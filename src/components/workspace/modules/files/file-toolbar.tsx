import {
  HardDrive,
  Star,
  RefreshCw,
  Upload,
  FolderInput,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface FileToolbarProps {
  currentPath: string
  onNavigateTo: (path: string) => void
  bookmarks: string[]
  onToggleBookmark: () => void
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
  onToggleBookmark,
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
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-card flex-wrap">
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

        {/* 书签按钮 */}
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8', bookmarks.includes(currentPath) && 'text-yellow-500')}
          onClick={onToggleBookmark}
          title={bookmarks.includes(currentPath) ? t('common_remove_bookmark') : t('common_add_bookmark')}
        >
          <Star className={cn('h-4 w-4', bookmarks.includes(currentPath) && 'fill-current')} />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-sm gap-1.5"
          onClick={onRefresh}
          title={`${t('fs_refresh')} (F5)`}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-sm gap-1.5"
          disabled={transferLoading === 'upload'}
          onClick={() => onNativeUpload(false)}
          title={t('fs_upload_file')}
        >
          <Upload className="h-4 w-4" />
          <span className="hidden lg:inline">{t('fs_upload_file')}</span>
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-sm gap-1.5"
          disabled={transferLoading === 'upload'}
          onClick={() => onNativeUpload(true)}
          title={t('fs_upload_folder')}
        >
          <FolderInput className="h-4 w-4" />
          <span className="hidden lg:inline">{t('fs_upload_folder')}</span>
        </Button>

        <div className="relative w-40">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t('fs_search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* 书签栏 */}
      {bookmarks.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b bg-muted/30 overflow-x-auto">
          <Star className="h-3.5 w-3.5 text-yellow-500 fill-current shrink-0" />
          {bookmarks.map((bm) => (
            <button
              key={bm}
              onClick={() => onNavigateTo(bm)}
              className={cn(
                'text-xs px-2 py-0.5 rounded-md hover:bg-accent transition-colors whitespace-nowrap shrink-0',
                currentPath === bm ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground'
              )}
              title={bm}
            >
              {bm.split('/').pop() || bm}
            </button>
          ))}
        </div>
      )}

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
