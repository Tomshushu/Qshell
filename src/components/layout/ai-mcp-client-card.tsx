/**
 * Qshell MCP 插件中心
 *
 * 1. 内置 5 大免配置 SSH-Native 服务器排障插件（真实状态来自 Rust MCP Client 引擎）
 * 2. 支持自定义 Stdio / HTTP / SSE 插件的添加、编辑、删除、连接测试与工具刷新
 * 3. 插件级 / 工具级启停、连接状态与错误可见、写操作需显式授权
 * 4. 所有插件输出经端侧 DLP 脱敏与 8KB 截断保护
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { HintTooltip } from '@/components/ui/hint-tooltip'
import { useAIStore } from '@/store/ai-store'
import { useTranslation, translate } from '@/i18n'
import {
  backend,
  type McpPluginView,
  type McpPresetTemplate,
  type McpToolInfo,
} from '@/services/api'
import {
  Blocks,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  ShieldAlert,
  Globe,
  Cpu,
  Container,
  Coffee,
  Wrench,
  RotateCcw,
  Sparkles,
  Plus,
  Pencil,
  RefreshCw,
  Trash2,
  Layers,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  McpPluginEditorDialog,
  type McpEditorTarget,
} from './mcp-plugin-editor-dialog'

// ============================================================================
// 插件图标渲染组件
// ============================================================================
function McpPluginIcon({ icon, className }: { icon: string; className?: string }) {
  const baseClass = cn('w-4 h-4 shrink-0', className)
  switch (icon) {
    case 'docker':
      return <Container className={cn(baseClass, 'text-cyan-500')} />
    case 'java':
      return <Coffee className={cn(baseClass, 'text-orange-500')} />
    case 'kubernetes':
      return <Container className={cn(baseClass, 'text-blue-500')} />
    case 'nginx_web':
      return <Globe className={cn(baseClass, 'text-emerald-500')} />
    case 'linux_kernel':
      return <Cpu className={cn(baseClass, 'text-purple-500')} />
    default:
      return <Wrench className={cn(baseClass, 'text-primary')} />
  }
}

/** 分类胶囊对应的 i18n key（渲染时由 t() 解析，避免模块级硬编码文案） */
const CATEGORY_LABEL_KEYS: Record<string, string> = {
  container: 'mcp_category_container',
  application: 'mcp_category_application',
  system: 'mcp_category_system',
  custom: 'mcp_category_custom',
}

// ============================================================================
// 主组件：AiMcpClientCard
// ============================================================================
export function AiMcpClientCard() {
  const [plugins, setPlugins] = useState<McpPluginView[]>([])
  const [presets, setPresets] = useState<McpPresetTemplate[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [expandedToolsPluginId, setExpandedToolsPluginId] = useState<string | null>(null)
  const [busyPluginIds, setBusyPluginIds] = useState<Record<string, boolean>>({})
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [showPresets, setShowPresets] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorTarget, setEditorTarget] = useState<McpEditorTarget>({ mode: 'create' })
  const [pendingRemove, setPendingRemove] = useState<McpPluginView | null>(null)
  const [removing, setRemoving] = useState(false)

  const { t } = useTranslation()
  const allowWriteMcpTools = useAIStore((s) => s.settings.allowWriteMcpTools === true)
  const effectiveMode = useAIStore((s) => s.getEffectiveExecutionMode())
  const dangerModeActive = effectiveMode === 'danger'
  const pluginToolsBlocked = effectiveMode === 'ask' || effectiveMode === 'disabled'
  const updateSettings = useAIStore((s) => s.updateSettings)

  const loadData = useCallback(async () => {
    setLoading(true)
    setGlobalError(null)
    try {
      const mcp = backend?.mcpClient
      if (!mcp?.listPlugins) {
        throw new Error(translate('mcp_engine_unavailable'))
      }
      const [pluginList, presetList] = await Promise.all([
        mcp.listPlugins(),
        mcp.listPresets?.() ?? Promise.resolve([] as McpPresetTemplate[]),
      ])
      setPlugins(Array.isArray(pluginList) ? pluginList : [])
      setPresets(Array.isArray(presetList) ? presetList : [])
    } catch (err: unknown) {
      setGlobalError((err as Error)?.message || translate('mcp_unknown_error'))
      setPlugins([])
      setPresets([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const stats = useMemo(() => {
    let enabledCount = 0
    let connectedCount = 0
    let activeToolCount = 0
    for (const p of plugins) {
      if (p.connected) connectedCount++
      if (p.enabled) {
        enabledCount++
        const disabledSet = new Set(p.disabledTools || [])
        for (const t of p.discoveredTools || []) {
          if (!disabledSet.has(t.name) && p.connected) activeToolCount++
        }
      }
    }
    return { enabledCount, connectedCount, activeToolCount }
  }, [plugins])

  const categories = useMemo(() => {
    const extra = new Set<string>()
    for (const p of plugins) {
      if (p.category && !CATEGORY_LABEL_KEYS[p.category]) extra.add(p.category)
    }
    return ['all', 'container', 'application', 'system', 'custom', ...Array.from(extra)]
  }, [plugins])

  const filteredPlugins = useMemo(() => {
    if (selectedCategory === 'all') return plugins
    return plugins.filter((p) => p.category === selectedCategory)
  }, [plugins, selectedCategory])

  const missingPresets = useMemo(
    () => presets.filter((preset) => !plugins.some((p) => p.presetId === preset.presetId)),
    [presets, plugins],
  )

  const withBusy = useCallback(
    async (pluginId: string, action: () => Promise<void>) => {
      setBusyPluginIds((prev) => ({ ...prev, [pluginId]: true }))
      setGlobalError(null)
      try {
        await action()
      } catch (err: unknown) {
        setGlobalError((err as Error)?.message || translate('mcp_unknown_error'))
      } finally {
        setBusyPluginIds((prev) => ({ ...prev, [pluginId]: false }))
      }
    },
    [],
  )

  const replacePlugin = useCallback((updated: McpPluginView) => {
    setPlugins((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }, [])

  const handleTogglePlugin = (plugin: McpPluginView, nextEnabled: boolean) =>
    withBusy(plugin.id, async () => {
      const mcp = backend?.mcpClient
      if (!mcp?.setEnabled) throw new Error(translate('mcp_engine_unavailable'))
      replacePlugin(await mcp.setEnabled(plugin.id, nextEnabled))
    })

  const handleToggleTool = (plugin: McpPluginView, toolName: string, enabled: boolean) =>
    withBusy(plugin.id, async () => {
      const mcp = backend?.mcpClient
      if (!mcp?.setToolDisabled) throw new Error(translate('mcp_engine_unavailable'))
      replacePlugin(await mcp.setToolDisabled(plugin.id, toolName, !enabled))
    })

  const handleRefresh = (plugin: McpPluginView) =>
    withBusy(plugin.id, async () => {
      const mcp = backend?.mcpClient
      if (!mcp?.refreshPlugin) throw new Error(translate('mcp_engine_unavailable'))
      replacePlugin(await mcp.refreshPlugin(plugin.id))
    })

  const handleRestorePresets = async () => {
    setLoading(true)
    setGlobalError(null)
    try {
      const mcp = backend?.mcpClient
      if (!mcp?.restorePresets) throw new Error(translate('mcp_engine_unavailable'))
      const updatedList = await mcp.restorePresets()
      setPlugins(updatedList)
      const presetList = await (mcp.listPresets?.() ?? Promise.resolve([] as McpPresetTemplate[]))
      setPresets(Array.isArray(presetList) ? presetList : [])
    } catch (err: unknown) {
      setGlobalError((err as Error)?.message || translate('mcp_unknown_error'))
    } finally {
      setLoading(false)
    }
  }

  const handleRemove = async () => {
    if (!pendingRemove) return
    setRemoving(true)
    setGlobalError(null)
    try {
      const mcp = backend?.mcpClient
      if (!mcp?.removePlugin) throw new Error(translate('mcp_engine_unavailable'))
      await mcp.removePlugin(pendingRemove.id)
      setPendingRemove(null)
      await loadData()
    } catch (err: unknown) {
      setGlobalError((err as Error)?.message || translate('mcp_unknown_error'))
    } finally {
      setRemoving(false)
    }
  }

  const openEditor = (target: McpEditorTarget) => {
    setEditorTarget(target)
    setEditorOpen(true)
  }

  return (
    <>
      <Card
        data-testid="ai-mcp-client-card"
        className="border border-border/60 bg-muted/15 dark:bg-card/40 rounded-xl overflow-hidden shadow-2xs"
      >
        <CardContent className="p-4 space-y-3">
          {/* 顶部标题栏与汇总统计 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Blocks className="h-4 w-4 text-primary" />
              <span className="font-semibold text-xs text-foreground">
                {t('mcp_hub_title')}
              </span>
              <HintTooltip label="MCP plugin hub" content={t('mcp_hub_intro')} />
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                {t('mcp_stats', {
                  enabled: stats.enabledCount,
                  total: plugins.length,
                  connected: stats.connectedCount,
                  tools: stats.activeToolCount,
                })}
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="mcp-add-plugin-btn"
                onClick={() => openEditor({ mode: 'create' })}
                className="h-7 px-2.5 text-[11px] gap-1 cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                <span>{t('mcp_add_plugin')}</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="mcp-list-presets-btn"
                onClick={() => setShowPresets((prev) => !prev)}
                className="h-7 px-2.5 text-[11px] gap-1 cursor-pointer"
              >
                <Layers className="h-3 w-3" />
                <span>{t('mcp_builtin_templates', { count: presets.length })}</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="mcp-restore-presets-btn"
                onClick={() => void handleRestorePresets()}
                className="h-7 px-2.5 text-[11px] gap-1 cursor-pointer"
                title={t('mcp_restore_defaults_hint')}
              >
                <RotateCcw className="h-3 w-3" />
                <span>{t('mcp_restore_defaults')}</span>
              </Button>
            </div>
          </div>

          {/* 写操作授权：跟随执行模式，危险模式下由临时提权接管 */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-[11px] font-medium text-foreground">{t('mcp_allow_write_title')}</span>
              <HintTooltip label="Write authorization details" content={t('mcp_allow_write_desc')} />
            </div>
            <Switch
              data-testid="mcp-allow-write-switch"
              checked={allowWriteMcpTools || dangerModeActive}
              disabled={dangerModeActive}
              onCheckedChange={(checked) => updateSettings({ allowWriteMcpTools: checked })}
            />
          </div>
          {dangerModeActive && (
            <div className="text-[10px] text-destructive">
              {t('mcp_allow_write_danger_override') || '危险模式已接管插件写权限，退出后恢复原设置'}
            </div>
          )}
          {pluginToolsBlocked && (
            <div className="text-[10px] text-muted-foreground">
              {t('mcp_exec_mode_blocked') || '当前执行模式不允许 AI 调用插件工具，请切换到只读自动执行或危险模式'}
            </div>
          )}

          {/* 错误横幅提示 */}
          {globalError && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/25 text-destructive text-xs">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="flex-1 break-all">{globalError}</span>
            </div>
          )}

          {/* 内置模板清单 */}
          {showPresets && (
            <div className="p-3 rounded-lg border border-border/50 bg-background/50 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-foreground">
                  {t('mcp_templates_status', {
                    installed: presets.length - missingPresets.length,
                    total: presets.length,
                  })}
                </span>
                {missingPresets.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleRestorePresets()}
                    className="h-6 px-2 text-[10px] cursor-pointer"
                  >
                    {t('mcp_restore_missing')}
                  </Button>
                )}
              </div>
              {presets.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">{t('mcp_no_templates')}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {presets.map((preset) => {
                    const installed = !missingPresets.some((p) => p.presetId === preset.presetId)
                    return (
                      <span
                        key={preset.presetId}
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px]',
                          installed
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                            : 'bg-muted/40 border-border/50 text-muted-foreground',
                        )}
                      >
                        {installed ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                        {preset.name}
                        {!installed && ` ${t('mcp_template_missing')}`}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* 分类筛选胶囊 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {categories.map((cat) => {
              const active = selectedCategory === cat
              return (
                <button
                  key={cat}
                  type="button"
                  data-testid={`mcp-cat-${cat}`}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    'px-2 py-0.5 rounded-md text-[11px] font-medium transition-all cursor-pointer border',
                    active
                      ? 'bg-primary text-primary-foreground border-primary shadow-2xs'
                      : 'bg-background/60 hover:bg-muted text-muted-foreground border-border/50 hover:text-foreground',
                  )}
                >
                  {cat === 'all'
                    ? t('mcp_category_all', { count: plugins.length })
                    : CATEGORY_LABEL_KEYS[cat]
                      ? t(CATEGORY_LABEL_KEYS[cat])
                      : cat}
                </button>
              )
            })}
          </div>

          {/* 插件卡片网格 */}
          {loading ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>{t('mcp_loading')}</span>
            </div>
          ) : filteredPlugins.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Blocks className="h-5 w-5 opacity-60" />
              <span>
                {plugins.length === 0 ? t('mcp_empty_no_plugins') : t('mcp_empty_category')}
              </span>
              <div className="flex items-center gap-2 mt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => openEditor({ mode: 'create' })}
                  className="h-7 px-2.5 text-[11px] cursor-pointer"
                >
                  {t('mcp_add_plugin')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleRestorePresets()}
                  className="h-7 px-2.5 text-[11px] cursor-pointer"
                >
                  {t('mcp_restore_builtin')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredPlugins.map((plugin) => {
                const isBusy = Boolean(busyPluginIds[plugin.id])
                const toolsCount = plugin.discoveredTools?.length || 0
                const disabledSet = new Set(plugin.disabledTools || [])
                const activeToolsCount = (plugin.discoveredTools || []).filter(
                  (t) => !disabledSet.has(t.name),
                ).length
                const isExpanded = expandedToolsPluginId === plugin.id
                const hasWriteTools = (plugin.discoveredTools || []).some((t) => !t.isReadOnly)

                return (
                  <div
                    key={plugin.id}
                    data-testid={`mcp-plugin-card-${plugin.id}`}
                    className={cn(
                      'p-3 rounded-xl border transition-all flex flex-col justify-between gap-2',
                      plugin.enabled
                        ? 'border-primary/40 bg-primary/5 dark:bg-primary/10 shadow-2xs'
                        : 'border-border/50 bg-background/50 hover:border-border',
                    )}
                  >
                    <div className="space-y-1.5">
                      {/* 第一行：图标、名称、徽章与启停开关 */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-muted/70 border border-border/60 flex items-center justify-center shrink-0">
                            <McpPluginIcon icon={plugin.icon} className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-semibold text-foreground truncate">
                                {plugin.name}
                              </span>
                              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium leading-none">
                                <Sparkles className="h-2.5 w-2.5" />
                                {plugin.transport === 'ssh_native' ? t('mcp_badge_zero_config') : plugin.transport}
                              </span>
                            </div>

                            {/* 状态指示行：真实连接状态与后端错误 */}
                            <div className="flex items-center gap-1.5 mt-1 text-[10.5px]">
                              {isBusy ? (
                                <span className="inline-flex items-center gap-1 text-primary font-medium">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  {t('mcp_status_busy')}
                                </span>
                              ) : plugin.lastError ? (
                                <span className="inline-flex items-center gap-1 text-destructive font-medium break-all">
                                  <AlertCircle className="h-3 w-3 shrink-0" />
                                  {t('mcp_status_error', { error: plugin.lastError })}
                                </span>
                              ) : !plugin.enabled ? (
                                <span className="text-muted-foreground">{t('mcp_status_disabled')}</span>
                              ) : plugin.connected ? (
                                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                                  <CheckCircle2 className="h-3 w-3" />
                                  {t('mcp_status_connected', {
                                    mode: plugin.transport === 'ssh_native' ? t('mcp_mode_ssh') : t('mcp_mode_mcp'),
                                    active: activeToolsCount,
                                    total: toolsCount,
                                  })}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                                  <AlertCircle className="h-3 w-3" />
                                  {t('mcp_status_no_session')}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <Switch
                          data-testid={`mcp-switch-${plugin.id}`}
                          checked={plugin.enabled}
                          disabled={isBusy}
                          onCheckedChange={(checked) => void handleTogglePlugin(plugin, checked)}
                        />
                      </div>

                      {/* 插件功能简介：单行省略，完整说明收进问号 */}
                      <div className="flex items-center gap-1 min-w-0">
                        <p className="text-[11px] text-muted-foreground truncate min-w-0 flex-1">
                          {plugin.description}
                        </p>
                        <HintTooltip
                          label="Plugin description"
                          content={plugin.description}
                          iconClassName="h-3 w-3"
                        />
                      </div>
                    </div>

                    {/* 底部工具抽屉与插件操作 */}
                    <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-border/40 flex-wrap">
                      <span className="text-[10.5px] text-muted-foreground flex items-center gap-1">
                        {hasWriteTools ? (
                          <ShieldAlert className="h-3 w-3 text-amber-500 shrink-0" />
                        ) : (
                          <ShieldCheck className="h-3 w-3 text-emerald-500 shrink-0" />
                        )}
                        <span>{hasWriteTools ? t('mcp_writable') : t('mcp_readonly')}</span>
                        <HintTooltip
                          label="Tool safety"
                          content={hasWriteTools ? t('mcp_has_write_tools') : t('mcp_all_readonly')}
                          iconClassName="h-3 w-3"
                        />
                      </span>

                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          data-testid={`mcp-edit-${plugin.id}`}
                          disabled={isBusy}
                          title={t('mcp_action_edit')}
                          onClick={() => openEditor({ mode: 'edit', plugin })}
                          className="h-6 px-1.5 text-[11px] cursor-pointer text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          data-testid={`mcp-refresh-${plugin.id}`}
                          disabled={isBusy}
                          title={t('mcp_action_refresh')}
                          onClick={() => void handleRefresh(plugin)}
                          className="h-6 px-1.5 text-[11px] cursor-pointer text-muted-foreground hover:text-foreground"
                        >
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          data-testid={`mcp-remove-${plugin.id}`}
                          disabled={isBusy}
                          title={t('mcp_action_remove')}
                          onClick={() => setPendingRemove(plugin)}
                          className="h-6 px-1.5 text-[11px] cursor-pointer text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                        {toolsCount > 0 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            data-testid={`mcp-tools-toggle-${plugin.id}`}
                            title={t('mcp_view_tools', { active: activeToolsCount, total: toolsCount })}
                            onClick={() => setExpandedToolsPluginId(isExpanded ? null : plugin.id)}
                            className="h-6 px-2 text-[11px] gap-1 cursor-pointer text-muted-foreground hover:text-foreground"
                          >
                            <span className="font-mono">{activeToolsCount}/{toolsCount}</span>
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* 展开的工具级开关抽屉 */}
                    {isExpanded && toolsCount > 0 && (
                      <div className="pt-2 border-t border-border/50 space-y-1.5">
                        {plugin.discoveredTools.map((tool: McpToolInfo) => {
                          const isToolEnabled = !disabledSet.has(tool.name)
                          return (
                            <div
                              key={tool.name}
                              className="flex items-center justify-between gap-2 p-2 rounded-lg bg-background/80 border border-border/40 text-[11px]"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono font-medium text-foreground truncate">
                                    {tool.name}
                                  </span>
                                  <span
                                    className={cn(
                                      'inline-flex items-center gap-0.5 text-[9.5px] px-1.5 py-0.2 rounded border',
                                      tool.isReadOnly
                                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
                                    )}
                                  >
                                    {tool.isReadOnly ? <ShieldCheck className="h-2.5 w-2.5" /> : <ShieldAlert className="h-2.5 w-2.5" />}
                                    {tool.isReadOnly ? t('mcp_readonly') : t('mcp_writable')}
                                  </span>
                                </div>
                                {tool.description && (
                                  <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                                    {tool.description}
                                  </p>
                                )}
                              </div>
                              <Switch
                                checked={isToolEnabled}
                                onCheckedChange={(checked) => void handleToggleTool(plugin, tool.name, checked)}
                              />
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <McpPluginEditorDialog
        open={editorOpen}
        target={editorTarget}
        onClose={() => setEditorOpen(false)}
        onSaved={() => void loadData()}
      />

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        title={t('mcp_remove_title')}
        description={t('mcp_remove_desc', { name: pendingRemove?.name || '' })}
        variant="destructive"
        pending={removing}
        onConfirm={() => void handleRemove()}
        onCancel={() => setPendingRemove(null)}
      />
    </>
  )
}
