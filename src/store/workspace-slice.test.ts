import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './index'
import type { Server, WorkspaceTab } from '@/types'

/**
 * workspace-slice 的纯逻辑测试：只操作 store 状态，不触碰任何生产代码。
 * 覆盖标签重排、复制、窗口状态恢复、合并，以及广播批量选择的目标过滤规则。
 */

function resetStore() {
  useAppStore.setState({
    servers: [],
    tabs: [],
    groups: {},
    layout: null,
    activeTabId: null,
    lastActiveGroupId: null,
    broadcastTabIds: [],
    workspaces: {},
    tabColors: {},
  })
}

function state() {
  return useAppStore.getState()
}

function tabIds() {
  return state().tabs.map((t) => t.id)
}

function makeServer(id: string, over: Partial<Server> = {}): Server {
  return {
    id,
    name: id,
    host: '127.0.0.1',
    port: 22,
    username: 'root',
    authType: 'password',
    tags: [],
    favorite: false,
    status: 'unknown',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

function makeTab(over: Partial<WorkspaceTab> & { id: string }): WorkspaceTab {
  return {
    serverId: 'srv-1',
    serverName: 'srv-1',
    module: 'terminal',
    title: over.id,
    ...over,
  }
}

describe('workspace-slice', () => {
  beforeEach(resetStore)

  describe('reorderTabs', () => {
    it('moves a top-level tab before the target', () => {
      useAppStore.setState({
        tabs: [makeTab({ id: 'a' }), makeTab({ id: 'b' }), makeTab({ id: 'c' })],
      })
      state().reorderTabs('c', 'a', 'before')
      expect(tabIds()).toEqual(['c', 'a', 'b'])
    })

    it('moves a top-level tab after the target', () => {
      useAppStore.setState({
        tabs: [makeTab({ id: 'a' }), makeTab({ id: 'b' }), makeTab({ id: 'c' })],
      })
      state().reorderTabs('a', 'c', 'after')
      expect(tabIds()).toEqual(['b', 'c', 'a'])
    })

    it('is a no-op for unknown or identical ids', () => {
      useAppStore.setState({ tabs: [makeTab({ id: 'a' }), makeTab({ id: 'b' })] })

      state().reorderTabs('a', 'missing', 'before')
      expect(tabIds()).toEqual(['a', 'b'])

      state().reorderTabs('a', 'a', 'before')
      expect(tabIds()).toEqual(['a', 'b'])
    })

    it('moves a whole workspace block relative to remaining tabs', () => {
      useAppStore.setState({
        tabs: [
          makeTab({ id: 'x1', workspaceId: 'ws-1' }),
          makeTab({ id: 'x2', workspaceId: 'ws-1' }),
          makeTab({ id: 'y' }),
          makeTab({ id: 'z' }),
        ],
      })
      // workspace 内的标签整块移动，不能拆散
      state().reorderTabs('x1', 'z', 'before')
      expect(tabIds()).toEqual(['y', 'x1', 'x2', 'z'])
    })

    it('keeps workspace tabs together when moving after a tab', () => {
      useAppStore.setState({
        tabs: [
          makeTab({ id: 'y' }),
          makeTab({ id: 'x1', workspaceId: 'ws-1' }),
          makeTab({ id: 'x2', workspaceId: 'ws-1' }),
        ],
      })
      state().reorderTabs('x1', 'y', 'after')
      expect(tabIds()).toEqual(['y', 'x1', 'x2'])
    })
  })

  describe('duplicateTab', () => {
    it('inserts the copy right after the source and activates it', () => {
      useAppStore.setState({
        tabs: [makeTab({ id: 'a' }), makeTab({ id: 'b', serverId: 'srv-2' })],
        tabColors: { 'srv-2': '#ff0000' },
      })
      state().duplicateTab('b')
      const s = state()
      expect(s.tabs).toHaveLength(3)
      expect(s.tabs[1].id).toBe('b')

      const dup = s.tabs[2]
      expect(dup.id).not.toBe('b')
      expect(dup.serverId).toBe('srv-2')
      expect(dup.module).toBe('terminal')
      expect(dup.color).toBe('#ff0000')
      expect(s.activeTabId).toBe(dup.id)
    })

    it('does not inherit locked flag or temporary title', () => {
      useAppStore.setState({
        tabs: [makeTab({ id: 'a', locked: true, tempTitle: '临时名' })],
      })
      state().duplicateTab('a')
      const dup = state().tabs[1]
      expect(dup.locked).toBe(false)
      expect(dup.tempTitle).toBeUndefined()
    })

    it('is a no-op for an unknown tab', () => {
      useAppStore.setState({ tabs: [makeTab({ id: 'a' })] })
      state().duplicateTab('missing')
      expect(state().tabs).toHaveLength(1)
    })
  })

  describe('restoreWindowState', () => {
    it('puts every restored tab into a single new group', () => {
      state().restoreWindowState([makeTab({ id: 'r1' }), makeTab({ id: 'r2' })], 'r2')
      const s = state()
      expect(s.tabs).toHaveLength(2)
      expect(new Set(s.tabs.map((t) => t.groupId)).size).toBe(1)
      expect(s.activeTabId).toBe('r2')
      expect(Object.keys(s.groups)).toHaveLength(1)
      expect(s.layout?.type).toBe('group')
    })
  })

  describe('mergeTab', () => {
    it('activates an existing tab instead of duplicating it', () => {
      useAppStore.setState({ tabs: [makeTab({ id: 'm1' }), makeTab({ id: 'm2' })] })
      state().mergeTab(makeTab({ id: 'm1' }))
      expect(state().tabs).toHaveLength(2)
      expect(state().activeTabId).toBe('m1')
    })
  })

  describe('broadcast target filtering', () => {
    it('broadcastAllTabs only picks terminal tabs on broadcastable servers', () => {
      useAppStore.setState({
        servers: [
          makeServer('ssh-1'),
          makeServer('serial-1', { targetType: 'serial' }),
          makeServer('rdp-1', { protocol: 'rdp' }),
        ],
        tabs: [
          makeTab({ id: 't-ssh', serverId: 'ssh-1' }),
          makeTab({ id: 't-serial', serverId: 'serial-1' }),
          makeTab({ id: 't-rdp', serverId: 'rdp-1' }),
          makeTab({ id: 't-files', serverId: 'ssh-1', module: 'files' }),
          makeTab({ id: 't-orphan', serverId: 'no-such-server' }),
        ],
      })
      state().broadcastAllTabs()
      expect(state().broadcastTabIds).toEqual(['t-ssh'])
    })

    it('broadcastAllTabs ignores protocol "serial" as well as targetType', () => {
      useAppStore.setState({
        servers: [makeServer('s1', { protocol: 'serial' }), makeServer('s2')],
        tabs: [
          makeTab({ id: 'a', serverId: 's1' }),
          makeTab({ id: 'b', serverId: 's2' }),
        ],
      })
      state().broadcastAllTabs()
      expect(state().broadcastTabIds).toEqual(['b'])
    })

    it('broadcastToSplit only targets tabs in the same workspace', () => {
      useAppStore.setState({
        servers: [makeServer('ssh-1')],
        tabs: [
          makeTab({ id: 'w1', serverId: 'ssh-1', workspaceId: 'ws-1' }),
          makeTab({ id: 'w2', serverId: 'ssh-1', workspaceId: 'ws-1' }),
          makeTab({ id: 'other', serverId: 'ssh-1', workspaceId: 'ws-2' }),
        ],
      })
      state().broadcastToSplit('w1')
      expect([...state().broadcastTabIds].sort()).toEqual(['w1', 'w2'])
    })

    it('broadcastToSplit falls back to itself for a top-level tab', () => {
      useAppStore.setState({
        servers: [makeServer('ssh-1')],
        tabs: [
          makeTab({ id: 'solo', serverId: 'ssh-1', workspaceId: null }),
          makeTab({ id: 'solo2', serverId: 'ssh-1' }),
        ],
      })
      state().broadcastToSplit('solo')
      expect(state().broadcastTabIds).toEqual(['solo'])
    })

    it('broadcastToSplit excludes serial targets inside the same workspace', () => {
      useAppStore.setState({
        servers: [makeServer('ssh-1'), makeServer('serial-1', { targetType: 'serial' })],
        tabs: [
          makeTab({ id: 'a', serverId: 'ssh-1', workspaceId: 'ws-x' }),
          makeTab({ id: 'b', serverId: 'serial-1', workspaceId: 'ws-x' }),
        ],
      })
      state().broadcastToSplit('a')
      expect(state().broadcastTabIds).toEqual(['a'])
    })

    it('clearBroadcast empties the list', () => {
      useAppStore.setState({ broadcastTabIds: ['a', 'b'] })
      state().clearBroadcast()
      expect(state().broadcastTabIds).toEqual([])
    })
  })
})
