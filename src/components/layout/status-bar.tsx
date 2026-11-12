import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { Wifi, WifiOff, Server, Copy, Check, Monitor, Zap, PenSquare, Layers } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { sshService } from '@/services/ssh-service'
import { collectGroupIds } from '@/utils/split-layout'
import { playSound, SoundType } from '@/lib/sound'
import { extractBaseServerId } from '@/services/ssh-connection-state'
import { cn } from '@/lib/utils'
import { StatusBarMetricsPill } from '@/components/workspace/floating-metrics-hud'
import { getServerConnectionFlags, deviceStatusKeys, isPureVncServer } from '@/services/connection-targets'

/** 复制成功对勾的显示时长（ms） */
const COPY_FEEDBACK_MS = 1500

function formatSerialBytes(value: number): string {
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function StatusBar() {
  const { t } = useTranslation()
  const { activeTabId, tabs, connectedServers, servers, layout, workspaces, terminalComposeBarVisible } =
    useAppStore()

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const serverId = activeTab?.serverId
  const server = servers.find((s) => s.id === serverId)

  // 分屏判定：底部状态栏只反映当前活动 tab。分屏下现在仍渲染，但会切换为
  // 「分屏摘要 / 当前焦点会话」展示，而不是单连接状态，避免误导用户。
  //
  // 同时看「全局 layout」和「活跃 tab 所属 workspace 的 layout」，任一为
  // 多窗格即判定分屏。原因：focusGroup / setActiveTab 会把 workspace 的 split
  // 树同步到全局 layout，切换窗格时全局 layout 可能短暂落到单叶子，只用全局
  // layout 会让判定抖动。补上 workspace 自身 layout 这一路判据即可消除。
  // 注意：本组件所有 hook 必须保持无条件执行，不能在分屏时提前 return，
  // 否则 hook 数量会变化并触发 "Rendered fewer hooks than expected"。
  const isSplitMode = useMemo(() => {
    if (collectGroupIds(layout).length > 1) return true
    const wsId = tabs.find((t) => t.id === activeTabId)?.workspaceId
    if (!wsId) return false
    const wsLayout = workspaces[wsId]?.layout
    return wsLayout ? collectGroupIds(wsLayout).length > 1 : false
  }, [layout, activeTabId, tabs, workspaces])

  const splitTerminalCount = useMemo(() => {
    if (!isSplitMode) return 1
    const wsId = tabs.find((t) => t.id === activeTabId)?.workspaceId
    if (wsId && workspaces[wsId]?.layout) {
      const gids = collectGroupIds(workspaces[wsId].layout)
      if (gids.length > 1) return gids.length
    }
    const globalGids = collectGroupIds(layout)
    if (globalGids.length > 1) return globalGids.length
    const wsTabs = wsId
      ? tabs.filter((t) => t.workspaceId === wsId && t.module === 'terminal')
      : []
    return wsTabs.length > 0 ? wsTabs.length : 2
  }, [isSplitMode, tabs, activeTabId, layout, workspaces])

  // SFTP 标签的 serverId 是特殊值 'sftp'，并非真实服务器 ID，
  // 全局 connectedServers 中不会有该条目，会被误判为"未连接"。
  // SFTP 模块内部 tab 栏已显示每个连接的状态，底部状态栏不应重复显示连接状态，
  // 改为显示模块标识 + 已连接服务器统计，避免误导用户。
  const isSftpTab = serverId === 'sftp'
  const connectedCount = useMemo(() => {
    return new Set(
      Object.keys(connectedServers)
        .filter((k) => connectedServers[k])
        .map((k) => extractBaseServerId(k))
    ).size
  }, [connectedServers])
  // Phase 0：形态判断统一查能力表（BMC 走 Redfish，不依赖 SSH 连接）
  const serverFlags = getServerConnectionFlags(server?.targetType, server?.protocol)
  // Phase 2-C：设备管理目标统一不走 SSH，避免误显示 SSH 模式 / 指标胶囊
  const isBmcServer = serverFlags.isDeviceManagedServer
  const deviceStatus = deviceStatusKeys(server?.targetType)
  const isRdpServer = serverFlags.isRdpServer
  const isSerialServer = serverFlags.isSerialServer
  const isTelnetServer = serverFlags.isTelnetServer || server?.protocol === 'telnet'
  const isFtpServer = server?.protocol === 'ftp'
  const isVncMode = activeTab?.module === 'vnc' || isPureVncServer(server)
  const supportsMetrics = serverFlags.supportsMetrics
  const isDashboard = !activeTab || !serverId

  const connId =
    activeTab?.id && serverId && !isSerialServer && !isRdpServer && !isBmcServer && !isVncMode
      ? `ws:${serverId}:${activeTab.id}`
      : serverId
  const isConnected = connId
    ? ((activeTab ? connectedServers[`ws:${serverId}:${activeTab.id}`] : undefined) ??
        connectedServers[connId] ??
        connectedServers[serverId || ''] ??
        false)
    : false

  const focusTitle = useMemo(() => {
    if (isSerialServer) {
      return server?.name ? `${server.name} (${server.host || 'COM'})` : server?.host || 'COM'
    }
    if (!server) return activeTab?.title || activeTab?.serverName || '?'
    if (server.name && server.name !== server.host) {
      return `${server.name} (${server.host})`
    }
    return server.host || server.name || '?'
  }, [server, activeTab, isSerialServer])

  const [serialStats, setSerialStats] = useState({ rxBytes: 0, txBytes: 0, rxRate: 0, txRate: 0 })

  useEffect(() => {
    if (!isSerialServer || !activeTabId) {
      // 延后一帧清零，避免在 effect 内同步 setState 触发级联渲染
      const resetTimer = setTimeout(
        () => setSerialStats({ rxBytes: 0, txBytes: 0, rxRate: 0, txRate: 0 }),
        0,
      )
      return () => clearTimeout(resetTimer)
    }
    let disposed = false
    let previous: { sessionId: string; rxBytes: number; txBytes: number; at: number } | null = null
    const sample = async () => {
      const sessionId = sshService.getTabActiveSessionId(activeTabId)
      if (!sessionId) {
        previous = null
        if (!disposed) setSerialStats({ rxBytes: 0, txBytes: 0, rxRate: 0, txRate: 0 })
        return
      }
      try {
        const stats = await sshService.getSerialStats(sessionId)
        if (disposed) return
        const now = Date.now()
        const prev = previous
        const sameSession = prev !== null && prev.sessionId === sessionId
        const seconds = sameSession ? Math.max((now - prev.at) / 1000, 0.001) : 1
        setSerialStats({
          ...stats,
          rxRate: sameSession ? Math.max(0, (stats.rxBytes - prev.rxBytes) / seconds) : 0,
          txRate: sameSession ? Math.max(0, (stats.txBytes - prev.txBytes) / seconds) : 0,
        })
        previous = { sessionId, ...stats, at: now }
      } catch {
        if (!disposed) setSerialStats((current) => ({ ...current, rxRate: 0, txRate: 0 }))
      }
    }
    void sample()
    const timer = window.setInterval(sample, 1000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [activeTabId, isSerialServer])

  // 复制 IP（server.host）到剪贴板，复制成功后图标短暂变为对勾
  const [copiedIp, setCopiedIp] = useState(false)
  const copyTimerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    },
    [],
  )
  const handleCopyIp = useCallback(async () => {
    const host = server?.host
    if (!host) return
    try {
      await navigator.clipboard.writeText(host)
      setCopiedIp(true)
      playSound(SoundType.Click)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(
        () => setCopiedIp(false),
        COPY_FEEDBACK_MS,
      )
    } catch {
      // 剪贴板不可用（非安全上下文 / 权限被拒）时静默失败，不打断用户
    }
  }, [server?.host])

  // 复制 IP 按钮：仅在状态栏确实展示 host 时挂载
  const copyIpButton = server?.host ? (
    <button
      type="button"
      onClick={handleCopyIp}
      title={copiedIp ? t('status_ip_copied') : t('status_copy_ip')}
      aria-label={copiedIp ? t('status_ip_copied') : t('status_copy_ip')}
      className={cn(
        'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded transition-all active:scale-90',
        copiedIp
          ? 'text-success'
          : 'text-muted-foreground/60 hover:bg-accent/50 hover:text-foreground',
      )}
    >
      {copiedIp ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  ) : null

  return (
    <div className="flex items-center h-6 px-3 glass border-t border-border/40 text-[11px] text-muted-foreground gap-4 select-none">
      {/* Connection status */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
        {isSftpTab ? (
          <>
            <Server className="h-3 w-3 text-primary flex-shrink-0" />
            <span className="truncate">{t('status_sftp_mode')}</span>
            {connectedCount > 0 && (
              <span className="text-muted-foreground/70 truncate">
                · {t('status_sftp_connected_count').replace('{n}', String(connectedCount))}
              </span>
            )}
          </>
        ) : isConnected ? (
          isSplitMode ? (
            <>
              <Layers className="h-3 w-3 text-primary flex-shrink-0" />
              <span className="truncate">
                {t('status_split_mode', { count: splitTerminalCount })}
                {' · '}
                <span className="text-foreground/90 font-medium">
                  {t('status_current_focus')}: {focusTitle}
                </span>
              </span>
              {copyIpButton}
            </>
          ) : (
            <>
              <Wifi className="h-3 w-3 text-success flex-shrink-0" />
              <span className="truncate">
                {isSerialServer
                  ? `${t('status_serial_mode')} · ${server?.host || 'COM'}`
                  : `${t('status_connected_to')} ${server?.host || '?'}`}
              </span>
              {copyIpButton}
            </>
          )
        ) : isBmcServer ? (
          <>
            <Wifi className="h-3 w-3 text-success flex-shrink-0" />
            <span className="truncate">{t(deviceStatus.readyKey)} · {server?.host || '?'}</span>
            {copyIpButton}
          </>
        ) : isRdpServer ? (
          <>
            <Monitor className="h-3 w-3 text-primary flex-shrink-0" />
            <span className="truncate">{t('rdp_ready')} · {server?.host || '?'}</span>
            {copyIpButton}
          </>
        ) : isVncMode ? (
          <>
            <Monitor className="h-3 w-3 text-primary flex-shrink-0" />
            <span className="truncate">VNC · {server?.host || '?'}</span>
            {copyIpButton}
          </>
        ) : isSerialServer ? (
          <>
            <WifiOff className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            <span className="truncate">{t('status_serial_disconnected')} · {server?.host || 'COM'}</span>
            {copyIpButton}
          </>
        ) : serverId ? (
          isSplitMode ? (
            <>
              <Layers className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              <span className="truncate">
                {t('status_split_mode', { count: splitTerminalCount })}
                {' · '}
                <span className="text-foreground/90 font-medium">
                  {t('status_current_focus')}: {focusTitle}
                </span>
                {' ('}{t('status_disconnected')}{')'}
              </span>
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3 text-destructive flex-shrink-0" />
              <span className="truncate">{t('status_disconnected')}</span>
            </>
          )
        ) : (
          <>
            <Server className="h-3 w-3 text-muted-foreground/60 flex-shrink-0" />
            <span className="truncate">
              {t('status_ready')} · {t('dashboard_filter_all') || '全部主机'} {servers.length}
              {connectedCount > 0 && ` (${t('status_connected_count', { count: connectedCount })})`}
            </span>
          </>
        )}
      </div>

      {/* 右侧工具胶囊组（快捷命令、资源监控、协议模式），紧凑微距排布 */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isSerialServer && (
          <span
            className="hidden items-center gap-2 font-mono tabular-nums text-[10px] sm:flex mr-1"
            title={`${t('serial_rx_total')}: ${formatSerialBytes(serialStats.rxBytes)} · ${t('serial_tx_total')}: ${formatSerialBytes(serialStats.txBytes)}`}
          >
            <span className={cn('inline-flex items-center w-[76px] tabular-nums truncate', serialStats.rxRate > 0 ? 'text-emerald-500' : 'text-muted-foreground/55')}>
              RX {formatSerialBytes(serialStats.rxRate)}/s
            </span>
            <span className={cn('inline-flex items-center w-[76px] tabular-nums truncate', serialStats.txRate > 0 ? 'text-sky-500' : 'text-muted-foreground/55')}>
              TX {formatSerialBytes(serialStats.txRate)}/s
            </span>
          </span>
        )}

        {/* 快捷命令底栏触发按钮（位于资源监控左侧） */}
        {isConnected && !isSftpTab && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('qshell:toggle-quick-commands'))}
            className="flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium rounded border border-border/50 bg-muted/30 hover:bg-muted/80 text-foreground/80 hover:text-foreground transition-all duration-150 cursor-pointer shadow-2xs active:scale-95 flex-shrink-0"
            title={`${t('quick_cmd_bar') || '快捷命令'} (Alt+C)`}
          >
            <Zap className="h-3 w-3 text-amber-500 fill-amber-500/20" />
            <span>{t('quick_cmd_bar') || '快捷命令'}</span>
            <kbd className="hidden sm:inline-block text-[9px] font-mono text-muted-foreground/70 px-1 py-0.2 rounded bg-background/50 border border-border/40">
              Alt+C
            </kbd>
          </button>
        )}

        {/* 命令撰写与多机分发底栏触发按钮 */}
        {isConnected && !isSftpTab && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('qshell:toggle-compose-bar', { detail: { forceToggle: true } }))}
            className={cn(
              "flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-medium rounded border transition-all duration-150 cursor-pointer shadow-2xs active:scale-95 flex-shrink-0",
              terminalComposeBarVisible
                ? "bg-primary/15 border-primary/40 text-primary font-semibold"
                : "border-border/50 bg-muted/30 hover:bg-muted/80 text-foreground/80 hover:text-foreground"
            )}
            title={`${t('compose_bar_title') || '撰写'} (Ctrl+Shift+U)`}
          >
            <PenSquare className={cn("h-3 w-3", terminalComposeBarVisible ? "text-primary" : "text-sky-500")} />
            <span>{t('compose_bar_title') || '撰写'}</span>
            <kbd className="hidden sm:inline-block text-[9px] font-mono text-muted-foreground/70 px-1 py-0.2 rounded bg-background/50 border border-border/40">
              Ctrl+Shift+U
            </kbd>
          </button>
        )}

        {/* 实时监控底栏触发胶囊 */}
        {isConnected && !isSftpTab && !isSerialServer && !isRdpServer && !isBmcServer && !isVncMode && supportsMetrics && connId && (
          <StatusBarMetricsPill
            serverId={connId}
            isConnected={isConnected}
          />
        )}

        {/* Workspace mode（仅在具体会话标签页下展示协议模式，首页/仪表盘不展示任何模式胶囊） */}
        {!isDashboard && (
          <span className="text-muted-foreground/70 flex-shrink-0 font-mono text-[10px] uppercase tracking-wider bg-muted/40 border border-border/40 px-1.5 py-0.5 rounded shadow-2xs">
            {isSftpTab
              ? 'SFTP'
              : isBmcServer
                ? t(deviceStatus.modeKey)
                : isRdpServer
                  ? t('module_rdp')
                  : isVncMode
                    ? 'VNC'
                    : isSerialServer
                      ? t('status_serial_mode')
                      : isTelnetServer
                        ? 'TELNET'
                        : isFtpServer
                          ? 'FTP'
                          : t('status_ssh_mode')}
          </span>
        )}
      </div>
    </div>
  )
}
