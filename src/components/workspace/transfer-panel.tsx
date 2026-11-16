import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Upload,
  Download,
  ArrowLeftRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  X,
  ArrowUpDown,
  Trash2,
  Pause,
  Play,
  Ban,
  Clock,
  Filter,
} from 'lucide-react'
import { sshService } from '@/services/ssh-service'
import {
  acquireTransferQueueListeners,
  useTransferQueueStore,
  type UnifiedTransferPriority,
  type UnifiedTransferTask,
} from '@/store/transfer-queue-store'
import { QshellLoader } from '@/components/ui/qshell-loader'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'

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

type TabType = 'upload' | 'download' | 's2s'

const NEXT_PRIORITY: Record<UnifiedTransferPriority, UnifiedTransferPriority> = {
  normal: 'high',
  high: 'low',
  low: 'normal',
}

/** 跨挂载周期记录已处理的新任务通知序号（-1 表示尚未初始化），避免面板卸载期间的通知丢失 */
let lastHandledIncomingSeq = -1;

export function TransferPanel() {
  const { t } = useTranslation()
  const tasks = useTransferQueueStore((s) => s.tasks)
  const incomingSeq = useTransferQueueStore((s) => s._incomingSeq)
  const incomingDirection = useTransferQueueStore((s) => s._incomingDirection)
  const setPriority = useTransferQueueStore((s) => s.setPriority)
  const pauseTask = useTransferQueueStore((s) => s.pauseTask)
  const resumeTask = useTransferQueueStore((s) => s.resumeTask)
  const updateTask = useTransferQueueStore((s) => s.updateTask)
  const cancelTask = useTransferQueueStore((s) => s.cancelTask)
  const removeTask = useTransferQueueStore((s) => s.removeTask)
  const clearCompleted = useTransferQueueStore((s) => s.clearCompleted)
  const clearAll = useTransferQueueStore((s) => s.clearAll)

  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('upload')
  const [now, setNow] = useState(() => Date.now())
  // 用模块级变量记录已处理的 seq：TransferPanel 仅在文件面板打开时挂载，
  // 若用组件内 ref 初始化快照，挂载前产生的新任务通知会被吞掉。
  const handledIncomingSeqRef = useRef(lastHandledIncomingSeq)

  // 通过引用计数单例订阅后端传输进度与目录失败明细事件，避免多处重复入库
  useEffect(() => {
    return acquireTransferQueueListeners(sshService)
  }, [])

  // 当收到新进传输任务时自动展开面板并聚焦对应标签页
  useEffect(() => {
    if (handledIncomingSeqRef.current < 0) {
      // 首次挂载：仅记录当前 seq，不因历史通知自动展开
      handledIncomingSeqRef.current = incomingSeq
      lastHandledIncomingSeq = incomingSeq
      return
    }
    if (incomingSeq > handledIncomingSeqRef.current) {
      handledIncomingSeqRef.current = incomingSeq
      lastHandledIncomingSeq = incomingSeq
      setIsOpen(true)
      if (incomingDirection) {
        setActiveTab(incomingDirection)
      }
    }
  }, [incomingSeq, incomingDirection])

  // 进行中任务超过 2s 无进度事件时自动衰减速率至 0
  const hasTransferringTasks = tasks.some((item) => item.status === 'transferring')
  useEffect(() => {
    if (!hasTransferringTasks) return
    const timer = window.setInterval(() => {
      useTransferQueueStore.getState().decayStaleSpeeds()
    }, 1000)
    return () => window.clearInterval(timer)
  }, [hasTransferringTasks])

  // 仅当存在 scheduled 或 queued 任务时运行队列调度器定时器
  const hasPendingSchedulerTasks = tasks.some(
    (item) => item.status === 'scheduled' || item.status === 'queued',
  )
  useEffect(() => {
    if (!hasPendingSchedulerTasks) return
    const timer = window.setInterval(() => {
      useTransferQueueStore.getState().tickScheduler()
    }, 1000)
    return () => window.clearInterval(timer)
  }, [hasPendingSchedulerTasks])

  // 面板展开且存在定时倒计时或进行中任务时每秒刷新展示时钟
  const hasClockDrivenTasks = tasks.some(
    (item) => item.status === 'scheduled' || item.status === 'transferring',
  )
  useEffect(() => {
    if (!isOpen || !hasClockDrivenTasks) return
    const timer = window.setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isOpen, hasClockDrivenTasks])

  const handleCyclePriority = useCallback(
    (task: UnifiedTransferTask) => {
      setPriority(task.id, NEXT_PRIORITY[task.priority])
    },
    [setPriority],
  )

  const handlePause = useCallback(
    (task: UnifiedTransferTask) => {
      const store = useTransferQueueStore.getState()
      const liveTask = store.tasks.find((item) => item.id === task.id)
      const wasTransferring = (liveTask ?? task).status === 'transferring'
      pauseTask(task.id)
      if (wasTransferring && store.isTaskPaused(task.id)) {
        sshService.cancelTransfer(task.id).catch((err) => {
          console.warn('Failed to pause transfer:', err)
        })
      }
    },
    [pauseTask],
  )

  const handleResume = useCallback(
    (task: UnifiedTransferTask) => {
      const isSingleFileResumable = Boolean(
        task.tmpPath &&
          task.localPath &&
          task.remotePath &&
          task.serverId &&
          (task.direction === 'upload' || task.direction === 'download'),
      )

      if (typeof task.startFn === 'function') {
        resumeTask(task.id)
        useTransferQueueStore.getState().tickScheduler()
        return
      }

      if (!isSingleFileResumable) {
        updateTask(task.id, {
          status: 'failed',
          error: '该任务不支持断点续传，请重新发起传输',
          speedBytesPerSec: 0,
          etaSeconds: undefined,
        })
        return
      }

      const startResumeTransfer = () => {
        updateTask(task.id, { status: 'transferring', error: undefined })
        if (typeof sshService.registerActiveTransfer === 'function') {
          try {
            sshService.registerActiveTransfer({
              transferId: task.id,
              serverId: task.serverId,
              fileName: task.fileName,
              type: task.direction,
              tmpPath: task.tmpPath!,
              isUpload: task.direction === 'upload',
            })
          } catch (err) {
            console.warn('Failed to register resumed transfer:', err)
          }
        }
        const op =
          task.direction === 'upload'
            ? sshService.resumeUpload(
                task.serverId,
                task.localPath!,
                task.remotePath!,
                task.tmpPath!,
                task.transferredBytes,
                task.id,
                task.totalBytes > 0 ? task.totalBytes : undefined,
              )
            : sshService.resumeDownload(
                task.serverId,
                task.remotePath!,
                task.localPath!,
                task.tmpPath!,
                task.transferredBytes,
                task.id,
              )
        return op
          .then((res) => {
            if (typeof sshService.unregisterActiveTransfer === 'function') {
              try {
                sshService.unregisterActiveTransfer(task.id)
              } catch {
                // ignore
              }
            }
            if (res && typeof res === 'object' && 'success' in res && !res.success) {
              const current = useTransferQueueStore
                .getState()
                .tasks.find((item) => item.id === task.id)
              if (current && current.status === 'transferring') {
                updateTask(task.id, {
                  status: 'failed',
                  error:
                    ('error' in res && typeof res.error === 'string' && res.error) ||
                    'Resume failed',
                  speedBytesPerSec: 0,
                  etaSeconds: undefined,
                })
              }
              useTransferQueueStore.getState().tickScheduler()
            }
          })
          .catch((err) => {
            if (typeof sshService.unregisterActiveTransfer === 'function') {
              try {
                sshService.unregisterActiveTransfer(task.id)
              } catch {
                // ignore
              }
            }
            const current = useTransferQueueStore
              .getState()
              .tasks.find((item) => item.id === task.id)
            if (current && current.status === 'transferring') {
              const msg = err instanceof Error ? err.message : String(err)
              updateTask(task.id, {
                status: 'failed',
                error: msg || 'Resume failed',
                speedBytesPerSec: 0,
                etaSeconds: undefined,
              })
            }
            useTransferQueueStore.getState().tickScheduler()
            console.warn('Failed to resume transfer:', err)
          })
      }

      const storeState = useTransferQueueStore.getState()
      const activeCount = storeState.tasks.filter(
        (item) => item.id !== task.id && item.status === 'transferring',
      ).length
      if (activeCount >= storeState.maxConcurrent) {
        resumeTask(task.id)
        updateTask(task.id, {
          status: 'queued',
          error: undefined,
          startFn: async () => {
            await startResumeTransfer()
          },
        })
        useTransferQueueStore.getState().tickScheduler()
        return
      }

      resumeTask(task.id)
      void startResumeTransfer()
    },
    [resumeTask, updateTask],
  )

  const handleClearAll = useCallback(() => {
    const allTasks = useTransferQueueStore.getState().tasks
    for (const item of allTasks) {
      if (item.status === 'transferring') {
        sshService.cancelTransfer(item.id).catch((err) => {
          console.warn('Failed to cancel active transfer during clearAll:', err)
        })
      }
      if (
        item.tmpPath &&
        item.serverId &&
        item.direction !== 's2s' &&
        typeof sshService.cleanupTmpFile === 'function'
      ) {
        sshService
          .cleanupTmpFile(item.serverId, item.tmpPath, item.direction === 'upload')
          .catch(() => {})
      }
    }
    clearAll()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('qshell:transfer-queue-cleared'))
    }
  }, [clearAll])

  const handleCancel = useCallback(
    (task: UnifiedTransferTask) => {
      const wasTransferring = task.status === 'transferring'
      cancelTask(task.id)
      if (wasTransferring) {
        sshService.cancelTransfer(task.id).catch((err) => {
          console.warn('Failed to cancel transfer:', err)
        })
      }
      if (
        task.tmpPath &&
        task.serverId &&
        task.direction !== 's2s' &&
        typeof sshService.cleanupTmpFile === 'function'
      ) {
        sshService
          .cleanupTmpFile(task.serverId, task.tmpPath, task.direction === 'upload')
          .catch(() => {})
      }
    },
    [cancelTask],
  )

  const handleRemove = useCallback(
    (task: UnifiedTransferTask) => {
      if (
        (task.status === 'failed' || task.status === 'paused') &&
        task.tmpPath &&
        task.serverId &&
        task.direction !== 's2s' &&
        typeof sshService.cleanupTmpFile === 'function'
      ) {
        sshService
          .cleanupTmpFile(task.serverId, task.tmpPath, task.direction === 'upload')
          .catch(() => {})
      }
      removeTask(task.id)
    },
    [removeTask],
  )

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

  // 按方向分组
  const uploadTasks = tasks.filter((item) => item.direction === 'upload')
  const downloadTasks = tasks.filter((item) => item.direction === 'download')
  const s2sTasks = tasks.filter((item) => item.direction === 's2s')
  const currentTabTasks =
    activeTab === 'upload'
      ? uploadTasks
      : activeTab === 'download'
        ? downloadTasks
        : s2sTasks

  const uploadActiveCount = uploadTasks.filter((item) => item.status === 'transferring').length
  const downloadActiveCount = downloadTasks.filter((item) => item.status === 'transferring').length
  const s2sActiveCount = s2sTasks.filter((item) => item.status === 'transferring').length
  const activeCount = uploadActiveCount + downloadActiveCount + s2sActiveCount
  const pendingCount = tasks.filter(
    (item) => item.status === 'queued' || item.status === 'scheduled',
  ).length
  const badgeCount = activeCount > 0 ? activeCount : pendingCount

  const currentTabActive = currentTabTasks.filter((item) => item.status === 'transferring').length
  const currentTabQueued = currentTabTasks.filter((item) => item.status === 'queued').length
  const currentTabScheduled = currentTabTasks.filter((item) => item.status === 'scheduled').length
  const currentTabCompleted = currentTabTasks.filter((item) => item.status === 'completed').length
  const currentTabPartial = currentTabTasks.filter((item) => item.status === 'partial').length
  const currentTabFailed = currentTabTasks.filter((item) => item.status === 'failed').length

  const totalRate = currentTabTasks
    .filter((item) => item.status === 'transferring')
    .reduce((sum, item) => sum + item.speedBytesPerSec, 0)

  const emptyLabel =
    activeTab === 'upload'
      ? t('tx_empty_upload')
      : activeTab === 'download'
        ? t('tx_empty_download')
        : t('tx_empty_s2s')

  const emptyHintTitle =
    activeTab === 'upload'
      ? t('tx_empty_upload_hint')
      : activeTab === 'download'
        ? t('tx_empty_download_hint')
        : t('tx_empty_s2s_hint')

  const emptyHintDesc =
    activeTab === 'upload'
      ? t('tx_upload_hint')
      : activeTab === 'download'
        ? t('tx_download_hint')
        : t('tx_s2s_hint')

  return (
    <div className={cn('relative', isOpen && 'z-40')} ref={panelRef}>
      {/* 切换按钮 */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'relative flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent/50 transition-colors cursor-pointer',
          isOpen && 'bg-accent/50',
        )}
        title={t('tx_title')}
        aria-label={t('tx_title')}
      >
        <ArrowUpDown
          className={cn(
            'h-4 w-4',
            activeCount > 0
              ? 'text-primary animate-pulse'
              : pendingCount > 0
                ? 'text-amber-500'
                : 'text-muted-foreground',
          )}
        />
        {badgeCount > 0 && (
          <span
            className={cn(
              'absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full text-[10px] font-bold px-1',
              activeCount > 0
                ? 'bg-primary text-primary-foreground'
                : 'bg-amber-500 text-white',
            )}
          >
            {badgeCount}
          </span>
        )}
      </button>

      {/* 面板 */}
      {isOpen && (
        <Card className="theme-floating-panel absolute top-full right-0 mt-1 z-popup w-96 max-w-[calc(100vw-1rem)] border-border/60 h-[min(520px,calc(100vh-76px))] flex flex-col bg-popover/98 backdrop-blur-xl shadow-2xl">
          {/* Tab 切换：upload / download / s2s */}
          <div className="flex border-b flex-shrink-0" role="tablist">
            <TabButton
              active={activeTab === 'upload'}
              onClick={() => setActiveTab('upload')}
              icon={<Upload className="h-3.5 w-3.5" />}
              label={t('tx_tab_upload')}
              count={uploadTasks.length}
              activeCount={uploadActiveCount}
            />
            <TabButton
              active={activeTab === 'download'}
              onClick={() => setActiveTab('download')}
              icon={<Download className="h-3.5 w-3.5" />}
              label={t('tx_tab_download')}
              count={downloadTasks.length}
              activeCount={downloadActiveCount}
            />
            <TabButton
              active={activeTab === 's2s'}
              onClick={() => setActiveTab('s2s')}
              icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
              label={t('tx_tab_s2s')}
              count={s2sTasks.length}
              activeCount={s2sActiveCount}
            />
          </div>

          {/* 头部统计 */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b flex-shrink-0 bg-card/50">
            <div className="flex items-center gap-1.5 text-[11px] flex-wrap">
              {currentTabActive > 0 && (
                <span className="text-primary font-medium">
                  {t('tx_n_in_progress').replace('{n}', String(currentTabActive))}
                </span>
              )}
              {currentTabQueued > 0 && (
                <span className="text-muted-foreground font-medium">
                  {t('tx_n_queued').replace('{n}', String(currentTabQueued))}
                </span>
              )}
              {currentTabScheduled > 0 && (
                <span className="text-amber-500 font-medium">
                  {t('tx_n_scheduled').replace('{n}', String(currentTabScheduled))}
                </span>
              )}
              {currentTabCompleted > 0 && (
                <span className="text-success">
                  {t('tx_n_done').replace('{n}', String(currentTabCompleted))}
                </span>
              )}
              {currentTabPartial > 0 && (
                <span className="text-amber-500 font-medium">
                  {t('sftp_transfer_partial')} ({currentTabPartial})
                </span>
              )}
              {currentTabFailed > 0 && (
                <span className="text-destructive">
                  {t('tx_n_failed').replace('{n}', String(currentTabFailed))}
                </span>
              )}
              {currentTabTasks.length === 0 && (
                <span className="text-muted-foreground">{emptyLabel}</span>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {currentTabActive > 0 && totalRate > 0 && (
                <span className="text-[11px] text-muted-foreground mr-1 tabular-nums">
                  {formatRate(totalRate)}
                </span>
              )}
              {tasks.some(
                (item) =>
                  item.status === 'completed' ||
                  item.status === 'partial' ||
                  item.status === 'skipped',
              ) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={clearCompleted}
                >
                  {t('tx_clear_done')}
                </Button>
              )}
              {tasks.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={handleClearAll}
                  title={t('tx_clear_all')}
                  aria-label={t('tx_clear_all')}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>

          {/* 传输列表 */}
          <ScrollArea className="flex-1 min-h-0">
            {currentTabTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                {activeTab === 'upload' ? (
                  <Upload className="h-10 w-10 mb-2 opacity-20" />
                ) : activeTab === 'download' ? (
                  <Download className="h-10 w-10 mb-2 opacity-20" />
                ) : (
                  <ArrowLeftRight className="h-10 w-10 mb-2 opacity-20" />
                )}
                <p className="text-sm">{emptyHintTitle}</p>
                <p className="text-[11px] mt-1 opacity-70">{emptyHintDesc}</p>
              </div>
            ) : (
              <div className="p-1.5 space-y-1">
                {currentTabTasks.map((task) => (
                  <TransferRow
                    key={task.id}
                    task={task}
                    now={now}
                    onCyclePriority={handleCyclePriority}
                    onPause={handlePause}
                    onResume={handleResume}
                    onCancel={handleCancel}
                    onRemove={handleRemove}
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
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex-1 flex items-center justify-center gap-1 py-2 px-1 text-xs font-medium transition-colors relative cursor-pointer',
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

function PriorityBadge({
  priority,
  onClick,
}: {
  priority: UnifiedTransferPriority
  onClick: () => void
}) {
  const { t } = useTranslation()
  const label =
    priority === 'high'
      ? t('tx_priority_high')
      : priority === 'low'
        ? t('tx_priority_low')
        : t('tx_priority_normal')

  return (
    <button
      type="button"
      onClick={onClick}
      title={t('tx_priority_toggle_hint')}
      aria-label={`${t('tx_priority_toggle_hint')}: ${label}`}
      className={cn(
        'px-1.5 py-0.5 rounded text-[9px] font-semibold border transition-colors cursor-pointer flex-shrink-0',
        priority === 'high' &&
          'bg-rose-500/15 text-rose-500 border-rose-500/30 hover:bg-rose-500/25',
        priority === 'normal' &&
          'bg-primary/10 text-primary border-primary/25 hover:bg-primary/20',
        priority === 'low' &&
          'bg-muted text-muted-foreground border-border/60 hover:bg-accent',
      )}
    >
      {label}
    </button>
  )
}

function TransferRow({
  task,
  now,
  onCyclePriority,
  onPause,
  onResume,
  onCancel,
  onRemove,
}: {
  task: UnifiedTransferTask
  now: number
  onCyclePriority: (task: UnifiedTransferTask) => void
  onPause: (task: UnifiedTransferTask) => void
  onResume: (task: UnifiedTransferTask) => void
  onCancel: (task: UnifiedTransferTask) => void
  onRemove: (task: UnifiedTransferTask) => void
}) {
  const { t } = useTranslation()
  const isActive = task.status === 'transferring'
  const isQueued = task.status === 'queued'
  const isScheduled = task.status === 'scheduled'
  const isPaused = task.status === 'paused'
  const isPartial = task.status === 'partial'
  const isSkipped = task.status === 'skipped'
  const isCompleted = task.status === 'completed'
  const isFailed = task.status === 'failed'
  const isCanceled = task.status === 'cancelled'
  const isTerminal = isCompleted || isPartial || isSkipped || isFailed || isCanceled

  const rawPercent =
    task.totalBytes > 0
      ? Math.round((task.transferredBytes / task.totalBytes) * 100)
      : isCompleted
        ? 100
        : 0
  const displayPercent = isCompleted
    ? 100
    : isActive
      ? Math.min(99, rawPercent)
      : rawPercent

  const isFileCount =
    task.totalBytes > 0 &&
    (task.totalType === 'files' ||
      task.totalType === 'count' ||
      Boolean(task.isDirectory))

  const elapsedMs = Math.max(0, now - task.createdAt)
  const scheduledRemainingMs =
    isScheduled && task.scheduledAt !== undefined
      ? Math.max(0, task.scheduledAt - now)
      : null

  const showPriorityBadge = isActive || isQueued || isScheduled || isPaused
  const canPause = isActive || isQueued || isScheduled
  const canResume = isPaused || isFailed
  const canCancel = isActive || isQueued || isScheduled || isPaused

  const renderLeadingIcon = () => {
    if (isCompleted) return <CheckCircle2 className="h-4 w-4 text-success" />
    if (isPartial) return <AlertTriangle className="h-4 w-4 text-amber-500" />
    if (isSkipped) return <Ban className="h-4 w-4 text-muted-foreground" />
    if (isFailed) return <XCircle className="h-4 w-4 text-destructive" />
    if (isCanceled) return <XCircle className="h-4 w-4 text-amber-500" />
    if (isPaused) return <Pause className="h-4 w-4 text-blue-500" />
    if (isScheduled) return <Clock className="h-4 w-4 text-amber-500" />
    if (isQueued) return <Clock className="h-4 w-4 text-muted-foreground" />
    if (task.direction === 'upload') return <Upload className="h-4 w-4 text-primary" />
    if (task.direction === 'download') return <Download className="h-4 w-4 text-primary" />
    return <ArrowLeftRight className="h-4 w-4 text-purple-500" />
  }

  const statusText = (() => {
    if (isCanceled) return t('sftp_transfer_canceled')
    if (isPartial) return t('sftp_transfer_partial')
    if (isSkipped) return t('sftp_transfer_skipped')
    if (isFailed) return t('tx_failed')
    if (isCompleted) return t('tx_done')
    if (isPaused) return t('sftp_transfer_paused')
    if (isQueued) return t('tx_status_queued')
    if (isScheduled) {
      if (scheduledRemainingMs !== null && scheduledRemainingMs > 0) {
        return t('tx_scheduled_in', { time: formatTime(scheduledRemainingMs) })
      }
      return t('tx_scheduled_soon')
    }
    return `${displayPercent}%`
  })()

  return (
    <div
      className={cn(
        'rounded-md px-2.5 py-2 transition-colors group relative border border-transparent',
        isActive && 'bg-primary/5 border-primary/15',
        isScheduled && 'bg-amber-500/5 border-amber-500/15',
        isPaused && 'bg-blue-500/5 border-blue-500/15',
        isPartial && 'bg-amber-500/5 border-amber-500/20',
        (isCompleted || isSkipped) && 'opacity-75',
        isFailed && 'bg-red-500/5 border-red-500/15',
        isCanceled && 'bg-amber-500/5',
      )}
    >
      {/* 第 1 行：图标 + 文件名 + 优先级徽章 + 动作按钮 */}
      <div className="flex items-center gap-1.5 mb-1">
        <div className="flex-shrink-0">{renderLeadingIcon()}</div>
        <span
          className="text-xs truncate flex-1 leading-tight font-medium"
          title={task.fileName}
        >
          {task.fileName}
        </span>

        {isPartial && (
          <Badge
            variant="soft-warning"
            className="px-1.5 py-0 text-[9px] flex-shrink-0"
          >
            {t('sftp_transfer_partial')}
          </Badge>
        )}

        {showPriorityBadge && (
          <PriorityBadge
            priority={task.priority}
            onClick={() => onCyclePriority(task)}
          />
        )}

        {isActive && (
          <div className="flex-shrink-0">
            <QshellLoader size="xs" />
          </div>
        )}

        <div className="flex items-center gap-0.5 flex-shrink-0">
          {canPause && (
            <button
              type="button"
              onClick={() => onPause(task)}
              className="p-0.5 rounded hover:bg-accent text-blue-500 cursor-pointer"
              title={t('sftp_transfer_pause')}
              aria-label={t('sftp_transfer_pause')}
            >
              <Pause className="h-3 w-3" />
            </button>
          )}
          {canResume && (
            <button
              type="button"
              onClick={() => onResume(task)}
              className="p-0.5 rounded hover:bg-accent text-emerald-500 cursor-pointer"
              title={t('sftp_transfer_resume')}
              aria-label={t('sftp_transfer_resume')}
            >
              <Play className="h-3 w-3" />
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              onClick={() => onCancel(task)}
              className="p-0.5 rounded hover:bg-accent text-amber-500 cursor-pointer"
              title={t('sftp_transfer_cancel')}
              aria-label={t('sftp_transfer_cancel')}
            >
              <Ban className="h-3 w-3" />
            </button>
          )}
          {isTerminal && (
            <button
              type="button"
              onClick={() => onRemove(task)}
              className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
              title={t('tx_remove')}
              aria-label={t('tx_remove')}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* 过滤规则摘要提示（如有） */}
      {task.filterSummary && (
        <div
          className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1 truncate"
          title={task.filterSummary}
        >
          <Filter className="h-2.5 w-2.5 flex-shrink-0 opacity-70" />
          <span className="truncate">
            {t('tx_filter_hint', { summary: task.filterSummary })}
          </span>
        </div>
      )}

      {/* 第 2 行：进度条 */}
      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mb-1.5">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300',
            isFailed && 'bg-red-500',
            isCompleted && 'bg-green-500',
            isActive && 'bg-primary',
            isPaused && 'bg-blue-500',
            (isPartial || isCanceled || isScheduled) && 'bg-amber-500',
            (isQueued || isSkipped) && 'bg-muted-foreground/40',
          )}
          style={{ width: `${displayPercent}%` }}
        />
      </div>

      {/* 第 3 行：统计信息 */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums gap-2">
        <span>
          {isFileCount ? (
            <>
              <span className="text-foreground font-medium">{task.transferredBytes}</span>
              /{task.totalBytes} {t('tx_files')}
            </>
          ) : (
            <>
              <span className="text-foreground font-medium">{formatSize(task.transferredBytes)}</span>
              /{formatSize(task.totalBytes)}
            </>
          )}
        </span>

        {isActive && (
          <span className="flex items-center gap-2">
            {task.speedBytesPerSec > 0 && (
              <span className="text-primary font-medium">{formatRate(task.speedBytesPerSec)}</span>
            )}
            {elapsedMs > 0 && <span>{formatTime(elapsedMs)}</span>}
            {task.etaSeconds !== undefined && task.etaSeconds > 0 && task.etaSeconds < 3600 && (
              <span className="opacity-70">
                {t('tx_remaining')} {formatTime(task.etaSeconds * 1000)}
              </span>
            )}
          </span>
        )}

        <span
          className={cn(
            'font-bold flex-shrink-0',
            isActive && 'text-primary',
            isCompleted && 'text-success',
            isFailed && 'text-destructive',
            (isPartial || isCanceled || isScheduled) && 'text-amber-500',
            isPaused && 'text-blue-500',
            (isQueued || isSkipped) && 'text-muted-foreground',
          )}
        >
          {statusText}
        </span>
      </div>

      {task.error && (
        <div
          className="mt-1 text-[10px] text-destructive/90 truncate"
          title={task.error}
        >
          {task.error}
        </div>
      )}
    </div>
  )
}
