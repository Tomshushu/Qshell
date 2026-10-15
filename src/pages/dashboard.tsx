import { useState, useMemo, useCallback, useRef, createContext, useContext, useEffect, memo, useDeferredValue } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAppStore, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX } from '@/store'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Plus,
  Star,
  Terminal,
  TerminalSquare,
  Eye,
  Monitor,
  Copy,
  Check,
  LayoutGrid,
  List,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Pencil,
  Trash2,
  Search,
  X,
  Download,
  Upload,
  FileDown,
  FolderOpen,
  FolderTree,
  Server,
  ServerCog,
  ArrowLeftRight,
  Command,
} from 'lucide-react'
import { sshService } from '@/services/ssh-service'
import { backend } from '@/services/api'
import { cn } from '@/lib/utils'
import { playSound, SoundType } from '@/lib/sound'
import { EditServerDialog } from '@/components/server/edit-server-dialog'
import { ServerFormDialog } from '@/components/server/server-form-dialog'
import { ExportServersDialog } from '@/components/server/export-servers-dialog'
import { ServerCard as StyleServerCard, type ServerCardProps } from '@/components/dashboard/server-cards'
import { OsIcon } from '@/components/dashboard/os-icon'
import { ImportServersDialog } from '@/components/server/import-servers-dialog'
import { BatchBmcPowerDialog } from '@/components/server/batch-bmc-power-dialog'
import { BatchCommandDialog } from '@/components/server/batch-command-dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { Server as ServerType, WorkspaceModule } from '@/types'
import { useTranslation } from '@/i18n'
import { useMarqueeSelection } from '@/hooks/use-marquee-selection'
import { MarqueeRect } from '@/components/ui/marquee-rect'
import { isModuleAvailable } from '@/services/connection-targets'
import { ServerGroupTree } from '@/components/dashboard/server-group-tree'
import { RecycleBinDialog } from '@/components/dashboard/recycle-bin-dialog'
import {
  recordConnection,
  getRecentServerIds,
  removeRecentConnection,
  removeRecentConnections,
} from '@/lib/recent-connections'
import { useShortcutStore } from '@/store/shortcut-store'
import { TagFilterPopover } from '@/components/dashboard/tag-filter-popover'
import { DeviceTypeFilterPopover } from '@/components/dashboard/device-type-filter-popover'
import { SERVER_DRAG_MIME, collectSubtreeIds, HOST_GROUP_ID } from '@/lib/server-groups'
import { GroupTreePicker } from '@/components/ui/group-tree-picker'

/** 侧边栏宽度 clamp：拖拽后的值取整并限制在允许范围内 */
function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)))
}

type ViewMode = 'card' | 'list'
type SortField = 'name' | 'host' | 'createdAt' | 'lastAccessedAt'
type SortOrder = 'asc' | 'desc'

// 排序选项：模块级常量，避免每次渲染重建（PERF-4）。
// labelKey 在组件内通过 t() 解析为当前语言文案。
const SORT_OPTIONS: { field: SortField; labelKey: string }[] = [
  { field: 'name', labelKey: 'dashboard_sort_name' },
  { field: 'host', labelKey: 'dashboard_sort_host' },
  { field: 'createdAt', labelKey: 'dashboard_sort_created' },
  { field: 'lastAccessedAt', labelKey: 'dashboard_sort_last_accessed' },
]

/**
 * 服务器操作上下文 — 让 ServerContextMenu 通过 context 拿到导出/导入回调，
 * 避免 ServerCard / ServerListView / RecentServerList 等中间组件 props drilling。
 *
 * Provider 由 Dashboard 提供。未在 Provider 内使用时返回 no-op，安全降级。
 */
interface ServerActions {
  onAddServer: () => void
  onExportServer: (id: string) => void
  onExportAll: () => void
  onImport: () => void
  onBatchBmcPower: () => void
  onBatchCommand: () => void
}
const ServerActionsContext = createContext<ServerActions | null>(null)
function useServerActions(): ServerActions {
  const ctx = useContext(ServerActionsContext)
  if (!ctx) {
    return {
      onAddServer: () => {},
      onExportServer: () => {},
      onExportAll: () => {},
      onImport: () => {},
      onBatchBmcPower: () => {},
      onBatchCommand: () => {},
    }
  }
  return ctx
}

export function Dashboard() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const uiStyle = useAppStore(s => s.uiStyle)
  const servers = useAppStore(s => s.servers)
  const openTab = useAppStore(s => s.openTab)
  const openServersInSplit = useAppStore(s => s.openServersInSplit)
  const openSftpWithServers = useAppStore(s => s.openSftpWithServers)
  const updateServer = useAppStore(s => s.updateServer)
  const deleteServer = useAppStore(s => s.deleteServer)
  const deleteServers = useAppStore(s => s.deleteServers)
  const serverGroups = useAppStore(s => s.serverGroups)
  const tags = useAppStore(s => s.tags)
  const trashCount = useAppStore(s => s.trashCount)
  const setTrashCount = useAppStore(s => s.setTrashCount)
  const loadServers = useAppStore(s => s.loadServers)
  // 侧边栏宽度：持久化偏好（重启后恢复）
  const savedSidebarWidth = useAppStore(s => s.sidebarWidth)
  const setSidebarWidth = useAppStore(s => s.setSidebarWidth)
  /** 侧边栏过滤（null = 全部；'favorites' = 我的收藏；'recent' = 最近连接；否则为分组 id，含子孙；未分组服务器归入「服务器」），互不组合、单选生效 */
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [deviceTypeFilter, setDeviceTypeFilter] = useState<string | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [addDialogGroupId, setAddDialogGroupId] = useState<string | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  // 添加服务器两步式流程：先选目标类型，再打开对应添加表单
  const [viewMode, setViewMode] = useState<ViewMode>('card')

  // 回收站待删除数量刷新
  const refreshTrashCount = useCallback(async () => {
    try {
      const list = await sshService.listTrashServers()
      setTrashCount(list.length)
    } catch {
      // 忽略
    }
  }, [setTrashCount])
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [editingServerId, setEditingServerId] = useState<string | null>(null)
  const [renamingServerId, setRenamingServerId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  // 拖拽中只更新本地 state（每帧渲染），松手后才写回 store 持久化，
  // 避免 mousemove 期间每帧触发一次 localStorage 写入。
  const [leftWidth, setLeftWidth] = useState(savedSidebarWidth)
  const [deleteTarget, setDeleteTarget] = useState<ServerType | null>(null)
  const [batchDeleteTargets, setBatchDeleteTargets] = useState<ServerType[] | null>(null)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exportPreselectIds, setExportPreselectIds] = useState<string[] | undefined>(undefined)
  const [showImportDialog, setShowImportDialog] = useState(false)
  // 批量选择：单击选中（替换），Ctrl+单击追加/切换；右键多选时弹出批量菜单
  const [selectedServerIds, setSelectedServerIds] = useState<Set<string>>(new Set())
  // 批量 BMC 电源操作弹窗（仅选中集合含 BMC 服务器时打开）
  const [batchBmcPowerOpen, setBatchBmcPowerOpen] = useState(false)
  // 批量命令执行弹窗（仅选中集合含可执行 SSH 命令的服务器时打开）
  const [batchCommandOpen, setBatchCommandOpen] = useState(false)

  const isDragging = useRef(false)
  // 拖拽监听器的引用，便于组件卸载时兜底清理（LEAK-1）
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  // 拖拽过程中的实时宽度（ref），mouseup 时一次性写入 store 持久化
  const draggingWidthRef = useRef(savedSidebarWidth)
  // 搜索框引用：用于 Ctrl+F / "/" 快捷键聚焦（UX-7）
  const searchInputRef = useRef<HTMLInputElement>(null)
  // 平台判断：命令面板快捷键提示，macOS 显示 ⌘K，Windows/Linux 显示 Ctrl K
  const isMac = navigator.userAgent.includes('Mac')
  // 批量打开防抖锁（防止手快双击导致重复触发批量调度）
  const isBatchOpeningRef = useRef(false)
  const acquireBatchOpenLock = useCallback(() => {
    if (isBatchOpeningRef.current) return false
    isBatchOpeningRef.current = true
    setTimeout(() => {
      isBatchOpeningRef.current = false
    }, 1000)
    return true
  }, [])

  // ── 框选（marquee）多选：空白处左键拖动，像 Windows 资源管理器一样框选服务器 ──
  const {
    containerRef: listAreaRef,
    marquee,
    onMouseDown: handleMarqueeMouseDown,
    consumeMarqueeClick,
  } = useMarqueeSelection({
    itemSelector: '[data-server-id]',
    getItemId: (el) => el.dataset.serverId!,
    getSelection: () => selectedServerIds,
    setSelection: (ids) => setSelectedServerIds(ids),
  })

  /**
   * 打开导出对话框。
   * - 传 preselectIds（如右键"导出此服务器"传 [server.id]）：默认勾选这些服务器
   * - 不传或传空数组：默认不勾选（"导出全部"由用户在对话框中点"全选"）
   */
  const openExportDialog = useCallback((preselectIds?: string[]) => {
    setExportPreselectIds(preselectIds && preselectIds.length > 0 ? preselectIds : undefined)
    setShowExportDialog(true)
  }, [])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    const startX = e.clientX
    const startWidth = leftWidth
    draggingWidthRef.current = startWidth

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return
      const delta = ev.clientX - startX
      const newWidth = clampSidebarWidth(startWidth + delta)
      draggingWidthRef.current = newWidth
      setLeftWidth(newWidth)
    }

    const onMouseUp = () => {
      isDragging.current = false
      // 拖拽结束才落库，避免 mousemove 每帧写 localStorage
      setSidebarWidth(draggingWidthRef.current)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      resizeCleanupRef.current = null
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    // 记录清理函数，便于组件卸载时兜底移除监听器（LEAK-1）
    resizeCleanupRef.current = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [leftWidth, setSidebarWidth])

  // 组件卸载时若仍在拖拽，强制移除监听器并还原 body 样式（LEAK-1）
  useEffect(() => {
    return () => {
      if (isDragging.current && resizeCleanupRef.current) {
        resizeCleanupRef.current()
        isDragging.current = false
      }
    }
  }, [])

  // 持久化宽度在外部被修改时（如设置中重置布局）同步到本地；拖拽中不打断用户操作
  useEffect(() => {
    if (isDragging.current) return
    setLeftWidth(savedSidebarWidth)
  }, [savedSidebarWidth])

  // 全局快捷键：Ctrl+F 或 "/" 聚焦搜索框（UX-7）
  // 仅在服务器/收藏视图（含搜索框）生效；输入框内按 "/" 不触发，避免误拦截
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      // 搜索框快捷键（默认 Mod+F）
      if (useShortcutStore.getState().matchesAction(e, 'dashboard.search')) {
        const input = searchInputRef.current
        if (!input) return
        e.preventDefault()
        input.focus()
        input.select()
        return
      }
      // "/" 聚焦搜索框（仅在非输入态生效）
      if (e.key === '/' && !isTyping) {
        const input = searchInputRef.current
        if (!input) return
        e.preventDefault()
        input.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])



  const allTags = useMemo(() => {
    const set = new Set<string>([
      ...tags,
      ...servers.flatMap((s) => s.tags ?? []),
    ])
    return [...set].sort()
  }, [tags, servers])

  const sortServers = (list: ServerType[]) => {
    return [...list].sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'host':
          cmp = a.host.localeCompare(b.host)
          break
        case 'createdAt':
          cmp = (a.createdAt || 0) - (b.createdAt || 0)
          break
        case 'lastAccessedAt':
          cmp = (a.lastAccessedAt || 0) - (b.lastAccessedAt || 0)
          break
      }
      return sortOrder === 'asc' ? cmp : -cmp
    })
  }

  // 搜索防抖（PERF-3）：用 useDeferredValue 让过滤在后台渲染，避免每次按键卡顿
  const deferredSearch = useDeferredValue(searchQuery)

  // 最近连接（本地持久），监听 store 写入事件实时刷新
  const [recentServerIds, setRecentServerIds] = useState<string[]>(() => getRecentServerIds())
  useEffect(() => {
    const onRecent = () => setRecentServerIds(getRecentServerIds())
    window.addEventListener('recent-connections-changed', onRecent)
    return () => window.removeEventListener('recent-connections-changed', onRecent)
  }, [])

  // 命令面板事件桥：跳转分组 / 打开导入（命令面板为 App 级全局浮层，无法直接访问本组件局部 state）
  useEffect(() => {
    const onNavigateGroup = (e: Event) => {
      const gid = (e as CustomEvent<string>).detail
      if (gid) setSelectedGroupId(gid)
    }
    const onImport = () => setShowImportDialog(true)
    window.addEventListener('command-palette:navigate-group', onNavigateGroup)
    window.addEventListener('command-palette:import', onImport)
    return () => {
      window.removeEventListener('command-palette:navigate-group', onNavigateGroup)
      window.removeEventListener('command-palette:import', onImport)
    }
  }, [setSelectedGroupId, setShowImportDialog])

  const displayServers = useMemo(() => {
    let list: ServerType[] = servers
    // 侧边栏过滤：收藏 / 最近连接 / 分组（含子孙，未分组服务器归入「服务器」），互不组合、单选生效
    if (selectedGroupId === 'favorites') {
      list = list.filter((s) => s.favorite)
    } else if (selectedGroupId === 'recent') {
      const byId = new Map(servers.map((s) => [s.id, s]))
      list = recentServerIds.map((id) => byId.get(id)).filter((s): s is ServerType => !!s)
    } else if (selectedGroupId) {
      const subtree = collectSubtreeIds(serverGroups, selectedGroupId)
      list = list.filter((s) => {
        const gid = s.groupId && serverGroups.some((g) => g.id === s.groupId) ? s.groupId : HOST_GROUP_ID
        return subtree.has(gid)
      })
    }
    if (tagFilter) {
      list = list.filter((s) => (s.tags ?? []).includes(tagFilter!))
    }
    if (deviceTypeFilter) {
      list = list.filter((s) => s.targetType === deviceTypeFilter)
    }
    if (deferredSearch.trim()) {
      const q = deferredSearch.trim().toLowerCase()
      list = list.filter((s) =>
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        s.username.toLowerCase().includes(q) ||
        (s.osInfo || '').toLowerCase().includes(q) ||
        (s.osType || '').toLowerCase().includes(q) ||
        (s.notes || '').toLowerCase().includes(q) ||
        (s.tags ?? []).some((t) => t.toLowerCase().includes(q))
      )
    }
    return sortServers(list)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers, selectedGroupId, serverGroups, recentServerIds, tagFilter, deviceTypeFilter, deferredSearch, sortField, sortOrder])



  const toggleSortOrder = useCallback(() => {
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
  }, [sortOrder])

  // 排序字段文案：从模块级 SORT_OPTIONS 解析当前字段对应的 i18n key，再交由 t() 翻译（PERF-4）
  const sortFieldLabel = t(SORT_OPTIONS.find(o => o.field === sortField)?.labelKey || 'dashboard_sort_name')

  // 当前分组过滤的显示名（用于标题栏面包屑）
  const selectedGroupLabel = useMemo(() => {
    if (!selectedGroupId) return null
    if (selectedGroupId === 'favorites') return t('group_favorites')
    if (selectedGroupId === 'recent') return t('group_recent')
    return serverGroups.find((g) => g.id === selectedGroupId)?.name ?? null
  }, [selectedGroupId, serverGroups, t])

  // 切换导航/分组/搜索过滤时清空批量选择，避免跨列表残留选中
  // 采用渲染期「条件变化时调整 state」模式，避免在 effect 内同步 setState
  const filterKey = `${selectedGroupId}|${tagFilter}|${deviceTypeFilter}`
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey)
    setSelectedServerIds(new Set())
  }

  // 批量选择：单击替换选中，Ctrl+单击追加/切换
  const handleServerSelect = useCallback((serverId: string, ctrlKey: boolean) => {
    setSelectedServerIds((prev) => {
      if (ctrlKey) {
        const next = new Set(prev)
        if (next.has(serverId)) next.delete(serverId)
        else next.add(serverId)
        return next
      }
      if (prev.size === 1 && prev.has(serverId)) return prev
      return new Set([serverId])
    })
  }, [])

  // 取消所有选中（点击空白区域时触发）
  const handleClearSelection = useCallback(() => {
    setSelectedServerIds((prev) => (prev.size === 0 ? prev : new Set()))
  }, [])

  // 批量「在同一个工作台打开」：≤4 自动 T/田 字型分屏；>4 退化为独立标签页
  // Windows 仅配 RDP 时走系统 RDP 客户端；Windows 配有 SSH 时与其他 SSH 目标一样进入终端分屏。
  // BMC 带外管理不支持分屏（仅一个模块，分屏后无法渲染终端），单独打开独立标签页
  const handleBatchOpenSameWorkspace = useCallback(() => {
    if (!acquireBatchOpenLock()) return
    const selected = servers.filter((s) => selectedServerIds.has(s.id))
    if (selected.length === 0) return
    const windowsRdpOnly = selected.filter(
      (s) => s.targetType === 'windows' && (!s.port || s.port <= 0) && Boolean(s.rdpPort && s.rdpPort > 0)
    )
    const bmcServers = selected.filter((s) => s.targetType === 'bmc')
    // 可分屏的服务器：Windows (配置了 SSH 端口) 或 Linux/Unix/网络设备等
    const tabServers = selected.filter((s) => {
      if (s.targetType === 'bmc') return false
      if (s.targetType === 'windows') {
        return Boolean(s.port && s.port > 0)
      }
      return true
    })
    const noPortServers = selected.filter(
      (s) => s.targetType === 'windows' && (!s.port || s.port <= 0) && (!s.rdpPort || s.rdpPort <= 0)
    )
    if (noPortServers.length > 0) {
      toast.warning(t('server_no_port'))
    }
    for (const s of windowsRdpOnly) {
      backend?.rdp.launch({ serverId: s.id, rdpPort: s.rdpPort })
    }
    // BMC 单独打开独立标签页（不分屏）
    for (const s of bmcServers) {
      openTab(s.id, s.name, 'bmc')
    }
    if (tabServers.length > 0) {
      openServersInSplit(
        tabServers.map((s) => ({ serverId: s.id, serverName: s.name, module: 'terminal' as WorkspaceModule })),
      )
    }
    setSelectedServerIds(new Set())
  }, [servers, selectedServerIds, openServersInSplit, openTab, acquireBatchOpenLock, toast, t])

  // 批量「打开」：各自独立标签页（Windows 仅配 RDP 走系统客户端，配 SSH 打开终端，皆无提示未配置连接端口）
  const handleBatchOpenSeparate = useCallback(() => {
    if (!acquireBatchOpenLock()) return
    const selected = servers.filter((s) => selectedServerIds.has(s.id))
    if (selected.length === 0) return
    for (const s of selected) {
      if (s.targetType === 'windows') {
        const hasSsh = Boolean(s.port && s.port > 0)
        const hasRdp = Boolean(s.rdpPort && s.rdpPort > 0)
        if (hasSsh) {
          openTab(s.id, s.name, 'terminal')
        } else if (hasRdp) {
          backend?.rdp.launch({ serverId: s.id, rdpPort: s.rdpPort })
        } else {
          toast.warning(`${s.name}: ${t('server_no_port')}`)
        }
      } else if (s.targetType === 'bmc') {
        // BMC 默认进入带外管理模块（与双击行为一致）
        openTab(s.id, s.name, 'bmc')
      } else {
        openTab(s.id, s.name, 'terminal')
      }
    }
    setSelectedServerIds(new Set())
  }, [servers, selectedServerIds, openTab, acquireBatchOpenLock, toast, t])

  // 批量「一键打开 SFTP 文件传输」：切到 SFTP 传输面板并批量排布连接标签
  const handleBatchOpenSftp = useCallback(() => {
    if (!acquireBatchOpenLock()) return

    const selected = servers.filter((s) => selectedServerIds.has(s.id))
    if (selected.length === 0) return
    const eligible = selected.filter(
      (s) => s.targetType !== 'bmc' && s.targetType !== 'serial' && s.protocol !== 'serial' && !(s.targetType === 'windows' && (!s.port || s.port <= 0))
    )
    if (eligible.length === 0) {
      toast.info(t('dash_batch_no_sftp_servers'))
      return
    }
    openSftpWithServers(eligible.map((s) => s.id))
    setSelectedServerIds(new Set())
  }, [servers, selectedServerIds, openSftpWithServers, acquireBatchOpenLock, toast, t])

  // 批量「在同一个工作台打开文件管理」：≤4 自动分屏；>4 退化为独立标签页
  const handleBatchOpenFilesSplit = useCallback(() => {
    if (!acquireBatchOpenLock()) return
    const selected = servers.filter((s) => selectedServerIds.has(s.id))
    if (selected.length === 0) return
    const eligible = selected.filter(
      (s) => s.targetType !== 'bmc' && s.targetType !== 'serial' && s.protocol !== 'serial' && !(s.targetType === 'windows' && (!s.port || s.port <= 0))
    )
    if (eligible.length === 0) {
      toast.info(t('dash_batch_no_sftp_servers'))
      return
    }
    openServersInSplit(
      eligible.map((s) => ({ serverId: s.id, serverName: s.name, module: 'files' as WorkspaceModule }))
    )
    setSelectedServerIds(new Set())
  }, [servers, selectedServerIds, openServersInSplit, acquireBatchOpenLock, toast, t])

  const handleRename = useCallback((server: ServerType) => {
    setRenamingServerId(server.id)
    setRenameValue(server.name)
  }, [])

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingServerId || !renameValue.trim()) return
    const newName = renameValue.trim()
    if (newName.length > 100) {
      toast.error('服务器名称不能超过 100 个字符')
      return
    }
    try {
      await sshService.updateServer(renamingServerId, { name: newName })
      updateServer(renamingServerId, { name: newName })
    } catch (e) {
      toast.error(`${t('common_rename_failed')}: ${(e as Error).message || e}`)
    }
    setRenamingServerId(null)
    setRenameValue('')
  }, [renamingServerId, renameValue, updateServer, toast, t])

  const handleDelete = useCallback(async (server: ServerType) => {
    // 警告音由 ConfirmDialog 打开时统一播放，避免重复
    setDeleteTarget(server)
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    const server = deleteTarget
    try {
      // 先主动断开该服务器的 SSH 连接（若已连接），防止后端资源泄漏
      try {
        await sshService.disconnect(server.id)
      } catch (e) {
        // 断开失败不阻塞删除流程，仅记日志
        console.warn('[Delete Server] disconnect failed:', e)
      }
      await sshService.deleteServer(server.id)
      removeRecentConnection(server.id)
      deleteServer(server.id)
      // 删除成功后再关闭对话框（BUG-3：失败时不立即关闭）
      setDeleteTarget(null)
      playSound(SoundType.Success)
      toast.success(t('trash_moved'))
      void refreshTrashCount()
    } catch (e) {
      // Error 音由 toast.error 自动播放，无需重复
      toast.error(`${t('common_delete_failed')}: ${(e as Error).message || e}`)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteTarget, deleteServer, toast, t])

  const handleDeleteCancel = useCallback(() => {
    setDeleteTarget(null)
  }, [])

  const handleBatchDelete = useCallback(() => {
    const targets = servers.filter((s) => selectedServerIds.has(s.id))
    if (targets.length > 0) {
      setBatchDeleteTargets(targets)
    }
  }, [servers, selectedServerIds])

  const handleBatchDeleteConfirm = useCallback(async () => {
    if (!batchDeleteTargets || batchDeleteTargets.length === 0) return
    const targets = [...batchDeleteTargets]
    const ids = targets.map((s) => s.id)
    try {
      const r = await sshService.deleteServersBatch(ids)
      if (r.success) {
        removeRecentConnections(ids)
        deleteServers(ids)
        setSelectedServerIds((prev) => {
          const next = new Set(prev)
          for (const s of targets) {
            next.delete(s.id)
          }
          return next
        })
        setBatchDeleteTargets(null)
        toast.success(t('trash_moved_batch').replace('{count}', String(targets.length)))
        playSound(SoundType.Success)
        void refreshTrashCount()
      } else {
        toast.error(`${t('common_delete_failed')}: ${r.error || ''}`)
      }
    } catch (e) {
      toast.error(`${t('common_delete_failed')}: ${(e as Error).message || e}`)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchDeleteTargets, deleteServers, toast, t])

  const handleBatchDeleteCancel = useCallback(() => {
    setBatchDeleteTargets(null)
  }, [])

  /**
   * 服务器卡片 / 列表行拖拽开始（事件冒泡委托）：
   * 拖拽选中的卡片时携带全部选中 ID（批量移动），否则仅携带自身。
   * 负载由左侧分组树（ServerGroupTree）的 drop 处理消费。
   */
  const handleListDragStart = useCallback((e: React.DragEvent) => {
    const el = (e.target as HTMLElement).closest('[data-server-id]')
    if (!el) return
    const id = el.getAttribute('data-server-id')
    if (!id) return
    const ids = selectedServerIds.has(id) && selectedServerIds.size > 1 ? Array.from(selectedServerIds) : [id]
    e.dataTransfer.setData(SERVER_DRAG_MIME, JSON.stringify(ids))
    e.dataTransfer.effectAllowed = 'move'
  }, [selectedServerIds])


  // 统一的服务器列表工具栏（搜索 / 排序 / 视图切换）始终显示
  const showToolbar = true

  const serverActionsValue = useMemo(() => ({
    onAddServer: () => { setAddDialogGroupId(null); setShowAddDialog(true) },
    onExportServer: (id: string) => openExportDialog([id]),
    onExportAll: () => openExportDialog(),
    onImport: () => setShowImportDialog(true),
    // 批量 BMC 电源操作：入口在多选右键菜单，仅当选中集合含 BMC 服务器时可用
    onBatchBmcPower: () => {
      if (servers.some((s) => selectedServerIds.has(s.id) && s.targetType === 'bmc')) {
        setBatchBmcPowerOpen(true)
      }
    },
    // 批量命令执行：入口在多选右键菜单，仅当选中集合含可执行 SSH 命令的服务器（非 BMC、非 Serial）时可用
    onBatchCommand: () => {
      if (servers.some((s) => selectedServerIds.has(s.id) && s.targetType !== 'bmc' && s.targetType !== 'serial' && s.protocol !== 'serial')) {
        setBatchCommandOpen(true)
      }
    },
  }), [openExportDialog, servers, selectedServerIds])

  return (
    <div className="h-full flex">
      {/* 左侧导航（固定展开，不提供收起/折叠） */}
      <div
        className="dashboard-sidebar flex-shrink-0 border-r flex flex-col"
        style={{ width: leftWidth }}
      >
        {/* 快捷入口：点击或 Ctrl/⌘+K 打开全局命令面板；行规格与「我的收藏」一致（Command 图标区分语义） */}
        <div className="px-3 pt-1.5 pb-1">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('command-palette:open'))}
            title={`快捷入口 (${isMac ? '⌘K' : 'Ctrl K'})`}
            className="group/row w-full flex items-center gap-1 h-6 pl-1 pr-1.5 rounded-md text-[11px] transition-colors duration-150 cursor-pointer select-none text-muted-foreground hover:bg-accent/40 hover:text-foreground font-medium"
          >
            <Command className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />
            <span className="truncate flex-1 text-left">快捷入口</span>
            <kbd className="ml-auto flex-shrink-0 text-[10px] px-1 py-0.5 rounded-md font-mono tabular-nums bg-transparent text-muted-foreground/50 group-hover/row:bg-muted/70 group-hover/row:text-foreground">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
        </div>
            {/* 分组树（含默认分组）+ 我的收藏（分组区下方），互不组合、单选生效 */}
            <div className="flex-1 min-h-0 overflow-y-auto px-3">
              <ServerGroupTree
                selectedGroupId={selectedGroupId}
                onSelectGroup={setSelectedGroupId}
                onAddServerToGroup={(gid) => {
                  setAddDialogGroupId(gid)
                  setShowAddDialog(true)
                }}
                recentServerIds={recentServerIds}
                trashCount={trashCount}
                onOpenTrash={() => setTrashOpen(true)}
              />
            </div>
            <div className="px-3 pt-3 mt-auto">
              <div className="h-px mb-3 bg-border/50" />
              <Button
                size="sm"
                className="w-full gap-2 rounded-lg bg-primary text-primary-foreground font-medium shadow-sm hover:bg-primary/90 transition-colors duration-150"
                onClick={() => setShowAddDialog(true)}
              >
                <Plus className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{t('dashboard_btn_add')}</span>
              </Button>
            </div>
      </div>

      {/* 拖拽分隔线：零宽度热区（绝对定位叠加在边框上），避免在侧边栏与内容区之间留出空隙。
          hover/active 时只显示居中的 1px 细线，不出现粗高亮带 */}
      <div className="relative w-0 flex-shrink-0">
        <div className="group absolute inset-y-0 -left-1 w-2 cursor-col-resize" onMouseDown={handleResizeStart}>
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-transparent transition-colors group-hover:bg-primary/40 group-active:bg-primary/60" />
        </div>
      </div>

      {/* 右侧内容区（包在 ServerActionsContext.Provider 内，让 ServerContextMenu 能拿到导出/导入回调） */}
      <ServerActionsContext.Provider value={serverActionsValue}>
      <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
        {/* 顶部工具栏 */}
        <div className="dashboard-header flex items-center justify-between gap-3 flex-wrap flex-shrink-0 z-10 border-b">
            {/* 标题与服务器统计 Indicator */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-tight text-foreground">
                {selectedGroupLabel ?? t('nav_servers')}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-primary/10 text-primary border border-primary/20">
                {displayServers.length}
              </span>
            </div>

            {/* 右侧工具组 */}
            <div className="flex items-center gap-2.5 ml-auto">
              {showToolbar && (
                <>
                  {/* 搜索框 (含 KBD 快捷键提示) */}
                  <div className="relative w-52">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
                    <Input
                      ref={searchInputRef}
                      placeholder={uiStyle === 'anime' ? t('dashboard_search_placeholder_anime') : t('dashboard_search_placeholder')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 pl-8 pr-8 text-xs bg-muted/30 border border-border/50 rounded-lg transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* 紧凑筛选：标签与设备类型集中在顶部，避免额外占用一整行 */}
                  <div className="flex items-center gap-1.5">
                    <TagFilterPopover
                      allTags={allTags}
                      tagFilter={tagFilter}
                      onSelectTag={setTagFilter}
                    />
                    <DeviceTypeFilterPopover
                      value={deviceTypeFilter}
                      onChange={setDeviceTypeFilter}
                    />
                    {(tagFilter || deviceTypeFilter) && (
                      <button
                        type="button"
                        onClick={() => { setTagFilter(null); setDeviceTypeFilter(null) }}
                        className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        title={t('dashboard_filter_all')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {showToolbar && (
                    <>
                      <div className="w-px h-4 bg-border/60 mx-0.5" />

                      {/* 排序字段下拉选择 */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs gap-1.5 px-2.5 rounded-lg border-border/50 bg-muted/30 hover:bg-accent/60 transition-colors font-medium cursor-pointer"
                          >
                            <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/80" />
                            <span>{sortFieldLabel}</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          {SORT_OPTIONS.map((opt) => {
                            const isSelected = sortField === opt.field
                            return (
                              <DropdownMenuItem
                                key={opt.field}
                                onClick={() => setSortField(opt.field)}
                                className={cn("text-xs justify-between font-medium cursor-pointer", isSelected && "text-primary font-semibold bg-primary/10")}
                              >
                                <span>{t(opt.labelKey)}</span>
                                {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                              </DropdownMenuItem>
                            )
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>

                      {/* 升序/降序切换按钮 */}
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 rounded-lg border-border/50 bg-muted/30 hover:bg-accent/60 transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
                        onClick={toggleSortOrder}
                        title={sortOrder === 'asc' ? t('dash_sort_asc_title') : t('dash_sort_desc_title')}
                      >
                        {sortOrder === 'asc' ? (
                          <ArrowUp className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5 text-primary" />
                        )}
                      </Button>

                      {/* 视图模式单按钮切换 (Card / List) */}
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 rounded-lg border-border/50 bg-muted/30 hover:bg-accent/60 transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
                        onClick={() => setViewMode((v) => (v === 'card' ? 'list' : 'card'))}
                        title={viewMode === 'card' ? t('dash_view_card_title') : t('dash_view_list_title')}
                      >
                        {viewMode === 'card' ? (
                          <List className="h-3.5 w-3.5" />
                        ) : (
                          <LayoutGrid className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

        {/* 可滚动内容区 */}
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="dashboard-content-area flex-1 flex flex-col min-h-0">
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    ref={listAreaRef}
                    className="flex-1 flex flex-col min-h-0"
                    onMouseDown={handleMarqueeMouseDown}
                    onClick={() => {
                      // 刚结束框选时抑制本次 click，避免清空刚选中的内容
                      if (consumeMarqueeClick()) return
                      handleClearSelection()
                    }}
                  >
                {/* 服务器列表 */}
              {displayServers.length > 0 ? (
                viewMode === 'card' ? (
                  <div
                    className="dashboard-server-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                    onDragStart={handleListDragStart}
                  >
                    {displayServers.map((server) => (
                      <ServerCard
                        key={server.id}
                        server={server}
                        selected={selectedServerIds.has(server.id)}
                        selectedServerIds={selectedServerIds}
                        onSelect={handleServerSelect}
                        selectedCount={selectedServerIds.size}
                        onBatchOpenSameWorkspace={handleBatchOpenSameWorkspace}
                        onBatchOpenSeparate={handleBatchOpenSeparate}
                        onBatchOpenSftp={handleBatchOpenSftp}
                        onBatchOpenFilesSplit={handleBatchOpenFilesSplit}
                        onClearSelection={handleClearSelection}
                        onRename={handleRename}
                        onDelete={handleDelete}
                        onBatchDelete={handleBatchDelete}
                        onEdit={setEditingServerId}
                        renamingServerId={renamingServerId}
                        renameValue={renameValue}
                        onRenameValueChange={setRenameValue}
                        onRenameSubmit={handleRenameSubmit}
                        onRenameCancel={() => setRenamingServerId(null)}
                      />
                    ))}
                  </div>
                ) : (
                  <ServerListView
                    servers={displayServers}
                    selectedServerIds={selectedServerIds}
                    onSelect={handleServerSelect}
                    selectedCount={selectedServerIds.size}
                    onBatchOpenSameWorkspace={handleBatchOpenSameWorkspace}
                    onBatchOpenSeparate={handleBatchOpenSeparate}
                    onBatchOpenSftp={handleBatchOpenSftp}
                    onBatchOpenFilesSplit={handleBatchOpenFilesSplit}
                    onClearSelection={handleClearSelection}
                    onRename={handleRename}
                    onDelete={handleDelete}
                    onBatchDelete={handleBatchDelete}
                    onEdit={setEditingServerId}
                    renamingServerId={renamingServerId}
                    renameValue={renameValue}
                    onRenameValueChange={setRenameValue}
                    onRenameSubmit={handleRenameSubmit}
                    onRenameCancel={() => setRenamingServerId(null)}
                    onListDragStart={handleListDragStart}
                  />
                )
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center select-none">
                  {uiStyle === 'anime' ? (
                    <div className="relative mb-5 flex flex-col items-center group/cat cursor-default">
                      {/* 萌系趴卧打盹小猫 SVG */}
                      <div className="relative transform hover:scale-105 transition-transform duration-300">
                        <svg viewBox="0 0 96 72" className="w-28 h-20 drop-shadow-md overflow-visible" fill="none">
                          {/* 睡着的心形小气泡微动效 */}
                          <path d="M 74 18 C 74 12, 80 10, 84 14 C 88 10, 94 12, 94 18 C 94 24, 84 30, 84 30 C 84 30, 74 24, 74 18 Z" className="fill-pink-400/80 animate-pulse" />
                          <circle cx="68" cy="24" r="2" className="fill-pink-300/60" />
                          <circle cx="64" cy="28" r="1.2" className="fill-pink-300/40" />

                          {/* 猫咪身体 */}
                          <ellipse cx="44" cy="46" rx="34" ry="20" className="fill-pink-100/90 dark:fill-pink-950/60 stroke-pink-300 dark:stroke-pink-500/50" strokeWidth="2" />

                          {/* 猫尾巴 */}
                          <path d="M 12 46 C 4 44, 2 34, 8 28 C 13 24, 18 30, 14 36" className="stroke-pink-300 dark:stroke-pink-500/60 fill-pink-100/90 dark:fill-pink-950/60" strokeWidth="2" strokeLinecap="round" />

                          {/* 猫头部 */}
                          <circle cx="64" cy="38" r="18" className="fill-pink-100 dark:fill-pink-950/80 stroke-pink-300 dark:stroke-pink-500/50" strokeWidth="2" />

                          {/* 左耳 */}
                          <path d="M 52 26 L 50 12 L 62 21 Z" className="fill-pink-100 dark:fill-pink-950 stroke-pink-300 dark:stroke-pink-500/50" strokeWidth="2" strokeLinejoin="round" />
                          <path d="M 53 23 L 52 16 L 59 21 Z" className="fill-pink-400/80 dark:fill-pink-500/60" />

                          {/* 右耳 */}
                          <path d="M 68 22 L 78 12 L 78 26 Z" className="fill-pink-100 dark:fill-pink-950 stroke-pink-300 dark:stroke-pink-500/50" strokeWidth="2" strokeLinejoin="round" />
                          <path d="M 70 22 L 76 16 L 76 23 Z" className="fill-pink-400/80 dark:fill-pink-500/60" />

                          {/* 睡着的弯弯眼（幸福治愈） */}
                          <path d="M 58 38 Q 61 35 64 38" className="stroke-pink-400 dark:stroke-pink-300" strokeWidth="1.8" strokeLinecap="round" fill="none" />
                          <path d="M 68 38 Q 71 35 74 38" className="stroke-pink-400 dark:stroke-pink-300" strokeWidth="1.8" strokeLinecap="round" fill="none" />

                          {/* 樱花小鼻尖与小嘴 */}
                          <polygon points="66,41 64,43 68,43" className="fill-pink-500" />
                          <path d="M 64 43 Q 66 45 68 43" className="stroke-pink-400 dark:stroke-pink-300" strokeWidth="1.2" strokeLinecap="round" fill="none" />

                          {/* 害羞腮红 */}
                          <ellipse cx="56" cy="42" rx="3" ry="1.8" className="fill-pink-400/40" />
                          <ellipse cx="76" cy="42" rx="3" ry="1.8" className="fill-pink-400/40" />

                          {/* 前爪并拢 */}
                          <ellipse cx="52" cy="56" rx="6" ry="4" className="fill-pink-100 dark:fill-pink-950 stroke-pink-300 dark:stroke-pink-500/50" strokeWidth="1.5" />
                          <ellipse cx="62" cy="56" rx="6" ry="4" className="fill-pink-100 dark:fill-pink-950 stroke-pink-300 dark:stroke-pink-500/50" strokeWidth="1.5" />
                        </svg>
                      </div>
                    </div>
                  ) : (
                    <Server className="h-12 w-12 text-muted-foreground/30 mb-4" />
                  )}
                  {servers.length === 0 ? (
                    <div className="max-w-sm mx-auto">
                      <p className="text-xs text-muted-foreground mb-4">
                        {uiStyle === 'anime' ? t('dashboard_empty_anime') : t('dashboard_empty')}
                      </p>
                      <Button
                        onClick={() => { setAddDialogGroupId(null); setShowAddDialog(true) }}
                        size="sm"
                        className={cn(
                          "gap-1.5",
                          uiStyle === 'anime' && "rounded-full bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 shadow-md hover:shadow-lg hover:scale-105 transition-all text-white font-semibold"
                        )}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {uiStyle === 'anime' ? t('dashboard_btn_add_anime') : t('dashboard_btn_add')}
                      </Button>
                    </div>
                  ) : selectedGroupId === 'favorites' ? (
                    <>
                      <h3 className="text-sm font-semibold mb-1">
                        {uiStyle === 'anime' ? t('dashboard_no_favorites_anime') : t('dashboard_no_favorites')}
                      </h3>
                      <p className="text-xs text-muted-foreground">{t('dashboard_help_text')}</p>
                    </>
                  ) : selectedGroupId === 'recent' ? (
                    <>
                      <h3 className="text-sm font-semibold mb-1">{t('group_recent')}</h3>
                      <p className="text-xs text-muted-foreground">{t('group_recent_empty')}</p>
                    </>
                  ) : (
                    <>
                      <h3 className="text-sm font-semibold mb-1">
                        {uiStyle === 'anime' ? t('dashboard_no_matches_anime') : t('dashboard_no_matches')}
                      </h3>
                      <p className="text-xs text-muted-foreground">{t('dashboard_help_text')}</p>
                    </>
                  )}
                </div>
              )}
              {/* 框选矩形（client 坐标 fixed 定位，不拦截事件） */}
              <MarqueeRect marquee={marquee} />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-52">
                <ContextMenuItem onClick={() => { setAddDialogGroupId(null); setShowAddDialog(true) }}>
                  <Plus className="h-4 w-4" />
                  {t('dashboard_btn_add')}
                </ContextMenuItem>
                <ContextMenuSeparator />
                {/* disabled 条件与工具栏导出按钮保持一致（UX-6） */}
                <ContextMenuItem onClick={() => openExportDialog()} disabled={servers.length === 0}>
                  <Download className="h-4 w-4" />
                  {t('dashboard_btn_export_all')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => setShowImportDialog(true)}>
                  <Upload className="h-4 w-4" />
                  {t('dashboard_btn_import')}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
        </div>
      </div>
      </ServerActionsContext.Provider>

      {/* Add Server Dialog：统一使用现代化桌面级 ServerFormDialog */}
      {showAddDialog && (
        <ServerFormDialog
          open={showAddDialog}
          mode="add"
          initialTargetType="linux"
          initialGroupId={addDialogGroupId}
          onClose={() => { setShowAddDialog(false); setAddDialogGroupId(null) }}
          onSaved={() => { setShowAddDialog(false); setAddDialogGroupId(null); loadServers() }}
        />
      )}
      <RecycleBinDialog
        open={trashOpen}
        onOpenChange={setTrashOpen}
        onChanged={loadServers}
      />

      {/* Edit Server Dialog */}
      {editingServerId && (
        <EditServerDialog
          key={editingServerId}
          open={!!editingServerId}
          onClose={() => setEditingServerId(null)}
          onSaved={() => {
            setEditingServerId(null)
            loadServers()
          }}
          serverId={editingServerId}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('dash_delete_title')}
        description={t('dash_delete_desc').replace('{name}', deleteTarget?.name ?? '')}
        confirmLabel={t('dash_delete_confirm')}
        variant="destructive"
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />

      {/* Batch Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!batchDeleteTargets && batchDeleteTargets.length > 0}
        title={t('dash_batch_delete_title')}
        description={t('dash_batch_delete_desc').replace('{count}', String(batchDeleteTargets?.length ?? 0))}
        confirmLabel={t('dash_batch_delete_confirm')}
        variant="destructive"
        onConfirm={handleBatchDeleteConfirm}
        onCancel={handleBatchDeleteCancel}
      />



      {/* Export Servers Dialog */}
      <ExportServersDialog
        open={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        preselectIds={exportPreselectIds}
      />

      {/* Import Servers Dialog */}
      <ImportServersDialog
        open={showImportDialog}
        onClose={() => setShowImportDialog(false)}
      />

      {/* 批量 BMC 电源操作（选中集合中的 BMC 子集） */}
      <BatchBmcPowerDialog
        open={batchBmcPowerOpen}
        servers={servers.filter((s) => selectedServerIds.has(s.id) && s.targetType === 'bmc')}
        onClose={() => setBatchBmcPowerOpen(false)}
      />

      {/* 批量命令执行（选中集合中可执行 SSH 命令的服务器子集，排除 BMC 与 Serial） */}
      <BatchCommandDialog
        open={batchCommandOpen}
        servers={servers.filter((s) => selectedServerIds.has(s.id) && s.targetType !== 'bmc' && s.targetType !== 'serial' && s.protocol !== 'serial')}
        onClose={() => setBatchCommandOpen(false)}
      />
    </div>
  )
}

/** 服务器右键菜单 */
function ServerContextMenu({ children, server, selected, selectedCount, selectedServerIds, onBatchOpenSameWorkspace, onBatchOpenSeparate, onBatchOpenSftp, onBatchOpenFilesSplit, onClearSelection, onBatchDelete, onRename, onDelete, onEdit }: {
  children: React.ReactNode
  server: ServerType
  selected: boolean
  selectedCount: number
  selectedServerIds: Set<string>
  onBatchOpenSameWorkspace: () => void
  onBatchOpenSeparate: () => void
  onBatchOpenSftp: () => void
  onBatchOpenFilesSplit: () => void
  onClearSelection: () => void
  onBatchDelete: () => void
  onRename: (s: ServerType) => void
  onDelete: (s: ServerType) => void
  onEdit: (id: string) => void
}) {
  const { t } = useTranslation()
  const openTab = useAppStore(s => s.openTab)
  const openSftpWithServers = useAppStore(s => s.openSftpWithServers)
  const { onAddServer, onExportServer, onExportAll, onImport, onBatchBmcPower, onBatchCommand } = useServerActions()
  // 「移动到分组」：自选多台服务器批量改归属（右键项被选中集合内时移动整组选中）
  const serverGroups = useAppStore(s => s.serverGroups)
  const updateServer = useAppStore(s => s.updateServer)
  const { toast } = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const handleMoveToGroup = useCallback(async (groupId: string | null) => {
    const ids = selected && selectedCount > 1 && selectedServerIds.has(server.id)
      ? Array.from(selectedServerIds)
      : [server.id]
    // 单台且目标分组与当前相同：无需移动，给出反馈后退出
    if (ids.length === 1 && groupId === server.groupId) {
      toast.info(t('group_already_in'))
      return
    }
    const groupName = groupId
      ? serverGroups.find((g) => g.id === groupId)?.name ?? ''
      : t('group_ungrouped')
    try {
      const result = await sshService.moveServersToGroup(ids, groupId)
      if (result.failed.length > 0) {
        toast.error(`${t('common_op_failed')}: ${result.failed[0]}`)
      }
      for (const id of ids) {
        if (!result.failed.includes(id)) updateServer(id, { groupId })
      }
      playSound(SoundType.Toggle)
      if (result.failed.length === 0) {
        toast.success(
          ids.length > 1
            ? t('group_move_success_multi', { count: ids.length, name: groupName })
            : t('group_move_success_one', { name: groupName }),
        )
      }
    } catch (e) {
      toast.error(`${t('common_op_failed')}: ${(e as Error).message || e}`)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectedCount, selectedServerIds, server.id, serverGroups, updateServer, t, toast])

  // 多选且当前服务器在选中集合内时，顶部展示批量操作项
  const showBatch = selected && selectedCount > 1

  return (
    <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        {showBatch ? (
          <>
            {/* 多选模式：仅保留批量操作，移除所有针对单个服务器的操作（重命名/打开终端/编辑/删除等） */}
            {/* ≤6 才显示「在同一个工作台打开」：>6 退化为独立标签页，与「打开」行为重复，故隐藏 */}
            {selectedCount <= 6 && (
              <ContextMenuItem onClick={onBatchOpenSameWorkspace}>
                <LayoutGrid className="h-4 w-4" />
                {t('dash_batch_open_same_workspace')}
                <span className="ml-auto text-[10px] text-muted-foreground">{selectedCount}</span>
              </ContextMenuItem>
            )}
            <ContextMenuItem onClick={onBatchOpenSeparate}>
              <FolderOpen className="h-4 w-4" />
              {t('dash_batch_open_separate')}
            </ContextMenuItem>
            <ContextMenuItem onClick={onBatchOpenSftp}>
              <ArrowLeftRight className="h-4 w-4" />
              {t('dash_batch_open_sftp')}
              <span className="ml-auto text-[10px] text-muted-foreground">{selectedCount}</span>
            </ContextMenuItem>
            {selectedCount <= 6 && (
              <ContextMenuItem onClick={onBatchOpenFilesSplit}>
                <FolderOpen className="h-4 w-4" />
                {t('dash_batch_open_files_split')}
                <span className="ml-auto text-[10px] text-muted-foreground">{selectedCount}</span>
              </ContextMenuItem>
            )}
            {/* 批量 BMC 电源操作：右键的服务器为 BMC 类型时展示（弹窗内自动过滤选中集合中的 BMC 子集） */}
            {server.targetType === 'bmc' && (
              <ContextMenuItem onClick={onBatchBmcPower}>
                <ServerCog className="h-4 w-4" />
                {t('dash_batch_bmc_power')}
              </ContextMenuItem>
            )}
            {/* 批量命令执行：右键的服务器为 SSH/Linux 类型时展示（排除 BMC 与 Serial） */}
            {server.targetType !== 'bmc' && server.targetType !== 'serial' && server.protocol !== 'serial' && (
              <ContextMenuItem onClick={onBatchCommand}>
                <TerminalSquare className="h-4 w-4" />
                {t('dash_batch_command')}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onClearSelection}>
              <X className="h-4 w-4" />
              {t('dash_batch_clear_selection')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive focus:text-destructive" onClick={onBatchDelete}>
              <Trash2 className="h-4 w-4" />
              {t('dash_batch_delete')}
              <span className="ml-auto text-[10px] text-destructive/80 font-mono">{selectedCount}</span>
            </ContextMenuItem>
          </>
        ) : (
          <>
            {/* 单选模式：针对该服务器的全部操作 */}
            <ContextMenuItem onClick={() => onRename(server)}>
              <Pencil className="h-4 w-4" />
              {t('dash_rename')}
            </ContextMenuItem>
            {isModuleAvailable(server.targetType, 'terminal') && (
              <ContextMenuItem onClick={() => {
                if (server.targetType === 'windows' && (!server.port || server.port <= 0)) {
                  toast.warning(t('server_no_ssh_port') || '未配置 SSH 端口')
                  return
                }
                openTab(server.id, server.name, 'terminal')
              }}>
                <Terminal className="h-4 w-4" />
                {t('dash_open_terminal')}
              </ContextMenuItem>
            )}
            {isModuleAvailable(server.targetType, 'files') && (
              <>
                <ContextMenuItem onClick={() => {
                  if (server.targetType === 'windows' && (!server.port || server.port <= 0)) {
                    toast.warning(t('server_no_ssh_port') || '未配置 SSH 端口')
                    return
                  }
                  openSftpWithServers([server.id])
                }}>
                  <ArrowLeftRight className="h-4 w-4" />
                  {t('dash_open_sftp')}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => {
                  if (server.targetType === 'windows' && (!server.port || server.port <= 0)) {
                    toast.warning(t('server_no_ssh_port') || '未配置 SSH 端口')
                    return
                  }
                  openTab(server.id, server.name, 'files')
                }}>
                  <FolderOpen className="h-4 w-4" />
                  {t('dash_open_files')}
                </ContextMenuItem>
              </>
            )}
            {isModuleAvailable(server.targetType, 'bmc') && (
              <ContextMenuItem onClick={() => openTab(server.id, server.name, 'bmc')}>
                <ServerCog className="h-4 w-4" />
                {t('dash_open_bmc') || '打开带外管理'}
              </ContextMenuItem>
            )}
            {server.targetType === 'windows' && (
              <ContextMenuItem onClick={async () => {
                if (!server.rdpPort || server.rdpPort <= 0) {
                  toast.warning(t('server_no_rdp_port') || '未配置 RDP 端口')
                  return
                }
                if (backend) {
                  await backend.rdp.launch({
                    serverId: server.id,
                    rdpPort: server.rdpPort,
                  })
                }
              }}>
                <Monitor className="h-4 w-4" />
                {t('dash_open_rdp') || '打开远程桌面'}
              </ContextMenuItem>
            )}
            {isModuleAvailable(server.targetType, 'overview') && (
              <ContextMenuItem onClick={() => {
                if (server.targetType === 'windows' && (!server.port || server.port <= 0)) {
                  toast.warning(t('server_no_ssh_port') || '未配置 SSH 端口')
                  return
                }
                openTab(server.id, server.name, 'overview')
              }}>
                <Eye className="h-4 w-4" />
                {t('dash_view_detail')}
              </ContextMenuItem>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onEdit(server.id)}>
              <Pencil className="h-4 w-4" />
              {t('dash_edit')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            {/* 添加新服务器 / 导出导入操作 */}
            <ContextMenuItem onClick={onAddServer}>
              <Plus className="h-4 w-4" />
              {t('dash_add_new')}
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onExportServer(server.id)}>
              <FileDown className="h-4 w-4" />
              {t('dash_export_this')}
            </ContextMenuItem>
            <ContextMenuItem onClick={onExportAll}>
              <Download className="h-4 w-4" />
              {t('dash_export_all')}
            </ContextMenuItem>
            <ContextMenuItem onClick={onImport}>
              <Upload className="h-4 w-4" />
              {t('dash_import_servers')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(server)}>
              <Trash2 className="h-4 w-4" />
              {t('dash_delete')}
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <FolderTree className="mr-2 h-4 w-4 text-muted-foreground" />
            {t('server_move_to_group')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-52 p-1">
            <GroupTreePicker
              groups={serverGroups}
              value={server.groupId || null}
              onPick={(id) => {
                handleMoveToGroup(id)
                setMenuOpen(false)
              }}
              ungroupedLabel={t('group_ungrouped')}
              size="compact"
            />
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}



/** 列表视图 */
const ServerListView = memo(function ServerListView({ servers, selectedServerIds, selectedCount, onSelect, onBatchOpenSameWorkspace, onBatchOpenSeparate, onBatchOpenSftp, onBatchOpenFilesSplit, onClearSelection, onBatchDelete, onRename, onDelete, onEdit, renamingServerId, renameValue, onRenameValueChange, onRenameSubmit, onRenameCancel, onListDragStart }: {
  servers: ServerType[]
  selectedServerIds: Set<string>
  selectedCount: number
  onSelect: (serverId: string, ctrlKey: boolean) => void
  onBatchOpenSameWorkspace: () => void
  onBatchOpenSeparate: () => void
  onBatchOpenSftp: () => void
  onBatchOpenFilesSplit: () => void
  onClearSelection: () => void
  onBatchDelete: () => void
  onRename: (s: ServerType) => void
  onDelete: (s: ServerType) => void
  onEdit: (id: string) => void
  renamingServerId: string | null
  renameValue: string
  onRenameValueChange: (v: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  /** 拖拽开始委托处理（冒泡捕获行拖拽，写入分组移动所需的 dataTransfer 负载） */
  onListDragStart: (e: React.DragEvent) => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const openTab = useAppStore(s => s.openTab)
  const updateServer = useAppStore(s => s.updateServer)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 虚拟化滚动容器引用（PERF-5）
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // 行虚拟化：固定行高 44px，仅渲染可视区域行，50+ 服务器列表不卡顿

  const rowVirtualizer = useVirtualizer({
    count: servers.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 44,
    overscan: 10,
  })

  const handleCopyIp = useCallback(async (e: React.MouseEvent, server: ServerType) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(server.host)
      setCopiedId(server.id)
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current)
      }
      copiedTimeoutRef.current = setTimeout(() => setCopiedId(null), 1500)
      playSound(SoundType.Click)
    } catch (e) {
      toast.error(`${t('common_copy_failed')}: ${(e as Error).message || e}`)
    }
  }, [toast, t])

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) {
        clearTimeout(copiedTimeoutRef.current)
      }
    }
  }, [])

  const handleToggleFavorite = useCallback(async (e: React.MouseEvent, server: ServerType) => {
    e.stopPropagation()
    const newFav = !server.favorite
    try {
      await sshService.updateServer(server.id, { favorite: newFav })
      updateServer(server.id, { favorite: newFav })
      playSound(SoundType.Toggle)
    } catch (e) {
      toast.error(`${t('common_op_failed')}: ${(e as Error).message || e}`)
    }
  }, [updateServer, toast, t])

  const lastConnectTimeRef = useRef<Record<string, number>>({})
  const handleConnectServer = useCallback((server: ServerType) => {
    const now = Date.now()
    if (now - (lastConnectTimeRef.current[server.id] || 0) < 600) return
    lastConnectTimeRef.current[server.id] = now

    if (server.targetType === 'windows') {
      const hasSsh = Boolean(server.port && server.port > 0)
      const hasRdp = Boolean(server.rdpPort && server.rdpPort > 0)
      if (hasSsh) {
        openTab(server.id, server.name, 'terminal')
      } else if (hasRdp) {
        recordConnection(server.id)
        backend?.rdp.launch({ serverId: server.id, rdpPort: server.rdpPort })
      } else {
        toast.warning(t('server_no_port') || '未配置连接端口')
      }
    } else if (server.targetType === 'bmc') {
      openTab(server.id, server.name, 'bmc')
    } else {
      openTab(server.id, server.name, 'terminal')
    }
  }, [openTab, toast, t])

  // 备注列加宽至 minmax(140px, 1.5fr)，避免内容稍长即被截断（UX-10）
  const gridTemplate = 'grid-cols-[28px_1fr_140px_1fr_minmax(140px,1.5fr)_80px]'

  return (
    <Card className="flex-1 flex flex-col min-h-0">
      <CardContent className="p-0 flex flex-col flex-1 min-h-0">
        <div className={`grid ${gridTemplate} gap-2 px-4 py-2.5 text-xs text-muted-foreground font-medium border-b bg-muted/30`}>
          <span></span>
          <span>{t('dash_th_name')}</span>
          <span>IP</span>
          <span>{t('dash_th_tags')}</span>
          <span>{t('dash_th_notes')}</span>
          <span className="text-right">{t('dash_th_action')}</span>
        </div>
        {/* 虚拟化滚动容器（PERF-5）：50+ 服务器仅渲染可视区域行；maxHeight 保证虚拟izer 有界高度 */}
        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-y-auto"
          onDragStart={onListDragStart}
        >
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: 'relative',
              width: '100%',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const server = servers[virtualRow.index]
              if (!server) return null
              const row = (
                <div
                  data-server-id={server.id}
                  draggable
                  className={cn(
                    `server-list-row grid ${gridTemplate} gap-2 px-4 py-2 cursor-pointer items-center text-sm border-b select-none transition-colors duration-150`,
                    selectedServerIds.has(server.id) && "is-selected",
                  )}
                  onClick={(e) => { e.stopPropagation(); onSelect(server.id, e.ctrlKey || e.metaKey) }}
                  onDoubleClick={() => handleConnectServer(server)}
                >
                  <OsIcon osType={server.osType} osInfo={server.osInfo} targetType={server.targetType} className="h-6 w-6 rounded-md flex-shrink-0 shadow-sm" />
                  <div className="flex items-center gap-2 min-w-0">
                    {renamingServerId === server.id ? (
                      <Input
                        ref={(el) => {
                          if (el) {
                            setTimeout(() => {
                              el.focus()
                              el.select()
                            }, 0)
                          }
                        }}
                        value={renameValue}
                        onChange={(e) => onRenameValueChange(e.target.value)}
                        onFocus={(e) => e.target.select()}
                        maxLength={100}
                        onBlur={onRenameSubmit}
                        onKeyDown={(e) => { if (e.key === 'Enter') onRenameSubmit(); if (e.key === 'Escape') onRenameCancel() }}
                        className="h-5 text-xs py-0 px-1"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="truncate font-medium">{server.name}</span>
                    )}
                    <button onClick={(e) => handleToggleFavorite(e, server)} className="flex-shrink-0" title={server.favorite ? t('dash_unfavorite') : t('dash_favorite')}>
                      <Star className={cn("h-3 w-3 transition-colors", server.favorite ? 'fill-amber-500 text-amber-500' : 'text-muted-foreground/30 hover:text-amber-500')} />
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground font-mono">{server.host}</span>
                    <button onClick={(e) => handleCopyIp(e, server)} className="flex-shrink-0">
                      {copiedId === server.id ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />}
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    {(Array.isArray(server.tags) ? server.tags : []).slice(0, 2).map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 rounded-md bg-muted/60 text-muted-foreground text-[9px] flex-shrink-0 border border-border/40 font-mono">{tag}</span>
                    ))}
                    {(Array.isArray(server.tags) ? server.tags.length : 0) > 2 && <span className="text-[9px] text-muted-foreground">+{(Array.isArray(server.tags) ? server.tags.length : 0) - 2}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground truncate">{server.notes || '-'}</span>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs gap-1"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleConnectServer(server)
                      }}
                    >
                      {server.targetType === 'windows'
                        ? ((!server.port || server.port <= 0) && server.rdpPort && server.rdpPort > 0 ? <Monitor className="h-3 w-3" /> : <Terminal className="h-3 w-3" />)
                        : server.targetType === 'bmc'
                          ? <ServerCog className="h-3 w-3" />
                          : <Terminal className="h-3 w-3" />}
                      {t('dash_btn_connect')}
                    </Button>
                  </div>
                </div>
              )
              // 虚拟化包装层：绝对定位到对应滚动偏移
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ServerContextMenu
                    server={server}
                    selected={selectedServerIds.has(server.id)}
                    selectedCount={selectedCount}
                    selectedServerIds={selectedServerIds}
                    onBatchOpenSameWorkspace={onBatchOpenSameWorkspace}
                    onBatchOpenSeparate={onBatchOpenSeparate}
                    onBatchOpenSftp={onBatchOpenSftp}
                    onBatchOpenFilesSplit={onBatchOpenFilesSplit}
                    onClearSelection={onClearSelection}
                    onBatchDelete={onBatchDelete}
                    onRename={onRename}
                    onDelete={onDelete}
                    onEdit={onEdit}
                  >
                    {row}
                  </ServerContextMenu>
                </div>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
})



/** 服务器卡片（包装右键菜单与按风格定制的分发渲染器） */
const ServerCard = memo(function ServerCard({
  server,
  selected,
  selectedCount,
  selectedServerIds,
  onBatchOpenSameWorkspace,
  onBatchOpenSeparate,
  onBatchOpenSftp,
  onBatchOpenFilesSplit,
  onClearSelection,
  onBatchDelete,
  onRename,
  onDelete,
  onEdit,
  onSelect,
  renamingServerId,
  renameValue,
  onRenameValueChange,
  onRenameSubmit,
  onRenameCancel,
}: ServerCardProps) {
  return (
    <ServerContextMenu
      server={server}
      selected={selected}
      selectedCount={selectedCount}
      selectedServerIds={selectedServerIds}
      onBatchOpenSameWorkspace={onBatchOpenSameWorkspace}
      onBatchOpenSeparate={onBatchOpenSeparate}
      onBatchOpenSftp={onBatchOpenSftp}
      onBatchOpenFilesSplit={onBatchOpenFilesSplit}
      onClearSelection={onClearSelection}
      onBatchDelete={onBatchDelete}
      onRename={onRename}
      onDelete={onDelete}
      onEdit={onEdit}
    >
      <div className="h-full w-full" data-server-id={server.id}>
        <StyleServerCard
          server={server}
          selected={selected}
          onSelect={onSelect}
          renamingServerId={renamingServerId}
          renameValue={renameValue}
          onRenameValueChange={onRenameValueChange}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
        />
      </div>
    </ServerContextMenu>
  )
})

export { OsIcon }



