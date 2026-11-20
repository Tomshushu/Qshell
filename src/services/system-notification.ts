/**
 * 系统原生通知（P1-10）
 *
 * 仅在应用窗口不可见/未聚焦时发送，窗口在前台时由应用内 Toast 承担提示，
 * 避免重复打扰。权限被拒绝、无桌面环境或非 Tauri 运行时均静默降级。
 */
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { isTauri } from '@/services/api'

let permissionCache: boolean | null = null

async function ensurePermission(): Promise<boolean> {
  if (!isTauri) return false
  if (permissionCache !== null) return permissionCache
  try {
    let granted = await isPermissionGranted()
    if (!granted) granted = (await requestPermission()) === 'granted'
    permissionCache = granted
    return granted
  } catch {
    permissionCache = false
    return false
  }
}

/** 窗口是否在前台（前台时不需要系统通知） */
function isWindowForeground(): boolean {
  if (typeof document === 'undefined') return false
  return document.visibilityState === 'visible' && document.hasFocus()
}

/**
 * 发送系统通知。用户关闭了「系统通知」开关、窗口在前台、
 * 或系统权限不可用时直接返回，不抛错。
 */
export async function notifySystem(title: string, body: string): Promise<void> {
  if (!isTauri) return
  // 懒加载 store，避免与 transfer-queue-store 形成模块循环依赖
  const { useAppStore } = await import('@/store')
  if (!useAppStore.getState().systemNotificationsEnabled) return
  if (isWindowForeground()) return
  if (!(await ensurePermission())) return
  try {
    sendNotification({ title, body })
  } catch {
    // 系统通知不可用（无通知服务/被策略禁用）时静默降级
  }
}

/** 重置权限缓存（用户重新打开开关时调用，允许重新申请权限） */
export function resetNotificationPermissionCache(): void {
  permissionCache = null
}
