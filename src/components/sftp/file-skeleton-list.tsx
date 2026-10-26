import React from 'react'
import { cn } from '@/lib/utils'

interface FileSkeletonListProps {
  count?: number
  viewMode?: 'list' | 'medium' | 'large' | string
  className?: string
}

/**
 * 现代文件目录加载骨架屏组件 (对标 Termius / VS Code)
 * 在冷加载未命中缓存时提供极速视觉占位，彻底消除"旧目录半透明卡顿停滞"的不适感
 */
export function FileSkeletonList({
  count = 7,
  viewMode = 'list',
  className,
}: FileSkeletonListProps) {
  if (viewMode === 'large' || viewMode === 'medium') {
    return (
      <div
        className={cn(
          "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3 p-4",
          className
        )}
      >
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col items-center justify-center gap-2 p-3 rounded-xl border border-border/20 bg-muted/15 animate-pulse"
          >
            <div className="h-10 w-10 rounded-lg bg-muted/60" />
            <div
              className="h-3 rounded bg-muted/50"
              style={{ width: `${Math.max(40, 75 - (i % 4) * 12)}%` }}
            />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col divide-y divide-border/20 px-3 py-1 select-none", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2.5 px-2 animate-pulse">
          {/* 图标占位 */}
          <div className="h-4 w-4 rounded shrink-0 bg-muted/60" />
          {/* 文件名长短自然错落 */}
          <div
            className="h-3.5 rounded bg-muted/50"
            style={{ width: `${Math.max(28, 55 - (i % 5) * 8)}%` }}
          />
          {/* 属性列占位 */}
          <div className="ml-auto flex items-center gap-6 shrink-0 opacity-60">
            <div className="h-3 w-12 rounded bg-muted/40 hidden sm:block" />
            <div className="h-3 w-28 rounded bg-muted/40 hidden md:block" />
            <div className="h-3 w-16 rounded bg-muted/40 hidden lg:block" />
          </div>
        </div>
      ))}
    </div>
  )
}
