import React from 'react'
import { createPortal } from 'react-dom'
import {
  RefreshCw,
  Copy,
  Check,
  Plus,
  ChevronRight,
  FolderPlus,
  FilePlus,
  Upload,
  FolderInput,
  Download,
  Eye,
  Edit3,
  Pencil,
  Shield,
  Info,
  Trash2,
  Loader2,
  Bookmark,
  EyeOff,
} from 'lucide-react'
import { ArchiveFileIcon } from '@/components/ui/file-icons'
import { ContextMenuShortcut } from '@/components/ui/context-menu'
import { isSupportedArchiveName } from '@/components/sftp/sftp-utils'
import { cn } from '@/lib/utils'
import { clampMenuToViewport, computeSubMenuPosition } from '@/lib/menu-position'
import type { FileEntry } from '@/types'
import type { ContextMenuState } from './types'

interface FileContextMenuProps {
  ctxMenu: ContextMenuState | null
  ctxMenuRef: React.RefObject<HTMLDivElement | null>
  currentPath: string
  selectedFiles: string[]
  transferLoading: string | null
  extractingArchive?: string | null
  isWindows: boolean
  onClose: () => void
  showHidden?: boolean
  onToggleShowHidden?: () => void
  onRefresh: () => void
  onNewItem: (type: 'file' | 'dir') => void
  onNativeUpload: (isFolder: boolean) => void
  onDownloadMultiple: (paths: string[]) => void
  onPreview: (file: FileEntry) => void
  onNavigateTo: (path: string) => void
  onOpenEditor: (file: FileEntry) => void
  onStartRename: (file: FileEntry) => void
  onDownload: (file: FileEntry) => void
  onDownloadArchive: (file: FileEntry, format: string) => void
  onExtractArchive?: (file: FileEntry) => void
  onChangePermissions: (file: FileEntry) => void
  onShowProperties: (file: FileEntry) => void
  onDelete: (paths: string[]) => void
  bookmarks?: string[]
  onAddBookmark?: (path: string) => void
  onRemoveBookmark?: (path: string) => void
  t: (key: string) => string
}

const itemClass =
  'relative flex w-full cursor-pointer select-none items-center rounded-lg px-2.5 py-1.5 text-xs outline-none hover:bg-accent hover:text-accent-foreground transition-colors disabled:pointer-events-none disabled:opacity-50 text-left'

export function FileContextMenu({
  ctxMenu,
  ctxMenuRef,
  currentPath,
  selectedFiles,
  transferLoading,
  extractingArchive,
  isWindows,
  onClose,
  showHidden,
  onToggleShowHidden,
  onRefresh,
  onNewItem,
  onNativeUpload,
  onDownloadMultiple,
  onPreview,
  onNavigateTo,
  onOpenEditor,
  onStartRename,
  onDownload,
  onDownloadArchive,
  onExtractArchive,
  onChangePermissions,
  onShowProperties,
  onDelete,
  bookmarks,
  onAddBookmark,
  onRemoveBookmark,
  t,
}: FileContextMenuProps) {
  const [copied, setCopied] = React.useState(false)
  const [activeSubMenu, setActiveSubMenu] = React.useState<'new' | 'upload' | 'archive' | null>(null)
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // 组件卸载时清理定时器
  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  if (!ctxMenu || typeof document === 'undefined') return null
  const { file } = ctxMenu
  const isDirectory = file?.isDirectory ?? false
  // 多选模式:右键的文件在选中列表中且选中数>1时,只保留批量操作
  const multiSelect = !!file && selectedFiles.length > 1 && selectedFiles.includes(file.path)

  // 动态根据菜单类型估算高度，避免把条目少的菜单误判为 480 导致在视口下方被过度上推
  const estimatedH = multiSelect ? 160 : !file ? 150 : isDirectory ? 380 : 340
  // 边界检测: 主菜单预估宽度 220（含 padding）
  const mainPos = clampMenuToViewport(ctxMenu.x, ctxMenu.y, 220, estimatedH)
  // 子菜单方向: 根据父菜单右侧剩余空间决定向右/向左展开
  const newSub = computeSubMenuPosition(mainPos.left, mainPos.top, 220, 160, 80)
  const uploadSub = computeSubMenuPosition(mainPos.left, mainPos.top, 220, 160, 80)
  const archiveSub = computeSubMenuPosition(mainPos.left, mainPos.top, 220, 180, 200)

  const handleCopyPath = () => {
    const pathToCopy = file?.path || currentPath
    navigator.clipboard.writeText(pathToCopy)
    setCopied(true)
    setTimeout(() => {
      setCopied(false)
      onClose()
    }, 800)
  }

  const openSubMenu = (menu: 'new' | 'upload' | 'archive') => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setActiveSubMenu(menu)
  }

  const scheduleCloseSubMenu = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
    }
    closeTimerRef.current = setTimeout(() => {
      setActiveSubMenu(null)
    }, 180)
  }

  const keepSubMenuOpen = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  return createPortal(
    <div
      ref={ctxMenuRef}
      className="fixed z-[9999] min-w-[13rem] glass-strong rounded-xl border border-border/60 shadow-xl p-1.5 text-xs text-popover-foreground select-none animate-in fade-in-0 zoom-in-95 duration-100"
      style={{ left: mainPos.left, top: mainPos.top }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 多选模式下在顶部展示选中的文件数量信息 */}
      {multiSelect && (
        <>
          <div className="px-2.5 py-1 text-[11px] font-medium text-muted-foreground/80 select-none">
            {t('fs_selected_n').replace('{n}', String(selectedFiles.length))}
          </div>
          <div className="-mx-1 my-1 h-px bg-border/50" />
        </>
      )}

      <button
        className={itemClass}
        onMouseEnter={() => setActiveSubMenu(null)}
        onClick={() => {
          onRefresh()
          onClose()
        }}
      >
        <RefreshCw className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
        <span>{t('fs_refresh')}</span>
        <ContextMenuShortcut>F5</ContextMenuShortcut>
      </button>

      {onToggleShowHidden && (
        <button
          className={itemClass}
          onMouseEnter={() => setActiveSubMenu(null)}
          onClick={() => {
            onToggleShowHidden()
            onClose()
          }}
        >
          {showHidden ? (
            <EyeOff className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <Eye className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span>{showHidden ? (t('sftp_hide_hidden') || 'Hide Hidden Files') : (t('sftp_show_hidden') || 'Show Hidden Files')}</span>
        </button>
      )}

      <button
        className={itemClass}
        onMouseEnter={() => setActiveSubMenu(null)}
        onClick={handleCopyPath}
      >
        {copied ? (
          <Check className="mr-2 h-4 w-4 shrink-0 text-green-500" />
        ) : (
          <Copy className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span>{copied ? (t('fs_copy_path_done') || t('sftp_copy_path_done')) : t('fs_copy_path')}</span>
      </button>

      {!multiSelect && (
        <>
          <div
            className="relative"
            onMouseEnter={() => openSubMenu('new')}
            onMouseLeave={scheduleCloseSubMenu}
          >
            <button className={itemClass}>
              <Plus className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{t('fs_new')}</span>
              <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
            </button>
            {activeSubMenu === 'new' && (
              <div
                className={cn(
                  'absolute -top-1.5 flex flex-col min-w-[12rem] glass-strong rounded-xl border border-border/60 shadow-xl p-1.5 text-xs text-popover-foreground select-none animate-in fade-in-0 zoom-in-95 duration-100',
                  newSub.side === 'right' ? 'left-full ml-1' : 'right-full mr-1'
                )}
                onMouseEnter={keepSubMenuOpen}
                onMouseLeave={scheduleCloseSubMenu}
              >
                <button
                  className={itemClass}
                  onClick={() => {
                    onNewItem('dir')
                    onClose()
                  }}
                >
                  <FolderPlus className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="whitespace-nowrap">{t('fs_new_folder')}</span>
                  <ContextMenuShortcut className="shrink-0">Ctrl+Shift+N</ContextMenuShortcut>
                </button>
                <button
                  className={itemClass}
                  onClick={() => {
                    onNewItem('file')
                    onClose()
                  }}
                >
                  <FilePlus className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{t('fs_new_file')}</span>
                </button>
              </div>
            )}
          </div>

          <div
            className="relative"
            onMouseEnter={() => openSubMenu('upload')}
            onMouseLeave={scheduleCloseSubMenu}
          >
            <button
              className={itemClass}
              disabled={transferLoading === 'upload'}
            >
              <Upload className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{t('fs_upload_here')}</span>
              <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
            </button>
            {activeSubMenu === 'upload' && (
              <div
                className={cn(
                  'absolute -top-1.5 flex flex-col min-w-[10rem] glass-strong rounded-xl border border-border/60 shadow-xl p-1.5 text-xs text-popover-foreground select-none animate-in fade-in-0 zoom-in-95 duration-100',
                  uploadSub.side === 'right' ? 'left-full ml-1' : 'right-full mr-1'
                )}
                onMouseEnter={keepSubMenuOpen}
                onMouseLeave={scheduleCloseSubMenu}
              >
                <button
                  className={itemClass}
                  disabled={transferLoading === 'upload'}
                  onClick={() => {
                    onNativeUpload(false)
                    onClose()
                  }}
                >
                  <Upload className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{t('fs_upload_file')}</span>
                </button>
                <button
                  className={itemClass}
                  disabled={transferLoading === 'upload'}
                  onClick={() => {
                    onNativeUpload(true)
                    onClose()
                  }}
                >
                  <FolderInput className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{t('fs_upload_folder')}</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {file && (
        <>
          <div className="-mx-1 my-1 h-px bg-border/50" />

          {multiSelect ? (
            /* 多选模式: 批量下载 */
            <button
              className={itemClass}
              disabled={transferLoading === 'download'}
              onMouseEnter={() => setActiveSubMenu(null)}
              onClick={() => {
                onDownloadMultiple(selectedFiles)
                onClose()
              }}
            >
              <Download className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{t('fs_download_local')}</span>
            </button>
          ) : (
            <>
              {!isDirectory && (
                <button
                  className={itemClass}
                  onMouseEnter={() => setActiveSubMenu(null)}
                  onClick={() => {
                    onPreview(file)
                    onClose()
                  }}
                >
                  <Eye className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{t('fs_preview')}</span>
                </button>
              )}
              {isDirectory ? (
                <>
                  <button
                    className={itemClass}
                    onMouseEnter={() => setActiveSubMenu(null)}
                    onClick={() => {
                      onNavigateTo(file.path)
                      onClose()
                    }}
                  >
                    <FolderInput className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>{t('fs_enter_dir')}</span>
                  </button>
                  {onAddBookmark && onRemoveBookmark && bookmarks && (
                    <button
                      className={itemClass}
                      onMouseEnter={() => setActiveSubMenu(null)}
                      onClick={() => {
                        if (bookmarks.includes(file.path)) {
                          onRemoveBookmark(file.path)
                        } else {
                          onAddBookmark(file.path)
                        }
                        onClose()
                      }}
                    >
                      <Bookmark
                        className={cn(
                          "mr-2 h-4 w-4 shrink-0",
                          bookmarks.includes(file.path)
                            ? "fill-amber-500 text-amber-500"
                            : "text-muted-foreground"
                        )}
                      />
                      <span>
                        {bookmarks.includes(file.path)
                          ? (t('sftp_remove_current_bookmark') || 'Remove Bookmark')
                          : (t('sftp_add_bookmark') || 'Bookmark Path')}
                      </span>
                    </button>
                  )}
                </>
              ) : (
                <button
                  className={itemClass}
                  onMouseEnter={() => setActiveSubMenu(null)}
                  onClick={() => {
                    onOpenEditor(file)
                    onClose()
                  }}
                >
                  <Edit3 className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{t('fs_edit_file')}</span>
                </button>
              )}

              <button
                className={itemClass}
                onMouseEnter={() => setActiveSubMenu(null)}
                onClick={() => {
                  onStartRename(file)
                  onClose()
                }}
              >
                <Pencil className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{t('fs_rename')}</span>
                <ContextMenuShortcut>F2</ContextMenuShortcut>
              </button>

              <button
                className={itemClass}
                disabled={transferLoading === file.path}
                onMouseEnter={() => setActiveSubMenu(null)}
                onClick={() => {
                  onDownload(file)
                  onClose()
                }}
              >
                <Download className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{isDirectory ? t('fs_download_dir') : t('fs_download_local')}</span>
              </button>

              {!isDirectory && isSupportedArchiveName(file.name) && onExtractArchive && (
                <button
                  className={itemClass}
                  disabled={transferLoading === file.path || extractingArchive === file.path}
                  onMouseEnter={() => setActiveSubMenu(null)}
                  onClick={() => {
                    onExtractArchive(file)
                    onClose()
                  }}
                >
                  {extractingArchive === file.path ? (
                    <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <ArchiveFileIcon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span>{t('fs_extract_archive') || t('sftp_extract_archive')}</span>
                </button>
              )}

              {isDirectory && (
                <div
                  className="relative"
                  onMouseEnter={() => openSubMenu('archive')}
                  onMouseLeave={scheduleCloseSubMenu}
                >
                  <button
                    className={itemClass}
                    disabled={transferLoading === file.path}
                  >
                    <ArchiveFileIcon className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>{t('fs_pack_download')}</span>
                    <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  {activeSubMenu === 'archive' && (
                    <div
                      className={cn(
                        'absolute -top-1.5 flex flex-col min-w-[12rem] max-h-[300px] overflow-y-auto glass-strong rounded-xl border border-border/60 shadow-xl p-1.5 text-xs text-popover-foreground select-none animate-in fade-in-0 zoom-in-95 duration-100',
                        archiveSub.side === 'right' ? 'left-full ml-1' : 'right-full mr-1'
                      )}
                      onMouseEnter={keepSubMenuOpen}
                      onMouseLeave={scheduleCloseSubMenu}
                    >
                      {[
                        { format: 'tar.gz', label: 'tar.gz', desc: t('fs_format_gzip') },
                        { format: 'tar.bz2', label: 'tar.bz2', desc: t('fs_format_bzip2') },
                        { format: 'tar.xz', label: 'tar.xz', desc: t('fs_format_xz') },
                        { format: 'zip', label: 'zip', desc: t('fs_format_zip') },
                        { format: 'tar', label: 'tar', desc: t('fs_format_tar') },
                      ].map((item) => (
                        <button
                          key={item.format}
                          className={itemClass}
                          disabled={transferLoading === file.path}
                          onClick={() => {
                            onDownloadArchive(file, item.format)
                            onClose()
                          }}
                        >
                          <span>{item.label}</span>
                          <span className="ml-auto text-[11px] text-muted-foreground/70">{item.desc}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!isWindows && (
                <button
                  className={itemClass}
                  onMouseEnter={() => setActiveSubMenu(null)}
                  onClick={() => {
                    onChangePermissions(file)
                    onClose()
                  }}
                >
                  <Shield className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{t('fs_change_perm')}</span>
                </button>
              )}

              <button
                className={itemClass}
                onMouseEnter={() => setActiveSubMenu(null)}
                onClick={() => {
                  onShowProperties(file)
                  onClose()
                }}
              >
                <Info className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>{t('fs_properties')}</span>
              </button>
            </>
          )}

          <div className="-mx-1 my-1 h-px bg-border/50" />

          <button
            className="relative flex w-full cursor-pointer select-none items-center rounded-lg px-2.5 py-1.5 text-xs outline-none text-destructive hover:bg-destructive/10 hover:text-destructive transition-colors text-left"
            onMouseEnter={() => setActiveSubMenu(null)}
            onClick={() => {
              onDelete(selectedFiles.length > 0 ? selectedFiles : [file.path])
              onClose()
            }}
          >
            <Trash2 className="mr-2 h-4 w-4 shrink-0" />
            <span>{multiSelect ? t('fs_delete_n').replace('{n}', String(selectedFiles.length)) : t('fs_delete')}</span>
            {!multiSelect && <ContextMenuShortcut>Del</ContextMenuShortcut>}
          </button>
        </>
      )}
    </div>,
    document.body
  )
}

