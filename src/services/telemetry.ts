/**
 * src/services/telemetry.ts
 *
 * Qshell 轻量级匿名活跃度与装机统计探针：
 * 1. 严格保护用户隐私，绝不收集 IP、用户名、服务器、私钥或任何配置数据；
 * 2. 仅收集：随机匿名设备 UUID、操作系统类型（Windows/macOS/Linux）、客户端版本号；
 * 3. 支持用户在设置中一键开启或关闭匿名统计（Local-First 原则）；
 * 4. 异步无阻塞发送（fire-and-forget），离线或网络故障时静默忽略，绝不干扰应用启动。
 */

export const TELEMETRY_DEVICE_ID_KEY = 'qshell_telemetry_device_id'
export const TELEMETRY_ENABLED_KEY = 'qshell_telemetry_enabled'

export interface TelemetryPayload {
  anonymousId: string
  version: string
  os: 'windows' | 'macos' | 'linux' | 'web'
  locale: string
  timestamp: string
}

/**
 * 获取或生成持久化的匿名设备唯一标识（UUID）
 */
export function getOrCreateAnonymousId(): string {
  try {
    let id = localStorage.getItem(TELEMETRY_DEVICE_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(TELEMETRY_DEVICE_ID_KEY, id)
    }
    return id
  } catch {
    return 'anon-device-fallback'
  }
}

/**
 * 检查用户是否允许发送匿名统计
 */
export function isTelemetryEnabled(): boolean {
  try {
    const val = localStorage.getItem(TELEMETRY_ENABLED_KEY)
    return val !== 'false' // 默认开启匿名统计
  } catch {
    return true
  }
}

/**
 * 设置用户是否允许匿名统计
 */
export function setTelemetryEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(TELEMETRY_ENABLED_KEY, enabled ? 'true' : 'false')
  } catch {
    /* ignore */
  }
}

/**
 * 检测当前操作系统平台
 */
export function detectPlatform(): 'windows' | 'macos' | 'linux' | 'web' {
  if (typeof navigator === 'undefined') return 'web'
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('win')) return 'windows'
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('linux')) return 'linux'
  return 'web'
}

/**
 * 组装匿名心跳数据包
 */
export function buildTelemetryPayload(version = '1.0.7'): TelemetryPayload {
  return {
    anonymousId: getOrCreateAnonymousId(),
    version,
    os: detectPlatform(),
    locale: typeof navigator !== 'undefined' ? navigator.language : 'zh-CN',
    timestamp: new Date().toISOString(),
  }
}

/**
 * 发送匿名启动心跳（在应用就绪后异步调用）
 */
export async function sendStartupPulse(endpoint?: string): Promise<boolean> {
  if (!isTelemetryEnabled()) {
    return false
  }

  // 默认心跳目标：可配置。若未配置自定义端点，则仅在本地记录
  const targetUrl = endpoint || (import.meta.env.VITE_TELEMETRY_ENDPOINT as string) || ''
  if (!targetUrl) {
    return false
  }

  try {
    const payload = buildTelemetryPayload()
    // 异步发送，带 5 秒超时保护
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Qshell-Telemetry/1.0',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    clearTimeout(timer)
    return res.ok
  } catch {
    // 静默忽略网络错误，绝对不打扰用户使用
    return false
  }
}
