import { createContext, useContext } from 'react'

export interface ToastContextValue {
  toast: {
    success: (message: string, duration?: number) => void
    error: (message: string, duration?: number) => void
    info: (message: string, duration?: number) => void
    warning: (message: string, duration?: number) => void
  }
}

export interface ToastItem {
  id: number
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  duration: number
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // 兜底：在 provider 外使用时不崩溃，仅 console
    return {
      toast: {
        success: (m: string) => console.log('[toast.success]', m),
        error: (m: string) => console.error('[toast.error]', m),
        info: (m: string) => console.info('[toast.info]', m),
        warning: (m: string) => console.warn('[toast.warning]', m),
      },
    }
  }
  return ctx
}
