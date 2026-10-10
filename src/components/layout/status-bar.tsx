import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { Wifi, WifiOff, Server, Copy, Check, Monitor } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { sshService } from '@/services/ssh-service'
import { collectGroupIds } from '@/utils/split-layout'
import { playSound, SoundType } from '@/lib/sound'
import { extractBaseServerId } from '@/services/ssh-connection-state'
import { cn } from '@/lib/utils'

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
  const { activeTabId, tabs, connectedServers, servers, layout, workspaces } =
    useAppStore()

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const serverId = activeTab?.serverId
  const isConnected = serverId
    ? ((activeTab ? connectedServers[`ws:${serverId}:${activeTab.id}`] : undefined) ?? connectedServers[serverId] ?? false)
    : false
  const server = servers.find((s) => s.id === serverId)

  // 分屏判定：底部状态栏只反映当前活动 tab，分屏下没有代表性（各窗格状态由
  // 窗格头部体现），反而会误导用户以为只有一个连接，故分屏时不渲染。
  //
  // 这里同时看「全局 layout」和「活跃 tab 所属 workspace 的 layout」，任一为
  // 多窗格即判定分屏。原因：focusGroup / setActiveTab 会把 workspace 的 split
  // 树同步到全局 layout，切换窗格时全局 layout 可能短暂落到单叶子，只用全局
  // layout 会让状态栏闪现一下再消失，内容区高度随之突变 —— 表现为页面抖动。
  // 补上 workspace 自身 layout 这一路判据即可消除该抖动。
  // 注意：early return 必须放在本组件所有 hook 之后，否则分屏时 hook 数量
  // 会减少，触发 "Rendered fewer hooks than expected"。
  const isSplitMode = useMemo(() => {
    if (collectGroupIds(layout).length > 1) return true
    const wsId = tabs.find((t) => t.id === activeTabId)?.workspaceId
    if (!wsId) return false
    const wsLayout = workspaces[wsId]?.layout
    return wsLayout ? collectGroupIds(wsLayout).length > 1 : false
  }, [layout, activeTabId, tabs, workspaces])

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
  // BMC 带外管理通过 Redfish (HTTPS) 工作，不依赖 SSH 连接
  const isBmcServer = server?.targetType === 'bmc'
  const isRdpServer = server?.targetType === 'rdp' || server?.protocol === 'rdp'
  const isSerialServer = server?.targetType === 'serial' || server?.protocol === 'serial'
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
        const sameSession = previous?.sessionId === sessionId
        const seconds = sameSession ? Math.max((now - previous.at) / 1000, 0.001) : 1
        setSerialStats({
          ...stats,
          rxRate: sameSession ? Math.max(0, (stats.rxBytes - previous.rxBytes) / seconds) : 0,
          txRate: sameSession ? Math.max(0, (stats.txBytes - previous.txBytes) / seconds) : 0,
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

  // 分屏模式下不渲染底部状态栏（此处为本组件最后一个 hook 之后，hook 数量恒定）
  if (isSplitMode) return null

  // 复制 IP 按钮：仅在状态栏确实展示 host 时挂载
  const copyIpButton = server?.host ? (
    <button
      type="button"
      onClick={handleCopyIp}
      title={copiedIp ? t('status_ip_copied') : t('status_copy_ip')}
      aria-label={copiedIp ? t('status_ip_copied') : t('status_copy_ip')}
      className={cn(
        'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded transition-colors',
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
          <>
            <Wifi className="h-3 w-3 text-success flex-shrink-0" />
            <span className="truncate">
              {isSerialServer
                ? `${t('status_serial_mode')} · ${server?.host || 'COM'}`
                : `${t('status_connected_to')} ${server?.host || '?'}`}
            </span>
            {copyIpButton}
          </>
        ) : isBmcServer ? (
          <>
            <Wifi className="h-3 w-3 text-success flex-shrink-0" />
            <span className="truncate">{t('status_bmc_ready') || 'BMC 已就绪'} · {server?.host || '?'}</span>
            {copyIpButton}
          </>
        ) : isRdpServer ? (
          <>
            <Monitor className="h-3 w-3 text-primary flex-shrink-0" />
            <span className="truncate">{t('rdp_ready') || '远程桌面'} · {server?.host || '?'}</span>
            {copyIpButton}
          </>
        ) : isSerialServer ? (
          <>
            <WifiOff className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            <span className="truncate">{t('status_serial_disconnected')} · {server?.host || 'COM'}</span>
            {copyIpButton}
          </>
        ) : serverId ? (
          <>
            <WifiOff className="h-3 w-3 text-destructive flex-shrink-0" />
            <span className="truncate">{t('status_disconnected')}</span>
          </>
        ) : (
          <span className="truncate">{t('status_ready')}</span>
        )}
      </div>

      {isSerialServer && (
        <span
          className="hidden items-center gap-2 font-mono text-[10px] sm:flex"
          title={`${t('serial_rx_total')}: ${formatSerialBytes(serialStats.rxBytes)} · ${t('serial_tx_total')}: ${formatSerialBytes(serialStats.txBytes)}`}
        >
          <span className={serialStats.rxRate > 0 ? 'text-emerald-500' : 'text-muted-foreground/55'}>
            RX {formatSerialBytes(serialStats.rxRate)}/s
          </span>
          <span className={serialStats.txRate > 0 ? 'text-sky-500' : 'text-muted-foreground/55'}>
            TX {formatSerialBytes(serialStats.txRate)}/s
          </span>
        </span>
      )}

      {/* Workspace mode */}
      <span className="text-muted-foreground/50 flex-shrink-0 font-mono">
        {isSftpTab
          ? 'SFTP'
          : isBmcServer
            ? (t('status_bmc_mode') || 'BMC 模式')
            : isRdpServer
              ? (t('module_rdp') || '远程桌面')
              : isSerialServer
                ? t('status_serial_mode')
                : t('status_ssh_mode')}
      </span>
    </div>
  )
}
