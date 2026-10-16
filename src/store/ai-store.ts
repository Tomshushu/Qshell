/**
 * src/store/ai-store.ts
 *
 * Qshell AIOps & Terminal Copilot 状态管理 Store
 * 支持本地持久化设置，连接测试，错误诊断与自然语言指令生成
 */

import { create } from 'zustand'
import type {
  AIProvider,
  AISettings,
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
  openDiagnosis: (snippet: string, context?: AIPromptContext) => void
  closeDiagnosis: () => void
  runDiagnosis: () => Promise<void>
  openCommandPalette: (context?: AIPromptContext) => void
  closeCommandPalette: () => void
  runGenerateCommand: (userIntent: string) => Promise<void>
}

export const useAIStore = create<AIStoreState>((set, get) => ({
  settings: loadSavedSettings(),
  isTestingConnection: false,
  testResult: null,

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
