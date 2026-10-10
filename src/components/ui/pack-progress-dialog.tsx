import { Archive, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './dialog'
import { useTranslation } from '@/i18n'

interface PackProgressDialogProps {
  open: boolean
  targetName?: string
  fileCount?: number
}

export function PackProgressDialog({ open, targetName, fileCount }: PackProgressDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} modal>
      <DialogContent className="sm:max-w-[380px] gap-0 p-0 overflow-hidden">
        {/* 顶部蓝色装饰条 */}
        <div className="h-1 bg-primary" />

        <div className="p-6 pt-5">
          <DialogHeader className="text-center sm:text-center mb-3">
            {/* 动画图标 */}
            <div className="mx-auto mb-4 relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Archive className="h-6 w-6 text-primary" />
              </div>
              {/* 旋转光环 */}
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" style={{ margin: '-3px' }} />
            </div>
            <DialogTitle className="text-base">{t('pp_packing')}</DialogTitle>
            {targetName && (
              <DialogDescription className="text-xs mt-1 truncate max-w-[280px]">
                {targetName}
              </DialogDescription>
            )}
          </DialogHeader>

          {/* 进度信息区 */}
          <div className="mt-2 rounded-md bg-primary/5 border border-primary/10 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-3.5 w-3.5 text-primary animate-spin flex-shrink-0" />
              <span className="text-xs text-muted-foreground">
                {fileCount && fileCount > 0
                  ? t('pp_packing_files_count').replace('{n}', fileCount.toLocaleString())
                  : t('pp_packing_generic')}
              </span>
            </div>

            {/* 不定长进度条动画 */}
            <div className="mt-2.5 h-1 bg-primary/10 rounded-full overflow-hidden">
              <div
                className="h-full w-[40%] rounded-full bg-primary"
                style={{ animation: 'progress-indeterminate 1.8s cubic-bezier(0.4, 0, 0.2, 1) infinite' }}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
