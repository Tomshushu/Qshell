import { useEffect, useState } from 'react'
import { XCircle, ChevronDown, ChevronUp } from 'lucide-react'
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
  const [showDetail, setShowDetail] = useState(false)
  // 错误信息友好化：命中已知模式时展示友好文案，原始技术信息收进"技术详情"
  const { message: friendlyMessage, detail } = friendlyError(message)

  // 弹窗关闭时重置详情展开状态（渲染期调整状态，避免 effect 级联渲染）
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (!open && showDetail) setShowDetail(false)
  }
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

          {/* 技术详情：命中友好化映射时提供原始错误供排查 */}
          {detail && (
            <div className="mt-1.5">
              <button
                type="button"
                onClick={() => setShowDetail((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors mx-auto"
              >
                {showDetail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {showDetail ? t('err_hide_detail') : t('err_show_detail')}
              </button>
              {showDetail && (
                <div className="mt-1.5 rounded-md bg-muted/50 border border-border/60 px-3 py-2 max-h-[160px] overflow-y-auto">
                  <p className="text-[11px] text-muted-foreground font-mono leading-relaxed break-all whitespace-pre-wrap">
                    {detail}
                  </p>
                </div>
              )}
            </div>
          )}

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
