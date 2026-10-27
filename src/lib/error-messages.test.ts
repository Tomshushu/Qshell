import { describe, expect, it } from 'vitest'
import { friendlyError, cleanTechnicalPrefixes } from './error-messages'

describe('error-messages friendly conversion', () => {
  it('cleans technical prefixes properly', () => {
    const raw = 'SSH connection failed: SSH connect to 172.29.1.13:22 failed: SSH error: Disconnected'
    expect(cleanTechnicalPrefixes(raw)).toBe('Disconnected')
  })

  it('converts Disconnected error to friendly message', () => {
    const raw = 'SSH connection failed: SSH connect to 172.29.1.13:22 failed: SSH error: Disconnected'
    const res = friendlyError(raw)
    expect(res.message).toContain('连接已断开')
    expect(res.detail).toBe(raw)
  })

  it('converts connection refused with os error', () => {
    const raw = 'SSH connection failed: connection refused (os error 10061)'
    const res = friendlyError(raw)
    expect(res.message).toContain('连接被拒绝')
    expect(res.detail).toBe(raw)
  })

  it('converts timeout with os error', () => {
    const raw = 'SSH connection failed: timed out (os error 10060)'
    const res = friendlyError(raw)
    expect(res.message).toContain('连接超时')
    expect(res.detail).toBe(raw)
  })

  it('converts authentication failed error', () => {
    const raw = 'SSH connection failed: all configured authentication methods failed'
    const res = friendlyError(raw)
    expect(res.message).toContain('认证失败')
    expect(res.detail).toBe(raw)
  })

  it('cleans unmapped technical errors into generic friendly message instead of raw string', () => {
    const raw = 'SSH connection failed: some mysterious remote server failure'
    const res = friendlyError(raw)
    expect(res.message).toContain('连接')
    expect(res.message).not.toContain('SSH connection failed:')
    expect(res.detail).toBe(raw)
  })
})
