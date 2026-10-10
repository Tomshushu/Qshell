export type SessionEventType =
  | 'session_start'
  | 'session_end'
  | 'output'
  | 'command'
  | 'command_start'
  | 'command_end'
  | 'cwd'
  | 'title'
  | 'part'
  | 'resize'

export interface SessionRecordingEvent {
  v: 1
  type: SessionEventType
  atMs: number
  [key: string]: unknown
}

const SECRET_PATTERNS: RegExp[] = [
  /((?:--?(?:password|passwd|token|secret|api[-_]?key)|\b(?:password|passwd|token|secret|api[-_]?key)=)\s*[=:]?\s*)([^\s"']+)/gi,
  /(https?:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi,
  /(Authorization:\s*(?:Bearer|Basic)\s+)(\S+)/gi,
]

/** Best-effort redaction for session indexes. The readable terminal log remains unchanged. */
export function redactCommandForSession(command: string): string {
  return SECRET_PATTERNS.reduce((value, pattern) => value.replace(pattern, (_match, prefix, _secret, suffix) => {
    return `${prefix}••••••${suffix ?? ''}`
  }), command)
}

export function serializeSessionEvent(
  startedAt: number,
  type: SessionEventType,
  payload: Record<string, unknown> = {},
): string {
  const event: SessionRecordingEvent = {
    v: 1,
    type,
    atMs: Math.max(0, Date.now() - startedAt),
    ...payload,
  }
  return `${JSON.stringify(event)}\n`
}

