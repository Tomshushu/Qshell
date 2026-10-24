import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useMarqueeSelection } from '@/hooks/use-marquee-selection'
import { MarqueeRect } from '@/components/ui/marquee-rect'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  FolderOpen,
  RefreshCw,
  Search,
  Eye,
  Pencil,
  Save,
  Shield,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Loader2,
  UploadCloud,
  Braces,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  renderFileIcon,
  type LocalFile,
  BINARY_EXT_SET,
  DOCX_EXT_SET,
  DOC_LEGACY_EXT_SET,
  SPREADSHEET_EXT_SET,
  TEXT_EXT_SET,
  UNIVERSAL_PREVIEW_EXTS,
  isUniversalPreviewSupported,
  isLogFileName,
  isBinaryContent,
} from './local-file-picker-utils'
import { UniversalFileViewer } from '@/components/ui/universal-file-viewer'
import { ResizablePreviewDialog } from '@/components/ui/resizable-preview-dialog'
import { useShortcutStore } from '@/store/shortcut-store'
import { CodeEditor } from '@/components/ui/code-editor'
import { sshService } from '@/services/ssh-service'
import { FilePermissionsModal } from './file-permissions-modal'
import { ErrorDialog } from '@/components/ui/error-dialog'
import { formatSftpError, isSftpConnectionError } from '@/lib/sftp-error'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PackProgressDialog } from '@/components/ui/pack-progress-dialog'
import type { FileEntry } from '@/types'
import type { FileStatInfo } from '@/services/api'
import { useTranslation } from '@/i18n'
import { useFileExplorerPreferences } from '@/hooks/use-file-explorer-preferences'
import { useToast } from '@/components/ui/toast'
import { useAppStore } from '@/store'
import { extractBaseServerId } from '@/services/ssh-connection-state'
import type { FilesModuleProps, TreeNode, SortField, SortDirection } from './files/types'
import { isAbsolutePath, resolveRelativePath } from '@/utils/terminal-path-utils'
import {
  decodeTextFile,
  decodeTextWithEncoding,
  encodeTextFile,
  normalizeEol,
  bytesToBase64,
  base64ToBytes,
  SUPPORTED_ENCODINGS,
  eolLabel,
  type TextEol,
} from '@/utils/text-file-codec'
import { PermissionBadge } from './files/permission-badge'
import { FilePropertiesDialog } from './files/file-properties-dialog'
import { FileContextMenu } from './files/file-context-menu'
import { FileDirectoryTree } from './files/file-directory-tree'
import { FileToolbar } from './files/file-toolbar'

function findTreeNode(root: TreeNode, path: string): TreeNode | null {
  if (root.path === path) return root
  for (const child of root.children) {
    const found = findTreeNode(child, path)
    if (found) return found
  }
  return null
}

function updateTreeNode(root: TreeNode, path: string, updater: (node: TreeNode) => TreeNode): TreeNode {
  if (root.path === path) return updater(root)
  // 路径前缀不匹配的子树直接短路返回原引用，避免整树深拷贝（性能优化）
  // 例如 path=/home/user 时，/var 子树完全不需要遍历
  if (!path.startsWith(root.path === '/' ? '/' : root.path + '/')) return root
  let changed = false
  const newChildren = root.children.map(c => {
    const newC = updateTreeNode(c, path, updater)
    if (newC !== c) changed = true
    return newC
  })
  return changed ? { ...root, children: newChildren } : root
}

// E7: 并发数控制工具 - 限制同时执行的异步任务数量
// 避免批量下载/上传时一次性 Promise.all 导致 SSH 通道拥堵或后端资源耗尽
const FILE_TRANSFER_CONCURRENCY = 3 // 与 SFTP 模块默认值一致
async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (true) {
      if (sshService.isExiting()) break
      const i = nextIndex++
      if (i >= tasks.length) break
      results[i] = await tasks[i]()
    }
  })
  await Promise.all(workers)
  return results
}

// D1: 将可见的目录树扁平化为 {node, depth} 列表,便于虚拟化/限制节点数
function flattenTree(root: TreeNode, expandedPaths: Set<string>): { node: TreeNode; depth: number }[] {
  const result: { node: TreeNode; depth: number }[] = []
  const walk = (node: TreeNode, depth: number) => {
    result.push({ node, depth })
    if (expandedPaths.has(node.path) && node.loaded) {
      node.children.forEach(c => walk(c, depth + 1))
    }
  }
  walk(root, 0)
  return result
}

// 目录树最大显示节点数,超过时显示提示,避免深目录展开后 DOM 节点激增
const MAX_TREE_NODES = 500

function fileEntriesToTreeNodes(data: FileEntry[]): TreeNode[] {
  return data
    .filter(f => f.isDirectory && f.name !== '.' && f.name !== '..')
    .map(d => ({
      path: d.path,
      name: d.name,
      children: [],
      loaded: false,
      loading: false,
    }))
}

function toIconFile(file: Pick<FileEntry, 'name' | 'path' | 'isDirectory' | 'size' | 'modifiedTime'>): LocalFile {
  return {
    name: file.name,
    path: file.path,
    isDirectory: file.isDirectory,
    size: file.size,
    modified: file.modifiedTime,
  }
}

// B4: 危险根路径黑名单,删除这些路径可能导致系统损坏
const DANGEROUS_ROOTS = ['/', '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/boot', '/dev', '/proc', '/sys', '/var', '/home', '/root', '/opt']
const isDangerousPath = (p: string) => DANGEROUS_ROOTS.includes(p) || p.split('/').filter(Boolean).length <= 1

/**
 * 判断错误是否为「用户取消」。
 * 后端文案随版本/语言变化（"User canceled" / "Transfer canceled by user" 等），
 * 不能再用中文字面量精确比较（永远匹配不上），统一做大小写无关的包含匹配。
 */
const isUserCanceledError = (error?: string | null): boolean => {
  if (!error) return false
  const s = error.toLowerCase()
  return s.includes('cancel') || error.includes('用户取消') || error.includes('已取消')
}

/** 获取文件类型图标和颜色 */
// 文件图标统一使用 local-file-picker-utils 中的 renderFileIcon/getFileIconMeta
// 与 SFTP 模块共用同一套图标和配色（图片/视频/音频/代码/表格/归档/文档/文件夹）

/** 判断文件预览类型：text 进文本编辑器，universal 进通用预览器，其余不支持 */
function getFileKind(name: string):
  | 'text'
  | 'universal'
  | 'unsupported' {
  if (isLogFileName(name)) return 'text'
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (TEXT_EXT_SET.has(ext)) return 'text'
  if (
    isUniversalPreviewSupported(name) ||
    UNIVERSAL_PREVIEW_EXTS.has(ext) ||
    DOCX_EXT_SET.has(ext) ||
    DOC_LEGACY_EXT_SET.has(ext) ||
    SPREADSHEET_EXT_SET.has(ext)
  ) {
    return 'universal'
  }
  return 'unsupported'
}



export function FilesModule({
  serverId,
  isConnected = true,
  isActive = true,
  getTerminalCwd,
  subscribeTerminalCwd,
}: FilesModuleProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  // ToastProvider 在消息列表变化时会重建 toast 对象。异步文件操作统一通过 ref
  // 读取最新实例，避免 callback 依赖频繁变化导致原生拖拽监听反复注册。
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast }, [toast])
  const baseServerId = extractBaseServerId(serverId)
  const server = useAppStore((s) => s.servers.find((sv) => sv.id === baseServerId))
  // 用户设置里的 SFTP 并发数（1-10）：本模块此前写死 3，导致设置不生效且内外层并发相乘
  const sftpTransferConcurrency = useAppStore((s) => Number(s.sftpTransferConcurrency) || 3)
  const isWindows = server?.targetType === 'windows'
  const isTelnet = server?.protocol === 'telnet'
  const isNetwork = server?.targetType === 'network'
  const [currentPath, setCurrentPath] = useState('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  // 预览对话框的查看模式：编辑在预览弹框内进行（与 SFTP 面板一致），不再有独立编辑器视图
  const [viewerMode, setViewerMode] = useState<'preview' | 'edit'>('preview')
  // 当前预览文件是否可编辑（文本类且不超大小上限；实际为二进制内容时自动降级为不可编辑）
  const [viewerEditable, setViewerEditable] = useState(false)
  // 打开文件的原始编码/换行符/BOM：保存时按原样回写（参照 Notepad++）
  // state 供编辑器工具栏展示，refs 供异步保存逻辑读取最新值
  const [editFileEncoding, setEditFileEncoding] = useState('utf-8')
  const [editFileEol, setEditFileEol] = useState<TextEol>(null)
  const [, setEditFileHasBom] = useState(false)
  const editFileEncodingRef = useRef('utf-8')
  const editFileEolRef = useRef<TextEol>(null)
  const editFileHasBomRef = useRef(false)
  // 编辑器内容是否被用户修改过：切换编码重读磁盘前据此提示，避免未保存内容静默丢失
  const editDirtyRef = useRef(false)
  // 待确认的编码切换（dirty 时先弹确认框）
  const [pendingEncodingChange, setPendingEncodingChange] = useState<string | null>(null)
  // 预览/编辑链路请求序号：快速连续打开多个文件时丢弃过期响应，
  // 避免慢请求后到覆盖新文件内容（否则会把 A 的内容保存进 B）
  const viewerReqIdRef = useRef(0)
  // 属性对话框请求序号（同类竞态：连续对两个文件点属性）
  const statReqIdRef = useRef(0)
  // 当前编码是否为「自动检测兜底结果」（非 UTF-8、无 BOM，主要是不确定的 GB18030）
  const autoDetectedEncodingRef = useRef(false)
  // 用户已确认按自动检测编码写回（避免重复弹框）
  const encodingSaveAckRef = useRef(false)
  // 待确认的「按自动检测编码保存」
  const [pendingEncodingSave, setPendingEncodingSave] = useState(false)

  // 切换目录时重置「新建文件/文件夹」输入：避免输入内容残留、在错误目录里创建条目
  useEffect(() => {
    setShowNewItem(false)
    setNewItemName('')
  }, [currentPath])

  // 卸载时清理「再次点击重命名」的延时句柄，避免定时器操作已卸载组件
  useEffect(() => () => {
    if (pendingRenameTimerRef.current !== null) {
      window.clearTimeout(pendingRenameTimerRef.current)
      pendingRenameTimerRef.current = null
    }
  }, [])
  const [newItemName, setNewItemName] = useState('')
  const [showNewItem, setShowNewItem] = useState(false)
  const [newItemType, setNewItemType] = useState<'file' | 'dir'>('file')
  const [transferLoading, setTransferLoading] = useState<string | null>(null)
  const [extractingFile, setExtractingFile] = useState<string | null>(null)
  const [packingTarget, setPackingTarget] = useState<{ name: string; fileCount: number } | null>(null)
  const [treeRoot, setTreeRoot] = useState<TreeNode>({
    path: '/',
    name: '/',
    children: [],
    loaded: false,
    loading: false,
  })
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['/']))
  // 右键菜单
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; file: FileEntry | null } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)
  // 重命名
  const [renamingFile, setRenamingFile] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [permissionsFile, setPermissionsFile] = useState<FileEntry | null>(null)
  const treeLoadingRef = useRef(new Set<string>())
  // 目录树节点请求序号：force 重载会绕过 loading 去重，与进行中的同路径请求并发时，
  // 只允许最后一次请求写入，避免旧响应覆盖新树
  const treeReqIdRef = useRef(new Map<string, number>())
  const [openingPath, setOpeningPath] = useState<string | null>(null)
  const lastFetchedPathRef = useRef<string>('')
  // 文件列表请求序号：每次 fetchFiles 自增，过期请求的结果被丢弃，
  // 防止快速切目录时旧响应覆盖新响应（对齐 sftp-panel 的 localDirReqIdRef 范式）
  const fetchFilesReqIdRef = useRef(0)
  // 保活初始化标记：确保根目录加载只在首次连接建立时执行一次，
  // 避免保活模式下切换模块回归时重复发起 SFTP 请求
  const filesInitializedRef = useRef(false)
  // 终端目录跟随：面板激活期间实时探测终端 cwd，变化即跟随。
  // - lastRawTerminalCwdRef：上次探测到的原始 cwd（规范化后）。用于快速通道——
  //   原始值未变则跳过 statInfo 校验，避免轮询每轮都打后端
  // - lastAppliedTerminalDirRef：上次已直达的（经校验/符号链接解析后的）目录。
  //   终端目录没变时保留用户在文件模块内的手动导航，不被轮询拽回
  // - filesInitDone：init 异步流程（根目录树 + home 解析）完成标记，
  //   直达需等 init 完成后再导航，否则会被 init 的 setCurrentPath(home) 覆盖
  const lastRawTerminalCwdRef = useRef<string | null>(null)
  const lastAppliedTerminalDirRef = useRef<string | null>(null)
  const [filesInitDone, setFilesInitDone] = useState(false)
  // 同步 currentPath 最新值，供异步直达逻辑读取，避免闭包过期
  const currentPathRef = useRef(currentPath)
  useEffect(() => { currentPathRef.current = currentPath }, [currentPath])
  // 终端 cwd 回调经 ref 读取：init/激活 effect 不因 prop 变化重跑，
  // 同时保证回调内总能拿到最新值
  const getTerminalCwdPropRef = useRef(getTerminalCwd)
  useEffect(() => { getTerminalCwdPropRef.current = getTerminalCwd }, [getTerminalCwd])
  const subscribeTerminalCwdRef = useRef(subscribeTerminalCwd)
  useEffect(() => { subscribeTerminalCwdRef.current = subscribeTerminalCwd }, [subscribeTerminalCwd])
  // E4: 标记重命名是否已通过 Enter 提交,避免卸载 input 触发 onBlur 重复提交/取消
  const renameCommittedRef = useRef(false)
  // 「再次点击重命名」：点击前已选中该文件时，标记待重命名，onClick 延时触发
  const pendingRenameRef = useRef<string | null>(null)
  // 双击标志：用于消歧「再次点击重命名」与「双击进入目录/打开文件」
  const rowDblClickedRef = useRef(false)
  // 「再次点击重命名」的延时句柄：卸载/重复点击时需要清理，避免悬挂定时器操作已卸载组件
  const pendingRenameTimerRef = useRef<number | null>(null)
  // 同步追踪 treeRoot 最新值,供 loadNodeChildren 在 async 上下文中读取,
  // 避免 React 18 并发模式下 setState updater 非同步执行导致的 canLoad 误判。
  const treeRootRef = useRef(treeRoot)
  // B8: 在 useEffect 中同步 ref,避免在 render 期间写 ref 引发并发模式下的副作用问题
  useEffect(() => { treeRootRef.current = treeRoot }, [treeRoot])
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)

  // === 新增功能状态 ===
  // 拖拽上传
  const [dragOver, setDragOver] = useState(false)
  // 统一偏好与路径收藏（跨端漫游与集中管理）
  const filePrefs = useFileExplorerPreferences({
    scope: 'workspace',
    serverId: baseServerId,
    onToast: {
      success: (msg) => toastRef.current.success(msg),
      info: (msg) => toastRef.current.info(msg),
      warning: (msg) => toastRef.current.warning(msg),
    },
  })

  const sortField = filePrefs.sortField as SortField
  const sortDirection = filePrefs.sortOrder as SortDirection
  const toggleSort = filePrefs.handleSort as (field: SortField) => void
  const showHidden = filePrefs.showHidden
  const toggleShowHidden = filePrefs.toggleShowHidden
  const bookmarks = filePrefs.bookmarks

  // 文件属性对话框
  const [propertiesFile, setPropertiesFile] = useState<FileEntry | null>(null)
  const [statInfo, setStatInfo] = useState<FileStatInfo | null>(null)
  const [statLoading, setStatLoading] = useState(false)
  // 文件预览（文本编辑 / 图片/PDF/视频/音频/DOCX/表格/压缩包，编辑在弹框内进行）
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null)
  const [previewRawBytes, setPreviewRawBytes] = useState<Uint8Array | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  // 目录树宽度（可调整）
  const [treeWidth, setTreeWidth] = useState(240)
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  // 保存当前 resize 监听器以便组件卸载时清理
  const resizeHandlersRef = useRef<{ move: ((ev: MouseEvent) => void) | null; up: (() => void) | null }>({ move: null, up: null })
  const isUnmountedRef = useRef(false)

  // 组件卸载时清理 resize 监听器，避免内存泄漏
  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
      if (resizeHandlersRef.current.move) {
        document.removeEventListener('mousemove', resizeHandlersRef.current.move)
      }
      if (resizeHandlersRef.current.up) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        document.removeEventListener('mouseup', resizeHandlersRef.current.up)
      }
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])



  // 点击其他地方关闭右键菜单
  // 注意两个坑（本项目其他浮层已踩过）：
  // 1. 文件模块渲染在 WorkspaceModuleModal 内，弹窗主体对 click 做了
  //    stopPropagation，挂 window/document 冒泡阶段的 click 监听永远收不到事件，
  //    必须用 document 捕获阶段；
  // 2. 部分 Radix 下拉 trigger 会在 pointerdown 上 preventDefault，导致后续
  //    click 不派发，因此用 pointerdown 而非 click/mousedown。
  useEffect(() => {
    if (!ctxMenu) return
    const close = (e: Event) => {
      const target = e.target as Node | null
      if (ctxMenuRef.current && target && !ctxMenuRef.current.contains(target)) {
        setCtxMenu(null)
      }
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('contextmenu', close, true)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('contextmenu', close, true)
    }
  }, [ctxMenu])

  // 模块被隐藏（弹窗关闭/切换到其他模块）时收起右键菜单：
  // 菜单经 Portal 挂到 body，不会随模块隐藏而消失，需显式清理
  useEffect(() => {
    if (!isActive) setCtxMenu(null)
  }, [isActive])

  const fetchFiles = useCallback(async (path: string) => {
    // C2.1 修复：请求序号机制，快速切目录时丢弃过期响应，
    // 防止旧响应覆盖新响应（对齐 sftp-panel 的 localDirReqIdRef 范式）
    const reqId = ++fetchFilesReqIdRef.current
    setLoading(true)
    // D3: 切换目录时不立即清空 files,保留旧数据直到新数据到达,避免白屏闪烁
    setError(null)
    // 客户端超时兜底,避免 Rust 端 hang 死时右侧 spinner 永远转
    let timedOut = false
    const clientTimeoutId = window.setTimeout(() => {
      if (reqId !== fetchFilesReqIdRef.current) return // 已被新请求取代
      timedOut = true
      setError(`${t('fs_err_load_dir_timeout')}: ${path}`)
      setLoading(false)
    }, 35_000)
    try {
      const data = await sshService.listFiles(serverId, path)
      // 过期请求丢弃：用户已切换到其他目录
      if (timedOut || reqId !== fetchFilesReqIdRef.current) return
      setFiles(data)
      // 刷新后清理已不存在的选中项（重命名/删除/外部变更），避免对失效路径执行操作
      const present = new Set(data.map(f => f.path))
      setSelectedFiles(prev => (prev.length === 0 ? prev : prev.filter(p => present.has(p))))
      // 性能优化：不在列表加载路径同步更新 treeRoot（会触发整树深拷贝，阻塞渲染）
      // 树节点的子节点只在 loadNodeChildren（用户主动展开或祖先链加载）中更新
      treeLoadingRef.current.delete(path)
      // 异步更新树节点（不阻塞当前渲染帧），仅在节点已存在于树中时更新
      // 用 queueMicrotask 让出主线程，确保文件列表先渲染
      queueMicrotask(() => {
        setTreeRoot(prev => {
          if (!findTreeNode(prev, path)) return prev
          return updateTreeNode(prev, path, n => ({
            ...n,
            children: fileEntriesToTreeNodes(data),
            loaded: true,
            loading: false,
          }))
        })
      })
    } catch (err) {
      if (!timedOut && reqId === fetchFilesReqIdRef.current) {
        setError(err instanceof Error ? err.message : t('fs_err_load_list'))
        treeLoadingRef.current.delete(path)
        setTreeRoot(prev => {
          if (!findTreeNode(prev, path)) return prev
          return updateTreeNode(prev, path, n => ({ ...n, loading: false }))
        })
      }
    } finally {
      window.clearTimeout(clientTimeoutId)
      // 过期请求不重置 loading（新请求会管理自己的 loading 状态）
      if (!timedOut && reqId === fetchFilesReqIdRef.current) {
        setLoading(false)
        setOpeningPath(null)
      }
    }
  }, [serverId, t])

  // 文件列表滚动容器（虚拟滚动 + 框选共用）
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // 重置文件列表滚动位置（虚拟滚动必须显式重置，对齐 sftp-panel 的做法）。
  // 根因：模块弹窗隐藏时外层容器被加上 display:none，浏览器会把滚动容器的
  // scrollTop 静默归零且不派发 scroll 事件，而 virtualizer 内部的 scrollOffset
  // 仍是旧值；恢复显示后 virtualizer 按旧 offset 计算可见范围，会把第一个
  // 可见项的 start 渲染成顶部 spacer，导致首行上方出现大片空白、整体行被推下去，
  // 且因没有 scroll 事件产生，该错位不会自愈。
  // 恢复显示时上一份内容仍在 DOM 中（保活渲染），容器可滚动，此时先挪开 1px
  // 再于下一帧归零，强制产生真实的 scroll 事件，把内部 offset 同步回 0。
  // 注意：必须声明在 navigateTo 之前——navigateTo 的依赖数组在渲染时同步求值，
  // 后置声明会触发 TDZ（Cannot access before initialization）。
  const resetListScroll = useCallback((forceSync = false) => {
    const el = scrollContainerRef.current
    if (!el) return
    if (el.scrollTop !== 0) {
      el.scrollTo({ top: 0 })
      return
    }
    if (forceSync && el.scrollHeight > el.clientHeight + 1) {
      el.scrollTo({ top: 1 })
      requestAnimationFrame(() => {
        scrollContainerRef.current?.scrollTo({ top: 0 })
      })
    }
  }, [])

  // 乐观导航：0ms 立即更新目标路径并开始拉取，消除 React 生命周期等待与感官延迟
  const navigateTo = useCallback((targetPath: string) => {
    if (!targetPath) return
    setOpeningPath(targetPath)
    lastFetchedPathRef.current = targetPath
    setCurrentPath(targetPath)
    // 切换目录必须清空选中集：否则在 A 目录选中的文件会残留到 B 目录，
    // 按 Delete / 右键删除时会删掉上一目录的文件（误删远端数据的直接来源）
    setSelectedFiles([])
    // 切换目录后回到顶部：否则新目录会保留上一目录的滚动偏移
    // （旧内容此刻仍在 DOM 中，scrollTo 能产生 scroll 事件同步 virtualizer 内部状态）
    resetListScroll()
    void fetchFiles(targetPath)
  }, [fetchFiles, resetListScroll])

  // 读取终端上报的当前工作目录并做路径规范化（不含存在性校验）。
  // 解析链路（terminal.tsx 侧）：OSC 7 > Shell 标题(OSC 0/2)路径提取 > cd 命令推导 > home。
  // 与 resolveTerminalDir 拆分：本函数开销小，供实时跟随轮询做「目录是否变化」快速判断，
  // 避免每次轮询都发起 statInfo。
  const getTerminalCwdCandidate = useCallback(async (): Promise<string | null> => {
    let candidate: string | null = null
    try {
      const asyncCwd = await getTerminalCwdPropRef.current?.()
      if (typeof asyncCwd === 'string' && asyncCwd.trim()) candidate = asyncCwd.trim()
    } catch {
      // 探测异常静默回退
    }
    if (!candidate || !isAbsolutePath(candidate)) return null

    // Windows 目标：终端上报原生盘符路径（C:\Users\foo），文件模块使用
    // POSIX 风格（/C:/Users/foo，后端会再转回 Windows 路径），需对齐
    if (isWindows && /^[a-zA-Z]:[\\/]/.test(candidate)) {
      candidate = `/${candidate.replace(/\\/g, '/')}`
    }
    // 去掉末尾斜杠（根目录除外），与目录树/列表路径表示保持一致
    if (candidate.length > 1 && candidate.endsWith('/')) {
      candidate = candidate.replace(/\/+$/, '')
    }
    return candidate
  }, [isWindows])

  // 完整解析终端目录：候选路径经 statInfo 校验（含符号链接解析），失败返回 null（回退 home）。
  const resolveTerminalDir = useCallback(async (): Promise<string | null> => {
    const candidate = await getTerminalCwdCandidate()
    if (!candidate) return null

    // 校验目录真实存在且为目录，避免把终端标题解析误差导航过去；
    // 符号链接目录解析为绝对目标后再用（cd 进入软链目录的常见场景）
    try {
      const info = await sshService.statInfo(serverId, candidate)
      if (info?.type === 'directory') return candidate
      if (info?.type === 'symbolic link' && info.symlinkTarget) {
        const target = info.symlinkTarget.trim()
        if (!target) return null
        const parent = candidate.slice(0, candidate.lastIndexOf('/')) || '/'
        const resolved = isAbsolutePath(target)
          ? target
          : resolveRelativePath(parent, target)
        const verify = await sshService.statInfo(serverId, resolved).catch(() => null)
        if (verify?.type === 'directory') return resolved
      }
    } catch {
      // stat 失败（路径不存在/无权限）静默回退 home
    }
    return null
  }, [serverId, getTerminalCwdCandidate])

  const loadNodeChildren = useCallback(async (nodePath: string, force = false) => {
    if (treeLoadingRef.current.has(nodePath) && !force) return

    // 从 ref 同步读取最新树状态,不依赖 setState updater 的副作用
    // (React 18 并发模式下 updater 在下次渲染才执行,canLoad 不会被同步设置)
    const currentRoot = treeRootRef.current
    const node = findTreeNode(currentRoot, nodePath)
    if (!node || node.loading) return
    if (node.loaded && !force) return

    // 请求序号：force 重载与进行中的同路径请求并发时，只允许最后一次响应写入树
    const reqId = (treeReqIdRef.current.get(nodePath) || 0) + 1
    treeReqIdRef.current.set(nodePath, reqId)

    treeLoadingRef.current.add(nodePath)
    setTreeRoot(prev => {
      const n = findTreeNode(prev, nodePath)
      if (!n) return prev
      return updateTreeNode(prev, nodePath, x => ({ ...x, loading: true }))
    })

    // 客户端超时兜底:Rust 端 `execute` 虽然包了 30s timeout,
    // 但若 SSH 半死不活(网络分区/russh 内部未检测断连)导致 Promise 永不 settle,
    // 前端也强制清状态,避免左侧 spinner 永远转。
    let timedOut = false
    const clientTimeoutId = window.setTimeout(() => {
      timedOut = true
      treeLoadingRef.current.delete(nodePath)
      setTreeRoot(prev => {
        const n = findTreeNode(prev, nodePath)
        if (!n) return prev
        return updateTreeNode(prev, nodePath, x => ({
          ...x,
          loaded: true,
          loading: false,
        }))
      })
      setError(`${t('fs_err_load_dir_timeout')}: ${nodePath}`)
    }, 35_000)

    let children: TreeNode[] = []
    try {
      const data = await sshService.listFiles(serverId, nodePath)
      if (timedOut || treeReqIdRef.current.get(nodePath) !== reqId) return
      children = fileEntriesToTreeNodes(data)
    } catch (err) {
      if (!timedOut && treeReqIdRef.current.get(nodePath) === reqId) {
        setError(err instanceof Error ? err.message : t('fs_err_load_tree'))
      }
    } finally {
      window.clearTimeout(clientTimeoutId)
      if (!timedOut && treeReqIdRef.current.get(nodePath) === reqId) {
        treeLoadingRef.current.delete(nodePath)
        setTreeRoot(prev => {
          const n = findTreeNode(prev, nodePath)
          if (!n) return prev
          return updateTreeNode(prev, nodePath, x => ({
            ...x,
            children,
            loaded: true,
            loading: false,
          }))
        })
      }
    }
  }, [serverId, t])

  // 初始化：加载根目录 + 解析用户主目录 + 顺序展开祖先节点
  // 保活模式下：等待 isConnected 变为 true 后才执行首次加载
  // 注意：cleanup 中重置 filesInitializedRef，确保 React StrictMode 双执行时
  // 第二次 effect 能正常重新初始化（否则第一次 init 被 cancelled、第二次被 ref 拦截，
  // 导致 currentPath 永不设置、右侧文件列表不刷新）
  useEffect(() => {
    if (!isConnected || isTelnet || isNetwork) return
    if (filesInitializedRef.current) return
    filesInitializedRef.current = true
    // 新会话重置终端目录跟随标记：重连后允许重新跟随新 shell 的目录
    lastRawTerminalCwdRef.current = null
    lastAppliedTerminalDirRef.current = null
    setFilesInitDone(false)
    let cancelled = false
    // 重置状态
    setExpandedPaths(new Set(['/']))
    treeLoadingRef.current.clear()
    setTreeRoot({ path: '/', name: '/', children: [], loaded: false, loading: true })

    const init = async () => {
      // 1. 先加载根目录树
      try {
        const rootData = await sshService.listFiles(serverId, '/')
        if (cancelled) return
        setTreeRoot({
          path: '/',
          name: '/',
          children: fileEntriesToTreeNodes(rootData),
          loaded: true,
          loading: false,
        })
        // 同步更新 ref,使后续 loadNodeChildren 能立即读到最新树状态
        treeRootRef.current = {
          path: '/',
          name: '/',
          children: fileEntriesToTreeNodes(rootData),
          loaded: true,
          loading: false,
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t('fs_err_load_root'))
        setTreeRoot(prev => ({ ...prev, loading: false }))
        // 根目录加载失败时，仍然尝试解析 home 并设置 currentPath
      }

      // 2. 解析用户主目录(15s 超时,防止 SSH execute hang 导致 init 卡死)
      let home = '/'
      let homeTimeoutId: ReturnType<typeof setTimeout> | undefined
      try {
        const homePromise = sshService.getHomeDirectory(serverId)
        const resolved = await Promise.race([
          homePromise,
          new Promise<string>((_, reject) =>
            { homeTimeoutId = setTimeout(() => reject(new Error('timeout')), 15_000) }
          ),
        ])
        if (cancelled) return
        if (resolved && resolved !== '/') {
          home = resolved
        }
      } catch {
        // 解析失败/超时则使用 /
      } finally {
        if (homeTimeoutId) clearTimeout(homeTimeoutId)
      }

      if (cancelled) return
      setCurrentPath(home)

      // 3. 如果 home 不是根目录,展开所有祖先 + home,并顺序加载
      if (home !== '/') {
        const parts = home.split('/').filter(Boolean)
        const ancestors: string[] = []
        let acc = ''
        for (const part of parts) {
          acc += '/' + part
          ancestors.push(acc)
        }
        setExpandedPaths(prev => {
          const next = new Set(prev)
          ancestors.forEach(p => next.add(p))
          return next
        })
        // 顺序加载每一层祖先,确保父节点先加载完,子节点才存在于树中
        for (const ancestorPath of ancestors) {
          if (cancelled) break
          await loadNodeChildren(ancestorPath)
        }
      }

      // init 完成：通知"激活直达"逻辑可以安全导航。
      // 早于此的导航会被上面的 setCurrentPath(home) 覆盖，必须等这一步
      if (!cancelled) setFilesInitDone(true)
    }
    init()
    return () => {
      cancelled = true
      // 重置初始化标记：
      // 1. React StrictMode 双执行：第一次 effect 被 cleanup 取消（cancelled=true），
      //    重置 ref 让第二次 effect 能正常重新初始化
      // 2. 依赖变化（isConnected 断开→重连）：重置 ref 允许重连后重新加载文件列表
      filesInitializedRef.current = false
    }
  }, [isConnected, serverId, loadNodeChildren, isTelnet, isNetwork, t])

  // 终端目录跟随（与成熟产品一致）：OSC 7 / 标题 / cd 拦截触发即时推送跟随，
  // 800ms 轮询作为兜底（覆盖无 OSC 7 的 shell、漏报等场景）。
  // 1. 触发时机为"面板激活"而非连接建立时——此刻终端已运行良久，OSC 7/标题追踪的
  //    cwd 一定就绪；连接时立即解析大概率只能拿到 home 兜底值；
  // 2. filesInitDone 守卫：init 未完成时导航会被 init 的 setCurrentPath(home) 覆盖，
  //    等 init 置位后本 effect 会因依赖变化自动重跑，补上直达；
  // 3. lastRawTerminalCwdRef / lastAppliedTerminalDirRef 双守卫：
  //    - 终端目录没变时保留用户的手动导航，不被拽回；
  //    - 快速通道只在原始 cwd 变化时才发起 statInfo 校验，避免每轮空转打后端；
  // 4. 重连时 init 重置两个标记，允许重新直达。
  useEffect(() => {
    if (!isActive || !isConnected || isTelnet || isNetwork) return
    if (!filesInitDone) return
    let disposed = false
    let inFlight = false

    const followTerminalDir = async () => {
      if (disposed || inFlight) return
      inFlight = true
      try {
        // 快速通道：先看原始 cwd 是否变化，未变化则不做任何校验/导航
        const candidate = await getTerminalCwdCandidate()
        if (disposed || !candidate) return
        if (candidate === lastRawTerminalCwdRef.current) return
        lastRawTerminalCwdRef.current = candidate

        const dir = await resolveTerminalDir()
        if (disposed || !dir) return
        // 终端目录未变化：保留用户在文件模块内的手动导航，不重复直达
        if (dir === lastAppliedTerminalDirRef.current) return
        lastAppliedTerminalDirRef.current = dir
        // 校验失败（null）时保持 init 设置的 home，属于预期的静默回退
        if (dir !== currentPathRef.current) {
          navigateTo(dir)
        }
      } catch {
        // 探测异常静默，等待下一轮
      } finally {
        inFlight = false
      }
    }

    void followTerminalDir() // 打开时立即直达一次
    // 主通道：订阅终端 cwd 变化推送，即时跟随
    const unsubscribe = subscribeTerminalCwdRef.current?.(() => {
      void followTerminalDir()
    })
    // 兜底：800ms 轮询（覆盖推送漏报的 shell）
    const interval = window.setInterval(followTerminalDir, 800)
    return () => {
      disposed = true
      unsubscribe?.()
      window.clearInterval(interval)
    }
  }, [isActive, isConnected, isTelnet, isNetwork, filesInitDone, getTerminalCwdCandidate, resolveTerminalDir, navigateTo])

  // 当 currentPath 变化时加载文件列表（跳过已由 navigateTo 同步发起的请求）
  useEffect(() => {
    if (currentPath && lastFetchedPathRef.current !== currentPath) {
      lastFetchedPathRef.current = currentPath
      fetchFiles(currentPath)
    }
  }, [currentPath, fetchFiles])

  // 当 currentPath 变化时,顺序展开并加载左侧目录树的祖先节点
  // （用户在右侧进入子目录或初始化打开 home 时,左侧目录树跟随展开）
  // 性能优化：祖先链加载不阻塞右侧文件列表渲染，延迟到下一帧执行
  useEffect(() => {
    if (!treeRoot.loaded) return
    if (!currentPath || currentPath === '/') return
    const parts = currentPath.split('/').filter(Boolean)
    const ancestors: string[] = []
    let acc = ''
    for (const part of parts) {
      acc += '/' + part
      ancestors.push(acc)
    }
    setExpandedPaths(prev => {
      const next = new Set(prev)
      ancestors.forEach(p => next.add(p))
      return next
    })
    let cancelled = false
    const loadAncestorsSequentially = async () => {
      // 顺序加载:每层加载完成后下一层的父节点才存在于树中
      for (const ancestorPath of ancestors) {
        if (cancelled) break
        await loadNodeChildren(ancestorPath)
      }
    }
    // 用 setTimeout(0) 让出当前渲染帧，确保右侧文件列表先渲染再后台加载树
    // 这样用户进入目录时右侧能立即显示，左侧目录树稍后异步更新
    const timer = setTimeout(() => {
      void loadAncestorsSequentially()
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [currentPath, loadNodeChildren, treeRoot.loaded])

  // 监听传输进度
  useEffect(() => {
    if (!isActive) {
      setPackingTarget(null)
      return
    }
    const unsub = sshService.onTransferProgress((data) => {
      // 文件页只消费归档下载阶段；普通上传/SFTP 面板的进度由各自 UI 处理。
      if (data.type !== 'download') return
      if (data.phase === 'packing') {
        setPackingTarget({ name: data.fileName || '', fileCount: data.total || 0 })
        return
      }
      if (data.phase === 'packed') {
        setPackingTarget(null)
        return
      }
      if (data.done) {
        setPackingTarget(null)
        return
      }
    })
    // 目录传输部分成功：按 serverId 过滤，避免把 SFTP 面板的传输提示到本模块
    const unsubFailures = sshService.onTransferFailures((data) => {
      if (data.serverId !== serverId) return
      if (!data.failures || data.failures.length === 0) return
      const first = data.failures[0]
      toastRef.current.warning(
        `部分完成：成功 ${data.succeeded}，失败 ${data.failures.length}${first ? `（${first.path}: ${first.error}）` : ''}`,
        5000,
      )
    })
    return () => { unsub?.(); unsubFailures?.() }
  }, [isActive, serverId])

  // === 拖拽上传 ===
  const handleUpload = useCallback(async (selectedPaths: string[]) => {
    setTransferLoading('upload')
    // 本模块拿不到后端 transferId，用进出计数让「关闭窗口」能拦截正在进行的传输
    sshService.beginBusyOperation()
    try {
      const result = await sshService.uploadFromPaths(
        serverId,
        currentPath,
        selectedPaths,
        undefined,
        sftpTransferConcurrency,
      )
      if (result.success && result.results) {
        const failed = result.results.filter((r) => !r.success)
        const successCount = result.results.filter((r) => r.success).length
        if (failed.length > 0) {
          setError(`${t('fs_err_upload')}: ${failed.map((r) => r.fileName).join(', ')}`)
        } else if (successCount === 0) {
          // 空目录没有任何文件条目，不能报“上传完成”
          toastRef.current.warning('未上传任何文件（目标可能是空目录）')
        } else {
          // E6: 上传完成 toast 提示
          toastRef.current.success(`上传完成,共 ${successCount} 个文件`)
        }
        fetchFiles(currentPath)
        if (expandedPaths.has(currentPath)) {
          loadNodeChildren(currentPath, true)
        }
      } else if (!result.success && !isUserCanceledError(result.error)) {
        setError(`${t('fs_err_upload')}: ${result.error || t('common_unknown_error')}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fs_err_upload'))
    } finally {
      sshService.endBusyOperation()
      setTransferLoading(null)
    }
  }, [serverId, currentPath, fetchFiles, loadNodeChildren, expandedPaths, t, sftpTransferConcurrency])

  // === 原生文件选择器上传（调用系统自带资源管理器）===
  const handleNativeUpload = useCallback(async (directory: boolean = false) => {
    try {
      const selected = await openDialog({
        multiple: true,
        directory,
        title: directory ? t('fs_select_upload_folder') : t('fs_select_upload_file'),
      })
      if (!selected) return // 用户取消

      const paths = Array.isArray(selected) ? selected : [selected]
      if (paths.length === 0) return

      await handleUpload(paths)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fs_err_select_file'))
    }
  }, [handleUpload, t])

  useEffect(() => {
    // 保活的隐藏工作台不注册 WebView 全局拖拽事件，避免工作台越多监听器越多。
    if (!isActive) {
      setDragOver(false)
      return
    }
    const webview = getCurrentWebview()
    let disposed = false
    let unlisten: (() => void) | undefined
    void webview.onDragDropEvent((event) => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        setDragOver(true)
      } else if (event.payload.type === 'drop') {
        setDragOver(false)
        const paths = event.payload.paths
        if (paths && paths.length > 0) {
          // Windows + WebView2 拖拽文件夹时会生成 inputFiles.lst 临时文件,
          // 无法获取文件夹真实路径,需过滤并提示用户用"上传文件夹"按钮
          const realPaths = paths.filter(p => !p.toLowerCase().endsWith('inputfiles.lst'))
          if (realPaths.length === 0) {
            setError(t('fs_err_folder_unsupported'))
          } else {
            void handleUpload(realPaths)
          }
        }
      } else if (event.payload.type === 'leave') {
        setDragOver(false)
      }
    }).then((cleanup) => {
      if (disposed) cleanup()
      else unlisten = cleanup
    }).catch((err) => {
      console.error('[FilesModule] Failed to register drag/drop listener:', err)
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [handleUpload, isActive, t])

  // === 列排序 ===
  // D5: 使用 useDeferredValue 对搜索输入做 debounce,避免大量文件时每次按键触发重排卡顿
  const deferredSearch = useDeferredValue(searchQuery)
  const sortedFiles = useMemo(() => {
    const filtered = files.filter(f => {
      if (!showHidden && f.name.startsWith('.')) return false
      if (deferredSearch && !f.name.toLowerCase().includes(deferredSearch.toLowerCase())) return false
      return true
    })
    return [...filtered].sort((a, b) => {
      // 目录始终排在前面
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      let cmp = 0
      switch (sortField) {
        case 'name': cmp = a.name.localeCompare(b.name); break
        case 'size': cmp = a.size - b.size; break
        case 'modifiedTime': cmp = a.modifiedTime.localeCompare(b.modifiedTime); break
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })
  }, [files, deferredSearch, sortField, sortDirection, showHidden])

// toggleSort provided by useFileExplorerPreferences

  const rowVirtualizer = useVirtualizer({
    count: sortedFiles.length,
    getScrollElement: () => scrollContainerRef.current,
    // 紧凑行高初值（text-sm 20px + py-1×2 8px + 边框 1px ≈ 29px，动态测量会自动校正）
    estimateSize: () => 30,
    overscan: 10,
  })

  // ── 框选（marquee）多选：空白处左键拖动框选文件（Ctrl+拖动追加） ──
  const {
    marquee: fileMarquee,
    onMouseDown: handleFileMarqueeMouseDown,
    consumeMarqueeClick: consumeFileMarqueeClick,
  } = useMarqueeSelection({
    itemSelector: 'tr[data-file-path]',
    getItemId: (el) => el.dataset.filePath!,
    getSelection: () => new Set(selectedFiles),
    setSelection: (ids) => setSelectedFiles(Array.from(ids)),
    containerRef: scrollContainerRef,
  })

  // 模块重新显示（从终端切回文件/再次打开弹窗）时同步虚拟滚动内部偏移，
  // 避免顶部出现空白 spacer、首行被推下去
  useEffect(() => {
    if (!isActive) return
    resetListScroll(true)
  }, [isActive, resetListScroll])


  // === 目录树宽度调整 ===
  const startResize = (e: React.MouseEvent) => {
    // 只响应左键
    if (e.button !== 0) return
    e.preventDefault()
    resizeRef.current = { startX: e.clientX, startWidth: treeWidth }
    const onMouseMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return
      const delta = ev.clientX - resizeRef.current.startX
      const newWidth = Math.max(160, Math.min(480, resizeRef.current.startWidth + delta))
      setTreeWidth(newWidth)
    }
    const onMouseUp = () => {
      resizeRef.current = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      resizeHandlersRef.current.move = null
      resizeHandlersRef.current.up = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    // 保存到 ref 以便组件卸载时清理
    resizeHandlersRef.current.move = onMouseMove
    resizeHandlersRef.current.up = onMouseUp
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // 展开/折叠目录节点
  const toggleTreeNode = (nodePath: string) => {
    navigateTo(nodePath)
    const node = findTreeNode(treeRoot, nodePath)
    const isExpanded = expandedPaths.has(nodePath)

    if (isExpanded) {
      if (node?.loading) return
      if (node && !node.loaded) {
        void loadNodeChildren(nodePath)
        return
      }
      setExpandedPaths(prev => {
        const next = new Set(prev)
        next.delete(nodePath)
        return next
      })
      return
    }

    setExpandedPaths(prev => new Set(prev).add(nodePath))
    if (!node?.loaded) {
      void loadNodeChildren(nodePath)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '-'
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)} GB`
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${bytes} B`
  }

  const permissionBadge = (perm?: string) => <PermissionBadge perm={perm} />

  // 判断文件是否可在预览弹框内编辑：文本类扩展名且不超 2MB（二进制扩展名拦截，避免加载乱码）
  const isEditableFile = (file: FileEntry): boolean => {
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (BINARY_EXT_SET.has(ext) && !TEXT_EXT_SET.has(ext)) return false
    return file.size <= 2 * 1024 * 1024
  }

  // 应用解码结果到编辑器状态（refs 供异步保存逻辑读取最新值）
  const applyDecodedText = (text: string, encoding: string, eol: TextEol, hasBom: boolean, autoDetected = false) => {
    editFileEncodingRef.current = encoding
    editFileEolRef.current = eol
    editFileHasBomRef.current = hasBom
    // 自动检测兜底得到的编码（GB18030 等）不可靠，保存前需用户确认
    autoDetectedEncodingRef.current = autoDetected
    encodingSaveAckRef.current = false
    setEditFileEncoding(encoding)
    setEditFileEol(eol)
    setEditFileHasBom(hasBom)
    editDirtyRef.current = false
    setEditContent(text)
  }

  // 统一的文件查看器：预览 + 编辑一体（与 SFTP 面板一致），编辑在弹框内进行。
  // mode='edit' 直接进入编辑态（双击/F4/右键编辑）；'preview' 进入预览态（右键预览/大文件降级）。
  const openViewer = async (file: FileEntry, mode: 'preview' | 'edit') => {
    // 请求序号：连续快速打开多个文件时，只允许最后一次请求写入编辑器状态
    const reqId = ++viewerReqIdRef.current
    const kind = getFileKind(file.name)
    if (kind === 'unsupported') {
      toastRef.current.warning(t('fs_preview_unsupported'))
      return
    }
    const maxSize = 100 * 1024 * 1024
    if (file.size > maxSize) {
      toastRef.current.warning(`${t('fs_preview_too_large')} (${t('fs_preview_download_hint')})`)
      return
    }
    // B7: 符号链接的 size 字段并不可信(可能为 0 或指向目标大小),
    // 且编辑符号链接会破坏链接关系,这里直接禁止编辑符号链接
    let editable = isEditableFile(file)
    if (file.permissions?.startsWith('l')) {
      if (mode === 'edit') {
        toastRef.current.warning('不支持编辑符号链接')
        return
      }
      editable = false
    }
    if (mode === 'edit' && !editable) {
      // 大文件/二进制扩展名：编辑降级为只读预览
      toastRef.current.warning(
        file.size > 2 * 1024 * 1024
          ? `${t('fs_err_file_too_large')} (${formatSize(file.size)})`
          : '不支持编辑此类型文件',
      )
      mode = 'preview'
    }
    setPreviewFile(file)
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewRawBytes(null)
    setViewerMode(mode)
    setViewerEditable(false) // 待文本解码成功后再置位，避免二进制内容闪现编辑态
    try {
      const base64 = await sshService.readBinaryFile(serverId, file.path)
      // 过期响应直接丢弃：用户已打开另一个文件，不能覆盖新文件的编辑内容
      if (reqId !== viewerReqIdRef.current) return
      const bytes = base64ToBytes(base64)
      setPreviewRawBytes(bytes)
      if (editable) {
        // 解码 + 编码检测（自动检测不准时可在弹框内手动切换编码重新打开）
        const decoded = decodeTextFile(bytes)
        if (isBinaryContent(decoded.text)) {
          // 文本扩展名但实际是二进制内容：降级为预览态
          if (mode === 'edit') {
            toastRef.current.warning('检测到文件包含二进制内容，仅支持预览')
          }
          setViewerEditable(false)
          setViewerMode('preview')
        } else {
          // 仅 GB18030 兜底属于“自动检测猜测”，保存前需用户确认
          applyDecodedText(decoded.text, decoded.encoding, decoded.eol, decoded.hasBom, decoded.encoding === 'gb18030')
          setViewerEditable(true)
          setViewerMode(mode)
        }
      }
    } catch (e) {
      if (reqId === viewerReqIdRef.current) {
        setPreviewError((e as Error).message || t('fs_preview_failed'))
      }
    } finally {
      if (reqId === viewerReqIdRef.current) setPreviewLoading(false)
    }
  }

  // 文件预览：不论是文档、多媒体还是文本/日志文件，统一在预览弹框中浏览
  const openPreview = (file: FileEntry) => {
    void openViewer(file, 'preview')
  }

  // 文件编辑：与预览共用同一弹框，直接进入编辑态
  const openEditor = (file: FileEntry) => {
    void openViewer(file, 'edit')
  }

  // 手动切换编码重新打开（Notepad++ 式「以 XX 编码打开」）：自动检测不准时的兜底。
  // dirty 时由确认框把关（pendingEncodingChange），此处直接执行重读
  const reopenWithEncoding = async (encoding: string) => {
    if (!previewFile) return
    const reqId = ++viewerReqIdRef.current
    setEditLoading(true)
    try {
      const base64 = await sshService.readBinaryFile(serverId, previewFile.path)
      if (reqId !== viewerReqIdRef.current) return
      const bytes = base64ToBytes(base64)
      const decoded = decodeTextWithEncoding(bytes, encoding)
      if (isBinaryContent(decoded.text)) {
        toastRef.current.warning('该编码下文件包含二进制内容，请选择其他编码')
        return
      }
      // 用户显式指定的编码是可信的，保存时无需再确认
      applyDecodedText(decoded.text, encoding, decoded.eol, decoded.hasBom, false)
      // 之前因二进制内容被判为只读的文本文件，显式选对编码后应恢复可编辑
      if (isEditableFile(previewFile)) {
        setViewerEditable(true)
      }
    } catch (err) {
      if (reqId === viewerReqIdRef.current) {
        setError(err instanceof Error ? err.message : t('fs_err_read'))
      }
    } finally {
      if (reqId === viewerReqIdRef.current) setEditLoading(false)
    }
  }

  // 编辑器内容变更入口：除标记 dirty 外与 setEditContent 等价
  const handleEditContentChange = (val: string) => {
    editDirtyRef.current = true
    setEditContent(val)
  }

  const handleSave = async () => {
    if (!previewFile) return
    const encoding = editFileEncodingRef.current
    // 自动检测兜底编码（GB18030 等）不可靠：首次保存必须显式确认，
    // 否则“打开 → 保存”一次就会把原文件按错误编码不可逆转码
    if (autoDetectedEncodingRef.current && encoding !== 'utf-8' && !encodingSaveAckRef.current) {
      setPendingEncodingSave(true)
      return
    }
    setEditLoading(true)
    try {
      const backupResult = await sshService.backupFile(serverId, previewFile.path)
      if (backupResult.exitCode !== 0) {
        toastRef.current.error(`${t('fs_err_backup')}: ${backupResult.stderr || t('common_unknown_error')}`, 1500)
        return
      }
      // 按原编码/换行符/BOM 回写：UTF-8 无 BOM 直接写文本，其余走 ::base64:: 原始字节写回
      const normalized = normalizeEol(editContent, editFileEolRef.current)
      let contentToWrite: string
      if (encoding === 'utf-8' && !editFileHasBomRef.current) {
        contentToWrite = normalized
      } else {
        const bytes = encodeTextFile(normalized, encoding, editFileHasBomRef.current)
        contentToWrite = `::base64::${bytesToBase64(bytes)}`
      }
      const result = await sshService.writeFile(serverId, previewFile.path, contentToWrite)
      if (result.exitCode !== 0) {
        toastRef.current.error(`${t('fs_err_save')}: ${result.stderr || t('common_unknown_error')}`, 1500)
      } else {
        toastRef.current.success(t('fs_save_success'), 1500)
        editDirtyRef.current = false
        // 刷新文件所在父目录（而非 currentPath）：树状视图编辑深层文件时，
        // currentPath 可能与编辑文件不在同一层级，备份文件需在父目录才能看到
        const parentPath = previewFile.path.includes('/')
          ? previewFile.path.substring(0, previewFile.path.lastIndexOf('/')) || '/'
          : '/'
        fetchFiles(parentPath)
        if (expandedPaths.has(parentPath) && parentPath !== currentPath) {
          loadNodeChildren(parentPath, true)
        }
      }
    } catch (err) {
      toastRef.current.error(err instanceof Error ? err.message : t('fs_err_save'), 1500)
    } finally {
      setEditLoading(false)
    }
  }

  const handleBackup = async (path: string) => {
    try {
      const result = await sshService.backupFile(serverId, path)
      if (result.exitCode !== 0) {
        toastRef.current.error(`${t('fs_err_backup')}: ${result.stderr || t('common_unknown_error')}`, 1500)
        return
      }
      // 成功：后端 stdout 返回备份文件完整路径，提示用户备份位置
      toastRef.current.success(`${t('fs_backup_success')}: ${result.stdout}`, 1500)
      // 刷新父目录列表，使备份文件立即可见（无需手动刷新）
      const parentPath = path.includes('/')
        ? path.substring(0, path.lastIndexOf('/')) || '/'
        : '/'
      if (parentPath === currentPath) {
        fetchFiles(currentPath)
      } else if (expandedPaths.has(parentPath)) {
        loadNodeChildren(parentPath, true)
      }
    } catch (err) {
      toastRef.current.error(err instanceof Error ? err.message : t('fs_err_backup'), 1500)
    }
  }

  const handleNewItem = async () => {
    if (!newItemName.trim()) return
    // B1: 校验名称不能包含路径分隔符,也不能为 . 或 ..
    if (newItemName.includes('/') || newItemName.includes('\\')) {
      toastRef.current.error(t('common_name_too_long_separator'))
      return
    }
    if (newItemName === '.' || newItemName === '..') {
      toastRef.current.error(t('common_name_too_long_separator'))
      return
    }
    const fullPath = currentPath === '/' ? `/${newItemName}` : `${currentPath}/${newItemName}`
    try {
      if (newItemType === 'dir') {
        const result = await sshService.mkdir(serverId, fullPath)
        if (result.exitCode !== 0) {
          setError(`${t('fs_err_mkdir')}: ${result.stderr || t('common_unknown_error')}`)
          return
        }
      } else {
        const result = await sshService.writeFile(serverId, fullPath, '')
        if (result.exitCode !== 0) {
          // B2: 新建文件分支应使用保存失败的错误码,而非 mkdir
          setError(`${t('common_save_failed')}: ${result.stderr || t('common_unknown_error')}`)
          return
        }
      }
      setShowNewItem(false)
      setNewItemName('')
      fetchFiles(currentPath)
      if (expandedPaths.has(currentPath)) {
        loadNodeChildren(currentPath, true)
      } else if (currentPath === '/') {
        loadNodeChildren('/', true)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fs_err_mkdir'))
    }
  }

  const handleRename = async (oldPath: string, newName: string) => {
    if (!newName.trim()) return
    // B1: 校验名称不能包含路径分隔符,也不能为 . 或 ..
    if (newName.includes('/') || newName.includes('\\')) {
      toastRef.current.error(t('common_name_too_long_separator'))
      return
    }
    if (newName === '.' || newName === '..') {
      toastRef.current.error(t('common_name_too_long_separator'))
      return
    }
    const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/')) || '/'
    const newPath = parentPath === '/' ? `/${newName}` : `${parentPath}/${newName}`
    try {
      const result = await sshService.renameFile(serverId, oldPath, newPath)
      if (result.exitCode !== 0) {
        setError(`${t('fs_err_rename')}: ${result.stderr || t('common_unknown_error')}`)
      } else {
        fetchFiles(currentPath)
        if (expandedPaths.has(parentPath)) {
          loadNodeChildren(parentPath, true)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fs_err_rename'))
    }
  }

  // 进入内联重命名态（预填原文件名），供 F2 / 右键 / 再次点击共用
  const startRename = useCallback((file: { path: string; name: string }) => {
    setRenamingFile(file.path)
    setRenameValue(file.name)
  }, [])

  const handleDelete = useCallback((paths: string[]) => {
    if (paths.length === 0) return
    // 防御：只允许删除当前目录列表中真实存在的条目。
    // 选中集一旦残留上一目录的路径（目录切换/刷新竞态），这里会直接拦截，避免误删远端文件。
    const present = new Set(files.map(f => f.path))
    const valid = paths.filter(p => present.has(p))
    if (valid.length === 0) return
    // B4: 客户端预检危险根路径,弹 toast.warning 提示用户
    const hasDangerous = valid.some(p => isDangerousPath(p))
    if (hasDangerous) {
      toastRef.current.warning(t('common_dangerous_path_warn'))
    }
    setPendingDelete(valid)
  }, [files, t])

  const confirmDelete = async () => {
    console.log('[ConfirmDelete] Starting deletion...', pendingDelete)
    const targets = pendingDelete
    setPendingDelete(null)
    if (!targets || targets.length === 0) {
      console.log('[ConfirmDelete] No targets to delete')
      return
    }

    // 检查当前所在路径（或其父级目录）是否被删除
    const isCurrentPathDeleted = targets.some(targetPath => {
      // B6: 删除根路径时,当前路径必然被影响,startsWith 检查会漏掉 '/' 情况,单独处理
      if (targetPath === '/') return true
      return currentPath === targetPath || currentPath.startsWith(targetPath + '/')
    })
    console.log('[ConfirmDelete] isCurrentPathDeleted:', isCurrentPathDeleted, 'currentPath:', currentPath)

    // 立即清空当前选中项，避免删除过程中对 UI 产生竞态/二次删除
    setSelectedFiles([])

    const errors: string[] = []
    try {
      console.log('[ConfirmDelete] Invoking concurrent delete for targets:', targets)
      // E7: 用并发数控制替代 Promise.all，避免批量删除时 SSH 通道拥堵
      const deleteTasks = targets.map((path) => async () => {
        try {
          console.log('[ConfirmDelete] Deleting file:', path)
          const result = await sshService.deleteFile(serverId, path)
          console.log('[ConfirmDelete] Delete result for:', path, result)
          if (result.exitCode !== 0) {
            return { path, error: result.stderr || t('common_unknown_error') }
          }
        } catch (err) {
          console.error('[ConfirmDelete] Delete failed for:', path, err)
          return { path, error: err instanceof Error ? err.message : t('fs_err_delete') }
        }
        return null
      })
      const results = await runWithConcurrency(deleteTasks, FILE_TRANSFER_CONCURRENCY)

      console.log('[ConfirmDelete] Concurrent delete completed. isUnmounted:', isUnmountedRef.current)
      if (isUnmountedRef.current) return

      results.forEach(res => {
        if (res) {
          errors.push(`${res.path}: ${res.error}`)
        }
      })
    } catch (e) {
      console.error('[ConfirmDelete] Exception inside Promise.all:', e)
      if (isUnmountedRef.current) return
      errors.push(`${t('fs_err_delete')}: ${e instanceof Error ? e.message : t('common_unknown_error')}`)
    }

    if (isUnmountedRef.current) return

    if (errors.length > 0) {
      console.warn('[ConfirmDelete] Deletion encountered errors:', errors)
      setError(`${t('fs_err_delete')}\n${errors.join('\n')}`)
    }

    // 计算下一个需要跳转的路径（如果是当前目录被删，回退到其父级目录）
    let nextPath = currentPath
    if (isCurrentPathDeleted) {
      const matchedTarget = targets.find(targetPath => currentPath === targetPath || currentPath.startsWith(targetPath + '/'))
      if (matchedTarget) {
        nextPath = matchedTarget.substring(0, matchedTarget.lastIndexOf('/')) || '/'
      }
      console.log('[ConfirmDelete] Redirecting to parent folder:', nextPath)
      setCurrentPath(nextPath)
    } else {
      // 否则，直接刷新当前目录列表
      console.log('[ConfirmDelete] Refreshing current folder:', currentPath)
      fetchFiles(currentPath)
    }

    // 刷新涉及的父目录（去重）
    const parentPaths = new Set<string>()
    targets.forEach(path => {
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '/'
      parentPaths.add(parentPath)
    })
    console.log('[ConfirmDelete] Refreshing directory tree parent nodes:', Array.from(parentPaths))
    parentPaths.forEach(parentPath => {
      if (expandedPaths.has(parentPath)) {
        console.log('[ConfirmDelete] Reloading tree node children for:', parentPath)
        loadNodeChildren(parentPath, true)
      }
    })
  }

  const handleDownload = async (file: FileEntry) => {
    setTransferLoading(file.path)
    // E6: 下载开始 toast 提示
    toastRef.current.info(`开始下载 ${file.name}...`)
    sshService.beginBusyOperation()
    try {
      const result = await sshService.downloadFile(serverId, file.path, undefined, sftpTransferConcurrency)
      if (!result.success && !isUserCanceledError(result.error)) {
        setError(`${t('fs_err_download')}: ${result.error || t('common_unknown_error')}`)
      } else if (result.success) {
        // E6: 下载完成 toast 提示
        toastRef.current.success(`下载完成: ${file.name}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fs_err_download'))
    } finally {
      sshService.endBusyOperation()
      setTransferLoading(null)
    }
  }

  const handleDownloadMultiple = async (paths: string[]) => {
    try {
      const selected = await openDialog({
        directory: true,
        // B3: 批量下载对话框标题应使用"选择下载目录",该 i18n key 不存在故用内联中文
        title: '选择下载目录',
      })
      if (!selected) return

      const destFolder = Array.isArray(selected) ? selected[0] : selected
      if (!destFolder) return

      setTransferLoading('download')
      // E6: 批量下载开始 toast 提示
      toastRef.current.info(`开始下载 ${paths.length} 个文件...`)

      const selectedFileEntries = files.filter(f => paths.includes(f.path))
      if (selectedFileEntries.length === 0) {
        // 选中集与当前目录列表不一致（列表已刷新）：不能静默跳过还提示成功
        toastRef.current.warning('未找到可下载的文件，请刷新后重试')
        setTransferLoading(null)
        return
      }

      // E7: 用并发数控制替代 Promise.all，避免批量下载时 SSH 通道拥堵
      const downloadTasks = selectedFileEntries.map((file) => async () => {
        try {
          return await sshService.downloadFile(serverId, file.path, destFolder, sftpTransferConcurrency)
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
      })

      sshService.beginBusyOperation()
      const results = await runWithConcurrency(downloadTasks, sftpTransferConcurrency)
      const failed = results.filter(r => !r.success && !isUserCanceledError(r.error))
      const succeeded = results.filter(r => r.success).length
      if (failed.length > 0) {
        setError(`${t('fs_err_download')}: ${failed.map(r => r.error || t('common_unknown_error')).join(', ')}`)
      } else if (succeeded === 0) {
        toastRef.current.warning('没有文件被下载')
      } else {
        // E6: 批量下载完成 toast 提示（按实际成功数，而非选中数）
        toastRef.current.success(`下载完成,共 ${succeeded} 个文件`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fs_err_download'))
    } finally {
      sshService.endBusyOperation()
      setTransferLoading(null)
      setSelectedFiles([])
    }
  }

  const handleDownloadArchive = async (file: FileEntry, format: string = 'tar.gz') => {
    setTransferLoading(file.path)
    // E6: 打包下载开始 toast 提示
    toastRef.current.info(`开始打包下载 ${file.name} (${format})...`)
    try {
      const result = await sshService.downloadArchive(serverId, file.path, format)
      if (!result.success && !isUserCanceledError(result.error)) {
        setError(`${t('fs_err_pack')}: ${result.error || t('common_unknown_error')}`)
      } else if (result.success) {
        // E6: 打包下载完成 toast 提示
        toastRef.current.success(`打包下载完成: ${file.name}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fs_err_pack'))
    } finally {
      setTransferLoading(null)
      setPackingTarget(null)
    }
  }

  // 解压归档文件并自动刷新目录
  const handleExtractArchive = async (file: FileEntry) => {
    if (extractingFile) return
    setExtractingFile(file.path)
    toastRef.current.info(`${t('fs_extract_archive') || t('sftp_extract_archive') || '解压'}: ${file.name}...`)
    try {
      const result = await sshService.extractArchive(serverId, file.path)
      if (result.success) {
        toastRef.current.success(result.message || t('sftp_extract_success') || '解压完成')
        handleRefresh()
      } else {
        const errMsg = result.error || result.message || t('sftp_extract_failed') || '解压失败'
        toastRef.current.error(errMsg)
        setError(errMsg)
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : t('sftp_extract_failed') || '解压失败'
      toastRef.current.error(errMsg)
      setError(errMsg)
    } finally {
      setExtractingFile(null)
    }
  }

  // 打开文件属性对话框
  const handleShowProperties = async (file: FileEntry) => {
    const reqId = ++statReqIdRef.current
    setPropertiesFile(file)
    setStatInfo(null)
    setStatLoading(true)
    try {
      const info = await sshService.statInfo(serverId, file.path)
      // 丢弃过期响应：连续查看两个文件的属性时不能串数据
      if (reqId !== statReqIdRef.current) return
      setStatInfo(info)
    } catch (err) {
      if (reqId === statReqIdRef.current) {
        setError(err instanceof Error ? err.message : t('fs_err_props'))
      }
    } finally {
      if (reqId === statReqIdRef.current) setStatLoading(false)
    }
  }

  // 书签操作（委托给 useFileExplorerPreferences 统一处理）
  const handleAddBookmark = useCallback((path: string) => {
    filePrefs.addBookmark(path, {
      maxLimitMsg: t('sftp_bookmarks_max_limit') || '书签数量已达上限 50',
      successMsg: t('sftp_bookmark_added') || '已添加书签',
    })
  }, [filePrefs, t])

  const handleRemoveBookmark = useCallback((path: string) => {
    filePrefs.removeBookmark(path, {
      infoMsg: t('sftp_bookmark_removed') || '已移除书签',
    })
  }, [filePrefs, t])

  const toggleBookmark = useCallback((path?: string) => {
    const target = path || currentPath
    if (!target) return
    filePrefs.toggleBookmark(target, {
      maxLimitMsg: t('sftp_bookmarks_max_limit') || '书签数量已达上限 50',
      successMsg: t('sftp_bookmark_added') || '已添加书签',
      infoMsg: t('sftp_bookmark_removed') || '已移除书签',
    })
  }, [filePrefs, currentPath, t])

  // 刷新
  const handleRefresh = useCallback(() => {
    fetchFiles(currentPath)
    if (expandedPaths.has(currentPath)) {
      loadNodeChildren(currentPath, true)
    }
  }, [currentPath, fetchFiles, loadNodeChildren, expandedPaths])

  // === 键盘快捷键 ===
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 工作台模块采用保活隐藏；只有当前可见的文件模块可以响应快捷键，
      // 防止用户在终端/监控页按 F2、Delete 时误操作远程文件。
      if (!isActive) return
      // 在输入框中不触发快捷键
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (previewFile) return

      const { matchesAction } = useShortcutStore.getState()

      if (matchesAction(e, 'sftp.refresh')) {
        e.preventDefault()
        handleRefresh()
      }
      // F2 重命名:仅单选时生效,多选时不触发
      if (matchesAction(e, 'sftp.rename') && selectedFiles.length === 1) {
        e.preventDefault()
        const file = files.find(f => f.path === selectedFiles[0])
        if (file) {
          startRename(file)
        }
      }
      if (matchesAction(e, 'sftp.delete') && selectedFiles.length > 0) {
        e.preventDefault()
        handleDelete(selectedFiles)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedFiles, files, previewFile, handleRefresh, handleDelete, isActive])

  // D1: 扁平化目录树,限制最大显示节点数,避免深目录展开后 DOM 节点激增
  const flattenedTree = useMemo(
    () => flattenTree(treeRoot, expandedPaths),
    [treeRoot, expandedPaths]
  )
  const visibleTreeNodes = flattenedTree.slice(0, MAX_TREE_NODES)
  const hasMoreTreeNodes = flattenedTree.length > MAX_TREE_NODES

  // 排序图标
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 text-muted-foreground/40" />
    return sortDirection === 'asc'
      ? <ArrowUp className="h-3 w-3 text-primary" />
      : <ArrowDown className="h-3 w-3 text-primary" />
  }

  // 格式化错误信息为友好的中文弹框内容（过滤网络连接/超时类错误，此类状态由工作区状态机/重连条承载，避免弹出侵入式全屏模态框）
  const shouldShowDialog = error && !isSftpConnectionError(error)
  const formattedError = shouldShowDialog ? formatSftpError(error) : null

  if (isTelnet || isNetwork) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <FolderOpen className="h-16 w-16 mb-4 opacity-30" />
        <p className="text-base font-medium mb-1">
          {isTelnet ? "Telnet 设备不支持文件管理" : "网络设备不支持文件管理"}
        </p>
        <p className="text-xs text-muted-foreground/70">
          当前设备主要通过 CLI 命令行交互，无 SFTP 文件传输子系统。
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full relative p-1 gap-1 bg-transparent overflow-hidden">
      {/* 拖拽上传遮罩 */}
      {dragOver && (
        <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-3 text-primary">
            <UploadCloud className="h-16 w-16" />
            <span className="text-lg font-medium">{t('fs_drag_upload_hint')}</span>
            <span className="text-sm text-muted-foreground">{currentPath}</span>
          </div>
        </div>
      )}

      {/* Directory tree */}
      <FileDirectoryTree
        treeWidth={treeWidth}
        treeRoot={treeRoot}
        visibleTreeNodes={visibleTreeNodes}
        hasMoreTreeNodes={hasMoreTreeNodes}
        expandedPaths={expandedPaths}
        currentPath={currentPath}
        onToggleTreeNode={toggleTreeNode}
        onRefreshRoot={() => {
          void loadNodeChildren('/', true)
        }}
        onStartResize={startResize}
        t={t}
      />

      {/* File list */}
      <div className="flex-1 flex flex-col min-w-0 bg-card/95 rounded-xl border border-border/70 shadow-sm overflow-hidden">
        {/* Toolbar & Bookmarks & New Item */}
        <FileToolbar
          currentPath={currentPath}
          onNavigateTo={navigateTo}
          bookmarks={bookmarks}
          onAddBookmark={handleAddBookmark}
          onRemoveBookmark={handleRemoveBookmark}
          onToggleBookmark={toggleBookmark}
          showHidden={showHidden}
          onToggleShowHidden={toggleShowHidden}
          onRefresh={handleRefresh}
          transferLoading={transferLoading}
          onNativeUpload={handleNativeUpload}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          showNewItem={showNewItem}
          newItemType={newItemType}
          newItemName={newItemName}
          setNewItemName={setNewItemName}
          onNewItemConfirm={handleNewItem}
          onNewItemCancel={() => {
            setShowNewItem(false)
            setNewItemName('')
          }}
          t={t}
        />

        <ErrorDialog
          open={!!formattedError}
          title={formattedError?.title}
          message={formattedError?.message ?? ''}
          onClose={() => setError(null)}
        />

        {/* 文件表格 */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto relative"
          onMouseDown={handleFileMarqueeMouseDown}
          onClick={(e) => {
            // 点击空白清空选中；框选刚结束的 click 与点击行（行自身处理选择）不清空
            if (consumeFileMarqueeClick()) return
            if ((e.target as HTMLElement).closest('tr[data-file-path]')) return
            setSelectedFiles([])
          }}
          onContextMenu={(e) => {
            const target = e.target as HTMLElement
            if (target.closest('tr[data-file-path]')) return
            e.preventDefault()
            setSelectedFiles([]) // 右键空白处清空选中
            setCtxMenu({ x: e.clientX, y: e.clientY, file: null })
          }}
        >
          {loading && files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-3" />
              <span className="text-sm">{t('fs_loading_list')}</span>
            </div>
          ) : files.length === 0 && !error ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <FolderOpen className="h-12 w-12 mb-3 opacity-20" />
              <p className="text-sm font-medium">{t('fs_empty_dir')}</p>
              <p className="text-xs mt-1">{t('fs_upload_hint')}</p>
            </div>
          ) : files.length === 0 && error ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground select-none">
              <FolderOpen className="h-12 w-12 mb-3 opacity-20 text-destructive" />
              <p className="text-sm font-medium text-foreground mb-1">
                {t('fs_err_load_list') || 'Failed to load directory'}
              </p>
              <p className="text-xs text-muted-foreground max-w-sm text-center mb-3">
                {error}
              </p>
              <Button size="sm" variant="outline" onClick={() => fetchFiles(currentPath)}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                {t('common_retry') || 'Retry'}
              </Button>
            </div>
          ) : sortedFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Search className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">{t('fs_no_match')}</p>
            </div>
          ) : (
            <div className="m-2 rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden relative">
              {loading && (
                <div className="absolute top-0 left-0 right-0 z-10 h-0.5 bg-primary/20 overflow-hidden">
                  <div className="h-full bg-primary animate-pulse w-full" />
                </div>
              )}
            <table className={cn("w-full text-sm transition-opacity duration-150", loading && "opacity-60 pointer-events-none")}>
              <thead className="workspace-table-head">
                <tr className="text-left text-muted-foreground border-b">
                  <th
                    className="px-2 py-1 font-medium cursor-pointer hover:bg-accent/50 transition-colors select-none"
                    onClick={() => toggleSort('name')}
                  >
                    <div className="flex items-center gap-1.5">
                      {t('fs_th_name')}
                      <SortIcon field="name" />
                    </div>
                  </th>
                  <th
                    className="px-2 py-1 font-medium cursor-pointer hover:bg-accent/50 transition-colors select-none w-24"
                    onClick={() => toggleSort('size')}
                  >
                    <div className="flex items-center gap-1.5">
                      {t('fs_th_size')}
                      <SortIcon field="size" />
                    </div>
                  </th>
                  <th
                    className="px-2 py-1 font-medium cursor-pointer hover:bg-accent/50 transition-colors select-none w-40"
                    onClick={() => toggleSort('modifiedTime')}
                  >
                    <div className="flex items-center gap-1.5">
                      {t('fs_th_modified')}
                      <SortIcon field="modifiedTime" />
                    </div>
                  </th>
                  <th className="px-2 py-1 font-medium select-none w-32">
                    <div className="flex items-center gap-1.5">
                      {t('fs_th_perm')}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rowVirtualizer.getVirtualItems().length > 0 && (
                  <tr>
                    <td colSpan={4} style={{ height: `${rowVirtualizer.getVirtualItems()[0].start}px` }} />
                  </tr>
                )}
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const file = sortedFiles[virtualRow.index]
                  return (
                    <tr
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      data-file-path={file.path}
                      className={cn(
                        'workspace-table-row border-b cursor-pointer select-none',
                        selectedFiles.includes(file.path) && 'is-selected'
                      )}
                      onMouseDown={(e) => {
                        // 每次交互开始时清除双击标志，避免上次双击遗留的 true 误杀本次重命名
                        if (e.button === 0) rowDblClickedRef.current = false
                        // 内联重命名进行中：点击当前行交由输入框处理
                        if (renamingFile === file.path) return
                        // 只响应左键，避免右键也触发选择逻辑（右键由 onContextMenu 处理）
                        if (e.button !== 0) return
                        // 记录点击前是否已选中：用于「再次点击重命名」（仅点击前已选中时触发）
                        const wasSelected = selectedFiles.includes(file.path)
                        // D4: 移除 flushSync,改为普通 setState,避免阻塞主线程
                        if (e.ctrlKey || e.metaKey) {
                          // Ctrl/Cmd+click: 切换选中状态
                          setSelectedFiles(prev =>
                            prev.includes(file.path)
                              ? prev.filter(p => p !== file.path)
                              : [...prev, file.path]
                          )
                        } else {
                          setSelectedFiles([file.path])
                        }
                        // 点击前已选中且无修饰键 → 标记待重命名；由 onClick 延时触发，避让双击进入目录/打开文件
                        if (!e.ctrlKey && !e.metaKey && !e.shiftKey && wasSelected) {
                          pendingRenameRef.current = file.path
                        }
                      }}
                      onClick={() => {
                        // 内联重命名中：忽略当前行点击，避免重复触发
                        if (renamingFile === file.path) return
                        const pending = pendingRenameRef.current
                        pendingRenameRef.current = null
                        if (!pending || pending !== file.path) return
                        // 延时消歧：双击会在 click 后触发 onDoubleClick（已置 rowDblClickedRef），
                        // 500ms（系统双击判定窗口）内发生双击则不重命名，交由双击进入目录/打开文件
                        if (pendingRenameTimerRef.current !== null) {
                          window.clearTimeout(pendingRenameTimerRef.current)
                        }
                        pendingRenameTimerRef.current = window.setTimeout(() => {
                          pendingRenameTimerRef.current = null
                          if (rowDblClickedRef.current) return
                          startRename(file)
                        }, 500)
                      }}
                      onDoubleClick={() => {
                        // 标记为双击，抑制「再次点击重命名」的延时触发
                        rowDblClickedRef.current = true
                        pendingRenameRef.current = null
                        if (file.isDirectory) {
                          navigateTo(file.path)
                        } else {
                          const kind = getFileKind(file.name)
                          if (kind === 'text') {
                            // 文本文件：如果超过 2MB（如大 log 文件），自动降级为只读预览，避免编辑器崩溃/报错
                            if (file.size > 2 * 1024 * 1024) {
                              openPreview(file)
                            } else {
                              openEditor(file)
                            }
                          } else if (kind === 'universal') {
                            openPreview(file)
                          } else {
                            toastRef.current.warning(t('fs_preview_unsupported'))
                          }
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        // D4: 移除 flushSync,改为普通 setState,避免阻塞主线程
                        // 右键时如果未选中该文件，则选中它
                        if (!selectedFiles.includes(file.path)) {
                          setSelectedFiles([file.path])
                        }
                        setCtxMenu({ x: e.clientX, y: e.clientY, file })
                      }}
                    >
                      <td className="px-2 py-1">
                        {renamingFile === file.path ? (
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
                            onChange={(e) => setRenameValue(e.target.value)}
                            onFocus={(e) => e.target.select()}
                            className="h-7 text-sm w-48"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                // E4: 标记已提交,onBlur 不再重复处理
                                renameCommittedRef.current = true
                                handleRename(file.path, renameValue)
                                setRenamingFile(null)
                              }
                              if (e.key === 'Escape') {
                                // E4: Escape 也视为已提交(取消),阻止 onBlur 再次触发
                                renameCommittedRef.current = true
                                setRenamingFile(null)
                              }
                            }}
                            onBlur={() => {
                              // E4: 若由 Enter/Escape 触发的卸载,跳过 onBlur 处理
                              if (renameCommittedRef.current) {
                                renameCommittedRef.current = false
                                return
                              }
                              if (renameValue.trim() && renameValue !== file.name) {
                                handleRename(file.path, renameValue)
                              }
                              setRenamingFile(null)
                            }}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <div className="flex items-center gap-2">
                            {openingPath === file.path ? (
                              <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                            ) : (
                              renderFileIcon(toIconFile(file), 'h-4 w-4')
                            )}
                            <span className={cn('truncate', file.isDirectory && 'font-medium', openingPath === file.path && 'text-primary font-medium')}>{file.name}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1 text-muted-foreground tabular-nums">
                        {file.isDirectory ? '-' : formatSize(file.size)}
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">{file.modifiedTime}</td>
                      <td className="px-2 py-1">{permissionBadge(file.permissions)}</td>
                    </tr>
                  )
                })}
                {rowVirtualizer.getVirtualItems().length > 0 && (
                  <tr>
                    <td colSpan={4} style={{ height: `${rowVirtualizer.getTotalSize() - rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1].end}px` }} />
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          )}
          {/* 框选矩形（client 坐标 fixed 定位，不拦截事件） */}
          <MarqueeRect marquee={fileMarquee} />
        </div>
      </div>

      {/* 权限编辑弹窗 */}
      {permissionsFile && (
        <FilePermissionsModal
          open={!!permissionsFile}
          onClose={() => {
            setPermissionsFile(null)
            fetchFiles(currentPath)
          }}
          serverId={serverId}
          filePath={permissionsFile.path}
          currentPermissions={permissionsFile.permissions}
          isDirectory={permissionsFile.isDirectory}
        />
      )}

      {/* 文件属性对话框 */}
      <FilePropertiesDialog
        open={!!propertiesFile}
        onOpenChange={(open) => !open && setPropertiesFile(null)}
        propertiesFile={propertiesFile}
        statInfo={statInfo}
        statLoading={statLoading}
        formatSize={formatSize}
        t={t}
      />

      {/* 压缩进度弹框 */}
      <PackProgressDialog
        open={packingTarget !== null}
        targetName={packingTarget?.name}
        fileCount={packingTarget?.fileCount}
      />

      {/* 删除确认对话框 */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('fs_confirm_delete')}
        description={pendingDelete
          ? (pendingDelete.length === 1
              ? t('fs_confirm_delete_desc').replace('{name}', `"${pendingDelete[0]}"`)
              // E2: 批量删除显示前 5 个文件名 + "等 N 个文件",让用户清楚删的是什么
              : (() => {
                  const names = pendingDelete.slice(0, 5).map(p => `"${p.split('/').pop() || p}"`).join('、')
                  const suffix = pendingDelete.length > 5
                    ? ` 等共 ${pendingDelete.length} 个文件`
                    : ` 共 ${pendingDelete.length} 个文件`
                  return `${names}${suffix}`
                })()
            ) + (pendingDelete.some(p => isDangerousPath(p))
                ? `\n\n${t('common_dangerous_path_warn')}`
                : '')
          : ''}
        confirmLabel={t('fs_delete')}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      {/* 切换编码确认对话框（dirty 时）：重读磁盘会丢弃未保存的修改 */}
      <ConfirmDialog
        open={pendingEncodingChange !== null}
        title="切换编码"
        description="当前文件有未保存的修改。切换编码将从磁盘重新读取文件，未保存的内容将丢失。是否继续？"
        confirmLabel="重新读取"
        cancelLabel="取消"
        variant="destructive"
        onConfirm={() => {
          const enc = pendingEncodingChange
          setPendingEncodingChange(null)
          if (enc) void reopenWithEncoding(enc)
        }}
        onCancel={() => setPendingEncodingChange(null)}
      />

      {/* 自动检测编码保存确认：GB18030 兜底检测不可靠，避免“打开即保存”把原文件不可逆转码 */}
      <ConfirmDialog
        open={pendingEncodingSave}
        title="按自动检测的编码保存？"
        description={`当前文件编码为自动检测结果（${editFileEncoding}），可能并不准确。按此编码写回会导致非该编码的文件内容损坏。建议先在上方编码下拉框中选择正确编码并确认内容正常后再保存。`}
        confirmLabel="仍然保存"
        cancelLabel="取消"
        variant="destructive"
        onConfirm={() => {
          setPendingEncodingSave(false)
          encodingSaveAckRef.current = true
          void handleSave()
        }}
        onCancel={() => setPendingEncodingSave(false)}
      />

      {/* 文件预览可调整大小对话框（预览 + 编辑一体，与 SFTP 面板一致） */}
      <ResizablePreviewDialog
        open={!!previewFile}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewFile(null)
            setPreviewRawBytes(null)
            setPreviewError(null)
            setViewerMode('preview')
            setViewerEditable(false)
            editDirtyRef.current = false
          }
        }}
        title={previewFile?.name || ''}
        fileSize={previewFile?.size}
        icon={<Eye className="h-4 w-4 text-primary shrink-0" />}
        extraHeaderActions={previewFile ? (() => {
          const ext = previewFile.name.split('.').pop()?.toLowerCase() || ''
          const isJson = ext === 'json'
          const ready = !previewLoading && !previewError
          // 文本类扩展名即使被判为二进制（如 UTF-16 无 BOM），也必须能手动切换编码自救
          const isTextFile = getFileKind(previewFile.name) === 'text'
          return (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {/* 编码选择（Notepad++ 式：手动切换重新打开）+ 换行符徽标。
                  条件不再依赖 viewerEditable：二进制判定（如 UTF-16 无 BOM）后用户仍需入口手动选对编码 */}
              {(viewerEditable || isTextFile) && ready && (
                <>
                  <select
                    value={editFileEncoding}
                    onChange={(e) => {
                      const enc = e.target.value
                      // dirty 时先确认：切换编码会从磁盘重读，未保存内容将丢失
                      if (editDirtyRef.current && enc !== editFileEncoding) {
                        setPendingEncodingChange(enc)
                        return
                      }
                      void reopenWithEncoding(enc)
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
                    {eolLabel(editFileEol)}
                  </span>
                </>
              )}
              {/* 格式化 JSON：编辑态操作文本内容，预览态操作原始字节 */}
              {isJson && ready && viewerMode === 'edit' && editContent && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(editContent)
                      const isMultiLine = editContent.includes('\n')
                      handleEditContentChange(isMultiLine ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2))
                      toastRef.current.success(isMultiLine ? 'JSON 已压缩（单行）' : 'JSON 已格式化')
                    } catch (err) {
                      toastRef.current.error('JSON 语法错误，无法格式化: ' + (err instanceof Error ? err.message : String(err)))
                    }
                  }}
                  title="格式化 JSON (缩进排版 / 紧凑排版)"
                >
                  <Braces className="h-3.5 w-3.5 mr-1 text-primary" />
                  <span>格式化</span>
                </Button>
              )}
              {isJson && ready && viewerMode === 'preview' && previewRawBytes && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    try {
                      const text = new TextDecoder('utf-8').decode(previewRawBytes)
                      const parsed = JSON.parse(text)
                      const isMultiLine = text.includes('\n')
                      const formatted = isMultiLine ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2)
                      setPreviewRawBytes(new TextEncoder().encode(formatted))
                      toastRef.current.success(isMultiLine ? 'JSON 已压缩（单行）' : 'JSON 已格式化')
                    } catch (err) {
                      toastRef.current.error('JSON 语法错误，无法格式化: ' + (err instanceof Error ? err.message : String(err)))
                    }
                  }}
                  title="格式化 JSON (缩进排版 / 紧凑排版)"
                >
                  <Braces className="h-3.5 w-3.5 mr-1 text-primary" />
                  <span>格式化</span>
                </Button>
              )}
              {/* 编辑/预览切换 */}
              {viewerEditable && ready && viewerMode === 'preview' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setViewerMode('edit')}
                  title={t('sftp_viewer_edit')}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  <span>{t('sftp_viewer_edit')}</span>
                </Button>
              )}
              {viewerEditable && ready && viewerMode === 'edit' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setViewerMode('preview')}
                  title={t('sftp_viewer_preview')}
                >
                  <Eye className="h-3.5 w-3.5 mr-1" />
                  <span>{t('sftp_viewer_preview')}</span>
                </Button>
              )}
              {/* 备份 + 保存（仅编辑态） */}
              {viewerEditable && viewerMode === 'edit' && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => void handleBackup(previewFile.path)}
                  >
                    <Shield className="h-3.5 w-3.5" />
                    <span>{t('fs_create_backup')}</span>
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={editLoading}
                    onClick={handleSave}
                    title={t('fs_save')}
                  >
                    {editLoading ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5 mr-1" />
                    )}
                    <span>{t('fs_save')}</span>
                  </Button>
                </>
              )}
            </div>
          )
        })() : undefined}
      >
        {previewLoading && (
          <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground min-h-64">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="text-sm">{t('fs_preview_loading')}</span>
          </div>
        )}
        {previewError && (
          <div className="flex-1 flex items-center justify-center p-4">
            <p className="text-red-500 text-sm text-center">{previewError}</p>
          </div>
        )}
        {!previewLoading && !previewError && previewFile && (
          viewerMode === 'edit' && viewerEditable ? (
            <div className="w-full h-full">
              <CodeEditor
                value={editContent}
                onValueChange={handleEditContentChange}
                fileName={previewFile.name}
                className="h-full"
              />
            </div>
          ) : (
            <div className="w-full h-full flex flex-col overflow-hidden">
              <UniversalFileViewer
                data={previewRawBytes}
                fileName={previewFile.name}
                className="h-full"
                onError={(err) => setPreviewError(err.message)}
              />
            </div>
          )
        )}
      </ResizablePreviewDialog>

      {/* 右键菜单 */}
      <FileContextMenu
        ctxMenu={ctxMenu}
        ctxMenuRef={ctxMenuRef}
        currentPath={currentPath}
        selectedFiles={selectedFiles}
        bookmarks={bookmarks}
        onAddBookmark={handleAddBookmark}
        onRemoveBookmark={handleRemoveBookmark}
        showHidden={showHidden}
        onToggleShowHidden={toggleShowHidden}
        transferLoading={transferLoading}
        isWindows={isWindows}
        onClose={() => setCtxMenu(null)}
        onRefresh={handleRefresh}
        onNewItem={(type) => {
          setShowNewItem(true)
          setNewItemType(type)
        }}
        onNativeUpload={handleNativeUpload}
        onDownloadMultiple={handleDownloadMultiple}
        onPreview={openPreview}
        onNavigateTo={navigateTo}
        onOpenEditor={openEditor}
        onStartRename={startRename}
        onDownload={handleDownload}
        onDownloadArchive={handleDownloadArchive}
        onExtractArchive={handleExtractArchive}
        extractingArchive={extractingFile}
        onChangePermissions={(file) => setPermissionsFile(file)}
        onShowProperties={handleShowProperties}
        onDelete={(paths) => handleDelete(paths)}
        t={t}
      />
    </div>
  )
}
