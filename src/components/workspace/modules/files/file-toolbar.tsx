import {
  HardDrive,
  RefreshCw,
  Upload,
  FolderInput,
  Search,
  Eye,
  EyeOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SftpBookmarkDropdown } from '@/components/sftp/sftp-dropdowns'

interface FileToolbarProps {
  currentPath: string
  onNavigateTo: (path: string) => void
  bookmarks: string[]
  onAddBookmark: (path: string) => void
  onRemoveBookmark: (path: string) => void
  onToggleBookmark?: () => void
  showHidden?: boolean
  onToggleShowHidden?: () => void
  onRefresh: () => void
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
  t: (key: string) => string
}

export function FileToolbar({
  currentPath,
  onNavigateTo,
  bookmarks,
  onAddBookmark,
  onRemoveBookmark,
  showHidden = true,
  onToggleShowHidden,
  onRefresh,
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
  t,
}: FileToolbarProps) {
  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b bg-card flex-wrap">
        {/* 面包屑导航 */}
        <div className="flex items-center gap-0.5 text-sm font-mono flex-1 min-w-0 overflow-hidden">
          <button
            onClick={() => onNavigateTo('/')}
            className="text-muted-foreground hover:text-foreground transition-colors px-1 rounded hover:bg-accent flex items-center"
            title="/"
          >
            <HardDrive className="h-3.5 w-3.5" />
          </button>
          {currentPath !== '/' &&
            currentPath
              .split('/')
              .filter(Boolean)
              .map((seg, idx, arr) => {
                const path = '/' + arr.slice(0, idx + 1).join('/')
                return (
                  <span key={path} className="flex items-center gap-0.5 min-w-0">
                    <span className="text-muted-foreground/40">/</span>
                    <button
                      onClick={() => onNavigateTo(path)}
                      className="text-muted-foreground hover:text-foreground transition-colors px-1 rounded hover:bg-accent truncate max-w-[120px]"
                      title={path}
                    >
                      {seg}
                    </button>
                  </span>
                )
              })}
        </div>

        {/* 路径书签分体下拉按钮（与 SFTP 样式交互完全一致） */}
        <SftpBookmarkDropdown
          currentPath={currentPath}
          bookmarks={bookmarks}
          onAddBookmark={onAddBookmark}
          onRemoveBookmark={onRemoveBookmark}
          onNavigate={onNavigateTo}
          t={t}
        />

        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-sm gap-1"
          onClick={onRefresh}
          title={`${t('fs_refresh')} (F5)`}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>

        {onToggleShowHidden && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-sm gap-1"
            onClick={onToggleShowHidden}
            title={showHidden ? (t('sftp_hide_hidden') || 'Hide Hidden Files') : (t('sftp_show_hidden') || 'Show Hidden Files')}
          >
            {showHidden ? <Eye className="h-3.5 w-3.5 text-primary" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-sm gap-1"
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
          className="h-7 text-sm gap-1"
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
