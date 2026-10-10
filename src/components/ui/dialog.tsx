import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close
const DialogPortal = DialogPrimitive.Portal

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /**
     * 是否渲染内置的右上角关闭按钮（默认 true）。
     * 自带标题栏关闭按钮的弹窗应设为 false —— 内置按钮是 absolute right-4 top-4，
     * 会浮在自定义标题栏之上，与标题栏右侧的搜索框/操作按钮重叠，且形成两个 ×。
     */
    showCloseButton?: boolean
  }
>(function DialogContentInner({ className, children, onPointerDownOutside, onCloseAutoFocus, showCloseButton = true, ...props }, ref) {
  const uiStyle = useAppStore(s => s.uiStyle)
  const isAnime = uiStyle === 'anime'

  React.useEffect(() => {
    return () => {
      // 弹窗关闭卸载后，通知活跃终端恢复输入光标焦点
      window.dispatchEvent(new CustomEvent("focus-active-terminal"))
    }
  }, [])

  return (
  <DialogPortal>
    <DialogOverlay />
    {/* 外层定位容器：让猫耳能浮到弹框上方而不被 overflow:hidden 裁切 */}
    <div className="fixed left-[50%] top-[50%] z-50 translate-x-[-50%] translate-y-[-50%] group/dialog">
      {/* 二次元猫耳装饰 (Anime Dialog Cat Ears) */}
      {isAnime && (
        <>
          {/* 左猫耳 */}
          <div className="absolute left-[18%] -top-[20px] z-10 pointer-events-none anime-dialog-ear anime-dialog-ear-left">
            <svg viewBox="0 0 34 26" className="w-[32px] h-[24px] overflow-visible drop-shadow-sm" fill="none">
              <path
                d="M 2 26 C 2 16, 7 7, 14 2 C 18 1, 21 3, 23 7 C 27 13, 31 20, 33 26"
                className="fill-card stroke-[2px] stroke-pink-400 dark:stroke-pink-500"
                strokeLinejoin="round"
              />
              <path
                d="M 7 25 C 7 17, 10 10, 15 5 C 18 10, 23 17, 26 25 Z"
                className="fill-pink-300/80 dark:fill-pink-500/60"
              />
              <path
                d="M 8 25 C 9 20, 12 16, 14 14 C 13 18, 14 21, 16 25"
                stroke="rgba(255,255,255,0.75)"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          {/* 右猫耳 */}
          <div className="absolute right-[18%] -top-[20px] z-10 pointer-events-none anime-dialog-ear anime-dialog-ear-right">
            <svg viewBox="0 0 34 26" className="w-[32px] h-[24px] overflow-visible drop-shadow-sm scale-x-[-1]" fill="none">
              <path
                d="M 2 26 C 2 16, 7 7, 14 2 C 18 1, 21 3, 23 7 C 27 13, 31 20, 33 26"
                className="fill-card stroke-[2px] stroke-pink-400 dark:stroke-pink-500"
                strokeLinejoin="round"
              />
              <path
                d="M 7 25 C 7 17, 10 10, 15 5 C 18 10, 23 17, 26 25 Z"
                className="fill-pink-300/80 dark:fill-pink-500/60"
              />
              <path
                d="M 8 25 C 9 20, 12 16, 14 14 C 13 18, 14 21, 16 25"
                stroke="rgba(255,255,255,0.75)"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </>
      )}
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "relative grid w-[calc(100vw-2rem)] min-w-0 max-w-lg max-h-[calc(100vh-2.5rem)] gap-4 border border-border/60 glass-strong rounded-2xl p-6 shadow-xl duration-300 [overflow-wrap:anywhere] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          isAnime && "anime-dialog-content border-pink-300/60 dark:border-pink-500/40",
          className
        )}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event)
          if (!event.defaultPrevented) {
            window.dispatchEvent(new CustomEvent("focus-active-terminal"))
          }
        }}
        onPointerDownOutside={(event) => {
          // 修复 Radix react-dialog@1.1.x 嵌套弹框 bug：Content 硬编码
          // deferPointerDownOutside: true，点击内层弹框的关闭按钮/选项时，
          // click 冒泡到 document 前内层已同步卸载，外层随即误判「点击了外部」
          // 被一并关闭。误触发时原始 pointerdown 的目标节点已随内层弹框脱离
          // 文档（isConnected === false）；正常点击遮罩时目标（overlay）仍连接
          // 在文档中，不受影响，照常关闭。
          const target = event.detail.originalEvent.target as Node | null
          if (target && !target.isConnected) {
            event.preventDefault()
            return
          }
          onPointerDownOutside?.(event)
        }}
        {...props}
      >
        {/* 二次元弹框背景猫咪小嘴 (Anime Dialog Cat Nose & Mouth Watermark) */}
        {isAnime && (
          <div className="absolute inset-0 pointer-events-none select-none flex items-center justify-center translate-y-4 overflow-hidden z-0">
            <svg
              viewBox="0 0 160 80"
              className="w-44 h-22 text-pink-400/18 dark:text-pink-400/12 transition-all duration-300 group-hover/dialog:text-pink-400/28 dark:group-hover/dialog:text-pink-400/20 group-hover/dialog:scale-105"
              fill="none"
            >
              {/* 樱花小三角鼻尖 */}
              <path
                d="M 80 27 L 75 20 C 75 19, 85 19, 85 20 Z"
                className="fill-current"
              />
              {/* 萌系 :3 / ω 娇俏猫咪嘴巴 */}
              <path
                d="M 64 32 C 69 39, 77 39, 80 29 C 83 39, 91 39, 96 32"
                stroke="currentColor"
                strokeWidth="2.8"
                strokeLinecap="round"
              />
              {/* 左侧灵动微胡须 */}
              <path d="M 36 25 C 46 27, 54 29, 60 29" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M 34 35 C 44 35, 52 34, 60 33" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              {/* 右侧灵动微胡须 */}
              <path d="M 124 25 C 114 27, 106 29, 100 29" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M 126 35 C 116 35, 108 34, 100 33" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              {/* 柔粉腮红微晕 */}
              <ellipse cx="48" cy="37" rx="8" ry="4" className="fill-current opacity-60" />
              <ellipse cx="112" cy="37" rx="8" ry="4" className="fill-current opacity-60" />
            </svg>
          </div>
        )}
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-lg p-1 opacity-60 ring-offset-background transition-all hover:bg-accent hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </div>
  </DialogPortal>
)})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex min-w-0 max-w-full flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex min-w-0 max-w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end", className)} {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("min-w-0 max-w-full break-words text-lg font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]", className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("min-w-0 max-w-full whitespace-pre-wrap break-words text-sm text-muted-foreground [overflow-wrap:anywhere]", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
