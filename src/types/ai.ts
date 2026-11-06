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
  | 'modelscope'
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
  websiteUrl: string
  descriptionKey: string
  isDomestic: boolean
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

export type AIExecutionMode = 'ask' | 'auto_readonly' | 'disabled' | 'danger'

/** 与 @qshell/policy 的 AdaptiveRetryPlan 保持一致：短超时后自动改用浅层命令重试 */
export interface AdaptiveRetryPlan {
  command: string
  timeoutMs: number
  reason?: string
}

export interface CommandGuardDecision {
  allowed: boolean
  isReadOnly: boolean
  riskLevel: CommandRiskLevel
  reason: string
  safeToAutoExecute: boolean
  isInteractive?: boolean
  blockedReason?: string
  suggestedSafeCommand?: string
  adaptiveRetry?: AdaptiveRetryPlan
  isDangerous?: boolean
  preview?: string
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
  executionMode?: AIExecutionMode
  customBlacklist?: string[]
  /** 是否允许 Agent 调用「包含状态变更操作」的 MCP 插件工具（默认 false，只读工具始终可用） */
  allowWriteMcpTools?: boolean
  /** 最大保留历史会话数（默认 30，超限自动滚动淘汰最旧会话） */
  maxAssistantSessions?: number
  /** 单个会话最多保留历史消息记录数（默认 50，超限滑动窗口滚动淘汰最旧记录） */
  maxMessagesPerSession?: number
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
  serverName?: string
  serverHost?: string
  currentDir?: string
  currentCommand?: string
  recentOutput?: string
  selectedText?: string
  serverInventory?: string
  probeReport?: string
  servers?: any[]
  serverGroups?: any[]
  activeServerId?: string | null
  isExplainShell?: boolean
  isDockerDiagnosis?: boolean
  dockerContext?: {
    serverId: string
    containerId: string
    containerName: string
    image: string
    status: string
    exitCode?: number | null
    oomKilled?: boolean
    memoryLimit?: number
    logsSnippet?: string
  }
}

export type AIAssistantMode = 'agent' | 'chat'

export type AIMascotMood = 'idle' | 'happy' | 'thinking' | 'blink' | 'error' | 'typing'

export interface AIAssistantExecutionCard {
  id: string
  command: string
  explanation?: string
  decision: CommandGuardDecision
  status: 'pending' | 'executing' | 'executed' | 'rejected' | 'blocked'
  output?: string
  summary?: string
  error?: string
  /** 危险模式执行前置预览与全量审计标记 */
  dangerPreview?: string
  dangerAudited?: boolean
  executedAt?: number
}

export interface ShellPipelineStep {
  stepIndex: number
  rawCommand: string
  program: string
  args: string[]
  actionDescription: string
  flagsExplanation?: Array<{ flag: string; meaning: string }>
  dataFlowDescription?: string
  riskLevel: CommandRiskLevel
  riskReason?: string
}

export interface ShellPipelineExplainResult {
  fullCommand: string
  summary: string
  isPipeline: boolean
  hasDestructiveRisk: boolean
  steps: ShellPipelineStep[]
  aiExplanation?: string
}

export interface AIAssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  createdAt: number
  mode?: AIAssistantMode
  status?: 'sending' | 'streaming' | 'done' | 'error'
  suggestedCommands?: Array<{
    command: string
    explanation?: string
    risk?: CommandRiskAnalysis
  }>
  executionCard?: AIAssistantExecutionCard
  pipelineExplain?: ShellPipelineExplainResult
}

export interface AIAssistantSession {
  id: string
  title: string
  messages: AIAssistantMessage[]
  createdAt: number
  updatedAt: number
  mode?: AIAssistantMode
}

export const AI_PROVIDER_PRESETS: Record<AIProvider, ProviderPreset> = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com',
    websiteUrl: 'https://platform.deepseek.com',
    descriptionKey: 'ai_provider_deepseek_desc',
    subtitleKey: 'ai_provider_deepseek_sub',
    isDomestic: true,
  },
  qwen: {
    id: 'qwen',
    name: 'Qwen',
    protocol: 'openai',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    websiteUrl: 'https://dashscope.console.aliyun.com',
    descriptionKey: 'ai_provider_qwen_desc',
    subtitleKey: 'ai_provider_qwen_sub',
    isDomestic: true,
  },
  modelscope: {
    id: 'modelscope',
    name: 'ModelScope 魔搭',
    protocol: 'openai',
    defaultBaseUrl: 'https://api-inference.modelscope.cn/v1',
    websiteUrl: 'https://www.modelscope.cn/my/myaccesstoken',
    descriptionKey: 'ai_provider_modelscope_desc',
    subtitleKey: 'ai_provider_modelscope_sub',
    isDomestic: true,
  },
  siliconflow: {
    id: 'siliconflow',
    name: 'SiliconFlow',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    websiteUrl: 'https://siliconflow.cn',
    descriptionKey: 'ai_provider_siliconflow_desc',
    subtitleKey: 'ai_provider_siliconflow_sub',
    isDomestic: true,
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    protocol: 'openai',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    websiteUrl: 'https://ollama.com',
    descriptionKey: 'ai_provider_ollama_desc',
    subtitleKey: 'ai_provider_ollama_sub',
    isDomestic: true,
  },
  moonshot: {
    id: 'moonshot',
    name: 'Kimi',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    websiteUrl: 'https://platform.moonshot.cn',
    descriptionKey: 'ai_provider_moonshot_desc',
    subtitleKey: 'ai_provider_moonshot_sub',
    isDomestic: true,
  },
  glm: {
    id: 'glm',
    name: 'GLM',
    protocol: 'openai',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    websiteUrl: 'https://bigmodel.cn',
    descriptionKey: 'ai_provider_glm_desc',
    subtitleKey: 'ai_provider_glm_sub',
    isDomestic: true,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    websiteUrl: 'https://platform.openai.com',
    descriptionKey: 'ai_provider_openai_desc',
    subtitleKey: 'ai_provider_openai_sub',
    isDomestic: false,
  },
  anthropic: {
    id: 'anthropic',
    name: 'Claude',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    websiteUrl: 'https://console.anthropic.com',
    descriptionKey: 'ai_provider_anthropic_desc',
    subtitleKey: 'ai_provider_anthropic_sub',
    isDomestic: false,
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini',
    protocol: 'gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    websiteUrl: 'https://aistudio.google.com',
    descriptionKey: 'ai_provider_gemini_desc',
    subtitleKey: 'ai_provider_gemini_sub',
    isDomestic: false,
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    websiteUrl: 'https://console.groq.com',
    descriptionKey: 'ai_provider_groq_desc',
    subtitleKey: 'ai_provider_groq_sub',
    isDomestic: false,
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    protocol: 'openai',
    defaultBaseUrl: '',
    websiteUrl: '',
    descriptionKey: 'ai_provider_custom_desc',
    subtitleKey: 'ai_provider_custom_sub',
    isDomestic: false,
  },
}
