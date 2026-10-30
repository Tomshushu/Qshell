import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './index'
import { ConnectionState } from '@/services/ssh-connection-state'
import type { ServerStateEntry } from './types'

/**
 * server-slice 连接状态机的纯逻辑测试。
 *
 * 固化「connectedServers 由 setServerState 同步派生」这一契约：
 * 正是 terminal 组件断线时漏调 setServerState(Disconnected)，
 * 才导致 SSH 断开后顶部标签仍误显示"在线"。
 */

function resetStore() {
  useAppStore.setState({ connectedServers: {}, serverStates: {}, manualDisconnect: {} })
}

function state() {
  return useAppStore.getState()
}

describe('server-slice connection state', () => {
  beforeEach(resetStore)

  it('setServerState(Ready) marks the server as connected', () => {
    state().setServerState('s1', ConnectionState.Ready)

    expect(state().connectedServers['s1']).toBe(true)
    expect(state().serverStates['s1'].state).toBe(ConnectionState.Ready)
  })

  it('setServerState(Disconnected) clears the connected flag', () => {
    state().setServerState('s1', ConnectionState.Ready)
    state().setServerState('s1', ConnectionState.Disconnected)

    expect(state().connectedServers['s1']).toBe(false)
    expect(state().serverStates['s1'].state).toBe(ConnectionState.Disconnected)
  })

  it('non-ready states are never marked connected', () => {
    for (const s of [
      ConnectionState.Disconnected,
      ConnectionState.Connecting,
      ConnectionState.Authenticating,
      ConnectionState.Disconnecting,
      ConnectionState.Failed,
    ]) {
      state().setServerState('s2', s)
      expect(state().connectedServers['s2']).toBe(false)
    }
  })

  it('works with workspace-scoped conn ids (ws:...)', () => {
    state().setServerState('ws:s1:t1', ConnectionState.Ready)
    expect(state().connectedServers['ws:s1:t1']).toBe(true)

    state().setServerState('ws:s1:t1', ConnectionState.Disconnected)
    expect(state().connectedServers['ws:s1:t1']).toBe(false)
  })

  it('drops stale events with a lower generation', () => {
    state().setServerState('s1', ConnectionState.Ready, undefined, undefined, 5)
    state().setServerState('s1', ConnectionState.Disconnected, undefined, undefined, 3)

    // 旧事件被丢弃，状态不回退
    expect(state().serverStates['s1'].state).toBe(ConnectionState.Ready)
    expect(state().connectedServers['s1']).toBe(true)
  })

  it('accepts equal-generation events', () => {
    state().setServerState('s1', ConnectionState.Ready, undefined, undefined, 5)
    state().setServerState('s1', ConnectionState.Disconnected, undefined, undefined, 5)

    expect(state().serverStates['s1'].state).toBe(ConnectionState.Disconnected)
    expect(state().connectedServers['s1']).toBe(false)
  })

  it('clearServerState removes the entry entirely', () => {
    state().setServerState('s1', ConnectionState.Ready)
    state().clearServerState('s1')

    expect(state().serverStates['s1']).toBeUndefined()
    expect(state().connectedServers['s1']).toBeUndefined()
  })

  it('syncServerStates derives connectedServers from entries', () => {
    const entries: Record<string, ServerStateEntry> = {
      a: { state: ConnectionState.Ready, generation: 1 },
      b: { state: ConnectionState.Disconnected, generation: 1 },
    }
    state().syncServerStates(entries)

    expect(state().connectedServers['a']).toBe(true)
    expect(state().connectedServers['b']).toBe(false)
  })
})
