import React, { memo, useEffect, useMemo } from 'react'
import { QshellLoader } from '@/components/ui/qshell-loader'
import { Button } from '@/components/ui/button'
import {
  RotateCcw,
  Terminal,
  Settings2,
  AlertTriangle,
  Eye,
  Copy,
} from 'lucide-react'
import { useTranslation } from '@/i18n'
import { useToast } from '@/components/ui/toast'
import type { Server } from '@/types'

export interface TerminalConnectionOverlayProps {
  status: 'connecting' | 'connected' | 'error' | 'disconnected' | 'reconnecting'
  error?: string
  reconnectAttempt?: number
  server?: Server | null
  termName?: string
  isPeekRaw: boolean
  onTogglePeekRaw: () => void
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
  isPeekRaw,
  onTogglePeekRaw,
  onReconnect,
  onEditServer,
  onCancel,
}: TerminalConnectionOverlayProps) {
  const { t } = useTranslation()
  const { toast } = useToast()

  // 快捷键支持：在失败/重连状态下，用户直接按 Enter 键触发重新连接，按 Esc 切换原始终端回显
  useEffect(() => {
    if (status !== 'error' && status !== 'reconnecting') return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isPeekRaw) return
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onReconnect()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onTogglePeekRaw()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [status, isPeekRaw, onReconnect, onTogglePeekRaw])

  // 智能错误诊断提示，为用户快速排障提供建议
  const smartDiagnosticHint = useMemo(() => {
    if (!error) return null
    const lower = error.toLowerCase()
    if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('no route')) {
      return '远端主机响应超时，请检查 IP 地址、网络路由或云安全组出入站规则'
    }
    if (lower.includes('connection refused') || lower.includes('refused')) {
      return '目标端口连接被拒，请确认远程 SSH/Telnet 服务是否已启动且端口正确'
    }
    if (lower.includes('permission denied') || lower.includes('auth') || lower.includes('authentication')) {
      return '身份认证被拒，请检查用户名、密码或 SSH 私钥配置是否正确'
    }
    if (lower.includes('host key') || lower.includes('fingerprint') || lower.includes('mismatch')) {
      return '目标主机公钥指纹与已保存记录不一致，请检查是否重装了系统或网络劫持'
    }
    if (lower.includes('busy') || lower.includes('com') || lower.includes('serial')) {
      return '本地串口设备可能被其他应用程序占用，或硬件连接已松脱'
    }
    return null
  }, [error])

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

  // ===== 1. 偷看模式（Peek Raw）：用户主动切换到底层终端控制台，显示轻量悬浮胶囊 =====
  if (isPeekRaw) {
    return (
      <div className="pointer-events-auto absolute top-3 right-3 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/80 bg-background/95 shadow-xl backdrop-blur-md text-xs select-none animate-in fade-in slide-in-from-top-2 duration-200">
        {status === 'connecting' && (
          <>
            <QshellLoader size="xs" />
            <span className="text-[11px] text-muted-foreground">{t('tm_connecting') || '连接中...'}</span>
          </>
        )}
        {status === 'reconnecting' && (
          <>
            <QshellLoader size="xs" />
            <span className="text-[11px] text-amber-500 font-medium">
              {t('term_reconnecting') || '重连中'} ({reconnectAttempt || 1})
            </span>
          </>
        )}
        {status === 'error' && (
          <>
            <span className="w-2 h-2 rounded-full bg-destructive animate-ping shrink-0" />
            <span className="text-[11px] text-destructive font-medium truncate max-w-[140px]" title={error}>
              {error || t('tm_connection_failed') || '连接失败'}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10.5px] font-semibold gap-1"
              onClick={onReconnect}
            >
              <RotateCcw className="h-3 w-3" />
              <span>{t('reconnect_now') || '重试'}</span>
            </Button>
          </>
        )}
        <div className="h-3.5 w-px bg-border/60 mx-0.5" />
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10.5px] text-primary hover:text-primary font-medium gap-1"
          onClick={onTogglePeekRaw}
          title="还原图形化加载界面 (Esc)"
        >
          <Eye className="h-3 w-3" />
          <span>还原画面</span>
        </Button>
      </div>
    )
  }

  // ===== 2. 正常连接中状态 (connecting) =====
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

          {/* 底部辅助操作条 */}
          <div className="mt-8 flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1.5"
              onClick={onTogglePeekRaw}
              title="切换到底层终端原始回显界面"
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>查看控制台输出</span>
            </Button>

            {onCancel && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={onCancel}
              >
                {t('common_cancel') || '取消'}
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ===== 3. 自动重连中状态 (reconnecting) =====
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

          <div className="mt-6 flex items-center gap-2">
            <Button
              size="sm"
              className="h-8 px-4 text-xs font-semibold gap-1.5"
              onClick={onReconnect}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{t('reconnect_now') || '立即重试 (Enter)'}</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1.5"
              onClick={onTogglePeekRaw}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>控制台输出</span>
            </Button>

            {onCancel && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={onCancel}
              >
                {t('reconnect_cancel') || '取消'}
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ===== 4. 连接失败状态 (error)：完全沿用加载页面结构，字母定格静止（不跳动），下方显示提示与重试/编辑配置按钮 =====
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

          {/* 错误详情 & 一键复制 */}
          <div className="w-full mt-1 rounded-xl bg-muted/40 border border-border/50 p-2.5 text-left space-y-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="font-mono">错误详情:</span>
              {error && (
                <button
                  type="button"
                  className="text-[10px] text-primary hover:underline flex items-center gap-1 select-none"
                  onClick={() => {
                    navigator.clipboard.writeText(error)
                    toast.success('错误信息已复制到剪贴板')
                  }}
                >
                  <Copy className="h-3 w-3" />
                  <span>复制</span>
                </button>
              )}
            </div>
            <div className="font-mono text-xs text-destructive break-all leading-relaxed max-h-20 overflow-y-auto select-text">
              {error || 'SSH 连接失败'}
            </div>
          </div>

          {/* 智能排障建议 */}
          {smartDiagnosticHint && (
            <div className="w-full flex items-start gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 p-2 text-left text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{smartDiagnosticHint}</span>
            </div>
          )}

          {/* 底部行动按钮群：重新连接 (Enter) + 编辑配置 + 原始输出 */}
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

            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1.5"
              onClick={onTogglePeekRaw}
              title="查看终端底层报错与输出 (Esc)"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>原始输出</span>
            </Button>

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
