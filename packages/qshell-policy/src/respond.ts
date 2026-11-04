/**
 * packages/qshell-policy/src/respond.ts
 *
 * S1-3 DLP 出向通道唯一返回出口与结构化拒绝包装器
 *
 * 核心管线：
 * raw output ➔ dlp.sanitize(出向脱敏) ➔ truncateOutput(8KB/150行防爆截断) ➔ recordAudit(写审计) ➔ 返回规范对象
 *
 * 严禁任何工具处理器绕过此出口直接裸返回未脱敏内容！
 */

import { sanitize } from './dlp'
import { truncateOutput } from './truncate'
import { recordAudit } from './audit'
import type {
  PolicyResponseContext,
  PolicyToolResponse,
  GuardVerdict,
  AuditRecord,
} from './types'

/**
 * 成功输出唯一返回出口
 */
export function respond(
  rawContent: string,
  ctx: PolicyResponseContext = {},
): PolicyToolResponse {
  const startTs = Date.now()

  // 1. 出向 DLP 脱敏清洗 (强制开启，不可关闭)
  const dlpRes = sanitize(rawContent || '')

  // 2. 8KB 与 150 行防爆截断
  const truncRes = truncateOutput(dlpRes.text)

  // 3. 组装并写入审计记录
  const auditRecord: AuditRecord = {
    ts: startTs,
    requestId: ctx.requestId || `req_${startTs}_${Math.random().toString(36).slice(2, 7)}`,
    transport: ctx.transport || 'internal',
    hostId: ctx.hostId || 'default',
    tool: ctx.tool || 'unknown_tool',
    command: ctx.command,
    remotePath: ctx.remotePath,
    verdict: ctx.verdict
      ? {
          class: ctx.verdict.class,
          reason: ctx.verdict.reason,
          segment: ctx.verdict.segment,
        }
      : undefined,
    policyLevel: 'read-only',
    durationMs: ctx.durationMs || 0,
    outputBytes: truncRes.outputBytes,
    truncated: truncRes.truncated,
    dlpHitTypes: dlpRes.hitTypes,
  }

  recordAudit(auditRecord)

  return {
    content: [
      {
        type: 'text',
        text: truncRes.text,
      },
    ],
    audit: auditRecord,
    requestId: auditRecord.requestId,
  }
}

/**
 * 结构化拒绝与错误返回出口 (S1-4 规范)
 * 外部模型接收到结构化错误与 hint，能够自主修正命令，避免反复重试
 */
export function respondError(
  errorOrVerdict: string | (Partial<GuardVerdict> & { message?: string }),
  ctx: PolicyResponseContext = {},
): PolicyToolResponse {
  const startTs = Date.now()
  const reqId = ctx.requestId || `err_${startTs}_${Math.random().toString(36).slice(2, 7)}`

  let verdictName = 'unknown-error'
  let segment: string | undefined
  let hint = '只读排障请使用只读命令（如 systemctl status, journalctl -n 50, ss -tulpn, docker ps 等）'
  let errorText = ''

  if (typeof errorOrVerdict === 'string') {
    errorText = errorOrVerdict
    verdictName = 'destructive'
  } else {
    verdictName = errorOrVerdict.reason || 'destructive'
    segment = errorOrVerdict.segment
    hint = errorOrVerdict.hint || hint
    errorText =
      errorOrVerdict.message ||
      `安全策略拒绝：${errorOrVerdict.reason || '禁止非只读或高危操作'}${segment ? ` [片段: ${segment}]` : ''}`
  }

  // 错误同样必须落审计 (写明拒绝原因，不泄露凭据)
  const auditRecord: AuditRecord = {
    ts: startTs,
    requestId: reqId,
    transport: ctx.transport || 'internal',
    hostId: ctx.hostId || 'default',
    tool: ctx.tool || 'unknown_tool',
    command: ctx.command,
    remotePath: ctx.remotePath,
    verdict: {
      class: 'destructive',
      reason: verdictName,
      segment,
    },
    policyLevel: 'read-only',
    durationMs: ctx.durationMs || 0,
    outputBytes: errorText.length,
    truncated: false,
    errorCode: verdictName.toUpperCase(),
  }

  recordAudit(auditRecord)

  const payload = {
    isError: true,
    verdict: verdictName,
    segment,
    hint,
    requestId: reqId,
    message: errorText,
  }

  return {
    isError: true,
    verdict: verdictName as any,
    segment,
    hint,
    requestId: reqId,
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    audit: auditRecord,
  }
}
