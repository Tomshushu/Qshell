import { describe, it, expect, beforeEach } from 'vitest'
import { useAIStore, shouldAutoExecuteSuggestedCommand } from '../ai-store'

describe('danger mode manual switch', () => {
  beforeEach(() => {
    useAIStore.setState({
      settings: { ...useAIStore.getState().settings, executionMode: 'auto_readonly' },
      currentAssistantSessionId: null,
      dangerModeActive: false,
    })
  })

  it('auto-executes suggested commands only in auto_readonly and danger modes', () => {
    expect(shouldAutoExecuteSuggestedCommand('auto_readonly', true)).toBe(true)
    expect(shouldAutoExecuteSuggestedCommand('danger', true)).toBe(true)
    expect(shouldAutoExecuteSuggestedCommand('ask', true)).toBe(false)
    expect(shouldAutoExecuteSuggestedCommand('disabled', true)).toBe(false)
    expect(shouldAutoExecuteSuggestedCommand('danger', false)).toBe(false)
  })

  it('is off by default and activates only on an explicit request', () => {
    expect(useAIStore.getState().dangerModeActive).toBe(false)
    expect(useAIStore.getState().getEffectiveExecutionMode()).toBe('auto_readonly')
    useAIStore.getState().activateDangerMode()
    expect(useAIStore.getState().getEffectiveExecutionMode()).toBe('danger')
  })

  it('stays active when switching or creating assistant sessions', () => {
    useAIStore.setState({ currentAssistantSessionId: 'session-a' })
    useAIStore.getState().activateDangerMode()

    useAIStore.setState({ currentAssistantSessionId: 'session-b' })
    expect(useAIStore.getState().getEffectiveExecutionMode()).toBe('danger')

    useAIStore.getState().createNewAssistantSession()
    expect(useAIStore.getState().getEffectiveExecutionMode()).toBe('danger')
  })

  it('has no time-based expiry: the switch stays on until manually turned off', () => {
    useAIStore.getState().activateDangerMode()
    expect(useAIStore.getState().dangerModeActive).toBe(true)
    expect(useAIStore.getState().getEffectiveExecutionMode()).toBe('danger')
  })

  it('only falls back on an explicit deactivate', () => {
    useAIStore.getState().activateDangerMode()
    useAIStore.getState().deactivateDangerMode()
    expect(useAIStore.getState().getEffectiveExecutionMode()).toBe('auto_readonly')

    useAIStore.getState().activateDangerMode()
    useAIStore.getState().updateSettings({ executionMode: 'disabled' })
    useAIStore.getState().deactivateDangerMode()
    expect(useAIStore.getState().getEffectiveExecutionMode()).toBe('disabled')
  })

  it('does not write the elevation into persisted settings', () => {
    useAIStore.getState().activateDangerMode()
    expect(useAIStore.getState().settings.executionMode).toBe('auto_readonly')
  })
})
