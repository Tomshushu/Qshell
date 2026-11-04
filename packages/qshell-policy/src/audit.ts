/**
 * packages/qshell-policy/src/audit.ts
 *
 * Qshell 结构化安全审计日志记录器 (JSONL 契约标准)
 * 审计原则：严格脱敏后落盘，不记录文件内容本体，不记录私钥/Token 原值。
 */

import type { AuditRecord } from './types'

export const AUDIT_STORAGE_KEY = 'qshell_mcp_audit_logs_v1'
export const MAX_IN_MEMORY_AUDIT_LOGS = 1000

// 内存中的审计缓存（方便快速查询与展示）
const auditLogBuffer: AuditRecord[] = []

/**
 * 格式化单条审计记录为 JSONL 格式的一行字符串
 */
export function formatAuditRecord(record: AuditRecord): string {
  return JSON.stringify({
    ts: record.ts || Date.now(),
    requestId: record.requestId,
    userId: record.userId || 'local-user',
    agent: record.agent || 'qshell-agent',
    model: record.model || 'unknown',
    transport: record.transport || 'internal',
    hostId: record.hostId || 'default',
    tool: record.tool,
    command: record.command,
    remotePath: record.remotePath,
    verdict: record.verdict,
    policyLevel: record.policyLevel || 'read-only',
    approvalId: record.approvalId,
    approvalState: record.approvalState || 'NONE',
    durationMs: record.durationMs || 0,
    outputBytes: record.outputBytes || 0,
    truncated: Boolean(record.truncated),
    errorCode: record.errorCode,
    dlpHitTypes: record.dlpHitTypes || [],
  })
}

/**
 * 写入单条审计记录
 */
export function recordAudit(record: AuditRecord): void {
  // 1. 内存缓冲
  auditLogBuffer.unshift(record)
  if (auditLogBuffer.length > MAX_IN_MEMORY_AUDIT_LOGS) {
    auditLogBuffer.length = MAX_IN_MEMORY_AUDIT_LOGS
  }

  // 2. 本地持久化 (支持浏览器与 Node 环境容错)
  try {
    if (typeof localStorage !== 'undefined') {
      const line = formatAuditRecord(record)
      const existing = localStorage.getItem(AUDIT_STORAGE_KEY)
      const lines = existing ? existing.split('\n') : []
      lines.unshift(line)
      // 最多保留 2000 行
      if (lines.length > 2000) {
        lines.length = 2000
      }
      localStorage.setItem(AUDIT_STORAGE_KEY, lines.join('\n'))
    }
  } catch {
    // 忽略存储配额异常
  }
}

/**
 * 读取最近的审计日志记录
 */
export function getRecentAuditRecords(limit = 100): AuditRecord[] {
  if (auditLogBuffer.length > 0) {
    return auditLogBuffer.slice(0, limit)
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(AUDIT_STORAGE_KEY)
      if (raw) {
        return raw
          .split('\n')
          .filter(Boolean)
          .slice(0, limit)
          .map((line) => {
            try {
              return JSON.parse(line) as AuditRecord
            } catch {
              return null
            }
          })
          .filter(Boolean) as AuditRecord[]
      }
    }
  } catch {
    /* ignore */
  }
  return []
}

/**
 * 清除本地审计日志
 */
export function clearAuditRecords(): void {
  auditLogBuffer.length = 0
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(AUDIT_STORAGE_KEY)
    }
  } catch {
    /* ignore */
  }
}
