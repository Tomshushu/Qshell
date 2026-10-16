/**
 * src/types/ai.ts
 *
 * Qshell AIOps & Terminal Copilot 核心类型定义
 * 支持国内外主流大模型（DeepSeek、通义千问、智谱、Kimi、SiliconFlow、OpenAI、Claude、Gemini、Ollama）
 * 以及端侧安全评级与双环隔离定义
 */

export type AIProvider =
  | 'deepseek'
  | 'qwen'
  | 'glm'
  | 'moonshot'
  | 'siliconflow'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'ollama'
  | 'custom'

export type AIProtocol = 'openai' | 'anthropic' | 'gemini'

export interface ProviderPreset {
  id: AIProvider
  name: string
  protocol: AIProtocol
  defaultBaseUrl: string
  defaultModel: string
  recommendedModels: string[]
  websiteUrl: string
  descriptionKey: string
  isDomestic: boolean
  tagText: string
  tagType: 'recommended' | 'domestic' | 'offline' | 'speed' | 'custom' | 'global'
  subtitleKey: string
}

export interface ConfiguredProvider {
  id: string
  provider: AIProvider
  name: string
  protocol: AIProtocol
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number
  maxTokens?: number
  isEnabled: boolean
  lastTestedAt?: number
  lastLatencyMs?: number
  lastTestStatus?: 'success' | 'failed' | null
  lastTestError?: string | null
  createdAt?: number
}

export interface AISettings {
  provider: AIProvider
  protocol: AIProtocol
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  enableDlp: boolean
  maskPrivateIps: boolean
}

export type CommandRiskLevel = 'safe' | 'notice' | 'dangerous' | 'blocked'

export interface CommandRiskAnalysis {
  level: CommandRiskLevel
  command: string
  reasons: string[]
  isBlocked: boolean
}

export interface AIDiagnosisResult {
  rootCause: string
  explanation: string
  suggestions: string[]
  recommendedCommands: Array<{
    command: string
    explanation: string
    risk: CommandRiskAnalysis
  }>
}

export interface AIPromptContext {
  osType?: string
  osDistro?: string
  currentDir?: string
  currentCommand?: string
  recentOutput?: string
  selectedText?: string
}

export type AIAssistantMode = 'agent' | 'chat'

export type AIMascotMood = 'idle' | 'happy' | 'thinking' | 'blink'

export interface AIAssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  mode?: AIAssistantMode
  status?: 'sending' | 'streaming' | 'done' | 'error'
  suggestedCommands?: Array<{
    command: string
    explanation?: string
    risk?: CommandRiskAnalysis
  }>
}

export const AI_PROVIDER_PRESETS: Record<AIProvider, ProviderPreset> = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    recommendedModels: ['deepseek-chat', 'deepseek-reasoner'],
    websiteUrl: 'https://platform.deepseek.com',
    descriptionKey: 'ai_provider_deepseek_desc',
    subtitleKey: 'ai_provider_deepseek_sub',
    isDomestic: true,
    tagText: '推荐',
    tagType: 'recommended',
  },
  qwen: {
    id: 'qwen',
    name: 'Qwen',
    protocol: 'openai',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    recommendedModels: [
      'qwen-plus',
      'qwen-max',
      'qwen-coder-plus',
      'qwen2.5-coder-32b-instruct',
      'qwen-turbo',
    ],
    websiteUrl: 'https://dashscope.console.aliyun.com',
    descriptionKey: 'ai_provider_qwen_desc',
    subtitleKey: 'ai_provider_qwen_sub',
    isDomestic: true,
    tagText: '国内',
    tagType: 'domestic',
  },
  siliconflow: {
    id: 'siliconflow',
    name: 'SiliconFlow',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    recommendedModels: [
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'Pro/deepseek-ai/DeepSeek-V3',
      'Pro/deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen2.5-Coder-32B-Instruct',
      'Qwen/Qwen2.5-72B-Instruct',
    ],
    websiteUrl: 'https://siliconflow.cn',
    descriptionKey: 'ai_provider_siliconflow_desc',
    subtitleKey: 'ai_provider_siliconflow_sub',
    isDomestic: true,
    tagText: '推荐',
    tagType: 'recommended',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    protocol: 'openai',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'deepseek-r1:8b',
    recommendedModels: [
      'deepseek-r1:8b',
      'deepseek-r1:14b',
      'qwen2.5-coder:7b',
      'qwen2.5-coder:14b',
      'llama3.3:70b',
      'llama3.2',
    ],
    websiteUrl: 'https://ollama.com',
    descriptionKey: 'ai_provider_ollama_desc',
    subtitleKey: 'ai_provider_ollama_sub',
    isDomestic: true,
    tagText: '100%离线',
    tagType: 'offline',
  },
  moonshot: {
    id: 'moonshot',
    name: 'Kimi',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-auto',
    recommendedModels: [
      'moonshot-v1-auto',
      'kimi-k1.5',
      'moonshot-v1-128k',
      'moonshot-v1-32k',
    ],
    websiteUrl: 'https://platform.moonshot.cn',
    descriptionKey: 'ai_provider_moonshot_desc',
    subtitleKey: 'ai_provider_moonshot_sub',
    isDomestic: true,
    tagText: '长上下文',
    tagType: 'domestic',
  },
  glm: {
    id: 'glm',
    name: 'GLM',
    protocol: 'openai',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-plus',
    recommendedModels: ['glm-4-plus', 'glm-4-flash', 'glm-4-air', 'glm-4-long'],
    websiteUrl: 'https://bigmodel.cn',
    descriptionKey: 'ai_provider_glm_desc',
    subtitleKey: 'ai_provider_glm_sub',
    isDomestic: true,
    tagText: '国内',
    tagType: 'domestic',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    recommendedModels: ['gpt-4o', 'gpt-4.5-preview', 'o3-mini', 'o1', 'gpt-4o-mini'],
    websiteUrl: 'https://platform.openai.com',
    descriptionKey: 'ai_provider_openai_desc',
    subtitleKey: 'ai_provider_openai_sub',
    isDomestic: false,
    tagText: '国际',
    tagType: 'global',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Claude',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-7-sonnet-20250219',
    recommendedModels: [
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
    ],
    websiteUrl: 'https://console.anthropic.com',
    descriptionKey: 'ai_provider_anthropic_desc',
    subtitleKey: 'ai_provider_anthropic_sub',
    isDomestic: false,
    tagText: '代码顶尖',
    tagType: 'global',
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    protocol: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-3.8-flash',
    recommendedModels: [
      'gemini-3.8-flash',
      'gemini-4-argon',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-pro',
    ],
    websiteUrl: 'https://aistudio.google.com',
    descriptionKey: 'ai_provider_gemini_desc',
    subtitleKey: 'ai_provider_gemini_sub',
    isDomestic: false,
    tagText: '极速推理',
    tagType: 'speed',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    recommendedModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    websiteUrl: 'https://console.groq.com',
    descriptionKey: 'ai_provider_groq_desc',
    subtitleKey: 'ai_provider_groq_sub',
    isDomestic: false,
    tagText: '极速推理',
    tagType: 'speed',
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    protocol: 'openai',
    defaultBaseUrl: '',
    defaultModel: '',
    recommendedModels: [],
    websiteUrl: '',
    descriptionKey: 'ai_provider_custom_desc',
    subtitleKey: 'ai_provider_custom_sub',
    isDomestic: false,
    tagText: '自定义',
    tagType: 'custom',
  },
}
