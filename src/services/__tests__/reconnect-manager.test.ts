import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  reconnectManager,
  MAX_RECONNECT_ATTEMPTS,
  RETRY_DELAYS_SEC,
} from '../reconnect-manager'
import { sshService } from '../ssh-service'
import { SshErrorKind } from '../ssh-connection-state'

vi.mock('@/services/ssh-service', () => ({
  sshService: {
    isAvailable: vi.fn(() => true),
    connect: vi.fn(),
    probeConnections: vi.fn().mockResolvedValue([]),
    onStateChanged: vi.fn(() => () => {}),
  },
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: vi.fn(() => ({
      servers: [{ id: 'srv-1', protocol: 'ssh' }],
      manualDisconnect: {},
      terminalAutoReconnect: true,
    })),
  },
}))

describe('ReconnectManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    reconnectManager.reset('srv-1')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('初始状态为 idle', () => {
    const state = reconnectManager.getState('srv-1')
    expect(state.status).toBe('idle')
    expect(state.attempt).toBe(0)
    expect(state.maxAttempts).toBe(MAX_RECONNECT_ATTEMPTS)
  })

  it('第 1 次调度重试应设置 2s 倒计时 (attempt=1)', () => {
    reconnectManager.scheduleNextAttempt('srv-1', 'network error', SshErrorKind.NetworkError)
    const state = reconnectManager.getState('srv-1')
    expect(state.status).toBe('countdown')
    expect(state.attempt).toBe(1)
    expect(state.remainingSec).toBe(RETRY_DELAYS_SEC[0]) // 2s
  })

  it('倒计时随时间自减，归零时执行重连', async () => {
    const connectSpy = vi.spyOn(sshService, 'connect').mockResolvedValue({ success: true })

    reconnectManager.scheduleNextAttempt('srv-1', 'timeout', SshErrorKind.Timeout)
    expect(reconnectManager.getState('srv-1').remainingSec).toBe(2)

    // 前进 1 秒
    vi.advanceTimersByTime(1000)
    expect(reconnectManager.getState('srv-1').remainingSec).toBe(1)

    // 前进 1 秒（达到 2 秒，触发连接）
    vi.advanceTimersByTime(1000)
    expect(connectSpy).toHaveBeenCalledWith('srv-1')
  })

  it('重试超过 3 次后自动停机进入 exhausted 状态', () => {
    // 模拟前 3 次重试
    reconnectManager.scheduleNextAttempt('srv-1')
    reconnectManager.scheduleNextAttempt('srv-1')
    reconnectManager.scheduleNextAttempt('srv-1')

    expect(reconnectManager.getState('srv-1').attempt).toBe(3)

    // 第 4 次尝试超过上限
    reconnectManager.scheduleNextAttempt('srv-1')
    const finalState = reconnectManager.getState('srv-1')
    expect(finalState.status).toBe('exhausted')
    expect(finalState.attempt).toBe(3)
  })

  it('点击取消重试能够清理定时器并恢复 idle', () => {
    reconnectManager.scheduleNextAttempt('srv-1')
    expect(reconnectManager.getState('srv-1').status).toBe('countdown')

    reconnectManager.cancelRetry('srv-1')
    expect(reconnectManager.getState('srv-1').status).toBe('idle')
  })

  it('系统休眠唤醒探测能够打断倒计时立即触发重试', async () => {
    const connectSpy = vi.spyOn(sshService, 'connect').mockResolvedValue({ success: true })
    const probeSpy = vi.spyOn(sshService, 'probeConnections').mockResolvedValue(['srv-1'])

    // 进入 8 秒倒计时
    reconnectManager.scheduleNextAttempt('srv-1')
    expect(reconnectManager.getState('srv-1').status).toBe('countdown')

    // 触发休眠唤醒
    await reconnectManager.handleSystemWakeUp('clock_drift')

    expect(probeSpy).toHaveBeenCalled()
    expect(connectSpy).toHaveBeenCalledWith('srv-1')
  })
})
