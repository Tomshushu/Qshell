import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react'
import { playSound, SoundType } from '@/lib/sound'
import { friendlyError } from '@/lib/error-messages'
import { ToastContext, type ToastContextValue, type ToastItem } from './toast'

type ToastType = 'success' | 'error' | 'info' | 'warning'

// toast 类型 → 音效映射：在 toast 出现时统一播放，调用方无需重复处理
const TOAST_SOUND_MAP: Record<ToastType, SoundType> = {
  success: SoundType.Success,
  error: SoundType.Error,
  info: SoundType.Notify,
  warning: SoundType.Warn,
}

// 相同类型+相同文案的 Toast 防抖与防重时间窗口（毫秒）
const TOAST_DEDUPE_WINDOW_MS = 1500

let toastIdCounter = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  // 维护活跃的 toast 去重映射：key = `${type}:${message}`
  const activeToastsRef = useRef<Map<string, { id: number; timestamp: number; timerId?: number }>>(new Map())

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    for (const [key, record] of activeToastsRef.current.entries()) {
      if (record.id === id) {
        if (record.timerId) window.clearTimeout(record.timerId)
        activeToastsRef.current.delete(key)
        break
      }
    }
  }, [])

  const push = useCallback((type: ToastType, rawMessage: string, duration = 4000) => {
    // 错误类 toast 友好化：命中已知模式时展示友好文案（技术排查走 console / ErrorDialog）
    const message = type === 'error' ? friendlyError(rawMessage).message : rawMessage
    if (type === 'error') console.error('[toast.error]', rawMessage)

    const dedupeKey = `${type}:${message}`
    const now = Date.now()
    const existing = activeToastsRef.current.get(dedupeKey)

    // 全局防抖去重：如果 1.5 秒内收到完全相同的消息，直接重置其销毁定时器并忽略重复弹窗与音效
    if (existing && now - existing.timestamp < TOAST_DEDUPE_WINDOW_MS) {
      if (existing.timerId) {
        window.clearTimeout(existing.timerId)
      }
      if (duration > 0) {
        existing.timerId = window.setTimeout(() => remove(existing.id), duration)
      }
      existing.timestamp = now
      return
    }

    const id = ++toastIdCounter
    setToasts(prev => [...prev, { id, type, message, duration }])
    // toast 出现时统一播放对应音效（受全局开关控制）
    playSound(TOAST_SOUND_MAP[type])

    const timerId = duration > 0 ? window.setTimeout(() => remove(id), duration) : undefined
    activeToastsRef.current.set(dedupeKey, { id, timestamp: now, timerId })
  }, [remove])

  const toast: ToastContextValue['toast'] = {
    success: (m: string, d?: number) => push('success', m, d ?? 4000),
    error: (m: string, d?: number) => push('error', m, d ?? 6000),
    info: (m: string, d?: number) => push('info', m, d ?? 4000),
    warning: (m: string, d?: number) => push('warning', m, d ?? 5000),
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* 提示通知容器：下移至终端与主内容区域顶部高度（避开顶部 TabBar 36px 与 ModuleTabs 32px 导航栏，与终端内容区对齐） */}
      <div className="fixed top-[76px] right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <ToastCard key={t.id} item={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const r = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(r)
  }, [])

  const config = {
    success: { icon: CheckCircle2, bar: 'bg-emerald-500', iconColor: 'text-emerald-500' },
    error: { icon: XCircle, bar: 'bg-red-500', iconColor: 'text-red-500' },
    info: { icon: Info, bar: 'bg-blue-500', iconColor: 'text-blue-500' },
    warning: { icon: AlertTriangle, bar: 'bg-amber-500', iconColor: 'text-amber-500' },
  }[item.type]
  const Icon = config.icon

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2.5 min-w-[min(280px,calc(100vw-2rem))] max-w-[min(420px,calc(100vw-2rem))] rounded-xl bg-popover/95 border border-border/60 shadow-xl backdrop-blur-sm overflow-hidden transition-all duration-200 ${
        visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'
      }`}
    >
      <div className={`w-1 self-stretch ${config.bar}`} />
      <Icon className={`h-4.5 w-4.5 shrink-0 mt-3 ${config.iconColor}`} />
      <p className="flex-1 text-xs text-popover-foreground leading-relaxed py-3 pr-1 break-words whitespace-pre-wrap">
        {item.message}
      </p>
      <button
        onClick={onClose}
        className="shrink-0 p-1.5 mt-2 mr-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
        aria-label="close"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
