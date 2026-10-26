import * as React from "react"
import { cn } from "@/lib/utils"

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  /** 快捷键组合（如 Ctrl, Cmd, Shift, ↵, K 等） */
  children?: React.ReactNode
}

/**
 * Raycast 风格实体触感快捷键按键组件 (Tactile Keycap)
 * - 紧凑等宽、微立体发丝边框与内高光
 * - 提供实体按键的桌面物理触感
 */
export const Kbd = React.forwardRef<HTMLElement, KbdProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <kbd
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center font-mono text-[10px] font-medium leading-none select-none tracking-tight",
          "h-[20px] min-w-[20px] px-1.5 rounded-[5px]",
          "bg-muted/80 text-muted-foreground border border-border/80",
          "shadow-[0_1px_0_1px_rgba(0,0,0,0.05),inset_0_1px_0_0_rgba(255,255,255,0.25)]",
          "dark:bg-secondary/60 dark:text-muted-foreground/90 dark:border-white/10 dark:shadow-[0_1px_0_0_rgba(0,0,0,0.45),inset_0_1px_0_0_rgba(255,255,255,0.08)]",
          className
        )}
        {...props}
      >
        {children}
      </kbd>
    )
  }
)
Kbd.displayName = "Kbd"
