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
  HTML_EXT_SET,
  TEXT_EXT_SET,
  UNIVERSAL_PREVIEW_EXTS,
  isUniversalPreviewSupported,
  isLogFileName,
  isBinaryContent,
} from './local-file-picker-utils'
import { UniversalFileViewer } from '@/components/ui/universal-file-viewer'
import { ResizablePreviewDialog } from '@/components/ui/resizable-preview-dialog'
import { ArchiveFileIcon } from '@/components/ui/file-icons'
import { sshService } from '@/services/ssh-service'
import { FilePermissionsModal } from './file-permissions-modal'
import { ErrorDialog } from '@/components/ui/error-dialog'
import { formatSftpError, isSftpConnectionError } from '@/lib/sftp-error'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { PackProgressDialog } from '@/components/ui/pack-progress-dialog'
import type { FileEntry } from '@/types'
import type { FileStatInfo } from '@/services/api'
import { useTranslation } from '@/i18n'
import { useToast } from '@/components/ui/toast'
import { useAppStore } from '@/store'
import { extractBaseServerId } from '@/services/ssh-connection-state'
import type { FilesModuleProps, TreeNode, SortField, SortDirection } from './files/types'
import { PermissionBadge } from './files/permission-badge'
import { FilePropertiesDialog } from './files/file-properties-dialog'
import { FileEditorView } from './files/file-editor-view'
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



export function FilesModule({ serverId, isConnected = true, isActive = true }: FilesModuleProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  // ToastProvider 在消息列表变化时会重建 toast 对象。异步文件操作统一通过 ref
  // 读取最新实例，避免 callback 依赖频繁变化导致原生拖拽监听反复注册。
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast }, [toast])
  const baseServerId = extractBaseServerId(serverId)
  const server = useAppStore((s) => s.servers.find((sv) => sv.id === baseServerId))
  const isWindows = server?.targetType === 'windows'
  const isTelnet = server?.protocol === 'telnet'
  const isNetwork = server?.targetType === 'network'
  const [currentPath, setCurrentPath] = useState('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingFile, setEditingFile] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [editLoading, setEditLoading] = useState(false)
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
  const [openingPath, setOpeningPath] = useState<string | null>(null)
  const lastFetchedPathRef = useRef<string>('')
  // 文件列表请求序号：每次 fetchFiles 自增，过期请求的结果被丢弃，
  // 防止快速切目录时旧响应覆盖新响应（对齐 sftp-panel 的 localDirReqIdRef 范式）
  const fetchFilesReqIdRef = useRef(0)
  // 保活初始化标记：确保根目录加载只在首次连接建立时执行一次，
  // 避免保活模式下切换模块回归时重复发起 SFTP 请求
  const filesInitializedRef = useRef(false)
  // E4: 标记重命名是否已通过 Enter 提交,避免卸载 input 触发 onBlur 重复提交/取消
  const renameCommittedRef = useRef(false)
  // 同步追踪 treeRoot 最新值,供 loadNodeChildren 在 async 上下文中读取,
  // 避免 React 18 并发模式下 setState updater 非同步执行导致的 canLoad 误判。
  const treeRootRef = useRef(treeRoot)
  // B8: 在 useEffect 中同步 ref,避免在 render 期间写 ref 引发并发模式下的副作用问题
  useEffect(() => { treeRootRef.current = treeRoot }, [treeRoot])
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)

  // === 新增功能状态 ===
  // 拖拽上传
  const [dragOver, setDragOver] = useState(false)
  // 列排序
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  // 路径书签
  const [bookmarks, setBookmarks] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`file-bookmarks-${baseServerId}`)
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  // 文件属性对话框
  const [propertiesFile, setPropertiesFile] = useState<FileEntry | null>(null)
  const [statInfo, setStatInfo] = useState<FileStatInfo | null>(null)
  const [statLoading, setStatLoading] = useState(false)
  // 文件预览（图片/PDF/视频/音频/DOCX/表格/压缩包）
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null)
  const [previewRawBytes, setPreviewRawBytes] = useState<Uint8Array | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [editMode, setEditMode] = useState<'edit' | 'preview'>('preview')
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

  // 书签持久化
  useEffect(() => {
    localStorage.setItem(`file-bookmarks-${baseServerId}`, JSON.stringify(bookmarks))
  }, [bookmarks, baseServerId])

  // 点击其他地方关闭右键菜单
  useEffect(() => {
    if (!ctxMenu) return
    const close = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null)
      }
    }
    const timer = setTimeout(() => {
      window.addEventListener('click', close)
      window.addEventListener('contextmenu', close)
    }, 0)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [ctxMenu])

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

  // 乐观导航：0ms 立即更新目标路径并开始拉取，消除 React 生命周期等待与感官延迟
  const navigateTo = useCallback((targetPath: string) => {
    if (!targetPath) return
    setOpeningPath(targetPath)
    lastFetchedPathRef.current = targetPath
    setCurrentPath(targetPath)
    void fetchFiles(targetPath)
  }, [fetchFiles])

  const loadNodeChildren = useCallback(async (nodePath: string, force = false) => {
    if (treeLoadingRef.current.has(nodePath) && !force) return

    // 从 ref 同步读取最新树状态,不依赖 setState updater 的副作用
    // (React 18 并发模式下 updater 在下次渲染才执行,canLoad 不会被同步设置)
    const currentRoot = treeRootRef.current
    const node = findTreeNode(currentRoot, nodePath)
    if (!node || node.loading) return
    if (node.loaded && !force) return

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
      if (timedOut) return
      children = fileEntriesToTreeNodes(data)
    } catch (err) {
      if (!timedOut) setError(err instanceof Error ? err.message : t('fs_err_load_tree'))
    } finally {
      window.clearTimeout(clientTimeoutId)
      if (!timedOut) {
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
    return () => { unsub?.() }
  }, [isActive])

  // === 拖拽上传 ===
  const handleUpload = useCallback(async (selectedPaths: string[]) => {
    setTransferLoading('upload')
    try {
      const result = await sshService.uploadFromPaths(serverId, currentPath, selectedPaths)
      if (result.success && result.results) {
        const failed = result.results.filter((r) => !r.success)
        if (failed.length > 0) {
          setError(`${t('fs_err_upload')}: ${failed.map((r) => r.fileName).join(', ')}`)
        } else {
          // E6: 上传完成 toast 提示
          const successCount = result.results.filter((r) => r.success).length
          toastRef.current.success(`上传完成,共 ${successCount} 个文件`)
        }
        fetchFiles(currentPath)
        if (expandedPaths.has(currentPath)) {
          loadNodeChildren(currentPath, true)
        }
      } else if (!result.success && result.error !== '用户取消') {
        setError(`${t('fs_err_upload')}: ${result.error || t('common_unknown_error')}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fs_err_upload'))
    } finally {
      setTransferLoading(null)
    }
  }, [serverId, currentPath, fetchFiles, loadNodeChildren, expandedPaths, t])

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
    const filtered = files.filter(f =>
      !deferredSearch || f.name.toLowerCase().includes(deferredSearch.toLowerCase())
    )
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
  }, [files, deferredSearch, sortField, sortDirection])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: sortedFiles.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 41,
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
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)}G`
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)}M`
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`
    return `${bytes}B`
  }

  const permissionBadge = (perm?: string) => <PermissionBadge perm={perm} />

  const openEditor = async (file: FileEntry) => {
    // B7: 符号链接的 size 字段并不可信(可能为 0 或指向目标大小),
    // 且编辑符号链接会破坏链接关系,这里直接禁止编辑符号链接
    if (file.permissions?.startsWith('l')) {
      toastRef.current.warning('不支持编辑符号链接')
      return
    }
    // F4: 二进制文件扩展名拦截,避免在编辑器中加载乱码
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (BINARY_EXT_SET.has(ext) && !TEXT_EXT_SET.has(ext)) {
      toastRef.current.warning('不支持编辑此类型文件')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError(`${t('fs_err_file_too_large')} (${formatSize(file.size)})`)
      return
    }
    setEditingFile(file.path)
    setEditMode(ext === 'md' || ext === 'markdown' || HTML_EXT_SET.has(ext) ? 'preview' : 'edit')
    setEditLoading(true)
    try {
      const result = await sshService.readFile(serverId, file.path)
      const text = result.stdout || ''
      if (isBinaryContent(text)) {
        setEditingFile(null)
        toastRef.current.warning('检测到文件包含二进制内容，无法在文本编辑器中打开')
        return
      }
      setEditContent(text)
    } catch (err) {
      setEditingFile(null)
      setError(err instanceof Error ? err.message : t('fs_err_read'))
    } finally {
      setEditLoading(false)
    }
  }

  // 文件预览：不论是文档、多媒体还是文本/日志文件，在预览模式下统一交由 UniversalFileViewer 进行专业浏览与搜索
  const openPreview = async (file: FileEntry) => {
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
    setPreviewFile(file)
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewRawBytes(null)
    try {
      const base64 = await sshService.readBinaryFile(serverId, file.path)
      const binaryString = atob(base64)
      const len = binaryString.length
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      setPreviewRawBytes(bytes)
    } catch (e) {
      setPreviewError((e as Error).message || t('fs_preview_failed'))
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleSave = async () => {
    if (!editingFile) return
    setEditLoading(true)
    try {
      const backupResult = await sshService.backupFile(serverId, editingFile)
      if (backupResult.exitCode !== 0) {
        toastRef.current.error(`${t('fs_err_backup')}: ${backupResult.stderr || t('common_unknown_error')}`, 1500)
        return
      }
      const result = await sshService.writeFile(serverId, editingFile, editContent)
      if (result.exitCode !== 0) {
        toastRef.current.error(`${t('fs_err_save')}: ${result.stderr || t('common_unknown_error')}`, 1500)
      } else {
        toastRef.current.success(t('fs_save_success'), 1500)
        setEditingFile(null)
        // 刷新文件所在父目录（而非 currentPath）：树状视图编辑深层文件时，
        // currentPath 可能与 editingFile 不在同一层级，备份文件需在父目录才能看到
        const parentPath = editingFile.includes('/')
          ? editingFile.substring(0, editingFile.lastIndexOf('/')) || '/'
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

  const handleDelete = useCallback((paths: string[]) => {
    if (paths.length === 0) return
    // B4: 客户端预检危险根路径,弹 toast.warning 提示用户
    const hasDangerous = paths.some(p => isDangerousPath(p))
    if (hasDangerous) {
      toastRef.current.warning(t('common_dangerous_path_warn'))
    }
    setPendingDelete(paths)
  }, [t])

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
    try {
      const result = await sshService.downloadFile(serverId, file.path)
      if (!result.success && result.error !== '用户取消') {
        setError(`${t('fs_err_download')}: ${result.error || t('common_unknown_error')}`)
      } else if (result.success) {
        // E6: 下载完成 toast 提示
        toastRef.current.success(`下载完成: ${file.name}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fs_err_download'))
    } finally {
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

      // E7: 用并发数控制替代 Promise.all，避免批量下载时 SSH 通道拥堵
      const downloadTasks = selectedFileEntries.map((file) => async () => {
        try {
          return await sshService.downloadFile(serverId, file.path, destFolder)
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) }
        }
      })

      const results = await runWithConcurrency(downloadTasks, FILE_TRANSFER_CONCURRENCY)
      const failed = results.filter(r => !r.success)
      if (failed.length > 0) {
        setError(`${t('fs_err_download')}: ${failed.map(r => r.error || t('common_unknown_error')).join(', ')}`)
      } else {
        // E6: 批量下载完成 toast 提示
        toastRef.current.success(`下载完成,共 ${paths.length} 个文件`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fs_err_download'))
    } finally {
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
      if (!result.success && result.error !== '用户取消') {
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
    setPropertiesFile(file)
    setStatInfo(null)
    setStatLoading(true)
    try {
      const info = await sshService.statInfo(serverId, file.path)
      setStatInfo(info)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fs_err_props'))
    } finally {
      setStatLoading(false)
    }
  }

  // 书签切换
  const toggleBookmark = () => {
    if (!currentPath) return
    // E5: 书签最多 50 个,超过时提示用户并阻止添加
    if (!bookmarks.includes(currentPath) && bookmarks.length >= 50) {
      toastRef.current.warning('书签数量已达上限 50')
      return
    }
    setBookmarks(prev => {
      if (prev.includes(currentPath)) {
        return prev.filter(p => p !== currentPath)
      }
      return [...prev, currentPath]
    })
  }

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
      if (editingFile) return

      if (e.key === 'F5') {
        e.preventDefault()
        handleRefresh()
      }
      // F2 重命名:仅单选时生效,多选时不触发
      if (e.key === 'F2' && selectedFiles.length === 1) {
        e.preventDefault()
        const file = files.find(f => f.path === selectedFiles[0])
        if (file) {
          setRenamingFile(file.path)
          setRenameValue(file.name)
        }
      }
      if (e.key === 'Delete' && selectedFiles.length > 0) {
        e.preventDefault()
        handleDelete(selectedFiles)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedFiles, files, editingFile, handleRefresh, handleDelete, isActive])

  // D1: 扁平化目录树,限制最大显示节点数,避免深目录展开后 DOM 节点激增
  const flattenedTree = useMemo(
    () => flattenTree(treeRoot, expandedPaths),
    [treeRoot, expandedPaths]
  )
  const visibleTreeNodes = flattenedTree.slice(0, MAX_TREE_NODES)
  const hasMoreTreeNodes = flattenedTree.length > MAX_TREE_NODES

  if (editingFile) {
    return (
      <FileEditorView
        editingFile={editingFile}
        editContent={editContent}
        setEditContent={setEditContent}
        editLoading={editLoading}
        editMode={editMode}
        setEditMode={setEditMode}
        onBack={() => setEditingFile(null)}
        onSave={handleSave}
        onBackup={handleBackup}
        onFormatJsonSuccess={(isMultiLine) => {
          toastRef.current.success(isMultiLine ? 'JSON 已压缩（单行）' : 'JSON 已格式化')
        }}
        onFormatJsonError={(errMsg) => {
          toastRef.current.error('JSON 语法错误，无法格式化: ' + errMsg)
        }}
        t={t}
      />
    )
  }

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
    <div className="flex h-full relative p-2 gap-1 bg-transparent overflow-hidden">
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
          onToggleBookmark={toggleBookmark}
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
                    className="px-3 py-2 font-medium cursor-pointer hover:bg-accent/50 transition-colors select-none"
                    onClick={() => toggleSort('name')}
                  >
                    <div className="flex items-center gap-1.5">
                      {t('fs_th_name')}
                      <SortIcon field="name" />
                    </div>
                  </th>
                  <th
                    className="px-3 py-2 font-medium cursor-pointer hover:bg-accent/50 transition-colors select-none w-24"
                    onClick={() => toggleSort('size')}
                  >
                    <div className="flex items-center gap-1.5">
                      {t('fs_th_size')}
                      <SortIcon field="size" />
                    </div>
                  </th>
                  <th
                    className="px-3 py-2 font-medium cursor-pointer hover:bg-accent/50 transition-colors select-none w-40"
                    onClick={() => toggleSort('modifiedTime')}
                  >
                    <div className="flex items-center gap-1.5">
                      {t('fs_th_modified')}
                      <SortIcon field="modifiedTime" />
                    </div>
                  </th>
                  <th className="px-3 py-2 font-medium select-none w-32">
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
                        // 只响应左键，避免右键也触发选择逻辑（右键由 onContextMenu 处理）
                        if (e.button !== 0) return
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
                      }}
                      onDoubleClick={() => {
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
                      <td className="px-3 py-2">
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
                      <td className="px-3 py-2 text-muted-foreground tabular-nums">
                        {file.isDirectory ? '-' : formatSize(file.size)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{file.modifiedTime}</td>
                      <td className="px-3 py-2">{permissionBadge(file.permissions)}</td>
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

        {/* 状态栏 */}
        <div className="flex items-center gap-3 px-3 py-1.5 border-t bg-card text-xs text-muted-foreground">
          {/* D3: 切换目录时保留旧数据,在状态栏显示 loading 指示器 */}
          {loading && files.length > 0 && (
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
          )}
          <span>{t('fs_items').replace('{n}', String(sortedFiles.length))}</span>
          {selectedFiles.length > 0 && (
            <>
              <span className="text-muted-foreground/40">|</span>
              <span>{t('fs_selected_items').replace('{n}', String(selectedFiles.length))}</span>
            </>
          )}
          <div className="flex-1" />
          <span className="text-muted-foreground/60">{t('fs_shortcuts_hint')}</span>
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

      {/* 文件预览可调整大小对话框 */}
      <ResizablePreviewDialog
        open={!!previewFile}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewFile(null)
            setPreviewRawBytes(null)
            setPreviewError(null)
          }
        }}
        title={previewFile?.name || ''}
        fileSize={previewFile?.size}
        icon={<Eye className="h-4 w-4 text-primary shrink-0" />}
        extraHeaderActions={previewFile && previewFile.name.toLowerCase().endsWith('.json') && previewRawBytes ? (
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
        ) : undefined}
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
          <div className="w-full h-full flex flex-col overflow-hidden">
            <UniversalFileViewer
              data={previewRawBytes}
              fileName={previewFile.name}
              className="h-full"
              onError={(err) => setPreviewError(err.message)}
            />
          </div>
        )}
      </ResizablePreviewDialog>

      {/* 右键菜单 */}
      <FileContextMenu
        ctxMenu={ctxMenu}
        ctxMenuRef={ctxMenuRef}
        currentPath={currentPath}
        selectedFiles={selectedFiles}
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
        onStartRename={(file) => {
          setRenamingFile(file.path)
          setRenameValue(file.name)
        }}
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
