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
import { useTranslation, translate } from '@/i18n'
import {
  backend,
  type McpPluginView,
  type McpToolInfo,
} from '@/services/api'
import {
  Blocks,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Globe,
  Cpu,
  Container,
  Coffee,
  Wrench,
  Plus,
  Pencil,
  RefreshCw,
  Trash2,
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
  const [loading, setLoading] = useState<boolean>(true)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [expandedToolsPluginId, setExpandedToolsPluginId] = useState<string | null>(null)
  const [busyPluginIds, setBusyPluginIds] = useState<Record<string, boolean>>({})
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorTarget, setEditorTarget] = useState<McpEditorTarget>({ mode: 'create' })
  const [pendingRemove, setPendingRemove] = useState<McpPluginView | null>(null)
  const [removing, setRemoving] = useState(false)

  const { t } = useTranslation()

  const loadData = useCallback(async () => {
    setLoading(true)
    setGlobalError(null)
    try {
      const mcp = backend?.mcpClient
      if (!mcp?.listPlugins) {
        throw new Error(translate('mcp_engine_unavailable'))
      }
      const pluginList = await mcp.listPlugins()
      setPlugins(Array.isArray(pluginList) ? pluginList : [])
    } catch (err: unknown) {
      setGlobalError((err as Error)?.message || translate('mcp_unknown_error'))
      setPlugins([])
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
        className="overflow-hidden rounded-xl border border-border/60 bg-background shadow-none"
      >
        <CardContent className="p-4 space-y-4">
          {/* 标题与操作：全部收在顶栏一行 */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Blocks className="h-4 w-4 text-primary shrink-0" />
              <span className="text-xs font-semibold text-foreground" title={t('mcp_hub_intro')}>
                {t('mcp_hub_title')}
              </span>
              <span className="text-[11px] text-muted-foreground truncate">
                {t('mcp_stats', {
                  enabled: stats.enabledCount,
                  total: plugins.length,
                  connected: stats.connectedCount,
                  tools: stats.activeToolCount,
                })}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                data-testid="mcp-add-plugin-btn"
                onClick={() => openEditor({ mode: 'create' })}
                className="h-7 px-2.5 text-xs gap-1 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{t('mcp_add_plugin')}</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid="mcp-restore-presets-btn"
                onClick={() => void handleRestorePresets()}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                title={t('mcp_restore_defaults_hint')}
              >
                <span>{t('mcp_restore_defaults')}</span>
              </Button>
            </div>
          </div>

          {/* 错误横幅提示 */}
          {globalError && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/25 text-destructive text-xs">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="flex-1 break-all">{globalError}</span>
            </div>
          )}

          {/* 分类筛选：轻量文字标签页 */}
          <div className="flex flex-wrap items-center gap-4 border-b border-border/50">
            {categories.map((cat) => {
              const active = selectedCategory === cat
              return (
                <button
                  key={cat}
                  type="button"
                  data-testid={`mcp-cat-${cat}`}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    '-mb-px border-b-2 pb-2 pt-1 text-xs transition-colors cursor-pointer',
                    active
                      ? 'border-primary font-medium text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
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

          {/* 插件列表 */}
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
            <div className="divide-y divide-border/50">
              {filteredPlugins.map((plugin) => {
                const isBusy = Boolean(busyPluginIds[plugin.id])
                const toolsCount = plugin.discoveredTools?.length || 0
                const disabledSet = new Set(plugin.disabledTools || [])
                const activeToolsCount = (plugin.discoveredTools || []).filter(
                  (t) => !disabledSet.has(t.name),
                ).length
                const isExpanded = expandedToolsPluginId === plugin.id
                const hasWriteTools = (plugin.discoveredTools || []).some((t) => !t.isReadOnly)
                // builtin-* 才是内置预置插件；isPreset 也会用于「用户基于模板创建」的插件，不能据此判断
                const isBuiltin = plugin.id.startsWith('builtin-')
                const state = isBusy
                  ? { label: t('mcp_state_busy'), dot: 'bg-primary', detail: t('mcp_status_busy') }
                  : plugin.lastError
                    ? { label: t('mcp_state_error'), dot: 'bg-destructive', detail: t('mcp_status_error', { error: plugin.lastError }) }
                    : !plugin.enabled
                      ? { label: t('mcp_state_disabled'), dot: 'bg-muted-foreground/50', detail: t('mcp_status_disabled') }
                      : plugin.connected
                        ? {
                            label: t('mcp_state_connected'),
                            dot: 'bg-emerald-500',
                            detail: t('mcp_status_connected', {
                              mode: plugin.transport === 'ssh_native' ? t('mcp_mode_ssh') : t('mcp_mode_mcp'),
                              active: activeToolsCount,
                              total: toolsCount,
                            }),
                          }
                        : { label: t('mcp_state_offline'), dot: 'bg-amber-500', detail: t('mcp_status_no_session') }

                return (
                  <div
                    key={plugin.id}
                    data-testid={`mcp-plugin-card-${plugin.id}`}
                    className={cn('group', !plugin.enabled && 'opacity-60')}
                  >
                    <div className="flex items-center gap-3 py-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                        <McpPluginIcon icon={plugin.icon} className="h-4 w-4" />
                      </div>

                      {/* 名称 + 状态点 + 一行简介 */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-foreground">
                            {plugin.name}
                          </span>
                          <span
                            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', state.dot)}
                            title={state.detail}
                          />
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {state.label}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground" title={plugin.description}>
                          {plugin.description}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {toolsCount > 0 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            data-testid={`mcp-tools-toggle-${plugin.id}`}
                            title={`${t('mcp_view_tools', { active: activeToolsCount, total: toolsCount })} · ${hasWriteTools ? t('mcp_has_write_tools') : t('mcp_all_readonly')}`}
                            onClick={() => setExpandedToolsPluginId(isExpanded ? null : plugin.id)}
                            className="h-7 px-2 text-[11px] gap-1 cursor-pointer text-muted-foreground hover:text-foreground"
                          >
                            <span className="font-mono">{activeToolsCount}/{toolsCount}</span>
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </Button>
                        )}

                        {/* 编辑 / 刷新 / 删除：平时隐藏，悬停或键盘聚焦时出现；内置预置插件不允许编辑与删除 */}
                        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          {!isBuiltin && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              data-testid={`mcp-edit-${plugin.id}`}
                              disabled={isBusy}
                              title={t('mcp_action_edit')}
                              onClick={() => openEditor({ mode: 'edit', plugin })}
                              className="h-7 px-1.5 cursor-pointer text-muted-foreground hover:text-foreground"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            data-testid={`mcp-refresh-${plugin.id}`}
                            disabled={isBusy}
                            title={t('mcp_action_refresh')}
                            onClick={() => void handleRefresh(plugin)}
                            className="h-7 px-1.5 cursor-pointer text-muted-foreground hover:text-foreground"
                          >
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                          {!isBuiltin && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              data-testid={`mcp-remove-${plugin.id}`}
                              disabled={isBusy}
                              title={t('mcp_action_remove')}
                              onClick={() => setPendingRemove(plugin)}
                              className="h-7 px-1.5 cursor-pointer text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>

                        <Switch
                          data-testid={`mcp-switch-${plugin.id}`}
                          checked={plugin.enabled}
                          disabled={isBusy}
                          onCheckedChange={(checked) => void handleTogglePlugin(plugin, checked)}
                        />
                      </div>
                    </div>

                    {/* 展开的工具级开关 */}
                    {isExpanded && toolsCount > 0 && (
                      <div className="space-y-0.5 pb-3 pl-11">
                        {plugin.discoveredTools.map((tool: McpToolInfo) => {
                          const isToolEnabled = !disabledSet.has(tool.name)
                          return (
                            <div
                              key={tool.name}
                              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={cn(
                                      'h-1.5 w-1.5 shrink-0 rounded-full',
                                      tool.isReadOnly ? 'bg-emerald-500' : 'bg-amber-500',
                                    )}
                                    title={tool.isReadOnly ? t('mcp_all_readonly') : t('mcp_has_write_tools')}
                                  />
                                  <span className="truncate font-mono text-[11px] text-foreground">
                                    {tool.name}
                                  </span>
                                </div>
                                {tool.description && (
                                  <p className="truncate pl-3 text-[11px] text-muted-foreground">
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
