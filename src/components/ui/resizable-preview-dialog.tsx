import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X, Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { formatFileSize } from '@/components/workspace/modules/local-file-picker-utils'

export interface ResizablePreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  icon?: React.ReactNode
  fileSize?: number
  sideBadge?: React.ReactNode
  extraHeaderActions?: React.ReactNode
  children: React.ReactNode
  defaultWidth?: number
  defaultHeight?: number
  minWidth?: number
  minHeight?: number
  className?: string
  contentClassName?: string
}

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export function ResizablePreviewDialog({
  open,
  onOpenChange,
  title,
  icon,
  fileSize,
  sideBadge,
  extraHeaderActions,
  children,
  defaultWidth = 960,
  defaultHeight = 680,
  minWidth = 520,
  minHeight = 380,
  className,
  contentClassName,
}: ResizablePreviewDialogProps) {
  const uiStyle = useAppStore(s => s.uiStyle)
  const isAnime = uiStyle === 'anime'

  // 窗口尺寸与定位（相对于视口）
  const [rect, setRect] = useState({ x: 100, y: 80, width: defaultWidth, height: defaultHeight })
  const [isMaximized, setIsMaximized] = useState(false)
  const [isInteracting, setIsInteracting] = useState(false) // 拖拽移动或拉伸中

  // 保存最大化前的原始位置与尺寸，用于恢复
  const prevRectRef = useRef(rect)

  // 计算固定初始尺寸并居中
  const resetToInitial = useCallback(() => {
    if (typeof window === 'undefined') return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const initW = Math.min(defaultWidth, Math.max(vw - 64, 360))
    const initH = Math.min(defaultHeight, Math.max(vh - 64, 300))
    const initX = Math.max(16, Math.round((vw - initW) / 2))
    const initY = Math.max(16, Math.round((vh - initH) / 2))

    const newRect = { x: initX, y: initY, width: initW, height: initH }
    setRect(newRect)
    prevRectRef.current = newRect
    setIsMaximized(false)
  }, [defaultWidth, defaultHeight])

  // 每次打开时，重置为固定初始大小和居中位置
  useEffect(() => {
    if (open) {
      resetToInitial()
    }
  }, [open, resetToInitial])

  // 窗口大小变化时保护弹框不越出视口
  useEffect(() => {
    const handleResize = () => {
      if (isMaximized) {
        setRect({ x: 8, y: 8, width: window.innerWidth - 16, height: window.innerHeight - 16 })
      } else {
        setRect(prev => {
          const vw = window.innerWidth
          const vh = window.innerHeight
          let { x, y, width, height } = prev
          width = Math.min(width, vw - 16)
          height = Math.min(height, vh - 16)
          x = Math.max(8, Math.min(x, vw - width - 8))
          y = Math.max(8, Math.min(y, vh - height - 8))
          return { x, y, width, height }
        })
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [isMaximized])

  // 切换最大化与还原
  const toggleMaximize = useCallback(() => {
    if (isMaximized) {
      setRect(prevRectRef.current)
      setIsMaximized(false)
    } else {
      prevRectRef.current = rect
      setRect({
        x: 8,
        y: 8,
        width: window.innerWidth - 16,
        height: window.innerHeight - 16,
      })
      setIsMaximized(true)
    }
  }, [isMaximized, rect])

  // 标题栏拖拽移动
  const handleHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // 点击按钮、输入框或标记不拖动的元素时不触发窗口移动
    const target = e.target as HTMLElement
    if (
      target.closest('button') ||
      target.closest('input') ||
      target.closest('a') ||
      target.closest('[data-no-drag]')
    ) {
      return
    }

    if (e.button !== 0 || isMaximized) return
    e.preventDefault()

    const startPointerX = e.clientX
    const startPointerY = e.clientY
    const startX = rect.x
    const startY = rect.y
    setIsInteracting(true)

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startPointerX
      const dy = ev.clientY - startPointerY
      const vw = window.innerWidth
      const vh = window.innerHeight

      // 允许左右移出部分，但保留至少 100px 可抓取
      const minX = -rect.width + 100
      const maxX = vw - 100
      // 上方不能超出视口顶部，下方保留 50px
      const minY = 0
      const maxY = vh - 50

      setRect(prev => ({
        ...prev,
        x: Math.max(minX, Math.min(startX + dx, maxX)),
        y: Math.max(minY, Math.min(startY + dy, maxY)),
      }))
    }

    const onMouseUp = () => {
      setIsInteracting(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // 边缘与角落拉伸调整大小
  const handleResizeMouseDown = (dir: ResizeDirection, e: React.MouseEvent) => {
    if (e.button !== 0 || isMaximized) return
    e.preventDefault()
    e.stopPropagation()

    const startPointerX = e.clientX
    const startPointerY = e.clientY
    const startX = rect.x
    const startY = rect.y
    const startW = rect.width
    const startH = rect.height
    setIsInteracting(true)

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startPointerX
      const dy = ev.clientY - startPointerY
      const vw = window.innerWidth
      const vh = window.innerHeight

      let newW = startW
      let newH = startH
      let newX = startX
      let newY = startY

      // 东 (右)
      if (dir.includes('e')) {
        newW = Math.max(minWidth, Math.min(startW + dx, vw - startX - 8))
      }
      // 南 (下)
      if (dir.includes('s')) {
        newH = Math.max(minHeight, Math.min(startH + dy, vh - startY - 8))
      }
      // 西 (左)
      if (dir.includes('w')) {
        const potentialW = startW - dx
        if (potentialW >= minWidth) {
          const maxLeftShift = startX + startW - minWidth
          newX = Math.max(8, Math.min(startX + dx, maxLeftShift))
          newW = startW + (startX - newX)
        } else {
          newW = minWidth
          newX = startX + (startW - minWidth)
        }
      }
      // 北 (上)
      if (dir.includes('n')) {
        const potentialH = startH - dy
        if (potentialH >= minHeight) {
          const maxTopShift = startY + startH - minHeight
          newY = Math.max(0, Math.min(startY + dy, maxTopShift))
          newH = startH + (startY - newY)
        } else {
          newH = minHeight
          newY = startY + (startH - minHeight)
        }
      }

      setRect({
        x: newX,
        y: newY,
        width: newW,
        height: newH,
      })
    }

    const onMouseUp = () => {
      setIsInteracting(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* 背景半透明遮罩 */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        {/* 窗口容器 */}
        <DialogPrimitive.Content asChild aria-describedby={undefined}>
          <div
            style={{
              position: 'fixed',
              left: `${rect.x}px`,
              top: `${rect.y}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
              zIndex: 50,
            }}
            className={cn(
              "flex flex-col bg-background border border-border/80 rounded-xl shadow-2xl overflow-hidden focus:outline-none select-text transition-[border-color,box-shadow]",
              isAnime && "border-pink-300/60 dark:border-pink-500/40",
              className
            )}
          >
            {/* 拖拽或拉伸过程中，全屏透明防穿透遮罩，防止 iframe 吞光标事件导致拖拽中断 */}
            {isInteracting && (
              <div className="fixed inset-0 z-[100] cursor-grabbing select-none" />
            )}

            {/* 标题栏（可拖拽移动，双击最大化/还原） */}
            <div
              className={cn(
                "flex items-center justify-between px-3.5 py-2 border-b border-border/70 bg-muted/40 backdrop-blur-xs shrink-0 select-none",
                !isMaximized && "cursor-move"
              )}
              onMouseDown={handleHeaderMouseDown}
              onDoubleClick={toggleMaximize}
            >
              {/* 左侧：文件图标、名称、大小、环境标记 */}
              <div className="flex items-center gap-2.5 min-w-0 mr-3">
                {icon && (
                  <div className="p-1 rounded-md bg-background/80 border border-border/50 shrink-0 flex items-center justify-center text-foreground/80 shadow-2xs">
                    {icon}
                  </div>
                )}
                <DialogPrimitive.Title
                  className="text-sm font-semibold truncate text-foreground select-text"
                  title={typeof title === 'string' ? title : undefined}
                >
                  {title}
                </DialogPrimitive.Title>
                {typeof fileSize === 'number' && fileSize > 0 && (
                  <span className="px-1.5 py-0.5 rounded-md bg-muted/70 border border-border/40 text-[11px] text-muted-foreground font-mono shrink-0 hidden sm:inline-block shadow-2xs">
                    {formatFileSize(fileSize)}
                  </span>
                )}
                {sideBadge}
              </div>

              {/* 右侧：自定义操作、最大化/还原按钮、关闭按钮 */}
              <div className="flex items-center gap-1.5 shrink-0" data-no-drag>
                {extraHeaderActions && (
                  <div className="flex items-center gap-1.5">
                    {extraHeaderActions}
                    <div className="h-3.5 w-px bg-border/70 mx-0.5 shrink-0" />
                  </div>
                )}

                {/* 最大化 / 还原按钮 */}
                <button
                  type="button"
                  onClick={toggleMaximize}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 active:scale-95 transition-all"
                  title={isMaximized ? '还原窗口' : '最大化窗口'}
                >
                  {isMaximized ? (
                    <Minimize2 className="h-3.5 w-3.5" />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" />
                  )}
                </button>

                {/* 关闭按钮 */}
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:scale-95 transition-all"
                  title="关闭 (Esc)"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* 主内容展示区（充满剩余高度，无固定截断） */}
            <div className={cn("flex-1 min-h-0 w-full overflow-hidden flex flex-col relative", contentClassName)}>
              {children}
            </div>

            {/* 8 方向边缘与角落拉伸热区（最大化状态隐藏） */}
            {!isMaximized && (
              <>
                {/* 边框 */}
                <div
                  className="absolute top-0 left-2 right-2 h-1.5 cursor-n-resize z-20"
                  onMouseDown={(e) => handleResizeMouseDown('n', e)}
                />
                <div
                  className="absolute bottom-0 left-2 right-2 h-1.5 cursor-s-resize z-20"
                  onMouseDown={(e) => handleResizeMouseDown('s', e)}
                />
                <div
                  className="absolute top-2 bottom-2 left-0 w-1.5 cursor-w-resize z-20"
                  onMouseDown={(e) => handleResizeMouseDown('w', e)}
                />
                <div
                  className="absolute top-2 bottom-2 right-0 w-1.5 cursor-e-resize z-20"
                  onMouseDown={(e) => handleResizeMouseDown('e', e)}
                />

                {/* 四角 */}
                <div
                  className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize z-30"
                  onMouseDown={(e) => handleResizeMouseDown('nw', e)}
                />
                <div
                  className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize z-30"
                  onMouseDown={(e) => handleResizeMouseDown('ne', e)}
                />
                <div
                  className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize z-30"
                  onMouseDown={(e) => handleResizeMouseDown('sw', e)}
                />
                <div
                  className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-30 flex items-end justify-end p-0.5"
                  onMouseDown={(e) => handleResizeMouseDown('se', e)}
                  title="拖动调整大小"
                >
                  {/* 右下角视觉拉伸把手（斜纹小把手） */}
                  <svg
                    viewBox="0 0 10 10"
                    className="w-2.5 h-2.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors pointer-events-none"
                    fill="currentColor"
                  >
                    <path d="M8 2 L2 8 M8 5 L5 8 M8 8 L8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                </div>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
