import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground border-border/70",
        // Linear / Raycast 风格静音胶囊（Soft Badges）：低饱和微透背景 + 柔和边界
        soft: "border-border/50 bg-muted/50 text-muted-foreground",
        "soft-success":
          "border-green-500/25 bg-green-500/10 text-green-600 dark:text-green-400 dark:border-green-400/20",
        "soft-warning":
          "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400 dark:border-amber-400/20",
        "soft-destructive":
          "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400 dark:border-red-400/20",
        "soft-info":
          "border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400 dark:border-sky-400/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
