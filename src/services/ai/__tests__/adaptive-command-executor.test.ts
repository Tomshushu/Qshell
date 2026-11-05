import { describe, it, expect, vi } from 'vitest'
import { executeWithAdaptiveRetry } from '../adaptive-command-executor'

const ok = (stdout: string) => ({ stdout, stderr: '', exitCode: 0 })
const plan = {
  command: 'find / -maxdepth 1 -name "poetry**" -type f 2>/dev/null | head -n 20',
  timeoutMs: 500,
  reason: '检索深度 5 较大，4 秒无返回时自动改用 -maxdepth 1 重试',
}

describe('executeWithAdaptiveRetry', () => {
  it('uses the original command when it returns quickly', async () => {
    const run = vi.fn().mockResolvedValue(ok('primary output'))
    const res = await executeWithAdaptiveRetry('find / -maxdepth 5', plan, run)

    expect(res.usedFallback).toBe(false)
    expect(res.stdout).toBe('primary output')
    expect(res.notice).toBeUndefined()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('automatically retries with the shallow command when the original hangs', async () => {
    const run = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce(ok('shallow output'))

    const res = await executeWithAdaptiveRetry('find / -maxdepth 5', plan, run)

    expect(res.usedFallback).toBe(true)
    expect(res.stdout).toBe('shallow output')
    expect(res.notice).toContain('自动改用浅深度命令重试')
    expect(run).toHaveBeenNthCalledWith(2, plan.command, 10000)
  })

  it('falls back when the original command fails quickly', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(ok('shallow output'))

    const res = await executeWithAdaptiveRetry('find / -maxdepth 5', plan, run)

    expect(res.usedFallback).toBe(true)
    expect(res.notice).toContain('执行失败')
    expect(res.stdout).toBe('shallow output')
  })

  it('reports a clear notice when the shallow retry also fails', async () => {
    const run = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockRejectedValueOnce(new Error('sshd unavailable'))

    const res = await executeWithAdaptiveRetry('find / -maxdepth 5', plan, run)

    expect(res.usedFallback).toBe(true)
    expect(res.exitCode).toBe(-1)
    expect(res.notice).toContain('浅深度重试亦失败')
  })

  it('runs plain commands once when no retry plan is attached', async () => {
    const run = vi.fn().mockResolvedValue(ok('df output'))
    const res = await executeWithAdaptiveRetry('df -h', undefined, run)

    expect(res.usedFallback).toBe(false)
    expect(res.stdout).toBe('df output')
    expect(run).toHaveBeenCalledTimes(1)
  })
})
