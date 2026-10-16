/**
 * src/components/layout/ai-settings-panel.tsx
 *
 * Qshell AIOps & Terminal Copilot 模型配置中心
 * 1. 支持国内外所有主流大模型预设与自定义 (BYOK)
 * 2. 一键测试连接与网络延迟探测
 * 3. 端侧零信任安全脱敏 (DLP) 设置
 */

import React, { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n'
import { useAIStore } from '@/store/ai-store'
import {
  AI_PROVIDER_PRESETS,
  type AIProvider,
  type AIProtocol,
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
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function AISettingsPanel() {
  const { t } = useTranslation()
  const {
    settings,
    updateSettings,
    selectProvider,
    isTestingConnection,
    testResult,
    testConnection,
  } = useAIStore()

  const [showApiKey, setShowApiKey] = useState(false)

  const currentPreset = AI_PROVIDER_PRESETS[settings.provider]

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300 pb-12">
      {/* 1. 顶部总览卡片 */}
      <Card className="border border-border/60 bg-gradient-to-r from-primary/5 via-background to-background shadow-xs rounded-xl overflow-hidden">
        <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <h2 className="text-base font-semibold text-foreground tracking-tight">
                {t('ai_settings_title')}
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                BYOK 自由接入
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed pl-11">
              {t('ai_settings_subtitle')}
            </p>
          </div>

          <Button
            size="sm"
            variant="outline"
            disabled={isTestingConnection}
            onClick={() => void testConnection()}
            className="shrink-0 h-8 gap-1.5 text-xs font-medium border-border/80 hover:bg-primary/10 hover:text-primary transition-all"
          >
            {isTestingConnection ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>{t('ai_testing_connection')}</span>
              </>
            ) : (
              <>
                <Zap className="h-3.5 w-3.5 text-primary" />
                <span>{t('ai_test_connection_btn')}</span>
              </>
            )}
          </Button>
        </CardContent>

        {/* 测试结果横幅 */}
        {testResult && (
          <div
            className={cn(
              'px-5 py-2.5 text-xs flex items-center gap-2 border-t',
              testResult.success
                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                : 'bg-destructive/10 text-destructive border-destructive/20',
            )}
          >
            {testResult.success ? (
              <>
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  {t('ai_test_success_msg', { latency: testResult.latencyMs || 0 })}
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  {t('ai_test_failed_msg')}: {testResult.error}
                </span>
              </>
            )}
          </div>
        )}
      </Card>

      {/* 2. 模型服务商选择 */}
      <Card className="border border-border/60 bg-background/50 shadow-xs rounded-xl">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Bot className="h-4 w-4 text-primary" />
              {t('ai_provider_select_label')}
            </span>
            {currentPreset && (
              <span className="text-[11px] text-muted-foreground">
                {t(currentPreset.descriptionKey)}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {(Object.keys(AI_PROVIDER_PRESETS) as AIProvider[]).map((key) => {
              const preset = AI_PROVIDER_PRESETS[key]
              const isSelected = settings.provider === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectProvider(key)}
                  className={cn(
                    'flex flex-col items-start p-2.5 rounded-lg border text-left transition-all relative overflow-hidden',
                    isSelected
                      ? 'border-primary bg-primary/10 text-primary shadow-xs ring-1 ring-primary/30'
                      : 'border-border/60 bg-muted/20 hover:bg-muted/40 text-foreground',
                  )}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <span className="text-xs font-medium truncate">
                      {preset.name}
                    </span>
                    {preset.isDomestic ? (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-500">
                        国内
                      </span>
                    ) : (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-muted text-muted-foreground">
                        国际
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground truncate w-full font-mono">
                    {preset.defaultModel || '自定义模型'}
                  </span>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* 3. 详细参数配置 */}
      <Card className="border border-border/60 bg-background/50 shadow-xs rounded-xl">
        <CardContent className="p-5 space-y-4 text-xs">
          {/* Base URL */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-medium text-foreground flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                {t('ai_base_url_label')}
              </label>
              {currentPreset?.defaultBaseUrl && (
                <button
                  type="button"
                  onClick={() => updateSettings({ baseUrl: currentPreset.defaultBaseUrl })}
                  className="text-[10px] text-primary hover:underline"
                >
                  {t('ai_reset_default_url')}
                </button>
              )}
            </div>
            <Input
              value={settings.baseUrl}
              onChange={(e) => updateSettings({ baseUrl: e.target.value })}
              placeholder={currentPreset?.defaultBaseUrl || 'https://api.openai.com/v1'}
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
              {currentPreset?.websiteUrl && (
                <a
                  href={currentPreset.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-primary hover:underline flex items-center gap-1"
                >
                  {t('ai_get_api_key_link')}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={settings.apiKey}
                onChange={(e) => updateSettings({ apiKey: e.target.value })}
                placeholder={settings.provider === 'ollama' ? 'Ollama 本地无需 API Key' : 'sk-...'}
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

          {/* 模型名称 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-medium text-foreground">
                {t('ai_model_name_label')}
              </label>
            </div>
            <Input
              value={settings.model}
              onChange={(e) => updateSettings({ model: e.target.value })}
              placeholder={currentPreset?.defaultModel || 'deepseek-chat'}
              className="h-8 text-xs font-mono"
            />
            {currentPreset?.recommendedModels && currentPreset.recommendedModels.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <span className="text-[10px] text-muted-foreground">{t('ai_recommended_models')}:</span>
                {currentPreset.recommendedModels.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => updateSettings({ model: m })}
                    className={cn(
                      'text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors',
                      settings.model === m
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
        </CardContent>
      </Card>

      {/* 4. 安全防护与隐私脱敏 (DLP) */}
      <Card className="border border-border/60 bg-background/50 shadow-xs rounded-xl">
        <CardContent className="p-5 space-y-4">
          <div className="font-semibold text-xs text-foreground flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            {t('ai_security_and_dlp_title')}
          </div>

          {/* DLP 脱敏开关 */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/20">
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
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/20">
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
    </div>
  )
}
