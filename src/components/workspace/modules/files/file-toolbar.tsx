import { cn } from '@/lib/utils'
import {
  HardDrive,
  FolderOpen,
  ChevronRight,
  RefreshCw,
  Upload,
  FolderInput,
  Search,
  Eye,
  EyeOff,
  ClipboardPaste,
  SlidersHorizontal,
  ExternalLink,
  Square,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { SftpBookmarkDropdown, ViewModeDropdown } from '@/components/sftp/sftp-dropdowns'
import { useAppStore } from '@/store'
import { useSettingsDialogStore } from '@/store/settings-dialog-store'
import type { SftpViewMode } from '@/types'
import { Z_LAYER } from '@/lib/z-layer'

interface FileToolbarProps {
  currentPath: string
  onNavigateTo: (path: string) => void
  bookmarks: string[]
  onAddBookmark: (path: string) => void
  onRemoveBookmark: (path: string) => void
  onToggleBookmark?: () => void
  viewMode?: SftpViewMode
  onViewModeChange?: (mode: SftpViewMode) => void
  showHidden?: boolean
  onToggleShowHidden?: () => void
  onClipboardPathJump?: () => void
  showTransferPolicy?: boolean
  onRefresh: () => void
  loading?: boolean
  transferLoading: string | null
  onNativeUpload: (isFolder: boolean) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  showNewItem: boolean
  newItemType: 'file' | 'dir'
  newItemName: string
  setNewItemName: (name: string) => void
  onNewItemConfirm: () => void
  onNewItemCancel: () => void
  activeExternalEdits?: Array<{ sessionId: string; fileName: string; remotePath: string }>
  onStopExternalEdit?: (sessionId: string) => void
  t: (key: string) => string
}

function formatRateLimitBadge(kbps: number): string {
  if (kbps <= 0) return ''
  if (kbps >= 1024) {
    const mb = kbps / 1024
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}M/s`
  }
  return `${kbps}K/s`
}

/** 方案 B：工作台仅保留轻量只读状态与快捷入口，点击直达「设置 → SFTP」，避免重复配置表单 */
function TransferSettingsShortcut({ t }: { t: (key: string) => string }) {
  const transferRateLimit = useAppStore((s) => s.transferRateLimit)
  const sftpExclusionEnabled = useAppStore((s) => s.sftpExclusionEnabled)
  const hasActivePolicy = transferRateLimit > 0 || sftpExclusionEnabled
  const tooltip = hasActivePolicy
    ? t('sftp_transfer_policy_active')
    : t('sftp_transfer_policy_shortcut')

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => useSettingsDialogStore.getState().openSettings('sftp')}
      className={cn(
        'h-7 px-1.5 gap-1 text-muted-foreground hover:text-foreground active:scale-95 transition-all cursor-pointer shrink-0 relative',
        hasActivePolicy && 'text-primary bg-primary/10 hover:bg-primary/15',
      )}
      title={tooltip}
      aria-label={tooltip}
    >
      <SlidersHorizontal className="h-3.5 w-3.5" />
      {transferRateLimit > 0 && (
        <span className="text-[10px] font-mono leading-none">
          {formatRateLimitBadge(transferRateLimit)}
        </span>
      )}
      {sftpExclusionEnabled && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-primary shrink-0"
          aria-hidden="true"
        />
      )}
    </Button>
  )
}

export function FileToolbar({
  currentPath,
  onNavigateTo,
  bookmarks,
  onAddBookmark,
  onRemoveBookmark,
  viewMode,
  onViewModeChange,
  showHidden = true,
  onToggleShowHidden,
  onClipboardPathJump,
  showTransferPolicy = false,
  onRefresh,
  loading = false,
  transferLoading,
  onNativeUpload,
  searchQuery,
  setSearchQuery,
  showNewItem,
  newItemType,
  newItemName,
  setNewItemName,
  onNewItemConfirm,
  onNewItemCancel,
  activeExternalEdits,
  onStopExternalEdit,
  t,
}: FileToolbarProps) {
  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b bg-card flex-wrap">
        {/* 面包屑导航 */}
        <div className="flex items-center gap-0.5 text-xs font-mono flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-0.5 select-none">
          <button
            onClick={() => onNavigateTo('/')}
            className={cn(
              "px-1.5 py-0.5 rounded-md transition-all flex items-center gap-1 text-xs cursor-pointer select-none shrink-0",
              currentPath === '/'
                ? "bg-primary/10 text-primary font-medium border border-primary/20 shadow-2xs"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}
            title="/"
          >
            <HardDrive className="h-3 w-3 shrink-0 opacity-70" />
            {currentPath === '/' && <span>/</span>}
          </button>
          {currentPath !== '/' &&
            currentPath
              .split('/')
              .filter(Boolean)
              .map((seg, idx, arr) => {
                const path = '/' + arr.slice(0, idx + 1).join('/')
                const isLast = idx === arr.length - 1
                return (
                  <span key={path} className="flex items-center gap-0.5 min-w-0 shrink-0">
                    <ChevronRight className="h-3 w-3 mx-0.5 text-muted-foreground/40 shrink-0" />
                    <button
                      onClick={() => onNavigateTo(path)}
                      className={cn(
                        "flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs transition-all cursor-pointer select-none max-w-[140px] truncate text-left",
                        isLast
                          ? "bg-primary/10 text-primary font-medium border border-primary/20 shadow-2xs"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/60 active:scale-[0.98]"
                      )}
                      title={path}
                    >
                      {isLast && <FolderOpen className="h-3 w-3 shrink-0 text-primary" />}
                      <span className="truncate">{seg}</span>
                    </button>
                  </span>
                )
              })}
        </div>

        {/* 从剪贴板跳转路径 (P2-27) */}
        {onClipboardPathJump && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground active:scale-95 transition-all cursor-pointer shrink-0"
            onClick={onClipboardPathJump}
            title={t('sftp_clipboard_path_jump')}
            aria-label={t('sftp_clipboard_path_jump')}
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
          </Button>
        )}

        {/* 路径书签分体下拉按钮（与 SFTP 样式交互完全一致） */}
        <SftpBookmarkDropdown
          currentPath={currentPath}
          bookmarks={bookmarks}
          onAddBookmark={onAddBookmark}
          onRemoveBookmark={onRemoveBookmark}
          onNavigate={onNavigateTo}
          t={t}
        />

        {/* 传输策略快捷入口（跳转 设置 → SFTP，避免与全局设置重复表单） */}
        {showTransferPolicy && (
          <TransferSettingsShortcut t={t} />
        )}

        {/* 活跃外部编辑会话：可手动停止 watcher，避免 Files 模块启动的会话无人管理 */}
        {activeExternalEdits && activeExternalEdits.length > 0 && onStopExternalEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-1.5 gap-1 text-emerald-600 shrink-0" title="外部编辑器正在监听的文件">
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="text-[11px]">外部编辑 ({activeExternalEdits.length})</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" style={{ zIndex: Z_LAYER.POPUP }}>
              {activeExternalEdits.map((s) => (
                <DropdownMenuItem key={s.sessionId} className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate" title={s.remotePath}>{s.fileName}</span>
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    title="停止监听"
                    onClick={(e) => { e.stopPropagation(); onStopExternalEdit(s.sessionId) }}
                  >
                    <Square className="h-3 w-3" />
                  </button>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-sm gap-1 active:scale-95 transition-all cursor-pointer"
          onClick={onRefresh}
          title={`${t('fs_refresh')} (F5)`}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>

        {viewMode && onViewModeChange && (
          <ViewModeDropdown viewMode={viewMode} onChange={onViewModeChange} t={t} />
        )}

        {onToggleShowHidden && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-sm gap-1 active:scale-95 transition-all cursor-pointer"
            onClick={onToggleShowHidden}
            title={showHidden ? (t('sftp_hide_hidden') || 'Hide Hidden Files') : (t('sftp_show_hidden') || 'Show Hidden Files')}
          >
            {showHidden ? <Eye className="h-3.5 w-3.5 text-primary" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-sm gap-1 active:scale-95 transition-all cursor-pointer"
          disabled={transferLoading === 'upload'}
          onClick={() => onNativeUpload(false)}
          title={t('fs_upload_file')}
        >
          <Upload className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">{t('fs_upload_file')}</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-sm gap-1 active:scale-95 transition-all cursor-pointer"
          disabled={transferLoading === 'upload'}
          onClick={() => onNativeUpload(true)}
          title={t('fs_upload_folder')}
        >
          <FolderInput className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">{t('fs_upload_folder')}</span>
        </Button>

        <div className="relative w-40">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t('fs_search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-8 text-sm"
          />
        </div>
      </div>

      {/* 新建输入 */}
      {showNewItem && (
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-card">
          <span className="text-sm text-muted-foreground">
            {newItemType === 'dir' ? `${t('fs_new_folder')}:` : `${t('fs_new_file')}:`}
          </span>
          <Input
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder={t('fs_new_name_placeholder')}
            className="h-8 text-sm w-56"
            onKeyDown={(e) => {
              if (e.key === 'Enter') onNewItemConfirm()
              if (e.key === 'Escape') onNewItemCancel()
            }}
            autoFocus
          />
          <Button
            size="sm"
            className="h-8 text-sm"
            onClick={onNewItemConfirm}
            disabled={!newItemName.trim()}
          >
            {t('fs_create')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-sm"
            onClick={onNewItemCancel}
          >
            {t('common_cancel')}
          </Button>
        </div>
      )}
    </>
  )
}
