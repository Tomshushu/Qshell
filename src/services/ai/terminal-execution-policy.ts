/**
 * src/services/ai/terminal-execution-policy.ts
 *
 * 「在终端运行 / 右键执行」等所有 insert-terminal-command(execute:true) 事件的统一裁决。
 * 只有「安全只读自动执行」档允许自动回车；只读问答与询问确认档一律降级为「仅填入」，
 * 由用户自行回车完成显式确认，避免任何派发入口绕过 AI 执行模式。
 */

import type { AIExecutionMode } from '@/types/ai'

export function shouldAutoRunTerminalCommand(
  mode: AIExecutionMode | undefined,
  requestedExecute: boolean,
): boolean {
  if (!requestedExecute) return false
  const effective = mode || 'auto_readonly'
  return effective === 'auto_readonly' || effective === 'danger'
}
