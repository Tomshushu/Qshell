/**
 * src/store/ai-store.ts
 *
 * Qshell AIOps & Terminal Copilot 状态管理 Store
 * 支持本地持久化设置，连接测试，错误诊断与自然语言指令生成
 */

import { create } from 'zustand'
import type {
  AIProvider,
  AIProtocol,
  AISettings,
  ConfiguredProvider,
  AIDiagnosisResult,
  AIPromptContext,
  CommandRiskAnalysis,
  AIAssistantMode,
  AIAssistantMessage,
  AIAssistantSession,
  AIMascotMood,
  AIExecutionMode,
  AIAssistantExecutionCard,
  ShellPipelineExplainResult,
} from '@/types/ai'
import { AI_PROVIDER_PRESETS } from '@/types/ai'
import {
  testConnection,
  fetchProviderModels,
  diagnoseTerminalError,
  generateCommand,
  sendAssistantChat,
  extractCommandsFromContent,
  isLikelyShellCommand,
} from '@/services/ai/ai-client'
import { useAppStore } from '@/store'
import { backend } from '@/services/api'
import {
  resolveProbePlan,
  executeSafeProbe,
  formatProbeReportForAI,
  buildServerInventory,
  findActiveConnectionId,
} from '@/services/ai/server-probe-service'
import {
  evaluateCommandForExecution,
  wrapSafeInspectionCommand,
  generateExecutionSummary,
} from '@/services/ai/command-guard'
import {
  explainShellCommand,
  detectUserIntent,
} from '@/services/ai/shell-explainer'
import {
  buildDockerDiagnosisPrompt,
  generateOfflineDockerDiagnosis,
  type DockerDiagnosisParams,
} from '@/services/ai/docker-diagnoser'

const AI_SETTINGS_STORAGE_KEY = 'qshell_ai_settings_v1'
const AI_MODELS_CACHE_STORAGE_KEY = 'qshell_ai_models_cache_v1'
const AI_CONFIGURED_PROVIDERS_KEY = 'qshell_ai_configured_providers_v1'
const AI_SHOW_FLOATING_MASCOT_KEY = 'qshell_ai_show_floating_mascot_v1'
const AI_MASTER_ENABLED_KEY = 'qshell_ai_master_enabled_v1'
const AI_ASSISTANT_SESSIONS_KEY = 'qshell_ai_assistant_sessions_v1'

export const DEFAULT_MAX_ASSISTANT_SESSIONS = 30
export const DEFAULT_MAX_MESSAGES_PER_SESSION = 50
export const MAX_EXECUTION_CARD_OUTPUT_LENGTH = 8192 // 8KB: 单次命令采样输出上限，超长截断防撑爆本地存储

/**
 * 裁剪单个消息，防止过大的回显/输出撑爆本地存储空间 (如几万行的日志输出)
 */
export function sanitizeMessageForStorage(msg: AIAssistantMessage): AIAssistantMessage {
  if (!msg.executionCard || !msg.executionCard.output) return msg
  if (msg.executionCard.output.length > MAX_EXECUTION_CARD_OUTPUT_LENGTH) {
    return {
      ...msg,
      executionCard: {
        ...msg.executionCard,
        output:
          msg.executionCard.output.slice(0, MAX_EXECUTION_CARD_OUTPUT_LENGTH) +
          '\n\n... [输出超出 8KB，已自动截断以节省本地存储空间] ...',
      },
    }
  }
  return msg
}

/**
 * 滚动修剪会话与问答记录：
 * 1. 确保每个会话内部的消息数不超过 maxMessagesPerSession（FIFO 滚动淘汰最旧的消息，保留最近的问答）
 * 2. 裁剪超大命令输出，避免单条庞大回显直接把 localStorage 填满
 * 3. 确保总会话数不超过 maxSessions（按 updatedAt 降序排序，超出上限时淘汰最久未活跃的旧会话）
 */
export function pruneAssistantSessions(
  sessions: AIAssistantSession[],
  maxSessions: number = DEFAULT_MAX_ASSISTANT_SESSIONS,
  maxMessagesPerSession: number = DEFAULT_MAX_MESSAGES_PER_SESSION,
): AIAssistantSession[] {
  if (!Array.isArray(sessions)) return []

  const safeMaxSessions = Math.max(1, maxSessions)
  const safeMaxMessages = Math.max(1, maxMessagesPerSession)

  // 1. 修剪每个会话内部的消息数量与超大输出
  const prunedPerSession = sessions.map((s) => {
    let msgs = s.messages || []
    if (msgs.length > safeMaxMessages) {
      // 保留最新的 safeMaxMessages 条记录 (滑动窗口滚动淘汰最旧消息)
      msgs = msgs.slice(-safeMaxMessages)
    }
    msgs = msgs.map(sanitizeMessageForStorage)
    return {
      ...s,
      messages: msgs,
    }
  })

  // 2. 按最近更新时间 (updatedAt || createdAt) 从新到旧排序
  const sorted = [...prunedPerSession].sort(
    (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0),
  )

  // 3. 截取最大保留数量 (滚动淘汰超出上限的最旧会话)
  if (sorted.length > safeMaxSessions) {
    return sorted.slice(0, safeMaxSessions)
  }
  return sorted
}

/**
 * 计算当前 AI 问答历史记录占用的会话数、消息总数与近似存储体积
 */
export function getAssistantStorageStats(sessions: AIAssistantSession[]): {
  sessionCount: number
  messageCount: number
  approxBytes: number
  approxFormatted: string
} {
  const sessionCount = sessions.length
  let messageCount = 0
  for (const s of sessions) {
    messageCount += s.messages ? s.messages.length : 0
  }
  let approxBytes = 0
  try {
    const raw = localStorage.getItem(AI_ASSISTANT_SESSIONS_KEY)
    if (raw) {
      approxBytes = new Blob([raw]).size
    } else if (sessions.length > 0) {
      approxBytes = JSON.stringify(sessions).length
    }
  } catch {
    approxBytes = JSON.stringify(sessions).length
  }

  let approxFormatted = `${approxBytes} B`
  if (approxBytes > 1024 * 1024) {
    approxFormatted = `${(approxBytes / (1024 * 1024)).toFixed(2)} MB`
  } else if (approxBytes > 1024) {
    approxFormatted = `${(approxBytes / 1024).toFixed(1)} KB`
  }

  return { sessionCount, messageCount, approxBytes, approxFormatted }
}

export function loadSavedAssistantSessions(
  maxSessions: number = DEFAULT_MAX_ASSISTANT_SESSIONS,
  maxMessagesPerSession: number = DEFAULT_MAX_MESSAGES_PER_SESSION,
): AIAssistantSession[] {
  try {
    const raw = localStorage.getItem(AI_ASSISTANT_SESSIONS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return pruneAssistantSessions(parsed, maxSessions, maxMessagesPerSession)
      }
    }
  } catch {
    /* ignore */
  }
  return []
}

export function saveAssistantSessions(
  sessions: AIAssistantSession[],
  maxSessions: number = DEFAULT_MAX_ASSISTANT_SESSIONS,
  maxMessagesPerSession: number = DEFAULT_MAX_MESSAGES_PER_SESSION,
): void {
  try {
    const pruned = pruneAssistantSessions(sessions, maxSessions, maxMessagesPerSession)
    localStorage.setItem(AI_ASSISTANT_SESSIONS_KEY, JSON.stringify(pruned))
  } catch (err) {
    console.warn('[AIStore] LocalStorage quota warning when saving assistant sessions:', err)
    try {
      const emergencyPruned = pruneAssistantSessions(
        sessions,
        Math.max(5, Math.floor(maxSessions / 2)),
        Math.max(10, Math.floor(maxMessagesPerSession / 2)),
      )
      localStorage.setItem(AI_ASSISTANT_SESSIONS_KEY, JSON.stringify(emergencyPruned))
    } catch {
      /* ignore fatal quota exceeded */
    }
  }
}

export function autoSyncCurrentSession(
  sessions: AIAssistantSession[],
  currentId: string | null,
  messages: AIAssistantMessage[],
  mode: AIAssistantMode,
  maxSessions: number = DEFAULT_MAX_ASSISTANT_SESSIONS,
  maxMessagesPerSession: number = DEFAULT_MAX_MESSAGES_PER_SESSION,
): { updatedSessions: AIAssistantSession[]; activeId: string } {
  if (messages.length === 0) {
    return { updatedSessions: sessions, activeId: currentId || '' }
  }
  const firstUserMsg = messages.find((m) => m.role === 'user')
  const title = (firstUserMsg?.content.trim().slice(0, 36) || '新会话').replace(/\n+/g, ' ')
  const now = Date.now()

  let activeId = currentId
  let updatedSessions = [...sessions]

  let safeMessages = messages
  if (safeMessages.length > maxMessagesPerSession) {
    safeMessages = safeMessages.slice(-maxMessagesPerSession)
  }
  safeMessages = safeMessages.map(sanitizeMessageForStorage)

  if (activeId && updatedSessions.some((s) => s.id === activeId)) {
    updatedSessions = updatedSessions.map((s) => {
      if (s.id === activeId) {
        return {
          ...s,
          title: s.title || title,
          messages: safeMessages,
          updatedAt: now,
          mode,
        }
      }
      return s
    })
  } else {
    activeId = `session_${now}_${Math.random().toString(36).slice(2, 7)}`
    const newSession: AIAssistantSession = {
      id: activeId,
      title,
      messages: safeMessages,
      createdAt: now,
      updatedAt: now,
      mode,
    }
    updatedSessions = [newSession, ...updatedSessions]
  }

  const prunedSessions = pruneAssistantSessions(updatedSessions, maxSessions, maxMessagesPerSession)
  saveAssistantSessions(prunedSessions, maxSessions, maxMessagesPerSession)
  return { updatedSessions: prunedSessions, activeId }
}

function loadSavedEnableAiGlobal(): boolean {
  try {
    const raw = localStorage.getItem(AI_MASTER_ENABLED_KEY)
    if (raw !== null) {
      return raw === 'true'
    }
  } catch {
    /* ignore */
  }
  return true
}

function saveEnableAiGlobal(val: boolean): void {
  try {
    localStorage.setItem(AI_MASTER_ENABLED_KEY, String(val))
  } catch {
    /* ignore */
  }
}

/**
 * 判断当前是否有效配置并启用了可用的 AI 模型提供商
 */
export function hasActiveAIProvider(
  configuredProviders: ConfiguredProvider[],
  settings: AISettings,
): boolean {
  const activeProv = configuredProviders.find((p) => p.isEnabled)
  if (activeProv) {
    return Boolean(
      activeProv.apiKey?.trim() ||
      activeProv.provider === 'ollama' ||
      activeProv.baseUrl.includes('11434')
    )
  }
  return Boolean(
    settings.apiKey?.trim() ||
    settings.provider === 'ollama' ||
    settings.baseUrl.includes('11434')
  )
}

function loadSavedShowFloatingMascot(): boolean {
  try {
    const raw = localStorage.getItem(AI_SHOW_FLOATING_MASCOT_KEY)
    if (raw !== null) {
      return raw === 'true'
    }
  } catch {
    /* ignore */
  }
  return true
}

function saveShowFloatingMascot(val: boolean): void {
  try {
    localStorage.setItem(AI_SHOW_FLOATING_MASCOT_KEY, String(val))
  } catch {
    /* ignore */
  }
}

const DEFAULT_SETTINGS: AISettings = {
  provider: 'deepseek',
  protocol: 'openai',
  baseUrl: AI_PROVIDER_PRESETS.deepseek.defaultBaseUrl,
  apiKey: '',
  model: AI_PROVIDER_PRESETS.deepseek.defaultModel,
  temperature: 0.3,
  maxTokens: 8192,
  enableDlp: true,
  maskPrivateIps: false,
  executionMode: 'auto_readonly',
  customBlacklist: [],
  maxAssistantSessions: DEFAULT_MAX_ASSISTANT_SESSIONS,
  maxMessagesPerSession: DEFAULT_MAX_MESSAGES_PER_SESSION,
}

function loadSavedSettings(): AISettings {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_SETTINGS, ...parsed }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS
}

function saveSettings(settings: AISettings): void {
  try {
    localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* ignore */
  }
}

function loadSavedConfiguredProviders(fallbackSettings: AISettings): ConfiguredProvider[] {
  try {
    const raw = localStorage.getItem(AI_CONFIGURED_PROVIDERS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Enforce single active provider constraint
        let hasActive = false
        return parsed.map((p) => {
          if (p.isEnabled) {
            if (!hasActive) {
              hasActive = true
              return { ...p, isEnabled: true }
            }
            return { ...p, isEnabled: false }
          }
          return p
        })
      }
    }
  } catch {
    /* ignore */
  }

  // Auto-migration: if old settings has an API key or is Ollama, create initial configured provider
  if (fallbackSettings.apiKey?.trim() || fallbackSettings.provider === 'ollama') {
    const preset = AI_PROVIDER_PRESETS[fallbackSettings.provider]
    const initialProvider: ConfiguredProvider = {
      id: `prov_${fallbackSettings.provider}_${Date.now()}`,
      provider: fallbackSettings.provider,
      name: preset?.name || fallbackSettings.provider,
      protocol: fallbackSettings.protocol || preset?.protocol || 'openai',
      baseUrl: fallbackSettings.baseUrl || preset?.defaultBaseUrl || '',
      apiKey: fallbackSettings.apiKey || '',
      model: fallbackSettings.model || preset?.defaultModel || '',
      temperature: fallbackSettings.temperature ?? 0.3,
      maxTokens: fallbackSettings.maxTokens ?? 2048,
      isEnabled: true,
      createdAt: Date.now(),
    }
    saveConfiguredProviders([initialProvider])
    return [initialProvider]
  }

  return []
}

function saveConfiguredProviders(providers: ConfiguredProvider[]): void {
  try {
    localStorage.setItem(AI_CONFIGURED_PROVIDERS_KEY, JSON.stringify(providers))
  } catch {
    /* ignore */
  }
}

function loadSavedModelsCache(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(AI_MODELS_CACHE_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return {}
}

function saveModelsCache(cache: Record<string, string[]>): void {
  try {
    localStorage.setItem(AI_MODELS_CACHE_STORAGE_KEY, JSON.stringify(cache))
  } catch {
    /* ignore */
  }
}

export interface AIStoreState {
  settings: AISettings
  isTestingConnection: boolean
  testResult: { success: boolean; latencyMs?: number; error?: string } | null

  // 已配置的提供商列表
  configuredProviders: ConfiguredProvider[]
  testingProviderId: string | null

  // 动态模型拉取状态
  customModelsMap: Record<string, string[]>
  isFetchingModels: boolean
  fetchModelsError: string | null

  // 诊断弹窗状态
  isDiagnosisModalOpen: boolean
  diagnosisSnippet: string
  diagnosisContext: AIPromptContext
  isDiagnosing: boolean
  diagnosisResult: AIDiagnosisResult | null
  diagnosisError: string | null

  // 智能指令生成弹窗状态
  isCommandPaletteOpen: boolean
  commandPaletteContext: AIPromptContext
  isGeneratingCommand: boolean
  generatedCommandResult: {
    command: string
    explanation: string
    risk: CommandRiskAnalysis
  } | null
  commandGenerationError: string | null

  // Actions
  updateSettings: (partial: Partial<AISettings>) => void
  selectProvider: (provider: AIProvider) => void
  testConnection: () => Promise<void>
  fetchModels: () => Promise<string[]>

  // 提供商管理 Actions
  saveConfiguredProvider: (
    provider: Partial<ConfiguredProvider> & { provider: AIProvider },
    activate?: boolean,
  ) => string
  removeConfiguredProvider: (id: string) => void
  toggleActiveProvider: (id: string) => void
  testConfiguredProvider: (id: string) => Promise<{ success: boolean; latencyMs?: number; error?: string }>
  testProviderConfig: (config: {
    provider: AIProvider
    protocol: AIProtocol
    baseUrl: string
    apiKey: string
    model?: string
  }) => Promise<{ success: boolean; latencyMs?: number; error?: string }>
  fetchModelsForConfig: (config: {
    provider: AIProvider
    protocol: AIProtocol
    baseUrl: string
    apiKey: string
  }) => Promise<string[]>

  openDiagnosis: (snippet: string, context?: AIPromptContext) => void
  openExplainShell: (command: string, context?: AIPromptContext) => void
  openDockerDiagnosis: (params: DockerDiagnosisParams) => void
  closeDiagnosis: () => void
  runDiagnosis: () => Promise<void>
  openCommandPalette: (context?: AIPromptContext) => void
  closeCommandPalette: () => void
  runGenerateCommand: (userIntent: string) => Promise<void>

  // 全局 AI 总开关与悬浮助手状态
  enableAiGlobal: boolean
  setEnableAiGlobal: (enabled: boolean) => void

  showFloatingMascot: boolean
  isFloatingAssistantOpen: boolean
  assistantMode: AIAssistantMode
  assistantMessages: AIAssistantMessage[]
  assistantSessions: AIAssistantSession[]
  currentAssistantSessionId: string | null
  isAssistantResponding: boolean
  assistantInput: string
  assistantMascotMood: AIMascotMood

  setShowFloatingMascot: (show: boolean) => void
  openFloatingAssistant: () => void
  closeFloatingAssistant: () => void
  toggleFloatingAssistant: () => void
  setAssistantMode: (mode: AIAssistantMode) => void
  setAssistantInput: (text: string) => void
  setAssistantMascotMood: (mood: AIMascotMood) => void
  sendAssistantMessage: (text?: string, context?: AIPromptContext) => Promise<void>
  stopAssistantResponding: () => void
  clearAssistantMessages: () => void
  createNewAssistantSession: () => void
  loadAssistantSession: (sessionId: string) => void
  deleteAssistantSession: (sessionId: string) => void
  clearAllAssistantSessions: () => void
  executeMessageCommand: (messageId: string) => Promise<void>
  rejectMessageCommand: (messageId: string) => void
}

let activeAssistantAbortController: AbortController | null = null

const initialSettings = loadSavedSettings()
const initialConfigured = loadSavedConfiguredProviders(initialSettings)
const activeProv = initialConfigured.find((p) => p.isEnabled)
if (activeProv) {
  initialSettings.provider = activeProv.provider
  initialSettings.protocol = activeProv.protocol
  initialSettings.baseUrl = activeProv.baseUrl
  initialSettings.apiKey = activeProv.apiKey
  initialSettings.model = activeProv.model
  if (activeProv.temperature !== undefined) initialSettings.temperature = activeProv.temperature
  if (activeProv.maxTokens !== undefined) initialSettings.maxTokens = activeProv.maxTokens
} else if (initialConfigured.length > 0) {
  initialSettings.apiKey = ''
}

async function buildExecutionCard(
  commands: Array<{ command: string; explanation?: string }> | undefined,
  content: string,
  executionMode: AIExecutionMode,
  customBlacklist: string[],
  activeServerId: string | null,
): Promise<AIAssistantExecutionCard | undefined> {
  if (executionMode === 'disabled') return undefined

  const rawCmds = (commands && commands.length > 0 ? commands : extractCommandsFromContent(content))
    .filter((c) => c && c.command && isLikelyShellCommand(c.command))
  if (!rawCmds || rawCmds.length === 0) return undefined

  // 在 auto_readonly 模式下，若存在多个候选命令，优先挑选可自动执行的只读安全命令
  let primaryCmd = rawCmds[0]
  if (executionMode === 'auto_readonly' && rawCmds.length > 1) {
    const safeCmd = rawCmds.find((c) => {
      const d = evaluateCommandForExecution(c.command, { customBlacklist, executionMode })
      return d.safeToAutoExecute
    })
    if (safeCmd) {
      primaryCmd = safeCmd
    }
  }

  const decision = evaluateCommandForExecution(primaryCmd.command, {
    customBlacklist,
    executionMode,
  })

  if (executionMode === 'auto_readonly' && decision.safeToAutoExecute) {
    const safeCmd = wrapSafeInspectionCommand(decision.suggestedSafeCommand || primaryCmd.command)
    let autoOutput = ''
    const appState = useAppStore.getState()
    const tabs = (appState.tabs || []).map((t) => ({ id: t.id, serverId: t.serverId }))
    const connectedServers = appState.connectedServers || {}
    let activeConnId = activeServerId ? findActiveConnectionId(activeServerId, tabs, connectedServers) : null

    if (!activeConnId) {
      for (const s of appState.servers || []) {
        const cId = findActiveConnectionId(s.id, tabs, connectedServers)
        if (cId) {
          activeConnId = cId
          break
        }
      }
    }

    if (backend?.ssh?.execute && activeConnId) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('执行超时 (10s)')), 10000),
        )
        const autoExecRes = await Promise.race([
          backend.ssh.execute(activeConnId, safeCmd),
          timeoutPromise,
        ])
        autoOutput = (autoExecRes.stdout || autoExecRes.stderr || '').trim()
      } catch (e) {
        autoOutput = (e as Error)?.message || '自动只读探测执行异常'
      }
    } else {
      autoOutput = '（已通过严格只读白名单校验，就绪待执行）'
    }

    const autoSummary = generateExecutionSummary(safeCmd, autoOutput)
    return {
      id: `exec_${Date.now()}`,
      command: safeCmd,
      explanation: primaryCmd.explanation,
      decision,
      status: 'executed',
      output: autoOutput || '⚡ 安全只读指令已完成内核执行采样',
      summary: autoSummary,
      executedAt: Date.now(),
    }
  }

  if (decision.riskLevel === 'blocked' || !decision.allowed) {
    return {
      id: `exec_${Date.now()}`,
      command: primaryCmd.command,
      explanation: primaryCmd.explanation,
      decision,
      status: 'blocked',
      error: decision.blockedReason || decision.reason,
    }
  }

  return {
    id: `exec_${Date.now()}`,
    command: decision.suggestedSafeCommand || primaryCmd.command,
    explanation: primaryCmd.explanation,
    decision,
    status: 'pending',
  }
}

export const useAIStore = create<AIStoreState>((set, get) => ({
  settings: initialSettings,
  isTestingConnection: false,
  testResult: null,

  configuredProviders: initialConfigured,
  testingProviderId: null,

  customModelsMap: loadSavedModelsCache(),
  isFetchingModels: false,
  fetchModelsError: null,

  isDiagnosisModalOpen: false,
  diagnosisSnippet: '',
  diagnosisContext: {},
  isDiagnosing: false,
  diagnosisResult: null,
  diagnosisError: null,

  isCommandPaletteOpen: false,
  commandPaletteContext: {},
  isGeneratingCommand: false,
  generatedCommandResult: null,
  commandGenerationError: null,

  enableAiGlobal: loadSavedEnableAiGlobal(),
  setEnableAiGlobal: (enabled: boolean) => {
    set({ enableAiGlobal: enabled })
    saveEnableAiGlobal(enabled)
  },

  showFloatingMascot: loadSavedShowFloatingMascot(),
  isFloatingAssistantOpen: false,
  assistantMode: 'agent',
  assistantMessages: [],
  assistantSessions: loadSavedAssistantSessions(
    initialSettings.maxAssistantSessions,
    initialSettings.maxMessagesPerSession,
  ),
  currentAssistantSessionId: null,
  isAssistantResponding: false,
  assistantInput: '',
  assistantMascotMood: 'idle',

  updateSettings: (partial) => {
    const current = get().settings
    const updated = { ...current, ...partial }
    let nextSessions = get().assistantSessions
    if (
      (partial.maxAssistantSessions !== undefined && partial.maxAssistantSessions !== current.maxAssistantSessions) ||
      (partial.maxMessagesPerSession !== undefined && partial.maxMessagesPerSession !== current.maxMessagesPerSession)
    ) {
      nextSessions = pruneAssistantSessions(
        nextSessions,
        updated.maxAssistantSessions || DEFAULT_MAX_ASSISTANT_SESSIONS,
        updated.maxMessagesPerSession || DEFAULT_MAX_MESSAGES_PER_SESSION,
      )
      saveAssistantSessions(
        nextSessions,
        updated.maxAssistantSessions || DEFAULT_MAX_ASSISTANT_SESSIONS,
        updated.maxMessagesPerSession || DEFAULT_MAX_MESSAGES_PER_SESSION,
      )
    }
    set({ settings: updated, assistantSessions: nextSessions, testResult: null })
    saveSettings(updated)
  },

  selectProvider: (provider) => {
    const preset = AI_PROVIDER_PRESETS[provider]
    if (!preset) return

    const current = get().settings
    const cachedModels = get().customModelsMap[provider]
    let initialModel = preset.defaultModel
    if (cachedModels && cachedModels.length > 0) {
      initialModel = cachedModels.includes(preset.defaultModel)
        ? preset.defaultModel
        : cachedModels[0]
    }

    const updated: AISettings = {
      ...current,
      provider,
      protocol: preset.protocol,
      baseUrl: preset.defaultBaseUrl,
      model: initialModel,
    }
    set({ settings: updated, testResult: null, fetchModelsError: null })
    saveSettings(updated)
  },

  testConnection: async () => {
    const { settings } = get()
    set({ isTestingConnection: true, testResult: null })
    const res = await testConnection(settings)
    set({ isTestingConnection: false, testResult: res })
  },

  fetchModels: async () => {
    const { settings, customModelsMap } = get()
    set({ isFetchingModels: true, fetchModelsError: null })
    try {
      const models = await fetchProviderModels(settings)
      if (models.length > 0) {
        const nextMap = { ...customModelsMap, [settings.provider]: models }
        set({
          customModelsMap: nextMap,
          isFetchingModels: false,
          fetchModelsError: null,
        })
        saveModelsCache(nextMap)
        if (!settings.model || !models.includes(settings.model)) {
          get().updateSettings({ model: models[0] })
        }
      } else {
        set({ isFetchingModels: false })
      }
      return models
    } catch (err: unknown) {
      const msg = (err as Error)?.message || '拉取模型列表失败'
      set({ isFetchingModels: false, fetchModelsError: msg })
      throw err
    }
  },

  saveConfiguredProvider: (providerData, activate = true) => {
    const providers = get().configuredProviders
    const targetId = providerData.id || `prov_${providerData.provider}_${Date.now()}`
    const existingIdx = providers.findIndex((p) => p.id === targetId)

    const preset = AI_PROVIDER_PRESETS[providerData.provider]
    const newEntry: ConfiguredProvider = {
      id: targetId,
      provider: providerData.provider,
      name:
        providerData.name?.trim() ||
        preset?.name ||
        providerData.provider,
      protocol: providerData.protocol || preset?.protocol || 'openai',
      baseUrl: providerData.baseUrl ?? (preset?.defaultBaseUrl || ''),
      apiKey: providerData.apiKey ?? '',
      model: providerData.model || (preset?.defaultModel || ''),
      temperature: providerData.temperature ?? 0.3,
      maxTokens: providerData.maxTokens ?? 2048,
      isEnabled: activate || (existingIdx >= 0 ? providers[existingIdx].isEnabled : providers.length === 0),
      lastTestedAt: providerData.lastTestedAt,
      lastLatencyMs: providerData.lastLatencyMs,
      lastTestStatus: providerData.lastTestStatus,
      lastTestError: providerData.lastTestError,
      createdAt: providerData.createdAt || Date.now(),
    }

    let updated: ConfiguredProvider[]
    if (newEntry.isEnabled) {
      // Ensure all others are disabled
      updated = [
        newEntry,
        ...providers.filter((p) => p.id !== targetId).map((p) => ({ ...p, isEnabled: false })),
      ]
    } else {
      if (existingIdx >= 0) {
        updated = providers.map((p) => (p.id === targetId ? newEntry : p))
      } else {
        updated = [...providers, newEntry]
      }
    }

    const currentSettings = get().settings
    let nextSettings = { ...currentSettings }
    if (newEntry.isEnabled) {
      nextSettings = {
        ...nextSettings,
        provider: newEntry.provider,
        protocol: newEntry.protocol,
        baseUrl: newEntry.baseUrl,
        apiKey: newEntry.apiKey,
        model: newEntry.model,
        temperature: newEntry.temperature ?? currentSettings.temperature,
        maxTokens: newEntry.maxTokens ?? currentSettings.maxTokens,
      }
    }

    set({ configuredProviders: updated, settings: nextSettings, testResult: null })
    saveConfiguredProviders(updated)
    saveSettings(nextSettings)
    return targetId
  },

  removeConfiguredProvider: (id: string) => {
    const providers = get().configuredProviders
    const target = providers.find((p) => p.id === id)
    const updated = providers.filter((p) => p.id !== id)

    const currentSettings = get().settings
    let nextSettings = { ...currentSettings }

    if (target?.isEnabled) {
      if (updated.length > 0) {
        updated[0] = { ...updated[0], isEnabled: true }
        nextSettings = {
          ...nextSettings,
          provider: updated[0].provider,
          protocol: updated[0].protocol,
          baseUrl: updated[0].baseUrl,
          apiKey: updated[0].apiKey,
          model: updated[0].model,
          temperature: updated[0].temperature ?? currentSettings.temperature,
          maxTokens: updated[0].maxTokens ?? currentSettings.maxTokens,
        }
      } else {
        nextSettings = {
          ...nextSettings,
          apiKey: '',
        }
      }
    }

    set({ configuredProviders: updated, settings: nextSettings })
    saveConfiguredProviders(updated)
    saveSettings(nextSettings)
  },

  toggleActiveProvider: (id: string) => {
    const providers = get().configuredProviders
    const target = providers.find((p) => p.id === id)
    if (!target) return

    const willEnable = !target.isEnabled
    const updated = providers.map((p) => {
      if (p.id === id) {
        return { ...p, isEnabled: willEnable }
      }
      return { ...p, isEnabled: false }
    })

    const currentSettings = get().settings
    let nextSettings = { ...currentSettings }
    if (willEnable) {
      nextSettings = {
        ...nextSettings,
        provider: target.provider,
        protocol: target.protocol,
        baseUrl: target.baseUrl,
        apiKey: target.apiKey,
        model: target.model,
        temperature: target.temperature ?? currentSettings.temperature,
        maxTokens: target.maxTokens ?? currentSettings.maxTokens,
      }
    } else {
      nextSettings = {
        ...nextSettings,
        apiKey: '',
      }
    }

    set({ configuredProviders: updated, settings: nextSettings })
    saveConfiguredProviders(updated)
    saveSettings(nextSettings)
  },

  testConfiguredProvider: async (id: string) => {
    const providers = get().configuredProviders
    const target = providers.find((p) => p.id === id)
    if (!target) return { success: false, error: '未找到提供商' }

    set({ testingProviderId: id })
    const res = await testConnection({
      provider: target.provider,
      protocol: target.protocol,
      baseUrl: target.baseUrl,
      apiKey: target.apiKey,
      model: target.model,
      temperature: target.temperature ?? 0.3,
      maxTokens: target.maxTokens ?? 2048,
      enableDlp: false,
      maskPrivateIps: false,
    })

    const updated = get().configuredProviders.map((p) => {
      if (p.id === id) {
        return {
          ...p,
          lastTestedAt: Date.now(),
          lastLatencyMs: res.latencyMs,
          lastTestStatus: (res.success ? 'success' : 'failed') as 'success' | 'failed',
          lastTestError: res.error || null,
        }
      }
      return p
    })

    set({ configuredProviders: updated, testingProviderId: null })
    saveConfiguredProviders(updated)
    return res
  },

  testProviderConfig: async (config) => {
    return await testConnection({
      provider: config.provider,
      protocol: config.protocol,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model || '',
      temperature: 0.3,
      maxTokens: 2048,
      enableDlp: false,
      maskPrivateIps: false,
    })
  },

  fetchModelsForConfig: async (config) => {
    const models = await fetchProviderModels({
      provider: config.provider,
      protocol: config.protocol,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: '',
      temperature: 0.3,
      maxTokens: 2048,
      enableDlp: false,
      maskPrivateIps: false,
    })
    if (models.length > 0) {
      const nextMap = { ...get().customModelsMap, [config.provider]: models }
      set({ customModelsMap: nextMap })
      saveModelsCache(nextMap)
    }
    return models
  },

  openDiagnosis: (snippet, context = {}) => {
    if (!get().enableAiGlobal) return
    const text = snippet?.trim()
    if (!text) {
      set({ isFloatingAssistantOpen: true, assistantMode: 'agent' })
      return
    }

    set({
      isFloatingAssistantOpen: true,
      assistantMode: 'agent',
    })

    const prompt = `请帮我诊断分析以下终端报错日志，定位根因并给出排查解决建议：\n\`\`\`\n${text}\n\`\`\``
    void get().sendAssistantMessage(prompt, { ...context, selectedText: text })
  },

  openExplainShell: (command, context = {}) => {
    if (!get().enableAiGlobal) return
    const text = command?.trim()
    if (!text) {
      set({ isFloatingAssistantOpen: true, assistantMode: 'agent' })
      return
    }

    set({
      isFloatingAssistantOpen: true,
      assistantMode: 'agent',
    })

    const prompt = `请帮我拆解并解析以下 Shell 复合指令的执行流程与管道逻辑：\n\`\`\`bash\n${text}\n\`\`\``
    void get().sendAssistantMessage(prompt, {
      ...context,
      selectedText: text,
      isExplainShell: true,
    })
  },

  openDockerDiagnosis: (params) => {
    if (!get().enableAiGlobal) return
    set({
      isFloatingAssistantOpen: true,
      assistantMode: 'agent',
    })

    const prompt = buildDockerDiagnosisPrompt(params)
    void get().sendAssistantMessage(prompt, {
      activeServerId: params.serverId,
      isDockerDiagnosis: true,
      dockerContext: params,
    })
  },

  closeDiagnosis: () => {
    set({ isDiagnosisModalOpen: false, isDiagnosing: false })
  },

  runDiagnosis: async () => {
    const { settings, diagnosisSnippet, diagnosisContext } = get()
    if (!diagnosisSnippet || !diagnosisSnippet.trim()) return

    if (settings.provider !== 'ollama' && (!settings.apiKey || !settings.apiKey.trim())) {
      set({
        isDiagnosing: false,
        diagnosisError: '尚未配置 API 访问密钥，请前往 [设置 ➔ AI 运维] 填入对应模型的 API Key。',
      })
      return
    }

    set({ isDiagnosing: true, diagnosisError: null })
    try {
      const res = await diagnoseTerminalError(settings, diagnosisSnippet, diagnosisContext)
      set({ isDiagnosing: false, diagnosisResult: res })
    } catch (err: unknown) {
      set({
        isDiagnosing: false,
        diagnosisError: (err as Error)?.message || '诊断过程中发生错误',
      })
    }
  },

  openCommandPalette: (_context = {}) => {
    if (!get().enableAiGlobal) return
    set({
      isFloatingAssistantOpen: true,
      assistantMode: 'agent',
    })
  },

  closeCommandPalette: () => {
    set({ isCommandPaletteOpen: false, isGeneratingCommand: false })
  },

  runGenerateCommand: async (userIntent) => {
    const { settings, commandPaletteContext } = get()
    if (!userIntent || !userIntent.trim()) return

    if (settings.provider !== 'ollama' && (!settings.apiKey || !settings.apiKey.trim())) {
      set({
        isGeneratingCommand: false,
        commandGenerationError: '尚未配置 API 访问密钥，请前往 [设置 ➔ AI 运维] 填入对应模型的 API Key。',
      })
      return
    }

    set({ isGeneratingCommand: true, commandGenerationError: null })
    try {
      const res = await generateCommand(settings, userIntent, commandPaletteContext)
      set({ isGeneratingCommand: false, generatedCommandResult: res })
    } catch (err: unknown) {
      set({
        isGeneratingCommand: false,
        commandGenerationError: (err as Error)?.message || '生成命令失败',
      })
    }
  },

  setShowFloatingMascot: (show: boolean) => {
    set({ showFloatingMascot: show })
    saveShowFloatingMascot(show)
  },

  openFloatingAssistant: () => {
    if (!get().enableAiGlobal) return
    set({ isFloatingAssistantOpen: true })
  },
  closeFloatingAssistant: () => set({ isFloatingAssistantOpen: false }),
  toggleFloatingAssistant: () => {
    if (!get().enableAiGlobal) return
    set((state) => ({ isFloatingAssistantOpen: !state.isFloatingAssistantOpen }))
  },
  setAssistantMode: (mode) => set({ assistantMode: mode }),
  setAssistantInput: (text) => set({ assistantInput: text }),
  setAssistantMascotMood: (mood) => set({ assistantMascotMood: mood }),
  clearAssistantMessages: () => set({ assistantMessages: [], currentAssistantSessionId: null }),

  stopAssistantResponding: () => {
    if (activeAssistantAbortController) {
      activeAssistantAbortController.abort()
      activeAssistantAbortController = null
    }
    const { assistantMessages, assistantSessions, currentAssistantSessionId, assistantMode, settings } = get()
    const lastMsg = assistantMessages[assistantMessages.length - 1]
    if (lastMsg && lastMsg.role === 'assistant' && lastMsg.status === 'streaming') {
      const finalMsg: AIAssistantMessage = {
        ...lastMsg,
        status: 'done',
        suggestedCommands: extractCommandsFromContent(lastMsg.content),
      }
      const finalMsgs = assistantMessages.map((m) => (m.id === finalMsg.id ? finalMsg : m))
      const { updatedSessions, activeId } = autoSyncCurrentSession(
        assistantSessions,
        currentAssistantSessionId,
        finalMsgs,
        assistantMode,
        settings.maxAssistantSessions,
        settings.maxMessagesPerSession,
      )
      set({
        assistantMessages: finalMsgs,
        assistantSessions: updatedSessions,
        currentAssistantSessionId: activeId,
        isAssistantResponding: false,
        assistantMascotMood: 'idle',
      })
      return
    }

    set({
      isAssistantResponding: false,
      assistantMascotMood: 'idle',
    })
  },

  createNewAssistantSession: () => {
    if (activeAssistantAbortController) {
      activeAssistantAbortController.abort()
      activeAssistantAbortController = null
    }
    const { assistantMessages, currentAssistantSessionId, assistantSessions, assistantMode, settings } = get()
    let updatedSessions = assistantSessions
    if (assistantMessages.length > 0) {
      const res = autoSyncCurrentSession(
        assistantSessions,
        currentAssistantSessionId,
        assistantMessages,
        assistantMode,
        settings.maxAssistantSessions,
        settings.maxMessagesPerSession,
      )
      updatedSessions = res.updatedSessions
    }
    set({
      assistantSessions: updatedSessions,
      currentAssistantSessionId: null,
      assistantMessages: [],
      assistantInput: '',
      assistantMascotMood: 'idle',
      isAssistantResponding: false,
    })
  },

  loadAssistantSession: (sessionId: string) => {
    if (activeAssistantAbortController) {
      activeAssistantAbortController.abort()
      activeAssistantAbortController = null
    }
    const { assistantMessages, currentAssistantSessionId, assistantSessions, assistantMode, settings } = get()
    let currentSessions = assistantSessions
    if (assistantMessages.length > 0) {
      const res = autoSyncCurrentSession(
        assistantSessions,
        currentAssistantSessionId,
        assistantMessages,
        assistantMode,
        settings.maxAssistantSessions,
        settings.maxMessagesPerSession,
      )
      currentSessions = res.updatedSessions
    }
    const target = currentSessions.find((s) => s.id === sessionId)
    if (target) {
      set({
        assistantSessions: currentSessions,
        currentAssistantSessionId: target.id,
        assistantMessages: target.messages,
        assistantMode: target.mode || 'agent',
        assistantInput: '',
        assistantMascotMood: 'idle',
        isAssistantResponding: false,
      })
    }
  },

  deleteAssistantSession: (sessionId: string) => {
    const { assistantSessions, currentAssistantSessionId, settings } = get()
    const updated = assistantSessions.filter((s) => s.id !== sessionId)
    saveAssistantSessions(updated, settings.maxAssistantSessions, settings.maxMessagesPerSession)
    if (currentAssistantSessionId === sessionId || updated.length === 0) {
      if (activeAssistantAbortController) {
        activeAssistantAbortController.abort()
        activeAssistantAbortController = null
      }
      set({
        assistantSessions: updated,
        currentAssistantSessionId: null,
        assistantMessages: [],
        isAssistantResponding: false,
        assistantMascotMood: 'idle',
      })
    } else {
      set({ assistantSessions: updated })
    }
  },

  clearAllAssistantSessions: () => {
    if (activeAssistantAbortController) {
      activeAssistantAbortController.abort()
      activeAssistantAbortController = null
    }
    saveAssistantSessions([])
    set({
      assistantSessions: [],
      currentAssistantSessionId: null,
      assistantMessages: [],
      isAssistantResponding: false,
      assistantMascotMood: 'idle',
    })
  },

  sendAssistantMessage: async (text?: string, context?: AIPromptContext) => {
    const { assistantInput, assistantMessages, assistantMode, settings, configuredProviders } = get()
    const content = (text !== undefined ? text : assistantInput).trim()
    if (!content) return

    if (activeAssistantAbortController) {
      activeAssistantAbortController.abort()
      activeAssistantAbortController = null
    }
    const abortController = new AbortController()
    activeAssistantAbortController = abortController

    const userMsg: AIAssistantMessage = {
      id: `msg_u_${Date.now()}`,
      role: 'user',
      content,
      createdAt: Date.now(),
      mode: assistantMode,
      status: 'done',
    }

    const nextMessages = [...assistantMessages, userMsg]
    set({
      assistantMessages: nextMessages,
      assistantInput: '',
      isAssistantResponding: true,
      assistantMascotMood: 'thinking',
    })

    const finalizeMessages = (finalMsgs: AIAssistantMessage[], mood: AIMascotMood = 'happy') => {
      const { assistantSessions, currentAssistantSessionId, assistantMode: curMode, settings: curSettings } = get()
      const { updatedSessions, activeId } = autoSyncCurrentSession(
        assistantSessions,
        currentAssistantSessionId,
        finalMsgs,
        curMode,
        curSettings.maxAssistantSessions,
        curSettings.maxMessagesPerSession,
      )
      let safeFinalMsgs = finalMsgs
      const maxMsgs = curSettings.maxMessagesPerSession || DEFAULT_MAX_MESSAGES_PER_SESSION
      if (safeFinalMsgs.length > maxMsgs) {
        safeFinalMsgs = safeFinalMsgs.slice(-maxMsgs)
      }
      set({
        assistantMessages: safeFinalMsgs,
        assistantSessions: updatedSessions,
        currentAssistantSessionId: activeId,
        isAssistantResponding: false,
        assistantMascotMood: mood,
      })
      setTimeout(() => {
        if (get().assistantMascotMood === 'happy') {
          set({ assistantMascotMood: 'idle' })
        }
      }, 4000)
    }

    // 0. 智能意图嗅探与指令拆解准备 (Shell Explainer)
    const intentRes = detectUserIntent(content)
    const isExplainShellIntent = Boolean(context?.isExplainShell || intentRes.intent === 'explain_shell')
    const commandCandidate = context?.selectedText || intentRes.commandCandidate || content
    let pipelineExplainResult: ShellPipelineExplainResult | undefined
    if (isExplainShellIntent && commandCandidate) {
      try {
        pipelineExplainResult = explainShellCommand(commandCandidate)
      } catch {
        // ignore
      }
    }

    const assistantMsgId = `msg_a_${Date.now()}`

    const onChunk = (_chunk: string, accumulated: string) => {
      set((state) => {
        const exists = state.assistantMessages.some((m) => m.id === assistantMsgId)
        const curMsgs = exists
          ? state.assistantMessages.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: accumulated,
                    status: 'streaming' as const,
                    pipelineExplain: pipelineExplainResult,
                  }
                : m,
            )
          : [
              ...state.assistantMessages,
              {
                id: assistantMsgId,
                role: 'assistant' as const,
                content: accumulated,
                createdAt: Date.now(),
                mode: assistantMode,
                status: 'streaming' as const,
                pipelineExplain: pipelineExplainResult,
              },
            ]
        return {
          assistantMessages: curMsgs,
        }
      })
    }

    // 1. 获取已存服务器资产与当前活跃会话
    const appState = useAppStore.getState()
    const servers = appState.servers || []
    const serverGroups = appState.serverGroups || []
    const activeTab = appState.tabs?.find((t) => t.id === appState.activeTabId)
    const activeServerId = activeTab?.serverId || null
    const activeServer = activeServerId ? servers.find((s) => s.id === activeServerId) : null

    // 2. 构造紧凑资产拓扑，注入 System Prompt
    const serverInventory = buildServerInventory(servers, serverGroups)
    const enrichedContext: AIPromptContext = {
      ...context,
      isExplainShell: isExplainShellIntent,
      isDockerDiagnosis: context?.isDockerDiagnosis,
      dockerContext: context?.dockerContext,
      serverInventory,
      servers,
      serverGroups,
      activeServerId,
      osType: context?.osType || activeServer?.osType || activeServer?.targetType || undefined,
      osDistro: context?.osDistro || activeServer?.osInfo || undefined,
      serverName: context?.serverName || activeServer?.name || undefined,
      serverHost: context?.serverHost || activeServer?.host || undefined,
    }

    const activeProv = configuredProviders.find((p) => p.isEnabled)
    const effectiveSettings: AISettings = activeProv
      ? {
          provider: activeProv.provider,
          protocol: activeProv.protocol,
          baseUrl: activeProv.baseUrl,
          apiKey: activeProv.apiKey,
          model: activeProv.model,
          temperature: activeProv.temperature ?? settings.temperature ?? 0.3,
          maxTokens: activeProv.maxTokens ?? settings.maxTokens ?? 8192,
          enableDlp: settings.enableDlp,
          maskPrivateIps: settings.maskPrivateIps,
          executionMode: settings.executionMode ?? 'auto_readonly',
          customBlacklist: settings.customBlacklist ?? [],
        }
      : settings

    const hasApiKeyOrOllama =
      Boolean(effectiveSettings.apiKey?.trim()) ||
      effectiveSettings.provider === 'ollama' ||
      effectiveSettings.baseUrl.includes('11434')

    if (hasApiKeyOrOllama) {
      try {
        const historyForApi = nextMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }))
        const res = await sendAssistantChat(
          effectiveSettings,
          historyForApi,
          assistantMode,
          enrichedContext,
          abortController.signal,
          onChunk,
        )
        if (abortController.signal.aborted) return
        activeAssistantAbortController = null

        const currentExecMode = effectiveSettings.executionMode || settings.executionMode || 'auto_readonly'
        const currentBlacklist = effectiveSettings.customBlacklist || settings.customBlacklist || []

        let executionCard: AIAssistantExecutionCard | undefined

        // 若 Agent 在 ReAct 循环阶段已执行只读工具探针/排障指令，直接将真实执行记录装配为执行卡片
        const toolsList =
          res.executedTools && res.executedTools.length > 0
            ? res.executedTools
            : res.executedTool
              ? [res.executedTool]
              : []

        if (toolsList.length > 0) {
          const combinedCommand = toolsList.map((t) => t.command).join(' && ')
          const combinedOutput =
            toolsList.length === 1
              ? toolsList[0].output
              : toolsList
                  .map(
                    (t, idx) =>
                      `=== [第 ${idx + 1} 步排查采样] ${t.command} ===\n${t.output}`,
                  )
                  .join('\n\n')

          const primaryTool = toolsList[toolsList.length - 1]
          const decision = evaluateCommandForExecution(combinedCommand, {
            customBlacklist: currentBlacklist,
            executionMode: currentExecMode,
          })
          const autoSummary = generateExecutionSummary(combinedCommand, combinedOutput)
          executionCard = {
            id: `exec_${Date.now()}`,
            command: combinedCommand,
            explanation:
              primaryTool.explanation ||
              `Agent 自主执行了 ${toolsList.length} 轮只读排查指令`,
            decision,
            status: 'executed',
            output: combinedOutput || '⚡ 安全只读指令已完成内核执行采样',
            summary: autoSummary,
            executedAt: Date.now(),
          }
        } else {
          executionCard = await buildExecutionCard(
            res.commands,
            res.content,
            currentExecMode,
            currentBlacklist,
            activeServerId,
          )
        }

        const assistantMsg: AIAssistantMessage = {
          id: assistantMsgId,
          role: 'assistant',
          content: res.content,
          createdAt: Date.now(),
          mode: assistantMode,
          status: 'done',
          suggestedCommands: res.commands,
          executionCard,
          pipelineExplain: pipelineExplainResult
            ? { ...pipelineExplainResult, aiExplanation: res.content }
            : undefined,
        }
        finalizeMessages(
          [
            ...nextMessages.filter((m) => m.id !== assistantMsgId),
            assistantMsg,
          ],
          'happy',
        )
      } catch (err: unknown) {
        if (abortController.signal.aborted || (err as Error)?.name === 'AbortError') {
          activeAssistantAbortController = null
          set({
            isAssistantResponding: false,
            assistantMascotMood: 'idle',
          })
          return
        }
        activeAssistantAbortController = null
        const errorMsg: AIAssistantMessage = {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `⚠️ **AI 响应异常**：${(err as Error)?.message || '未能连接到模型接口'}\n\n请检查「设置 -> AI 运维」中当前提供商的 API Key、Base URL 及网络连通性。`,
          createdAt: Date.now(),
          mode: assistantMode,
          status: 'error',
        }
        finalizeMessages([...nextMessages, errorMsg], 'idle')
      }
    } else {
      // 模拟离线智能应答（具备极佳的运维演示体验与流式输出体验）
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => resolve(), 250)
          abortController.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      } catch {
        if (abortController.signal.aborted) {
          activeAssistantAbortController = null
          set({
            isAssistantResponding: false,
            assistantMascotMood: 'idle',
          })
          return
        }
      }
      if (abortController.signal.aborted) return

      // 若为指令拆解意图，直接装配离线乐高积木流转卡片
      if (isExplainShellIntent && pipelineExplainResult) {
        const replyContent =
          `已为你完成 **${pipelineExplainResult.steps.length} 步** 复合指令与管道流转拆解：\n\n` +
          `> 💡 **业务总结**：${pipelineExplainResult.summary}\n` +
          `> 🛡️ **安全风险**：${pipelineExplainResult.hasDestructiveRisk ? '⚠️ 包含修改或删除操作' : '纯只读安全处理 (0 生产风险)'}\n\n` +
          `详细步骤请见下方 **乐高积木流转卡片**。`

        const assistantMsg: AIAssistantMessage = {
          id: assistantMsgId,
          role: 'assistant',
          content: replyContent,
          createdAt: Date.now(),
          mode: assistantMode,
          status: 'done',
          pipelineExplain: pipelineExplainResult,
        }
        finalizeMessages(
          [
            ...nextMessages.filter((m) => m.id !== assistantMsgId),
            assistantMsg,
          ],
          'happy',
        )
        return
      }

      // 若为 Docker 容器异常退出诊断意图，直接装配高水准离线即时归因报告
      if (context?.isDockerDiagnosis && context?.dockerContext) {
        const replyContent = generateOfflineDockerDiagnosis(context.dockerContext)
        const assistantMsg: AIAssistantMessage = {
          id: assistantMsgId,
          role: 'assistant',
          content: replyContent,
          createdAt: Date.now(),
          mode: assistantMode,
          status: 'done',
        }
        finalizeMessages(
          [
            ...nextMessages.filter((m) => m.id !== assistantMsgId),
            assistantMsg,
          ],
          'happy',
        )
        return
      }

      const probePlan = resolveProbePlan(content, servers, serverGroups, activeServerId)

      let replyContent = ''
      let commands: Array<{ command: string; explanation?: string; risk: CommandRiskAnalysis }> = []

      if (probePlan.shouldProbe && probePlan.targetServers.length > 0) {
        if (backend?.ssh?.batchExecute) {
          try {
            const probeRes = await executeSafeProbe(probePlan.targetServers, probePlan.metric, abortController.signal)
            replyContent = formatProbeReportForAI(probeRes, probePlan.targetExplanation)
          } catch (e) {
            replyContent = `### 🩺 服务器状态排查\n\n执行只读探针异常: ${(e as Error)?.message || '未知错误'}`
          }
        } else {
          replyContent = `### 🩺 服务器状态排查提示\n\n已识别排查目标：${probePlan.targetExplanation || '指定服务器'}。\n当前处于**本地离线规则模式**且未检测到本地 SSH 终端通道支持。如需执行服务器真实指标巡检，请先建立 SSH 连接或在「设置 -> AI 运维」中配置大模型。`
        }
        commands = []
      } else if (content.includes('连接') || content.includes('超时') || content.includes('timeout')) {
        replyContent = `### 🔍 SSH 连接超时排查指南
实例无法连接或 Connection timed out 通常由以下原因导致：
1. **安全组 / 防火墙未放行**：请确认云控制台安全组入方向是否允许对应端口（默认 TCP 22）。
2. **sshd 守护进程未运行**：可在物理机或 VNC 控制台检查服务状态。
3. **网络路由不可达**：检查本地公网出口与服务器公网 IP 是否路由畅通。

建议在终端执行以下排查命令：`
        commands = [
          {
            command: 'ping -c 4 <目标IP>',
            explanation: '探测网络层连通性与丢包率',
            risk: { level: 'safe', command: 'ping -c 4 <目标IP>', reasons: [], isBlocked: false },
          },
          {
            command: 'nc -zv -w 3 <目标IP> 22',
            explanation: '探测远程 SSH 端口 22 是否开放并接受握手',
            risk: { level: 'safe', command: 'nc -zv -w 3 <目标IP> 22', reasons: [], isBlocked: false },
          },
          {
            command: 'sudo systemctl status sshd',
            explanation: '在服务器控制台查看 SSH 服务运行状态',
            risk: { level: 'safe', command: 'sudo systemctl status sshd', reasons: [], isBlocked: false },
          },
        ]
      } else if (content.includes('磁盘') || content.includes('空间') || content.includes('清理')) {
        replyContent = `### 💾 磁盘空间清理与大文件排查
当 Linux 系统根目录或数据盘利用率达到 100% 时，会导致服务无法写入日志或崩溃：
1. **查看磁盘分区占用**：使用 \`df -h\` 查看满载的分区。
2. **安全定位大目录**：使用有深度限制的 \`du\` 检索体积最大的目录，严禁全盘无界递归。
3. **安全清理**：优先截断正在写入的日志文件，避免直接删除导致句柄未释放。`
        commands = [
          {
            command: 'df -hT',
            explanation: '查看所有磁盘挂载点使用容量与文件系统类型',
            risk: { level: 'safe', command: 'df -hT', reasons: [], isBlocked: false },
          },
          {
            command: 'du -h --max-depth=1 /var/log 2>/dev/null | sort -rh | head -n 10',
            explanation: '找出 /var/log 目录下体积最大的前 10 个子目录（限制深度=1，避免 I/O 卡死）',
            risk: { level: 'safe', command: 'du -h --max-depth=1 /var/log 2>/dev/null | sort -rh | head -n 10', reasons: [], isBlocked: false },
          },
          {
            command: 'sudo journalctl --vacuum-size=200M',
            explanation: '清理 systemd 日志，只保留最近 200MB',
            risk: { level: 'notice', command: 'sudo journalctl --vacuum-size=200M', reasons: ['修改系统日志保留大小'], isBlocked: false },
          },
        ]
      } else if (content.includes('端口') || content.includes('占用')) {
        replyContent = `### 🔌 端口占用排查与释放方案
如果启动服务提示 \`Address already in use\`，请按如下流程排查并释放占用端口：`
        commands = [
          {
            command: 'sudo lsof -i :8080',
            explanation: '查看占用指定端口（如 8080）的进程 PID 及程序名称',
            risk: { level: 'safe', command: 'sudo lsof -i :8080', reasons: [], isBlocked: false },
          },
          {
            command: 'sudo ss -tulpn | grep :8080',
            explanation: '使用 ss 高性能内核套接字工具查看端口监听详情',
            risk: { level: 'safe', command: 'sudo ss -tulpn | grep :8080', reasons: [], isBlocked: false },
          },
        ]
      } else if (content.includes('诊断') || content.includes('报错') || content.includes('error') || content.includes('failed')) {
        replyContent = `### 🔍 终端报错日志排障建议
根据您选中的终端日志内容，建议按以下标准排查步骤进行定位：
1. **确认服务进程与错误退出码**：检查最近崩溃或退出的核心守护进程。
2. **检索完整上下文日志堆栈**：单一报错行往往由前序异常诱发，需结合 systemd 或 dmesg 查看前序堆栈。
3. **安全排查命令推荐**：`
        commands = [
          {
            command: 'journalctl -xe --no-pager | tail -n 40',
            explanation: '查看 systemd 核心服务最近 40 行系统详细报错上下文',
            risk: { level: 'safe', command: 'journalctl -xe --no-pager | tail -n 40', reasons: [], isBlocked: false },
          },
          {
            command: 'dmesg -T --level=err,warn | tail -n 20',
            explanation: '检索内核级告警与 OOM 内存溢出终止记录',
            risk: { level: 'safe', command: 'dmesg -T --level=err,warn | tail -n 20', reasons: [], isBlocked: false },
          },
        ]
      } else {
        replyContent = `您好！针对您的问题：「**${content}**」

当前处于 **本地离线规则模式**（未接入大模型），本地规则仅收录了基础的服务器连接与常见高频排障指南。

作为 **Qshell 运维小助手**，我主要专注于 Linux 服务器运维、终端排障分析与 Shell 命令编写。

💡 若需进行自由开放式问答、解决复杂故障或体验全能 Agent 深度推理，可在「设置 -> AI 运维」中配置模型 API Key（支持 DeepSeek、通义千问、Kimi 或 100% 离线的本地 Ollama）。`
        commands = []
      }

      // 离线模拟流式逐字输出
      const chunks = replyContent.match(/[\s\S]{1,4}/g) || [replyContent]
      let simAccumulated = ''
      for (const piece of chunks) {
        if (abortController.signal.aborted) break
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 20)
          abortController.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }).catch(() => {})
        if (abortController.signal.aborted) break
        simAccumulated += piece
        onChunk(piece, simAccumulated)
      }

      if (abortController.signal.aborted) {
        activeAssistantAbortController = null
        return
      }
      activeAssistantAbortController = null

      const currentExecMode = effectiveSettings.executionMode || settings.executionMode || 'auto_readonly'
      const currentBlacklist = effectiveSettings.customBlacklist || settings.customBlacklist || []

      const executionCard = await buildExecutionCard(
        commands,
        replyContent,
        currentExecMode,
        currentBlacklist,
        activeServerId,
      )

      const simAssistantMsg: AIAssistantMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: replyContent,
        createdAt: Date.now(),
        mode: assistantMode,
        status: 'done',
        suggestedCommands: commands,
        executionCard,
      }
      finalizeMessages(
        [
          ...nextMessages.filter((m) => m.id !== assistantMsgId),
          simAssistantMsg,
        ],
        'happy',
      )
    }
  },

  executeMessageCommand: async (messageId: string) => {
    const { assistantMessages, assistantSessions, currentAssistantSessionId, assistantMode } = get()
    const targetMsg = assistantMessages.find((m) => m.id === messageId)
    if (!targetMsg || !targetMsg.executionCard) return

    const card = targetMsg.executionCard
    if (card.status !== 'pending') return

    // 1. 设置执行中状态
    const executingCard: AIAssistantExecutionCard = {
      ...card,
      status: 'executing',
    }
    const updatedMessages = assistantMessages.map((m) =>
      m.id === messageId ? { ...m, executionCard: executingCard } : m,
    )
    set({ assistantMessages: updatedMessages, assistantMascotMood: 'thinking' })

    const rawCmd = card.command
    const safeCmd = wrapSafeInspectionCommand(rawCmd)

    // 2. 查找当前活跃工作区连接
    const appState = useAppStore.getState()
    const tabs = (appState.tabs || []).map((t) => ({ id: t.id, serverId: t.serverId }))
    const connectedServers = appState.connectedServers || {}
    const activeTab = appState.tabs?.find((t) => t.id === appState.activeTabId)
    const activeServerId = activeTab?.serverId || null

    let activeConnId: string | null = null
    if (activeServerId) {
      activeConnId = findActiveConnectionId(activeServerId, tabs, connectedServers)
    }
    if (!activeConnId) {
      for (const s of appState.servers || []) {
        const connId = findActiveConnectionId(s.id, tabs, connectedServers)
        if (connId) {
          activeConnId = connId
          break
        }
      }
    }

    let stdout = ''
    let stderr = ''
    let isError = false

    if (backend?.ssh?.execute && activeConnId) {
      try {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('执行超时 (10s)')), 10000),
        )
        const cmdRes = await Promise.race([
          backend.ssh.execute(activeConnId, safeCmd),
          timeoutPromise,
        ])
        stdout = cmdRes.stdout || ''
        stderr = cmdRes.stderr || ''
        if (cmdRes.exitCode !== 0 && !stdout && stderr) {
          isError = true
        }
      } catch (err: unknown) {
        stderr = (err as Error)?.message || '执行异常'
        isError = true
      }
    } else if (!activeConnId) {
      stderr = '未检测到目标服务器的活跃 SSH 终端连接，无法下发命令执行。请先在工作区连接目标服务器。'
      isError = true
    } else {
      await new Promise((r) => setTimeout(r, 50))
      stdout = `[只读执行]\n$ ${safeCmd}\n(执行完成)`
    }

    const outputText = (stdout || stderr || '(执行完成，标准输出为空)').trim()
    const summary = generateExecutionSummary(safeCmd, outputText)
    const executedCard: AIAssistantExecutionCard = {
      ...card,
      command: safeCmd,
      status: 'executed',
      output: outputText,
      summary,
      error: isError ? stderr : undefined,
      executedAt: Date.now(),
    }

    const finalMessages = get().assistantMessages.map((m) =>
      m.id === messageId ? { ...m, executionCard: executedCard } : m,
    )
    const { settings } = get()
    const { updatedSessions, activeId } = autoSyncCurrentSession(
      assistantSessions,
      currentAssistantSessionId,
      finalMessages,
      assistantMode,
      settings.maxAssistantSessions,
      settings.maxMessagesPerSession,
    )

    set({
      assistantMessages: finalMessages,
      assistantSessions: updatedSessions,
      currentAssistantSessionId: activeId,
      assistantMascotMood: isError ? 'blink' : 'happy',
    })
  },

  rejectMessageCommand: (messageId: string) => {
    const { assistantMessages, assistantSessions, currentAssistantSessionId, assistantMode, settings } = get()
    const targetMsg = assistantMessages.find((m) => m.id === messageId)
    if (!targetMsg || !targetMsg.executionCard) return

    const rejectedCard: AIAssistantExecutionCard = {
      ...targetMsg.executionCard,
      status: 'rejected',
    }
    const finalMessages = assistantMessages.map((m) =>
      m.id === messageId ? { ...m, executionCard: rejectedCard } : m,
    )
    const { updatedSessions, activeId } = autoSyncCurrentSession(
      assistantSessions,
      currentAssistantSessionId,
      finalMessages,
      assistantMode,
      settings.maxAssistantSessions,
      settings.maxMessagesPerSession,
    )
    set({
      assistantMessages: finalMessages,
      assistantSessions: updatedSessions,
      currentAssistantSessionId: activeId,
      assistantMascotMood: 'idle',
    })
  },
}))
