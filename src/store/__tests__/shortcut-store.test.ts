import { describe, it, expect, beforeEach } from 'vitest'
import { useShortcutStore } from '../shortcut-store'

describe('shortcut-store', () => {
  beforeEach(() => {
    useShortcutStore.getState().resetAll()
  })

  it('provides default key bindings', () => {
    const store = useShortcutStore.getState()
    const binding = store.getBinding('tab.new')
    expect(binding).toBeTruthy()
    const displayKeys = store.getDisplayKeys('tab.new')
    expect(displayKeys.length).toBeGreaterThan(0)
  })

  it('allows setting custom binding and detects conflicts', () => {
    const store = useShortcutStore.getState()
    // Set tab.new to Ctrl+Shift+N
    const res1 = store.setBinding('tab.new', 'Ctrl+Shift+N')
    expect(res1.success).toBe(true)
    expect(res1.conflictActionId).toBeUndefined()
    expect(useShortcutStore.getState().getBinding('tab.new')).toBe('Ctrl+Shift+N')

    // Set tab.close to the same Ctrl+Shift+N -> should report conflict
    const res2 = store.setBinding('tab.close', 'Ctrl+Shift+N')
    expect(res2.success).toBe(true)
    expect(res2.conflictActionId).toBe('tab.new')
  })

  it('resets single and all bindings', () => {
    const store = useShortcutStore.getState()
    store.setBinding('tab.new', 'Ctrl+Alt+N')
    expect(useShortcutStore.getState().getBinding('tab.new')).toBe('Ctrl+Alt+N')

    store.resetBinding('tab.new')
    // Should revert to default
    expect(useShortcutStore.getState().getBinding('tab.new')).toBe('Mod+T')
  })

  it('isGlobalAction recognizes global shortcut events', () => {
    const store = useShortcutStore.getState()
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      metaKey: false,
    })
    // On Windows/Linux Mod+K matches Ctrl+K
    const isGlobal = store.isGlobalAction(event)
    expect(isGlobal).toBe(true)
  })
})
