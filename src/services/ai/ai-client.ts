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
import { evaluateCommandRisk } from './risk-evaluator'
import {
  AGENT_TOOLS,
  executeAgentTool,
  normalizeToolName,
  stripDsmlTags,
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
    trimmed === 'https://api.groq.com/openai'
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

    const endpoint = buildAnthropicEndpoint(baseUrl)
    const res = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey || '',
        'anthropic-version': '2023-06-01',
      },
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

    const endpoint = buildAnthropicEndpoint(baseUrl)
    const res = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey || '',
        'anthropic-version': '2023-06-01',
      },
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

  // 2. Google Gemini 协议
  if (protocol === 'gemini') {
    const key = settings.apiKey?.trim() || ''
    if (!key) {
      throw new Error('获取 Gemini 模型列表需要填写 API Key')
    }
    const endpoint = `${buildModelsEndpoint(baseUrl, 'gemini')}?key=${key}`
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Gemini 模型拉取失败 (${res.status}): ${errText || res.statusText}`)
    }
    const data = await res.json()
    if (Array.isArray(data.models)) {
      return data.models
        .filter((m: { name?: string; supportedGenerationMethods?: string[] }) => {
          const methods = m.supportedGenerationMethods || []
          return methods.includes('generateContent') || m.name?.includes('gemini')
        })
        .map((m: { name?: string }) => (m.name || '').replace(/^models\//, ''))
        .filter(Boolean)
    }
    return []
  }

  // 3. Anthropic Claude 协议
  if (protocol === 'anthropic') {
    const key = settings.apiKey?.trim() || ''
    if (!key) {
      throw new Error('获取 Claude 模型列表需要填写 API Key')
    }
    const endpoint = buildModelsEndpoint(baseUrl, 'anthropic')
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Claude 模型拉取失败 (${res.status}): ${errText || res.statusText}`)
    }
    const data = await res.json()
    if (Array.isArray(data.data)) {
      return data.data.map((m: { id?: string; name?: string }) => m.id || m.name).filter(Boolean)
    }
    return []
  }

  // 4. OpenAI 兼容协议 (涵盖大部分平台)
  const endpoint = buildModelsEndpoint(baseUrl, 'openai')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (settings.apiKey?.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`
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

  const data = await res.json()
  let rawList: unknown[] = []
  if (Array.isArray(data.data)) {
    rawList = data.data
  } else if (Array.isArray(data.models)) {
    rawList = data.models
  } else if (Array.isArray(data)) {
    rawList = data
  }

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
  if (/^[*\-+>|~`!\[\]【】{}<]/.test(trimmed)) return false

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

  const systemPrompt = isAgent
    ? `你是 Qshell 全局智能终端运维 Agent。你具备全方位的 Linux 运维、云原生、Docker、Kubernetes、网络协议栈与 Shell 脚本专长。
你的核心原则：
1. 【排查结论直出与优先总结（绝对核心原则）】：
   - 当用户询问服务器状态或排查某个具体指标/高占用应用时（例如“内存占用最高的是哪个应用”、“查看CPU占用排行”、“哪些容器正在运行”）：
   - 如果上下文已包含 [只读指标实时探测结果]，你必须直接依据探测到的真实客观数据进行严密分析，**并在回答的正文第一行直接给出清晰明确的【排查结论总结】**（例如明确回答：“经现场实时排查，目标服务器上内存占用最高的是 **EMQX 消息服务**（PID xxxx，占用 xx%），其次是两个 Java 业务应用...”）；
   - **绝对严禁**只输出排查步骤而让用户自己去跑命令确认结果！你的首要任务是直接替用户查明并总结结论；
   - 若用户需要进一步排障、杀进程或优化配置，可在结论下方提供建议操作命令；
2. 【深度思考过程规范（自动折叠）】：
   - 必须在 <think>...</think> 标签内展开详实、严密、深度的技术推导与因果溯源（前端将自动为你收折展示，用户可点击展开查验）：
     a. 【意图与目标定位】：分析用户意图的核心痛点、目标操作系统环境与资产拓扑关系；
     b. 【指标关联与因果推导】：深入推导指标背后的系统因果逻辑（如多进程内存 RSS vs 物理总内存比例、JVM 堆配置与参数影响、Swap 换页风险、I/O 潜在压力等）；
     c. 【方案决策与安全权衡】：权衡只读排障路径与命令安全性，推演最稳妥的排查与建议步骤；
   - 在 <think> 标签闭合后，再输出正文，并在正文首行直接呈现条理分明、直击要点的排查结论总结与专业执行方案；
3. 【系统精准兼容与只读白名单规范】：
   - 必须优先识别【目标操作系统环境】（如 Ubuntu/Debian, CentOS/RHEL, Alpine, macOS, Windows 等），生成与该系统完全原生兼容的 Shell/PowerShell 指令，绝不在 Linux 下生成 Windows 专有命令，也绝不在 Windows 下生成 Linux 专有命令；
   - 排查与诊断时，推荐的命令行必须优先选用【只读白名单指令】（如查看状态、日志切片、端口监听、进程列表、资源占用、容器只读状态等，如 \`systemctl status\`、\`journalctl -n 50\`、\`ss -tulpn\`、\`docker ps\` 等）；
   - 严禁提供导致系统 I/O 阻塞或卡死的无限制全盘递归遍历指令（如严禁使用 \`find /\`、\`du -sh /*\` 等，必须使用限制深度的安全命令如 \`du -h --max-depth=1 /var/log | sort -hr | head -n 5\`）；
   - 【严禁推荐持续阻塞式交互指令（如 watch, tail -f, htop）】：严禁在代码块中推荐持续循环、常驻阻塞或交互式 TUI 命令（如 \`watch\`、\`tail -f\`、\`htop\` 等），因为后台安全执行卡片无法交互且会超时挂起；若需监控进程或查看最新状态，必须推荐【单次即时采样指令】（例如直接使用 \`ps -p <PID> -o %cpu,%mem,cmd\`、\`top -b -n 1\`、\`tail -n 30\` 等）；
   - 严禁使用子 Shell 替换（\`$()\`、反引号）、未经授权的重定向写盘、或高危破坏性指令；
   - 若用户明确要求进行写操作（如重启服务、修改配置、终止进程），可以提供相应命令，但在回答中必须明确标识该操作具有变更性质与潜在风险，以便系统安全执行卡片进行二次授权；
4. 【双引擎诊断与多轮递进排障规范】：
   - 快速通道（Fast Path）：对于日常指标查询与状态巡检，必须利用前置实时探针数据在首行直出明确结论；
   - 深度专家诊断（Deep Diagnosis）：当用户要求“深度排查”、“追查根因”、“分析终端报错/输出”或在执行完排查指令后要求进一步诊断时：
     a. 【现象定位】：根据实际输出明确当前系统出现的客观异常；
     b. 【因果溯源】：推导故障背后的根本原因（如内存泄漏、连接池耗尽、句柄超限、磁盘打满等）；
     c. 【处置建议】：优先提供只读命令验证假设，如需写操作明确风险；
5. 如果涉及命令行操作，请优先提供可直接执行的 Shell 命令，必须使用 \`\`\`bash 或 \`\`\`sh 独立代码块包裹；
6. 语言简洁、直接、富有科技感与专家水准；
7. 【未连接活动服务器与未指定目标规范】：
   - 当 [当前活跃连接目标] 为未连接任何终端且用户在问题中未指明具体服务器名称时（如用户点击了通用快捷入口或使用代词“当前连接的服务器”、“这台机器”）：
   - **绝对严禁**擅自猜测或随机挑选一台默认服务器发起探测！
   - 你必须直接礼貌地向用户说明当前未连接任何活动终端，无法直接执行服务器排查。系统已为用户唤出下方快捷选择卡片，请明确提示用户可在下方卡片中点击或勾选目标服务器发起排查，也可以直接回复要排查哪台服务器；
8. 【非运维、生活闲聊与跨领域提问处理规范（优雅回归与工具阻断）】：
   - 当用户提出与服务器运维、终端操作、编程脚本或系统技术无关的跨领域生活闲聊/百科问题时（例如询问宠物猫狗品种、生活常识、天气、菜谱、娱乐八卦等）：
     a. 【严格阻断工具执行与 Shell 命令生成】：绝对严禁调用任何服务器探针工具（如 probe_server 或系统探针），绝对严禁生成无关的 Shell 伪命令或推荐执行块；
     b. 【礼貌简洁作答与自然引导】：在 <think>（若有）分析后，正文使用 1~2 句话给予友好、精炼的回答，随后自然回归并表明 Qshell 运维小助手的角色职责（例如：“不过作为 Qshell 运维小助手，我更专注于帮您排查 Linux 服务器故障、分析高负载进程或编写 Shell 脚本。如果您有任何服务器或终端相关的问题，随时告诉我！”）；
     c. 【多义词与技术歧义保护】：注意区分技术术语与日常词汇（如 Linux 中的 cat 查看文件、tail 截取日志、kill 终止进程、sleep 延时、ping 探测、docker、nginx、tmux 等），在技术运维上下文中必须严肃作为专业命令处理，严禁误判为宠物或生活闲聊。`
    : `你是 Qshell 桌面终端的 AI 智能助手。你友善、耐心且具备专业的 Linux/Unix/Windows 运维与开发知识。
你的职责是帮助用户解答各种关于 SSH 远程连接、服务器配置、命令使用、系统原理与运维脚本的疑问。条理清晰，友好专业。排查问题时优先给出明确总结结论，并推荐安全只读指令。若有深度推导请使用 <think>...</think> 包裹。
若用户询问与服务器运维、终端操作无关的生活常识或日常闲聊（如宠物猫狗、美食、娱乐等），请用 1~2 句话简要礼貌回应，并自然引导用户咨询服务器运维、故障排查或脚本相关的问题；遇到含 cat、tail、kill 等系统命令时必须按专业运维指令正常解答。`

  let fullSystemPrompt = systemPrompt

  // Add contextual hint if present
  if (
    context.currentDir ||
    context.osType ||
    context.osDistro ||
    context.serverName ||
    context.serverHost ||
    context.selectedText ||
    context.serverInventory ||
    context.probeReport ||
    !context.activeServerId
  ) {
    const contextItems: string[] = []
    if (context.serverName || context.serverHost) {
      contextItems.push(`当前活跃连接目标: ${context.serverName || ''} (${context.serverHost || ''})`)
    } else {
      contextItems.push(`当前活跃连接目标: 【未连接任何终端】（当前处于首页或未打开任何 SSH 终端标签页。若用户未明确指名要查看哪台服务器，必须提示用户未连接终端并引导用户选择具体服务器，绝不可随意猜测连接哪台）`)
    }
    if (context.osType || context.osDistro) {
      const osName = context.osDistro
        ? `${context.osDistro} (${context.osType || 'Linux'})`
        : (context.osType || 'Linux')
      contextItems.push(`目标操作系统环境: ${osName}（请严格依据此系统类型生成原生兼容的指令）`)
    }
    if (context.currentDir) contextItems.push(`当前工作目录: ${context.currentDir}`)
    if (context.serverInventory) {
      const cleanInv = settings.enableDlp
        ? sanitizeLogContent(context.serverInventory, { maskPrivateIps: settings.maskPrivateIps })
        : context.serverInventory
      contextItems.push(`[已纳管服务器与分组资产]\n${cleanInv}`)
    }
    if (context.probeReport) {
      const cleanReport = settings.enableDlp
        ? sanitizeLogContent(context.probeReport, { maskPrivateIps: settings.maskPrivateIps })
        : context.probeReport
      contextItems.push(`[只读指标实时探测结果]\n${cleanReport}`)
    }
    if (context.selectedText) {
      const cleanSnippet = settings.enableDlp
        ? sanitizeLogContent(context.selectedText, { maskPrivateIps: settings.maskPrivateIps })
        : context.selectedText
      contextItems.push(`用户选中内容: ${cleanSnippet}`)
    }
    fullSystemPrompt += `\n\n[环境上下文参考]\n${contextItems.join('\n')}`
  }

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
    // 最后一轮不传递工具，强制收敛模型给出终局诊断
    const tools = isAgent && !isLastStep ? AGENT_TOOLS : undefined

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

