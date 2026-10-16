/**
 * src/components/layout/ai-settings-panel.tsx
 *
 * Qshell AIOps & Terminal Copilot 模型配置中心
 * 1. 提供商列表管理：已配置 (Configured) 与 热门提供商 (Popular Providers)
 * 2. 状态约束：已配置的服务商每次只能开启一个 (Single active provider)
 * 3. 健康检测：已配置服务商连通性与网络延迟探测 (⚡ 142ms)
 * 4. 交互式弹窗配置：动态拉取模型列表、参数自定义、测试连接并保存启用
 * 5. 端侧零信任安全防御与数据脱敏 (DLP)
 */

import React, { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SelectPopover } from '@/components/ui/select-popover'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslation } from '@/i18n'
import { useAIStore } from '@/store/ai-store'
import {
  AI_PROVIDER_PRESETS,
  type AIProvider,
  type AIProtocol,
  type ConfiguredProvider,
} from '@/types/ai'
import {
  Sparkles,
  Bot,
  KeyRound,
  Globe,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  ExternalLink,
  Zap,
  RefreshCw,
  Edit2,
  Pencil,
  Trash2,
  Plus,
  Sliders,
  Check,
  Layers,
  Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ==========================================
// 1. 服务商 Brand 图标组件
// ==========================================
function ProviderBrandIcon({
  provider,
  className,
}: {
  provider: AIProvider
  className?: string
}) {
  const iconClass = cn('w-4 h-4 shrink-0', className)

  switch (provider) {
    case 'deepseek':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <path
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5h-2v-2h2v2zm0-4h-2V7h2v5.5z"
            fill="currentColor"
            className="text-cyan-500"
          />
          <circle cx="9" cy="9" r="1.5" fill="#38bdf8" />
          <circle cx="15" cy="9" r="1.5" fill="#38bdf8" />
        </svg>
      )
    case 'qwen':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <rect x="3" y="3" width="18" height="18" rx="4" className="fill-orange-500/20 stroke-orange-500" strokeWidth="2" />
          <path d="M7 12h10M12 7v10" className="stroke-orange-500" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      )
    case 'siliconflow':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <path
            d="M12 3L3 8v8l9 5 9-5V8l-9-5z"
            className="fill-purple-500/20 stroke-purple-500"
            strokeWidth="2"
          />
          <circle cx="12" cy="12" r="3" className="fill-purple-500" />
        </svg>
      )
    case 'ollama':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <rect x="4" y="5" width="16" height="14" rx="3" className="fill-emerald-500/20 stroke-emerald-500" strokeWidth="2" />
          <circle cx="9" cy="11" r="1.5" className="fill-emerald-500" />
          <circle cx="15" cy="11" r="1.5" className="fill-emerald-500" />
          <path d="M9 15h6" className="stroke-emerald-500" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )
    case 'openai':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <circle cx="12" cy="12" r="9" className="stroke-emerald-600 dark:stroke-emerald-400" strokeWidth="2" />
          <path
            d="M12 6v6l4.5 2.5"
            className="stroke-emerald-600 dark:stroke-emerald-400"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'anthropic':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <path
            d="M12 2L9 9l-7 3 7 3 3 7 3-7 7-3-7-3-3-7z"
            className="fill-amber-500/20 stroke-amber-500"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'gemini':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <path
            d="M12 2C12 7.52 7.52 12 2 12c5.48 0 10 4.48 10 10 0-5.52 4.48-10 10-10-5.52 0-10-4.48-10-10z"
            className="fill-blue-500/20 stroke-blue-500"
            strokeWidth="1.8"
          />
        </svg>
      )
    case 'groq':
      return (
        <Zap className={cn('text-amber-500', iconClass)} />
      )
    case 'moonshot':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <path
            d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
            className="fill-indigo-500/20 stroke-indigo-500"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'glm':
      return (
        <svg viewBox="0 0 24 24" fill="none" className={iconClass}>
          <path
            d="M4 7h16M4 12h16M4 17h10"
            className="stroke-blue-500"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      )
    default:
      return <Sliders className={cn('text-muted-foreground', iconClass)} />
  }
}

// ==========================================
// 2. 标签徽章组件 (TagBadge)
// ==========================================
function TagBadge({
  text,
  type = 'custom',
}: {
  text: string
  type?: 'recommended' | 'domestic' | 'offline' | 'speed' | 'custom' | 'global' | 'official'
}) {
  const colorMap: Record<string, string> = {
    recommended: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    domestic: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25',
    offline: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/25',
    speed: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
    global: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25',
    official: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    custom: 'bg-muted/80 text-muted-foreground border-border/60',
  }

  return (
    <span
      className={cn(
        'text-[10px] px-1.5 py-0.5 rounded font-medium border leading-none shrink-0 inline-flex items-center justify-center',
        colorMap[type] || colorMap.custom,
      )}
    >
      {text}
    </span>
  )
}

// ==========================================
// 3. 配置提供商模态弹窗 (ConfigureProviderModal)
// ==========================================
interface ConfigureModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingProvider: ConfiguredProvider | null
  presetProviderKey: AIProvider | null
  onSave: (
    data: Partial<ConfiguredProvider> & { provider: AIProvider },
    activate: boolean,
  ) => void
}

function ConfigureProviderModal({
  open,
  onOpenChange,
  editingProvider,
  presetProviderKey,
  onSave,
}: ConfigureModalProps) {
  const { t } = useTranslation()
  const {
    customModelsMap,
    testProviderConfig,
    fetchModelsForConfig,
  } = useAIStore()

  // 提供商 Key (优先取编辑项，否则取预设项)
  const providerKey = editingProvider?.provider || presetProviderKey || 'deepseek'
  const preset = AI_PROVIDER_PRESETS[providerKey]

  // 表单状态
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [protocol, setProtocol] = useState<AIProtocol>('openai')

  const [showApiKey, setShowApiKey] = useState(false)
  const [isManualInput, setIsManualInput] = useState(false)

  // 连通性测试状态
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    latencyMs?: number
    error?: string
  } | null>(null)

  // 模型拉取状态
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [fetchError, setFetchError] = useState<string | null>(null)

  // 当弹窗打开时回填表单
  React.useEffect(() => {
    if (!open) return

    setTestResult(null)
    setFetchError(null)

    if (editingProvider) {
      setName(editingProvider.name)
      setBaseUrl(editingProvider.baseUrl)
      setApiKey(editingProvider.apiKey)
      setModel(editingProvider.model)
      setProtocol(editingProvider.protocol)
    } else if (preset) {
      setName(preset.name)
      setBaseUrl(preset.defaultBaseUrl)
      setApiKey('')
      setModel(preset.defaultModel)
      setProtocol(preset.protocol)
    }

    // 载入已有缓存模型
    const cached = customModelsMap[providerKey] || []
    setFetchedModels(cached)
    setIsManualInput(cached.length === 0)
  }, [open, editingProvider, preset, providerKey, customModelsMap])

  // 执行连通性测试
  const handleTestConnection = async () => {
    setIsTesting(true)
    setTestResult(null)
    try {
      const res = await testProviderConfig({
        provider: providerKey,
        protocol,
        baseUrl,
        apiKey,
        model,
      })
      setTestResult(res)
    } finally {
      setIsTesting(false)
    }
  }

  // 动态拉取模型列表
  const handleFetchModels = async () => {
    setIsFetchingModels(true)
    setFetchError(null)
    try {
      const models = await fetchModelsForConfig({
        provider: providerKey,
        protocol,
        baseUrl,
        apiKey,
      })
      setFetchedModels(models)
      if (models.length > 0) {
        setIsManualInput(false)
        if (!model || !models.includes(model)) {
          setModel(models[0])
        }
      }
    } catch (err: unknown) {
      setFetchError((err as Error)?.message || t('ai_fetch_models_failed'))
    } finally {
      setIsFetchingModels(false)
    }
  }

  // 保存动作
  const handleSubmit = (activate: boolean) => {
    onSave(
      {
        id: editingProvider?.id,
        provider: providerKey,
        name: name.trim() || preset?.name || providerKey,
        protocol,
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim() || preset?.defaultModel || 'default',
      },
      activate,
    )
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 overflow-hidden rounded-xl border border-border/80 shadow-2xl bg-background">
        {/* Header */}
        <DialogHeader className="p-5 border-b border-border/60 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-background border border-border/60 shadow-2xs">
              <ProviderBrandIcon provider={providerKey} className="w-5 h-5" />
            </div>
            <div className="space-y-0.5">
              <DialogTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                {editingProvider
                  ? t('ai_config_dialog_title_edit', { provider: preset?.name || providerKey })
                  : t('ai_config_dialog_title_create', { provider: preset?.name || providerKey })}
                <TagBadge
                  text={preset?.tagText || (editingProvider ? t('ai_tag_custom') : t('ai_tag_official'))}
                  type={preset?.tagType || 'custom'}
                />
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {t('ai_config_dialog_subtitle')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[68vh] overflow-y-auto text-xs">
          {/* 提供商别名 */}
          <div className="space-y-1.5">
            <label className="font-medium text-foreground flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5 text-muted-foreground" />
              {t('ai_config_name_label')}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={preset?.name || 'My AI Provider'}
              className="h-8 text-xs font-medium"
            />
          </div>

          {/* Base URL */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-medium text-foreground flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                {t('ai_base_url_label')}
              </label>
              {preset?.defaultBaseUrl && (
                <button
                  type="button"
                  onClick={() => setBaseUrl(preset.defaultBaseUrl)}
                  className="text-[11px] text-primary hover:underline"
                >
                  {t('ai_reset_default_url')}
                </button>
              )}
            </div>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={preset?.defaultBaseUrl || 'https://api.openai.com/v1'}
              className="h-8 text-xs font-mono"
            />
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-medium text-foreground flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                {t('ai_api_key_label')}
              </label>
              {preset?.websiteUrl && (
                <a
                  href={preset.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-primary hover:underline flex items-center gap-1"
                >
                  {t('ai_get_api_key_link')}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={providerKey === 'ollama' ? 'Ollama 本地无需 API Key' : 'sk-...'}
                className="h-8 text-xs font-mono pr-9"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
              >
                {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              {t('ai_api_key_security_notice')}
            </p>
          </div>

          {/* 模型选择与拉取 */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="font-medium text-foreground">
                  {t('ai_model_name_label')}
                </label>
                {fetchedModels.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono font-medium border border-emerald-500/20">
                    {t('ai_models_count', { count: fetchedModels.length })}
                  </span>
                )}
              </div>

              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isFetchingModels}
                onClick={() => void handleFetchModels()}
                className="h-6 px-2 text-[11px] gap-1 hover:text-primary hover:border-primary/50 text-foreground"
              >
                <RefreshCw className={cn('h-3 w-3', isFetchingModels && 'animate-spin text-primary')} />
                <span>
                  {isFetchingModels ? t('ai_fetching_models') : t('ai_fetch_models_btn')}
                </span>
              </Button>
            </div>

            {/* 下拉选择 or 手动输入 */}
            {fetchedModels.length > 0 && !isManualInput ? (
              <div className="flex items-center gap-2">
                <SelectPopover
                  value={model || null}
                  onChange={(val) => {
                    if (val) setModel(val)
                  }}
                  options={fetchedModels.map((m) => ({
                    value: m,
                    label: m,
                  }))}
                  searchable
                  searchPlaceholder={t('ai_select_model_placeholder')}
                  placeholder={t('ai_select_model_placeholder')}
                  className="flex-1 h-8 text-xs font-mono"
                  panelClassName="w-[360px] max-h-72"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsManualInput(true)}
                  className="h-8 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground shrink-0"
                  title={t('ai_custom_model_mode')}
                >
                  <Edit2 className="h-3 w-3" />
                  <span className="hidden sm:inline">{t('ai_custom_model_mode')}</span>
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={preset?.defaultModel || 'deepseek-chat'}
                  className="h-8 text-xs font-mono flex-1"
                />
                {fetchedModels.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsManualInput(false)}
                    className="h-8 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground shrink-0"
                    title="从已拉取列表中选择"
                  >
                    <Layers className="h-3 w-3" />
                    <span className="hidden sm:inline">选择列表</span>
                  </Button>
                )}
              </div>
            )}

            {/* 拉取失败错误提示 */}
            {fetchError && (
              <div className="text-[11px] text-destructive flex items-center gap-1.5 pt-0.5">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{fetchError}</span>
              </div>
            )}

            {/* 推荐模型标签 */}
            {preset?.recommendedModels && preset.recommendedModels.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <span className="text-[10px] text-muted-foreground">{t('ai_recommended_models')}:</span>
                {preset.recommendedModels.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setModel(m)}
                    className={cn(
                      'text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors',
                      model === m
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/60 text-muted-foreground hover:bg-muted/40',
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 连通性测试按钮与反馈 */}
          <div className="pt-2 border-t border-border/40 space-y-2">
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isTesting}
                onClick={() => void handleTestConnection()}
                className="h-7 px-2.5 text-xs gap-1.5 font-medium border-border/80 hover:bg-primary/10 hover:text-primary transition-all"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    <span>{t('ai_testing_connection')}</span>
                  </>
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5 text-primary" />
                    <span>{t('ai_test_connection_btn')}</span>
                  </>
                )}
              </Button>

              {testResult && (
                <div className="text-xs">
                  {testResult.success ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {t('ai_test_success_msg', { latency: testResult.latencyMs || 0 })}
                    </span>
                  ) : (
                    <span className="text-destructive font-medium flex items-center gap-1 truncate max-w-xs" title={testResult.error}>
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      {testResult.error || t('ai_test_failed_msg')}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border/60 bg-muted/20 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
          >
            {t('modal_close_esc')}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleSubmit(false)}
            className="h-8 px-3 text-xs font-medium border-border/80 hover:bg-muted"
          >
            {t('ai_save_only_btn')}
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={() => handleSubmit(true)}
            className="h-8 px-3.5 text-xs font-medium gap-1.5 bg-primary text-primary-foreground shadow-xs hover:bg-primary/90"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('ai_save_and_enable_btn')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ==========================================
// 4. 主面板组件 (AISettingsPanel)
// ==========================================
export function AISettingsPanel() {
  const { t } = useTranslation()
  const {
    settings,
    updateSettings,
    configuredProviders,
    testingProviderId,
    saveConfiguredProvider,
    removeConfiguredProvider,
    toggleActiveProvider,
    testConfiguredProvider,
  } = useAIStore()

  // 弹窗状态
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ConfiguredProvider | null>(null)
  const [selectedPresetKey, setSelectedPresetKey] = useState<AIProvider | null>(null)

  // 删除确认状态
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const handleOpenCreate = (presetKey: AIProvider) => {
    setEditingProvider(null)
    setSelectedPresetKey(presetKey)
    setModalOpen(true)
  }

  const handleOpenEdit = (provider: ConfiguredProvider) => {
    setSelectedPresetKey(null)
    setEditingProvider(provider)
    setModalOpen(true)
  }

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300 pb-12">
      {/* 顶部标题区 */}
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
          {t('ai_providers_section_title')}
        </h2>
      </div>

      {/* 1. 已配置卡片区 (Configured Providers) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-foreground">
            {t('ai_configured_section_title')}
          </span>
          <span className="text-[11px] text-muted-foreground/80">
            {t('ai_single_active_hint')}
          </span>
        </div>

        <Card className="border border-border/60 bg-muted/15 dark:bg-card/40 rounded-xl overflow-hidden shadow-2xs">
          {configuredProviders.length === 0 ? (
            <CardContent className="p-8 text-center flex flex-col items-center justify-center space-y-2">
              <div className="p-3 rounded-full bg-muted/60 text-muted-foreground">
                <Bot className="h-5 w-5" />
              </div>
              <p className="text-xs text-muted-foreground max-w-sm">
                {t('ai_configured_empty_tip')}
              </p>
            </CardContent>
          ) : (
            <div className="divide-y divide-border/40">
              {configuredProviders.map((item) => {
                const isTestingThis = testingProviderId === item.id
                const preset = AI_PROVIDER_PRESETS[item.provider]

                return (
                  <div
                    key={item.id}
                    className={cn(
                      'px-4 py-3 flex items-center justify-between gap-3 transition-colors',
                      item.isEnabled
                        ? 'bg-primary/5 hover:bg-primary/8'
                        : 'hover:bg-muted/30',
                    )}
                  >
                    {/* 左侧：图标 + 名称 + 标签 + 模型 */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-background border border-border/60 shadow-2xs shrink-0">
                        <ProviderBrandIcon provider={item.provider} className="w-4 h-4" />
                      </div>

                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground truncate max-w-[200px]">
                            {item.name}
                          </span>
                          <TagBadge
                            text={preset?.tagText || t('ai_tag_custom')}
                            type={preset?.tagType || 'custom'}
                          />
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono truncate max-w-[260px]">
                          {item.model || 'default'}
                        </div>
                      </div>
                    </div>

                    {/* 右侧：健康检测 + 单选启用 + 编辑 + 删除 */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* 健康检测按钮与延迟显示 */}
                      {isTestingThis ? (
                        <div className="h-7 px-2.5 rounded border border-border/60 bg-background text-[11px] text-primary flex items-center gap-1 font-mono">
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          <span>{t('ai_test_pinging')}</span>
                        </div>
                      ) : item.lastTestStatus === 'success' ? (
                        <button
                          type="button"
                          onClick={() => void testConfiguredProvider(item.id)}
                          title="点击重新检测延迟"
                          className="h-7 px-2.5 rounded border border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[11px] font-mono flex items-center gap-1 transition-colors"
                        >
                          <Zap className="h-3 w-3 shrink-0" />
                          <span>⚡ {item.lastLatencyMs || 0}ms</span>
                        </button>
                      ) : item.lastTestStatus === 'failed' ? (
                        <button
                          type="button"
                          onClick={() => void testConfiguredProvider(item.id)}
                          title={item.lastTestError || '连接失败，点击重新检测'}
                          className="h-7 px-2.5 rounded border border-destructive/25 bg-destructive/10 hover:bg-destructive/20 text-destructive text-[11px] flex items-center gap-1 transition-colors"
                        >
                          <AlertCircle className="h-3 w-3 shrink-0" />
                          <span>{t('ai_test_failed_msg')}</span>
                        </button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void testConfiguredProvider(item.id)}
                          className="h-7 px-2.5 text-[11px] gap-1 text-muted-foreground hover:text-foreground hover:border-primary/40"
                        >
                          <Activity className="h-3 w-3" />
                          <span>{t('ai_test_ping_btn')}</span>
                        </Button>
                      )}

                      {/* 单选启用/停用按钮 */}
                      {item.isEnabled ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => toggleActiveProvider(item.id)}
                          className="h-7 px-2.5 text-xs font-medium border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-all gap-1 group/btn"
                        >
                          <Check className="h-3.5 w-3.5 group-hover/btn:hidden" />
                          <span className="group-hover/btn:hidden">{t('ai_status_enabled')}</span>
                          <span className="hidden group-hover/btn:inline">{t('ai_status_disable_btn')}</span>
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => toggleActiveProvider(item.id)}
                          className="h-7 px-2.5 text-xs font-medium border-border/80 hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-all"
                        >
                          {t('ai_status_enable_btn')}
                        </Button>
                      )}

                      {/* 编辑按钮 */}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => handleOpenEdit(item)}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title={t('ai_edit_btn')}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>

                      {/* 删除按钮 */}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteId(item.id)}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title={t('ai_delete_btn')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {/* 2. 热门提供商卡片区 (Popular Providers) */}
      <div className="space-y-2 pt-2">
        <span className="text-xs font-semibold text-foreground">
          {t('ai_popular_section_title')}
        </span>

        <Card className="border border-border/60 bg-muted/15 dark:bg-card/40 rounded-xl overflow-hidden shadow-2xs divide-y divide-border/40">
          {(Object.keys(AI_PROVIDER_PRESETS) as AIProvider[]).map((key) => {
            const preset = AI_PROVIDER_PRESETS[key]

            return (
              <div
                key={key}
                className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
              >
                {/* 左侧：图标 + 名称 + 标签 + 副标题 */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-background border border-border/60 shadow-2xs shrink-0">
                    <ProviderBrandIcon provider={key} className="w-4 h-4" />
                  </div>

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground truncate">
                        {preset.name}
                      </span>
                      <TagBadge text={preset.tagText} type={preset.tagType} />
                    </div>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {t(preset.subtitleKey)}
                    </p>
                  </div>
                </div>

                {/* 右侧：+ 连接 按钮 */}
                <div className="shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenCreate(key)}
                    className="h-7 px-3 text-xs font-medium border-border/80 hover:bg-background hover:text-primary hover:border-primary/40 shadow-2xs gap-1 transition-all"
                  >
                    <Plus className="h-3 w-3" />
                    <span>{t('ai_connect_btn')}</span>
                  </Button>
                </div>
              </div>
            )
          })}
        </Card>
      </div>

      {/* 3. 安全防护与隐私脱敏 (DLP) */}
      <Card className="border border-border/60 bg-muted/15 dark:bg-card/40 rounded-xl overflow-hidden shadow-2xs">
        <CardContent className="p-5 space-y-4">
          <div className="font-semibold text-xs text-foreground flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            {t('ai_security_and_dlp_title')}
          </div>

          {/* DLP 脱敏开关 */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-background/50">
            <div className="space-y-0.5 pr-4">
              <div className="text-xs font-medium text-foreground">
                {t('ai_dlp_switch_title')}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t('ai_dlp_switch_desc')}
              </p>
            </div>
            <Switch
              checked={settings.enableDlp}
              onCheckedChange={(checked) => updateSettings({ enableDlp: checked })}
            />
          </div>

          {/* 内网 IP 模糊化开关 */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-background/50">
            <div className="space-y-0.5 pr-4">
              <div className="text-xs font-medium text-foreground">
                {t('ai_mask_private_ip_title')}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t('ai_mask_private_ip_desc')}
              </p>
            </div>
            <Switch
              checked={settings.maskPrivateIps}
              onCheckedChange={(checked) => updateSettings({ maskPrivateIps: checked })}
            />
          </div>
        </CardContent>
      </Card>

      {/* 配置模态弹窗 */}
      <ConfigureProviderModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        editingProvider={editingProvider}
        presetProviderKey={selectedPresetKey}
        onSave={(data, activate) => {
          saveConfiguredProvider(data, activate)
        }}
      />

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        open={!!deleteId}
        title={t('ai_delete_provider_title')}
        description={t('ai_delete_provider_confirm')}
        onConfirm={() => {
          if (deleteId) {
            removeConfiguredProvider(deleteId)
            setDeleteId(null)
          }
        }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  )
}
