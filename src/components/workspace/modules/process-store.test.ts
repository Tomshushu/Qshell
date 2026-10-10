// @vitest-environment jsdom
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useProcessSnapshot, refreshProcessSnapshot, clearProcessSnapshotStore } from './process-store'
import { sshService } from '@/services/ssh-service'
import type { ProcessInfo } from '@/types'

vi.mock('@/services/ssh-service', () => ({
  sshService: {
    listProcesses: vi.fn(),
  },
}))

const mockProc = (pid: number, name: string): ProcessInfo => ({
  pid,
  ppid: 1,
  user: 'root',
  cpu: 0.1,
  memory: 1.2,
  vsz: 1024,
  rss: 512,
  tty: '?',
  stat: 'S',
  start: '00:00',
  time: '0:01',
  command: name,
})

describe('ProcessStore 多实例隔离与生命周期测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearProcessSnapshotStore()
  })

  it('不同 serverId 的进程数据完全隔离，互不干扰', async () => {
    const listSpy = vi.mocked(sshService.listProcesses)
    listSpy.mockImplementation(async (serverId: string) => {
      if (serverId === 'srv-A') {
        return [mockProc(101, 'serverA-nginx')]
      }
      return [mockProc(202, 'serverB-redis')]
    })

    const { result: resA, unmount: unmountA } = renderHook(() =>
      useProcessSnapshot('srv-A', 5000, false)
    )
    const { result: resB, unmount: unmountB } = renderHook(() =>
      useProcessSnapshot('srv-B', 5000, false)
    )

    await waitFor(() => {
      expect(resA.current.processes.length).toBe(1)
      expect(resB.current.processes.length).toBe(1)
    })

    expect(resA.current.processes[0].command).toBe('serverA-nginx')
    expect(resB.current.processes[0].command).toBe('serverB-redis')

    // 触发 Server A 刷新，不应污染 Server B
    listSpy.mockResolvedValueOnce([
      mockProc(101, 'serverA-nginx'),
      mockProc(102, 'serverA-worker'),
    ])

    await act(async () => {
      refreshProcessSnapshot('srv-A')
    })

    await waitFor(() => {
      expect(resA.current.processes.length).toBe(2)
    })

    // Server B 依然保持原状
    expect(resB.current.processes.length).toBe(1)
    expect(resB.current.processes[0].command).toBe('serverB-redis')

    unmountA()
    unmountB()
  })

  it('卸载 Server A 不会影响 Server B 的状态与生命周期', async () => {
    const listSpy = vi.mocked(sshService.listProcesses)
    listSpy.mockImplementation(async (serverId: string) => {
      return [mockProc(1, 'init-' + serverId)]
    })

    const { result: resA, unmount: unmountA } = renderHook(() =>
      useProcessSnapshot('srv-A', 5000, true)
    )
    const { result: resB, unmount: unmountB } = renderHook(() =>
      useProcessSnapshot('srv-B', 5000, true)
    )

    await waitFor(() => {
      expect(resA.current.processes.length).toBe(1)
      expect(resB.current.processes.length).toBe(1)
    })

    // 卸载 Server A
    unmountA()

    // Server B 数据依然有效
    expect(resB.current.processes[0].command).toBe('init-srv-B')

    unmountB()
  })
})
