import { Info, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { renderFileIcon, type LocalFile } from '../local-file-picker-utils'
import { PermissionBadge } from './permission-badge'
import type { FileEntry } from '@/types'
import type { FileStatInfo } from '@/services/api'

interface FilePropertiesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  propertiesFile: FileEntry | null
  statInfo: FileStatInfo | null
  statLoading: boolean
  formatSize: (bytes: number) => string
  t: (key: string) => string
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

export function FilePropertiesDialog({
  open,
  onOpenChange,
  propertiesFile,
  statInfo,
  statLoading,
  formatSize,
  t,
}: FilePropertiesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-primary" />
            {t('fs_file_props')}
          </DialogTitle>
        </DialogHeader>
        {propertiesFile && (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-3 pb-3 border-b">
              {renderFileIcon(toIconFile(propertiesFile), 'h-10 w-10')}
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{propertiesFile.name}</p>
                <p className="text-xs text-muted-foreground truncate">{propertiesFile.path}</p>
              </div>
            </div>

            {statLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : statInfo ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('fs_type')}</span>
                  <span className="font-mono">{statInfo.type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('fs_th_size')}</span>
                  <span className="tabular-nums">
                    {formatSize(statInfo.size)} ({statInfo.size.toLocaleString()} {t('fs_bytes')})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('fs_perm')}</span>
                  <span className="font-mono flex items-center gap-1.5">
                    {statInfo.mode} (<PermissionBadge perm={propertiesFile.permissions} />)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('fs_owner')}</span>
                  <span className="font-mono">{statInfo.owner}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('fs_group')}</span>
                  <span className="font-mono">{statInfo.group}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('fs_th_modified')}</span>
                  <span className="text-xs">{statInfo.modifiedTime}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('fs_access_time')}</span>
                  <span className="text-xs">{statInfo.accessTime}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Inode</span>
                  <span className="font-mono tabular-nums">{statInfo.inode}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('fs_links')}</span>
                  <span className="font-mono tabular-nums">{statInfo.links}</span>
                </div>
                {statInfo.isSymlink && statInfo.symlinkTarget && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('fs_symlink')}</span>
                    <span className="font-mono text-xs truncate max-w-[200px]" title={statInfo.symlinkTarget}>
                      {statInfo.symlinkTarget}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">{t('fs_no_props')}</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
