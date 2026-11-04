/**
 * packages/qshell-mcp/__tests__/mcp-shell.test.ts
 *
 * Qshell MCP stdio 薄壳基础单元测试集 (S2-1 契约验证)
 */

import { describe, it, expect, vi } from 'vitest'
import {
  evaluateCommandForExecution,
  validateSftpReadPath,
  PROBE_SERVER_SCHEMA,
  EXECUTE_READONLY_COMMAND_SCHEMA,
  SFTP_READ_FILE_SCHEMA,
} from '@qshell/policy'

describe('Qshell MCP Stdio Thin Shell - S2-1 Contract Tests', () => {
  it('defines 3 standard MCP tools in tools/list', () => {
    const tools = [
      PROBE_SERVER_SCHEMA,
      EXECUTE_READONLY_COMMAND_SCHEMA,
      SFTP_READ_FILE_SCHEMA,
    ]

    expect(tools).toHaveLength(3)
    const names = tools.map((t) => t.name)
    expect(names).toContain('probe_server')
    expect(names).toContain('execute_readonly_command')
    expect(names).toContain('sftp_read_file')
  })

  it('performs pre-flight zero-trust rejection on destructive commands', () => {
    const destructive = 'rm -rf /var/log/*'
    const decision = evaluateCommandForExecution(destructive, { executionMode: 'auto_readonly' })
    expect(decision.allowed).toBe(false)
    expect(decision.verdict?.class).toBe('destructive')
  })

  it('performs pre-flight zero-trust rejection on sensitive SFTP paths', () => {
    const sensitive = '/root/.ssh/id_rsa'
    const validation = validateSftpReadPath(sensitive)
    expect(validation.valid).toBe(false)
    expect(validation.reason).toContain('SSH')
  })

  it('allows safe read-only commands for forward execution', () => {
    const safe = 'systemctl status nginx'
    const decision = evaluateCommandForExecution(safe, { executionMode: 'auto_readonly' })
    expect(decision.allowed).toBe(true)
    expect(decision.verdict?.class).toBe('read-only')
  })

  it('allows safe whitelist paths for SFTP read', () => {
    const confPath = '/etc/nginx/nginx.conf'
    const validation = validateSftpReadPath(confPath)
    expect(validation.valid).toBe(true)
    expect(validation.normalizedPath).toBe('/etc/nginx/nginx.conf')
  })
})
