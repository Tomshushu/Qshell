/**
 * packages/qshell-policy/src/types.ts
 *
 * Qshell 策略核心类型定义 (S1 契约标准)
 */

export type CommandRiskLevel = 'safe' | 'notice' | 'dangerous' | 'blocked'

export type CommandClass = 'read-only' | 'safe' | 'destructive' | 'privileged'

export type GuardRejectReason =
  | 'destructive'
  | 'injection'
  | 'io-blocked'
  | 'tui'
  | 'write-redirect'
  | 'background-detach'
  | 'subshell'
  | 'unknown-host'

export interface GuardVerdict {
  allowed: boolean
  class: CommandClass
  reason?: GuardRejectReason
  segment?: string
  hint?: string
  normalized: string
  needsApproval: boolean
  timeoutMs: number
}

export interface CommandGuardOptions {
  customBlacklist?: string[]
  executionMode?: 'ask' | 'auto_readonly' | 'disabled' | 'danger'
}

/**
 * 自适应降级重试计划：只读命令先按原样下发，若在 timeoutMs 内仍无返回，
 * 执行层自动改用 command（更浅的检索深度）重试，避免长时间卡住主机与 AI 问答。
 */
export interface AdaptiveRetryPlan {
  command: string
  timeoutMs: number
  reason?: string
}

export interface CommandGuardDecision {
  allowed: boolean
  isReadOnly: boolean
  riskLevel: CommandRiskLevel
  reason: string
  safeToAutoExecute: boolean
  isInteractive?: boolean
  blockedReason?: string
  suggestedSafeCommand?: string
  adaptiveRetry?: AdaptiveRetryPlan
  /** 危险模式下的写命令：已通过红线检查，允许执行但必须预览并全量审计 */
  isDangerous?: boolean
  /** 执行前置预览文本（供 UI 在真正下发前展示） */
  preview?: string
  verdict?: GuardVerdict
}

export interface DlpSanitizeOptions {
  maskPrivateIps?: boolean
}

export interface AuditRecord {
  ts: number
  requestId: string
  userId?: string
  agent?: string
  model?: string
  transport: 'stdio' | 'local-http' | 'internal'
  hostId?: string
  tool: string
  command?: string
  remotePath?: string
  verdict?: {
    class: CommandClass | string
    reason?: string
    segment?: string
  }
  policyLevel?: string
  /** 危险模式（会话级临时提权）执行标记，用于全量审计筛选 */
  dangerous?: boolean
  approvalId?: string
  approvalState?: 'ACCEPT' | 'DECLINE' | 'CANCEL' | 'NONE'
  durationMs?: number
  outputBytes: number
  truncated: boolean
  errorCode?: string
  dlpHitTypes?: string[]
}

export interface PolicyResponseContext {
  requestId?: string
  hostId?: string
  tool?: string
  command?: string
  remotePath?: string
  transport?: 'stdio' | 'local-http' | 'internal'
  verdict?: GuardVerdict
  durationMs?: number
  /** 是否为危险模式执行，审计记录会带上 policyLevel=dangerous */
  dangerous?: boolean
}

export interface PolicyToolResponse {
  isError?: boolean
  content: Array<{
    type: 'text'
    text: string
  }>
  audit?: AuditRecord
  verdict?: GuardRejectReason
  segment?: string
  hint?: string
  requestId?: string
}
