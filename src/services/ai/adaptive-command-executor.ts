/**
 * src/services/ai/adaptive-command-executor.ts
 *
 * 只读命令自适应降级执行器。
 * 对「带深度但可能卡住」的检索命令（如 find / -maxdepth 5），先按原命令下发；
 * 若在短超时内没有返回（或快速失败），自动改用策略层生成的浅深度命令重试，
 * 避免长时间挂起主机、也避免用红色拦截卡片打断 AI 问答。
 *
 * 注意：JS 侧无法取消已在远程执行的命令，原命令会在自身硬超时后自行结束；
 * 因此原命令通常应带 `| head -n N` 之类的输出限流（策略层保留原命令的管道）。
 */

import type { AdaptiveRetryPlan } from '@qshell/policy'

export interface CommandExecResult {
  stdout: string
  stderr: string
  exitCode: number
  error?: string
}

export interface AdaptiveExecutionResult extends CommandExecResult {
  /** 是否真的走了浅层重试 */
  usedFallback: boolean
  /** 可展示给 AI / 用户的降级说明 */
  notice?: string
}

export async function executeWithAdaptiveRetry(
  primary: string,
  plan: AdaptiveRetryPlan | undefined,
  run: (command: string, timeoutMs: number) => Promise<CommandExecResult>,
  hardTimeoutMs = 10000,
): Promise<AdaptiveExecutionResult> {
  if (!plan || !plan.command || plan.command === primary) {
    return { ...(await run(primary, hardTimeoutMs)), usedFallback: false }
  }

  const softTimeoutMs = Math.max(500, plan.timeoutMs)
  let softTimer: ReturnType<typeof setTimeout> | undefined
  const softTimeout = new Promise<'timeout'>((resolve) => {
    softTimer = setTimeout(() => resolve('timeout'), softTimeoutMs)
  })

  // 把原命令的失败也转成结果对象，避免 Promise.race 后残留未处理的 rejection
  const primaryTask = run(primary, softTimeoutMs)
    .then((result) => (result.error ? { error: result.error } : { result }))
    .catch((err: unknown) => ({ error: (err as Error)?.message || String(err) }))

  let raced: { result?: CommandExecResult; error?: string } | 'timeout'
  try {
    raced = await Promise.race([primaryTask, softTimeout])
  } finally {
    if (softTimer) clearTimeout(softTimer)
  }

  if (raced !== 'timeout' && raced.result) {
    return { ...raced.result, usedFallback: false }
  }

  const cause = raced === 'timeout'
    ? `在 ${Math.round(softTimeoutMs / 1000)}s 内未返回结果`
    : `执行失败（${raced.error || '未知原因'}）`

  try {
    const fallbackResult = await run(plan.command, hardTimeoutMs)
    return {
      ...fallbackResult,
      usedFallback: true,
      notice: `⏱️ 原命令${cause}，已自动改用浅深度命令重试：${plan.command}`,
    }
  } catch (err: unknown) {
    const message = (err as Error)?.message || '自动降级重试失败'
    return {
      stdout: '',
      stderr: message,
      exitCode: -1,
      error: message,
      usedFallback: true,
      notice: `⏱️ 原命令${cause}，浅深度重试亦失败：${message}`,
    }
  }
}
