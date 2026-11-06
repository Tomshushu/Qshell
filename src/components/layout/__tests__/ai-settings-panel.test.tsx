/**
 * src/components/layout/__tests__/ai-settings-panel.test.tsx
 *
 * 验证 AI 设置面板 Option C 终端执行模式、自定义黑名单配置与外部 MCP 运维插件中心
 */

import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { AISettingsPanel } from '../ai-settings-panel'
import { useAIStore } from '@/store/ai-store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n/i18n-provider'
import type { ConfiguredProvider } from '@/types/ai'

function makeProvider(overrides: Partial<ConfiguredProvider> = {}): ConfiguredProvider {
  return {
    id: 'prov-siliconflow-1',
    provider: 'siliconflow',
    name: 'SiliconFlow-A',
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKey: 'sk-test',
    model: 'model-a',
    isEnabled: true,
    ...overrides,
  }
}

// 插件中心现在以 Rust MCP Client 为唯一数据源（不再有前端假数据兜底），
// 这里按后端真实契约提供 5 个内置插件视图。
vi.mock('@/services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api')>()
  const seeded = ['docker', 'java', 'kubernetes', 'nginx_web', 'linux_kernel'].map((id) => ({
    id: `builtin-${id}`,
    name: `${id} 排障`,
    description: `${id} 专项诊断`,
    icon: id,
    category:
      id === 'java' || id === 'nginx_web'
        ? 'application'
        : id === 'linux_kernel'
          ? 'system'
          : 'container',
    enabled: true,
    connected: true,
    transport: 'ssh_native',
    command: null,
    args: [],
    url: null,
    env: {},
    headers: {},
    disabledTools: [],
    discoveredTools: [],
    isPreset: true,
    presetId: id,
    lastConnectedAt: null,
    lastError: null,
  }))
  return {
    ...actual,
    backend: {
      ...(actual.backend || {}),
      // store rehydrate 会同步 SFTP 排除配置，保留最小桩避免无关报错
      files: { setExclusionConfig: vi.fn() },
      mcpClient: {
        listPlugins: vi.fn().mockResolvedValue(seeded),
        listPresets: vi.fn().mockResolvedValue([]),
        setEnabled: vi.fn(),
        setToolDisabled: vi.fn(),
        restorePresets: vi.fn(),
        refreshPlugin: vi.fn(),
        removePlugin: vi.fn(),
        upsertPlugin: vi.fn(),
        testConnection: vi.fn(),
        listActiveTools: vi.fn().mockResolvedValue([]),
        callTool: vi.fn(),
      },
    },
  }
})

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <I18nProvider>
      <TooltipProvider>{ui}</TooltipProvider>
    </I18nProvider>,
  )
}

describe('AISettingsPanel Option C Command Guard & MCP Client Ecosystem', () => {
  beforeEach(() => {
    useAIStore.setState({
      enableAiGlobal: true,
      settings: {
        provider: 'deepseek',
        protocol: 'openai',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'test-key',
        model: 'deepseek-chat',
        temperature: 0.3,
        maxTokens: 2048,
        enableDlp: true,
        maskPrivateIps: false,
        executionMode: 'ask',
        customBlacklist: ['prod-db'],
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows one entry per vendor and marks configured vendors in the popular list', () => {
    useAIStore.setState({
      configuredProviders: [
        makeProvider({ id: 'p1', name: 'SiliconFlow-A', model: 'model-a', isEnabled: true }),
        makeProvider({ id: 'p2', name: 'SiliconFlow-B', model: 'model-b', isEnabled: false }),
      ],
    })
    renderWithProviders(<AISettingsPanel />)

    expect(screen.getByText('SiliconFlow-A')).toBeTruthy()
    expect(screen.queryByText('SiliconFlow-B')).toBeNull()
    expect(screen.getByTestId('ai-popular-configured-siliconflow')).toBeTruthy()
  })

  it('switches the model directly from the configured list', () => {
    useAIStore.setState({
      configuredProviders: [makeProvider({ id: 'p1', model: 'model-a', isEnabled: true })],
      customModelsMap: { siliconflow: ['model-a', 'model-b', 'model-c'] },
      settings: { ...useAIStore.getState().settings, provider: 'siliconflow', model: 'model-a' },
    })
    renderWithProviders(<AISettingsPanel />)

    fireEvent.click(screen.getByRole('button', { name: /切换模型/ }))
    fireEvent.click(screen.getByText('model-b'))

    expect(useAIStore.getState().configuredProviders[0].model).toBe('model-b')
    expect(useAIStore.getState().settings.model).toBe('model-b')
  })

  it('only lists the current model and fetched models in the inline switcher', () => {
    useAIStore.setState({
      configuredProviders: [makeProvider({ id: 'p1', model: 'model-a', isEnabled: true })],
      customModelsMap: { siliconflow: ['model-a', 'model-b'] },
    })
    renderWithProviders(<AISettingsPanel />)

    fireEvent.click(screen.getByRole('button', { name: /切换模型/ }))
    expect(screen.getByText('model-b')).toBeTruthy()
    expect(screen.queryByText('deepseek-ai/DeepSeek-V3')).toBeNull()
    expect(screen.queryByText('Pro/deepseek-ai/DeepSeek-V3')).toBeNull()
  })

  it('does not render hardcoded recommended models when configuring a provider', () => {
    useAIStore.setState({ configuredProviders: [], customModelsMap: {} })
    renderWithProviders(<AISettingsPanel />)

    const connectButtons = screen.getAllByRole('button', { name: /连接/ })
    expect(connectButtons.length).toBeGreaterThan(0)
    fireEvent.click(connectButtons[0])

    expect(screen.queryByText(/推荐模型/)).toBeNull()
    expect(screen.queryByText('deepseek-chat')).toBeNull()
  })

  it('fetches fresh models from the refresh button before the latency test', async () => {
    const originalFetch = useAIStore.getState().fetchModelsForConfig
    const fetchSpy = vi.fn().mockResolvedValue(['model-a', 'model-new'])
    useAIStore.setState({
      configuredProviders: [makeProvider({ id: 'p1', model: 'model-a', isEnabled: true })],
      customModelsMap: { siliconflow: ['model-a'] },
      fetchModelsForConfig: fetchSpy,
    })

    try {
      renderWithProviders(<AISettingsPanel />)
      const refreshBtn = screen.getByTestId('ai-refresh-models-siliconflow')
      expect(refreshBtn.getAttribute('title')).toContain('拉取可用模型')
      fireEvent.click(refreshBtn)

      await vi.waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith({
          provider: 'siliconflow',
          protocol: 'openai',
          baseUrl: 'https://api.siliconflow.cn/v1',
          apiKey: 'sk-test',
        })
      })
    } finally {
      useAIStore.setState({ fetchModelsForConfig: originalFetch })
    }
  })

  it('renders Option C command guard title, highlights and 3 execution modes', () => {
    renderWithProviders(<AISettingsPanel />)

    expect(screen.getByText('AI 终端安全执行与只读白名单网关')).toBeTruthy()
    expect(screen.getByText('Option C 智能受控')).toBeTruthy()
    expect(screen.getByTestId('exec-mode-ask')).toBeTruthy()
    expect(screen.getByTestId('exec-mode-auto-readonly')).toBeTruthy()
    expect(screen.getByTestId('exec-mode-disabled')).toBeTruthy()
  })

  it('allows user to switch execution modes', () => {
    renderWithProviders(<AISettingsPanel />)

    // 默认是 ask
    expect(useAIStore.getState().settings.executionMode).toBe('ask')

    // 切换到 auto_readonly
    act(() => {
      fireEvent.click(screen.getByTestId('exec-mode-auto-readonly'))
    })
    expect(useAIStore.getState().settings.executionMode).toBe('auto_readonly')

    // 切换到 disabled
    act(() => {
      fireEvent.click(screen.getByTestId('exec-mode-disabled'))
    })
    expect(useAIStore.getState().settings.executionMode).toBe('disabled')
  })

  it('renders danger mode as a peer mode card and requires a second confirmation', () => {
    renderWithProviders(<AISettingsPanel />)

    const dangerCard = screen.getByTestId('exec-mode-danger')
    expect(dangerCard.parentElement).toBe(screen.getByTestId('exec-mode-ask').parentElement)

    act(() => {
      fireEvent.click(dangerCard)
    })
    expect(useAIStore.getState().dangerModeActive).toBe(false)
    expect(screen.getByText('确认开启')).toBeTruthy()

    act(() => {
      fireEvent.click(screen.getByText('确认开启'))
    })
    expect(useAIStore.getState().getEffectiveExecutionMode()).toBe('danger')
    expect(useAIStore.getState().settings.executionMode).toBe('ask')

    act(() => {
      useAIStore.getState().deactivateDangerMode()
    })
  })

  it('allows user to add and remove custom blacklist items', () => {
    renderWithProviders(<AISettingsPanel />)

    // 检查已有的 prod-db
    expect(screen.getByTestId('blacklist-tag-prod-db')).toBeTruthy()

    // 添加新关键词
    const input = screen.getByTestId('custom-blacklist-input')
    const addBtn = screen.getByTestId('custom-blacklist-add-btn')

    act(() => {
      fireEvent.change(input, { target: { value: 'truncate, drop' } })
    })

    act(() => {
      fireEvent.click(addBtn)
    })

    const updatedList = useAIStore.getState().settings.customBlacklist
    expect(updatedList).toContain('prod-db')
    expect(updatedList).toContain('truncate')
    expect(updatedList).toContain('drop')

    // 删除 prod-db
    const prodDbTag = screen.getByTestId('blacklist-tag-prod-db')
    const removeBtn = prodDbTag.querySelector('button')
    expect(removeBtn).toBeTruthy()

    act(() => {
      fireEvent.click(removeBtn!)
    })

    const finalAfterRemoval = useAIStore.getState().settings.customBlacklist
    expect(finalAfterRemoval).not.toContain('prod-db')
    expect(finalAfterRemoval).toContain('truncate')
  })

  it('renders the Zero-Config MCP plugin hub with 5 pre-enabled server troubleshooting plugins and supports filtering', async () => {
    renderWithProviders(<AISettingsPanel />)

    expect(screen.getByTestId('ai-mcp-client-card')).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByTestId('mcp-plugin-card-builtin-docker')).toBeTruthy()
      expect(screen.getByTestId('mcp-plugin-card-builtin-java')).toBeTruthy()
      expect(screen.getByTestId('mcp-plugin-card-builtin-kubernetes')).toBeTruthy()
      expect(screen.getByTestId('mcp-plugin-card-builtin-nginx_web')).toBeTruthy()
      expect(screen.getByTestId('mcp-plugin-card-builtin-linux_kernel')).toBeTruthy()
    })

    // Filter by application category (Java & Nginx)
    act(() => {
      fireEvent.click(screen.getByTestId('mcp-cat-application'))
    })

    expect(screen.getByTestId('mcp-plugin-card-builtin-java')).toBeTruthy()
    expect(screen.getByTestId('mcp-plugin-card-builtin-nginx_web')).toBeTruthy()
    expect(screen.queryByTestId('mcp-plugin-card-builtin-docker')).toBeNull()
  })
})
