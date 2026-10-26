import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { RefreshCw, FileText, Search, Loader2, BarChart3, MoreVertical } from 'lucide-react'
import { sshService } from '@/services/ssh-service'
import type { ServiceInfo, ServiceCapabilities, ServiceResource, ServiceResourceRawMap, WorkspaceModule, ServiceProps } from '@/types'
import { useTranslation } from '@/i18n'
import { ServiceDetailDialog } from './service-detail-dialog'
import { useToast } from '@/components/ui/toast'
import { QshellLoader } from '@/components/ui/qshell-loader'

/** 批量操作对应的 i18n key（默认不提供批量 Mask，风险过高） */
const BATCH_LABEL_KEY: Record<'start' | 'stop' | 'restart' | 'enable' | 'disable', string> = {
  start: 'svc_start',
  stop: 'svc_stop',
  restart: 'svc_restart',
  enable: 'svc_batch_enable',
  disable: 'svc_batch_disable',
}

/** 字节 -> 人类可读大小 */
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '-'
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

/** CPU 采样间隔（秒）：与后端 CPUUsageNSec 差值一起计算使用率 */
const CPU_SAMPLE_INTERVAL = 1.5

type StatusFilter = 'all' | 'running' | 'stopped' | 'failed'

interface ServicesModuleProps {
  serverId: string
  /** 跳转到其他 Workspace 模块（由 workspace 注入，例如「在文件模块中打开」） */
  onNavigate?: (module: WorkspaceModule) => void
  initialSearchQuery?: string
}

export function ServicesModule({ serverId, onNavigate, initialSearchQuery }: ServicesModuleProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [services, setServices] = useState<ServiceInfo[]>([])
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '')
  const [prevInitialSearchQuery, setPrevInitialSearchQuery] = useState(initialSearchQuery)
  if (initialSearchQuery !== prevInitialSearchQuery) {
    setPrevInitialSearchQuery(initialSearchQuery)
    setSearchQuery(initialSearchQuery || '')
  }

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  // 远端服务能力（systemd / journalctl / sudo），驱动详情页能力降级
  const [capabilities, setCapabilities] = useState<ServiceCapabilities | null>(null)
  // 打开详情的服务（null 表示关闭）
  const [detailService, setDetailService] = useState<ServiceInfo | null>(null)
  // 详情属性与加载态：在打开时拉取并下发，对话框为受控展示组件
  const [detailProps, setDetailProps] = useState<ServiceProps>({})
  const [detailLoading, setDetailLoading] = useState(false)
  // 加载详情属性（操作后也可复用刷新）；属性以 props 形式下发到对话框
  const loadDetailProps = (svc: ServiceInfo) => {
    setDetailProps({})
    setDetailLoading(true)
    return sshService
      .serviceInspect(serverId, svc.name)
      .then((p) => setDetailProps(p || {}))
      .catch(() => setDetailProps({}))
      .finally(() => setDetailLoading(false))
  }
  // 打开详情：记录当前服务并加载其属性
  const openDetail = (svc: ServiceInfo) => {
    setDetailService(svc)
    void loadDetailProps(svc)
  }

  // === 批量操作 ===
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set())
  const [batchRunning, setBatchRunning] = useState<'start' | 'stop' | 'restart' | 'enable' | 'disable' | null>(null)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)
  const [batchFailures, setBatchFailures] = useState<{ name: string; error: string }[]>([])
  // === 资源列：按需加载，默认关闭（避免为数字高频刷新） ===
  const [showResources, setShowResources] = useState(false)
  const [resources, setResources] = useState<Record<string, ServiceResource> | null>(null)
  const [loadingResources, setLoadingResources] = useState(false)

  // 按需采集资源：两次采样 CPUUsageNSec 求差算 CPU%，一次命令覆盖全部服务
  const loadResources = useCallback(async () => {
    setLoadingResources(true)
    try {
      const first: ServiceResourceRawMap = await sshService.serviceResources(serverId)
      await new Promise((r) => setTimeout(r, CPU_SAMPLE_INTERVAL * 1000))
      const second: ServiceResourceRawMap = await sshService.serviceResources(serverId)
      const next: Record<string, ServiceResource> = {}
      for (const [unit, cur] of Object.entries(second)) {
        const prev = first[unit]
        const curNs = cur?.cpuNs ?? 0
        const prevNs = prev?.cpuNs ?? 0
        const cpuPercent =
          curNs >= prevNs ? ((curNs - prevNs) / 1e9 / CPU_SAMPLE_INTERVAL) * 100 : 0
        next[unit] = {
          memoryBytes: cur?.memoryBytes ?? 0,
          tasks: cur?.tasks ?? 0,
          cpuPercent,
        }
      }
      setResources(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('svc_res_collect_fail'))
    } finally {
      setLoadingResources(false)
    }
     
  }, [serverId, t])

  const fetchServices = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await sshService.listServices(serverId)
      setServices(data)
      if (showResources) {
        void loadResources()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('svc_err_load'))
    } finally {
      setLoading(false)
    }
     
  }, [serverId, showResources, loadResources, t])

  useEffect(() => {

    fetchServices()
  }, [fetchServices])

  // 能力探测：systemd / journalctl / sudo（一次性，驱动日志 Tab 降级与权限提示）
  useEffect(() => {
    let cancelled = false
    const detect = async () => {
      try {
        const caps = await sshService.serviceCapabilities(serverId)
        if (!cancelled) setCapabilities(caps)
      } catch {
        if (!cancelled) setCapabilities(null)
      }
    }
    void detect()
    return () => {
      cancelled = true
    }
  }, [serverId])

  // 切换开机自启（Enable / Disable）
  // 语义与 Start / Stop 分离：只改开机策略，不改变当前运行实例
  const handleToggleEnabled = async (service: ServiceInfo) => {
    setActionLoading(service.name)
    try {
      const res = service.enabled
        ? await sshService.serviceDisable(serverId, service.name)
        : await sshService.serviceEnable(serverId, service.name)
      if (res.exitCode !== 0) {
        setError(t(service.enabled ? 'svc_disable_auto_fail' : 'svc_enable_auto_fail', {
          err: res.stderr || res.stdout || t('svc_unknown_error'),
        }))
      } else {
        await fetchServices()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('svc_op_failed'))
    } finally {
      setActionLoading(null)
    }
  }

  // 批量操作：并发度 4，单个失败不阻塞其他，最终汇总成功/失败
  const runBatch = async (action: 'start' | 'stop' | 'restart' | 'enable' | 'disable') => {
    const targets = [...selectedNames]
    if (targets.length === 0 || batchRunning) return
    setError(null)
    setBatchFailures([])
    setBatchRunning(action)
    setBatchProgress({ done: 0, total: targets.length })

    const CONCURRENCY = 4
    const failures: { name: string; error: string }[] = []
    let cursor = 0
    const worker = async () => {
      while (cursor < targets.length) {
        const name = targets[cursor++]
        try {
          const res =
            action === 'start'
              ? await sshService.startService(serverId, name)
              : action === 'stop'
                ? await sshService.stopService(serverId, name)
                : action === 'restart'
                  ? await sshService.restartService(serverId, name)
                  : action === 'enable'
                    ? await sshService.serviceEnable(serverId, name)
                    : await sshService.serviceDisable(serverId, name)
          if (res.exitCode !== 0) {
            failures.push({ name, error: res.stderr || res.stdout || t('svc_unknown_error') })
          }
        } catch (err) {
          failures.push({ name, error: err instanceof Error ? err.message : t('svc_op_execute_err') })
        }
        setBatchProgress((p) => (p ? { ...p, done: p.done + 1 } : p))
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()),
    )

    setBatchRunning(null)
    setBatchProgress(null)
    const actionLabel = t(BATCH_LABEL_KEY[action])
    if (failures.length === 0) {
      toast.success(
        t('svc_batch_success').replace('{action}', actionLabel).replace('{count}', String(targets.length)),
      )
    } else {
      setBatchFailures(failures)
      toast.error(
        t('svc_batch_summary')
          .replace('{action}', actionLabel)
          .replace('{ok}', String(targets.length - failures.length))
          .replace('{fail}', String(failures.length)),
      )
    }
    await fetchServices()
    setSelectedNames(new Set())
  }

  // 资源列开关：开启时采集一次，关闭时清空（不持续轮询）
  const toggleResources = async () => {
    if (showResources) {
      setShowResources(false)
      setResources(null)
      return
    }
    setShowResources(true)
    if (!resources) await loadResources()
  }

  const filteredServices = services.filter((s) => {
    const matchesSearch = !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesFilter =
      statusFilter === 'all' ||
      (statusFilter === 'running' && s.active) ||
      (statusFilter === 'stopped' && !s.active && s.subState !== 'failed') ||
      (statusFilter === 'failed' && s.subState === 'failed')
    return matchesSearch && matchesFilter
  })

  const statusBadge = (service: ServiceInfo) => {
    if (service.active) {
      return (
        <Badge variant="soft-success" className="gap-1.5 px-2 py-0.5 text-[10px] font-normal tracking-wide">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 status-dot-pulse" />
          active ({service.subState})
        </Badge>
      )
    }
    if (service.subState === 'failed') {
      return (
        <Badge variant="soft-destructive" className="gap-1.5 px-2 py-0.5 text-[10px] font-normal tracking-wide">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
          failed
        </Badge>
      )
    }
    return (
      <Badge variant="soft" className="gap-1.5 px-2 py-0.5 text-[10px] font-normal tracking-wide">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
        inactive
      </Badge>
    )
  }

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* 统一规范工具栏 */}
      <div className="flex items-center gap-2.5 px-4 h-11 border-b border-border/50 bg-muted/20 shrink-0 flex-wrap">
        <Button
          variant="ghost"
          onClick={fetchServices}
          disabled={loading}
          size="sm"
          className="gap-1 h-7 text-xs"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('svc_refresh')}
        </Button>

        <div className="h-3.5 w-[1px] bg-border/60" />

        <div className="flex items-center rounded-lg border border-border/50 bg-muted/40 p-0.5 text-xs">
          {(['all', 'running', 'stopped', 'failed'] as StatusFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-all ${
                statusFilter === f ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setStatusFilter(f)}
            >
              {f === 'all' ? t('svc_all') : f === 'running' ? t('svc_running') : f === 'stopped' ? t('svc_stopped') : t('svc_failed')}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="relative w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t('svc_search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-8 text-xs bg-background/80"
          />
        </div>

        <Button
          size="sm"
          variant={showResources ? 'secondary' : 'ghost'}
          className="h-7 text-xs gap-1"
          onClick={() => void toggleResources()}
          disabled={loadingResources}
          title={t('svc_res_toggle_hint')}
        >
          {loadingResources ? <Loader2 className="h-3 w-3 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
          {t('svc_res_toggle')}
        </Button>
      </div>

      {/* 批量操作工具栏（选中后出现） */}
      {selectedNames.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40 bg-accent/30 flex-wrap">
          <span className="text-xs whitespace-nowrap">
            {t('svc_batch_selected').replace('{count}', String(selectedNames.size))}
          </span>
          <div className="flex gap-1 flex-wrap">
            {(['start', 'stop', 'restart', 'enable', 'disable'] as const).map((a) => (
              <Button
                key={a}
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={batchRunning !== null}
                onClick={() => void runBatch(a)}
              >
                {t(BATCH_LABEL_KEY[a])}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            disabled={batchRunning !== null}
            onClick={() => setSelectedNames(new Set())}
          >
            {t('svc_batch_clear')}
          </Button>
          {batchProgress && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {batchRunning
                ? t('svc_batch_progress')
                    .replace('{action}', t(BATCH_LABEL_KEY[batchRunning]))
                    .replace('{done}', String(batchProgress.done))
                    .replace('{total}', String(batchProgress.total))
                : t('svc_batch_done')
                    .replace('{done}', String(batchProgress.done))
                    .replace('{total}', String(batchProgress.total))}
            </span>
          )}
        </div>
      )}

      {/* 批量失败明细：单个失败不阻塞其他任务，最终汇总展示 */}
      {batchFailures.length > 0 && (
        <div className="px-4 py-2 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs border-b border-rose-500/20">
          <div className="flex items-center">
            <span>{t('svc_batch_fail_title').replace('{count}', String(batchFailures.length))}</span>
            <Button variant="ghost" size="sm" className="h-4 text-[10px] ml-2" onClick={() => setBatchFailures([])}>
              {t('svc_close')}
            </Button>
          </div>
          <ul className="mt-1 space-y-0.5 max-h-24 overflow-auto">
            {batchFailures.map((f) => (
              <li key={f.name} className="font-mono truncate" title={f.error}>
                {f.name}: {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="px-4 py-2 bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs border-b border-rose-500/20 flex items-center justify-between">
          <span>{error}</span>
          <Button variant="ghost" size="sm" className="h-4 text-[10px] ml-2" onClick={() => setError(null)}>{t('svc_close')}</Button>
        </div>
      )}

      {/* Service list */}
      <div className="flex-1 overflow-auto">
        {loading && services.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <QshellLoader size="md" text={t('svc_loading')} />

          </div>
        ) : services.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <FileText className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">{t('svc_empty')}</p>
          </div>
        ) : (
          <div className="p-3">
            <div className="rounded-xl border border-border/70 bg-card shadow-xs overflow-hidden">
              <table className="w-full text-xs">
            <thead className="workspace-table-head">
              <tr className="text-left text-muted-foreground">
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    className="h-3 w-3"
                    checked={filteredServices.length > 0 && filteredServices.every((s) => selectedNames.has(s.name))}
                    ref={(el) => {
                      if (el) {
                        const all = filteredServices.length > 0 && filteredServices.every((s) => selectedNames.has(s.name))
                        el.indeterminate = !all && filteredServices.some((s) => selectedNames.has(s.name))
                      }
                    }}
                    onChange={(e) => {
                      setSelectedNames(e.target.checked ? new Set(filteredServices.map((s) => s.name)) : new Set())
                    }}
                    title={t('svc_select_all_title')}
                  />
                </th>
                <th className="px-3 py-2 font-medium">{t('svc_th_name')}</th>
                <th className="px-3 py-2 font-medium">{t('svc_th_desc')}</th>
                <th className="px-3 py-2 font-medium">{t('svc_th_status')}</th>
                <th className="px-3 py-2 font-medium">{t('svc_th_auto')}</th>
                {showResources && <th className="px-3 py-2 font-medium">{t('svc_th_cpu')}</th>}
                {showResources && <th className="px-3 py-2 font-medium">{t('svc_th_mem')}</th>}
                <th className="px-3 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {filteredServices.map((service) => (
                <tr key={service.name} className="border-b hover:bg-accent/30" onDoubleClick={() => openDetail(service)}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-3 w-3"
                      checked={selectedNames.has(service.name)}
                      onChange={(e) => {
                        setSelectedNames((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(service.name)
                          else next.delete(service.name)
                          return next
                        })
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium">
                    <span
                      className="truncate cursor-pointer hover:underline"
                      title={t('svc_open_detail')}
                      onClick={() => openDetail(service)}
                    >
                      {service.name}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground truncate max-w-[200px]">{service.description}</td>
                  <td className="px-3 py-2">{statusBadge(service)}</td>
                  <td className="px-3 py-2">
                    <button
                      className={`text-[11px] hover:underline disabled:opacity-40 disabled:no-underline ${
                        service.enabledState === 'enabled'
                          ? 'text-green-500'
                          : service.enabledState === 'masked'
                            ? 'text-red-500'
                            : 'text-muted-foreground'
                      }`}
                      disabled={
                        actionLoading === service.name ||
                        service.enabledState === 'masked' ||
                        service.enabledState === 'static'
                      }
                      title={
                        service.enabledState === 'masked'
                          ? t('svc_auto_masked')
                          : service.enabledState === 'static'
                            ? t('svc_auto_static')
                            : service.enabled
                              ? t('svc_auto_click_disable')
                              : t('svc_auto_click_enable')
                      }
                      onClick={() => handleToggleEnabled(service)}
                    >
                      {service.enabledState || 'unknown'}
                    </button>
                  </td>
                  {showResources && (
                    <td className="px-3 py-2 tabular-nums">
                      {resources?.[service.name] ? `${resources[service.name]!.cpuPercent.toFixed(1)}%` : '-'}
                    </td>
                  )}
                  {showResources && (
                    <td className="px-3 py-2 tabular-nums">
                      {resources?.[service.name] ? formatBytes(resources[service.name]!.memoryBytes) : '-'}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                      title={t('svc_open_detail')}
                      onClick={() => openDetail(service)}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
        )}

        {filteredServices.length === 0 && services.length > 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Search className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">{t('svc_no_match')}</p>
          </div>
        )}
      </div>

      {/* 服务详情：概览 / 日志 / 资源 / 失败诊断 */}
      <ServiceDetailDialog
        key={detailService ? `${serverId}:${detailService.name}` : 'closed'}
        serverId={serverId}
        service={detailService}
        props={detailProps}
        loadingProps={detailLoading}
        capabilities={capabilities}
        onNavigate={onNavigate}
        onClose={() => setDetailService(null)}
        onChanged={() => {
          void fetchServices()
          if (detailService) void loadDetailProps(detailService)
        }}
      />
    </div>
  )
}
