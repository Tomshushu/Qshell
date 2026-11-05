/**
 * 通用「小问号」提示组件
 *
 * 设置页只展示标题与控件，较长的说明、规则清单、风险提示收进 hover/focus 浮层，
 * 避免大段文字平铺造成信息密度过高。全局 TooltipProvider 由 App.tsx 提供。
 */

import type { ReactNode } from 'react'
import { HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipTrigger, TooltipContent } from './tooltip'

export interface HintTooltipProps {
  /** 浮层内容，支持多行文本或列表节点 */
  content: ReactNode
  /** 无障碍标签（不可见） */
  label?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
  /** 图标尺寸，默认 h-3.5 */
  iconClassName?: string
}

export function HintTooltip({
  content,
  label = 'More info',
  side = 'top',
  className,
  iconClassName,
}: HintTooltipProps) {
  if (!content) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="button"
          aria-label={label}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'inline-flex items-center justify-center shrink-0 text-muted-foreground/50 hover:text-foreground cursor-help transition-colors rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50',
            className,
          )}
        >
          <HelpCircle className={cn('h-3.5 w-3.5', iconClassName)} />
        </span>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        className="max-w-[320px] text-[11px] leading-relaxed whitespace-normal"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  )
}
