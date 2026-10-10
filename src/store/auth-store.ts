import { create } from 'zustand'
import {
  getSupabaseClient,
  getSupabaseConfig,
  setCustomSupabaseConfig,
  resetCustomSupabaseConfig,
  formatAuthError,
  type User,
  type Session,
} from '@/lib/supabase'
import { isTauri } from '@/services/api'

export interface AuthState {
  user: User | null
  session: Session | null
  isLoading: boolean
  isConfigured: boolean
  isCustomConfig: boolean
  supabaseUrl: string
  isAuthDialogOpen: boolean

  // 方法
  init: () => Promise<void>
  openAuthDialog: () => void
  closeAuthDialog: () => void
  signInWithPassword: (email: string, password: string) => Promise<{ error?: string }>
  signUpWithPassword: (email: string, password: string) => Promise<{ error?: string; needConfirm?: boolean }>
  signInWithOtp: (email: string) => Promise<{ error?: string }>
  verifyOtp: (email: string, token: string, type?: 'email' | 'signup' | 'magiclink' | 'recovery') => Promise<{ error?: string }>
  resetPasswordForEmail: (email: string) => Promise<{ error?: string }>
  resendVerificationEmail: (email: string) => Promise<{ error?: string }>
  signInWithGitHub: () => Promise<{ error?: string; url?: string }>
  setSessionFromToken: (tokenPayload: string) => Promise<{ error?: string }>
  updatePassword: (newPassword: string) => Promise<{ error?: string }>
  signOut: () => Promise<{ error?: string }>
  updateCustomConfig: (url: string, anonKey: string) => Promise<{ success: boolean; error?: string }>
  resetToDefaultConfig: () => void
}

let authSubscriptionInitialized = false

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  isLoading: true,
  isConfigured: false,
  isCustomConfig: false,
  supabaseUrl: '',
  isAuthDialogOpen: false,

  openAuthDialog: () => set({ isAuthDialogOpen: true }),
  closeAuthDialog: () => set({ isAuthDialogOpen: false }),

  init: async () => {
    const config = getSupabaseConfig()
    set({
      isConfigured: config.isConfigured,
      isCustomConfig: config.isCustom,
      supabaseUrl: config.url,
      isLoading: true,
    })

    const client = getSupabaseClient()
    if (!client) {
      set({ user: null, session: null, isLoading: false })
      return
    }

    try {
      const { data } = await client.auth.getSession()
      set({
        session: data.session,
        user: data.session?.user ?? null,
        isLoading: false,
      })

      if (!authSubscriptionInitialized) {
        authSubscriptionInitialized = true
        client.auth.onAuthStateChange((_event, session) => {
          set({
            session,
            user: session?.user ?? null,
            isLoading: false,
          })
        })
      }
    } catch (err) {
      console.error('[AuthStore] Failed to get session:', err)
      set({ user: null, session: null, isLoading: false })
    }
  },

  signInWithPassword: async (email, password) => {
    const client = getSupabaseClient()
    if (!client) {
      return { error: '未配置 Supabase 服务，请在设置中配置' }
    }
    set({ isLoading: true })
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) {
        set({ isLoading: false })
        return { error: formatAuthError(error) }
      }
      set({
        session: data.session,
        user: data.user,
        isLoading: false,
        isAuthDialogOpen: false,
      })
      return {}
    } catch (err) {
      set({ isLoading: false })
      return { error: formatAuthError(err) }
    }
  },

  signUpWithPassword: async (email, password) => {
    const client = getSupabaseClient()
    if (!client) {
      return { error: '未配置 Supabase 服务，请在设置中配置' }
    }
    set({ isLoading: true })
    try {
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
      })
      if (error) {
        set({ isLoading: false })
        return { error: formatAuthError(error) }
      }
      // 如果需要邮箱确认，此时可能没有直接生成 session
      const needConfirm = !data.session
      set({
        session: data.session,
        // 关键修复：未确认激活的账号不能设置为当前已登录用户，否则会导致界面错乱跳入已登录态
        user: data.session ? data.user : null,
        isLoading: false,
        // 若无需邮箱确认则直接关闭弹窗登录，若需确认则保持弹窗展示指引
        isAuthDialogOpen: !needConfirm ? false : get().isAuthDialogOpen,
      })
      return { needConfirm }
    } catch (err) {
      set({ isLoading: false })
      return { error: formatAuthError(err) }
    }
  },

  signInWithOtp: async (email) => {
    const client = getSupabaseClient()
    if (!client) {
      return { error: '未配置 Supabase 服务，请在设置中配置' }
    }
    set({ isLoading: true })
    try {
      const redirectUrl = isTauri ? undefined : window.location.origin
      const { error } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirectUrl,
          shouldCreateUser: true,
        },
      })
      set({ isLoading: false })
      if (error) {
        return { error: formatAuthError(error) }
      }
      return {}
    } catch (err) {
      set({ isLoading: false })
      return { error: formatAuthError(err) }
    }
  },

  verifyOtp: async (email, token, type = 'email') => {
    const client = getSupabaseClient()
    if (!client) {
      return { error: '未配置 Supabase 服务，请在设置中配置' }
    }
    set({ isLoading: true })
    try {
      const { data, error } = await client.auth.verifyOtp({
        email: email.trim(),
        token: token.trim(),
        type,
      })
      if (error) {
        set({ isLoading: false })
        return { error: formatAuthError(error) }
      }
      set({
        session: data.session,
        user: data.user,
        isLoading: false,
        isAuthDialogOpen: false,
      })
      return {}
    } catch (err) {
      set({ isLoading: false })
      return { error: formatAuthError(err) }
    }
  },

  resetPasswordForEmail: async (email) => {
    const client = getSupabaseClient()
    if (!client) {
      return { error: '未配置 Supabase 服务，请在设置中配置' }
    }
    set({ isLoading: true })
    try {
      const redirectUrl = isTauri ? undefined : `${window.location.origin}/#reset-password`
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: redirectUrl,
      })
      set({ isLoading: false })
      if (error) {
        return { error: formatAuthError(error) }
      }
      return {}
    } catch (err) {
      set({ isLoading: false })
      return { error: formatAuthError(err) }
    }
  },

  resendVerificationEmail: async (email) => {
    const client = getSupabaseClient()
    if (!client) {
      return { error: '未配置 Supabase 服务，请在设置中配置' }
    }
    set({ isLoading: true })
    try {
      const { error } = await client.auth.resend({
        type: 'signup',
        email: email.trim(),
      })
      set({ isLoading: false })
      if (error) {
        return { error: formatAuthError(error) }
      }
      return {}
    } catch (err) {
      set({ isLoading: false })
      return { error: formatAuthError(err) }
    }
  },

  signInWithGitHub: async () => {
    const client = getSupabaseClient()
    if (!client) {
      return { error: '未配置 Supabase 服务，请在设置中配置' }
    }
    set({ isLoading: true })
    try {
      const redirectUrl = isTauri ? 'http://127.0.0.1:45678/callback' : window.location.origin

      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: isTauri,
        },
      })
      set({ isLoading: false })
      if (error) {
        return { error: formatAuthError(error) }
      }

      if (data?.url) {
        if (isTauri) {
          try {
            const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
            const existing = await WebviewWindow.getByLabel('qshell-oauth')
            if (existing) {
              await existing.destroy()
            }
            const oauthWin = new WebviewWindow('qshell-oauth', {
              url: data.url,
              title: 'GitHub 账号授权登录',
              width: 520,
              height: 720,
              center: true,
              alwaysOnTop: true,
            })
            oauthWin.once('tauri://error', async () => {
              const { open } = await import('@tauri-apps/plugin-shell')
              await open(data.url)
            })
          } catch {
            const { open } = await import('@tauri-apps/plugin-shell')
            await open(data.url)
          }
        }
        return { url: data.url }
      }
      return {}
    } catch (err) {
      set({ isLoading: false })
      return { error: formatAuthError(err) }
    }
  },

  setSessionFromToken: async (tokenPayload: string) => {
    const client = getSupabaseClient()
    if (!client) {
      return { error: '未配置 Supabase 服务，请在设置中配置' }
    }
    set({ isLoading: true })
    try {
      let accessToken = ''
      let refreshToken = ''
      const trimmed = tokenPayload.trim()

      if (trimmed.startsWith('{')) {
        const parsed = JSON.parse(trimmed)
        accessToken = parsed.access_token || parsed.currentSession?.access_token || ''
        refreshToken = parsed.refresh_token || parsed.currentSession?.refresh_token || ''
        if (!accessToken && parsed.payload) {
          const payloadStr = String(parsed.payload)
          const hashOrQuery = payloadStr.includes('#') ? payloadStr.split('#')[1] : payloadStr.split('?')[1] || payloadStr
          const params = new URLSearchParams(hashOrQuery)
          accessToken = params.get('access_token') || ''
          refreshToken = params.get('refresh_token') || ''
        }
      } else if (trimmed.includes('access_token=')) {
        // 支持用户直接复制粘贴浏览器回调跳转的完整 URL (包含 hash 或 query 参数)
        const hashOrQuery = trimmed.includes('#') ? trimmed.split('#')[1] : trimmed.split('?')[1] || trimmed
        const params = new URLSearchParams(hashOrQuery)
        accessToken = params.get('access_token') || ''
        refreshToken = params.get('refresh_token') || ''
      } else {
        accessToken = trimmed
      }

      if (!accessToken) {
        set({ isLoading: false })
        return { error: '未检测到有效的访问令牌 (access_token)' }
      }

      const { data, error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      if (error) {
        set({ isLoading: false })
        return { error: formatAuthError(error) }
      }

      set({
        session: data.session,
        user: data.user,
        isLoading: false,
        isAuthDialogOpen: false,
      })
      return {}
    } catch (err) {
      set({ isLoading: false })
      return { error: formatAuthError(err) }
    }
  },

  updatePassword: async (newPassword: string) => {
    const client = getSupabaseClient()
    if (!client) {
      return { error: '未配置 Supabase 服务，请在设置中配置' }
    }
    set({ isLoading: true })
    try {
      const { error } = await client.auth.updateUser({
        password: newPassword.trim(),
      })
      set({ isLoading: false })
      if (error) {
        return { error: formatAuthError(error) }
      }
      return {}
    } catch (err) {
      set({ isLoading: false })
      return { error: formatAuthError(err) }
    }
  },

  signOut: async () => {
    const client = getSupabaseClient()
    if (!client) {
      set({ user: null, session: null })
      return {}
    }
    set({ isLoading: true })
    try {
      const { error } = await client.auth.signOut()
      set({ user: null, session: null, isLoading: false })
      if (error) {
        return { error: formatAuthError(error) }
      }
      return {}
    } catch (err) {
      set({ user: null, session: null, isLoading: false })
      return { error: formatAuthError(err) }
    }
  },

  updateCustomConfig: async (url, anonKey) => {
    setCustomSupabaseConfig(url, anonKey)
    await get().init()
    return { success: true }
  },

  resetToDefaultConfig: () => {
    resetCustomSupabaseConfig()
    void get().init()
  },
}))
