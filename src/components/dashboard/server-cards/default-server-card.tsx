import { memo } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Star, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { OsIcon } from '@/components/dashboard/os-icon'
import type { ServerCardSkinProps } from './types'
import { useServerCardActions } from './use-server-card-actions'

export const DefaultServerCard = memo(function DefaultServerCard({
  server,
  selected,
  onSelect,
  renamingServerId,
  renameValue,
  onRenameValueChange,
  onRenameSubmit,
  onRenameCancel,
  ...rest
}: ServerCardSkinProps & React.HTMLAttributes<HTMLDivElement>) {
  const {
    t,
    copied,
    handleCopyIp,
    handleToggleFavorite,
    handleClick,
    handleDoubleClick,
  } = useServerCardActions({ server, onSelect })

  return (
    <Card
      {...rest}
      data-server-id={server.id}
      draggable
      className={cn(
        "server-card bg-card border group/card select-none transition-colors duration-150 cursor-pointer",
        selected && "is-selected",
        rest.className,
      )}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <div className="flex items-center gap-3 relative">
        {/* Left Side: OS Icon */}
        <OsIcon osType={server.osType} osInfo={server.osInfo} targetType={server.targetType} className="h-10 w-10 rounded-xl flex-shrink-0 shadow-sm" />

        {/* Right Side: Name line & IP/Tags line */}
        <div className="flex-1 min-w-0">
          {/* First Line: Name + Online Status + Favorite Star */}
          <div className="flex items-center gap-1.5 min-w-0">
            {renamingServerId === server.id ? (
              <Input
                ref={(el) => {
                  if (el) {
                    setTimeout(() => {
                      el.focus()
                      el.select()
                    }, 0)
                  }
                }}
                value={renameValue}
                onChange={(e) => onRenameValueChange(e.target.value)}
                onFocus={(e) => e.target.select()}
                maxLength={100}
                onBlur={onRenameSubmit}
                onKeyDown={(e) => { if (e.key === 'Enter') onRenameSubmit(); if (e.key === 'Escape') onRenameCancel() }}
                className="h-5 text-xs py-0 px-1"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="font-semibold text-[13px] text-foreground truncate block max-w-[70%]">{server.name}</span>
                {/* Favorite Star（紧挨名称） */}
                <button
                  onClick={handleToggleFavorite}
                  className={cn(
                    "p-0.5 rounded hover:bg-accent text-muted-foreground/20 hover:text-amber-500 transition-colors cursor-pointer flex-shrink-0 ml-auto",
                    !server.favorite && "opacity-0 group-hover/card:opacity-100 transition-opacity"
                  )}
                  title={server.favorite ? t('dash_unfavorite') : t('dash_favorite')}
                >
                  <Star className={cn("h-3.5 w-3.5", server.favorite ? "fill-amber-500 text-amber-500" : "text-current")} />
                </button>
              </>
            )}
          </div>

          {/* Second Line: IP + Copy Button */}
          <div className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5 font-sans min-w-0">
            <span className="font-mono truncate">{server.host}</span>
            {/* Copy Button (only appears on card hover) */}
            <button
              onClick={handleCopyIp}
              className="inline-flex items-center justify-center h-4 w-4 rounded hover:bg-accent transition-colors flex-shrink-0 cursor-pointer text-muted-foreground/30 hover:text-foreground opacity-0 group-hover/card:opacity-100 focus:opacity-100 transition-opacity"
              title={t('dash_copy_ip')}
            >
              {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
        </div>
      </div>
    </Card>
  )
})
