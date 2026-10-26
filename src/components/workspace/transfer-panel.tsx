import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Upload,
  Download,
  CheckCircle2,
  XCircle,
  Loader2,
  X,
  ArrowUpDown,
  Trash2,
} from 'lucide-react'
import { sshService } from '@/services/ssh-service'
import { QshellLoader } from '@/components/ui/qshell-loader'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'

interface TransferItem {
  transferId: string
  type: string // 'upload' | 'download'
  fileName: string
  current: number
  total: number
  percent: number
  status: 'transferring' | 'completed' | 'failed' | 'canceled'
  timestamp: number
  startTime: number
  lastUpdate: number
  lastCurrent: number
  rate: number // bytes/sec
  elapsedMs: number
  error?: string
  /** total 字段语义："bytes"（字节级进度）或 "count"（文件计数进度，目录递归传输） */
  totalType?: 'bytes' | 'count'
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const decimals = i >= 2 ? 2 : (i === 0 ? 0 : 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(decimals)} ${units[i]}`
}

function formatRate(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '-'
  return `${formatSize(bytesPerSec)}/s`
}

function formatTime(ms: number): string {
  if (ms < 1000) return '<1s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return `${m}m${rs}s`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60}m`
}

/**
 * 判断 total 是字节数还是文件数。
 * 目录递归传输时后端按文件数发送进度（total 通常 < 100000），
 * 单文件传输时 total 是字节数（可能很大）。
 */
function looksLikeFileCount(total: number): boolean {
  return total > 0 && total < 50000
}

type TabType = 'upload' | 'download'

export function TransferPanel() {
  const { t } = useTranslation()
  const [transfers, setTransfers] = useState<TransferItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('upload')
  const mountedRef = useRef(true)
  const MAX_HISTORY = 500
  const transfersRef = useRef(transfers)
  useEffect(() => {
    transfersRef.current = transfers
  }, [transfers])

  // 记录被用户主动取消的 transferId，后端 done===false 时据此区分「已取消」与「失败」
  const cancelledRef = useRef<Set<string>>(new Set())

  // 定时刷新进行中传输的已用时间
  useEffect(() => {
    const timer = setInterval(() => {
      if (!mountedRef.current) return
      setTransfers(prev => prev.map(t => {
        if (t.status !== 'transferring') return t
        return { ...t, elapsedMs: Date.now() - t.startTime }
      }))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const unsubscribe = sshService.onTransferProgress((data) => {
      if (!mountedRef.current) return
      // 忽略打包阶段进度
      if (data.phase === 'packing' || data.phase === 'packed') return

      const { transferId, type, current, total, fileName, done, totalType, error } = data
      const isDoneSignal = !!done && total === 0
      const isFailSignal = done === false
      const effectiveTotal = (isDoneSignal || isFailSignal) ? undefined : total
      const effectiveCurrent = (isDoneSignal || isFailSignal) ? undefined : current
      // 优先使用后端提供的 totalType，回退到启发式判断（manifest 阶段按字节数展示）
      const effectiveTotalType: 'bytes' | 'count' = totalType === 'manifest'
        ? 'bytes'
        : (totalType ?? (total > 0 && total < 50000 ? 'count' : 'bytes'))
      const percent = effectiveTotal && effectiveTotal > 0
        ? Math.round((effectiveCurrent! / effectiveTotal) * 100)
        : isFailSignal ? 0 : done ? 100 : 0
      const now = Date.now()

      setTransfers(prev => {
        const existing = prev.find(t => t.transferId === transferId)

        if (existing) {
          const newCurrent = effectiveCurrent ?? existing.current
          const newTotal = effectiveTotal ?? existing.total
          const dt = (now - existing.lastUpdate) / 1000
          const dBytes = newCurrent - existing.lastCurrent
          let rate = existing.rate
          if (!isDoneSignal && !isFailSignal && dt > 0 && dBytes >= 0) {
            const instantRate = dBytes / dt
            rate = existing.rate > 0
              ? existing.rate * 0.7 + instantRate * 0.3
              : instantRate
          }

          return prev.map(t =>
            t.transferId === transferId
              ? {
                  ...t,
                  current: newCurrent,
                  total: newTotal,
                  percent: isFailSignal ? t.percent : isDoneSignal ? (t.percent > 0 ? t.percent : 100) : percent,
                  fileName: fileName || t.fileName,
                  status: isFailSignal
                    ? (cancelledRef.current.has(transferId) ? 'canceled' as const : 'failed' as const)
                    : done
                      ? 'completed' as const
                      : (existing.status === 'completed' || existing.status === 'failed' || existing.status === 'canceled')
                        ? existing.status
                        : 'transferring' as const,
                  lastUpdate: now,
                  lastCurrent: newCurrent,
                  rate: (done || isFailSignal) ? 0 : rate,
                  elapsedMs: (done || isFailSignal) ? t.elapsedMs : now - t.startTime,
                  totalType: effectiveTotalType,
                  error: isFailSignal ? (error || t.error) : t.error,
                }
              : t
          )
        }

        // 新传输
        const newItem: TransferItem = {
          transferId,
          type,
          fileName,
          current: effectiveCurrent ?? 0,
          total: effectiveTotal ?? 0,
          percent: isFailSignal ? 0 : isDoneSignal ? 100 : percent,
          status: isFailSignal
            ? (cancelledRef.current.has(transferId) ? 'canceled' : 'failed')
            : done ? 'completed' : 'transferring',
          timestamp: now,
          startTime: now,
          lastUpdate: now,
          lastCurrent: effectiveCurrent ?? 0,
          rate: 0,
          elapsedMs: 0,
          totalType: effectiveTotalType,
          error: isFailSignal ? error : undefined,
        }
        // Keep a bounded history so a long-running workspace cannot retain one
        // React object per transfer forever. Active transfers are always kept;
        // completed entries are trimmed from the tail first.
        const next = [newItem, ...prev]
        if (next.length <= MAX_HISTORY) return next
        const active = next.filter(item => item.status === 'transferring')
        const inactive = next.filter(item => item.status !== 'transferring')
        return [...active, ...inactive].slice(0, MAX_HISTORY)
      })

      // 新传输自动打开面板并切换到对应 Tab
      if (!transfersRef.current.find(t => t.transferId === transferId)) {
        setIsOpen(true)
        setActiveTab(type as TabType)
      }
      if (done || isFailSignal) {
        // The terminal event has consumed the cancellation marker; keeping it
        // forever would make this Set grow for every transfer in a long session.
        cancelledRef.current.delete(transferId)
      }
    })

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [])

  // 卸载时清空
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelledRef.current.clear()
    }
  }, [])

  const clearCompleted = useCallback(() => {
    setTransfers(prev => prev.filter(t => t.status === 'transferring'))
  }, [])

  const clearAll = useCallback(() => {
    setTransfers([])
  }, [])

  const removeTransfer = useCallback((id: string) => {
    const item = transfersRef.current.find(t => t.transferId === id)
    if (item && item.status === 'transferring') {
      // 用户主动取消：乐观置为「已取消」（与 SFTP 一致，记录保留而非移除），并通知后端
      cancelledRef.current.add(id)
      sshService.cancelTransfer(id).catch(err => {
        console.warn('Failed to cancel transfer:', err)
      })
      setTransfers(prev => prev.map(t =>
        t.transferId === id ? { ...t, status: 'canceled' as const, rate: 0 } : t
      ))
      return
    }
    cancelledRef.current.delete(id)
    setTransfers(prev => prev.filter(t => t.transferId !== id))
  }, [])

  // 点击外部关闭
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // 按类型分组
  const uploadTransfers = transfers.filter(t => t.type === 'upload')
  const downloadTransfers = transfers.filter(t => t.type === 'download')
  const currentTabTransfers = activeTab === 'upload' ? uploadTransfers : downloadTransfers

  const uploadActiveCount = uploadTransfers.filter(t => t.status === 'transferring').length
  const downloadActiveCount = downloadTransfers.filter(t => t.status === 'transferring').length
  const activeCount = uploadActiveCount + downloadActiveCount

  const currentTabActive = currentTabTransfers.filter(t => t.status === 'transferring').length
  const currentTabCompleted = currentTabTransfers.filter(t => t.status === 'completed').length
  const currentTabFailed = currentTabTransfers.filter(t => t.status === 'failed').length

  const totalRate = currentTabTransfers
    .filter(t => t.status === 'transferring')
    .reduce((sum, t) => sum + t.rate, 0)

  return (
    <div className="relative" ref={panelRef}>
      {/* 切换按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'relative flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent/50 transition-colors cursor-pointer',
          isOpen && 'bg-accent/50',
        )}
        title={t('tx_title')}
      >
        <ArrowUpDown className={cn('h-4 w-4', activeCount > 0 ? 'text-primary animate-pulse' : 'text-muted-foreground')} />
        {activeCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground px-1">
            {activeCount}
          </span>
        )}
      </button>

      {/* 面板 */}
      {isOpen && (
        <Card className="theme-floating-panel absolute top-full right-0 mt-1 z-50 w-96 border-border/60 h-[520px] flex flex-col">
          {/* Tab 切换 */}
          <div className="flex border-b flex-shrink-0">
            <TabButton
              active={activeTab === 'upload'}
              onClick={() => setActiveTab('upload')}
              icon={<Upload className="h-3.5 w-3.5" />}
              label={t('tx_tab_upload')}
              count={uploadTransfers.length}
              activeCount={uploadActiveCount}
            />
            <TabButton
              active={activeTab === 'download'}
              onClick={() => setActiveTab('download')}
              icon={<Download className="h-3.5 w-3.5" />}
              label={t('tx_tab_download')}
              count={downloadTransfers.length}
              activeCount={downloadActiveCount}
            />
          </div>

          {/* 头部统计 */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b flex-shrink-0 bg-card/50">
            <div className="flex items-center gap-1.5 text-[11px]">
              {currentTabActive > 0 && (
                <span className="text-primary font-medium">{t('tx_n_in_progress').replace('{n}', String(currentTabActive))}</span>
              )}
              {currentTabCompleted > 0 && (
                <span className="text-success">{t('tx_n_done').replace('{n}', String(currentTabCompleted))}</span>
              )}
              {currentTabFailed > 0 && (
                <span className="text-destructive">{t('tx_n_failed').replace('{n}', String(currentTabFailed))}</span>
              )}
              {currentTabTransfers.length === 0 && (
                <span className="text-muted-foreground">{activeTab === 'upload' ? t('tx_empty_upload') : t('tx_empty_download')}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {currentTabActive > 0 && totalRate > 0 && (
                <span className="text-[11px] text-muted-foreground mr-1 tabular-nums">
                  {formatRate(totalRate)}
                </span>
              )}
              {currentTabCompleted + currentTabFailed > 0 && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={clearCompleted}>
                  {t('tx_clear_done')}
                </Button>
              )}
              {currentTabTransfers.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={clearAll} title={t('tx_clear_all')}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>

          {/* 传输列表 */}
          <ScrollArea className="flex-1 min-h-0">
            {currentTabTransfers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                {activeTab === 'upload' ? (
                  <Upload className="h-10 w-10 mb-2 opacity-20" />
                ) : (
                  <Download className="h-10 w-10 mb-2 opacity-20" />
                )}
                <p className="text-sm">{activeTab === 'upload' ? t('tx_empty_upload_hint') : t('tx_empty_download_hint')}</p>
                <p className="text-[11px] mt-1 opacity-70">{activeTab === 'upload' ? t('tx_upload_hint') : t('tx_download_hint')}</p>
              </div>
            ) : (
              <div className="p-1.5 space-y-0.2">
                {currentTabTransfers.map(transfer => (
                  <TransferRow
                    key={transfer.transferId}
                    transfer={transfer}
                    onRemove={removeTransfer}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </Card>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
  activeCount,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  count: number
  activeCount: number
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors relative',
        active
          ? 'text-foreground border-b-2 border-b-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-accent/30',
      )}
    >
      {icon}
      <span>{label}</span>
      {count > 0 && (
        <span className="text-[10px] text-muted-foreground">({count})</span>
      )}
      {activeCount > 0 && (
        <span className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground px-1">
          {activeCount}
        </span>
      )}
    </button>
  )
}

function TransferRow({
  transfer,
  onRemove,
}: {
  transfer: TransferItem
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation()
  const isUpload = transfer.type === 'upload'
  const isActive = transfer.status === 'transferring'
  const isCompleted = transfer.status === 'completed'
  const isFailed = transfer.status === 'failed'
  const isCanceled = transfer.status === 'canceled'

  // 与 SFTP 一致的百分比口径：完成后 100%，进行中封顶 99%，终态保留其时的百分比
  const displayPercent = transfer.status === 'completed'
    ? 100
    : transfer.status === 'transferring'
      ? Math.min(99, transfer.percent)
      : transfer.percent

  // 优先使用后端提供的 totalType 判断；回退到启发式判断（兼容旧数据）
  const isFileCount = transfer.total > 0 && (
    transfer.totalType === 'count' ||
    (!transfer.totalType && looksLikeFileCount(transfer.total))
  )

  const remainingBytes = transfer.total - transfer.current
  const etaSec = transfer.rate > 0 ? remainingBytes / transfer.rate : 0

  return (
    <div
      className={cn(
        'rounded-md px-2.5 py-2 transition-colors group relative',
        isActive && 'bg-primary/5',
        isCompleted && 'opacity-70',
        isFailed && 'bg-red-500/5',
        isCanceled && 'bg-amber-500/5',
      )}
    >
      {/* 第 1 行：图标 + 文件名 + 关闭按钮 */}
      <div className="flex items-center gap-2 mb-1">
        <div className="flex-shrink-0">
          {isActive && (isUpload ? <Upload className="h-4 w-4 text-primary" /> : <Download className="h-4 w-4 text-primary" />)}
          {isCompleted && <CheckCircle2 className="h-4 w-4 text-success" />}
          {isFailed && <XCircle className="h-4 w-4 text-destructive" />}
          {isCanceled && <XCircle className="h-4 w-4 text-amber-500" />}
        </div>
        <span className="text-xs truncate flex-1 leading-tight font-medium" title={transfer.fileName}>
          {transfer.fileName}
        </span>
        <button
          onClick={() => onRemove(transfer.transferId)}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-accent"
          title={t('tx_remove')}
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>

      {/* 第 2 行：进度条 */}
      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mb-1.5">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300',
            isFailed && 'bg-red-500',
            isCompleted && 'bg-green-500',
            isActive && 'bg-primary',
            isCanceled && 'bg-amber-500',
          )}
          style={{ width: `${displayPercent}%` }}
        />
      </div>

      {/* 第 3 行：统计信息 */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>
          {isFileCount ? (
            <>
              <span className="text-foreground font-medium">{transfer.current}</span>
              /{transfer.total} {t('tx_files')}
            </>
          ) : (
            <>
              <span className="text-foreground font-medium">{formatSize(transfer.current)}</span>
              /{formatSize(transfer.total)}
            </>
          )}
        </span>

        {isActive && (
          <span className="flex items-center gap-2">
            {transfer.rate > 0 && (
              <span className="text-primary font-medium">{formatRate(transfer.rate)}</span>
            )}
            {transfer.elapsedMs > 0 && (
              <span>{formatTime(transfer.elapsedMs)}</span>
            )}
            {etaSec > 0 && etaSec < 3600 && (
              <span className="opacity-70">{t('tx_remaining')} {formatTime(etaSec * 1000)}</span>
            )}
          </span>
        )}

        <span
          className={cn(
            'font-bold flex-shrink-0',
            isActive && 'text-primary',
            isCompleted && 'text-success',
            isFailed && 'text-destructive',
            isCanceled && 'text-amber-500',
          )}
        >
          {isCanceled ? t('sftp_transfer_canceled') : isFailed ? t('tx_failed') : isCompleted ? t('tx_done') : `${displayPercent}%`}
        </span>
      </div>

      {isActive && (
        <div className="absolute top-2 right-7">
          <QshellLoader size="xs" />
        </div>
      )}
    </div>
  )
}
