import React, { useState, useEffect, useCallback, useRef } from 'react'
import JSZip from 'jszip'
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Search,
  X,
  Copy,
  Check,
  FileArchive,
  FileAudio,
  File as GenericFile,
  Loader2,
  Expand,
  Shrink,
  PanelLeftClose,
  PanelLeftOpen,
  WrapText,
  Braces,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { renderFileIcon } from '@/components/file-icons'
import { LogViewer } from '@/components/ui/log-viewer'
import { isLogFileName } from '@/components/workspace/modules/local-file-picker-utils'

export interface ArchiveViewerProps {
  /** 压缩包二进制数据 (Uint8Array, ArrayBuffer, Blob, 或 base64/data URL 字符串) */
  data?: Uint8Array | ArrayBuffer | Blob | string | null
  /** 压缩包文件名 (如 iot-single.zip, gm-adapter.jar) */
  fileName: string
  /** 容器自定义 CSS 类名 */
  className?: string
  /** 发生错误时的回调 */
  onError?: (err: Error) => void
  /** 是否在外层已有标题的容器中隐藏重复的文件名与图标 */
  hideTitle?: boolean
}

/** 树形节点结构 */
export interface ArchiveNode {
  name: string
  path: string
  isDirectory: boolean
  size: number
  date?: Date
  children: ArchiveNode[]
  entry?: JSZip.JSZipObject
  totalFiles: number
  totalDirs: number
  totalSize: number
}

/** 格式化字节数 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const decimals = i >= 2 ? 2 : (i === 0 ? 0 : 1)
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i] || 'MB'}`
}

/** 获取文件扩展名 */
function getExt(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : ''
}

/** 判断是否为常见文本/代码扩展名 */
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'yaml', 'yml', 'xml', 'html', 'htm', 'css', 'scss', 'less',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go',
  'rs', 'php', 'sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1', 'sql', 'toml', 'ini', 'conf', 'config',
  'properties', 'env', 'gradle', 'dockerfile', 'makefile', 'cmake', 'log', 'out', 'err',
  'vue', 'svelte', 'proto', 'graphql', 'lua', 'swift', 'kt', 'kts', 'scala', 'rb', 'diff', 'patch',
  'csv', 'tsv', 'mod', 'sum', 'editorconfig', 'gitignore',
])

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi'])

/** 从 JSZip 实例构建层级树 */
export function buildArchiveTree(zip: JSZip): ArchiveNode {
  const root: ArchiveNode = {
    name: 'root',
    path: '',
    isDirectory: true,
    size: 0,
    children: [],
    totalFiles: 0,
    totalDirs: 0,
    totalSize: 0,
  }

  // 辅助查找或创建路径上的中间目录
  const dirMap = new Map<string, ArchiveNode>()
  dirMap.set('', root)

  function ensureDir(path: string): ArchiveNode {
    const cleanPath = path.replace(/\/+$/, '')
    if (!cleanPath) return root
    if (dirMap.has(cleanPath)) return dirMap.get(cleanPath)!

    const parts = cleanPath.split('/')
    const dirName = parts.pop() || cleanPath
    const parentPath = parts.join('/')
    const parentNode = ensureDir(parentPath)

    const newDir: ArchiveNode = {
      name: dirName,
      path: cleanPath,
      isDirectory: true,
      size: 0,
      children: [],
      totalFiles: 0,
      totalDirs: 0,
      totalSize: 0,
    }

    parentNode.children.push(newDir)
    dirMap.set(cleanPath, newDir)
    return newDir
  }

  // 遍历所有 ZIP 条目（兼容 Windows 反斜杠路径）
  zip.forEach((rawPath, entry) => {
    const relPath = rawPath.replace(/\\/g, '/')
    const isDir = entry.dir || relPath.endsWith('/')
    const cleanPath = relPath.replace(/\/+$/, '')
    if (!cleanPath) return

    const parts = cleanPath.split('/')
    const fileName = parts.pop() || cleanPath
    const parentPath = parts.join('/')
    const parentDir = ensureDir(parentPath)

    if (isDir) {
      // 目录条目已通过 ensureDir 处理，更新 entry 信息
      const existing = dirMap.get(cleanPath)
      if (existing) {
        existing.entry = entry
        existing.date = entry.date
      }
    } else {
      // 文件条目
      const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0
      const fileNode: ArchiveNode = {
        name: fileName,
        path: cleanPath,
        isDirectory: false,
        size,
        date: entry.date,
        entry,
        children: [],
        totalFiles: 1,
        totalDirs: 0,
        totalSize: size,
      }
      parentDir.children.push(fileNode)
    }
  })

  // 递归计算统计指标并排序（文件夹在前，文件在后，按字母序）
  function finalizeNode(node: ArchiveNode) {
    if (!node.isDirectory) return

    let filesCount = 0
    let dirsCount = 0
    let totalSize = 0

    node.children.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })

    for (const child of node.children) {
      if (child.isDirectory) {
        finalizeNode(child)
        dirsCount += 1 + child.totalDirs
        filesCount += child.totalFiles
        totalSize += child.totalSize
      } else {
        filesCount += 1
        totalSize += child.size
      }
    }

    node.totalFiles = filesCount
    node.totalDirs = dirsCount
    node.totalSize = totalSize
  }

  finalizeNode(root)
  return root
}

export function ArchiveViewer({
  data,
  fileName,
  className,
  onError,
  hideTitle = false,
}: ArchiveViewerProps) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [treeRoot, setTreeRoot] = useState<ArchiveNode | null>(null)

  // 展开折叠状态管理
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  // 当前选中节点与右侧预览数据
  const [selectedNode, setSelectedNode] = useState<ArchiveNode | null>(null)
  const [subFileLoading, setSubFileLoading] = useState(false)
  const [subFileContent, setSubFileContent] = useState<string | null>(null)
  const [subFileBlobUrl, setSubFileBlobUrl] = useState<string | null>(null)
  const [subFileError, setSubFileError] = useState<string | null>(null)

  // 侧边栏折叠与搜索
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [copied, setCopied] = useState(false)
  const [wrapText, setWrapText] = useState(true)

  // 侧边栏宽度
  const [sidebarWidth, setSidebarWidth] = useState(320)
  const isResizingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(320)

  // 释放 Object URL
  const blobUrlRef = useRef<string | null>(null)
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [])

  // 切换节点展开/收起
  const toggleExpand = useCallback((path: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  // 展开所有 / 收起所有
  const handleExpandAll = useCallback(() => {
    if (!treeRoot) return
    const all = new Set<string>()
    function collectDirs(node: ArchiveNode) {
      if (node.isDirectory && node.path) {
        all.add(node.path)
      }
      node.children.forEach(collectDirs)
    }
    collectDirs(treeRoot)
    setExpandedPaths(all)
  }, [treeRoot])

  const handleCollapseAll = useCallback(() => {
    setExpandedPaths(new Set())
  }, [])

  // 选中节点并按需解压加载预览内容
  const handleSelectNode = useCallback(async (node: ArchiveNode) => {
    setSelectedNode(node)
    setSubFileError(null)

    if (node.isDirectory) {
      // 目录节点：点击自动切换展开状态，无需加载文件
      toggleExpand(node.path)
      return
    }

    if (!node.entry) return

    setSubFileLoading(true)
    setSubFileContent(null)
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
    setSubFileBlobUrl(null)

    try {
      const ext = getExt(node.name)
      const isText = TEXT_EXTS.has(ext) || isLogFileName(node.name)
      const isImg = IMAGE_EXTS.has(ext)
      const isMedia = AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext)

      if (isText) {
        const text = await node.entry.async('string')
        setSubFileContent(text)
      } else if (isImg || isMedia) {
        const bytes = await node.entry.async('uint8array')
        const mime = isImg ? `image/${ext === 'svg' ? 'svg+xml' : ext}` : `${isMedia && AUDIO_EXTS.has(ext) ? 'audio' : 'video'}/${ext}`
        // 拷贝为 ArrayBuffer-backed 视图，满足 BlobPart 类型要求
        const blob = new Blob([new Uint8Array(bytes)], { type: mime })
        const url = URL.createObjectURL(blob)
        blobUrlRef.current = url
        setSubFileBlobUrl(url)
      }
    } catch (err: unknown) {
      setSubFileError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubFileLoading(false)
    }
  }, [toggleExpand])

  // 异步加载与解析 ZIP
  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)
    setTreeRoot(null)
    setSelectedNode(null)

    async function parseZip() {
      try {
        if (!data) throw new Error('未提供压缩包数据')

        let buffer: ArrayBuffer
        if (data instanceof Uint8Array) {
          buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
        } else if (data instanceof ArrayBuffer) {
          buffer = data
        } else if (data instanceof Blob) {
          buffer = await data.arrayBuffer()
        } else if (typeof data === 'string') {
          if (data.startsWith('data:')) {
            const b64 = data.split(',')[1] || ''
            const binaryString = atob(b64)
            const len = binaryString.length
            const bytes = new Uint8Array(len)
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i)
            }
            buffer = bytes.buffer
          } else {
            // 普通字符串当做 Blob 或 text 读取
            buffer = new TextEncoder().encode(data).buffer
          }
        } else {
          throw new Error('不支持的数据格式')
        }

        const zip = await JSZip.loadAsync(buffer)
        if (!active) return

        const root = buildArchiveTree(zip)
        setTreeRoot(root)

        // 智能默认展开：
        // 若只有一个顶层根目录，自动展开根目录及下一层；若有多个，展开第 1 层
        const initialExpanded = new Set<string>()
        if (root.children.length === 1 && root.children[0].isDirectory) {
          const firstDir = root.children[0]
          initialExpanded.add(firstDir.path)
          firstDir.children.forEach(child => {
            if (child.isDirectory && child.children.length <= 15) {
              initialExpanded.add(child.path)
            }
          })
        } else {
          root.children.forEach(child => {
            if (child.isDirectory && child.children.length <= 15) {
              initialExpanded.add(child.path)
            }
          })
        }
        setExpandedPaths(initialExpanded)

        // 默认选中第一个文件（如果有）
        function findFirstFile(node: ArchiveNode): ArchiveNode | null {
          for (const child of node.children) {
            if (!child.isDirectory) return child
            const found = findFirstFile(child)
            if (found) return found
          }
          return null
        }
        const firstFile = findFirstFile(root)
        if (firstFile) {
          handleSelectNode(firstFile)
        }
      } catch (err: unknown) {
        if (!active) return
        const message = err instanceof Error ? err.message : String(err)
        setLoadError(message)
        onError?.(err instanceof Error ? err : new Error(message))
      } finally {
        if (active) setLoading(false)
      }
    }

    void parseZip()

    return () => {
      active = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, fileName])


  // 复制文本内容
  const handleCopyContent = useCallback(() => {
    if (!subFileContent) return
    navigator.clipboard.writeText(subFileContent).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [subFileContent])

  // 格式化 / 紧凑 JSON 内容
  const handleToggleFormatJson = useCallback(() => {
    if (!subFileContent) return
    try {
      const parsed = JSON.parse(subFileContent)
      const isMultiLine = subFileContent.includes('\n')
      const formatted = isMultiLine ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2)
      setSubFileContent(formatted)
    } catch (err) {
      console.warn('Invalid JSON in archive entry:', err)
    }
  }, [subFileContent])

  // 侧边栏拖拽调宽
  const handleMouseDownResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizingRef.current = true
    startXRef.current = e.clientX
    startWidthRef.current = sidebarWidth

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return
      const delta = moveEvent.clientX - startXRef.current
      const nextWidth = Math.max(200, Math.min(600, startWidthRef.current + delta))
      setSidebarWidth(nextWidth)
    }

    const handleMouseUp = () => {
      isResizingRef.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [sidebarWidth])

  // 关键字搜索过滤
  const isSearchActive = searchKeyword.trim().length > 0
  const searchLower = searchKeyword.trim().toLowerCase()

  // 递归判断节点或其子树是否匹配
  function checkArchiveNodeMatch(node: ArchiveNode, keyword: string): boolean {
    if (!keyword) return true
    if (node.name.toLowerCase().includes(keyword) || node.path.toLowerCase().includes(keyword)) {
      return true
    }
    if (node.isDirectory) {
      return node.children.some(child => checkArchiveNodeMatch(child, keyword))
    }
    return false
  }

  const nodeMatchesSearch = useCallback((node: ArchiveNode): boolean => {
    if (!isSearchActive) return true
    return checkArchiveNodeMatch(node, searchLower)
  }, [isSearchActive, searchLower])

  // 当搜索关键字变化时，自动展开所有包含匹配项的目录
  useEffect(() => {
    if (!isSearchActive || !treeRoot) return
    const matchedDirs = new Set<string>()
    function scan(node: ArchiveNode) {
      if (node.isDirectory) {
        const hasMatch = node.children.some(child => nodeMatchesSearch(child))
        if (hasMatch && node.path) {
          matchedDirs.add(node.path)
        }
        node.children.forEach(scan)
      }
    }
    scan(treeRoot)
    setExpandedPaths(prev => new Set([...prev, ...matchedDirs]))
  }, [isSearchActive, searchLower, treeRoot, nodeMatchesSearch])

  // 渲染单个树节点
  const renderTreeNode = (node: ArchiveNode, depth = 0) => {
    if (isSearchActive && !nodeMatchesSearch(node)) {
      return null
    }

    const isExpanded = expandedPaths.has(node.path)
    const isSelected = selectedNode?.path === node.path

    return (
      <div key={node.path || node.name} className="flex flex-col select-none">
        <div
          onClick={() => handleSelectNode(node)}
          className={cn(
            'group flex items-center gap-1.5 py-1 px-2 rounded-md text-xs cursor-pointer transition-colors',
            isSelected
              ? 'bg-primary/15 text-primary font-medium dark:bg-primary/25'
              : 'hover:bg-muted/60 text-foreground'
          )}
          style={{ paddingLeft: `${Math.max(8, depth * 14 + 6)}px` }}
          title={node.path || node.name}
        >
          {node.isDirectory ? (
            <button
              type="button"
              onClick={(e) => toggleExpand(node.path, e)}
              className="p-0.5 -ml-1 text-muted-foreground hover:text-foreground rounded transition-transform"
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
            </button>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}

          {/* 图标渲染 */}
          <div className="shrink-0 flex items-center justify-center">
            {node.isDirectory ? (
              isExpanded ? (
                <FolderOpen className="h-4 w-4 text-amber-500 fill-amber-500/20" />
              ) : (
                <Folder className="h-4 w-4 text-amber-500 fill-amber-500/20" />
              )
            ) : (
              renderFileIcon({ name: node.name, isDirectory: false }, 'h-4 w-4')
            )}
          </div>

          {/* 文件/目录名 */}
          <span className="truncate flex-1 font-mono text-[12px]">{node.name}</span>

          {/* 目录项数或文件大小标签 */}
          {node.isDirectory ? (
            <span className="text-[10px] text-muted-foreground/70 shrink-0 tabular-nums px-1 py-0.5 rounded bg-muted/50">
              {node.totalFiles}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/70 shrink-0 tabular-nums">
              {formatBytes(node.size)}
            </span>
          )}
        </div>

        {/* 子节点列表 */}
        {node.isDirectory && isExpanded && node.children.length > 0 && (
          <div className="flex flex-col">
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className={cn('w-full h-full flex flex-col items-center justify-center gap-3 bg-background text-muted-foreground', className)}>
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <p className="text-sm font-medium">正在解析压缩包目录结构...</p>
      </div>
    )
  }

  if (loadError || !treeRoot) {
    return (
      <div className={cn('w-full h-full flex flex-col items-center justify-center gap-2.5 p-6 bg-background text-center', className)}>
        <FileArchive className="h-10 w-10 text-muted-foreground/50 mb-1" />
        <h4 className="font-semibold text-base text-foreground">压缩包解构失败</h4>
        <p className="text-xs text-muted-foreground max-w-md">{loadError || '未能读取压缩包有效内容'}</p>
      </div>
    )
  }

  return (
    <div className={cn('w-full h-full flex flex-col overflow-hidden bg-background select-none', className)}>
      {/* 顶部总览状态栏 */}
      <div className="h-10 px-3 border-b flex items-center justify-between gap-2 shrink-0 bg-muted/20 text-xs">
        <div className="flex items-center gap-2 overflow-hidden">
          {!hideTitle && (
            <>
              <FileArchive className="h-4 w-4 text-primary shrink-0" />
              <span className="font-semibold truncate max-w-[220px]" title={fileName}>
                {fileName}
              </span>
              <span className="text-muted-foreground/60 text-xs shrink-0">·</span>
            </>
          )}
          <span className="text-muted-foreground/80 tabular-nums font-mono text-[11px]">
            {treeRoot.totalFiles.toLocaleString()} 个条目
          </span>
          <span className="text-muted-foreground/60 text-xs shrink-0">·</span>
          <span className="text-muted-foreground/80 tabular-nums font-mono text-[11px]">
            解压后 {formatBytes(treeRoot.totalSize)}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title={sidebarCollapsed ? '展开目录树' : '收起目录树'}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* 主体两栏布局 */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* 左侧：360 压缩风格树状目录 */}
        {!sidebarCollapsed && (
          <>
            <div
              className="flex flex-col border-r bg-muted/10 shrink-0 overflow-hidden"
              style={{ width: `${sidebarWidth}px` }}
            >
              {/* 搜索与快捷操作栏 */}
              <div className="p-2 border-b flex items-center gap-1.5 shrink-0 bg-background/50">
                <div className="relative flex-1 flex items-center">
                  <Search className="absolute left-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    placeholder="搜索包内文件..."
                    className="w-full h-7 pl-7 pr-6 text-xs bg-muted/40 border border-input/60 rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  {searchKeyword && (
                    <button
                      type="button"
                      onClick={() => setSearchKeyword('')}
                      className="absolute right-1.5 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleExpandAll}
                  className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted"
                  title="展开全部"
                >
                  <Expand className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleCollapseAll}
                  className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted"
                  title="收起全部"
                >
                  <Shrink className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* 树节点滚动列表 */}
              <div className="flex-1 overflow-auto p-1.5 space-y-0.5">
                {treeRoot.children.map(child => renderTreeNode(child, 0))}
              </div>
            </div>

            {/* 拖拽调节宽度的分界线 */}
            <div
              onMouseDown={handleMouseDownResize}
              className="w-1 cursor-col-resize hover:bg-primary/50 active:bg-primary transition-colors shrink-0 z-10"
              title="拖拽调节侧边栏宽度"
            />
          </>
        )}

        {/* 右侧：单文件内容联动预览区 */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
          {selectedNode && !selectedNode.isDirectory ? (
            <>
              {/* 文件操作头部工具栏 */}
              <div className="h-10 px-4 border-b flex items-center justify-between gap-3 shrink-0 bg-muted/10 text-xs">
                <div className="flex items-center gap-2 overflow-hidden">
                  {renderFileIcon({ name: selectedNode.name, isDirectory: false }, 'h-4 w-4 shrink-0')}
                  <span className="font-semibold text-foreground truncate max-w-[200px]" title={selectedNode.name}>
                    {selectedNode.name}
                  </span>
                  <span className="text-muted-foreground/60 text-[11px] truncate max-w-[320px]" title={selectedNode.path}>
                    ({selectedNode.path})
                  </span>
                  <span className="text-muted-foreground tabular-nums">· {formatBytes(selectedNode.size)}</span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {subFileContent !== null && (
                    <>
                      {getExt(selectedNode.name) === 'json' && (
                        <button
                          type="button"
                          onClick={handleToggleFormatJson}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                          title="格式化 JSON (缩进排版 / 紧凑排版)"
                        >
                          <Braces className="h-3 w-3 text-primary" />
                          <span>格式化</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setWrapText(!wrapText)}
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors',
                          wrapText ? 'bg-primary/10 border-primary/30 text-primary' : 'hover:bg-muted border-border text-muted-foreground'
                        )}
                        title="切换自动换行"
                      >
                        <WrapText className="h-3 w-3" />
                        <span>换行</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleCopyContent}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                        <span>{copied ? '已复制' : '复制'}</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* 文件内容渲染区域 */}
              <div className="flex-1 overflow-auto relative">
                {subFileLoading ? (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <span className="text-xs">正在解压读取文件内容...</span>
                  </div>
                ) : subFileError ? (
                  <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-destructive">
                    <p className="text-sm font-medium">预览加载失败</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-md">{subFileError}</p>
                  </div>
                ) : subFileContent !== null ? (
                  isLogFileName(selectedNode.name) || subFileContent.length > 50000 ? (
                    <LogViewer
                      data={subFileContent}
                      fileName={selectedNode.name}
                      fileSize={selectedNode.size}
                      className="h-full"
                      initialScrollToBottom={isLogFileName(selectedNode.name)}
                    />
                  ) : (
                    <div className="p-4 font-mono text-xs leading-relaxed select-text">
                      <pre className={cn('overflow-x-auto tab-size-4', wrapText ? 'whitespace-pre-wrap break-all' : 'whitespace-pre')}>
                        {subFileContent}
                      </pre>
                    </div>
                  )
                ) : subFileBlobUrl && IMAGE_EXTS.has(getExt(selectedNode.name)) ? (
                  <div className="w-full h-full flex items-center justify-center p-4 bg-muted/5 overflow-auto">
                    <img
                      src={subFileBlobUrl}
                      alt={selectedNode.name}
                      className="max-w-full max-h-full object-contain rounded shadow-sm border"
                    />
                  </div>
                ) : subFileBlobUrl && AUDIO_EXTS.has(getExt(selectedNode.name)) ? (
                  <div className="w-full h-full flex flex-col items-center justify-center p-6 gap-4">
                    <FileAudio className="h-16 w-16 text-primary/60" />
                    <audio controls src={subFileBlobUrl} className="w-80" />
                  </div>
                ) : subFileBlobUrl && VIDEO_EXTS.has(getExt(selectedNode.name)) ? (
                  <div className="w-full h-full flex items-center justify-center p-4 bg-black">
                    <video controls src={subFileBlobUrl} className="max-w-full max-h-full" />
                  </div>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-muted-foreground gap-3">
                    <GenericFile className="h-12 w-12 text-muted-foreground/40" />
                    <div>
                      <p className="text-sm font-medium text-foreground">二进制或专有格式文件</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        大小：{formatBytes(selectedNode.size)} · 后缀：.{getExt(selectedNode.name) || '无'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* 未选中具体文件或选中了目录时的概览卡片 */
            <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
              {selectedNode ? (
                <div className="max-w-md flex flex-col items-center gap-2">
                  <Folder className="h-12 w-12 text-amber-500/70 fill-amber-500/20 mb-1" />
                  <h4 className="font-semibold text-base text-foreground font-mono">{selectedNode.name}</h4>
                  <p className="text-xs text-muted-foreground font-mono">{selectedNode.path}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs tabular-nums text-foreground/80 bg-muted/40 px-3 py-1.5 rounded-md">
                    <span>包含 {selectedNode.totalFiles} 个文件</span>
                    <span>·</span>
                    <span>{selectedNode.totalDirs} 个子目录</span>
                    <span>·</span>
                    <span>共 {formatBytes(selectedNode.totalSize)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground/70 mt-3">
                    请在左侧展开此目录并点击具体文件进行内容预览
                  </p>
                </div>
              ) : (
                <div className="max-w-md flex flex-col items-center gap-2">
                  <FileArchive className="h-12 w-12 text-primary/60 mb-1" />
                  <h4 className="font-semibold text-base text-foreground">{fileName}</h4>
                  <p className="text-xs text-muted-foreground">
                    压缩包内共有 {treeRoot.totalFiles.toLocaleString()} 个文件，未解压总大小 {formatBytes(treeRoot.totalSize)}
                  </p>
                  <p className="text-xs text-muted-foreground/70 mt-3">
                    👈 请在左侧树状目录中点击文件以在线联动预览
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
