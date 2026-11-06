import React, { memo, useEffect, useMemo } from 'react'
import { QshellLoader } from '@/components/ui/qshell-loader'
import { Button } from '@/components/ui/button'
import { RotateCcw, Settings2 } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { friendlyError } from '@/lib/error-messages'
import type { Server } from '@/types'

export interface TerminalConnectionOverlayProps {
  status: 'connecting' | 'connected' | 'error' | 'disconnected' | 'reconnecting'
  error?: string
  reconnectAttempt?: number
  server?: Server | null
  termName?: string
  onReconnect: () => void
  onEditServer?: () => void
  onCancel?: () => void
}

export const TerminalConnectionOverlay = memo(function TerminalConnectionOverlay({
  status,
  error,
  reconnectAttempt,
  server,
  termName,
  onReconnect,
  onEditServer,
  onCancel,
}: TerminalConnectionOverlayProps) {
  const { t } = useTranslation()
  const friendly = useMemo(() => friendlyError(error || ''), [error])

  // 快捷键支持：仅在连接失败时允许按 Enter 手动重连；
  // 自动重连进行中不再响应 Enter，避免重复发起连接
  useEffect(() => {
    if (status !== 'error') return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onReconnect()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [status, onReconnect])

  // 连接目标描述串
  const targetLabel = useMemo(() => {
    if (!server) return termName || 'Terminal'
    const isSerial = server.targetType === 'serial' || server.protocol === 'serial'
    if (isSerial) {
      return `串口 ${server.host || 'COM'} (${server.port || 115200} baud)`
    }
    const isTelnet = server.protocol === 'telnet'
    const protocolStr = isTelnet ? 'Telnet' : 'SSH'
    const username = server.username || 'root'
    const host = server.host || 'server'
    const port = server.port || 22
    return `${username}@${host}:${port} (${protocolStr})`
  }, [server, termName])

  // 已成功连接或中途断开后不遮挡用户的历史输出（中途断开保留终端现场，由终端内“按 Enter 重新连接”接管）
  if (status === 'connected' || status === 'disconnected') {
    return null
  }

  // ===== 1. 正常连接中状态 (connecting) =====
  if (status === 'connecting') {
    return (
      <div className="pointer-events-auto absolute inset-0 z-20 flex flex-col items-center justify-center p-6 bg-background/90 backdrop-blur-md select-none animate-in fade-in duration-200">
        <div className="flex flex-col items-center max-w-sm text-center">
          <QshellLoader
            size="lg"
            text={
              <div className="flex flex-col items-center gap-1.5 mt-2">
                <span className="text-sm font-semibold text-foreground">
                  {t('tm_connecting') || '正在建立终端连接...'}
                </span>
                <span className="text-xs text-muted-foreground font-mono truncate max-w-[280px]">
                  {targetLabel}
                </span>
              </div>
            }
          />

          {onCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-8 h-7 px-3 text-xs"
              onClick={onCancel}
            >
              {t('common_cancel') || '取消'}
            </Button>
          )}
        </div>
      </div>
    )
  }

  // ===== 2. 自动重连中状态 (reconnecting) =====
  if (status === 'reconnecting') {
    return (
      <div className="pointer-events-auto absolute inset-0 z-20 flex flex-col items-center justify-center p-6 bg-background/90 backdrop-blur-md select-none animate-in fade-in duration-200">
        <div className="flex flex-col items-center max-w-sm text-center">
          <QshellLoader
            size="lg"
            text={
              <div className="flex flex-col items-center gap-1.5 mt-2">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span>{t('term_reconnecting') || '正在重新连接...'}</span>
                </div>
                <span className="text-xs text-muted-foreground font-mono truncate max-w-[280px]">
                  {reconnectAttempt ? `已尝试第 ${reconnectAttempt} 次自动重连` : targetLabel}
                </span>
              </div>
            }
          />

          {/* 自动重连进行中只展示进度，不再提供手动重试入口 */}
          {onCancel && (
            <div className="mt-6 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={onCancel}
              >
                {t('reconnect_cancel') || '取消'}
              </Button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ===== 3. 连接失败状态 (error)：完全沿用加载页面结构，字母定格静止（不跳动），下方显示提示与重试/编辑配置按钮 =====
  return (
    <div className="pointer-events-auto absolute inset-0 z-20 flex flex-col items-center justify-center p-6 bg-background/92 backdrop-blur-md select-none animate-in fade-in duration-200">
      <div className="flex flex-col items-center max-w-md w-full text-center">
        {/* 静态定格的吉祥物字母（静止不跳动，原地休息） */}
        <QshellLoader
          size="lg"
          isStatic={true}
        />

        {/* 状态与配置提示信息 */}
        <div className="mt-4 flex flex-col items-center gap-2 w-full">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-destructive shrink-0" />
            <span className="text-sm font-semibold text-foreground">
              {t('tm_connection_failed') || '终端连接失败'}
            </span>
            <span className="text-xs text-muted-foreground font-mono truncate max-w-[220px]">
              {targetLabel}
            </span>
          </div>

          {/* 直接告诉用户大概是什么问题，不再提供底层输出入口 */}
          {friendly.message && (
            <p className="max-w-[320px] text-xs leading-relaxed text-muted-foreground">
              {friendly.message}
            </p>
          )}

          {/* 底部行动按钮群：重新连接 (Enter) + 编辑配置 */}
          <div className="mt-4 flex items-center gap-2.5">
            <Button
              size="sm"
              className="h-8 px-4 text-xs font-semibold gap-1.5 shadow-sm"
              onClick={onReconnect}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{t('ws_reconnect') || '重新连接'} (Enter)</span>
            </Button>

            {onEditServer && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs gap-1.5"
                onClick={onEditServer}
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span>编辑配置</span>
              </Button>
            )}

            {onCancel && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={onCancel}
              >
                {t('common_cancel') || '取消'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
