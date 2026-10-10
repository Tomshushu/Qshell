import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"
import { cn } from "@/lib/utils"

/**
 * 开关组件（Apple Design System 风格）
 *
 * 设计要点：
 * - 较大的点击区域（w-11 h-6），符合 macOS / iOS 开关尺寸
 * - 关闭态使用 muted 背景，开启态使用 primary 实色，对比清晰
 * - 圆点（thumb）使用纯白带细微阴影，开启时向右滑动
 * - 平滑的 spring 动画过渡，与项目 --ease-spring 一致
 * - focus-visible 焦点环使用 ring 变量
 *
 * 用法：
 *   <Switch checked={enabled} onCheckedChange={setEnabled} />
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform duration-200",
        "data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
