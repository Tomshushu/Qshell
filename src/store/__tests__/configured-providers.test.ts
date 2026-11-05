import { describe, it, expect, beforeEach } from 'vitest'
import { useAIStore } from '@/store/ai-store'
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

describe('configured providers per vendor', () => {
  beforeEach(() => {
    localStorage.clear()
    useAIStore.setState({
      configuredProviders: [],
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
        executionMode: 'auto_readonly',
        customBlacklist: [],
      },
    })
  })

  it('overwrites the existing config of the same vendor instead of adding a duplicate', () => {
    useAIStore.setState({
      configuredProviders: [makeProvider({ id: 'p1', model: 'model-a', isEnabled: true })],
    })

    useAIStore.getState().saveConfiguredProvider(
      { provider: 'siliconflow', model: 'model-b', apiKey: 'sk-new', baseUrl: 'https://api.example/v1' },
      false,
    )

    const providers = useAIStore.getState().configuredProviders
    expect(providers).toHaveLength(1)
    expect(providers[0].id).toBe('p1')
    expect(providers[0].model).toBe('model-b')
  })

  it('removes every duplicate record of the same vendor on delete', () => {
    useAIStore.setState({
      configuredProviders: [
        makeProvider({ id: 'p1', isEnabled: true }),
        makeProvider({ id: 'p2', model: 'model-b', isEnabled: false }),
        makeProvider({ id: 'p3', provider: 'deepseek', model: 'deepseek-chat', isEnabled: false }),
      ],
    })

    useAIStore.getState().removeConfiguredProvider('p1')

    const remaining = useAIStore.getState().configuredProviders
    expect(remaining).toHaveLength(1)
    expect(remaining[0].provider).toBe('deepseek')
  })

  it('switches the model in place without losing other fields and syncs active settings', () => {
    useAIStore.setState({
      configuredProviders: [
        makeProvider({ id: 'p1', model: 'model-a', isEnabled: true, apiKey: 'secret', lastLatencyMs: 123 }),
      ],
    })

    useAIStore.getState().updateConfiguredProviderModel('p1', 'model-c')

    const updated = useAIStore.getState().configuredProviders[0]
    expect(updated.model).toBe('model-c')
    expect(updated.apiKey).toBe('secret')
    expect(updated.lastLatencyMs).toBe(123)
    expect(useAIStore.getState().settings.model).toBe('model-c')
  })
})
