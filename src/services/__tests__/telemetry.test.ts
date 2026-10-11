import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getOrCreateAnonymousId,
  isTelemetryEnabled,
  setTelemetryEnabled,
  buildTelemetryPayload,
  sendStartupPulse,
  TELEMETRY_DEVICE_ID_KEY,
  TELEMETRY_ENABLED_KEY,
} from '../telemetry'

describe('Anonymous Telemetry Service', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('generates and persists unique anonymous device ID', () => {
    const id1 = getOrCreateAnonymousId()
    expect(id1).toBeTruthy()
    expect(localStorage.getItem(TELEMETRY_DEVICE_ID_KEY)).toBe(id1)

    const id2 = getOrCreateAnonymousId()
    expect(id2).toBe(id1)
  })

  it('allows user to toggle telemetry on and off', () => {
    expect(isTelemetryEnabled()).toBe(true) // default enabled
    setTelemetryEnabled(false)
    expect(isTelemetryEnabled()).toBe(false)
    expect(localStorage.getItem(TELEMETRY_ENABLED_KEY)).toBe('false')

    setTelemetryEnabled(true)
    expect(isTelemetryEnabled()).toBe(true)
  })

  it('builds non-sensitive telemetry payload', () => {
    const payload = buildTelemetryPayload('1.0.5')
    expect(payload.version).toBe('1.0.5')
    expect(payload.anonymousId).toBeTruthy()
    expect(['windows', 'macos', 'linux', 'web']).toContain(payload.os)
    expect(payload.timestamp).toBeTruthy()
  })

  it('safely handles network offline or missing endpoint without throwing', async () => {
    const res = await sendStartupPulse('')
    expect(res).toBe(false)
  })
})
