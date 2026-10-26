import { Fragment, memo, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { listen } from '@tauri-apps/api/event'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useMarqueeSelection } from '@/hooks/use-marquee-selection'
import { MarqueeRect } from '@/components/ui/marquee-rect'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuShortcut
} from '@/components/ui/context-menu'
import {
  mkdir as mkdirLocal,
  rename as renameLocal,
  remove as removeLocal,
  writeTextFile as writeLocal,
  readTextFile as readTextFileLocal,
  readFile as readFileLocal,
} from '@tauri-apps/plugin-fs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Kbd } from '@/components/ui/kbd'
import { CodeEditor } from '@/components/ui/code-editor'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import {
  ArrowUp,
  ArrowDown,
  ChevronRight,
  ChevronDown,
  Download,
  Folder,
  FolderOpen,
  FolderUp,
  HardDrive,
  Loader2,
  Monitor,
  RefreshCw,
  Pause,
  Play,
  Search,
  Upload,
  UploadCloud,
  X,
  Link,
  Trash2,
  Bookmark,
  Edit2,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  File,
  Plus,
  Server,
  Shield,
  ArrowLeftRight,
  ArrowRight,
  ArrowLeft,
  Copy,
  Check,
  Ban,
  AlertCircle,
  Eye,
  Save,
  Pencil,
  WifiOff,
  FileSpreadsheet,
  Braces,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatSftpError, isSftpConnectionError } from '@/lib/sftp-error'
import { playSound, SoundType } from '@/lib/sound'
import { ErrorDialog } from '@/components/ui/error-dialog'
import { backend } from '@/services/api'
import { sshService } from '@/services/ssh-service'
import { ConnectionState } from '@/services/ssh-connection-state'
import { reconnectManager, useReconnectState } from '@/services/reconnect-manager'
import { useAppStore } from '@/store'
import { useFileExplorerPreferences } from '@/hooks/use-file-explorer-preferences'
import { useTranslation } from '@/i18n'
import type { LocalFileEntry, FileEntry, TransferProgressData, SftpDiagnostics } from '@/services/api/types'
import { getPathUtils } from '@/targets'
import {
  getParentPath,
  getPathBreadcrumbs,
  formatFileSize,
  renderFileIcon,
  readLastLocalPath,
  writeLastLocalPath,
  getFileTypeLabel,
  HTML_EXT_SET,
  isBinaryContent,
} from '@/components/workspace/modules/local-file-picker-utils'
import {
  decodeReadResult,
  decodeTextWithEncoding,
  encodeTextFile,
  normalizeEol,
  detectEol,
  bytesToBase64,
  base64ToBytes,
  SUPPORTED_ENCODINGS,
  eolLabel,
} from '@/utils/text-file-codec'
import { isConfirmSuppressed, suppressConfirm } from '@/utils/confirm-suppress'
import { UniversalFileViewer } from '@/components/ui/universal-file-viewer'
import { MarkdownViewer } from '@/components/ui/markdown-viewer'
import { ResizablePreviewDialog } from '@/components/ui/resizable-preview-dialog'
import { ArchiveFileIcon } from '@/components/ui/file-icons'
import { OsIcon } from '@/pages/dashboard'
import { SftpBreadcrumbBar } from '@/components/layout/sftp-breadcrumb-bar'
import { QshellLoader } from '@/components/ui/qshell-loader'
import { FileSkeletonList } from '@/components/sftp/file-skeleton-list'
import {
  type SftpViewMode,
  type ConflictAction,
  type TransferRecordItem,
  type TransferChildRecord,
  type SearchResult,
  type FileViewerState,
  type RightTab,
} from '@/components/sftp/sftp-types'
export type { SftpViewMode }
import {
  CLIPBOARD_FEEDBACK_MS,
  RATE_SMOOTHING_ALPHA,
  TRANSFER_REFRESH_INTERVAL_MS,
  MAX_RIGHT_TABS,
  INITIAL_VIEWER_STATE,
  createEmptyRightTab,
  getErrorMessage,
  isAlreadyGoneError,
  isResumableTmpPath,
  isSupportedArchiveName,
  formatTransferSize,
  formatTransferRate,
  formatClockTime,
  toSftpConnId,
  toBaseServerId,
  joinPath,
  validateFileName,
  generateDuplicateName,
  formatFailureList,
  getFileExt,
  getPreviewKind,
  getMimeFromExt,
  sortFiles,
  getSyncPathFromRoot,
  getLocalOs,
  parsePermissions,
  getOctalMode,
  getIconSizeClass,
  runWithConcurrency,
} from '@/components/sftp/sftp-utils'
import { SftpDeleteDialog } from '@/components/sftp/sftp-delete-dialog'
import { SftpPermissionsDialog } from '@/components/sftp/sftp-permissions-dialog'
import { SftpConflictDialog } from '@/components/sftp/sftp-conflict-dialog'
import { SftpExtractionProgressDialog } from '@/components/sftp/sftp-extraction-progress-dialog'
import { SftpExtractConflictDialog } from '@/components/sftp/sftp-extract-conflict-dialog'
import { SftpOverwriteDialog } from '@/components/sftp/sftp-overwrite-dialog'
import { SftpDiagnosticsDialog } from '@/components/sftp/sftp-diagnostics-dialog'
import { InlineRenameInput } from '@/components/sftp/inline-rename-input'
import { FilePropertiesTooltip } from '@/components/sftp/file-properties-tooltip'
import {
  GroupFilterChip,
  useServerFilterList,
  SftpActionsDropdown,
  SftpBookmarkDropdown,
} from '@/components/sftp/sftp-dropdowns'

// 传输明细固定行高（px）：虚拟滚动无需逐行测量，偏移稳定
const TRANSFER_CHILD_ROW_HEIGHT = 24
// 超过该数量才启用虚拟滚动；少量子记录直接整表渲染，避免虚拟化开销
const TRANSFER_CHILD_VIRTUALIZE_THRESHOLD = 60

/**
 * 传输明细子文件列表。
 * 此前用 slice(0, 2000).map 一次性挂载全部行（单条展开可达 1 万+ DOM 节点），
 * 配合高频进度事件重渲染会直接卡死界面。超过阈值后改为虚拟滚动，只渲染可视区域。
 */
const TransferChildList = memo(function TransferChildList({
  childRecords,
  basePath,
  maxHeight,
  fixedHeight,
  isTransferring,
}: {
  childRecords: TransferChildRecord[]
  basePath?: string
  maxHeight: number
  fixedHeight?: number
  isTransferring: boolean
}) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualize = childRecords.length > TRANSFER_CHILD_VIRTUALIZE_THRESHOLD
  const virtualizer = useVirtualizer({
    count: virtualize ? childRecords.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TRANSFER_CHILD_ROW_HEIGHT,
    overscan: 12,
  })

  const normalizeBase = basePath?.replace(/\\/g, '/').replace(/\/$/, '')

  const renderRow = (child: TransferChildRecord) => {
    // 空文件 total=0，无法用除法计算百分比；一旦状态完成应显示 100%。
    // 同时限制范围，避免异常/迟到进度事件显示负数或超过 100%。
    const childPercent = child.status === 'completed'
      ? 100
      : child.total > 0
        ? Math.min(100, Math.max(0, Math.round((child.current / child.total) * 100)))
        : 0
    const normalizedChildPath = child.path.replace(/\\/g, '/')
    const displayPath = normalizeBase && normalizedChildPath.startsWith(`${normalizeBase}/`)
      ? normalizedChildPath.slice(normalizeBase.length + 1)
      : normalizedChildPath
    return (
      <div
        key={child.path}
        className="grid h-6 grid-cols-[minmax(0,1fr)_minmax(100px,200px)_110px] items-center gap-2 border-b border-border/20 px-2 text-[10px] last:border-b-0 overflow-hidden"
      >
        <span className="truncate min-w-0 font-mono" title={child.path}>{displayPath}</span>
        <span
          className={cn(
            'truncate min-w-0 font-medium',
            child.status === 'completed' ? 'text-green-600' :
            child.status === 'failed' ? 'text-red-500' :
            child.status === 'canceled' ? 'text-amber-500' :
            child.status === 'transferring' ? 'text-primary' : 'text-muted-foreground'
          )}
          title={child.status === 'failed' ? (child.error || t('sftp_transfer_failed')) : undefined}
        >
          {child.status === 'completed' ? t('sftp_transfer_completed') :
            child.status === 'failed' ? (child.error || t('sftp_transfer_failed')) :
            child.status === 'canceled' ? t('sftp_transfer_canceled') :
            child.status === 'transferring' ? t('sftp_transfer_transferring') : (t('sftp_transfer_waiting') || '排队中')}
        </span>
        <div className="flex items-center gap-1 min-w-0">
          <div className="h-1 flex-1 overflow-hidden rounded bg-muted">
            <div className={cn('h-full', child.status === 'failed' ? 'bg-red-500' : child.status === 'completed' ? 'bg-green-500' : 'bg-primary')} style={{ width: `${Math.min(100, Math.max(0, childPercent))}%` }} />
          </div>
          <span className="w-7 text-right font-mono shrink-0">{childPercent}%</span>
        </div>
      </div>
    )
  }

  if (childRecords.length === 0) {
    return (
      <div className="rounded-md border border-border/40">
        <div className="px-2 py-3 text-center text-[10px] text-muted-foreground">
          {isTransferring ? t('sftp_transfer_transferring') : '暂无子文件记录'}
        </div>
      </div>
    )
  }

  const contentHeight = virtualize
    ? virtualizer.getTotalSize()
    : childRecords.length * TRANSFER_CHILD_ROW_HEIGHT

  return (
    <div
      ref={scrollRef}
      className="overflow-auto rounded-md border border-border/40"
      style={virtualize
        ? { height: fixedHeight ?? maxHeight }
        : { maxHeight, height: contentHeight > maxHeight ? maxHeight : undefined }}
    >
      {virtualize ? (
        <div style={{ height: contentHeight, position: 'relative' }}>
          {virtualizer.getVirtualItems().map(v => {
            const child = childRecords[v.index]
            if (!child) return null
            return (
              <div
                key={child.path}
                className="absolute left-0 right-0 top-0"
                style={{ transform: `translateY(${v.start}px)` }}
              >
                {renderRow(child)}
              </div>
            )
          })}
        </div>
      ) : (
        childRecords.map(renderRow)
      )}
    </div>
  )
})

export function SftpPanel() {
  const { t } = useTranslation()
  // Async directory loads, progress events and delayed UI work can outlive the
  // panel when a workspace tab is closed. This guard prevents late callbacks
  // from mutating state after unmount and makes cleanup deterministic.
  const mountedRef = useRef(true)
  // tRef：持有最新的 t 引用，供空依赖 useEffect 回调使用，避免语言切换后文案冻结在首次渲染
  const tRef = useRef(t)
  tRef.current = t
  // toastRef：持有最新的 toast 引用，供空依赖 useCallback/useEffect 使用
  const { toast } = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const { servers, serverGroups } = useAppStore()
  // 传输并发量（1-8），从全局 store 读取，运行时变更立即生效（每次传输读取最新值）
  const sftpTransferConcurrency = useAppStore((s) => s.sftpTransferConcurrency)
  // 传输限速（KB/s）：从 store 读取（持久化），变更时同步到后端
  const transferRateLimit = useAppStore((s) => s.transferRateLimit)
  // SFTP 传输排除与忽略规则配置
  const sftpExclusionEnabled = useAppStore((s) => s.sftpExclusionEnabled)
  const sftpExclusionPatterns = useAppStore((s) => s.sftpExclusionPatterns)
  const sftpRespectGitignore = useAppStore((s) => s.sftpRespectGitignore)
  // SFTP 视图与隐藏文件配置：本地与远程面板完全独立
  const sftpLocalViewMode = useAppStore((s) => s.sftpLocalViewMode) || 'list'
  const sftpRemoteViewMode = useAppStore((s) => s.sftpRemoteViewMode) || 'list'
  const sftpLocalShowHidden = useAppStore((s) => s.sftpLocalShowHidden)
  const setSftpLocalShowHidden = useAppStore((s) => s.setSftpLocalShowHidden)
  const sftpRemoteShowHidden = useAppStore((s) => s.sftpRemoteShowHidden)
  const setSftpRemoteShowHidden = useAppStore((s) => s.setSftpRemoteShowHidden)
  // SFTP 批量打开联动：待在 SFTP 传输面板中批量连接打开的服务器 ID 列表
  const sftpPendingOpenServerIds = useAppStore((s) => s.sftpPendingOpenServerIds)
  const clearSftpPendingOpenServers = useAppStore((s) => s.clearSftpPendingOpenServers)

  // 1. 本地 Explorer 状态
  const [localPath, setLocalPath] = useState<string>('')
  // 用 ref 跟踪最新 localPath，传输完成刷新时对比，避免刷新到已离开的目录
  const localPathRef = useRef<string>('')
  localPathRef.current = localPath
  const [localFiles, setLocalFiles] = useState<LocalFileEntry[]>([])
  // 用 ref 跟踪最新 localFiles，供 pasteFilesFromClipboard 等空依赖 useCallback 读取，避免闭包陷阱
  const localFilesRef = useRef<LocalFileEntry[]>([])
  localFilesRef.current = localFiles
  const [localLoading, setLocalLoading] = useState<boolean>(false)
  const [openingLocalPath, setOpeningLocalPath] = useState<string | null>(null)
  const [localSearch, setLocalSearch] = useState<string>('')
  const [syncBrowsing, setSyncBrowsing] = useState<boolean>(false)
  const [leftSideType, setLeftSideType] = useState<"local" | "remote">("local")
  const [rightSideType] = useState<"local" | "remote">("remote")
  const [leftServerId, setLeftServerId] = useState<string>("")
  const leftServerIdRef = useRef<string>("")
  leftServerIdRef.current = leftServerId
  const isLeftRemote = leftSideType === 'remote' && !!leftServerId
  const [connectingLeftServerId, setConnectingLeftServerId] = useState<string>("")
  const [compareActive, setCompareActive] = useState<boolean>(false)
  // 同步浏览配对根：开启同步时锁定两侧当前路径，作为后续相对路径计算的基准
  // 对齐 WinSCP 机制 —— 配对根固定，避免不同步跳转导致基准漂移
  const syncPairRootRef = useRef<{ local: string; remote: string } | null>(null)
  // 切换来源标记：'user' = 用户主动切换（应触发同步），'sync' = 同步触发的切换（不反向触发）
  // 替代旧 isSyncNavigatingRef boolean flag，避免快速连续切换时同步被吞没
  const syncSourceRef = useRef<'user' | 'sync'>('user')
  const [selectedLocalPaths, setSelectedLocalPaths] = useState<Set<string>>(new Set())
  const [localError, setLocalError] = useState<string | null>(null)
  const [systemRoots, setSystemRoots] = useState<string[]>([])
  const [leftViewMode, setLeftViewMode] = useState<SftpViewMode>(sftpLocalViewMode)
  const [rightViewMode, setRightViewMode] = useState<SftpViewMode>(sftpRemoteViewMode)

  const handleSetLeftViewMode = useCallback((mode: SftpViewMode) => {
    setLeftViewMode(mode)
  }, [])

  const handleSetRightViewMode = useCallback((mode: SftpViewMode) => {
    setRightViewMode(mode)
  }, [])

  useEffect(() => {
    setLeftViewMode(sftpLocalViewMode)
  }, [sftpLocalViewMode])

  // 2. 远程 Explorer 状
  const [selectedServerId, setSelectedServerId] = useState<string>('')
  // ref 镜像：供 onStateChanged 订阅（订阅仅注册一次）内读取当前选中服务器，避免闭包过期
  const selectedServerIdRef = useRef<string>('')
  selectedServerIdRef.current = selectedServerId
  const [connectingServerId, setConnectingServerId] = useState<string>('')
  const [remotePath, setRemotePath] = useState<string>('')
  // Windows 远程盘符列表（如 ['C:', 'D:']），用于磁盘切换栏
  const [remoteDrives, setRemoteDrives] = useState<string[]>([])
  // 用 ref 跟踪最新 remotePath，上传完成刷新时对比，避免刷新到已离开的目录
  const remotePathRef = useRef<string>('')
  // loadRemoteDirectory / loadLocalDirectory 的 ref 包装，供空依赖 useEffect 内调用最新版本
  const loadRemoteDirectoryRef = useRef<(serverId: string, path: string) => Promise<void> | void>(() => {})
  const loadLocalDirectoryRef = useRef<(path: string, overrideSideType?: 'local' | 'remote', overrideServerId?: string) => Promise<void> | void>(() => {})
  remotePathRef.current = remotePath
  const [remoteFiles, setRemoteFiles] = useState<FileEntry[]>([])
  // 用 ref 跟踪最新 remoteFiles，供 pasteFilesFromClipboard 等空依赖 useCallback 读取，避免闭包陷阱
  const remoteFilesRef = useRef<FileEntry[]>([])
  remoteFilesRef.current = remoteFiles
  const [remoteLoading, setRemoteLoading] = useState<boolean>(false)
  const [remoteSearch, setRemoteSearch] = useState<string>('')
  // 递归搜索模式：'filter'=当前目录过滤（默认），'recursive'=递归搜索子目录
  const [searchMode, setSearchMode] = useState<'filter' | 'recursive'>('filter')
  // 递归搜索关键词（独立于 remoteSearch，避免两种模式互相污染）
  const [recursiveSearchPattern, setRecursiveSearchPattern] = useState<string>('')
  // 递归搜索结果
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  // 递归搜索进行中标志（显示 spinner）
  const [recursiveSearching, setRecursiveSearching] = useState<boolean>(false)
  const [selectedRemotePaths, setSelectedRemotePaths] = useState<Set<string>>(new Set())
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [isRemoteDisconnected, setIsRemoteDisconnected] = useState<boolean>(false)
  const [remoteDisconnectedError, setRemoteDisconnectedError] = useState<string | null>(null)
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false)
  const reconnectState = useReconnectState(selectedServerId)
  const [openingRemotePath, setOpeningRemotePath] = useState<string | null>(null)
  const [copiedLocalIp, setCopiedLocalIp] = useState<boolean>(false)

  // ─────────────────────────────────────────────────────────────
  // 右侧多标签状态
  // - rightTabs：所有右侧标签的数据真源
  // - activeRightTabId：当前激活标签 ID
  // - 原 useState（selectedServerId/remotePath/...）作为 active tab 的工作副本镜像
  //   切换 tab 时由 switchToTab 同步：先保存当前工作副本 → 再恢复目标 tab 工作副本
  // ─────────────────────────────────────────────────────────────
  const [rightTabs, setRightTabs] = useState<RightTab[]>([])
  const rightTabsRef = useRef<RightTab[]>([])
  rightTabsRef.current = rightTabs
  const inProgressBatchServerIdsRef = useRef<Set<string>>(new Set())
  const [activeRightTabId, setActiveRightTabId] = useState<string>('')
  const activeRightTabIdRef = useRef<string>('')
  activeRightTabIdRef.current = activeRightTabId
  const activeRightTab = rightTabs.find(t => t.id === activeRightTabId) || null

  // 选服视图批量选择状态
  const [batchSelectedServerIds, setBatchSelectedServerIds] = useState<Set<string>>(new Set())

  // Local/Remote context menu and operations states
  const [localContextMenuFile, setLocalContextMenuFile] = useState<LocalFileEntry | null>(null)
  const [remoteContextMenuFile, setRemoteContextMenuFile] = useState<FileEntry | null>(null)
  const [extractingArchivePath, setExtractingArchivePath] = useState<string | null>(null)
  const [pendingExtractConflict, setPendingExtractConflict] = useState<{
    archivePath: string
    destination: string
    resolve: (action: 'overwrite' | 'keep' | 'cancel') => void
  } | null>(null)
  const [pendingToolInstall, setPendingToolInstall] = useState<{
    tool: string
    resolve: (confirmed: boolean) => void
  } | null>(null)
  const [extractionProgressOpen, setExtractionProgressOpen] = useState(false)
  const [extractionProgress, setExtractionProgress] = useState(0)
  const [extractionProgressStatus, setExtractionProgressStatus] = useState<'running' | 'success' | 'failed'>('running')
  const [extractionProgressPhase, setExtractionProgressPhase] = useState('')
  const [extractionProgressPath, setExtractionProgressPath] = useState('')
  const extractionAutoCloseTimerRef = useRef<number | null>(null)

  // 兜底：等待用户选择的 Promise 在组件卸载（关闭面板/页面刷新）时自动取消，
  // 避免 resolve 永不触发导致 extractingArchivePath 全局锁死、后续解压点击被静默吞掉。
  // 正常流程中用户点击按钮时 Promise 已先 resolve，cleanup 的二次 resolve 会被 Promise 忽略，无副作用。
  useEffect(() => {
    if (!pendingToolInstall) return
    const resolve = pendingToolInstall.resolve
    return () => resolve(false)
  }, [pendingToolInstall])
  useEffect(() => {
    if (!pendingExtractConflict) return
    const resolve = pendingExtractConflict.resolve
    return () => resolve('cancel')
  }, [pendingExtractConflict])
  const [renameSide, setRenameSide] = useState<'local' | 'remote'>('local')
  const [deleteSide, setDeleteSide] = useState<'local' | 'remote'>('local')
  const [createFolderSide, setCreateFolderSide] = useState<'local' | 'remote'>('local')
  const [createFileSide, setCreateFileSide] = useState<'local' | 'remote'>('local')
  // 远程操作目标服务器 ID：当左侧也是远程服务器时，左侧的删除/重命名/权限/归档操作需针对 leftServerId
  // 为空时回退到 selectedServerId（右侧），保持原有行为
  const [deleteServerId, setDeleteServerId] = useState<string>('')
  const [renameServerId, setRenameServerId] = useState<string>('')
  const [permissionsServerId, setPermissionsServerId] = useState<string>('')

  const [showCreateFile, setShowCreateFile] = useState<boolean>(false)
  const [newFileName, setNewFileName] = useState<string>('')

  // 文件夹和操作的目标与显示状态
  const [deleteTarget, setDeleteTarget] = useState<LocalFileEntry | FileEntry | null>(null)
  // 多选删除：当不为 null 时，删除操作作用于该路径数组（过滤掉 '..'）；deleteTarget 仅用于保持对话框打开与显示首项
  const [deleteMultiPaths, setDeleteMultiPaths] = useState<string[] | null>(null)
  // 删除可能需要递归遍历大量远程文件。显式锁定确认框并展示当前项，避免重复提交。
  const [deletePending, setDeletePending] = useState(false)
  const [deleteProgress, setDeleteProgress] = useState<{ current: number; total: number; path: string } | null>(null)
  const deletePendingRef = useRef(false)
  // Shift 范围选择锚点：记录上次单选的行索引（基于 filteredLocalFiles/filteredRemoteFiles）
  const lastSelectedLocalIndexRef = useRef<number>(-1)
  const lastSelectedRemoteIndexRef = useRef<number>(-1)
  const [renameTarget, setRenameTarget] = useState<LocalFileEntry | FileEntry | null>(null)
  const [renameValue, setRenameValue] = useState<string>('')
  // 「再次点击重命名」交互：记录待触发的项；dblClickedRef 标记双击以避让进入目录/传输
  const pendingRenameRef = useRef<{ side: 'local' | 'remote'; path: string } | null>(null)
  // 多选状态下点击已选项时暂缓清空其他项（防止破坏拖拽多选文件）
  const pendingDeselectOthersLocalRef = useRef<string | null>(null)
  const pendingDeselectOthersRemoteRef = useRef<string | null>(null)
  const dblClickedRef = useRef(false)
  const [newFolderName, setNewFolderName] = useState<string>('')
  const [showCreateFolder, setShowCreateFolder] = useState<boolean>(false)

  // 关闭服务器标签前的二次确认：记录待关闭的服务器 id
  const [pendingCloseServerId, setPendingCloseServerId] = useState<string | null>(null)
  // 「不再提醒」勾选态：勾选 + 确认后持久化，后续断开服务器直接执行
  const [closeServerDontAskAgain, setCloseServerDontAskAgain] = useState(false)

  // Edit Permissions states
  const [permissionsTarget, setPermissionsTarget] = useState<FileEntry | null>(null)

  // === 键盘快捷键：当前焦点面板 ===
  // 'local' / 'remote' 表示焦点在本地/远程文件列表，null 表示无焦点
  // 快捷键据此判断作用对象；列表容器需 tabIndex={0} 才能获取焦点
  const [activePanel, setActivePanel] = useState<'local' | 'remote' | null>(null)
  const activePanelRef = useRef<'local' | 'remote' | null>(null)
  activePanelRef.current = activePanel
  const [perms, setPerms] = useState({
    owner: { read: false, write: false, execute: false },
    group: { read: false, write: false, execute: false },
    others: { read: false, write: false, execute: false },
    // 特殊权限位（setuid / setgid / sticky），与 parsePermissions 返回结构对齐
    setuid: false,
    setgid: false,
    sticky: false,
  })
  const [ownerUser, setOwnerUser] = useState('')
  const [ownerGroup, setOwnerGroup] = useState('')
  const [permissionsRecursive, setPermissionsRecursive] = useState(false)
  const [permSaving, setPermSaving] = useState(false)

  // 权限明细读数：随开关实时计算的权限串 + 八进制（与工作台 Files 模块一致）
  // octalMode 仍为 4 位（含 setuid/setgid/sticky 首位），用于保存；
  // 展示用 octalDisplay：无特殊权限位时省略前导 0（如 755），有则显示 4 位（如 4755）
  const octalMode = getOctalMode(perms)
  const octalDisplay = octalMode.startsWith('0') ? octalMode.slice(1) : octalMode
  const toSymString = (p: { read: boolean; write: boolean; execute: boolean }) =>
    `${p.read ? 'r' : '-'}${p.write ? 'w' : '-'}${p.execute ? 'x' : '-'}`
  const permsSymbol = `${permissionsTarget?.permissions?.[0] || '-'}${toSymString(perms.owner)}${toSymString(perms.group)}${toSymString(perms.others)}`

  // 主机搜索与过滤状态
  // 选服列表的筛选状态（标签/搜索/分组）按栏拆分：左右两栏各自独立，切换互不联动
  const [leftTagFilter, setLeftTagFilter] = useState<string | null>(null)
  const [rightTagFilter, setRightTagFilter] = useState<string | null>(null)
  const [rightHostSearch, setRightHostSearch] = useState<string>('')
  // 分组筛选：null = 全部分组；UNGROUPED_FILTER = 未分组；其余为分组 ID（含子组）
  const [leftGroupFilter, setLeftGroupFilter] = useState<string | null>(null)
  const [rightGroupFilter, setRightGroupFilter] = useState<string | null>(null)

  // 切换标签页或切换分组/标签筛选时清空批量勾选，避免上一标签页或隐藏主机的勾选残留到新标签页
  const tabAndFilterKey = `${activeRightTabId}|${rightGroupFilter}|${rightTagFilter}`
  const [prevTabAndFilterKey, setPrevTabAndFilterKey] = useState(tabAndFilterKey)
  if (tabAndFilterKey !== prevTabAndFilterKey) {
    setPrevTabAndFilterKey(tabAndFilterKey)
    setBatchSelectedServerIds(new Set())
  }
  // 注：transferStatus 浮窗已移除，统一用下方 transferRecords 表格展示（含进度条/速率）

  // === 面板内拖拽传输（Pointer 事件实现，绕开 Tauri dragDropEnabled 限制）===
  // 说明：Tauri 窗口 dragDropEnabled=true 会接管 webview 原生拖放，导致 HTML5
  // draggable 失效（拖不动/光标禁止）。改用 Pointer 事件自定义拖拽，
  // 既修复面板内互拖，又不影响 terminal/files 的系统文件拖入。
  const dragPointerRef = useRef<{
    source: 'local' | 'remote'
    files: FileEntry[]
    paths?: string[]
    startX: number
    startY: number
  } | null>(null)
  const isPointerDraggingRef = useRef<boolean>(false)
  const justDraggedRef = useRef<boolean>(false)
  const [isDraggingOverLocal, setIsDraggingOverLocal] = useState<boolean>(false)
  const [isDraggingOverRemote, setIsDraggingOverRemote] = useState<boolean>(false)
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; label: string; count: number } | null>(null)

  // SFTP 图标模式 Windows 风格悬浮属性弹窗状态
  const [hoveredCardInfo, setHoveredCardInfo] = useState<{
    file: LocalFileEntry | FileEntry
    side: 'local' | 'remote'
    rect: DOMRect
  } | null>(null)
  const hoverCardTimerRef = useRef<number | null>(null)

  const clearCardHover = useCallback(() => {
    if (hoverCardTimerRef.current) {
      window.clearTimeout(hoverCardTimerRef.current)
      hoverCardTimerRef.current = null
    }
    setHoveredCardInfo(null)
  }, [])

  const handleCardMouseEnter = useCallback((
    e: React.MouseEvent<HTMLElement>,
    file: LocalFileEntry | FileEntry,
    side: 'local' | 'remote'
  ) => {
    if (file.name === '..' || renameTarget || dragPointerRef.current) return
    if (hoverCardTimerRef.current) window.clearTimeout(hoverCardTimerRef.current)
    const currentTarget = e.currentTarget
    hoverCardTimerRef.current = window.setTimeout(() => {
      if (!currentTarget.isConnected) return
      setHoveredCardInfo({
        file,
        side,
        rect: currentTarget.getBoundingClientRect(),
      })
    }, 300)
  }, [renameTarget])

  // 执行面板间传输：source 为拖拽源面板，target 为放置面板
  const performTransfer = (
    source: 'local' | 'remote',
    target: 'local' | 'remote',
    st: { source: 'local' | 'remote'; files: FileEntry[]; paths?: string[] },
  ) => {
    if (source === 'local' && target === 'remote') {
      if (leftSideType === 'remote' && leftServerId) {
        void handleServerToServerTransfer(leftServerId, selectedServerId, remotePath, st.files, remoteFiles)
      } else if (st.paths) {
        void handleUploadLocalPaths(selectedServerId, remotePath, st.paths, remoteFiles)
      }
    } else if (source === 'remote' && target === 'local') {
      if (leftSideType === 'remote' && leftServerId) {
        void handleServerToServerTransfer(selectedServerId, leftServerId, localPath, st.files, localFiles)
      } else {
        void handleDownloadRemoteFiles(selectedServerId, localPath, st.files, localFiles)
      }
    }
  }
  const performTransferRef = useRef(performTransfer)
  performTransferRef.current = performTransfer

  // 命中测试：根据指针坐标判断落在哪个面板
  const hitPanel = (x: number, y: number): 'local' | 'remote' | null => {
    const el = document.elementFromPoint(x, y)
    const panelEl = el?.closest('[data-panel]')
    return (panelEl?.getAttribute('data-panel') as 'local' | 'remote' | null) || null
  }

  // === 虚拟滚动 ===
  // 文件行固定高度 40px（与 h-10 一致）
  const FILE_ROW_HEIGHT = 40
  // 本地/远程列表的滚动容器 ref（virtualizer 在 filteredXxxFiles 定义后创建）
  const localListRef = useRef<HTMLDivElement | null>(null)
  const remoteListRef = useRef<HTMLDivElement | null>(null)

  // === 框选（marquee）多选：空白处左键拖动框选文件（Ctrl+拖动追加） ===
  // 左右两栏各自独立实例，命中范围互不影响；".." 项无 data-file-path，不会被框选
  const {
    marquee: localMarquee,
    onMouseDown: handleLocalMarqueeMouseDown,
    consumeMarqueeClick: consumeLocalMarqueeClick,
  } = useMarqueeSelection({
    itemSelector: '[data-file-row="local"][data-file-path]',
    dragHandleSelector: '[data-drag-handle="true"]',
    getItemId: (el) => el.dataset.filePath!,
    getSelection: () => selectedLocalPaths,
    setSelection: (ids) => setSelectedLocalPaths(ids),
    containerRef: localListRef,
  })
  const {
    marquee: remoteMarquee,
    onMouseDown: handleRemoteMarqueeMouseDown,
    consumeMarqueeClick: consumeRemoteMarqueeClick,
  } = useMarqueeSelection({
    itemSelector: '[data-file-row="remote"][data-file-path]',
    dragHandleSelector: '[data-drag-handle="true"]',
    getItemId: (el) => el.dataset.filePath!,
    getSelection: () => selectedRemotePaths,
    setSelection: (ids) => setSelectedRemotePaths(ids),
    containerRef: remoteListRef,
  })

  // 左右分栏大小拖拽状态与处理
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [localSplitPercent, setLocalSplitPercent] = useState<number>(50)

  // === 文件冲突对话框状态 ===
  // pendingConflict: 当前待解决的冲突；applyToAll: 是否对剩余所有冲突应用同一操作
  // 使用 ref 持有 pendingConflict，避免 askConflict 闭包陷阱（依赖 state 会导致并发触发时 Promise 永不 resolve）
  type PendingConflict = {
    name: string
    location: string
    kind: 'upload' | 'download'
    resolve: (action: ConflictAction) => void
  }
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null)
  const pendingConflictRef = useRef<PendingConflict | null>(null)
  pendingConflictRef.current = pendingConflict
  const [conflictApplyToAll, setConflictApplyToAll] = useState<boolean>(false)
  const conflictApplyToAllRef = useRef<boolean>(false)
  const conflictCachedActionRef = useRef<ConflictAction | null>(null)
  // 批量操作中是否已选择"停止"，剩余文件直接跳过
  const conflictStoppedRef = useRef<boolean>(false)
  // 队列元素为完整对象，避免下一项复用上一项的 name/location/kind
  const conflictQueueRef = useRef<PendingConflict[]>([])

  // === 覆盖确认对话框状态 ===
  // 用于重命名、新建文件等单次操作的"是否覆盖已存在文件"确认
  // 与 askConflict 区别：单次操作（非批量），无 applyToAll / 队列
  type PendingOverwrite = {
    title: string
    description: string
    resolve: (confirmed: boolean) => void
  }
  const [pendingOverwrite, setPendingOverwrite] = useState<PendingOverwrite | null>(null)
  const pendingOverwriteRef = useRef<PendingOverwrite | null>(null)
  pendingOverwriteRef.current = pendingOverwrite

  // === 传输记录列表状态（仅当前 SFTP 会话内有效，关闭标签即清空）===
  const [transferRecords, setTransferRecords] = useState<TransferRecordItem[]>([])
  // 目录任务的子文件明细独立存储，避免大目录把主记录数组撑爆。
  const [transferChildren, setTransferChildren] = useState<Record<string, TransferChildRecord[]>>({})
  // 每批子记录变化只汇总一次，渲染每一列时直接读取，避免对大目录重复 reduce。
  const directoryRateTrackerRef = useRef<Map<string, { lastBytes: number; lastTime: number; smoothedRate: number }>>(new Map())
  // 每批子记录变化只汇总一次，渲染每一列时直接读取，避免对大目录重复 reduce。
  const directoryTransferSummaries = useMemo(() => {
    const summaries: Record<string, { totalBytes: number; currentBytes: number; activeRate: number }> = {}
    const now = Date.now()
    for (const [transferId, children] of Object.entries(transferChildren)) {
      let totalBytes = 0
      let currentBytes = 0
      let activeChildrenRate = 0
      for (const child of children) {
        const childTotal = Math.max(0, child.total || child.size)
        totalBytes += childTotal
        currentBytes += child.status === 'completed'
          ? childTotal
          : Math.min(childTotal, Math.max(0, child.current))
        if (child.status === 'transferring') activeChildrenRate += child.rate ?? 0
      }

      // 目录级别跨多文件/多并发 Worker 的综合网络吞吐率测算（解决海量小文件瞬间完成 child.rate 归零导致目录速率为 0 的问题）
      let tracker = directoryRateTrackerRef.current.get(transferId)
      if (!tracker) {
        tracker = { lastBytes: currentBytes, lastTime: now, smoothedRate: 0 }
        directoryRateTrackerRef.current.set(transferId, tracker)
      } else {
        const dt = (now - tracker.lastTime) / 1000
        const dBytes = currentBytes - tracker.lastBytes
        if (dt >= 0.25 || (tracker.smoothedRate === 0 && dBytes > 0 && dt >= 0.05)) {
          if (dt > 0 && dBytes >= 0) {
            const instantRate = dBytes / dt
            tracker.smoothedRate = tracker.smoothedRate > 0
              ? tracker.smoothedRate * RATE_SMOOTHING_ALPHA + instantRate * (1 - RATE_SMOOTHING_ALPHA)
              : instantRate
          }
          tracker.lastTime = now
          tracker.lastBytes = currentBytes
        }
      }

      const activeRate = Math.max(activeChildrenRate, tracker.smoothedRate)
      summaries[transferId] = { totalBytes, currentBytes, activeRate }
    }
    return summaries
  }, [transferChildren])
  const transferChildrenRef = useRef(transferChildren)
  transferChildrenRef.current = transferChildren
  const manifestBufferRef = useRef<Map<string, TransferChildRecord[]>>(new Map())
  const manifestFlushRafRef = useRef<number | null>(null)
  const directoryTransferIdsRef = useRef<Set<string>>(new Set())
  // bytes 进度事件合批缓冲：万级小文件时每秒可能上千条事件，逐条 setState 会让
  // 8000 行组件全量重渲染。这里按帧合并，每个文件只保留最新一条状态。
  const progressBufferRef = useRef<Map<string, TransferProgressData>>(new Map())
  const progressFlushRafRef = useRef<number | null>(null)
  // 每个 transferId 的顶层名称（首个非 manifest 事件的 fileName 即顶层记录名，同步登记）。
  // 后端 preflight 与初始 count 事件背靠背到达时，第二条事件处理时 transferRecordsRef
  // 可能尚未同步（React 未重渲染，parent 查找为 undefined），此时不能依赖 parent?.fileName
  // 判定「是否子文件事件」，否则父级同名事件会被误判为子文件，生成一条与父目录同名的假子记录。
  const transferTopNameRef = useRef<Map<string, string>>(new Map())
  const [transferPanelOpen, setTransferPanelOpen] = useState<boolean>(false)
  // 传输提示（如"临时文件已丢失，从头开始传输"），自动消失
  const [transferNotice, setTransferNotice] = useState<string | null>(null)
  const transferNoticeTimerRef = useRef<number | null>(null)
  const showTransferNotice = useCallback((msg: string) => {
    setTransferNotice(msg)
    if (transferNoticeTimerRef.current !== null) {
      window.clearTimeout(transferNoticeTimerRef.current)
    }
    transferNoticeTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current) return
      setTransferNotice(null)
      transferNoticeTimerRef.current = null
    }, 5000)
  }, [])

  // === 文件预览/编辑状态 ===
  const [viewer, setViewer] = useState<FileViewerState>(INITIAL_VIEWER_STATE)
  const viewerRef = useRef(viewer)
  viewerRef.current = viewer
  // 待确认的编码切换（viewer dirty 时先弹确认框，避免未保存内容静默丢失）
  const [pendingViewerEncoding, setPendingViewerEncoding] = useState<string | null>(null)
  // 防竞态 token：每次 openFileViewer 递增，旧请求的 setViewer 通过 token 校验被丢弃
  const viewerTokenRef = useRef(0)
  // 本地图片用 createObjectURL 创建 blob URL，需在关闭/重开时 revoke 避免内存泄漏
  const viewerObjectUrlRef = useRef<string | null>(null)

  // === 地址栏可编辑状态 ===
  // 双击面包屑或点击编辑按钮进入输入模式，回车跳转、Esc 取消
  const [localPathEditing, setLocalPathEditing] = useState(false)
  const [localPathInput, setLocalPathInput] = useState('')
  const [remotePathEditing, setRemotePathEditing] = useState(false)
  const [remotePathInput, setRemotePathInput] = useState('')

  const startLocalPathEdit = useCallback(() => {
    setLocalPathInput(localPath)
    setLocalPathEditing(true)
  }, [localPath])
  const commitLocalPathEdit = useCallback(() => {
    const p = localPathInput.trim()
    setLocalPathEditing(false)
    if (p && p !== localPath) loadLocalDirectory(p)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPathInput, localPath])
  const startRemotePathEdit = useCallback(() => {
    setRemotePathInput(remotePath)
    setRemotePathEditing(true)
  }, [remotePath])
  const commitRemotePathEdit = useCallback(() => {
    if (!selectedServerId) return
    const p = remotePathInput.trim()
    setRemotePathEditing(false)
    if (isRemoteDisconnected) {
      toastRef.current.warning(tRef.current('sftp_offline_readonly_tip'))
      return
    }
    if (p && p !== remotePath) loadRemoteDirectory(selectedServerId, p)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remotePathInput, remotePath, selectedServerId, isRemoteDisconnected])

  // === 上次访问路径记忆（按 serverId 持久化到 localStorage）===
  // 远程路径变化时保存，下次连接同一服务器时自动恢复
  useEffect(() => {
    if (!selectedServerId || !remotePath) return
    try { localStorage.setItem(`qshell.sftp.last-remote-path.${selectedServerId}`, remotePath) }
    catch { /* ignore */ }
  }, [selectedServerId, remotePath])

  // === 路径书签/收藏管理（按服务器隔离，对齐工作台文件模块 file-bookmarks-${baseServerId}）===
  // 1. 远程路径书签：跟随 active tab / selectedServerId 自动隔离切换

  // 统一偏好与路径收藏管理（左右独立，云端双向漫游）
  const leftPrefs = useFileExplorerPreferences({
    scope: leftSideType === 'remote' ? 'sftp-remote' : 'sftp-local',
    serverId: leftSideType === 'remote' ? leftServerId : undefined,
    onToast: {
      success: (msg) => toastRef.current.success(msg),
      info: (msg) => toastRef.current.info(msg),
      warning: (msg) => toastRef.current.warning(msg),
    },
  })

  const rightPrefs = useFileExplorerPreferences({
    scope: 'sftp-remote',
    serverId: selectedServerId,
    onToast: {
      success: (msg) => toastRef.current.success(msg),
      info: (msg) => toastRef.current.info(msg),
      warning: (msg) => toastRef.current.warning(msg),
    },
  })

  const remoteBookmarks = rightPrefs.bookmarks
  const handleAddRemoteBookmark = useCallback((path: string) => {
    rightPrefs.addBookmark(path, {
      maxLimitMsg: tRef.current('sftp_bookmarks_max_limit') || 'Maximum 50 bookmarks allowed',
      successMsg: tRef.current('sftp_bookmark_added') || 'Bookmark added',
    })
  }, [rightPrefs])

  const handleRemoveRemoteBookmark = useCallback((path: string) => {
    rightPrefs.removeBookmark(path, {
      infoMsg: tRef.current('sftp_bookmark_removed') || 'Bookmark removed',
    })
  }, [rightPrefs])

  const leftBookmarks = leftPrefs.bookmarks
  const handleAddLeftBookmark = useCallback((path: string) => {
    leftPrefs.addBookmark(path, {
      maxLimitMsg: tRef.current('sftp_bookmarks_max_limit') || 'Maximum 50 bookmarks allowed',
      successMsg: tRef.current('sftp_bookmark_added') || 'Bookmark added',
    })
  }, [leftPrefs])

  const handleRemoveLeftBookmark = useCallback((path: string) => {
    leftPrefs.removeBookmark(path, {
      infoMsg: tRef.current('sftp_bookmark_removed') || 'Bookmark removed',
    })
  }, [leftPrefs])

  // === 显示隐藏文件开关：左右面板完全独立 ===
  // 1. 本地面板：默认继承 store.sftpLocalShowHidden（未设置时默认 false）
  const [leftShowHidden, setLeftShowHiddenRaw] = useState<boolean>(() => {
    return sftpLocalShowHidden ?? false
  })
  useEffect(() => {
    setLeftShowHiddenRaw(sftpLocalShowHidden ?? false)
  }, [sftpLocalShowHidden])

  // 2. 远程面板工作副本：默认继承 store.sftpRemoteShowHidden（未设置时默认 true）
  const [rightShowHidden, setRightShowHiddenRaw] = useState<boolean>(() => {
    return sftpRemoteShowHidden ?? true
  })
  useEffect(() => {
    setRightShowHiddenRaw(sftpRemoteShowHidden ?? true)
  }, [sftpRemoteShowHidden])

  const isHiddenName = useCallback((name: string): boolean => {
    if (name === '..' || name === '.') return false
    return name.startsWith('.')
  }, [])

  // 切换左侧隐藏文件显示
  const setLeftShowHidden = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setLeftShowHiddenRaw(prev => {
      const next = typeof value === 'function' ? value(prev) : value
      setSftpLocalShowHidden(next)
      try {
        localStorage.setItem('qshell.sftp.local.showHidden', String(next))
      } catch {}
      if (prev && !next) {
        setSelectedLocalPaths(s => {
          const filtered = new Set<string>()
          for (const p of s) {
            const name = p.split(/[\/\\]/).pop() || ''
            if (!isHiddenName(name)) filtered.add(p)
          }
          return filtered
        })
      }
      return next
    })
  }, [isHiddenName, setSftpLocalShowHidden])

  // 切换右侧隐藏文件显示（工作副本）
  const setRightShowHidden = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setRightShowHiddenRaw(prev => {
      const next = typeof value === 'function' ? value(prev) : value
      setSftpRemoteShowHidden(next)
      try {
        localStorage.setItem('qshell.sftp.remote.showHidden', String(next))
      } catch {}
      if (prev && !next) {
        setSelectedRemotePaths(s => {
          const filtered = new Set<string>()
          for (const p of s) {
            const name = p.split(/[\/\\]/).pop() || ''
            if (!isHiddenName(name)) filtered.add(p)
          }
          return filtered
        })
      }
      return next
    })
  }, [isHiddenName, setSftpRemoteShowHidden])

  // === 文件剪贴板（跨面板复制/粘贴）===
  // Ctrl+C 把当前面板选中文件路径写入 fileClipboard；Ctrl+V 把剪贴板内容粘贴到对侧面板
  // 仅支持 local↔remote 跨面板粘贴（即上传/下载）；同侧粘贴视为无操作
  type FileClipboard = {
    sourceSide: 'local' | 'remote'
    sourceServerId?: string
    paths: string[]           // 始终保留路径，用于上传
    remoteEntries?: FileEntry[] // 远程源时额外存 entry，避免目录切换后找不到
  }
  const fileClipboardRef = useRef<FileClipboard | null>(null)

  /** 把当前面板的选中项写入文件剪贴板 */
  const copyFilesToClipboard = useCallback((side: 'local' | 'remote') => {
    const selected = side === 'local'
      ? Array.from(selectedLocalPathsRef.current).filter(p => !p.endsWith('/..') && p !== '..')
      : Array.from(selectedRemotePathsRef.current).filter(p => !p.endsWith('/..') && p !== '..')
    if (selected.length === 0) return
    const isSourceLeftRemote = side === 'local' && isLeftRemote
    const isSourceRightRemote = side === 'remote'
    const remoteEntries = isSourceRightRemote
      ? selected
          .map(p => filteredRemoteFilesRef.current.find(f => f.path === p))
          .filter((f): f is FileEntry => !!f)
      : isSourceLeftRemote
      ? (selected
          .map(p => filteredLocalFilesRef.current.find(f => f.path === p))
          .filter((f): f is LocalFileEntry => !!f) as unknown as FileEntry[])
      : undefined
    fileClipboardRef.current = {
      sourceSide: side,
      sourceServerId: isSourceRightRemote
        ? selectedServerIdRef.current
        : isSourceLeftRemote
          ? leftServerIdRef.current
          : undefined,
      paths: selected,
      remoteEntries,
    }
  }, [isLeftRemote])

  /**
   * 打开文件预览/编辑对话框
   * - 文本文件：默认 preview 模式，可切换 edit
   * - 图片/PDF/视频/音频文件：preview 模式（不可编辑）
   * - 其他类型：回退到原行为（上传/下载）
   * 通过 token 防竞态：快速连续打开两文件时，旧请求的 setViewer 会被丢弃
   */
  const openFileViewer = useCallback(async (
    side: 'local' | 'remote',
    file: { name: string; path: string; size: number; isDirectory: boolean },
    serverId?: string
  ) => {
    if (file.isDirectory) return false
    // 本地文件不限制大小；仅远程服务器受网络传输与 SFTP 缓冲区安全保护（100MB）
    if (side === 'remote' && file.size > 100 * 1024 * 1024) {
      toastRef.current.warning(`${tRef.current('fs_preview_too_large') || '远程文件过大无法在线预览'} (100MB)`)
      return false
    }
    if (side === 'remote' && isRemoteDisconnected) {
      toastRef.current.warning(tRef.current('sftp_offline_readonly_tip'))
      return false
    }
    const kind = getPreviewKind(file.name, file.size, side === 'remote')
    if (kind === 'unsupported') return false  // 非预览类型，交给原流程
    const ext = getFileExt(file.name)
    const isImage = kind === 'image'
    const isText = kind === 'text'
    const isDocx = kind === 'docx'
    const isLegacyDoc = kind === 'legacy_doc'
    const isSpreadsheet = kind === 'spreadsheet'
    const isCsvOrTsv = isSpreadsheet && (ext === 'csv' || ext === 'tsv')
    const needRawBytes = kind === 'universal' || isDocx || isLegacyDoc || (isSpreadsheet && !isCsvOrTsv)

    // 分配 token，后续 setViewer 的 updater 中校验 token，防止旧请求覆盖新请求
    const myToken = ++viewerTokenRef.current
    setViewer({
      open: true,
      mode: 'preview',
      side,
      serverId,
      path: file.path,
      fileName: file.name,
      fileSize: file.size,
      isImage,
      kind,
      loading: true,
      token: myToken,
    })
    // helper：仅当 viewer 仍是本次请求（token 匹配）时才更新
    const updateIfMine = (patch: Partial<FileViewerState>) => {
      setViewer(v => v.token === myToken ? { ...v, ...patch } : v)
    }
    try {
      if (needRawBytes) {
        // 二进制流（Word docx、旧版 doc、Excel xlsx/xls、压缩包 zip/jar/war）
        if (side === 'remote' && serverId) {
          const b64 = await sshService.readBinaryFile(serverId, file.path)
          if (!b64) throw new Error(tRef.current('sftp_empty_image_data'))
          const binaryString = atob(b64)
          const len = binaryString.length
          const bytes = new Uint8Array(len)
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i)
          }
          updateIfMine({ loading: false, rawBytes: bytes })
        } else {
          try {
            const bytes = await readFileLocal(file.path)
            updateIfMine({ loading: false, rawBytes: bytes })
          } catch (e: unknown) {
            throw new Error(getErrorMessage(e, t('sftp_read_local_file_failed')), { cause: e })
          }
        }
      } else if (isText || isCsvOrTsv) {
        // 文本或 CSV/TSV：读取 + 编码检测解码（files_read 对非 UTF-8 返回 ::base64:: 前缀）
        if (side === 'remote' && serverId) {
          const res = await sshService.readFile(serverId, file.path)
          if (res.exitCode !== 0) throw new Error(res.stderr || t('sftp_read_failed'))
          const decoded = decodeReadResult(res.stdout || '')
          if (isBinaryContent(decoded.text)) {
            updateIfMine({ loading: false, isBinary: true, error: tRef.current('sftp_viewer_binary_unsupported') })
          } else {
            updateIfMine({ loading: false, isBinary: false, content: decoded.text, encoding: decoded.encoding, eol: decoded.eol, hasBom: decoded.hasBom })
          }
        } else {
          try {
            const text = await readTextFileLocal(file.path)
            if (isBinaryContent(text)) {
              updateIfMine({ loading: false, isBinary: true, error: tRef.current('sftp_viewer_binary_unsupported') })
            } else {
              // 本地文本：剥离 UTF-8 BOM 字符并记录，保存时补回；EOL 检测与远程保持一致
              const hasBom = text.startsWith('\uFEFF')
              const body = hasBom ? text.slice(1) : text
              updateIfMine({ loading: false, isBinary: false, content: body, encoding: 'utf-8', eol: detectEol(body), hasBom })
            }
          } catch (e: unknown) {
            throw new Error(getErrorMessage(e, t('sftp_read_local_file_failed')), { cause: e })
          }
        }
      } else {
        // 二进制类型（image/pdf/video/audio）：读取原始字节
        const mime = getMimeFromExt(file.name)
        if (side === 'remote' && serverId) {
          // 远程文件：用 SFTP 读取原始字节（cat 命令会破坏二进制数据）
          const b64 = await sshService.readBinaryFile(serverId, file.path)
          if (!b64) throw new Error(tRef.current('sftp_empty_image_data'))
          updateIfMine({ loading: false, mediaSrc: `data:${mime};base64,${b64}` })
        } else {
          // 本地文件：用 Blob + createObjectURL（避免 base64 分块转换的栈溢出和编码问题）
          try {
            const bytes = await readFileLocal(file.path)
            // 释放上一次的 object URL（如果有），避免内存泄漏
            if (viewerObjectUrlRef.current) {
              URL.revokeObjectURL(viewerObjectUrlRef.current)
              viewerObjectUrlRef.current = null
            }
            const blob = new Blob([bytes], { type: mime })
            const url = URL.createObjectURL(blob)
            viewerObjectUrlRef.current = url
            updateIfMine({ loading: false, mediaSrc: url })
          } catch (e: unknown) {
            throw new Error(getErrorMessage(e, t('sftp_read_local_image_failed')), { cause: e })
          }
        }
      }
    } catch (e: unknown) {
      updateIfMine({ loading: false, error: getErrorMessage(e, String(e)) })
    }
    return true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 切换编辑/预览模式 */
  const toggleViewerMode = useCallback(() => {
    const v = viewerRef.current
    if (!v.open || v.isImage) return
    if (v.mode === 'preview') {
      if (v.fileSize && v.fileSize > 2 * 1024 * 1024) {
        toastRef.current.warning(tRef.current('sftp_edit_too_large'))
        return
      }
    }
    setViewer(prev => ({
      ...prev,
      mode: prev.mode === 'preview' ? 'edit' : 'preview',
      dirty: false,
    }))
  }, [])

  /** 保存编辑内容 */
  const saveViewerContent = useCallback(async () => {
    if (!viewer.dirty || !viewer.content) return
    setViewer(v => ({ ...v, saving: true }))
    try {
      if (viewer.side === 'remote' && viewer.serverId) {
        // 按原编码/换行符/BOM 回写：UTF-8 无 BOM 直接写文本，其余走 ::base64:: 原始字节写回
        const encoding = viewer.encoding || 'utf-8'
        const hasBom = viewer.hasBom ?? false
        const normalized = normalizeEol(viewer.content, viewer.eol ?? null)
        let contentToWrite: string
        if (encoding === 'utf-8' && !hasBom) {
          contentToWrite = normalized
        } else {
          contentToWrite = `::base64::${bytesToBase64(encodeTextFile(normalized, encoding, hasBom))}`
        }
        const res = await sshService.writeFile(viewer.serverId, viewer.path, contentToWrite)
        if (res.exitCode !== 0) throw new Error(res.stderr || t('sftp_write_failed'))
      } else {
        // 本地：与远程一致做 EOL 归一；BOM 以 UTF-8 BOM 字符形式补回
        const normalized = normalizeEol(viewer.content, viewer.eol ?? null)
        await writeLocal(viewer.path, (viewer.hasBom ? '\uFEFF' : '') + normalized)
      }
      setViewer(v => ({ ...v, saving: false, dirty: false, mode: 'preview' }))
    } catch (e: unknown) {
      setViewer(v => ({ ...v, saving: false, error: getErrorMessage(e, String(e)) }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer])

  /** 手动切换编码重新打开（Notepad++ 式「以 XX 编码打开」）：自动检测不准时的兜底 */
  const reopenViewerWithEncoding = useCallback(async (encoding: string) => {
    const v = viewerRef.current
    if (v.side !== 'remote' || !v.serverId || v.loading) return
    const myToken = ++viewerTokenRef.current
    setViewer(prev => ({ ...prev, loading: true, token: myToken }))
    const updateIfMine = (patch: Partial<FileViewerState>) => {
      setViewer(prev => (prev.token === myToken ? { ...prev, ...patch } : prev))
    }
    try {
      const b64 = await sshService.readBinaryFile(v.serverId, v.path)
      if (!b64) throw new Error(tRef.current('sftp_read_failed'))
      const decoded = decodeTextWithEncoding(base64ToBytes(b64), encoding)
      if (isBinaryContent(decoded.text)) {
        updateIfMine({ loading: false, isBinary: true, error: tRef.current('sftp_viewer_binary_unsupported') })
        return
      }
      updateIfMine({ loading: false, isBinary: false, content: decoded.text, encoding, eol: decoded.eol, hasBom: decoded.hasBom })
    } catch (e: unknown) {
      updateIfMine({ loading: false, error: getErrorMessage(e, String(e)) })
    }
  }, [])

  /** 格式化/紧凑 JSON 内容 */
  const formatViewerJson = useCallback(() => {
    if (!viewer.content) return
    try {
      const parsed = JSON.parse(viewer.content)
      const isMultiLine = viewer.content.includes('\n')
      const formatted = isMultiLine ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2)
      setViewer(v => ({
        ...v,
        content: formatted,
        dirty: v.mode === 'edit' ? true : v.dirty,
      }))
      toastRef.current.success(isMultiLine ? 'JSON 已压缩（单行）' : 'JSON 已格式化')
    } catch (err) {
      toastRef.current.error('JSON 语法错误，无法格式化: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [viewer.content])

  // 关闭预览/编辑对话框时的未保存确认（替代 window.confirm，与全局 ConfirmDialog 风格一致）
  const [showCloseViewerConfirm, setShowCloseViewerConfirm] = useState(false)

  // SFTP 配置诊断（仅 Windows 服务端）
  const [diagnosingSftp, setDiagnosingSftp] = useState(false)
  const [sftpDiagnostics, setSftpDiagnostics] = useState<SftpDiagnostics | null>(null)
  const [showDiagnosticsDialog, setShowDiagnosticsDialog] = useState(false)

  const closeViewer = useCallback(() => {
    // 有未保存修改时弹出确认对话框（而非阻塞的 window.confirm）
    if (viewer.dirty) {
      setShowCloseViewerConfirm(true)
      return
    }
    // 释放本地图片的 object URL，避免内存泄漏
    if (viewerObjectUrlRef.current) {
      URL.revokeObjectURL(viewerObjectUrlRef.current)
      viewerObjectUrlRef.current = null
    }
    setViewer(INITIAL_VIEWER_STATE)
  }, [viewer.dirty])
  // 传输面板高度（像素），可拖拽调整；从 localStorage 恢复用户上次设置
  const transferPanelMinHeight = 80
  const getTransferPanelMaxHeight = () => {
    if (typeof window !== 'undefined' && window.innerHeight > 0) {
      return Math.max(600, Math.floor(window.innerHeight * 0.85))
    }
    return 600
  }
  const TRANSFER_PANEL_HEIGHT_KEY = 'sftp:transferPanelHeight'
  const [transferPanelHeight, setTransferPanelHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(TRANSFER_PANEL_HEIGHT_KEY)
      if (saved) {
        const h = parseInt(saved, 10)
        if (!isNaN(h) && h >= transferPanelMinHeight && h <= 1200) {
          return h
        }
      }
    } catch { /* localStorage 不可用时回退默认值 */ }
    return 180
  })
  const transferRecordsRef = useRef(transferRecords)
  transferRecordsRef.current = transferRecords
  // 通过 ref 解析服务器名称（避免把 servers 塞进大量传输回调的依赖数组）
  const serversRef = useRef(servers)
  serversRef.current = servers
  const serverNameOf = (id?: string): string => id ? (serversRef.current.find(s => s.id === toBaseServerId(id))?.name ?? '') : ''
  // 上次播放传输完成音的时间戳：500ms 节流，避免批量传输 N 个小文件时响 N 次
  // 大文件传输间隔远超 500ms，每个完成都能正常播放，不受影响
  const lastSuccessSoundRef = useRef(0)
  // 选择集合的 ref：键盘快捷键回调读取最新值，避免闭包陷阱
  const selectedLocalPathsRef = useRef<Set<string>>(selectedLocalPaths)
  selectedLocalPathsRef.current = selectedLocalPaths
  const selectedRemotePathsRef = useRef<Set<string>>(selectedRemotePaths)
  selectedRemotePathsRef.current = selectedRemotePaths
  // 文件列表的 ref：快捷键全选/取首项时读取最新列表
  const filteredLocalFilesRef = useRef<LocalFileEntry[]>([])
  const filteredRemoteFilesRef = useRef<FileEntry[]>([])
  // 待绑定的源/目标路径：前端触发传输时记录，后端 progress 事件到来时按 fileName 取出并填入记录
  // key: fileName, value: { source, target, sourceServerName, targetServerName, serverId, ts }
  const pendingPathsRef = useRef<Map<string, { source: string; target: string; sourceServerName?: string; targetServerName?: string; serverId?: string; ts: number }[]>>(new Map())
  // 目录加载请求序号：防止快速切换目录时旧响应覆盖新结果（stale response guard）
  // 每次加载递增，响应返回时校验序号是否仍为最新，不匹配则丢弃
  const localDirReqIdRef = useRef<number>(0)
  const remoteDirReqIdRef = useRef<number>(0)
  // 批次隔离：每次进入 handleUploadLocalPaths/handleDownloadRemoteFiles 生成新 batchId，
  // 防止用户在传输中再次拖拽触发第二批，污染第一批的冲突状态/队列/Promise
  // askConflict 会校验当前 batchId 是否仍为最新，过期批次直接 skip
  const transferBatchIdRef = useRef<number>(0)
  // 可展开详情的记录 ID 集合
  const [expandedTransfers, setExpandedTransfers] = useState<Set<string>>(new Set())
  // 传输面板拖拽调整大小
  const transferResizeRef = useRef<{
    startY: number
    startHeight: number
  } | null>(null)

  // 拖拽中：根据鼠标移动距离计算新高度（向上拖增大）
  // 用 rAF 节流，避免每个 mousemove 都 setState 触发重渲染
  const rafIdRef = useRef<number | null>(null)
  // 用 ref 持有最新高度，避免 stopTransferResize 闭包读到过期值
  const transferPanelHeightRef = useRef(transferPanelHeight)
  transferPanelHeightRef.current = transferPanelHeight
  const handleTransferResize = useCallback((e: MouseEvent) => {
    const ref = transferResizeRef.current
    if (!ref) return
    if (rafIdRef.current !== null) return  // 已有待执行帧，跳过
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      const r = transferResizeRef.current
      if (!r) return
      const delta = r.startY - e.clientY
      const maxHeight = getTransferPanelMaxHeight()
      const newHeight = Math.max(
        transferPanelMinHeight,
        Math.min(maxHeight, r.startHeight + delta)
      )
      setTransferPanelHeight(newHeight)
    })
  }, [])

  // 拖拽结束：清理监听，持久化高度到 localStorage
  const stopTransferResize = useCallback(() => {
    transferResizeRef.current = null
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    document.removeEventListener('mousemove', handleTransferResize)
    document.removeEventListener('mouseup', stopTransferResize)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    // 持久化最终高度（从 ref 读取，避免闭包过期值）
    try {
      localStorage.setItem(TRANSFER_PANEL_HEIGHT_KEY, String(transferPanelHeightRef.current))
    } catch { /* localStorage 不可用时忽略 */ }
  }, [handleTransferResize])

  // 拖拽开始：记录起始位置和高度
  const startTransferResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    transferResizeRef.current = {
      startY: e.clientY,
      startHeight: transferPanelHeight,
    }
    // 拖拽过程中给 document 添加监听
    document.addEventListener('mousemove', handleTransferResize)
    document.addEventListener('mouseup', stopTransferResize)
    // 拖拽时禁用文本选择
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ns-resize'
  }, [transferPanelHeight, handleTransferResize, stopTransferResize])

  // 组件卸载时也清理监听
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleTransferResize)
      document.removeEventListener('mouseup', stopTransferResize)
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [handleTransferResize, stopTransferResize])

  // === 复制路径反馈状态 ===
  const [copiedRemotePath, setCopiedRemotePath] = useState<boolean>(false)

  // 左右分栏拖拽：监听器引用存 ref，组件卸载时清理
  const splitResizeHandlersRef = useRef<{ move: ((e: MouseEvent) => void) | null; up: ((e: MouseEvent) => void) | null }>({ move: null, up: null })
  const handleSplitResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const offset = moveEvent.clientX - rect.left
      const percentage = (offset / rect.width) * 100
      setLocalSplitPercent(Math.max(10, Math.min(90, percentage)))
    }
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      splitResizeHandlersRef.current = { move: null, up: null }
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    splitResizeHandlersRef.current = { move: handleMouseMove, up: handleMouseUp }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }
  // 卸载时清理可能残留的分栏拖拽监听器
  useEffect(() => {
    return () => {
      const ref = splitResizeHandlersRef.current
      if (ref.move) document.removeEventListener('mousemove', ref.move)
      if (ref.up) document.removeEventListener('mouseup', ref.up)
    }
  }, [])

  // SFTP 排序持久化：从 useFileExplorerPreferences 统一获取
  const localSortField = leftPrefs.sortField as 'name' | 'size' | 'modified'
  const localSortOrder = leftPrefs.sortOrder
  const handleLocalSort = leftPrefs.handleSort

  const remoteSortField = rightPrefs.sortField as 'name' | 'size' | 'modified'
  const remoteSortOrder = rightPrefs.sortOrder
  const setRemoteSortField = rightPrefs.setSortField
  const setRemoteSortOrder = rightPrefs.setSortOrder
  const handleRemoteSort = rightPrefs.handleSort

  const loadLocalDirectory = async (
    pathString: string,
    overrideSideType?: 'local' | 'remote',
    overrideServerId?: string,
  ) => {
    if (!backend) return
    const prevPath = localPathRef.current
    // 递增请求序号：响应返回时校验，丢弃过期响应（用户已切换到其他目录）
    const reqId = ++localDirReqIdRef.current

    const activeSideType = overrideSideType !== undefined ? overrideSideType : leftSideType
    const activeServerId = overrideServerId !== undefined ? overrideServerId : leftServerId

    setLocalLoading(true)
    setLocalError(null)
    setLocalPath(pathString)
    setSelectedLocalPaths(new Set())

    try {
      let resFiles: (FileEntry | LocalFileEntry)[]
      if (activeSideType === 'remote' && activeServerId) {
        resFiles = await backend.files.list(activeServerId, pathString)
      } else {
        const res = await backend.files.listLocalDirectory(pathString)
        resFiles = res.files
      }

      if (!mountedRef.current || localDirReqIdRef.current !== reqId) return // 过期响应/组件已卸载，丢弃
      // 左面板列表可能装远程条目（左面板为远程时），历史运行时语义如此，此处显式断言
      setLocalFiles(resFiles as LocalFileEntry[])
      
      if (activeSideType === 'local') {
        writeLastLocalPath(pathString)
      }
      
      // 切换目录后滚动到顶部（虚拟滚动需要显式重置）
      localListRef.current?.scrollTo({ top: 0 })
      
      // 同步浏览逻辑：本地切目录 → 同步切换远程目录
      // 仅当左侧是本地、右侧是远程、且本次切换由用户主动发起（非同步触发）时才同步
      // 基于"配对根"计算目标路径，避免不同步跳转导致基准漂移
      if (syncBrowsing && selectedServerId && syncSourceRef.current === 'user'
          && syncPairRootRef.current && activeSideType === 'local'
          && leftSideType === 'local' && rightSideType === 'remote') {
        const { local: localRoot, remote: remoteRoot } = syncPairRootRef.current
        const targetPath = getSyncPathFromRoot(
          pathString, localRoot, remoteRoot,
          getLocalOs() === 'windows', false,
        )
        if (targetPath && targetPath !== remotePathRef.current) {
          // 标记为同步触发，防止对侧切换反向触发同步（避免乒乓）
          syncSourceRef.current = 'sync'
          void loadRemoteDirectory(selectedServerId, targetPath)
            .catch(err => {
              // 目标目录不存在等情况静默跳过（对齐 FileZilla 行为）
              console.warn('[SyncBrowsing] remote sync failed:', err)
            })
            .finally(() => {
              syncSourceRef.current = 'user'
            })
        } else if (targetPath === null) {
          // 路径不在配对根下，无法同步——提示用户
          toastRef.current.warning(tRef.current('sftp_sync_root_warn'))
        }
      }
    } catch (err: unknown) {
      if (!mountedRef.current || localDirReqIdRef.current !== reqId) return // 过期响应/组件已卸载，丢弃
      console.error('Failed to load local directory:', err)
      setLocalError(getErrorMessage(err, String(err)))
      setLocalFiles([])
      setLocalPath(prevPath)
    } finally {
      // 仅当仍是最新请求时才关闭 loading，避免新请求的 loading 被误清
      if (mountedRef.current && localDirReqIdRef.current === reqId) {
        setLocalLoading(false)
        setOpeningLocalPath(null)
      }
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadRemoteDirectory = async (serverId: string, pathString: string) => {
    if (!backend || !serverId) return
    const prevPath = remotePathRef.current
    const reqId = ++remoteDirReqIdRef.current

    setRemoteLoading(true)
    setRemoteError(null)
    setRemotePath(pathString)
    setSelectedRemotePaths(new Set())

    try {
      const files = await backend.files.list(serverId, pathString)
      if (!mountedRef.current || remoteDirReqIdRef.current !== reqId) return // 过期响应/组件已卸载，丢弃
      setRemoteFiles(files)
      // 切换目录后滚动到顶部（虚拟滚动需要显式重置）
      remoteListRef.current?.scrollTo({ top: 0 })
      // 同步浏览逻辑：远程切目录 → 同步切换本地目录
      // 仅当本次切换由用户主动发起（非同步触发）时才同步
      if (syncBrowsing && syncSourceRef.current === 'user'
          && syncPairRootRef.current
          && leftSideType === 'local' && rightSideType === 'remote') {
        const { local: localRoot, remote: remoteRoot } = syncPairRootRef.current
        const targetPath = getSyncPathFromRoot(
          pathString, remoteRoot, localRoot,
          false, getLocalOs() === 'windows',
        )
        if (targetPath && targetPath !== localPathRef.current) {
          syncSourceRef.current = 'sync'
          void loadLocalDirectory(targetPath)
            .catch(err => {
              console.warn('[SyncBrowsing] local sync failed:', err)
            })
            .finally(() => {
              syncSourceRef.current = 'user'
            })
        } else if (targetPath === null) {
          // 路径不在配对根下，无法同步——提示用户
          toastRef.current.warning(tRef.current('sftp_sync_root_warn'))
        }
      }
    } catch (err: unknown) {
      if (!mountedRef.current || remoteDirReqIdRef.current !== reqId) return // 过期响应/组件已卸载，丢弃
      console.error('Failed to load remote directory:', err)
      const errMsg = getErrorMessage(err, String(err))
      if (isSftpConnectionError(errMsg)) {
        setIsRemoteDisconnected(true)
        setRemoteDisconnectedError(errMsg)
      } else {
        setRemoteError(errMsg)
      }
      setRemotePath(prevPath)
    } finally {
      if (mountedRef.current && remoteDirReqIdRef.current === reqId) {
        setRemoteLoading(false)
        setOpeningRemotePath(null)
      }
    }
  }

  // 更新 ref，供空依赖的 useEffect（如进度事件监听）调用最新版本
  loadRemoteDirectoryRef.current = loadRemoteDirectory
  loadLocalDirectoryRef.current = loadLocalDirectory

  // ─────────────────────────────────────────────────────────────
  // 右侧多标签：工作副本 ↔ rightTabs 同步
  // 工作副本（selectedServerId/remotePath/...）变化时，自动写回 active tab
  // 这样所有原代码无需改动，工作副本即真源的镜像
  // 注：selectedRemotePaths 通过 ref 读取，避免频繁的选中操作触发 setRightTabs；
  //     切换 tab 时由 switchToRightTab 手动持久化选中项，避免丢失。
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeRightTabId) return
    setRightTabs(prev => prev.map(t =>
      t.id === activeRightTabId
        ? {
            ...t,
            serverId: selectedServerId,
            connectingId: connectingServerId,
            path: remotePath,
            files: remoteFiles,
            loading: remoteLoading,
            search: remoteSearch,
            selectedPaths: selectedRemotePathsRef.current,
            error: remoteError,
            disconnected: isRemoteDisconnected,
            disconnectedError: remoteDisconnectedError,
            sortField: remoteSortField,
            sortOrder: remoteSortOrder,
            syncBrowsing: syncBrowsing,
            syncPairRoot: syncPairRootRef.current,
            compareActive: compareActive,
            viewMode: rightViewMode,
            showHidden: rightShowHidden,
          }
        : t
    ))
  }, [activeRightTabId, selectedServerId, connectingServerId, remotePath,
      remoteFiles, remoteLoading, remoteSearch,
      remoteError, isRemoteDisconnected, remoteDisconnectedError,
      remoteSortField, remoteSortOrder, syncBrowsing, compareActive,
      rightViewMode, rightShowHidden])

  // 同步标签名（首次连接成功后 serverName 为空，需补全）
  useEffect(() => {
    if (!activeRightTabId || !selectedServerId) return
    const baseId = toBaseServerId(selectedServerId)
    const srv = servers.find(s => s.id === baseId)
    const name = srv?.name || srv?.host || baseId
    setRightTabs(prev => prev.map(t =>
      t.id === activeRightTabId && t.serverName !== name
        ? { ...t, serverName: name }
        : t
    ))
  }, [activeRightTabId, selectedServerId, servers])

  // 切换 active tab：恢复目标 tab 的工作副本
  // 注意：不需要手动保存当前工作副本——上面的 useEffect 已实时同步
  const switchToRightTab = useCallback((tabId: string) => {
    if (tabId === activeRightTabIdRef.current) return
    const target = rightTabs.find(t => t.id === tabId)
    if (!target) return

    // 递增请求序号，丢弃切换前未完成的远程目录加载响应
    remoteDirReqIdRef.current++

    // 切换前：强制把旧 tab 的 loading 设为 false，避免残留 spinner
    // （useEffect 会把工作副本同步到 active tab，但切换 active 后旧 tab 不再被同步）
    // 同时持久化当前选中项到旧 tab——useEffect 不再依赖 selectedRemotePaths，
    // 切换瞬间若仅选中项变化，useEffect 不会触发，需在此手动保存。
    setRightTabs(prev => prev.map(t =>
      t.id === activeRightTabIdRef.current
        ? { ...t, loading: false, connectingId: '', selectedPaths: selectedRemotePathsRef.current }
        : t
    ))

    // 恢复目标 tab 工作副本
    setSelectedServerId(target.serverId)
    setConnectingServerId(target.connectingId)
    setRemotePath(target.path)
    setRemoteFiles(target.files)
    setRemoteLoading(false)  // 切换后强制 loading=false，避免残留 spinner
    setRemoteSearch(target.search)
    setSelectedRemotePaths(new Set(target.selectedPaths))
    const isDisconnectedTab = !!target.disconnected
    setIsRemoteDisconnected(isDisconnectedTab)
    setRemoteDisconnectedError(target.disconnectedError || null)
    setRemoteError(isDisconnectedTab || isSftpConnectionError(target.error) ? null : target.error)
    setRemoteSortField(target.sortField)
    setRemoteSortOrder(target.sortOrder)
    setSyncBrowsing(target.syncBrowsing)
    setCompareActive(target.compareActive)
    syncPairRootRef.current = target.syncPairRoot
    setRightViewMode(target.viewMode || sftpRemoteViewMode || 'list')
    setRightShowHidden(target.showHidden !== undefined ? target.showHidden : (sftpRemoteShowHidden ?? true))
    // 重置递归搜索状态，避免切换 tab 时残留前一个 tab 的搜索结果
    setSearchMode('filter')
    setRecursiveSearchPattern('')
    setSearchResults([])
    setRecursiveSearching(false)

    setActiveRightTabId(tabId)
    setBatchSelectedServerIds(new Set())
    remoteListRef.current?.scrollTo({ top: 0 })
  }, [rightTabs, sftpRemoteViewMode, sftpRemoteShowHidden, setRightShowHidden])

  // 新建空 tab 并设为 active（不发起连接，仅创建占位）
  // 返回新 tab id；若已达上限返回空字符串
  const createRightTab = useCallback((): string => {
    if (rightTabs.length >= MAX_RIGHT_TABS) {
      console.warn('[RightTab] max tabs reached:', MAX_RIGHT_TABS)
      return ''
    }
    const tab = createEmptyRightTab(
      sftpRemoteViewMode || 'list',
      sftpRemoteShowHidden ?? true,
      remoteSortField,
      remoteSortOrder
    )
    setRightTabs(prev => [...prev, tab])
    setActiveRightTabId(tab.id)
    // 清空工作副本（新 tab 是空的）
    setSelectedServerId('')
    setConnectingServerId('')
    setRemotePath('')
    setRemoteFiles([])
    setRemoteLoading(false)
    setRemoteSearch('')
    setSelectedRemotePaths(new Set())
    setBatchSelectedServerIds(new Set())
    setRemoteError(null)
    setIsRemoteDisconnected(false)
    setRemoteDisconnectedError(null)
    setRemoteSortField(remoteSortField)
    setRemoteSortOrder(remoteSortOrder)
    setSyncBrowsing(false)
    setCompareActive(false)
    syncPairRootRef.current = null
    setRightViewMode(tab.viewMode ?? 'list')
    setRightShowHidden(tab.showHidden ?? (sftpRemoteShowHidden ?? true))
    // 重置递归搜索状态
    setSearchMode('filter')
    setRecursiveSearchPattern('')
    setSearchResults([])
    setRecursiveSearching(false)
    return tab.id
  }, [rightTabs.length])

  // 关闭 tab：从 rightTabs 删除，断开 SSH 连接，切换到相邻 tab
  const closeRightTab = useCallback(async (tabId: string) => {
    const tab = rightTabs.find(t => t.id === tabId)
    if (!tab) return

    // 断开该 tab 的 SSH 连接（若有）
    if (tab.serverId) {
      try { await sshService.disconnect(tab.serverId) }
      catch (e) { console.warn('[RightTab] disconnect failed:', e) }
    }

    const idx = rightTabs.findIndex(t => t.id === tabId)
    const newTabs = rightTabs.filter(t => t.id !== tabId)
    setRightTabs(newTabs)

    // 如果关闭的是 active tab，切换到相邻 tab
    if (tabId === activeRightTabIdRef.current) {
      if (newTabs.length === 0) {
        // 没有剩余 tab：清空工作副本
        setActiveRightTabId('')
        setSelectedServerId('')
        setConnectingServerId('')
        setRemotePath('')
        setRemoteFiles([])
        setRemoteLoading(false)
        setRemoteSearch('')
        setSelectedRemotePaths(new Set())
        setRemoteError(null)
        setSyncBrowsing(false)
        setCompareActive(false)
        syncPairRootRef.current = null
        setRightViewMode(sftpRemoteViewMode || 'list')
        setRightShowHidden(sftpRemoteShowHidden ?? true)
        // 保留进行中（transferring/paused）的传输记录，以及属于左侧远程会话的传输记录，避免丢失跟踪与操作入口
        setTransferRecords(prev => prev.filter(t =>
          t.status === 'transferring' ||
          t.status === 'paused' ||
          (leftSideType === 'remote' && !!leftServerId && t.serverId === leftServerId)
        ))
        if (tab?.serverId) {
          for (const [key, arr] of pendingPathsRef.current.entries()) {
            const filtered = arr.filter(item => item.serverId !== tab.serverId)
            if (filtered.length === 0) pendingPathsRef.current.delete(key)
            else pendingPathsRef.current.set(key, filtered)
          }
        }
        if (pendingConflictRef.current) {
          pendingConflictRef.current.resolve('skip')
          pendingConflictRef.current = null
          setPendingConflict(null)
        }
        conflictQueueRef.current.forEach(item => item.resolve('skip'))
        conflictQueueRef.current = []
        conflictStoppedRef.current = false
        conflictApplyToAllRef.current = false
        conflictCachedActionRef.current = null
        setConflictApplyToAll(false)
      } else {
        // 切换到相邻 tab（优先右侧，否则左侧）
        const nextTab = newTabs[Math.min(idx, newTabs.length - 1)]
        switchToRightTab(nextTab.id)
      }
    }
  }, [rightTabs, switchToRightTab, leftSideType, leftServerId])

  // 切换同步浏览开关
  // 开启时：校验左侧=本地、右侧=远程，并锁定当前两侧路径为配对根
  // 关闭时：清空配对根
  const toggleSyncBrowsing = () => {
    if (!syncBrowsing) {
      // 开启校验：必须左侧本地、右侧远程，且两侧都有有效路径
      if (leftSideType !== 'local' || rightSideType !== 'remote'
          || !localPathRef.current || !remotePathRef.current) {
        console.warn('[SyncBrowsing]', t('sftp_sync_browsing_no_pair'))
        return
      }
      // 锁定配对根：Windows 本地路径盘符小写化，与 getSyncPathFromRoot 的 normalize 保持一致
      syncPairRootRef.current = {
        local: localPathRef.current.replace(/^[A-Z]:/, (m) => m.toLowerCase()),
        remote: remotePathRef.current,
      }
      setSyncBrowsing(true)
    } else {
      syncPairRootRef.current = null
      setSyncBrowsing(false)
    }
  }

  const comparisonResults = useMemo(() => {
    if (!compareActive || !selectedServerId) return null

    const localMap = new Map<string, LocalFileEntry>()
    localFiles.forEach(f => {
      if (f.name !== '..') {
        localMap.set(f.name, f)
      }
    })

    const remoteMap = new Map<string, FileEntry>()
    remoteFiles.forEach(f => {
      if (f.name !== '..') {
        remoteMap.set(f.name, f)
      }
    })

    const localCompare = new Map<string, 'missing' | 'size_mismatch' | 'identical'>()
    const remoteCompare = new Map<string, 'missing' | 'size_mismatch' | 'identical'>()

    localMap.forEach((lf, name) => {
      const rf = remoteMap.get(name)
      if (!rf) {
        localCompare.set(lf.path, 'missing')
      } else if (lf.isDirectory !== rf.isDirectory) {
        localCompare.set(lf.path, 'size_mismatch')
      } else if (!lf.isDirectory && lf.size !== rf.size) {
        localCompare.set(lf.path, 'size_mismatch')
      } else {
        localCompare.set(lf.path, 'identical')
      }
    })

    remoteMap.forEach((rf, name) => {
      const lf = localMap.get(name)
      if (!lf) {
        remoteCompare.set(rf.path, 'missing')
      } else if (lf.isDirectory !== rf.isDirectory) {
        remoteCompare.set(rf.path, 'size_mismatch')
      } else if (!rf.isDirectory && lf.size !== rf.size) {
        remoteCompare.set(rf.path, 'size_mismatch')
      } else {
        remoteCompare.set(rf.path, 'identical')
      }
    })

    return { localCompare, remoteCompare }
  }, [compareActive, localFiles, remoteFiles, selectedServerId])

  const getCompareRowBgClass = (path: string, side: 'local' | 'remote', isSelected: boolean) => {
    if (isSelected) return 'is-selected font-semibold text-foreground'
    if (!comparisonResults) return 'hover:bg-accent/70'
    const status = side === 'local' 
      ? comparisonResults.localCompare.get(path) 
      : comparisonResults.remoteCompare.get(path)
    
    if (status === 'missing') {
      return 'bg-emerald-500/15 hover:bg-emerald-500/25 border-l-2 border-emerald-500 text-emerald-600 dark:text-emerald-400'
    }
    if (status === 'size_mismatch') {
      return 'bg-amber-500/15 hover:bg-amber-500/25 border-l-2 border-amber-500 text-amber-600 dark:text-amber-400'
    }
  }

  const getCompareCardClass = (path: string, side: 'local' | 'remote', isSelected: boolean) => {
    if (isSelected) return 'is-selected'
    if (!comparisonResults) return ''
    const status = side === 'local' 
      ? comparisonResults.localCompare.get(path) 
      : comparisonResults.remoteCompare.get(path)
    
    if (status === 'missing') {
      return 'border-emerald-500/80 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    }
    if (status === 'size_mismatch') {
      return 'border-amber-500/80 bg-amber-500/10 text-amber-600 dark:text-amber-400'
    }
    return 'opacity-60 hover:opacity-100'
  }

  const handleConnectLeftServer = async (serverId: string) => {
    const sftpConnId = toSftpConnId(serverId)
    setConnectingLeftServerId(sftpConnId)
    setLocalError(null)
    try {
      const connectRes = await sshService.connect(sftpConnId)
      if (!connectRes.success) {
        throw new Error(connectRes.error || "Connection failed")
      }

      let homeDir = "/"
      try {
        homeDir = await sshService.getHomeDirectory(sftpConnId)
      } catch (e) {
        console.error("Failed to get home directory:", e)
      }

      // Windows 远程：homeDir 可能是 C:\Users\...，确保非空时直接使用
      // 若返回 POSIX 路径（如 /home/foo），说明 home 查询失败，回退到 C:\
      const baseId = toBaseServerId(serverId)
      const srv = servers.find(s => s.id === baseId)
      if (srv?.targetType === 'windows' && homeDir && !homeDir.includes(':') && !homeDir.startsWith('\\\\')) {
        homeDir = 'C:\\'
      }
      setLeftServerId(sftpConnId)
      setLocalPath(homeDir || "/")
      setSelectedLocalPaths(new Set())
      setLocalSearch('')
      await loadLocalDirectory(homeDir, 'remote', sftpConnId)
    } catch (err) {
      console.error("Left connection error:", err)
      setLocalError(getErrorMessage(err, String(err)))
      setLeftServerId("")
    } finally {
      setConnectingLeftServerId("")
    }
  }

  const handleConnectServer = async (serverId: string) => {
    // ─── 多标签改造：连接前确保有可用的 active tab ───
    // 规则：
    // 1. 若 rightTabs 为空（首次连接）：创建第一个 tab
    // 2. 若当前 active tab 是空的（未连接且未在连接中）：复用该 tab
    // 3. 否则（active tab 已连接或在连接中）：新建 tab
    // 这样保证用户在服务器列表点击连接时，要么复用空 tab，要么新建 tab
    const currentTab = activeRightTab
    const isCurrentTabEmpty = currentTab && !currentTab.serverId && !currentTab.connectingId
    if (rightTabs.length === 0 || !currentTab) {
      const newId = createRightTab()
      if (!newId) return  // 已达上限
    } else if (!isCurrentTabEmpty) {
      // 当前 tab 已被占用，新建 tab
      const newId = createRightTab()
      if (!newId) return  // 已达上限
    }
    // 此时 active tab 必为空 tab（serverId/connectingId 都为空）
    setBatchSelectedServerIds(new Set())

    const sftpConnId = toSftpConnId(serverId)
    const baseId = toBaseServerId(serverId)
    setConnectingServerId(sftpConnId)
    setRemoteError(null)
    try {
      const connectRes = await sshService.connect(sftpConnId)
      if (!connectRes.success) {
        throw new Error(connectRes.error || 'Connection failed')
      }

      // 按目标类型获取路径工具（Linux/Windows 完全隔离）
      const srv = servers.find(s => s.id === baseId)
      const isWin = srv?.targetType === 'windows'
      const pathUtils = getPathUtils(srv?.targetType || 'linux')
      let homeDir = pathUtils.getDefaultHomeDir()
      try {
        const fetched = await sshService.getHomeDirectory(sftpConnId)
        if (fetched) {
          // Windows targetType 但返回了 POSIX 路径（如 /），忽略用兜底
          if (isWin && !fetched.includes(':') && !fetched.startsWith('\\\\')) {
            // 保持 homeDir = 默认值
          } else {
            homeDir = fetched
          }
        }
      } catch (e) {
        console.error('Failed to get home directory:', e)
      }

      // Windows 远程：获取盘符列表用于磁盘切换栏
      if (srv?.targetType === 'windows') {
        try {
          const drives = await backend?.files.listDrives(sftpConnId)
          setRemoteDrives(drives || ['C:\\'])
        } catch {
          setRemoteDrives(['C:\\'])
        }
      } else {
        setRemoteDrives([])
      }

      // 切换服务器时重置传输记录和冲突状态，避免上一会话残留错配
      setTransferRecords([])
      pendingPathsRef.current.clear()
      resetConflictState()

      setSelectedServerId(sftpConnId)
      // 优先恢复上次访问路径；失败则回退到 home 目录
      // 注意：Windows 远程的 home 目录形如 C:\Users\Admin，不应视为无效路径
      const lastPath = (() => {
        try { return localStorage.getItem(`qshell.sftp.last-remote-path.${baseId}`) || '' }
        catch { return '' }
      })()
      // 校验上次路径与当前 targetType 兼容（通过平台专属工具函数判断）
      if (pathUtils.isPathCompatible(lastPath)) {
        try {
          await loadRemoteDirectory(sftpConnId, lastPath)
          return
        } catch {
          // 上次路径无效（可能已被删除），回退到 home 目录
        }
      }
      await loadRemoteDirectory(sftpConnId, homeDir || '/')
    } catch (err: unknown) {
      console.error('Connection error:', err)
      setRemoteError(getErrorMessage(err, String(err)))
    } finally {
      setConnectingServerId('')
    }
  }

  // 原地重连服务器（保留当前标签页及断线前所在目录现场）
  const handleReconnectServer = useCallback(async (tabId?: string) => {
    const currentTabs = rightTabsRef.current
    const targetTab = tabId
      ? currentTabs.find(t => t.id === tabId)
      : currentTabs.find(t => t.id === activeRightTabIdRef.current)
    const targetServerId = targetTab?.serverId || selectedServerIdRef.current
    if (!targetServerId || isReconnecting) return

    const targetPath = targetTab?.path || remotePathRef.current || '/'
    reconnectManager.cancelRetry(targetServerId)
    setIsReconnecting(true)
    setRemoteLoading(true)
    setRemoteError(null)

    try {
      const connectRes = await sshService.connect(targetServerId)
      if (!connectRes.success) {
        throw new Error(connectRes.error || tRef.current('sftp_reconnect_failed'))
      }

      // Windows 盘符更新
      const srv = servers.find(s => s.id === toBaseServerId(targetServerId))
      if (srv?.targetType === 'windows') {
        try {
          const drives = await backend?.files.listDrives(targetServerId)
          setRemoteDrives(drives || ['C:\\'])
        } catch {
          setRemoteDrives(['C:\\'])
        }
      }

      setIsRemoteDisconnected(false)
      setRemoteDisconnectedError(null)
      setRightTabs(prev => prev.map(t =>
        t.serverId === targetServerId
          ? { ...t, disconnected: false, disconnectedError: null, error: null, connectingId: '', loading: false }
          : t
      ))

      // 原地刷新目录！
      loadRemoteDirectoryRef.current(targetServerId, targetPath)

      playSound(SoundType.CONNECTED)
      toastRef.current.success(tRef.current('sftp_reconnect_success'))

      const hasResumable = transferRecordsRef.current.some(
        r => r.status === 'failed' && r.resumable && r.serverId === targetServerId
      )
      if (hasResumable) {
        toastRef.current.info(tRef.current('sftp_resume_all_transfers_tip'))
      }
    } catch (err: unknown) {
      const errMsg = getErrorMessage(err, String(err))
      console.error('Reconnect failed:', err)
      setRemoteDisconnectedError(errMsg)
      playSound(SoundType.ERROR)
      toastRef.current.error(`${tRef.current('sftp_reconnect_failed')}: ${errMsg}`)
    } finally {
      setIsReconnecting(false)
      setRemoteLoading(false)
      setConnectingServerId('')
    }
  }, [isReconnecting, servers])

  // 用户主动退出断开的服务器标签（返回服务器选择列表）
  const handleExitDisconnectedServer = useCallback(() => {
    setIsRemoteDisconnected(false)
    setRemoteDisconnectedError(null)
    setSelectedServerId('')
    setRemotePath('')
    setRemoteFiles([])
    setRemoteError(null)
    setRightViewMode(sftpRemoteViewMode || 'list')
    setRightShowHidden(sftpRemoteShowHidden ?? true)
    const activeId = activeRightTabIdRef.current
    if (activeId) {
      setRightTabs(prev => prev.map(t =>
        t.id === activeId
          ? { ...createEmptyRightTab(sftpRemoteViewMode || 'list', sftpRemoteShowHidden ?? true), id: t.id }
          : t
      ))
    }
  }, [sftpRemoteViewMode, sftpRemoteShowHidden, setRightShowHidden])

  // 批量打开/连接多个服务器的 SFTP 传输标签（支持从 Dashboard 联动消费或 SFTP 内部批量连接）
  const handleBatchConnectServers = useCallback(async (serverIds: string[]) => {
    if (!serverIds || serverIds.length === 0) return

    // 1. 去重并校验有效性（过滤不存在的 ID）
    const uniqueIds = Array.from(new Set(serverIds)).filter(id => servers.some(s => s.id === id))
    if (uniqueIds.length === 0) return

    // 2. 区分：哪些服务器已经在现有 rightTabs 中打开了？或正在并发连接中？
    const currentTabs = rightTabsRef.current
    const inProgress = inProgressBatchServerIdsRef.current

    const existingTabByServerId = new Map<string, RightTab>()
    for (const tab of currentTabs) {
      if (tab.serverId) existingTabByServerId.set(tab.serverId, tab)
      if (tab.connectingId) existingTabByServerId.set(tab.connectingId, tab)
    }

    // 需要新打开连接的 serverId 列表（已打开或正连接中的均过滤掉）
    const toOpenIds = uniqueIds.filter(id => !existingTabByServerId.has(id) && !inProgress.has(id))

    // 3. 计算可用槽位
    const occupiedTabs = currentTabs.filter(t => t.serverId || t.connectingId)
    const emptyTab = currentTabs.find(t => !t.serverId && !t.connectingId)

    const availableSlots = Math.max(0, MAX_RIGHT_TABS - occupiedTabs.length)
    if (availableSlots === 0 && toOpenIds.length > 0) {
      toast.warning(t('sftp_max_tabs_reached', { max: MAX_RIGHT_TABS }))
      const firstExisting = uniqueIds.find(id => existingTabByServerId.has(id))
      if (firstExisting) {
        switchToRightTab(existingTabByServerId.get(firstExisting)!.id)
      }
      return
    }

    let finalOpenIds = toOpenIds
    if (finalOpenIds.length > availableSlots) {
      toast.warning(t('sftp_max_tabs_reached', { max: MAX_RIGHT_TABS }))
      finalOpenIds = finalOpenIds.slice(0, availableSlots)
    }

    // 如果没有需要新打开的，只需激活第一个已存在的 tab
    if (finalOpenIds.length === 0) {
      const firstExisting = uniqueIds.find(id => existingTabByServerId.has(id))
      if (firstExisting) {
        switchToRightTab(existingTabByServerId.get(firstExisting)!.id)
      }
      return
    }

    // 登记正在连接中的 serverId，防止并发重复调度
    for (const id of finalOpenIds) {
      inProgress.add(id)
    }

    // 4. 构建新的 tabs 列表
    const tabsToCreate: RightTab[] = []
    const serverTabMap: { serverId: string; tabId: string }[] = []

    let reusedTabId: string | null = null
    let startIndex = 0

    if (emptyTab) {
      reusedTabId = emptyTab.id
      const firstSrvId = toSftpConnId(finalOpenIds[0])
      serverTabMap.push({ serverId: firstSrvId, tabId: emptyTab.id })
      startIndex = 1
    }

    for (let i = startIndex; i < finalOpenIds.length; i++) {
      const rawSid = finalOpenIds[i]
      const sid = toSftpConnId(rawSid)
      const baseSid = toBaseServerId(rawSid)
      const srv = servers.find(s => s.id === baseSid)
      const newTab = createEmptyRightTab(sftpRemoteViewMode || 'list', sftpRemoteShowHidden ?? true)
      newTab.serverId = sid
      newTab.serverName = srv?.name || srv?.host || baseSid
      newTab.connectingId = sid
      newTab.loading = true
      tabsToCreate.push(newTab)
      serverTabMap.push({ serverId: sid, tabId: newTab.id })
    }

    const primaryTabId = serverTabMap[0].tabId
    const primaryServerId = serverTabMap[0].serverId

    // 更新 rightTabs 状态（双重防御：内部对 base 进行存在性过滤，彻底杜绝重复追加）
    setRightTabs(prev => {
      let base = [...prev]
      if (reusedTabId) {
        const basePrimaryId = toBaseServerId(primaryServerId)
        const srv = servers.find(s => s.id === basePrimaryId)
        base = base.map(t => t.id === reusedTabId ? {
          ...t,
          serverId: primaryServerId,
          serverName: srv?.name || srv?.host || basePrimaryId,
          connectingId: primaryServerId,
          loading: true,
        } : t)
      }
      const existingIds = new Set<string>()
      for (const t of base) {
        if (t.serverId) existingIds.add(t.serverId)
        if (t.connectingId) existingIds.add(t.connectingId)
      }
      const safeTabsToCreate = tabsToCreate.filter(t => {
        const targetId = t.serverId || t.connectingId
        if (!targetId) return true
        if (existingIds.has(targetId)) return false
        existingIds.add(targetId)
        return true
      })
      const nextTabs = [...base, ...safeTabsToCreate]
      rightTabsRef.current = nextTabs
      return nextTabs
    })

    // 激活首个 tab 并初始化其工作副本
    setActiveRightTabId(primaryTabId)
    setSelectedServerId(primaryServerId)
    setConnectingServerId(primaryServerId)
    setRemotePath('')
    setRemoteFiles([])
    setRemoteLoading(true)
    setRemoteSearch('')
    setSelectedRemotePaths(new Set())
    setRemoteError(null)

    // 5. 并发执行连接
    try {
      for (const item of serverTabMap) {
        const { serverId: sid, tabId: tid } = item
        const baseSid = toBaseServerId(sid)
        void (async () => {
          try {
            const connectRes = await sshService.connect(sid)
            if (!connectRes.success) {
              throw new Error(connectRes.error || 'Connection failed')
            }

            const srv = servers.find(s => s.id === baseSid)
            const isWin = srv?.targetType === 'windows'
            const pathUtils = getPathUtils(srv?.targetType || 'linux')
            let homeDir = pathUtils.getDefaultHomeDir()
            try {
              const fetched = await sshService.getHomeDirectory(sid)
              if (fetched) {
                if (isWin && !fetched.includes(':') && !fetched.startsWith('\\\\')) {
                  // keep default
                } else {
                  homeDir = fetched
                }
              }
            } catch (e) {
              console.error('Failed to get home directory:', e)
            }

            const lastPath = (() => {
              try { return localStorage.getItem(`qshell.sftp.last-remote-path.${baseSid}`) || '' }
              catch { return '' }
            })()
            const targetPath = (pathUtils.isPathCompatible(lastPath) ? lastPath : homeDir) || '/'

            let files: FileEntry[] = []
            if (backend) {
              try {
                files = await backend.files.list(sid, targetPath)
              } catch (listErr) {
                console.warn('Failed to list files for batch tab:', listErr)
              }
            }

            // 如果该 tab 当前处于 active 状态，更新工作副本
            if (activeRightTabIdRef.current === tid) {
              setSelectedServerId(sid)
              setConnectingServerId('')
              setRemotePath(targetPath)
              setRemoteFiles(files)
              setRemoteLoading(false)
              setRemoteError(null)
              if (isWin && backend) {
                try {
                  const drives = await backend.files.listDrives(sid)
                  setRemoteDrives(drives)
                } catch {
                  setRemoteDrives(['C:\\'])
                }
              }
            }

            // 无论是否 active，都更新 rightTabs 保证真源数据完整
            setRightTabs(prevTabs => {
              const updated = prevTabs.map(t => {
                if (t.id !== tid) return t
                return {
                  ...t,
                  serverId: sid,
                  serverName: srv?.name || srv?.host || baseSid,
                  connectingId: '',
                  path: targetPath,
                  files,
                  loading: false,
                  error: null,
                }
              })
              rightTabsRef.current = updated
              return updated
            })
          } catch (err: unknown) {
            const errMsg = getErrorMessage(err, String(err))
            if (activeRightTabIdRef.current === tid) {
              setConnectingServerId('')
              setRemoteError(errMsg)
              setRemoteLoading(false)
            }
            setRightTabs(prevTabs => {
              const updated = prevTabs.map(t => {
                if (t.id !== tid) return t
                return {
                  ...t,
                  connectingId: '',
                  loading: false,
                  error: errMsg,
                }
              })
              rightTabsRef.current = updated
              return updated
            })
          } finally {
            inProgressBatchServerIdsRef.current.delete(sid)
          }
        })()
      }
    } catch {
      for (const sid of finalOpenIds) {
        inProgressBatchServerIdsRef.current.delete(sid)
      }
    }
  }, [servers, toast, t, switchToRightTab, sftpRemoteViewMode, sftpRemoteShowHidden])

  const handleBatchConnectServersRef = useRef(handleBatchConnectServers)
  handleBatchConnectServersRef.current = handleBatchConnectServers

  const lastProcessedBatchKeyRef = useRef<{ key: string; time: number }>({ key: '', time: 0 })

  // 消费从 Dashboard 等处传入的批量打开 SFTP 服务器队列
  useEffect(() => {
    if (sftpPendingOpenServerIds && sftpPendingOpenServerIds.length > 0) {
      const ids = [...sftpPendingOpenServerIds]
      const batchKey = [...ids].sort().join(',')
      const now = Date.now()
      clearSftpPendingOpenServers()

      if (batchKey === lastProcessedBatchKeyRef.current.key && now - lastProcessedBatchKeyRef.current.time < 3000) {
        return
      }
      lastProcessedBatchKeyRef.current = { key: batchKey, time: now }

      void handleBatchConnectServersRef.current(ids)
    }
  }, [sftpPendingOpenServerIds, clearSftpPendingOpenServers])

  // Load system roots and initial local directory
  useEffect(() => {
    const initLocal = async () => {
      if (!backend) return
      try {
        const roots = await backend.files.getSystemRoots()
        setSystemRoots(roots)

        let initialPath = readLastLocalPath()
        if (!initialPath && roots.length > 0) {
          initialPath = roots[0]
        }
        if (initialPath) {
          await loadLocalDirectory(initialPath)
        }
      } catch (err) {
        console.error('Failed to initialize local explorer:', err)
      }
    }
    initLocal()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // === 传输限速同步（功能2）===
  // store 值变化时同步到后端（应用启动时 store 从 localStorage 恢复后也会触发一次）
  useEffect(() => {
    if (!backend) return
    sshService.setTransferRateLimit(transferRateLimit).catch(err => {
      console.warn('[RateLimit] sync failed:', err)
    })
  }, [transferRateLimit])

  // === 传输排除与忽略规则同步 ===
  useEffect(() => {
    if (!backend) return
    sshService.setExclusionConfig(sftpExclusionEnabled, sftpExclusionPatterns, sftpRespectGitignore).catch(err => {
      console.warn('[ExclusionConfig] sync failed:', err)
    })
  }, [sftpExclusionEnabled, sftpExclusionPatterns, sftpRespectGitignore])

  // === 递归搜索（功能1）===
  // searchMode 为 recursive 时，输入关键词后 debounce 500ms 触发搜索
  // 用请求序号丢弃过期响应（用户快速输入时只采纳最后一次结果）
  const recursiveSearchReqIdRef = useRef<number>(0)
  useEffect(() => {
    if (searchMode !== 'recursive') {
      setSearchResults([])
      setRecursiveSearching(false)
      return
    }
    const pattern = recursiveSearchPattern.trim()
    if (!pattern || !selectedServerId || !remotePath) {
      setSearchResults([])
      setRecursiveSearching(false)
      return
    }
    const reqId = ++recursiveSearchReqIdRef.current
    setRecursiveSearching(true)
    const timer = setTimeout(async () => {
      try {
        const paths = await sshService.searchFilesRecursive(selectedServerId, remotePath, pattern, 500)
        // 丢弃过期响应
        if (recursiveSearchReqIdRef.current !== reqId) return
        const results: SearchResult[] = paths.map(p => {
          const lastSlash = p.lastIndexOf('/')
          const name = lastSlash >= 0 ? p.slice(lastSlash + 1) : p
          const parentDir = lastSlash > 0 ? p.slice(0, lastSlash) : '/'
          return { path: p, name, parentDir }
        })
        setSearchResults(results)
      } catch (err) {
        if (recursiveSearchReqIdRef.current !== reqId) return
        console.warn('[RecursiveSearch] failed:', err)
        setSearchResults([])
      } finally {
        if (recursiveSearchReqIdRef.current === reqId) {
          setRecursiveSearching(false)
        }
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [searchMode, recursiveSearchPattern, selectedServerId, remotePath])

  // 点击搜索结果：跳转到该文件所在目录并选中
  const handleSearchResultClick = useCallback((result: SearchResult) => {
    if (!selectedServerId) return
    // 切换到过滤模式，清空搜索关键词，跳转到父目录
    setSearchMode('filter')
    setRecursiveSearchPattern('')
    setSearchResults([])
    setRemoteSearch('')
    loadRemoteDirectory(selectedServerId, result.parentDir)
    // 延迟选中（等目录加载完成），用 setTimeout 简化避免与 remoteFiles 异步加载竞态
    setTimeout(() => {
      if (!mountedRef.current) return
      setSelectedRemotePaths(new Set([result.path]))
    }, 500)
  }, [selectedServerId, loadRemoteDirectory])

  // 订阅 SSH 状态变化：处理外部断连（网络故障/心跳超时/服务端主动关闭）
  // 多标签改造：
  // - 任何 tab 的 serverId 断连：把所有 transferring 记录标记为 failed（传输记录全局共享）
  // - 非 active tab 断连：只更新 rightTabs 中该 tab 的 error 字段（保留 serverId/path/files，用户切换过去能看到错误）
  // - active tab 断连：清空工作副本（useEffect 会同步到 rightTabs），并清理冲突状态
  // 注意：用户手动断开由 handleDisconnect → closeRightTab 处理，此处仅处理外部断连；重复标记为 failed 是幂等的。
  // generation 版本号校验：后端每次新连接 +1，丢弃 generation < 已知的过期事件，
  // 避免事件乱序导致状态回退（例如旧 Ready 事件晚于新 Disconnecting 事件到达）
  const knownGenerationsRef = useRef<Map<string, number>>(new Map())
  useEffect(() => {
    if (!backend) return
    const unsubscribe = sshService.onStateChanged((data) => {
      // generation 过期检查：丢弃乱序到达的旧事件
      const known = knownGenerationsRef.current.get(data.serverId) ?? 0
      if (data.generation < known) return
      knownGenerationsRef.current.set(data.serverId, data.generation)
      const currentId = selectedServerIdRef.current
      const isActiveTab = currentId && data.serverId === currentId

      // 连接成功恢复：清除离线断连标记，并就地刷新目录
      if (data.state === ConnectionState.Ready) {
        if (isActiveTab) {
          const wasDisconnected = rightTabsRef.current.find(t => t.id === activeRightTabIdRef.current)?.disconnected
          setIsRemoteDisconnected(false)
          setRemoteDisconnectedError(null)
          if (wasDisconnected) {
            const targetPath = rightTabsRef.current.find(t => t.id === activeRightTabIdRef.current)?.path || remotePathRef.current || '/'
            Promise.resolve(loadRemoteDirectoryRef.current(data.serverId, targetPath)).catch(console.error)
          }
        }
        setRightTabs(prev => prev.map(t =>
          t.serverId === data.serverId
            ? { ...t, disconnected: false, disconnectedError: null, error: null }
            : t
        ))
        return
      }

      if (data.state !== ConnectionState.Disconnected && data.state !== ConnectionState.Failed) return

      const disconnectReason = data.error || tRef.current('sftp_transfer_disconnected')

      // 传输因连接断开/失败终止：连接状态音（Submarine/Basso）已由 workspace.tsx
      // 的 onStateChanged 统一播放，此处不再重复播音，仅更新传输状态

      // 1. 把所有 transferring 记录标记为 failed（传输记录全局共享）
      setTransferRecords(prev => prev.map(r =>
        r.status === 'transferring'
          ? {
              ...r,
              status: 'failed' as const,
              error: disconnectReason,
              completedAt: Date.now(),
              rate: 0,
              resumable: isResumableTmpPath(r.tmpPath) && r.lastOffset > 0 && r.total > 0 && r.lastOffset < r.total,
            }
          : r
      ))

      if (isActiveTab) {
        // 2a. active tab 断连：对标 WinSCP / Termius，绝不清空工作区！
        // 保留 selectedServerId、remotePath、remoteFiles 快照现场，仅置离线标记
        setIsRemoteDisconnected(true)
        setRemoteDisconnectedError(disconnectReason)
        setConnectingServerId('')
        setRemoteLoading(false)

        // 清理冲突状态（冲突对话框是全局唯一的）
        pendingPathsRef.current.clear()
        if (pendingConflictRef.current) {
          pendingConflictRef.current.resolve('skip')
          pendingConflictRef.current = null
          setPendingConflict(null)
        }
        conflictQueueRef.current.forEach(item => item.resolve('skip'))
        conflictQueueRef.current = []
        conflictStoppedRef.current = false
        conflictApplyToAllRef.current = false
        conflictCachedActionRef.current = null
      }

      // 2b. 更新所有匹配 serverId 的 rightTabs 状态为 disconnected
      setRightTabs(prev => prev.map(t =>
        t.serverId === data.serverId
          ? {
              ...t,
              loading: false,
              connectingId: '',
              disconnected: true,
              disconnectedError: disconnectReason,
              error: null,
            }
          : t
      ))
    })
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [])

  // 订阅传输进度事件，维护本会话内的传输记录列表
  // 使用 ref 持有 panelOpen 状态避免依赖导致的重复订阅/丢事件
  const transferPanelOpenRef = useRef(transferPanelOpen)
  transferPanelOpenRef.current = transferPanelOpen
  useEffect(() => {
    // 单条进度事件的实际处理逻辑（bytes 事件会先进入合批缓冲，再由 flush 统一调用）
    const processProgressEvent = (data: TransferProgressData) => {
      if (!mountedRef.current) return
      // 忽略打包阶段进度（不影响传输记录）
      if (data.phase === 'packing' || data.phase === 'packed') return

      const { transferId, type, current, total, fileName, done, totalType, tmpPath, phase } = data
      // 目录传输任务（manifest 清单或 count 计数事件）均标记为目录传输任务
      if (totalType === 'manifest' || totalType === 'count') {
        directoryTransferIdsRef.current.add(transferId)
      }
      // manifest 是目录正式传输前的子文件清单事件。它不参与父记录进度计算，
      // 按动画帧批量写入，避免数千文件扫描时触发数千次 React 重渲染。
      if (totalType === 'manifest') {
        directoryTransferIdsRef.current.add(transferId)
        const pending = manifestBufferRef.current.get(transferId) || []
        pending.push({
          path: fileName,
          size: total,
          current: 0,
          total,
          status: 'waiting',
        })
        manifestBufferRef.current.set(transferId, pending)
        if (manifestFlushRafRef.current === null) {
          manifestFlushRafRef.current = requestAnimationFrame(() => {
            manifestFlushRafRef.current = null
            const batches = manifestBufferRef.current
            manifestBufferRef.current = new Map()
            setTransferChildren(prev => {
              const next = { ...prev }
              for (const [id, items] of batches) {
                const existing = new Map((next[id] || []).map(item => [item.path, item]))
                for (const item of items) {
                  const prevChild = existing.get(item.path)
                  if (!prevChild || prevChild.status === 'waiting') {
                    existing.set(item.path, item)
                  }
                }
                next[id] = Array.from(existing.values()).slice(0, 5000)
              }
              return next
            })
          })
        }
        return
      }
      // 首个非 manifest 事件的 fileName 即顶层记录名，同步登记（不依赖可能滞后的 transferRecordsRef）
      if (!transferTopNameRef.current.has(transferId)) {
        transferTopNameRef.current.set(transferId, fileName)
      }
      const isDoneSignal = !!done && total === 0
      // 失败结束信号：done===false（后端在传输失败时发送，携带 error 原因）
      const isFailSignal = done === false
      const effectiveTotal = isDoneSignal ? undefined : total
      const effectiveCurrent = isDoneSignal ? undefined : current
      const percent = effectiveTotal && effectiveTotal > 0
        ? Math.round((effectiveCurrent! / effectiveTotal) * 100)
        : done ? 100 : 0
      const now = Date.now()

      // 传输完成（done 信号）：500ms 节流播放 Success 音，
      // 批量传输小文件时只响一次，大文件传输间隔远超 500ms 不受影响。
      // 失败状态由 Disconnected/Failed 事件分支处理。
      if (isDoneSignal) {
        const nowMs = Date.now()
        if (nowMs - lastSuccessSoundRef.current > 500) {
          playSound(SoundType.Success)
          lastSuccessSoundRef.current = nowMs
        }
      }

      // phase=tmpLost：续传时临时文件丢失，后端已降级为全新传输
      // 前端需：1) 显示 toast 提示用户 2) 重置进度记录（current=0, tmpPath 更新为新值）
      if (phase === 'tmpLost') {
        showTransferNotice(tRef.current('sftp_transfer_tmp_lost'))
      }

      // 先检查是否为已存在的传输记录（用于决定是否需要消费 pendingPathsRef）
      // 注意：不能在 setTransferRecords 的 updater 内部执行 arr.shift() 等副作用——
      // React 18 StrictMode 会双重调用 updater 来检测副作用，第二次 shift 会取出错误的条目或抛错。
      // 因此在 updater 外部同步消费 pendingPathsRef，把结果通过闭包传入 updater。
      const existingRecord = transferRecordsRef.current.find(t => t.transferId === transferId)
      let pendingSource: string | undefined
      let pendingTarget: string | undefined
      let pendingSourceServer: string | undefined
      let pendingTargetServer: string | undefined
      let pendingServerId: string | undefined
      if (!existingRecord) {
        // 新传输：从 pendingPathsRef 取出源/目标路径（按 fileName 取）
        // 若 fileName 有多条 pending（同名文件不同源），按 FIFO 取最早一条
        const map = pendingPathsRef.current
        const arr = map.get(fileName)
        if (arr && arr.length > 0) {
          const item = arr.shift()!
          pendingSource = item.source
          pendingTarget = item.target
          pendingSourceServer = item.sourceServerName
          pendingTargetServer = item.targetServerName
          pendingServerId = item.serverId
          if (arr.length === 0) map.delete(fileName)
        }
      }

      // 首次收到 tmp_path（新记录）触发目标目录刷新，让用户立即看到临时文件
      // 在 setTransferRecords updater 外部执行，避免 StrictMode 双调用副作用
      // 后端发送 tmp_path 事件时临时文件可能还在创建中（SFTP open_with_flags 需网络往返），
      // 加 150ms 延迟确保 ls 能列到临时文件
      if (!existingRecord && tmpPath) {
        const effectiveServerId = pendingServerId || selectedServerIdRef.current
        if (type === 'upload' && effectiveServerId) {
          setTimeout(() => {
            if (selectedServerIdRef.current === effectiveServerId) {
              loadRemoteDirectoryRef.current(effectiveServerId, remotePathRef.current)
            }
          }, 150)
        } else if (type === 'download') {
          setTimeout(() => {
            loadLocalDirectoryRef.current(localPathRef.current)
          }, 150)
        }
      }

      setTransferRecords(prev => {
        const existing = prev.find(t => t.transferId === transferId)
        if (existing) {
          // 失败结束信号：将传输记录置为失败并带上后端返回的原因
          // （如目标目录无写入权限。仅覆盖尚未定型的进行中/已完成记录，避免回退已失败/取消记录）
          // 状态守卫（必须）：暂停/取消时后端也会发 done=false（error 含 canceled），
          // 若不加守卫会把 paused/canceled 记录改写成 failed —— 暂停→续传按钮消失（断点续传断裂）、
          // 取消被误显示为失败。仅 transferring 中的记录才允许被失败信号定型。
          if (isFailSignal) {
            return prev.map(t => {
              if (t.transferId !== transferId) return t
              if (t.status !== 'transferring') return t
              return {
                ...t,
                status: 'failed' as const,
                error: (data.error as string) || t.error || tRef.current('sftp_upload_failed'),
                completedAt: now,
                rate: 0,
                resumable: false,
                resuming: false,
              }
            })
          }
          // phase=tmpLost：后端降级为全新传输，重置进度记录
          // tmpPath 更新为后端新发送的值，current/lastOffset/percent 归零，重置 startTime
          if (phase === 'tmpLost') {
            return prev.map(t =>
              t.transferId === transferId
                ? {
                    ...t,
                    current: 0,
                    total: 0,
                    percent: 0,
                    // 更新为新 tmpPath（用于下次续传）
                    tmpPath: tmpPath ?? t.tmpPath,
                    // 重置续传状态
                    lastOffset: 0,
                    lastCurrent: 0,
                    lastRateBytes: 0,
                    lastRateTime: now,
                    lastUpdate: now,
                    startTime: now,
                    elapsedMs: 0,
                    rate: 0,
                    resumable: false,
                    resuming: true,
                    // 状态保持 transferring（已在 resumeTransfer 中设置）
                    status: 'transferring' as const,
                  }
                : t
            )
          }

          const isDirectoryRecord = existing.totalType === 'count'
            || directoryTransferIdsRef.current.has(transferId)
          // 目录父记录只接收文件计数事件。子文件的 bytes 事件仅用于更新展开详情，
          // 不能覆盖父记录的 current/total，否则分母会随当前文件大小不断变化。
          const shouldUpdateParentProgress = !isDirectoryRecord || totalType === 'count'

          // 锁定总数分母：一旦获取到有效总数（> 0），分母绝对保持不变（绝不被 0 冲掉，也绝不降低缩水）
          let newTotal = existing.total
          if (shouldUpdateParentProgress) {
            if (effectiveTotal !== undefined && effectiveTotal > 0) {
              if (isDirectoryRecord) {
                if (existing.total === 0) {
                  newTotal = effectiveTotal
                }
              } else {
                newTotal = effectiveTotal
              }
            }
          }

          let newCurrent = existing.current
          if (shouldUpdateParentProgress) {
            if (effectiveCurrent !== undefined) {
              newCurrent = Math.max(existing.current, effectiveCurrent)
            }
          }

          // 传输完成时（isDoneSignal 结束信号或 done: true）：
          // 确保分子（current）严丝合缝对齐总数（total），显示例如 3000/3000，前后数量绝对对齐；
          // 分母（total）在整个过程中始终锁定保持不变。
          if (isDoneSignal || done) {
            if (newTotal > 0) {
              newCurrent = newTotal
            } else if (newCurrent > 0) {
              newTotal = newCurrent
            }
          }
          // 速率采样窗口机制：
          // 高速传输时 IPC 进度事件可能每 20ms~50ms 到达一次。若每次都把 lastUpdate 设为 now，
          // 相邻事件的 dt 永远 < 0.25s，导致速率计算分支永远进不去（被锁死在低速或 0）。
          // 正确机制：使用专门的 lastRateTime 与 lastRateBytes 维护采样基准点，只有当
          // (now - lastRateTime) 累计达到 250ms 时才结算一次瞬时速率并推进基准点；
          // lastUpdate 则记录任意数据包到达的最新绝对时间，供 1s 闲置看门狗识别静默。
          const rateStartTime = existing.lastRateTime ?? existing.lastUpdate ?? existing.startTime
          const rateStartBytes = existing.lastRateBytes ?? existing.lastCurrent ?? 0
          const dt = (now - rateStartTime) / 1000
          const dBytes = newCurrent - rateStartBytes
          let rate = existing.rate
          let newLastRateTime = existing.lastRateTime ?? rateStartTime
          let newLastRateBytes = existing.lastRateBytes ?? rateStartBytes

          if (!isDoneSignal && dBytes >= 0) {
            if (dt >= 0.25 || (existing.rate === 0 && dBytes > 0 && dt >= 0.05)) {
              if (dt > 0) {
                const instantRate = dBytes / dt
                rate = existing.rate > 0
                  ? existing.rate * RATE_SMOOTHING_ALPHA + instantRate * (1 - RATE_SMOOTHING_ALPHA)
                  : instantRate
              }
              newLastRateTime = now
              newLastRateBytes = newCurrent
            }
          }
          return prev.map(t =>
            t.transferId === transferId
              ? {
                  ...t,
                  current: newCurrent,
                  total: newTotal,
                  // 目录任务一旦识别就固定为 count；后续子文件事件不能把它覆盖成 bytes，
                  // 否则左侧展开按钮会随进度事件出现/消失。
                  totalType: (t.totalType === 'count' || directoryTransferIdsRef.current.has(transferId))
                    ? 'count'
                    : (totalType ?? t.totalType),
                  // tmpPath 仅在首个进度事件携带，已存在则不覆盖
                  // 目录刷新逻辑已移到 setTransferRecords 调用之前（新记录创建时触发）
                  tmpPath: t.tmpPath ?? tmpPath,
                  percent: isDoneSignal
                    ? (t.percent > 0 ? t.percent : 100)
                    : shouldUpdateParentProgress
                      ? percent
                      : t.percent,
                  // 文件夹传输时，初始事件携带顶层文件夹名（如 myfolder），
                  // 后续子文件进度事件携带子文件名（如 a.txt），不应覆盖已有记录的 fileName。
                  // 优先保持已有值；仅当已有值为空（边界情况）才用新事件的 fileName 填充。
                  fileName: t.fileName || fileName,
                  // currentSubFile：仅文件夹递归传输（totalType=count）的 transferring 状态维护
                  // - 子文件事件（fileName 与顶层名不同）：更新为当前子文件名
                  // - 初始事件或单文件传输（fileName 与顶层名相同）：保持 undefined
                  // - done 事件：清空，传输完成只显示顶层文件夹名
                  currentSubFile: done
                    ? undefined
                    : (fileName && fileName !== (t.fileName || fileName))
                      ? (fileName.split(/[/\\]/).pop() || fileName)
                      : t.currentSubFile,
                  // 状态保护：canceled/paused/failed/completed 已定型，不应被后续迟到事件覆盖
                  // - canceled/failed：断点续传正确判断的前提
                  // - paused：用户暂停后保留续传状态，避免迟到事件回退为 transferring
                  // - completed：避免迟到进度事件把已完成记录回退为 transferring
                  status: t.status === 'canceled' as const
                    ? 'canceled' as const
                    : t.status === 'paused' as const
                    ? 'paused' as const
                    : t.status === 'failed' as const
                    ? 'failed' as const
                    : t.status === 'completed' as const
                    ? 'completed' as const
                    : done ? 'completed' as const : 'transferring' as const,
                  lastUpdate: now,
                  lastCurrent: newCurrent,
                  lastRateTime: newLastRateTime,
                  lastRateBytes: newLastRateBytes,
                  // 跟踪最后一次已知已传输字节数（用于断点续传 offset）
                  lastOffset: newCurrent,
                  rate: done ? 0 : rate,
                  finalRate: (done || isDoneSignal)
                    ? (rate > 0
                        ? rate
                        : (t.finalRate ?? (t.rate > 0 ? t.rate : ((now - t.startTime > 0 && newTotal > 0 && !isDirectoryRecord) ? Math.round(newTotal / ((now - t.startTime) / 1000)) : undefined))))
                    : (rate > 0 ? rate : t.finalRate),
                  elapsedMs: done ? t.elapsedMs : now - t.startTime,
                  completedAt: done ? now : t.completedAt,
                  // 成功完成时清除 resumable；resuming 状态在 done 时也清除
                  // 但 paused 状态保留 resumable：暂停后后端会发送 done 事件，不应清除续传标志
                  // 传输进行中且已知临时文件路径时标记 resumable=true，
                  // 使「传输中」的传输在关闭 SFTP 后也能断点重传
                  resumable: done
                    ? (t.status === 'paused' as const ? t.resumable : false)
                    : (t.tmpPath || tmpPath ? true : t.resumable),
                  resuming: done ? (t.status === 'paused' as const ? t.resuming : false) : t.resuming,
                  // 当收到非 preflight 事件时清除 phase，使 UI 从"正在检查…"切换到"传输中"
                  phase: data.phase || undefined,
                }
              : t
          )
        }
        // 新传输：使用 updater 外部已消费的 pendingSource/pendingTarget
        const newItem: TransferRecordItem = {
          transferId,
          type: type as 'upload' | 'download' | 's2s',
          // 捕获真实发起传输的服务器 ID，用于后续取消/恢复/清理临时文件时定位正确的服务器
          serverId: pendingServerId || selectedServerIdRef.current || '',
          // 失败结束信号可能 fileName 为空（预检即失败），用 pending 源路径推导文件名兜底
          fileName: fileName || (pendingSource ? pendingSource.split(/[/\\]/).pop() || fileName : fileName),
          // 新记录刚创建时还没有子文件事件到达，currentSubFile 留空
          currentSubFile: undefined,
          sourcePath: pendingSource,
          targetPath: pendingTarget,
          sourceServerName: pendingSourceServer,
          targetServerName: pendingTargetServer,
          current: effectiveCurrent ?? 0,
          total: effectiveTotal ?? 0,
          totalType: (directoryTransferIdsRef.current.has(transferId) || totalType === 'count') ? 'count' : totalType,
          // 捕获首个进度事件携带的 tmpPath（用于断点续传）
          tmpPath: tmpPath,
          percent: isFailSignal ? 0 : isDoneSignal ? 100 : percent,
          status: isFailSignal ? 'failed' : done ? 'completed' : 'transferring',
          error: isFailSignal ? (data.error as string || tRef.current('sftp_upload_failed')) : undefined,
          timestamp: now,
          startTime: now,
          completedAt: isFailSignal || done ? now : undefined,
          lastUpdate: now,
          lastCurrent: effectiveCurrent ?? 0,
          lastRateTime: now,
          lastRateBytes: effectiveCurrent ?? 0,
          rate: 0,
          elapsedMs: 0,
          // 断点续传相关字段初始值
          lastOffset: effectiveCurrent ?? 0,
          // 首个进度事件携带 tmpPath 即具备续传条件，标记 resumable 支持「传输中」断点重传。
          // 仅 .sw-*-tmp-<uuid> 命名（Linux 路径）支持续传；Windows 的 .uploading/.downloading 不支持。
          resumable: isResumableTmpPath(tmpPath),
          resuming: false,
          // 传输阶段标识（preflight=预检中），传递给 UI 渲染对应动画
          phase: data.phase || undefined,
        }
        // 新传输自动展开面板（通过 ref 读取最新值，避免依赖）
        if (!transferPanelOpenRef.current) setTransferPanelOpen(true)
        if (newItem.status === 'transferring') {
          sshService.registerActiveTransfer({
            transferId: newItem.transferId,
            serverId: newItem.serverId,
            fileName: newItem.fileName,
            type: newItem.type,
            tmpPath: newItem.tmpPath,
            isUpload: newItem.type === 'upload',
          })
        }
        // 限制记录上限，避免长时间运行后无限增长
        return [newItem, ...prev].slice(0, 500)
      })

      // 已有父目录记录时，把常规字节/计数事件同步到对应子文件。
      const parent = transferRecordsRef.current.find(t => t.transferId === transferId)
      const bufferedChildren = manifestBufferRef.current.get(transferId)
      const hasChildManifest = directoryTransferIdsRef.current.has(transferId)
        || !!bufferedChildren?.length
        || !!transferChildrenRef.current[transferId]?.length
      // 用同步登记的顶层名称判定子文件事件：parent 可能因渲染时序短暂滞后（见 transferTopNameRef 注释），
      // 不能用 parent?.fileName 做唯一判据，否则父级同名事件（如初始 count）会在竞态窗口内生成假子记录。
      const topName = transferTopNameRef.current.get(transferId)
      if ((parent?.totalType === 'count' || hasChildManifest) && fileName && fileName !== topName) {
        const normalized = fileName.replace(/\\/g, '/')
        if (bufferedChildren) {
          for (let index = 0; index < bufferedChildren.length; index++) {
            const child = bufferedChildren[index]
            const childNormalized = child.path.replace(/\\/g, '/')
            const matches = childNormalized === normalized
              || childNormalized.endsWith(`/${normalized}`)
              || normalized.endsWith(`/${childNormalized}`)
            if (!matches) continue
            if (totalType === 'count') {
              bufferedChildren[index] = { ...child, current: child.total, lastCurrent: child.total, lastUpdate: now, rate: 0, status: 'completed' }
            } else {
              const childRateStartTime = child.lastRateTime ?? child.lastUpdate ?? now
              const childRateStartBytes = child.lastRateBytes ?? child.lastCurrent ?? 0
              const dt = (now - childRateStartTime) / 1000
              const delta = current - childRateStartBytes
              let childRate = child.rate ?? 0
              let newChildRateTime = child.lastRateTime ?? childRateStartTime
              let newChildRateBytes = child.lastRateBytes ?? childRateStartBytes
              if (dt >= 0.25 || (childRate === 0 && delta > 0 && dt >= 0.05)) {
                if (dt > 0 && delta >= 0) {
                  const instantRate = delta / dt
                  childRate = childRate > 0
                    ? childRate * RATE_SMOOTHING_ALPHA + instantRate * (1 - RATE_SMOOTHING_ALPHA)
                    : instantRate
                }
                newChildRateTime = now
                newChildRateBytes = current
              }
              bufferedChildren[index] = {
                ...child,
                current,
                total: total > 0 ? total : child.total,
                lastCurrent: current,
                lastUpdate: now,
                lastRateTime: newChildRateTime,
                lastRateBytes: newChildRateBytes,
                rate: done ? 0 : childRate,
                status: done ? 'completed' : 'transferring',
              }
            }
          }
        }
        setTransferChildren(prev => {
          const children = prev[transferId] || []
          let changed = false
          const nextChildren = children.map(child => {
            const childNormalized = child.path.replace(/\\/g, '/')
            const matches = childNormalized === normalized
              || childNormalized.endsWith(`/${normalized}`)
              || normalized.endsWith(`/${childNormalized}`)
            if (!matches) return child
            changed = true
            if (totalType === 'count') {
              return { ...child, current: child.total, lastCurrent: child.total, lastUpdate: now, rate: 0, status: 'completed' as const }
            }
            const itemTotal = total > 0 ? total : child.total
            const childRateStartTime = child.lastRateTime ?? child.lastUpdate ?? now
            const childRateStartBytes = child.lastRateBytes ?? child.lastCurrent ?? 0
            const dt = (now - childRateStartTime) / 1000
            const delta = current - childRateStartBytes
            let childRate = child.rate ?? 0
            let newChildRateTime = child.lastRateTime ?? childRateStartTime
            let newChildRateBytes = child.lastRateBytes ?? childRateStartBytes
            if (dt >= 0.25 || (childRate === 0 && delta > 0 && dt >= 0.05)) {
              if (dt > 0 && delta >= 0) {
                const instantRate = delta / dt
                childRate = childRate > 0
                  ? childRate * RATE_SMOOTHING_ALPHA + instantRate * (1 - RATE_SMOOTHING_ALPHA)
                  : instantRate
              }
              newChildRateTime = now
              newChildRateBytes = current
            }
            return {
              ...child,
              current,
              total: itemTotal,
              lastCurrent: current,
              lastUpdate: now,
              lastRateTime: newChildRateTime,
              lastRateBytes: newChildRateBytes,
              rate: done ? 0 : childRate,
              status: done ? 'completed' as const : 'transferring' as const,
            }
          })
          if (!changed && (parent?.totalType === 'count' || directoryTransferIdsRef.current.has(transferId))) {
            const isCompleted = totalType === 'count' || !!done
            const newChild: TransferChildRecord = {
              path: fileName,
              size: totalType === 'bytes' ? total : 0,
              current: totalType === 'bytes' ? current : 1,
              total: totalType === 'bytes' ? total : 1,
              status: isCompleted ? 'completed' : 'transferring',
              lastUpdate: now,
              rate: 0,
            }
            return { ...prev, [transferId]: [newChild, ...children].slice(0, 500) }
          }
          return changed ? { ...prev, [transferId]: nextChildren } : prev
        })
      }
      if (hasChildManifest && (isDoneSignal || isFailSignal)) {
        setTransferChildren(prev => prev[transferId] ? {
          ...prev,
          [transferId]: prev[transferId].map(child => {
            if (child.status === 'completed' || child.status === 'canceled') return child
            if (isDoneSignal) return { ...child, current: child.total, status: 'completed' as const }
            // 失败时把「传输中」和「等待中」的子记录都置为失败：
            // 否则 waiting 会永远显示省略号，用户以为还在排队
            if (child.status === 'transferring' || child.status === 'waiting') {
              return { ...child, status: 'failed' as const, error: data.error || tRef.current('sftp_transfer_failed') }
            }
            return child
          }),
        } : prev)
      }
    }

    // 冲刷合批缓冲：处理 count/done 等关键事件前先冲刷，
    // 保证滞后的字节事件不会晚于终态事件被应用（进度只增不减，但顺序仍应保持）。
    const flushProgressBuffer = () => {
      if (progressFlushRafRef.current !== null) {
        cancelAnimationFrame(progressFlushRafRef.current)
        progressFlushRafRef.current = null
      }
      const buffered = progressBufferRef.current
      if (buffered.size === 0) return
      const events = Array.from(buffered.values())
      buffered.clear()
      for (const evt of events) processProgressEvent(evt)
    }

    const unsubscribe = sshService.onTransferProgress((data: TransferProgressData) => {
      // 高频道字节进度（非终态、非阶段事件）走 rAF 合批；
      // 其余事件（count/done/失败/manifest）立即处理，保证状态流转及时
      const isHighFrequencyBytes = data.totalType === 'bytes' && data.done == null && !data.phase
      if (!isHighFrequencyBytes) {
        flushProgressBuffer()
        processProgressEvent(data)
        return
      }
      // 同一文件的多次字节进度只保留最新一条，下一帧统一更新
      progressBufferRef.current.set(`${data.transferId}:${data.fileName}`, data)
      if (progressFlushRafRef.current === null) {
        progressFlushRafRef.current = requestAnimationFrame(() => {
          progressFlushRafRef.current = null
          flushProgressBuffer()
        })
      }
    })

    // 部分成功：目录传输结束后端一次性下发失败明细。
    // 记录置为 partial（而不是 completed/failed），并把失败文件补进明细列表。
    const unsubscribeFailures = sshService.onTransferFailures((data) => {
      if (!mountedRef.current) return
      const failures = data.failures || []
      if (failures.length === 0) return
      setTransferRecords(prev => prev.map(t => t.transferId === data.transferId
        ? {
            ...t,
            status: 'partial' as const,
            failedCount: failures.length,
            succeededCount: data.succeeded,
            skippedCount: data.skipped,
          }
        : t))
      setTransferChildren(prev => {
        const children = prev[data.transferId] || []
        const existing = new Set(children.map(c => c.path))
        const extra: TransferChildRecord[] = failures
          .filter(f => !existing.has(f.path))
          .map(f => ({
            path: f.path,
            size: 0,
            current: 0,
            total: 0,
            status: 'failed' as const,
            error: f.error,
            lastUpdate: Date.now(),
            rate: 0,
          }))
        if (extra.length === 0) return prev
        return { ...prev, [data.transferId]: [...extra, ...children].slice(0, 500) }
      })
      // 记录已进入终态，移出全局活跃传输表
      sshService.unregisterActiveTransfer(data.transferId)
    })

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe()
      if (typeof unsubscribeFailures === 'function') unsubscribeFailures()
      if (progressFlushRafRef.current !== null) {
        cancelAnimationFrame(progressFlushRafRef.current)
        progressFlushRafRef.current = null
      }
      progressBufferRef.current.clear()
      if (manifestFlushRafRef.current !== null) {
        cancelAnimationFrame(manifestFlushRafRef.current)
        manifestFlushRafRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 定时刷新进行中传输的已用时间与实时速率衰减（避免网络静默时速率冻结虚高）
  const hasTransferring = transferRecords.some(t => t.status === 'transferring')
  useEffect(() => {
    if (!hasTransferring) return
    const timer = setInterval(() => {
      const now = Date.now()
      setTransferRecords(prev => prev.map(t => {
        if (t.status !== 'transferring') return t
        const idleSec = (now - t.lastUpdate) / 1000
        let rate = t.rate
        let lastRateTime = t.lastRateTime
        let lastRateBytes = t.lastRateBytes
        if (idleSec >= 2.0) {
          rate = 0
          lastRateTime = now
          lastRateBytes = t.current
        } else if (idleSec >= 1.0) {
          rate = Math.round(t.rate * 0.5)
          lastRateTime = now
          lastRateBytes = t.current
        }
        return { ...t, rate, lastRateTime, lastRateBytes, elapsedMs: now - t.startTime }
      }))
      for (const [, tracker] of directoryRateTrackerRef.current.entries()) {
        const idle = (now - tracker.lastTime) / 1000
        if (idle >= 2.0) {
          tracker.smoothedRate = 0
        } else if (idle >= 1.0) {
          tracker.smoothedRate = Math.round(tracker.smoothedRate * 0.5)
        }
      }
      setTransferChildren(prev => {
        let changed = false
        const next = { ...prev }
        for (const [id, children] of Object.entries(next)) {
          const updated = children.map(c => {
            if (c.status !== 'transferring' || !c.rate) return c
            const idle = c.lastUpdate ? (now - c.lastUpdate) / 1000 : 0
            if (idle >= 2.0 && c.rate !== 0) {
              changed = true
              return { ...c, rate: 0, lastRateTime: now, lastRateBytes: c.current }
            } else if (idle >= 1.0 && c.rate > 0) {
              changed = true
              return { ...c, rate: Math.round(c.rate * 0.5), lastRateTime: now, lastRateBytes: c.current }
            }
            return c
          })
          next[id] = updated
        }
        return changed ? next : prev
      })
    }, TRANSFER_REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [hasTransferring])

  // 组件卸载时清空传输记录和所有 ref（关闭 SFTP 标签即清空）
  // 队列中的 resolve 也要调用，避免 Promise 永久挂起造成内存泄漏
  useEffect(() => {
    // React StrictMode may run effect cleanup and setup once during development;
    // re-arm the lifecycle guard whenever this effect is installed.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // 取消所有正在进行的后端传输，并清理未完成的临时文件（退出/卸载即清理，不保留跨会话孤儿文件）
      const recordsToClean = [...transferRecordsRef.current]
      transferRecordsRef.current = []

      recordsToClean.forEach(record => {
        if (record.status === 'transferring') {
          sshService.cancelTransfer(record.transferId).catch(err => {
            console.error('Failed to cancel transfer on unmount:', err)
          })
        }
        sshService.unregisterActiveTransfer(record.transferId)
      })

      // 若非全应用退出状态（全应用退出时由 cancelAndCleanupAllTransfers 全局统一低并发处理），
      // 对当前面板带有 tmpPath 的非活跃/遗留文件按 serverId 限制并发清理（每台服务器最多 2 个并发），杜绝冲击 MaxSessions
      if (!sshService.isExiting()) {
        const withTmp = recordsToClean.filter(r => !!r.tmpPath)
        const byServer = new Map<string, typeof withTmp>()
        for (const r of withTmp) {
          const sid = r.serverId || selectedServerIdRef.current
          if (sid) {
            const list = byServer.get(sid) || []
            list.push(r)
            byServer.set(sid, list)
          }
        }
        byServer.forEach((items, sid) => {
          let idx = 0
          const worker = async () => {
            while (idx < items.length) {
              const item = items[idx++]
              if (!item?.tmpPath) continue
              try {
                await sshService.cleanupTmpFile(sid, item.tmpPath, item.type === 'upload')
              } catch (e) {
                console.warn('Failed to cleanup tmp file on unmount:', item.tmpPath, e)
              }
            }
          }
          void Promise.all(Array.from({ length: Math.min(2, items.length) }, () => worker()))
        })
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
      pendingPathsRef.current.clear()
      // 解决所有挂起的冲突 Promise，避免内存泄漏
      // 注意：pendingConflictRef（当前正显示的弹窗）必须先 resolve 再 nullify，
      // 否则 await askConflict(...) 持有的 Promise 永挂，闭包无法 GC
      if (pendingConflictRef.current) {
        pendingConflictRef.current.resolve('skip')
        pendingConflictRef.current = null
      }
      conflictQueueRef.current.forEach(item => item.resolve('skip'))
      conflictQueueRef.current = []
      conflictStoppedRef.current = false
      conflictApplyToAllRef.current = false
      conflictCachedActionRef.current = null
      // 清理剪贴板反馈定时器
      clipboardTimersRef.current.forEach(id => clearTimeout(id))
      clipboardTimersRef.current = []
      // 清理传输通知定时器
      if (transferNoticeTimerRef.current !== null) {
        clearTimeout(transferNoticeTimerRef.current)
        transferNoticeTimerRef.current = null
      }
      if (extractionAutoCloseTimerRef.current !== null) {
        clearTimeout(extractionAutoCloseTimerRef.current)
        extractionAutoCloseTimerRef.current = null
      }
      // 清理本地图片预览的 blob URL，避免内存泄漏
      if (viewerObjectUrlRef.current) {
        URL.revokeObjectURL(viewerObjectUrlRef.current)
        viewerObjectUrlRef.current = null
      }
    }
  }, [])

  // 全局 Pointer 拖拽监听：仅在 dragPointerRef 有起点时处理，
  // 超过 6px 阈值才进入拖拽态（避免与点击/选择冲突）。
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const st = dragPointerRef.current
      if (!st) return
      if (!isPointerDraggingRef.current) {
        const dx = e.clientX - st.startX
        const dy = e.clientY - st.startY
        if (Math.hypot(dx, dy) < 6) return
        isPointerDraggingRef.current = true
        document.body.classList.add('sftp-dragging')
      }
      setDragPreview({ x: e.clientX, y: e.clientY, label: st.files[0]?.name ?? '', count: st.files.length })
      const panel = hitPanel(e.clientX, e.clientY)
      const overTarget = panel != null && panel !== st.source
      setIsDraggingOverLocal(overTarget && panel === 'local')
      setIsDraggingOverRemote(overTarget && panel === 'remote')
    }
    const onUp = (e: PointerEvent) => {
      const st = dragPointerRef.current
      dragPointerRef.current = null
      document.body.classList.remove('sftp-dragging')
      if (!st) return
      if (!isPointerDraggingRef.current) return
      isPointerDraggingRef.current = false
      setDragPreview(null)
      setIsDraggingOverLocal(false)
      setIsDraggingOverRemote(false)
      justDraggedRef.current = true
      const panel = hitPanel(e.clientX, e.clientY)
      if (panel != null && panel !== st.source) {
        performTransferRef.current(st.source, panel, st)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  // 记录数量封顶（slice(0, 500)）后，清理被丢弃记录残留的子数据与索引，
  // 避免长时间运行时 transferChildren / directoryTransferIdsRef / transferTopNameRef 只增不减。
  // 只清理「曾经在 records 中出现过、现在已经消失」的 id，避免误删 manifest 先到、父记录尚未渲染的子数据。
  const prevRecordIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const ids = new Set(transferRecords.map(t => t.transferId))
    const prevIds = prevRecordIdsRef.current
    prevRecordIdsRef.current = ids
    const removed = new Set<string>()
    for (const id of prevIds) if (!ids.has(id)) removed.add(id)
    if (removed.size === 0) return
    setTransferChildren(prev => {
      const keys = Object.keys(prev)
      if (!keys.some(k => removed.has(k))) return prev
      const next: Record<string, TransferChildRecord[]> = {}
      for (const k of keys) if (!removed.has(k)) next[k] = prev[k]
      return next
    })
    for (const id of removed) {
      directoryTransferIdsRef.current.delete(id)
      transferTopNameRef.current.delete(id)
      directoryRateTrackerRef.current.delete(id)
    }
     
  }, [transferRecords])

  // 传输记录操作：清空已完成和已跳过，保留 failed/canceled 以支持断点续传
  const clearCompletedTransfers = useCallback(() => {
    const removed = new Set(transferRecordsRef.current
      .filter(t => t.status === 'completed' || t.status === 'skipped')
      .map(t => t.transferId))
    setTransferRecords(prev => prev.filter(t => !removed.has(t.transferId)))
    setTransferChildren(children => Object.fromEntries(Object.entries(children).filter(([id]) => !removed.has(id))))
    setExpandedTransfers(expanded => new Set(Array.from(expanded).filter(id => !removed.has(id))))
    for (const id of removed) {
      directoryTransferIdsRef.current.delete(id)
      transferTopNameRef.current.delete(id)
    }
  }, [])

  const clearAllTransfers = useCallback(() => {
    // 存在进行中的传输时拒绝清空，避免丢失可取消/续传的传输记录
    if (transferRecords.some(r => r.status === 'transferring')) {
      toastRef.current.warning(tRef.current('sftp_transfer_transferring'))
      return
    }
    setTransferRecords([])
    setTransferChildren({})
    setExpandedTransfers(new Set())
    directoryTransferIdsRef.current.clear()
    transferTopNameRef.current.clear()
    directoryRateTrackerRef.current.clear()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const removeTransfer = useCallback((id: string) => {
    setTransferRecords(prev => prev.filter(t => t.transferId !== id))
    setTransferChildren(prev => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    setExpandedTransfers(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    directoryTransferIdsRef.current.delete(id)
    transferTopNameRef.current.delete(id)
    directoryRateTrackerRef.current.delete(id)
  }, [])

  /**
   * 目录记录失败/取消后的重试：跳过目标端已存在且大小一致的文件（目录续传）。
   * 单文件记录不显示该入口（续传走独立的 resume 流程）。
   */
  const retryTransferSkipExisting = useCallback(async (item: TransferRecordItem) => {
    if (!item.sourcePath || !item.targetPath) return
    const isCanceled = (msg?: string | null) => !!msg && msg.toLowerCase().includes('cancel')
    try {
      if (item.type === 'download') {
        const res = await sshService.downloadFile(
          item.serverId,
          item.sourcePath,
          item.targetPath,
          sftpTransferConcurrency,
          true,
        )
        if (!res.success && !isCanceled(res.error)) {
          toastRef.current?.warning(res.error || tRef.current('sftp_transfer_failed'))
        }
      } else if (item.type === 'upload') {
        // targetPath 是远端完整路径（含目录名），重试时以父目录作为 remoteDir
        const parent = item.targetPath.replace(/\\/g, '/').replace(/\/[^/]+$/, '') || '/'
        const res = await sshService.uploadFromPaths(
          item.serverId,
          parent,
          [item.sourcePath],
          undefined,
          sftpTransferConcurrency,
          true,
        )
        if (!res.success && !isCanceled(res.error)) {
          toastRef.current?.warning(res.error || tRef.current('sftp_transfer_failed'))
        }
      }
    } catch (err) {
      toastRef.current?.warning(getErrorMessage(err, tRef.current('sftp_transfer_failed')))
    }
  }, [sftpTransferConcurrency])

  /**
   * 取消传输任务
   * 1. 乐观更新本地记录为 'canceled'（用户立即看到反馈）
   * 2. 调用后端 cancel_transfer 设置 cancel flag，SFTP chunk 循环检测后退出
   * 3. 后端返回 "Transfer canceled by user" 错误，upload/download 调用方据此跳过错误提示
   * 4. 立即清理临时文件（取消即清理，不再支持续传），resumable 始终为 false
   */
  const cancelTransfer = useCallback(async (transferId: string) => {
    // 先读取当前记录信息（用于清理临时文件），再乐观更新状态
    const record = transferRecordsRef.current.find(t => t.transferId === transferId)
    const tmpPath = record?.tmpPath
    const isUpload = record?.type === 'upload'
    // 乐观更新本地状态：取消即清理，不再支持续传
    setTransferRecords(prev => prev.map(t =>
      t.transferId === transferId && t.status === 'transferring'
        ? {
            ...t,
            status: 'canceled' as const,
            completedAt: Date.now(),
            rate: 0,
            resumable: false,
            tmpPath: undefined,  // 已清理，移除 tmpPath 引用
          }
        : t
    ))
    setTransferChildren(prev => prev[transferId] ? {
      ...prev,
      [transferId]: prev[transferId].map(child =>
        child.status === 'completed' ? child : { ...child, status: 'canceled' as const }
      ),
    } : prev)
    try {
      await sshService.cancelTransfer(transferId)
    } catch (err) {
      console.error('Failed to cancel transfer:', err)
    }
    // 取消后立即清理临时文件（无需等待后端 chunk 循环退出）
    if (tmpPath) {
      // 使用传输记录所属的 serverId，而非当前活跃 tab 的 serverId，避免跨服务器误操作
      const sid = record?.serverId ?? selectedServerIdRef.current
      if (sid) {
        try {
          await sshService.cleanupTmpFile(sid, tmpPath, isUpload)
        } catch (err) {
          console.error('Failed to cleanup tmp file after cancel:', err)
        }
      }
    }
  }, [])

  /**
   * 暂停传输任务
   * 与 cancelTransfer 共用后端 cancel flag 机制（设置 flag → chunk 循环退出）
   * 区别：暂停保留临时文件，状态为 'paused'，resumable=true，支持后续续传
   * 仅对单文件字节级传输有效（目录递归/归档传输不支持续传）
   */
  const pauseTransfer = useCallback(async (transferId: string) => {
    const record = transferRecordsRef.current.find(t => t.transferId === transferId)
    if (!record) return
    // 目录递归/归档传输无 tmpPath，不支持暂停续传，直接走取消逻辑
    if (!record.tmpPath) {
      await cancelTransfer(transferId)
      return
    }
    // 乐观更新为 paused 状态，保留 tmpPath 支持 resumeTransfer
    setTransferRecords(prev => prev.map(t =>
      t.transferId === transferId && t.status === 'transferring'
        ? {
            ...t,
            status: 'paused' as const,
            completedAt: Date.now(),
            rate: 0,
            resumable: true,
          }
        : t
    ))
    try {
      await sshService.cancelTransfer(transferId)
      // 暂停是可恢复操作，风险低，不加二次确认；仅提示用户可点击继续
      toastRef.current.info(tRef.current('sftp_transfer_paused') + tRef.current('sftp_transfer_paused_hint'))
    } catch (err) {
      console.error('Failed to pause transfer:', err)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 断点续传：从上次中断处继续传输
   * 仅对单文件传输失败/取消且 tmpPath 存在的记录有效。
   * 复用原 transferId，后端进度事件直接更新原记录。
   *
   * 后端降级策略：临时文件丢失/大小不匹配时自动从头传输（phase=tmpLost 事件通知前端重置）
   * 所以此处无需处理临时文件丢失错误，只处理真正的失败（网络、源文件被删等）
   */
  const resumeTransfer = useCallback(async (transferId: string) => {
    const record = transferRecordsRef.current.find(t => t.transferId === transferId)
    if (!record || !record.resumable) return
    // 重启后 tmpPath 可能丢失（持久化数据不完整或临时文件已被清理），无法续传
    // 此时提示用户并移除记录，避免用户反复点击无效的继续按钮
    if (!record.tmpPath || !record.sourcePath || !record.targetPath) {
      toastRef.current.error(tRef.current('sftp_resume_failed_tmp_missing'))
      setTransferRecords(prev => prev.filter(t => t.transferId !== transferId))
      return
    }
    // 使用传输记录所属的 serverId，而非当前活跃 tab 的 serverId，避免跨服务器误操作
    const sid = record.serverId || selectedServerIdRef.current
    if (!sid) return

    // 乐观更新：标记为 transferring + resuming，重置 startTime 以正确计算续传耗时
    sshService.registerActiveTransfer({
      transferId,
      serverId: sid,
      fileName: record.fileName,
      type: record.type,
      tmpPath: record.tmpPath,
      isUpload: record.type === 'upload',
    })
    setTransferRecords(prev => prev.map(t =>
      t.transferId === transferId
        ? {
            ...t,
            status: 'transferring' as const,
            resumable: false,
            resuming: true,
            completedAt: undefined,
            startTime: Date.now(),
            lastUpdate: Date.now(),
            lastCurrent: t.lastOffset,
            lastRateTime: Date.now(),
            lastRateBytes: t.lastOffset,
            rate: 0,
          }
        : t
    ))

    /**
     * 续传失败后的统一状态更新
     * 保留 resumable：可能只是临时网络问题，用户可再次点击继续
     * 但若源文件被删除（无法恢复），resumable 也保留——用户下次点继续仍会失败，可手动清除
     */
    const handleResumeFailure = (error: string) => {
      sshService.unregisterActiveTransfer(transferId)
      setTransferRecords(prev => prev.map(t =>
        t.transferId === transferId && t.status === 'transferring'
          ? {
              ...t,
              status: 'failed' as const,
              error,
              completedAt: Date.now(),
              rate: 0,
              // 保留 resumable：后端降级机制已处理临时文件问题，
              // 此处的失败通常是网络中断等临时性问题，允许用户再次尝试
              resumable: isResumableTmpPath(t.tmpPath) && t.total > 0 && t.lastOffset < t.total
                // 路径校验类失败（如 Invalid temporary path）重试必然同样失败，
                // 关闭续传入口避免用户陷入「点击-失败」的无限循环
                && !/Invalid (temporary|remote) (local )?path/i.test(error),
            }
          : t
      ))
    }

    try {
      if (record.type === 'upload') {
        // 上传：sourcePath=本地路径，targetPath=远程路径，tmpPath=远程临时文件
        const res = await sshService.resumeUpload(
          sid,
          record.sourcePath,
          record.targetPath,
          record.tmpPath,
          record.lastOffset,
          transferId,
          record.total,
        )
        if (!res.success && !((res.error || '').includes('canceled'))) {
          handleResumeFailure(res.error || t('sftp_resume_failed'))
        }
      } else {
        // 下载：sourcePath=远程路径，targetPath=本地路径，tmpPath=本地临时文件
        const res = await sshService.resumeDownload(
          sid,
          record.sourcePath,
          record.targetPath,
          record.tmpPath,
          record.lastOffset,
          transferId
        )
        if (!res.success && !((res.error || '').includes('canceled'))) {
          handleResumeFailure(res.error || t('sftp_resume_failed'))
        }
      }
    } catch (err: unknown) {
      console.error('Failed to resume transfer:', err)
      handleResumeFailure(getErrorMessage(err, t('sftp_resume_failed')))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 一键恢复所有支持断点续传的中断/失败传输任务
  const handleResumeAllFailedTransfers = useCallback(() => {
    const curSid = selectedServerIdRef.current
    const resumableRecords = transferRecordsRef.current.filter(
      r => r.status === 'failed' && r.resumable && (!curSid || !r.serverId || r.serverId === curSid)
    )
    for (const record of resumableRecords) {
      void resumeTransfer(record.transferId)
    }
  }, [resumeTransfer])

  /**
   * 清理断点续传残留的临时文件并移除记录
   * 用户放弃续传时调用：清理远程/本地临时文件，从列表移除记录。
   */
  const cleanupTransferTmpFile = useCallback(async (transferId: string) => {
    const record = transferRecordsRef.current.find(t => t.transferId === transferId)
    if (!record || !record.tmpPath) {
      // 无临时文件路径，直接移除记录
      setTransferRecords(prev => prev.filter(t => t.transferId !== transferId))
      return
    }
    // 使用传输记录所属的 serverId，而非当前活跃 tab 的 serverId，避免跨服务器误操作
    const sid = record.serverId || selectedServerIdRef.current
    if (!sid) {
      setTransferRecords(prev => prev.filter(t => t.transferId !== transferId))
      return
    }
    // 临时文件位置：上传=远程（isRemote=true），下载=本地（isRemote=false）
    const isRemote = record.type === 'upload'
    try {
      await sshService.cleanupTmpFile(sid, record.tmpPath, isRemote)
    } catch (err) {
      console.error('Failed to cleanup tmp file:', err)
    }
    // 无论清理成功与否都移除记录（避免用户看到的残留记录无法消除）
    setTransferRecords(prev => prev.filter(t => t.transferId !== transferId))
  }, [])

  // 剪贴板反馈定时器统一管理（卸载时清理，避免 setState on unmounted）
  const clipboardTimersRef = useRef<number[]>([])
  const setClipboardTimer = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      // 触发后从数组中移除，避免无限增长
      clipboardTimersRef.current = clipboardTimersRef.current.filter(t => t !== id)
      fn()
    }, ms)
    clipboardTimersRef.current.push(id)
  }, [])

  // 复制远程文件路径到剪贴板
  const handleCopyRemotePath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path)
      setCopiedRemotePath(true)
      setClipboardTimer(() => setCopiedRemotePath(false), CLIPBOARD_FEEDBACK_MS)
      playSound(SoundType.Click)
    } catch (err) {
      console.error('Failed to copy remote path:', err)
    }
  }, [setClipboardTimer])

  // 复制本地文件路径到剪贴板（与远程对称，用于快捷键 Ctrl+C）
  const handleCopyLocalPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path)
      playSound(SoundType.Click)
    } catch (err) {
      console.error('Failed to copy local path:', err)
    }
  }, [])

  // 本地复制IP
  const handleCopyLocalIp = useCallback(async (ip: string) => {
    try {
      await navigator.clipboard.writeText(ip)
      setCopiedLocalIp(true)
      setClipboardTimer(() => setCopiedLocalIp(false), CLIPBOARD_FEEDBACK_MS)
      playSound(SoundType.Click)
    } catch (err) {
      console.error('Failed to copy local IP:', err)
    }
  }, [setClipboardTimer])

  // === 文件冲突对话框核心：检查并询问用户 ===
  // 检查本地路径是否已存在（下载场景）
  const localExists = useCallback((name: string): boolean => {
    return localFiles.some(f => f.name === name)
  }, [localFiles])

  // 弹出冲突对话框，返回用户选择的操作
  // 单个文件场景：直接弹窗
  // 批量场景：第一个冲突弹窗，用户可选"应用到全部"
  // 依赖数组为空：所有状态通过 ref 读取，避免闭包陷阱
  // batchId 参数：调用方传入当前批次 ID，若与 transferBatchIdRef.current 不一致，
  // 说明该批次已被新批次取代（用户在传输中再次拖拽），直接 skip 避免污染
  const askConflict = useCallback((
    name: string,
    location: string,
    kind: 'upload' | 'download',
    batchId?: number
  ): Promise<ConflictAction> => {
    // 批次已过期：新批次已开始，旧批次直接 skip
    if (batchId !== undefined && batchId !== transferBatchIdRef.current) {
      return Promise.resolve('skip')
    }
    // 已停止：直接 skip
    if (conflictStoppedRef.current) return Promise.resolve('skip')
    // 应用到全部：直接使用缓存的操作
    if (conflictApplyToAllRef.current && conflictCachedActionRef.current) {
      const cached = conflictCachedActionRef.current
      if (cached === 'stop') {
        conflictStoppedRef.current = true
        return Promise.resolve('skip')
      }
      return Promise.resolve(cached)
    }

    return new Promise<ConflictAction>((resolve) => {
      const item: PendingConflict = { name, location, kind, resolve }
      // 如果已有对话框在显示，加入队列等待（保留完整对象信息）
      if (pendingConflictRef.current) {
        conflictQueueRef.current.push(item)
        return
      }
      pendingConflictRef.current = item
      setPendingConflict(item)
    })
  }, [])

  // 用户点击对话框按钮
  const handleConflictResolve = useCallback((action: ConflictAction) => {
    const current = pendingConflictRef.current
    if (!current) return

    // 处理"应用到全部"
    if (conflictApplyToAllRef.current) {
      conflictCachedActionRef.current = action
      if (action === 'stop') {
        conflictStoppedRef.current = true
      }
    }

    // 关闭对话框
    pendingConflictRef.current = null
    setPendingConflict(null)
    // 重置 applyToAll checkbox（下次冲突默认不勾选）
    setConflictApplyToAll(false)
    conflictApplyToAllRef.current = false

    // 解决当前冲突
    current.resolve(action)

    // 处理队列中的下一个冲突（使用各自的 name/location/kind，不再复用）
    const next = conflictQueueRef.current.shift()
    if (next) {
      pendingConflictRef.current = next
      setPendingConflict(next)
    } else {
      // 队列空，重置停止标记（下次新传输重新开始）
      conflictStoppedRef.current = false
    }
  }, [])

  // 用户切换"应用到全部"
  const handleConflictApplyToAllChange = useCallback((checked: boolean) => {
    setConflictApplyToAll(checked)
    conflictApplyToAllRef.current = checked
  }, [])

  // 重置冲突状态（传输批次结束时调用）
  // 先 resolve 所有挂起的 Promise，避免新批次启动时旧批次的 await 永挂
  const resetConflictState = useCallback(() => {
    // resolve 当前弹窗和队列中所有等待的 Promise（按 skip 处理）
    if (pendingConflictRef.current) {
      pendingConflictRef.current.resolve('skip')
      pendingConflictRef.current = null
      setPendingConflict(null)
    }
    conflictQueueRef.current.forEach(item => item.resolve('skip'))
    conflictQueueRef.current = []
    conflictStoppedRef.current = false
    conflictApplyToAllRef.current = false
    conflictCachedActionRef.current = null
    setConflictApplyToAll(false)
  }, [])

  // === 覆盖确认对话框核心 ===
  // 弹出覆盖确认对话框，返回 true=用户确认覆盖 / false=用户取消
  // 用于重命名、新建文件等单次操作场景（非批量），避免 mv 静默覆盖 / writeFile 清空内容等风险
  // 依赖数组为空：state 通过 ref 读取，避免闭包陷阱
  const askOverwrite = useCallback((
    title: string,
    description: string
  ): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const item: PendingOverwrite = { title, description, resolve }
      pendingOverwriteRef.current = item
      setPendingOverwrite(item)
    })
  }, [])

  // 用户点击"覆盖"按钮
  const handleOverwriteConfirm = useCallback(() => {
    const cur = pendingOverwriteRef.current
    if (!cur) return
    pendingOverwriteRef.current = null
    setPendingOverwrite(null)
    cur.resolve(true)
  }, [])

  // 用户点击"取消"或关闭对话框
  const handleOverwriteCancel = useCallback(() => {
    const cur = pendingOverwriteRef.current
    if (!cur) return
    pendingOverwriteRef.current = null
    setPendingOverwrite(null)
    cur.resolve(false)
  }, [])

  // 记录待绑定的源/目标路径（前端触发传输时调用）
  // 后端 progress 事件到来时按 fileName 取出并填入传输记录
  const recordPendingPath = useCallback((
    fileName: string,
    source: string,
    target: string,
    sourceServerName?: string,
    targetServerName?: string,
    serverId?: string,
  ) => {
    const map = pendingPathsRef.current
    const now = Date.now()
    // 清理 60s 仍未消费的登记：传输在首个进度事件前失败/取消时没人来取，
    // 残留条目会被后续同名传输按 FIFO 误绑定（显示上一次的源/目标路径）
    if (map.size > 64) {
      for (const [key, items] of map) {
        const fresh = items.filter(i => now - i.ts < 60_000)
        if (fresh.length === 0) map.delete(key)
        else if (fresh.length !== items.length) map.set(key, fresh)
      }
    }
    const arr = map.get(fileName) || []
    arr.push({ source, target, sourceServerName, targetServerName, serverId, ts: now })
    map.set(fileName, arr)
    // 自动展开面板
    if (!transferPanelOpen) setTransferPanelOpen(true)
  }, [transferPanelOpen])

  // 添加一条跳过记录到传输日志（冲突跳过时调用）
  const addSkippedRecord = useCallback((
    type: 'upload' | 'download' | 's2s',
    fileName: string,
    sourcePath: string,
    targetPath: string,
    skipReason: string,
    sourceServerName?: string,
    targetServerName?: string,
    serverId?: string,
  ) => {
    const now = Date.now()
    const item: TransferRecordItem = {
      transferId: `skip-${now}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      serverId: serverId || selectedServerIdRef.current || '',
      fileName,
      currentSubFile: undefined,
      sourcePath,
      targetPath,
      sourceServerName,
      targetServerName,
      current: 0,
      total: 0,
      percent: 0,
      status: 'skipped',
      timestamp: now,
      startTime: now,
      completedAt: now,
      lastUpdate: now,
      lastCurrent: 0,
      rate: 0,
      elapsedMs: 0,
      skipReason,
      // 跳过记录不支持断点续传
      lastOffset: 0,
      resumable: false,
      resuming: false,
    }
    setTransferRecords(prev => [item, ...prev].slice(0, 500))
    if (!transferPanelOpen) setTransferPanelOpen(true)
  }, [transferPanelOpen])

  // 切换某条记录的详情展开/收起
  const toggleTransferDetail = useCallback((id: string) => {
    setExpandedTransfers(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // 归档下载：把远程目录打包为 tar.gz/tar.bz2/tar.xz/zip/tar 后下载到本地当前目录
  const handleDownloadArchive = async (
    entry: FileEntry,
    format: 'tar.gz' | 'tar.bz2' | 'tar.xz' | 'zip' | 'tar' = 'tar.gz',
    serverId?: string
  ) => {
    const sid = serverId || selectedServerId
    if (!sid) return
    if (!entry.isDirectory) return
    const now = Date.now()
    const archiveName = `${entry.name}.${format}`
    const transferId = `archive-${now}-${Math.random().toString(36).slice(2, 8)}`
    setTransferRecords(prev => [{
      transferId,
      type: 'download' as const,
      serverId: sid || '',
      fileName: archiveName,
      sourcePath: entry.path,
      targetPath: joinPath(localPath, archiveName),
      sourceServerName: serverNameOf(sid),
      current: 0, total: 0, percent: 0,
      status: 'transferring' as const,
      timestamp: now, startTime: now,
      lastUpdate: now, lastCurrent: 0, rate: 0, elapsedMs: 0,
      lastOffset: 0, resumable: false, resuming: false,
    }, ...prev].slice(0, 500))
    if (!transferPanelOpen) setTransferPanelOpen(true)
    try {
      const res = await sshService.downloadArchive(sid, entry.path, format)
      // 无论成功失败都更新记录状态，避免永远停留在 transferring
      setTransferRecords(prev => prev.map(r => r.transferId === transferId ? {
        ...r,
        status: res.success ? 'completed' : 'failed',
        error: res.success ? undefined : (res.error || t('sftp_archive_download_failed')),
        completedAt: Date.now(),
      } : r))
      if (!res.success) {
        showTransferNotice(res.error || t('sftp_archive_download_failed'))
      }
      // 刷新本地目录以显示下载的归档文件（归档下载到当前本地目录）
      if (leftSideType === "local") loadLocalDirectory(localPathRef.current); else if (rightSideType === "local") loadRemoteDirectory("", localPathRef.current)
    } catch (e: unknown) {
      const msg = getErrorMessage(e, t('sftp_archive_download_failed'))
      setTransferRecords(prev => prev.map(r => r.transferId === transferId ? {
        ...r,
        status: 'failed',
        error: msg,
        completedAt: Date.now(),
      } : r))
      showTransferNotice(msg)
    }
  }

  const handleExtractArchive = async (
    entry: LocalFileEntry | FileEntry,
    side: 'local' | 'remote',
    serverId?: string,
  ) => {
    if (!mountedRef.current) return
    if (entry.isDirectory || !isSupportedArchiveName(entry.name) || extractingArchivePath) return
    const sid = side === 'remote' ? serverId : null
    if (side === 'remote' && !sid) return
    if (extractionAutoCloseTimerRef.current !== null) {
      window.clearTimeout(extractionAutoCloseTimerRef.current)
      extractionAutoCloseTimerRef.current = null
    }
    setExtractingArchivePath(entry.path)
    setExtractionProgress(8)
    setExtractionProgressOpen(true)
    setExtractionProgressStatus('running')
    setExtractionProgressPhase(t('sftp_extract_phase_validate'))
    setExtractionProgressPath(entry.path)
    // 底层解压命令没有逐文件进度事件；缓慢推进到 88%，完成后再跳到 100%，
    // 让长时间解压始终有可见反馈，同时避免伪装成精确的字节百分比。
    const progressTimer = window.setInterval(() => {
      if (!mountedRef.current) return
      setExtractionProgress(current => Math.min(88, current + (current < 40 ? 3 : 1)))
    }, 900)
    if (side === 'local') setLocalError(null); else setRemoteError(null)
    let unlistenProgress: (() => void) | null = null
    try {
      // 本地 7z/rar 解压支持逐文件真进度（后端 emit extract://progress）；
      // 收到首个真进度后停掉时间驱动的假进度，避免两者互相覆盖
      if (side === 'local') {
        unlistenProgress = await listen<{ path: string; percent: number }>('extract://progress', (event) => {
          if (!mountedRef.current) return
          if (event.payload.path !== entry.path) return
          window.clearInterval(progressTimer)
          setExtractionProgress(Math.max(8, Math.min(88, event.payload.percent)))
        })
      }
      setExtractionProgress(22)
      setExtractionProgressPhase(t('sftp_extract_phase_prepare'))
      let result = await sshService.extractArchive(sid ?? null, entry.path)
      if (!mountedRef.current) return
      if (!result.success && result.error === 'EXTRACT_TOOL_MISSING') {
        const confirmed = await new Promise<boolean>(resolve => {
          setPendingToolInstall({ tool: result.message || '', resolve })
        })
        if (!confirmed) {
          setExtractionProgressStatus('failed')
          setExtractionProgressPhase(t('sftp_extract_phase_canceled'))
          return
        }
        showTransferNotice(t('sftp_extract_tool_installing').replace('{tool}', result.message || ''))
        setExtractionProgress(35)
        setExtractionProgressPhase(t('sftp_extract_phase_install').replace('{tool}', result.message || ''))
        const installed = await sshService.installExtractionTool(sid ?? null, entry.path)
        if (!mountedRef.current) return
        if (!installed.success) {
          const message = installed.error || t('sftp_extract_tool_install_failed')
          setExtractionProgressStatus('failed')
          setExtractionProgressPhase(t('sftp_extract_phase_failed'))
          if (side === 'local') setLocalError(message); else setRemoteError(message)
          return
        }
        setExtractionProgress(52)
        setExtractionProgressPhase(t('sftp_extract_phase_extract'))
        result = await sshService.extractArchive(sid ?? null, entry.path)
      }
      if (!result.success && result.error === 'EXTRACT_TARGET_EXISTS') {
        const action = await new Promise<'overwrite' | 'keep' | 'cancel'>(resolve => {
          setPendingExtractConflict({ archivePath: entry.path, destination: result.message || '', resolve })
        })
        if (action === 'cancel') {
          setExtractionProgressStatus('failed')
          setExtractionProgressPhase(t('sftp_extract_phase_canceled'))
          return
        }
        result = await sshService.extractArchive(sid ?? null, entry.path, action)
        if (!mountedRef.current) return
      }
      if (!result.success) {
        setExtractionProgressStatus('failed')
        setExtractionProgressPhase(t('sftp_extract_phase_failed'))
        const message = result.error || t('sftp_extract_failed')
        if (side === 'local') setLocalError(message); else setRemoteError(message)
        return
      }
      showTransferNotice(result.message || t('sftp_extract_success'))
      setExtractionProgress(100)
      setExtractionProgressStatus('success')
      setExtractionProgressPhase(t('sftp_extract_phase_success'))
      if (side === 'local') await loadLocalDirectory(localPathRef.current)
      else if (sid === leftServerId) await loadLocalDirectory(localPathRef.current, 'remote', sid)
      else await loadRemoteDirectory(sid!, remotePathRef.current)
      // 保留完成状态片刻，让用户看到成功反馈后自动收起弹框。
      extractionAutoCloseTimerRef.current = window.setTimeout(() => {
        extractionAutoCloseTimerRef.current = null
        if (!mountedRef.current) return
        setExtractionProgressOpen(false)
      }, 900)
    } catch (error) {
      if (!mountedRef.current) return
      const message = getErrorMessage(error, t('sftp_extract_failed'))
      setExtractionProgressStatus('failed')
      setExtractionProgressPhase(t('sftp_extract_phase_failed'))
      if (side === 'local') setLocalError(message); else setRemoteError(message)
    } finally {
      window.clearInterval(progressTimer)
      unlistenProgress?.()
      if (mountedRef.current) setExtractingArchivePath(null)
    }
  }

  // 本地单文件下载
  const handleDownloadFile = async (file: FileEntry) => {
    if (!selectedServerId) return
    if (isRemoteDisconnected) {
      toastRef.current.warning(tRef.current('sftp_offline_readonly_tip'))
      return
    }
    // 左侧也是远程服务器：走 s2s 传输，不落本地
    if (leftSideType === 'remote' && leftServerId) {
      void handleServerToServerTransfer(selectedServerId, leftServerId, localPath, [file], localFiles)
      return
    }
    // 生成新批次 ID 并清理上一批次遗留的冲突状态
    const myBatchId = ++transferBatchIdRef.current
    resetConflictState()
    // duplicate 模式下生成不冲突的本地文件名，replace 模式覆盖原文件
    let targetLocalPath = joinPath(localPath, file.name)
    // 检查本地是否已存在同名文件
    if (localExists(file.name)) {
      const action = await askConflict(file.name, localPath, 'download', myBatchId)
      if (action === 'stop' || action === 'skip') {
        addSkippedRecord('download', file.name, file.path, targetLocalPath,
          action === 'stop' ? t('sftp_transfer_user_stop') : t('sftp_transfer_user_skip'),
          serverNameOf(selectedServerId), undefined, selectedServerId)
        if (transferBatchIdRef.current === myBatchId) resetConflictState()
        return
      }
      if (action === 'duplicate') {
        // 生成副本名：file.txt → file(1).txt，避免覆盖已存在文件
        const existingNames = new Set(localFiles.map(f => f.name))
        const dupName = generateDuplicateName(file.name, existingNames)
        targetLocalPath = joinPath(localPath, dupName)
      }
      // replace：沿用原 targetLocalPath，downloadFile 内部会覆盖
    }
    // 记录源/目标路径，等后端 progress 事件到来时绑定
    // 注：progress 事件携带的 fileName 是远程原文件名，故 key 仍用 file.name
    recordPendingPath(file.name, file.path, targetLocalPath, serverNameOf(selectedServerId), undefined, selectedServerId)
    try {
      const res = await sshService.downloadFile(selectedServerId, file.path, targetLocalPath, sftpTransferConcurrency)
      // 用户取消（含对话框取消和传输中取消）：不显示错误，记录已由 cancelTransfer 标记
      const isCanceled = !res.success && (res.error === 'User canceled' || (res.error || '').includes('canceled'))
      if (!res.success && !isCanceled) {
        setLocalError(res.error || t('sftp_download_failed'))
      } else if (res.success) {
        // 仅当用户未离开起始目录时才刷新，避免把用户强行拉回原目录
        if (localPathRef.current === localPath) loadLocalDirectory(localPath)
        toastRef.current.success(`下载完成: ${file.name}`)
      }
    } catch (err: unknown) {
      console.error('Download error:', err)
      setLocalError(getErrorMessage(err, t('sftp_download_failed')))
    } finally {
      if (transferBatchIdRef.current === myBatchId) resetConflictState()
    }
  }

  // 1. 本地重命名
  const handleRenameLocal = async () => {
    if (!renameTarget) return
    const validateErr = validateFileName(renameValue, t)
    if (validateErr) { setLocalError(validateErr); return }
    const newName = renameValue.trim()
    // 名称未变化（大小写完全一致）：直接关闭对话框，避免无意义的 rename 调用
    if (newName === renameTarget.name) {
      setRenameTarget(null)
      setRenameValue('')
      return
    }
    // 冲突检测：目标名已存在且非自身（排除自身以支持大小写改名等场景）
    const conflict = localFiles.some(f => f.name === newName && f.path !== renameTarget.path)
    if (conflict) {
      const parentPath = getParentPath(renameTarget.path) || ''
      const ok = await askOverwrite(
        t('sftp_rename_overwrite_title'),
        t('sftp_rename_overwrite_desc').replace('{location}', parentPath).replace('{name}', newName)
      )
      if (!ok) return // 用户取消，保留对话框供修改名称
    }
    try {
      // 使用 getParentPath 同时处理 / 和 \ 分隔符，避免 lastIndexOf 在混合分隔符路径上错位
      const parentPath = getParentPath(renameTarget.path)
      if (!parentPath) { setLocalError(t('sftp_rename_failed')); return }
      const newPathString = joinPath(parentPath, newName)
      await renameLocal(renameTarget.path, newPathString)
      setRenameTarget(null)
      setRenameValue('')
      loadLocalDirectory(localPath, undefined, undefined, { isRefresh: true })
    } catch (err: unknown) {
      console.error('Failed to rename local file:', err)
      setLocalError(getErrorMessage(err, String(err)))
    }
  }

  // 2. 本地删除（支持多选）
  const handleDeleteLocal = async () => {
    if (deletePendingRef.current) return
    const paths = deleteMultiPaths ?? (deleteTarget ? [deleteTarget.path] : [])
    if (paths.length === 0) return
    deletePendingRef.current = true
    setDeletePending(true)
    const failures: string[] = []
    try {
      for (const [index, p] of paths.entries()) {
        setDeleteProgress({ current: index + 1, total: paths.length, path: p })
        try {
          await removeLocal(p, { recursive: true })
        } catch (err: unknown) {
          const message = getErrorMessage(err, String(err))
          if (!isAlreadyGoneError(message)) failures.push(`${p}: ${message}`)
        }
      }
    } finally {
      deletePendingRef.current = false
      setDeletePending(false)
      setDeleteProgress(null)
    }
    setDeleteTarget(null)
    setDeleteMultiPaths(null)
    if (failures.length > 0) {
      setLocalError(t('sftp_delete_partial_failed').replace('{failures}', failures.join('\n')))
    }
    setSelectedLocalPaths(new Set())
    loadLocalDirectory(localPath, undefined, undefined, { isRefresh: true })
  }

  // 3. 本地创建文件夹
  const handleCreateFolderLocal = async () => {
    const validateErr = validateFileName(newFolderName, t)
    if (validateErr) { setLocalError(validateErr); return }
    const newName = newFolderName.trim()
    // 文件夹不允许覆盖式创建（mkdir 无 -p 时会报错，但显式提示更友好）
    if (localFiles.some(f => f.name === newName)) {
      setLocalError(t('sftp_create_folder_exists').replace('{name}', newName))
      return
    }
    try {
      const pathString = joinPath(localPath, newName)
      await mkdirLocal(pathString)
      setShowCreateFolder(false)
      setNewFolderName('')
      loadLocalDirectory(localPath, undefined, undefined, { isRefresh: true })
    } catch (err: unknown) {
      console.error('Failed to create local directory:', err)
      setLocalError(getErrorMessage(err, String(err)))
    }
  }

  // 4. 本地创建文件
  const handleCreateFileLocal = async () => {
    const validateErr = validateFileName(newFileName, t)
    if (validateErr) { setLocalError(validateErr); return }
    const newName = newFileName.trim()
    // 文件已存在：writeFile 会清空原文件内容，必须明确确认后才执行
    if (localFiles.some(f => f.name === newName)) {
      const ok = await askOverwrite(
        t('sftp_create_file_overwrite_title'),
        t('sftp_create_file_overwrite_desc').replace('{location}', localPath).replace('{name}', newName)
      )
      if (!ok) return // 用户取消，保留对话框供修改名称
    }
    try {
      const pathString = joinPath(localPath, newName)
      await writeLocal(pathString, '')
      setShowCreateFile(false)
      setNewFileName('')
      loadLocalDirectory(localPath, undefined, undefined, { isRefresh: true })
    } catch (err: unknown) {
      console.error('Failed to create local file:', err)
      setLocalError(getErrorMessage(err, String(err)))
    }
  }

  // 5. 远程创建文件
  const handleCreateFileRemote = async () => {
    if (!selectedServerId) return
    if (isRemoteDisconnected) {
      toastRef.current.warning(tRef.current('sftp_offline_readonly_tip'))
      return
    }
    const validateErr = validateFileName(newFileName, t, 'remote')
    if (validateErr) { setRemoteError(validateErr); return }
    const newName = newFileName.trim()
    // 文件已存在：远程 writeFile 会清空原文件内容，必须明确确认后才执行
    if (remoteFiles.some(f => f.name === newName)) {
      const ok = await askOverwrite(
        t('sftp_create_file_overwrite_title'),
        t('sftp_create_file_overwrite_desc').replace('{location}', remotePath).replace('{name}', newName)
      )
      if (!ok) return // 用户取消，保留对话框供修改名称
    }
    try {
      // 远程路径分隔符恒为 /
      const pathString = remotePath.endsWith('/') ? remotePath + newName : remotePath + '/' + newName
      await sshService.writeFile(selectedServerId, pathString, '')
      setShowCreateFile(false)
      setNewFileName('')
      loadRemoteDirectory(selectedServerId, remotePath)
    } catch (err: unknown) {
      console.error('Failed to create remote file:', err)
      setRemoteError(getErrorMessage(err, String(err)))
    }
  }

  // 6. 远程权限对话框加载
  // serverId 可选：当左侧也是远程服务器时，传入 leftServerId 以操作左侧服务器
  const handleOpenPermissions = (file: FileEntry, serverId?: string) => {
    setPermissionsTarget(file)
    setPermissionsServerId(serverId || selectedServerId)
    const parsed = parsePermissions(file.permissions)
    setPerms(parsed)
    // 服务器未返回用户名/组名（仅返回数字 uid/gid）时，回退显示数字 id，避免字段空白
    setOwnerUser(file.owner || (file.uid === 0 ? 'root' : (file.uid != null ? String(file.uid) : '')))
    setOwnerGroup(file.group || (file.gid === 0 ? 'root' : (file.gid != null ? String(file.gid) : '')))
    setPermissionsRecursive(false)
  }

  // 7. 远程权限对话框保存
  const handleSavePermissions = async () => {
    if (!permissionsTarget) return
    const sid = permissionsServerId || selectedServerId
    if (!sid) return
    setPermSaving(true)
    try {
      const mode = getOctalMode(perms)
      const permRes = await sshService.setPermissions(sid, permissionsTarget.path, mode, permissionsRecursive)
      if (permRes.exitCode !== 0) {
        throw new Error(permRes.stderr || 'Failed to update file permissions')
      }

      // chmod 成功后再 chown；若 chown 失败，明确提示部分成功，避免用户误以为全部失败
      if (ownerUser !== permissionsTarget.owner || ownerGroup !== permissionsTarget.group) {
        const chownRes = await sshService.chownFile(
          sid,
          permissionsTarget.path,
          ownerUser,
          ownerGroup,
          permissionsRecursive
        )
        if (chownRes.exitCode !== 0) {
          throw new Error(
            `${t('sftp_perm_ok_chown_fail')}: ${chownRes.stderr || 'Failed to update ownership'}`
          )
        }
      }

      setPermissionsTarget(null)
      // 刷新对应侧目录：左侧远程 → 刷新左侧；否则刷新右侧
      if (sid === leftServerId) {
        loadLocalDirectory(localPath)
      } else {
        loadRemoteDirectory(selectedServerId, remotePath)
      }
    } catch (err: unknown) {
      console.error('Failed to save permissions:', err)
      setRemoteError(getErrorMessage(err, String(err)))
    } finally {
      setPermSaving(false)
    }
  }

  // SFTP 配置诊断（检测 Windows 服务端 SFTP 配置状态）
  const handleDiagnoseSftp = async () => {
    if (!selectedServerId) return
    if (!backend) {
      toast.error(tRef.current('sftp_diag_failed'))
      return
    }
    setDiagnosingSftp(true)
    try {
      const result = await backend.files.diagnoseSftp(selectedServerId)
      setSftpDiagnostics(result)
      setShowDiagnosticsDialog(true)
    } catch (e) {
      toast.error(getErrorMessage(e, tRef.current('sftp_diag_failed')))
    } finally {
      setDiagnosingSftp(false)
    }
  }

  // ── 远程文件管理操作 ──────────────────────────────────────────────────
  // 1. 删除远程文件/文件夹（支持多选）
  // 当左侧也是远程服务器时，deleteServerId 为 leftServerId，操作左侧并刷新左侧目录
  const handleDeleteRemote = async () => {
    if (deletePendingRef.current) return
    const sid = deleteServerId || selectedServerId
    if (!sid) return
    if (sid === selectedServerId && isRemoteDisconnected) {
      toastRef.current.warning(tRef.current('sftp_offline_readonly_tip'))
      return
    }
    const paths = deleteMultiPaths ?? (deleteTarget ? [deleteTarget.path] : [])
    if (paths.length === 0) return
    deletePendingRef.current = true
    setDeletePending(true)
    const failures: string[] = []
    let successCount = 0
    try {
      for (const [index, p] of paths.entries()) {
        setDeleteProgress({ current: index + 1, total: paths.length, path: p })
        try {
          const res = await sshService.deleteFile(sid, p)
          if (res.exitCode === 0) {
            successCount++
          } else {
            const message = res.stderr || 'Delete failed'
            if (isAlreadyGoneError(message)) successCount++
            else failures.push(`${p}: ${message}`)
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Delete failed'
          if (isAlreadyGoneError(message)) successCount++
          else failures.push(`${p}: ${message}`)
        }
      }
    } finally {
      deletePendingRef.current = false
      setDeletePending(false)
      setDeleteProgress(null)
    }
    setDeleteTarget(null)
    setDeleteMultiPaths(null)
    setDeleteServerId('')
    if (successCount > 0) {
      // 刷新对应侧目录：左侧远程 → 刷新左侧；否则刷新右侧
      if (sid === leftServerId) {
        loadLocalDirectory(localPath)
        setSelectedLocalPaths(new Set())
      } else {
        loadRemoteDirectory(selectedServerId, remotePath)
        setSelectedRemotePaths(new Set())
      }
    }
    if (failures.length > 0) {
      setRemoteError(t('sftp_delete_partial_failed').replace('{failures}', failures.join('\n')))
      playSound(SoundType.Error)
    } else if (successCount > 0) {
      playSound(SoundType.Success)
    }
  }

  // 2. 重命名远程文件
  // 当左侧也是远程服务器时，renameServerId 为 leftServerId，操作左侧并刷新左侧目录
  const handleRenameRemote = async () => {
    const sid = renameServerId || selectedServerId
    if (!sid || !renameTarget) return
    if (sid === selectedServerId && isRemoteDisconnected) {
      toastRef.current.warning(tRef.current('sftp_offline_readonly_tip'))
      return
    }
    const validateErr = validateFileName(renameValue, t, 'remote')
    if (validateErr) { setRemoteError(validateErr); return }
    const newName = renameValue.trim()
    // 名称未变化（大小写完全一致）：直接关闭对话框，避免无意义的 renameFile 调用
    if (newName === renameTarget.name) {
      setRenameTarget(null)
      setRenameValue('')
      setRenameServerId('')
      return
    }
    // 确定要检查的文件列表：左侧远程（sid === leftServerId）→ localFiles；右侧 → remoteFiles
    // 远程 mv 会静默覆盖目标文件，需在执行前明确询问用户
    const checkList = (sid === leftServerId) ? localFiles : remoteFiles
    const conflict = checkList.some(f => f.name === newName && f.path !== renameTarget.path)
    if (conflict) {
      const parent = getParentPath(renameTarget.path) || '/'
      const ok = await askOverwrite(
        t('sftp_rename_overwrite_title'),
        t('sftp_rename_overwrite_desc').replace('{location}', parent).replace('{name}', newName)
      )
      if (!ok) return // 用户取消，保留对话框供修改名称
    }
    const parent = getParentPath(renameTarget.path) || '/'
    // 远程路径分隔符恒为 /
    const newPath = parent.endsWith('/') ? parent + newName : parent + '/' + newName
    try {
      const res = await sshService.renameFile(sid, renameTarget.path, newPath)
      if (res.exitCode === 0) {
        // 刷新对应侧目录：左侧远程 → 刷新左侧；否则刷新右侧
        if (sid === leftServerId) {
          loadLocalDirectory(localPath)
        } else {
          loadRemoteDirectory(selectedServerId, remotePath)
        }
      } else {
        setRemoteError(res.stderr || t('sftp_rename_failed'))
      }
    } catch (err) {
      setRemoteError(err instanceof Error ? err.message : t('sftp_rename_failed'))
    } finally {
      setRenameTarget(null)
      setRenameValue('')
      setRenameServerId('')
    }
  }

  // 3. 创建远程文件夹
  const handleCreateFolderRemote = async () => {
    if (!selectedServerId) return
    if (isRemoteDisconnected) {
      toastRef.current.warning(tRef.current('sftp_offline_readonly_tip'))
      return
    }
    const validateErr = validateFileName(newFolderName, t, 'remote')
    if (validateErr) { setRemoteError(validateErr); return }
    const newName = newFolderName.trim()
    // 文件夹不允许覆盖式创建（远程 mkdir 失败会返回 stderr，但显式提示更友好且避免一次往返）
    if (remoteFiles.some(f => f.name === newName)) {
      setRemoteError(t('sftp_create_folder_exists').replace('{name}', newName))
      return
    }
    // 远程路径分隔符恒为 /
    const path = remotePath.endsWith('/') ? remotePath + newName : remotePath + '/' + newName
    try {
      const res = await sshService.mkdir(selectedServerId, path)
      if (res.exitCode === 0) {
        loadRemoteDirectory(selectedServerId, remotePath)
      } else {
        setRemoteError(res.stderr || t('sftp_create_directory_failed'))
      }
    } catch (err) {
      setRemoteError(err instanceof Error ? err.message : t('sftp_create_directory_failed'))
    } finally {
      setShowCreateFolder(false)
      setNewFolderName('')
    }
  }

  // A. 下载远程文件到当前本地目录（支持多选并发）
  // 两阶段：① 串行预检冲突（避免传输开始后才弹窗） ② 并发限流下载
  // 批次隔离：每次进入生成新 batchId，旧批次若仍在 await askConflict 会因 batchId 不匹配自动 skip
  // 注：loadLocalDirectory/loadRemoteDirectory/t 通过 ref 读取，避免这些高频重建的值进入依赖数组
  const handleDownloadRemoteFiles = useCallback(async (srcServerId: string, destFolder: string, files: FileEntry[], destFilesList: (FileEntry | LocalFileEntry)[]) => {
    if (!srcServerId || files.length === 0) return
    if (srcServerId === selectedServerId && isRemoteDisconnected) {
      toastRef.current.warning(tRef.current('sftp_offline_readonly_tip'))
      return
    }
    // 生成新批次 ID 并清理上一批次遗留的冲突状态（resolve 旧 Promise，避免永挂）
    const myBatchId = ++transferBatchIdRef.current
    resetConflictState()
    // ① 预检阶段：串行检查每个文件是否与本地冲突，决定下载列表
    // usedLocalNames：跟踪本批次已分配的本地文件名，避免 duplicate 生成的副本名互相冲突
    const usedLocalNames = new Set(destFilesList.map(f => f.name))
    const toDownload: { file: FileEntry; target: string }[] = []
    for (const file of files) {
      let targetName = file.name
      if (localExists(file.name) || usedLocalNames.has(file.name)) {
        const action = await askConflict(file.name, destFolder, 'download', myBatchId)
        if (action === 'stop') {
          addSkippedRecord('download', file.name, file.path, joinPath(destFolder, file.name), tRef.current('sftp_transfer_user_stop'), serverNameOf(srcServerId), undefined, srcServerId)
          break
        }
        if (action === 'skip') {
          addSkippedRecord('download', file.name, file.path, joinPath(destFolder, file.name), tRef.current('sftp_transfer_user_skip'), serverNameOf(srcServerId), undefined, srcServerId)
          continue
        }
        if (action === 'duplicate') {
          // 生成副本名：file.txt → file(1).txt，避免覆盖已存在文件或本批次已分配的同名文件
          targetName = generateDuplicateName(file.name, usedLocalNames)
        }
        // replace：沿用原文件名，downloadFile 内部会覆盖
      }
      usedLocalNames.add(targetName)
      const target = joinPath(destFolder, targetName)
      // 提前记录 pendingPath，使首个进度事件到来时能立即绑定源/目标路径
      // 注：progress 事件携带的 fileName 是远程原文件名，故 key 仍用 file.name
      recordPendingPath(file.name, file.path, target, serverNameOf(srcServerId), undefined, srcServerId)
      toDownload.push({ file, target })
    }
    if (toDownload.length === 0) {
      // 本批次未产生传输：仍需清理冲突状态（resolve 可能残留的 Promise）
      if (transferBatchIdRef.current === myBatchId) resetConflictState()
      return
    }
    // ② 并发下载阶段：按设置中的并发量限流，每个文件独立 transferId
    // 并发安全性：后端每个 downloadFile 调用各自 create_sftp_session 独立 channel，
    // SshConnection 用 Arc 包裹跨 task 安全共享，不存在 Mutex 串行化

    // 不在此处直接刷新本地目录：后端临时文件创建是异步的（tokio::fs::File::create 需 IO），
    // 此刻刷新可能列到临时文件未创建前的状态。改为监听第一个进度事件（携带 tmp_path）到达后再刷新。

    try {
      const failures: string[] = []
      await runWithConcurrency(toDownload, sftpTransferConcurrency, async ({ file, target }) => {
        try {
          // 传入完整的 target 路径（含副本名），后端检测到非目录时直接用作目标文件路径
          const res = await sshService.downloadFile(srcServerId, file.path, target, sftpTransferConcurrency)
          // 用户取消（含对话框取消和传输中取消）：不加入 failures，记录已由 cancelTransfer 标记
          const isCanceled = !res.success && (res.error === 'User canceled' || (res.error || '').includes('canceled'))
          if (res.success) {
            // 单个文件下载成功后立即刷新本地目录（不用等所有文件传完）
            if (localPathRef.current === destFolder && leftSideType === "local") loadLocalDirectoryRef.current(destFolder); else if (remotePathRef.current === destFolder && rightSideType === "local") loadRemoteDirectoryRef.current("", destFolder)
          } else if (!isCanceled) {
            failures.push(`${file.name}: ${res.error || tRef.current('sftp_download_failed')}`)
          }
        } catch (err: unknown) {
          failures.push(`${file.name}: ${getErrorMessage(err, tRef.current('sftp_download_failed'))}`)
        }
      })
      if (failures.length > 0) {
        const failureText = formatFailureList(failures)
        setLocalError(tRef.current('sftp_download_partial_failed').replace('{failures}', failureText))
      }
      // 仅当用户未离开起始目录时才刷新
      if (localPathRef.current === destFolder && leftSideType === "local") loadLocalDirectoryRef.current(destFolder); else if (remotePathRef.current === destFolder && rightSideType === "local") loadRemoteDirectoryRef.current("", destFolder)
    } catch (err: unknown) {
      console.error('Drag download error:', err)
      setLocalError(getErrorMessage(err, tRef.current('sftp_download_failed')))
    } finally {
      // 仅当仍是当前批次时才清理，避免清掉新批次的状态
      if (transferBatchIdRef.current === myBatchId) resetConflictState()
    }
  }, [leftSideType, rightSideType, localExists, sftpTransferConcurrency, resetConflictState, askConflict, addSkippedRecord, recordPendingPath, selectedServerId, isRemoteDisconnected])

  // B. 上传本地文件到当前远程目录（支持多选并发）
  // 两阶段：① 串行预检冲突（避免传输开始后才弹窗） ② 并发限流上传
  // 每个文件独立调用 uploadFromPaths([p]) 以获得独立 transferId，确保传输记录按文件粒度生成
  // 批次隔离：每次进入生成新 batchId，旧批次若仍在 await askConflict 会因 batchId 不匹配自动 skip
  // 限制：前端不遍历本地目录，目录递归由后端 uploadFromPaths 完成。
  // BUG-9 已修复：后端 upload_dir_recursive_inner 已通过 entry.file_type().is_symlink() 跳过 symlink，
  // 与远程"跳过 symlink"策略一致，不会跟随 symlink 递归上传。
  const handleUploadLocalPaths = useCallback(async (targetServerId: string, targetPath: string, paths: string[], destFilesList: (FileEntry | LocalFileEntry)[]) => {
    if (!targetServerId || paths.length === 0) return
    if (targetServerId === selectedServerId && isRemoteDisconnected) {
      toastRef.current.warning(tRef.current('sftp_offline_readonly_tip'))
      return
    }
    // 生成新批次 ID 并清理上一批次遗留的冲突状态（resolve 旧 Promise，避免永挂）
    const myBatchId = ++transferBatchIdRef.current
    resetConflictState()
    // ① 预检阶段：串行检查每个文件是否与远程冲突
    // usedRemoteNames：跟踪本批次已分配的远程文件名，避免 duplicate 生成的副本名互相冲突
    const usedRemoteNames = new Set(destFilesList.map(f => f.name))
    const toUpload: { path: string; name: string; target: string; targetName: string | undefined }[] = []
    for (const p of paths) {
      const name = p.split(/[/\\]/).pop() || ''
      if (!name) continue
      let targetName: string | undefined // undefined 表示沿用本地 basename（replace 或无冲突）
      // 用 joinPath 拼远程路径：Windows 远程目标必须用 '\' 分隔，
      // 硬编码 '/' 会产生混合分隔符并波及续传临时文件路径
      const originalTarget = joinPath(targetPath, name)
      if (destFilesList.some(f => f.name === name) || usedRemoteNames.has(name)) {
        const action = await askConflict(name, targetPath, 'upload', myBatchId)
        if (action === 'stop') {
          addSkippedRecord('upload', name, p, originalTarget, tRef.current('sftp_transfer_user_stop'), undefined, serverNameOf(targetServerId), targetServerId)
          break
        }
        if (action === 'skip') {
          addSkippedRecord('upload', name, p, originalTarget, tRef.current('sftp_transfer_user_skip'), undefined, serverNameOf(targetServerId), targetServerId)
          continue
        }
        if (action === 'duplicate') {
          targetName = generateDuplicateName(name, usedRemoteNames)
          usedRemoteNames.add(targetName)
        }
      }
      toUpload.push({ path: p, name, target: targetName ? joinPath(targetPath, targetName) : originalTarget, targetName })
    }
    if (toUpload.length === 0) {
      if (transferBatchIdRef.current === myBatchId) resetConflictState()
      return
    }
    // ② 并发上传阶段：按设置中的并发量限流，每个文件独立 transferId
    // 并发安全性：后端每个 uploadFromPaths 调用各自 create_sftp_session 独立 channel，
    // SshConnection 用 Arc 包裹跨 task 安全共享，不存在 Mutex 串行化

    // 目录刷新辅助函数：防止后台会话上传完成刷新时串写当前激活标签的文件列表
    const refreshTargetDirectory = () => {
      const isRightActive = rightSideType === "remote" && selectedServerIdRef.current === targetServerId && remotePathRef.current === targetPath
      const isLeftActive = leftSideType === "remote" && leftServerIdRef.current === targetServerId && localPathRef.current === targetPath
      if (isRightActive) {
        loadRemoteDirectoryRef.current(targetServerId, targetPath)
      } else if (isLeftActive) {
        loadLocalDirectoryRef.current(targetPath)
      } else {
        // 目标为后台会话标签：绝不调用 loadRemoteDirectoryRef（避免串写当前激活标签视图），静默拉取并更新后台标签快照
        void sshService.listFiles(targetServerId, targetPath).then(files => {
          if (Array.isArray(files)) {
            setRightTabs(prev => prev.map(t => (t.serverId === targetServerId && t.path === targetPath) ? { ...t, files } : t))
          }
        }).catch(e => console.warn('Background tab file refresh failed:', e))
      }
    }

    try {
      const failures: string[] = []
      let anySuccess = false
      await runWithConcurrency(toUpload, sftpTransferConcurrency, async ({ path, name, target, targetName }) => {
        try {
          // 登记待绑定路径：后端上传进度事件以 file_name 为键回填 sourcePath/targetPath。
          // 上传事件的 file_name = 重命名后名（duplicate）?? 本地基名，故 key 用 targetName ?? name。
          // 缺少此登记会导致新建传输记录的 sourcePath/targetPath 为空（列表两列显示 "-"）。
          recordPendingPath(targetName ?? name, path, target, undefined, serverNameOf(targetServerId), targetServerId)
          // targetName 仅在 duplicate 时传入，后端用其覆盖远程文件名
          const res = await sshService.uploadFromPaths(targetServerId, targetPath, [path], targetName, sftpTransferConcurrency)
          if (res.success) {
            anySuccess = true
            // 单个文件上传成功后立即刷新远程目录（不用等所有文件传完）
            refreshTargetDirectory()
          } else {
            // 用户取消：不加入 failures，记录已由 cancelTransfer 标记
            // 后端整体 error 可能是 "All files failed to upload"，需检查 results 中各项是否有 canceled
            const isCanceled = (res.error || '').includes('canceled')
              || (res.results || []).some(r => (r.error || '').includes('canceled'))
            if (!isCanceled) {
              failures.push(`${name}: ${res.error || tRef.current('sftp_upload_failed')}`)
            }
          }
        } catch (err: unknown) {
          console.error('Upload error:', err)
          failures.push(`${name}: ${getErrorMessage(err, tRef.current('sftp_upload_failed'))}`)
        }
      })
      if (anySuccess) {
        // 仅当用户未离开起始目录时才刷新
        refreshTargetDirectory()
      }
      if (failures.length > 0) {
        const failureText = formatFailureList(failures)
        const template = !anySuccess
          ? tRef.current('sftp_upload_all_failed')
          : (tRef.current('sftp_upload_partial_failed') || tRef.current('sftp_upload_all_failed'))
        const fullMsg = template.replace('{failures}', failureText)
        const isRightActive = rightSideType === "remote" && selectedServerIdRef.current === targetServerId && remotePathRef.current === targetPath
        const isLeftActive = leftSideType === "remote" && leftServerIdRef.current === targetServerId && localPathRef.current === targetPath
        if (isRightActive) {
          setRemoteError(fullMsg)
        } else if (isLeftActive) {
          setLocalError(fullMsg)
        } else {
          toastRef.current.error(`${serverNameOf(targetServerId)}: ${fullMsg}`)
        }
      }
    } catch (err: unknown) {
      console.error('Drag upload error:', err)
      const errText = getErrorMessage(err, tRef.current('sftp_upload_failed'))
      const isRightActive = rightSideType === "remote" && selectedServerIdRef.current === targetServerId && remotePathRef.current === targetPath
      const isLeftActive = leftSideType === "remote" && leftServerIdRef.current === targetServerId && localPathRef.current === targetPath
      if (isRightActive) {
        setRemoteError(errText)
      } else if (isLeftActive) {
        setLocalError(errText)
      } else {
        toastRef.current.error(`${serverNameOf(targetServerId)}: ${errText}`)
      }
    } finally {
      // 仅当仍是当前批次时才清理，避免清掉新批次的状态
      if (transferBatchIdRef.current === myBatchId) resetConflictState()
    }
  }, [leftSideType, rightSideType, sftpTransferConcurrency, resetConflictState, askConflict, addSkippedRecord, recordPendingPath, selectedServerId, isRemoteDisconnected])

  // 服务器到服务器传输（左侧远程 ↔ 右侧远程，后端走 SFTP 对拷不落本地）
  // 参数语义：(srcServerId, destServerId, destDirPath, srcFiles, destFilesList)
  // - srcServerId: 源服务器 ID
  // - destServerId: 目标服务器 ID
  // - destDirPath: 目标目录路径（文件将被放入此目录）
  // - srcFiles: 源文件 FileEntry 列表
  // - destFilesList: 目标目录现有文件列表（用于冲突检测）
  const handleServerToServerTransfer = useCallback(async (
    srcServerId: string,
    destServerId: string,
    destDirPath: string,
    srcFiles: FileEntry[],
    destFilesList: (FileEntry | LocalFileEntry)[],
  ) => {
    if (!srcServerId || !destServerId || srcFiles.length === 0) return
    if ((srcServerId === selectedServerId && isRemoteDisconnected) || (destServerId === selectedServerId && isRemoteDisconnected)) {
      toastRef.current.warning(tRef.current('sftp_offline_readonly_tip'))
      return
    }
    const myBatchId = ++transferBatchIdRef.current
    resetConflictState()
    // ① 预检阶段：串行检查每个文件是否与目标目录冲突
    const usedDestNames = new Set(destFilesList.map(f => f.name))
    const toTransfer: { file: FileEntry; targetName: string | undefined }[] = []
    for (const file of srcFiles) {
      const name = file.name
      let targetName: string | undefined
      const originalTarget = joinPath(destDirPath, name)
      if (destFilesList.some(f => f.name === name) || usedDestNames.has(name)) {
        const action = await askConflict(name, destDirPath, 'upload', myBatchId)
        if (action === 'stop') {
          addSkippedRecord('s2s', name, file.path, originalTarget, tRef.current('sftp_transfer_user_stop'), serverNameOf(srcServerId), serverNameOf(destServerId), destServerId)
          break
        }
        if (action === 'skip') {
          addSkippedRecord('s2s', name, file.path, originalTarget, tRef.current('sftp_transfer_user_skip'), serverNameOf(srcServerId), serverNameOf(destServerId), destServerId)
          continue
        }
        if (action === 'duplicate') {
          targetName = generateDuplicateName(name, usedDestNames)
        }
      }
      usedDestNames.add(targetName ?? name)
      recordPendingPath(name, file.path, joinPath(destDirPath, targetName ?? name), serverNameOf(srcServerId), serverNameOf(destServerId), destServerId)
      toTransfer.push({ file, targetName })
    }
    if (toTransfer.length === 0) {
      if (transferBatchIdRef.current === myBatchId) resetConflictState()
      return
    }
    // ② 并发传输阶段：每个文件独立 transferId，后端按 SFTP 对拷

    // 目录刷新辅助函数：防止后台会话 S2S 完成刷新时串写当前激活标签的文件列表
    const refreshDestDirectory = () => {
      const isLeftActive = leftSideType === "remote" && leftServerIdRef.current === destServerId && localPathRef.current === destDirPath
      const isRightActive = rightSideType === "remote" && selectedServerIdRef.current === destServerId && remotePathRef.current === destDirPath
      if (isLeftActive) {
        loadLocalDirectoryRef.current(destDirPath)
      } else if (isRightActive) {
        loadRemoteDirectoryRef.current(destServerId, destDirPath)
      } else {
        // 目标为后台标签：更新后台标签缓存，绝不刷新当前激活视图
        void sshService.listFiles(destServerId, destDirPath).then(files => {
          if (Array.isArray(files)) {
            setRightTabs(prev => prev.map(t => (t.serverId === destServerId && t.path === destDirPath) ? { ...t, files } : t))
          }
        }).catch(e => console.warn('Background tab file refresh failed:', e))
      }
    }

    try {
      const failures: string[] = []
      let anySuccess = false
      await runWithConcurrency(toTransfer, sftpTransferConcurrency, async ({ file, targetName }) => {
        try {
          const res = await sshService.serverToServerTransfer(
            srcServerId, file.path, destServerId, destDirPath, targetName, sftpTransferConcurrency,
          )
          if (res.exitCode === 0) {
            anySuccess = true
            // 单个文件传输成功后立即刷新目标目录
            refreshDestDirectory()
          } else {
            const errMsg = res.stderr || res.stdout || tRef.current('sftp_transfer_failed')
            if (!errMsg.includes('canceled')) {
              failures.push(`${file.name}: ${errMsg}`)
            }
          }
        } catch (err: unknown) {
          failures.push(`${file.name}: ${getErrorMessage(err, tRef.current('sftp_transfer_failed'))}`)
        }
      })
      if (anySuccess) {
        refreshDestDirectory()
      }
      if (failures.length > 0) {
        const msg = formatFailureList(failures)
        const template = !anySuccess
          ? tRef.current('sftp_upload_all_failed')
          : (tRef.current('sftp_upload_partial_failed') || tRef.current('sftp_upload_all_failed'))
        const fullMsg = template.replace('{failures}', msg)
        const isLeftActive = leftSideType === "remote" && leftServerIdRef.current === destServerId && localPathRef.current === destDirPath
        const isRightActive = rightSideType === "remote" && selectedServerIdRef.current === destServerId && remotePathRef.current === destDirPath
        if (isLeftActive) {
          setLocalError(fullMsg)
        } else if (isRightActive) {
          setRemoteError(fullMsg)
        } else {
          toastRef.current.error(`${serverNameOf(destServerId)}: ${fullMsg}`)
        }
      }
    } catch (err: unknown) {
      console.error('Server-to-server transfer error:', err)
      const errText = getErrorMessage(err, tRef.current('sftp_transfer_failed'))
      const isLeftActive = leftSideType === "remote" && leftServerIdRef.current === destServerId && localPathRef.current === destDirPath
      const isRightActive = rightSideType === "remote" && selectedServerIdRef.current === destServerId && remotePathRef.current === destDirPath
      if (isLeftActive) {
        setLocalError(errText)
      } else if (isRightActive) {
        setRemoteError(errText)
      } else {
        toastRef.current.error(`${serverNameOf(destServerId)}: ${errText}`)
      }
    } finally {
      if (transferBatchIdRef.current === myBatchId) resetConflictState()
    }
  }, [leftSideType, rightSideType, sftpTransferConcurrency, resetConflictState, askConflict, addSkippedRecord, recordPendingPath])

  // 下载当前选中的远程文件到本地目录（按钮点击触发，支持多选）
  const handleDownloadSelected = useCallback(() => {
    if (selectedRemotePaths.size === 0 || !selectedServerId) return
    const files = remoteFiles.filter(f => selectedRemotePaths.has(f.path) && f.name !== '..')
    if (files.length === 0) return
    if (leftSideType === 'remote' && leftServerId) {
      void handleServerToServerTransfer(selectedServerId, leftServerId, localPath, files, localFiles)
    } else {
      void handleDownloadRemoteFiles(selectedServerId, localPath, files, localFiles)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRemotePaths, selectedServerId, remoteFiles, leftSideType, leftServerId, localPath, localFiles])

  // 用 ref 持有 handleUploadLocalPaths 和 handleDownloadRemoteFiles 的最新引用
  // 避免 pasteFilesFromClipboard 依赖未 memoize 的函数导致每次渲染都重建
  const handleUploadLocalPathsRef = useRef(handleUploadLocalPaths)
  handleUploadLocalPathsRef.current = handleUploadLocalPaths
  const handleDownloadRemoteFilesRef = useRef(handleDownloadRemoteFiles)
  handleDownloadRemoteFilesRef.current = handleDownloadRemoteFiles
  const handleServerToServerTransferRef = useRef(handleServerToServerTransfer)
  handleServerToServerTransferRef.current = handleServerToServerTransfer

  /** 把剪贴板内容粘贴到目标面板 */
  const pasteFilesFromClipboard = useCallback((targetSide: 'local' | 'remote') => {
    const cb = fileClipboardRef.current
    if (!cb || cb.paths.length === 0) {
      showTransferNotice(tRef.current('sftp_clipboard_empty'))
      return
    }
    // 同侧粘贴：不允许
    if (cb.sourceSide === targetSide) {
      showTransferNotice(tRef.current('sftp_paste_source_same_as_target'))
      return
    }
    // 跨面板粘贴
    if (cb.sourceSide === 'local' && targetSide === 'remote') {
      if (!selectedServerIdRef.current) {
        showTransferNotice(tRef.current('sftp_paste_target_not_connected'))
        return
      }
      if (leftSideType === 'remote') {
        // 双侧远程：左侧远程 → 右侧远程 (s2s)
        const srcServer = cb.sourceServerId || leftServerIdRef.current
        if (!srcServer) {
          showTransferNotice(tRef.current('sftp_paste_target_not_connected'))
          return
        }
        const entries = cb.remoteEntries || []
        if (entries.length === 0) {
          showTransferNotice(tRef.current('sftp_clipboard_empty'))
          return
        }
        void handleServerToServerTransferRef.current(
          srcServer,
          selectedServerIdRef.current,
          remotePathRef.current,
          entries,
          remoteFilesRef.current,
        )
      } else {
        // 本地 → 远程：上传（要求远程已连接）
        // 通过 ref 读取最新 remoteFiles，避免 useCallback 闭包陷阱（依赖数组只有 showTransferNotice）
        // 否则 destFilesList 永远是首次渲染时的空数组，冲突检测失效，会静默覆盖已存在文件
        handleUploadLocalPathsRef.current(selectedServerIdRef.current, remotePathRef.current, cb.paths, remoteFilesRef.current)
      }
    } else if (cb.sourceSide === 'remote' && targetSide === 'local') {
      if (!selectedServerIdRef.current || cb.sourceServerId !== selectedServerIdRef.current) {
        showTransferNotice(tRef.current('sftp_paste_target_not_connected'))
        return
      }
      // 直接使用剪贴板中缓存的 FileEntry[]，避免目录切换后 filteredRemoteFilesRef 找不到
      const entries = cb.remoteEntries || []
      if (entries.length === 0) {
        showTransferNotice(tRef.current('sftp_clipboard_empty'))
        return
      }
      if (leftSideType === 'remote') {
        // 双侧远程：右侧远程 → 左侧远程 (s2s)
        if (!leftServerIdRef.current) {
          showTransferNotice(tRef.current('sftp_paste_target_not_connected'))
          return
        }
        void handleServerToServerTransferRef.current(
          selectedServerIdRef.current,
          leftServerIdRef.current,
          localPathRef.current,
          entries,
          localFilesRef.current,
        )
      } else {
        // 远程 → 本地：下载（要求源服务器仍是当前远程且已连接）
        // 直接调用 handleDownloadRemoteFiles，避免 setSelectedRemotePaths 异步竞态
        // 通过 ref 读取最新 localFiles，理由同上
        void handleDownloadRemoteFilesRef.current(selectedServerIdRef.current, localPathRef.current, entries, localFilesRef.current)
      }
    }
  }, [showTransferNotice, leftSideType])

  // 提取全部唯一的标签并排序
  const allTags = useMemo(() => [...new Set(servers.flatMap((s) => s.tags))].sort(), [servers])

  // SFTP 模块内「已连接」的服务器集合（左栏远程 + 所有右侧标签）。
  // 用于：同一台远程服务器在 SFTP 模块内只能同时连接一次（不论左右），
  // 已连接的服务器在选服列表中置灰不可选，并排到列表末尾。
  const connectedServerIds = useMemo(() => {
    const set = new Set<string>()
    if (leftSideType === 'remote' && leftServerId) set.add(toBaseServerId(leftServerId))
    rightTabs.forEach((t) => { if (t.serverId) set.add(toBaseServerId(t.serverId)) })
    return set
  }, [leftSideType, leftServerId, rightTabs])

  // 左右两栏选服列表各自独立的筛选链路：标签/搜索/分组互不联动（左栏无搜索框，hostSearch 传空）
  const {
    filteredServers: leftFilteredServers,
    groupFilterCounts: leftGroupFilterCounts,
  } = useServerFilterList(servers, serverGroups, leftTagFilter, '', leftGroupFilter, connectedServerIds)
  const {
    filteredServers: rightFilteredServers,
    groupFilterCounts: rightGroupFilterCounts,
  } = useServerFilterList(servers, serverGroups, rightTagFilter, rightHostSearch, rightGroupFilter, connectedServerIds)

  // 过滤本地文件
  // 注：t 通过 tRef 读取，避免 t 引用变化（如语言切换触发 Provider 重渲染）导致每次重算
  const filteredLocalFiles = useMemo(() => {
    const query = localSearch.toLowerCase().trim()
    const filtered = localFiles
      .filter((f) => leftShowHidden || !isHiddenName(f.name))
      .filter((f) => !query || f.name.toLowerCase().includes(query))
    const sorted = sortFiles(
      filtered,
      localSortField,
      localSortOrder,
      (f) => tRef.current(getFileTypeLabel(f)),
      (f) => (f as LocalFileEntry).modified || ''
    )

    // 如果不是根目录，且没有进行搜索，我们在列表最前面虚拟插入 ".." 文件
    const parentPath = getParentPath(localPath)
    if (parentPath && !query) {
      const parentEntry: LocalFileEntry = {
        name: '..',
        path: parentPath,
        isDirectory: true,
        size: 0,
        modified: ''
      }
      return [parentEntry, ...sorted]
    }
    return sorted
  }, [localFiles, localSearch, localPath, localSortField, localSortOrder, leftShowHidden, isHiddenName])

  // 过滤远程文件
  // 注：t 通过 tRef 读取，避免 t 引用变化导致每次重算
  const filteredRemoteFiles = useMemo(() => {
    const query = remoteSearch.toLowerCase().trim()
    const filtered = remoteFiles
      .filter((f) => rightShowHidden || !isHiddenName(f.name))
      .filter((f) => !query || f.name.toLowerCase().includes(query))
    const sorted = sortFiles(
      filtered,
      remoteSortField,
      remoteSortOrder,
      (f) => tRef.current(getFileTypeLabel(f)),
      (f) => f.modifiedTime || ''
    )

    // 如果不是远程根目录，且没有进行搜索，我们在列表最前面虚拟插入 ".." 文件
    const parentPath = getParentPath(remotePath)
    if (parentPath && !query) {
      const parentEntry: FileEntry = {
        name: '..',
        path: parentPath,
        isDirectory: true,
        size: 0,
        modifiedTime: '',
        permissions: 'drwxr-xr-x'
      }
      return [parentEntry, ...sorted]
    }
    return sorted
  }, [remoteFiles, remoteSearch, remotePath, remoteSortField, remoteSortOrder, rightShowHidden, isHiddenName])

  // 同步 ref（键盘快捷键回调读取最新列表，避免闭包陷阱）
  filteredLocalFilesRef.current = filteredLocalFiles
  filteredRemoteFilesRef.current = filteredRemoteFiles

  // 本地文件列表虚拟化器（固定行高 40px，overscan 8 行缓冲）
  const localVirtualizer = useVirtualizer({
    count: filteredLocalFiles.length,
    getScrollElement: () => localListRef.current,
    estimateSize: () => FILE_ROW_HEIGHT,
    overscan: 8,
  })
  // 远程文件列表虚拟化器
  const remoteVirtualizer = useVirtualizer({
    count: filteredRemoteFiles.length,
    getScrollElement: () => remoteListRef.current,
    estimateSize: () => FILE_ROW_HEIGHT,
    overscan: 8,
  })

  const connectedServer = useMemo(() => {
    const baseId = toBaseServerId(selectedServerId)
    return servers.find((s) => s.id === baseId)
  }, [servers, selectedServerId])

  // 本地面包
  const localBreadcrumbs = useMemo(() => getPathBreadcrumbs(localPath), [localPath])
  // 远程面包
  const remoteBreadcrumbs = useMemo(() => getPathBreadcrumbs(remotePath), [remotePath])

  // ============================================================
  // 键盘快捷键
  // ============================================================
  // 设计要点：
  // 1. 通过 activePanel 区分作用对象（本地/远程），列表容器需 tabIndex={0} 获取焦点
  // 2. 对话框打开时（rename/delete/conflict/permissions/createFolder/createFile）禁用快捷键，
  //    避免与对话框内输入冲突
  // 3. 焦点在 input/textarea/contenteditable/select 上时不拦截（让浏览器原生处理）
  // 4. actionsRef 持有最新函数引用，keydown useEffect 只注册一次，避免频繁重订阅
  const handleSelectAllLocal = useCallback(() => {
    const all = new Set<string>()
    for (const f of filteredLocalFilesRef.current) {
      if (f.name === '..') continue
      all.add(f.path)
    }
    setSelectedLocalPaths(all)
  }, [])

  const handleSelectAllRemote = useCallback(() => {
    const all = new Set<string>()
    for (const f of filteredRemoteFilesRef.current) {
      if (f.name === '..') continue
      all.add(f.path)
    }
    setSelectedRemotePaths(all)
  }, [])

  // 触发删除：复用现有对话框流程（设置 deleteSide/deleteTarget/deleteMultiPaths）
  // 注意：多选时也必须设置 deleteTarget（取首个选中项）以使 ConfirmDialog 打开，
  // 真正的删除路径列表由 deleteMultiPaths 持有，与右键菜单多选删除保持一致
  const triggerDelete = useCallback((side: 'local' | 'remote') => {
    if (side === 'local') {
      const selected = selectedLocalPathsRef.current
      const valid = Array.from(selected).filter(p => !p.endsWith('/..') && p !== '..')
      if (valid.length === 0) return
      // 左侧为远程服务器时，走远程删除（针对 leftServerId）；否则走本地删除
      const isLeftRemote = leftSideType === 'remote' && !!leftServerId
      setDeleteSide(isLeftRemote ? 'remote' : 'local')
      if (isLeftRemote) setDeleteServerId(leftServerId)
      const firstEntry = filteredLocalFilesRef.current.find(f => f.path === valid[0]) ?? null
      setDeleteTarget(firstEntry)
      setDeleteMultiPaths(valid.length > 1 ? valid : null)
    } else {
      if (!selectedServerId) return
      const selected = selectedRemotePathsRef.current
      const valid = Array.from(selected).filter(p => !p.endsWith('/..') && p !== '..')
      if (valid.length === 0) return
      setDeleteSide('remote')
      setDeleteServerId(selectedServerId)
      const firstEntry = filteredRemoteFilesRef.current.find(f => f.path === valid[0]) ?? null
      setDeleteTarget(firstEntry)
      setDeleteMultiPaths(valid.length > 1 ? valid : null)
    }
  }, [selectedServerId, leftSideType, leftServerId])

  // 触发重命名：单选时复用现有对话框流程
  const triggerRename = useCallback((side: 'local' | 'remote') => {
    if (side === 'local') {
      const selected = Array.from(selectedLocalPathsRef.current)
        .filter(p => !p.endsWith('/..') && p !== '..')
      if (selected.length !== 1) return
      const entry = filteredLocalFilesRef.current.find(f => f.path === selected[0])
      if (!entry) return
      // 左侧为远程服务器时，走远程重命名（针对 leftServerId）；否则走本地重命名
      const isLeftRemote = leftSideType === 'remote' && !!leftServerId
      setRenameSide(isLeftRemote ? 'remote' : 'local')
      if (isLeftRemote) setRenameServerId(leftServerId)
      setRenameTarget(entry)
      setRenameValue(entry.name)
    } else {
      if (!selectedServerId) return
      const selected = Array.from(selectedRemotePathsRef.current)
        .filter(p => !p.endsWith('/..') && p !== '..')
      if (selected.length !== 1) return
      const entry = filteredRemoteFilesRef.current.find(f => f.path === selected[0])
      if (!entry) return
      setRenameSide('remote')
      setRenameServerId(selectedServerId)
      setRenameTarget(entry)
      setRenameValue(entry.name)
    }
  }, [selectedServerId, leftSideType, leftServerId])

  // 触发进入目录/打开文件（Enter 键 / 双击）
  // 对于可预览的文本/图片文件，优先打开查看器；其他类型走原上传/下载流程
  const triggerEnter = useCallback((side: 'local' | 'remote') => {
    if (side === 'local') {
      const selected = Array.from(selectedLocalPathsRef.current)
        .filter(p => !p.endsWith('/..') && p !== '..')
      if (selected.length !== 1) return
      const entry = filteredLocalFilesRef.current.find(f => f.path === selected[0])
      if (!entry) return
      if (entry.isDirectory) {
        loadLocalDirectory(entry.path)
        setSelectedLocalPaths(new Set())
      } else {
        if (selectedServerId) {
          if (leftSideType === 'remote' && leftServerId) {
            void handleServerToServerTransfer(leftServerId, selectedServerId, remotePath, [entry as unknown as FileEntry], remoteFiles)
          } else {
            void handleUploadLocalPaths(selectedServerId, remotePath, [entry.path], remoteFiles)
          }
        }
      }
    } else {
      if (!selectedServerId) return
      const selected = Array.from(selectedRemotePathsRef.current)
        .filter(p => !p.endsWith('/..') && p !== '..')
      if (selected.length !== 1) return
      const entry = filteredRemoteFilesRef.current.find(f => f.path === selected[0])
      if (!entry) return
      if (entry.isDirectory) {
        loadRemoteDirectory(selectedServerId, entry.path)
        setSelectedRemotePaths(new Set())
      } else {
        // 双击文件：直接下载（预览/编辑走右键菜单）
        handleDownloadFile(entry)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServerId, handleUploadLocalPaths, handleDownloadFile])

  // 触发复制路径（Ctrl+C）
  const triggerCopyPath = useCallback((side: 'local' | 'remote') => {
    if (side === 'local') {
      const selected = Array.from(selectedLocalPathsRef.current)
        .filter(p => !p.endsWith('/..') && p !== '..')
      if (selected.length === 0) return
      // 左侧为远程服务器时，复制的是远程路径
      if (leftSideType === 'remote') {
        handleCopyRemotePath(selected[0])
      } else {
        handleCopyLocalPath(selected[0])
      }
    } else {
      const selected = Array.from(selectedRemotePathsRef.current)
        .filter(p => !p.endsWith('/..') && p !== '..')
      if (selected.length === 0) return
      handleCopyRemotePath(selected[0])
    }
  }, [handleCopyLocalPath, handleCopyRemotePath, leftSideType])

  // 触发新建文件夹（Ctrl+Shift+N）
  const triggerNewFolder = useCallback((side: 'local' | 'remote') => {
    setCreateFolderSide(side)
    setNewFolderName('')
    setShowCreateFolder(true)
  }, [])

  // actionsRef：持有所有快捷键动作的最新引用，keydown 监听只注册一次
  const actionsRef = useRef({
    triggerDelete, triggerRename, triggerEnter, triggerCopyPath, triggerNewFolder,
    handleSelectAllLocal, handleSelectAllRemote,
    loadLocalDirectory, loadRemoteDirectory,
    copyFilesToClipboard, pasteFilesFromClipboard,
  })
  actionsRef.current = {
    triggerDelete, triggerRename, triggerEnter, triggerCopyPath, triggerNewFolder,
    handleSelectAllLocal, handleSelectAllRemote,
    loadLocalDirectory, loadRemoteDirectory,
    copyFilesToClipboard, pasteFilesFromClipboard,
  }

  // dialogOpenRef：判断是否有对话框打开，打开时禁用快捷键
  const dialogOpenRef = useRef(false)
  dialogOpenRef.current = !!(renameTarget || deleteTarget || pendingConflict ||
    pendingOverwrite || permissionsTarget || showCreateFolder || showCreateFile ||
    viewer.open || localPathEditing || remotePathEditing)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 焦点在可编辑元素上时不拦截，让浏览器原生处理
      const ae = document.activeElement as HTMLElement | null
      const tag = ae?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
          ae?.isContentEditable) {
        return
      }
      // 对话框打开时不拦截
      if (dialogOpenRef.current) return
      const panel = activePanelRef.current
      if (!panel) return
      const actions = actionsRef.current
      const key = e.key

      // Ctrl+A：全选（排除 '..'）
      if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'a') {
        e.preventDefault()
        if (panel === 'local') actions.handleSelectAllLocal()
        else actions.handleSelectAllRemote()
        return
      }
      // Ctrl+C：复制选中项路径（同时写入文件剪贴板，供 Ctrl+V 跨面板粘贴）
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key.toLowerCase() === 'c') {
        // 仅当有选中项时拦截，否则让浏览器复制
        const selected = panel === 'local'
          ? selectedLocalPathsRef.current
          : selectedRemotePathsRef.current
        const hasValid = Array.from(selected).some(p => !p.endsWith('/..') && p !== '..')
        if (hasValid) {
          e.preventDefault()
          actions.triggerCopyPath(panel)
          actions.copyFilesToClipboard(panel)
        }
        return
      }
      // Ctrl+V：粘贴文件到当前焦点面板
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && key.toLowerCase() === 'v') {
        e.preventDefault()
        actions.pasteFilesFromClipboard(panel)
        return
      }
      // Ctrl+Shift+N：新建文件夹
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && key.toLowerCase() === 'n') {
        e.preventDefault()
        actions.triggerNewFolder(panel)
        return
      }
      // 以下快捷键不与 Ctrl/Meta 组合
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (key === 'Delete') {
        e.preventDefault()
        actions.triggerDelete(panel)
      } else if (key === 'F2') {
        e.preventDefault()
        actions.triggerRename(panel)
      } else if (key === 'F5') {
        e.preventDefault()
        // 刷新后旧选中项可能已不存在，清理选中状态
        if (panel === 'local') {
          setSelectedLocalPaths(new Set())
          actions.loadLocalDirectory(localPathRef.current, undefined, undefined, { isRefresh: true })
        } else if (selectedServerIdRef.current) {
          setSelectedRemotePaths(new Set())
          actions.loadRemoteDirectory(selectedServerIdRef.current, remotePathRef.current, { isRefresh: true })
        }
      } else if (key === 'Backspace') {
        // 上级目录：进入新目录后旧选中项不再有效，清理
        e.preventDefault()
        if (panel === 'local') {
          const parent = getParentPath(localPathRef.current)
          if (parent) {
            setSelectedLocalPaths(new Set())
            actions.loadLocalDirectory(parent)
          }
        } else if (selectedServerIdRef.current) {
          const parent = getParentPath(remotePathRef.current)
          if (parent) {
            setSelectedRemotePaths(new Set())
            actions.loadRemoteDirectory(selectedServerIdRef.current, parent)
          }
        }
      } else if (key === 'Enter') {
        e.preventDefault()
        actions.triggerEnter(panel)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const renderServerSelectionList = (side: 'left' | 'right') => {
    return (
      <div className="flex-1 flex flex-col h-full bg-transparent px-6 pt-5 overflow-hidden">
        {(serverGroups.length > 0 || allTags.length > 0) && (
          <div className="flex items-center gap-1.5 flex-wrap mb-4 px-1 flex-shrink-0">
            {serverGroups.length > 0 && (
              <>
                <GroupFilterChip
                  groups={serverGroups}
                  value={leftGroupFilter}
                  onChange={setLeftGroupFilter}
                  counts={leftGroupFilterCounts.counts}
                  ungroupedCount={leftGroupFilterCounts.ungrouped}
                />
                {allTags.length > 0 && <span className="w-px h-3.5 bg-border/60 mx-0.5" />}
              </>
            )}
            {allTags.length > 0 && (
              <>
                <span className="text-[11px] text-muted-foreground mr-1">{t('dashboard_filter_tags')}:</span>
                <button
                  onClick={() => setLeftTagFilter(null)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer
                    ${leftTagFilter === null ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}
                >
                  {t('dashboard_filter_all')}
                </button>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setLeftTagFilter(leftTagFilter === tag ? null : tag)}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer
                      ${leftTagFilter === tag ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary hover:bg-primary/20'}`}
                  >
                    {tag}
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        <div className="flex-1 flex flex-col overflow-hidden">
          <ScrollArea className="flex-1 -mx-2 px-2">
            <div className="flex flex-col gap-1 pb-1">
              {leftFilteredServers.map((s) => {
                const isConnected = connectedServerIds.has(s.id)
                return (
                <div
                  key={s.id}
                  onDoubleClick={() => {
                    if (isConnected) return
                    if (side === 'left') {
                      handleConnectLeftServer(s.id);
                    } else {
                      handleConnectServer(s.id);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-3.5 p-3 rounded-xl border transition-all select-none",
                    isConnected
                      ? "opacity-50 cursor-not-allowed border-border/20 bg-muted/30"
                      : "hover:bg-accent/40 border-transparent hover:border-border/30 cursor-pointer group"
                  )}
                >
                  <OsIcon osType={s.osType} osInfo={s.osInfo} targetType={s.targetType} className="h-9 w-9 rounded-md overflow-hidden shadow-md flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className={cn("font-semibold text-sm truncate", isConnected ? "text-muted-foreground" : "text-foreground group-hover:text-primary transition-colors")}>
                      {s.name || s.host}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5 font-medium">
                      {s.host} &bull; ssh, {s.username}:{s.port}
                    </div>
                  </div>
                  {isConnected
                    ? <span className="text-[10px] text-muted-foreground/70 px-2 py-0.5 rounded bg-muted/60 flex-shrink-0">已连接</span>
                    : <ChevronRight className="h-4 w-4 text-muted-foreground/45 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />}
                </div>
                )
              })}
              {leftFilteredServers.length === 0 && (
                <div className="text-center py-12 text-muted-foreground flex flex-col items-center justify-center gap-2">
                  <Search className="h-8 w-8 text-muted-foreground/35" />
                  <span className="text-xs">{t('sftp_no_hosts_found')}</span>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    );
  };

  // 统一错误弹框：取 localError / remoteError 中第一个非空值
  // 过滤规则：
  // 1. 当远程处于断网/已断开状态（isRemoteDisconnected），或错误属于网络断开/超时类异常时，
  //    界面已常驻显示离线快照重连横幅（带有详细原因及“重新连接”按钮），不应弹出侵入式模态 ErrorDialog 阻断用户操作。
  // 2. 只有真正的业务操作失败（如删除失败、权限不足、重命名冲突、解压失败等）才弹出模态 ErrorDialog。
  const effectiveRemoteError = (() => {
    if (!remoteError) return null
    if (isRemoteDisconnected) return null
    if (selectedServerId && isSftpConnectionError(remoteError)) return null
    return remoteError
  })()

  const effectiveLocalError = (() => {
    if (!localError) return null
    if (leftSideType === 'remote' && isSftpConnectionError(localError)) return null
    return localError
  })()

  const activeSftpError = effectiveRemoteError || effectiveLocalError
  const formattedSftpError = activeSftpError ? formatSftpError(activeSftpError) : null
  const dismissSftpError = () => { setLocalError(null); setRemoteError(null) }

  const renderLocalCards = () => {
    const iconSize = getIconSizeClass(leftViewMode)
    return (
      <div className={cn("sftp-icon-grid", `view-${leftViewMode}`)}>
        {filteredLocalFiles.map((file, index) => {
          const isSelected = selectedLocalPaths.has(file.path)
          const isParent = file.name === '..'
          return (
            <div
              key={file.path}
              data-file-row="local"
              data-file-path={isParent ? undefined : file.path}
              className={cn(
                "sftp-icon-card",
                getCompareCardClass(file.path, 'local', isSelected)
              )}
              onMouseEnter={(e) => handleCardMouseEnter(e, file, leftSideType === 'remote' ? 'remote' : 'local')}
              onMouseLeave={clearCardHover}
              onPointerDown={(e) => {
                clearCardHover()
                if (e.button !== 0 || isParent) return
                const isSelected = selectedLocalPaths.has(file.path)
                // 已选中：点击该已选卡片的任意处或手柄都可以开始拖拽多选文件！
                // 未选中：必须点击在手柄（图标或文件名）上才视为单文件拖拽，卡片四周留白留给框选
                if (!isSelected && !(e.target as HTMLElement).closest('[data-drag-handle="true"]')) return
                const files = isSelected
                  ? localFiles.filter(f => selectedLocalPaths.has(f.path))
                  : [file]
                const paths = isSelected
                  ? Array.from(selectedLocalPaths)
                  : [file.path]
                dragPointerRef.current = { source: 'local', files: files as unknown as FileEntry[], paths, startX: e.clientX, startY: e.clientY }
              }}
              onDoubleClick={() => {
                clearCardHover()
                dblClickedRef.current = true
                if (file.isDirectory) {
                  loadLocalDirectory(file.path)
                  setSelectedLocalPaths(new Set())
                } else {
                  if (leftSideType === 'remote' && leftServerId) {
                    if (selectedServerId && remotePath) {
                      void handleServerToServerTransfer(leftServerId, selectedServerId, remotePath, [file as unknown as FileEntry], remoteFiles)
                    } else {
                      showTransferNotice(tRef.current('sftp_paste_target_not_connected'))
                    }
                  } else {
                    if (selectedServerId && remotePath) {
                      void handleUploadLocalPaths(selectedServerId, remotePath, [file.path], remoteFiles)
                    } else {
                      showTransferNotice(tRef.current('sftp_paste_target_not_connected'))
                    }
                  }
                }
              }}
              onMouseDown={(e) => {
                clearCardHover()
                if (e.button !== 0 && e.button !== 2) return
                dblClickedRef.current = false
                if (renameTarget && renameTarget.path === file.path) return
                const wasSelected = selectedLocalPaths.has(file.path)
                const currentIndex = index
                const newSet = new Set(selectedLocalPaths)
                if (e.shiftKey && !isParent && lastSelectedLocalIndexRef.current >= 0) {
                  const start = Math.min(lastSelectedLocalIndexRef.current, currentIndex)
                  const end = Math.max(lastSelectedLocalIndexRef.current, currentIndex)
                  for (let i = start; i <= end; i++) {
                    const f = filteredLocalFiles[i]
                    if (f && f.name !== '..') newSet.add(f.path)
                  }
                } else if (e.ctrlKey || e.metaKey) {
                  if (isParent) return
                  if (newSet.has(file.path)) newSet.delete(file.path)
                  else newSet.add(file.path)
                  lastSelectedLocalIndexRef.current = currentIndex
                } else {
                  if (e.button === 2 && newSet.has(file.path)) {
                    return
                  }
                  if (e.button === 0 && wasSelected && newSet.size > 1) {
                    // 多选状态下按下已选项：暂不立即清空其他项，避免破坏拖拽多选文件；
                    // 仅当纯点击未拖拽时，在 onClick 中收敛为单选
                    pendingDeselectOthersLocalRef.current = file.path
                    lastSelectedLocalIndexRef.current = currentIndex
                    return
                  }
                  newSet.clear()
                  if (!isParent) {
                    newSet.add(file.path)
                    lastSelectedLocalIndexRef.current = currentIndex
                  }
                }
                setSelectedLocalPaths(newSet)
                if (e.button === 0 && !isParent && !e.ctrlKey && !e.metaKey && !e.shiftKey && wasSelected) {
                  pendingRenameRef.current = { side: 'local', path: file.path }
                }
              }}
              onClick={() => {
                if (renameTarget && renameTarget.path === file.path) return
                if (justDraggedRef.current) return
                if (pendingDeselectOthersLocalRef.current === file.path) {
                  pendingDeselectOthersLocalRef.current = null
                  setSelectedLocalPaths(new Set([file.path]))
                  return
                }
                const pending = pendingRenameRef.current
                pendingRenameRef.current = null
                if (!pending || pending.side !== 'local' || pending.path !== file.path) return
                window.setTimeout(() => {
                  if (!mountedRef.current) return
                  if (dblClickedRef.current) return
                  triggerRename('local')
                }, 250)
              }}
              onContextMenu={() => {
                clearCardHover()
                setLocalContextMenuFile(file)
              }}
            >
              <div className={cn("flex items-center justify-center shrink-0 relative mt-1", iconSize)} data-drag-handle="true">
                {openingLocalPath === file.path ? (
                  <Loader2 className="h-6 w-6 animate-spin text-primary shrink-0" />
                ) : (
                  renderFileIcon(file, iconSize)
                )}
              </div>
              {renameTarget && renameTarget.path === file.path ? (
                <div className="w-full mt-1.5 px-1">
                  <InlineRenameInput
                    value={renameValue}
                    onChange={setRenameValue}
                    onCommit={() => { if (renameSide === 'local') void handleRenameLocal(); else void handleRenameRemote(); }}
                    onCancel={() => { setRenameTarget(null); setRenameValue('') }}
                  />
                </div>
              ) : (
                <span
                  className="sftp-icon-card-name"
                  title={file.name}
                  data-drag-handle="true"
                >
                  {file.name}
                </span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const renderRemoteCards = () => {
    const iconSize = getIconSizeClass(rightViewMode)
    return (
      <div className={cn("sftp-icon-grid", `view-${rightViewMode}`)}>
        {filteredRemoteFiles.map((file, index) => {
          const isSelected = selectedRemotePaths.has(file.path)
          const isParent = file.name === '..'
          return (
            <div
              key={file.path}
              data-file-row="remote"
              data-file-path={isParent ? undefined : file.path}
              className={cn(
                "sftp-icon-card",
                getCompareCardClass(file.path, 'remote', isSelected)
              )}
              onMouseEnter={(e) => handleCardMouseEnter(e, file, 'remote')}
              onMouseLeave={clearCardHover}
              onPointerDown={(e) => {
                clearCardHover()
                if (e.button !== 0 || isParent) return
                const isSelected = selectedRemotePaths.has(file.path)
                // 已选中：点击该已选卡片的任意处或手柄都可以开始拖拽多选文件！
                // 未选中：必须点击在手柄（图标或文件名）上才视为单文件拖拽，卡片四周留白留给框选
                if (!isSelected && !(e.target as HTMLElement).closest('[data-drag-handle="true"]')) return
                const files = isSelected
                  ? remoteFiles.filter(f => selectedRemotePaths.has(f.path))
                  : [file]
                dragPointerRef.current = { source: 'remote', files, startX: e.clientX, startY: e.clientY }
              }}
              onDoubleClick={() => {
                clearCardHover()
                dblClickedRef.current = true
                if (file.isDirectory) {
                  if (isRemoteDisconnected) {
                    toastRef.current.warning(tRef.current('sftp_offline_readonly_tip'))
                    return
                  }
                  loadRemoteDirectory(selectedServerId, file.path)
                  setSelectedRemotePaths(new Set())
                } else {
                  if (leftSideType === 'remote' && leftServerId) {
                    if (selectedServerId && remotePath) {
                      void handleServerToServerTransfer(selectedServerId, leftServerId, localPath, [file], localFiles)
                    } else {
                      showTransferNotice(tRef.current('sftp_paste_target_not_connected'))
                    }
                  } else {
                    if (selectedServerId && remotePath) {
                      void handleDownloadRemoteFiles(selectedServerId, localPath, [file], localFiles)
                    } else {
                      showTransferNotice(tRef.current('sftp_paste_target_not_connected'))
                    }
                  }
                }
              }}
              onMouseDown={(e) => {
                clearCardHover()
                if (e.button !== 0 && e.button !== 2) return
                dblClickedRef.current = false
                if (renameTarget && renameTarget.path === file.path) return
                const wasSelected = selectedRemotePaths.has(file.path)
                const currentIndex = index
                const newSet = new Set(selectedRemotePaths)
                if (e.shiftKey && !isParent && lastSelectedRemoteIndexRef.current >= 0) {
                  const start = Math.min(lastSelectedRemoteIndexRef.current, currentIndex)
                  const end = Math.max(lastSelectedRemoteIndexRef.current, currentIndex)
                  for (let i = start; i <= end; i++) {
                    const f = filteredRemoteFiles[i]
                    if (f && f.name !== '..') newSet.add(f.path)
                  }
                } else if (e.ctrlKey || e.metaKey) {
                  if (isParent) return
                  if (newSet.has(file.path)) newSet.delete(file.path)
                  else newSet.add(file.path)
                  lastSelectedRemoteIndexRef.current = currentIndex
                } else {
                  if (e.button === 2 && newSet.has(file.path)) {
                    return
                  }
                  if (e.button === 0 && wasSelected && newSet.size > 1) {
                    // 多选状态下按下已选项：暂不立即清空其他项，避免破坏拖拽多选文件；
                    // 仅当纯点击未拖拽时，在 onClick 中收敛为单选
                    pendingDeselectOthersRemoteRef.current = file.path
                    lastSelectedRemoteIndexRef.current = currentIndex
                    return
                  }
                  newSet.clear()
                  if (!isParent) {
                    newSet.add(file.path)
                    lastSelectedRemoteIndexRef.current = currentIndex
                  }
                }
                setSelectedRemotePaths(newSet)
                if (e.button === 0 && !isParent && !e.ctrlKey && !e.metaKey && !e.shiftKey && wasSelected) {
                  pendingRenameRef.current = { side: 'remote', path: file.path }
                }
              }}
              onClick={() => {
                if (renameTarget && renameTarget.path === file.path) return
                if (justDraggedRef.current) return
                if (pendingDeselectOthersRemoteRef.current === file.path) {
                  pendingDeselectOthersRemoteRef.current = null
                  setSelectedRemotePaths(new Set([file.path]))
                  return
                }
                const pending = pendingRenameRef.current
                pendingRenameRef.current = null
                if (!pending || pending.side !== 'remote' || pending.path !== file.path) return
                window.setTimeout(() => {
                  if (!mountedRef.current) return
                  if (dblClickedRef.current) return
                  triggerRename('remote')
                }, 250)
              }}
              onContextMenu={() => {
                clearCardHover()
                setRemoteContextMenuFile(file)
              }}
            >
              <div className={cn("flex items-center justify-center shrink-0 relative mt-1", iconSize)} data-drag-handle="true">
                {openingRemotePath === file.path ? (
                  <Loader2 className="h-6 w-6 animate-spin text-primary shrink-0" />
                ) : (
                  renderFileIcon(file, iconSize)
                )}
              </div>
              {renameTarget && renameTarget.path === file.path ? (
                <div className="w-full mt-1.5 px-1">
                  <InlineRenameInput
                    value={renameValue}
                    onChange={setRenameValue}
                    onCommit={() => { if (renameSide === 'local') void handleRenameLocal(); else void handleRenameRemote(); }}
                    onCancel={() => { setRenameTarget(null); setRenameValue('') }}
                  />
                </div>
              ) : (
                <span
                  className="sftp-icon-card-name"
                  title={file.name}
                  data-drag-handle="true"
                >
                  {file.name}
                </span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background relative">

      {/* SFTP 面板内拖拽预览：跟随光标，不拦截事件 */}
      {dragPreview && createPortal(
        <div
          className="fixed z-[100] pointer-events-none flex items-center gap-2 rounded-lg border border-border/60 bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-lg"
          style={{ left: dragPreview.x + 14, top: dragPreview.y + 14 }}
        >
          <span className="max-w-[220px] truncate font-medium">{dragPreview.label}</span>
          {dragPreview.count > 1 && (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">{dragPreview.count}</span>
          )}
        </div>,
        document.body,
      )}

      {/* 2. 核心主内容区（双栏文件管理器）
          min-h-0 确保 flex 子元素能正确收缩，让出底部传输面板的空间 */}
      <div ref={containerRef} className="flex-1 flex overflow-hidden min-h-0 p-2 gap-1 bg-canvas/40">
        
        {/* ─── 左栏：本地文件浏览器 ────────────────────────────────────────── */}
        <div 
          className="flex flex-col h-full overflow-hidden bg-card/95 rounded-xl border border-border/70 shadow-sm flex-shrink-0"
          style={{ width: `calc(${localSplitPercent}% - 4px)` }}
        >
          
                    {/* 本地面板顶部标题 */}
          <div className="px-3 py-2 border-b flex items-center justify-between bg-muted/15 select-none h-10 flex-shrink-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground truncate mr-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 px-2 font-semibold text-xs gap-1.5 rounded-lg border border-border/50 bg-muted/30 hover:bg-accent/60 cursor-pointer flex-shrink-0">
                    <OsIcon osType={leftSideType === 'local' ? getLocalOs() : (leftServerId ? servers.find(s=>s.id===toBaseServerId(leftServerId))?.osType : undefined)} osInfo={leftSideType === 'local' ? undefined : (leftServerId ? servers.find(s=>s.id===toBaseServerId(leftServerId))?.osInfo : undefined)} targetType={leftSideType === 'local' ? undefined : (leftServerId ? servers.find(s=>s.id===toBaseServerId(leftServerId))?.targetType : undefined)} className="h-4 w-4 rounded-md" />
                    <span>{leftSideType === 'local' ? t('sftp_local') : (leftServerId ? (servers.find(s=>s.id===toBaseServerId(leftServerId))?.name || 'Remote') : 'Select Server')}</span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuItem onClick={() => {
                    setLeftSideType('local');
                    setLeftServerId('');
                    setSelectedLocalPaths(new Set());
                    setLocalSearch('');
                    const saved = readLastLocalPath();
                    const fallback = saved || (systemRoots.length > 0 ? systemRoots[0] : '/');
                    loadLocalDirectory(fallback, 'local', '');
                  }} className="cursor-pointer">
                    <Monitor className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span>{t('sftp_local')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    setLeftSideType('remote');
                    setLeftServerId('');
                    setSelectedLocalPaths(new Set());
                    setLocalSearch('');
                  }} className="cursor-pointer">
                    <Server className="mr-2 h-4 w-4 text-muted-foreground" />
                    <span>{t('sftp_remote_server')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {leftSideType === 'local' ? (
                <>
                  <span className="inline-flex items-baseline gap-1 text-[11px] text-muted-foreground font-mono font-normal">
                    <span className="text-muted-foreground/50">|</span>
                    <span>127.0.0.1</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyLocalIp('127.0.0.1');
                      }}
                      className="p-0.5 hover:text-foreground hover:bg-muted rounded transition-colors shrink-0 cursor-pointer self-center"
                      title={t('sftp_copy_local_ip')}
                    >
                      {copiedLocalIp ? (
                        <Check className="h-2.5 w-2.5 text-green-500" />
                      ) : (
                        <Copy className="h-2.5 w-2.5" />
                      )}
                    </button>
                  </span>
                </>
              ) : leftServerId ? (
                (() => {
                  const s = servers.find(srv => srv.id === toBaseServerId(leftServerId));
                  return (
                    <span className="inline-flex items-baseline gap-1 text-[11px] text-muted-foreground font-mono font-normal">
                      <span className="text-muted-foreground/50">|</span>
                      <span>{s?.host}</span>
                    </span>
                  );
                })()
              ) : null}
            </div>
          </div>

          {leftSideType === 'remote' && !leftServerId && !connectingLeftServerId ? (
            renderServerSelectionList('left')
          ) : leftSideType === 'remote' && !leftServerId && connectingLeftServerId ? (
            <div className="flex-1 flex flex-col items-center justify-center bg-transparent p-6 select-none">
              <QshellLoader size="lg" text={t('sftp_connecting') || 'Connecting...'} />

            </div>
          ) : (
            <>
              {/* 本地头部导航 */}

          <div className="p-3 border-b flex-shrink-0 flex flex-col gap-2 bg-muted/5">
            <div className="flex items-center gap-1.5 overflow-hidden">
              <Button
                variant="ghost"
                size="icon"
                disabled={!getParentPath(localPath)}
                onClick={() => {
                  const parent = getParentPath(localPath)
                  if (parent) loadLocalDirectory(parent)
                }}
                className="h-7 w-7 flex-shrink-0"
                aria-label={t('sftp_go_up') || 'Go up'}
              >
                <FolderUp className="h-4 w-4" />
              </Button>

              {/* 本地路径面包�?*/}
              {localPathEditing ? (
                <input
                  ref={(el) => {
                    if (el) {
                      setTimeout(() => {
                        el.focus()
                        el.select()
                      }, 0)
                    }
                  }}
                  autoFocus
                  value={localPathInput}
                  onChange={(e) => setLocalPathInput(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onBlur={commitLocalPathEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitLocalPathEdit() }
                    else if (e.key === 'Escape') { e.preventDefault(); setLocalPathEditing(false) }
                  }}
                  className="flex-1 h-7 px-2 text-xs font-mono bg-background border border-primary/50 focus-visible:ring-1 focus-visible:ring-primary rounded-md outline-none"
                  placeholder={t('sftp_path_goto')}
                />
              ) : (
                <SftpBreadcrumbBar
                  crumbs={localBreadcrumbs}
                  onNavigate={loadLocalDirectory}
                  onDoubleClick={startLocalPathEdit}
                  title={t('sftp_path_goto')}
                  isLocalRootSelectable={leftSideType === 'local'}
                  systemRoots={systemRoots}
                />
              )}

              {/* 本地路径收藏 */}
              <SftpBookmarkDropdown
                currentPath={localPath}
                bookmarks={leftBookmarks}
                onAddBookmark={handleAddLeftBookmark}
                onRemoveBookmark={handleRemoveLeftBookmark}
                onNavigate={loadLocalDirectory}
                disabled={!localPath || localLoading}
                t={t}
              />

              {/* 本地文件搜索（路径之后，刷新之前） */}
              <div className="relative w-40 flex-shrink-0">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/60" />
                <Input
                  type="text"
                  placeholder={t('sftp_search_local_placeholder') || 'Search...'}
                  value={localSearch}
                  onChange={(e) => setLocalSearch(e.target.value)}
                  className="pl-7 pr-6 h-7 text-xs bg-background border-border/50 focus-visible:ring-1 focus-visible:ring-primary rounded-md"
                />
                {localSearch && (
                  <button
                    onClick={() => setLocalSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              <SftpActionsDropdown
                viewMode={leftViewMode}
                onViewModeChange={handleSetLeftViewMode}
                showHidden={leftShowHidden}
                onToggleShowHidden={() => setLeftShowHidden(v => !v)}
                onRefresh={() => loadLocalDirectory(localPath, undefined, undefined, { isRefresh: true })}
                onNewFolder={() => {
                  setCreateFolderSide('local')
                  setNewFolderName('')
                  setShowCreateFolder(true)
                }}
                onNewFile={() => {
                  setCreateFileSide('local')
                  setNewFileName('')
                  setShowCreateFile(true)
                }}
                onSelectAll={handleSelectAllLocal}
                onTransfer={() => {
                  if (!selectedServerId) return
                  const valid = Array.from(selectedLocalPaths).filter(p => !p.endsWith('/..') && p !== '..')
                  if (valid.length === 0) return
                  if (isLeftRemote) {
                    const files = localFiles.filter(f => selectedLocalPaths.has(f.path) && f.name !== '..')
                    if (files.length > 0) {
                      void handleServerToServerTransfer(leftServerId, selectedServerId, remotePath, files as unknown as FileEntry[], remoteFiles)
                    }
                  } else {
                    void handleUploadLocalPaths(selectedServerId, remotePath, valid, remoteFiles)
                  }
                }}
                onDelete={() => triggerDelete('local')}
                canTransfer={!!selectedServerId && Array.from(selectedLocalPaths).some(p => !p.endsWith('/..') && p !== '..')}
                canDelete={Array.from(selectedLocalPaths).some(p => !p.endsWith('/..') && p !== '..')}
                transferLabel={
                  selectedLocalPaths.size > 1
                    ? t('sftp_transfer_selected').replace('{n}', String(selectedLocalPaths.size))
                    : t('sftp_transfer_to_target')
                }
                transferIcon={<ArrowRight className="mr-2 h-3.5 w-3.5 text-muted-foreground" />}
                loading={localLoading}
                t={t}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => loadLocalDirectory(localPath, undefined, undefined, { isRefresh: true })}
                disabled={localLoading}
                className="h-7 w-7 flex-shrink-0"
                aria-label={t('sftp_refresh') || 'Refresh'}
              >
                <RefreshCw className={cn("h-4 w-4", localLoading && "animate-spin")} />
              </Button>
             </div>

          </div>

          {/* 本地目录结构布局：文件列?*/}
          <div className="flex-1 flex overflow-hidden">
            
            {/* 本地主列?*/}
            <div className="flex-1 flex flex-col h-full overflow-hidden relative">
              {localLoading && localFiles.length === 0 ? (
                <div className="flex-1 overflow-hidden p-2">
                  <FileSkeletonList viewMode={leftViewMode} count={8} />
                </div>
              ) : localError ? (
                <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                  <p className="text-xs text-destructive mb-2">{localError}</p>
                  <Button size="sm" variant="outline" onClick={() => loadLocalDirectory(localPath)}>
                    {t('sftp_retry')}
                  </Button>
                </div>
              ) : (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* 本地列表表头（仅列表模式展示） */}
                  {leftViewMode === 'list' && (
                    <div className={cn(
                      "grid px-4 border-b border-border/50 bg-muted/20 text-[10px] text-muted-foreground/80 font-semibold select-none items-stretch h-7 flex-shrink-0 tracking-wider uppercase",
                      leftSideType === 'remote' ? "grid-cols-[2.5fr_0.8fr_1fr_1.5fr_1.2fr_1fr]" : "grid-cols-[2.5fr_1fr_1.2fr_1.8fr]"
                    )}>
                      <button 
                        onClick={() => handleLocalSort('name')}
                        className="flex items-center gap-1 hover:text-foreground text-left cursor-pointer font-medium tracking-wider pr-3 h-full transition-colors"
                      >
                        <span>{t('sftp_col_name')}</span>
                        {localSortField === 'name' && (
                          localSortOrder === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />
                        )}
                      </button>
                      <button 
                        onClick={() => handleLocalSort('size')}
                        className="flex items-center justify-start gap-1 hover:text-foreground text-left cursor-pointer font-medium tracking-wider pl-3 pr-3 h-full transition-colors"
                      >
                        <span>{t('sftp_col_size')}</span>
                        {localSortField === 'size' && (
                          localSortOrder === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />
                        )}
                      </button>
                      <span className="text-left pl-3 pr-3 h-full flex items-center justify-start font-medium tracking-wider">{t('sftp_col_type') || 'Type'}</span>
                      <button 
                        onClick={() => handleLocalSort('modified')}
                        className="flex items-center justify-start gap-1 hover:text-foreground text-left cursor-pointer font-medium tracking-wider pl-3 h-full transition-colors"
                      >
                        <span>{t('sftp_col_modified')}</span>
                        {localSortField === 'modified' && (
                          localSortOrder === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />
                        )}
                      </button>
                      {leftSideType === 'remote' && (
                        <>
                          <span className="text-left pl-3 pr-3 h-full flex items-center justify-start font-medium tracking-wider">{t('sftp_col_permissions')}</span>
                          <span className="text-left pl-3 pr-3 h-full flex items-center justify-start font-medium tracking-wider">{t('sftp_col_owner') || 'Owner'}</span>
                        </>
                      )}
                    </div>
                  )}

                  {/* 本地进度条 */}
                  {localLoading && (
                    <div className="h-0.5 w-full bg-primary/20 overflow-hidden relative flex-shrink-0">
                      <div className="h-full bg-primary animate-pulse w-full" />
                    </div>
                  )}

                  {/* 本地滚动项 */}
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div
                        ref={localListRef}
                        data-panel="local"
                        tabIndex={0}
                        onFocus={() => setActivePanel('local')}
                        onBlur={() => setActivePanel(prev => prev === 'local' ? null : prev)}
                        onScroll={clearCardHover}
                        className={cn(
                          "flex-1 overflow-auto transition-all duration-200 outline-none",
                          isDraggingOverLocal && "bg-primary/5 ring-2 ring-primary/40 ring-dashed",
                          activePanel === 'local' && !isDraggingOverLocal && "ring-1 ring-primary/20",
                          ""
                        )}
                        onMouseDown={(e) => {
                          const target = e.target as HTMLElement
                          if (target.closest('[data-drag-handle="true"]')) return
                          const row = target.closest('[data-file-row="local"]') as HTMLElement | null
                          const path = row?.dataset.filePath
                          // 点击在已选中的行/卡片上时交给多选拖拽，不启动框选！
                          if (path && selectedLocalPaths.has(path)) return
                          handleLocalMarqueeMouseDown(e)
                        }}
                        onClick={(e) => {
                          if (justDraggedRef.current) { justDraggedRef.current = false; return }
                          if (consumeLocalMarqueeClick()) return
                          if ((e.target as HTMLElement).closest('[data-file-row="local"]')) return
                          setSelectedLocalPaths(new Set())
                        }}
                        onContextMenu={(e) => {
                          if (!(e.target as HTMLElement).closest('[data-file-row="local"]')) {
                            setLocalContextMenuFile(null)
                          }
                        }}
                      >
                        {filteredLocalFiles.length === 0 ? (
                          <div className="py-12 text-center text-xs text-muted-foreground select-none">
                            {localLoading
                              ? t('sftp_loading_local')
                              : localError
                                ? t('sftp_load_failed_retry')
                                : localSearch.trim()
                                  ? t('sftp_no_matching_files')
                                  : t('sftp_no_files')}
                          </div>
                        ) : leftViewMode === 'list' ? (
                          <div
                            style={{
                              height: `${localVirtualizer.getTotalSize()}px`,
                              width: '100%',
                              position: 'relative',
                            }}
                          >
                            {localVirtualizer.getVirtualItems().map((virtualItem) => {
                              const file = filteredLocalFiles[virtualItem.index]
                              const isSelected = selectedLocalPaths.has(file.path)
                              return (
                                <div
                                  key={file.path}
                                  data-file-row="local"
                                  data-file-path={file.name === '..' ? undefined : file.path}
                                  style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: `${virtualItem.size}px`,
                                    transform: `translateY(${virtualItem.start}px)`,
                                  }}
                                  onPointerDown={(e) => {
                                    if (e.button !== 0 || file.name === '..') return
                                    const isSelected = selectedLocalPaths.has(file.path)
                                    // 已选中：点击已选行的任意区域（或手柄）都可以启动拖拽多选文件！
                                    // 未选中：必须点击在手柄（图标或文件名）上才视为单文件拖拽，属性列留给框选
                                    if (!isSelected && !(e.target as HTMLElement).closest('[data-drag-handle="true"]')) return
                                    const files = isSelected
                                      ? localFiles.filter(f => selectedLocalPaths.has(f.path))
                                      : [file]
                                    const paths = isSelected
                                      ? Array.from(selectedLocalPaths)
                                      : [file.path]
                                    dragPointerRef.current = { source: 'local', files: files as unknown as FileEntry[], paths, startX: e.clientX, startY: e.clientY }
                                  }}
                                  onDoubleClick={() => {
                                     dblClickedRef.current = true
                                     if (file.isDirectory) {
                                       loadLocalDirectory(file.path)
                                       setSelectedLocalPaths(new Set())
                                     } else {
                                       if (leftSideType === 'remote' && leftServerId) {
                                         if (selectedServerId && remotePath) {
                                           void handleServerToServerTransfer(leftServerId, selectedServerId, remotePath, [file as unknown as FileEntry], remoteFiles)
                                         } else {
                                           showTransferNotice(tRef.current('sftp_paste_target_not_connected'))
                                         }
                                       } else {
                                         if (selectedServerId && remotePath) {
                                           void handleUploadLocalPaths(selectedServerId, remotePath, [file.path], remoteFiles)
                                         } else {
                                           showTransferNotice(tRef.current('sftp_paste_target_not_connected'))
                                         }
                                       }
                                     }
                                   }}
                                  onMouseDown={(e) => {
                                    if (e.button !== 0 && e.button !== 2) return
                                    // 每次交互（mousedown）开始时清除双击标志，避免上一次双击遗留的 true 误杀本次重命名
                                    dblClickedRef.current = false
                                    // 内联重命名进行中：点击当前行不触发选中/重命名逻辑，交由输入框处理
                                    if (renameTarget && renameTarget.path === file.path) return
                                    // 跳过 ".." 项的可选择行为（允许导航但不进入选中集合）
                                    const isParent = file.name === '..'
                                    // 记录点击前是否已选中：用于「再次点击重命名」（仅在点击前已选中时触发）
                                    const wasSelected = selectedLocalPaths.has(file.path)
                                    const currentIndex = virtualItem.index
                                    const newSet = new Set(selectedLocalPaths)
                                    if (e.shiftKey && !isParent && lastSelectedLocalIndexRef.current >= 0) {
                                      // Shift 范围选择：从锚点索引到当前索引（跳过 ".."）
                                      const start = Math.min(lastSelectedLocalIndexRef.current, currentIndex)
                                      const end = Math.max(lastSelectedLocalIndexRef.current, currentIndex)
                                      for (let i = start; i <= end; i++) {
                                        const f = filteredLocalFiles[i]
                                        if (f && f.name !== '..') newSet.add(f.path)
                                      }
                                    } else if (e.ctrlKey || e.metaKey) {
                                      if (isParent) return
                                      if (newSet.has(file.path)) newSet.delete(file.path)
                                      else newSet.add(file.path)
                                      lastSelectedLocalIndexRef.current = currentIndex
                                    } else {
                                      if (e.button === 2 && newSet.has(file.path)) {
                                        return
                                      }
                                      if (e.button === 0 && wasSelected && newSet.size > 1) {
                                        // 多选状态下按下已选项：暂不立即清空其他项，避免破坏拖拽多选文件；
                                        // 仅当纯点击未拖拽时，在 onClick 中收敛为单选
                                        pendingDeselectOthersLocalRef.current = file.path
                                        lastSelectedLocalIndexRef.current = currentIndex
                                        return
                                      }
                                      newSet.clear()
                                      if (!isParent) {
                                        newSet.add(file.path)
                                        lastSelectedLocalIndexRef.current = currentIndex
                                      }
                                    }
                                    setSelectedLocalPaths(newSet)
                                    // 点击前已选中（且非修饰键、非父目录）→ 标记待重命名；由 onClick 延时触发，避让双击进入目录/传输
                                    if (e.button === 0 && !isParent && !e.ctrlKey && !e.metaKey && !e.shiftKey && wasSelected) {
                                      pendingRenameRef.current = { side: 'local', path: file.path }
                                    }
                                  }}
                                  onClick={() => {
                                    // 内联重命名中：忽略当前行的点击，避免重复触发
                                    if (renameTarget && renameTarget.path === file.path) return
                                    if (justDraggedRef.current) return
                                    if (pendingDeselectOthersLocalRef.current === file.path) {
                                      pendingDeselectOthersLocalRef.current = null
                                      setSelectedLocalPaths(new Set([file.path]))
                                      return
                                    }
                                    const pending = pendingRenameRef.current
                                    pendingRenameRef.current = null
                                    if (!pending || pending.side !== 'local' || pending.path !== file.path) return
                                    // 延时消歧：双击会在 click 之后触发 onDoubleClick（已置 dblClickedRef），
                                    // 250ms 内发生双击则不重命名，交由双击进入目录/传输
                                    window.setTimeout(() => {
                                      if (dblClickedRef.current) return
                                      triggerRename('local')
                                    }, 250)
                                  }}
                                  onContextMenu={() => {
                                    setLocalContextMenuFile(file)
                                  }}
                                  className={cn(
                                    "workspace-table-row group grid px-4 h-9 text-xs items-center cursor-pointer select-none",
                                    leftSideType === 'remote' ? "grid-cols-[2.5fr_0.8fr_1fr_1.5fr_1.2fr_1fr]" : "grid-cols-[2.5fr_1fr_1.2fr_1.8fr]",
                                    getCompareRowBgClass(file.path, 'local', isSelected)
                                  )}
                                >
                                  <div className="flex items-center overflow-hidden pr-2">
                                    <div className="inline-flex items-center gap-2 max-w-full overflow-hidden" data-drag-handle="true">
                                      {file.name === '..' ? (
                                        <div className="flex items-center gap-2 text-muted-foreground/90 font-medium">
                                          <div className="flex h-5 w-5 items-center justify-center rounded bg-muted/60 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                            <FolderUp className="h-3.5 w-3.5" />
                                          </div>
                                          <span className="font-mono text-xs font-semibold tracking-wide">..</span>
                                          <span className="text-[11px] text-muted-foreground/60 hidden sm:inline font-normal">({t('fp_parent_dir')})</span>
                                        </div>
                                      ) : (
                                        <>
                                          {openingLocalPath === file.path ? (
                                            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                                          ) : (
                                            renderFileIcon(file, "h-4.5 w-4.5")
                                          )}
                                          {renameTarget && renameTarget.path === file.path ? (
                                            <InlineRenameInput
                                              value={renameValue}
                                              onChange={setRenameValue}
                                              onCommit={() => { if (renameSide === 'local') void handleRenameLocal(); else void handleRenameRemote(); }}
                                              onCancel={() => { setRenameTarget(null); setRenameValue('') }}
                                            />
                                          ) : (
                                            <span className={cn(
                                              "truncate tracking-tight",
                                              file.isDirectory
                                                ? "font-medium text-foreground"
                                                : !isSelected && "text-foreground/80",
                                              isSelected && "font-semibold text-foreground"
                                            )}>
                                              {file.name}
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  <span className="truncate text-left text-[11px] text-muted-foreground font-mono tabular-nums pl-3">
                                    {file.name === '..' ? (
                                      <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Kbd size="xs">Alt+↑</Kbd>
                                      </span>
                                    ) : (file.isDirectory ? <span className="text-[10px] text-muted-foreground/40 font-sans uppercase">dir</span> : formatFileSize(file.size))}
                                  </span>
                                  <span className="text-left text-[11px] text-muted-foreground font-mono truncate pl-3">
                                    {file.name === '..' ? '' : t(getFileTypeLabel(file))}
                                  </span>
                                  <span className="text-left text-[11px] text-muted-foreground font-mono truncate pl-3">
                                    {file.name === '..' ? '' : (leftSideType === 'remote' ? ((file as unknown as FileEntry).modifiedTime || '-') : (file.modified || '-'))}
                                  </span>
                                  {leftSideType === 'remote' && (
                                    <>
                                      <span className="text-left text-[11px] text-muted-foreground font-mono truncate pl-3">
                                        {file.name === '..' ? '' : ((file as unknown as FileEntry).permissions || '-')}
                                      </span>
                                      <span className="text-left text-[11px] text-muted-foreground font-mono truncate pl-3">
                                        {file.name === '..' ? '' : ((file as unknown as FileEntry).owner || ((file as unknown as FileEntry).uid === 0 ? 'root' : ((file as unknown as FileEntry).uid != null ? String((file as unknown as FileEntry).uid) : '-')))}
                                      </span>
                                    </>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          renderLocalCards()
                        )}
                        {/* 框选矩形（client 坐标 fixed 定位，不拦截事件） */}
                        <MarqueeRect marquee={localMarquee} />
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-56">
                      {localContextMenuFile && localContextMenuFile.name !== '..' ? (
                        <>
                          {(() => {
                            // 多选场景判断：右键项属于多选集合时，重命名为单文件操作需隐藏
                            const isMulti = selectedLocalPaths.has(localContextMenuFile.path) && selectedLocalPaths.size > 1
                            // 可预览/编辑的文件（非目录、文本/图片/PDF/视频/音频）
                            const canPreview = !localContextMenuFile.isDirectory && !isMulti &&
                              getPreviewKind(localContextMenuFile.name) !== 'unsupported'
                            // 左侧也是远程服务器时，右键菜单对齐右侧（远程操作针对 leftServerId）
                            const isLeftRemote = leftSideType === 'remote' && !!leftServerId
                            // 左侧为远程时，localContextMenuFile 实际为 FileEntry
                            const leftRemoteFile = isLeftRemote ? (localContextMenuFile as unknown as FileEntry) : null
                            return (
                              <>
                                {isMulti && (
                                  <>
                                    <div className="px-2.5 py-1 text-[11px] font-medium text-muted-foreground/80 select-none">
                                      {t('fs_selected_n').replace('{n}', String(selectedLocalPaths.size))}
                                    </div>
                                    <ContextMenuSeparator />
                                  </>
                                )}
                                {canPreview && (
                                  <ContextMenuItem onClick={() => {
                                    if (localContextMenuFile) {
                                      // 左侧为远程服务器时，按远程文件预览（传 leftServerId）
                                      void openFileViewer(
                                        isLeftRemote ? 'remote' : 'local',
                                        localContextMenuFile,
                                        isLeftRemote ? leftServerId : undefined
                                      )
                                    }
                                  }}>
                                    <Eye className="mr-2 h-4 w-4 text-muted-foreground" />
                                    <span>{t('sftp_viewer_preview')}</span>
                                  </ContextMenuItem>
                                )}
                                <ContextMenuItem
                                  disabled={!selectedServerId}
                                  onClick={() => {
                                    if (!localContextMenuFile) return
                                    // 左侧也是远程服务器：走 s2s 传输
                                    if (isLeftRemote) {
                                      const files = isMulti
                                        ? localFiles.filter(f => selectedLocalPaths.has(f.path) && f.name !== '..')
                                        : [localContextMenuFile]
                                      if (files.length > 0) {
                                        void handleServerToServerTransfer(leftServerId, selectedServerId, remotePath, files as unknown as FileEntry[], remoteFiles)
                                      }
                                      return
                                    }
                                    // 若右键项属于多选集合，则上传所有选中；否则只上传该项
                                    if (isMulti) {
                                      handleUploadLocalPaths(selectedServerId, remotePath,
                                        Array.from(selectedLocalPaths).filter(p => !p.endsWith('/..') && p !== '..'),
                                        remoteFiles)
                                    } else {
                                      handleUploadLocalPaths(selectedServerId, remotePath, [localContextMenuFile.path], remoteFiles)
                                    }
                                  }}>
                                  <Upload className="mr-2 h-4 w-4 text-muted-foreground" />
                                  <span>{isMulti
                                    ? t('sftp_transfer_selected').replace('{n}', String(selectedLocalPaths.size))
                                    : t('sftp_transfer_to_target')}</span>
                                </ContextMenuItem>
                                {rightTabs.filter(t => t.serverId && t.path && (!isLeftRemote || t.serverId !== leftServerId)).length > 1 && (
                                <ContextMenuItem
                                  disabled={rightTabs.filter(t => t.serverId && t.path && (!isLeftRemote || t.serverId !== leftServerId)).length === 0}
                                  onClick={async () => {
                                    if (!localContextMenuFile) return
                                    // 收集所有已连接且有效的右侧会话（当前目录非空）
                                    const targets = rightTabs.filter(t => t.serverId && t.path && (!isLeftRemote || t.serverId !== leftServerId))
                                    if (targets.length === 0) return
                                    if (isLeftRemote) {
                                      // 左侧也是远程服务器：逐一对每个右侧会话串行发起 s2s 传输，隔离冲突检测与批次状态
                                      const files = isMulti
                                        ? localFiles.filter(f => selectedLocalPaths.has(f.path) && f.name !== '..')
                                        : [localContextMenuFile]
                                      if (files.length === 0) return
                                      for (const tab of targets) {
                                        if (tab.serverId && tab.serverId !== leftServerId) {
                                          try {
                                            // 实时拉取最新目标目录文件列表，杜绝后台标签使用陈旧快照导致的冲突漏检与静默覆盖
                                            let destFiles = (tab.id === activeRightTabId && rightSideType === 'remote') ? remoteFilesRef.current : tab.files
                                            try {
                                              const live = await sshService.listFiles(tab.serverId, tab.path)
                                              if (Array.isArray(live)) {
                                                destFiles = live
                                                setRightTabs(prev => prev.map(t => t.id === tab.id ? { ...t, files: live } : t))
                                              }
                                            } catch (e) {
                                              console.warn(`Failed to fetch live files for session ${tab.serverId}:`, e)
                                            }
                                            await handleServerToServerTransfer(leftServerId, tab.serverId, tab.path, files as unknown as FileEntry[], destFiles)
                                          } catch (err) {
                                            console.error(`s2s transfer to session ${tab.serverId} failed:`, err)
                                          }
                                        }
                                      }
                                    } else {
                                      // 左侧为本地：逐一对每个右侧会话串行上传，避免 transferBatchIdRef 碰撞导致静默跳过冲突文件
                                      const paths = isMulti
                                        ? Array.from(selectedLocalPaths).filter(p => !p.endsWith('/..') && p !== '..')
                                        : [localContextMenuFile.path]
                                      if (paths.length === 0) return
                                      for (const tab of targets) {
                                        if (tab.serverId) {
                                          try {
                                            // 实时拉取最新目标目录文件列表，杜绝后台标签使用陈旧快照导致的冲突漏检与静默覆盖
                                            let destFiles = (tab.id === activeRightTabId && rightSideType === 'remote') ? remoteFilesRef.current : tab.files
                                            try {
                                              const live = await sshService.listFiles(tab.serverId, tab.path)
                                              if (Array.isArray(live)) {
                                                destFiles = live
                                                setRightTabs(prev => prev.map(t => t.id === tab.id ? { ...t, files: live } : t))
                                              }
                                            } catch (e) {
                                              console.warn(`Failed to fetch live files for session ${tab.serverId}:`, e)
                                            }
                                            await handleUploadLocalPaths(tab.serverId, tab.path, paths, destFiles)
                                          } catch (err) {
                                            console.error(`Upload to session ${tab.serverId} failed:`, err)
                                          }
                                        }
                                      }
                                    }
                                  }}>
                                  <UploadCloud className="mr-2 h-4 w-4 text-muted-foreground" />
                                  <span>{t('sftp_transfer_to_all_right')}</span>
                                </ContextMenuItem>
                                )}
                                <ContextMenuItem onClick={() => copyFilesToClipboard('local')}>
                                  <Copy className="mr-2 h-4 w-4 text-muted-foreground" />
                                  <span>{t('tm_copy')}</span>
                                  <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
                                </ContextMenuItem>
                                {/* 左侧为远程服务器：归档下载（仅目录、单选） */}
                                {!isMulti && isLeftRemote && leftRemoteFile && leftRemoteFile.isDirectory && (
                                  <ContextMenuSub>
                                    <ContextMenuSubTrigger>
                                      <ArchiveFileIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                                      <span>{t('sftp_download_archive')}</span>
                                    </ContextMenuSubTrigger>
                                    <ContextMenuSubContent className="w-48">
                                      {[
                                        { format: 'tar.gz' as const, label: 'tar.gz', desc: t('fs_format_gzip') },
                                        { format: 'tar.bz2' as const, label: 'tar.bz2', desc: t('fs_format_bzip2') },
                                        { format: 'tar.xz' as const, label: 'tar.xz', desc: t('fs_format_xz') },
                                        { format: 'zip' as const, label: 'zip', desc: t('fs_format_zip') },
                                        { format: 'tar' as const, label: 'tar', desc: t('fs_format_tar') },
                                      ].map((item) => (
                                        <ContextMenuItem
                                          key={item.format}
                                          onClick={() => {
                                            if (leftRemoteFile) handleDownloadArchive(leftRemoteFile, item.format, leftServerId)
                                          }}
                                        >
                                          <span>{item.label}</span>
                                          <span className="ml-auto text-[11px] text-muted-foreground/70">{item.desc}</span>
                                        </ContextMenuItem>
                                      ))}
                                    </ContextMenuSubContent>
                                  </ContextMenuSub>
                                )}
                                {!isMulti && !localContextMenuFile.isDirectory && isSupportedArchiveName(localContextMenuFile.name) && (
                                  <ContextMenuItem
                                    disabled={extractingArchivePath !== null}
                                    onClick={() => void handleExtractArchive(localContextMenuFile, isLeftRemote ? 'remote' : 'local', isLeftRemote ? leftServerId : undefined)}
                                  >
                                    {extractingArchivePath === localContextMenuFile.path
                                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin text-muted-foreground" />
                                      : <ArchiveFileIcon className="mr-2 h-4 w-4 text-muted-foreground" />}
                                    <span>{t('sftp_extract_archive')}</span>
                                  </ContextMenuItem>
                                )}
                                {!isMulti && (
                                  <ContextMenuItem onClick={() => {
                                    // 左侧为远程：走远程重命名（针对 leftServerId）
                                    setRenameSide(isLeftRemote ? 'remote' : 'local')
                                    if (isLeftRemote) setRenameServerId(leftServerId)
                                    setRenameTarget(localContextMenuFile)
                                    setRenameValue(localContextMenuFile.name)
                                  }}>
                                    <Edit2 className="mr-2 h-4 w-4 text-muted-foreground" />
                                    <span>{t('sftp_rename')}</span>
                                    <ContextMenuShortcut>F2</ContextMenuShortcut>
                                  </ContextMenuItem>
                                )}
                                <ContextMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onClick={() => {
                                  // 左侧为远程：走远程删除（针对 leftServerId）
                                  setDeleteSide(isLeftRemote ? 'remote' : 'local')
                                  if (isLeftRemote) setDeleteServerId(leftServerId)
                                  // 多选场景：收集所有选中路径（排除 '..'）
                                  if (isMulti) {
                                    const paths = Array.from(selectedLocalPaths).filter(p => !p.endsWith('/..') && p !== '..')
                                    setDeleteMultiPaths(paths)
                                    setDeleteTarget(localContextMenuFile)
                                  } else {
                                    setDeleteMultiPaths(null)
                                    setDeleteTarget(localContextMenuFile)
                                  }
                                }}>
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  <span>{isMulti
                                    ? t('sftp_delete_selected').replace('{n}', String(selectedLocalPaths.size))
                                    : t('sftp_delete')}</span>
                                  <ContextMenuShortcut>Del</ContextMenuShortcut>
                                </ContextMenuItem>
                                {/* 左侧为远程服务器：权限设置（仅单选，仅 Linux——Windows 无 POSIX 权限） */}
                                {!isMulti && isLeftRemote && leftRemoteFile && servers.find(s => s.id === toBaseServerId(leftServerId))?.targetType !== 'windows' && (
                                  <ContextMenuItem onClick={() => handleOpenPermissions(leftRemoteFile, leftServerId)}>
                                    <Shield className="mr-2 h-4 w-4 text-muted-foreground" />
                                    <span>{t('sftp_perm_title')}</span>
                                  </ContextMenuItem>
                                )}
                                {/* 左侧为远程服务器：复制远程路径（仅单选） */}
                                {!isMulti && isLeftRemote && (
                                  <ContextMenuItem onClick={() => {
                                    if (localContextMenuFile) {
                                      handleCopyRemotePath(localContextMenuFile.path)
                                    }
                                  }}>
                                    {copiedRemotePath
                                      ? <Check className="mr-2 h-4 w-4 text-green-500" />
                                      : <Copy className="mr-2 h-4 w-4 text-muted-foreground" />}
                                    <span>{copiedRemotePath ? t('sftp_copy_path_done') : t('sftp_copy_path')}</span>
                                  </ContextMenuItem>
                                )}
                                {!isMulti && localContextMenuFile?.isDirectory && (
                                  <ContextMenuItem onClick={() => {
                                    if (leftBookmarks.includes(localContextMenuFile.path)) {
                                      handleRemoveLeftBookmark(localContextMenuFile.path)
                                    } else {
                                      handleAddLeftBookmark(localContextMenuFile.path)
                                    }
                                  }}>
                                    <Bookmark className={cn(
                                      "mr-2 h-4 w-4",
                                      leftBookmarks.includes(localContextMenuFile.path)
                                        ? "fill-amber-500 text-amber-500"
                                        : "text-muted-foreground"
                                    )} />
                                    <span>
                                      {leftBookmarks.includes(localContextMenuFile.path)
                                        ? t('sftp_remove_current_bookmark')
                                        : t('sftp_add_bookmark')}
                                    </span>
                                  </ContextMenuItem>
                                )}
                              </>
                            )
                          })()}
                          <ContextMenuSeparator />
                        </>
                      ) : null}
                      <ContextMenuItem onClick={() => loadLocalDirectory(localPath, undefined, undefined, { isRefresh: true })}>
                        <RefreshCw className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span>{t('sftp_refresh')}</span>
                        <ContextMenuShortcut>F5</ContextMenuShortcut>
                      </ContextMenuItem>
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <Plus className="mr-2 h-4 w-4 text-muted-foreground" />
                          <span>{t('sftp_new')}</span>
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-52">
                          <ContextMenuItem onClick={() => {
                            setCreateFolderSide('local')
                            setShowCreateFolder(true)
                            setNewFolderName('')
                          }}>
                            <Folder className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span className="whitespace-nowrap">{t('sftp_new_folder')}</span>
                            <ContextMenuShortcut>Ctrl+Shift+N</ContextMenuShortcut>
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => {
                            setCreateFileSide('local')
                            setShowCreateFile(true)
                            setNewFileName('')
                          }}>
                            <File className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>{t('sftp_new_file')}</span>
                          </ContextMenuItem>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      <ContextMenuItem
                        disabled={!fileClipboardRef.current || fileClipboardRef.current.sourceSide !== 'remote' || !selectedServerId}
                        onClick={() => pasteFilesFromClipboard('local')}
                      >
                        <Copy className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span>{t('sftp_paste_here')}</span>
                        <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </div>
              )}
            </div>
          </div>
          </>
          )}
        </div>

        {/* Split Resize Handle */}
        <div 
          className="relative w-1 flex-shrink-0 flex items-center justify-center cursor-col-resize select-none group z-10 -mx-0.5" 
          onMouseDown={handleSplitResizeStart}
        >
          <div className="w-0.5 h-10 rounded-full bg-border/60 transition-all group-hover:h-16 group-hover:w-1 group-hover:bg-primary/70 group-active:bg-primary" />
        </div>

        {/* ─── 右栏：远程服务器 SFTP 浏览器 ──────────────────────────────────────── */}
        <div
          className="flex flex-col h-full overflow-hidden bg-card/95 rounded-xl border border-border/70 shadow-sm relative flex-1 min-w-0"
        >
          {/* ─── 右侧多标签栏（合并原标签栏 + 顶部标题行）───
              每个标签 = OsIcon + 服务器名 + 状态图标 + 关闭按钮
              未连接时在右侧显示主机搜索框 */}
          <div className="flex items-center gap-1.5 px-2.5 h-10 border-b border-border/70 bg-muted/15 select-none flex-shrink-0">
            {rightTabs.length === 0 ? (
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground flex-shrink-0 px-1">
                <Server className="h-4 w-4 text-primary shrink-0" />
                <span>{t('sftp_remote_server')}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0 py-1">
                {rightTabs.map((tab) => {
                  const isActive = tab.id === activeRightTabId
                  const isConnecting = !!tab.connectingId
                  const isLoading = tab.loading
                  const srvId = tab.serverId ? toBaseServerId(tab.serverId) : null
                  const srv = srvId ? servers.find(s => s.id === srvId) : null
                  return (
                    <div
                      key={tab.id}
                      onClick={() => switchToRightTab(tab.id)}
                      className={cn(
                        "theme-tab-item group relative flex items-center gap-1.5 pl-2.5 pr-2 h-7.5 text-xs cursor-pointer select-none flex-shrink-0 mx-0.5",
                        isActive && "is-active",
                      )}
                      title={tab.serverName || (tab.serverId ? tab.serverId : t('sftp_new_tab'))}
                    >

                      {isConnecting || isLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0 text-primary" />
                      ) : tab.disconnected ? (
                        <div className="relative flex items-center justify-center shrink-0">
                          <OsIcon osType={srv?.osType} osInfo={srv?.osInfo} targetType={srv?.targetType} className="h-4 w-4 rounded-md flex-shrink-0 opacity-60" />
                          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 ring-1 ring-background" title={t('sftp_offline_badge')} />
                        </div>
                      ) : tab.serverId ? (
                        <OsIcon osType={srv?.osType} osInfo={srv?.osInfo} targetType={srv?.targetType} className="h-4 w-4 rounded-md flex-shrink-0" />
                      ) : (
                        <Server className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/50" />
                      )}
                      <span className={cn(
                        "max-w-[140px] truncate transition-colors",
                        isActive ? "text-foreground font-semibold" : "text-muted-foreground group-hover:text-foreground font-normal"
                      )}>
                        {tab.serverName || (tab.serverId ? tab.serverId : t('sftp_new_tab'))}
                        {tab.disconnected ? ` (${t('sftp_offline_badge')})` : ''}
                      </span>
                      {/* 状态图标：同步浏览 */}
                      {tab.syncBrowsing && (
                        <Link className="h-2.5 w-2.5 text-primary flex-shrink-0" aria-label="sync" />
                      )}
                      {/* 状态图标：目录比较 */}
                      {tab.compareActive && (
                        <ArrowLeftRight className="h-2.5 w-2.5 text-primary flex-shrink-0" aria-label="compare" />
                      )}
                      {/* 关闭按钮 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (tab.serverId || tab.connectingId) {
                            // 已勾选「不再提醒」时直接断开，否则弹二次确认
                            if (isConfirmSuppressed('sftp-close-server')) {
                              void closeRightTab(tab.id)
                            } else {
                              setCloseServerDontAskAgain(false)
                              setPendingCloseServerId(tab.id)
                            }
                          } else {
                            void closeRightTab(tab.id)
                          }
                        }}
                        onMouseDown={(e) => {
                          if (e.button === 1) {
                            e.preventDefault()
                            e.stopPropagation()
                            if (tab.serverId || tab.connectingId) {
                              if (isConfirmSuppressed('sftp-close-server')) {
                                void closeRightTab(tab.id)
                              } else {
                                setCloseServerDontAskAgain(false)
                                setPendingCloseServerId(tab.id)
                              }
                            } else {
                              void closeRightTab(tab.id)
                            }
                          }
                        }}
                        className={cn(
                          "ml-0.5 p-0.5 rounded hover:bg-destructive/15 hover:text-destructive transition-colors flex-shrink-0",
                          isActive ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60 hover:!opacity-100"
                        )}
                        title={t('tb_close')}
                        aria-label={t('tb_close')}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )
                })}
                {/* 新建标签按钮 */}
                {rightTabs.length < MAX_RIGHT_TABS && (
                  <button
                    onClick={() => createRightTab()}
                    className="ml-1 h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-background/70 transition-colors flex-shrink-0 cursor-pointer"
                    title={t('sftp_new_tab')}
                    aria-label={t('sftp_new_tab')}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}

            {/* 未连接时显示主机搜索框（右侧） */}
            {!selectedServerId && !connectingServerId && (
              <div className="relative w-44 flex-shrink-0 ml-auto">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/60" />
                <Input
                  type="text"
                  placeholder={t('sftp_search_hosts_placeholder')}
                  value={rightHostSearch}
                  onChange={(e) => setRightHostSearch(e.target.value)}
                  className="pl-7 pr-6 h-7 text-xs bg-background border-border/50 focus-visible:ring-1 focus-visible:ring-primary rounded-md"
                />
                {rightHostSearch && (
                  <button
                    onClick={() => setRightHostSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
          
          {/* 情况 A：未选择/未连接服务器 */}
          {!selectedServerId && !connectingServerId && (
            <div className="flex-1 flex flex-col h-full bg-transparent px-6 pt-5 overflow-hidden">


              {/* 标签过滤?*/}
              {(serverGroups.length > 0 || allTags.length > 0) && (
                <div className="flex items-center gap-1.5 flex-wrap mb-4 px-1 flex-shrink-0">
                  {serverGroups.length > 0 && (
                    <>
                      <GroupFilterChip
                        groups={serverGroups}
                        value={rightGroupFilter}
                        onChange={setRightGroupFilter}
                        counts={rightGroupFilterCounts.counts}
                        ungroupedCount={rightGroupFilterCounts.ungrouped}
                      />
                      {allTags.length > 0 && <span className="w-px h-3.5 bg-border/60 mx-0.5" />}
                    </>
                  )}
                  {allTags.length > 0 && (
                    <>
                      <span className="text-[11px] text-muted-foreground mr-1">{t('dashboard_filter_tags')}:</span>
                      <button
                        onClick={() => setRightTagFilter(null)}
                        className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer
                          ${rightTagFilter === null ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}
                      >
                        {t('dashboard_filter_all')}
                      </button>
                      {allTags.map((tag) => (
                        <button
                          key={tag}
                          onClick={() => setRightTagFilter(rightTagFilter === tag ? null : tag)}
                          className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer
                            ${rightTagFilter === tag ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary hover:bg-primary/20'}`}
                        >
                          {tag}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* 批量操作工具条：全选 / 已选计数 / 一键连接 */}
              {(() => {
                const selectableRightServers = rightFilteredServers.filter(s => !connectedServerIds.has(s.id))
                const visibleSelectedServers = selectableRightServers.filter(s => batchSelectedServerIds.has(s.id))
                const visibleCount = visibleSelectedServers.length
                const allChecked = selectableRightServers.length > 0 && selectableRightServers.every(s => batchSelectedServerIds.has(s.id))

                return (
                  <div className="flex items-center justify-between gap-2 mb-2 px-1 flex-shrink-0 min-h-[28px]">
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs font-normal text-muted-foreground hover:text-foreground cursor-pointer"
                        onClick={() => {
                          if (allChecked) {
                            setBatchSelectedServerIds(new Set())
                          } else {
                            setBatchSelectedServerIds(new Set(selectableRightServers.map(s => s.id)))
                          }
                        }}
                      >
                        {allChecked ? t('sftp_deselect_all') : t('sftp_select_all')}
                      </Button>
                      {visibleCount > 0 && (
                        <span className="text-xs text-muted-foreground font-mono">
                          {t('sftp_selected_count', { count: visibleCount })}
                        </span>
                      )}
                    </div>
                    {visibleCount > 0 && (
                      <Button
                        size="sm"
                        className="h-6 text-xs gap-1.5 px-3 cursor-pointer animate-in fade-in-50 duration-150"
                        onClick={() => {
                          const ids = visibleSelectedServers.map(s => s.id)
                          setBatchSelectedServerIds(new Set())
                          void handleBatchConnectServers(ids)
                        }}
                      >
                        <ArrowLeftRight className="h-3.5 w-3.5" />
                        <span>{t('sftp_batch_open')} ({visibleCount})</span>
                      </Button>
                    )}
                  </div>
                )
              })()}

              {/* 主机列表 */}
              <div className="flex-1 flex flex-col overflow-hidden">
                <ScrollArea className="flex-1 -mx-2 px-2">
                  <div className="flex flex-col gap-1 pb-1">
                    {rightFilteredServers.map((s) => {
                      const isConnected = connectedServerIds.has(s.id)
                      const isChecked = batchSelectedServerIds.has(s.id)
                      return (
                      <div
                        key={s.id}
                        onClick={() => {
                          if (!isConnected) {
                            setBatchSelectedServerIds(prev => {
                              const next = new Set(prev)
                              if (next.has(s.id)) next.delete(s.id)
                              else next.add(s.id)
                              return next
                            })
                          }
                        }}
                        onDoubleClick={() => {
                          if (!isConnected) {
                            handleConnectServer(s.id)
                          }
                        }}
                        className={cn(
                          "flex items-center gap-3.5 p-3 rounded-xl border transition-all select-none",
                          isConnected
                            ? "opacity-50 cursor-not-allowed border-border/20 bg-muted/30"
                            : isChecked
                              ? "bg-primary/10 border-primary/40 hover:bg-primary/15 cursor-pointer"
                              : "hover:bg-accent/40 border-transparent hover:border-border/30 cursor-pointer group"
                        )}
                      >
                        {/* 复选框：直接呈现 */}
                        <div
                          className={cn(
                            "w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0",
                            isConnected
                              ? "border-border/30 bg-muted/30 cursor-not-allowed opacity-40"
                              : isChecked
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border/60 group-hover:border-primary/60 bg-card"
                          )}
                        >
                          {isChecked && <Check className="h-3 w-3 text-primary-foreground stroke-[3]" />}
                        </div>
                        <OsIcon osType={s.osType} osInfo={s.osInfo} targetType={s.targetType} className="h-9 w-9 rounded-md overflow-hidden shadow-md flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className={cn("font-semibold text-sm truncate", isConnected ? "text-muted-foreground" : isChecked ? "text-primary" : "text-foreground group-hover:text-primary transition-colors")}>
                            {s.name || s.host}
                          </div>
                          <div className="text-xs text-muted-foreground truncate mt-0.5 font-medium">
                            {s.host} &bull; ssh, {s.username}:{s.port}
                          </div>
                        </div>
                        {isConnected
                          ? <span className="text-[10px] text-muted-foreground/70 px-2 py-0.5 rounded bg-muted/60 flex-shrink-0">已连接</span>
                          : <ChevronRight className="h-4 w-4 text-muted-foreground/45 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />}
                      </div>
                      )
                    })}
                    {rightFilteredServers.length === 0 && (
                      <div className="text-center py-12 text-muted-foreground flex flex-col items-center justify-center gap-2">
                        <Search className="h-8 w-8 text-muted-foreground/35" />
                        <span className="text-xs">{t('sftp_no_hosts_found')}</span>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}

          {/* 情况 B：正在连接加载服务器（仅在尚未进入服务器工作区时显示） */}
          {!selectedServerId && connectingServerId && (
            <div className="flex-1 flex flex-col items-center justify-center bg-transparent p-6 select-none">
              <QshellLoader size="lg" text={t('sftp_connecting') || 'Connecting...'} />

              <p className="text-[10px] text-muted-foreground font-mono">
                {servers.find(s => s.id === toBaseServerId(connectingServerId))?.name}
              </p>
            </div>
          )}

          {/* 情况 C：已连接，渲染远程文件结?*/}
          {selectedServerId && (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              
              {/* 远程头部导航 */}
              <div className="p-3 border-b flex-shrink-0 flex flex-col gap-2 bg-muted/5">
                {/* Windows 磁盘切换栏 */}
                {remoteDrives.length > 0 && (
                  <div className="flex items-center gap-1 flex-shrink-0 overflow-x-auto no-scrollbar">
                    <HardDrive className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    {remoteDrives.map(drive => {
                      const letter = drive.charAt(0).toUpperCase()
                      // 使用 POSIX 形式 /C:/ 保持与 home 目录和导航路径形式一致
                      // 后端 files_list 会将 /C:/ 经 posix_to_windows_path 转为 C:\
                      const drivePath = `/${letter}:/`
                      const isActive = remotePath.toUpperCase().startsWith(`/${letter}:`)
                      return (
                        <button
                          key={drive}
                          onClick={() => {
                            if (isRemoteDisconnected) {
                              toastRef.current.warning(tRef.current('sftp_offline_readonly_tip'))
                              return
                            }
                            loadRemoteDirectory(selectedServerId, drivePath)
                          }}
                          className={cn(
                            "px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors flex-shrink-0",
                            isActive
                              ? "bg-primary/15 text-primary font-semibold"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground"
                          )}
                          title={drivePath}
                        >
                          {letter}:
                        </button>
                      )
                    })}
                  </div>
                )}
                <div className="flex items-center gap-1.5 overflow-hidden">

                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!getParentPath(remotePath)}
                    onClick={() => {
                      if (isRemoteDisconnected) {
                        toastRef.current.warning(tRef.current('sftp_offline_readonly_tip'))
                        return
                      }
                      const parent = getParentPath(remotePath)
                      if (parent) loadRemoteDirectory(selectedServerId, parent)
                    }}
                    className="h-7 w-7 flex-shrink-0"
                    aria-label={t('sftp_go_up') || 'Go up'}
                  >
                    <FolderUp className="h-4 w-4" />
                  </Button>

                  {/* 远程路径面包屑 */}
                  {remotePathEditing ? (
                    <input
                      ref={(el) => {
                        if (el) {
                          setTimeout(() => {
                            el.focus()
                            el.select()
                          }, 0)
                        }
                      }}
                      autoFocus
                      value={remotePathInput}
                      onChange={(e) => setRemotePathInput(e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onBlur={commitRemotePathEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); commitRemotePathEdit() }
                        else if (e.key === 'Escape') { e.preventDefault(); setRemotePathEditing(false) }
                      }}
                      className="flex-1 h-7 px-2 text-xs font-mono bg-background border border-primary/50 focus-visible:ring-1 focus-visible:ring-primary rounded-md outline-none"
                      placeholder={t('sftp_path_goto')}
                    />
                  ) : (
                    <SftpBreadcrumbBar
                      crumbs={remoteBreadcrumbs}
                      onNavigate={(path) => {
                        if (isRemoteDisconnected) {
                          toastRef.current.warning(tRef.current('sftp_offline_readonly_tip'))
                          return
                        }
                        loadRemoteDirectory(selectedServerId, path)
                      }}
                      onDoubleClick={startRemotePathEdit}
                      title={t('sftp_path_goto')}
                    />
                  )}

                  {/* 远程路径收藏 */}
                  <SftpBookmarkDropdown
                    currentPath={remotePath}
                    bookmarks={remoteBookmarks}
                    onAddBookmark={handleAddRemoteBookmark}
                    onRemoveBookmark={handleRemoveRemoteBookmark}
                    onNavigate={(path) => {
                      if (isRemoteDisconnected) {
                        toastRef.current.warning(tRef.current('sftp_offline_readonly_tip'))
                        return
                      }
                      loadRemoteDirectory(selectedServerId, path)
                    }}
                    disabled={!selectedServerId || !remotePath || remoteLoading}
                    t={t}
                  />

                  {/* 文件搜索（路径之后，刷新之前） */}
                  <div className="relative w-40 flex-shrink-0">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/60" />
                    <Input
                      type="text"
                      placeholder={
                        searchMode === 'recursive'
                          ? (t('sftp_recursive_search') || 'Recursive search...')
                          : (t('sftp_search_remote_placeholder') || 'Search...')
                      }
                      value={searchMode === 'recursive' ? recursiveSearchPattern : remoteSearch}
                      onChange={(e) => {
                        if (searchMode === 'recursive') {
                          setRecursiveSearchPattern(e.target.value)
                        } else {
                          setRemoteSearch(e.target.value)
                        }
                      }}
                      className={cn(
                        "pl-7 pr-12 h-7 text-xs bg-background border-border/50 focus-visible:ring-1 focus-visible:ring-primary rounded-md",
                        searchMode === 'recursive' && "border-primary/60 ring-1 ring-primary/30"
                      )}
                    />
                    {/* 递归搜索模式切换按钮 */}
                    <button
                      onClick={() => {
                        const next = searchMode === 'recursive' ? 'filter' : 'recursive'
                        setSearchMode(next)
                        if (next === 'filter') {
                          setRecursiveSearchPattern('')
                          setSearchResults([])
                          setRecursiveSearching(false)
                        } else {
                          setRemoteSearch('')
                        }
                      }}
                      title={t('sftp_search_in_dir') || 'Search in this directory'}
                      className={cn(
                        "absolute right-5 top-1/2 -translate-y-1/2 transition-colors",
                        searchMode === 'recursive'
                          ? "text-primary"
                          : "text-muted-foreground/60 hover:text-foreground"
                      )}
                    >
                      <Search className="h-3 w-3" />
                    </button>
                    {/* 清空按钮 */}
                    {((searchMode === 'filter' && remoteSearch) ||
                      (searchMode === 'recursive' && recursiveSearchPattern)) && (
                      <button
                        onClick={() => {
                          if (searchMode === 'recursive') {
                            setRecursiveSearchPattern('')
                            setSearchResults([])
                          } else {
                            setRemoteSearch('')
                          }
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                    {/* 递归搜索结果浮层 */}
                    {searchMode === 'recursive' && (
                      <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-background border border-border rounded-md shadow-lg max-h-72 overflow-y-auto">
                        {recursiveSearching && (
                          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {t('sftp_searching') || 'Searching...'}
                          </div>
                        )}
                        {!recursiveSearching && searchResults.length === 0 && recursiveSearchPattern.trim() && (
                          <div className="px-3 py-2 text-xs text-muted-foreground">
                            {t('sftp_no_search_results') || 'No results'}
                          </div>
                        )}
                        {!recursiveSearching && searchResults.length > 0 && (
                          <>
                            <div className="px-3 py-1 text-[10px] text-muted-foreground border-b border-border/50 sticky top-0 bg-background">
                              {t('sftp_search_results').replace('{n}', String(searchResults.length))}
                            </div>
                            {searchResults.map((r) => (
                              <button
                                key={r.path}
                                onClick={() => handleSearchResultClick(r)}
                                className="w-full flex flex-col items-start px-3 py-1.5 text-xs hover:bg-accent transition-colors text-left"
                                title={r.path}
                              >
                                <span className="truncate w-full font-medium">{r.name}</span>
                                <span className="truncate w-full text-[10px] text-muted-foreground/80">{r.parentDir}</span>
                              </button>
                            ))}
                          </>
                        )}
                        {!recursiveSearching && !recursiveSearchPattern.trim() && (
                          <div className="px-3 py-2 text-xs text-muted-foreground">
                            {t('sftp_search_in_dir') || 'Search in this directory'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {connectedServer?.targetType === 'windows' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleDiagnoseSftp}
                      disabled={diagnosingSftp}
                      className="h-7 w-7 flex-shrink-0"
                      title={t('sftp_diag_title')}
                      aria-label={t('sftp_diag_title')}
                    >
                      {diagnosingSftp ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertCircle className="h-4 w-4" />}
                    </Button>
                  )}
                  <SftpActionsDropdown
                    viewMode={rightViewMode}
                    onViewModeChange={handleSetRightViewMode}
                    showHidden={rightShowHidden}
                    onToggleShowHidden={() => setRightShowHidden(v => !v)}
                    onRefresh={() => {
                      if (isRemoteDisconnected) {
                        handleReconnectServer()
                      } else if (selectedServerId) {
                        loadRemoteDirectory(selectedServerId, remotePath)
                      }
                    }}
                    onNewFolder={() => {
                      setCreateFolderSide('remote')
                      setNewFolderName('')
                      setShowCreateFolder(true)
                    }}
                    onNewFile={() => {
                      setCreateFileSide('remote')
                      setNewFileName('')
                      setShowCreateFile(true)
                    }}
                    onSelectAll={handleSelectAllRemote}
                    onTransfer={handleDownloadSelected}
                    onDelete={() => triggerDelete('remote')}
                    canTransfer={selectedRemotePaths.size > 0 && Array.from(selectedRemotePaths).some(p => !p.endsWith('/..') && p !== '..')}
                    canDelete={selectedRemotePaths.size > 0 && Array.from(selectedRemotePaths).some(p => !p.endsWith('/..') && p !== '..')}
                    transferLabel={
                      selectedRemotePaths.size > 1
                        ? t('sftp_transfer_selected').replace('{n}', String(selectedRemotePaths.size))
                        : (t('sftp_transfer_to_target') || 'Transfer')
                    }
                    transferIcon={<ArrowLeft className="mr-2 h-3.5 w-3.5 text-muted-foreground" />}
                    loading={remoteLoading}
                    syncBrowsing={syncBrowsing}
                    onToggleSyncBrowsing={toggleSyncBrowsing}
                    compareActive={compareActive}
                    onToggleCompareActive={() => setCompareActive(!compareActive)}
                    t={t}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      if (isRemoteDisconnected) {
                        handleReconnectServer()
                      } else {
                        loadRemoteDirectory(selectedServerId, remotePath)
                      }
                    }}
                    disabled={remoteLoading}
                    className="h-7 w-7 flex-shrink-0"
                    aria-label={t('sftp_refresh') || 'Refresh'}
                  >
                    <RefreshCw className={cn("h-4 w-4", remoteLoading && "animate-spin")} />
                  </Button>

                </div>

              </div>

              {/* 断网重连横幅（对标 WinSCP / Termius） */}
              {isRemoteDisconnected && (
                <div className="flex items-center justify-between gap-3 px-3 py-2 bg-amber-500/10 dark:bg-amber-500/15 border-b border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs flex-shrink-0 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2 min-w-0">
                    <WifiOff className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    {reconnectState.status === 'countdown' ? (
                      <>
                        <span className="font-medium truncate">
                          {t('reconnect_retrying')
                            .replace('{attempt}', String(reconnectState.attempt))
                            .replace('{max}', String(reconnectState.maxAttempts))}
                        </span>
                        <span className="text-[11px] font-mono opacity-80 shrink-0">
                          ({t('reconnect_countdown').replace('{sec}', String(reconnectState.remainingSec))})
                        </span>
                      </>
                    ) : reconnectState.status === 'exhausted' ? (
                      <span className="font-medium truncate text-destructive dark:text-red-400">
                        {t('reconnect_exhausted')}
                      </span>
                    ) : (
                      <span className="font-medium truncate">
                        {t('sftp_conn_lost_banner')}
                      </span>
                    )}
                    {remoteDisconnectedError && reconnectState.status !== 'countdown' && (
                      <span className="text-[11px] text-muted-foreground truncate hidden sm:inline" title={remoteDisconnectedError}>
                        ({remoteDisconnectedError})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {transferRecords.some(r => r.status === 'failed' && r.resumable && (!selectedServerId || r.serverId === selectedServerId)) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleResumeAllFailedTransfers}
                        className="h-6 px-2 text-[11px] border-amber-500/30 hover:bg-amber-500/10 text-amber-800 dark:text-amber-300 cursor-pointer"
                      >
                        {t('sftp_resume_all_transfers')}
                      </Button>
                    )}
                    {reconnectState.status === 'countdown' ? (
                      <>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleReconnectServer()}
                          className="h-6 px-2.5 text-[11px] font-medium gap-1 cursor-pointer bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-600 dark:text-zinc-950"
                        >
                          <RefreshCw className="h-3 w-3" />
                          <span>{t('reconnect_now')}</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => selectedServerId && reconnectManager.cancelRetry(selectedServerId)}
                          className="h-6 px-2 text-[11px] border-amber-500/30 hover:bg-amber-500/10 cursor-pointer"
                        >
                          {t('reconnect_cancel')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="default"
                        disabled={isReconnecting || reconnectState.status === 'reconnecting'}
                        onClick={() => handleReconnectServer()}
                        className="h-6 px-2.5 text-[11px] font-medium gap-1 cursor-pointer bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-600 dark:text-zinc-950"
                      >
                        {isReconnecting || reconnectState.status === 'reconnecting' ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>
                              {reconnectState.attempt > 0
                                ? t('reconnect_retrying')
                                    .replace('{attempt}', String(reconnectState.attempt))
                                    .replace('{max}', String(reconnectState.maxAttempts))
                                : t('sftp_reconnecting')}
                            </span>
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-3 w-3" />
                            <span>{t('sftp_reconnect_btn')}</span>
                          </>
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleExitDisconnectedServer}
                      className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {t('sftp_exit_to_server_list')}
                    </Button>
                  </div>
                </div>
              )}

              {/* 远程文件列表 */}
              <div className="flex-1 flex flex-col h-full overflow-hidden relative">
                {remoteLoading && remoteFiles.length === 0 ? (
                  <div className="flex-1 overflow-hidden p-2">
                    <FileSkeletonList viewMode={rightViewMode} count={8} />
                  </div>
                ) : remoteError && !isRemoteDisconnected && remoteFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                    <p className="text-xs text-destructive mb-2">{remoteError}</p>
                    <Button size="sm" variant="outline" onClick={() => loadRemoteDirectory(selectedServerId, remotePath)}>
                      {t('sftp_retry')}
                    </Button>
                  </div>
                ) : (
                  <div className={cn("flex-1 flex flex-col overflow-hidden", isRemoteDisconnected && "opacity-85")}>
                    {/* 表头（仅列表模式展示） */}
                    {rightViewMode === 'list' && (
                      <div className="grid grid-cols-[2.5fr_0.8fr_1fr_1.5fr_1.2fr_1fr] px-4 border-b border-border/50 bg-muted/20 text-[10px] text-muted-foreground/80 font-semibold select-none items-stretch h-7 flex-shrink-0 tracking-wider uppercase">
                        <button 
                          onClick={() => handleRemoteSort('name')}
                          className="flex items-center gap-1 hover:text-foreground text-left cursor-pointer font-medium tracking-wider pr-3 h-full transition-colors"
                        >
                          <span>{t('sftp_col_name')}</span>
                          {remoteSortField === 'name' && (
                            remoteSortOrder === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />
                          )}
                        </button>
                        <button 
                          onClick={() => handleRemoteSort('size')}
                          className="flex items-center justify-start gap-1 hover:text-foreground text-left cursor-pointer font-medium tracking-wider pl-3 pr-3 h-full transition-colors"
                        >
                          <span>{t('sftp_col_size')}</span>
                          {remoteSortField === 'size' && (
                            remoteSortOrder === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />
                          )}
                        </button>
                        <span className="text-left pl-3 pr-3 h-full flex items-center justify-start font-medium tracking-wider">{t('sftp_col_type') || 'Type'}</span>
                        <button 
                          onClick={() => handleRemoteSort('modified')}
                          className="flex items-center justify-start gap-1 hover:text-foreground text-left cursor-pointer font-medium tracking-wider pl-3 pr-3 h-full transition-colors"
                        >
                          <span>{t('sftp_col_modified')}</span>
                          {remoteSortField === 'modified' && (
                            remoteSortOrder === 'asc' ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />
                          )}
                        </button>
                        <span className="text-left pl-3 pr-3 h-full flex items-center justify-start font-medium tracking-wider">{t('sftp_col_permissions')}</span>
                        <span className="text-left pl-3 pr-3 h-full flex items-center justify-start font-medium tracking-wider">{t('sftp_col_owner') || 'Owner'}</span>
                      </div>
                    )}

                    {/* 远程进度条 */}
                    {remoteLoading && (
                      <div className="h-0.5 w-full bg-primary/20 overflow-hidden relative flex-shrink-0">
                        <div className="h-full bg-primary animate-pulse w-full" />
                      </div>
                    )}

                    {/* 滚动区 */}
                    <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div
                        ref={remoteListRef}
                        data-panel="remote"
                        tabIndex={0}
                        onFocus={() => setActivePanel('remote')}
                        onBlur={() => setActivePanel(prev => prev === 'remote' ? null : prev)}
                        onScroll={clearCardHover}
                        className={cn(
                          "flex-1 overflow-auto transition-all duration-200 outline-none",
                          isDraggingOverRemote && "bg-primary/5 ring-2 ring-primary/40 ring-dashed",
                          activePanel === 'remote' && !isDraggingOverRemote && "ring-1 ring-primary/20",
                          ""
                        )}
                        onMouseDown={(e) => {
                          const target = e.target as HTMLElement
                          if (target.closest('[data-drag-handle="true"]')) return
                          const row = target.closest('[data-file-row="remote"]') as HTMLElement | null
                          const path = row?.dataset.filePath
                          // 点击在已选中的行/卡片上时交给多选拖拽，不启动框选！
                          if (path && selectedRemotePaths.has(path)) return
                          handleRemoteMarqueeMouseDown(e)
                        }}
                        onClick={(e) => {
                          if (justDraggedRef.current) { justDraggedRef.current = false; return }
                          if (consumeRemoteMarqueeClick()) return
                          if ((e.target as HTMLElement).closest('[data-file-row="remote"]')) return
                          setSelectedRemotePaths(new Set())
                        }}
                        onContextMenu={(e) => {
                          if (!(e.target as HTMLElement).closest('[data-file-row="remote"]')) {
                            setRemoteContextMenuFile(null)
                          }
                        }}
                      >
                        {filteredRemoteFiles.length === 0 ? (
                          <div className="py-12 text-center text-xs text-muted-foreground select-none">
                            {remoteLoading
                              ? t('sftp_loading_remote')
                              : remoteError
                                ? t('sftp_load_failed_retry')
                                : remoteSearch.trim()
                                  ? t('sftp_no_matching_files')
                                  : t('sftp_no_remote_files')}
                          </div>
                        ) : rightViewMode === 'list' ? (
                          <div
                            style={{
                              height: `${remoteVirtualizer.getTotalSize()}px`,
                              width: '100%',
                              position: 'relative',
                            }}
                          >
                            {remoteVirtualizer.getVirtualItems().map((virtualItem) => {
                              const file = filteredRemoteFiles[virtualItem.index]
                              const isSelected = selectedRemotePaths.has(file.path)
                              return (
                                <div
                                  key={file.path}
                                  data-file-row="remote"
                                  data-file-path={file.name === '..' ? undefined : file.path}
                                  style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: `${virtualItem.size}px`,
                                    transform: `translateY(${virtualItem.start}px)`,
                                  }}
                                  onPointerDown={(e) => {
                                    if (e.button !== 0 || file.name === '..') return
                                    const isSelected = selectedRemotePaths.has(file.path)
                                    // 已选中：点击已选行的任意区域（或手柄）都可以启动拖拽多选文件！
                                    // 未选中：必须点击在手柄（图标或文件名）上才视为单文件拖拽，属性列留给框选
                                    if (!isSelected && !(e.target as HTMLElement).closest('[data-drag-handle="true"]')) return
                                    const files = isSelected
                                      ? remoteFiles.filter(f => selectedRemotePaths.has(f.path))
                                      : [file]
                                    dragPointerRef.current = { source: 'remote', files, startX: e.clientX, startY: e.clientY }
                                  }}
                                  onDoubleClick={() => {
                                     dblClickedRef.current = true
                                     if (file.isDirectory) {
                                       if (isRemoteDisconnected) {
                                         toastRef.current.warning(tRef.current('sftp_offline_readonly_tip'))
                                         return
                                       }
                                       loadRemoteDirectory(selectedServerId, file.path)
                                       setSelectedRemotePaths(new Set())
                                     } else {
                                       if (leftSideType === 'remote' && leftServerId) {
                                         void handleServerToServerTransfer(selectedServerId, leftServerId, localPath, [file], localFiles)
                                       } else {
                                         handleDownloadFile(file)
                                       }
                                     }
                                   }}
                                  onMouseDown={(e) => {
                                    if (e.button !== 0 && e.button !== 2) return
                                    // 每次交互（mousedown）开始时清除双击标志，避免上一次双击遗留的 true 误杀本次重命名
                                    dblClickedRef.current = false
                                    // 内联重命名进行中：点击当前行不触发选中/重命名逻辑，交由输入框处理
                                    if (renameTarget && renameTarget.path === file.path) return
                                    // 跳过 ".." 项的可选择行为（允许导航但不进入选中集合）
                                    const isParent = file.name === '..'
                                    // 记录点击前是否已选中：用于「再次点击重命名」
                                    const wasSelected = selectedRemotePaths.has(file.path)
                                    const currentIndex = virtualItem.index
                                    const newSet = new Set(selectedRemotePaths)
                                    if (e.shiftKey && !isParent && lastSelectedRemoteIndexRef.current >= 0) {
                                      // Shift 范围选择：从锚点索引到当前索引（跳过 ".."）
                                      const start = Math.min(lastSelectedRemoteIndexRef.current, currentIndex)
                                      const end = Math.max(lastSelectedRemoteIndexRef.current, currentIndex)
                                      for (let i = start; i <= end; i++) {
                                        const f = filteredRemoteFiles[i]
                                        if (f && f.name !== '..') newSet.add(f.path)
                                      }
                                    } else if (e.ctrlKey || e.metaKey) {
                                      if (isParent) return
                                      if (newSet.has(file.path)) newSet.delete(file.path)
                                      else newSet.add(file.path)
                                      lastSelectedRemoteIndexRef.current = currentIndex
                                    } else {
                                      if (e.button === 2 && newSet.has(file.path)) {
                                        return
                                      }
                                      if (e.button === 0 && wasSelected && newSet.size > 1) {
                                        // 多选状态下按下已选项：暂不立即清空其他项，避免破坏拖拽多选文件；
                                        // 仅当纯点击未拖拽时，在 onClick 中收敛为单选
                                        pendingDeselectOthersRemoteRef.current = file.path
                                        lastSelectedRemoteIndexRef.current = currentIndex
                                        return
                                      }
                                      newSet.clear()
                                      if (!isParent) {
                                        newSet.add(file.path)
                                        lastSelectedRemoteIndexRef.current = currentIndex
                                      }
                                    }
                                    setSelectedRemotePaths(newSet)
                                    // 点击前已选中（且非修饰键、非父目录）→ 标记待重命名；由 onClick 延时触发，避让双击进入目录/传输
                                    if (e.button === 0 && !isParent && !e.ctrlKey && !e.metaKey && !e.shiftKey && wasSelected) {
                                      pendingRenameRef.current = { side: 'remote', path: file.path }
                                    }
                                  }}
                                  onClick={() => {
                                    // 内联重命名中：忽略当前行的点击，避免重复触发
                                    if (renameTarget && renameTarget.path === file.path) return
                                    if (justDraggedRef.current) return
                                    if (pendingDeselectOthersRemoteRef.current === file.path) {
                                      pendingDeselectOthersRemoteRef.current = null
                                      setSelectedRemotePaths(new Set([file.path]))
                                      return
                                    }
                                    const pending = pendingRenameRef.current
                                    pendingRenameRef.current = null
                                    if (!pending || pending.side !== 'remote' || pending.path !== file.path) return
                                    // 延时消歧：双击会在 click 之后触发 onDoubleClick（已置 dblClickedRef），
                                    // 250ms 内发生双击则不重命名，交由双击进入目录/传输
                                    window.setTimeout(() => {
                                      if (dblClickedRef.current) return
                                      triggerRename('remote')
                                    }, 250)
                                  }}
                                  onContextMenu={() => {
                                    setRemoteContextMenuFile(file)
                                  }}
                                  className={cn(
                                    "workspace-table-row group grid grid-cols-[2.5fr_0.8fr_1fr_1.5fr_1.2fr_1fr] px-4 h-9 text-xs items-center cursor-pointer select-none",
                                    getCompareRowBgClass(file.path, 'remote', isSelected)
                                  )}
                                >
                                  <div className="flex items-center overflow-hidden pr-2">
                                    <div className="inline-flex items-center gap-2 max-w-full overflow-hidden" data-drag-handle="true">
                                      {file.name === '..' ? (
                                        <div className="flex items-center gap-2 text-muted-foreground/90 font-medium">
                                          <div className="flex h-5 w-5 items-center justify-center rounded bg-muted/60 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                            <FolderUp className="h-3.5 w-3.5" />
                                          </div>
                                          <span className="font-mono text-xs font-semibold tracking-wide">..</span>
                                          <span className="text-[11px] text-muted-foreground/60 hidden sm:inline font-normal">({t('fp_parent_dir')})</span>
                                        </div>
                                      ) : (
                                        <>
                                          {openingRemotePath === file.path ? (
                                            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                                          ) : (
                                            renderFileIcon(file, "h-4.5 w-4.5")
                                          )}
                                          {renameTarget && renameTarget.path === file.path ? (
                                            <InlineRenameInput
                                              value={renameValue}
                                              onChange={setRenameValue}
                                              onCommit={() => { if (renameSide === 'local') void handleRenameLocal(); else void handleRenameRemote(); }}
                                              onCancel={() => { setRenameTarget(null); setRenameValue('') }}
                                            />
                                          ) : (
                                            <span className={cn(
                                              "truncate tracking-tight",
                                              file.isDirectory
                                                ? "font-medium text-foreground"
                                                : !isSelected && "text-foreground/80",
                                              isSelected && "font-semibold text-foreground"
                                            )}>
                                              {file.name}
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  <span className="truncate text-left text-[11px] text-muted-foreground font-mono tabular-nums pl-3">
                                    {file.name === '..' ? (
                                      <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Kbd size="xs">Alt+↑</Kbd>
                                      </span>
                                    ) : (file.isDirectory ? <span className="text-[10px] text-muted-foreground/40 font-sans uppercase">dir</span> : formatFileSize(file.size))}
                                  </span>
                                  <span className="text-left text-[11px] text-muted-foreground font-mono truncate pl-3">
                                    {file.name === '..' ? '' : t(getFileTypeLabel(file))}
                                  </span>
                                  <span className="text-left text-[11px] text-muted-foreground font-mono truncate pl-3">
                                    {file.name === '..' ? '' : (file.modifiedTime || '-')}
                                  </span>
                                  <span className="text-left text-[11px] text-muted-foreground font-mono truncate pl-3">
                                    {file.name === '..' ? '' : (file.permissions || '-')}
                                  </span>
                                  <span className="text-left text-[11px] text-muted-foreground font-mono truncate pl-3">
                                    {file.name === '..' ? '' : (file.owner || (file.uid === 0 ? 'root' : (file.uid != null ? String(file.uid) : '-')))}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          renderRemoteCards()
                        )}
                        {/* 框选矩形（client 坐标 fixed 定位，不拦截事件） */}
                        <MarqueeRect marquee={remoteMarquee} />
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-56">
                      {remoteContextMenuFile && remoteContextMenuFile.name !== '..' ? (
                        <>
                          {(() => {
                            // 多选场景判断：右键项属于多选集合时，重命名/编辑权限/复制路径等单文件操作需隐藏
                            const isMulti = selectedRemotePaths.has(remoteContextMenuFile.path) && selectedRemotePaths.size > 1
                            // 可预览/编辑的文件（非目录、文本/图片/PDF/视频/音频）
                            const canPreview = !remoteContextMenuFile.isDirectory && !isMulti &&
                              getPreviewKind(remoteContextMenuFile.name) !== 'unsupported'
                            return (
                              <>
                                {isMulti && (
                                  <>
                                    <div className="px-2.5 py-1 text-[11px] font-medium text-muted-foreground/80 select-none">
                                      {t('fs_selected_n').replace('{n}', String(selectedRemotePaths.size))}
                                    </div>
                                    <ContextMenuSeparator />
                                  </>
                                )}
                                {canPreview && (
                                  <ContextMenuItem onClick={() => {
                                    if (remoteContextMenuFile && selectedServerId) {
                                      void openFileViewer('remote', remoteContextMenuFile, selectedServerId)
                                    }
                                  }}>
                                    <Eye className="mr-2 h-4 w-4 text-muted-foreground" />
                                    <span>{t('sftp_viewer_preview')}</span>
                                  </ContextMenuItem>
                                )}
                                <ContextMenuItem onClick={() => {
                                  if (!remoteContextMenuFile) return
                                  // 若右键项属于多选集合，则下载所有选中；否则只下载该项
                                  if (isMulti) {
                                    handleDownloadSelected()
                                  } else {
                                    handleDownloadFile(remoteContextMenuFile)
                                  }
                                }}>
                                  <Download className="mr-2 h-4 w-4 text-muted-foreground" />
                                  <span>{isMulti
                                    ? t('sftp_transfer_selected').replace('{n}', String(selectedRemotePaths.size))
                                    : t('sftp_transfer_to_target')}</span>
                                </ContextMenuItem>
                                <ContextMenuItem onClick={() => copyFilesToClipboard('remote')}>
                                  <Copy className="mr-2 h-4 w-4 text-muted-foreground" />
                                  <span>{t('tm_copy')}</span>
                                  <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
                                </ContextMenuItem>
                                {!isMulti && remoteContextMenuFile.isDirectory && (
                                  <ContextMenuSub>
                                    <ContextMenuSubTrigger>
                                      <ArchiveFileIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                                      <span>{t('sftp_download_archive')}</span>
                                    </ContextMenuSubTrigger>
                                    <ContextMenuSubContent className="w-48">
                                      {[
                                        { format: 'tar.gz' as const, label: 'tar.gz', desc: t('fs_format_gzip') },
                                        { format: 'tar.bz2' as const, label: 'tar.bz2', desc: t('fs_format_bzip2') },
                                        { format: 'tar.xz' as const, label: 'tar.xz', desc: t('fs_format_xz') },
                                        { format: 'zip' as const, label: 'zip', desc: t('fs_format_zip') },
                                        { format: 'tar' as const, label: 'tar', desc: t('fs_format_tar') },
                                      ].map((item) => (
                                        <ContextMenuItem
                                          key={item.format}
                                          onClick={() => {
                                            if (remoteContextMenuFile) handleDownloadArchive(remoteContextMenuFile, item.format)
                                          }}
                                        >
                                          <span>{item.label}</span>
                                          <span className="ml-auto text-[11px] text-muted-foreground/70">{item.desc}</span>
                                        </ContextMenuItem>
                                      ))}
                                    </ContextMenuSubContent>
                                  </ContextMenuSub>
                                )}
                                {!isMulti && !remoteContextMenuFile.isDirectory && isSupportedArchiveName(remoteContextMenuFile.name) && (
                                  <ContextMenuItem
                                    disabled={extractingArchivePath !== null}
                                    onClick={() => void handleExtractArchive(remoteContextMenuFile, 'remote', selectedServerId)}
                                  >
                                    {extractingArchivePath === remoteContextMenuFile.path
                                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin text-muted-foreground" />
                                      : <ArchiveFileIcon className="mr-2 h-4 w-4 text-muted-foreground" />}
                                    <span>{t('sftp_extract_archive')}</span>
                                  </ContextMenuItem>
                                )}
                                {!isMulti && (
                                  <ContextMenuItem onClick={() => {
                                    setRenameSide('remote')
                                    setRenameServerId(selectedServerId)
                                    setRenameTarget(remoteContextMenuFile)
                                    setRenameValue(remoteContextMenuFile.name)
                                  }}>
                                    <Edit2 className="mr-2 h-4 w-4 text-muted-foreground" />
                                    <span>{t('sftp_rename')}</span>
                                    <ContextMenuShortcut>F2</ContextMenuShortcut>
                                  </ContextMenuItem>
                                )}
                                <ContextMenuItem className="text-destructive focus:bg-destructive/10 focus:text-destructive" onClick={() => {
                                  setDeleteSide('remote')
                                  setDeleteServerId(selectedServerId)
                                  // 多选场景：收集所有选中路径（排除 '..'）
                                  if (isMulti) {
                                    const paths = Array.from(selectedRemotePaths).filter(p => !p.endsWith('/..') && p !== '..')
                                    setDeleteMultiPaths(paths)
                                    setDeleteTarget(remoteContextMenuFile)
                                  } else {
                                    setDeleteMultiPaths(null)
                                    setDeleteTarget(remoteContextMenuFile)
                                  }
                                }}>
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  <span>{isMulti
                                    ? t('sftp_delete_selected').replace('{n}', String(selectedRemotePaths.size))
                                    : t('sftp_delete')}</span>
                                  <ContextMenuShortcut>Del</ContextMenuShortcut>
                                </ContextMenuItem>
                                {!isMulti && connectedServer?.targetType !== 'windows' && (
                                  <ContextMenuItem onClick={() => handleOpenPermissions(remoteContextMenuFile)}>
                                    <Shield className="mr-2 h-4 w-4 text-muted-foreground" />
                                    <span>{t('sftp_perm_title')}</span>
                                  </ContextMenuItem>
                                )}
                                {!isMulti && (
                                  <ContextMenuItem onClick={() => {
                                    if (remoteContextMenuFile) {
                                      handleCopyRemotePath(remoteContextMenuFile.path)
                                    }
                                  }}>
                                    {copiedRemotePath
                                      ? <Check className="mr-2 h-4 w-4 text-green-500" />
                                      : <Copy className="mr-2 h-4 w-4 text-muted-foreground" />}
                                    <span>{copiedRemotePath ? t('sftp_copy_path_done') : t('sftp_copy_path')}</span>
                                  </ContextMenuItem>
                                )}
                                {!isMulti && remoteContextMenuFile?.isDirectory && (
                                  <ContextMenuItem onClick={() => {
                                    if (remoteBookmarks.includes(remoteContextMenuFile.path)) {
                                      handleRemoveRemoteBookmark(remoteContextMenuFile.path)
                                    } else {
                                      handleAddRemoteBookmark(remoteContextMenuFile.path)
                                    }
                                  }}>
                                    <Bookmark className={cn(
                                      "mr-2 h-4 w-4",
                                      remoteBookmarks.includes(remoteContextMenuFile.path)
                                        ? "fill-amber-500 text-amber-500"
                                        : "text-muted-foreground"
                                    )} />
                                    <span>
                                      {remoteBookmarks.includes(remoteContextMenuFile.path)
                                        ? t('sftp_remove_current_bookmark')
                                        : t('sftp_add_bookmark')}
                                    </span>
                                  </ContextMenuItem>
                                )}
                              </>
                            )
                          })()}
                          <ContextMenuSeparator />
                        </>
                      ) : null}
                      <ContextMenuItem onClick={() => loadRemoteDirectory(selectedServerId, remotePath)}>
                        <RefreshCw className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span>{t('sftp_refresh')}</span>
                        <ContextMenuShortcut>F5</ContextMenuShortcut>
                      </ContextMenuItem>
                      <ContextMenuSub>
                        <ContextMenuSubTrigger>
                          <Plus className="mr-2 h-4 w-4 text-muted-foreground" />
                          <span>{t('sftp_new')}</span>
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className="w-52">
                          <ContextMenuItem onClick={() => {
                            setCreateFolderSide('remote')
                            setShowCreateFolder(true)
                            setNewFolderName('')
                          }}>
                            <Folder className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span className="whitespace-nowrap">{t('sftp_new_folder')}</span>
                            <ContextMenuShortcut>Ctrl+Shift+N</ContextMenuShortcut>
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => {
                            setCreateFileSide('remote')
                            setShowCreateFile(true)
                            setNewFileName('')
                          }}>
                            <File className="mr-2 h-4 w-4 text-muted-foreground" />
                            <span>{t('sftp_new_file')}</span>
                          </ContextMenuItem>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      <ContextMenuItem
                        disabled={!fileClipboardRef.current || fileClipboardRef.current.sourceSide !== 'local'}
                        onClick={() => pasteFilesFromClipboard('remote')}
                      >
                        <Copy className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span>{t('sftp_paste_here')}</span>
                        <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3. 远程与本地辅助模态对话框 */}
      {/* A. 删除确认与删除进度共用同一个弹框，避免确认后再次弹窗或尺寸跳变 */}
      <SftpDeleteDialog
        open={!!deleteTarget}
        deleteTarget={deleteTarget}
        deleteMultiPaths={deleteMultiPaths}
        deletePending={deletePending}
        deleteProgress={deleteProgress}
        onClose={() => {
          setDeleteTarget(null)
          setDeleteMultiPaths(null)
          setDeleteServerId('')
        }}
        onConfirm={deleteSide === 'local' ? handleDeleteLocal : handleDeleteRemote}
        t={t}
      />

      {/* C. 新建文件夹 */}
      <ConfirmDialog
        open={showCreateFolder}
        title={t('sftp_create_folder_title')}
        description={t('sftp_create_folder_desc')}
        confirmText={t('sftp_create')}
        cancelText={t('sftp_cancel')}
        onConfirm={createFolderSide === 'local' ? handleCreateFolderLocal : handleCreateFolderRemote}
        onCancel={() => {
          setShowCreateFolder(false)
          setNewFolderName('')
        }}
      >
        <Input
          type="text"
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          className="mt-2 text-xs"
          placeholder={t('sftp_input_folder_placeholder')}
          autoFocus
        />
      </ConfirmDialog>

      {/* C2. 关闭（断开）服务器标签二次确认（勾选「不再提醒」后直接断开） */}
      <ConfirmDialog
        open={!!pendingCloseServerId}
        title={t('sftp_close_server_title')}
        description={t('sftp_close_server_desc')}
        confirmText={t('sftp_close_server_confirm')}
        cancelText={t('sftp_cancel')}
        showDontAskAgain
        dontAskAgain={closeServerDontAskAgain}
        onDontAskAgainChange={setCloseServerDontAskAgain}
        onConfirm={() => {
          if (closeServerDontAskAgain) suppressConfirm('sftp-close-server')
          if (pendingCloseServerId) void closeRightTab(pendingCloseServerId)
          setPendingCloseServerId(null)
        }}
        onCancel={() => setPendingCloseServerId(null)}
      />

      {/* D. 新建文件 */}
      <ConfirmDialog
        open={showCreateFile}
        title={t('sftp_create_file_title')}
        description={t('sftp_create_file_desc')}
        confirmText={t('sftp_create_file_confirm')}
        cancelText={t('sftp_cancel')}
        onConfirm={createFileSide === 'local' ? handleCreateFileLocal : handleCreateFileRemote}
        onCancel={() => {
          setShowCreateFile(false)
          setNewFileName('')
        }}
      >
        <Input
          type="text"
          value={newFileName}
          onChange={(e) => setNewFileName(e.target.value)}
          className="mt-2 text-xs"
          placeholder={t('sftp_create_file_placeholder')}
          autoFocus
        />
      </ConfirmDialog>

      {/* E0. 关闭文件查看器时的未保存确认（替代 window.confirm） */}
      <ConfirmDialog
        open={showCloseViewerConfirm}
        title={t('sftp_viewer_unsaved_title')}
        description={t('sftp_viewer_unsaved_confirm')}
        confirmText={t('sftp_viewer_discard_close')}
        cancelText={t('sftp_cancel')}
        variant="destructive"
        onConfirm={() => {
          setShowCloseViewerConfirm(false)
          // 释放本地图片的 object URL，避免内存泄漏
          if (viewerObjectUrlRef.current) {
            URL.revokeObjectURL(viewerObjectUrlRef.current)
            viewerObjectUrlRef.current = null
          }
          setViewer(INITIAL_VIEWER_STATE)
        }}
        onCancel={() => setShowCloseViewerConfirm(false)}
      />

      {/* 切换编码确认对话框（dirty 时）：重读磁盘会丢弃未保存的修改 */}
      <ConfirmDialog
        open={pendingViewerEncoding !== null}
        title="切换编码"
        description="当前文件有未保存的修改。切换编码将从磁盘重新读取文件，未保存的内容将丢失。是否继续？"
        confirmText="重新读取"
        cancelText="取消"
        variant="destructive"
        onConfirm={() => {
          const enc = pendingViewerEncoding
          setPendingViewerEncoding(null)
          if (enc) void reopenViewerWithEncoding(enc)
        }}
        onCancel={() => setPendingViewerEncoding(null)}
      />

      {/* E. 编辑权限与所有权 */}
      <SftpPermissionsDialog
        permissionsTarget={permissionsTarget}
        perms={perms}
        setPerms={setPerms}
        permsSymbol={permsSymbol}
        octalDisplay={octalDisplay}
        ownerUser={ownerUser}
        setOwnerUser={setOwnerUser}
        ownerGroup={ownerGroup}
        setOwnerGroup={setOwnerGroup}
        permissionsRecursive={permissionsRecursive}
        setPermissionsRecursive={setPermissionsRecursive}
        permSaving={permSaving}
        onClose={() => setPermissionsTarget(null)}
        onSave={handleSavePermissions}
        t={t}
      />

      {/* === 文件冲突对话框 === */}
      <SftpConflictDialog
        pendingConflict={pendingConflict}
        conflictApplyToAll={conflictApplyToAll}
        onApplyToAllChange={handleConflictApplyToAllChange}
        onResolve={handleConflictResolve}
        t={t}
      />

      {/* === 解压进度动画 === */}
      <SftpExtractionProgressDialog
        open={extractionProgressOpen}
        status={extractionProgressStatus}
        phase={extractionProgressPhase}
        path={extractionProgressPath}
        progress={extractionProgress}
        onClose={() => setExtractionProgressOpen(false)}
        t={t}
      />

      {/* === 解压目标冲突对话框 === */}
      <ConfirmDialog
        open={!!pendingToolInstall}
        title={t('sftp_extract_tool_install_title')}
        description={t('sftp_extract_tool_install_description').replace('{tool}', pendingToolInstall?.tool || '')}
        confirmLabel={t('sftp_extract_tool_install_confirm')}
        cancelLabel={t('sftp_cancel')}
        variant="default"
        onConfirm={() => {
          pendingToolInstall?.resolve(true)
          setPendingToolInstall(null)
        }}
        onCancel={() => {
          pendingToolInstall?.resolve(false)
          setPendingToolInstall(null)
        }}
      />

      <SftpExtractConflictDialog
        pendingExtractConflict={pendingExtractConflict}
        onResolve={(action) => {
          pendingExtractConflict?.resolve(action)
          setPendingExtractConflict(null)
        }}
        t={t}
      />

      {/* === 覆盖确认对话框 === */}
      {/* 用于重命名/新建文件等单次操作的覆盖确认，与批量冲突对话框区别：无 applyToAll/队列 */}
      <SftpOverwriteDialog
        pendingOverwrite={pendingOverwrite}
        onConfirm={handleOverwriteConfirm}
        onCancel={handleOverwriteCancel}
        t={t}
      />

      {/* === 底部传输记录面板（可拖拽调整大小、可折叠）===
          独立区域，与上方文件列表区分离，不再用 absolute 浮动遮挡文件 */}
      <div
        className="relative shrink-0 border-t border-border/60 bg-card/90 backdrop-blur flex flex-col"
        style={{ height: transferPanelOpen ? transferPanelHeight : 28 }}
      >
        {/* 拖拽手柄：位于顶部边缘，鼠标悬停显示上下箭头 */}
        {transferPanelOpen && (
          <div
            onMouseDown={startTransferResize}
            className="absolute -top-0.5 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-primary/30 transition-colors z-50"
            title={t('sftp_drag_resize_hint')}
          />
        )}

        {/* 折叠头部：点击切换展开/隐藏 */}
        <div className="flex items-center justify-between px-3 h-7 text-xs select-none shrink-0 border-b border-border/40">
          <button
            onClick={() => setTransferPanelOpen(o => !o)}
            className="flex items-center gap-1.5 hover:text-foreground text-muted-foreground transition-colors"
            title={transferPanelOpen ? t('sftp_transfer_hide') : t('sftp_transfer_expand')}
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", transferPanelOpen ? "" : "-rotate-90")} />
            <span className="font-medium">{t('sftp_transfer_title')}</span>
            <span className="text-[10px] text-muted-foreground/70">
              ({transferRecords.length})
            </span>
            {transferRecords.some(r => r.status === 'transferring') && (
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
            )}
          </button>
          <div className="flex items-center gap-1">
            {transferRecords.length > 0 && transferPanelOpen && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={clearCompletedTransfers}
                >
                  {t('sftp_transfer_clear_done')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                  onClick={clearAllTransfers}
                >
                  {t('sftp_transfer_clear')}
                </Button>
              </>
            )}
          </div>
        </div>

        {/* 展开内容：表格形式 */}
        {transferPanelOpen && (
          <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {/* 提示使用浮层，不参与表格布局，出现/消失时不会推挤传输记录 */}
            {transferNotice && (
              <div className="pointer-events-none absolute left-2 right-2 top-1 z-30 flex h-7 items-center gap-1.5 overflow-hidden rounded border border-amber-500/20 bg-background/95 px-3 py-1.5 text-[11px] text-amber-600 shadow-sm backdrop-blur dark:text-amber-400">
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span className="truncate">{transferNotice}</span>
              </div>
            )}
            {transferRecords.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground select-none">
                {t('sftp_transfer_empty')}
              </div>
            ) : (
              <>
              <table className="w-full text-[11px] table-fixed">
                <colgroup>
                  <col className="w-6" />
                  <col className="w-[18%]" />
                  <col className="w-16" />
                  <col className="w-24" />
                  <col className="w-16" />
                  <col className="w-[18%]" />
                  <col className="w-[18%]" />
                  <col className="w-20" />
                  <col className="w-48" />
                  <col className="w-12" />
                </colgroup>
                <thead className="workspace-table-head">
                  <tr className="text-left text-muted-foreground border-b border-border/40">
                    <th className="px-2 py-1.5 font-medium"></th>
                    <th className="px-2 py-1.5 font-medium">{t('sftp_transfer_col_name')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('sftp_transfer_col_status')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('sftp_transfer_col_size')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('sftp_transfer_col_time')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('sftp_transfer_col_local')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('sftp_transfer_col_remote')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('sftp_transfer_col_result')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('sftp_transfer_col_progress')}</th>
                    <th className="px-2 py-1.5 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {/* 限制渲染前 100 条记录避免 DOM 节点爆炸（新记录在数组前面，用户最关心最近的）
                      完整虚拟化需重构为 div 网格，风险较高暂不实施 */}
                  {transferRecords.slice(0, 100).map(item => {
                    const childRecords = transferChildren[item.transferId] || []
                    const isDirectoryTask = item.totalType === 'count' || directoryTransferIdsRef.current.has(item.transferId)
                    // 目录任务从创建开始就允许点击；清单尚未到达时详情面板显示加载状态。
                    const isExpandable = isDirectoryTask || childRecords.length > 0
                    const isExpanded = expandedTransfers.has(item.transferId)
                    // totalType='count' 表示目录递归传输，total 是文件数；否则为字节数
                    const isFileCount = item.totalType === 'count'
                    const sizeText = isFileCount
                      ? (item.total > 0
                          ? (item.status === 'completed' ? `${item.total}/${item.total}` : `${item.current}/${item.total}`)
                          : `${item.current}`)
                      : (item.status === 'completed' && item.total > 0
                          ? `${formatTransferSize(item.total)} / ${formatTransferSize(item.total)}`
                          : `${formatTransferSize(item.current)} / ${formatTransferSize(item.total)}`)
                    // 目录总进度按所有子文件字节加权。并发传输时，各子文件已传字节和
                    // 实时速率自然累加；清单无大小时才回退到文件计数百分比。
                    const directorySummary = directoryTransferSummaries[item.transferId]
                    const directoryTotalBytes = isDirectoryTask && !isFileCount ? (directorySummary?.totalBytes ?? 0) : 0
                    const directoryCurrentBytes = isDirectoryTask && !isFileCount ? (directorySummary?.currentBytes ?? 0) : 0

                    // 统计当前并发传输中所有子文件的进度贡献比例（activeChildrenRatio），支持多并发传输时主进度条平滑递增
                    let activeChildRatio = 0
                    if (isFileCount && item.total > 0) {
                      const activeChildren = childRecords.filter(c => c.status === 'transferring' && c.total > 0)
                      for (const child of activeChildren) {
                        activeChildRatio += Math.min(0.99, Math.max(0, child.current / child.total))
                      }
                    }

                    // 目录文件计数任务（totalType=count）：按 已完成文件数 + 当前文件进度比例 / 总文件数 综合计算百分比；
                    // 既保持了大文件传输时的平滑递增，又避免了小文件时的阶跃卡顿。
                    const displayPercent = (() => {
                      if (item.status === 'completed') return 100
                      if (isFileCount) {
                        if (item.total > 0) {
                          const fractionalCurrent = item.current + activeChildRatio
                          return Math.min(99, Math.round((fractionalCurrent / item.total) * 100))
                        }
                        return 0
                      }
                      if (isDirectoryTask && directoryTotalBytes > 0) {
                        return Math.min(99, Math.round((directoryCurrentBytes / directoryTotalBytes) * 100))
                      }
                      return item.percent
                    })()
                    const displayRate = isDirectoryTask
                      ? (item.status === 'completed'
                          ? (item.finalRate || directorySummary?.activeRate || 0)
                          : (directorySummary?.activeRate || item.rate || 0))
                      : (item.status === 'completed'
                          ? (item.finalRate || item.rate || 0)
                          : item.rate)
                    const hasDeterminateProgress = isDirectoryTask ? (isFileCount ? item.total > 0 : directoryTotalBytes > 0) : item.total > 0
                    // 源/目标路径：远端显示「服务器名: 路径」，本地侧显示「本地: 路径」；过长由 CSS 省略
                    const sourceLabel = item.sourceServerName
                      ? `${item.sourceServerName}: ${item.sourcePath ?? ''}`
                      : (item.sourcePath ? `本地: ${item.sourcePath}` : '-')
                    const targetLabel = item.targetServerName
                      ? `${item.targetServerName}: ${item.targetPath ?? ''}`
                      : (item.targetPath ? `本地: ${item.targetPath}` : '-')
                    // 详情列仅显示异常或人工处理原因；正常生命周期由“状态”列表达。
                    const resultText = (() => {
                      switch (item.status) {
                        case 'failed': return item.error || t('sftp_transfer_failed')
                        case 'skipped': return item.skipReason || t('sftp_transfer_skipped')
                        case 'canceled': return item.error || t('sftp_transfer_user_canceled')
                        default: return '—'
                      }
                    })()
                    // 操作时间：传输中显示开始时间，完成/失败/跳过显示完成时间，回退到创建时间
                    const opTime = item.completedAt ?? item.startTime ?? item.timestamp
                    return (
                      <Fragment key={item.transferId}>
                      <tr
                        key={item.transferId}
                        onClick={(e) => {
                          if (!isExpandable) return
                          if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return
                          toggleTransferDetail(item.transferId)
                        }}
                        // 固定行高：实时子文件名、进度数字变化时不得重新撑高/压缩表格行。可展开时支持点击整行展开/收起
                        className={cn(
                          "h-10 border-b border-border/20 align-middle transition-colors",
                          isExpandable ? "cursor-pointer hover:bg-muted/40" : "hover:bg-muted/20",
                          isExpanded && "bg-muted/25"
                        )}
                      >
                        {/* 类型图标：upload=蓝色上传箭头，download=绿色下载箭头，s2s=紫色双向箭头 */}
                        <td className="h-10 shrink-0 px-2 py-1.5 align-middle">
                          <div className="flex h-5 items-center justify-center leading-none">
                            {/* 始终保留下拉按钮占位，避免目录清单到达后图标重新排版 */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                if (isExpandable) toggleTransferDetail(item.transferId)
                              }}
                              disabled={!isExpandable}
                              className={cn("mr-1 inline-flex h-3 w-3 shrink-0 items-center justify-center leading-none", isExpandable ? "text-muted-foreground hover:text-foreground" : "invisible")}
                              aria-label={isExpanded ? 'Collapse transfer details' : 'Expand transfer details'}
                            >
                              {isExpanded ? <ChevronDown className="block h-3 w-3" /> : <ChevronRight className="block h-3 w-3" />}
                            </button>
                            {item.type === 'upload'
                              ? <Upload className="block h-3 w-3 shrink-0 text-blue-500" />
                              : item.type === 'download'
                              ? <Download className="block h-3 w-3 shrink-0 text-green-500" />
                              : <ArrowLeftRight className="block h-3 w-3 shrink-0 text-purple-500" />}
                          </div>
                        </td>
                        {/* 名称：始终只显示顶层文件/文件夹名，避免当前子文件变化触发表格重排。
                            当前子文件仍保留在 title 和可展开详情中。 */}
                        <td className="h-10 max-w-0 overflow-hidden px-2 py-1.5" title={item.currentSubFile ? `${item.fileName} / ${item.currentSubFile}` : item.fileName}>
                          <div className="flex h-5 min-w-0 items-center overflow-hidden whitespace-nowrap">
                            <span className="min-w-0 truncate font-medium">{item.fileName}</span>
                          </div>
                        </td>
                        {/* 状态 */}
                        <td className="px-2 py-1.5 shrink-0">
                          {item.status === 'transferring' && item.phase === 'preflight' && (
                            <Badge variant="soft" className="gap-1 px-1.5 py-0 text-[10px] h-5 font-normal tracking-wide">
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              {t('sftp_transfer_preflight')}
                            </Badge>
                          )}
                          {item.status === 'transferring' && item.phase !== 'preflight' && (
                            <Badge variant="soft-info" className="gap-1 px-1.5 py-0 text-[10px] h-5 font-normal tracking-wide">
                              <span className="h-1.5 w-1.5 rounded-full bg-sky-400 status-dot-pulse" />
                              {t('sftp_transfer_transferring')}
                            </Badge>
                          )}
                          {item.status === 'paused' && (
                            <Badge variant="soft-info" className="gap-1 px-1.5 py-0 text-[10px] h-5 font-normal tracking-wide text-blue-400 border-blue-500/20 bg-blue-500/10">
                              <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                              {t('sftp_transfer_paused')}
                            </Badge>
                          )}
                          {item.status === 'completed' && (
                            <Badge variant="soft-success" className="gap-1 px-1.5 py-0 text-[10px] h-5 font-normal tracking-wide">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              {t('sftp_transfer_completed')}
                            </Badge>
                          )}
                          {item.status === 'failed' && (
                            <Badge variant="soft-destructive" className="gap-1 px-1.5 py-0 text-[10px] h-5 font-normal tracking-wide" title={item.error}>
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                              {t('sftp_transfer_failed')}
                            </Badge>
                          )}
                          {item.status === 'partial' && (
                            <Badge
                              variant="soft-warning"
                              className="gap-1 px-1.5 py-0 text-[10px] h-5 font-normal tracking-wide"
                              title={`${item.succeededCount ?? 0} ${t('sftp_transfer_completed')} / ${item.failedCount ?? 0} ${t('sftp_transfer_failed')}`}
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              {t('sftp_transfer_partial')}
                              {(item.failedCount ?? 0) > 0 && ` (${item.failedCount})`}
                            </Badge>
                          )}
                          {item.status === 'skipped' && (
                            <Badge variant="soft" className="gap-1 px-1.5 py-0 text-[10px] h-5 font-normal tracking-wide">
                              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                              {t('sftp_transfer_skipped')}
                            </Badge>
                          )}
                          {item.status === 'canceled' && (
                            <Badge variant="soft-warning" className="gap-1 px-1.5 py-0 text-[10px] h-5 font-normal tracking-wide">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              {t('sftp_transfer_canceled')}
                            </Badge>
                          )}
                        </td>
                        {/* 大小 */}
                        <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground shrink-0">
                          {item.status === 'skipped' ? '-' : sizeText}
                        </td>
                        {/* 操作时间 */}
                        <td className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground shrink-0 whitespace-nowrap">
                          {formatClockTime(opTime)}
                        </td>
                        {/* 源路径（带服务器名称，过长省略，悬停显示完整） */}
                        <td className="px-2 py-1.5 truncate font-mono text-[10px] text-muted-foreground" title={sourceLabel}>
                          {sourceLabel}
                        </td>
                        {/* 目标路径（带服务器名称，过长省略，悬停显示完整） */}
                        <td className="px-2 py-1.5 truncate font-mono text-[10px] text-muted-foreground" title={targetLabel}>
                          {targetLabel}
                        </td>
                        {/* 结果：成功显示成功，失败/跳过显示原因（过长省略，悬停显示完整） */}
                        <td className="px-2 py-1.5 truncate text-[10px]" title={resultText}>
                          <span className={cn(
                            item.status === 'failed' ? 'text-red-500' :
                            item.status === 'skipped' || item.status === 'canceled' ? 'text-muted-foreground' :
                            'text-muted-foreground/60'
                          )}>{resultText}</span>
                        </td>
                        {/* 进度（条+百分比+速率） */}
                        <td className="px-2 py-1.5 shrink-0">
                          {item.status === 'skipped' ? (
                            <span className="text-muted-foreground/60">-</span>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden min-w-[40px]">
                                {/* total=0 时显示不确定条纹动画 */}
                                {!hasDeterminateProgress && item.status === 'transferring' ? (
                                  <div
                                    className="h-full bg-primary/60 animate-pulse"
                                    style={{ width: '100%' }}
                                  />
                                ) : (
                                  <div
                                    className={cn(
                                      "h-full transition-all",
                                      item.status === 'failed' ? "bg-red-500" :
                                      item.status === 'partial' ? "bg-amber-500" :
                                      item.status === 'completed' ? "bg-green-500" :
                                      item.status === 'canceled' ? "bg-amber-500" :
                                      item.status === 'paused' ? "bg-blue-500" : "bg-primary"
                                    )}
                                    style={{ width: `${Math.min(100, Math.max(0, displayPercent))}%` }}
                                  />
                                )}
                              </div>
                              <span className="font-mono tabular-nums text-[10px] w-8 text-right shrink-0">
                                {/* total=0 时显示已传输字节数而非百分比 */}
                                {!hasDeterminateProgress && item.status === 'transferring'
                                  ? formatTransferSize(item.current)
                                  : `${displayPercent}%`}
                              </span>
                              <span className="font-mono tabular-nums text-[9px] text-muted-foreground/70 shrink-0 whitespace-nowrap min-w-[58px] text-right">
                                {item.status === 'transferring'
                                  ? formatTransferRate(displayRate)
                                  : item.status === 'completed'
                                    ? (displayRate > 0 ? formatTransferRate(displayRate) : '—')
                                    : '—'}
                              </span>
                            </div>
                          )}
                        </td>
                        {/* 操作 */}
                        <td className="px-2 py-1.5 shrink-0">
                          {item.status === 'transferring' ? (
                            // 传输中：暂停（保留临时文件）+ 取消（清理临时文件）
                            <div className="flex items-center gap-2">
                              {item.tmpPath && (
                                <button
                                  onClick={() => pauseTransfer(item.transferId)}
                                  className="text-blue-500 hover:text-blue-600"
                                  title={t('sftp_transfer_pause')}
                                >
                                  <Pause className="h-3 w-3" />
                                </button>
                              )}
                              <button
                                onClick={() => cancelTransfer(item.transferId)}
                                className="text-amber-500 hover:text-amber-600"
                                title={t('sftp_transfer_cancel')}
                              >
                                <Ban className="h-3 w-3" />
                              </button>
                            </div>
                          ) : item.status === 'paused' ? (
                            // 已暂停：继续 + 取消任务（清理临时文件）
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => resumeTransfer(item.transferId)}
                                className="text-green-500 hover:text-green-600"
                                title={t('sftp_transfer_resume')}
                              >
                                <Play className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => cleanupTransferTmpFile(item.transferId)}
                                className="text-muted-foreground/60 hover:text-red-500"
                                title={t('sftp_transfer_cancel_task')}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          ) : item.resumable ? (
                            // 失败（网络中断等）且存在临时文件：显示"继续"和"取消任务"两个按钮
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => resumeTransfer(item.transferId)}
                                className="text-green-500 hover:text-green-600"
                                title={t('sftp_transfer_resume')}
                              >
                                <Play className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => cleanupTransferTmpFile(item.transferId)}
                                className="text-muted-foreground/60 hover:text-red-500"
                                title={t('sftp_transfer_cancel_task')}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              {/* 目录记录失败/部分成功后：重试并跳过目标端已存在且大小一致的文件 */}
                              {(item.status === 'failed' || item.status === 'partial')
                                && item.type !== 's2s'
                                && item.sourcePath
                                && item.targetPath && (
                                <button
                                  onClick={() => void retryTransferSkipExisting(item)}
                                  className="text-muted-foreground/70 hover:text-foreground"
                                  title={t('sftp_transfer_retry_skip')}
                                >
                                  <RefreshCw className="h-3 w-3" />
                                </button>
                              )}
                              {/* 完成的下载：在本地文件夹中显示 */}
                              {item.status === 'completed' && item.type === 'download' && item.targetPath && (
                                <button
                                  onClick={async () => {
                                    try {
                                      const { open } = await import('@tauri-apps/plugin-shell')
                                      const parent = getParentPath(item.targetPath!) || item.targetPath!
                                      await open(parent)
                                    } catch (e) {
                                      showTransferNotice(String(e))
                                    }
                                  }}
                                  className="text-muted-foreground/70 hover:text-primary"
                                  title={t('sftp_open_in_folder')}
                                >
                                  <FolderOpen className="h-3 w-3" />
                                </button>
                              )}
                              {/* 完成的上传：跳转到远程路径所在目录 */}
                              {item.status === 'completed' && item.type === 'upload' && item.targetPath && selectedServerId && (
                                <button
                                  onClick={() => {
                                    const parent = getParentPath(item.targetPath!) || item.targetPath!
                                    if (selectedServerId) loadRemoteDirectory(selectedServerId, parent)
                                  }}
                                  className="text-muted-foreground/70 hover:text-primary"
                                  title={t('sftp_goto_remote_path')}
                                >
                                  <FolderOpen className="h-3 w-3" />
                                </button>
                              )}
                              <button
                                onClick={() => removeTransfer(item.transferId)}
                                className="text-muted-foreground/60 hover:text-foreground"
                                title={t('sftp_transfer_clear')}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (() => {
                        const expandedCount = Math.max(1, expandedTransfers.size)
                        // 与主列表实际渲染上限（slice(0, 100)）保持一致，
                        // 否则记录超过 100 条时 availableHeight 会被算成负数，展开区高度失去意义
                        const renderedRecords = Math.min(transferRecords.length, 100)
                        const unexpandedCount = Math.max(0, renderedRecords - expandedCount)
                        // 固定高度占用：顶部折叠条(28) + 表头(28) + 未展开主行(每行40) + 展开主行(每行40) + 内外边距与安全余量(24)
                        const fixedOccupied = 28 + 28 + (unexpandedCount * 40) + (expandedCount * 40) + 24
                        const availableHeight = Math.max(220, transferPanelHeight - fixedOccupied)
                        const dynamicHeight = Math.max(220, Math.floor(availableHeight / expandedCount))
                        const hasManyChildren = childRecords.length * TRANSFER_CHILD_ROW_HEIGHT > dynamicHeight
                        return (
                          <tr key={`${item.transferId}-children`} className="bg-muted/10">
                            <td colSpan={10} className="px-8 py-2">
                              <TransferChildList
                                childRecords={childRecords}
                                basePath={item.type === 'upload' ? item.targetPath : item.sourcePath}
                                maxHeight={dynamicHeight}
                                fixedHeight={hasManyChildren ? dynamicHeight : undefined}
                                isTransferring={item.status === 'transferring'}
                              />
                          </td>
                        </tr>
                      )
                    })()}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
              {/* 超过 100 条时显示提示，引导用户清理已完成记录 */}
              {transferRecords.length > 100 && (
                <div className="py-2 text-center text-[10px] text-muted-foreground/70 select-none">
                  {t('sftp_transfer_truncated').replace('{shown}', '100').replace('{total}', String(transferRecords.length))}
                </div>
              )}
              </>
            )}
          </div>
        )}
      </div>

      {/* transferStatus 浮窗已移除，统一用下方 transferRecords 表格展示 */}

      {/* === 文件预览/编辑对话框 === */}
      {/* === 文件预览/编辑可调整大小对话框 === */}
      <ResizablePreviewDialog
        open={viewer.open}
        onOpenChange={(open) => { if (!open) closeViewer() }}
        title={viewer.fileName}
        fileSize={viewer.fileSize}
        sideBadge={
          <span className={cn(
            "text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0 border",
            viewer.side === 'remote'
              ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20"
              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
          )}>
            {viewer.side === 'remote' ? t('sftp_remote') : t('sftp_local')}
          </span>
        }
        icon={
          viewer.kind === 'image' ? (
            <FileImage className="h-4 w-4 text-rose-400 shrink-0" />
          ) : viewer.kind === 'pdf' ? (
            <FileText className="h-4 w-4 text-red-500 shrink-0" />
          ) : viewer.kind === 'docx' ? (
            <FileText className="h-4 w-4 text-blue-600 shrink-0" />
          ) : viewer.kind === 'legacy_doc' ? (
            <FileText className="h-4 w-4 text-amber-600 shrink-0" />
          ) : viewer.kind === 'spreadsheet' ? (
            <FileSpreadsheet className="h-4 w-4 text-emerald-500 shrink-0" />
          ) : viewer.kind === 'video' ? (
            <FileVideo className="h-4 w-4 text-purple-400 shrink-0" />
          ) : viewer.kind === 'audio' ? (
            <FileAudio className="h-4 w-4 text-amber-400 shrink-0" />
          ) : (
            <FileText className="h-4 w-4 text-blue-400 shrink-0" />
          )
        }
        extraHeaderActions={(() => {
          const ext = getFileExt(viewer.fileName)
          const isEditable = viewer.kind === 'text' || (viewer.kind === 'spreadsheet' && (ext === 'csv' || ext === 'tsv'))
          const isJson = ext === 'json'
          if (!isEditable && !isJson) return null
          return (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {/* 编码选择（Notepad++ 式：手动切换重新打开）+ 换行符徽标 */}
              {isEditable && viewer.side === 'remote' && !viewer.loading && !viewer.error && (
                <>
                  <select
                    value={viewer.encoding || 'utf-8'}
                    onChange={(e) => {
                      const enc = e.target.value
                      // dirty 时先确认：切换编码会从磁盘重读，未保存内容将丢失
                      if (viewer.dirty && enc !== (viewer.encoding || 'utf-8')) {
                        setPendingViewerEncoding(enc)
                        return
                      }
                      void reopenViewerWithEncoding(enc)
                    }}
                    className="h-7 rounded-md border border-input bg-background px-1.5 text-xs text-foreground cursor-pointer"
                    title="编码 / Encoding"
                  >
                    {SUPPORTED_ENCODINGS.map((e) => (
                      <option key={e.value} value={e.value}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                  <span
                    className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground select-none"
                    title="换行符"
                  >
                    {eolLabel(viewer.eol ?? null)}
                  </span>
                </>
              )}
              {isJson && !viewer.loading && !viewer.error && viewer.content && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={formatViewerJson}
                  title="格式化 JSON (缩进排版 / 紧凑排版)"
                >
                  <Braces className="h-3.5 w-3.5 mr-1 text-primary" />
                  <span>格式化</span>
                </Button>
              )}
              {isEditable && viewer.mode === 'preview' && !viewer.loading && !viewer.error && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={toggleViewerMode}
                  title={t('sftp_viewer_edit')}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  <span>{t('sftp_viewer_edit')}</span>
                </Button>
              )}
              {isEditable && viewer.mode === 'edit' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={toggleViewerMode}
                  title={t('sftp_viewer_preview')}
                >
                  <Eye className="h-3.5 w-3.5 mr-1" />
                  <span>{t('sftp_viewer_preview')}</span>
                </Button>
              )}
              {isEditable && viewer.mode === 'edit' && (
                <Button
                  variant="default"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={!viewer.dirty || viewer.saving}
                  onClick={saveViewerContent}
                  title={t('sftp_viewer_save')}
                >
                  {viewer.saving ? (
                    <QshellLoader size="xs" className="mr-1.5" />
                  ) : (
                    <Save className="h-3.5 w-3.5 mr-1" />
                  )}
                  <span>{t('sftp_viewer_save')}</span>
                </Button>
              )}
            </div>
          )
        })()}
      >
        {viewer.loading ? (
          <div className="flex-1 flex items-center justify-center min-h-64">
            <QshellLoader size="md" text={t('common_loading') || 'Loading...'} />
          </div>
        ) : viewer.error ? (
          <div className="flex-1 flex flex-col items-center justify-center min-h-64 gap-2 px-6 text-center">
            <AlertCircle className={cn("h-8 w-8", viewer.isBinary ? "text-amber-500" : "text-destructive")} />
            <p className={cn("text-sm", viewer.isBinary ? "text-foreground font-medium" : "text-destructive")}>{viewer.error}</p>
          </div>
        ) : (viewer.kind === 'universal' || viewer.kind === 'docx' || viewer.kind === 'legacy_doc' || (viewer.kind === 'spreadsheet' && viewer.mode === 'preview') || viewer.kind === 'image' || viewer.kind === 'pdf' || viewer.kind === 'video' || viewer.kind === 'audio') ? (
          <div className="w-full h-full flex flex-col overflow-hidden">
            <UniversalFileViewer
              data={viewer.rawBytes || viewer.mediaSrc}
              fileName={viewer.fileName}
              className="h-full"
              onError={(err) => setViewer(v => ({ ...v, error: err.message }))}
            />
          </div>
        ) : viewer.mode === 'edit' ? (
          <div className="w-full h-full">
            <CodeEditor
              value={viewer.content || ''}
              onValueChange={(val) => setViewer(v => ({ ...v, content: val, dirty: true }))}
              fileName={viewer.fileName}
              className="h-full"
            />
          </div>
        ) : (getFileExt(viewer.fileName) === 'md' || getFileExt(viewer.fileName) === 'markdown') ? (
          <div className="w-full h-full overflow-auto">
            <MarkdownViewer content={viewer.content || ''} />
          </div>
        ) : HTML_EXT_SET.has(getFileExt(viewer.fileName)) ? (
          <div className="w-full h-full bg-white">
            <iframe
              srcDoc={viewer.content || ''}
              title={viewer.fileName}
              sandbox="allow-same-origin allow-scripts"
              className="w-full h-full border-0"
            />
          </div>
        ) : (
          <div className="w-full h-full flex flex-col overflow-hidden">
            <UniversalFileViewer
              data={viewer.content || viewer.rawBytes || viewer.mediaSrc}
              fileName={viewer.fileName}
              className="h-full"
              onError={(err) => setViewer(v => ({ ...v, error: err.message }))}
            />
          </div>
        )}
      </ResizablePreviewDialog>

      {/* === SFTP 配置诊断结果对话框 === */}
      <SftpDiagnosticsDialog
        open={showDiagnosticsDialog}
        onOpenChange={setShowDiagnosticsDialog}
        sftpDiagnostics={sftpDiagnostics}
        t={t}
      />

      {/* 统一 SFTP 操作错误弹框 */}
      <ErrorDialog
        open={!!formattedSftpError}
        title={formattedSftpError?.title}
        message={formattedSftpError?.message ?? ''}
        onClose={dismissSftpError}
      />

      {/* SFTP 图标模式 Windows 风格悬浮属性弹窗 */}
      {hoveredCardInfo && (
        <FilePropertiesTooltip
          info={hoveredCardInfo}
          t={t}
        />
      )}
    </div>
  )
}
