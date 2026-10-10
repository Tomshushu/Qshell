import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  FolderUp,
  HardDrive,
  Home,
  Loader2,
  Monitor,
  Music,
  RefreshCw,
  Search,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { backend } from '@/services/api'
import { useTranslation } from '@/i18n'
import {
  type LocalFile,
  type QuickAccessEntry,
  type TreeNode,
  buildDescendantPaths,
  findContainingRoot,
  findTreeNode,
  formatFileSize,
  getFileTypeLabel,
  getParentPath,
  getPathBreadcrumbs,
  localFilesToTreeNodes,
  pathsEqual,
  readLastLocalPath,
  renderFileIcon,
  updateTreeNode,
  writeLastLocalPath,
} from './local-file-picker-utils'

interface LocalFilePickerProps {
  open: boolean
  onClose: () => void
  onConfirm: (selectedPaths: string[]) => void
  multiSelect?: boolean
  remoteDir?: string
}

function quickAccessIcon(type: string) {
  switch (type) {
    case 'desktop': return Monitor
    case 'downloads': return Download
    case 'documents': return FileText
    case 'pictures': return FileImage
    case 'music': return Music
    case 'videos': return Video
    case 'home': return Home
    default: return Folder
  }
}

function quickAccessColor(type: string): string {
  switch (type) {
    case 'desktop': return 'text-blue-500'
    case 'downloads': return 'text-green-500'
    case 'documents': return 'text-orange-500'
    case 'pictures': return 'text-pink-500'
    case 'music': return 'text-purple-500'
    case 'videos': return 'text-red-500'
    default: return 'text-amber-500'
  }
}

function rootDisplayName(rootPath: string): string {
  if (/^[A-Za-z]:\\?$/.test(rootPath)) return rootPath.replace('\\', '')
  if (rootPath === '/') return '/'
  const parts = rootPath.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] || rootPath
}

export function LocalFilePicker({
  open,
  onClose,
  onConfirm,
  multiSelect = true,
  remoteDir = '/',
}: LocalFilePickerProps) {
  const [currentPath, setCurrentPath] = useState('')
  const [files, setFiles] = useState<LocalFile[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quickAccess, setQuickAccess] = useState<QuickAccessEntry[]>([])
  const [systemRoots, setSystemRoots] = useState<string[]>([])
  const [platform, setPlatform] = useState('win32')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [treeRoots, setTreeRoots] = useState<TreeNode[]>([])
  const [lastClickedPath, setLastClickedPath] = useState<string | null>(null)

  const { t } = useTranslation()

  const treeLoadingRef = useRef(new Set<string>())
  const initTokenRef = useRef(0)

  const resetState = useCallback(() => {
    setCurrentPath('')
    setFiles([])
    setSelectedPaths(new Set())
    setSearchQuery('')
    setLoading(false)
    setError(null)
    setExpandedPaths(new Set())
    setTreeRoots([])
    setLastClickedPath(null)
    treeLoadingRef.current.clear()
  }, [])

  const listDirectory = useCallback(async (dirPath: string): Promise<LocalFile[]> => {
    if (!backend) throw new Error(t('fp_err_not_desktop'))
    const result = await backend.files.listLocalDirectory(dirPath)
    if (!result.success) {
      throw new Error(result.error || t('fp_err_read_dir'))
    }
    return result.files
  }, [t])

  const loadDirectory = useCallback(async (dirPath: string) => {
    if (!dirPath) return
    setLoading(true)
    setError(null)
    try {
      const data = await listDirectory(dirPath)
      setFiles(data)
      setCurrentPath(dirPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fp_err_load'))
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [listDirectory, t])

  const loadTreeNodeChildren = useCallback(async (nodePath: string, force = false) => {
    if (treeLoadingRef.current.has(nodePath) && !force) return

    let canLoad = false
    setTreeRoots(prev => prev.map(root => {
      const node = findTreeNode(root, nodePath)
      if (!node || node.loading) return root
      if (node.loaded && !force) return root
      canLoad = true
      treeLoadingRef.current.add(nodePath)
      return updateTreeNode(root, nodePath, n => ({ ...n, loading: true }))
    }))

    if (!canLoad) return

    let children: TreeNode[] = []
    try {
      const data = await listDirectory(nodePath)
      children = localFilesToTreeNodes(data)
    } catch {
      children = []
    } finally {
      treeLoadingRef.current.delete(nodePath)
      setTreeRoots(prev => prev.map(root => {
        const node = findTreeNode(root, nodePath)
        if (!node) return root
        return updateTreeNode(root, nodePath, n => ({
          ...n,
          children,
          loaded: true,
          loading: false,
        }))
      }))
    }
  }, [listDirectory])

  const revealPathInTree = useCallback(async (targetPath: string, roots: string[]) => {
    if (!targetPath || roots.length === 0) return
    const rootPath = findContainingRoot(targetPath, roots)
    const paths = buildDescendantPaths(rootPath, targetPath)

    setExpandedPaths(prev => {
      const next = new Set(prev)
      paths.forEach(p => next.add(p))
      return next
    })

    for (const path of paths) {
      await loadTreeNodeChildren(path)
    }
  }, [loadTreeNodeChildren])

  const initializeDialog = useCallback(async () => {
    const token = ++initTokenRef.current
    resetState()

    try {
      if (!backend) throw new Error(t('fp_err_not_desktop'))
      const [quickItems, roots] = await Promise.all([
        backend.files.getQuickAccess(),
        backend.files.getSystemRoots(),
      ])
      if (token !== initTokenRef.current) return

      const entries = (quickItems || []) as QuickAccessEntry[]
      setQuickAccess(entries)
      setSystemRoots(roots || [])
      if (entries[0]?.platform) setPlatform(entries[0].platform)

      const tree = (roots || []).map((root: string) => ({
        path: root,
        name: rootDisplayName(root),
        children: [],
        loaded: false,
        loading: false,
      }))
      setTreeRoots(tree)

      const remembered = readLastLocalPath()
      // Match by path (not display name) to support non-Chinese Windows locales
      const fallback = entries.find(i => /[/\\]Desktop$/i.test(i.path))?.path || entries[0]?.path || roots[0] || ''
      const initialPath = remembered || fallback
      if (!initialPath) return

      await loadDirectory(initialPath)
      if (token !== initTokenRef.current) return
      await revealPathInTree(initialPath, roots || [])
    } catch (err) {
      if (token !== initTokenRef.current) return
      setError(err instanceof Error ? err.message : t('fp_err_init'))
    }
  }, [loadDirectory, resetState, revealPathInTree, t])

  useEffect(() => {
    if (open) {
      // 延后到宏任务初始化，避免在 effect 内同步 setState 触发级联渲染
      const timer = setTimeout(() => {
        void initializeDialog()
      }, 0)
      return () => clearTimeout(timer)
    }
    initTokenRef.current += 1
  }, [open, initializeDialog])

  const navigateTo = useCallback(async (dirPath: string) => {
    await loadDirectory(dirPath)
    await revealPathInTree(dirPath, systemRoots)
  }, [loadDirectory, revealPathInTree, systemRoots])

  const toggleTreeExpand = useCallback((nodePath: string) => {
    const isExpanded = expandedPaths.has(nodePath)
    if (isExpanded) {
      setExpandedPaths(prev => {
        const next = new Set(prev)
        next.delete(nodePath)
        return next
      })
      return
    }
    setExpandedPaths(prev => new Set(prev).add(nodePath))
    void loadTreeNodeChildren(nodePath)
  }, [expandedPaths, loadTreeNodeChildren])

  const toggleSelection = useCallback((file: LocalFile, event?: React.MouseEvent) => {
    const path = file.path
    setLastClickedPath(path)

    if (!multiSelect) {
      setSelectedPaths(new Set([path]))
      return
    }

    if (event?.ctrlKey || event?.metaKey) {
      setSelectedPaths(prev => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        return next
      })
      return
    }

    if (event?.shiftKey && lastClickedPath) {
      const ordered = files.map(f => f.path)
      const start = ordered.indexOf(lastClickedPath)
      const end = ordered.indexOf(path)
      if (start >= 0 && end >= 0) {
        const [from, to] = start < end ? [start, end] : [end, start]
        const range = ordered.slice(from, to + 1)
        setSelectedPaths(prev => new Set([...prev, ...range]))
        return
      }
    }

    setSelectedPaths(new Set([path]))
  }, [files, lastClickedPath, multiSelect])

  const handleRowClick = (file: LocalFile, event: React.MouseEvent) => {
    if (file.isDirectory && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      void navigateTo(file.path)
      return
    }
    toggleSelection(file, event)
  }

  const handleRowDoubleClick = (file: LocalFile) => {
    if (file.isDirectory) {
      void navigateTo(file.path)
    } else if (!selectedPaths.has(file.path)) {
      setSelectedPaths(new Set([file.path]))
    }
  }

  const selectCurrentFolder = () => {
    if (!currentPath) return
    if (multiSelect) {
      setSelectedPaths(prev => new Set(prev).add(currentPath))
    } else {
      setSelectedPaths(new Set([currentPath]))
    }
  }

  const removeSelection = (path: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev)
      next.delete(path)
      return next
    })
  }

  const handleConfirm = () => {
    if (selectedPaths.size === 0) return
    writeLastLocalPath(currentPath)
    onConfirm(Array.from(selectedPaths))
    onClose()
  }

  const handleClose = () => {
    if (currentPath) writeLastLocalPath(currentPath)
    onClose()
  }

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return files
    return files.filter(f => f.name.toLowerCase().includes(q))
  }, [files, searchQuery])

  const breadcrumbs = useMemo(() => getPathBreadcrumbs(currentPath), [currentPath])
  const parentPath = currentPath ? getParentPath(currentPath) : null
  const selectedItems = useMemo(
    () => Array.from(selectedPaths).map(path => ({ path, name: path.split(/[/\\]/).pop() || path })),
    [selectedPaths],
  )

  const renderTreeNode = (node: TreeNode, depth = 0) => {
    const isExpanded = expandedPaths.has(node.path)
    const isActive = pathsEqual(currentPath, node.path)
    const isLoading = node.loading

    const isRoot = depth === 0
    const Icon = isRoot ? HardDrive : Folder
    const iconClass = isRoot ? 'text-blue-500' : 'text-amber-500'

    return (
      <div key={node.path}>
        <button
          type="button"
          className={cn(
            'w-full flex items-center gap-1 py-1 pr-2 rounded-md text-xs transition-colors hover:bg-accent/80',
            isActive && 'bg-accent text-foreground font-medium',
          )}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onMouseDown={(e) => {
            if (e.button !== 0) return
            void navigateTo(node.path)
            if (!isExpanded) toggleTreeExpand(node.path)
          }}
          onClick={(e) => {
            if (e.detail === 0) {
              void navigateTo(node.path)
              if (!isExpanded) toggleTreeExpand(node.path)
            }
          }}
        >
          <span
            className="shrink-0 p-0.5 rounded hover:bg-muted"
            onMouseDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              toggleTreeExpand(node.path)
            }}
            onClick={(e) => {
              e.stopPropagation()
              if (e.detail === 0) {
                toggleTreeExpand(node.path)
              }
            }}
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : isExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </span>
          <Icon className={cn('h-3.5 w-3.5 shrink-0', iconClass)} />
          <span className="truncate text-left">{node.name}</span>
        </button>
        {isExpanded && node.children.length > 0 && (
          <div>{node.children.map(child => renderTreeNode(child, depth + 1))}</div>
        )}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose() }}>
      <DialogContent className="max-w-6xl w-[95vw] h-[min(720px,88vh)] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b bg-card/50 space-y-2">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="space-y-1 min-w-0">
              <DialogTitle className="flex items-center gap-2 text-base">
                <Upload className="h-4 w-4 text-primary" />
                {t('fp_select_files')}
              </DialogTitle>
              <DialogDescription className="text-xs font-mono truncate">
                {t('fp_upload_to')}{remoteDir || '/'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 flex min-h-0">
          {/* 左侧导航 */}
          <aside className="w-60 border-r bg-muted/20 flex flex-col shrink-0">
            {quickAccess.length > 0 && (
              <div className="p-3 border-b space-y-2">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{t('fp_quick_access')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {quickAccess.map(item => {
                    const Icon = quickAccessIcon(item.type)
                    const active = pathsEqual(currentPath, item.path)
                    return (
                      <button
                        key={item.path}
                        type="button"
                        title={item.path}
                        onClick={() => void navigateTo(item.path)}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] border transition-colors',
                          active
                            ? 'bg-primary/10 border-primary/30 text-primary'
                            : 'bg-background hover:bg-accent border-border text-foreground',
                        )}
                      >
                        <Icon className={cn('h-3.5 w-3.5', quickAccessColor(item.type))} />
                        <span className="max-w-[72px] truncate">{t('quick_access_' + item.type) || item.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="px-3 py-2 border-b flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                {platform === 'win32' ? t('fp_this_pc') : t('fp_filesystem')}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => currentPath && void loadDirectory(currentPath)}
              >
                <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
              </Button>
            </div>

            <ScrollArea className="flex-1">
              <div className="py-1 px-1">
                {treeRoots.map(root => renderTreeNode(root, 0))}
              </div>
            </ScrollArea>
          </aside>

          {/* 右侧文件区 */}
          <section className="flex-1 flex flex-col min-w-0">
            <div className="px-4 py-2.5 border-b bg-card/30 flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={!parentPath}
                onClick={() => parentPath && void navigateTo(parentPath)}
                title={t('fp_parent_dir')}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>

              <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto text-xs">
                {breadcrumbs.length === 0 ? (
                  <span className="text-muted-foreground">{t('fp_not_selected')}</span>
                ) : (
                  breadcrumbs.map((crumb, idx) => (
                    <span key={crumb.path} className="flex items-center gap-1 shrink-0">
                      {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
                      <button
                        type="button"
                        className={cn(
                          'px-1.5 py-0.5 rounded hover:bg-accent transition-colors max-w-[140px] truncate',
                          idx === breadcrumbs.length - 1 ? 'font-medium' : 'text-muted-foreground',
                        )}
                        onClick={() => void navigateTo(crumb.path)}
                      >
                        {crumb.label}
                      </button>
                    </span>
                  ))
                )}
              </div>

              <div className="relative w-44 shrink-0">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('fp_filter_placeholder')}
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>

            {error && (
              <div className="mx-4 mt-3 px-3 py-2 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">
                {error}
              </div>
            )}

            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="text-sm">{t('fp_reading')}</span>
                </div>
              ) : filteredFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                  <FolderOpen className="h-8 w-8 opacity-30" />
                  <span className="text-sm">{searchQuery ? t('fp_no_match') : t('fp_empty_folder')}</span>
                </div>
              ) : (
                <div className="m-2 rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="workspace-table-head">
                    <tr className="text-left text-muted-foreground">
                      <th className="w-10 px-3 py-2" />
                      <th className="px-3 py-2 font-medium">{t('fp_th_name')}</th>
                      <th className="px-3 py-2 font-medium w-28">{t('fp_th_size')}</th>
                      <th className="px-3 py-2 font-medium w-40">{t('fp_th_modified')}</th>
                      <th className="px-3 py-2 font-medium w-32">{t('fp_th_type')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFiles.map(file => {
                      const selected = selectedPaths.has(file.path)
                      return (
                        <tr
                          key={file.path}
                          className={cn(
                            'workspace-table-row border-b cursor-pointer select-none',
                            selected && 'is-selected',
                          )}
                          onMouseDown={(e) => {
                            if (e.button !== 0) return
                            handleRowClick(file, e)
                          }}
                          onClick={(e) => {
                            if (e.detail === 0) {
                              handleRowClick(file, e)
                            }
                          }}
                          onDoubleClick={() => handleRowDoubleClick(file)}
                        >
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className={cn(
                                'h-4 w-4 rounded border flex items-center justify-center transition-colors',
                                selected
                                  ? 'bg-primary border-primary text-primary-foreground'
                                  : 'border-muted-foreground/40 hover:border-primary/60',
                              )}
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleSelection(file, e)
                              }}
                            >
                              {selected && <Check className="h-3 w-3" />}
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {renderFileIcon(file)}
                              <span className={cn('truncate', file.isDirectory && 'font-medium')}>
                                {file.name}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {file.isDirectory ? '-' : formatFileSize(file.size)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{file.modified}</td>
                          <td className="px-3 py-2 text-muted-foreground">{t(getFileTypeLabel(file))}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* 底部操作栏 */}
        <div className="border-t bg-card/50 px-5 py-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5 shrink-0"
                disabled={!currentPath}
                onClick={selectCurrentFolder}
              >
                <FolderUp className="h-3.5 w-3.5" />
                {t('fp_select_current')}
              </Button>
              <span className="text-xs text-muted-foreground truncate">
                {t('fp_upload_hint')}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" onClick={handleClose}>
                {t('common_cancel')}
              </Button>
              <Button onClick={handleConfirm} disabled={selectedPaths.size === 0} className="gap-1.5">
                <Upload className="h-4 w-4" />
                {t('fp_upload_n').replace('{n}', String(selectedPaths.size))}
              </Button>
            </div>
          </div>

          {selectedItems.length > 0 && (
            <div className="flex flex-wrap gap-1.5 max-h-20 overflow-auto">
              {selectedItems.map(item => (
                <span
                  key={item.path}
                  className="inline-flex items-center gap-1 max-w-[240px] pl-2 pr-1 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] border border-primary/20"
                  title={item.path}
                >
                  <span className="truncate">{item.name}</span>
                  <button
                    type="button"
                    className="p-0.5 rounded-full hover:bg-primary/20"
                    onClick={() => removeSelection(item.path)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
