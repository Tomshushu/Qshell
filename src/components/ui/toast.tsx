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

let activeToastInstance: ToastContextValue['toast'] | null = null

export function setActiveToast(instance: ToastContextValue['toast'] | null) {
  activeToastInstance = instance
}

export const toast = {
  success: (m: string, d?: number) => {
    if (activeToastInstance) activeToastInstance.success(m, d)
    else console.log('[toast.success]', m)
  },
  error: (m: string, d?: number) => {
    if (activeToastInstance) activeToastInstance.error(m, d)
    else console.error('[toast.error]', m)
  },
  info: (m: string, d?: number) => {
    if (activeToastInstance) activeToastInstance.info(m, d)
    else console.info('[toast.info]', m)
  },
  warning: (m: string, d?: number) => {
    if (activeToastInstance) activeToastInstance.warning(m, d)
    else console.warn('[toast.warning]', m)
  },
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // 兜底：在 provider 外使用时不崩溃，使用全局实例或 console
    return {
      toast,
    }
  }
  return ctx
}
