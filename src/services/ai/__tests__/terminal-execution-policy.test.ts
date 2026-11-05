import { describe, it, expect } from 'vitest'
import { shouldAutoRunTerminalCommand } from '../terminal-execution-policy'

describe('shouldAutoRunTerminalCommand', () => {
  it('only auto-runs in the auto_readonly and danger modes', () => {
    expect(shouldAutoRunTerminalCommand('auto_readonly', true)).toBe(true)
    expect(shouldAutoRunTerminalCommand('danger', true)).toBe(true)
    expect(shouldAutoRunTerminalCommand('ask', true)).toBe(false)
    expect(shouldAutoRunTerminalCommand('disabled', true)).toBe(false)
  })

  it('falls back to the default auto_readonly mode when unset', () => {
    expect(shouldAutoRunTerminalCommand(undefined, true)).toBe(true)
  })

  it('never auto-runs when the event only asks to fill the command', () => {
    expect(shouldAutoRunTerminalCommand('auto_readonly', false)).toBe(false)
    expect(shouldAutoRunTerminalCommand('disabled', false)).toBe(false)
  })
})
