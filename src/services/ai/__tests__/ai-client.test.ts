import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildModelsEndpoint, fetchProviderModels } from '../ai-client'
import type { AISettings } from '@/types/ai'

describe('ai-client buildModelsEndpoint', () => {
  it('correctly maps OpenAI and compatible endpoints', () => {
    expect(buildModelsEndpoint('https://api.openai.com/v1', 'openai')).toBe('https://api.openai.com/v1/models')
    expect(buildModelsEndpoint('https://api.deepseek.com', 'openai')).toBe('https://api.deepseek.com/models')
    expect(buildModelsEndpoint('https://api.siliconflow.cn/v1', 'openai')).toBe('https://api.siliconflow.cn/v1/models')
    expect(buildModelsEndpoint('https://api.groq.com/openai/v1', 'openai')).toBe('https://api.groq.com/openai/v1/models')
    expect(buildModelsEndpoint('http://127.0.0.1:11434/v1', 'openai')).toBe('http://127.0.0.1:11434/v1/models')
    expect(buildModelsEndpoint('https://my-proxy.com/chat/completions', 'openai')).toBe('https://my-proxy.com/models')
  })

  it('correctly maps Gemini and Anthropic endpoints', () => {
    expect(buildModelsEndpoint('https://generativelanguage.googleapis.com', 'gemini')).toBe('https://generativelanguage.googleapis.com/v1beta/models')
    expect(buildModelsEndpoint('https://api.anthropic.com/v1', 'anthropic')).toBe('https://api.anthropic.com/v1/models')
  })
})

describe('fetchProviderModels', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('parses standard OpenAI format with smart chat model prioritization', async () => {
    const mockResponse = {
      object: 'list',
      data: [
        { id: 'text-embedding-3-small' },
        { id: 'gpt-4o' },
        { id: 'gpt-4o-mini' },
        { id: 'whisper-1' },
      ],
    }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    })

    const settings: AISettings = {
      provider: 'openai',
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      temperature: 0.3,
      maxTokens: 2048,
      enableDlp: true,
      maskPrivateIps: false,
    }

    const models = await fetchProviderModels(settings)
    expect(models).toEqual(['gpt-4o', 'gpt-4o-mini', 'text-embedding-3-small', 'whisper-1'])
  })

  it('parses Ollama /api/tags format', async () => {
    const mockResponse = {
      models: [
        { name: 'qwen2.5-coder:7b', modified_at: '2026-10-10' },
        { name: 'deepseek-r1:14b', modified_at: '2026-10-11' },
      ],
    }
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    })

    const settings: AISettings = {
      provider: 'ollama',
      protocol: 'openai',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: '',
      model: 'qwen2.5-coder:7b',
      temperature: 0.3,
      maxTokens: 2048,
      enableDlp: true,
      maskPrivateIps: false,
    }

    const models = await fetchProviderModels(settings)
    expect(models).toContain('qwen2.5-coder:7b')
    expect(models).toContain('deepseek-r1:14b')
  })
})
