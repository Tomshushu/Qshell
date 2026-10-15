import { Fragment, useMemo, useState, useEffect, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Eye,
  GitBranch,
  List,
  RefreshCw,
  Search,
  Skull,
  Terminal,
  Loader2,
  Copy,
} from 'lucide-react'
import { sshService } from '@/services/ssh-service'
import { useTranslation, translate } from '@/i18n'
import { useToast } from '@/components/ui/toast'
import { useAppStore } from '@/store'
import { extractBaseServerId } from '@/services/ssh-connection-state'
import type { ProcessInfo, PortInfo, WorkspaceModule, NavigationContext } from '@/types'
import { refreshProcessSnapshot, useProcessSnapshot } from './process-store'

type SortField = 'pid' | 'ppid' | 'cpu' | 'memory' | 'vsz' | 'rss' | 'command'
type SortDir = 'asc' | 'desc'
type ViewMode = 'list' | 'tree'

interface ProcessesModuleProps {
  serverId: string
  /** 跳转到其它模块 */
  onNavigate?: (module: WorkspaceModule, context?: NavigationContext) => void
}

interface ProcessNode {
  proc: ProcessInfo
  children: ProcessNode[]
  depth: number
}

interface ConfirmState {
  open: boolean
  signal: 'term' | 'kill' | null
  proc: ProcessInfo | null
}

const INTERVAL_OPTIONS = [1000, 2000, 3000, 5000, 10000]

function formatSize(kb: number): string {
  if (kb >= 1048576) return `${(kb / 1048576).toFixed(1)}G`
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)}M`
  return `${kb}K`
}

function formatRuntime(seconds: number): string {
  if (!seconds || seconds < 0) return '-'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (d > 0) return `${d}${translate('time_days')} ${h}${translate('time_hours')}`
  if (h > 0) return `${h}${translate('time_hours')} ${m}${translate('time_minutes')}`
  if (m > 0) return `${m}${translate('time_minutes')} ${s}${translate('time_seconds')}`
  return `${s}${translate('time_seconds')}`
}

function cpuClass(v: number): string {
  if (v > 10) return 'text-red-500 font-medium'
  if (v > 5) return 'text-yellow-500'
  return ''
}

function memClass(v: number): string {
  if (v > 10) return 'text-red-500 font-medium'
  if (v > 5) return 'text-yellow-500'
  return ''
}

function statClass(stat: string): string {
  if (stat.includes('Z')) return 'text-red-500'
  if (stat.includes('D')) return 'text-orange-500'
  if (stat.startsWith('R')) return 'text-green-500'
  return 'text-muted-foreground'
}

function buildTree(list: ProcessInfo[]): ProcessNode[] {
  const byPid = new Map<number, ProcessNode>()
  list.forEach((p) => byPid.set(p.pid, { proc: p, children: [], depth: 0 }))
  const roots: ProcessNode[] = []
  byPid.forEach((node) => {
    const parent = byPid.get(node.proc.ppid)
    if (parent && parent.proc.pid !== node.proc.pid) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  })
  const sortNodes = (nodes: ProcessNode[]) => {
    nodes.sort((a, b) => a.proc.pid - b.proc.pid)
    nodes.forEach((n) => sortNodes(n.children))
  }
  sortNodes(roots)
  const assignDepth = (nodes: ProcessNode[], d: number) => {
    nodes.forEach((n) => {
      n.depth = d
      assignDepth(n.children, d + 1)
    })
  }
  assignDepth(roots, 0)
  return roots
}

interface ProcessAssociations {
  serviceUnit: string | null
  dockerId: string | null
}

/**
 * 从 cgroup 路径推导跨模块关联（best-effort）。
 * - systemd 单元：/system.slice/nginx.service → nginx
 * - Docker 容器：/docker/<id>、docker-<id>.scope、cri-containerd-<id>.scope
 */
function parseAssociations(cgroup: string): ProcessAssociations {
  if (!cgroup) return { serviceUnit: null, dockerId: null }
  const service = cgroup.match(/([^/:@\s]+)\.service(?:\/|$)/)
  const docker =
    cgroup.match(/[/:]docker\/([0-9a-fA-F]{12,64})/) ||
    cgroup.match(/docker-([0-9a-fA-F]{12,64})\.scope/) ||
    cgroup.match(/cri-containerd-([0-9a-fA-F]{12,64})\.scope/)
  return {
    serviceUnit: service?.[1] ?? null,
    dockerId: docker?.[1] ?? null,
  }
}

export function ProcessesModule({ serverId, onNavigate }: ProcessesModuleProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('cpu')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [intervalMs, setIntervalMs] = useState(3000)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [detail, setDetail] = useState<ProcessInfo | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState>({ open: false, signal: null, proc: null })
  const [procPorts, setProcPorts] = useState<PortInfo[]>([])
  const [portsLoading, setPortsLoading] = useState(false)
  const [prevDetailPid, setPrevDetailPid] = useState<number | null>(null)

  const currentDetailPid = detail?.pid ?? null
  if (currentDetailPid !== prevDetailPid) {
    setPrevDetailPid(currentDetailPid)
    setProcPorts([])
    setPortsLoading(currentDetailPid !== null)
  }

  useEffect(() => {
    if (!detail) return
    let active = true
    sshService
      .listPorts(serverId)
      .then((ports) => {
        if (active) {
          setProcPorts(ports.filter((p) => p.pid === detail.pid))
        }
      })
      .catch(() => {
        if (active) setProcPorts([])
      })
      .finally(() => {
        if (active) setPortsLoading(false)
      })
    return () => {
      active = false
    }
  }, [serverId, detail])

  const { processes, error, loading } = useProcessSnapshot(serverId, intervalMs, autoRefresh)

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return processes
    return processes.filter(
      (p) =>
        p.pid.toString().includes(q) ||
        p.user.toLowerCase().includes(q) ||
        p.command.toLowerCase().includes(q),
    )
  }, [processes, searchQuery])

  const sorted = useMemo(() => {
    const list = [...filtered]
    const dir = sortDir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      switch (sortField) {
        case 'pid':
        case 'ppid':
          return (a[sortField] - b[sortField]) * dir
        case 'cpu':
          return (a.cpu - b.cpu) * dir
        case 'memory':
          return (a.memory - b.memory) * dir
        case 'vsz':
          return (a.vsz - b.vsz) * dir
        case 'rss':
          return (a.rss - b.rss) * dir
        case 'command':
          return a.command.localeCompare(b.command) * dir
        default:
          return 0
      }
    })
    return list
  }, [filtered, sortField, sortDir])

  const tree = useMemo(() => buildTree(filtered), [filtered])

  const assoc = useMemo(() => parseAssociations(detail?.cgroup ?? ''), [detail])

  const summary = useMemo(() => {
    let running = 0
    let sleeping = 0
    let zombie = 0
    for (const p of processes) {
      if (p.stat.startsWith('R')) running++
      else if (p.stat.includes('S')) sleeping++
      if (p.stat.includes('Z')) zombie++
    }
    return { total: processes.length, running, sleeping, zombie }
  }, [processes])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const openDetail = (proc: ProcessInfo) => setDetail(proc)

  const askSignal = (proc: ProcessInfo, signal: 'term' | 'kill') =>
    setConfirm({ open: true, signal, proc })

  const handleSignal = async () => {
    const proc = confirm.proc
    const signal = confirm.signal
    setConfirm({ open: false, signal: null, proc: null })
    if (!proc || !signal) return
    try {
      const result = await sshService.signalProcess(serverId, proc.pid, signal, proc.startTimeTicks)
      if (result.exitCode !== 0) {
        toast.error(
          `${t('proc_err_kill').replace('{pid}', String(proc.pid))}: ${
            result.stderr || t('common_unknown_error')
          }`,
        )
      } else {
        toast.success(
          signal === 'kill'
            ? t('proc_kill_done').replace('{pid}', String(proc.pid))
            : t('proc_term_done').replace('{pid}', String(proc.pid)),
        )
        setDetail(null)
        refreshProcessSnapshot(serverId)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('proc_err_kill_generic'))
    }
  }

  const renderActions = (proc: ProcessInfo) => (
    <div className="flex gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        title={t('proc_detail')}
        onClick={() => openDetail(proc)}
      >
        <Eye className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        title={t('proc_term')}
        disabled={confirm.proc?.pid === proc.pid}
        onClick={() => askSignal(proc, 'term')}
      >
        <Skull className="h-3 w-3 text-yellow-500" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        title={t('proc_kill_force')}
        disabled={confirm.proc?.pid === proc.pid}
        onClick={() => askSignal(proc, 'kill')}
      >
        <Skull className="h-3 w-3 text-red-500" />
      </Button>
    </div>
  )

  const renderRowCells = (proc: ProcessInfo) => (
    <>
      <td className="px-3 py-1.5 font-mono">{proc.pid}</td>
      <td className="px-3 py-1.5">{proc.user}</td>
      <td className="px-3 py-1.5">
        <span className={cpuClass(proc.cpu)}>{proc.cpu}</span>
      </td>
      <td className="px-3 py-1.5">
        <span className={memClass(proc.memory)}>{proc.memory}</span>
      </td>
      <td className="px-3 py-1.5 text-muted-foreground">{formatSize(proc.vsz)}</td>
      <td className="px-3 py-1.5 text-muted-foreground">{formatSize(proc.rss)}</td>
      <td className={`px-3 py-1.5 font-mono ${statClass(proc.stat)}`}>{proc.stat}</td>
      <td
        className="px-3 py-1.5 truncate max-w-[320px] font-mono cursor-pointer hover:underline"
        title={proc.command}
        onClick={() => openDetail(proc)}
      >
        {proc.command}
      </td>
      <td className="px-3 py-1.5">{renderActions(proc)}</td>
    </>
  )

  const renderTreeRows = (nodes: ProcessNode[]): ReactNode => {
    const allCollapsed = collapsed
    return nodes.map((node) => {
      const hasChildren = node.children.length > 0
      const isCollapsed = allCollapsed.has(node.proc.pid)
      return (
        <Fragment key={node.proc.pid}>
          <tr
            className="border-b hover:bg-accent/30"
            onDoubleClick={() => openDetail(node.proc)}
          >
            <td className="px-3 py-1.5">
              <div className="flex items-center gap-1" style={{ paddingLeft: `${node.depth * 16}px` }}>
                {hasChildren ? (
                  <button
                    className="p-0.5 rounded hover:bg-accent"
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev)
                        if (next.has(node.proc.pid)) next.delete(node.proc.pid)
                        else next.add(node.proc.pid)
                        return next
                      })
                    }
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </button>
                ) : (
                  <span className="w-4" />
                )}
                <span className="font-mono">{node.proc.pid}</span>
              </div>
            </td>
            <td className="px-3 py-1.5">{node.proc.user}</td>
            <td className="px-3 py-1.5">
              <span className={cpuClass(node.proc.cpu)}>{node.proc.cpu}</span>
            </td>
            <td className="px-3 py-1.5">
              <span className={memClass(node.proc.memory)}>{node.proc.memory}</span>
            </td>
            <td className="px-3 py-1.5 text-muted-foreground">{formatSize(node.proc.vsz)}</td>
            <td className="px-3 py-1.5 text-muted-foreground">{formatSize(node.proc.rss)}</td>
            <td className={`px-3 py-1.5 font-mono ${statClass(node.proc.stat)}`}>{node.proc.stat}</td>
            <td
              className="px-3 py-1.5 truncate max-w-[320px] font-mono cursor-pointer hover:underline"
              title={node.proc.command}
              onClick={() => openDetail(node.proc)}
            >
              {node.proc.command}
            </td>
            <td className="px-3 py-1.5">{renderActions(node.proc)}</td>
          </tr>
          {hasChildren && !isCollapsed && renderTreeRows(node.children)}
        </Fragment>
      )
    })
  }

  const confirmProc = confirm.proc
  const confirmTitle =
    confirm.signal === 'kill' ? t('proc_kill_confirm_title') : t('proc_term_confirm_title')
  const confirmDesc =
    confirm.signal === 'kill'
      ? t('proc_kill_confirm_desc').replace('{pid}', String(confirmProc?.pid ?? ''))
      : t('proc_term_confirm_desc').replace('{pid}', String(confirmProc?.pid ?? ''))

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* 统一规范工具栏 */}
      <div className="flex items-center gap-2.5 px-4 h-11 border-b border-border/50 bg-muted/20 shrink-0 flex-wrap">
        <Button
          variant="ghost"
          onClick={() => refreshProcessSnapshot(serverId)}
          disabled={loading}
          size="sm"
          className="gap-1 h-7 text-xs"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('proc_refresh')}
        </Button>

        <div className="h-3.5 w-[1px] bg-border/60" />

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
          <span className="text-[11px]">{t('proc_auto_refresh')}</span>
        </label>

        <select
          value={intervalMs}
          disabled={!autoRefresh}
          onChange={(e) => setIntervalMs(Number(e.target.value))}
          className="h-7 rounded-md border border-border/60 bg-background/80 text-[11px] px-1.5 disabled:opacity-50"
          title={t('proc_refresh_interval')}
        >
          {INTERVAL_OPTIONS.map((ms) => (
            <option key={ms} value={ms}>
              {ms / 1000}s
            </option>
          ))}
        </select>

        <div className="flex items-center rounded-lg border border-border/50 bg-muted/40 p-0.5 text-xs">
          <button
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-all ${
              viewMode === 'list' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setViewMode('list')}
          >
            <List className="h-3 w-3" />
            {t('proc_view_list')}
          </button>
          <button
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-all ${
              viewMode === 'tree' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setViewMode('tree')}
          >
            <GitBranch className="h-3 w-3" />
            {t('proc_view_tree')}
          </button>
        </div>

        <div className="flex-1" />

        <div className="relative w-52">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t('proc_search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-8 text-xs bg-background/80"
          />
        </div>
      </div>

      {/* Summary 统计栏 */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-b border-border/40 bg-muted/15 text-[11px] text-muted-foreground">
        <span>
          {t('proc_summary_total')}: <b className="text-foreground font-mono">{summary.total}</b>
        </span>
        <span className="text-emerald-500">
          {t('proc_summary_running')}: <b className="font-mono">{summary.running}</b>
        </span>
        <span>
          {t('proc_summary_sleeping')}: <b className="text-foreground font-mono">{summary.sleeping}</b>
        </span>
        <span className={summary.zombie > 0 ? "text-rose-500 font-semibold" : "text-muted-foreground"}>
          {t('proc_summary_zombie')}: <b className="font-mono">{summary.zombie}</b>
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 bg-red-500/10 text-red-500 text-xs border-b flex items-center justify-between">
          <span>{error}</span>
          <Button variant="ghost" size="sm" className="h-4 text-[10px]" onClick={() => refreshProcessSnapshot(serverId)}>
            {t('proc_retry')}
          </Button>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto">
        {loading && processes.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm">{t('proc_loading')}</span>
          </div>
        ) : processes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Search className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-sm">{t('proc_empty')}</p>
          </div>
        ) : (
          <div className="p-3">
            <div className="rounded-xl border border-border/70 bg-card shadow-xs overflow-hidden">
              <table className="w-full text-xs">
              <thead className="workspace-table-head">
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium cursor-pointer" onClick={() => toggleSort('pid')}>
                    <span className="flex items-center gap-1">PID <ArrowUpDown className="h-2.5 w-2.5" /></span>
                  </th>
                  <th className="px-3 py-2 font-medium">{t('proc_th_user')}</th>
                  <th className="px-3 py-2 font-medium cursor-pointer" onClick={() => toggleSort('cpu')}>
                    <span className="flex items-center gap-1">CPU% <ArrowUpDown className="h-2.5 w-2.5" /></span>
                  </th>
                  <th className="px-3 py-2 font-medium cursor-pointer" onClick={() => toggleSort('memory')}>
                    <span className="flex items-center gap-1">MEM% <ArrowUpDown className="h-2.5 w-2.5" /></span>
                  </th>
                  <th className="px-3 py-2 font-medium cursor-pointer" onClick={() => toggleSort('vsz')}>
                    <span className="flex items-center gap-1">VSZ <ArrowUpDown className="h-2.5 w-2.5" /></span>
                  </th>
                  <th className="px-3 py-2 font-medium cursor-pointer" onClick={() => toggleSort('rss')}>
                    <span className="flex items-center gap-1">RSS <ArrowUpDown className="h-2.5 w-2.5" /></span>
                  </th>
                  <th className="px-3 py-2 font-medium">STAT</th>
                  <th className="px-3 py-2 font-medium cursor-pointer" onClick={() => toggleSort('command')}>
                    <span className="flex items-center gap-1">{t('proc_th_command')} <ArrowUpDown className="h-2.5 w-2.5" /></span>
                  </th>
                  <th className="px-3 py-2 font-medium">{t('proc_th_action')}</th>
                </tr>
              </thead>
              <tbody>
                {viewMode === 'list'
                  ? sorted.map((proc) => (
                      <tr
                        key={proc.pid}
                        className="border-b hover:bg-accent/30"
                        onDoubleClick={() => openDetail(proc)}
                      >
                        {renderRowCells(proc)}
                      </tr>
                    ))
                  : renderTreeRows(tree)}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>

      {/* Detail drawer */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null) }}>
        <DialogContent className="max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono">{detail.pid}</span>
                  <span className="truncate text-base">{detail.command}</span>
                </DialogTitle>
                <DialogDescription>
                  {t('proc_key_label')}: <span className="font-mono">{detail.pid}:{detail.startTimeTicks}</span>
                </DialogDescription>
              </DialogHeader>

              <Tabs defaultValue="overview" className="w-full">
                <TabsList>
                  <TabsTrigger value="overview">{t('proc_detail_overview')}</TabsTrigger>
                  <TabsTrigger value="tree">{t('proc_detail_tree')}</TabsTrigger>
                  <TabsTrigger value="assoc">{t('proc_assoc')}</TabsTrigger>
                  <TabsTrigger value="command">{t('proc_detail_command')}</TabsTrigger>
                </TabsList>

                <TabsContent value="overview">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs py-2">
                    <Field label={t('proc_th_user')} value={detail.user} />
                    <Field label="PID" value={String(detail.pid)} />
                    <Field label={t('proc_th_ppid')} value={String(detail.ppid)} />
                    <Field label={t('proc_th_nice')} value={String(detail.nice)} />
                    <Field label="CPU%" value={String(detail.cpu)} />
                    <Field label="MEM%" value={String(detail.memory)} />
                    <Field label="VSZ" value={formatSize(detail.vsz)} />
                    <Field label="RSS" value={formatSize(detail.rss)} />
                    <Field label="STAT" value={detail.stat} />
                    <Field label={t('proc_runtime')} value={formatRuntime(detail.startTimeTicks)} />
                  </div>
                </TabsContent>

                <TabsContent value="tree">
                  <div className="text-xs py-2 space-y-3">
                    <div>
                      <div className="text-muted-foreground mb-1">{t('proc_parent')}</div>
                      {processes.find((p) => p.pid === detail.ppid) ? (
                        <button
                          className="text-left font-mono hover:underline"
                          onClick={() => {
                            const parent = processes.find((p) => p.pid === detail.ppid)
                            if (parent) setDetail(parent)
                          }}
                        >
                          {detail.ppid} · {processes.find((p) => p.pid === detail.ppid)?.command}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">{t('proc_no_parent')}</span>
                      )}
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1">{t('proc_children')}</div>
                      {processes.filter((p) => p.ppid === detail.pid).length === 0 ? (
                        <span className="text-muted-foreground">{t('proc_no_children')}</span>
                      ) : (
                        <ul className="space-y-1">
                          {processes
                            .filter((p) => p.ppid === detail.pid)
                            .map((c) => (
                              <li key={c.pid}>
                                <button
                                  className="text-left font-mono hover:underline"
                                  onClick={() => setDetail(c)}
                                >
                                  {c.pid} · {c.command}
                                </button>
                              </li>
                            ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="assoc">
                  <div className="text-xs py-2 space-y-3">
                    <div>
                      <div className="text-muted-foreground mb-1">{t('proc_assoc_service')}</div>
                      {assoc.serviceUnit ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{assoc.serviceUnit}</span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() => onNavigate?.('services', { searchQuery: assoc.serviceUnit! })}
                          >
                            {t('proc_goto_services')}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{t('proc_no_assoc')}</span>
                      )}
                    </div>

                    <div>
                      <div className="text-muted-foreground mb-1">{t('proc_assoc_docker')}</div>
                      {assoc.dockerId ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono">{assoc.dockerId.slice(0, 12)}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            title={t('proc_copy_docker_id')}
                            onClick={() => {
                              navigator.clipboard.writeText(assoc.dockerId!)
                              toast.success(t('proc_copied'))
                            }}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() =>
                              onNavigate?.('docker', {
                                view: 'containers',
                                searchQuery: assoc.dockerId!.slice(0, 12),
                              })
                            }
                          >
                            {t('proc_goto_docker')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-xs gap-1"
                            onClick={() => {
                              const baseServerId = extractBaseServerId(serverId)
                              const serverName =
                                useAppStore.getState().servers.find((s) => s.id === baseServerId)?.name || baseServerId
                              useAppStore
                                .getState()
                                .openTab(
                                  baseServerId,
                                  serverName,
                                  'terminal',
                                  `docker exec -it ${assoc.dockerId} /bin/sh`,
                                )
                            }}
                          >
                            <Terminal className="h-3 w-3" />
                            {t('proc_exec_docker')}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{t('proc_no_assoc')}</span>
                      )}
                    </div>

                    <div>
                      <div className="text-muted-foreground mb-1">{t('proc_assoc_ports')}</div>
                      {portsLoading ? (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span className="text-xs">{t('prts_loading')}</span>
                        </div>
                      ) : procPorts.length > 0 ? (
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap gap-1.5">
                            {procPorts.map((p, idx) => (
                              <span
                                key={`${p.protocol}-${p.port}-${idx}`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted font-mono text-[11px]"
                              >
                                <span className="text-primary font-semibold">{p.port}</span>
                                <span className="text-muted-foreground">/{p.protocol.toUpperCase()}</span>
                                <span className="text-muted-foreground text-[10px]">({p.localAddress})</span>
                                {p.state && <span className="text-green-500 text-[10px]">{p.state}</span>}
                              </span>
                            ))}
                          </div>
                          <div>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs"
                              onClick={() => onNavigate?.('ports', { searchQuery: String(detail.pid) })}
                            >
                              {t('proc_goto_ports')}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">{t('proc_no_assoc')}</span>
                      )}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="command">
                  <pre className="text-[11px] font-mono bg-[var(--color-code-bg)] text-green-400 p-2 rounded overflow-auto max-h-60 whitespace-pre-wrap break-words">
                    {detail.command}
                  </pre>
                </TabsContent>
              </Tabs>

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(String(detail.pid))
                    toast.success(t('proc_copied'))
                  }}
                >
                  <Copy className="h-3 w-3 mr-1" />
                  {t('proc_copy_pid')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-yellow-500"
                  onClick={() => askSignal(detail, 'term')}
                >
                  <Skull className="h-3 w-3 mr-1" />
                  {t('proc_term')}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => askSignal(detail, 'kill')}
                >
                  <Skull className="h-3 w-3 mr-1" />
                  {t('proc_kill_force')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirm signal */}
      <ConfirmDialog
        open={confirm.open}
        title={confirmTitle}
        description={confirmDesc}
        confirmLabel={confirm.signal === 'kill' ? t('proc_kill_force') : t('proc_term')}
        cancelLabel={t('proc_close')}
        variant={confirm.signal === 'kill' ? 'destructive' : 'default'}
        onConfirm={handleSignal}
        onCancel={() => setConfirm({ open: false, signal: null, proc: null })}
      />
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono truncate">{value}</span>
    </div>
  )
}
