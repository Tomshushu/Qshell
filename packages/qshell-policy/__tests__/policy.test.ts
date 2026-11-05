/**
 * packages/qshell-policy/__tests__/policy.test.ts
 *
 * Qshell Policy & MCP 基础规范单元测试集 (S1 契约验证)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  evaluateCommandForExecution,
  sanitize,
  sanitizeLogContent,
  truncateOutput,
  recordAudit,
  getRecentAuditRecords,
  clearAuditRecords,
  respond,
  respondError,
  PROBE_SERVER_SCHEMA,
  EXECUTE_READONLY_COMMAND_SCHEMA,
  SFTP_READ_FILE_SCHEMA,
  MCP_TOOLS,
  toMcpToolDefinition,
  buildMcpTools,
  validateSftpReadPath,
  isBinaryContent,
  clipFileLines,
} from '../src/index'

describe('Qshell Policy Package - S1 Contract Tests', () => {
  beforeEach(() => {
    clearAuditRecords()
  })

  describe('S1-1: Command Guard Zero-Trust Policy', () => {
    it('allows safe read-only commands', () => {
      const res = evaluateCommandForExecution('free -h')
      expect(res.allowed).toBe(true)
      expect(res.isReadOnly).toBe(true)
      expect(res.riskLevel).toBe('safe')
    })

    it('blocks destructive rm and write redirection commands', () => {
      const res = evaluateCommandForExecution('rm -rf /var/log/app')
      expect(res.allowed).toBe(false)
      expect(res.isReadOnly).toBe(false)

      const redirectRes = evaluateCommandForExecution('echo test > /tmp/foo')
      expect(redirectRes.allowed).toBe(false)
    })

    it('blocks subshell execution like $() and backticks', () => {
      const res1 = evaluateCommandForExecution('echo $(whoami)')
      expect(res1.allowed).toBe(false)

      const res2 = evaluateCommandForExecution('echo `id`')
      expect(res2.allowed).toBe(false)
    })

    it('enforces depth limits on du and find', () => {
      const badDu = evaluateCommandForExecution('du -sh /*')
      expect(badDu.allowed).toBe(false)

      const goodDu = evaluateCommandForExecution('du -h --max-depth=1 /var/log')
      expect(goodDu.allowed).toBe(true)
    })
  })

  describe('S1-2: Tool Schema MCP Alignment', () => {
    it('has probe_server schema matching MCP specification', () => {
      expect(PROBE_SERVER_SCHEMA.name).toBe('probe_server')
      expect(PROBE_SERVER_SCHEMA.annotations?.readOnlyHint).toBe(true)
      expect(PROBE_SERVER_SCHEMA.annotations?.idempotentHint).toBe(true)
      expect(PROBE_SERVER_SCHEMA.inputSchema.required).toContain('metric')
    })

    it('has execute_readonly_command schema matching MCP specification', () => {
      expect(EXECUTE_READONLY_COMMAND_SCHEMA.name).toBe('execute_readonly_command')
      expect(EXECUTE_READONLY_COMMAND_SCHEMA.annotations?.readOnlyHint).toBe(true)
      expect(EXECUTE_READONLY_COMMAND_SCHEMA.inputSchema.required).toContain('command')
    })

    it('has sftp_read_file schema matching MCP specification', () => {
      expect(SFTP_READ_FILE_SCHEMA.name).toBe('sftp_read_file')
      expect(SFTP_READ_FILE_SCHEMA.annotations?.readOnlyHint).toBe(true)
      expect(SFTP_READ_FILE_SCHEMA.inputSchema.required).toContain('remotePath')
    })

    it('normalizes a dynamic plugin tool into a valid MCP tool definition', () => {
      const def = toMcpToolDefinition({
        qualifiedName: 'mcp__ext_k8s__get_pods',
        toolName: 'get_pods',
        description: 'list pods',
        inputSchema: {
          type: 'object',
          properties: { namespace: { type: 'string' } },
          required: ['namespace', 42],
        },
        isReadOnly: true,
        transport: 'stdio',
      })
      expect(def.name).toBe('mcp__ext_k8s__get_pods')
      expect(def.inputSchema.type).toBe('object')
      expect(def.inputSchema.required).toEqual(['namespace'])
      expect(def.annotations).toEqual({
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      })
    })

    it('marks write-capable tools as non-idempotent and handles malformed schemas', () => {
      const def = toMcpToolDefinition({
        qualifiedName: 'mcp__ext_writer__delete_pod',
        toolName: 'delete_pod',
        description: 'delete pod',
        inputSchema: { properties: null } as unknown as Record<string, unknown>,
        isReadOnly: false,
      })
      expect(def.inputSchema.properties).toEqual({})
      expect(def.inputSchema.required).toEqual([])
      expect(def.annotations?.readOnlyHint).toBe(false)
      expect(def.annotations?.idempotentHint).toBe(false)
      expect(def.annotations?.openWorldHint).toBe(false)
    })

    it('merges dynamic tools into the full tool list and blocks protected name spoofing', () => {
      expect(MCP_TOOLS).toHaveLength(3)
      expect(buildMcpTools([])).toHaveLength(3)

      const full = buildMcpTools([
        {
          qualifiedName: 'mcp__ext_k8s__get_pods',
          toolName: 'get_pods',
          description: 'list pods',
          inputSchema: { type: 'object', properties: {} },
          isReadOnly: true,
          transport: 'http',
        },
        // 插件不得伪造静态内置工具名
        {
          qualifiedName: 'probe_server',
          toolName: 'probe_server',
          description: 'spoofed',
          inputSchema: { type: 'object', properties: {} },
          isReadOnly: false,
          transport: 'stdio',
        },
      ])
      expect(full).toHaveLength(4)
      expect(full.map((tool) => tool.name)).toContain('mcp__ext_k8s__get_pods')
      expect(full.find((tool) => tool.name === 'probe_server')).toBe(PROBE_SERVER_SCHEMA)
    })
  })

  describe('S1-3: DLP Outbound Sanitizer & respond() Pipeline', () => {
    it('redacts private keys from tool output', () => {
      const raw = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----'
      const res = respond(raw, { tool: 'sftp_read_file' })
      expect(res.content[0].text).toContain('[REDACTED_PRIVATE_KEY]')
      expect(res.audit?.dlpHitTypes).toContain('PRIVATE_KEY')
    })

    it('redacts cloud keys and API tokens from tool output', () => {
      const raw = 'AKIAIOSFODNN7EXAMPLE\nsk-proj-1234567890abcdefghijklmn'
      const res = respond(raw, { tool: 'execute_readonly_command' })
      expect(res.content[0].text).toContain('[REDACTED_AWS_KEY]')
      expect(res.content[0].text).toContain('[REDACTED_API_KEY]')
    })

    it('redacts password key-value pairs', () => {
      const raw = 'db.password="SuperSecret123"\nauth_token=abcdef123456'
      const res = respond(raw, { tool: 'sftp_read_file' })
      expect(res.content[0].text).toContain('[REDACTED_SECRET]')
    })

    it('sanitizes directly via sanitize() and sanitizeLogContent()', () => {
      const res = sanitize('secret_token="abcdef123456"')
      expect(res.text).toContain('[REDACTED_SECRET]')
      expect(res.hitTypes).toContain('CREDENTIAL_PAIR')

      const logRes = sanitizeLogContent('2026-11-04 12:00:00 [ERROR] token=secret123')
      expect(logRes).toContain('[REDACTED_SECRET]')
    })

    it('marks dangerous executions in the full audit record', () => {
      const res = respond('restart done', {
        tool: 'execute_readonly_command',
        dangerous: true,
      })
      expect(res.audit?.dangerous).toBe(true)
      expect(res.audit?.policyLevel).toBe('danger')
      expect(res.audit?.approvalState).toBe('ACCEPT')

      const plain = respond('ok', { tool: 'probe_server' })
      expect(plain.audit?.dangerous).toBe(false)
      expect(plain.audit?.policyLevel).toBe('read-only')
    })
  })

  describe('S1-4: Structured Errors & JSONL Audit', () => {
    it('returns structured error with hint and verdict', () => {
      const errRes = respondError({
        reason: 'io-blocked',
        segment: 'du -sh /*',
        hint: '请限制深度：du -h --max-depth=1 /var/log',
      }, {
        tool: 'execute_readonly_command',
        command: 'du -sh /*',
      })

      expect(errRes.isError).toBe(true)
      expect(errRes.verdict).toBe('io-blocked')
      expect(errRes.segment).toBe('du -sh /*')
      expect(errRes.hint).toContain('--max-depth=1')
      const parsed = JSON.parse(errRes.content[0].text)
      expect(parsed.isError).toBe(true)
      expect(parsed.verdict).toBe('io-blocked')
    })

    it('records structured audit records', () => {
      respond('Linux prod-server 5.15.0', {
        requestId: 'req_test_001',
        hostId: 'srv_prod_01',
        tool: 'probe_server',
      })

      const records = getRecentAuditRecords(10)
      expect(records.length).toBeGreaterThan(0)
      const r = records[0]
      expect(r.tool).toBe('probe_server')
      expect(r.hostId).toBe('srv_prod_01')
      expect(r.policyLevel).toBe('read-only')
    })

    it('records audit directly via recordAudit()', () => {
      recordAudit({
        ts: Date.now(),
        requestId: 'req_manual_audit',
        transport: 'internal',
        hostId: 'srv_01',
        tool: 'test_tool',
        policyLevel: 'read-only',
        durationMs: 5,
        outputBytes: 10,
        truncated: false,
      })
      const recs = getRecentAuditRecords(5)
      expect(recs.some((r) => r.requestId === 'req_manual_audit')).toBe(true)
    })
  })

  describe('S1-5: SFTP Path Whitelist & Read Constraints', () => {
    it('allows valid whitelist paths', () => {
      const nginx = validateSftpReadPath('/etc/nginx/nginx.conf')
      expect(nginx.valid).toBe(true)
      expect(nginx.normalizedPath).toBe('/etc/nginx/nginx.conf')

      const log = validateSftpReadPath('/var/log/nginx/error.log')
      expect(log.valid).toBe(true)

      const app = validateSftpReadPath('/opt/myapp/config.yaml')
      expect(app.valid).toBe(true)
    })

    it('blocks relative paths and directory traversal', () => {
      const rel = validateSftpReadPath('nginx.conf')
      expect(rel.valid).toBe(false)
      expect(rel.reason).toContain('绝对 POSIX 路径')

      const traversal = validateSftpReadPath('/etc/nginx/../../root/.ssh/id_rsa')
      expect(traversal.valid).toBe(false)
      expect(traversal.reason).toContain('路径穿越')
    })

    it('blocks sensitive SSH credentials and keys', () => {
      const ssh1 = validateSftpReadPath('/root/.ssh/id_rsa')
      expect(ssh1.valid).toBe(false)
      expect(ssh1.reason).toContain('SSH')

      const ssh2 = validateSftpReadPath('/home/deploy/.ssh/authorized_keys')
      expect(ssh2.valid).toBe(false)

      const privKey = validateSftpReadPath('/etc/ssl/private/server.key')
      expect(privKey.valid).toBe(false)
    })

    it('blocks shadow, sudoers, proc, env and k8s secrets', () => {
      expect(validateSftpReadPath('/etc/shadow').valid).toBe(false)
      expect(validateSftpReadPath('/etc/sudoers').valid).toBe(false)
      expect(validateSftpReadPath('/proc/version').valid).toBe(false)
      expect(validateSftpReadPath('/opt/app/.env').valid).toBe(false)
      expect(validateSftpReadPath('/var/run/secrets/kubernetes.io/token').valid).toBe(false)
    })

    it('blocks paths outside whitelist', () => {
      const nonWhitelisted = validateSftpReadPath('/boot/grub/grub.cfg')
      expect(nonWhitelisted.valid).toBe(false)
      expect(nonWhitelisted.reason).toContain('白名单')
    })

    it('detects binary content', () => {
      expect(isBinaryContent('::base64::iVBORw0KGgoAAAANSUhEUgAA...')).toBe(true)
      expect(isBinaryContent('Hello\0World')).toBe(true)
      expect(isBinaryContent('server { listen 80; }')).toBe(false)
    })

    it('clips text lines beyond maxLines', () => {
      const multiLine = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n')
      const res = clipFileLines(multiLine, 100)
      expect(res.isClipped).toBe(true)
      expect(res.totalLines).toBe(200)
      expect(res.clippedText).toContain('已按安全配额仅读取前 100 行')
    })
  })

  describe('Output Truncation (8KB / 150 lines)', () => {
    it('truncates outputs exceeding 150 lines', () => {
      const longLines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n')
      const res = truncateOutput(longLines)
      expect(res.truncated).toBe(true)
      expect(res.text).toContain('输出超出 150 行')
    })

    it('truncates outputs exceeding 8192 bytes', () => {
      const bigString = 'A'.repeat(12000)
      const res = truncateOutput(bigString)
      expect(res.truncated).toBe(true)
      expect(res.text).toContain('输出超出 8192 字节')
      expect(res.outputBytes).toBeLessThanOrEqual(8192)
    })
  })
})
