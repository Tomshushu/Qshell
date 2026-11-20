import { cn } from '@/lib/utils'

/**
 * 自定义会话图标（P1-13）
 *
 * 支持三种取值：
 * - `data:image/...` 数据 URL：渲染为图片
 * - 预设 ID / emoji：渲染为居中文本（预设 ID 由选择器映射为 emoji 后写入）
 *
 * 未设置时不渲染任何内容，由调用方回退到默认 OS 图标。
 */
export function ServerIconBadge({
  icon,
  className,
  textClassName = 'text-2xl',
}: {
  icon?: string | null
  className?: string
  /** emoji 字号，需按容器尺寸显式指定（默认适配 40px 卡片） */
  textClassName?: string
}) {
  const value = icon?.trim()
  if (!value) return null

  if (value.startsWith('data:image/')) {
    return (
      <img
        src={value}
        alt=""
        draggable={false}
        className={cn('object-cover select-none', className)}
      />
    )
  }

  // 超长非 data URL 文本不做渲染，避免布局被异常配置撑破
  if (value.length > 24) return null

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center overflow-hidden bg-muted/60 leading-none select-none',
        className,
      )}
      aria-hidden
    >
      <span className={textClassName}>{value}</span>
    </span>
  )
}
