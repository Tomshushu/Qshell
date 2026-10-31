import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAppStore } from './index'
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from './constants'

// Mock sound playing to avoid DOM Audio errors in test
vi.mock('@/lib/sound', () => ({
  playSound: vi.fn(),
  setSoundEnabled: vi.fn(),
  SoundType: {
    Toggle: 'toggle',
    Complete: 'complete',
  },
}))

function state() {
  return useAppStore.getState()
}

describe('ui-slice', () => {
  beforeEach(() => {
    useAppStore.setState({
      theme: 'system',
      uiStyle: 'ubuntu',
      customCursorEnabled: true,
      language: 'zh-CN',
      uiSoundEnabled: false,
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      appLockEnabled: false,
      appLockType: 'password',
      appLockPasswordHash: null,
      appLockIdleMinutes: 0,
      appLockOnStartup: false,
      isAppLocked: false,
    })
  })

  describe('theme toggling', () => {
    it('cycles theme through system -> light -> dark -> system', () => {
      expect(state().theme).toBe('system')

      state().toggleTheme()
      expect(state().theme).toBe('light')

      state().toggleTheme()
      expect(state().theme).toBe('dark')

      state().toggleTheme()
      expect(state().theme).toBe('system')
    })

    it('sets theme directly', () => {
      state().setTheme('dark')
      expect(state().theme).toBe('dark')
    })
  })

  describe('sidebar width clamp', () => {
    it('clamps sidebar width within min and max boundaries', () => {
      state().setSidebarWidth(50)
      expect(state().sidebarWidth).toBe(SIDEBAR_WIDTH_MIN)

      state().setSidebarWidth(1000)
      expect(state().sidebarWidth).toBe(SIDEBAR_WIDTH_MAX)

      state().setSidebarWidth(250.4)
      expect(state().sidebarWidth).toBe(250)
    })
  })

  describe('app lock state machine', () => {
    it('does not lock if password hash is not set', () => {
      expect(state().appLockPasswordHash).toBeNull()
      state().lockApp()
      expect(state().isAppLocked).toBe(false)
    })

    it('locks when password hash is configured', () => {
      state().setAppLock(true, 'sha256-hash-value', 'password')
      expect(state().appLockPasswordHash).toBe('sha256-hash-value')

      state().lockApp()
      expect(state().isAppLocked).toBe(true)

      state().unlockApp()
      expect(state().isAppLocked).toBe(false)
    })

    it('clamps idle minutes to at least 0', () => {
      state().setAppLockIdleMinutes(-5)
      expect(state().appLockIdleMinutes).toBe(0)

      state().setAppLockIdleMinutes(15)
      expect(state().appLockIdleMinutes).toBe(15)
    })
  })

  describe('sound settings', () => {
    it('updates ui sound setting', () => {
      state().setUiSoundEnabled(true)
      expect(state().uiSoundEnabled).toBe(true)

      state().setUiSoundEnabled(false)
      expect(state().uiSoundEnabled).toBe(false)
    })
  })
})
