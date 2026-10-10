import React, { useMemo } from 'react'
import { ChevronRight, ChevronDown, Folder, HardDrive, MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface BreadcrumbCrumb {
  label: string
  path: string
}

export interface SftpBreadcrumbBarProps {
  crumbs: BreadcrumbCrumb[]
  onNavigate: (path: string) => void
  onDoubleClick?: () => void
  title?: string
  /** Whether to enable Windows drive switcher on the first crumb */
  isLocalRootSelectable?: boolean
  systemRoots?: string[]
  className?: string
}

export function SftpBreadcrumbBar({
  crumbs,
  onNavigate,
  onDoubleClick,
  title,
  isLocalRootSelectable = false,
  systemRoots = [],
  className,
}: SftpBreadcrumbBarProps) {
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0) {
      e.currentTarget.scrollLeft += e.deltaY
    }
  }

  // When crumbs count > 4, fold intermediate crumbs (excluding the first and last 3)
  const { isFolded, firstCrumb, hiddenCrumbs, tailCrumbs } = useMemo(() => {
    if (crumbs.length <= 4) {
      return { isFolded: false, firstCrumb: null, hiddenCrumbs: [], tailCrumbs: [] }
    }
    return {
      isFolded: true,
      firstCrumb: crumbs[0],
      hiddenCrumbs: crumbs.slice(1, crumbs.length - 3),
      tailCrumbs: crumbs.slice(crumbs.length - 3),
    }
  }, [crumbs])

  const renderFirstCrumb = (crumb: BreadcrumbCrumb, isLast: boolean) => {
    if (isLocalRootSelectable && systemRoots.length > 1) {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onDoubleClick={(e) => e.stopPropagation()}
              className={cn(
                "hover:text-foreground hover:bg-muted/40 transition-all px-1.5 py-0.5 rounded flex items-center gap-0.5 cursor-pointer font-medium border border-transparent hover:border-border/30 shrink-0",
                isLast && "text-foreground font-semibold"
              )}
            >
              <span className="truncate max-w-[130px]">{crumb.label}</span>
              <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[80px]">
            {systemRoots.map((root) => (
              <DropdownMenuItem
                key={root}
                onClick={() => onNavigate(root)}
                className="text-xs cursor-pointer gap-2"
              >
                <HardDrive className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                {root.replace('\\', '')}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }

    return (
      <button
        type="button"
        onClick={() => onNavigate(crumb.path)}
        onDoubleClick={(e) => e.stopPropagation()}
        title={crumb.label}
        className={cn(
          "hover:text-primary hover:underline transition-colors px-1 py-0.5 rounded truncate max-w-[130px] shrink-0 text-left",
          isLast && "text-foreground font-semibold"
        )}
      >
        {crumb.label}
      </button>
    )
  }

  return (
    <div
      className={cn(
        "flex-1 flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-0.5 text-xs text-muted-foreground select-none h-7 flex-nowrap min-w-0",
        className
      )}
      onDoubleClick={onDoubleClick}
      onWheel={handleWheel}
      title={title}
    >
      {crumbs.length === 0 ? null : !isFolded ? (
        crumbs.map((crumb, idx) => (
          <div key={crumb.path} className="flex items-center flex-shrink-0">
            {idx > 0 && <ChevronRight className="h-3 w-3 mx-0.5 flex-shrink-0 text-muted-foreground/60" />}
            {idx === 0 ? (
              renderFirstCrumb(crumb, idx === crumbs.length - 1)
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(crumb.path)}
                onDoubleClick={(e) => e.stopPropagation()}
                title={crumb.label}
                className={cn(
                  "hover:text-primary hover:underline transition-colors px-1 py-0.5 rounded truncate max-w-[130px] shrink-0 text-left",
                  idx === crumbs.length - 1 && "text-foreground font-semibold"
                )}
              >
                {crumb.label}
              </button>
            )}
          </div>
        ))
      ) : (
        <>
          {/* First crumb */}
          {firstCrumb && (
            <div className="flex items-center flex-shrink-0">
              {renderFirstCrumb(firstCrumb, false)}
            </div>
          )}

          {/* Ellipsis with Dropdown */}
          <div className="flex items-center flex-shrink-0">
            <ChevronRight className="h-3 w-3 mx-0.5 flex-shrink-0 text-muted-foreground/60" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="hover:text-foreground hover:bg-muted/50 transition-all px-1.5 py-0.5 rounded flex items-center justify-center cursor-pointer border border-transparent hover:border-border/40 h-5 w-6 shrink-0 text-muted-foreground/80 hover:text-foreground"
                  title="..."
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto min-w-[180px] p-1 shadow-md">
                {hiddenCrumbs.map((crumb) => (
                  <DropdownMenuItem
                    key={crumb.path}
                    onClick={() => onNavigate(crumb.path)}
                    className="text-xs cursor-pointer gap-2 py-1.5 px-2 rounded flex items-center"
                    title={crumb.path}
                  >
                    <Folder className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                    <span className="truncate max-w-[200px]">{crumb.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Tail crumbs */}
          {tailCrumbs.map((crumb, idx) => {
            const isLast = idx === tailCrumbs.length - 1
            return (
              <div key={crumb.path} className="flex items-center flex-shrink-0">
                <ChevronRight className="h-3 w-3 mx-0.5 flex-shrink-0 text-muted-foreground/60" />
                <button
                  type="button"
                  onClick={() => onNavigate(crumb.path)}
                  onDoubleClick={(e) => e.stopPropagation()}
                  title={crumb.label}
                  className={cn(
                    "hover:text-primary hover:underline transition-colors px-1 py-0.5 rounded truncate max-w-[130px] shrink-0 text-left",
                    isLast && "text-foreground font-semibold"
                  )}
                >
                  {crumb.label}
                </button>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
