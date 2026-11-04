/**
 * src/components/layout/ai-mcp-settings-card.tsx
 *
 * 本地 MCP 服务端与客户端授权设置卡片 (Stage S2 Substage 2c)
 * 1. 本地 127.0.0.1:45680 MCP 服务端状态与启停开关
 * 2. 256-bit 高熵 Bearer Token 显示、复制与重新生成
 * 3. 外部 Agent (Cursor / Claude Desktop / Claude Code / VS Code) 客户端接入配置模板生成器
 * 4. 零信任服务器资产白名单授权清单 (S2-6 Authorization & S2-7 Concurrency Lease Monitoring)
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n'
import { useAppStore } from '@/store'
import { backend } from '@/services/api'
import type { McpStatus } from '@/services/api/types'
import {
  Server,
  ShieldCheck,
  ShieldAlert,
  Copy,
  Check,
  RefreshCw,
  Eye,
  EyeOff,
  Radio,
  Search,
  CheckCircle2,
  Lock,
  Cpu,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type ClientSnippetType = 'cursor' | 'claude_desktop' | 'claude_code' | 'vscode'

export function AiMcpSettingsCard() {
  const { t } = useTranslation()
  const { toast } = useToast()

  const servers = useAppStore((s) => s.servers)

  const [status, setStatus] = useState<McpStatus | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [toggling, setToggling] = useState<boolean>(false)
  const [showToken, setShowToken] = useState<boolean>(false)
  const [activeSnippetTab, setActiveSnippetTab] = useState<ClientSnippetType>('cursor')
  const [hostSearch, setHostSearch] = useState<string>('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [isConfirmRegenOpen, setIsConfirmRegenOpen] = useState<boolean>(false)
  const [authorizedIds, setAuthorizedIds] = useState<Set<string>>(new Set())

  // 加载 MCP 服务状态与已授权服务器列表
  const refreshStatus = useCallback(async () => {
    try {
      if (backend?.mcp) {
        const res = await backend.mcp.getStatus()
        setStatus(res)
        setAuthorizedIds(new Set(res.authorizedHostIds || []))
      } else {
        // 开发降级/纯网页模式
        setStatus({
          enabled: false,
          port: 45680,
          endpointUrl: 'http://127.0.0.1:45680/mcp',
          token: 'qshell_mcp_dev_token_placeholder',
          hostCount: 0,
          activeLeases: 0,
          authorizedHostCount: 0,
          authorizedHostIds: [],
        })
      }
    } catch (err) {
      console.warn('[AiMcpSettingsCard] Failed to fetch MCP status:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  // 启停本地 MCP 服务
  const handleToggleEnabled = async (checked: boolean) => {
    if (toggling) return
    setToggling(true)
    try {
      if (backend?.mcp) {
        const newStatus = await backend.mcp.setEnabled(checked)
        setStatus(newStatus)
      } else {
        setStatus((prev) => (prev ? { ...prev, enabled: checked } : null))
      }
      toast.success(checked ? (t('ai_mcp_enable_label') || '本地 MCP 服务已启用') : '本地 MCP 服务已暂停')
    } catch (err) {
      toast.error('操作失败: ' + String(err))
    } finally {
      setToggling(false)
    }
  }

  // 重新生成 Token
  const handleRegenerateToken = async () => {
    try {
      if (backend?.mcp) {
        const newToken = await backend.mcp.regenerateToken()
        setStatus((prev) => (prev ? { ...prev, token: newToken } : null))
      }
      setIsConfirmRegenOpen(false)
      toast.success((t('ai_mcp_token_regen') || '重新生成 Token') + ' 成功')
    } catch (err) {
      toast.error('生成 Token 失败: ' + String(err))
    }
  }

  // 复制文本到剪贴板并展示高亮反馈
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    toast.success(t('ai_mcp_copy_success') || '已复制到剪贴板')
    setTimeout(() => {
      setCopiedKey((curr) => (curr === key ? null : curr))
    }, 2000)
  }

  // 切换单个服务器授权状态
  const handleToggleServerAuth = async (serverId: string) => {
    const nextSet = new Set(authorizedIds)
    if (nextSet.has(serverId)) {
      nextSet.delete(serverId)
    } else {
      nextSet.add(serverId)
    }
    setAuthorizedIds(nextSet)

    const list = Array.from(nextSet)
    try {
      if (backend?.mcp) {
        await backend.mcp.setAuthorizedHosts(list)
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                authorizedHostIds: list,
                authorizedHostCount: list.length,
              }
            : null
        )
      }
    } catch (err) {
      console.error('[AiMcpSettingsCard] Failed to update authorized hosts:', err)
      toast.error('更新服务器授权失败: ' + String(err))
    }
  }

  // 全选所有服务器
  const handleSelectAllServers = async () => {
    const allIds = servers.map((s) => s.id)
    const nextSet = new Set(allIds)
    setAuthorizedIds(nextSet)
    try {
      if (backend?.mcp) {
        await backend.mcp.setAuthorizedHosts(allIds)
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                authorizedHostIds: allIds,
                authorizedHostCount: allIds.length,
              }
            : null
        )
      }
    } catch (err) {
      console.error('[AiMcpSettingsCard] Failed to select all servers:', err)
    }
  }

  // 取消全选服务器
  const handleDeselectAllServers = async () => {
    setAuthorizedIds(new Set())
    try {
      if (backend?.mcp) {
        await backend.mcp.setAuthorizedHosts([])
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                authorizedHostIds: [],
                authorizedHostCount: 0,
              }
            : null
        )
      }
    } catch (err) {
      console.error('[AiMcpSettingsCard] Failed to deselect all servers:', err)
    }
  }

  // 过滤展示服务器
  const filteredServers = useMemo(() => {
    const q = hostSearch.trim().toLowerCase()
    if (!q) return servers
    return servers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        s.username.toLowerCase().includes(q)
    )
  }, [servers, hostSearch])

  // 生成客户端配置文件片段
  const currentEndpoint = status?.endpointUrl || `http://127.0.0.1:${status?.port || 45680}/mcp`
  const currentToken = status?.token || '<QSHELL_MCP_TOKEN>'

  const snippetCode = useMemo(() => {
    switch (activeSnippetTab) {
      case 'cursor':
        return JSON.stringify(
          {
            mcpServers: {
              qshell: {
                url: currentEndpoint,
                headers: {
                  Authorization: `Bearer ${currentToken}`,
                },
              },
            },
          },
          null,
          2
        )
      case 'claude_desktop':
        return JSON.stringify(
          {
            mcpServers: {
              qshell: {
                command: 'node',
                args: ['packages/qshell-mcp/dist/index.js'],
                env: {
                  QSHELL_MCP_TOKEN: currentToken,
                },
              },
            },
          },
          null,
          2
        )
      case 'claude_code':
        return `claude mcp add qshell node "packages/qshell-mcp/dist/index.js" --env QSHELL_MCP_TOKEN="${currentToken}"`
      case 'vscode':
        return JSON.stringify(
          {
            mcpServers: {
              qshell: {
                url: currentEndpoint,
                headers: {
                  Authorization: `Bearer ${currentToken}`,
                },
              },
            },
          },
          null,
          2
        )
    }
  }, [activeSnippetTab, currentEndpoint, currentToken])

  const authorizedCount = authorizedIds.size
  const totalCount = servers.length

  return (
    <Card className="border border-border/60 bg-muted/15 dark:bg-card/40 rounded-xl overflow-hidden shadow-2xs">
      <CardContent className="p-5 space-y-5">
        {/* 头部标题与 127.0.0.1 闭环徽标 */}
        <div className="font-semibold text-xs text-foreground flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-primary animate-pulse" />
            <span className="text-sm font-bold tracking-tight">
              {t('ai_mcp_title') || '本地 MCP 服务端与客户端授权'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {status?.activeLeases ? (
              <span className="text-[10px] text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                <Cpu className="h-3 w-3" />
                {t('ai_mcp_active_leases')}: {status.activeLeases}
              </span>
            ) : null}
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
              <ShieldCheck className="h-3 w-3" />
              {t('ai_mcp_badge_ready') || '127.0.0.1 闭环'}
            </span>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {t('ai_mcp_desc') ||
            'Qshell 原生集成标准 Model Context Protocol (MCP) 服务端，支持 Cursor、Claude Desktop、VS Code、Claude Code 等外部 Agent 跨进程调用已授权服务器的巡检与只读命令执行。'}
        </p>

        {/* 1. 服务启停开关 */}
        <div className="flex items-center justify-between p-3.5 rounded-lg border border-border/50 bg-background/50">
          <div className="space-y-0.5 pr-4">
            <div className="text-xs font-semibold text-foreground flex items-center gap-2">
              <span>{t('ai_mcp_enable_label') || '启用本地 MCP 服务'}</span>
              {status?.enabled ? (
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium font-mono">
                  ● 运行中 (:45680)
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground font-mono">
                  ○ 已停止
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {t('ai_mcp_enable_desc') ||
                '开启后仅监听本机 127.0.0.1:45680 端口，严格杜绝局域网与公网暴露，提供零信任原生安全防护。'}
            </p>
          </div>
          <Switch
            checked={!!status?.enabled}
            disabled={loading || toggling}
            onCheckedChange={handleToggleEnabled}
          />
        </div>

        {/* 2. 端点与 Token 信息区 (仅在启用时展示) */}
        {status?.enabled && (
          <div className="space-y-3.5 p-3.5 rounded-lg border border-border/50 bg-background/50 animate-in fade-in duration-200">
            {/* Endpoint */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-foreground block">
                {t('ai_mcp_endpoint_label') || 'HTTP JSON-RPC 端点'}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={currentEndpoint}
                  className="font-mono text-xs bg-muted/30 h-8 border-border/60 select-all"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2.5 text-xs shrink-0 cursor-pointer gap-1"
                  onClick={() => handleCopy(currentEndpoint, 'endpoint')}
                >
                  {copiedKey === 'endpoint' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>{copiedKey === 'endpoint' ? '已复制' : '复制'}</span>
                </Button>
              </div>
            </div>

            {/* Bearer Token */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-foreground">
                  {t('ai_mcp_token_label') || 'Bearer 鉴权令牌 (Token)'}
                </label>
                <button
                  type="button"
                  onClick={() => setIsConfirmRegenOpen(true)}
                  className="text-[11px] text-primary hover:underline flex items-center gap-1 cursor-pointer font-medium"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>{t('ai_mcp_token_regen') || '重新生成 Token'}</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    readOnly
                    type={showToken ? 'text' : 'password'}
                    value={currentToken}
                    className="font-mono text-xs bg-muted/30 h-8 border-border/60 pr-8 select-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                    title={showToken ? (t('ai_mcp_token_hide') || '隐藏 Token') : (t('ai_mcp_token_show') || '显示 Token')}
                  >
                    {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2.5 text-xs shrink-0 cursor-pointer gap-1"
                  onClick={() => handleCopy(currentToken, 'token')}
                >
                  {copiedKey === 'token' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>{copiedKey === 'token' ? '已复制' : '复制'}</span>
                </Button>
              </div>
            </div>

            {/* 3. 客户端快速接入片段生成器 */}
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-foreground">
                  {t('ai_mcp_client_config_title') || '外部 MCP 客户端接入配置'}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  直接粘贴至对应 Agent 工具配置即可
                </span>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-1 border-b border-border/50 pb-1">
                {(
                  [
                    { id: 'cursor', label: t('ai_mcp_client_cursor') || 'Cursor' },
                    { id: 'claude_desktop', label: t('ai_mcp_client_claude_desktop') || 'Claude Desktop' },
                    { id: 'claude_code', label: t('ai_mcp_client_claude_code') || 'Claude Code' },
                    { id: 'vscode', label: t('ai_mcp_client_vscode') || 'VS Code / Cline' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveSnippetTab(tab.id)}
                    className={cn(
                      'px-2.5 py-1 text-xs rounded-md transition-all cursor-pointer font-medium',
                      activeSnippetTab === tab.id
                        ? 'bg-primary text-primary-foreground shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Code Snippet Box */}
              <div className="relative rounded-lg bg-zinc-950 p-3 font-mono text-[11px] text-zinc-100 overflow-x-auto border border-border/40">
                <pre className="whitespace-pre">{snippetCode}</pre>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="absolute top-2 right-2 h-7 px-2 text-[10.5px] cursor-pointer bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 gap-1"
                  onClick={() => handleCopy(snippetCode, 'snippet')}
                >
                  {copiedKey === 'snippet' ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  <span>{copiedKey === 'snippet' ? '已复制' : t('ai_mcp_copy_snippet') || '复制配置'}</span>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* 4. 零信任服务器资产白名单授权 (S2-6) */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-primary" />
                <span>{t('ai_mcp_hosts_title') || '零信任服务器白名单授权'}</span>
                <span className="text-[10.5px] font-mono text-primary font-bold ml-1">
                  ({authorizedCount} / {totalCount})
                </span>
              </div>
              <p className="text-[10.5px] text-muted-foreground">
                {t('ai_mcp_hosts_desc') ||
                  '外部 Agent（如 Cursor / Claude）仅能探查和连接在此勾选授权的服务器。未授权的服务器请求将被零信任安全网关立即阻断并返回 unknown-host。'}
              </p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-primary hover:bg-primary/10 cursor-pointer"
                onClick={handleSelectAllServers}
                disabled={totalCount === 0}
              >
                {t('ai_mcp_hosts_select_all') || '全选'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:bg-muted cursor-pointer"
                onClick={handleDeselectAllServers}
                disabled={authorizedCount === 0}
              >
                {t('ai_mcp_hosts_deselect_all') || '取消全选'}
              </Button>
            </div>
          </div>

          {/* 搜索框 (如果服务器大于 3 台) */}
          {totalCount > 3 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={hostSearch}
                onChange={(e) => setHostSearch(e.target.value)}
                placeholder={t('ai_mcp_hosts_search_placeholder') || '搜索服务器名称、IP 或主机名...'}
                className="pl-8 h-8 text-xs bg-background/50 border-border/50"
              />
            </div>
          )}

          {/* 服务器列表 */}
          {totalCount === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground border border-dashed border-border/60 rounded-lg">
              {t('ai_mcp_hosts_empty') || '暂无服务器资产，请先在资产列表中添加服务器。'}
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1 divide-y divide-border/20 border border-border/50 rounded-lg p-2 bg-background/40">
              {filteredServers.map((server) => {
                const isAuth = authorizedIds.has(server.id)
                return (
                  <label
                    key={server.id}
                    className={cn(
                      'flex items-center justify-between p-2 rounded-md transition-colors cursor-pointer select-none text-xs',
                      isAuth
                        ? 'bg-primary/5 hover:bg-primary/10 border border-primary/20'
                        : 'hover:bg-muted/30 border border-transparent'
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <input
                        type="checkbox"
                        checked={isAuth}
                        onChange={() => handleToggleServerAuth(server.id)}
                        className="rounded border-border/80 text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer"
                      />
                      <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate flex items-center gap-1.5">
                          <span>{server.name}</span>
                          <span className="text-[10px] text-muted-foreground font-mono font-normal">
                            ({server.username}@{server.host}:{server.port})
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center">
                      {isAuth ? (
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          {t('ai_mcp_host_authorized') || '已授权'}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full font-normal">
                          {t('ai_mcp_host_unauthorized') || '未授权'}
                        </span>
                      )}
                    </div>
                  </label>
                )
              })}
            </div>
          )}

          {authorizedCount === 0 && totalCount > 0 && (
            <p className="text-[10.5px] text-amber-500/90 font-medium flex items-center gap-1 pt-0.5">
              <ShieldAlert className="h-3 w-3 shrink-0" />
              <span>{t('ai_mcp_hosts_none_selected') || '未授权任何服务器（外部 MCP 客户端将无法探查或调用任何主机）'}</span>
            </p>
          )}
        </div>
      </CardContent>

      {/* 重新生成 Token 确认弹窗 */}
      <ConfirmDialog
        open={isConfirmRegenOpen}
        title={t('ai_mcp_token_regen_confirm_title') || '重新生成 MCP 访问令牌？'}
        description={
          t('ai_mcp_token_regen_confirm_desc') ||
          '重新生成后，旧令牌将立即失效。所有已配置此 Token 的外部 MCP 客户端（如 Cursor、Claude Desktop）需要同步更新配置方可继续调用。'
        }
        onConfirm={handleRegenerateToken}
        onCancel={() => setIsConfirmRegenOpen(false)}
      />
    </Card>
  )
}
