import { useState, useRef, useEffect, useMemo } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface SelectPopoverProps {
  value: string | null
  onChange: (v: string | null) => void
  options: SelectOption[]
  placeholder?: string
  /** 触发器额外类名，如 w-full 实现全宽表单字段 */
  className?: string
  /** 弹层宽度/定位类，默认 w-52 */
  panelClassName?: string
  /** 是否显示「清除/全部」项（选中后回到 null） */
  clearable?: boolean
  clearLabel?: string
  disabled?: boolean
  ariaLabel?: string
  /** 是否启用搜索过滤（默认 false；若 options 数量很多可开启） */
  searchable?: boolean
  searchPlaceholder?: string
}

/**
 * 通用下拉选择器，统一全站下拉框风格（与 TagFilterPopover / DeviceTypeFilterPopover 一致）：
 * 圆角触发器 + ChevronDown 箭头 + 自定义圆角弹层 + 选中态高亮。用于取代原生 <select>，
 * 避免系统菜单与自定义下拉在视觉/交互上不一致。
 *
 * 基于 Radix Popover 实现：弹层经 Portal 渲染到 body，不会被任何祖先的
 * overflow-hidden / overflow-auto / transform 裁切或遮挡；且 Radix 的 DismissableLayer
 * 会协调嵌套关系，在 Dialog 等弹窗内点击选项不会误关外层弹窗、也不会选不上。
 */
export function SelectPopover({
  value,
  onChange,
  options,
  placeholder,
  className,
  panelClassName,
  clearable = false,
  clearLabel,
  disabled,
  ariaLabel,
  searchable = false,
  searchPlaceholder = '搜索...',
}: SelectPopoverProps) {
  const [open, setOpen] = useState(false)
  const [filterText, setFilterText] = useState('')
  const selectedRef = useRef<HTMLButtonElement | null>(null)

  const selected = options.find((o) => o.value === value)

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setFilterText('')
    }
  }

  useEffect(() => {
    if (open && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [open])

  const filteredOptions = useMemo(() => {
    if (!filterText.trim()) return options
    const q = filterText.toLowerCase()
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    )
  }, [options, filterText])

  // 大数据量模型/选项按需分页渲染（批次大小 50）
  const PAGE_BATCH_SIZE = 50

  const selectedIndex = useMemo(() => {
    if (!value) return -1
    return filteredOptions.findIndex((o) => o.value === value)
  }, [filteredOptions, value])

  const initialRenderCount = useMemo(() => {
    if (selectedIndex >= 0) {
      return Math.max(
        PAGE_BATCH_SIZE,
        Math.min(filteredOptions.length, Math.ceil((selectedIndex + 1) / PAGE_BATCH_SIZE) * PAGE_BATCH_SIZE),
      )
    }
    return Math.min(PAGE_BATCH_SIZE, filteredOptions.length)
  }, [selectedIndex, filteredOptions.length])

  const [renderedCount, setRenderedCount] = useState(PAGE_BATCH_SIZE)

  useEffect(() => {
    setRenderedCount(initialRenderCount)
  }, [filterText, initialRenderCount])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    if (scrollTop + clientHeight >= scrollHeight - 32) {
      if (renderedCount < filteredOptions.length) {
        setRenderedCount((prev) => Math.min(prev + PAGE_BATCH_SIZE, filteredOptions.length))
      }
    }
  }

  const visibleOptions = useMemo(() => {
    return filteredOptions.slice(0, renderedCount)
  }, [filteredOptions, renderedCount])

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            'h-8 min-w-[120px] flex items-center justify-between gap-1.5 rounded-lg border pl-2.5 pr-7 text-xs font-medium outline-none transition-colors cursor-pointer relative',
            value
              ? 'border-primary/40 text-primary bg-primary/5'
              : 'border-border/50 text-muted-foreground bg-muted/30 hover:bg-accent/60',
            disabled && 'opacity-50 cursor-not-allowed',
            className,
          )}
        >
          <span className="truncate" title={selected ? selected.label : undefined}>
            {selected ? selected.label : (placeholder ?? '')}
          </span>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
            <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => {
            if (!searchable) {
              e.preventDefault()
            }
          }}
          className={cn(
            'z-[100] rounded-lg border bg-popover shadow-md p-1 flex flex-col',
            panelClassName ?? 'w-52',
          )}
        >
          {searchable && (
            <div className="p-1 pb-1.5 border-b border-border/50">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-7 pl-7 text-xs bg-muted/30"
                  autoFocus
                />
              </div>
            </div>
          )}

          <div
            className="max-h-60 overflow-y-auto overscroll-contain p-0.5 space-y-0.5"
            style={{ scrollbarWidth: 'thin' }}
            onScroll={handleScroll}
          >
            {clearable && (
              <button
                type="button"
                onClick={() => {
                  onChange(null)
                  setOpen(false)
                }}
                className={cn(
                  'w-full flex items-center justify-between gap-1.5 rounded-md px-2 h-8 text-xs transition-colors',
                  !value ? 'bg-primary/10 text-primary font-semibold' : 'text-foreground hover:bg-accent/40',
                )}
              >
                <span className="font-medium truncate">{clearLabel ?? placeholder}</span>
                {!value && <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />}
              </button>
            )}
            {filteredOptions.length === 0 ? (
              <div className="py-3 text-center text-xs text-muted-foreground">
                无匹配项
              </div>
            ) : (
              <>
                {visibleOptions.map((opt) => {
                  const isSel = value === opt.value
                  return (
                    <button
                      key={opt.value}
                      ref={isSel ? selectedRef : undefined}
                      type="button"
                      disabled={opt.disabled}
                      onClick={() => {
                        onChange(opt.value)
                        setOpen(false)
                      }}
                      className={cn(
                        'w-full flex items-center justify-between gap-1.5 rounded-md px-2 h-8 text-xs transition-colors',
                        opt.disabled && 'opacity-40 cursor-not-allowed',
                        isSel ? 'bg-primary/10 text-primary font-semibold' : 'text-foreground hover:bg-accent/40',
                      )}
                    >
                      <span className="font-medium truncate">{opt.label}</span>
                      {isSel && <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />}
                    </button>
                  )
                })}
                {renderedCount < filteredOptions.length && (
                  <button
                    type="button"
                    onClick={() =>
                      setRenderedCount((prev) => Math.min(prev + PAGE_BATCH_SIZE, filteredOptions.length))
                    }
                    className="w-full py-1.5 mt-1 text-[11px] text-muted-foreground hover:text-foreground text-center bg-muted/20 hover:bg-muted/40 rounded transition-colors"
                  >
                    加载更多 (已显示 {renderedCount} / 共 {filteredOptions.length} 个)
                  </button>
                )}
              </>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
