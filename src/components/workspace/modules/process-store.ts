import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { sshService } from '@/services/ssh-service'
import type { ProcessInfo } from '@/types'

export interface ProcessStoreState {
  processes: ProcessInfo[]
  error: string | null
  loading: boolean
}

interface ServerProcessStore {
  state: ProcessStoreState
  listeners: Set<() => void>
  timer: ReturnType<typeof setInterval> | null
  currentIntervalMs: number | null
  refreshers: Map<symbol, number>
}

const DEFAULT_STATE: ProcessStoreState = { processes: [], error: null, loading: false }
const serverStores = new Map<string, ServerProcessStore>()

function getOrCreateStore(serverId: string): ServerProcessStore {
  let store = serverStores.get(serverId)
  if (!store) {
    store = {
      state: { ...DEFAULT_STATE },
      listeners: new Set(),
      timer: null,
      currentIntervalMs: null,
      refreshers: new Map(),
    }
    serverStores.set(serverId, store)
  }
  return store
}

function emit(store: ServerProcessStore) {
  for (const l of store.listeners) l()
}

async function load(serverId: string) {
  const store = serverStores.get(serverId)
  if (!store) return
  try {
    const data = await sshService.listProcesses(serverId)
    const current = serverStores.get(serverId)
    if (current) {
      current.state = { processes: data, error: null, loading: false }
      emit(current)
    }
  } catch (err) {
    const current = serverStores.get(serverId)
    if (current) {
      current.state = {
        ...current.state,
        error: err instanceof Error ? err.message : 'load failed',
        loading: false,
      }
      emit(current)
    }
  }
}

function updateTimer(serverId: string) {
  const store = serverStores.get(serverId)
  if (!store) return

  if (store.refreshers.size === 0) {
    if (store.timer) {
      clearInterval(store.timer)
      store.timer = null
      store.currentIntervalMs = null
    }
    return
  }

  // 计算所有活跃刷新者要求的最小刷新间隔
  let minInterval = Infinity
  for (const interval of store.refreshers.values()) {
    if (interval < minInterval) minInterval = interval
  }

  // 若当前定时器间隔相同且已在运行，无需重新创建
  if (store.timer && store.currentIntervalMs === minInterval) {
    return
  }

  if (store.timer) {
    clearInterval(store.timer)
  }

  store.currentIntervalMs = minInterval
  store.state = { ...store.state, loading: true }
  emit(store)
  void load(serverId)
  store.timer = setInterval(() => void load(serverId), minInterval)
}

function checkGarbageCollect(serverId: string) {
  const store = serverStores.get(serverId)
  if (!store) return
  if (store.listeners.size === 0 && store.refreshers.size === 0) {
    if (store.timer) {
      clearInterval(store.timer)
      store.timer = null
    }
    serverStores.delete(serverId)
  }
}

/** 手动触发一次快照刷新（不影响自动刷新定时器）。 */
export function refreshProcessSnapshot(serverId: string) {
  void load(serverId)
}

/** 供测试与断开连接时手动清理指定服务器的 Store 实例 */
export function clearProcessSnapshotStore(serverId?: string) {
  if (serverId) {
    const store = serverStores.get(serverId)
    if (store?.timer) clearInterval(store.timer)
    serverStores.delete(serverId)
  } else {
    for (const store of serverStores.values()) {
      if (store.timer) clearInterval(store.timer)
    }
    serverStores.clear()
  }
}

/**
 * 订阅进程快照（隔离多 serverId 与分屏场景）。
 * @param serverId     当前服务器
 * @param intervalMs   自动刷新间隔（毫秒）
 * @param autoRefresh  是否启用自动刷新（关闭时仅做一次性加载）
 */
export function useProcessSnapshot(
  serverId: string,
  intervalMs: number,
  autoRefresh: boolean,
): ProcessStoreState {
  const [refresherKey] = useState(() => Symbol('process-refresher'))

  const subscribe = useCallback((cb: () => void) => {
    const store = getOrCreateStore(serverId)
    store.listeners.add(cb)
    return () => {
      const current = serverStores.get(serverId)
      if (current) {
        current.listeners.delete(cb)
        checkGarbageCollect(serverId)
      }
    }
  }, [serverId])

  const getSnapshot = useCallback(() => {
    return serverStores.get(serverId)?.state ?? DEFAULT_STATE
  }, [serverId])

  useEffect(() => {
    const store = getOrCreateStore(serverId)
    if (autoRefresh) {
      store.refreshers.set(refresherKey, intervalMs)
      updateTimer(serverId)
    } else {
      store.refreshers.delete(refresherKey)
      updateTimer(serverId)
      void load(serverId)
    }

    return () => {
      const current = serverStores.get(serverId)
      if (current) {
        current.refreshers.delete(refresherKey)
        updateTimer(serverId)
        checkGarbageCollect(serverId)
      }
    }
  }, [serverId, intervalMs, autoRefresh, refresherKey])

  return useSyncExternalStore(subscribe, getSnapshot)
}
