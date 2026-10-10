import { describe, expect, it } from 'vitest'
import { redactCommandForSession, serializeSessionEvent } from './session-recording'

describe('session recording', () => {
  it('redacts common inline secrets', () => {
    expect(redactCommandForSession('curl --token abc123 https://user:pass@example.com'))
      .toContain('--token ••••••')
    expect(redactCommandForSession('curl --token abc123 https://user:pass@example.com'))
      .not.toContain('abc123')
    expect(redactCommandForSession('curl --token abc123 https://user:pass@example.com'))
      .not.toContain(':pass@')
  })

  it('serializes versioned relative-time events', () => {
    const event = JSON.parse(serializeSessionEvent(Date.now() - 10, 'command_end', { exitCode: 0 }))
    expect(event.v).toBe(1)
    expect(event.type).toBe('command_end')
    expect(event.atMs).toBeGreaterThanOrEqual(0)
    expect(event.exitCode).toBe(0)
  })
})

