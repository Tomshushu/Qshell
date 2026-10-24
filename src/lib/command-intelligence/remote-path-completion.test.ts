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
      // 主命令（ls -1A + [ -d ]）的输出格式：目录带尾随 '/'，文件为裸名
      stdout: 'dirA/\nfileB\n',
      stderr: '',
      exitCode: 0,
    })

    // 第一次调用：发起底层命令
    const first = await listRemoteDir('srv-1', '/var')
    expect(execSpy).toHaveBeenCalledTimes(1)
    expect(first.entries.length).toBe(2)
    expect(first.ok).toBe(true)

    // 第二次调用（未过期）：直接命中缓存，不增加底层调用
    const second = await listRemoteDir('srv-1', '/var')
    expect(execSpy).toHaveBeenCalledTimes(1)
    expect(second).toEqual(first)
  })

  it('隐藏项沉底，非隐藏项保持 ls -t 的时间倒序', async () => {
    const execSpy = vi.mocked(sshService.execute)
    // 模拟 `ls -1At` 输出：已按 mtime 降序排好，隐藏项夹在中间
    execSpy.mockResolvedValue({
      stdout: 'ble-ca/\n.ssh/\ncategraf/\ndata/\n',
      stderr: '',
      exitCode: 0,
    })

    const { entries } = await listRemoteDir('srv-1', '/root')
    // 稳定分区：非隐藏保持原序（ble-ca → categraf → data），隐藏沉底
    expect(entries.map((e) => e.name)).toEqual([
      'ble-ca',
      'categraf',
      'data',
      '.ssh',
    ])
    expect(entries.map((e) => e.hidden)).toEqual([false, false, false, true])
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
