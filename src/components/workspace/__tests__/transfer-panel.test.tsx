/**
 * src/components/workspace/__tests__/transfer-panel.test.tsx
 *
 * Wave 3 TransferPanel 统一传输队列组件测试：
 * 1. 基于 useTransferQueueStore 渲染 + onTransferProgress / onTransferFailures 事件订阅与卸载防泄漏
 * 2. upload / download / s2s 三标签计数与新 s2s 任务自动展开聚焦
 * 3. scheduled / queued 仅存在时启用 window.setInterval(() => tickScheduler(), 1000) 并随清空销毁
 * 4. priority 循环切换、scheduledAt 倒计时、filterSummary 提示，及 pause/resume/cancel/remove/clearCompleted/clearAll 动作
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { TransferPanel } from '../transfer-panel'
import { I18nProvider } from '@/i18n/i18n-provider'
import { useTransferQueueStore } from '@/store/transfer-queue-store'
import type { TransferProgressData, TransferFailuresData } from '@/services/api/types'

type ProgressCb = (data: TransferProgressData) => void
type FailuresCb = (data: TransferFailuresData) => void

const mockListeners = vi.hoisted(() => ({
  progressCbs: new Set<ProgressCb>(),
  failuresCbs: new Set<FailuresCb>(),
}))

const mockSshService = vi.hoisted(() => ({
  onTransferProgress: vi.fn((cb: ProgressCb) => {
    mockListeners.progressCbs.add(cb)
    return () => {
      mockListeners.progressCbs.delete(cb)
    }
  }),
  onTransferFailures: vi.fn((cb: FailuresCb) => {
    mockListeners.failuresCbs.add(cb)
    return () => {
      mockListeners.failuresCbs.delete(cb)
    }
  }),
  cancelTransfer: vi.fn().mockResolvedValue(undefined),
  resumeUpload: vi.fn().mockResolvedValue(undefined),
  resumeDownload: vi.fn().mockResolvedValue(undefined),
  cleanupTmpFile: vi.fn().mockResolvedValue(undefined),
  registerActiveTransfer: vi.fn(),
  unregisterActiveTransfer: vi.fn(),
}))

vi.mock('@/services/ssh-service', () => ({
  sshService: mockSshService,
}))

function emitProgress(data: Partial<TransferProgressData> & Pick<TransferProgressData, 'transferId' | 'type' | 'fileName'>) {
  for (const cb of Array.from(mockListeners.progressCbs)) {
    cb({
      current: 0,
      total: 1000,
      ...data,
    })
  }
}

function renderPanel() {
  return render(
    <I18nProvider>
      <TransferPanel />
    </I18nProvider>,
  )
}

describe('TransferPanel unified queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListeners.progressCbs.clear()
    mockListeners.failuresCbs.clear()
    useTransferQueueStore.getState().clearAll()
    useTransferQueueStore.setState({ maxConcurrent: 3 })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('subscribes to transfer events without leaking listeners across remounts', () => {
    const first = renderPanel()
    expect(mockListeners.progressCbs.size).toBe(1)
    expect(mockListeners.failuresCbs.size).toBe(1)

    first.unmount()
    expect(mockListeners.progressCbs.size).toBe(0)
    expect(mockListeners.failuresCbs.size).toBe(0)

    const second = renderPanel()
    expect(mockListeners.progressCbs.size).toBe(1)
    expect(mockListeners.failuresCbs.size).toBe(1)

    second.unmount()
    expect(mockListeners.progressCbs.size).toBe(0)
    expect(mockListeners.failuresCbs.size).toBe(0)
  })

  it('auto-opens and switches to s2s tab on incoming s2s progress events and tracks tab counts', () => {
    renderPanel()

    // 注入一条上传进度和一条跨服 s2s 进度
    act(() => {
      emitProgress({
        transferId: 'up-1',
        type: 'upload',
        fileName: 'app.tar.gz',
        current: 500,
        total: 1000,
      })
    })
    expect(screen.getByRole('tablist')).toBeTruthy()
    expect(screen.getByText('app.tar.gz')).toBeTruthy()

    act(() => {
      emitProgress({
        transferId: 's2s-1',
        type: 's2s',
        fileName: 'db-dump.sql',
        current: 200,
        total: 2000,
      })
    })

    // 自动切换到跨服标签页并展示 s2s 任务
    expect(screen.getByText('db-dump.sql')).toBeTruthy()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((el) => el.textContent)).toEqual([
      expect.stringContaining('上传'),
      expect.stringContaining('下载'),
      expect.stringContaining('跨服'),
    ])
    expect(tabs[2].getAttribute('aria-selected')).toBe('true')

    // 收到失败事件应合并到对应任务状态
    act(() => {
      for (const cb of Array.from(mockListeners.failuresCbs)) {
        cb({
          transferId: 's2s-1',
          type: 's2s',
          serverId: 'srv-1',
          succeeded: 0,
          skipped: 2,
          failures: [
            { path: '/a', error: 'permission denied' },
            { path: '/b', error: 'timeout' },
          ],
        })
      }
    })
    expect(screen.getByText('2 failed')).toBeTruthy()
    expect(
      useTransferQueueStore
        .getState()
        .tasks.find((item) => item.id === 's2s-1')
        ?.children?.map((c) => c.path),
    ).toEqual(['/a', '/b'])
  })

  it('runs tickScheduler interval only while queued or scheduled tasks exist', () => {
    vi.useFakeTimers()
    const tickSpy = vi.spyOn(useTransferQueueStore.getState(), 'tickScheduler')

    renderPanel()
    act(() => {
      vi.advanceTimersByTime(3500)
    })
    expect(tickSpy).not.toHaveBeenCalled()

    // 入队一个定时任务（5 秒后触发），定时器启动
    const scheduledAt = Date.now() + 5000
    act(() => {
      useTransferQueueStore.getState().enqueueTask({
        id: 'sched-1',
        protocol: 'sftp',
        serverId: 'srv-1',
        direction: 'upload',
        fileName: 'nightly.zip',
        totalBytes: 1024,
        scheduledAt,
        startFn: vi.fn().mockResolvedValue(undefined),
      })
    })

    act(() => {
      vi.advanceTimersByTime(2100)
    })
    expect(tickSpy).toHaveBeenCalledTimes(2)

    // 取消后不再存在 scheduled / queued 任务，interval 应停止
    act(() => {
      useTransferQueueStore.getState().cancelTask('sched-1')
    })
    const callsAfterCancel = tickSpy.mock.calls.length
    act(() => {
      vi.advanceTimersByTime(3500)
    })
    expect(tickSpy.mock.calls.length).toBe(callsAfterCancel)

    tickSpy.mockRestore()
  })

  it('renders priority badge, scheduled countdown, filterSummary and supports pause/resume/cancel/remove/clear actions', () => {
    vi.useFakeTimers()
    const now = new Date('2026-11-15T10:00:00Z').getTime()
    vi.setSystemTime(now)

    const startFn = vi.fn().mockResolvedValue(undefined)
    useTransferQueueStore.getState().enqueueTask({
      id: 'dl-sched',
      protocol: 'sftp',
      serverId: 'srv-1',
      direction: 'download',
      fileName: 'logs-bundle.tar',
      totalBytes: 4096,
      priority: 'normal',
      scheduledAt: now + 65_000,
      filterSummary: '*.log, 10~500KB',
      startFn,
    })

    useTransferQueueStore.getState().enqueueTask({
      id: 'dl-paused',
      protocol: 'sftp',
      direction: 'download',
      fileName: 'partial.bin',
      totalBytes: 2048,
      serverId: 'srv-1',
      localPath: 'C:/tmp/partial.bin',
      remotePath: '/var/partial.bin',
      tmpPath: 'C:/tmp/partial.bin.part',
    })
    useTransferQueueStore.getState().upsertFromProgressEvent({
      transferId: 'dl-paused',
      type: 'download',
      fileName: 'partial.bin',
      current: 512,
      total: 2048,
    })

    useTransferQueueStore.getState().enqueueTask({
      id: 'dl-done',
      protocol: 'sftp',
      serverId: 'srv-1',
      direction: 'download',
      fileName: 'done.txt',
      totalBytes: 100,
    })
    useTransferQueueStore.getState().upsertFromProgressEvent({
      transferId: 'dl-done',
      type: 'download',
      fileName: 'done.txt',
      current: 100,
      total: 100,
      done: true,
    })

    renderPanel()

    // 打开面板并切换到下载标签页
    fireEvent.click(screen.getByRole('button', { name: '传输列表' }))
    fireEvent.click(screen.getByRole('tab', { name: /下载/ }))

    // 验证 filterSummary 与定时倒计时文案
    expect(screen.getByText('过滤: *.log, 10~500KB')).toBeTruthy()
    expect(screen.getByText('1m5s 后开始')).toBeTruthy()

    // 切换优先级：中 -> 高 -> 低
    const priorityButtons = screen.getAllByRole('button', { name: /点击切换传输优先级/ })
    expect(priorityButtons[0].textContent).toBe('中')
    fireEvent.click(priorityButtons[0])
    expect(useTransferQueueStore.getState().tasks.find((t) => t.id === 'dl-sched')?.priority).toBe('high')
    fireEvent.click(screen.getAllByRole('button', { name: /点击切换传输优先级/ })[0])
    expect(useTransferQueueStore.getState().tasks.find((t) => t.id === 'dl-sched')?.priority).toBe('low')

    // 暂停进行中的 dl-paused（[0] 为 dl-sched，[1] 为 dl-paused）-> 触发 sshService.cancelTransfer
    const pauseBtns = screen.getAllByRole('button', { name: /暂停传输/ })
    fireEvent.click(pauseBtns[1])
    expect(useTransferQueueStore.getState().tasks.find((t) => t.id === 'dl-paused')?.status).toBe('paused')
    expect(mockSshService.cancelTransfer).toHaveBeenCalledWith('dl-paused')

    // 继续暂停中的 dl-paused -> 触发 sshService.resumeDownload 并登记活跃传输 + 置为 transferring
    fireEvent.click(screen.getByRole('button', { name: /继续/ }))
    expect(useTransferQueueStore.getState().tasks.find((t) => t.id === 'dl-paused')?.status).toBe('transferring')
    expect(mockSshService.registerActiveTransfer).toHaveBeenCalledWith({
      transferId: 'dl-paused',
      serverId: 'srv-1',
      fileName: 'partial.bin',
      type: 'download',
      tmpPath: 'C:/tmp/partial.bin.part',
      isUpload: false,
    })
    expect(mockSshService.resumeDownload).toHaveBeenCalledWith(
      'srv-1',
      '/var/partial.bin',
      'C:/tmp/partial.bin',
      'C:/tmp/partial.bin.part',
      512,
      'dl-paused',
    )

    // 取消定时任务
    const cancelBtns = screen.getAllByRole('button', { name: '取消传输' })
    fireEvent.click(cancelBtns[0])
    expect(useTransferQueueStore.getState().tasks.find((t) => t.id === 'dl-sched')?.status).toBe('cancelled')

    // 清空已完成
    fireEvent.click(screen.getByRole('button', { name: '清空已完成' }))
    expect(useTransferQueueStore.getState().tasks.some((t) => t.id === 'dl-done')).toBe(false)

    // 单项移除已取消项 + 清空全部（先取消活跃传输并广播 qshell:transfer-queue-cleared）
    fireEvent.click(screen.getAllByRole('button', { name: '移除' })[0])
    expect(useTransferQueueStore.getState().tasks.some((t) => t.id === 'dl-sched')).toBe(false)

    const clearedListener = vi.fn()
    window.addEventListener('qshell:transfer-queue-cleared', clearedListener)
    mockSshService.cancelTransfer.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '清空全部' }))
    expect(mockSshService.cancelTransfer).toHaveBeenCalledWith('dl-paused')
    expect(useTransferQueueStore.getState().tasks).toHaveLength(0)
    expect(clearedListener).toHaveBeenCalledTimes(1)
    window.removeEventListener('qshell:transfer-queue-cleared', clearedListener)
  })

  it('formats small single files (<50KB) as bytes instead of file counts, renders partial badge, and cleans tmp file on remove', () => {
    useTransferQueueStore.getState().enqueueTask({
      id: 'small-file',
      protocol: 'sftp',
      serverId: 'srv-1',
      direction: 'upload',
      fileName: 'config.json',
      totalBytes: 2048,
      transferredBytes: 1024,
      totalType: 'bytes',
      status: 'completed',
    })

    useTransferQueueStore.getState().enqueueTask({
      id: 'dir-files',
      protocol: 'sftp',
      serverId: 'srv-1',
      direction: 'upload',
      fileName: 'assets',
      totalBytes: 12,
      transferredBytes: 8,
      isDirectory: true,
      totalType: 'files',
      status: 'partial',
    })

    useTransferQueueStore.getState().enqueueTask({
      id: 'failed-tmp',
      protocol: 'sftp',
      serverId: 'srv-1',
      direction: 'upload',
      fileName: 'broken.iso',
      totalBytes: 102400,
      tmpPath: '/remote/.broken.iso.part',
      status: 'failed',
      error: 'connection lost',
    })

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '传输列表' }))

    // Small single file must display KB, never "个文件"
    expect(screen.getByText('1.0 KB')).toBeTruthy()
    expect(screen.getByText('/2.0 KB')).toBeTruthy()

    // Directory with totalType='files' displays file count
    expect(screen.getByText('/12 个文件')).toBeTruthy()

    // Partial badge is displayed cleanly
    expect(screen.getAllByText('部分成功').length).toBeGreaterThan(0)

    // Removing a failed resumable task cleans up its tmpPath
    const removeButtons = screen.getAllByRole('button', { name: '移除' })
    fireEvent.click(removeButtons[removeButtons.length - 1])
    expect(mockSshService.cleanupTmpFile).toHaveBeenCalledWith(
      'srv-1',
      '/remote/.broken.iso.part',
      true,
    )

    // 清空已完成 also clears partial tasks
    fireEvent.click(screen.getByRole('button', { name: '清空已完成' }))
    expect(useTransferQueueStore.getState().tasks).toHaveLength(0)
  })
})
