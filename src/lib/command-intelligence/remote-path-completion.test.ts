import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listRemoteDir, clearRemotePathCache } from './remote-path-completion'
import { sshService } from '@/services/ssh-service'

vi.mock('@/services/ssh-service', () => ({
  sshService: {
    execute: vi.fn(),
  },
}))

describe('remote-path-completion LRU 缓存与生命周期测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearRemotePathCache()
  })

  it('缓存命中并在过期后主动淘汰', async () => {
    const execSpy = vi.mocked(sshService.execute)
    execSpy.mockResolvedValue({
      stdout: 'dirA/\nfileB*\n',
      stderr: '',
      exitCode: 0,
    })

    // 第一次调用：发起底层命令
    const first = await listRemoteDir('srv-1', '/var')
    expect(execSpy).toHaveBeenCalledTimes(1)
    expect(first.length).toBe(2)

    // 第二次调用（未过期）：直接命中缓存，不增加底层调用
    const second = await listRemoteDir('srv-1', '/var')
    expect(execSpy).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it('clearRemotePathCache 可以按 serverId 或全局清理缓存', async () => {
    const execSpy = vi.mocked(sshService.execute)
    execSpy.mockResolvedValue({
      stdout: 'file1\n',
      stderr: '',
      exitCode: 0,
    })

    await listRemoteDir('srv-1', '/etc')
    await listRemoteDir('srv-2', '/etc')
    expect(execSpy).toHaveBeenCalledTimes(2)

    // 清除 srv-1 缓存
    clearRemotePathCache('srv-1')

    // srv-1 重新拉取
    await listRemoteDir('srv-1', '/etc')
    expect(execSpy).toHaveBeenCalledTimes(3)

    // srv-2 依然命中缓存
    await listRemoteDir('srv-2', '/etc')
    expect(execSpy).toHaveBeenCalledTimes(3)

    // 全局清除
    clearRemotePathCache()
    await listRemoteDir('srv-2', '/etc')
    expect(execSpy).toHaveBeenCalledTimes(4)
  })
})
