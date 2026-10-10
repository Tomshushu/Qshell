import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { sshService } from '@/services/ssh-service'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from '@/i18n'
import type { ServiceInfo, ServiceProps, ServiceDependencies, WorkspaceModule } from '@/types'
import { useToast } from '@/components/ui/toast'
import {
  Loader2, RefreshCw, Play, Square, RotateCcw, X, Copy, Download, Search, Pause,
  Info, BarChart3, Network, Settings2, Cpu, Plug, Folder, FileText,
} from 'lucide-react'

/** 日志 RingBuffer 上限：超出后丢弃最旧行，避免长时间跟随导致内存无限增长 */
const MAX_LOG_LINES = 5000

type DetailTab =
  | 'overview'
  | 'logs'
  | 'resources'
  | 'dependencies'
  | 'config'
  | 'process'
  | 'ports'
  | 'files'

interface ServiceDetailDialogProps {
  serverId: string
  service: ServiceInfo | null
  /** 远端能力（journal 不可用时日志 Tab 降级） */
  capabilities: { journal: boolean; sudoNoPass: boolean } | null
  onClose: () => void
  /** 详情属性（由父组件加载后下发，对话框为受控展示组件） */
  props: ServiceProps
  loadingProps: boolean
  /** 操作成功后通知外层刷新列表 */
  onChanged: () => void
  /** 跳转到其他 Workspace 模块（由 workspace 注入，可选） */
  onNavigate?: (module: WorkspaceModule) => void
}

/** 秒 -> 人类可读时长 */
function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '-'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** 字节 -> 人类可读大小 */
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '-'
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

const LOG_LINES = [200, 500, 1000, 5000]
const LOG_LEVELS: { value: string; labelKey: string }[] = [
  { value: '', labelKey: 'svc_log_all' },
  { value: 'err', labelKey: 'svc_log_err' },
  { value: 'warning', labelKey: 'svc_log_warning' },
  { value: 'info', labelKey: 'svc_log_info' },
]
const LOG_RANGES: { value: string; labelKey: string }[] = [
  { value: '', labelKey: 'svc_log_range_all' },
  { value: '30 min ago', labelKey: 'svc_log_range_30m' },
  { value: '1 hour ago', labelKey: 'svc_log_range_1h' },
  { value: '1 day ago', labelKey: 'svc_log_range_1d' },
]

export function ServiceDetailDialog({
  serverId,
  service,
  capabilities,
  onClose,
  props,
  loadingProps,
  onChanged,
  onNavigate,
}: ServiceDetailDialogProps) {
  const { toast } = useToast()
  const { t } = useTranslation()
  const [tab, setTab] = useState<DetailTab>('overview')

  // 日志
  const [logs, setLogs] = useState('')
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [logLines, setLogLines] = useState(500)
  const [logLevel, setLogLevel] = useState('')
  const [logRange, setLogRange] = useState('')
  const [logFilter, setLogFilter] = useState('')
  // 实时跟随
  const [following, setFollowing] = useState(false)
  const [paused, setPaused] = useState(false)
  const [pendingLines, setPendingLines] = useState(0)
  const [autoScroll, setAutoScroll] = useState(true)
  const unlistenRef = useRef<(() => void) | null>(null)
  const [frozenLogs, setFrozenLogs] = useState('')
  const logBoxRef = useRef<HTMLPreElement>(null)

  // 资源
  const [cpuPercent, setCpuPercent] = useState<number | null>(null)
  const [samplingCpu, setSamplingCpu] = useState(false)

  // P1：依赖 / 配置 / 进程 / 端口（切到对应 Tab 时按需加载，离开不再轮询）
  const [deps, setDeps] = useState<ServiceDependencies | null>(null)
  const [unitFileText, setUnitFileText] = useState('')
  const [processText, setProcessText] = useState('')
  const [portsText, setPortsText] = useState('')
  const [loadingDeps, setLoadingDeps] = useState(false)
  const [loadingUnitFile, setLoadingUnitFile] = useState(false)
  const [loadingProcess, setLoadingProcess] = useState(false)
  const [loadingPorts, setLoadingPorts] = useState(false)
  // Mask / Unmask 二次确认
  const [pendingMask, setPendingMask] = useState<'mask' | 'unmask' | null>(null)

  const [acting, setActing] = useState<string | null>(null)

  const open = service !== null



  const loadLogs = useCallback(async (override?: { priority?: string }) => {
    if (!service) return
    if (capabilities && !capabilities.journal) return
    setLoadingLogs(true)
    try {
      const res = await sshService.serviceLogs(serverId, service.name, {
        lines: logLines,
        since: logRange || undefined,
        priority: override?.priority ?? (logLevel || undefined),
      })
      if (res.exitCode !== 0) {
        toast.error(res.stderr || res.stdout || t('svc_log_load_fail'))
        setLogs('')
      } else {
        setLogs(res.stdout || t('svc_log_empty'))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('svc_log_load_fail'))
    } finally {
      setLoadingLogs(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, service, logLines, logLevel, logRange, capabilities, toast])

  /** 追加日志并应用 RingBuffer 上限 */
  const appendLogs = useCallback((prev: string, chunk: string) => {
    const next = prev ? prev + chunk : chunk
    const lines = next.split('\n')
    return lines.length > MAX_LOG_LINES
      ? lines.slice(lines.length - MAX_LOG_LINES).join('\n')
      : next
  }, [])

  /** 启动实时跟随：journalctl -f，输出由 service:log:data 事件推送 */
  const startFollow = useCallback(async () => {
    if (!service || following) return
    try {
      const sid = await sshService.serviceLogFollowStart(serverId, service.name, logLines)
      setFollowing(true)
      setPaused(false)
      setPendingLines(0)
      unlistenRef.current = await listen<{ sessionId: string; data: string }>(
        'service:log:data',
        (e) => {
          if (e.payload.sessionId !== sid) return
          const chunk = e.payload.data || ''
          setLogs((prev) => appendLogs(prev, chunk))
          if (paused) setPendingLines((n) => n + Math.max(0, chunk.split('\n').length - 1))
        },
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('svc_log_follow_fail'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, following, serverId, logLines, appendLogs, paused, toast])

  const stopFollow = useCallback(async () => {
    unlistenRef.current?.()
    unlistenRef.current = null
    if (service) {
      try {
        await sshService.serviceLogFollowStop(serverId, service.name)
      } catch {
        /* 停止失败也继续清理本地状态 */
      }
    }
    setFollowing(false)
    setPaused(false)
    setPendingLines(0)
  }, [service, serverId])

  /** 暂停只冻结 UI 渲染，跟随仍在后台累积（pendingLines 为期间新增行数） */
  const togglePause = useCallback(() => {
    setPaused((p) => {
      if (!p) setFrozenLogs(logs)
      else setPendingLines(0)
      return !p
    })
  }, [logs])

  // 离开详情页 / 切换服务 / 关闭弹框时释放跟随订阅，防止隐藏后仍持有 SSH 流
  useEffect(() => {
    return () => {
      unlistenRef.current?.()
      unlistenRef.current = null
      if (service?.name) void sshService.serviceLogFollowStop(serverId, service.name).catch(() => {})
    }
  }, [serverId, service])

  // 跟随新日志时自动滚动到底部（用户手动上滚后自动关闭）
  useEffect(() => {
    if (!autoScroll || paused) return
    const el = logBoxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs, autoScroll, paused])



  // CPU 使用率：两次采样 CPUUsageNSec 差值 / 间隔（百分比，单核基准）
  const sampleCpu = useCallback(async () => {
    if (!service) return
    setSamplingCpu(true)
    try {
      const a = await sshService.serviceInspect(serverId, service.name)
      const t0 = performance.now()
      await new Promise((r) => setTimeout(r, 1500))
      const b = await sshService.serviceInspect(serverId, service.name)
      const dt = (performance.now() - t0) / 1000
      const da = Number(a?.CPUUsageNSec || 0)
      const db = Number(b?.CPUUsageNSec || 0)
      if (db >= da && dt > 0) {
        setCpuPercent(((db - da) / 1e9 / dt) * 100)
      }
    } catch {
      setCpuPercent(null)
    } finally {
      setSamplingCpu(false)
    }
  }, [serverId, service])

  /** 依赖（P1） */
  const loadDeps = useCallback(async () => {
    if (!service) return
    setLoadingDeps(true)
    try {
      const d = await sshService.serviceDependencies(serverId, service.name)
      setDeps(d)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('svc_deps_load_fail'))
    } finally {
      setLoadingDeps(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, service, toast])

  /** Unit 文件 + Drop-in（P1） */
  const loadUnitFile = useCallback(async () => {
    if (!service) return
    setLoadingUnitFile(true)
    try {
      const res = await sshService.serviceUnitFile(serverId, service.name)
      setUnitFileText(
        res.exitCode === 0 ? res.stdout || t('svc_config_empty') : res.stderr || res.stdout || t('svc_unit_file_fail'),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('svc_unit_file_fail'))
    } finally {
      setLoadingUnitFile(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, service, toast])

  /** 主进程与子进程（P1） */
  const loadProcess = useCallback(async () => {
    if (!service) return
    setLoadingProcess(true)
    try {
      const res = await sshService.serviceProcess(serverId, service.name)
      setProcessText(
        res.exitCode === 0 ? res.stdout || t('svc_process_empty') : res.stderr || res.stdout || t('svc_process_fail'),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('svc_process_fail'))
    } finally {
      setLoadingProcess(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, service, toast])

  /** 监听端口（P1） */
  const loadPorts = useCallback(async () => {
    if (!service) return
    setLoadingPorts(true)
    try {
      const res = await sshService.servicePorts(serverId, service.name)
      setPortsText(
        res.exitCode === 0 ? res.stdout || t('svc_ports_empty') : res.stderr || res.stdout || t('svc_ports_fail'),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('svc_ports_fail'))
    } finally {
      setLoadingPorts(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, service, toast])



  // Tab 懒加载：切到对应 Tab 时按需拉一次（事件驱动，替代 effect 内 setState）
  const handleTabChange = (next: DetailTab) => {
    setTab(next)
    if (next === 'logs' && !logs && !loadingLogs) void loadLogs()
    if (next === 'resources' && cpuPercent === null && !samplingCpu) void sampleCpu()
    if (next === 'dependencies' && !deps && !loadingDeps) void loadDeps()
    if (next === 'config' && !unitFileText && !loadingUnitFile) void loadUnitFile()
    if (next === 'process' && !processText && !loadingProcess) void loadProcess()
    if (next === 'ports' && !portsText && !loadingPorts) void loadPorts()
  }

  const runAction = useCallback(
    async (
      action:
        | 'start'
        | 'stop'
        | 'restart'
        | 'enable'
        | 'disable'
        | 'mask'
        | 'unmask'
        | 'daemon-reload',
    ) => {
      if (!service) return
      setActing(action)
      try {
        const res =
          action === 'start'
            ? await sshService.startService(serverId, service.name)
            : action === 'stop'
              ? await sshService.stopService(serverId, service.name)
              : action === 'restart'
                ? await sshService.restartService(serverId, service.name)
                : action === 'enable'
                  ? await sshService.serviceEnable(serverId, service.name)
                  : action === 'disable'
                    ? await sshService.serviceDisable(serverId, service.name)
                    : action === 'mask'
                      ? await sshService.serviceMask(serverId, service.name)
                      : action === 'unmask'
                        ? await sshService.serviceUnmask(serverId, service.name)
                        : await sshService.serviceDaemonReload(serverId)
        if (res.exitCode !== 0) {
          toast.error(res.stderr || res.stdout || t('svc_op_failed_with', { action }))
        } else {
          toast.success(t('svc_op_ok'))
          onChanged()
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('svc_op_failed'))
      } finally {
        setActing(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serverId, service, toast, onChanged],
  )

  // 解析属性
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [open])
  const pid = props.MainPID ? Number(props.MainPID) : null
  const startedMs = props.ExecMainStartTimestamp ? Number(props.ExecMainStartTimestamp) / 1000 : null
  const uptime = startedMs && startedMs > 0 ? (now - startedMs) / 1000 : null
  const memory = props.MemoryCurrent ? Number(props.MemoryCurrent) : null
  const tasks = props.TasksCurrent ? Number(props.TasksCurrent) : null
  const memLimit = props.MemoryLimit && Number(props.MemoryLimit) > 0 ? Number(props.MemoryLimit) : null

  const isFailed = service?.activeState === 'failed' || service?.subState === 'failed'
  const isActive = service?.active === true

  // 暂停时基于冻结快照渲染，跟随仍在后台累积到 logs
  const filteredLogs = useMemo(() => {
    const base = paused ? frozenLogs : logs
    if (!logFilter.trim()) return base
    const kw = logFilter.toLowerCase()
    return base
      .split('\n')
      .filter((l) => l.toLowerCase().includes(kw))
      .join('\n')
  }, [logs, paused, logFilter, frozenLogs])

  const copyLogs = () => {
    navigator.clipboard.writeText(filteredLogs)
    toast.success(t('svc_log_copied'))
  }

  const exportLogs = () => {
    const blob = new Blob([filteredLogs], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name || 'service'}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  const statusText = () => {
    if (isFailed) return t('svc_status_failed')
    if (isActive) return t('svc_status_running')
    return t('svc_status_stopped')
  }

  const statusColor = () => {
    if (isFailed) return 'text-red-500 bg-red-500/10'
    if (isActive) return 'text-green-500 bg-green-500/10'
    return 'text-muted-foreground bg-muted'
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        className="w-[min(940px,calc(100vw-2rem))] max-w-[940px] h-[min(700px,calc(100vh-2rem))] flex flex-col p-0 gap-0 overflow-hidden"
        showCloseButton={false}
      >
        {/* 关闭按钮：固定右上角（与 Docker 容器详情弹框一致） */}
        <div className="absolute top-0 right-0 z-20 p-3">
          <button
            className="p-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
            onClick={onClose}
            title={t('svc_close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab 切换栏：替代标题头（布局对齐 Docker 容器日志/状态弹框） */}
        <DialogTitle className="sr-only">{name}</DialogTitle>
        <div className="flex items-center gap-1 px-4 pt-3 pr-12 border-b border-border/60 shrink-0">
          {(
            [
              { key: 'overview' as DetailTab, label: t('svc_detail_overview'), icon: <Info className="h-3.5 w-3.5" /> },
              { key: 'logs' as DetailTab, label: t('svc_detail_logs'), icon: <FileText className="h-3.5 w-3.5" /> },
              { key: 'resources' as DetailTab, label: t('svc_detail_resources'), icon: <BarChart3 className="h-3.5 w-3.5" /> },
              { key: 'dependencies' as DetailTab, label: t('svc_detail_deps'), icon: <Network className="h-3.5 w-3.5" /> },
              { key: 'config' as DetailTab, label: t('svc_detail_config'), icon: <Settings2 className="h-3.5 w-3.5" /> },
              { key: 'process' as DetailTab, label: t('svc_detail_process'), icon: <Cpu className="h-3.5 w-3.5" /> },
              { key: 'ports' as DetailTab, label: t('svc_detail_ports'), icon: <Plug className="h-3.5 w-3.5" /> },
              { key: 'files' as DetailTab, label: t('svc_detail_files'), icon: <Folder className="h-3.5 w-3.5" /> },
            ]
          ).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => handleTabChange(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                tab === key
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-1.5 min-w-0 flex-shrink-0 pr-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" title={t('svc_refresh')} onClick={onChanged} disabled={loadingProps}>
              <RefreshCw className={`h-3.5 w-3.5 ${loadingProps ? 'animate-spin' : ''}`} />
            </Button>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusColor()}`}>
              {statusText()}
            </span>
            {service?.enabledState && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {t('svc_auto_badge')} {service.enabledState}
              </span>
            )}
            <span className="text-[11px] text-muted-foreground truncate" title={name}>{name}</span>
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 flex flex-col px-5 py-4 overflow-hidden">
          {loadingProps && !props.Id && !props.MainPID ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              <span className="text-sm">{t('svc_detail_loading')}</span>
            </div>
          ) : tab === 'overview' ? (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
              {/* 失败诊断摘要：先诊断、后操作 */}
              {isFailed && (
                <div className="rounded-md border border-red-500/30 bg-red-500/[0.06] p-3">
                  <div className="text-xs font-medium text-red-500 mb-2">{t('svc_diag_failed_title')}</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                    <span className="text-muted-foreground">{t('svc_diag_result')}</span>
                    <span className="font-mono">{props.Result || '-'}</span>
                    <span className="text-muted-foreground">{t('svc_diag_exit_code')}</span>
                    <span className="font-mono">{props.ExecMainStatus ?? '-'}</span>
                    <span className="text-muted-foreground">{t('svc_diag_restarts')}</span>
                    <span className="font-mono">{props.NRestarts ?? '-'}</span>
                    <span className="text-muted-foreground">{t('svc_diag_restart_policy')}</span>
                    <span className="font-mono">{props.Restart || '-'}</span>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button
                      size="sm"
                      className="h-6 text-[11px]"
                      onClick={() => {
                        setLogLevel('err')
                        setTab('logs')
                        setLogs('')
                        void loadLogs({ priority: 'err' })
                      }}
                    >
                      {t('svc_diag_view_logs')}
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => void runAction('restart')} disabled={acting !== null}>
                      {t('svc_diag_retry')}
                    </Button>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-2">
                    {t('svc_diag_note')}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                <span className="text-muted-foreground">{t('svc_detail_active')}</span>
                <span className="font-mono">{props.ActiveState || service?.activeState || '-'}</span>
                <span className="text-muted-foreground">{t('svc_detail_sub')}</span>
                <span className="font-mono">{props.SubState || service?.subState || '-'}</span>
                <span className="text-muted-foreground">{t('svc_detail_load')}</span>
                <span className="font-mono">{props.LoadState || service?.loadState || '-'}</span>
                <span className="text-muted-foreground">{t('svc_detail_auto')}</span>
                <span className="font-mono">{props.UnitFileState || service?.enabledState || '-'}</span>
                <span className="text-muted-foreground">{t('svc_detail_pid')}</span>
                <span className="font-mono">{pid && pid > 0 ? pid : '-'}</span>
                <span className="text-muted-foreground">{t('svc_detail_uptime')}</span>
                <span className="font-mono">{uptime ? formatUptime(uptime) : '-'}</span>
                <span className="text-muted-foreground">{t('svc_detail_user')}</span>
                <span className="font-mono">{props.User || '-'}</span>
                <span className="text-muted-foreground">{t('svc_detail_unit_path')}</span>
                <span className="font-mono break-all">{props.FragmentPath || '-'}</span>
                <span className="text-muted-foreground">{t('svc_diag_restart_policy')}</span>
                <span className="font-mono">{props.Restart || '-'}</span>
              </div>
            </div>
          ) : tab === 'logs' ? (
            <div className="flex-1 min-h-0 flex flex-col gap-2.5">
              {capabilities && !capabilities.journal ? (
                <div className="text-xs text-muted-foreground border rounded-md p-3">
                  {t('svc_no_journal')}
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 flex-wrap shrink-0">
                    <select
                      className="h-7 text-xs rounded-md border border-border bg-card px-2"
                      value={logLines}
                      onChange={(e) => setLogLines(Number(e.target.value))}
                    >
                      {LOG_LINES.map((n) => (
                        <option key={n} value={n}>{t('svc_log_lines').replace('{n}', String(n))}</option>
                      ))}
                    </select>
                    <select
                      className="h-7 text-xs rounded-md border border-border bg-card px-2"
                      value={logLevel}
                      onChange={(e) => setLogLevel(e.target.value)}
                    >
                      {LOG_LEVELS.map((l) => (
                        <option key={l.value} value={l.value}>{t(l.labelKey)}</option>
                      ))}
                    </select>
                    <select
                      className="h-7 text-xs rounded-md border border-border bg-card px-2"
                      value={logRange}
                      onChange={(e) => setLogRange(e.target.value)}
                    >
                      {LOG_RANGES.map((r) => (
                        <option key={r.value} value={r.value}>{t(r.labelKey)}</option>
                      ))}
                    </select>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={loadLogs} disabled={loadingLogs}>
                      <RefreshCw className={`h-3 w-3 mr-1 ${loadingLogs ? 'animate-spin' : ''}`} />
                      {t('svc_log_refresh')}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={copyLogs} disabled={!logs}>
                      <Copy className="h-3 w-3 mr-1" />{t('svc_log_copy')}
                    </Button>
                    <Button
                      size="sm"
                      variant={following ? 'secondary' : 'ghost'}
                      className="h-7 text-xs"
                      onClick={() => (following ? void stopFollow() : void startFollow())}
                      disabled={loadingLogs}
                      title={following ? 'journalctl -f' : 'journalctl -f'}
                    >
                      {following ? t('svc_log_stop_follow') : t('svc_log_follow')}
                    </Button>
                    {following && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={togglePause}>
                        <Pause className="h-3 w-3 mr-1" />
                        {paused ? `${t('svc_log_resume')}${pendingLines > 0 ? ` (+${pendingLines})` : ''}` : t('svc_log_pause')}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={exportLogs} disabled={!logs}>
                      <Download className="h-3 w-3 mr-1" />{t('svc_log_export')}
                    </Button>
                    <div className="flex-1" />
                    <div className="relative w-40">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                      <input
                        className="h-7 w-full text-xs pl-7 pr-2 rounded-md border border-border bg-card"
                        placeholder={t('svc_log_filter')}
                        value={logFilter}
                        onChange={(e) => setLogFilter(e.target.value)}
                      />
                    </div>
                  </div>
                  <pre
                    ref={logBoxRef}
                    onScroll={(e) => {
                      const el = e.currentTarget
                      // 距底部 24px 内视为在底部，恢复自动滚动
                      setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
                    }}
                    className="flex-1 min-h-0 overflow-auto text-[11px] font-mono bg-zinc-950 text-emerald-400 p-3 rounded-lg border border-border/50 shadow-inner leading-relaxed"
                  >
                    {loadingLogs ? t('svc_detail_loading') : filteredLogs || t('svc_log_empty')}
                  </pre>
                </>
              )}
            </div>
          ) : tab === 'resources' ? (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                <span className="text-muted-foreground">{t('svc_res_mem')}</span>
                <span className="font-mono">{memory ? formatBytes(memory) : '-'}</span>
                <span className="text-muted-foreground">{t('svc_res_mem_limit')}</span>
                <span className="font-mono">{memLimit ? formatBytes(memLimit) : t('svc_res_unlimited')}</span>
                <span className="text-muted-foreground">{t('svc_res_tasks')}</span>
                <span className="font-mono">{tasks ?? '-'}</span>
                <span className="text-muted-foreground">{t('svc_res_cpu')}</span>
                <span className="font-mono">
                  {cpuPercent !== null ? `${cpuPercent.toFixed(2)}%` : '-'}
                </span>
                <span className="text-muted-foreground">{t('svc_res_cpu_total')}</span>
                <span className="font-mono">
                  {props.CPUUsageNSec ? `${(Number(props.CPUUsageNSec) / 1e9).toFixed(1)}s` : '-'}
                </span>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={sampleCpu} disabled={samplingCpu}>
                <RefreshCw className={`h-3 w-3 mr-1 ${samplingCpu ? 'animate-spin' : ''}`} />
                {t('svc_res_resample')}
              </Button>
              <div className="text-[10px] text-muted-foreground">
                {t('svc_res_note')}
              </div>
            </div>
          ) : tab === 'dependencies' ? (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t('svc_deps_title')}</span>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={loadDeps} disabled={loadingDeps}>
                  <RefreshCw className={`h-3 w-3 mr-1 ${loadingDeps ? 'animate-spin' : ''}`} />
                  {t('svc_log_refresh')}
                </Button>
              </div>
              {loadingDeps ? (
                <div className="text-xs text-muted-foreground">{t('svc_detail_loading')}</div>
              ) : !deps ? (
                <div className="text-xs text-muted-foreground">{t('svc_deps_none')}</div>
              ) : (
                <div className="space-y-2">
                  {(
                    [
                      ['requires', t('svc_dep_requires')],
                      ['wants', t('svc_dep_wants')],
                      ['requisite', t('svc_dep_requisite')],
                      ['bindsTo', t('svc_dep_bindsTo')],
                      ['partOf', t('svc_dep_partOf')],
                      ['conflicts', t('svc_dep_conflicts')],
                      ['after', t('svc_dep_after')],
                      ['before', t('svc_dep_before')],
                      ['requiredBy', t('svc_dep_requiredBy')],
                      ['wantedBy', t('svc_dep_wantedBy')],
                    ] as [keyof ServiceDependencies, string][]
                  ).map(([key, label]) => {
                    const items = deps[key] || []
                    if (items.length === 0) return null
                    return (
                      <div key={key}>
                        <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
                        <div className="flex flex-wrap gap-1">
                          {items.map((u) => {
                            const st = deps.states?.[u]
                            // 依赖节点状态色：Running(绿) / Failed(红) / 变更中(黄) / Not Found(删除线) / 已停止(灰)
                            const color =
                              st?.activeState === 'active'
                                ? 'text-green-500'
                                : st?.activeState === 'failed'
                                  ? 'text-red-500'
                                  : st?.activeState === 'activating' || st?.activeState === 'deactivating'
                                    ? 'text-amber-500'
                                    : st?.loadState === 'not-found'
                                      ? 'text-muted-foreground/50 line-through'
                                      : 'text-muted-foreground'
                            return (
                              <span
                                key={u}
                                className={`text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted ${color}`}
                                title={
                                  st
                                    ? `${st.activeState} / ${st.subState} / ${st.loadState}`
                                    : t('svc_dep_status_unknown')
                                }
                              >
                                {u}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                  {Object.values(deps).every((v) => (v?.length ?? 0) === 0) && (
                    <div className="text-xs text-muted-foreground">{t('svc_deps_empty')}</div>
                  )}
                </div>
              )}
            </div>
          ) : tab === 'config' ? (
            <div className="flex-1 min-h-0 flex flex-col gap-2">
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground">{t('svc_config_desc')}</span>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={loadUnitFile} disabled={loadingUnitFile}>
                  <RefreshCw className={`h-3 w-3 mr-1 ${loadingUnitFile ? 'animate-spin' : ''}`} />
                  {t('svc_log_refresh')}
                </Button>
              </div>
              <pre className="flex-1 min-h-0 overflow-auto text-[11px] font-mono bg-zinc-950 text-zinc-200 p-3 rounded-lg border border-border/50 shadow-inner leading-relaxed">
                {loadingUnitFile ? t('svc_detail_loading') : unitFileText || t('svc_config_empty')}
              </pre>
            </div>
          ) : tab === 'process' ? (
            <div className="flex-1 min-h-0 flex flex-col gap-2">
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground">{t('svc_process_desc')}</span>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={loadProcess} disabled={loadingProcess}>
                  <RefreshCw className={`h-3 w-3 mr-1 ${loadingProcess ? 'animate-spin' : ''}`} />
                  {t('svc_log_refresh')}
                </Button>
              </div>
              <pre className="flex-1 min-h-0 overflow-auto text-[11px] font-mono bg-zinc-950 text-zinc-200 p-3 rounded-lg border border-border/50 shadow-inner leading-relaxed">
                {loadingProcess ? t('svc_detail_loading') : processText || t('svc_process_empty')}
              </pre>
            </div>
          ) : tab === 'ports' ? (
            <div className="flex-1 min-h-0 flex flex-col gap-2">
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground">{t('svc_ports_desc')}</span>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={loadPorts} disabled={loadingPorts}>
                  <RefreshCw className={`h-3 w-3 mr-1 ${loadingPorts ? 'animate-spin' : ''}`} />
                  {t('svc_log_refresh')}
                </Button>
              </div>
              <pre className="flex-1 min-h-0 overflow-auto text-[11px] font-mono bg-zinc-950 text-zinc-200 p-3 rounded-lg border border-border/50 shadow-inner leading-relaxed">
                {loadingPorts ? t('svc_detail_loading') : portsText || t('svc_ports_empty')}
              </pre>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
              <div className="text-xs text-muted-foreground">{t('svc_files_desc')}</div>
              <div className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-xs items-start">
                <span className="text-muted-foreground">{t('svc_detail_unit_path')}</span>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono break-all">{props.FragmentPath || '-'}</span>
                  {props.FragmentPath && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] shrink-0"
                        onClick={() => {
                          navigator.clipboard.writeText(props.FragmentPath || '')
                          toast.success(t('svc_path_copied'))
                        }}
                      >
                        {t('svc_copy')}
                      </Button>
                      {onNavigate && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] shrink-0"
                          title={t('svc_files_open_title')}
                          onClick={() => {
                            navigator.clipboard.writeText(props.FragmentPath || '')
                            onNavigate('files')
                            toast.success(t('svc_files_switched'))
                          }}
                        >
                          {t('svc_files_open')}
                        </Button>
                      )}
                    </>
                  )}
                </div>
                <span className="text-muted-foreground">{t('svc_files_dropin')}</span>
                <span className="font-mono break-all">
                  {props.DropInPaths || (props.FragmentPath ? `/etc/systemd/system/${name}.d/` : '-')}
                </span>
                <span className="text-muted-foreground">{t('svc_files_workdir')}</span>
                <span className="font-mono break-all">{props.WorkingDirectory || '-'}</span>
                <span className="text-muted-foreground">ExecStart</span>
                <span className="font-mono break-all">{props.ExecStart || '-'}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer 操作 */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border/60 shrink-0 bg-muted/10">
          {isActive ? (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void runAction('stop')} disabled={acting !== null}>
                {acting === 'stop' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Square className="h-3 w-3 mr-1" />}
                {t('svc_stop')}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void runAction('restart')} disabled={acting !== null}>
                {acting === 'restart' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                {t('svc_restart')}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void runAction('start')} disabled={acting !== null}>
              {acting === 'start' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
              {t('svc_start')}
            </Button>
          )}
          {service?.enabled ? (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void runAction('disable')} disabled={acting !== null}>
              {t('svc_disable_auto')}
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void runAction('enable')} disabled={acting !== null}>
              {t('svc_enable_auto')}
            </Button>
          )}
          {service?.enabledState === 'masked' ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setPendingMask('unmask')}
              disabled={acting !== null}
            >
              {t('svc_unmask')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-red-500"
              onClick={() => setPendingMask('mask')}
              disabled={acting !== null}
            >
              {t('svc_mask')}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => void runAction('daemon-reload')}
            disabled={acting !== null}
            title={t('svc_reload_title')}
          >
            {t('svc_reload')}
          </Button>
          <div className="flex-1" />
          {capabilities && !capabilities.sudoNoPass && (
            <span className="text-[10px] text-muted-foreground">{t('svc_sudo_hint')}</span>
          )}
        </div>

        {/* Mask / Unmask 二次确认：Mask 比 Disable 更强，必须明确影响 */}
        <ConfirmDialog
          open={pendingMask !== null}
          title={pendingMask === 'mask' ? t('svc_mask_title') : t('svc_unmask_title')}
          description={
            pendingMask === 'mask'
              ? t('svc_mask_confirm', { name })
              : t('svc_unmask_confirm', { name })
          }
          confirmLabel={t('svc_confirm_ok')}
          variant="destructive"
          pending={acting === 'mask' || acting === 'unmask'}
          onConfirm={() => {
            const op = pendingMask
            setPendingMask(null)
            if (op) void runAction(op)
          }}
          onCancel={() => setPendingMask(null)}
        />
      </DialogContent>
    </Dialog>
  )
}
