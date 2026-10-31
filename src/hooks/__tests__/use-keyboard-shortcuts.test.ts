import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useKeyboardShortcuts } from '../use-keyboard-shortcuts'
import { useAppStore } from '@/store'
import { useShortcutStore } from '@/store/shortcut-store'

describe('useKeyboardShortcuts', () => {
  const isMac = /Mac/i.test(navigator.userAgent)

  beforeEach(() => {
    cleanup()
    useShortcutStore.getState().resetAll()
    useAppStore.setState({
      tabs: [
        { id: 'tab-1', serverId: 'srv-1', serverName: 'Server 1', module: 'terminal', title: 'Term 1' },
        { id: 'tab-2', serverId: 'srv-2', serverName: 'Server 2', module: 'files', title: 'SFTP 2' },
        { id: 'tab-3', serverId: 'srv-3', serverName: 'Server 3', module: 'terminal', title: 'Term 3' },
      ],
      activeTabId: 'tab-1',
      isAppLocked: false,
      appLockEnabled: false,
      appLockPasswordHash: '',
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('triggers lockApp when app lock is configured and Mod+Alt+L is pressed', () => {
    const lockAppSpy = vi.fn()
    useAppStore.setState({
      appLockEnabled: true,
      appLockPasswordHash: 'some_hash',
      lockApp: lockAppSpy,
    })

    renderHook(() => useKeyboardShortcuts())

    const event = new KeyboardEvent('keydown', {
      key: 'l',
      ctrlKey: !isMac,
      metaKey: isMac,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(event)

    expect(lockAppSpy).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('dispatches open-app-lock-setup when app lock is not configured', () => {
    const setupListener = vi.fn()
    window.addEventListener('open-app-lock-setup', setupListener)

    renderHook(() => useKeyboardShortcuts())

    const event = new KeyboardEvent('keydown', {
      key: 'l',
      ctrlKey: !isMac,
      metaKey: isMac,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(event)

    expect(setupListener).toHaveBeenCalledTimes(1)
    window.removeEventListener('open-app-lock-setup', setupListener)
  })

  it('opens a new terminal tab on Mod+T for the current server', () => {
    const openTabSpy = vi.fn()
    useAppStore.setState({ openTab: openTabSpy })

    renderHook(() => useKeyboardShortcuts())

    const event = new KeyboardEvent('keydown', {
      key: 't',
      ctrlKey: !isMac,
      metaKey: isMac,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(event)

    expect(openTabSpy).toHaveBeenCalledWith('srv-1', 'Server 1', 'terminal')
    expect(event.defaultPrevented).toBe(true)
  })

  it('dispatches qshell:request-close-tab on Mod+W', () => {
    const closeListener = vi.fn()
    window.addEventListener('qshell:request-close-tab', closeListener)

    renderHook(() => useKeyboardShortcuts())

    const event = new KeyboardEvent('keydown', {
      key: 'w',
      ctrlKey: !isMac,
      metaKey: isMac,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(event)

    expect(closeListener).toHaveBeenCalledTimes(1)
    const customEvent = closeListener.mock.calls[0][0] as CustomEvent
    expect(customEvent.detail).toBe('tab-1')

    window.removeEventListener('qshell:request-close-tab', closeListener)
  })

  it('switches to next and previous tabs with wrap-around', () => {
    const setActiveTabSpy = vi.fn()
    useAppStore.setState({ setActiveTab: setActiveTabSpy })

    renderHook(() => useKeyboardShortcuts())

    // Next tab: Ctrl+Tab
    const nextEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      ctrlKey: true,
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(nextEvent)
    expect(setActiveTabSpy).toHaveBeenCalledWith('tab-2')

    // Prev tab from tab-1 wraps to tab-3: Ctrl+Shift+Tab
    const prevEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(prevEvent)
    expect(setActiveTabSpy).toHaveBeenCalledWith('tab-3')
  })

  it('suppresses all shortcuts when isAppLocked is true', () => {
    const openTabSpy = vi.fn()
    useAppStore.setState({
      isAppLocked: true,
      openTab: openTabSpy,
    })

    renderHook(() => useKeyboardShortcuts())

    const event = new KeyboardEvent('keydown', {
      key: 't',
      ctrlKey: !isMac,
      metaKey: isMac,
      bubbles: true,
    })
    window.dispatchEvent(event)

    expect(openTabSpy).not.toHaveBeenCalled()
  })
})
