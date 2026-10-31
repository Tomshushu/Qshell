import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAuthStore } from '../auth-store'

const mockAuth = {
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
}

vi.mock('@/lib/supabase', () => ({
  getSupabaseClient: vi.fn(() => ({
    auth: mockAuth,
  })),
  getSupabaseConfig: vi.fn(() => ({
    isConfigured: true,
    isCustom: false,
    url: 'https://test.supabase.co',
    anonKey: 'anon-key-test',
  })),
  setCustomSupabaseConfig: vi.fn(),
  resetCustomSupabaseConfig: vi.fn(),
  formatAuthError: vi.fn((err: any) => err.message || 'Auth error'),
}))

function state() {
  return useAuthStore.getState()
}

describe('auth-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({
      user: null,
      session: null,
      isLoading: false,
      isConfigured: false,
      isCustomConfig: false,
      supabaseUrl: '',
      isAuthDialogOpen: false,
    })
  })

  describe('dialog visibility', () => {
    it('opens and closes auth dialog', () => {
      expect(state().isAuthDialogOpen).toBe(false)
      state().openAuthDialog()
      expect(state().isAuthDialogOpen).toBe(true)
      state().closeAuthDialog()
      expect(state().isAuthDialogOpen).toBe(false)
    })
  })

  describe('init and session recovery', () => {
    it('initializes store from supabase client session', async () => {
      const mockSession = {
        user: { id: 'user-123', email: 'test@example.com' },
        access_token: 'token-abc',
      }
      mockAuth.getSession.mockResolvedValueOnce({ data: { session: mockSession }, error: null })

      await state().init()

      expect(state().isConfigured).toBe(true)
      expect(state().supabaseUrl).toBe('https://test.supabase.co')
      expect(state().user?.email).toBe('test@example.com')
      expect(state().session).toEqual(mockSession)
      expect(state().isLoading).toBe(false)
    })
  })

  describe('signInWithPassword', () => {
    it('signs in and sets session state on success', async () => {
      const mockSession = {
        user: { id: 'u1', email: 'hello@qshell.com' },
        access_token: 'tok-1',
      }
      mockAuth.signInWithPassword.mockResolvedValueOnce({
        data: { session: mockSession, user: mockSession.user },
        error: null,
      })

      const res = await state().signInWithPassword('hello@qshell.com', 'password123')
      expect(res.error).toBeUndefined()
      expect(state().user?.email).toBe('hello@qshell.com')
    })

    it('returns error message on failure', async () => {
      mockAuth.signInWithPassword.mockResolvedValueOnce({
        data: { session: null, user: null },
        error: new Error('Invalid login credentials'),
      })

      const res = await state().signInWithPassword('wrong@qshell.com', 'badpass')
      expect(res.error).toBeDefined()
    })
  })

  describe('signOut', () => {
    it('clears session and user on signOut', async () => {
      useAuthStore.setState({
        user: { id: 'u1' } as any,
        session: { access_token: 'tok' } as any,
      })
      mockAuth.signOut.mockResolvedValueOnce({ error: null })

      const res = await state().signOut()
      expect(res.error).toBeUndefined()
      expect(state().user).toBeNull()
      expect(state().session).toBeNull()
    })
  })
})
