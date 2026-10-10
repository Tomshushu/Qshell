import { createClient, type SupabaseClient, type User, type Session } from '@supabase/supabase-js'

export const CUSTOM_SUPABASE_URL_KEY = 'qshell_custom_supabase_url'
export const CUSTOM_SUPABASE_ANON_KEY = 'qshell_custom_supabase_anon_key'

export interface SupabaseConfigInfo {
  url: string
  anonKey: string
  isCustom: boolean
  isConfigured: boolean
}

let cachedClient: SupabaseClient | null = null
let currentClientKey = ''

/**
 * 规范化 Supabase 基础 URL：
 * 去除末尾斜杠，并自动剥离用户误粘的 API 子路径（如 /rest/v1、/auth/v1 等）
 */
export function normalizeSupabaseUrl(url: string): string {
  let u = url.trim()
  if (!u) return ''
  u = u.replace(/\/+$/, '')
  u = u.replace(/\/(rest|auth)\/v1\/?$/i, '')
  u = u.replace(/\/+$/, '')
  return u
}

/**
 * 获取当前生效的 Supabase 配置信息（优先使用用户自定义配置，其次使用环境变量注入）
 */
export function getSupabaseConfig(): SupabaseConfigInfo {
  let customUrl = ''
  let customKey = ''
  try {
    customUrl = localStorage.getItem(CUSTOM_SUPABASE_URL_KEY)?.trim() || ''
    customKey = localStorage.getItem(CUSTOM_SUPABASE_ANON_KEY)?.trim() || ''
  } catch {
    /* ignore localStorage errors */
  }

  const envUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim()
  const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

  const rawUrl = customUrl || envUrl
  const url = normalizeSupabaseUrl(rawUrl)
  const anonKey = customKey || envKey
  const isCustom = Boolean(customUrl && customKey)
  const isConfigured = Boolean(url && anonKey)

  return {
    url,
    anonKey,
    isCustom,
    isConfigured,
  }
}

/**
 * 获取当前 Supabase Client 实例（若未配置则返回 null）
 */
export function getSupabaseClient(): SupabaseClient | null {
  const config = getSupabaseConfig()
  if (!config.isConfigured) {
    cachedClient = null
    currentClientKey = ''
    return null
  }

  const clientKey = `${config.url}::${config.anonKey}`
  if (cachedClient && currentClientKey === clientKey) {
    return cachedClient
  }

  try {
    // 基础合法性校验
    new URL(config.url)
    cachedClient = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'qshell_supabase_auth_token',
      },
    })
    currentClientKey = clientKey
    return cachedClient
  } catch (err) {
    console.error('[Supabase] Failed to initialize client:', err)
    cachedClient = null
    currentClientKey = ''
    return null
  }
}

/**
 * 设置并保存用户自定义的 Supabase 配置
 */
export function setCustomSupabaseConfig(url: string, anonKey: string): void {
  try {
    localStorage.setItem(CUSTOM_SUPABASE_URL_KEY, normalizeSupabaseUrl(url))
    localStorage.setItem(CUSTOM_SUPABASE_ANON_KEY, anonKey.trim())
    // 切换后端实例时主动清空旧实例的 Session 缓存，避免跨后端 JWT 签名冲突
    localStorage.removeItem('qshell_supabase_auth_token')
  } catch (err) {
    console.error('[Supabase] Failed to write custom config to localStorage:', err)
  }
  cachedClient = null
  currentClientKey = ''
}

/**
 * 清除用户自定义的 Supabase 配置（恢复默认环境变量）
 */
export function resetCustomSupabaseConfig(): void {
  try {
    localStorage.removeItem(CUSTOM_SUPABASE_URL_KEY)
    localStorage.removeItem(CUSTOM_SUPABASE_ANON_KEY)
    // 恢复默认配置时清空旧自定义实例的 Session 缓存
    localStorage.removeItem('qshell_supabase_auth_token')
  } catch {
    /* ignore */
  }
  cachedClient = null
  currentClientKey = ''
}

/**
 * 测试指定的 Supabase 实例配置是否连通有效
 */
export async function testSupabaseConnection(
  url: string,
  anonKey: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const trimmedUrl = normalizeSupabaseUrl(url)
    const trimmedKey = anonKey.trim()
    if (!trimmedUrl || !trimmedKey) {
      return { success: false, error: 'URL 或 API Key 不能为空' }
    }
    new URL(trimmedUrl)

    const tempClient = createClient(trimmedUrl, trimmedKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    // 请求 Auth 服务健康状态或会话状态
    const { error } = await tempClient.auth.getSession()
    if (error) {
      return { success: false, error: formatAuthError(error) }
    }
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: formatAuthError(err),
    }
  }
}

/**
 * 将 Supabase Auth 返回的英文错误信息转换为友好的中文化错误提示
 */
export function formatAuthError(err: unknown): string {
  if (!err) return '未知认证错误'
  const message =
    typeof err === 'string'
      ? err
      : (err as { message?: string })?.message || String(err)
  const lower = message.toLowerCase()

  if (lower.includes('invalid login credentials')) {
    return '邮箱或密码不正确，请重新输入'
  }
  if (lower.includes('email not confirmed')) {
    return '该邮箱尚未完成验证，请查收邮件完成激活，或使用验证码登录'
  }
  if (lower.includes('user already registered')) {
    return '该邮箱已被注册，请直接登录或找回密码'
  }
  if (lower.includes('password should be at least')) {
    return '密码长度不能少于 6 位'
  }
  if (lower.includes('signup requires a valid password')) {
    return '请设置有效的密码（至少 6 个字符）'
  }
  if (lower.includes('token has expired') || lower.includes('otp expired')) {
    return '验证码已过期，请重新获取'
  }
  if (lower.includes('invalid token') || lower.includes('token is invalid')) {
    return '验证码不正确，请仔细核对后重新输入'
  }
  if (lower.includes('email link is invalid or has expired')) {
    return '登录链接已失效或过期，请重新申请'
  }
  if (lower.includes('error sending') || lower.includes('smtp')) {
    return '邮件发送服务暂时不可用，请稍后再试或检查 Supabase 邮件设置'
  }
  if (
    lower.includes('rate limit') ||
    lower.includes('over_email_send_rate_limit') ||
    lower.includes('only request this once every')
  ) {
    return '请求过于频繁，请稍候 60 秒后再试'
  }
  if (lower.includes('user not found')) {
    return '未找到该邮箱对应的账号，请先注册'
  }
  if (lower.includes('signups not allowed')) {
    return '当前服务暂未开放新用户注册'
  }
  if (lower.includes('network') || lower.includes('failed to fetch')) {
    return '网络连接失败，请检查网络或 Supabase 服务的可用性'
  }
  if (lower.includes('unable to validate email address')) {
    return '邮箱格式不正确，请输入有效的邮箱地址'
  }

  return message
}

export type { User, Session }

