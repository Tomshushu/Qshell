/**
 * src/components/layout/__tests__/ai-mcp-settings-card.test.tsx
 *
 * 验证本地 MCP 服务端与客户端授权设置卡片组件交互与功能完整性
 */

import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { AiMcpSettingsCard } from '../ai-mcp-settings-card'
import { useAppStore } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n/i18n-provider'
import type { Server } from '@/types'

const { mockMcp } = vi.hoisted(() => {
  return {
    mockMcp: {
      getStatus: vi.fn(),
      setEnabled: vi.fn(),
      regenerateToken: vi.fn(),
      getAuthorizedHosts: vi.fn(),
      setAuthorizedHosts: vi.fn(),
    },
  }
})

vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  return {
    ...actual,
    backend: {
      ...actual.backend,
      mcp: mockMcp,
      files: {
        ...actual.backend?.files,
        setExclusionConfig: vi.fn().mockResolvedValue(undefined),
      },
    },
  }
})

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <I18nProvider>
      <TooltipProvider>{ui}</TooltipProvider>
    </I18nProvider>
  )
}

describe('AiMcpSettingsCard', () => {
  const defaultStatus = {
    enabled: true,
    port: 45680,
    endpointUrl: 'http://127.0.0.1:45680/mcp',
    token: 'test_token_1234567890abcdef',
    hostCount: 2,
    activeLeases: 0,
    authorizedHostCount: 1,
    authorizedHostIds: ['srv-1'],
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockMcp.getStatus.mockResolvedValue({ ...defaultStatus })
    mockMcp.setEnabled.mockImplementation(async (enabled: boolean) => ({
      ...defaultStatus,
      enabled,
    }))
    mockMcp.regenerateToken.mockResolvedValue('new_token_9876543210fedcba')
    mockMcp.getAuthorizedHosts.mockResolvedValue(['srv-1'])
    mockMcp.setAuthorizedHosts.mockResolvedValue(undefined)

    // 模拟服务器资产
    const mockServers: Server[] = [
      {
        id: 'srv-1',
        name: '生产 Web 节点 A',
        host: '192.168.1.10',
        port: 22,
        username: 'root',
        authType: 'password',
        tags: [],
        favorite: false,
        status: 'offline',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'srv-2',
        name: '数据库主节点 B',
        host: '192.168.1.20',
        port: 22,
        username: 'ubuntu',
        authType: 'password',
        tags: [],
        favorite: false,
        status: 'offline',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]

    useAppStore.setState({
      servers: mockServers,
    })

    // 模拟剪贴板
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders MCP card header and 127.0.0.1 isolated badge', async () => {
    renderWithProviders(<AiMcpSettingsCard />)

    await waitFor(() => {
      expect(screen.getByText('本地 MCP 服务端与客户端授权')).toBeTruthy()
      expect(screen.getByText('127.0.0.1 闭环')).toBeTruthy()
    })
  })

  it('displays endpoint and token when enabled', async () => {
    renderWithProviders(<AiMcpSettingsCard />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('http://127.0.0.1:45680/mcp')).toBeTruthy()
      expect(screen.getByDisplayValue('test_token_1234567890abcdef')).toBeTruthy()
    })
  })

  it('switches client snippet tabs between Cursor, Codex, Claude Desktop, Claude Code, Windsurf, VS Code, and Zed', async () => {
    renderWithProviders(<AiMcpSettingsCard />)

    await waitFor(() => {
      expect(screen.getByText('外部 MCP 客户端接入配置')).toBeTruthy()
    })

    const claudeDesktopTab = screen.getByText('Claude Desktop')
    fireEvent.click(claudeDesktopTab)
    expect(screen.getByText(/packages\/qshell-mcp\/dist\/index\.js/)).toBeTruthy()

    const claudeCodeTab = screen.getByText('Claude Code')
    fireEvent.click(claudeCodeTab)
    expect(screen.getByText(/claude mcp add qshell/)).toBeTruthy()

    const codexTab = screen.getByText('Codex')
    fireEvent.click(codexTab)
    expect(screen.getByText(/codex mcp add qshell/)).toBeTruthy()

    const windsurfTab = screen.getByText('Windsurf')
    fireEvent.click(windsurfTab)
    expect(screen.getByText(/serverUrl/)).toBeTruthy()

    const zedTab = screen.getByText('Zed')
    fireEvent.click(zedTab)
    expect(screen.getByText(/context_servers/)).toBeTruthy()
  })

  it('allows toggling host authorization and displays authorized badges', async () => {
    renderWithProviders(<AiMcpSettingsCard />)

    await waitFor(() => {
      expect(screen.getByText('生产 Web 节点 A')).toBeTruthy()
      expect(screen.getByText('数据库主节点 B')).toBeTruthy()
      expect(screen.getByText('已授权外部调用')).toBeTruthy()
      expect(screen.getByText('未授权（安全拦截）')).toBeTruthy()
    })

    // 点击第二个服务器进行授权
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThanOrEqual(2)

    fireEvent.click(checkboxes[1])
    expect(mockMcp.setAuthorizedHosts).toHaveBeenCalledWith(['srv-1', 'srv-2'])
  })

  it('allows selecting and deselecting all servers', async () => {
    renderWithProviders(<AiMcpSettingsCard />)

    await waitFor(() => {
      expect(screen.getByText('全选')).toBeTruthy()
      expect(screen.getByText('取消全选')).toBeTruthy()
    })

    const selectAllBtn = screen.getByText('全选')
    fireEvent.click(selectAllBtn)
    expect(mockMcp.setAuthorizedHosts).toHaveBeenCalledWith(['srv-1', 'srv-2'])

    const deselectAllBtn = screen.getByText('取消全选')
    fireEvent.click(deselectAllBtn)
    expect(mockMcp.setAuthorizedHosts).toHaveBeenCalledWith([])
  })
})
