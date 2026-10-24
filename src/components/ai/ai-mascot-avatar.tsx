/**
 * src/components/ai/ai-mascot-avatar.tsx
 *
 * Qshell 全局 AI 助手吉祥物 Mascot 矢量矢量组件
 * 1. 严格像素级复刻参考图中的蓝白科技感小机器人造型
 * 2. 支持多种灵动表情与微动状态：idle（待机扫光）、happy（开心笑眼 ^ ^）、thinking（思考呼吸）、blink（自然眨眼）
 * 3. 内置 4.5 秒生命周期自动眨眼系统与悬浮呼吸微动
 */

import { useEffect, useState, useId } from 'react'
import type { AIMascotMood } from '@/types/ai'
import { cn } from '@/lib/utils'

export interface AIMascotAvatarProps {
  /** 尺寸像素大小，默认 48 */
  size?: number
  /** 当前表情或状态 */
  mood?: AIMascotMood
  /** 是否渲染外部蓝青色渐变圆盘底座（悬浮按钮时为 true，消息气泡或独立头像时为 false） */
  showGlowRing?: boolean
  /** 鼠标悬浮时是否自动触发 happy 开心笑眼 */
  interactive?: boolean
  /** 自定义类名 */
  className?: string
  /** 点击回调 */
  onClick?: () => void
}

export function AIMascotAvatar({
  size = 48,
  mood = 'idle',
  showGlowRing = true,
  interactive = true,
  className,
  onClick,
}: AIMascotAvatarProps) {
  const [internalMood, setInternalMood] = useState<AIMascotMood>(mood)
  const [isHovered, setIsHovered] = useState(false)
  const uniqueId = useId().replace(/:/g, '_')

  // 同步外部传入的 mood
  useEffect(() => {
    setInternalMood(mood)
  }, [mood])

  // 待机状态下，每隔 4.5 秒自动自然眨眼 180ms，赋予生命体感
  useEffect(() => {
    if (mood !== 'idle' || isHovered) return

    const timer = setInterval(() => {
      setInternalMood('blink')
      setTimeout(() => {
        setInternalMood((curr) => (curr === 'blink' ? 'idle' : curr))
      }, 180)
    }, 4500)

    return () => clearInterval(timer)
  }, [mood, isHovered])

  // 鼠标悬停交互
  const handleMouseEnter = () => {
    if (interactive && mood === 'idle') {
      setIsHovered(true)
      setInternalMood('happy')
    }
  }

  const handleMouseLeave = () => {
    if (interactive && isHovered) {
      setIsHovered(false)
      setInternalMood(mood)
    }
  }

  const activeMood = isHovered && mood === 'idle' ? 'happy' : internalMood

  const glowFilterId = `cyan-glow-${uniqueId}`
  const ringGradId = `ring-grad-${uniqueId}`
  const headGradId = `head-grad-${uniqueId}`
  const visorGradId = `visor-grad-${uniqueId}`
  const glassReflectId = `glass-grad-${uniqueId}`
  const bodyGradId = `body-grad-${uniqueId}`

  return (
    <div
      className={cn(
        'relative select-none shrink-0 rounded-full transition-transform duration-300 ease-out',
        interactive && 'cursor-pointer hover:scale-105 active:scale-95',
        className,
      )}
      style={{ width: size, height: size }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full overflow-visible drop-shadow-md"
      >
        <defs>
          {/* 青色发光荧光滤镜 */}
          <filter id={glowFilterId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* 外圈科技蓝圆环渐变底座 */}
          <linearGradient id={ringGradId} x1="10" y1="10" x2="90" y2="90" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0052d9" />
            <stop offset="55%" stopColor="#0080ff" />
            <stop offset="100%" stopColor="#00d5ff" />
          </linearGradient>

          {/* 头部圆润白色高光渐变 */}
          <linearGradient id={headGradId} x1="50" y1="18" x2="50" y2="72" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="65%" stopColor="#f0f5ff" />
            <stop offset="100%" stopColor="#dce8fa" />
          </linearGradient>

          {/* 深邃太空黑/夜幕护目镜渐变 */}
          <linearGradient id={visorGradId} x1="50" y1="30" x2="50" y2="65" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#070e24" />
            <stop offset="100%" stopColor="#0f1f45" />
          </linearGradient>

          {/* 护目镜上部玻璃高光反光 */}
          <linearGradient id={glassReflectId} x1="50" y1="32" x2="50" y2="44" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.0" />
          </linearGradient>

          {/* 身体机甲渐变 */}
          <linearGradient id={bodyGradId} x1="50" y1="70" x2="50" y2="95" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#d5e3f7" />
          </linearGradient>
        </defs>

        {/* 1. 可选的圆形渐变底盘（在悬浮按钮形态中生效） */}
        {showGlowRing && (
          <circle
            cx="50"
            cy="50"
            r="48"
            fill={`url(#${ringGradId})`}
            className="transition-all duration-300"
          />
        )}

        {/* 2. 机器人身体躯干与能量核心 */}
        <g className="transition-transform duration-300">
          {/* 颈部连接处 */}
          <rect x="44" y="68" width="12" height="7" rx="3.5" fill="#c3d7f2" />

          {/* 身体/胸甲 */}
          <path
            d="M32 76 C32 71, 68 71, 68 76 C72 84, 69 94, 66 96 C56 98, 44 98, 34 96 C31 94, 28 84, 32 76 Z"
            fill={`url(#${bodyGradId})`}
          />

          {/* 胸口发光能量核心 */}
          <ellipse
            cx="50"
            cy="84"
            rx="6.5"
            ry="4.5"
            fill="#0066ff"
            className="animate-pulse"
          />
          <ellipse
            cx="50"
            cy="84"
            rx="4"
            ry="2.5"
            fill="#00f0ff"
            filter={`url(#${glowFilterId})`}
          />
        </g>

        {/* 3. 头部头盔主体 (带有浮动微动) */}
        <g className={cn(
          'transition-transform duration-300 origin-center',
          activeMood === 'happy' && 'scale-105 -translate-y-0.5',
        )}>
          {/* 左侧耳机 */}
          <ellipse cx="23" cy="48" rx="5" ry="9" fill="#ffffff" />
          <ellipse cx="23" cy="48" rx="2.8" ry="6" fill="#0088ff" />
          <ellipse cx="23" cy="48" rx="1.6" ry="3.5" fill="#00f0ff" filter={`url(#${glowFilterId})`} />

          {/* 右侧耳机 */}
          <ellipse cx="77" cy="48" rx="5" ry="9" fill="#ffffff" />
          <ellipse cx="77" cy="48" rx="2.8" ry="6" fill="#0088ff" />
          <ellipse cx="77" cy="48" rx="1.6" ry="3.5" fill="#00f0ff" filter={`url(#${glowFilterId})`} />

          {/* 头部圆滑机体 */}
          <rect
            x="24"
            y="22"
            width="52"
            height="50"
            rx="25"
            fill={`url(#${headGradId})`}
          />
          {/* 头部顶部弧形高光 */}
          <path
            d="M34 26 C42 24, 58 24, 66 26 C68 28, 64 30, 50 30 C36 30, 32 28, 34 26 Z"
            fill="#ffffff"
            opacity="0.8"
          />

          {/* 4. 护目镜面罩 (Visor) */}
          <rect
            x="28"
            y="32"
            width="44"
            height="32"
            rx="16"
            fill={`url(#${visorGradId})`}
            stroke="#1d3d82"
            strokeWidth="1.2"
          />
          {/* 护目镜内侧微发光轮廓 */}
          <rect
            x="29.5"
            y="33.5"
            width="41"
            height="29"
            rx="14.5"
            fill="none"
            stroke="#00d5ff"
            strokeWidth="0.8"
            strokeOpacity="0.4"
          />
          {/* 护目镜反光玻璃面 */}
          <path
            d="M31 43 C31 36, 40 33, 50 33 C60 33, 69 36, 69 43 C64 38, 56 36, 50 36 C44 36, 36 38, 31 43 Z"
            fill={`url(#${glassReflectId})`}
          />

          {/* 5. 动态眼睛与表情 */}
          <g filter={`url(#${glowFilterId})`}>
            {/* A. 待机/常规状态 (idle)：经典青色胶囊发光大眼 (与原图 100% 对齐) */}
            {activeMood === 'idle' && (
              <rect
                x="37"
                y="43.5"
                width="26"
                height="9"
                rx="4.5"
                fill="#00f5ff"
                className="transition-all duration-200"
              />
            )}

            {/* B. 开心笑眼 (happy)：俏皮弯月笑眼 ^ ^ */}
            {activeMood === 'happy' && (
              <g className="transition-all duration-200">
                <path
                  d="M36 49 Q42 41 48 49"
                  stroke="#00f5ff"
                  strokeWidth="3.4"
                  strokeLinecap="round"
                  fill="none"
                />
                <path
                  d="M52 49 Q58 41 64 49"
                  stroke="#00f5ff"
                  strokeWidth="3.4"
                  strokeLinecap="round"
                  fill="none"
                />
              </g>
            )}

            {/* C. 思考状态 (thinking)：流动的发光呼吸三核波 */}
            {activeMood === 'thinking' && (
              <g className="transition-all duration-200">
                <circle cx="39" cy="48" r="3.4" fill="#00f5ff" className="animate-pulse" />
                <circle cx="50" cy="48" r="3.8" fill="#38bdf8" className="animate-pulse delay-100" />
                <circle cx="61" cy="48" r="3.4" fill="#00f5ff" className="animate-pulse delay-200" />
              </g>
            )}

            {/* D. 自然眨眼 (blink)：180ms 极细横线 */}
            {activeMood === 'blink' && (
              <g className="transition-all duration-150">
                <line
                  x1="38"
                  y1="48"
                  x2="62"
                  y2="48"
                  stroke="#00f5ff"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
              </g>
            )}
          </g>
        </g>
      </svg>
    </div>
  )
}
