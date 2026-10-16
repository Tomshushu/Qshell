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

export const AI_PROVIDER_PRESETS: Record<AIProvider, ProviderPreset> = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek (深度求索)',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    recommendedModels: ['deepseek-chat', 'deepseek-reasoner'],
    websiteUrl: 'https://platform.deepseek.com',
    descriptionKey: 'ai_provider_deepseek_desc',
    isDomestic: true,
  },
  qwen: {
    id: 'qwen',
    name: '通义千问 (DashScope)',
    protocol: 'openai',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    recommendedModels: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-2.5-coder-32b-instruct'],
    websiteUrl: 'https://dashscope.console.aliyun.com',
    descriptionKey: 'ai_provider_qwen_desc',
    isDomestic: true,
  },
  glm: {
    id: 'glm',
    name: '智谱清言 (BigModel)',
    protocol: 'openai',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    recommendedModels: ['glm-4-flash', 'glm-4-plus', 'glm-4-air'],
    websiteUrl: 'https://bigmodel.cn',
    descriptionKey: 'ai_provider_glm_desc',
    isDomestic: true,
  },
  moonshot: {
    id: 'moonshot',
    name: '月之暗面 (Moonshot / Kimi)',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    recommendedModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    websiteUrl: 'https://platform.moonshot.cn',
    descriptionKey: 'ai_provider_moonshot_desc',
    isDomestic: true,
  },
  siliconflow: {
    id: 'siliconflow',
    name: '硅基流动 (SiliconFlow)',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    recommendedModels: [
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen2.5-Coder-32B-Instruct',
      'Qwen/Qwen2.5-72B-Instruct',
    ],
    websiteUrl: 'https://siliconflow.cn',
    descriptionKey: 'ai_provider_siliconflow_desc',
    isDomestic: true,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI 官方',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    recommendedModels: ['gpt-4o-mini', 'gpt-4o', 'o1-mini'],
    websiteUrl: 'https://platform.openai.com',
    descriptionKey: 'ai_provider_openai_desc',
    isDomestic: false,
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-20241022',
    recommendedModels: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
    websiteUrl: 'https://console.anthropic.com',
    descriptionKey: 'ai_provider_anthropic_desc',
    isDomestic: false,
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    protocol: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-1.5-flash',
    recommendedModels: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'],
    websiteUrl: 'https://aistudio.google.com',
    descriptionKey: 'ai_provider_gemini_desc',
    isDomestic: false,
  },
  groq: {
    id: 'groq',
    name: 'Groq (全球极速推理)',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    recommendedModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'],
    websiteUrl: 'https://console.groq.com',
    descriptionKey: 'ai_provider_groq_desc',
    isDomestic: false,
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (本地/离线私有化)',
    protocol: 'openai',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5-coder:7b',
    recommendedModels: ['qwen2.5-coder:7b', 'deepseek-r1:8b', 'llama3.2', 'deepseek-coder-v2'],
    websiteUrl: 'https://ollama.com',
    descriptionKey: 'ai_provider_ollama_desc',
    isDomestic: true,
  },
  custom: {
    id: 'custom',
    name: '自定义 (OpenAI Compatible)',
    protocol: 'openai',
    defaultBaseUrl: '',
    defaultModel: '',
    recommendedModels: [],
    websiteUrl: '',
    descriptionKey: 'ai_provider_custom_desc',
    isDomestic: false,
  },
}
