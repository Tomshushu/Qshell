import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadWorkspaceSession,
  saveWorkspaceSession,
  getSerialPortName,
  newGroupId,
  newWorkspaceId,
  resolveTargetGroupId,
  pruneWorkspaces,
} from './workspace-helpers'
import type { Server, WorkspaceTab, TabGroup, WorkspaceDef } from '@/types'

function makeTab(id: string, over: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return {
    id,
    serverId: 'srv-1',
    serverName: 'Server 1',
    module: 'terminal',
    title: id,
    ...over,
  }
}

describe('workspace-helpers', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  describe('session storage persistence', () => {
    it('returns null when no session is saved or JSON is corrupt', () => {
      expect(loadWorkspaceSession()).toBeNull()

      sessionStorage.setItem('trae:workspace-session', 'invalid-json{{{')
      expect(loadWorkspaceSession()).toBeNull()

      sessionStorage.setItem('trae:workspace-session', JSON.stringify({ not: 'an array of tabs' }))
      expect(loadWorkspaceSession()).toBeNull()
    })

    it('saves and loads valid workspace session data', () => {
      const sessionData = {
        tabs: [makeTab('t1')],
        groups: { 'g1': { id: 'g1', activeTabId: 't1' } },
        layout: null,
        activeTabId: 't1',
        workspaces: {},
      }
      saveWorkspaceSession(sessionData as any)
      const loaded = loadWorkspaceSession()
      expect(loaded).toBeDefined()
      expect(loaded?.tabs).toHaveLength(1)
      expect(loaded?.tabs[0].id).toBe('t1')
    })
  })

  describe('getSerialPortName', () => {
    it('returns null for undefined server or empty port/host', () => {
      expect(getSerialPortName(undefined)).toBeNull()
      expect(getSerialPortName({ host: '' } as Server)).toBeNull()
    })

    it('parses portName from serialConfig JSON and lowercases', () => {
      const server = {
        host: 'COM1',
        serialConfig: JSON.stringify({ portName: 'COM3' }),
      } as Server
      expect(getSerialPortName(server)).toBe('com3')
    })

    it('falls back to host when serialConfig is missing or malformed', () => {
      const server1 = { host: 'COM5' } as Server
      expect(getSerialPortName(server1)).toBe('com5')

      const server2 = { host: '/dev/ttyUSB0', serialConfig: 'bad-json' } as Server
      expect(getSerialPortName(server2)).toBe('/dev/ttyusb0')
    })
  })

  describe('id generators', () => {
    it('generates unique group and workspace IDs with prefixes', () => {
      const g1 = newGroupId()
      const g2 = newGroupId()
      expect(g1).toMatch(/^group-[0-9a-f-]{36}$/)
      expect(g1).not.toBe(g2)

      const w1 = newWorkspaceId()
      const w2 = newWorkspaceId()
      expect(w1).toMatch(/^ws-[0-9a-f-]{36}$/)
      expect(w1).not.toBe(w2)
    })
  })

  describe('resolveTargetGroupId', () => {
    it('prefers active tab groupId if present and exists in groups', () => {
      const res = resolveTargetGroupId({
        tabs: [makeTab('t1', { groupId: 'g1' })],
        activeTabId: 't1',
        groups: { g1: { id: 'g1', activeTabId: 't1' }, g2: { id: 'g2', activeTabId: null } },
        lastActiveGroupId: 'g2',
      })
      expect(res).toBe('g1')
    })

    it('falls back to lastActiveGroupId if active tab has no group', () => {
      const res = resolveTargetGroupId({
        tabs: [makeTab('t1')],
        activeTabId: 't1',
        groups: { g2: { id: 'g2', activeTabId: null } },
        lastActiveGroupId: 'g2',
      })
      expect(res).toBe('g2')
    })

    it('falls back to first group key or null when no groups exist', () => {
      const res1 = resolveTargetGroupId({
        tabs: [],
        activeTabId: null,
        groups: { gFirst: { id: 'gFirst', activeTabId: null } },
        lastActiveGroupId: 'missing',
      })
      expect(res1).toBe('gFirst')

      const res2 = resolveTargetGroupId({
        tabs: [],
        activeTabId: null,
        groups: {},
        lastActiveGroupId: null,
      })
      expect(res2).toBeNull()
    })
  })

  describe('pruneWorkspaces', () => {
    it('dissolves workspace when remaining tab groups <= 1', () => {
      const tabs = [
        makeTab('t1', { workspaceId: 'ws-1', groupId: 'g1' }),
      ]
      const groups: Record<string, TabGroup> = {
        g1: { id: 'g1', activeTabId: 't1' },
      }
      const workspaces: Record<string, WorkspaceDef> = {
        'ws-1': {
          id: 'ws-1',
          name: 'WS 1',
          layout: { type: 'group', groupId: 'g1' },
        },
      }

      const res = pruneWorkspaces(tabs, groups, workspaces)
      // Workspace dissolved because it had <= 1 split group
      expect(Object.keys(res.workspaces)).toHaveLength(0)
      expect(res.tabs[0].workspaceId).toBeNull()
      expect(res.groups['g1']).toBeDefined()
    })

    it('retains multi-group split layouts and cleans up unused groups', () => {
      const tabs = [
        makeTab('t1', { workspaceId: 'ws-1', groupId: 'g1' }),
        makeTab('t2', { workspaceId: 'ws-1', groupId: 'g2' }),
      ]
      const groups: Record<string, TabGroup> = {
        g1: { id: 'g1', activeTabId: 't1' },
        g2: { id: 'g2', activeTabId: 't2' },
        gUnused: { id: 'gUnused', activeTabId: null },
      }
      const workspaces: Record<string, WorkspaceDef> = {
        'ws-1': {
          id: 'ws-1',
          name: 'WS 1',
          layout: {
            type: 'split',
            id: 'split-1',
            direction: 'row',
            ratio: 0.5,
            children: [
              { type: 'group', groupId: 'g1' },
              { type: 'group', groupId: 'g2' },
            ],
          },
        },
      }

      const res = pruneWorkspaces(tabs, groups, workspaces)
      expect(Object.keys(res.workspaces)).toHaveLength(1)
      expect(res.groups['g1']).toBeDefined()
      expect(res.groups['g2']).toBeDefined()
      // gUnused was pruned
      expect(res.groups['gUnused']).toBeUndefined()
    })
  })
})
