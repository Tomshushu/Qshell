import { create } from 'zustand'
import { useEffect } from 'react'
import { sshService } from '@/services/ssh-service'
import type { SystemMetrics, ProcessInfo } from '@/types'

export const MAX_CPU_HISTORY = 120
export const MAX_NET_HISTORY = 120
export const MAX_DISK_IO_HISTORY = 60

export interface NetHistoryPoint {
  rxKbps: number
  txKbps: number
}

export interface DiskIoHistoryPoint {
  idx: number
  [deviceKey: string]: number
}

export type MetricsSubscriptionSpeed = 'high' | 'normal' | 'idle'

export interface ServerMetricsState {
  metrics: SystemMetrics | null
  cpuHistory: number[]
  /** 按网卡名称索引的网络时序历史 (interface -> NetHistoryPoint[]) */
  netHistoryByIface: Record<string, NetHistoryPoint[]>
  /** 磁盘 IO 吞吐与利用率时序历史 */
  diskIoHistory: DiskIoHistoryPoint[]
  /** 共享高频进程快照 (一眼定位高 CPU / 内存消耗根因) */
  topProcesses: ProcessInfo[]
  lastUpdatedAt: number | null
  loading: boolean
  error: string | null
}

const DEFAULT_SERVER_STATE: ServerMetricsState = {
  metrics: null,
  cpuHistory: [],
  netHistoryByIface: {},
  diskIoHistory: [],
  topProcesses: [],
  lastUpdatedAt: null,
  loading: false,
  error: null,
}

interface MetricsStore {
  serverStates: Record<string, ServerMetricsState>
  getServerState: (serverId: string) => ServerMetricsState
  refreshServerMetrics: (serverId: string) => Promise<SystemMetrics | null>
  refreshProcesses: (serverId: string) => Promise<ProcessInfo[]>
  clearServerMetrics: (serverId: string) => void
}

// 调度控制器：内部管理每个服务器的单例轮询定时器与订阅者集合
interface ServerPollContext {
  subscribers: Map<string, MetricsSubscriptionSpeed>
  timer: ReturnType<typeof setInterval> | null
  currentInterval: number | null
  inFlight: boolean
  inFlightProcesses: boolean
  lastProcessFetch: number
}

const pollContexts = new Map<string, ServerPollContext>()

function getOrCreateContext(serverId: string): ServerPollContext {
  let ctx = pollContexts.get(serverId)
  if (!ctx) {
    ctx = {
      subscribers: new Map(),
      timer: null,
      currentInterval: null,
      inFlight: false,
      inFlightProcesses: false,
      lastProcessFetch: 0,
    }
    pollContexts.set(serverId, ctx)
  }
  return ctx
}

function resolveInterval(subscribers: Map<string, MetricsSubscriptionSpeed>): number | null {
  if (subscribers.size === 0) return null
  let hasHigh = false
  let hasNormal = false
  for (const speed of subscribers.values()) {
    if (speed === 'high') {
      hasHigh = true
      break
    }
    if (speed === 'normal') {
      hasNormal = true
    }
  }
  if (hasHigh) return 1000 // 大盘活跃时，1秒高速刷新
  if (hasNormal) return 2500 // 悬浮窗展开态，2.5秒刷新
  return 4000 // 悬浮窗折叠胶囊态，4秒低频刷新
}

function updatePoller(serverId: string) {
  const ctx = getOrCreateContext(serverId)
  const targetInterval = resolveInterval(ctx.subscribers)

  if (targetInterval === null) {
    // 无活跃订阅者，清理定时器
    if (ctx.timer) {
      clearInterval(ctx.timer)
      ctx.timer = null
      ctx.currentInterval = null
    }
    return
  }

  // 如果已在按相同频率运行，无需重建
  if (ctx.timer && ctx.currentInterval === targetInterval) {
    return
  }

  if (ctx.timer) {
    clearInterval(ctx.timer)
  }

  ctx.currentInterval = targetInterval
  ctx.timer = setInterval(() => {
    // 页面不可见（最小化/切换到后台标签）时，完全静默暂停，避免无效消耗 CPU 与 SSH 通道
    if (typeof document !== 'undefined' && document.hidden) return

    // 防重叠发起：上一次采集未完成时跳过，绝不在 SSH 通道排队堆积
    if (ctx.inFlight) return

    void useMetricsStore.getState().refreshServerMetrics(serverId)

    // 间隔 >= 4.5s 顺带低频采集一次进程快照（供悬浮窗与大盘快速定位高资源消耗根因）
    const now = Date.now()
    if (now - ctx.lastProcessFetch >= 4500) {
      void useMetricsStore.getState().refreshProcesses(serverId)
    }
  }, targetInterval)
}

export function registerMetricsSubscriber(
  serverId: string,
  subscriberId: string,
  speed: MetricsSubscriptionSpeed = 'normal',
) {
  if (!serverId) return
  const ctx = getOrCreateContext(serverId)
  ctx.subscribers.set(subscriberId, speed)
  updatePoller(serverId)

  // 首次注册且暂无数据时，立即触发一次静默采集
  const currentState = useMetricsStore.getState().serverStates[serverId]
  if (!currentState?.metrics && !ctx.inFlight) {
    void useMetricsStore.getState().refreshServerMetrics(serverId)
  }
  if (!currentState?.topProcesses?.length && !ctx.inFlightProcesses) {
    void useMetricsStore.getState().refreshProcesses(serverId)
  }
}

export function unregisterMetricsSubscriber(serverId: string, subscriberId: string) {
  if (!serverId) return
  const ctx = pollContexts.get(serverId)
  if (!ctx) return
  ctx.subscribers.delete(subscriberId)
  if (ctx.subscribers.size === 0) {
    updatePoller(serverId)
    pollContexts.delete(serverId)
  } else {
    updatePoller(serverId)
  }
}

export const useMetricsStore = create<MetricsStore>((set, get) => ({
  serverStates: {},

  getServerState: (serverId: string) => {
    return get().serverStates[serverId] || DEFAULT_SERVER_STATE
  },

  refreshServerMetrics: async (serverId: string) => {
    if (!serverId) return null
    const ctx = getOrCreateContext(serverId)
    if (ctx.inFlight) return null
    ctx.inFlight = true

    try {
      const data = await sshService.collectMetrics(serverId)

      set((state) => {
        const prev = state.serverStates[serverId] || DEFAULT_SERVER_STATE

        // 1. CPU 历史
        const nextCpu = [...prev.cpuHistory, data.cpuUsage]
        const cpuHistory =
          nextCpu.length > MAX_CPU_HISTORY ? nextCpu.slice(-MAX_CPU_HISTORY) : nextCpu

        // 2. 网卡按名历史 (保留多网卡独立历史与 'all' 汇总历史)
        const nextNetByIface: Record<string, NetHistoryPoint[]> = { ...prev.netHistoryByIface }
        let totalRx = 0
        let totalTx = 0
        for (const net of data.network || []) {
          const iface = net.interface
          const rx = Math.max(0, net.rxKbps || 0)
          const tx = Math.max(0, net.txKbps || 0)
          totalRx += rx
          totalTx += tx
          const ifacePrev = nextNetByIface[iface] || []
          const nextPoints = [
            ...ifacePrev,
            { rxKbps: rx, txKbps: tx },
          ]
          nextNetByIface[iface] =
            nextPoints.length > MAX_NET_HISTORY ? nextPoints.slice(-MAX_NET_HISTORY) : nextPoints
        }

        const allPrev = nextNetByIface['all'] || []
        const nextAllPoints = [
          ...allPrev,
          { rxKbps: totalRx, txKbps: totalTx },
        ]
        nextNetByIface['all'] =
          nextAllPoints.length > MAX_NET_HISTORY ? nextAllPoints.slice(-MAX_NET_HISTORY) : nextAllPoints

        // 3. 磁盘 IO 历史
        const ioPoint: DiskIoHistoryPoint = { idx: prev.diskIoHistory.length }
        for (const disk of data.diskIo || []) {
          ioPoint[`${disk.device}:throughput`] =
            Math.max(0, disk.readMbps) + Math.max(0, disk.writeMbps)
          ioPoint[`${disk.device}:read`] = Math.max(0, disk.readMbps)
          ioPoint[`${disk.device}:write`] = Math.max(0, disk.writeMbps)
          ioPoint[`${disk.device}:util`] = Math.max(0, disk.util * 100)
        }
        const nextIo = [...prev.diskIoHistory, ioPoint].map((item, index) => ({
          ...item,
          idx: index,
        }))
        const diskIoHistory =
          nextIo.length > MAX_DISK_IO_HISTORY
            ? nextIo.slice(-MAX_DISK_IO_HISTORY).map((item, index) => ({ ...item, idx: index }))
            : nextIo

        return {
          serverStates: {
            ...state.serverStates,
            [serverId]: {
              ...prev,
              metrics: data,
              cpuHistory,
              netHistoryByIface: nextNetByIface,
              diskIoHistory,
              lastUpdatedAt: Date.now(),
              loading: false,
              error: null,
            },
          },
        }
      })

      return data
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      set((state) => {
        const prev = state.serverStates[serverId] || DEFAULT_SERVER_STATE
        return {
          serverStates: {
            ...state.serverStates,
            [serverId]: {
              ...prev,
              loading: false,
              error: msg,
            },
          },
        }
      })
      return null
    } finally {
      ctx.inFlight = false
    }
  },

  refreshProcesses: async (serverId: string) => {
    if (!serverId) return []
    const ctx = getOrCreateContext(serverId)
    if (ctx.inFlightProcesses) return get().serverStates[serverId]?.topProcesses || []
    ctx.inFlightProcesses = true
    try {
      const data = await sshService.listProcesses(serverId)
      set((state) => {
        const prev = state.serverStates[serverId] || DEFAULT_SERVER_STATE
        return {
          serverStates: {
            ...state.serverStates,
            [serverId]: {
              ...prev,
              topProcesses: data,
            },
          },
        }
      })
      ctx.lastProcessFetch = Date.now()
      return data
    } catch {
      return get().serverStates[serverId]?.topProcesses || []
    } finally {
      ctx.inFlightProcesses = false
    }
  },

  clearServerMetrics: (serverId: string) => {
    set((state) => {
      const next = { ...state.serverStates }
      delete next[serverId]
      return { serverStates: next }
    })
  },
}))

/**
 * 订阅服务器系统指标 Hook
 * 统一调度单例轮询器，消除并发轮询导致的数据冲突与差分计算抖动
 */
export function useMetricsSubscription(
  serverId: string | undefined,
  active: boolean,
  speed: MetricsSubscriptionSpeed = 'normal',
) {
  useEffect(() => {
    if (!serverId || !active) return
    const subId = Math.random().toString(36).slice(2)
    registerMetricsSubscriber(serverId, subId, speed)
    return () => {
      unregisterMetricsSubscriber(serverId, subId)
    }
  }, [serverId, active, speed])
}
