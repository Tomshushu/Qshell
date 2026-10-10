import { useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog'
import { Button } from './button'
import { useTranslation } from '@/i18n'
import { playSound, SoundType } from '@/lib/sound'
import { AlertTriangle, HelpCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ConfirmDialogProps {
  open: boolean
  title?: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  /** confirmLabel 的别名，与 confirmText 等价 */
  confirmText?: string
  /** cancelLabel 的别名，与 cancelText 等价 */
  cancelText?: string
  variant?: 'destructive' | 'default'
  onConfirm: () => void
  onCancel: () => void
  /** 异步确认正在执行时锁定对话框，防止重复提交或误关闭。 */
  pending?: boolean
  /** 可选内容（如输入框），渲染在描述与按钮之间 */
  children?: React.ReactNode
  /** 自定义弹框最大宽度，默认 max-w-[420px] */
  widthClass?: string
  /** 异步操作（pending）进行中仍允许通过取消按钮/× 触发 onCancel（如长时间传输的取消） */
  allowCancelWhilePending?: boolean
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  confirmText,
  cancelText,
  variant = 'destructive',
  onConfirm,
  onCancel,
  pending = false,
  children,
  widthClass,
  allowCancelWhilePending = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
      // 危险操作（destructive）弹 Warn 提醒用户慎重；普通确认弹 Confirm 中性提示
      playSound(variant === 'destructive' ? SoundType.Warn : SoundType.Confirm)
      // Focus the cancel button by default when opened to prevent accidental confirm
      const timer = setTimeout(() => {
        cancelRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [open, variant])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      cancelRef.current?.focus()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      confirmRef.current?.focus()
    }
  }

  const resolvedConfirmLabel = confirmText ?? confirmLabel ?? t('cd_default_confirm')
  const resolvedCancelLabel = cancelText ?? cancelLabel ?? t('cd_default_cancel')

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => { if (!open) onCancel() }}
    >
      <DialogContent
        className={cn('max-w-[420px] p-6 gap-4 overflow-hidden', widthClass)}
        onKeyDown={handleKeyDown}
        onInteractOutside={(e) => { if (pending) e.preventDefault() }}
        onPointerDownOutside={(e) => { if (pending) e.preventDefault() }}
        onEscapeKeyDown={(e) => { if (pending) e.preventDefault() }}
      >
        <div className="flex items-start gap-3.5 pr-4">
          <div className={cn(
            "shrink-0 flex items-center justify-center h-10 w-10 rounded-xl border transition-colors",
            variant === 'destructive'
              ? "bg-destructive/10 text-destructive border-destructive/20"
              : "bg-primary/10 text-primary border-primary/20"
          )}>
            {variant === 'destructive' ? (
              <AlertTriangle className="h-5 w-5" />
            ) : (
              <HelpCircle className="h-5 w-5" />
            )}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <DialogHeader className="p-0 text-left sm:text-left space-y-1">
              <DialogTitle className="text-base font-semibold text-foreground tracking-tight">
                {title ?? t('cd_default_title')}
              </DialogTitle>
              <DialogDescription className="max-h-[40vh] overflow-y-auto break-words text-xs text-muted-foreground leading-relaxed">
                {description}
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        {children && <div className="min-w-0 max-w-full overflow-hidden mt-1">{children}</div>}

        <DialogFooter className="flex items-center justify-end gap-2.5 pt-2 sm:justify-end">
          <Button
            ref={cancelRef}
            variant="outline"
            size="sm"
            className="h-8 px-3.5 rounded-lg text-xs font-medium border-border/70 hover:bg-accent/60"
            onClick={onCancel}
            disabled={pending && !allowCancelWhilePending}
          >
            {resolvedCancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={variant}
            size="sm"
            className="h-8 px-4 rounded-lg text-xs font-medium shadow-xs gap-1.5"
            onClick={onConfirm}
            disabled={pending}
            aria-busy={pending}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {resolvedConfirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
