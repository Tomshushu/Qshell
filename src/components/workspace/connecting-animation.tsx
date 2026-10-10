import { useState, useEffect, useRef } from 'react'
import { Terminal, Shield, Wifi, CheckCircle2, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import { ConnectionState } from '@/services/ssh-connection-state'

interface ConnectingAnimationProps {
  serverName?: string
  error?: string | null
  onRetry?: () => void
  state?: ConnectionState
}

// 连接阶段定义
const CONNECT_STEPS = [
  { icon: Wifi, labelKey: 'conn_step_tcp', duration: 800 },
  { icon: Shield, labelKey: 'conn_step_ssh', duration: 900 },
  { icon: Terminal, labelKey: 'conn_step_auth', duration: 1000 },
  { icon: CheckCircle2, labelKey: 'conn_step_session', duration: 700 },
]

export function ConnectingAnimation({ serverName, error, onRetry, state }: ConnectingAnimationProps) {
  const { t } = useTranslation()
  const [currentStep, setCurrentStep] = useState(0)
  const stepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 循环播放连接步骤（连接未完成时持续循环）
  useEffect(() => {
    if (error) return

    const step = CONNECT_STEPS[currentStep]
    stepTimerRef.current = setTimeout(() => {
      setCurrentStep((prev) => (prev + 1) % CONNECT_STEPS.length)
    }, step.duration)

    return () => {
      if (stepTimerRef.current) clearTimeout(stepTimerRef.current)
    }
  }, [currentStep, error])

  const stateStep = state === ConnectionState.Authenticating
    ? 2
    : state === ConnectionState.Ready
      ? 3
      : state === ConnectionState.Connecting
        ? 0
        : currentStep
  const CurrentIcon = error ? WifiOff : CONNECT_STEPS[stateStep].icon

  return (
    <div
      className="flex flex-col items-center justify-center h-full select-none"
      style={{ animation: 'connect-fade-in 0.4s ease-out' }}
    >
      {/* 中心动画区域 */}
      <div className="relative flex items-center justify-center mb-8" style={{ width: 140, height: 140 }}>
        {/* 雷达脉冲环（3 层错开） */}
        {!error && [0, 1, 2].map((i) => (
          <div
            key={i}
            className="absolute rounded-full border-2 border-primary"
            style={{
              width: 80,
              height: 80,
              animation: `connect-radar 2.4s ease-out ${i * 0.8}s infinite`,
            }}
          />
        ))}

        {/* 旋转渐变环 */}
        {!error && (
          <div
            className="absolute rounded-full"
            style={{
              width: 72,
              height: 72,
              background: 'conic-gradient(from 0deg, transparent 0deg, var(--color-primary) 90deg, transparent 180deg, var(--color-primary) 270deg, transparent 360deg)',
              maskImage: 'radial-gradient(circle, transparent 58%, black 60%)',
              WebkitMaskImage: 'radial-gradient(circle, transparent 58%, black 60%)',
              animation: 'connect-spin-gradient 1.5s linear infinite',
            }}
          />
        )}

        {/* 中心图标 */}
        <div
          className={cn(
            'relative flex items-center justify-center rounded-2xl transition-colors',
            error ? 'bg-destructive/15' : 'bg-primary/15'
          )}
          style={{
            width: 56,
            height: 56,
            animation: error ? undefined : 'connect-glow 2s ease-in-out infinite',
          }}
        >
          {error ? (
            <WifiOff className="h-7 w-7 text-destructive" />
          ) : (
            <Terminal className="h-7 w-7 text-primary" />
          )}
        </div>
      </div>

      {/* 服务器名称 */}
      {serverName && (
        <p className="text-base font-semibold mb-1 text-foreground">{serverName}</p>
      )}

      {/* 连接步骤 / 错误信息 */}
      {error ? (
        <div className="text-center">
          <p className="text-sm text-destructive mb-3 max-w-xs">{error}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-xs text-primary hover:text-primary/80 transition-colors underline underline-offset-2"
            >
              {t('conn_btn_retry')}
            </button>
          )}
        </div>
      ) : (
        <div className="h-6 flex items-center gap-2 overflow-hidden">
          <div
            key={stateStep}
            className="flex items-center gap-1.5 text-xs text-primary"
            style={{ animation: 'connect-slide-up 0.3s ease-out' }}
          >
            <CurrentIcon className="h-3.5 w-3.5 animate-pulse" />
            <span>{t(CONNECT_STEPS[stateStep].labelKey)}</span>
            <span
              className="inline-block w-1.5 h-3.5 bg-primary ml-0.5"
              style={{ animation: 'connect-cursor-blink 0.8s step-end infinite' }}
            />
          </div>
        </div>
      )}

      {/* 底部数据流可视化（非错误状态） */}
      {!error && (
        <div className="mt-6 relative" style={{ width: 200, height: 4 }}>
          {/* 连接线 */}
          <div className="absolute inset-0 rounded-full bg-border overflow-hidden">
            <div
              className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary/40 to-primary/0"
              style={{ animation: 'progress-indeterminate 1.8s ease-in-out infinite' }}
            />
          </div>
          {/* 数据包 */}
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary"
              style={{
                animation: `connect-packet 1.5s linear ${i * 0.5}s infinite`,
                boxShadow: '0 0 6px oklch(0.6 0.18 250)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
