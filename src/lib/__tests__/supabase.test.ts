import { describe, it, expect, beforeEach } from 'vitest'
import {
  getSupabaseConfig,
  setCustomSupabaseConfig,
  resetCustomSupabaseConfig,
  testSupabaseConnection,
  normalizeSupabaseUrl,
  formatAuthError,
  CUSTOM_SUPABASE_URL_KEY,
  CUSTOM_SUPABASE_ANON_KEY,
} from '@/lib/supabase'

describe('Supabase Client Configuration & Security', () => {
  beforeEach(() => {
    localStorage.clear()
    resetCustomSupabaseConfig()
  })

  it('reads default unconfigured state when no env or localStorage config is present', () => {
    const config = getSupabaseConfig()
    // 当没有自定义配置且无环境变量时，isConfigured 为 false 或仅取决于 env
    expect(config.isCustom).toBe(false)
  })

  it('allows saving and resetting custom Supabase self-hosted config', () => {
    setCustomSupabaseConfig('https://my-self-hosted.supabase.co', 'my-custom-anon-key')

    expect(localStorage.getItem(CUSTOM_SUPABASE_URL_KEY)).toBe('https://my-self-hosted.supabase.co')
    expect(localStorage.getItem(CUSTOM_SUPABASE_ANON_KEY)).toBe('my-custom-anon-key')

    const config = getSupabaseConfig()
    expect(config.isCustom).toBe(true)
    expect(config.url).toBe('https://my-self-hosted.supabase.co')
    expect(config.anonKey).toBe('my-custom-anon-key')
    expect(config.isConfigured).toBe(true)

    // 重置自定义配置
    resetCustomSupabaseConfig()
    expect(localStorage.getItem(CUSTOM_SUPABASE_URL_KEY)).toBeNull()
    const resetConfig = getSupabaseConfig()
    expect(resetConfig.isCustom).toBe(false)
  })

  it('fails test connection gracefully on invalid URL', async () => {
    const res = await testSupabaseConnection('not-a-valid-url', 'key123')
    expect(res.success).toBe(false)
    expect(res.error).toBeDefined()
  })

  it('fails test connection when URL or key is empty', async () => {
    const res = await testSupabaseConnection('', '')
    expect(res.success).toBe(false)
  })

  it('normalizes Supabase project URL by stripping rest/v1, auth/v1, and trailing slashes', () => {
    expect(normalizeSupabaseUrl('https://example.supabase.co/rest/v1/')).toBe('https://example.supabase.co')
    expect(normalizeSupabaseUrl('https://example.supabase.co/rest/v1')).toBe('https://example.supabase.co')
    expect(normalizeSupabaseUrl('https://example.supabase.co/auth/v1/')).toBe('https://example.supabase.co')
    expect(normalizeSupabaseUrl('https://example.supabase.co///')).toBe('https://example.supabase.co')
    expect(normalizeSupabaseUrl('  https://example.supabase.co/  ')).toBe('https://example.supabase.co')
  })

  it('formats raw Supabase auth error messages into user-friendly Chinese', () => {
    expect(formatAuthError('Invalid login credentials')).toBe('邮箱或密码不正确，请重新输入')
    expect(formatAuthError('Email not confirmed')).toBe('该邮箱尚未完成验证，请查收邮件完成激活，或使用验证码登录')
    expect(formatAuthError('User already registered')).toBe('该邮箱已被注册，请直接登录或找回密码')
    expect(formatAuthError('Password should be at least 6 characters')).toBe('密码长度不能少于 6 位')
    expect(formatAuthError('Token has expired or is invalid')).toBe('验证码已过期，请重新获取')
    expect(formatAuthError(new Error('Rate limit exceeded'))).toBe('请求过于频繁，请稍候 60 秒后再试')
    expect(formatAuthError('Custom error message')).toBe('Custom error message')
  })
})

