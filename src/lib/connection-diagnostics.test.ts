import { describe, expect, it } from 'vitest'
import type { Server } from '@/types'
import { buildConnectionDiagnosticReport, validateConnectionConfiguration } from './connection-diagnostics'
import { SshErrorKind } from '@/services/ssh-connection-state'

const server: Server = {
  id: 's1', name: 'demo', host: 'example.com', port: 22, username: 'root',
  authType: 'password', password: 'secret', tags: [], favorite: false,
  status: 'unknown', createdAt: 1, updatedAt: 1,
}

describe('connection diagnostics', () => {
  it('finds incomplete credentials before classifying network errors', () => {
    const invalid = { ...server, password: '' }
    expect(validateConnectionConfiguration(invalid)).toContain('password')
    expect(buildConnectionDiagnosticReport(invalid, 'connection timed out').code).toBe('config')
  })

  it('classifies host key mismatches as a non-retryable security issue', () => {
    const report = buildConnectionDiagnosticReport(server, 'Host key has changed', SshErrorKind.HostKeyMismatch)
    expect(report.code).toBe('hostKey')
    expect(report.retryable).toBe(false)
    expect(report.recommendations.some((item) => item.action === 'resetHostKey')).toBe(true)
  })

  it('uses proxy endpoint as the first connection hop', () => {
    const report = buildConnectionDiagnosticReport({
      ...server,
      proxyConfig: JSON.stringify({ type: 'ssh_jump', host: 'jump.example.com', port: 2222, username: 'jump' }),
    }, 'connection refused')
    expect(report.entryHost).toBe('jump.example.com')
    expect(report.entryPort).toBe(2222)
    expect(report.usesProxy).toBe(true)
  })

  it('uses first hop in chained proxy as entry point', () => {
    const jump1: Server = {
      ...server,
      id: 'jump1',
      host: 'jump1.corp.internal',
      port: 2201,
    }
    const target: Server = {
      ...server,
      id: 'target',
      host: 'target.corp.internal',
      port: 22,
      proxyConfig: JSON.stringify({
        type: 'chain',
        hops: [
          { id: 'h1', mode: 'reference', targetServerId: 'jump1' },
          { id: 'h2', mode: 'inline', host: 'jump2.corp.internal', port: 2202, username: 'admin' },
        ],
      }),
    }
    const report = buildConnectionDiagnosticReport(target, '', undefined, [jump1, target])
    expect(report.entryHost).toBe('jump1.corp.internal')
    expect(report.entryPort).toBe(2201)
    expect(report.usesProxy).toBe(true)
    expect(report.configurationIssues).toHaveLength(0)
  })

  it('detects self reference in chained jump hosts', () => {
    const target: Server = {
      ...server,
      id: 'target',
      proxyConfig: JSON.stringify({
        type: 'chain',
        hops: [{ id: 'h1', mode: 'reference', targetServerId: 'target' }],
      }),
    }
    const issues = validateConnectionConfiguration(target, [target])
    expect(issues).toContain('proxySelfReference')
  })

  it('detects cycles between servers in chained jump hosts', () => {
    const sA: Server = {
      ...server,
      id: 'sA',
      proxyConfig: JSON.stringify({
        type: 'chain',
        hops: [{ id: 'h1', mode: 'reference', targetServerId: 'sB' }],
      }),
    }
    const sB: Server = {
      ...server,
      id: 'sB',
      proxyConfig: JSON.stringify({
        type: 'chain',
        hops: [{ id: 'h2', mode: 'reference', targetServerId: 'sA' }],
      }),
    }
    const issues = validateConnectionConfiguration(sA, [sA, sB])
    expect(issues).toContain('proxyCycleDetected')
  })
})

