import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { StatusBar } from '../status-bar'
import { useAppStore } from '@/store'
import { I18nProvider } from '@/i18n/i18n-provider'
import type { Server, WorkspaceTab } from '@/types'

describe('StatusBar Component Protocol & Dashboard Mode Guard', () => {
  beforeEach(() => {
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
})
