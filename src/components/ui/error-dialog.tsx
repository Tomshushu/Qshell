import { useEffect } from 'react'
import { XCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './dialog'
import { Button } from './button'
import { useTranslation } from '@/i18n'
import { playSound, SoundType } from '@/lib/sound'
import { friendlyError } from '@/lib/error-messages'

interface ErrorDialogProps {
  open: boolean
  title?: string
  message: string
  onClose: () => void
}

export function ErrorDialog({
  open,
  title,
  message,
  onClose,
}: ErrorDialogProps) {
  const { t } = useTranslation()
  // 只向用户展示一句友好概括，底层技术信息不再暴露
  const { message: friendlyMessage } = friendlyError(message)
  // 错误对话框弹出时播放 Error 音，关闭时不响（避免干扰）
  useEffect(() => {
    if (open) playSound(SoundType.Error)
  }, [open])
  return (
    <Dialog open={open} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-[420px] gap-0 p-0 overflow-hidden">
        {/* 顶部红色装饰条（保留红色语义标识） */}
        <div className="h-1 bg-red-500" />

        <div className="p-6 pt-5">
          <DialogHeader className="text-center sm:text-center mb-2">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
              <XCircle className="h-6 w-6 text-red-500" />
            </div>
            <DialogTitle className="text-base">{title ?? t('ed_default_title')}</DialogTitle>
          </DialogHeader>

          {/* 错误详情：中性色调，等宽字体（错误信息多为技术文本） */}
          <div className="mt-2 rounded-md bg-muted border border-border px-3 py-2.5 max-h-[280px] overflow-y-auto">
            <p className="text-xs text-foreground/80 font-mono leading-relaxed break-all whitespace-pre-wrap">
              {friendlyMessage}
            </p>
          </div>

          {/* 操作按钮 */}
          <div className="mt-5 flex justify-center">
            <Button onClick={onClose} variant="outline" size="sm" className="min-w-[120px]">
              {t('ed_ok')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
