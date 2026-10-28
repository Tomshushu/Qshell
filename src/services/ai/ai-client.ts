/**
 * src/services/ai/ai-client.ts
 *
 * Qshell 全能通用多模型客户端
 * 统一适配标准：
 * 1. OpenAI-Compatible 协议 (DeepSeek, 通义千问, 智谱, Kimi, SiliconFlow, OpenAI, Groq, Ollama 等)
 * 2. Anthropic Claude 协议
 * 3. Google Gemini 协议
 */

import type {
  AISettings,
  AIDiagnosisResult,
  AIPromptContext,
  CommandRiskAnalysis,
  AIAssistantMode,
} from '@/types/ai'
import { sanitizeLogContent } from './dlp-sanitizer'
import { buildSystemPrompt } from './system-prompt'
import { evaluateCommandRisk } from './risk-evaluator'
import {
  AGENT_TOOLS,
  executeAgentTool,
  normalizeToolName,
  stripAllToolCallMarkup,
  extractTextToolCalls,
  type ExtractedToolCall,
} from './agent-tools'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
}

export interface StreamResult {
  content: string
  toolCalls?: Array<{
    id: string
    name: string
    arguments: string
  }>
}

function normalizeBaseUrl(url: string): string {
  return (url || '').trim().replace(/\/+$/, '')
}

function buildOpenAIEndpoint(baseUrl: string): string {
  const trimmed = normalizeBaseUrl(baseUrl)
  if (trimmed.endsWith('/chat/completions')) return trimmed
  if (trimmed.endsWith('/v1') || trimmed.endsWith('/v4') || trimmed.includes('/compatible-mode')) {
    return `${trimmed}/chat/completions`
  }
  if (
    trimmed === 'https://api.openai.com' ||
    trimmed === 'http://127.0.0.1:11434' ||
    trimmed === 'http://localhost:11434' ||
    trimmed === 'https://api.siliconflow.cn' ||
    trimmed === 'https://api.moonshot.cn'
  ) {
    return `${trimmed}/v1/chat/completions`
  }
  return `${trimmed}/chat/completions`
}

function buildAnthropicEndpoint(baseUrl: string): string {
  const trimmed = normalizeBaseUrl(baseUrl)
  if (trimmed.endsWith('/messages')) return trimmed
  if (trimmed.endsWith('/v1')) return `${trimmed}/messages`
  return `${trimmed}/v1/messages`
}

function buildGeminiEndpoint(baseUrl: string, model: string, apiKey: string): string {
  const trimmed = normalizeBaseUrl(baseUrl)
  if (trimmed.includes('/models/')) {
    return `${trimmed}?key=${apiKey}`
  }
  if (trimmed.endsWith('/v1beta')) {
    return `${trimmed}/models/${model}:generateContent?key=${apiKey}`
  }
  return `${trimmed}/v1beta/models/${model}:generateContent?key=${apiKey}`
}

export function buildModelsEndpoint(baseUrl: string, protocol = 'openai'): string {
  const trimmed = normalizeBaseUrl(baseUrl)
  if (protocol === 'anthropic') {
    if (trimmed.endsWith('/models')) return trimmed
    if (trimmed.endsWith('/v1')) return `${trimmed}/models`
    return `${trimmed}/v1/models`
  }
  if (protocol === 'gemini') {
    if (trimmed.includes('/v1beta')) {
      return trimmed.endsWith('/models') ? trimmed : `${trimmed}/models`
    }
    return `${trimmed}/v1beta/models`
  }

  // OpenAI-Compatible
  if (trimmed.endsWith('/models')) return trimmed
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed.replace(/\/chat\/completions$/, '/models')
  }
  if (
    trimmed === 'https://api.openai.com' ||
    trimmed === 'https://api.siliconflow.cn' ||
    trimmed === 'https://api.moonshot.cn' ||
    trimmed === 'https://api.groq.com/openai' ||
    trimmed === 'https://api-inference.modelscope.cn'
  ) {
    return `${trimmed}/v1/models`
  }
  if (trimmed === 'http://127.0.0.1:11434' || trimmed === 'http://localhost:11434') {
    return `${trimmed}/v1/models`
  }
  if (trimmed === 'https://api.deepseek.com') {
    return `${trimmed}/models`
  }
  return `${trimmed}/models`
}

/**
 * 通用单次请求派发
 */
async function callModelApi(
  settings: AISettings,
  messages: ChatMessage[],
  maxTokens = 2048,
  signal?: AbortSignal,
): Promise<string> {
  const protocol = settings.protocol || 'openai'
  const baseUrl = normalizeBaseUrl(settings.baseUrl)

  if (!baseUrl) {
    throw new Error('未配置接口地址 (Base URL)')
  }
  if (!settings.model) {
    throw new Error('未选择或填写模型名称 (Model)')
  }

  // 1. Anthropic Claude 协议适配
  if (protocol === 'anthropic') {
    const systemMsg = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const userAndAssistantMsgs = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role,
        content: m.content,
      }))
    const cleanKey = (settings.apiKey || '').trim().replace(/^["']|["']$/g, '')
    const endpoint = buildAnthropicEndpoint(baseUrl)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    }
    if (cleanKey) {
      headers['x-api-key'] = cleanKey
      headers['Authorization'] = `Bearer ${cleanKey}`
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify({
        model: settings.model,
        max_tokens: maxTokens,
        system: systemMsg,
        messages: userAndAssistantMsgs,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Claude API 错误 (${res.status}): ${errText || res.statusText}`)
    }

    const data = await res.json()
    return data.content?.[0]?.text || ''
  }

  // 2. Google Gemini 协议适配
  if (protocol === 'gemini') {
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

    const systemMsg = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const bodyPayload: Record<string, unknown> = { contents }
    if (systemMsg) {
      bodyPayload.systemInstruction = {
        parts: [{ text: systemMsg }],
      }
    }

    const endpoint = buildGeminiEndpoint(baseUrl, settings.model, settings.apiKey || '')
    const res = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Gemini API 错误 (${res.status}): ${errText || res.statusText}`)
    }

    const data = await res.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
  }

  // 3. OpenAI-Compatible 标准协议 (涵盖 90%+ 厂商，包括 DeepSeek, Qwen, GLM, Kimi, Ollama)
  const endpoint = buildOpenAIEndpoint(baseUrl)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (settings.apiKey && settings.apiKey.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: settings.temperature ?? 0.3,
      max_tokens: maxTokens,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`模型调用异常 (${res.status}): ${errText || res.statusText}`)
  }

  const data = await res.json()
  const reasoning = data.choices?.[0]?.message?.reasoning_content || ''
  let content = data.choices?.[0]?.message?.content || ''
  if (reasoning && !content.includes('<think>')) {
    content = `<think>\n${reasoning}\n</think>\n\n${content}`
  }
  return content
}

/**
 * 流式大模型调用 (Server-Sent Events / SSE Streaming)
 * 具备真正的 Token 级实时中断：当 signal abort 时立即关闭 reader 并发送 TCP RST，服务端立刻停止推理计费
 */
async function callModelApiStream(
  settings: AISettings,
  messages: ChatMessage[],
  maxTokens = 2048,
  signal?: AbortSignal,
  onChunk?: (chunk: string, accumulated: string) => void,
  tools?: Array<Record<string, unknown>>,
): Promise<StreamResult> {
  const protocol = settings.protocol || 'openai'
  const baseUrl = normalizeBaseUrl(settings.baseUrl)

  if (!baseUrl) {
    throw new Error('未配置接口地址 (Base URL)')
  }
  if (!settings.model) {
    throw new Error('未选择或填写模型名称 (Model)')
  }

  // 1. Anthropic Claude 协议流式适配
  if (protocol === 'anthropic') {
    const systemMsg = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const userAndAssistantMsgs = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role,
        content: m.content,
      }))

    const cleanKey = (settings.apiKey || '').trim().replace(/^["']|["']$/g, '')
    const endpoint = buildAnthropicEndpoint(baseUrl)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    }
    if (cleanKey) {
      headers['x-api-key'] = cleanKey
      headers['Authorization'] = `Bearer ${cleanKey}`
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify({
        model: settings.model,
        max_tokens: maxTokens,
        system: systemMsg,
        messages: userAndAssistantMsgs,
        stream: true,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Claude API 错误 (${res.status}): ${errText || res.statusText}`)
    }

    const reader = res.body?.getReader()
    if (!reader) {
      const data = await res.json()
      const text = data.content?.[0]?.text || ''
      onChunk?.(text, text)
      return { content: text }
    }

    const decoder = new TextDecoder('utf-8')
    let accumulated = ''
    let buffer = ''

    try {
      while (true) {
        if (signal?.aborted) {
          reader.cancel().catch(() => {})
          break
        }
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith(':')) continue
          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6).trim()
            try {
              const parsed = JSON.parse(jsonStr)
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                const delta = parsed.delta.text
                accumulated += delta
                onChunk?.(delta, accumulated)
              }
            } catch {
              /* ignore partial json */
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return { content: accumulated }
  }

  // 2. Google Gemini 协议流式适配
  if (protocol === 'gemini') {
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

    const systemMsg = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const bodyPayload: Record<string, unknown> = { contents }
    if (systemMsg) {
      bodyPayload.systemInstruction = {
        parts: [{ text: systemMsg }],
      }
    }

    const cleanBase = normalizeBaseUrl(baseUrl)
    const endpoint = `${cleanBase}/v1beta/models/${settings.model}:streamGenerateContent?alt=sse&key=${settings.apiKey || ''}`
    const res = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Gemini API 错误 (${res.status}): ${errText || res.statusText}`)
    }

    const reader = res.body?.getReader()
    if (!reader) {
      const data = await res.json()
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || ''
      onChunk?.(text, text)
      return { content: text }
    }

    const decoder = new TextDecoder('utf-8')
    let accumulated = ''
    let buffer = ''

    try {
      while (true) {
        if (signal?.aborted) {
          reader.cancel().catch(() => {})
          break
        }
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith(':')) continue
          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6).trim()
            try {
              const parsed = JSON.parse(jsonStr)
              const delta = parsed.candidates?.[0]?.content?.parts?.[0]?.text || ''
              if (delta) {
                accumulated += delta
                onChunk?.(delta, accumulated)
              }
            } catch {
              /* ignore partial json */
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    return { content: accumulated }
  }

  // 3. OpenAI-Compatible 标准流式协议 (覆盖 DeepSeek, Qwen, GLM, Kimi, OpenAI, Ollama, SiliconFlow)
  const endpoint = buildOpenAIEndpoint(baseUrl)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (settings.apiKey && settings.apiKey.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`
  }

  const requestPayload: Record<string, unknown> = {
    model: settings.model,
    messages: messages.map((m) => {
      const msgObj: Record<string, unknown> = {
        role: m.role,
        content: m.content,
      }
      if (m.tool_call_id) msgObj.tool_call_id = m.tool_call_id
      if (m.tool_calls) msgObj.tool_calls = m.tool_calls
      if (m.name) msgObj.name = m.name
      return msgObj
    }),
    temperature: settings.temperature ?? 0.3,
    max_tokens: maxTokens,
    stream: true,
  }
  if (tools && tools.length > 0) {
    requestPayload.tools = tools
  }

  let res = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify(requestPayload),
  })

  // 如果某些模型/代理返回 400 不支持 tools，自动降级为不传 tools 重试
  if (!res.ok && tools && tools.length > 0 && res.status >= 400 && res.status < 500) {
    delete requestPayload.tools
    res = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify(requestPayload),
    })
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`模型调用异常 (${res.status}): ${errText || res.statusText}`)
  }

  const reader = res.body?.getReader()
  if (!reader) {
    const data = await res.json()
    const msg = data.choices?.[0]?.message
    const text = msg?.content || ''
    onChunk?.(text, text)
    const rawToolCalls = msg?.tool_calls
    const nonStreamToolCalls = Array.isArray(rawToolCalls)
      ? rawToolCalls.map((tc: any) => ({
          id: tc.id || `call_${Date.now()}`,
          name: normalizeToolName(tc.function?.name || ''),
          arguments: tc.function?.arguments || '',
        }))
      : undefined
    return {
      content: text,
      toolCalls:
        nonStreamToolCalls && nonStreamToolCalls.length > 0
          ? nonStreamToolCalls
          : undefined,
    }
  }

  const decoder = new TextDecoder('utf-8')
  let accumulated = ''
  let buffer = ''
  let isInsideThinking = false
  const toolCallsMap: Record<number, { id: string; name: string; arguments: string }> = {}
  let hasToolCalls = false

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel().catch(() => {})
        break
      }
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith(':')) continue
        if (trimmed === 'data: [DONE]') continue
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6).trim()
          try {
            const parsed = JSON.parse(jsonStr)
            const delta = parsed.choices?.[0]?.delta?.content || ''
            const deltaObj = parsed.choices?.[0]?.delta || {}
            const reasoningDelta =
              deltaObj.reasoning_content || deltaObj.reasoning || deltaObj.thought || ''
            const toolCallDeltas = parsed.choices?.[0]?.delta?.tool_calls

            if (Array.isArray(toolCallDeltas)) {
              hasToolCalls = true
              for (const tc of toolCallDeltas) {
                const idx = tc.index ?? 0
                if (!toolCallsMap[idx]) {
                  toolCallsMap[idx] = {
                    id: tc.id || `call_${Date.now()}_${idx}`,
                    name: '',
                    arguments: '',
                  }
                }
                if (tc.id) toolCallsMap[idx].id = tc.id
                if (tc.function?.name) {
                  if (!toolCallsMap[idx].name) {
                    toolCallsMap[idx].name = tc.function.name
                  } else if (!toolCallsMap[idx].name.includes(tc.function.name)) {
                    toolCallsMap[idx].name += tc.function.name
                  }
                }
                if (tc.function?.arguments) {
                  toolCallsMap[idx].arguments += tc.function.arguments
                }
              }
            }

            if (reasoningDelta) {
              if (!isInsideThinking) {
                isInsideThinking = true
                accumulated += '<think>'
                onChunk?.('<think>', accumulated)
              }
              accumulated += reasoningDelta
              onChunk?.(reasoningDelta, accumulated)
            } else if (delta) {
              if (isInsideThinking) {
                isInsideThinking = false
                accumulated += '</think>\n\n'
                onChunk?.('</think>\n\n', accumulated)
              }
              accumulated += delta
              onChunk?.(delta, accumulated)
            }
          } catch {
            /* ignore partial json */
          }
        }
      }
    }
  } finally {
    if (isInsideThinking) {
      accumulated += '</think>\n\n'
      onChunk?.('</think>\n\n', accumulated)
    }
    reader.releaseLock()
  }

  const parsedToolCalls = hasToolCalls
    ? Object.values(toolCallsMap)
        .filter((tc) => tc.name)
        .map((tc) => ({
          ...tc,
          name: normalizeToolName(tc.name),
        }))
    : undefined

  return {
    content: accumulated,
    toolCalls:
      parsedToolCalls && parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
  }
}

/**
 * 测试模型连接健康度与延迟
 */
export async function testConnection(
  settings: AISettings,
): Promise<{ success: boolean; latencyMs?: number; error?: string }> {
  const startTime = Date.now()
  try {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Say OK' },
    ]
    await callModelApi(settings, messages, 10)
    const latencyMs = Date.now() - startTime
    return { success: true, latencyMs }
  } catch (err: unknown) {
    const errorMsg = (err as Error)?.message || '连接失败'
    return { success: false, error: errorMsg }
  }
}

/**
 * 动态拉取服务商支持的全部模型列表
 */
export async function fetchProviderModels(settings: AISettings): Promise<string[]> {
  const protocol = settings.protocol || 'openai'
  const baseUrl = normalizeBaseUrl(settings.baseUrl)
  if (!baseUrl) {
    throw new Error('请先填写或选择 API 接口地址 (Base URL)')
  }

  // 1. Ollama 专有兼容探针（优先探测 /api/tags，兼容 /v1/models）
  if (settings.provider === 'ollama' || baseUrl.includes(':11434')) {
    const hostRoot = baseUrl.replace(/\/v1\/?$/, '').replace(/\/api\/?$/, '')
    try {
      const res = await fetch(`${hostRoot}/api/tags`, {
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.models)) {
          const names = data.models
            .map((m: { name?: string; model?: string }) => m.name || m.model)
            .filter(Boolean) as string[]
          if (names.length > 0) return names
        }
      }
    } catch {
      // 降级尝试标准 /v1/models
    }
  }

  // 2. Google Gemini 协议（支持 pageSize=100 与 nextPageToken 循环全量分页拉取）
  if (protocol === 'gemini') {
    const key = settings.apiKey?.trim() || ''
    if (!key) {
      throw new Error('获取 Gemini 模型列表需要填写 API Key')
    }
    const baseEndpoint = buildModelsEndpoint(baseUrl, 'gemini')
    const allModels: string[] = []
    let pageToken: string | undefined = undefined
    let pageCount = 0
    const MAX_PAGES = 10

    do {
      pageCount++
      const url = new URL(baseEndpoint)
      url.searchParams.set('key', key)
      url.searchParams.set('pageSize', '100')
      if (pageToken) {
        url.searchParams.set('pageToken', pageToken)
      }

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`Gemini 模型拉取失败 (${res.status}): ${errText || res.statusText}`)
      }
      const data = await res.json()
      if (Array.isArray(data.models)) {
        const names = data.models
          .filter((m: { name?: string; supportedGenerationMethods?: string[] }) => {
            const methods = m.supportedGenerationMethods || []
            return methods.includes('generateContent') || m.name?.includes('gemini')
          })
          .map((m: { name?: string }) => (m.name || '').replace(/^models\//, ''))
          .filter(Boolean) as string[]
        allModels.push(...names)
      }
      pageToken = typeof data.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : undefined
    } while (pageToken && pageCount < MAX_PAGES)

    return Array.from(new Set(allModels))
  }

  // 3. Anthropic Claude 协议（支持 limit=100 与 after_id 循环全量分页拉取）
  if (protocol === 'anthropic') {
    const cleanKey = settings.apiKey?.trim().replace(/^["']|["']$/g, '') || ''
    if (!cleanKey) {
      throw new Error('获取 Claude 模型列表需要填写 API Key')
    }
    const baseEndpoint = buildModelsEndpoint(baseUrl, 'anthropic')
    const allModels: string[] = []
    let afterId: string | undefined = undefined
    let hasMore = true
    let pageCount = 0
    const MAX_PAGES = 10

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': cleanKey,
      'Authorization': `Bearer ${cleanKey}`,
    }

    while (hasMore && pageCount < MAX_PAGES) {
      pageCount++
      const url = new URL(baseEndpoint)
      url.searchParams.set('limit', '100')
      if (afterId) {
        url.searchParams.set('after_id', afterId)
      }

      let res = await fetch(url.toString(), {
        method: 'GET',
        headers,
      })

      // 若 Anthropic /v1/models 探测返回 404/405（常见于 Anthropic-兼容反代网关只暴露了 /v1/models），尝试回退探针
      if (!res.ok && res.status >= 400 && res.status < 500) {
        try {
          const fallbackEndpoint = `${baseUrl.replace(/\/+$/, '')}/v1/models`
          const fallbackRes = await fetch(fallbackEndpoint, { method: 'GET', headers })
          if (fallbackRes.ok) res = fallbackRes
        } catch {
          // ignore fallback
        }
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`Claude 模型拉取失败 (${res.status}): ${errText || res.statusText}`)
      }
      const data = await res.json()
      if (Array.isArray(data.data)) {
        const names = data.data.map((m: { id?: string; name?: string }) => m.id || m.name).filter(Boolean) as string[]
        allModels.push(...names)
        afterId = typeof data.last_id === 'string' ? data.last_id : undefined
        hasMore = Boolean(data.has_more && afterId)
      } else if (Array.isArray(data.models)) {
        const names = data.models.map((m: { id?: string; name?: string; model?: string }) => m.id || m.name || m.model).filter(Boolean) as string[]
        allModels.push(...names)
        hasMore = false
      } else {
        hasMore = false
      }
    }

    return Array.from(new Set(allModels))
  }

  // 4. OpenAI 兼容协议 (涵盖大部分平台、ModelScope、SiliconFlow 及各类聚合网关)
  const endpoint = buildModelsEndpoint(baseUrl, 'openai')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const cleanKey = settings.apiKey?.trim().replace(/^["']|["']$/g, '')
  if (cleanKey) {
    headers.Authorization = `Bearer ${cleanKey}`
  }

  let res = await fetch(endpoint, { method: 'GET', headers })
  // 若未找到且不含 /v1/，自动回退探测 /v1/models
  if (res.status === 404 && !endpoint.includes('/v1/')) {
    const fallbackEndpoint = `${baseUrl.replace(/\/+$/, '')}/v1/models`
    try {
      const fallbackRes = await fetch(fallbackEndpoint, { method: 'GET', headers })
      if (fallbackRes.ok) res = fallbackRes
    } catch {
      // 忽略 fallback 异常
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`模型列表拉取失败 (${res.status}): ${errText || res.statusText}`)
  }

  const allRawList: unknown[] = []
  let data = await res.json()

  const extractItems = (payload: unknown): unknown[] => {
    if (!payload || typeof payload !== 'object') return []
    const obj = payload as Record<string, unknown>
    if (Array.isArray(obj.data)) return obj.data
    if (Array.isArray(obj.models)) return obj.models
    if (Array.isArray(payload)) return payload
    return []
  }

  allRawList.push(...extractItems(data))

  // 兼容标准 OpenAI 游标分页 (has_more / after) 以及 next_page URL / page_token
  let pageCount = 1
  const MAX_PAGES = 10
  while (pageCount < MAX_PAGES) {
    pageCount++
    let nextUrl: string | null = null

    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>
      if (obj.has_more === true) {
        const rawItems = extractItems(obj)
        const lastItem = rawItems[rawItems.length - 1] as Record<string, unknown> | undefined
        const lastId = (obj.last_id as string) || (lastItem?.id as string)
        if (lastId) {
          try {
            const u = new URL(res.url)
            u.searchParams.set('after', lastId)
            nextUrl = u.toString()
          } catch {
            // ignore URL parse errors
          }
        }
      } else if (typeof obj.next_page === 'string' && obj.next_page) {
        try {
          nextUrl = new URL(obj.next_page, res.url).toString()
        } catch {
          // ignore
        }
      } else if (typeof obj.next_page_token === 'string' && obj.next_page_token) {
        try {
          const u = new URL(res.url)
          u.searchParams.set('page_token', obj.next_page_token)
          nextUrl = u.toString()
        } catch {
          // ignore
        }
      }
    }

    if (!nextUrl) break

    try {
      const nextRes = await fetch(nextUrl, { method: 'GET', headers })
      if (!nextRes.ok) break
      data = await nextRes.json()
      const newItems = extractItems(data)
      if (newItems.length === 0) break
      allRawList.push(...newItems)
    } catch {
      break
    }
  }

  const rawList = allRawList

  const modelNames: string[] = rawList
    .map((m: unknown) => {
      if (typeof m === 'string') return m
      if (m && typeof m === 'object') {
        const obj = m as Record<string, unknown>
        return String(obj.id || obj.name || obj.model || '')
      }
      return ''
    })
    .filter(Boolean)

  const uniqueModels = Array.from(new Set(modelNames))

  // 智能排序：优先将对话/编程/推理模型置顶，将向量嵌入/语音/生图模型排在后面
  const isChatModel = (id: string) => {
    const lower = id.toLowerCase()
    return (
      !lower.includes('embedding') &&
      !lower.includes('rerank') &&
      !lower.includes('whisper') &&
      !lower.includes('tts') &&
      !lower.includes('moderation') &&
      !lower.includes('dall-e') &&
      !lower.includes('flux') &&
      !lower.includes('stable-diffusion')
    )
  }

  return uniqueModels.sort((a, b) => {
    const aChat = isChatModel(a)
    const bChat = isChatModel(b)
    if (aChat && !bChat) return -1
    if (!aChat && bChat) return 1
    return a.localeCompare(b)
  })
}

/**
 * 场景一：自然语言意图转 Shell 命令与语法解释
 */
export async function generateCommand(
  settings: AISettings,
  userIntent: string,
  context: AIPromptContext = {},
): Promise<{
  command: string
  explanation: string
  risk: CommandRiskAnalysis
}> {
  const systemPrompt = `你是一个专业的 Linux / Unix 运维架构师助手 (Qshell AIOps Copilot)。
你的任务是根据用户的运维意图和当前的系统上下文，生成一条精准、安全且开箱即用的 Shell 命令，并用中文解释其参数含义。

当前目标环境信息：
- 操作系统/发行版: ${context.osDistro || context.osType || 'Linux (Debian/Ubuntu/CentOS 通用)'}
- 当前工作目录: ${context.currentDir || '~'}
- 已有前置命令或相关输入: ${context.currentCommand || '无'}

安全与只读白名单规范：
1. 涉及查询、诊断、排查、定位意图时，必须优先生成【只读安全命令】（如 status, ps, ss, lsof, df, free, cat, journalctl, docker ps 等），确保命令可直接在安全白名单中放行；
2. 涉及全盘或大范围统计时，严禁无限制递归（如严禁使用 \`du -sh /*\` 或 \`find /\`，必须强制添加深度限制如 \`du -h --max-depth=1 /path\`）；
3. 严禁生成隐蔽的子 Shell 执行（如 $() 或反引号）或未经确认的高危删除/清空/格式化等破坏性指令。

输出要求：
必须且仅能以合法的 JSON 格式返回，不要包含 markdown 外部包裹（如直接返回纯 JSON），格式如下：
{
  "command": "待执行的单行完整 Shell 命令",
  "explanation": "简明扼要的命令与参数逐项解释（中文，1-3句话）"
}`

  const userPrompt = `用户意图：${userIntent}`

  const rawOutput = await callModelApi(
    settings,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    1024,
  )

  let command = ''
  let explanation = ''

  try {
    const cleaned = rawOutput
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()
    const parsed = JSON.parse(cleaned)
    command = parsed.command || ''
    explanation = parsed.explanation || ''
  } catch {
    // 兜底提取第一行作为命令
    const lines = rawOutput.trim().split('\n')
    command = lines[0].replace(/^[$#]\s*/, '').trim()
    explanation = lines.slice(1).join('\n').trim() || 'AI 生成命令'
  }

  const risk = evaluateCommandRisk(command)

  return {
    command,
    explanation,
    risk,
  }
}

/**
 * 场景二：终端报错日志智能诊断与根因自愈分析
 */
export async function diagnoseTerminalError(
  settings: AISettings,
  rawErrorSnippet: string,
  context: AIPromptContext = {},
): Promise<AIDiagnosisResult> {
  // 1. 先经本地端侧 DLP 脱敏清洗
  const cleanErrorSnippet = settings.enableDlp
    ? sanitizeLogContent(rawErrorSnippet, { maskPrivateIps: settings.maskPrivateIps })
    : rawErrorSnippet

  const systemPrompt = `你是一个深谙 Linux 系统底层原理、网络协议栈与各类主流中间件的 AIOps 故障排查专家。
用户正在远程终端执行命令时遇到了报错。请帮用户分析报错现象、推导根本原因，并给出最小影响面的排查与自愈建议。

安全排查规范：
1. recommendedCommands 中推荐的排查定位命令必须优先选用【只读安全命令】（查看服务状态、端口监听、截取最新报错日志等）；
2. 严禁推荐导致高负载或 I/O 卡死的无界深度递归指令（如禁止 \`du -sh /*\` 或 \`find /\`）；
3. 涉及修改配置、重启服务或终止进程的自愈命令，必须在 explanation 中明确说明影响面。

目标系统上下文：
- 操作系统发行版: ${context.osDistro || context.osType || 'Linux'}
- 工作目录: ${context.currentDir || '未知'}
- 触发报错的命令: ${context.currentCommand || '未知'}

请严格按照如下合法的 JSON 格式输出，不要包含多余文字：
{
  "rootCause": "核心病根（1句话直接点明原因，如：本地3000端口已被其他Node进程占用）",
  "explanation": "详细诊断分析（说明错误原委与潜在风险，2-4句话）",
  "suggestions": [
    "排查建议1（例如：检查端口监听占用）",
    "排查建议2（例如：修改配置文件并重启服务）"
  ],
  "recommendedCommands": [
    {
      "command": "推荐排查或修复的具体命令",
      "explanation": "该命令执行的作用与目的"
    }
  ]
}`

  const userPrompt = `终端报错日志与上下文信息如下：
\`\`\`
${cleanErrorSnippet.slice(-3000)}
\`\`\``

  const rawOutput = await callModelApi(
    settings,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    2048,
  )

  let parsed: any = null
  try {
    const cleaned = rawOutput
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()
    parsed = JSON.parse(cleaned)
  } catch {
    parsed = {
      rootCause: '未能结构化解析模型诊断结果',
      explanation: rawOutput,
      suggestions: ['请检查终端错误详情并谨慎执行命令'],
      recommendedCommands: [],
    }
  }

  const recommendedCommands = Array.isArray(parsed.recommendedCommands)
    ? parsed.recommendedCommands.map((item: any) => ({
        command: item.command || '',
        explanation: item.explanation || '',
        risk: evaluateCommandRisk(item.command || ''),
      }))
    : []

  return {
    rootCause: parsed.rootCause || '分析完成',
    explanation: parsed.explanation || '',
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    recommendedCommands,
  }
}

export const SHELL_LANGUAGES = new Set([
  'bash',
  'sh',
  'shell',
  'zsh',
  'powershell',
  'pwsh',
  'ps1',
  'cmd',
  'bat',
])

export const NON_SHELL_LANGUAGES = new Set([
  'text',
  'txt',
  'plain',
  'plaintext',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'html',
  'css',
  'javascript',
  'js',
  'typescript',
  'ts',
  'python',
  'py',
  'java',
  'c',
  'cpp',
  'go',
  'rust',
  'rs',
  'sql',
  'md',
  'markdown',
  'log',
  'output',
  'console',
  'diff',
  'dockerfile',
  'conf',
  'ini',
])

/**
 * 校验候选文本是否可能是合法的 Shell 命令行，排除普通描述性文本或非命令标签
 */
export function isLikelyShellCommand(cmd: string): boolean {
  if (!cmd || cmd.length > 300) return false
  const trimmed = cmd.trim()
  if (!trimmed) return false

  // Shell 命令中不应包含中文字符
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return false

  // 不得以 Markdown 符号、列表符号或括号起始
  if (/^[*\-+>|~`![\]【】{}<]/.test(trimmed)) return false

  // 不得是有序列表序号（如 "1. "）
  if (/^\d+\.\s/.test(trimmed)) return false

  // 排除已知的非命令占位标记、常见文本说明标签
  const lower = trimmed.toLowerCase()
  const disallowedLabels = [
    'text',
    'test',
    'txt',
    'plain',
    'output',
    'stdout',
    'stderr',
    'none',
    'null',
    'undefined',
    'error',
    'prompt',
    'result',
    'note',
    'notes',
    'response',
    'code',
  ]
  if (disallowedLabels.includes(lower)) {
    return false
  }

  // 必须以字母、数字、路径符号（. / ~ \）或系统环境符号（$ %）起始
  if (!/^[a-zA-Z0-9_./~\\$%-]/.test(trimmed)) return false

  return true
}

/**
 * 从生成的文本中提取 Shell 命令与安全评级
 */
export function extractCommandsFromContent(rawOutput: string): Array<{
  command: string
  explanation?: string
  risk: CommandRiskAnalysis
}> {
  const commands: Array<{
    command: string
    explanation?: string
    risk: CommandRiskAnalysis
  }> = []

  // 精准捕获 Markdown 代码块：捕获其语言标识符与块内代码
  const codeBlockRegex = /```([a-zA-Z0-9_-]*)[^\n\r]*(?:\r?\n)([\s\S]*?)```/gi
  let match: RegExpExecArray | null

  while ((match = codeBlockRegex.exec(rawOutput)) !== null) {
    const lang = (match[1] || '').trim().toLowerCase()
    const rawBody = match[2].trim()

    // 1. 如果明确指定了非 Shell 语言标签（如 text, json, yaml, python 等），坚决跳过
    if (NON_SHELL_LANGUAGES.has(lang)) {
      continue
    }

    // 2. 如果指定了语言但不是 Shell 语言，坚决跳过
    if (lang && !SHELL_LANGUAGES.has(lang)) {
      continue
    }

    if (!rawBody) continue

    // 3. 提取非注释、非空行
    const validLines = rawBody
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'))

    if (validLines.length === 0) continue

    // 提取第一条非注释有效行作为推荐执行命令，并自动去除终端提示符前缀（如 '$ ', '> '）
    const firstCmd = validLines[0].replace(/^[$>]\s+/, '').trim()

    // 4. 严格校验是否像真正的 Shell 指令（过滤非代码普通文本或误判）
    if (!isLikelyShellCommand(firstCmd)) {
      continue
    }

    // 避免重复命令
    if (!commands.some((c) => c.command === firstCmd)) {
      commands.push({
        command: firstCmd,
        risk: evaluateCommandRisk(firstCmd),
      })
    }
  }

  return commands
}

export interface ExecutedToolItem {
  command: string
  output: string
  rawTerminalOutput?: string
  explanation?: string
}

/**
 * 场景三：全局 AI 悬浮助手多轮运维对话与 Agent 智能体交互 (支持 SSE 流式传输与 Token 级硬打断)
 * 基于标准工业级 ReAct (Reasoning + Acting) 自主循环架构：
 * 1. 支持最多 5 轮动态自适应下钻排查，证据确凿时自主提前退出 (Early Exit)
 * 2. 统一支持 OpenAI JSON 与国产模型 (通义千问/DeepSeek) 文本 XML 双协议工具解析
 * 3. 实时洗净协议代码，杜绝内部通信标签泄露到 UI
 */
export async function sendAssistantChat(
  settings: AISettings,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  mode: AIAssistantMode = 'agent',
  context: AIPromptContext = {},
  signal?: AbortSignal,
  onChunk?: (chunk: string, accumulated: string) => void,
): Promise<{
  content: string
  commands: Array<{
    command: string
    explanation?: string
    risk: CommandRiskAnalysis
  }>
  executedTool?: ExecutedToolItem
  executedTools?: ExecutedToolItem[]
}> {
  const isAgent = mode === 'agent'

  const fullSystemPrompt = buildSystemPrompt({
    mode,
    context,
    enableDlp: settings.enableDlp,
    maskPrivateIps: settings.maskPrivateIps,
  })

  const messages: ChatMessage[] = [
    { role: 'system', content: fullSystemPrompt },
  ]

  // Sanitize user messages if DLP enabled
  for (const item of history) {
    const content = item.role === 'user' && settings.enableDlp
      ? sanitizeLogContent(item.content, { maskPrivateIps: settings.maskPrivateIps })
      : item.content
    messages.push({
      role: item.role,
      content,
    })
  }

  // 工业级 ReAct 循环配置：Agent 模式支持最多 5 轮动态自适应下钻排查
  const MAX_AGENT_STEPS = isAgent ? 5 : 1
  let currentStep = 0
  let isDone = false
  const executedTools: ExecutedToolItem[] = []

  let accumulatedPrefix = ''
  let finalAssistantContent = ''

  while (currentStep < MAX_AGENT_STEPS && !isDone) {
    if (signal?.aborted) break

    const isLastStep = currentStep === MAX_AGENT_STEPS - 1
    // 最后一轮不传递工具，强制收敛模型给出终局诊断；若是纯指令拆解任务则不传递服务器探针工具
    const tools = isAgent && !isLastStep && !context.isExplainShell ? AGENT_TOOLS : undefined

    if (isLastStep && executedTools.length > 0) {
      messages.push({
        role: 'user',
        content:
          '[系统指令：排障采样已完成，请严格基于前序各步骤获取的真实数据，在正文第一行直接给出最终明确的排查结论与处置方案。请勿再调用任何工具。]',
      })
    }

    const currentStepIndex = currentStep + 1
    // 动态智能分配最大生成 Token：
    // 优先采用用户配置的 maxTokens，若未配置或偏低，在 Agent 模式 / 推理模型下至少分配 8192，
    // 彻底解决 DeepSeek-R1 / Qwen 等思维链模型在复杂集群巡检场景下中途耗尽 2048 Token 截断卡死的问题。
    const dynamicMaxTokens = Math.max(
      settings.maxTokens || 4096,
      isAgent ? 8192 : 4096,
    )

    const stepResult = await callModelApiStream(
      settings,
      messages,
      dynamicMaxTokens,
      signal,
      (chunk, stepAccumulated) => {
        const cleanedLive = stripAllToolCallMarkup(stepAccumulated)
        onChunk?.(chunk, accumulatedPrefix + cleanedLive)
      },
      tools,
    )

    if (signal?.aborted) break

    // 1. 双协议统一提取工具调用 (OpenAI JSON + 文本标记)
    const apiToolCalls = stepResult.toolCalls || []
    const textToolCalls = !isLastStep ? extractTextToolCalls(stepResult.content || '') : []

    const combinedCalls: ExtractedToolCall[] = [...apiToolCalls]
    for (const ttc of textToolCalls) {
      if (!combinedCalls.some((c) => c.name === ttc.name && c.arguments === ttc.arguments)) {
        combinedCalls.push(ttc)
      }
    }

    const cleanStepContent = stripAllToolCallMarkup(stepResult.content || '')

    // 2. 如果模型未发起任何工具调用，或已达到硬熔断上限，直接结束循环！(Early Exit)
    if (combinedCalls.length === 0 || isLastStep) {
      let stepText = cleanStepContent
      const contentWithoutThink = stepText
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/<think>[\s\S]*$/, '')
        .trim()

      if (!contentWithoutThink && stepText.includes('<think>')) {
        stepText += '\n\n> 💡 **提示**：模型针对多台主机的深度推导较长。上方已为您完整保留思考演进过程；如需进一步研判，可追问或在 AI 设置中进一步调大 Max Tokens。'
      }

      finalAssistantContent = accumulatedPrefix + stepText
      isDone = true
      break
    }

    // 3. 模型在此轮发起了工具调用
    // 先把包含思考过程/前置说明的模型回答推入上下文
    messages.push({
      role: 'assistant',
      content: stepResult.content || '',
      tool_calls: combinedCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      })),
    })

    if (cleanStepContent) {
      accumulatedPrefix += cleanStepContent + '\n\n'
    }

    // 逐个执行该轮所有工具
    for (const call of combinedCalls) {
      if (signal?.aborted) break
      const normCallName = normalizeToolName(call.name)
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = JSON.parse(call.arguments || '{}')
      } catch {
        parsedArgs = {}
      }

      const isCmd = Boolean(parsedArgs.command) || normCallName === 'execute_readonly_command'
      const toolDisplayDesc = isCmd
        ? `只读排障指令【${parsedArgs.command || ''}】`
        : `安全探测【${parsedArgs.metric || '系统'}】指标`

      const toolNotice = `> 🤖 **Agent 智能决策调用 (第 ${currentStepIndex} 步)：${toolDisplayDesc}...**\n\n`
      accumulatedPrefix += toolNotice
      onChunk?.(toolNotice, accumulatedPrefix)

      const toolExecContext = {
        servers: (context.servers as any) || [],
        serverGroups: (context.serverGroups as any) || [],
        activeServerId: context.activeServerId || null,
        customBlacklist: settings.customBlacklist || [],
        signal,
      }

      const execResult = await executeAgentTool(normCallName, parsedArgs, toolExecContext)
      if (execResult.commandRan) {
        executedTools.push({
          command: execResult.commandRan,
          output: execResult.rawTerminalOutput || execResult.output,
          rawTerminalOutput: execResult.rawTerminalOutput,
          explanation: execResult.explanation || (parsedArgs.explanation as string),
        })
      }

      // 保护性截断冗余工具输出，防止上下文过大导致思维链发散和 Token 耗尽
      let sanitizedToolOutput = execResult.output || ''
      if (sanitizedToolOutput.length > 2500) {
        const head = sanitizedToolOutput.slice(0, 1500)
        const tail = sanitizedToolOutput.slice(-800)
        sanitizedToolOutput = `${head}\n\n[...⚠️ 该主机输出过长，已智能保留核心指标首尾段落...]\n\n${tail}`
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: normCallName,
        content: sanitizedToolOutput,
      })
    }

    currentStep++
  }

  const finalCleanedContent = stripAllToolCallMarkup(finalAssistantContent || accumulatedPrefix)

  return {
    content: finalCleanedContent,
    commands: extractCommandsFromContent(finalCleanedContent),
    executedTool: executedTools[0],
    executedTools,
  }
}

