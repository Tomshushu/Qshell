import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { useAppStore } from '@/store'
import { CONNECTION_TARGETS } from '@/services/connection-targets'
import { cn } from '@/lib/utils'

interface DeviceTypeFilterPopoverProps {
  value: string | null
  onChange: (v: string | null) => void
}

/**
 * 设备类型筛选下拉：与 TagFilterPopover 视觉/交互风格统一（触发器 + 自定义弹层），
 * 取代原生 <select>，避免系统菜单与顶部其它自定义下拉格式不一致。
 */
export function DeviceTypeFilterPopover({ value, onChange }: DeviceTypeFilterPopoverProps) {
  const { t } = useTranslation()
  const uiStyle = useAppStore((s) => s.uiStyle)
  const isAnime = uiStyle === 'anime'
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })

  // 点击外部关闭下拉（面板已 Portal 到 body，需同时排除按钮与面板内部的点击）
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const node = e.target as Node
      if (wrapRef.current?.contains(node)) return
      if (panelRef.current?.contains(node)) return
      setOpen(false)
    }
    // 用 pointerdown 而非 mousedown：Radix 下拉（如排序菜单）的 trigger 会在
    // pointerdown 上 preventDefault()，导致后续 mousedown 不派发、外点关闭失效
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  // 面板 Portal 到 body 后用 fixed 定位：按触发按钮实时对齐
  // （嵌在页面容器内的 absolute 元素会导致 backdrop-filter 毛玻璃失效）
  useEffect(() => {
    if (!open) return
    const update = () => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect) return
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 208 - 8))
      setPos({ left, top: rect.bottom + 4 })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  const specs = CONNECTION_TARGETS.filter((s) => s.enabled)
  const selectedLabel = value
    ? t(specs.find((s) => s.id === value)?.labelKey ?? value)
    : ''

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'h-8 min-w-[126px] flex items-center justify-between gap-1.5 rounded-lg border pl-2.5 pr-7 text-xs font-medium outline-none transition-colors cursor-pointer relative',
          isAnime
            ? value
              ? 'border-pink-400 bg-pink-100/60 text-pink-700 shadow-[0_2px_8px_rgba(255,107,161,0.18)]'
              : 'border-pink-300/60 bg-pink-50/40 text-pink-600 hover:bg-pink-100/60'
            : value
              ? 'border-primary/40 text-primary bg-primary/5'
              : 'border-border/50 text-muted-foreground bg-muted/30 hover:bg-accent/60',
        )}
        aria-label={t('ct_target_type')}
      >
        <span className="truncate">{value ? selectedLabel : t('ct_target_type')}</span>
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
          <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </span>
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          style={{ left: pos.left, top: pos.top }}
          className={cn(
            'fixed z-[100] w-52 rounded-lg border border-border/60 glass-strong shadow-md p-1.5 space-y-0.5',
            isAnime && 'border-pink-300/60 shadow-[0_8px_28px_rgba(255,107,161,0.18)]',
          )}
        >
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setOpen(false)
            }}
            className={cn(
              'w-full flex items-center justify-between gap-1.5 rounded-md px-2 h-8 text-xs transition-colors',
              !value
                ? (isAnime ? 'bg-pink-100/70 text-pink-700 font-semibold' : 'bg-primary/10 text-primary font-semibold')
                : (isAnime ? 'text-foreground hover:bg-pink-100/40' : 'text-foreground hover:bg-accent/40'),
            )}
          >
            <span className="font-medium">{t('ct_target_type')}</span>
            {!value && <Check className={cn('h-3.5 w-3.5 flex-shrink-0', isAnime ? 'text-pink-500' : 'text-primary')} />}
          </button>
          {specs.map((spec) => {
            const isSel = value === spec.id
            const Icon = spec.icon
            return (
              <button
                key={spec.id}
                type="button"
                onClick={() => {
                  onChange(spec.id)
                  setOpen(false)
                }}
                className={cn(
                  'w-full flex items-center justify-between gap-1.5 rounded-md px-2 h-8 text-xs transition-colors',
                  isSel
                    ? (isAnime ? 'bg-pink-100/70 text-pink-700 font-semibold' : 'bg-primary/10 text-primary font-semibold')
                    : (isAnime ? 'text-foreground hover:bg-pink-100/40' : 'text-foreground hover:bg-accent/40'),
                )}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <Icon
                    className={cn(
                      'h-4 w-4 flex-shrink-0',
                      spec.iconColored ? '' : isAnime ? 'text-pink-500' : 'text-primary',
                    )}
                  />
                  <span className="font-medium truncate">{t(spec.labelKey)}</span>
                </span>
                {isSel && <Check className={cn('h-3.5 w-3.5 flex-shrink-0', isAnime ? 'text-pink-500' : 'text-primary')} />}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
