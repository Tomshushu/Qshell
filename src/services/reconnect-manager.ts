/**
 * 全局统一重连管理器 (ReconnectManager)
 *
 * 功能规范（参考市面成熟产品 Termius / VS Code Remote-SSH）：
 * 1. 自动退避重连（Auto-reconnect with Exponential Backoff）：
 *    - 最大重试次数：3 次（MAX_RECONNECT_ATTEMPTS = 3）
 *    - 退避间隔：2s、4s、8s（RETRY_DELAYS_SEC = [2, 4, 8]）
 *    - 倒计时与状态可视化（idle | countdown | reconnecting | exhausted）
 *    - 熔断保护：认证失败、HostKey 不匹配等不可恢复错误直接放弃，不刷连接
 *    - 手动断开（manualDisconnect）不触发自动重连
 * 2. 笔记本休眠唤醒感知（Sleep / Wake-up Detection）：
 *    - 1 秒低开销时钟探针（Heartbeat Clock Drift：delta > 3500ms 判定为系统休眠挂起并唤醒）
 *    - 协同监听 online（网络恢复）与 visibilitychange（标签页可见）事件
 *    - 唤醒后秒级主动探活（调用 Rust 后端 ssh_probe_connections）
 *    - 若处于倒计时或意外断线状态，唤醒后立即打断等待触发第 1 次重连（开盖即连）
 * 3. 工作台与 SFTP 状态统一：
 *    - 统一单例，跨模块共享重连状态，避免重复请求
 */

import { useSyncExternalStore } from 'react'
import { sshService } from './ssh-service'
import { ConnectionState, SshErrorKind, shouldRetry } from './ssh-connection-state'
import { useAppStore } from '@/store'

export const MAX_RECONNECT_ATTEMPTS = 3
export const RETRY_DELAYS_SEC = [2, 4, 8]

export type ReconnectStatus = 'idle' | 'countdown' | 'reconnecting' | 'exhausted'

export interface ReconnectState {
  status: ReconnectStatus
  attempt: number
  maxAttempts: number
  remainingSec: number
  error?: string | null
  errorKind?: SshErrorKind | null
}

const DEFAULT_STATE: Readonly<ReconnectState> = Object.freeze({
  status: 'idle',
  attempt: 0,
  maxAttempts: MAX_RECONNECT_ATTEMPTS,
  remainingSec: 0,
  error: null,
  errorKind: null,
})

type Listener = (state: ReconnectState) => void

class ReconnectManager {
  private states = new Map<string, ReconnectState>()
  private countdownTimers = new Map<string, ReturnType<typeof setInterval>>()
  private listeners = new Map<string, Set<Listener>>()
  private globalListeners = new Set<() => void>()
  private lastTick = Date.now()
  private isInitialized = false

  constructor() {
    this.initSleepDetection()
    this.initSshStateListener()
  }

  /**
   * 初始化休眠唤醒检测
   */
  private initSleepDetection() {
    if (typeof window === 'undefined') return

    // 1. 时钟心跳漂移检测（Clock Drift）：休眠时 JS 定时器挂起
    setInterval(() => {
      const now = Date.now()
      const delta = now - this.lastTick
      this.lastTick = now

      // 间隔超过 3500ms（正常应约为 1000ms），说明系统经历了休眠唤醒
      if (delta > 3500) {
        console.warn(`[ReconnectManager] System sleep/wake-up detected (delta: ${delta}ms). Triggering probe in 1.5s...`)
        // 唤醒后延迟 1.5s 给予操作系统网络栈与 Wi-Fi DHCP 重新建立网络连接的时间
        setTimeout(() => {
          this.handleSystemWakeUp('clock_drift')
        }, 1500)
      }
    }, 1000)

    // 2. 操作系统网络恢复事件
    window.addEventListener('online', () => {
      console.log('[ReconnectManager] Network is online. Triggering probe in 1.5s...')
      setTimeout(() => {
        this.handleSystemWakeUp('network_online')
      }, 1500)
    })

    // 3. 标签页/窗口重新聚焦与可见
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now()
        if (now - this.lastTick > 2000) {
          console.log('[ReconnectManager] App became visible. Checking connections...')
          this.handleSystemWakeUp('visibility_change')
        }
      }
    })
  }

  /**
   * 监听全局 SSH 状态流转
   */
  private initSshStateListener() {
    if (this.isInitialized) return
    this.isInitialized = true

    sshService.onStateChanged((data) => {
      const serverId = data.serverId
      const current = this.getState(serverId)

      if (data.state === ConnectionState.Ready) {
        // 连接成功：重置重连状态
        this.reset(serverId)
        return
      }

      if (data.state === ConnectionState.Disconnected || data.state === ConnectionState.Failed) {
        const store = useAppStore.getState()
        const baseServerId = serverId.startsWith('ws:')
          ? serverId.slice(3).split(':')[0]
          : serverId.startsWith('sftp:')
            ? serverId.slice(5)
            : serverId
        const server = store.servers.find((s) => s.id === baseServerId)
        if (server?.protocol === 'serial' || server?.protocol === 'rdp') {
          return
        }
        const isManual = store.manualDisconnect[serverId] ?? false
        const autoReconnectEnabled = store.terminalAutoReconnect ?? false

        // 检查是否支持自动重试
        const canRetry = shouldRetry(data.errorKind as SshErrorKind | undefined)

        if (!canRetry) {
          this.setState(serverId, {
            status: 'exhausted',
            attempt: current.attempt,
            maxAttempts: MAX_RECONNECT_ATTEMPTS,
            remainingSec: 0,
            error: data.error,
            errorKind: data.errorKind as SshErrorKind | null,
          })
          return
        }

        if (isManual || !autoReconnectEnabled) {
          this.setState(serverId, {
            ...DEFAULT_STATE,
            error: data.error,
            errorKind: data.errorKind as SshErrorKind | null,
          })
          return
        }

        // 仅在当前未处于重试或倒计时中时发起自动重试
        if (current.status === 'idle') {
          this.scheduleNextAttempt(serverId, data.error, data.errorKind as SshErrorKind | null)
        }
      }
    })
  }

  /**
   * 系统休眠唤醒 / 网络恢复处理逻辑
   */
  public async handleSystemWakeUp(source: string) {
    try {
      // 1. 调用 Rust 后端主动探针，并发秒级探测并清理死连接
      const deadServers = await sshService.probeConnections()
      if (deadServers && deadServers.length > 0) {
        console.log(`[ReconnectManager] probeConnections found ${deadServers.length} dead servers:`, deadServers)
        // 对于当前打开但被判定为死连接的服务器，如果未被手动断开，自动触发重试
        const store = useAppStore.getState()
        for (const serverId of deadServers) {
          const isManual = store.manualDisconnect[serverId] ?? false
          if (!isManual) {
            this.retryImmediately(serverId)
          }
        }
      }
    } catch (err) {
      console.error('[ReconnectManager] probeConnections failed on wake up:', err)
    }

    // 2. 对于当前正处于倒计时中的会话，立即打断等待，执行重连
    for (const [serverId, state] of this.states.entries()) {
      if (state.status === 'countdown') {
        console.log(`[ReconnectManager] Accelerating reconnect for ${serverId} on wake up (${source})`)
        this.retryImmediately(serverId)
      }
    }
  }

  /**
   * 获取指定服务器的当前重连状态（保证默认状态引用恒定，防止 useSyncExternalStore 无限重渲染）
   */
  public getState(serverId: string): ReconnectState {
    return this.states.get(serverId) ?? DEFAULT_STATE
  }

  /**
   * 订阅指定服务器的重连状态变化
   */
  public subscribe(serverId: string, listener: Listener): () => void {
    if (!this.listeners.has(serverId)) {
      this.listeners.set(serverId, new Set())
    }
    this.listeners.get(serverId)!.add(listener)

    return () => {
      const set = this.listeners.get(serverId)
      if (set) {
        set.delete(listener)
        if (set.size === 0) {
          this.listeners.delete(serverId)
        }
      }
    }
  }

  /**
   * 订阅任意服务器状态变化（全局通知）
   */
  public subscribeGlobal(listener: () => void): () => void {
    this.globalListeners.add(listener)
    return () => {
      this.globalListeners.delete(listener)
    }
  }

  /**
   * 安排下一次重试（退避调度与秒级倒计时）
   */
  public scheduleNextAttempt(
    serverId: string,
    error?: string | null,
    errorKind?: SshErrorKind | null,
  ) {
    this.clearTimer(serverId)

    const current = this.getState(serverId)
    const nextAttempt = current.attempt + 1

    if (nextAttempt > MAX_RECONNECT_ATTEMPTS) {
      this.setState(serverId, {
        status: 'exhausted',
        attempt: current.attempt,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
        remainingSec: 0,
        error: error ?? current.error,
        errorKind: errorKind ?? current.errorKind,
      })
      return
    }

    const delaySec = RETRY_DELAYS_SEC[nextAttempt - 1] ?? 8

    this.setState(serverId, {
      status: 'countdown',
      attempt: nextAttempt,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
      remainingSec: delaySec,
      error: error ?? current.error,
      errorKind: errorKind ?? current.errorKind,
    })

    let remaining = delaySec
    const timer = setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        this.clearTimer(serverId)
        this.executeReconnect(serverId)
      } else {
        const state = this.getState(serverId)
        if (state.status === 'countdown') {
          this.setState(serverId, {
            ...state,
            remainingSec: remaining,
          })
        }
      }
    }, 1000)

    this.countdownTimers.set(serverId, timer)
  }

  /**
   * 立即重试（用户手动点击或休眠唤醒加速）
   */
  public retryImmediately(serverId: string) {
    this.clearTimer(serverId)
    const current = this.getState(serverId)
    const attempt = current.attempt === 0 ? 1 : current.attempt

    this.setState(serverId, {
      ...current,
      status: 'reconnecting',
      attempt,
      remainingSec: 0,
    })

    this.executeReconnect(serverId)
  }

  /**
   * 执行实际连接动作
   */
  private async executeReconnect(serverId: string) {
    const current = this.getState(serverId)
    this.setState(serverId, {
      ...current,
      status: 'reconnecting',
      remainingSec: 0,
    })

    try {
      const res = await sshService.connect(serverId)
      if (res.success) {
        this.reset(serverId)
      } else {
        // 连接返回失败，继续退避下一轮
        this.scheduleNextAttempt(serverId, res.error, null)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.scheduleNextAttempt(serverId, msg, null)
    }
  }

  /**
   * 取消自动重试（用户主动点击取消）
   */
  public cancelRetry(serverId: string) {
    this.clearTimer(serverId)
    this.setState(serverId, {
      status: 'idle',
      attempt: 0,
      maxAttempts: MAX_RECONNECT_ATTEMPTS,
      remainingSec: 0,
    })
  }

  /**
   * 重置服务器重连状态（连接成功或切换时）
   */
  public reset(serverId: string) {
    this.clearTimer(serverId)
    if (this.states.has(serverId)) {
      this.states.delete(serverId)
      // 通知该 serverId 的专属监听器
      const listeners = this.listeners.get(serverId)
      if (listeners) {
        listeners.forEach((fn) => fn(DEFAULT_STATE))
      }
      this.globalListeners.forEach((fn) => fn())
    }
  }

  private clearTimer(serverId: string) {
    const timer = this.countdownTimers.get(serverId)
    if (timer) {
      clearInterval(timer)
      this.countdownTimers.delete(serverId)
    }
  }

  private setState(serverId: string, next: ReconnectState) {
    const prev = this.states.get(serverId)
    if (
      prev &&
      prev.status === next.status &&
      prev.attempt === next.attempt &&
      prev.remainingSec === next.remainingSec &&
      prev.error === next.error &&
      prev.errorKind === next.errorKind
    ) {
      return
    }

    this.states.set(serverId, next)

    // 通知该 serverId 的专属监听器
    const listeners = this.listeners.get(serverId)
    if (listeners) {
      listeners.forEach((fn) => fn(next))
    }

    // 通知全局监听器
    this.globalListeners.forEach((fn) => fn())
  }
}

export const reconnectManager = new ReconnectManager()

/**
 * React Hook：订阅指定服务器的重连状态（基于 useSyncExternalStore，零撕裂高效率）
 */
export function useReconnectState(serverId: string | undefined | null): ReconnectState {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!serverId) return () => {}
      return reconnectManager.subscribe(serverId, () => onStoreChange())
    },
    () => {
      if (!serverId) return DEFAULT_STATE
      return reconnectManager.getState(serverId)
    },
    () => DEFAULT_STATE,
  )
}
