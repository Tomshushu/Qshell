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
  customWhitelist?: string[]
  executionMode?: 'ask' | 'auto_readonly' | 'disabled'
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
