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
} from '@/types/ai'
import { AI_PROVIDER_PRESETS } from '@/types/ai'
import {
  testConnection,
  fetchProviderModels,
  diagnoseTerminalError,
  generateCommand,
} from '@/services/ai/ai-client'

const AI_SETTINGS_STORAGE_KEY = 'qshell_ai_settings_v1'
const AI_MODELS_CACHE_STORAGE_KEY = 'qshell_ai_models_cache_v1'
const AI_CONFIGURED_PROVIDERS_KEY = 'qshell_ai_configured_providers_v1'

const DEFAULT_SETTINGS: AISettings = {
  provider: 'deepseek',
  protocol: 'openai',
  baseUrl: AI_PROVIDER_PRESETS.deepseek.defaultBaseUrl,
  apiKey: '',
  model: AI_PROVIDER_PRESETS.deepseek.defaultModel,
  temperature: 0.3,
  maxTokens: 2048,
  enableDlp: true,
  maskPrivateIps: false,
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
  closeDiagnosis: () => void
  runDiagnosis: () => Promise<void>
  openCommandPalette: (context?: AIPromptContext) => void
  closeCommandPalette: () => void
  runGenerateCommand: (userIntent: string) => Promise<void>
}

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

  updateSettings: (partial) => {
    const current = get().settings
    const updated = { ...current, ...partial }
    set({ settings: updated, testResult: null })
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
    set({
      isDiagnosisModalOpen: true,
      diagnosisSnippet: snippet,
      diagnosisContext: context,
      diagnosisResult: null,
      diagnosisError: null,
    })
    void get().runDiagnosis()
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

  openCommandPalette: (context = {}) => {
    set({
      isCommandPaletteOpen: true,
      commandPaletteContext: context,
      generatedCommandResult: null,
      commandGenerationError: null,
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
}))
