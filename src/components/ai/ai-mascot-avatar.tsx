/**
 * src/components/ai/ai-mascot-avatar.tsx
 *
 * Qshell 全局 AI 助手吉祥物 Mascot 矢量组件 —— Q-Bitz (终端机灵鬼)
 * 1. 独创 Q-Bitz 形象：复古微弧面 OLED 终端屏幕、灵动像素眼、发光天线与优雅赛博猫尾巴
 * 2. 鼠标接近注视跟踪 (Gaze Tracking)：鼠标在 240px 内靠近时双眼精准凝视指针，超出距离平滑弹回居中
 * 3. 完整情绪系统：idle (待机点阵眼与光标)、happy (开心笑眼 ^ ^)、thinking (思考脉冲三核)、blink (自然眨眼)、error (红叉报错)
 * 4. 4.5 秒生命周期自动眨眼系统与优雅摆尾动画
 * 5. 全场景明暗主题与终端环境动态适配：
 *    - 暗色主题高对比度：采用高亮金属钛合金外壳 (#475569 ~ #242f40) + 3D 棱面高光边线 (#94a3b8 / #64748b) + 霓虹轮廓光，彻底解决深色背景融入问题
 *    - 明亮主题极客陶瓷白：高亮陶瓷白金属外壳 (#ffffff ~ #e2e8f0) + 深邃黑曜石 OLED 护目屏，黑白对比极度鲜明
 *    - 终端专属颜色适配：动态提取当前终端主题的青色/高亮色注入眼球、尾巴与天线核心
 */

import { useEffect, useState, useId, useRef, useCallback, useMemo } from 'react'
import type { AIMascotMood } from '@/types/ai'
import { cn } from '@/lib/utils'

export interface AIMascotAvatarProps {
  /** 尺寸像素大小，默认 48 */
  size?: number
  /** 当前表情或状态 */
  mood?: AIMascotMood
  /** 明暗主题模式：'dark' | 'light' | 'auto'，默认根据当前应用/终端环境自适应 */
  themeMode?: 'dark' | 'light' | 'auto'
  /** 是否强制浅色模式 (陶瓷白高亮机身) */
  isLight?: boolean
  /** 终端定制主色调 (眼睛、尾巴能量珠、天线能量核心)，为空时使用标准 Qshell 赛博青色 #38bdf8 */
  terminalAccentColor?: string
  /** 是否渲染外部暗黑赛博玻璃圆盘底座 */
  showGlowRing?: boolean
  /** 鼠标悬浮时是否自动触发 happy 开心笑眼与眼神追踪 */
  interactive?: boolean
  /** 自定义类名 */
  className?: string
  /** 点击回调 */
  onClick?: () => void
}

const ACTIVE_GAZE_RADIUS = 240 // 鼠标注视有效感应半径 (px)
const MAX_EYE_OFFSET = 5.5 // 眼球在视窗内的最大位移半径 (px)

export function AIMascotAvatar({
  size = 48,
  mood = 'idle',
  themeMode = 'auto',
  isLight,
  terminalAccentColor,
  showGlowRing = false,
  interactive = true,
  className,
  onClick,
}: AIMascotAvatarProps) {
  const [internalMood, setInternalMood] = useState<AIMascotMood>(mood)
  const [isHovered, setIsHovered] = useState(false)
  const [eyeOffset, setEyeOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const uniqueId = useId().replace(/:/g, '_')

  // 计算最终是否为浅色模式
  const isLightEffective = useMemo(() => {
    if (typeof isLight === 'boolean') return isLight
    if (themeMode === 'light') return true
    if (themeMode === 'dark') return false
    if (typeof document !== 'undefined') {
      return document.documentElement.classList.contains('light') && !document.documentElement.classList.contains('dark')
    }
    return false
  }, [isLight, themeMode])

  // 动态高光主色调（优先取终端主题青色/高亮色，默认 Qshell 赛博青色 #38bdf8）
  const cyanColor = terminalAccentColor || '#38bdf8'

  // 同步外部传入的 mood
  useEffect(() => {
    setInternalMood(mood)
  }, [mood])

  // 待机状态下，每隔 4.5 秒自动自然眨眼 180ms，赋予鲜活生命体感
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

  // 鼠标靠近注视跟踪算法 (Gaze Tracking)
  const handleWindowMouseMove = useCallback((e: MouseEvent) => {
    if (!interactive || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2

    const dx = e.clientX - centerX
    const dy = e.clientY - centerY
    const dist = Math.hypot(dx, dy)

    if (dist < ACTIVE_GAZE_RADIUS) {
      // 位于感应半径内：平滑解算瞳孔矢量偏角与位移
      const angle = Math.atan2(dy, dx)
      const ratio = dist / ACTIVE_GAZE_RADIUS
      const displacement = Math.min(MAX_EYE_OFFSET, ratio * MAX_EYE_OFFSET * 1.3)
      setEyeOffset({
        x: Math.round(Math.cos(angle) * displacement * 10) / 10,
        y: Math.round(Math.sin(angle) * displacement * 10) / 10,
      })
    } else {
      // 超出感应距离：自动平滑复位归中 (0, 0)
      setEyeOffset((prev) => (prev.x === 0 && prev.y === 0 ? prev : { x: 0, y: 0 }))
    }
  }, [interactive])

  useEffect(() => {
    if (!interactive) return
    window.addEventListener('mousemove', handleWindowMouseMove, { passive: true })
    return () => window.removeEventListener('mousemove', handleWindowMouseMove)
  }, [interactive, handleWindowMouseMove])

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
      setEyeOffset({ x: 0, y: 0 })
    }
  }

  const activeMood = isHovered && mood === 'idle' ? 'happy' : internalMood

  // 专属渐变与滤镜 ID
  const glowFilterId = `cyan-glow-${uniqueId}`
  const ambientGlowGradId = `ambient-glow-${uniqueId}`
  const cyberDiscGradId = `cyber-disc-grad-${uniqueId}`
  const headGradId = `head-grad-${uniqueId}`
  const bodyGradId = `body-grad-${uniqueId}`

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative select-none shrink-0 transition-transform duration-300 ease-out',
        interactive && 'cursor-pointer hover:scale-105 active:scale-95',
        className,
      )}
      style={{ width: size, height: size }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
    >
      <svg
        viewBox="0 0 130 130"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full overflow-visible"
      >
        <defs>
          <style>{`
            @keyframes qbitzTailSway {
              0%, 100% { transform: rotate(-6deg); }
              50% { transform: rotate(12deg); }
            }
            @keyframes qbitzCursorBlink {
              0%, 49% { opacity: 1; }
              50%, 100% { opacity: 0; }
            }
            .qbitz-tail-anim {
              transform-origin: 78px 96px;
              animation: qbitzTailSway 2.6s ease-in-out infinite;
            }
            .qbitz-cursor-anim {
              animation: qbitzCursorBlink 1.1s infinite;
            }
          `}</style>

          {/* 青色高亮辉光滤镜 */}
          <filter id={glowFilterId} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* 外部暗黑赛博玻璃微底座渐变 */}
          <linearGradient id={cyberDiscGradId} x1="15" y1="15" x2="115" y2="115" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0f172a" stopOpacity="0.95" />
            <stop offset="60%" stopColor="#0b0f19" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#050811" stopOpacity="0.98" />
          </linearGradient>

          {/* CRT 监视器外壳金属质感渐变（高对比度优化：暗色模式采用高辨识度钛合金 #475569 ~ #242f40，明亮模式采用珠光陶瓷白 #ffffff ~ #e2e8f0） */}
          <linearGradient id={headGradId} x1="22" y1="36" x2="98" y2="96" gradientUnits="userSpaceOnUse">
            {isLightEffective ? (
              <>
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="60%" stopColor="#f1f5f9" />
                <stop offset="100%" stopColor="#e2e8f0" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#475569" />
                <stop offset="55%" stopColor="#334155" />
                <stop offset="100%" stopColor="#242f40" />
              </>
            )}
          </linearGradient>

          {/* 下部基座渐变 */}
          <linearGradient id={bodyGradId} x1="36" y1="88" x2="84" y2="108" gradientUnits="userSpaceOnUse">
            {isLightEffective ? (
              <>
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="100%" stopColor="#cbd5e1" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#3b485d" />
                <stop offset="100%" stopColor="#1e293b" />
              </>
            )}
          </linearGradient>

          {/* 辐射型柔和环境光晕渐变（纯光效无边界向外渐散，赋予小人鲜明亮光存在感） */}
          <radialGradient id={ambientGlowGradId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={cyanColor} stopOpacity={isLightEffective ? "0.38" : "0.58"} />
            <stop offset="45%" stopColor={cyanColor} stopOpacity={isLightEffective ? "0.18" : "0.26"} />
            <stop offset="100%" stopColor={cyanColor} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* 0. 柔和向外辐射的环境粒子亮光（纯光晕向外淡出，100% 透明无硬边界，令小人在深色或浅色背景上极度醒目耀眼） */}
        <circle
          cx="60"
          cy="66"
          r="54"
          fill={`url(#${ambientGlowGradId})`}
          className="pointer-events-none"
        />

        {/* 1. 可选的暗黑赛博玻璃微底盘（默认不渲染） */}
        {showGlowRing && (
          <g>
            <circle
              cx="65"
              cy="65"
              r="61"
              fill={`url(#${cyberDiscGradId})`}
              stroke={cyanColor}
              strokeWidth="1.2"
              strokeOpacity="0.25"
              className="transition-all duration-300"
            />
            <circle
              cx="65"
              cy="65"
              r="58"
              fill="none"
              stroke="#0284c7"
              strokeWidth="0.8"
              strokeOpacity="0.15"
            />
          </g>
        )}

        {/* 2. 优雅赛博猫尾巴 (Style 1: 舒展向上微翘、能量芯线、末端发光能量球) */}
        <g className="qbitz-tail-anim">
          {/* 尾巴机身接口固定底座 */}
          <rect
            x="74"
            y="92"
            width="8"
            height="6"
            rx="2"
            fill={isLightEffective ? '#e2e8f0' : '#475569'}
            stroke={isLightEffective ? '#94a3b8' : '#64748b'}
            strokeWidth="1"
          />
          {/* 优雅舒展向上微翘主曲线 */}
          <path
            d="M 78 96 C 92 102, 108 106, 110 94 C 112 82, 100 76, 106 62"
            stroke={cyanColor}
            strokeWidth="4.5"
            strokeLinecap="round"
            fill="none"
          />
          {/* 内部高亮能量流光芯线 */}
          <path
            d="M 78 96 C 92 102, 108 106, 110 94 C 112 82, 100 76, 106 62"
            stroke="#e0f2fe"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
            opacity="0.9"
          />
          {/* 尖端高亮能量宝珠 */}
          <circle cx="106" cy="62" r="5" fill={cyanColor} filter={`url(#${glowFilterId})`} />
          <circle cx="106" cy="62" r="2" fill="#ffffff" />
        </g>

        {/* 3. 机体下部基座与悬浮动力核心 */}
        <g>
          <rect
            x="36"
            y="88"
            width="48"
            height="20"
            rx="10"
            fill={`url(#${bodyGradId})`}
            stroke={isLightEffective ? '#94a3b8' : '#64748b'}
            strokeWidth="1.8"
          />
          {/* 悬浮动力核心 */}
          <circle cx="60" cy="98" r="4.5" fill={cyanColor} className="animate-pulse" />
          <circle cx="60" cy="98" r="2" fill="#ffffff" />
        </g>

        {/* 4. 顶部天线 */}
        <g>
          <path
            d="M 60 38 L 60 26"
            stroke={isLightEffective ? '#64748b' : '#94a3b8'}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="60" cy="24" r="5" fill={cyanColor} filter={`url(#${glowFilterId})`} />
          <circle cx="60" cy="24" r="2" fill="#ffffff" />
        </g>

        {/* 5. 饱满圆润的 CRT 显示器机头主体 */}
        <g className={cn(
          'transition-transform duration-300 origin-center',
          activeMood === 'happy' && 'scale-105 -translate-y-0.5',
        )}>
          {/* 显示器外部合金外壳 */}
          <rect
            x="22"
            y="36"
            width="76"
            height="60"
            rx="18"
            fill={`url(#${headGradId})`}
            stroke={isLightEffective ? '#94a3b8' : '#64748b'}
            strokeWidth="2.5"
          />

          {/* 3D 棱面高光倒角线 (赋予机身立体感与与暗色背景的极佳分界) */}
          <path
            d="M 36 38.5 L 84 38.5"
            stroke={isLightEffective ? '#ffffff' : '#94a3b8'}
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity={isLightEffective ? 1 : 0.85}
          />
          {!isLightEffective && (
            <>
              <path d="M 23.5 52 L 23.5 76" stroke="#64748b" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
              <path d="M 96.5 52 L 96.5 76" stroke="#64748b" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
            </>
          )}

          {/* 赛博外轮廓微光 (在极深色终端背景中清晰勾勒机壳剪影) */}
          <rect
            x="22"
            y="36"
            width="76"
            height="60"
            rx="18"
            fill="none"
            stroke={cyanColor}
            strokeWidth="1"
            strokeOpacity={isLightEffective ? 0.35 : 0.28}
          />

          {/* 显示器内圈黑曜石 OLED 屏幕 */}
          <rect
            x="28"
            y="42"
            width="64"
            height="48"
            rx="12"
            fill={isLightEffective ? '#0a0f1d' : '#030712'}
            stroke={isLightEffective ? '#334155' : '#1e293b'}
            strokeWidth="1.6"
          />

          {/* 屏幕左上角微光终端提示符 >_ */}
          <text
            x="32"
            y="54"
            fontSize="7"
            fill={cyanColor}
            fontFamily="monospace"
            fontWeight="bold"
            opacity="0.85"
          >
            &gt;_
          </text>

          {/* 6. 灵动大眼睛与注视跟踪组 (由 handleWindowMouseMove 驱动 translate 偏移) */}
          <g
            style={{
              transform: `translate(${eyeOffset.x}px, ${eyeOffset.y}px)`,
              transition: 'transform 0.16s cubic-bezier(0.25, 1, 0.5, 1)',
            }}
          >
            {/* A. 待机/常规状态 (idle)：大号弧面胶囊像素眼与高光光斑 */}
            {activeMood === 'idle' && (
              <g filter={`url(#${glowFilterId})`}>
                {/* 左眼 */}
                <rect x="40" y="56" width="12" height="16" rx="6" fill={cyanColor} />
                <circle cx="43" cy="60" r="2.2" fill="#ffffff" />
                {/* 右眼 */}
                <rect x="68" y="56" width="12" height="16" rx="6" fill={cyanColor} />
                <circle cx="71" cy="60" r="2.2" fill="#ffffff" />
              </g>
            )}

            {/* B. 开心笑眼 (happy)：俏皮弯弯笑眼 ^ ^ */}
            {activeMood === 'happy' && (
              <g filter={`url(#${glowFilterId})`}>
                <path d="M 38 64 Q 46 54 54 64" stroke="#10b981" strokeWidth="3.2" strokeLinecap="round" fill="none" />
                <path d="M 66 64 Q 74 54 82 64" stroke="#10b981" strokeWidth="3.2" strokeLinecap="round" fill="none" />
              </g>
            )}

            {/* C. 思考状态 (thinking)：呼吸三核波 */}
            {activeMood === 'thinking' && (
              <g filter={`url(#${glowFilterId})`}>
                <circle cx="45" cy="64" r="3.6" fill={cyanColor} className="animate-pulse" />
                <circle cx="60" cy="64" r="4.2" fill={cyanColor} className="animate-pulse delay-100" />
                <circle cx="75" cy="64" r="3.6" fill={cyanColor} className="animate-pulse delay-200" />
              </g>
            )}

            {/* D. 自然眨眼 (blink)：极细闭眼横线 */}
            {activeMood === 'blink' && (
              <g filter={`url(#${glowFilterId})`}>
                <line x1="39" y1="64" x2="53" y2="64" stroke={cyanColor} strokeWidth="2.8" strokeLinecap="round" />
                <line x1="67" y1="64" x2="81" y2="64" stroke={cyanColor} strokeWidth="2.8" strokeLinecap="round" />
              </g>
            )}

            {/* E. 错误报警状态 (error)：红叉双眼 */}
            {activeMood === 'error' && (
              <g filter={`url(#${glowFilterId})`}>
                <text x="39" y="70" fontSize="16" fill="#f43f5e" fontWeight="bold">✕</text>
                <text x="67" y="70" fontSize="16" fill="#f43f5e" fontWeight="bold">✕</text>
              </g>
            )}

            {/* F. 输入指令状态 (typing)：命令行尖括号 */}
            {activeMood === 'typing' && (
              <g filter={`url(#${glowFilterId})`}>
                <text x="40" y="69" fontSize="13" fill={cyanColor} fontFamily="monospace" fontWeight="bold">&gt;</text>
                <text x="68" y="69" fontSize="13" fill={cyanColor} fontFamily="monospace" fontWeight="bold">_</text>
              </g>
            )}
          </g>

          {/* 7. 嘴部闪烁命令行光标 */}
          <rect
            x="54"
            y="78"
            width="12"
            height="2"
            rx="1"
            fill={cyanColor}
            className="qbitz-cursor-anim"
          />
        </g>
      </svg>
    </div>
  )
}
