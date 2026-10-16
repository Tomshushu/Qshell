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
} from '@/types/ai'
import { sanitizeLogContent } from './dlp-sanitizer'
import { evaluateCommandRisk } from './risk-evaluator'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
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

/**
 * 通用单次请求派发
 */
async function callModelApi(
  settings: AISettings,
  messages: ChatMessage[],
  maxTokens = 2048,
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
    const systemMsg = messages.find((m) => m.role === 'system')?.content || ''
    const userAndAssistantMsgs = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role,
        content: m.content,
      }))

    const endpoint = buildAnthropicEndpoint(baseUrl)
    const res = await fetch(endpoint, {
      method: 'POST',
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

    const systemMsg = messages.find((m) => m.role === 'system')?.content
    const bodyPayload: Record<string, unknown> = { contents }
    if (systemMsg) {
      bodyPayload.systemInstruction = {
        parts: [{ text: systemMsg }],
      }
    }

    const endpoint = buildGeminiEndpoint(baseUrl, settings.model, settings.apiKey || '')
    const res = await fetch(endpoint, {
      method: 'POST',
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
  return data.choices?.[0]?.message?.content || ''
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
