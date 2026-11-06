/**
 * MCP 插件新增 / 编辑对话框
 *
 * - 支持标准 Stdio / Streamable HTTP / SSE 三类自定义插件
 * - 内置 ssh_native 插件只允许修改展示信息，禁止注入启动命令或改传输方式
 * - 已保存凭据由后端以占位符回传，保留占位符即表示不修改真实值
 */

import React, { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  backend,
  type McpPluginConfigInput,
  type McpPluginView,
  type McpTestConnectionResult,
} from '@/services/api'
import { AlertCircle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation, translate } from '@/i18n'

/** 与 Rust 端 mcp_client::SECRET_PLACEHOLDER 保持一致 */
export const SECRET_PLACEHOLDER = '__QSHELL_SECRET_UNCHANGED__'

export interface McpEditorTarget {
  mode: 'create' | 'edit'
  plugin?: McpPluginView
}

interface McpPluginEditorDialogProps {
  open: boolean
  target: McpEditorTarget
  onClose: () => void
  onSaved: () => void
}

type Transport = 'stdio' | 'http' | 'sse' | 'ssh_native'

interface FormState {
  id: string
  name: string
  description: string
  icon: string
  category: string
  enabled: boolean
  transport: Transport
  command: string
  argsText: string
  url: string
  envText: string
  headersText: string
}

function mapToText(record: Record<string, string> | undefined): string {
  if (!record) return ''
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

function parseText(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    if (!key) continue
    result[key] = line.slice(idx + 1).trim()
  }
  return result
}

function buildInitialForm(target: McpEditorTarget): FormState {
  const p = target.plugin
  const isBuiltin = p?.transport === 'ssh_native'
  return {
    id: p?.id || '',
    name: p?.name || '',
    description: p?.description || '',
    icon: p?.icon || 'custom',
    category: p?.category || 'custom',
    enabled: p?.enabled ?? true,
    transport: (p?.transport === 'ssh_native' || p?.transport === 'http' || p?.transport === 'sse') ? p.transport : 'stdio',
    command: p?.command || '',
    argsText: (p?.args || []).join('\n'),
    url: p?.url || '',
    envText: mapToText(p?.env),
    headersText: mapToText(p?.headers),
  }
}

const FIELD_CLASS =
  'h-8 w-full rounded-md border border-border/60 bg-background/70 px-2.5 text-xs text-foreground outline-none focus:border-primary/60'

export function McpPluginEditorDialog({
  open,
  target,
  onClose,
  onSaved,
}: McpPluginEditorDialogProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState<FormState>(() => buildInitialForm(target))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<McpTestConnectionResult | null>(null)

  useEffect(() => {
    if (open) {
      setForm(buildInitialForm(target))
      setError(null)
      setTestResult(null)
      setBusy(false)
    }
  }, [open, target])

  const isBuiltin = form.transport === 'ssh_native'
  const isEdit = target.mode === 'edit'

  const patch = (changes: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...changes }))
    setTestResult(null)
  }

  const config = useMemo<McpPluginConfigInput>(() => {
    const p = target.plugin
    return {
      id: form.id.trim(),
      name: form.name.trim(),
      description: form.description.trim(),
      icon: form.icon.trim() || 'custom',
      category: form.category.trim() || 'custom',
      enabled: form.enabled,
      transport: form.transport,
      command: form.transport === 'stdio' ? form.command.trim() : null,
      args: form.argsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      url: form.transport === 'http' || form.transport === 'sse' ? form.url.trim() : null,
      env: parseText(form.envText),
      headers: parseText(form.headersText),
      disabledTools: p?.disabledTools || [],
      discoveredTools: p?.discoveredTools || [],
      isPreset: p?.isPreset || false,
      presetId: p?.presetId || null,
      lastConnectedAt: p?.lastConnectedAt || null,
      lastError: p?.lastError || null,
    }
  }, [form, target.plugin])

  const validate = (): string | null => {
    if (!config.name) return translate('mcp_editor_err_name')
    if (isBuiltin) return null
    if (form.transport === 'stdio' && !config.command) return translate('mcp_editor_err_command')
    if ((form.transport === 'http' || form.transport === 'sse') && !config.url) {
      return translate('mcp_editor_err_url')
    }
    if (config.url && !/^https?:\/\//i.test(config.url)) {
      return translate('mcp_editor_err_url_scheme')
    }
    return null
  }

  const handleSave = async () => {
    const invalid = validate()
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (!backend?.mcpClient?.upsertPlugin) {
        throw new Error(translate('mcp_engine_unavailable'))
      }
      await backend.mcpClient.upsertPlugin(config)
      onSaved()
      onClose()
    } catch (err: unknown) {
      setError((err as Error)?.message || translate('mcp_unknown_error'))
    } finally {
      setBusy(false)
    }
  }

  const handleTest = async () => {
    const invalid = validate()
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    setError(null)
    setTestResult(null)
    try {
      if (!backend?.mcpClient?.testConnection) {
        throw new Error(translate('mcp_engine_unavailable'))
      }
      setTestResult(await backend.mcpClient.testConnection(config))
    } catch (err: unknown) {
      setError((err as Error)?.message || translate('mcp_unknown_error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-[620px] p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/50">
          <DialogTitle className="text-sm font-semibold">
            {isEdit ? t('mcp_editor_title_edit') : t('mcp_editor_title_create')}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground leading-relaxed">
            {isBuiltin ? t('mcp_editor_desc_builtin') : t('mcp_editor_desc_custom')}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-3 max-h-[62vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">
                {t('mcp_editor_id')} {isEdit ? t('mcp_editor_id_readonly') : t('mcp_editor_id_auto')}
              </span>
              <Input
                className={FIELD_CLASS}
                value={form.id}
                disabled={isEdit}
                placeholder={t('mcp_editor_id_placeholder')}
                onChange={(e) => patch({ id: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">{t('mcp_editor_name')}</span>
              <Input
                className={FIELD_CLASS}
                value={form.name}
                placeholder={t('mcp_editor_name_placeholder')}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-[11px] text-muted-foreground">{t('mcp_editor_description')}</span>
            <Input
              className={FIELD_CLASS}
              value={form.description}
              placeholder={t('mcp_editor_description_placeholder')}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">{t('mcp_editor_category')}</span>
              <Input
                className={FIELD_CLASS}
                value={form.category}
                placeholder="container / application / system / custom"
                onChange={(e) => patch({ category: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">{t('mcp_editor_transport')}</span>
              <select
                className={FIELD_CLASS}
                value={form.transport}
                disabled={isBuiltin}
                onChange={(e) => patch({ transport: e.target.value as Transport })}
              >
                <option value="stdio">{t('mcp_editor_transport_stdio')}</option>
                <option value="http">{t('mcp_editor_transport_http')}</option>
                <option value="sse">{t('mcp_editor_transport_sse')}</option>
                {isBuiltin && <option value="ssh_native">{t('mcp_editor_transport_builtin')}</option>}
              </select>
            </label>
          </div>

          {form.transport === 'stdio' && (
            <>
              <label className="block space-y-1">
                <span className="text-[11px] text-muted-foreground">{t('mcp_editor_command')}</span>
                <Input
                  className={FIELD_CLASS}
                  value={form.command}
                  placeholder={t('mcp_editor_command_placeholder')}
                  onChange={(e) => patch({ command: e.target.value })}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] text-muted-foreground">{t('mcp_editor_args')}</span>
                <textarea
                  className={cn(FIELD_CLASS, 'h-16 py-1.5 resize-y font-mono')}
                  value={form.argsText}
                  placeholder={'-y\n@example/server'}
                  onChange={(e) => patch({ argsText: e.target.value })}
                />
              </label>
            </>
          )}

          {(form.transport === 'http' || form.transport === 'sse') && (
            <label className="block space-y-1">
              <span className="text-[11px] text-muted-foreground">{t('mcp_editor_url')}</span>
              <Input
                className={FIELD_CLASS}
                value={form.url}
                placeholder="https://mcp.example.com/mcp"
                onChange={(e) => patch({ url: e.target.value })}
              />
            </label>
          )}

          {!isBuiltin && (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">{t('mcp_editor_env')}</span>
                <textarea
                  className={cn(FIELD_CLASS, 'h-20 py-1.5 resize-y font-mono')}
                  value={form.envText}
                  placeholder="API_TOKEN=xxx"
                  onChange={(e) => patch({ envText: e.target.value })}
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">{t('mcp_editor_headers')}</span>
                <textarea
                  className={cn(FIELD_CLASS, 'h-20 py-1.5 resize-y font-mono')}
                  value={form.headersText}
                  placeholder="Authorization=Bearer xxx"
                  onChange={(e) => patch({ headersText: e.target.value })}
                />
              </label>
            </div>
          )}

          {!isBuiltin && isEdit && (
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {t('mcp_editor_secret_hint', { placeholder: SECRET_PLACEHOLDER })}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
            <span className="text-[11px] text-muted-foreground">{t('mcp_editor_enable_hint')}</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-foreground">{t('mcp_editor_enable')}</span>
              <Switch checked={form.enabled} onCheckedChange={(checked) => patch({ enabled: checked })} />
            </div>
          </div>

          {busy && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg border border-border/50 bg-muted/40 text-[11px] text-muted-foreground">
              <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
              <span>{t('mcp_editor_wait_hint')}</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/25 text-destructive text-xs">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 whitespace-pre-wrap break-all leading-relaxed">{error}</span>
            </div>
          )}

          {testResult && (
            <div
              className={cn(
                'flex items-start gap-2 p-2.5 rounded-lg border text-xs',
                testResult.success
                  ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400'
                  : 'bg-destructive/10 border-destructive/25 text-destructive',
              )}
            >
              {testResult.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              )}
              <span className="flex-1 whitespace-pre-wrap break-all leading-relaxed">
                {testResult.success
                  ? t('mcp_editor_test_success', {
                      server: testResult.serverName || 'MCP Server',
                      count: testResult.tools.length,
                      ms: testResult.latencyMs,
                    })
                  : t('mcp_editor_test_failed', {
                      error: testResult.error || t('mcp_unknown_error'),
                    })}
              </span>
            </div>
          )}

          {!isBuiltin && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-700 dark:text-amber-400">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{t('mcp_editor_warning')}</span>
            </div>
          )}
        </div>

        <DialogFooter className="px-5 py-3 border-t border-border/50 flex-row items-center justify-end gap-2">
          {!isBuiltin && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void handleTest()}
              className="h-8 text-[11px] cursor-pointer"
            >
              {t('mcp_editor_test')}
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={onClose} className="h-8 text-[11px] cursor-pointer">
            {t('mcp_editor_cancel')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void handleSave()}
            className="h-8 text-[11px] cursor-pointer"
          >
            {busy && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            {t('mcp_editor_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
