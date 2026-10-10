import { memo } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Star, Copy, Check, Heart } from 'lucide-react'
import { cn } from '@/lib/utils'
import { OsIcon } from '@/components/dashboard/os-icon'
import type { ServerCardSkinProps } from './types'
import { useServerCardActions } from './use-server-card-actions'

/**
 * 二次元超萌猫咪服务器卡片 (Anime Kawaii Cat Server Card)
 * 特色：
 * 1. 顶部俏皮立体的左右猫耳朵（带粉嫩内耳窝与耳毛细节，悬停欢快微颤动效）
 * 2. 左右两侧柔和猫胡须（Cat Whiskers）
 * 3. 背景萌系猫咪小嘴（Cat Nose & Mouth）
 * 4. 选中状态萌系 ♥ NYA! 心动贴纸徽章
 * 5. 全功能完整继承（双击打开、单击选择、Ctrl多选、拖拽、右键菜单、重命名、复制IP）
 */
export const AnimeCatServerCard = memo(function AnimeCatServerCard({
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
    <div {...rest} className={cn("relative group/card select-none", selected && "is-card-selected", rest.className)}>
      {/* 顶部俏皮立体的左右猫耳朵 (Kawaii Cat Ears with Twitch Animation) */}
      <div className="absolute left-6 -top-3.5 z-10 pointer-events-none anime-cat-ear anime-cat-ear-left">
        <svg viewBox="0 0 34 26" className="w-[26px] h-[20px] overflow-visible drop-shadow-sm" fill="none">
          <path
            d="M 2 26 C 2 16, 7 7, 14 2 C 18 1, 21 3, 23 7 C 27 13, 31 20, 33 26"
            className="fill-card stroke-[2px] stroke-pink-300 dark:stroke-pink-500/60"
            strokeLinejoin="round"
          />
          <path
            d="M 7 25 C 7 17, 10 10, 15 5 C 18 10, 23 17, 26 25 Z"
            className="fill-pink-300/85 dark:fill-pink-500/70"
          />
          <path
            d="M 8 25 C 9 20, 12 16, 14 14 C 13 18, 14 21, 16 25"
            stroke="rgba(255,255,255,0.75)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="absolute right-6 -top-3.5 z-10 pointer-events-none anime-cat-ear anime-cat-ear-right">
        <svg viewBox="0 0 34 26" className="w-[26px] h-[20px] overflow-visible drop-shadow-sm scale-x-[-1]" fill="none">
          <path
            d="M 2 26 C 2 16, 7 7, 14 2 C 18 1, 21 3, 23 7 C 27 13, 31 20, 33 26"
            className="fill-card stroke-[2px] stroke-pink-300 dark:stroke-pink-500/60"
            strokeLinejoin="round"
          />
          <path
            d="M 7 25 C 7 17, 10 10, 15 5 C 18 10, 23 17, 26 25 Z"
            className="fill-pink-300/85 dark:fill-pink-500/70"
          />
          <path
            d="M 8 25 C 9 20, 12 16, 14 14 C 13 18, 14 21, 16 25"
            stroke="rgba(255,255,255,0.75)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* 卡片主体 (Card Body) */}
      <Card
        data-server-id={server.id}
        draggable
        className={cn(
          "server-card anime-cat-card relative rounded-[20px] p-3.5 cursor-pointer overflow-visible transition-all duration-200",
          "border-2 border-pink-300/60 dark:border-pink-500/40 bg-card/95 hover:border-pink-400 dark:hover:border-pink-400",
          "shadow-[0_4px_16px_rgba(255,107,161,0.09)] hover:shadow-[0_10px_26px_rgba(255,107,161,0.22)] hover:-translate-y-1",
          selected && "is-selected border-pink-500 ring-2 ring-pink-400/40 shadow-[0_10px_28px_rgba(255,80,150,0.28)]"
        )}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {/* 左侧猫胡须 (Left Whiskers) */}
        <div className="absolute left-1 top-1/2 -translate-y-1/2 pointer-events-none text-pink-400/30 dark:text-pink-400/40 group-hover/card:text-pink-500/60 group-hover/card:-translate-x-0.5 transition-all duration-200">
          <svg viewBox="0 0 14 16" className="w-3 h-4" fill="none">
            <path d="M 1 3 C 5 4, 9 6, 13 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M 2 8 C 6 8, 9 9, 13 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M 1 13 C 5 12, 9 11, 13 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>

        {/* 右侧猫胡须 (Right Whiskers) */}
        <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none text-pink-400/30 dark:text-pink-400/40 group-hover/card:text-pink-500/60 group-hover/card:translate-x-0.5 transition-all duration-200">
          <svg viewBox="0 0 14 16" className="w-3 h-4 scale-x-[-1]" fill="none">
            <path d="M 1 3 C 5 4, 9 6, 13 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M 2 8 C 6 8, 9 9, 13 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M 1 13 C 5 12, 9 11, 13 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>

        {/* 卡片背景萌系猫咪小嘴 (Kawaii Cat Nose & Mouth Watermark) */}
        <div className="absolute inset-0 pointer-events-none select-none flex items-end justify-center pb-1.5 z-0 overflow-hidden rounded-[20px]">
          <svg
            viewBox="0 0 70 36"
            className="w-16 h-8 text-pink-400/22 dark:text-pink-400/16 transition-all duration-300 group-hover/card:text-pink-500/38 dark:group-hover/card:text-pink-400/28 group-hover/card:scale-110"
            fill="none"
          >
            {/* 樱花小三角鼻尖 */}
            <path
              d="M 35 13 L 31 8 C 31 7.5, 39 7.5, 39 8 Z"
              className="fill-current"
            />
            {/* 萌系 :3 / ω 娇俏猫咪嘴巴 */}
            <path
              d="M 26 15 C 29 20, 33 20, 35 14 C 37 20, 41 20, 44 15"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            {/* 柔粉小腮红 */}
            <ellipse cx="20" cy="18" rx="4" ry="2" className="fill-current opacity-60" />
            <ellipse cx="50" cy="18" rx="4" ry="2" className="fill-current opacity-60" />
          </svg>
        </div>

        {/* 卡片内容区 */}
        <div className="flex items-center gap-3 relative z-10 px-1">
          {/* OS 图标（萌系圆润小铃铛项圈风） */}
          <div className="relative flex-shrink-0">
            <OsIcon
              osType={server.osType}
              osInfo={server.osInfo}
              targetType={server.targetType}
              className="h-10 w-10 rounded-[14px] flex-shrink-0 shadow-sm ring-2 ring-pink-300/40 dark:ring-pink-500/30 transition-transform group-hover/card:scale-105"
            />
            {/* 萌系小金铃铛 (Jingle Bell Collar Tag) */}
            <div
              className="absolute -bottom-1 -right-1 pointer-events-none drop-shadow-sm transition-transform duration-300 group-hover/card:rotate-12 group-hover/card:scale-110"
              title="Kawaii Bell"
            >
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none">
                <circle cx="8" cy="8" r="5.5" className="fill-amber-400 stroke-amber-500/80" strokeWidth="0.8" />
                <path d="M 3.8 6 L 12.2 6" stroke="#D97706" strokeWidth="0.8" strokeLinecap="round" />
                <circle cx="8" cy="8.5" r="1.2" className="fill-amber-800" />
                <line x1="8" y1="9.7" x2="8" y2="12.8" stroke="#B45309" strokeWidth="0.8" strokeLinecap="round" />
                <circle cx="6.2" cy="5.2" r="0.6" fill="#FEF3C7" />
              </svg>
            </div>
          </div>

          {/* 服务器信息 */}
          <div className="flex-1 min-w-0">
            {/* 第一行：名称 + 收藏星星/爱心 */}
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
                  className="h-5 text-xs py-0 px-1.5 rounded-lg border-pink-400 focus-visible:ring-pink-400"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="font-semibold text-[13px] text-foreground truncate block max-w-[70%] font-sans tracking-wide">
                    {server.name}
                  </span>
                  {/* 收藏星标（二次元萌系动效） */}
                  <button
                    onClick={handleToggleFavorite}
                    className={cn(
                      "p-0.5 rounded-md hover:bg-pink-500/10 text-muted-foreground/30 hover:text-pink-500 transition-all cursor-pointer flex-shrink-0 ml-auto",
                      !server.favorite && "opacity-0 group-hover/card:opacity-100 transition-opacity"
                    )}
                    title={server.favorite ? t('dash_unfavorite') : t('dash_favorite')}
                  >
                    {server.favorite ? (
                      <Heart className="h-3.5 w-3.5 fill-pink-500 text-pink-500 animate-pulse" />
                    ) : (
                      <Star className="h-3.5 w-3.5 hover:text-pink-400" />
                    )}
                  </button>
                </>
              )}
            </div>

            {/* 第二行：IP + 复制按钮 */}
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5 font-sans min-w-0">
              <span className="font-mono truncate">{server.host}</span>

              {/* 复制按钮 */}
              <button
                onClick={handleCopyIp}
                className="inline-flex items-center justify-center h-4 w-4 rounded-md hover:bg-pink-500/15 transition-colors flex-shrink-0 cursor-pointer text-muted-foreground/30 hover:text-pink-500 opacity-0 group-hover/card:opacity-100 focus:opacity-100 transition-opacity"
                title={t('dash_copy_ip')}
              >
                {copied ? <Check className="h-3 w-3 text-pink-500" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          </div>
        </div>

        {/* 4. 选中贴纸徽章 (Kawaii Active Sticker) */}
        {selected && (
          <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <span className="inline-flex items-center gap-0.5 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold text-white bg-gradient-to-r from-pink-500 to-rose-500 shadow-[0_2px_8px_rgba(244,63,94,0.4)] animate-in zoom-in-75 duration-150">
              ♥ NYA!
            </span>
          </div>
        )}
      </Card>
    </div>
  )
})
