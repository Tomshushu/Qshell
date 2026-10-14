import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button } from '@/components/ui/button'
import { CodeEditor } from '@/components/ui/code-editor'
import { Input } from '@/components/ui/input'
import {
  RefreshCw, Play, Square, RotateCcw, FileText, BarChart3, Terminal,
  Search, Info, Container, MoreVertical, List, LayoutGrid, X,
  Cpu, MemoryStick, Network, HardDrive, Copy, Check,
  Trash2, Package, Layers, Pencil, Loader2, Save, Download, Pause, ExternalLink, Plus, Cable, Unplug,
  Upload, Folder, File as FileIcon, ChevronLeft, Hammer, GitCompare, ChevronDown, ChevronRight, FolderInput, Sparkles,
} from 'lucide-react'
import { TerminalModule } from '@/components/workspace/modules/terminal'
import { RemoteFilePicker } from '@/components/workspace/modules/remote-file-picker'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts'
import { sshService } from '@/services/ssh-service'
import { save as saveDialog, open as openDialog } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from '@/store'
import { extractBaseServerId } from '@/services/ssh-connection-state'
import { useTranslation } from '@/i18n'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { DockerContainer as DockerContainerType } from '@/types'
import type {
  DockerImage,
  DockerNetwork,
  DockerVolume,
  DockerOverview,
  SystemDfRow,
  DockerFileEntry,
} from '@/services/api'

import {
  MAX_LOG_SIZE,
  LOG_POLL_FAIL_THRESHOLD,
  type DockerModuleProps,
  type ViewType,
  type StatsData,
  type CgroupResult,
  type ContainerStatRow,
  type ComposeProject,
  type ComposeService,
  type ComposeImportPreview,
  type MenuItem,
  type PillTone,
  parseSizeToMiB,
  parseSizeToKB,
  extractStats,
  parseStats,
  buildCgroupCmd,
  parseCgroup,
  parseProcNetDev,
  stripAnsi,
  ANSI_FG_COLORS,
  renderAnsiLine,
  formatSize,
  parseHostPorts,
  isComposeUnhealthy,
  devLog,
  devWarn,
  defaultContainerName,
  dockerErrorHint,
  parseStatsAll,
  isSensitiveEnvKey,
  OverviewCard,
  PILL_TONES,
  StatusPill,
  EmptyState,
  ListSkeleton,
  CardsSkeleton,
  InspectSection,
  InspectKV,
  ENV_MASK,
  utf8ToBase64,
  StructuredInspect,
  deriveComposeDir,
  expandComposeProjects,
  shellQuote,
  lineDiff,
  parseComposeServices,
  parseComposeFileStatus,
  yamlScalar,
  dockerRunToCompose,
  DockerComposeImportDialog,
  DockerComposeConvertDialog,
  DockerDeployModal,
  DockerComposeEditModal,
  DockerSystemDfModal,
  DockerContainerDetailModal,
} from "@/components/docker";

export function DockerModule({ serverId, initialView, initialSearchQuery }: DockerModuleProps) {
  const baseServerId = extractBaseServerId(serverId)
  const serverName = useAppStore((s) => s.servers.find((x) => x.id === baseServerId)?.name || serverId)
  // 服务器主机地址：端口"浏览器打开"用
  const serverHost = useAppStore((s) => s.servers.find((x) => x.id === baseServerId)?.host || 'localhost')
  // 连接就绪标记：必须在所有使用它的 effect 之前声明（TDZ）
  const isConnected = useAppStore((s) => !!(s.connectedServers[serverId] ?? s.connectedServers[baseServerId]))
  const { t } = useTranslation()
  const { toast } = useToast()

  // 基础状态
  const [containers, setContainers] = useState<DockerContainerType[]>([])
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // 菜单状态
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; container: DockerContainerType } | null>(null)
  const [dropdownId, setDropdownId] = useState<string | null>(null)
  const dropdownPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // 模态框状态
  // 容器详情：日志/监控/详情/文件 共用一个模态框，按 type 切 Tab
  const [modal, setModal] = useState<{ type: 'logs' | 'inspect' | 'stats' | 'files'; container: DockerContainerType } | null>(null)
  const [logsData, setLogsData] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [inspectData, setInspectData] = useState('')
  const [inspectCopied, setInspectCopied] = useState(false)
  const [statsHistory, setStatsHistory] = useState<Array<StatsData & { time: string }>>([])
  const [statsCurrent, setStatsCurrent] = useState<StatsData | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  // 日志轮询连续失败时标记，用于切换实时指示灯颜色与停止轮询提示
  const [logsPollingFailed, setLogsPollingFailed] = useState(false)
  // 危险操作（stop/restart）确认对话框待执行动作
  const [pendingAction, setPendingAction] = useState<{ container: DockerContainerType; action: 'stop' | 'restart' } | null>(null)
  // 修改容器配置确认（保存会删旧容器同名重建，运行中会中断服务）
  const [pendingConfigEdit, setPendingConfigEdit] = useState<DockerContainerType | null>(null)

  // 视图切换：Overview（默认首页）/容器/镜像/网络/卷/Compose
  const [view, setView] = useState<'overview' | 'containers' | 'images' | 'networks' | 'volumes' | 'compose'>(initialView || 'overview')
  const [prevInitialView, setPrevInitialView] = useState(initialView)
  if (initialView !== prevInitialView) {
    setPrevInitialView(initialView)
    if (initialView) {
      setView(initialView)
    }
  }

  const [prevInitialSearchQuery, setPrevInitialSearchQuery] = useState(initialSearchQuery)
  if (initialSearchQuery !== prevInitialSearchQuery) {
    setPrevInitialSearchQuery(initialSearchQuery)
    if (initialSearchQuery !== undefined) {
      setSearchQuery(initialSearchQuery)
    }
  }
  // 镜像列表
  const [images, setImages] = useState<DockerImage[]>([])
  const [imagesLoading, setImagesLoading] = useState(false)
  // Compose 项目列表
  const [composeProjects, setComposeProjects] = useState<ComposeProject[]>([])
  const [composeLoading, setComposeLoading] = useState(false)
  // 删除容器确认（force=true 时使用 docker rm -f）
  const [pendingDeleteContainer, setPendingDeleteContainer] = useState<{ container: DockerContainerType; force: boolean } | null>(null)
  // 删除镜像确认
  const [pendingDeleteImage, setPendingDeleteImage] = useState<DockerImage | null>(null)
  // === 批量操作：多选容器（表格视图）===
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // 批量删除确认（rm -f 会强删运行中的容器，必须确认）
  const [pendingBatchDelete, setPendingBatchDelete] = useState(false)
  // compose down 确认：down 会停止并删除项目全部容器，危险度高于单容器 stop
  const [pendingComposeDown, setPendingComposeDown] = useState<ComposeProject | null>(null)
  // 网络/卷列表（P2 扩展）
  const [networks, setNetworks] = useState<DockerNetwork[]>([])
  const [networksLoading, setNetworksLoading] = useState(false)
  const [volumes, setVolumes] = useState<DockerVolume[]>([])
  const [volumesLoading, setVolumesLoading] = useState(false)
  // 删除网络/卷确认
  const [pendingDeleteNetwork, setPendingDeleteNetwork] = useState<DockerNetwork | null>(null)
  // 删除网络时携带的"被 N 个容器使用"信息，用于二次确认对话框描述文案
  const [pendingDeleteNetworkUsedBy, setPendingDeleteNetworkUsedBy] = useState(0)
  const [pendingDeleteVolume, setPendingDeleteVolume] = useState<DockerVolume | null>(null)
  // 清理未使用网络/卷确认（prune 删除全部未使用资源，危险）
  const [pendingPruneNetworks, setPendingPruneNetworks] = useState(false)
  const [pendingPruneVolumes, setPendingPruneVolumes] = useState(false)
  // 镜像拉取对话框
  const [pullDialog, setPullDialog] = useState<{ image: string; pulling: boolean } | null>(null)
  // Overview 总览（docker info + 全容器 stats 一次性采样）
  const [overview, setOverview] = useState<DockerOverview | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [containerStats, setContainerStats] = useState<ContainerStatRow[]>([])
  // docker stats --no-stream 首次采样需 1-2s+（容器多时更久）：期间 Top 5 显示占位
  const [statsLoading, setStatsLoading] = useState(true)
  const statsLoadedRef = useRef(false)
  // 日志实时刷新暂停（暂停期间跳过增量轮询，便于复制与排查）
  const [logsPaused, setLogsPaused] = useState(false)
  const logsPausedRef = useRef(false)
  // Inspect 结构化/Raw 切换
  const [inspectTab, setInspectTab] = useState<'structured' | 'raw'>('structured')
  // 运行新容器对话框（MVP basic）；editId 非空时为「从现有容器编辑」模式
  const [runDialog, setRunDialog] = useState<{
    name: string; image: string; ports: string; volumes: string
    env: string; restart: string; network: string; running: boolean
    editId?: string | null
  } | null>(null)
  // 镜像详情模态框
  const [imageInspectModal, setImageInspectModal] = useState<{ id: string; data: string } | null>(null)
  // Compose 新建项目对话框
  const [createDialog, setCreateDialog] = useState<{
    name: string; dir: string; dirTouched: boolean; yaml: string; creating: boolean
  } | null>(null)
  // 导入已有项目对话框：输入目录 → 扫描预览 → 勾选批量 up 注册
  const [importDialog, setImportDialog] = useState<{
    dirsText: string; scanning: boolean
    previews: ComposeImportPreview[]; selected: Set<string>; importing: boolean
  } | null>(null)
  // docker run → compose 转换对话框：输入 run 命令实时预览 YAML，确认后按新项目落盘
  const [convertDialog, setConvertDialog] = useState<{
    runCmd: string; name: string; dir: string; dirTouched: boolean; creating: boolean
  } | null>(null)
  // Compose 配置校验中（编辑弹框内）
  const [composeValidating, setComposeValidating] = useState(false)
  // Compose 实时部署输出面板（up/down/restart/pull 过程实时可见）
  const [deployModal, setDeployModal] = useState<{
    requestId: string; action: string; projectName: string
    text: string; running: boolean; exitCode: number | null; error: string | null
    // startedAt/lastChunkAt：用于「无输出心跳提示」与前端看门狗
    // （pull 大镜像可能静默数分钟，需明确告知仍在运行而非卡死）
    startedAt: number; lastChunkAt: number
  } | null>(null)
  const deployUnsubRef = useRef<(() => void) | null>(null)
  // 追踪当前激活的部署请求 id：订阅 Promise resolve 前若面板已被关闭/被新部署取代，
  // 可在 .then 中判断并立即退订，避免孤儿回调残留在全局 Set（RISK-1）
  const deployRequestIdRef = useRef<string | null>(null)
  const deployScrollRef = useRef<HTMLDivElement>(null)
  // 部署面板秒级心跳：驱动「已运行 / 无输出」计时显示（每 1s 触发一次重渲染）
  const [deployTick, setDeployTick] = useState(0)
  // Registry 登录对话框
  const [loginDialog, setLoginDialog] = useState<{
    registry: string; username: string; password: string; running: boolean
    loggedRegistries: { registry: string; tokenBased: boolean }[] | null
  } | null>(null)
  // System DF 磁盘占用
  const [dfModal, setDfModal] = useState<{ rows: SystemDfRow[]; loading: boolean } | null>(null)
  const [pendingPruneSystem, setPendingPruneSystem] = useState<{ includeImages: boolean } | null>(null)
  // 清理悬空镜像确认
  const [pendingPruneImages, setPendingPruneImages] = useState(false)
  // 网络详情 / 创建
  const [networkInspectModal, setNetworkInspectModal] = useState<{
    id: string; name: string; driver: string; scope: string; subnet: string; gateway: string
    containers: { name: string; ipv4: string }[]
    connectOpen: boolean; containerOptions: { id: string; name: string }[]; connecting: boolean
  } | null>(null)
  const [createNetworkDialog, setCreateNetworkDialog] = useState<{ name: string; driver: string; subnet: string; gateway: string } | null>(null)
  // 卷内容浏览
  const [volumeBrowseModal, setVolumeBrowseModal] = useState<{
    name: string; subPath: string; entries: { name: string; isDir: boolean; size: string; mtime: string }[]; error: string
  } | null>(null)
  // 镜像导出 / 导入
  const [saveLoadDialog, setSaveLoadDialog] = useState<{ mode: 'save' | 'load'; selected: string[]; remotePath: string; result: string; loading: boolean; progress: { transferred: number; total: number } | null; localFile: { name: string; path: string } | null; imageRef?: string } | null>(null)
  // Compose 日志模态框
  const [composeLogsModal, setComposeLogsModal] = useState<{ name: string; data: string } | null>(null)
  // Service 级视图：哪些项目已展开；展开时调 docker_compose_services 拉取 services 列表。
  // 按 configFile 索引（同一项目可能因多文件被拆成多条），避免重名冲突
  const [expandedCompose, setExpandedCompose] = useState<Set<string>>(new Set())
  const [composeServicesCache, setComposeServicesCache] = useState<Record<string, {
    services: ComposeService[]; loading: boolean; error: string | null
  }>>({})
  // service 级日志模态框（复用现有 logs modal，但带 service 名标识）
  const [composeServiceLogsModal, setComposeServiceLogsModal] = useState<
    { project: string; service: string; data: string } | null
  >(null)
  // Compose 卡片「更多」菜单：低频操作（Start/Stop/Build/Pull）收进此处，主栏只留高频动作
  const [composeMenu, setComposeMenu] = useState<{
    x: number; y: number; project: ComposeProject
  } | null>(null)
  // Compose 文件编辑弹窗：path=远程文件路径，content=编辑区内容，original=原始内容（检测是否改动），
  // loading=读取/保存中，error=读取失败信息（非空时只读展示错误）
  const [composeEditModal, setComposeEditModal] = useState<{
    path: string
    content: string
    original: string
    loading: boolean
    saving: boolean
    error: string | null
    view: 'edit' | 'diff'
  } | null>(null)

  // 日志流式跟随 refs（logs -f，替代旧 3 秒轮询）
  const logsUnsubRef = useRef<(() => void) | null>(null)
  // 流接收缓冲：chunk 可能在行中间截断，攒够完整行再追加
  const logsLineBufRef = useRef('')
  // 日志事件可能以几十 KB 的频率到达；逐 chunk setState 会反复复制 2MB 字符串并触发
  // split/虚拟列表重算。先合并到下一帧，保证 UI 更新最多 60 次/秒。
  const logsPendingDisplayRef = useRef('')
  const logsDisplayFrameRef = useRef<number | null>(null)
  // 最后收到日志行的 RFC3339 时间戳（docker logs --timestamps），用于断线续流去重
  const logsLastTsRef = useRef('')
  const statsPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const logsScrollRef = useRef<HTMLDivElement>(null)
  const statsFetchingRef = useRef(false)
  // 日志跟随连续失败计数（断线重连失败达阈值时停止并提示）
  const logFailCountRef = useRef(0)
  // cgroup 上次 CPU 采样（用于计算 CPU%）
  const cgroupPrevRef = useRef<{ usage: number; time: number } | null>(null)
  // cgroup 是否已验证可用：成功一次即保持 true（宿主机能力已被证实）。
  // 失败不置 false —— 探测失败可能只是当前容器已停止（读不到 /proc/<pid>/cgroup），
  // 不应据此认定宿主机不支持而永久放弃快速路径
  const cgroupAvailableRef = useRef<boolean | null>(null)
  // 模态框请求序号：打开新模态框/关闭时自增，旧模态框的在途响应因序号不匹配被丢弃，
  // 防止快速切换容器时旧容器的日志/监控数据覆盖新容器（陈旧响应竞态）
  const logsModalSeqRef = useRef(0)
  const statsModalSeqRef = useRef(0)
  // 日志吸底跟随：仅当用户停留在底部附近时自动滚动，向上翻阅历史时不打扰
  const logsStickBottomRef = useRef(true)
  const composeLogsStickBottomRef = useRef(true)
  // inspect 复制按钮"已复制"状态的定时器，避免多次点击叠加
  const inspectCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // stats 刷新函数引用，供错误重试按钮调用
  const statsRefreshRef = useRef<(() => Promise<void>) | null>(null)
  // Compose 日志模态框滚动容器：数据更新时自动滚到底部，显示最新日志
  const composeLogsScrollRef = useRef<HTMLDivElement>(null)

  // 新增：日志及详情的高级过滤/状态
  const [logSearchQuery, setLogSearchQuery] = useState('')
  const [logFilterError, setLogFilterError] = useState(false)
  const [logWrapLines, setLogWrapLines] = useState(true)

  const [inspectSearchQuery, setInspectSearchQuery] = useState('')
  const [inspectFilterLines, setInspectFilterLines] = useState(false)

  // Exec 内嵌终端：{ 容器, 自动探测到的 shell }（/bin/sh 优先，缺失则 /bin/bash）
  const [execTerminal, setExecTerminal] = useState<{ container: DockerContainerType; shell: string } | null>(null)

  // 增量日志过滤：logsData 保留 ANSI 序列（渲染层着色），过滤匹配按剥离后的文本比较
  const filteredLogs = useMemo(() => {
    if (!logsData) return ''
    if (!logSearchQuery && !logFilterError) return logsData
    const lines = logsData.split('\n')
    const q = logSearchQuery.toLowerCase()
    const filtered = lines.filter(line => {
      const plain = stripAnsi(line)
      const matchSearch = !logSearchQuery || plain.toLowerCase().includes(q)
      const matchError = !logFilterError || /error|warn|fail|exception|stderr/i.test(plain)
      return matchSearch && matchError
    })
    return filtered.join('\n')
  }, [logsData, logSearchQuery, logFilterError])

  // 日志按行拆分，供虚拟化渲染使用
  const logLines = useMemo(() => filteredLogs.split('\n'), [filteredLogs])
  // 日志虚拟化：固定行高 18px，避免大量日志一次性塞入单个 DOM 节点
  const logVirtualizer = useVirtualizer({
    count: logLines.length,
    getScrollElement: () => logsScrollRef.current,
    estimateSize: () => 18,
    overscan: 20,
  })

  // 配置项过滤
  const filteredInspect = useMemo(() => {
    if (!inspectSearchQuery) return inspectData
    if (!inspectFilterLines) return inspectData
    const lines = inspectData.split('\n')
    return lines
      .map((line, idx) => {
        if (line.toLowerCase().includes(inspectSearchQuery.toLowerCase())) {
          return `L${idx + 1}: ${line}`
        }
        return null
      })
      .filter(Boolean)
      .join('\n') || t('dk_no_match')
  }, [inspectData, inspectSearchQuery, inspectFilterLines, t])

  // === 数据加载 ===
  // silent=true 用于后台自动轮询：不进 loading 态（避免骨架屏闪烁）、失败不弹错误横幅
  const fetchContainers = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    try {
      const data = await sshService.dockerPs(serverId)
      setContainers(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      devWarn('[fetchContainers] 加载失败:', msg)
      if (!silent) setError(dockerErrorHint(msg, t))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [serverId, t])

  // 加载镜像列表
  const fetchImages = useCallback(async () => {
    setImagesLoading(true)
    setError(null)
    try {
      const data = await sshService.dockerImages(serverId)
      setImages(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      devWarn('[fetchImages] 加载失败:', msg)
      setError(dockerErrorHint(msg, t))
    } finally {
      setImagesLoading(false)
    }
  }, [serverId, t])

  // 加载网络列表
  const fetchNetworks = useCallback(async () => {
    setNetworksLoading(true)
    setError(null)
    try {
      const data = await sshService.dockerNetworkLs(serverId)
      setNetworks(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(dockerErrorHint(msg, t))
    } finally {
      setNetworksLoading(false)
    }
  }, [serverId, t])

  // 加载卷列表
  const fetchVolumes = useCallback(async () => {
    setVolumesLoading(true)
    setError(null)
    try {
      const data = await sshService.dockerVolumeLs(serverId)
      setVolumes(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(dockerErrorHint(msg, t))
    } finally {
      setVolumesLoading(false)
    }
  }, [serverId, t])

  // === Overview ===
  const fetchOverview = useCallback(async () => {
    setOverviewLoading(true)
    setError(null)
    try {
      const data = await sshService.dockerInfo(serverId)
      setOverview(data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(dockerErrorHint(msg, t))
    } finally {
      setOverviewLoading(false)
    }
  }, [serverId, t])

  // 全容器资源一次性采样（docker stats --no-stream，单次 SSH 往返 ~1-2s，容器多时更久）
  // 仅辅助 Overview 展示，失败静默：不干扰列表数据。
  // 首次成功前保持 loading 占位（由 10s 轮询自动重试），之后静默刷新不闪 loading
  const fetchContainerStats = useCallback(async () => {
    try {
      const result = await sshService.execute(serverId, "docker stats --no-stream --format '{{json .}}'")
      if (result.stdout && result.stdout.trim()) {
        setContainerStats(parseStatsAll(result.stdout))
        if (!statsLoadedRef.current) {
          statsLoadedRef.current = true
          setStatsLoading(false)
        }
      }
    } catch {
      // 静默
    }
  }, [serverId])

  // Overview 页轮询：资源采样 10s 一次（版本/计数信息不轮询，进入页面时加载一次）
  useEffect(() => {
    if (view !== 'overview' || !isConnected) return
    fetchOverview()
    fetchContainerStats()
    fetchContainers({ silent: true })
    const timer = setInterval(fetchContainerStats, 10_000)
    return () => clearInterval(timer)
  }, [view, isConnected, fetchOverview, fetchContainerStats, fetchContainers])

  // 加载 Compose 项目列表
  const fetchComposeProjects = useCallback(async () => {
    setComposeLoading(true)
    setError(null)
    const tag = '[fetchComposeProjects]'
    devLog(tag, '开始加载 Compose 项目, serverId=', serverId)
    try {
      // 注册表 ∪ 实时合并列表：返回 JSON 字符串（ComposeProjectEntry 数组）。
      // down 之后容器被删、实时 `docker compose ls` 不再返回该项目，但注册表中
      // 已登记的项目仍以 exists=false / status='' 返回，前端据此显示"已停止"
      // 并保留启动入口（Dockge/Portainer 同款"项目与运行状态解耦"模型）。
      const raw = await sshService.dockerComposeList(serverId)
      devLog(tag, 'dockerComposeList 返回长度=', raw?.length ?? 0)
      devLog(tag, '前 500 字符:', (raw || '').slice(0, 500))
      let entries: ComposeProject[] = []
      if (raw && raw.trim()) {
        try {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            entries = parsed.map((e: { name?: string; status?: string; configFile?: string; exists?: boolean }) => ({
              name: e.name ?? '',
              status: e.status ?? '',
              configFile: e.configFile ?? '',
              exists: e.exists ?? true,
            }))
          }
        } catch (parseErr) {
          devWarn(tag, 'JSON 解析失败:', parseErr)
        }
      }
      devLog(tag, '解析出项目数量=', entries.length)
      if (entries.length > 0) {
        // 多文件 compose 项目拆分为单文件项，独立 up/down/logs
        const expanded = expandComposeProjects(entries)
        devLog(tag, '拆分后单文件项数量=', expanded.length)
        setComposeProjects(expanded)

        // 对 status 为空且 configFile 非空的项并发查询单文件真实状态：
        // 多文件拆分项原 status 是合并项目容器总数（不准确）；
        // 注册表里的已停止项（status=''）也需确认真实状态。
        const needQuery = expanded.filter(p => !p.status && p.configFile)
        if (needQuery.length > 0) {
          devLog(tag, '需查询单文件状态项数=', needQuery.length)
          await Promise.all(needQuery.map(async (p) => {
            try {
              const psResult = await sshService.execute(
                serverId,
                `docker compose -f ${shellQuote(p.configFile)} ps --format json 2>/dev/null`,
              )
              const status = parseComposeFileStatus(psResult.stdout || '')
              devLog(tag, '单文件状态查询完成:', p.configFile, '→', status)
              setComposeProjects(prev =>
                prev.map(item =>
                  item.configFile === p.configFile ? { ...item, status } : item,
                ),
              )
            } catch (err) {
              devWarn(tag, '单文件状态查询失败:', p.configFile, err)
            }
          }))
        }
      } else {
        // 列表为空：可能确实没有项目，也可能返回解析异常（解析失败时 entries 为空，
        // 上面的 devWarn 已记录）。不下错误提示，避免掩盖"无项目"的正常空态。
        devLog(tag, '解析出 0 个项目')
        setComposeProjects([])
      }
    } catch (err) {
      devWarn(tag, '加载异常:', err)
      devWarn(tag, '错误堆栈:', err instanceof Error ? err.stack : '无堆栈')
      const msg = err instanceof Error ? err.message : String(err)
      setError(dockerErrorHint(msg, t))
    } finally {
      setComposeLoading(false)
    }
  }, [serverId, t])

  /** 展开/折叠项目卡片：展开时按需拉 services 列表（已缓存则跳过） */
  const toggleComposeExpanded = useCallback(async (project: ComposeProject) => {
    const key = project.configFile || project.name
    setExpandedCompose(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setComposeServicesCache(prev => {
      if (prev[key]) return prev // 已缓存
      return { ...prev, [key]: { services: [], loading: true, error: null } }
    })
    try {
      const dir = deriveComposeDir(project.configFile)
      const result = await sshService.dockerComposeServices(
        serverId, dir, project.configFile || undefined,
      )
      const services = parseComposeServices(result.stdout || '[]')
      setComposeServicesCache(prev => ({
        ...prev,
        [key]: { services, loading: false, error: null },
      }))
    } catch (err) {
      setComposeServicesCache(prev => ({
        ...prev,
        [key]: {
          services: prev[key]?.services || [],
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        },
      }))
    }
  }, [serverId])

  /** 取 service 级日志：复用 dockerComposeLogs 加 service 参数 */
  const handleServiceLogs = useCallback(async (project: ComposeProject, service: string) => {
    setComposeServiceLogsModal({
      project: project.name, service, data: t('dk_loading'),
    })
    try {
      const dir = deriveComposeDir(project.configFile)
      const result = await sshService.dockerComposeLogs(
        serverId, project.name, 200, dir, project.configFile || undefined, service,
      )
      const data = result.exitCode === 0
        ? (stripAnsi(result.stdout) || t('dk_no_logs'))
        : (stripAnsi(result.stdout || result.stderr || t('dk_err_logs')))
      setComposeServiceLogsModal({
        project: project.name, service, data,
      })
    } catch (err) {
      setComposeServiceLogsModal({
        project: project.name, service, data: err instanceof Error ? err.message : t('dk_err_logs'),
      })
    }
  }, [serverId, t])

  // 连接就绪前不发任何 docker 命令：模块可能在连接状态机到达 Ready 前挂载，
  // 提前请求会产生"Channel open failure / not connected"瞬态错误横幅
  useEffect(() => {
    if (!isConnected) return
    fetchContainers()
    // 容器状态自动轮询（10s，静默）：容器可能因 restart 策略自愈或被其他客户端
    // 操作，靠用户手动刷新感知太迟钝。静默模式不触发骨架屏、失败不打扰用户。
    const timer = setInterval(() => fetchContainers({ silent: true }), 10_000)
    return () => clearInterval(timer)
  }, [isConnected, fetchContainers])

  // Docker 版本信息：连接就绪后加载一次（上下文条在所有视图常显版本，§11.4）。
  // 静默失败：版本条缺失不代表模块不可用，Overview 页有完整错误展示
  useEffect(() => {
    if (!isConnected) return
    sshService.dockerInfo(serverId)
      .then((info) => setOverview(info))
      .catch(() => {
        /* 静默：Overview 页会展示完整错误 */
      })
  }, [isConnected, serverId])

  // 切换视图时加载对应数据（同样等连接就绪）
  useEffect(() => {
    if (!isConnected) return
    if (view === 'images') fetchImages()
    else if (view === 'networks') fetchNetworks()
    else if (view === 'volumes') fetchVolumes()
    else if (view === 'compose') fetchComposeProjects()
  }, [isConnected, view, fetchImages, fetchNetworks, fetchVolumes, fetchComposeProjects])

  // 刷新按钮：根据当前视图派发
  const handleRefresh = useCallback(() => {
    if (view === 'containers') fetchContainers()
    else if (view === 'images') fetchImages()
    else if (view === 'networks') fetchNetworks()
    else if (view === 'volumes') fetchVolumes()
    else fetchComposeProjects()
  }, [view, fetchContainers, fetchImages, fetchNetworks, fetchVolumes, fetchComposeProjects])

  const currentLoading =
    view === 'containers'
      ? loading
      : view === 'images'
        ? imagesLoading
        : view === 'networks'
          ? networksLoading
          : view === 'volumes'
            ? volumesLoading
            : composeLoading

  // === 容器操作 ===
  const handleAction = useCallback(async (container: DockerContainerType, action: 'start' | 'stop' | 'restart') => {
    setActionLoading(container.id)
    try {
      const result = action === 'start'
        ? await sshService.dockerStart(serverId, container.id)
        : action === 'stop'
        ? await sshService.dockerStop(serverId, container.id)
        : await sshService.dockerRestart(serverId, container.id)
      if (result.exitCode !== 0) {
        setError(result.stderr || result.stdout || t('dk_err_action').replace('{action}', action))
      } else {
        await fetchContainers()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dk_err_action').replace('{action}', action))
    } finally {
      setActionLoading(null)
    }
  }, [serverId, fetchContainers, t])

  // === Exec 内嵌终端：自动探测 shell（/bin/sh → /bin/bash），无需用户选择 ===
  // 两个 shell 都不存在（或容器未运行/无权限）时给出明确提示，不再打开终端
  const openExecTerminal = useCallback(async (container: DockerContainerType) => {
    // 前端正则校验容器 ID，避免命令注入（仅允许十六进制 ID 或安全字符）
    if (!/^[a-f0-9]{12,64}$|^[\w.-]{1,128}$/.test(container.id)) {
      toast.error(t('dk_exec_invalid_id'))
      return
    }
    setActionLoading(`exec-${container.id}`)
    try {
      // 依次探测：先 /bin/sh，缺失则 /bin/bash；都不存在输出 NOSHELL
      const probe = `docker exec ${container.id} /bin/sh -c 'exit 0' 2>/dev/null && echo SHELL_SH || (docker exec ${container.id} /bin/bash -c 'exit 0' 2>/dev/null && echo SHELL_BASH || echo NOSHELL)`
      const res = await sshService.execute(serverId, probe)
      const out = (res.stdout || '').trim()
      // 注意：NOSHELL 包含 "SH" 子串，必须优先判定
      if (out.includes('NOSHELL') || !out) {
        toast.error(t('dk_exec_no_shell'))
        return
      }
      setExecTerminal({ container, shell: out.includes('SHELL_SH') ? '/bin/sh' : '/bin/bash' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dk_exec_no_shell'))
    } finally {
      setActionLoading(null)
    }
  }, [serverId, t, toast])

  // === 删除容器 ===
  const handleDeleteContainer = useCallback(async () => {
    if (!pendingDeleteContainer) return
    const { container, force } = pendingDeleteContainer
    setActionLoading(container.id)
    try {
      const result = await sshService.dockerRm(serverId, container.id, force)
      if (result.exitCode !== 0) {
        toast.error(result.stderr || result.stdout || t('docker_container_delete'))
      } else {
        toast.success(`${t('docker_container_delete')} ✓`)
        await fetchContainers()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docker_container_delete'))
    } finally {
      setActionLoading(null)
      setPendingDeleteContainer(null)
    }
  }, [pendingDeleteContainer, serverId, fetchContainers, t, toast])

  // === 批量操作（多选 start/stop/rm）：顺序执行避免并发压垮 daemon，失败逐个收集 ===
  const runBatch = useCallback(async (action: 'start' | 'stop' | 'remove') => {
    const ids = [...selectedIds]
    if (!ids.length) return
    setActionLoading('batch')
    let ok = 0
    const failed: string[] = []
    try {
      for (const id of ids) {
        try {
          // 批量删除用 -f：运行中的容器直接强删（确认框已二次确认），避免先逐个 stop 拖长流程
          const result = action === 'start'
            ? await sshService.dockerStart(serverId, id)
            : action === 'stop'
              ? await sshService.dockerStop(serverId, id)
              : await sshService.dockerRm(serverId, id, true)
          if (result.exitCode === 0) ok++
          else failed.push(id.slice(0, 12))
        } catch {
          failed.push(id.slice(0, 12))
        }
      }
      if (failed.length) {
        toast.error(`${t('dk_batch_done')} ${ok}/${ids.length} — ${failed.join(', ')}`)
      } else {
        toast.success(`${t('dk_batch_done')} ${ok}/${ids.length} ✓`)
      }
      setSelectedIds(new Set())
      await fetchContainers()
    } finally {
      setActionLoading(null)
      setPendingBatchDelete(false)
    }
  }, [selectedIds, serverId, fetchContainers, t, toast])

  // === 修改容器配置：docker inspect 预填当前配置 → 编辑 → 保存时删旧容器同名重建 ===
  // （docker 不支持原地改端口/卷/环境变量，重建是唯一路径；运行中容器保存期间服务中断）
  const editContainerConfig = useCallback(async (container: DockerContainerType) => {
    try {
      const result = await sshService.dockerInspect(serverId, container.id)
      if (result.exitCode !== 0 || !result.stdout) {
        toast.error(result.stderr || t('dk_edit_config_failed'))
        return
      }
      const parsed = JSON.parse(result.stdout) as Array<Record<string, unknown>>
      const info = parsed?.[0]
      if (!info) {
        toast.error(t('dk_edit_config_failed'))
        return
      }
      const config = (info.Config || {}) as Record<string, unknown>
      const hostConfig = (info.HostConfig || {}) as Record<string, unknown>
      // 端口：PortBindings { "80/tcp": [{HostPort:"8080"}] } → "8080:80"（每行一条）
      const portLines: string[] = []
      for (const [key, bindings] of Object.entries((hostConfig.PortBindings || {}) as Record<string, Array<{ HostPort?: string } | null>>)) {
        const containerPort = key.split('/')[0]
        for (const b of bindings || []) {
          if (b?.HostPort) portLines.push(`${b.HostPort}:${containerPort}`)
        }
      }
      const volumes = ((hostConfig.Binds || []) as unknown[]).map(b => String(b))
      // 剔除镜像内置环境变量，只保留用户显式注入的
      const envExclude = new Set(['PATH', 'HOSTNAME', 'HOME', 'TERM'])
      const envLines = ((config.Env || []) as string[]).filter(e => !envExclude.has(e.split('=')[0]))
      const restartRaw = String(((hostConfig.RestartPolicy || {}) as Record<string, unknown>).Name || 'no')
      const networks = ((info.NetworkSettings || {}) as Record<string, unknown>).Networks as Record<string, unknown> | undefined
      const network = networks ? Object.keys(networks)[0] || '' : ''
      const restart = ['no', 'always', 'unless-stopped'].includes(restartRaw) ? restartRaw : 'unless-stopped'
      setRunDialog({
        name: container.name,
        image: String(config.Image || container.image),
        ports: portLines.join('\n'),
        volumes: volumes.join('\n'),
        env: envLines.join('\n'),
        restart,
        network,
        running: false,
        editId: container.id,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dk_edit_config_failed'))
    }
  }, [serverId, t, toast])

  // === 删除镜像 ===
  const handleDeleteImage = useCallback(async () => {
    if (!pendingDeleteImage) return
    // 设置 loading 供确认框 pending 展示，防止执行期间重复点击
    setActionLoading(`rmi-${pendingDeleteImage.id}`)
    try {
      const result = await sshService.dockerRmi(serverId, pendingDeleteImage.id)
      // docker rmi 成功时 stdout 含 "Deleted:" 或 "Untagged:"
      // （后端用 2>&1 合并，这些信息可能在 stdout 或 stderr）
      const output = `${result.stdout || ''}\n${result.stderr || ''}`
      const hasDeleteSignal = /Deleted:|Untagged:/i.test(output)
      if (result.exitCode !== 0 && !hasDeleteSignal) {
        toast.error(result.stderr || result.stdout || t('docker_image_delete'))
      } else {
        toast.success(`${t('docker_image_delete')} ✓`)
        await fetchImages()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docker_image_delete'))
    } finally {
      setActionLoading(null)
      setPendingDeleteImage(null)
    }
  }, [pendingDeleteImage, serverId, fetchImages, t, toast])

  // === 清理悬空镜像 ===
  const handlePruneImages = useCallback(async () => {
    try {
      const result = await sshService.dockerImagePrune(serverId)
      if (result.exitCode !== 0) {
        toast.error(result.stderr || result.stdout || t('docker_image_prune'))
      } else {
        toast.success(`${t('docker_image_prune')} ✓`)
        await fetchImages()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docker_image_prune'))
    } finally {
      setPendingPruneImages(false)
    }
  }, [serverId, fetchImages, t, toast])

  // === 网络操作 ===
  const handleDeleteNetwork = useCallback(async () => {
    if (!pendingDeleteNetwork) return
    setActionLoading(`netrm-${pendingDeleteNetwork.name}`)
    try {
      const result = await sshService.dockerNetworkRm(serverId, pendingDeleteNetwork.name)
      if (result.exitCode !== 0) {
        toast.error(result.stderr || result.stdout || t('docker_network_delete'))
      } else {
        toast.success(`${t('docker_network_deleted')} ✓`)
        await fetchNetworks()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docker_network_delete'))
    } finally {
      setActionLoading(null)
      setPendingDeleteNetwork(null)
      setPendingDeleteNetworkUsedBy(0)
    }
  }, [pendingDeleteNetwork, serverId, fetchNetworks, t, toast])

  // 删除网络前检查是否有容器使用，被使用则禁止删除（避免误删导致容器断网）
  const handleNetworkDeleteClick = useCallback(async (n: DockerNetwork) => {
    try {
      const res = await sshService.dockerNetworkInspect(serverId, n.name)
      if (res.exitCode === 0 && res.stdout) {
        try {
          const arr = JSON.parse(res.stdout)
          const net = Array.isArray(arr) ? arr[0] : arr
          const usedBy = net?.Containers ? Object.keys(net.Containers).length : 0
          setPendingDeleteNetworkUsedBy(usedBy)
        } catch {
          setPendingDeleteNetworkUsedBy(0)
        }
      }
    } catch {
      setPendingDeleteNetworkUsedBy(0)
    }
    setPendingDeleteNetwork(n)
  }, [serverId])

  const handlePruneNetworks = useCallback(async () => {
    setActionLoading('netprune')
    try {
      const result = await sshService.dockerNetworkPrune(serverId)
      if (result.exitCode !== 0) {
        toast.error(result.stderr || result.stdout || t('docker_network_prune'))
      } else {
        toast.success(`${t('docker_network_pruned')} ✓`)
        await fetchNetworks()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docker_network_prune'))
    } finally {
      setActionLoading(null)
      setPendingPruneNetworks(false)
    }
  }, [serverId, fetchNetworks, t, toast])

  // === 卷操作 ===
  const handleDeleteVolume = useCallback(async () => {
    if (!pendingDeleteVolume) return
    setActionLoading(`volrm-${pendingDeleteVolume.name}`)
    try {
      const result = await sshService.dockerVolumeRm(serverId, pendingDeleteVolume.name, false)
      if (result.exitCode !== 0) {
        toast.error(result.stderr || result.stdout || t('docker_volume_delete'))
      } else {
        toast.success(`${t('docker_volume_deleted')} ✓`)
        await fetchVolumes()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docker_volume_delete'))
    } finally {
      setActionLoading(null)
      setPendingDeleteVolume(null)
    }
  }, [pendingDeleteVolume, serverId, fetchVolumes, t, toast])

  const handlePruneVolumes = useCallback(async () => {
    setActionLoading('volprune')
    try {
      const result = await sshService.dockerVolumePrune(serverId)
      if (result.exitCode !== 0) {
        toast.error(result.stderr || result.stdout || t('docker_volume_prune'))
      } else {
        toast.success(`${t('docker_volume_pruned')} ✓`)
        await fetchVolumes()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docker_volume_prune'))
    } finally {
      setActionLoading(null)
      setPendingPruneVolumes(false)
    }
  }, [serverId, fetchVolumes, t, toast])

  // === 网络详情（含 subnet/gateway/接入容器） ===
  const openNetworkInspect = useCallback(async (n: DockerNetwork) => {
    setNetworkInspectModal({
      id: n.name, name: n.name, driver: n.driver, scope: n.scope, subnet: '', gateway: '',
      containers: [], connectOpen: false, containerOptions: [], connecting: false,
    })
    try {
      const res = await sshService.dockerNetworkInspect(serverId, n.name)
      if (res.exitCode === 0 && res.stdout) {
        try {
          const arr = JSON.parse(res.stdout)
          const net = Array.isArray(arr) ? arr[0] : arr
          const cfg = net?.IPAM?.Config?.[0] || {}
          const containers: { name: string; ipv4: string }[] = net?.Containers
            ? Object.values(net.Containers as Record<string, { Name: string; IPv4Address?: string }>).map((c) => ({ name: c.Name, ipv4: c.IPv4Address || '' }))
            : []
          setNetworkInspectModal((m) => m ? { ...m, driver: net?.Driver || n.driver, scope: net?.Scope || n.scope, subnet: cfg.Subnet || '', gateway: cfg.Gateway || '', containers } : m)
        } catch { /* 非 JSON 时保留基础信息 */ }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docker_network_inspect_title'))
    }
  }, [serverId, t, toast])

  // === 创建网络 ===
  const handleNetworkCreate = useCallback(async () => {
    if (!createNetworkDialog) return
    const name = createNetworkDialog.name.trim()
    if (!name) { toast.error(t('docker_network_name_placeholder')); return }
    setActionLoading('netcreate')
    try {
      const res = await sshService.dockerNetworkCreate(serverId, name, createNetworkDialog.driver, createNetworkDialog.subnet.trim() || null, createNetworkDialog.gateway.trim() || null)
      if (res.exitCode !== 0) {
        toast.error(res.stderr || res.stdout || t('docker_network_create_failed'))
      } else {
        toast.success(`${t('docker_network_created')} ✓`)
        setCreateNetworkDialog(null)
        await fetchNetworks()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docker_network_create_failed'))
    } finally {
      setActionLoading(null)
    }
  }, [createNetworkDialog, serverId, fetchNetworks, t, toast])

  // === 接入 / 移出容器 ===
  const openConnectPicker = useCallback(async () => {
    if (!networkInspectModal) return
    setNetworkInspectModal((p) => p ? { ...p, connecting: true } : p)
    try {
      const cts = await sshService.dockerPs(serverId)
      setNetworkInspectModal((p) => p ? {
        ...p,
        // 已接入该网络的容器不出现在可接入列表中，避免重复选择
        containerOptions: cts
          .filter((c) => !p.containers.some((cc) => cc.name === c.name))
          .map((c) => ({ id: c.id, name: c.name })),
        connectOpen: true,
        connecting: false,
      } : p)
    } catch {
      setNetworkInspectModal((p) => p ? { ...p, connecting: false } : p)
    }
  }, [serverId, networkInspectModal])

  const handleNetworkConnect = useCallback(async (containerId: string) => {
    if (!networkInspectModal) return
    setActionLoading(`netconn-${containerId}`)
    try {
      const res = await sshService.dockerNetworkConnect(serverId, networkInspectModal.id, containerId)
      if (res.exitCode !== 0) {
        toast.error(res.stderr || res.stdout || t('docker_network_connect'))
      } else {
        toast.success(`${t('docker_network_connected')} ✓`)
        setNetworkInspectModal((p) => p ? { ...p, connectOpen: false } : p)
        await openNetworkInspect({ name: networkInspectModal.id, driver: networkInspectModal.driver, scope: networkInspectModal.scope })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docker_network_connect'))
    } finally {
      setActionLoading(null)
    }
  }, [networkInspectModal, serverId, t, toast, openNetworkInspect])

  const handleNetworkDisconnect = useCallback(async (containerId: string) => {
    if (!networkInspectModal) return
    setActionLoading(`netdis-${containerId}`)
    try {
      const res = await sshService.dockerNetworkDisconnect(serverId, networkInspectModal.id, containerId, true)
      if (res.exitCode !== 0) {
        toast.error(res.stderr || res.stdout || t('docker_network_disconnect'))
      } else {
        toast.success(`${t('docker_network_disconnected')} ✓`)
        await openNetworkInspect({ name: networkInspectModal.id, driver: networkInspectModal.driver, scope: networkInspectModal.scope })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docker_network_disconnect'))
    } finally {
      setActionLoading(null)
    }
  }, [networkInspectModal, serverId, t, toast, openNetworkInspect])

  // === 卷内容浏览（宿主挂载点 ls -la） ===
  const parseLsLa = (text: string): { name: string; isDir: boolean; size: string; mtime: string }[] => {
    const out: { name: string; isDir: boolean; size: string; mtime: string }[] = []
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('total')) continue
      const cols = line.split(/\s+/)
      if (cols.length < 9) continue
      const name = cols.slice(8).join(' ')
      if (name === '.' || name === '..') continue
      out.push({ name, isDir: cols[0].startsWith('d'), size: cols[4], mtime: `${cols[5]} ${cols[6]} ${cols[7]}` })
    }
    return out
  }
  const openVolumeBrowse = useCallback(async (v: DockerVolume, subPath = '') => {
    setVolumeBrowseModal({ name: v.name, subPath, entries: [], error: '' })
    try {
      const res = await sshService.dockerVolumeBrowse(serverId, v.name, subPath || undefined)
      if (res.exitCode !== 0) {
        setVolumeBrowseModal({ name: v.name, subPath, entries: [], error: res.stderr || res.stdout || t('docker_volume_browse_failed') })
      } else {
        setVolumeBrowseModal({ name: v.name, subPath, entries: parseLsLa(res.stdout), error: '' })
      }
    } catch (err) {
      setVolumeBrowseModal({ name: v.name, subPath, entries: [], error: err instanceof Error ? err.message : t('docker_volume_browse_failed') })
    }
  }, [serverId, t])

  // === 镜像导出 / 导入 ===
  const transferCancelledRef = useRef(false)
  const cancelTransfer = useCallback(async () => {
    if (saveLoadDialog?.loading && !transferCancelledRef.current) {
      transferCancelledRef.current = true
      try { await sshService.dockerImageTransferCancel(serverId) } catch { /* ignore */ }
    }
    setSaveLoadDialog(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveLoadDialog, serverId, sshService])

  const handleImageSave = useCallback(async () => {
    if (!saveLoadDialog) return
    const refs = saveLoadDialog.selected
    if (refs.length === 0) { toast.error(t('docker_pull_invalid')); return }
    for (const r of refs) {
      if (!/^[a-zA-Z0-9._:/-]{1,128}$/.test(r)) { toast.error(t('docker_pull_invalid')); return }
    }
    // 方案 A：直接选择本地保存路径，tar 经 SSH 流式写入该文件，不依赖宿主机磁盘
    const defaultName = refs.length === 1
      ? `${refs[0].replace(/[:/]/g, '_')}.tar`
      : `images-export-${Date.now()}.tar`
    const picked = await saveDialog({ defaultPath: defaultName, filters: [{ name: 'TAR', extensions: ['tar'] }] })
    if (!picked) return
    setSaveLoadDialog((m) => m ? { ...m, loading: true, progress: { transferred: 0, total: 0 }, remotePath: '', result: '' } : m)
    const unlisten = await listen<{ serverId: string; transferred: number; total: number }>('docker-image-save-progress', (e) => {
      if (e.payload.serverId === serverId) {
        setSaveLoadDialog((m) => m ? { ...m, progress: { transferred: e.payload.transferred, total: e.payload.total } } : m)
      }
    })
    try {
      // 按所选镜像总体积估算超时，避免几十 GB 大镜像被固定 30 分钟截断
      const totalBytes = refs.reduce((sum, ref) => {
        const img = images.find((im) => (im.repository === '<none>' ? im.id : `${im.repository}:${im.tag}`) === ref)
        return sum + (img?.sizeBytes ?? 0)
      }, 0)
      const res = await sshService.dockerImageSaveStream(serverId, refs, picked, totalBytes)
      if (res.exitCode !== 0) {
        if (!transferCancelledRef.current) toast.error(res.stderr || t('docker_image_save_failed'))
      } else {
        toast.success(t('docker_image_save_success'))
        setSaveLoadDialog(null)
      }
    } catch (err) {
      if (!transferCancelledRef.current) toast.error(err instanceof Error ? err.message : t('docker_image_save_failed'))
    } finally {
      unlisten()
      setSaveLoadDialog((m) => m ? { ...m, loading: false } : m)
      transferCancelledRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveLoadDialog, serverId, t, toast])

  // load 弹框内选择本地 tar 文件（先选后传，弹框内可直接看到已选文件）
  const pickLocalFile = useCallback(async () => {
    if (!saveLoadDialog || saveLoadDialog.loading) return
    const picked = await openDialog({ filters: [{ name: 'TAR', extensions: ['tar'] }], multiple: false })
    if (!picked || typeof picked !== 'string') return
    const name = picked.split(/[\\/]/).pop() || picked
    setSaveLoadDialog((m) => m ? { ...m, localFile: { name, path: picked } } : m)
  }, [saveLoadDialog])

  const handleImageLoad = useCallback(async () => {
    if (!saveLoadDialog) return
    // 方案 A：直接选择本地 tar 文件，经 SSH stdin 流式喂给远端 docker load，不依赖宿主机磁盘
    // 文件由弹框内「选择本地 tar 文件」按钮选定（saveLoadDialog.localFile.path），
    // 此处不再弹原生文件选择器，避免与弹框交互割裂。
    const localPath = saveLoadDialog.localFile?.path
    if (!localPath) {
      toast.error('请先选择本地 tar 文件')
      return
    }
    setSaveLoadDialog((m) => m ? { ...m, loading: true, progress: { transferred: 0, total: 0 }, result: '' } : m)
    const unlisten = await listen<{ serverId: string; transferred: number; total: number }>('docker-image-load-progress', (e) => {
      if (e.payload.serverId === serverId) {
        setSaveLoadDialog((m) => m ? { ...m, progress: { transferred: e.payload.transferred, total: e.payload.total } } : m)
      }
    })
    try {
      const res = await sshService.dockerImageLoadStream(serverId, localPath)
      if (res.exitCode !== 0) {
        if (!transferCancelledRef.current) toast.error(res.stderr || res.stdout || t('docker_image_load_failed'))
      } else {
        toast.success(t('docker_image_load_success'))
        setSaveLoadDialog(null)
        await fetchImages()
      }
    } catch (err) {
      if (!transferCancelledRef.current) toast.error(err instanceof Error ? err.message : t('docker_image_load_failed'))
    } finally {
      unlisten()
      setSaveLoadDialog((m) => m ? { ...m, loading: false } : m)
      transferCancelledRef.current = false
    }
  }, [saveLoadDialog, serverId, t, toast, fetchImages])

  // === 镜像拉取（长操作：后端 30 分钟超时，对话框保持 pending 直到完成） ===
  const handlePullImage = useCallback(async () => {
    if (!pullDialog || pullDialog.pulling) return
    const image = pullDialog.image.trim()
    if (!/^[a-zA-Z0-9._:/-]{1,128}$/.test(image)) {
      toast.error(t('docker_pull_invalid'))
      return
    }
    setPullDialog({ image, pulling: true })
    try {
      const result = await sshService.dockerPull(serverId, image)
      if (result.exitCode !== 0) {
        toast.error(result.stderr || result.stdout || t('docker_pull_failed'))
        setPullDialog((prev) => (prev ? { ...prev, pulling: false } : prev))
      } else {
        toast.success(`${t('docker_pull_success')} ✓`)
        setPullDialog(null)
        if (view === 'images') await fetchImages()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docker_pull_failed'))
      setPullDialog((prev) => (prev ? { ...prev, pulling: false } : prev))
    }
  }, [pullDialog, serverId, view, fetchImages, t, toast])

  // === 容器生命周期补全：Pause / Resume ===
  const handleLifecycle = useCallback(async (container: DockerContainerType, action: 'pause' | 'unpause') => {
    setActionLoading(container.id)
    try {
      const result = action === 'pause'
        ? await sshService.dockerPause(serverId, container.id)
        : await sshService.dockerUnpause(serverId, container.id)
      if (result.exitCode !== 0) {
        setError(result.stderr || result.stdout || t('dk_err_action').replace('{action}', action))
      } else {
        await fetchContainers()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dk_err_action').replace('{action}', action))
    } finally {
      setActionLoading(null)
    }
  }, [serverId, fetchContainers, t])

  // === Compose 实时部署输出（Dockge 式：执行过程实时可见，替代转圈） ===
  // 注意：必须定义在所有引用它的 compose handlers（handleComposeAction/Up/Down）之前，
  // 否则 deps 数组在渲染期求值会触发 TDZ（Cannot access before initialization）
  const openDeploy = useCallback((action: 'up' | 'down' | 'restart' | 'stop' | 'start' | 'pull' | 'build', project: ComposeProject) => {
    const dir = deriveComposeDir(project.configFile)
    if (!dir) {
      toast.error(t('dk_compose_no_config'))
      return
    }
    const requestId = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    // 记录当前激活请求：供订阅 Promise resolve 时判断面板是否已被关闭/取代（RISK-1）
    deployRequestIdRef.current = requestId
    // 清理上一个订阅
    deployUnsubRef.current?.()
    deployUnsubRef.current = null
    const now = Date.now()
    setDeployModal({
      requestId, action, projectName: project.name,
      text: '', running: true, exitCode: null, error: null,
      startedAt: now, lastChunkAt: now,
    })
    // 先订阅输出流（按 requestId 过滤），就绪后再发起命令，避免错过早期输出
    sshService.onComposeOutput((e) => {
      if (!e || e.requestId !== requestId) return
      if (e.chunk) {
        setDeployModal((prev) => {
          if (!prev || prev.requestId !== requestId) return prev
          // 上限 200KB，防止超长部署撑爆内存
          const next = (prev.text + e.chunk).slice(-200_000)
          return { ...prev, text: next, lastChunkAt: Date.now() }
        })
      }
      if (e.done) {
        setDeployModal((prev) => {
          if (!prev || prev.requestId !== requestId) return prev
          return { ...prev, running: false, exitCode: e.exitCode ?? null, error: e.error ?? null }
        })
        // 部署（up/down/restart/stop/start/build/pull）结束后刷新列表：
        // down 后容器被删，注册表项目以"已停止"保留；up 后状态变 running。
        // 即时刷新让卡片状态与真实运行态同步，避免停留在旧的 running/缺失态。
        fetchComposeProjects()
        // 成功后短暂延时自动关闭面板：控制台 down 立即返回到提示符，UI 不应让人
        // "干等"在成功态。失败（exitCode!=0 或有 error）则保留面板以便查看错误输出。
        if (e.exitCode === 0 && !e.error) {
          const closedReq = requestId
          // 成功自动关闭/手动关闭共用的收尾：退订并清空面板
          const closePanel = () => {
            setDeployModal((prev) => {
              if (prev && prev.requestId === closedReq) {
                deployUnsubRef.current?.()
                deployUnsubRef.current = null
                deployRequestIdRef.current = null
                return null
              }
              return prev
            })
          }
          if (action === 'up') {
            // up -d 退出码 0 不代表容器健康：服务可能立即 crash/exit（RISK-2）。
            // 部署完成后二次校验项目运行状态，异常则不自动关闭并给出警告，
            // 让用户看到"启动实则失败"的信号。校验接口异常时按成功处理，不阻塞。
            sshService.dockerComposePs(serverId)
              .then((r) => {
                if (isComposeUnhealthy(r.stdout, project)) {
                  toast.warning(t('dk_compose_up_unhealthy'))
                } else {
                  setTimeout(closePanel, 1200)
                }
              })
              .catch(() => setTimeout(closePanel, 1200))
          } else {
            setTimeout(closePanel, 1200)
          }
        }
      }
    }).then((un) => {
      // 订阅就绪前面板已被关闭（或被新一轮部署取代）：立即退订，
      // 避免孤儿回调永久残留在全局 Set 中（RISK-1）
      if (deployRequestIdRef.current !== requestId) {
        un()
      } else {
        deployUnsubRef.current = un
      }
      sshService.dockerComposeActionStream(serverId, action, dir, project.configFile || undefined, requestId)
        .catch((err) => {
          setDeployModal((prev) => (prev && prev.requestId === requestId
            ? { ...prev, running: false, error: err instanceof Error ? err.message : String(err) }
            : prev))
        })
    })
  }, [serverId, t, toast, fetchComposeProjects])

  // === Compose 生命周期补全：restart / pull / start / stop / build（走实时输出面板） ===
  const handleComposeAction = useCallback((action: 'up' | 'down' | 'restart' | 'stop' | 'start' | 'pull' | 'build', project: ComposeProject) => {
    const dir = deriveComposeDir(project.configFile)
    if (!dir) {
      toast.error(t('dk_compose_no_config'))
      return
    }
    openDeploy(action, project)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDeploy, t])

  // === Compose 新建项目（Dockge 式：目录 + 初始 YAML，写入后即可 Up） ===
  const handleComposeCreate = useCallback(async () => {
    if (!createDialog || createDialog.creating) return
    const name = createDialog.name.trim()
    const dir = createDialog.dir.trim().replace(/\/+$/, '')
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(name)) {
      toast.error(t('dk_compose_create_name_invalid'))
      return
    }
    if (!dir.startsWith('/') || dir.length < 2) {
      toast.error(t('dk_compose_create_dir_invalid'))
      return
    }
    if (!createDialog.yaml.trim()) {
      toast.error(t('dk_compose_create_yaml_required'))
      return
    }
    setCreateDialog({ ...createDialog, creating: true })
    try {
      const result = await sshService.dockerComposeCreate(serverId, dir, utf8ToBase64(createDialog.yaml))
      if (result.exitCode !== 0) {
        toast.error(result.stderr || result.stdout || t('dk_compose_create_failed'))
        setCreateDialog((prev) => (prev ? { ...prev, creating: false } : prev))
      } else {
        toast.success(`${t('dk_compose_created')} ✓`)
        setCreateDialog(null)
        await fetchComposeProjects()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dk_compose_create_failed'))
      setCreateDialog((prev) => (prev ? { ...prev, creating: false } : prev))
    }
  }, [createDialog, serverId, fetchComposeProjects, t, toast])

  // === 导入已有项目：扫描目录 → 勾选 → 批量 up 注册 ===
  const handleImportScan = useCallback(async () => {
    if (!importDialog || importDialog.scanning) return
    const dirs = importDialog.dirsText
      .split('\n')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter((s) => s.startsWith('/') && s.length > 1)
    if (dirs.length === 0) {
      toast.error(t('dk_compose_import_no_dirs'))
      return
    }
    setImportDialog({ ...importDialog, scanning: true })
    try {
      const previews = (await sshService.dockerComposeImportScan(serverId, dirs)) as ComposeImportPreview[]
      setImportDialog({
        dirsText: importDialog.dirsText,
        scanning: false,
        previews,
        selected: new Set(previews.filter((p) => p.valid && p.file).map((p) => p.dir)),
        importing: false,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dk_compose_import_scan_failed'))
      setImportDialog((prev) => (prev ? { ...prev, scanning: false } : prev))
    }
  }, [importDialog, serverId, t, toast])

  /** 批量导入：对勾选目录逐个 docker compose up -d（复用 docker_compose_up），完成后刷新列表 */
  const handleImportConfirm = useCallback(async () => {
    if (!importDialog || importDialog.importing) return
    const targets = importDialog.previews.filter(
      (p) => p.valid && p.file && importDialog.selected.has(p.dir),
    )
    if (targets.length === 0) {
      toast.error(t('dk_compose_import_no_selection'))
      return
    }
    setImportDialog({ ...importDialog, importing: true })
    const failures: string[] = []
    for (const target of targets) {
      try {
        const r = await sshService.dockerComposeUp(
          serverId, deriveComposeDir(target.file), target.file,
        )
        if (r.exitCode !== 0) {
          failures.push(`${target.dir}: ${r.stderr || r.stdout || 'failed'}`)
        }
      } catch (err) {
        failures.push(`${target.dir}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (failures.length > 0) {
      toast.error(`${t('dk_compose_import_partial_fail')}: ${failures[0]}`)
      setImportDialog((prev) => (prev ? { ...prev, importing: false } : prev))
    } else {
      toast.success(`${t('dk_compose_import_done')} ✓`)
      setImportDialog(null)
      await fetchComposeProjects()
    }
  }, [importDialog, serverId, fetchComposeProjects, t, toast])

  // === docker run → compose：按解析出的 YAML 在指定目录创建新项目 ===
  const convertPreview = useMemo(() => {
    if (!convertDialog) return { yaml: '', error: null as string | null }
    return dockerRunToCompose(convertDialog.runCmd)
  }, [convertDialog])

  const handleConvertCreate = useCallback(async () => {
    if (!convertDialog || convertDialog.creating) return
    const { yaml, error } = dockerRunToCompose(convertDialog.runCmd)
    if (error || !yaml) {
      toast.error(error || t('dk_compose_convert_failed'))
      return
    }
    const name = convertDialog.name.trim()
    const dir = convertDialog.dir.trim().replace(/\/+$/, '')
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(name)) {
      toast.error(t('dk_compose_create_name_invalid'))
      return
    }
    if (!dir.startsWith('/') || dir.length < 2) {
      toast.error(t('dk_compose_create_dir_invalid'))
      return
    }
    setConvertDialog({ ...convertDialog, creating: true })
    try {
      const result = await sshService.dockerComposeCreate(serverId, dir, utf8ToBase64(yaml))
      if (result.exitCode !== 0) {
        toast.error(result.stderr || result.stdout || t('dk_compose_convert_failed'))
        setConvertDialog((prev) => (prev ? { ...prev, creating: false } : prev))
      } else {
        toast.success(`${t('dk_compose_created')} ✓`)
        setConvertDialog(null)
        await fetchComposeProjects()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dk_compose_convert_failed'))
      setConvertDialog((prev) => (prev ? { ...prev, creating: false } : prev))
    }
  }, [convertDialog, serverId, fetchComposeProjects, t, toast])

  // === Compose 配置校验（编辑弹框内：保存前确认配置有效） ===
  const handleComposeValidate = useCallback(async () => {
    if (!composeEditModal || composeEditModal.loading) return
    const dir = deriveComposeDir(composeEditModal.path)
    if (!dir) {
      toast.error(t('dk_compose_validate'))
      return
    }
    setComposeValidating(true)
    try {
      const result = await sshService.dockerComposeValidate(serverId, dir, composeEditModal.path)
      if (result.exitCode === 0) {
        toast.success(t('dk_compose_valid'))
      } else {
        toast.error(result.stderr || result.stdout || t('dk_compose_invalid'))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dk_compose_invalid'))
    } finally {
      setComposeValidating(false)
    }
  }, [composeEditModal, serverId, t, toast])

  // === Registry 登录（私有仓库 pull 的前置条件） ===
  const handleLogin = useCallback(async () => {
    if (!loginDialog || loginDialog.running) return
    const username = loginDialog.username.trim()
    if (!username || !loginDialog.password) {
      toast.error(t('dk_login_required'))
      return
    }
    setLoginDialog({ ...loginDialog, running: true })
    try {
      const result = await sshService.dockerLogin(serverId, loginDialog.registry.trim() || undefined, username, loginDialog.password)
      if (result.exitCode !== 0) {
        toast.error(result.stderr || result.stdout || t('dk_login_failed'))
        setLoginDialog((prev) => (prev ? { ...prev, running: false } : prev))
      } else {
        toast.success(`${t('dk_login_success')} ✓`)
        setLoginDialog(null)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dk_login_failed'))
      setLoginDialog((prev) => (prev ? { ...prev, running: false } : prev))
    }
  }, [loginDialog, serverId, t, toast])

  // === System DF 磁盘占用 ===
  const openDfModal = useCallback(async () => {
    setDfModal({ rows: [], loading: true })
    try {
      const rows = await sshService.dockerSystemDf(serverId)
      setDfModal({ rows, loading: false })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dk_df_load_failed'))
      setDfModal(null)
    }
  }, [serverId, t, toast])

  const handleSystemPrune = useCallback(async () => {
    if (!pendingPruneSystem) return
    setActionLoading('sysprune')
    try {
      const result = await sshService.dockerSystemPrune(serverId, pendingPruneSystem.includeImages)
      if (result.exitCode !== 0) {
        toast.error(result.stderr || result.stdout || t('dk_df_prune_failed'))
      } else {
        toast.success(`${t('dk_df_pruned')} ✓`)
        setPendingPruneSystem(null)
        // 清理后刷新 DF 数据
        const rows = await sshService.dockerSystemDf(serverId).catch(() => [])
        setDfModal((prev) => (prev ? { rows, loading: false } : prev))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dk_df_prune_failed'))
    } finally {
      setActionLoading(null)
    }
  }, [pendingPruneSystem, serverId, t, toast])

  // 部署输出自动滚动（实时输出始终吸底）
  useEffect(() => {
    if (deployModal && deployScrollRef.current) {
      deployScrollRef.current.scrollTop = deployScrollRef.current.scrollHeight
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployModal?.text])

  // === 镜像详情 ===
  const openImageInspect = useCallback(async (img: DockerImage) => {
    setImageInspectModal({ id: img.id, data: t('dk_loading') })
    try {
      const result = await sshService.dockerImageInspect(serverId, img.id)
      if (result.exitCode === 0 && result.stdout) {
        try {
          const parsed = JSON.parse(result.stdout)
          setImageInspectModal({ id: img.id, data: JSON.stringify(parsed, null, 2) })
        } catch {
          setImageInspectModal({ id: img.id, data: result.stdout })
        }
      } else {
        setImageInspectModal({ id: img.id, data: result.stderr || result.stdout || t('dk_err_detail') })
      }
    } catch (err) {
      setImageInspectModal({ id: img.id, data: err instanceof Error ? err.message : t('dk_err_detail') })
    }
  }, [serverId, t])

  // === 运行新容器（MVP basic：名称/镜像/端口/卷/环境变量/重启策略/网络） ===
  const handleRunImage = useCallback(async () => {
    if (!runDialog || runDialog.running) return
    const name = runDialog.name.trim()
    const image = runDialog.image.trim()
    if (!/^[a-zA-Z0-9._-]{1,128}$/.test(name)) {
      toast.error(t('docker_run_name_invalid'))
      return
    }
    if (!/^[a-zA-Z0-9._:/-]{1,128}$/.test(image)) {
      toast.error(t('docker_pull_invalid'))
      return
    }
    setRunDialog({ ...runDialog, running: true })
    try {
      // 修改配置模式：先删旧容器再同名重建（docker 不支持原地改端口/卷/环境变量）。
      // 旧容器已不存在（如上次保存删掉后 run 失败重试）不视为错误，继续重建。
      if (runDialog.editId) {
        const rm = await sshService.dockerRm(serverId, runDialog.editId, true)
        if (rm.exitCode !== 0 && !/no such container/i.test(`${rm.stderr}\n${rm.stdout}`)) {
          toast.error(rm.stderr || rm.stdout || t('docker_run_failed'))
          setRunDialog((prev) => (prev ? { ...prev, running: false } : prev))
          return
        }
      }
      const result = await sshService.dockerRun(serverId, {
        name,
        image,
        ports: runDialog.ports.trim() || undefined,
        volumes: runDialog.volumes.trim() || undefined,
        env: runDialog.env.trim() || undefined,
        restart: runDialog.restart || undefined,
        network: runDialog.network.trim() || undefined,
      })
      if (result.exitCode !== 0) {
        toast.error(result.stderr || result.stdout || t('docker_run_failed'))
        setRunDialog((prev) => (prev ? { ...prev, running: false } : prev))
      } else {
        toast.success(`${t('docker_run_success')} ✓`)
        setRunDialog(null)
        await fetchContainers()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docker_run_failed'))
      setRunDialog((prev) => (prev ? { ...prev, running: false } : prev))
    }
  }, [runDialog, serverId, fetchContainers, t, toast])

  // === Compose up/down/logs ===
  const handleComposeUp = useCallback((project: ComposeProject) => {
    // 从 config files 推导项目目录：取所有文件的公共父目录
    // 多文件场景如 /a/b/x.yml,/a/b/y.yml → /a/b
    const dir = deriveComposeDir(project.configFile)
    if (!dir) {
      toast.error(t('dk_compose_no_config'))
      return
    }
    openDeploy('up', project)
  }, [openDeploy, t, toast])

  // compose down 会停止并删除项目全部容器（危险度高于单容器 stop），
  // 与容器/镜像删除一致走 ConfirmDialog 确认后再执行
  const handleComposeDown = useCallback((project: ComposeProject) => {
    const dir = deriveComposeDir(project.configFile)
    if (!dir) {
      toast.error(t('dk_compose_no_config'))
      return
    }
    setPendingComposeDown(project)
  }, [t, toast])

  const confirmComposeDown = useCallback(async () => {
    const project = pendingComposeDown
    if (!project) return
    const dir = deriveComposeDir(project.configFile)
    if (!dir) {
      toast.error(t('dk_compose_no_config'))
      setPendingComposeDown(null)
      return
    }
    setPendingComposeDown(null)
    // down 也走实时输出面板（删除过程可见，失败原因直接展示）
    openDeploy('down', project)
  }, [pendingComposeDown, openDeploy, t, toast])

  const handleComposeLogs = useCallback(async (project: ComposeProject) => {
    setComposeLogsModal({ name: project.name, data: t('dk_loading') })
    // 与 up/down 一致：从 config files 推导项目目录并传 -f 参数，
    // 否则在 SSH 默认工作目录下执行会报 "no configuration file provided: not found"
    const dir = deriveComposeDir(project.configFile)
    try {
      const result = await sshService.dockerComposeLogs(
        serverId,
        project.name,
        200,
        dir || undefined,
        project.configFile || undefined,
      )
      if (result.exitCode === 0) {
        setComposeLogsModal({ name: project.name, data: stripAnsi(result.stdout) || t('dk_no_logs') })
      } else {
        setComposeLogsModal({ name: project.name, data: stripAnsi(result.stdout || result.stderr || t('dk_err_logs')) })
      }
    } catch (err) {
      setComposeLogsModal({ name: project.name, data: err instanceof Error ? err.message : t('dk_err_logs') })
    }
  }, [serverId, t])

  // === Compose 文件编辑：读取远程文件内容 ===
  // 用 cat 读取（含二进制兜底：若 cat 失败或输出异常，提示错误）。
  // 不用 base64 解码以避免引入额外依赖，compose 文件均为文本。
  const handleComposeEdit = useCallback(async (project: ComposeProject) => {
    if (!project.configFile) {
      toast.error(t('docker_compose_edit'))
      return
    }
    const editKey = `compose-edit-${project.configFile}`
    setActionLoading(editKey)
    // 立即弹出弹窗并显示加载态
    setComposeEditModal({
      path: project.configFile,
      content: '',
      original: '',
      loading: true,
      saving: false,
      error: null,
      view: 'edit',
    })
    try {
      const result = await sshService.execute(
        serverId,
        `cat ${shellQuote(project.configFile)} 2>&1`,
      )
      if (result.exitCode !== 0 && !result.stdout) {
        throw new Error(result.stderr || t('docker_compose_edit_read_err'))
      }
      setComposeEditModal({
        path: project.configFile,
        content: result.stdout || '',
        original: result.stdout || '',
        loading: false,
        saving: false,
        error: null,
        view: 'edit',
      })
    } catch (err) {
      setComposeEditModal({
        path: project.configFile,
        content: '',
        original: '',
        loading: false,
        saving: false,
        error: err instanceof Error ? err.message : t('docker_compose_edit_read_err'),
        view: 'edit',
      })
    } finally {
      setActionLoading(null)
    }
  }, [serverId, t, toast])

  // === Compose 文件编辑：保存回远程 ===
  // base64 编码写回：先写临时文件再原子替换，失败时保留原文件。
  // 不用 heredoc —— 文件内容中若有一行恰好等于终止符（从仓库克隆的文件完全可能），
  // heredoc 会提前终止，其后内容被当作宿主 shell 命令执行（注入），原文件被截断版覆盖。
  const handleComposeSave = useCallback(async () => {
    if (!composeEditModal || composeEditModal.loading || composeEditModal.saving) return
    // 未改动直接关闭
    if (composeEditModal.content === composeEditModal.original) {
      setComposeEditModal(null)
      return
    }
    setComposeEditModal({ ...composeEditModal, saving: true })
    const { path, content } = composeEditModal
    try {
      const tmpPath = `${path}.swktmp.${Date.now()}`
      // base64 输出仅含 [A-Za-z0-9+/=]，对 shell 完全惰性，内容无需任何转义
      const b64 = utf8ToBase64(content)
      // 与 heredoc 方案不同：base64 -d 精确还原内容，不再追加尾部换行
      const cmd = `echo ${shellQuote(b64)} | base64 -d > ${shellQuote(tmpPath)} && mv ${shellQuote(tmpPath)} ${shellQuote(path)} 2>&1`
      const result = await sshService.execute(serverId, cmd)
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || result.stdout || t('docker_compose_edit_save_err'))
      }
      toast.success(`${t('docker_compose_edit_saved')} ✓`)
      setComposeEditModal(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('docker_compose_edit_save_err'))
      setComposeEditModal({ ...composeEditModal, saving: false })
    }
  }, [composeEditModal, serverId, t, toast])

  // === 日志模态框 ===
  // 流式日志：把单个 chunk 追加到日志视图（处理跨 chunk 行截断、--timestamps 前缀剥离、
  // 断线续流的边界行去重）。logsData 保留 ANSI 序列，渲染层用 renderAnsiLine 着色。
  const appendLogsStreamChunk = useCallback((chunk: string) => {
    logsLineBufRef.current += chunk
    const text = logsLineBufRef.current
    const lastNewline = text.lastIndexOf('\n')
    if (lastNewline === -1) return
    const complete = text.slice(0, lastNewline)
    logsLineBufRef.current = text.slice(lastNewline + 1)
    const TS_RE = /^(\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+-]\d{2}:\d{2}))\s/
    let out = ''
    for (const raw of complete.split('\n')) {
      const line = raw.replace(/\r$/, '')
      const m = TS_RE.exec(line)
      if (m) {
        // --since 秒级精度可能重发边界行：时间戳不晚于上次最大值直接丢弃
        if (logsLastTsRef.current && m[1] <= logsLastTsRef.current) continue
        logsLastTsRef.current = m[1]
      }
      out += line + '\n'
    }
    if (!out) return
    logsPendingDisplayRef.current += out
    // 防止后台流速远高于渲染帧时待显示缓冲无限增长；保留最近一段即可。
    if (logsPendingDisplayRef.current.length > MAX_LOG_SIZE * 2) {
      logsPendingDisplayRef.current = logsPendingDisplayRef.current.slice(-MAX_LOG_SIZE)
    }
    if (logsDisplayFrameRef.current === null) {
      logsDisplayFrameRef.current = requestAnimationFrame(() => {
        logsDisplayFrameRef.current = null
        const pending = logsPendingDisplayRef.current
        logsPendingDisplayRef.current = ''
        if (!pending) return
        setLogsData(prev => {
          const next = prev + pending
          return next.length > MAX_LOG_SIZE ? next.slice(-MAX_LOG_SIZE) : next
        })
      })
    }
  }, [])

  const openLogsModal = useCallback(async (container: DockerContainerType) => {
    const seq = ++logsModalSeqRef.current
    setModal({ type: 'logs', container })
    setLogsData(t('dk_loading'))
    setLogsLoading(true)
    logsPausedRef.current = false
    setLogsPaused(false)
    logsLastTsRef.current = ''
    logsLineBufRef.current = ''
    logsPendingDisplayRef.current = ''
    if (logsDisplayFrameRef.current !== null) {
      cancelAnimationFrame(logsDisplayFrameRef.current)
      logsDisplayFrameRef.current = null
    }
    logFailCountRef.current = 0
    setLogsPollingFailed(false)
    // 旧流订阅立即作废（防与新容器的流串数据）
    logsUnsubRef.current?.()
    logsUnsubRef.current = null

    let initialFailed = false
    try {
      const result = await sshService.dockerLogs(serverId, container.id, 1000)
      // 等待期间用户已打开其他容器的日志/关闭模态框：丢弃陈旧响应
      if (logsModalSeqRef.current !== seq) return
      if (result.exitCode === 0) {
        // 保留 ANSI 序列（渲染层着色）；搜索/下载时按需剥离
        setLogsData(result.stdout || t('dk_no_logs_data'))
      } else {
        setLogsData(stripAnsi(result.stdout || result.stderr || t('dk_err_logs')))
      }
    } catch (err) {
      setLogsData(err instanceof Error ? err.message : t('dk_err_logs'))
      // 初始加载抛异常时不启动跟随流，避免空转
      initialFailed = true
    } finally {
      // 陈旧响应不触碰 loading 态（新模态框的加载流程由其自身管理）
      if (logsModalSeqRef.current === seq) setLogsLoading(false)
    }

    if (initialFailed) return
    // 等待期间模态框已被关闭/替换：不启动跟随流
    if (logsModalSeqRef.current !== seq) return

    // === logs -f 实时跟随 ===
    // 设计：后端单次连接有界 120s，done 后前端带 --since <上次时间戳> 自动续流，
    // 实现"永不超时的真流式"，且模态框关闭后远端进程最多存活 120s 自然结束。
    // 暂停：跳过 chunk 处理（lastTs 冻结）；恢复后从冻结点续拉，不丢不重。
    const fail = () => {
      logFailCountRef.current += 1
      if (logFailCountRef.current >= LOG_POLL_FAIL_THRESHOLD) {
        setLogsPollingFailed(true)
        toast.error(t('dk_err_logs'))
        return false
      }
      return true
    }
    const follow = () => {
      if (logsModalSeqRef.current !== seq) return
      // 续流起点：上次最后时间戳；无（初始加载行无时间戳）则回看 2 秒补连接间隙
      const parsedTs = logsLastTsRef.current ? Date.parse(logsLastTsRef.current) : NaN
      const since = !isNaN(parsedTs)
        ? String(Math.floor(parsedTs / 1000))
        : String(Math.floor(Date.now() / 1000) - 2)
      const requestId = `logs-${seq}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      let un: (() => void) | null = null
      let closed = false
      const unsub = () => { if (!closed) { closed = true; un?.() } }
      let gotData = false      // 本周期是否收到过数据（区分"120s 有界超时"与"连接失败"）
      let daemonError = false  // 容器被删/daemon 异常（docker logs 退出码非 0 且错误在输出里）
      sshService.onComposeOutput((e) => {
        if (!e || e.requestId !== requestId) return
        // 模态框已关闭/切换容器：断开本流
        if (logsModalSeqRef.current !== seq) { unsub(); return }
        if (e.chunk) {
          gotData = true
          if (/Error response from daemon|No such container/i.test(e.chunk)) daemonError = true
          if (!logsPausedRef.current) appendLogsStreamChunk(e.chunk)
        }
        if (e.done) {
          unsub()
          if (daemonError || (!gotData && (e.error || (e.exitCode != null && e.exitCode !== 0)))) {
            // 容器被删 / 连接失败：计入连续失败，达阈值停止跟随并提示
            if (!fail()) return
          } else {
            // 正常周期结束（120s 有界）：重置计数继续跟随
            logFailCountRef.current = 0
            setLogsPollingFailed(false)
          }
          setTimeout(follow, daemonError ? 5000 : 300)
        }
      }).then((u) => {
        un = u
        // 订阅就绪前模态框已关闭/替换：直接断开
        if (logsModalSeqRef.current !== seq || closed) { u(); return }
        logsUnsubRef.current = u
        sshService.dockerLogsStream(serverId, container.id, 0, since, requestId).catch((err) => {
          if (logsModalSeqRef.current !== seq) return
          devWarn('[logsStream] 启动失败:', err)
          if (fail()) setTimeout(follow, 1000)
        })
      })
    }
    follow()
  }, [serverId, appendLogsStreamChunk, t, toast])

  // === Inspect 模态框 ===
  const openInspectModal = useCallback(async (container: DockerContainerType) => {
    setModal({ type: 'inspect', container })
    setInspectData(t('dk_loading'))
    setInspectCopied(false)
    setInspectTab('structured')
    try {
      const result = await sshService.dockerInspect(serverId, container.id)
      if (result.exitCode === 0 && result.stdout) {
        try {
          const parsed = JSON.parse(result.stdout)
          setInspectData(JSON.stringify(parsed, null, 2))
        } catch {
          setInspectData(result.stdout)
        }
      } else {
        // 修复：stderr 现在正确返回错误信息（不再被 2>&1 合并到 stdout）
        setInspectData(result.stderr || result.stdout || t('dk_err_detail'))
      }
    } catch (err) {
      setInspectData(err instanceof Error ? err.message : t('dk_err_detail'))
    }
  }, [serverId, t])

  // === Stats 模态框 ===
  const openStatsModal = useCallback(async (container: DockerContainerType) => {
    const seq = ++statsModalSeqRef.current
    setModal({ type: 'stats', container })
    setStatsHistory([])
    setStatsCurrent(null)
    setStatsError(null)
    cgroupPrevRef.current = null
    // cgroupAvailableRef 不在此重置：cgroup 是否可用取决于宿主机能力，
    // 与具体容器无关，首次探测后跨 modal 复用，避免每次打开都重新探测。

    // 轻量路径：直接读 cgroup 文件（<50ms），无需 docker stats 的 1 秒 CPU 采样
    const fetchStatsCgroup = async (): Promise<boolean> => {
      try {
        const result = await sshService.execute(serverId, buildCgroupCmd(container.id))
        // 模态框已关闭/切换容器：丢弃陈旧响应
        if (statsModalSeqRef.current !== seq) return false
        const stdout = result.stdout || ''
        const { data, cpuUsage, now } = parseCgroup(stdout, cgroupPrevRef.current, t)
        if (!data) {
          // 探测失败不全局降级：可能只是该容器已停止。本次模态框降级 docker stats，
          // 下次打开模态框重新探测（快速路径成本仅一次 <50ms 的轻量命令）
          return false
        }
        cgroupPrevRef.current = { usage: cpuUsage, time: now }
        if (cgroupAvailableRef.current === null) cgroupAvailableRef.current = true

        // 转换为 StatsData（网络/块 IO 已从容器 netns /proc/net/dev 与 cgroup io 读取）
        const statsData: StatsData = {
          cpuPerc: data.cpuPerc,
          memPerc: data.memPerc,
          memUsed: data.memUsed,
          memTotal: data.memTotal,
          netRx: data.netRx, netTx: data.netTx,
          blockRead: data.blockRead, blockWrite: data.blockWrite,
          pids: data.pids,
        }
        setStatsCurrent(statsData)
        setStatsError(null)
        setStatsHistory(prev => {
          const next = [...prev, { ...statsData, time: new Date().toLocaleTimeString() }]
          return next.slice(-60)
        })
        return true
      } catch {
        // 同上：失败只影响本次采样，不永久关闭快速路径
        return false
      }
    }

    // 降级路径：docker stats（兼容性好，但有 ~1 秒 CPU 采样延迟）
    const fetchStatsDocker = async () => {
      try {
        const cmd = `docker stats --no-stream --format '{{json .}}' ${container.id}`
        const result = await sshService.execute(serverId, cmd)
        // 模态框已关闭/切换容器：丢弃陈旧响应
        if (statsModalSeqRef.current !== seq) return
        const stdout = result.stdout || ''
        const stderr = result.stderr || ''
        if (stdout.trim()) {
          const { data: parsed, error: parseError } = parseStats(stdout, t)
          if (parsed) {
            setStatsCurrent(parsed)
            setStatsError(null)
            setStatsHistory(prev => {
              const next = [...prev, { ...parsed, time: new Date().toLocaleTimeString() }]
              return next.slice(-60)
            })
            return
          }
          setStatsError(`${t('dk_parse_failed')}: ${parseError}`)
        } else if (stderr.trim()) {
          setStatsError(stderr.trim())
        } else {
          setStatsError(`${t('dk_no_output')} (exitCode=${result.exitCode})`)
        }
      } catch (err) {
        setStatsError(err instanceof Error ? err.message : t('dk_err_stats'))
      }
    }

    // 主轮询：cgroup 优先，失败降级 docker stats (带锁防止慢网堆积)
    const fetchStats = async () => {
      if (statsFetchingRef.current) return
      // 模态框已关闭/切换容器：不再发起采样
      if (statsModalSeqRef.current !== seq) return
      statsFetchingRef.current = true
      try {
        if (cgroupAvailableRef.current === false) {
          await fetchStatsDocker()
          return
        }
        const ok = await fetchStatsCgroup()
        if (statsModalSeqRef.current !== seq) return
        if (!ok) await fetchStatsDocker()
      } finally {
        statsFetchingRef.current = false
      }
    }

    statsFetchingRef.current = false
    // 暴露刷新函数供错误重试按钮调用
    statsRefreshRef.current = fetchStats
    await fetchStats()
    // 首次采样期间模态框已被关闭/替换：不启动轮询
    if (statsModalSeqRef.current !== seq) return
    if (statsPollRef.current) clearInterval(statsPollRef.current)
    // cgroup 路径快，可以 2 秒刷新；docker stats 降级时也是 2 秒（命令本身慢，但间隔合理）
    statsPollRef.current = setInterval(fetchStats, 2000)
  }, [serverId, t])

  // === Container Files（docker cp 浏览/下载/上传） ===
  const [filesPath, setFilesPath] = useState('/')
  const [filesList, setFilesList] = useState<DockerFileEntry[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  // 从宿主机复制：服务器文件选择对话框
  const [hostPickerOpen, setHostPickerOpen] = useState(false)
  // 容器内待删除文件/目录（破坏性操作需确认）
  const [pendingFileDelete, setPendingFileDelete] = useState<DockerFileEntry | null>(null)

  const fetchFiles = useCallback(async (container: DockerContainerType, path: string) => {
    setFilesLoading(true)
    setFilesError(null)
    try {
      const list = await sshService.dockerContainerFileList(serverId, container.id, path)
      setFilesList(list)
      setFilesPath(path)
    } catch (err) {
      setFilesList([])
      setFilesError(err instanceof Error ? err.message : t('dk_files_load_failed'))
    } finally {
      setFilesLoading(false)
    }
  }, [serverId, t])

  const openFilesTab = useCallback(async (container: DockerContainerType) => {
    setModal({ type: 'files', container })
    await fetchFiles(container, '/')
  }, [fetchFiles])

  /** 下载容器文件：docker cp 到远端临时目录 → SFTP 下载到本地 → 清理远端临时目录 */
  const handleFileDownload = useCallback(async (entry: DockerFileEntry) => {
    if (!modal?.container || entry.isDir) return
    const container = modal.container
    const fullPath = `${filesPath === '/' ? '' : filesPath}/${entry.name}`
    setActionLoading(`file-dl-${entry.name}`)
    let tmpDir: string | null = null
    try {
      const prep = await sshService.dockerCpFromContainer(serverId, container.id, fullPath)
      tmpDir = prep.tmpDir
      await sshService.downloadFile(serverId, prep.hostPath)
      toast.success(`${entry.name} ✓`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dk_files_download_failed'))
    } finally {
      if (tmpDir) await sshService.dockerCpCleanup(serverId, tmpDir).catch(() => {})
      setActionLoading(null)
    }
  }, [modal, serverId, filesPath, t, toast])

  /** 上传本地文件到容器当前目录：本地选择 → SFTP 传到远端临时目录 → docker cp 进容器 → 清理 */
  const handleFileUpload = useCallback(async () => {
    if (!modal?.container) return
    const container = modal.container
    // 临时目录带 /tmp/swk-docker-cp 前缀（后端 cp 命令据此判定可删源文件）
    const tmpDir = `/tmp/swk-docker-cp/up-${Date.now()}`
    setActionLoading('file-ul')
    try {
      // 上传前必须先创建目标目录：SFTP 上传会校验目标目录存在，
      // 目录不存在时报"目标不存在或已被移除"
      await sshService.execute(serverId, `mkdir -p ${tmpDir}`)
      const up = await sshService.uploadFiles(serverId, tmpDir, 'file')
      if (!up.success) {
        toast.error(up.error || t('dk_files_upload_failed'))
        return
      }
      const uploaded = await sshService.listFiles(serverId, tmpDir)
      for (const f of uploaded) {
        if (f.isDirectory) continue
        // 源路径统一用 tmpDir/name（不依赖 FileEntry.path 的口径）；复制后删除临时文件
        const r = await sshService.dockerCpToContainer(
          serverId, container.id, `${tmpDir}/${f.name}`, filesPath, true,
        )
        if (r.exitCode !== 0) {
          throw new Error(r.stderr || r.stdout || t('dk_files_upload_failed'))
        }
      }
      toast.success(`${t('dk_files_upload')} ✓`)
      await fetchFiles(container, filesPath)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dk_files_upload_failed'))
    } finally {
      await sshService.dockerCpCleanup(serverId, tmpDir).catch(() => {})
      setActionLoading(null)
    }
  }, [modal, serverId, filesPath, fetchFiles, t, toast])

  /** 从宿主机复制：文件浏览器选中服务器上的文件/目录 → docker cp 进容器（保留源文件） */
  const handleHostCopy = useCallback(async (paths: string[]) => {
    if (!modal?.container || paths.length === 0) return
    const container = modal.container
    setHostPickerOpen(false)
    setActionLoading('host-copy')
    try {
      for (const src of paths) {
        if (!src.startsWith('/')) continue
        // deleteSource=false：宿主机源文件必须保留
        const r = await sshService.dockerCpToContainer(serverId, container.id, src, filesPath, false)
        if (r.exitCode !== 0) {
          throw new Error(r.stderr || r.stdout || t('dk_files_host_copy_failed'))
        }
      }
      toast.success(`${t('dk_files_host_copy')} ✓`)
      await fetchFiles(container, filesPath)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dk_files_host_copy_failed'))
    } finally {
      setActionLoading(null)
    }
  }, [modal, serverId, filesPath, fetchFiles, t, toast])

  /** 删除容器内文件/目录（破坏性操作：确认后 docker exec rm -rf） */
  const handleFileDelete = useCallback(async () => {
    if (!modal?.container || !pendingFileDelete) return
    const container = modal.container
    const fullPath = `${filesPath === '/' ? '' : filesPath}/${pendingFileDelete.name}`
    setActionLoading(`file-del-${pendingFileDelete.name}`)
    try {
      const r = await sshService.dockerContainerFileDelete(serverId, container.id, fullPath)
      if (r.exitCode !== 0) {
        toast.error(r.stderr || r.stdout || t('dk_files_delete_failed'))
      } else {
        toast.success(`${t('dk_files_delete')} ✓`)
        await fetchFiles(container, filesPath)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dk_files_delete_failed'))
    } finally {
      setActionLoading(null)
      setPendingFileDelete(null)
    }
  }, [modal, serverId, filesPath, pendingFileDelete, fetchFiles, t, toast])

  /** 详情模态框 Tab 切换：先停掉当前 Tab 的轮询/流，再打开目标 Tab */
  const switchDetailTab = useCallback((tab: 'logs' | 'stats' | 'inspect' | 'files') => {
    if (!modal || modal.type === tab) return
    const container = modal.container
    // 清理日志流与监控轮询（序号自增使在途回调被丢弃）
    logsUnsubRef.current?.()
    logsUnsubRef.current = null
    logsModalSeqRef.current++
    statsModalSeqRef.current++
    if (statsPollRef.current) {
      clearInterval(statsPollRef.current)
      statsPollRef.current = null
    }
    statsFetchingRef.current = false
    logFailCountRef.current = 0
    setLogsPollingFailed(false)
    if (tab === 'logs') openLogsModal(container)
    else if (tab === 'stats') openStatsModal(container)
    else if (tab === 'inspect') openInspectModal(container)
    else openFilesTab(container)
  }, [modal, openLogsModal, openStatsModal, openInspectModal, openFilesTab])

  // === 关闭模态框 ===
  const closeModal = useCallback(() => {
    // 自增序号作废两个模态框的在途请求（其响应回调会因序号不匹配被丢弃）
    logsModalSeqRef.current++
    statsModalSeqRef.current++
    // 日志跟随流断开（远端进程最多存活 120s 有界自然结束）
    logsUnsubRef.current?.()
    logsUnsubRef.current = null
    logsPendingDisplayRef.current = ''
    if (logsDisplayFrameRef.current !== null) {
      cancelAnimationFrame(logsDisplayFrameRef.current)
      logsDisplayFrameRef.current = null
    }
    if (statsPollRef.current) {
      clearInterval(statsPollRef.current)
      statsPollRef.current = null
    }
    statsFetchingRef.current = false
    logFailCountRef.current = 0
    // 清理 inspect 复制定时器与 stats 刷新引用，避免关闭后残留回调
    if (inspectCopyTimerRef.current) {
      clearTimeout(inspectCopyTimerRef.current)
      inspectCopyTimerRef.current = null
    }
    statsRefreshRef.current = null
    setLogsPollingFailed(false)
    setModal(null)
  }, [])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      logsUnsubRef.current?.()
      if (statsPollRef.current) clearInterval(statsPollRef.current)
      deployUnsubRef.current?.()
    }
  }, [])

  // 部署面板心跳 + 前端看门狗：
  // - 每 1s 触发重渲染，驱动「已运行 Ns / 已 Ns 无输出」显示
  // - 兜底：后端虽保证 done 且自带超时（30min），但若事件在极端情况下丢失，
  //   前端不会永久停在「执行中」——超过阈值（30min + 2min 缓冲）自动置为失败
  useEffect(() => {
    if (!deployModal?.running) return
    const startedAt = deployModal.startedAt
    const WATCHDOG_MS = 32 * 60 * 1000
    const timer = setInterval(() => {
      setDeployTick((n) => n + 1)
      if (Date.now() - startedAt > WATCHDOG_MS) {
        setDeployModal((prev) => (
          prev && prev.running
            ? { ...prev, running: false, error: t('dk_deploy_timeout') }
            : prev
        ))
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [deployModal?.running, deployModal?.startedAt, t])

  // 日志自动滚动：仅当处于吸底状态（用户停留在底部附近）时跟随新日志；
  // 用户向上翻阅历史时不强制拉底，否则每 3 秒增量追加都会打断阅读
  useEffect(() => {
    if (modal?.type === 'logs' && logsScrollRef.current && logsStickBottomRef.current) {
      logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight
    }
  }, [logsData, modal])

  // Compose 日志模态框：数据更新时自动滚到底部，显示最新日志（吸底检测同上）
  useEffect(() => {
    if (composeLogsModal && composeLogsScrollRef.current && composeLogsStickBottomRef.current) {
      composeLogsScrollRef.current.scrollTop = composeLogsScrollRef.current.scrollHeight
    }
  }, [composeLogsModal])

  // === 菜单项构建 ===
  const buildMenuItems = useCallback((container: DockerContainerType): MenuItem[] => {
    const isRunning = container.state === 'running'
    return [
      { icon: <FileText className="h-3.5 w-3.5" />, label: t('dk_logs'), onClick: () => openLogsModal(container) },
      { icon: <BarChart3 className="h-3.5 w-3.5" />, label: t('dk_status'), onClick: () => openStatsModal(container) },
      { icon: <Info className="h-3.5 w-3.5" />, label: t('dk_detail'), onClick: () => openInspectModal(container) },
      { icon: <Terminal className="h-3.5 w-3.5" />, label: t('dk_exec'), onClick: () => openExecTerminal(container), disabled: !isRunning },
      // 生命周期补全：运行中可暂停（cgroup 冻结），暂停中可恢复
      ...(isRunning
        ? [{ icon: <Pause className="h-3.5 w-3.5" />, label: t('dk_container_pause'), onClick: () => handleLifecycle(container, 'pause') }]
        : container.state === 'paused'
          ? [{ icon: <Play className="h-3.5 w-3.5" />, label: t('dk_container_resume'), onClick: () => handleLifecycle(container, 'unpause') }]
          : []
      ),
      // restart 为危险操作，弹出确认框
      { icon: <RotateCcw className="h-3.5 w-3.5" />, label: t('dk_restart'), onClick: () => setPendingAction({ container, action: 'restart' }) },
      // 修改配置：inspect 预填当前配置，保存时删旧容器同名重建（docker 不支持原地改端口/卷/环境变量）
      { icon: <Pencil className="h-3.5 w-3.5" />, label: t('dk_edit_config'), onClick: () => setPendingConfigEdit(container) },
      ...(isRunning
        ? [{ icon: <Square className="h-3.5 w-3.5" />, label: t('dk_stop'), onClick: () => setPendingAction({ container, action: 'stop' }), danger: true }]
        : [{ icon: <Play className="h-3.5 w-3.5" />, label: t('dk_start'), onClick: () => handleAction(container, 'start') }]
      ),
      // 删除容器（运行中需先停止或强制删除）
      { icon: <Trash2 className="h-3.5 w-3.5" />, label: t('docker_container_delete'), onClick: () => setPendingDeleteContainer({ container, force: false }), danger: true },
      { icon: <Trash2 className="h-3.5 w-3.5" />, label: t('docker_container_force_delete'), onClick: () => setPendingDeleteContainer({ container, force: true }), danger: true },
    ]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleAction, handleLifecycle, openLogsModal, openStatsModal, openInspectModal, editContainerConfig, setPendingConfigEdit, t])

  // === 右键菜单 ===
  const handleContextMenu = useCallback((e: React.MouseEvent, container: DockerContainerType) => {
    e.preventDefault()
    e.stopPropagation()
    setDropdownId(null)
    setCtxMenu({ x: e.clientX, y: e.clientY, container })
  }, [])

  // 关闭菜单
  // 注意（与 files 模块同款修复）：Docker 模块同样渲染在 WorkspaceModuleModal 内，
  // 弹窗主体对 click 做了 stopPropagation，挂 window 冒泡阶段的 click 监听永远收不到
  // 事件，必须用 document 捕获阶段的 pointerdown；同时点击菜单内部
  // （根节点带 data-ctx-menu 标记）时不关闭，否则菜单项会先被关掉导致点击失效。
  useEffect(() => {
    if (!ctxMenu && !dropdownId && !composeMenu) return
    const close = (e: Event) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('[data-ctx-menu]')) return
      setCtxMenu(null)
      setDropdownId(null)
      setComposeMenu(null)
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('contextmenu', close, true)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('contextmenu', close, true)
    }
  }, [ctxMenu, dropdownId, composeMenu])

  // === 三点菜单按钮点击 ===
  const handleDropdownClick = useCallback((e: React.MouseEvent, container: DockerContainerType) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    dropdownPos.current = { x: rect.right, y: rect.bottom + 4 }
    setDropdownId(dropdownId === container.id ? null : container.id)
    setCtxMenu(null)
  }, [dropdownId])

  // === 过滤 ===
  const filteredContainers = useMemo(() => {
    if (!searchQuery) return containers
    const q = searchQuery.toLowerCase()
    return containers.filter(c =>
      c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q)
    )
  }, [containers, searchQuery])

  // === 状态徽章 ===
  const StatusBadge = ({ state, status }: { state: string; status: string }) => {
    // 状态颜色分类：running 绿/暂停类黄/exited 灰/created 蓝/dead 红/其他红
    const tone: PillTone = (() => {
      switch (state) {
        case 'running': return 'emerald'
        case 'paused': case 'restarting': return 'amber'
        case 'exited': return 'zinc'
        case 'created': return 'blue'
        default: return 'rose'
      }
    })()
    const pulse = state === 'running' || state === 'restarting' || state === 'dead'
    // 健康检查标记：docker ps 的 Status 含 "(healthy)" / "(unhealthy)" / "(health: starting)"
    const health = /\((healthy|unhealthy|health: starting)\)/.exec(status)?.[1]
    const cleanStatus = status.replace(/\s*\((healthy|unhealthy|health: starting)\)/, '').trim()
    const healthMark = health === 'healthy'
      ? { dot: 'bg-emerald-400', label: t('dk_health_healthy') }
      : health === 'unhealthy'
        ? { dot: 'bg-rose-400', label: t('dk_health_unhealthy') }
        : health
          ? { dot: 'bg-amber-400', label: t('dk_health_starting') }
          : null
    return (
      <StatusPill
        tone={tone}
        label={cleanStatus || status}
        pulse={pulse}
        extra={healthMark ? (
          <span className="inline-flex items-center gap-1 ml-0.5 pl-1.5 border-l border-border/40">
            <span className={cn('w-1.5 h-1.5 rounded-full', healthMark.dot)} />
            {healthMark.label}
          </span>
        ) : undefined}
      />
    )
  }

  // === 渲染菜单面板 ===
  const renderMenu = (container: DockerContainerType, x: number, y: number) => {
    const items = buildMenuItems(container)
    // 边界检测：确保菜单不超出视口
    const MENU_W = 180
    const MENU_H = items.length * 32 + 16
    const PAD = 8
    const adjX = x + MENU_W > window.innerWidth - PAD
      ? Math.max(PAD, window.innerWidth - MENU_W - PAD)
      : x
    const adjY = y + MENU_H > window.innerHeight - PAD
      ? Math.max(PAD, window.innerHeight - MENU_H - PAD)
      : y
    return (
      <div
        data-ctx-menu
        className="fixed z-[200] min-w-[160px] glass-strong border border-border/60 rounded-xl shadow-lg py-1.5 text-xs"
        style={{ left: adjX, top: adjY }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((item, i) => (
          <button
            key={i}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-accent text-left transition-colors duration-150',
              item.disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent',
              item.danger && 'text-destructive hover:bg-destructive/10',
            )}
            onClick={() => {
              if (item.disabled) return
              item.onClick()
              setCtxMenu(null)
              setDropdownId(null)
            }}
            disabled={item.disabled}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    )
  }

  /** Compose 卡片「更多」菜单：低频操作（Start/Stop/Build/Pull）集中收纳，
 * 主操作栏只保留 Up/Restart/Down/Logs/Edit 五个高频动作，与 Dockge 卡片密度一致。 */
  const renderComposeMenu = useCallback((x: number, y: number, project: ComposeProject) => {
    const running = /running/i.test(project.status)
    const busy = actionLoading !== null
    const items: {
      icon: React.ReactNode; label: string; disabled?: boolean
      danger?: boolean; onClick: () => void
    }[] = [
      {
        icon: <Play className="h-3.5 w-3.5" />,
        label: t('docker_compose_start'),
        disabled: busy || running,
        onClick: () => handleComposeAction('start', project),
      },
      {
        icon: <Square className="h-3.5 w-3.5" />,
        label: t('docker_compose_stop'),
        disabled: busy || !running,
        onClick: () => handleComposeAction('stop', project),
      },
      {
        icon: <Download className="h-3.5 w-3.5" />,
        label: t('docker_compose_pull'),
        disabled: busy,
        onClick: () => handleComposeAction('pull', project),
      },
    ]
    const MENU_W = 190
    const MENU_H = items.length * 32 + 16
    const PAD = 8
    const adjX = x + MENU_W > window.innerWidth - PAD
      ? Math.max(PAD, window.innerWidth - MENU_W - PAD)
      : x
    const adjY = y + MENU_H > window.innerHeight - PAD
      ? Math.max(PAD, window.innerHeight - MENU_H - PAD)
      : y
    return (
      <div
        data-ctx-menu
        className="fixed z-[200] min-w-[170px] glass-strong border border-border/60 rounded-xl shadow-lg py-1.5 text-xs"
        style={{ left: adjX, top: adjY }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((item, i) => (
          <button
            key={i}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-accent text-left transition-colors duration-150',
              item.disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent',
              item.danger && 'text-destructive hover:bg-destructive/10',
            )}
            onClick={() => {
              if (item.disabled) return
              item.onClick()
              setComposeMenu(null)
            }}
            disabled={item.disabled}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    )
  }, [actionLoading, t, handleComposeAction])

  const activeMenuContainer = ctxMenu?.container
    || (dropdownId ? containers.find(c => c.id === dropdownId) : null)

  return (
    <div className="flex h-full min-h-0 bg-transparent">
      {/* 左侧二级导航（Portainer 式资源导航，扩展新视图不再挤占工具栏） */}
      <nav className="w-36 flex-shrink-0 border-r border-border/60 bg-muted/20 flex flex-col py-2 px-1.5 gap-0.5 overflow-y-auto">
        <div className="px-2 pt-1 pb-2.5 mb-1 border-b border-border/40 flex items-center gap-1.5">
          <Container className="h-4 w-4 text-primary" />
          <span className="text-[13px] font-semibold text-foreground">Docker</span>
        </div>
        {([
          { key: 'overview', icon: <LayoutGrid className="h-4 w-4" />, label: t('dk_view_overview') },
          { key: 'containers', icon: <Container className="h-4 w-4" />, label: t('docker_view_containers') },
          { key: 'images', icon: <Package className="h-4 w-4" />, label: t('docker_view_images') },
          { key: 'networks', icon: <Network className="h-4 w-4" />, label: t('docker_view_networks') },
          { key: 'volumes', icon: <HardDrive className="h-4 w-4" />, label: t('docker_view_volumes') },
          { key: 'compose', icon: <Layers className="h-4 w-4" />, label: t('docker_view_compose') },
        ] as const).map((item) => (
          <button
            key={item.key}
            className={cn(
              'flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors duration-150 text-left',
              view === item.key
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
            onClick={() => setView(item.key)}
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* 右侧内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
      {/* 上下文条：Docker 版本常显 + 视图专属操作 + 全局刷新 */}
      <div className="flex items-center gap-2.5 px-4 h-11 border-b border-border/50 bg-muted/20 shrink-0 flex-wrap">
        {overview && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 text-emerald-400 text-[11px] font-medium whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Docker {overview.serverVersion}
          </span>
        )}
        {/* 搜索框仅容器视图显示 */}
        {view === 'containers' && (
          <div className="relative w-56">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('dk_search_placeholder')}
              className="h-7 pl-8 text-xs"
            />
          </div>
        )}
        <div className="flex-1 min-w-2" />
        {/* 容器视图：列表/卡片切换 */}
        {view === 'containers' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 gap-1 text-xs"
            onClick={() => setViewMode(viewMode === 'card' ? 'list' : 'card')}
            title={viewMode === 'card' ? t('dk_switch_list') : t('dk_switch_card')}
          >
            {viewMode === 'card' ? <List className="h-3.5 w-3.5" /> : <LayoutGrid className="h-3.5 w-3.5" />}
            {viewMode === 'card' ? t('dk_list_view') : t('dk_card_view')}
          </Button>
        )}
        {/* 镜像视图操作：清理悬空 / 拉取（主操作实心）/ 运行 */}
        {view === 'images' && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setPendingPruneImages(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('docker_image_prune')}
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setPullDialog({ image: '', pulling: false })}
            >
              <Download className="h-3.5 w-3.5" />
              {t('docker_pull_title')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setSaveLoadDialog({ mode: 'save', selected: [], remotePath: '', result: '', loading: false, progress: null, localFile: null })}
            >
              <Save className="h-3.5 w-3.5" />
              {t('docker_image_save')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setSaveLoadDialog({ mode: 'load', selected: [], imageRef: '', remotePath: '', result: '', loading: false, progress: null, localFile: null })}
            >
              <Upload className="h-3.5 w-3.5" />
              {t('docker_image_load')}
            </Button>
          </>
        )}
        {/* 网络视图操作 */}
        {view === 'networks' && (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setPendingPruneNetworks(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('docker_network_prune')}
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setCreateNetworkDialog({ name: '', driver: 'bridge', subnet: '', gateway: '' })}
            >
              <Plus className="h-3.5 w-3.5" />
              {t('docker_network_create')}
            </Button>
          </>
        )}
        {/* 卷视图操作 */}
        {view === 'volumes' && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => setPendingPruneVolumes(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('docker_volume_prune')}
          </Button>
        )}
        {/* 总览视图：磁盘占用分析入口 */}
        {view === 'overview' && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={openDfModal}
          >
            <HardDrive className="h-3.5 w-3.5" />
            {t('dk_df_title')}
          </Button>
        )}
        {/* 镜像视图：私有仓库登录 */}
        {view === 'images' && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => {
              setLoginDialog({ registry: '', username: '', password: '', running: false, loggedRegistries: null })
              // 读取服务器 ~/.docker/config.json 的 auths 键：显示当前已登录仓库
              sshService.execute(serverId, 'cat ~/.docker/config.json 2>/dev/null').then((r) => {
                const list: { registry: string; tokenBased: boolean }[] = []
                if (r.exitCode === 0 && r.stdout.trim()) {
                  try {
                    const cfg = JSON.parse(r.stdout) as { auths?: Record<string, unknown> }
                    for (const [reg, v] of Object.entries(cfg.auths || {})) {
                      list.push({
                        registry: reg,
                        tokenBased: typeof v === 'object' && v !== null && 'identityToken' in v,
                      })
                    }
                  } catch { /* 配置损坏时按无登录处理 */ }
                }
                setLoginDialog((p) => (p ? { ...p, loggedRegistries: list } : p))
              }).catch(() => setLoginDialog((p) => (p ? { ...p, loggedRegistries: [] } : p)))
            }}
          >
            <Info className="h-3.5 w-3.5" />
            {t('dk_login_title')}
          </Button>
        )}
        {/* Compose 视图：新建项目 / 导入已有项目 / docker run 转换 */}
        {view === 'compose' && (
          <>
            <Button
              variant="default"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setCreateDialog({
                name: '', dir: '/opt/stacks/', dirTouched: false, yaml: `services:
  web:
    image: nginx:latest
    ports:
      - "8080:80"
`, creating: false,
              })}
            >
              <Layers className="h-3.5 w-3.5" />
              {t('dk_compose_create')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setImportDialog({
                dirsText: '', scanning: false, previews: [], selected: new Set(), importing: false,
              })}
            >
              <FolderInput className="h-3.5 w-3.5" />
              {t('dk_compose_import')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setConvertDialog({
                runCmd: '', name: '', dir: '/opt/stacks/', dirTouched: false, creating: false,
              })}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t('dk_compose_convert')}
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={handleRefresh} disabled={currentLoading}>
          <RefreshCw className={cn('h-3.5 w-3.5', currentLoading && 'animate-spin')} />
          {t('dk_refresh')}
        </Button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/10 border-b border-destructive/20 text-destructive text-xs">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="opacity-60 hover:opacity-100">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* 内容区域（左右 16px，与弹框标题栏对齐） */}
      <div className="flex-1 overflow-auto px-4">
        {/* === Overview 首页 === */}
        {view === 'overview' && (
          overviewLoading ? (
            <CardsSkeleton />
          ) : (
            <div className="py-4 space-y-4">
              {/* 资源指标卡（点击跳转对应视图） */}
              {overview && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <OverviewCard
                    label={t('docker_view_containers')}
                    value={overview.containersTotal}
                    sub={`${overview.containersRunning} ${t('dk_ov_running')} · ${overview.containersPaused} ${t('dk_ov_paused')} · ${overview.containersStopped} ${t('dk_ov_stopped')}`}
                    icon={<Container className="h-3.5 w-3.5" />}
                    onClick={() => setView('containers')}
                    footer={overview.containersTotal > 0 ? (
                      /* 三色占比条：运行=绿 / 暂停=黄 / 停止=灰 */
                      <div className="mt-2 flex h-1.5 rounded-full overflow-hidden bg-muted">
                        <div className="bg-emerald-500" style={{ width: `${(overview.containersRunning / overview.containersTotal) * 100}%` }} />
                        <div className="bg-amber-500" style={{ width: `${(overview.containersPaused / overview.containersTotal) * 100}%` }} />
                        <div className="bg-zinc-400" style={{ width: `${(overview.containersStopped / overview.containersTotal) * 100}%` }} />
                      </div>
                    ) : undefined}
                  />
                  <OverviewCard
                    label={t('docker_view_images')}
                    value={overview.images}
                    icon={<Package className="h-3.5 w-3.5" />}
                    onClick={() => setView('images')}
                  />
                  <OverviewCard
                    label={t('docker_view_volumes')}
                    value={overview.volumes}
                    icon={<HardDrive className="h-3.5 w-3.5" />}
                    onClick={() => setView('volumes')}
                  />
                  <OverviewCard
                    label={t('docker_view_networks')}
                    value={overview.networks}
                    icon={<Network className="h-3.5 w-3.5" />}
                    onClick={() => setView('networks')}
                  />
                </div>
              )}

              {/* 异常容器：restarting / dead（点击进入 Stats 排查） */}
              {(() => {
                const abnormal = containers.filter(c => c.state === 'restarting' || c.state === 'dead')
                if (abnormal.length === 0) return null
                return (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-amber-400 mb-2">
                      <X className="h-3.5 w-3.5" />
                      {t('dk_ov_abnormal')} ({abnormal.length})
                    </div>
                    <div className="space-y-1">
                      {abnormal.map(c => (
                        <button
                          key={c.id}
                          className="flex items-center justify-between w-full text-left text-xs px-2.5 py-1.5 rounded-md hover:bg-accent/50 transition-colors"
                          onClick={() => openStatsModal(c)}
                        >
                          <span className="font-medium truncate">{c.name}</span>
                          <span className="text-[10px] text-muted-foreground flex-shrink-0 font-mono">{c.status}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })()}

              {/* 运行中容器资源 Top 5（按 CPU 排序，升级精致微表格与进度指示） */}
              {(containerStats.length > 0 || statsLoading) && (
                <div className="rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-xs">
                  <div className="text-xs font-semibold text-foreground mb-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Cpu className="h-3.5 w-3.5 text-primary" />
                      <span>{t('dk_ov_top_cpu')}</span>
                    </div>
                    {statsLoading ? (
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-normal">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        <span>{t('dk_stats_sampling')}</span>
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground font-mono">Top 5 by CPU</span>
                    )}
                  </div>
                  {containerStats.length > 0 ? (
                    <div className="space-y-1">
                      {[...containerStats].sort((a, b) => b.cpu - a.cpu).slice(0, 5).map(row => {
                        const c = containers.find(cc => cc.name === row.name)
                        const cpuPercent = Math.min(100, Math.max(0, row.cpu))
                        return (
                          <button
                            key={row.name}
                            className="group flex items-center justify-between w-full text-left text-xs px-2.5 py-1.5 rounded-lg border border-border/30 bg-muted/20 hover:bg-accent/50 hover:border-border/60 transition-all gap-3"
                            onClick={() => c && openStatsModal(c)}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                              <span className="font-medium text-foreground truncate">{row.name}</span>
                            </div>
                            {/* CPU 进度条与数值 */}
                            <div className="flex items-center gap-2 w-32 shrink-0">
                              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all duration-300",
                                    cpuPercent > 80 ? "bg-red-500" : cpuPercent > 50 ? "bg-amber-500" : "bg-primary"
                                  )}
                                  style={{ width: `${cpuPercent}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-mono text-muted-foreground w-12 text-right">
                                {row.cpu.toFixed(1)}%
                              </span>
                            </div>
                            <span className="text-[10px] font-mono text-muted-foreground/80 flex-shrink-0 w-24 text-right">
                              {t('dk_mem')} {row.memUsed}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    /* 首次采样占位 */
                    <div className="space-y-2 pt-1">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="flex items-center justify-between px-2 py-1.5">
                          <div className="h-3 w-28 bg-muted rounded animate-pulse" />
                          <div className="h-2.5 w-16 bg-muted rounded animate-pulse" />
                          <div className="h-2.5 w-20 bg-muted rounded animate-pulse" />
                        </div>
                      ))}
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-1 px-2">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        {t('dk_stats_sampling')}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 空态：docker 可用但没有任何容器 */}
              {overview && overview.containersTotal === 0 && (
                <EmptyState icon={<Container className="h-6 w-6" />} title={t('dk_ov_empty')} />
              )}
            </div>
          )
        )}

        {view === 'containers' && (
        <>
        {loading ? (
          /* === 加载骨架屏 === */
          viewMode === 'list' ? (
            <ListSkeleton rows={6} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="animate-pulse h-[112px] bg-muted rounded-xl" />
              ))}
            </div>
          )
        ) : filteredContainers.length === 0 ? (
          <EmptyState
            icon={<Container className="h-6 w-6" />}
            title={searchQuery ? t('dk_no_match') : t('dk_empty')}
          />
        ) : viewMode === 'list' ? (
          /* === 列表视图 === */
          <div className="my-2 rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
            {/* 批量操作工具栏：有选中项时出现 */}
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40 bg-accent/30 flex-wrap">
                <span className="text-xs font-medium text-foreground">{t('dk_batch_selected').replace('{n}', String(selectedIds.size))}</span>
                <div className="flex-1" />
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={actionLoading === 'batch'} onClick={() => runBatch('start')}>
                  {actionLoading === 'batch' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} {t('dk_start')}
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" disabled={actionLoading === 'batch'} onClick={() => runBatch('stop')}>
                  <Square className="h-3 w-3" /> {t('dk_stop')}
                </Button>
                <Button variant="destructive" size="sm" className="h-7 text-xs gap-1" disabled={actionLoading === 'batch'} onClick={() => setPendingBatchDelete(true)}>
                  <Trash2 className="h-3 w-3" /> {t('docker_container_delete')}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" disabled={actionLoading === 'batch'} onClick={() => setSelectedIds(new Set())}>
                  <X className="h-3 w-3" /> {t('common_cancel')}
                </Button>
              </div>
            )}
            {/* 横向滚动：窄容器下列宽不再压缩（容器名可读），整表左右滑动查看 */}
            <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[880px]">
            <thead className="workspace-table-head">
              <tr className="text-left text-muted-foreground/70">
                <th className="px-3 py-2.5 w-8">
                  <input
                    type="checkbox"
                    className="accent-primary cursor-pointer"
                    checked={filteredContainers.length > 0 && filteredContainers.every(c => selectedIds.has(c.id))}
                    onChange={(e) => {
                      setSelectedIds(e.target.checked ? new Set(filteredContainers.map(c => c.id)) : new Set())
                    }}
                  />
                </th>
                <th className="px-4 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('dk_th_name')}</th>
                <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('dk_th_image')}</th>
                <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('dk_th_status')}</th>
                <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('dk_th_ports')}</th>
                <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('dk_th_created')}</th>
                <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase w-10 text-right">{t('dk_th_action')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredContainers.map((c) => (
                <tr
                  key={c.id}
                  className={cn(
                    "border-b border-border/30 hover:bg-muted/30 transition-all duration-200 cursor-default group",
                    selectedIds.has(c.id) && "bg-primary/5"
                  )}
                  onContextMenu={(e) => handleContextMenu(e, c)}
                >
                  <td className="px-3 py-3 w-8" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="accent-primary cursor-pointer"
                      checked={selectedIds.has(c.id)}
                      onChange={() => setSelectedIds(prev => {
                        const next = new Set(prev)
                        if (next.has(c.id)) next.delete(c.id)
                        else next.add(c.id)
                        return next
                      })}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium min-w-[210px] max-w-[320px] truncate" title={c.name}>
                    <div className="flex items-center gap-2.5">
                      <div className={cn(
                        "p-1.5 rounded-lg flex-shrink-0 transition-colors duration-300",
                        c.state === 'running' ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground"
                      )}>
                        <Container className="h-4 w-4" />
                      </div>
                      <div className="flex items-center gap-1.5 min-w-0 truncate">
                        <span className="truncate font-semibold text-foreground text-[13px]">{c.name}</span>
                        <span className="text-[11px] text-muted-foreground/60 font-mono flex-shrink-0">({c.id.slice(0, 12)})</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 min-w-[170px] max-w-[260px] truncate" title={c.image}>
                    <span className="truncate font-mono text-[11px] text-foreground/85 block max-w-full">
                      {c.image}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 w-[100px] whitespace-nowrap">
                    <StatusBadge state={c.state} status={c.status} />
                  </td>
                  <td className="px-3 py-2.5 min-w-[130px]">
                    {parseHostPorts(c.ports).length > 0 ? (
                      <div className="flex items-center gap-1.5 flex-wrap max-w-[220px]">
                        {parseHostPorts(c.ports).map(p => (
                          <span key={p} className="inline-flex items-center font-mono text-[10px] text-muted-foreground bg-muted/50 border border-border/60 rounded-md overflow-hidden hover:border-primary/40 hover:text-foreground transition-colors">
                            <button
                              className="px-1.5 py-0.5 hover:bg-accent/60 transition-colors"
                              title={t('dk_port_copy')}
                              onClick={() => {
                                navigator.clipboard.writeText(`${serverHost}:${p}`)
                                toast.success(`${serverHost}:${p} ✓`)
                              }}
                            >
                              {p}
                            </button>
                            <button
                              className="px-1 py-0.5 border-l border-border/50 hover:bg-primary/10 hover:text-primary transition-colors"
                              title={t('dk_port_open')}
                              onClick={() => window.open(`http://${serverHost}:${p}`, '_blank', 'noopener')}
                            >
                              <ExternalLink className="h-2.5 w-2.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="font-mono text-[10px] text-muted-foreground/60 block truncate max-w-full" title={c.ports || '-'}>
                        {c.ports || '-'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground text-[10px] font-medium whitespace-nowrap" title={c.createdAt || '-'}>
                    {c.createdAt || '-'}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={(e) => handleDropdownClick(e, c)}
                      title={t('dk_more')}
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </div>
          ) : (
          /* === 卡片视图 === */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
            {filteredContainers.map((c) => {
              const isRunning = c.state === 'running'
              return (
                <div
                  key={c.id}
                  className={cn(
                    "relative rounded-xl border bg-card p-3.5 shadow-sm hover:shadow-md transition-all duration-300 cursor-default group flex flex-col justify-between h-[112px]",
                    isRunning
                      ? "border-emerald-500/20 hover:border-emerald-500/40 hover:bg-emerald-500/[0.01]"
                      : "border-border/60 hover:border-muted-foreground/20 hover:bg-muted/[0.01]"
                  )}
                  onContextMenu={(e) => handleContextMenu(e, c)}
                >
                  <div className="flex flex-col min-w-0">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn(
                          "p-1.5 rounded-lg flex-shrink-0 transition-colors duration-300",
                          isRunning ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground"
                        )}>
                          <Container className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-semibold text-xs text-foreground truncate max-w-[110px]" title={c.name}>{c.name}</span>
                            <span className="text-[11px] text-muted-foreground/60 font-mono">({c.id.slice(0, 12)})</span>
                          </div>
                        </div>
                      </div>
                      <button
                        className="text-foreground/50 hover:text-foreground flex-shrink-0"
                        onClick={(e) => handleDropdownClick(e, c)}
                        title={t('dk_more')}
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Subtitle: Image */}
                    <div className="mt-1.5 text-[10px] text-muted-foreground truncate font-mono bg-muted/40 border border-border/30 px-1.5 py-0.5 rounded w-fit max-w-full" title={c.image}>
                      {c.image}
                    </div>

                    {/* Mid Info: Status & Ports */}
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <StatusBadge state={c.state} status={c.status} />
                      <span className="font-mono text-[11px] text-muted-foreground bg-accent/40 border border-border/40 px-1.5 py-0.5 rounded truncate max-w-[130px]" title={c.ports || t('dk_no_ports')}>
                        {c.ports || '-'}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        </>
        )}

        {/* === 镜像列表 === */}
        {view === 'images' && (
          imagesLoading ? (
            <ListSkeleton rows={6} />
          ) : images.length === 0 ? (
            <EmptyState
              icon={<Package className="h-6 w-6" />}
              title={t('docker_no_images')}
              action={(
                <Button size="sm" className="h-7 text-xs gap-1" onClick={() => setPullDialog({ image: '', pulling: false })}>
                  <Download className="h-3.5 w-3.5" />
                  {t('docker_pull_title')}
                </Button>
              )}
            />
          ) : (
            <div className="my-2 rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[760px]">
              <thead className="workspace-table-head">
                <tr className="text-left text-muted-foreground/70">
                  <th className="px-4 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('docker_image_repository')}</th>
                  <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('docker_image_tag')}</th>
                  <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('docker_image_id')}</th>
                  <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('docker_image_status')}</th>
                  <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('docker_image_created')}</th>
                  <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('docker_image_size')}</th>
                  <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase w-20 text-right">{t('dk_th_action')}</th>
                </tr>
              </thead>
              <tbody>
                {images.map((img) => {
                  // 镜像状态分类（统一 StatusPill 色系）：
                  // - 运行中（被运行中容器引用）：绿
                  // - 已停止（被容器引用但无运行中）：黄
                  // - 悬空（dangling：<none> tag）：红
                  // - 未使用（无容器引用，正常 tag）：默认/灰
                  const isRunning = img.usedByRunning
                  const isStopped = img.inUse && !img.usedByRunning
                  const isDangling = img.dangling
                  const rowBg = isRunning
                    ? 'bg-emerald-500/[0.04] hover:bg-emerald-500/10'
                    : isStopped
                    ? 'bg-amber-500/[0.04] hover:bg-amber-500/10'
                    : isDangling
                    ? 'bg-rose-500/[0.04] hover:bg-rose-500/10'
                    : 'hover:bg-muted/30'
                  const badge: { tone: PillTone; label: string; pulse?: boolean } = isRunning
                    ? { tone: 'emerald', pulse: true, label: t('docker_image_status_running') }
                    : isStopped
                    ? { tone: 'amber', label: t('docker_image_status_stopped') }
                    : isDangling
                    ? { tone: 'rose', label: t('docker_image_status_dangling') }
                    : { tone: 'zinc', label: t('docker_image_status_unused') }
                  return (
                    <tr key={`${img.repository}:${img.tag}:${img.id}`} className={cn('border-b border-border/30 transition-all duration-200 group', rowBg)}>
                      <td className="px-4 py-3 font-medium min-w-[200px] max-w-[320px] truncate" title={img.repository}>
                        <span className={cn('truncate font-mono text-[11px]', isDangling && 'text-muted-foreground italic')}>{img.repository}</span>
                      </td>
                      <td className="px-3 py-3 min-w-[110px] truncate">
                        <span className={cn(
                          'font-mono text-[10px] border px-2 py-0.5 rounded',
                          isDangling
                            ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                            : 'bg-muted/60 border-border/30 text-muted-foreground'
                        )}>{img.tag}</span>
                      </td>
                      <td className="px-3 py-3 font-mono text-[10px] text-muted-foreground">{img.id.slice(0, 12)}</td>
                      <td className="px-3 py-3">
                        <StatusPill tone={badge.tone} label={badge.label} pulse={badge.pulse} />
                      </td>
                      <td className="px-3 py-3 text-muted-foreground text-[10px]">{img.createdSince}</td>
                      <td className="px-3 py-3 text-muted-foreground text-[10px]">{img.size}</td>
                      <td className="px-3 py-3 text-right w-10">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => openImageInspect(img)}
                            title={t('docker_image_inspect')}
                          >
                            <Info className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="text-emerald-400 hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed"
                            onClick={() => setRunDialog({
                              // 默认容器名 = 镜像名（用户可改）
                              name: img.dangling ? '' : defaultContainerName(img.repository),
                              image: img.dangling ? img.id : `${img.repository}:${img.tag}`,
                              ports: '', volumes: '', env: '', restart: 'unless-stopped', network: '', running: false, editId: null,
                            })}
                            disabled={img.dangling}
                            title={t('docker_run_title')}
                          >
                            <Play className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => setPendingDeleteImage(img)}
                            title={t('docker_image_delete')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </div>
          )
        )}

        {/* === 网络列表 === */}
        {view === 'networks' && (
          networksLoading ? (
            <ListSkeleton rows={5} />
          ) : networks.length === 0 ? (
            <EmptyState icon={<Network className="h-6 w-6" />} title={t('docker_no_networks')} />
          ) : (
            <div className="my-2 rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[560px]">
              <thead className="workspace-table-head">
                <tr className="text-left text-muted-foreground/70">
                  <th className="px-4 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('docker_network_name')}</th>
                  <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('docker_network_driver')}</th>
                  <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('docker_network_scope')}</th>
                  <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase w-20 text-right">{t('dk_th_action')}</th>
                </tr>
              </thead>
              <tbody>
                {networks.map((n) => {
                  // 内置网络（bridge/host/none）不可删除，按钮禁用并提示
                  const isBuiltin = ['bridge', 'host', 'none'].includes(n.name)
                  return (
                    <tr key={n.name} className="border-b border-border/30 hover:bg-muted/30 transition-all duration-200 group">
                      <td className="px-4 py-3 font-medium min-w-[200px] max-w-[320px] truncate font-mono text-[11px]" title={n.name}>{n.name}</td>
                      <td className="px-3 py-3 font-mono text-[10px] text-muted-foreground">{n.driver}</td>
                      <td className="px-3 py-3 font-mono text-[10px] text-muted-foreground">{n.scope}</td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            className="text-muted-foreground hover:text-foreground"
                            onClick={() => openNetworkInspect(n)}
                            title={t('docker_network_inspect')}
                          >
                            <Info className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground disabled:cursor-not-allowed"
                            onClick={() => handleNetworkDeleteClick(n)}
                            disabled={isBuiltin || actionLoading === `netrm-${n.name}`}
                            title={isBuiltin ? t('docker_builtin_network_hint') : t('docker_network_delete')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </div>
          )
        )}

        {/* === 卷列表 === */}
        {view === 'volumes' && (
          volumesLoading ? (
            <ListSkeleton rows={5} />
          ) : volumes.length === 0 ? (
            <EmptyState icon={<HardDrive className="h-6 w-6" />} title={t('docker_no_volumes')} />
          ) : (
            <div className="my-2 rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[560px]">
              <thead className="workspace-table-head">
                <tr className="text-left text-muted-foreground/70">
                  <th className="px-4 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('docker_volume_name')}</th>
                  <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('docker_volume_driver')}</th>
                  <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase">{t('docker_compose_status')}</th>
                  <th className="px-3 py-2.5 font-medium tracking-wider text-[10px] uppercase w-20 text-right">{t('dk_th_action')}</th>
                </tr>
              </thead>
              <tbody>
                {volumes.map((v) => (
                  <tr key={v.name} className={cn('border-b border-border/30 transition-all duration-200 group', v.dangling ? 'bg-rose-500/[0.04] hover:bg-rose-500/10' : 'hover:bg-muted/30')}>
                    <td className="px-4 py-3 font-medium max-w-[300px] truncate font-mono text-[11px]" title={v.name}>{v.name}</td>
                    <td className="px-3 py-3 font-mono text-[10px] text-muted-foreground">{v.driver}</td>
                    <td className="px-3 py-3">
                      <StatusPill
                        tone={v.dangling ? 'rose' : 'emerald'}
                        label={v.dangling ? t('docker_volume_dangling') : t('docker_volume_in_use')}
                      />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => openVolumeBrowse(v)}
                          title={t('docker_volume_browse')}
                        >
                          <Folder className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground disabled:cursor-not-allowed"
                          onClick={() => setPendingDeleteVolume(v)}
                          disabled={actionLoading === `volrm-${v.name}`}
                          title={t('docker_volume_delete')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
          )
        )}

        {/* === Compose 项目列表 === */}
        {view === 'compose' && (
          composeLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse h-10 bg-muted rounded" />
              ))}
            </div>
          ) : composeProjects.length === 0 ? (
            <EmptyState icon={<Layers className="h-6 w-6" />} title={t('docker_no_compose')} />
          ) : (
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {composeProjects.map((p) => {
                // 拆分后每项只有一个 configFile，用其作为唯一 key（同项目多文件不冲突）
                const itemKey = p.configFile || p.name
                const upKey = `compose-up-${itemKey}`
                const editKey = `compose-edit-${itemKey}`
                // 任一部署流执行中锁整卡（防 up/down 竞争）；actionLoading 兜底编辑等操作
                const busy = deployModal?.running === true ||
                  [upKey, editKey].includes(actionLoading || '')
                return (
                  <div
                    key={itemKey}
                    className="group rounded-xl border border-border/60 bg-card/50 p-3.5 hover:border-primary/30 transition-colors flex flex-col gap-3"
                  >
                    {/* 头部：展开/折叠 + 图标 + 名称/路径 + 状态徽章 */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {/* 折叠/展开按钮：展开后展示 services 子表 */}
                        <button
                          className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                          onClick={() => toggleComposeExpanded(p)}
                          title={expandedCompose.has(p.configFile || p.name) ? t('dk_compose_collapse') : t('dk_compose_expand')}
                        >
                          {expandedCompose.has(p.configFile || p.name)
                            ? <ChevronDown className="h-3.5 w-3.5" />
                            : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                        <div className="p-1.5 rounded-lg flex-shrink-0 bg-blue-500/10 text-blue-400">
                          <Layers className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-foreground text-[13px]" title={p.name}>{p.name}</div>
                          {p.configFile && (
                            <div className="text-[11px] text-muted-foreground font-mono truncate" title={p.configFile}>{p.configFile}</div>
                          )}
                        </div>
                      </div>
                      {!p.status ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap bg-muted/40 text-muted-foreground/70 border-border/40 flex-shrink-0">
                          <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                          {t('dk_loading')}
                        </span>
                      ) : (
                        <StatusPill
                          tone={/unknown/i.test(p.status) ? 'amber' : /running/i.test(p.status) ? 'emerald' : 'zinc'}
                          label={p.status && p.status.trim() ? p.status : t('dk_compose_stopped')}
                        />
                      )}
                    </div>

                    {/* 操作区：Logs（运维最高频，排绝对首位）→ 生命周期组 → 工具组
                        Logs 是排查第一入口（约 40% 操作），置于最前减少点击距离；
                        Build→Up→Restart→Down 按实际操作时序排列，彩色区分阶段；
                        Edit/更多 用中性色；Start/Stop/Pull 收进「更多」，
                        避免 Up/Down 与 Start/Stop 图标雷同难辨 */}
                    <div className="flex items-center gap-0.5 pt-2.5 border-t border-border/40">
                      {/* Logs：运维排查第一入口，最高频，绝对首位 */}
                      <button
                        className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={() => handleComposeLogs(p)}
                        disabled={busy}
                        title={t('docker_compose_logs')}
                      >
                        <FileText className="h-4 w-4" />
                      </button>
                      <div className="w-px h-5 bg-border/60 mx-1.5 flex-shrink-0" />
                      {/* Build：先编译镜像（有 build context 的项目是 up 的前置步骤） */}
                      <button
                        className="p-2 rounded-md hover:bg-accent text-violet-400 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={() => handleComposeAction('build', p)}
                        disabled={busy}
                        title={t('docker_compose_build')}
                      >
                        <Hammer className="h-4 w-4" />
                      </button>
                      <button
                        className="p-2 rounded-md hover:bg-accent text-emerald-400 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={() => handleComposeUp(p)}
                        disabled={busy}
                        title={t('docker_compose_up')}
                      >
                        <Play className="h-4 w-4" />
                      </button>
                      <button
                        className="p-2 rounded-md hover:bg-accent text-sky-400 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={() => handleComposeAction('restart', p)}
                        disabled={busy}
                        title={t('docker_compose_restart')}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button
                        className="p-2 rounded-md hover:bg-accent text-amber-400 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={() => handleComposeDown(p)}
                        disabled={busy}
                        title={t('docker_compose_down')}
                      >
                        <Square className="h-4 w-4" />
                      </button>
                      <div className="w-px h-5 bg-border/60 mx-1.5 flex-shrink-0" />
                      {/* Edit：改配置 */}
                      <button
                        className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ml-auto"
                        onClick={() => handleComposeEdit(p)}
                        disabled={busy}
                        title={t('docker_compose_edit')}
                      >
                        {actionLoading === editKey ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Pencil className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={(e) => {
                          e.stopPropagation()
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          setComposeMenu({ x: rect.right - 170, y: rect.bottom + 4, project: p })
                        }}
                        disabled={busy}
                        title={t('dk_more')}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </div>
                    {/* Service 级视图：展开后显示 project 下 services 列表，每行 logs/restart */}
                    {expandedCompose.has(p.configFile || p.name) && (
                      <div className="mt-2.5 pt-2.5 border-t border-border/40 space-y-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
                          {t('docker_compose_services')}
                        </div>
                        {(() => {
                          const key = p.configFile || p.name
                          const cache = composeServicesCache[key]
                          if (!cache || cache.loading) {
                            return (
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-2">
                                <Loader2 className="h-3 w-3 animate-spin" /> {t('dk_loading')}
                              </div>
                            )
                          }
                          if (cache.error) {
                            return <div className="text-[11px] text-destructive py-1">{cache.error}</div>
                          }
                          if (cache.services.length === 0) {
                            return (
                              <div className="text-[11px] text-muted-foreground py-1">
                                {t('docker_compose_services_empty')}
                              </div>
                            )
                          }
                          return cache.services.map((s) => {
                            const stateLower = s.state.toLowerCase()
                            const tone = /running|healthy/.test(stateLower)
                              ? 'emerald'
                              : /exited|dead/.test(stateLower)
                              ? 'rose'
                              : 'zinc'
                            return (
                              <div
                                key={s.name + (s.containerId || '')}
                                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-muted/30 group"
                              >
                                <Container className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                <span className="font-mono text-[12px] truncate flex-1" title={s.name}>
                                  {s.name}
                                </span>
                                <StatusPill tone={tone} label={s.state} />
                                <button
                                  className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => handleServiceLogs(p, s.name)}
                                  title={t('docker_compose_logs')}
                                >
                                  <FileText className="h-3 w-3" />
                                </button>
                                {s.containerId && (
                                  <button
                                    className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={async () => {
                                      try {
                                        const r = await sshService.execute(
                                          serverId,
                                          `docker restart ${shellQuote(s.containerId)}`,
                                        )
                                        if (r.exitCode !== 0) throw new Error(r.stderr || r.stdout)
                                        toast.success(`${s.name} ✓`)
                                        // 重启后刷新 services
                                        toggleComposeExpanded(p)
                                      } catch (err) {
                                        toast.error(err instanceof Error ? err.message : t('dk_err_action'))
                                      }
                                    }}
                                    title={t('docker_compose_restart')}
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            )
                          })
                        })()}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>

      {/* === 右键菜单 / 下拉菜单（Portal 渲染，避免层叠上下文问题） === */}
      {ctxMenu && createPortal(renderMenu(ctxMenu.container, ctxMenu.x, ctxMenu.y), document.body)}
      {dropdownId && activeMenuContainer && createPortal(
        renderMenu(activeMenuContainer, dropdownPos.current.x, dropdownPos.current.y),
        document.body
      )}
      {composeMenu && createPortal(
        renderComposeMenu(composeMenu.x, composeMenu.y, composeMenu.project),
        document.body
      )}

      <DockerContainerDetailModal
        modal={modal}
        onClose={closeModal}
        onSwitchTab={switchDetailTab}
        logsLoading={logsLoading}
        logsPollingFailed={logsPollingFailed}
        logSearchQuery={logSearchQuery}
        setLogSearchQuery={setLogSearchQuery}
        logFilterError={logFilterError}
        setLogFilterError={setLogFilterError}
        logWrapLines={logWrapLines}
        setLogWrapLines={setLogWrapLines}
        logsPaused={logsPaused}
        onToggleLogsPaused={() => {
          logsPausedRef.current = !logsPausedRef.current;
          setLogsPaused(logsPausedRef.current);
        }}
        filteredLogs={filteredLogs}
        logLines={logLines}
        logVirtualizer={logVirtualizer}
        logsScrollRef={logsScrollRef}
        logsStickBottomRef={logsStickBottomRef}
        onClearLogsView={() => {
          setLogsData('');
          logsLineBufRef.current = '';
        }}
        inspectSearchQuery={inspectSearchQuery}
        setInspectSearchQuery={setInspectSearchQuery}
        inspectFilterLines={inspectFilterLines}
        setInspectFilterLines={setInspectFilterLines}
        inspectCopied={inspectCopied}
        onCopyInspect={() => {
          navigator.clipboard.writeText(inspectData);
          setInspectCopied(true);
          if (inspectCopyTimerRef.current) clearTimeout(inspectCopyTimerRef.current);
          inspectCopyTimerRef.current = setTimeout(() => setInspectCopied(false), 2000);
        }}
        inspectTab={inspectTab}
        setInspectTab={setInspectTab}
        inspectData={inspectData}
        filteredInspect={filteredInspect}
        statsCurrent={statsCurrent}
        statsHistory={statsHistory}
        statsError={statsError}
        onRetryStats={() => {
          setStatsError(null);
          statsRefreshRef.current?.();
        }}
        filesPath={filesPath}
        filesLoading={filesLoading}
        filesError={filesError}
        filesList={filesList}
        actionLoading={actionLoading}
        onNavigateFiles={(path) => {
          if (modal?.container) fetchFiles(modal.container, path);
        }}
        onRefreshFiles={() => {
          if (modal?.container) fetchFiles(modal.container, filesPath);
        }}
        onFileUpload={handleFileUpload}
        onOpenHostPicker={() => setHostPickerOpen(true)}
        onFileDownload={handleFileDownload}
        onPromptFileDelete={setPendingFileDelete}
      />

      {/* === Exec 内嵌终端（自动探测 /bin/sh → /bin/bash，无需用户选择） === */}
      {execTerminal && (
        <Dialog open onOpenChange={(open) => { if (!open) setExecTerminal(null) }}>
          <DialogContent showCloseButton={false} className="w-[96vw] max-w-5xl h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60">
              <div className="flex items-center gap-2 min-w-0">
                <Terminal className="h-4 w-4 text-primary flex-shrink-0" />
                <span className="font-medium text-sm truncate">{t('dk_exec_title')} - {execTerminal.container.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground bg-accent/40 border border-border/50 px-1.5 py-0.5 rounded flex-shrink-0">
                  {execTerminal.shell}
                </span>
              </div>
              <button className="p-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-accent transition-colors" onClick={() => setExecTerminal(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* 内嵌 xterm：initialCommand 在会话就绪后自动发送 docker exec -it */}
            <div className="flex-1 min-h-0 bg-black overflow-hidden">
              <TerminalModule
                serverId={serverId}
                isActive
                isConnected={isConnected}
                initialCommand={`docker exec -it ${execTerminal.container.id} ${execTerminal.shell}`}
                isSplitPane
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
      {/* === 危险操作（stop/restart）确认对话框 === */}
      <ConfirmDialog
        open={pendingAction !== null}
        title={t('common_confirm_title')}
        description={pendingAction
          ? `${pendingAction.action === 'stop' ? t('dk_stop') : t('dk_restart')} ${pendingAction.container.name}?`
          : ''}
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        variant={pendingAction?.action === 'stop' ? 'destructive' : 'default'}
        onConfirm={() => {
          if (pendingAction) {
            handleAction(pendingAction.container, pendingAction.action)
            setPendingAction(null)
          }
        }}
        onCancel={() => setPendingAction(null)}
      />

      {/* === 修改容器配置确认（保存会删旧容器同名重建） === */}
      <ConfirmDialog
        open={pendingConfigEdit !== null}
        title={t('dk_edit_config')}
        description={
          !pendingConfigEdit
            ? ''
            : pendingConfigEdit.state === 'running'
              ? `容器「${pendingConfigEdit.name}」正在运行。修改配置将删除并同名重建，期间服务会中断。是否继续？`
              : `修改配置将删除并重建容器「${pendingConfigEdit.name}」。是否继续？`
        }
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        variant="destructive"
        onConfirm={() => {
          const c = pendingConfigEdit
          setPendingConfigEdit(null)
          if (c) editContainerConfig(c)
        }}
        onCancel={() => setPendingConfigEdit(null)}
      />

      {/* === 删除容器确认对话框 === */}
      <ConfirmDialog
        open={pendingDeleteContainer !== null}
        title={t('docker_container_delete')}
        description={pendingDeleteContainer
          ? t('docker_container_delete_confirm')
            .replace('{name}', pendingDeleteContainer.container.name)
            .replace('{id}', pendingDeleteContainer.container.id.slice(0, 12))
            + (pendingDeleteContainer.force ? ` (${t('docker_container_force_delete')})` : '')
          : ''}
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        variant="destructive"
        // 执行期间锁定对话框，防止确认按钮重复点击并发删除
        pending={actionLoading === pendingDeleteContainer?.container.id}
        onConfirm={handleDeleteContainer}
        onCancel={() => setPendingDeleteContainer(null)}
      />

      {/* === 服务器（宿主机）文件选择：选中文件/目录后复制到容器当前目录 === */}
      <RemoteFilePicker
        open={hostPickerOpen}
        serverId={serverId}
        title={t('dk_files_host_copy')}
        onClose={() => setHostPickerOpen(false)}
        onConfirm={(paths) => void handleHostCopy(paths)}
      />

      {/* === 删除容器内文件/目录确认 === */}
      <ConfirmDialog
        open={pendingFileDelete !== null}
        title={t('dk_files_delete')}
        description={t('dk_files_delete_confirm').replace('{name}', pendingFileDelete?.name || '')}
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        variant="destructive"
        pending={actionLoading === `file-del-${pendingFileDelete?.name}`}
        onConfirm={handleFileDelete}
        onCancel={() => setPendingFileDelete(null)}
      />

      {/* === 批量删除确认对话框（rm -f 强删含运行中容器） === */}
      <ConfirmDialog
        open={pendingBatchDelete}
        title={t('docker_container_delete')}
        description={t('dk_batch_delete_confirm').replace('{n}', String(selectedIds.size))}
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        variant="destructive"
        pending={actionLoading === 'batch'}
        onConfirm={() => runBatch('remove')}
        onCancel={() => { if (actionLoading !== 'batch') setPendingBatchDelete(false) }}
      />

      {/* === 删除镜像确认对话框 === */}
      <ConfirmDialog
        open={pendingDeleteImage !== null}
        title={t('docker_image_delete')}
        description={pendingDeleteImage
          ? t('docker_image_delete_confirm').replace('{id}', pendingDeleteImage.id.slice(0, 19))
          : ''}
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        variant="destructive"
        onConfirm={handleDeleteImage}
        onCancel={() => setPendingDeleteImage(null)}
        pending={actionLoading === (pendingDeleteImage ? `rmi-${pendingDeleteImage.id}` : '')}
      />

      {/* === Compose down 确认对话框（down 停止并删除项目全部容器） === */}
      <ConfirmDialog
        open={pendingComposeDown !== null}
        title={t('docker_compose_down')}
        description={pendingComposeDown
          ? t('docker_compose_down_confirm').replace('{name}', pendingComposeDown.name)
          : ''}
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        variant="destructive"
        pending={actionLoading === (pendingComposeDown ? `compose-down-${pendingComposeDown.configFile || pendingComposeDown.name}` : '')}
        onConfirm={confirmComposeDown}
        onCancel={() => setPendingComposeDown(null)}
      />

      {/* === 删除网络确认 === */}
      <ConfirmDialog
        open={pendingDeleteNetwork !== null}
        title={t('docker_network_delete')}
        description={
          !pendingDeleteNetwork
            ? ''
            : pendingDeleteNetworkUsedBy > 0
              ? `网络「${pendingDeleteNetwork.name}」当前被 ${pendingDeleteNetworkUsedBy} 个容器使用，删除将导致这些容器断网。\n\n` + t('docker_network_delete_confirm').replace('{name}', pendingDeleteNetwork.name)
              : t('docker_network_delete_confirm').replace('{name}', pendingDeleteNetwork.name)
        }
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        variant="destructive"
        pending={actionLoading === (pendingDeleteNetwork ? `netrm-${pendingDeleteNetwork.name}` : '')}
        onConfirm={handleDeleteNetwork}
        onCancel={() => { setPendingDeleteNetwork(null); setPendingDeleteNetworkUsedBy(0) }}
      />

      {/* === 清理未使用网络确认 === */}
      <ConfirmDialog
        open={pendingPruneNetworks}
        title={t('docker_network_prune')}
        description={t('docker_network_prune_confirm')}
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        variant="destructive"
        pending={actionLoading === 'netprune'}
        onConfirm={handlePruneNetworks}
        onCancel={() => setPendingPruneNetworks(false)}
      />

      {/* === 删除卷确认 === */}
      <ConfirmDialog
        open={pendingDeleteVolume !== null}
        title={t('docker_volume_delete')}
        description={pendingDeleteVolume
          ? t('docker_volume_delete_confirm').replace('{name}', pendingDeleteVolume.name)
          : ''}
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        variant="destructive"
        pending={actionLoading === (pendingDeleteVolume ? `volrm-${pendingDeleteVolume.name}` : '')}
        onConfirm={handleDeleteVolume}
        onCancel={() => setPendingDeleteVolume(null)}
      />

      {/* === 清理未使用卷确认（危险：卷内数据不可恢复） === */}
      <ConfirmDialog
        open={pendingPruneVolumes}
        title={t('docker_volume_prune')}
        description={t('docker_volume_prune_confirm')}
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        variant="destructive"
        pending={actionLoading === 'volprune'}
        onConfirm={handlePruneVolumes}
        onCancel={() => setPendingPruneVolumes(false)}
      />

      {/* === 创建网络对话框 === */}
      <ConfirmDialog
        open={createNetworkDialog !== null}
        title={t('docker_network_create_title')}
        description=""
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        pending={actionLoading === 'netcreate'}
        onConfirm={handleNetworkCreate}
        onCancel={() => setCreateNetworkDialog(null)}
        widthClass="max-w-[460px]"
      >
        {createNetworkDialog && (
          <div className="space-y-2.5 text-left">
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">{t('docker_network_name_placeholder')} *</label>
              <Input className="h-8 text-xs font-mono" value={createNetworkDialog.name}
                onChange={(e) => setCreateNetworkDialog((p) => (p ? { ...p, name: e.target.value } : p))} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">{t('docker_network_driver')}</label>
                <select className="w-full h-8 px-2 rounded-md border border-border bg-background text-xs font-mono outline-none focus:ring-1 focus:ring-ring"
                  value={createNetworkDialog.driver}
                  onChange={(e) => setCreateNetworkDialog((p) => (p ? { ...p, driver: e.target.value } : p))}>
                  <option value="bridge">bridge</option>
                  <option value="overlay">overlay</option>
                  <option value="macvlan">macvlan</option>
                  <option value="ipvlan">ipvlan</option>
                  <option value="host">host</option>
                  <option value="none">none</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">{t('docker_network_gateway')}</label>
                <Input className="h-8 text-xs font-mono" placeholder="172.20.0.1" value={createNetworkDialog.gateway}
                  onChange={(e) => setCreateNetworkDialog((p) => (p ? { ...p, gateway: e.target.value } : p))} />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">{t('docker_network_subnet')}</label>
              <Input className="h-8 text-xs font-mono" placeholder="172.20.0.0/16" value={createNetworkDialog.subnet}
                onChange={(e) => setCreateNetworkDialog((p) => (p ? { ...p, subnet: e.target.value } : p))} />
            </div>
          </div>
        )}
      </ConfirmDialog>

      {/* === 网络详情模态框 === */}
      {networkInspectModal && (
        <Dialog open onOpenChange={(open) => { if (!open) setNetworkInspectModal(null) }}>
          <DialogContent showCloseButton={false} className="w-[90vw] max-w-2xl max-h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
              <div className="flex items-center gap-2 min-w-0">
                <Network className="h-4 w-4 text-primary shrink-0" />
                <span className="font-medium text-sm truncate">{networkInspectModal.name}</span>
              </div>
              <button className="p-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-accent transition-colors" onClick={() => setNetworkInspectModal(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">{t('docker_network_driver')}</span><div className="font-mono">{networkInspectModal.driver || '-'}</div></div>
                <div><span className="text-muted-foreground">{t('docker_network_scope')}</span><div className="font-mono">{networkInspectModal.scope || '-'}</div></div>
                <div><span className="text-muted-foreground">{t('docker_network_subnet')}</span><div className="font-mono">{networkInspectModal.subnet || '-'}</div></div>
                <div><span className="text-muted-foreground">{t('docker_network_gateway')}</span><div className="font-mono">{networkInspectModal.gateway || '-'}</div></div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{t('docker_container')}</span>
                <Button variant="outline" size="sm" className="h-6 gap-1 text-xs" onClick={openConnectPicker} disabled={networkInspectModal.connecting}>
                  <Cable className="h-3 w-3" />{t('docker_network_connect')}
                </Button>
              </div>
              {networkInspectModal.connectOpen ? (
                <div className="border border-border/60 rounded-md p-2 space-y-1 max-h-40 overflow-auto">
                  {networkInspectModal.containerOptions.length === 0 ? (
                    <div className="text-muted-foreground text-center py-2">{t('docker_network_connect_hint')}</div>
                  ) : networkInspectModal.containerOptions.map((c) => (
                    <button key={c.id} className="w-full text-left px-2 py-1 rounded hover:bg-accent font-mono text-[11px] flex items-center justify-between"
                      onClick={() => handleNetworkConnect(c.id)}>
                      <span className="truncate">{c.name}</span>
                      {actionLoading === `netconn-${c.id}` && <Loader2 className="h-3 w-3 animate-spin" />}
                    </button>
                  ))}
                </div>
              ) : networkInspectModal.containers.length === 0 ? (
                <div className="text-muted-foreground text-center py-2">{t('docker_network_no_containers')}</div>
              ) : (
                <div className="border border-border/60 rounded-md divide-y divide-border/40">
                  {networkInspectModal.containers.map((c) => (
                    <div key={c.name} className="flex items-center justify-between px-2 py-1.5">
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] truncate">{c.name}</div>
                        {c.ipv4 && <div className="text-[10px] text-muted-foreground font-mono">{c.ipv4}</div>}
                      </div>
                      <button className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                        onClick={() => handleNetworkDisconnect(c.name)} title={t('docker_network_disconnect')}>
                        <Unplug className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* === 卷内容浏览模态框 === */}
      {volumeBrowseModal && (
        <Dialog open onOpenChange={(open) => { if (!open) setVolumeBrowseModal(null) }}>
          <DialogContent showCloseButton={false} className="w-[90vw] max-w-xl max-h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
              <div className="flex items-center gap-2 min-w-0">
                <Folder className="h-4 w-4 text-primary shrink-0" />
                <span className="font-medium text-sm truncate">{volumeBrowseModal.name}</span>
                {volumeBrowseModal.subPath && <span className="text-[10px] text-muted-foreground font-mono truncate">/ {volumeBrowseModal.subPath}</span>}
              </div>
              <div className="flex items-center gap-1">
                {volumeBrowseModal.subPath && (
                  <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={() => openVolumeBrowse({ name: volumeBrowseModal.name, driver: '', dangling: false }, volumeBrowseModal.subPath.split('/').slice(0, -1).join('/'))}>
                    <ChevronLeft className="h-3 w-3" />{t('docker_back')}
                  </Button>
                )}
                <button className="p-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-accent transition-colors" onClick={() => setVolumeBrowseModal(null)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-3 text-xs font-mono">
              {volumeBrowseModal.error ? (
                <div className="text-destructive">{volumeBrowseModal.error}</div>
              ) : volumeBrowseModal.entries.length === 0 ? (
                <div className="text-muted-foreground text-center py-6">{t('docker_volume_browse_empty')}</div>
              ) : (
                <table className="w-full">
                  <tbody>
                    {volumeBrowseModal.entries.map((e) => (
                      <tr key={e.name} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer"
                        onClick={() => e.isDir && openVolumeBrowse({ name: volumeBrowseModal.name, driver: '', dangling: false }, volumeBrowseModal.subPath ? `${volumeBrowseModal.subPath}/${e.name}` : e.name)}>
                        <td className="py-1.5 px-2 w-5">{e.isDir ? <Folder className="h-3.5 w-3.5 text-primary" /> : <FileIcon className="h-3.5 w-3.5 text-muted-foreground" />}</td>
                        <td className="py-1.5 px-2 truncate">{e.name}</td>
                        <td className="py-1.5 px-2 text-muted-foreground text-right">{e.size}</td>
                        <td className="py-1.5 px-2 text-muted-foreground text-right whitespace-nowrap">{e.mtime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* === 镜像导出 / 导入对话框 === */}
      <ConfirmDialog
        open={saveLoadDialog !== null}
        title={saveLoadDialog?.mode === 'load' ? t('docker_image_load_title') : t('docker_image_save_title')}
        description={saveLoadDialog?.mode === 'load' ? t('docker_image_load_desc') : t('docker_image_save_desc')}
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        pending={saveLoadDialog?.loading === true}
        onConfirm={saveLoadDialog?.mode === 'load' ? handleImageLoad : handleImageSave}
        onCancel={cancelTransfer}
        allowCancelWhilePending
        widthClass="max-w-[460px]"
      >
        {saveLoadDialog && (
          <div className="space-y-2.5 text-left">
            {saveLoadDialog.mode === 'save' ? (
              <>
                <label className="text-[10px] text-muted-foreground mb-1 block">{t('docker_image_save_select')}</label>
                {(() => {
                  const allRefs = images.map((img) => img.repository === '<none>' ? img.id : `${img.repository}:${img.tag}`)
                  const allSelected = allRefs.length > 0 && allRefs.every((r) => saveLoadDialog.selected.includes(r))
                  const someSelected = allRefs.some((r) => saveLoadDialog.selected.includes(r))
                  return (
                    <div className="border border-border/60 rounded-md overflow-hidden">
                      <label className="flex items-center gap-2 px-2 py-1 border-b border-border/60 bg-muted/30 text-xs cursor-pointer select-none">
                        <input type="checkbox" className="h-3 w-3 shrink-0"
                          checked={allSelected}
                          ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected }}
                          disabled={saveLoadDialog.loading || images.length === 0}
                          onChange={() => setSaveLoadDialog((p) => p ? { ...p, selected: allSelected ? [] : allRefs } : p)} />
                        <span className="font-medium">{allSelected ? t('docker_image_save_deselect_all') : t('docker_image_save_select_all')}</span>
                        <span className="text-muted-foreground ml-auto">{t('docker_image_save_selected', { count: saveLoadDialog.selected.length })}</span>
                      </label>
                      <div className="max-h-48 overflow-auto p-1 space-y-0.5">
                        {images.map((img, idx) => {
                          const ref = img.repository === '<none>' ? img.id : `${img.repository}:${img.tag}`
                          const checked = saveLoadDialog.selected.includes(ref)
                          return (
                            <label key={`${img.id}-${idx}`} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent cursor-pointer">
                              <input type="checkbox" className="h-3 w-3 shrink-0" checked={checked} disabled={saveLoadDialog.loading}
                                onChange={() => setSaveLoadDialog((p) => p ? { ...p, selected: checked ? p.selected.filter((x) => x !== ref) : [...p.selected, ref] } : p)} />
                              <span className="font-mono text-[11px] truncate flex-1">{ref}</span>
                              <span className="text-[10px] text-muted-foreground shrink-0">{img.size}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}
                {saveLoadDialog.loading && saveLoadDialog.progress && (() => {
                  const p = saveLoadDialog.progress!
                  // 传输尚未真正完成时进度封顶 99%，避免「显示 100% 但实际仍在传输」的假象；
                  // 真正完成由后端成功返回后关闭弹框（loading=false）体现。
                  const pct = p.total > 0 ? Math.min(99, Math.round((p.transferred / p.total) * 100)) : null
                  return (
                    <div className="space-y-1">
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: pct != null ? `${pct}%` : '0%' }} />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{t('docker_image_transferring')}</span>
                        <span className="font-mono tabular-nums">
                          {pct != null ? `${pct}% · ${formatSize(p.transferred)} / ${formatSize(p.total)}` : `${formatSize(p.transferred)} 已传输`}
                        </span>
                      </div>
                    </div>
                  )
                })()}
                {saveLoadDialog.remotePath && (
                  <div className="rounded-md border border-border/60 p-2 bg-muted/30">
                    <div className="text-[10px] text-muted-foreground mb-1">{t('docker_image_save_success')}</div>
                    <div className="font-mono text-[11px] break-all">{saveLoadDialog.remotePath}</div>
                  </div>
                )}
              </>
            ) : (
              <>
                <label className="text-[10px] text-muted-foreground mb-1 block">{t('docker_image_load_desc')}</label>
                <div className="rounded-md border border-border/60 p-2 space-y-1.5">
                  {saveLoadDialog.localFile ? (
                    <div className="flex items-center gap-2 text-[11px]">
                      <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-mono truncate flex-1" title={saveLoadDialog.localFile.path}>{saveLoadDialog.localFile.name}</span>
                      <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                        disabled={saveLoadDialog.loading}
                        onClick={pickLocalFile}
                      >更换</Button>
                    </div>
                  ) : (
                    <Button type="button" variant="outline" size="sm" className="h-7 w-full gap-1.5 text-xs"
                      onClick={pickLocalFile}
                      disabled={saveLoadDialog.loading}
                    ><Upload className="h-3.5 w-3.5" />选择本地 tar 文件</Button>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">{t('docker_image_load_pick_hint')}</div>
                {saveLoadDialog.loading && saveLoadDialog.progress && (() => {
                  const p = saveLoadDialog.progress!
                  // 传输尚未真正完成时进度封顶 99%，避免「显示 100% 但实际仍在传输」的假象；
                  // 真正完成由后端成功返回后关闭弹框（loading=false）体现。
                  const pct = p.total > 0 ? Math.min(99, Math.round((p.transferred / p.total) * 100)) : null
                  return (
                    <div className="space-y-1">
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: pct != null ? `${pct}%` : '0%' }} />
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{t('docker_image_transferring')}</span>
                        <span className="font-mono tabular-nums">
                          {pct != null ? `${pct}% · ${formatSize(p.transferred)} / ${formatSize(p.total)}` : `${formatSize(p.transferred)} 已传输`}
                        </span>
                      </div>
                    </div>
                  )
                })()}
                {saveLoadDialog.result && (
                  <div className="text-[11px] text-emerald-400 font-mono break-all whitespace-pre-wrap">{saveLoadDialog.result}</div>
                )}
              </>
            )}
          </div>
        )}
      </ConfirmDialog>

      {/* === 拉取镜像对话框 === */}
      <ConfirmDialog
        open={pullDialog !== null}
        title={t('docker_pull_title')}
        description={t('docker_pull_desc')}
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        pending={pullDialog?.pulling === true}
        onConfirm={handlePullImage}
        onCancel={() => { if (!pullDialog?.pulling) setPullDialog(null) }}
      >
        <input
          className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm font-mono outline-none focus:ring-1 focus:ring-ring"
          placeholder={t('docker_pull_placeholder')}
          value={pullDialog?.image ?? ''}
          disabled={pullDialog?.pulling === true}
          onChange={(e) => setPullDialog((prev) => (prev ? { ...prev, image: e.target.value } : prev))}
        />
      </ConfirmDialog>

      {/* === 运行新容器 / 修改配置对话框（editId 非空时为修改配置模式：保存=删旧同名重建） === */}
      <ConfirmDialog
        open={runDialog !== null}
        title={runDialog?.editId ? t('dk_edit_config') : t('docker_run_title')}
        description={runDialog?.editId ? t('dk_edit_config_desc') : t('docker_run_desc')}
        confirmLabel={runDialog?.editId ? t('dk_save_config') : t('common_confirm')}
        cancelLabel={t('common_cancel')}
        pending={runDialog?.running === true}
        onConfirm={handleRunImage}
        onCancel={() => { if (!runDialog?.running) setRunDialog(null) }}
        widthClass="max-w-[540px]"
      >
        {runDialog && (
          <div className="space-y-2.5 text-left">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">{t('docker_run_name')} *</label>
                <Input
                  className="h-8 text-xs font-mono"
                  value={runDialog.name}
                  // 修改配置模式名称锁定（同名重建）
                  disabled={runDialog.running || !!runDialog.editId}
                  onChange={(e) => setRunDialog((p) => (p ? { ...p, name: e.target.value } : p))}
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">{t('docker_run_image')} *</label>
                <Input
                  className="h-8 text-xs font-mono"
                  value={runDialog.image}
                  disabled={runDialog.running}
                  onChange={(e) => setRunDialog((p) => (p ? { ...p, image: e.target.value } : p))}
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">{t('docker_run_ports')}</label>
              <textarea
                className="w-full h-14 px-2.5 py-1.5 rounded-md border border-border bg-background text-xs font-mono outline-none focus:ring-1 focus:ring-ring resize-none"
                placeholder={t('docker_run_ports_hint')}
                value={runDialog.ports}
                disabled={runDialog.running}
                onChange={(e) => setRunDialog((p) => (p ? { ...p, ports: e.target.value } : p))}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">{t('docker_run_volumes')}</label>
              <textarea
                className="w-full h-14 px-2.5 py-1.5 rounded-md border border-border bg-background text-xs font-mono outline-none focus:ring-1 focus:ring-ring resize-none"
                placeholder={t('docker_run_volumes_hint')}
                value={runDialog.volumes}
                disabled={runDialog.running}
                onChange={(e) => setRunDialog((p) => (p ? { ...p, volumes: e.target.value } : p))}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">{t('docker_run_env')}</label>
              <textarea
                className="w-full h-14 px-2.5 py-1.5 rounded-md border border-border bg-background text-xs font-mono outline-none focus:ring-1 focus:ring-ring resize-none"
                placeholder={t('docker_run_env_hint')}
                value={runDialog.env}
                disabled={runDialog.running}
                onChange={(e) => setRunDialog((p) => (p ? { ...p, env: e.target.value } : p))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">{t('docker_run_restart')}</label>
                <select
                  className="w-full h-8 px-2 rounded-md border border-border bg-background text-xs outline-none focus:ring-1 focus:ring-ring"
                  value={runDialog.restart}
                  disabled={runDialog.running}
                  onChange={(e) => setRunDialog((p) => (p ? { ...p, restart: e.target.value } : p))}
                >
                  <option value="no">no</option>
                  <option value="unless-stopped">unless-stopped</option>
                  <option value="always">always</option>
                  <option value="on-failure">on-failure</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">{t('docker_run_network')}</label>
                <Input
                  className="h-8 text-xs font-mono"
                  value={runDialog.network}
                  disabled={runDialog.running}
                  onChange={(e) => setRunDialog((p) => (p ? { ...p, network: e.target.value } : p))}
                />
              </div>
            </div>
          </div>
        )}
      </ConfirmDialog>

      {/* === 镜像详情模态框 === */}
      {imageInspectModal && (
        <Dialog open onOpenChange={(open) => { if (!open) setImageInspectModal(null) }}>
          <DialogContent showCloseButton={false} className="w-[90vw] max-w-3xl h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">{t('docker_image_inspect')} - {imageInspectModal.id.slice(0, 12)}</span>
              </div>
              <button className="p-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-accent transition-colors" onClick={() => setImageInspectModal(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-zinc-950 text-[12px] font-mono text-zinc-300 leading-relaxed">
              <pre className="whitespace-pre-wrap break-all text-zinc-300">{imageInspectModal.data}</pre>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* === Compose 新建项目对话框 === */}
      <ConfirmDialog
        open={createDialog !== null}
        title={t('dk_compose_create')}
        description={t('dk_compose_create_desc')}
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        pending={createDialog?.creating === true}
        onConfirm={handleComposeCreate}
        onCancel={() => { if (!createDialog?.creating) setCreateDialog(null) }}
        widthClass="max-w-[600px]"
      >
        {createDialog && (
          <div className="space-y-2.5 text-left">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">{t('dk_compose_create_name')} *</label>
                <Input
                  className="h-8 text-xs font-mono"
                  value={createDialog.name}
                  disabled={createDialog.creating}
                  onChange={(e) => setCreateDialog((p) => (p ? {
                    ...p,
                    name: e.target.value,
                    // 目录未手动改过时自动跟随项目名（Dockge 式默认目录）
                    dir: p.dirTouched ? p.dir : `/opt/stacks/${e.target.value}`,
                  } : p))}
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground mb-1 block">{t('dk_compose_create_dir')} *</label>
                <Input
                  className="h-8 text-xs font-mono"
                  value={createDialog.dir}
                  disabled={createDialog.creating}
                  onChange={(e) => setCreateDialog((p) => (p ? { ...p, dir: e.target.value, dirTouched: true } : p))}
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">{t('dk_compose_create_yaml')}</label>
              <textarea
                className="w-full h-44 px-2.5 py-1.5 rounded-md border border-border bg-background text-xs font-mono outline-none focus:ring-1 focus:ring-ring resize-none"
                value={createDialog.yaml}
                disabled={createDialog.creating}
                onChange={(e) => setCreateDialog((p) => (p ? { ...p, yaml: e.target.value } : p))}
              />
            </div>
          </div>
        )}
      </ConfirmDialog>

      <DockerComposeImportDialog
        open={importDialog !== null}
        importDialog={importDialog}
        setImportDialog={setImportDialog}
        onConfirm={handleImportConfirm}
        onCancel={() => { if (!importDialog?.importing && !importDialog?.scanning) setImportDialog(null); }}
        onScan={handleImportScan}
      />

      <DockerComposeConvertDialog
        open={convertDialog !== null}
        convertDialog={convertDialog}
        setConvertDialog={setConvertDialog}
        convertPreview={convertPreview}
        onConfirm={handleConvertCreate}
        onCancel={() => { if (!convertDialog?.creating) setConvertDialog(null); }}
      />

      <DockerDeployModal
        deployModal={deployModal}
        deployTick={deployTick}
        onClose={() => {
          deployUnsubRef.current?.();
          deployUnsubRef.current = null;
          deployRequestIdRef.current = null;
          setDeployModal(null);
        }}
      />

      {/* === Registry 登录对话框 === */}
      <ConfirmDialog
        open={loginDialog !== null}
        title={t('dk_login_title')}
        description={t('dk_login_desc')}
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        pending={loginDialog?.running === true}
        onConfirm={handleLogin}
        onCancel={() => { if (!loginDialog?.running) setLoginDialog(null) }}
      >
        {loginDialog && (
          <div className="space-y-2.5 text-left">
            {/* 当前已登录仓库：token 型凭证（如 Docker Hub PAT）可能过期，长期仓库提醒重新验证 */}
            {loginDialog.loggedRegistries !== null && (
              <div className="rounded-md border border-border/60 px-2.5 py-2">
                <div className="text-[10px] text-muted-foreground mb-1.5">{t('dk_login_current')}</div>
                {loginDialog.loggedRegistries.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground/70">{t('dk_login_none')}</div>
                ) : (
                  <div className="space-y-1">
                    {loginDialog.loggedRegistries.map((lr) => (
                      <div key={lr.registry} className="flex items-center gap-1.5 text-[11px]">
                        <Check className="h-3 w-3 text-emerald-400 flex-shrink-0" />
                        <span className="font-mono truncate flex-1">{lr.registry}</span>
                        {lr.tokenBased && (
                          <span className="text-[10px] text-amber-400 flex-shrink-0">{t('dk_login_token_hint')}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">{t('dk_login_registry')}</label>
              <Input
                className="h-8 text-xs font-mono"
                placeholder="registry.example.com:5000"
                value={loginDialog.registry}
                disabled={loginDialog.running}
                onChange={(e) => setLoginDialog((p) => (p ? { ...p, registry: e.target.value } : p))}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">{t('dk_login_username')} *</label>
              <Input
                className="h-8 text-xs font-mono"
                value={loginDialog.username}
                disabled={loginDialog.running}
                onChange={(e) => setLoginDialog((p) => (p ? { ...p, username: e.target.value } : p))}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">{t('dk_login_password')} *</label>
              <Input
                type="password"
                className="h-8 text-xs font-mono"
                value={loginDialog.password}
                disabled={loginDialog.running}
                onChange={(e) => setLoginDialog((p) => (p ? { ...p, password: e.target.value } : p))}
              />
            </div>
          </div>
        )}
      </ConfirmDialog>

      <DockerSystemDfModal
        dfModal={dfModal}
        onClose={() => setDfModal(null)}
        onPrune={() => setPendingPruneSystem({ includeImages: false })}
      />

      {/* === 全局清理确认（含可选镜像清理） === */}
      <ConfirmDialog
        open={pendingPruneSystem !== null}
        title={t('dk_df_prune')}
        description={t('dk_df_prune_confirm')}
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        variant="destructive"
        pending={actionLoading === 'sysprune'}
        onConfirm={handleSystemPrune}
        onCancel={() => setPendingPruneSystem(null)}
      >
        {pendingPruneSystem && (
          <label className="flex items-center gap-2 text-xs text-left cursor-pointer">
            <input
              type="checkbox"
              className="accent-destructive"
              checked={pendingPruneSystem.includeImages}
              disabled={actionLoading === 'sysprune'}
              onChange={(e) => setPendingPruneSystem({ includeImages: e.target.checked })}
            />
            {t('dk_df_prune_images')}
          </label>
        )}
      </ConfirmDialog>

      {/* === 清理悬空镜像确认对话框 === */}
      <ConfirmDialog
        open={pendingPruneImages}
        title={t('docker_image_prune')}
        description={t('docker_image_prune_confirm')}
        confirmLabel={t('common_confirm')}
        cancelLabel={t('common_cancel')}
        variant="destructive"
        onConfirm={handlePruneImages}
        onCancel={() => setPendingPruneImages(false)}
      />

      {/* === Compose 日志模态框 === */}
      {composeLogsModal && (
        <Dialog open onOpenChange={(open) => { if (!open) setComposeLogsModal(null) }}>
          <DialogContent showCloseButton={false} className="w-[90vw] max-w-5xl h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">{t('docker_compose_logs')} - {composeLogsModal.name}</span>
              </div>
              <button className="p-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-accent transition-colors" onClick={() => setComposeLogsModal(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div
              ref={composeLogsScrollRef}
              onScroll={(e) => {
                const el = e.currentTarget
                composeLogsStickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
              }}
              className="flex-1 overflow-auto p-4 bg-zinc-950 font-mono text-[12px] text-zinc-200 leading-relaxed"
            >
              <pre className="whitespace-pre-wrap break-all">{composeLogsModal.data}</pre>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* === Service 级日志模态框 === */}
      {composeServiceLogsModal && (
        <Dialog open onOpenChange={(open) => { if (!open) setComposeServiceLogsModal(null) }}>
          <DialogContent showCloseButton={false} className="w-[90vw] max-w-5xl h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
              <div className="flex items-center gap-2">
                <Container className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">
                  {composeServiceLogsModal.project} / {composeServiceLogsModal.service}
                </span>
                <span className="text-xs text-muted-foreground">{t('docker_compose_logs')}</span>
              </div>
              <button className="p-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-accent transition-colors" onClick={() => setComposeServiceLogsModal(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-zinc-950 font-mono text-[12px] text-zinc-200 leading-relaxed">
              <pre className="whitespace-pre-wrap break-all">{composeServiceLogsModal.data}</pre>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <DockerComposeEditModal
        composeEditModal={composeEditModal}
        setComposeEditModal={setComposeEditModal}
        composeValidating={composeValidating}
        onValidate={handleComposeValidate}
        onSave={handleComposeSave}
        onClose={() => setComposeEditModal(null)}
      />
      </div>
    </div>
  )
}
