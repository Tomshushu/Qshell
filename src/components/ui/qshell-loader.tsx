import React, { memo } from 'react'
import { cn } from '@/lib/utils'

export type QshellLoaderSize = 'hero' | 'lg' | 'md' | 'sm' | 'xs'

export interface QshellLoaderProps {
  /**
   * Sizing presets:
   * - 'hero': 80px mascots (Startup splash, hero states)
   * - 'lg': 54px mascots (Connecting to remote server, prominent dialogs)
   * - 'md': 36px mascots (Panels, directory scans, log loads, update checks)
   * - 'sm': 24px mascots (Cards, small containers)
   * - 'xs': 13px inline bouncy chromatic wordmark (Buttons, status tags)
   */
  size?: QshellLoaderSize
  /** Optional caption or status text */
  text?: React.ReactNode
  /** Additional wrapper CSS class */
  className?: string
  /** Text layout orientation: 'vertical' (default) or 'horizontal' */
  layout?: 'vertical' | 'horizontal'
  /** Whether to show the bouncy ground shadows (for md, lg, hero) */
  showShadow?: boolean
  /** Whether the mascot letters are stationary/paused without jumping animation */
  isStatic?: boolean
}

const SIZE_STYLES: Record<
  Exclude<QshellLoaderSize, 'xs'>,
  {
    q: string
    s: string
    h: string
    e: string
    l: string
    shadowH: string
    gap: string
    jumpVars: React.CSSProperties
  }
> = {
  hero: {
    q: 'w-20 h-20 md:w-24 md:h-24',
    s: 'w-12 h-16 md:w-15 md:h-20',
    h: 'w-13 h-18 md:w-16 md:h-22',
    e: 'w-12 h-16 md:w-15 md:h-20',
    l: 'w-8 h-18 md:w-9 md:h-22',
    shadowH: 'h-2 w-full max-w-[40px]',
    gap: 'gap-3 md:gap-4',
    jumpVars: {
      ['--q-jump-y' as string]: '-20px',
      ['--q-squash-y' as string]: '4px',
      ['--q-land-y' as string]: '2px',
      ['--q-rebound-y' as string]: '-4px',
      ['--q-glow-blur' as string]: '12px',
      ['--q-glow-spread' as string]: '16px',
    },
  },
  lg: {
    q: 'w-14 h-14',
    s: 'w-9 h-12',
    h: 'w-10 h-13.5',
    e: 'w-9 h-12',
    l: 'w-6 h-13.5',
    shadowH: 'h-1.5 w-full max-w-[28px]',
    gap: 'gap-2',
    jumpVars: {
      ['--q-jump-y' as string]: '-14px',
      ['--q-squash-y' as string]: '3px',
      ['--q-land-y' as string]: '1.5px',
      ['--q-rebound-y' as string]: '-2.5px',
      ['--q-glow-blur' as string]: '8px',
      ['--q-glow-spread' as string]: '12px',
    },
  },
  md: {
    q: 'w-9 h-9',
    s: 'w-6 h-8',
    h: 'w-6.5 h-9',
    e: 'w-6 h-8',
    l: 'w-4 h-9',
    shadowH: 'h-1 w-full max-w-[20px]',
    gap: 'gap-1.5',
    jumpVars: {
      ['--q-jump-y' as string]: '-9px',
      ['--q-squash-y' as string]: '2px',
      ['--q-land-y' as string]: '1px',
      ['--q-rebound-y' as string]: '-1.8px',
      ['--q-glow-blur' as string]: '6px',
      ['--q-glow-spread' as string]: '8px',
    },
  },
  sm: {
    q: 'w-6 h-6',
    s: 'w-4 h-5',
    h: 'w-4.5 h-5.5',
    e: 'w-4 h-5',
    l: 'w-3 h-5.5',
    shadowH: 'h-0.5 w-full max-w-[14px]',
    gap: 'gap-1',
    jumpVars: {
      ['--q-jump-y' as string]: '-5px',
      ['--q-squash-y' as string]: '1.2px',
      ['--q-land-y' as string]: '0.6px',
      ['--q-rebound-y' as string]: '-1px',
      ['--q-glow-blur' as string]: '3px',
      ['--q-glow-spread' as string]: '4px',
    },
  },
}

export const QshellLoader = memo(function QshellLoader({
  size = 'md',
  text,
  className,
  layout = 'vertical',
  showShadow = true,
  isStatic = false,
}: QshellLoaderProps) {
  // 1. 超小型 (xs) 适用于 Button 内部或极度精简状态栏 (自动随主题切换色彩与光晕)
  if (size === 'xs') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1.5 select-none font-mono font-black text-xs tracking-tight',
          className
        )}
      >
        <div
          className="inline-flex items-center gap-0.5 leading-none"
          style={{
            ['--q-jump-y' as string]: '-3px',
            ['--q-squash-y' as string]: '0.8px',
            ['--q-land-y' as string]: '0.4px',
            ['--q-rebound-y' as string]: '-0.5px',
            ['--q-glow-blur' as string]: '2px',
            ['--q-glow-spread' as string]: '4px',
          }}
        >
          <span
            className="inline-block origin-bottom"
            style={{
              color: 'var(--qshell-c-q)',
              ['--char-glow' as string]: 'var(--qshell-glow-q)',
              animation: isStatic ? 'none' : 'qshell-ultra-cute-jump 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
              animationDelay: '0.00s',
            }}
          >
            Q
          </span>
          <span
            className="inline-block origin-bottom"
            style={{
              color: 'var(--qshell-c-s)',
              ['--char-glow' as string]: 'var(--qshell-glow-s)',
              animation: isStatic ? 'none' : 'qshell-ultra-cute-jump 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
              animationDelay: '0.09s',
            }}
          >
            s
          </span>
          <span
            className="inline-block origin-bottom"
            style={{
              color: 'var(--qshell-c-h)',
              ['--char-glow' as string]: 'var(--qshell-glow-h)',
              animation: isStatic ? 'none' : 'qshell-ultra-cute-jump 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
              animationDelay: '0.18s',
            }}
          >
            h
          </span>
          <span
            className="inline-block origin-bottom"
            style={{
              color: 'var(--qshell-c-e)',
              ['--char-glow' as string]: 'var(--qshell-glow-e)',
              animation: isStatic ? 'none' : 'qshell-ultra-cute-jump 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
              animationDelay: '0.27s',
            }}
          >
            e
          </span>
          <span
            className="inline-block origin-bottom"
            style={{
              color: 'var(--qshell-c-l1)',
              ['--char-glow' as string]: 'var(--qshell-glow-l1)',
              animation: isStatic ? 'none' : 'qshell-ultra-cute-jump 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
              animationDelay: '0.36s',
            }}
          >
            l
          </span>
          <span
            className="inline-block origin-bottom"
            style={{
              color: 'var(--qshell-c-l2)',
              ['--char-glow' as string]: 'var(--qshell-glow-l2)',
              animation: isStatic ? 'none' : 'qshell-ultra-cute-jump 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
              animationDelay: '0.45s',
            }}
          >
            l
          </span>
        </div>
        {text && <span className="font-normal font-sans text-muted-foreground">{text}</span>}
      </div>
    )
  }

  // 2. 矢量吉祥物形态 (sm, md, lg, hero)
  const styles = SIZE_STYLES[size]
  const displayShadow = showShadow && (size === 'md' || size === 'lg' || size === 'hero')

  return (
    <div
      className={cn(
        'flex select-none items-center justify-center',
        layout === 'vertical' ? 'flex-col gap-3' : 'flex-row gap-4',
        className
      )}
      style={styles.jumpVars}
    >
      <div className={cn('flex items-end justify-center', styles.gap)}>
        {/* 1. Q 宝 (跳起时: 亮色明亮深天蓝 / 暗色冰川苏打蓝) */}
        <div className="flex flex-col items-center">
          <div
            className="relative cursor-pointer origin-bottom"
            style={{
              ['--char-glow' as string]: 'var(--qshell-glow-q)',
              ['--tilt' as string]: '-5deg',
              animation: isStatic ? 'none' : 'qshell-ultra-cute-jump 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
              animationDelay: '0.00s',
            }}
          >
            <svg className={cn(styles.q, 'overflow-visible')} viewBox="0 0 90 90" fill="none">
              {/* 左侧小猫耳 */}
              <g style={{ transformOrigin: '30px 24px', animation: 'qshell-ear-wiggle-left 2s ease-in-out infinite' }}>
                <polygon points="22,26 31,10 38,24" fill="var(--qshell-c-q)" stroke="var(--qshell-c-q)" strokeWidth="2" strokeLinejoin="round" />
                <polygon points="25,24 31,14 36,23" fill="#f43f5e" opacity="0.6" />
              </g>

              {/* 右侧小猫耳 */}
              <g style={{ transformOrigin: '58px 24px', animation: 'qshell-ear-wiggle-right 2s ease-in-out infinite' }}>
                <polygon points="50,24 57,10 66,26" fill="var(--qshell-c-q)" stroke="var(--qshell-c-q)" strokeWidth="2" strokeLinejoin="round" />
                <polygon points="52,23 57,14 63,24" fill="#f43f5e" opacity="0.6" />
              </g>

              {/* Q 宝肚皮 */}
              <circle cx="44" cy="48" r="32" fill="var(--qshell-belly-fill)" stroke="var(--qshell-c-q)" strokeWidth="5" />

              {/* 水汪汪双眼 (带眨眼) */}
              <g style={{ transformOrigin: '44px 44px', animation: 'qshell-kawaii-blink 3.4s infinite' }}>
                <circle cx="32" cy="44" r="5" fill="var(--qshell-c-q)" />
                <circle cx="30.5" cy="42" r="2" fill="#ffffff" />
                <circle cx="34" cy="46" r="1" fill="#ffffff" opacity="0.8" />
                <circle cx="56" cy="44" r="5" fill="var(--qshell-c-q)" />
                <circle cx="54.5" cy="42" r="2" fill="#ffffff" />
                <circle cx="58" cy="46" r="1" fill="#ffffff" opacity="0.8" />
              </g>

              {/* 猫咪微笑小嘴巴 */}
              <path d="M38 52 Q41 56 44 52 Q47 56 50 52" stroke="var(--qshell-c-q)" strokeWidth="3" strokeLinecap="round" fill="none" />
              {/* 腮红 */}
              <ellipse cx="25" cy="51" rx="4" ry="2.5" fill="#f43f5e" opacity="0.65" />
              <ellipse cx="63" cy="51" rx="4" ry="2.5" fill="#f43f5e" opacity="0.65" />

              {/* 欢快甩动的小尾巴 */}
              <g style={{ transformOrigin: '64px 64px', animation: 'qshell-cute-tail-wag 0.5s ease-in-out infinite' }}>
                <path d="M62 62 Q72 74 80 80" stroke="var(--qshell-c-q)" strokeWidth="6" strokeLinecap="round" />
                <circle cx="80" cy="80" r="3.5" fill="#ffffff" />
              </g>
            </svg>
          </div>
          {displayShadow && (
            <div
              className={cn(styles.shadowH, 'rounded-full mt-1 origin-center')}
              style={{
                background: 'var(--qshell-ground-shadow)',
                animation: isStatic ? 'none' : 'qshell-shadow-bounce 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
                animationDelay: '0.00s',
              }}
            />
          )}
        </div>

        {/* 2. s 宝 (跳起时: 亮色浓郁暖橘橙 / 暗色活力甜橙黄) */}
        <div className="flex flex-col items-center">
          <div
            className="relative origin-bottom"
            style={{
              ['--char-glow' as string]: 'var(--qshell-glow-s)',
              ['--tilt' as string]: '6deg',
              animation: isStatic ? 'none' : 'qshell-ultra-cute-jump 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
              animationDelay: '0.09s',
            }}
          >
            <svg className={cn(styles.s, 'overflow-visible')} viewBox="0 0 54 70" fill="none">
              <path
                d="M42 22 C42 10, 14 10, 14 26 C14 42, 40 34, 40 50 C40 64, 12 64, 12 52"
                stroke="var(--qshell-c-s)"
                strokeWidth="7.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* 眯缝萌笑眼 ( > < ) */}
              <path d="M22 23 L26 26 L22 29" stroke="var(--qshell-c-s)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M34 23 L30 26 L34 29" stroke="var(--qshell-c-s)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {/* s 宝腮红 */}
              <circle cx="18" cy="27" r="2.5" fill="#f43f5e" opacity="0.75" />
              <circle cx="38" cy="27" r="2.5" fill="#f43f5e" opacity="0.75" />
            </svg>
          </div>
          {displayShadow && (
            <div
              className={cn(styles.shadowH, 'rounded-full mt-1 origin-center')}
              style={{
                background: 'var(--qshell-ground-shadow)',
                animation: isStatic ? 'none' : 'qshell-shadow-bounce 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
                animationDelay: '0.09s',
              }}
            />
          )}
        </div>

        {/* 3. h 宝 (跳起时: 亮色清新翡翠绿 / 暗色清新薄荷绿) */}
        <div className="flex flex-col items-center">
          <div
            className="relative origin-bottom"
            style={{
              ['--char-glow' as string]: 'var(--qshell-glow-h)',
              ['--tilt' as string]: '-4deg',
              animation: isStatic ? 'none' : 'qshell-ultra-cute-jump 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
              animationDelay: '0.18s',
            }}
          >
            <svg className={cn(styles.h, 'overflow-visible')} viewBox="0 0 60 84" fill="none">
              {/* 兔兔长耳柱 */}
              <path d="M16 20 L16 70" stroke="var(--qshell-c-h)" strokeWidth="7.5" strokeLinecap="round" />
              {/* 右侧跨步小腿 */}
              <path d="M16 46 C16 32, 46 32, 46 48 L46 70" stroke="var(--qshell-c-h)" strokeWidth="7.5" strokeLinecap="round" />
              {/* 兔耳粉红耳窝与天线薄荷球 */}
              <ellipse cx="16" cy="28" rx="2.5" ry="6" fill="#f43f5e" opacity="0.6" />
              <circle cx="16" cy="11" r="5" fill="var(--qshell-c-h)" style={{ animation: 'qshell-antenna-pulse 1.2s infinite' }} />
              {/* h 宝小脸 */}
              <circle cx="31" cy="46" r="2.5" fill="var(--qshell-c-h)" />
              <path d="M29 52 Q31 55 33 52" stroke="var(--qshell-c-h)" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>
          </div>
          {displayShadow && (
            <div
              className={cn(styles.shadowH, 'rounded-full mt-1 origin-center')}
              style={{
                background: 'var(--qshell-ground-shadow)',
                animation: isStatic ? 'none' : 'qshell-shadow-bounce 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
                animationDelay: '0.18s',
              }}
            />
          )}
        </div>

        {/* 4. e 宝 (跳起时: 亮色娇艳草莓玫粉 / 暗色蜜桃草莓粉) */}
        <div className="flex flex-col items-center">
          <div
            className="relative origin-bottom"
            style={{
              ['--char-glow' as string]: 'var(--qshell-glow-e)',
              ['--tilt' as string]: '7deg',
              animation: isStatic ? 'none' : 'qshell-ultra-cute-jump 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
              animationDelay: '0.27s',
            }}
          >
            <svg className={cn(styles.e, 'overflow-visible')} viewBox="0 0 54 70" fill="none">
              <path
                d="M42 36 L12 36 C12 18, 42 16, 42 30 C42 50, 14 60, 12 46 C12 34, 30 34, 42 52"
                stroke="var(--qshell-c-e)"
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* 萌萌大笑红舌头 */}
              <path d="M22 36 Q27 45 32 36 Z" fill="#f43f5e" />
              {/* 开心笑眼 ( ^ ) */}
              <path d="M24 26 Q27 22 30 26" stroke="var(--qshell-c-e)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            </svg>
          </div>
          {displayShadow && (
            <div
              className={cn(styles.shadowH, 'rounded-full mt-1 origin-center')}
              style={{
                background: 'var(--qshell-ground-shadow)',
                animation: isStatic ? 'none' : 'qshell-shadow-bounce 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
                animationDelay: '0.27s',
              }}
            />
          )}
        </div>

        {/* 5. 双胞胎哥哥 l (跳起时: 亮色优雅香芋浓紫 / 暗色香芋梦幻紫) */}
        <div className="flex flex-col items-center">
          <div
            className="relative origin-bottom"
            style={{
              ['--char-glow' as string]: 'var(--qshell-glow-l1)',
              ['--tilt' as string]: '8deg',
              animation: isStatic ? 'none' : 'qshell-ultra-cute-jump 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
              animationDelay: '0.36s',
            }}
          >
            <svg className={cn(styles.l, 'overflow-visible')} viewBox="0 0 34 84" fill="none">
              <path d="M17 18 L17 66 Q17 72 25 72" stroke="var(--qshell-c-l1)" strokeWidth="7.5" strokeLinecap="round" />
              <circle cx="17" cy="36" r="2.5" fill="var(--qshell-c-l1)" />
              <ellipse cx="17" cy="42" rx="2" ry="1" fill="#f43f5e" opacity="0.6" />
              {/* 头顶呆毛 */}
              <path d="M17 14 Q23 8 20 5" stroke="var(--qshell-c-l1)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            </svg>
          </div>
          {displayShadow && (
            <div
              className={cn(styles.shadowH, 'rounded-full mt-1 origin-center')}
              style={{
                background: 'var(--qshell-ground-shadow)',
                animation: isStatic ? 'none' : 'qshell-shadow-bounce 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
                animationDelay: '0.36s',
              }}
            />
          )}
        </div>

        {/* 6. 双胞胎弟弟 l (跳起时: 亮色亮丽琥珀金橙 / 暗色闪亮柠檬金) */}
        <div className="flex flex-col items-center relative">
          {/* 两人击掌时空中冒出的心动小爱心 ♥ */}
          {!isStatic && (
            <div
              className="absolute -top-5 -left-2.5 pointer-events-none text-rose-400 font-bold text-xs select-none"
              style={{
                animation: 'qshell-sparkle-float 1.2s infinite',
                animationDelay: '0.42s',
              }}
            >
              ♥
            </div>
          )}

          <div
            className="relative origin-bottom"
            style={{
              ['--char-glow' as string]: 'var(--qshell-glow-l2)',
              ['--tilt' as string]: '-8deg',
              animation: isStatic ? 'none' : 'qshell-ultra-cute-jump 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
              animationDelay: '0.45s',
            }}
          >
            <svg className={cn(styles.l, 'overflow-visible')} viewBox="0 0 34 84" fill="none">
              <path d="M17 18 L17 66 Q17 72 25 72" stroke="var(--qshell-c-l2)" strokeWidth="7.5" strokeLinecap="round" />
              {/* 俏皮眨眼 ( > ) */}
              <path d="M14 34 L18 36 L14 38" stroke="var(--qshell-c-l2)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              <ellipse cx="17" cy="42" rx="2" ry="1" fill="#f43f5e" opacity="0.6" />
              {/* 头顶小萌芽 */}
              <path d="M17 14 Q11 8 14 5" stroke="var(--qshell-c-l2)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            </svg>
          </div>
          {displayShadow && (
            <div
              className={cn(styles.shadowH, 'rounded-full mt-1 origin-center')}
              style={{
                background: 'var(--qshell-ground-shadow)',
                animation: isStatic ? 'none' : 'qshell-shadow-bounce 1.2s cubic-bezier(0.34, 1.56, 0.64, 1) infinite',
                animationDelay: '0.45s',
              }}
            />
          )}
        </div>
      </div>

      {text && (
        <div className={cn("text-xs text-muted-foreground font-medium text-center tracking-normal", !isStatic && "animate-pulse")}>
          {text}
        </div>
      )}
    </div>
  )
})
