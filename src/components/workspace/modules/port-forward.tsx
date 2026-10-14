/**
 * 端口转发监控面板
 *
 * 展示当前服务器所有端口转发的运行状态：
 * - 隧道自动启动的转发（来源标识 "tunnel:{隧道名}"）
 * - 其他运行中的转发（手动通过 API 添加）
 *
 * 支持单个停止 / 全部停止 / 刷新。
 * 转发规则（-L/-R/-D）的配置入口在「隧道管理」，本面板只做运行时监控。
 */

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { backend } from '@/services/api'
import { useTranslation } from '@/i18n'
import { useAppStore } from '@/store'
import { extractBaseServerId } from '@/services/ssh-connection-state'
import {
  RefreshCw,
  Square,
  Trash2,
  ArrowLeftRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Waypoints,
  Info,
  RotateCcw,
} from 'lucide-react'
import type { ForwardInfo, OperationResult } from '@/services/api/types'
import { cn } from '@/lib/utils'

interface PortForwardModuleProps {
  serverId: string
  hideToolbarHeader?: boolean
}

export function PortForwardModule({ serverId, hideToolbarHeader }: PortForwardModuleProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const baseServerId = extractBaseServerId(serverId)
  const server = useAppStore((s) => s.servers.find((sv) => sv.id === baseServerId))

  const [forwards, setForwards] = useState<ForwardInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [stoppingId, setStoppingId] = useState<string | null>(null)
  const [restartingId, setRestartingId] = useState<string | null>(null)
  const [stoppingAll, setStoppingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchForwards = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (!backend) throw new Error('backend not available')
      const list = await backend.portForward.list(serverId)
      setForwards(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pf_err_load'))
    } finally {
      setLoading(false)
    }
  }, [serverId, t])

  useEffect(() => {

    fetchForwards()
  }, [fetchForwards])

  // 启动时 + 每 5 秒轮询，更新状态
  useEffect(() => {
    const id = setInterval(() => {
      void fetchForwards()
    }, 5000)
    return () => clearInterval(id)
  }, [fetchForwards])

  const handleStop = async (id: string) => {
    if (!backend) return
    setStoppingId(id)
    try {
      const result: OperationResult = await backend.portForward.stop(id)
      if (!result.success) {
        toast.error(`${t('pf_stop_failed')}: ${result.error || ''}`)
      } else {
        await fetchForwards()
      }
    } finally {
      setStoppingId(null)
    }
  }

  const handleStopAll = async () => {
    if (!backend) return
    setStoppingAll(true)
    try {
      await backend.portForward.stopAll(serverId)
      await fetchForwards()
    } finally {
      setStoppingAll(false)
    }
  }

  const handleRestart = async (id: string) => {
    if (!backend) return
    setRestartingId(id)
    try {
      const result = await backend.portForward.restart(id)
      if (!result.success) {
        toast.error(`${t('pf_restart_failed')}: ${result.error || ''}`)
      }
      await fetchForwards()
    } finally {
      setRestartingId(null)
    }
  }

  return (
    <div className="flex flex-col h-full bg-transparent">
      {/* 独立模式下的 Toolbar */}
      {!hideToolbarHeader && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-card">
          <ArrowLeftRight className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{t('pf_title')}</span>
          {server && (
            <span className="text-xs text-muted-foreground">
              {server.name} ({server.host})
            </span>
          )}
          <div className="flex-1" />
          <Button onClick={fetchForwards} disabled={loading} size="sm" variant="outline" className="gap-1 h-7 text-xs">
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
            {t('pf_refresh')}
          </Button>
          <Button
            onClick={handleStopAll}
            disabled={stoppingAll || forwards.length === 0}
            size="sm"
            variant="outline"
            className="gap-1 h-7 text-xs text-destructive hover:text-destructive"
          >
            {stoppingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            {t('pf_stop_all')}
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* 面板定位说明 */}
        <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>{t('pf_monitor_hint')}</span>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* 转发列表 */}
        <div className="rounded-md border border-border/60 bg-card overflow-hidden">
          <div className="px-3 py-2 border-b border-border/60 bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{t('pf_list_title')}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-primary/10 text-primary font-semibold tabular-nums">
                {forwards.length}
              </span>
            </div>
            {hideToolbarHeader && (
              <div className="flex items-center gap-1.5">
                <Button onClick={fetchForwards} disabled={loading} size="sm" variant="ghost" className="gap-1 h-6 px-2 text-xs">
                  <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
                  {t('pf_refresh')}
                </Button>
                <Button
                  onClick={handleStopAll}
                  disabled={stoppingAll || forwards.length === 0}
                  size="sm"
                  variant="ghost"
                  className="gap-1 h-6 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  {stoppingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  {t('pf_stop_all')}
                </Button>
              </div>
            )}
          </div>
          {forwards.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              {t('pf_empty')}
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {forwards.map((f) => (
                <ForwardRow
                  key={f.id}
                  forward={f}
                  onStop={handleStop}
                  onRestart={handleRestart}
                  stopping={stoppingId === f.id}
                  restarting={restartingId === f.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ForwardRow({
  forward,
  onStop,
  onRestart,
  stopping,
  restarting,
}: {
  forward: ForwardInfo
  onStop: (id: string) => void
  onRestart: (id: string) => void
  stopping: boolean
  restarting: boolean
}) {
  const { t } = useTranslation()
  const kindLabel = forward.kind === 'local' ? t('pf_kind_local')
    : forward.kind === 'remote' ? t('pf_kind_remote')
    : t('pf_kind_dynamic')

  // 来源解析："tunnel:{name}" → 隧道名；无 source → 手动/其他入口添加
  const tunnelName = forward.source?.startsWith('tunnel:')
    ? forward.source.slice('tunnel:'.length)
    : null

  const stateInfo = (() => {
    switch (forward.state) {
      case 'active':
        return { icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />, label: t('pf_state_active'), color: 'text-emerald-500' }
      case 'starting':
        return { icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />, label: t('pf_state_starting'), color: 'text-amber-500' }
      case 'stopping':
        return { icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />, label: t('pf_state_stopping'), color: 'text-muted-foreground' }
      case 'failed':
        return { icon: <XCircle className="h-3.5 w-3.5 text-red-500" />, label: t('pf_state_failed'), color: 'text-red-500' }
      case 'stopped':
        return { icon: <Square className="h-3.5 w-3.5 text-muted-foreground" />, label: t('pf_state_stopped'), color: 'text-muted-foreground' }
    }
  })()

  const desc = forward.kind === 'dynamic'
    ? `${forward.localHost}:${forward.boundPort} → SOCKS5`
    : forward.kind === 'local'
      ? `${forward.localHost}:${forward.boundPort} → ${forward.remoteHost}:${forward.remotePort}`
      : `${forward.remoteHost}:${forward.remotePort} ← ${forward.localHost}:${forward.localPort}`

  return (
    <div className="px-3 py-2 flex items-center gap-2">
      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground flex-shrink-0">
        {forward.kind === 'local' ? 'L' : forward.kind === 'remote' ? 'R' : 'D'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{desc}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={cn('flex items-center gap-1 text-[10px]', stateInfo.color)}>
            {stateInfo.icon}
            {stateInfo.label}
          </span>
          <span className="text-[10px] text-muted-foreground">{kindLabel}</span>
          {tunnelName && (
            <span
              className="inline-flex items-center gap-1 text-[10px] text-primary truncate max-w-40"
              title={tunnelName}
            >
              <Waypoints className="h-3 w-3 flex-shrink-0" />
              {tunnelName}
            </span>
          )}
          {forward.lastError && (
            <span className="text-[10px] text-red-500 truncate" title={forward.lastError}>
              {forward.lastError}
            </span>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs gap-1 text-destructive hover:text-destructive flex-shrink-0"
        onClick={() => onStop(forward.id)}
        disabled={stopping || forward.state === 'stopping' || forward.state === 'stopped'}
      >
        {stopping ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
        {t('pf_stop')}
      </Button>
      {(forward.state === 'failed' || forward.state === 'stopped') && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1 flex-shrink-0"
          onClick={() => onRestart(forward.id)}
          disabled={restarting}
        >
          {restarting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          {t('pf_restart')}
        </Button>
      )}
    </div>
  )
}
