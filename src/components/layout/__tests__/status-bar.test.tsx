import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { StatusBar } from '../status-bar'
import { useAppStore } from '@/store'
import { useSessionTrafficStore } from '@/store/session-traffic-store'
import { useTerminalLockStore } from '@/store/terminal-lock-store'
import { I18nProvider } from '@/i18n/i18n-provider'
import type { RemoteFsCapabilities, Server, WorkspaceTab } from '@/types'

const { mockGetBackendCapabilities, eventListeners, mockListen } = vi.hoisted(() => {
  const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>()
  return {
    mockGetBackendCapabilities: vi.fn<(connId: string) => Promise<RemoteFsCapabilities>>(),
    eventListeners: listeners,
    mockListen: vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
      let set = listeners.get(eventName)
      if (!set) {
        set = new Set()
        listeners.set(eventName, set)
      }
      set.add(handler)
      return () => {
        set?.delete(handler)
      }
    }),
  }
})

vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
}))

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return {
    ...actual,
    backend: {
      files: {
        getBackendCapabilities: mockGetBackendCapabilities,
        setExclusionConfig: vi.fn(async () => ({ success: true })),
      },
    },
  }
})

function emitTauriEvent(eventName: string, payload: unknown) {
  const set = eventListeners.get(eventName)
  if (!set) return
  for (const handler of set) {
    handler({ payload })
  }
}

const HEALTHY_SFTP_CAPS: RemoteFsCapabilities = {
  backend: 'sftp',
  fallbackFromSftp: false,
  supportsSftp: true,
  supportsChmod: true,
  supportsSymlink: true,
  supportsResume: true,
}

const FALLBACK_SCP_CAPS: RemoteFsCapabilities = {
  backend: 'scp',
  fallbackFromSftp: true,
  supportsSftp: false,
  supportsChmod: true,
  supportsSymlink: true,
  supportsResume: false,
}

describe('StatusBar Component Protocol & Dashboard Mode Guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventListeners.clear()
    mockGetBackendCapabilities.mockResolvedValue(HEALTHY_SFTP_CAPS)
    useTerminalLockStore.setState({ lockedByTermId: {} })
    useAppStore.setState({
      activeTabId: null,
      tabs: [],
      servers: [
        { id: 'srv-1', name: 'Web Server', host: '192.168.1.100', port: 22, protocol: 'ssh' } as Server,
        { id: 'srv-2', name: 'Switch 1', host: '192.168.1.1', port: 23, protocol: 'telnet' } as Server,
        { id: 'srv-3', name: 'Storage FTP', host: '192.168.1.200', port: 21, protocol: 'ftp' } as Server,
      ],
      connectedServers: {},
      layout: { type: 'group', groupId: 'default' },
      workspaces: {},
    })
  })

  afterEach(cleanup)

  it('does not render any mode capsule on 首页 / 仪表盘 (no active tab)', () => {
    render(
      <I18nProvider>
        <StatusBar />
      </I18nProvider>
    )

    // Should NOT show any mode badge in the bottom-right corner
    expect(screen.queryByText('SSH 模式')).toBeNull()
    expect(screen.queryByText('仪表盘')).toBeNull()
    expect(screen.queryByText('Dashboard')).toBeNull()

    // Left status shows ready with total server counts
    expect(screen.getByText(/全部主机 3/)).toBeDefined()
  })

  it('renders TELNET mode accurately when active tab connects to a Telnet asset', () => {
    const tab: WorkspaceTab = {
      id: 'tab-telnet',
      serverId: 'srv-2',
      serverName: 'Switch 1',
      module: 'terminal',
      title: 'Switch 1',
    }

    useAppStore.setState({
      activeTabId: 'tab-telnet',
      tabs: [tab],
      connectedServers: { 'ws:srv-2:tab-telnet': true },
    })

    render(
      <I18nProvider>
        <StatusBar />
      </I18nProvider>
    )

    expect(screen.getByText('TELNET')).toBeDefined()
    expect(screen.queryByText('SSH 模式')).toBeNull()
  })

  it('renders FTP mode accurately when active tab connects to an FTP asset', () => {
    const tab: WorkspaceTab = {
      id: 'tab-ftp',
      serverId: 'srv-3',
      serverName: 'Storage FTP',
      module: 'files',
      title: 'Storage FTP',
    }

    useAppStore.setState({
      activeTabId: 'tab-ftp',
      tabs: [tab],
      connectedServers: { 'ws:srv-3:tab-ftp': true },
    })

    render(
      <I18nProvider>
        <StatusBar />
      </I18nProvider>
    )

    expect(screen.getByText('FTP')).toBeDefined()
    expect(screen.queryByText('SSH 模式')).toBeNull()
  })

  it('renders SSH mode when active tab is a genuine SSH server', () => {
    const tab: WorkspaceTab = {
      id: 'tab-ssh',
      serverId: 'srv-1',
      serverName: 'Web Server',
      module: 'terminal',
      title: 'Web Server',
    }

    useAppStore.setState({
      activeTabId: 'tab-ssh',
      tabs: [tab],
      connectedServers: { 'ws:srv-1:tab-ssh': true },
    })

    render(
      <I18nProvider>
        <StatusBar />
      </I18nProvider>
    )

    expect(screen.getByText('SSH 模式')).toBeDefined()
  })

  it('renders split mode summary and current focus information on the left while preserving right side tools', () => {
    const tab1: WorkspaceTab = {
      id: 'tab-1',
      serverId: 'srv-1',
      serverName: 'Web Server',
      module: 'terminal',
      title: 'Web Server',
      workspaceId: 'ws-1',
    }
    const tab2: WorkspaceTab = {
      id: 'tab-2',
      serverId: 'srv-2',
      serverName: 'Switch 1',
      module: 'terminal',
      title: 'Switch 1',
      workspaceId: 'ws-1',
    }

    useAppStore.setState({
      activeTabId: 'tab-1',
      tabs: [tab1, tab2],
      connectedServers: {
        'ws:srv-1:tab-1': true,
        'ws:srv-2:tab-2': true,
      },
      workspaces: {
        'ws-1': {
          id: 'ws-1',
          name: 'Workspace 1',
          layout: {
            type: 'split',
            id: 'split-root',
            direction: 'row',
            ratio: 0.5,
            children: [
              { type: 'group', groupId: 'group-1' },
              { type: 'group', groupId: 'group-2' },
            ],
          },
        },
      },
    })

    render(
      <I18nProvider>
        <StatusBar />
      </I18nProvider>
    )

    // Left side displays split mode total terminal count and focused target info
    expect(screen.getByText(/分屏模式 \(共 2 个终端\)/)).toBeDefined()
    expect(screen.getByText(/当前焦点: Web Server \(192\.168\.1\.100\)/)).toBeDefined()

    // Right side tools (Quick Command, Compose Bar) are preserved
    expect(screen.getByText(/快捷命令/)).toBeDefined()
    expect(screen.getByText(/撰写/)).toBeDefined()
  })

  it('renders Local Shell mode badge when active tab is ephemeral __local__:default', () => {
    const tab: WorkspaceTab = {
      id: 'tab-local',
      serverId: '__local__:default',
      serverName: 'Local Shell',
      module: 'terminal',
      title: 'Local Shell',
    }

    useAppStore.setState({
      activeTabId: 'tab-local',
      tabs: [tab],
      connectedServers: {},
    })

    render(
      <I18nProvider>
        <StatusBar />
      </I18nProvider>
    )

    expect(screen.getByText('本地终端')).toBeDefined()
    expect(screen.queryByText('SSH 模式')).toBeNull()
  })

  it('hides Quick Command and Compose Bar triggers when active tab is locked', () => {
    const tab: WorkspaceTab = {
      id: 'tab-locked',
      serverId: 'srv-1',
      serverName: 'Web Server',
      module: 'terminal',
      title: 'Web Server',
    }

    useAppStore.setState({
      activeTabId: 'tab-locked',
      tabs: [tab],
      connectedServers: { 'ws:srv-1:tab-locked': true },
    })
    useTerminalLockStore.setState({
      lockedByTermId: {
        'term-1': {
          termId: 'term-1',
          tabId: 'tab-locked',
          lockedAt: Date.now(),
        },
      },
    })

    render(
      <I18nProvider>
        <StatusBar />
      </I18nProvider>
    )

    expect(screen.queryByText(/快捷命令/)).toBeNull()
    expect(screen.queryByText(/撰写/)).toBeNull()
  })

  it('does not render duplicate session traffic rates alongside StatusBarMetricsPill on SSH sessions', () => {
    const tab: WorkspaceTab = {
      id: 'tab-ssh-clean',
      serverId: 'srv-1',
      serverName: 'Web Server',
      module: 'terminal',
      title: 'Web Server',
    }

    useSessionTrafficStore.getState().setTabActiveSession('tab-ssh-clean', 'sess-1')
    useSessionTrafficStore.getState().updateTraffic('sess-1', 1024, 512)
    useSessionTrafficStore.getState().updateTraffic('sess-1', 2048, 1024, Date.now() + 1000)
    useAppStore.setState({
      activeTabId: 'tab-ssh-clean',
      tabs: [tab],
      connectedServers: { 'ws:srv-1:tab-ssh-clean': true },
    })

    render(
      <I18nProvider>
        <StatusBar />
      </I18nProvider>
    )

    expect(screen.queryByText(/↓ .*\/s/)).toBeNull()
    expect(screen.queryByText(/↑ .*\/s/)).toBeNull()
    expect(screen.queryByText('SFTP')).toBeNull()
    expect(screen.getByText('SSH 模式')).toBeDefined()
  })

  it('clears previous SCP fallback badge immediately when switching to another SSH tab', async () => {
    const tab1: WorkspaceTab = {
      id: 'tab-scp',
      serverId: 'srv-1',
      serverName: 'Web Server',
      module: 'terminal',
      title: 'Web Server',
    }
    const tab2: WorkspaceTab = {
      id: 'tab-sftp',
      serverId: 'srv-4',
      serverName: 'App Server',
      module: 'terminal',
      title: 'App Server',
    }

    let resolveSecondQuery!: (caps: RemoteFsCapabilities) => void
    mockGetBackendCapabilities.mockImplementation((connId: string) => {
      if (connId === 'ws:srv-1:tab-scp') {
        return Promise.resolve(FALLBACK_SCP_CAPS)
      }
      return new Promise<RemoteFsCapabilities>((resolve) => {
        resolveSecondQuery = resolve
      })
    })

    useAppStore.setState({
      activeTabId: 'tab-scp',
      tabs: [tab1, tab2],
      servers: [
        { id: 'srv-1', name: 'Web Server', host: '192.168.1.100', port: 22, protocol: 'ssh' } as Server,
        { id: 'srv-4', name: 'App Server', host: '192.168.1.104', port: 22, protocol: 'ssh' } as Server,
      ],
      connectedServers: {
        'ws:srv-1:tab-scp': true,
        'ws:srv-4:tab-sftp': true,
      },
    })

    render(
      <I18nProvider>
        <StatusBar />
      </I18nProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('SCP (自动降级)')).toBeDefined()
    })

    act(() => {
      useAppStore.setState({ activeTabId: 'tab-sftp' })
    })

    // Previous tab's SCP badge must disappear immediately while tab-sftp is still resolving
    expect(screen.queryByText('SCP (自动降级)')).toBeNull()

    await act(async () => {
      resolveSecondQuery(HEALTHY_SFTP_CAPS)
    })

    expect(screen.queryByText('SCP (自动降级)')).toBeNull()
    expect(screen.queryByText('SFTP')).toBeNull()
  })

  it('updates StatusBar immediately when remote-fs-backend-changed event fires for active connection', async () => {
    const tab: WorkspaceTab = {
      id: 'tab-runtime',
      serverId: 'srv-1',
      serverName: 'Web Server',
      module: 'terminal',
      title: 'Web Server',
    }

    useAppStore.setState({
      activeTabId: 'tab-runtime',
      tabs: [tab],
      connectedServers: { 'ws:srv-1:tab-runtime': true },
    })

    render(
      <I18nProvider>
        <StatusBar />
      </I18nProvider>
    )

    await waitFor(() => {
      expect(mockGetBackendCapabilities).toHaveBeenCalledWith('ws:srv-1:tab-runtime')
      expect(mockListen).toHaveBeenCalledWith('remote-fs-backend-changed', expect.any(Function))
    })

    expect(screen.queryByText('SCP (自动降级)')).toBeNull()

    // Unrelated server event is ignored
    act(() => {
      emitTauriEvent('remote-fs-backend-changed', {
        serverId: 'srv-other',
        backend: 'scp',
        fallbackFromSftp: true,
      })
    })
    expect(screen.queryByText('SCP (自动降级)')).toBeNull()

    // Matching base serverId event updates immediately without remount
    act(() => {
      emitTauriEvent('remote-fs-backend-changed', {
        serverId: 'srv-1',
        backend: 'scp',
        fallbackFromSftp: true,
      })
    })

    expect(screen.getByText('SCP (自动降级)')).toBeDefined()
  })

  it('renders SCP fallback badge in split mode when focused session uses SCP fallback', async () => {
    mockGetBackendCapabilities.mockResolvedValue(FALLBACK_SCP_CAPS)
    const tab1: WorkspaceTab = {
      id: 'tab-1',
      serverId: 'srv-1',
      serverName: 'Web Server',
      module: 'terminal',
      title: 'Web Server',
      workspaceId: 'ws-1',
    }
    const tab2: WorkspaceTab = {
      id: 'tab-2',
      serverId: 'srv-2',
      serverName: 'Switch 1',
      module: 'terminal',
      title: 'Switch 1',
      workspaceId: 'ws-1',
    }

    useAppStore.setState({
      activeTabId: 'tab-1',
      tabs: [tab1, tab2],
      connectedServers: {
        'ws:srv-1:tab-1': true,
        'ws:srv-2:tab-2': true,
      },
      workspaces: {
        'ws-1': {
          id: 'ws-1',
          name: 'Workspace 1',
          layout: {
            type: 'split',
            id: 'split-root',
            direction: 'row',
            ratio: 0.5,
            children: [
              { type: 'group', groupId: 'group-1' },
              { type: 'group', groupId: 'group-2' },
            ],
          },
        },
      },
    })

    render(
      <I18nProvider>
        <StatusBar />
      </I18nProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('SCP (自动降级)')).toBeDefined()
    })
  })

  it('queries backend capabilities for connected non-FTP SFTP tab with resolved server and keeps healthy SFTP clean', async () => {
    const tab: WorkspaceTab = {
      id: 'tab-sftp-mode',
      serverId: 'sftp',
      serverName: 'SFTP',
      module: 'files',
      title: 'SFTP',
    }

    useAppStore.setState({
      activeTabId: 'tab-sftp-mode',
      tabs: [tab],
      servers: [
        { id: 'sftp', name: 'SFTP Host', host: '10.0.0.10', port: 22, protocol: 'ssh' } as Server,
      ],
      connectedServers: { 'ws:sftp:tab-sftp-mode': true },
    })

    mockGetBackendCapabilities.mockResolvedValue(FALLBACK_SCP_CAPS)

    render(
      <I18nProvider>
        <StatusBar />
      </I18nProvider>
    )

    await waitFor(() => {
      expect(mockGetBackendCapabilities).toHaveBeenCalledWith('ws:sftp:tab-sftp-mode')
      expect(screen.getByText('SCP (自动降级)')).toBeDefined()
    })

    // Healthy SFTP leaves no redundant grey badge on left side
    act(() => {
      emitTauriEvent('remote-fs-backend-changed', {
        connId: 'ws:sftp:tab-sftp-mode',
        capabilities: HEALTHY_SFTP_CAPS,
      })
    })
    expect(screen.queryByText('SCP (自动降级)')).toBeNull()
  })
})
