import { describe, it, expect, beforeEach } from 'vitest'
import { useShortcutStore } from '../shortcut-store'

describe('useShortcutStore', () => {
  beforeEach(() => {
    useShortcutStore.getState().resetAll()
  })

  it('retrieves definition for a valid action', () => {
    const def = useShortcutStore.getState().getDefinition('tab.new')
    expect(def).toBeDefined()
    expect(def?.id).toBe('tab.new')
    expect(def?.scope).toBe('global')

    const invalid = useShortcutStore.getState().getDefinition('non.existent.action')
    expect(invalid).toBeUndefined()
  })

  it('retrieves default binding when no custom binding exists', () => {
    const binding = useShortcutStore.getState().getBinding('tab.new')
    expect(binding).toBe('Mod+T')
  })

  it('formats display keys for an action', () => {
    const keys = useShortcutStore.getState().getDisplayKeys('tab.new')
    expect(keys.length).toBeGreaterThan(0)
    expect(keys[keys.length - 1]).toBe('T')
  })

  it('detects shortcut conflict with another action', () => {
    // tab.new is Mod+T by default
    const conflict = useShortcutStore.getState().findConflict('tab.close', 'Mod+T')
    expect(conflict).toBeDefined()
    expect(conflict?.id).toBe('tab.new')

    // No conflict when checking the action against its own shortcut
    const selfConflict = useShortcutStore.getState().findConflict('tab.new', 'Mod+T')
    expect(selfConflict).toBeUndefined()

    // No conflict for an unused shortcut
    const noConflict = useShortcutStore.getState().findConflict('tab.close', 'Ctrl+Shift+Alt+F12')
    expect(noConflict).toBeUndefined()
  })

  it('sets binding and auto-clears conflicting action', () => {
    // tab.close tries to take Mod+T (which is tab.new)
    const result = useShortcutStore.getState().setBinding('tab.close', 'Mod+T')
    expect(result.success).toBe(true)
    expect(result.conflictActionId).toBe('tab.new')

    expect(useShortcutStore.getState().getBinding('tab.close')).toBe('Mod+T')
    expect(useShortcutStore.getState().getBinding('tab.new')).toBe('')
  })

  it('clears and resets individual binding', () => {
    useShortcutStore.getState().setBinding('tab.new', 'Ctrl+Shift+N')
    expect(useShortcutStore.getState().getBinding('tab.new')).toBe('Ctrl+Shift+N')

    useShortcutStore.getState().clearBinding('tab.new')
    expect(useShortcutStore.getState().getBinding('tab.new')).toBe('')

    useShortcutStore.getState().resetBinding('tab.new')
    expect(useShortcutStore.getState().getBinding('tab.new')).toBe('Mod+T')
  })

  it('resets all custom bindings at once', () => {
    useShortcutStore.getState().setBinding('tab.new', 'Ctrl+N')
    useShortcutStore.getState().setBinding('tab.close', 'Ctrl+Q')

    expect(useShortcutStore.getState().getBinding('tab.new')).toBe('Ctrl+N')
    expect(useShortcutStore.getState().getBinding('tab.close')).toBe('Ctrl+Q')

    useShortcutStore.getState().resetAll()
    expect(useShortcutStore.getState().getBinding('tab.new')).toBe('Mod+T')
    expect(useShortcutStore.getState().getBinding('tab.close')).toBe('Mod+W')
  })

  it('matches keyboard event to action', () => {
    const isMac = /Mac/i.test(navigator.userAgent)
    const event = new KeyboardEvent('keydown', {
      key: 't',
      ctrlKey: !isMac,
      metaKey: isMac,
      bubbles: true,
    })

    expect(useShortcutStore.getState().matchesAction(event, 'tab.new')).toBe(true)
    expect(useShortcutStore.getState().matchesAction(event, 'tab.close')).toBe(false)
  })

  it('identifies whether an event is a global action', () => {
    const isMac = /Mac/i.test(navigator.userAgent)
    const tabNewEvent = new KeyboardEvent('keydown', {
      key: 't',
      ctrlKey: !isMac,
      metaKey: isMac,
      bubbles: true,
    })

    expect(useShortcutStore.getState().isGlobalAction(tabNewEvent)).toBe(true)

    const randomEvent = new KeyboardEvent('keydown', {
      key: 'j',
      bubbles: true,
    })
    expect(useShortcutStore.getState().isGlobalAction(randomEvent)).toBe(false)
  })
})
