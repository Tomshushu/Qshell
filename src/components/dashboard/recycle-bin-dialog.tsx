import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '@/i18n'
import { useToast } from '@/components/ui/toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import { sshService } from '@/services/ssh-service'
import type { Server } from '@/types'
import { RotateCcw, Trash2 } from 'lucide-react'

interface RecycleBinDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 恢复/清除后通知外层刷新（如侧栏计数） */
  onChanged?: () => void
}

const TRASH_RETENTION_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export function RecycleBinDialog({ open, onOpenChange, onChanged }: RecycleBinDialogProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [servers, setServers] = useState<Server[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [purgeTargets, setPurgeTargets] = useState<Server[] | null>(null)
  // 渲染期禁止直接调用 Date.now()（纯函数约束），改为状态 + 定时刷新（剩余天数按分钟粒度足够）
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const load = useMemo(
    () => async () => {
      try {
        // 打开时先清理超过保留期的项，再列出待删除服务器
        try {
          await sshService.cleanupTrash(TRASH_RETENTION_DAYS)
        } catch {
          // 清理失败不影响列出
        }
        const list = await sshService.listTrashServers()
        setServers(list)
        setSelected((prev) => {
          const ids = new Set(list.map((s) => s.id))
          const next = new Set<string>()
          prev.forEach((id) => {
            if (ids.has(id)) next.add(id)
          })
          return next
        })
      } catch (e) {
        toast.error(`${t('common_load_failed')}: ${(e as Error).message || e}`)
      }
    },
    [t, toast],
  )

  useEffect(() => {
    // 延迟到宏任务中执行，避免在 effect 内同步 setState 触发级联渲染
    const timer = setTimeout(() => {
      if (open) {
        void load()
      } else {
        setSelected(new Set())
        setPurgeTargets(null)
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [open, load])

  const allSelected = servers.length > 0 && selected.size === servers.length
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(servers.map((s) => s.id)))

  const handleRestore = async () => {
    const ids = [...selected]
    if (ids.length === 0) return
    try {
      const r = await sshService.restoreServersBatch(ids)
      if (r.success) {
        toast.success(t('trash_restored').replace('{count}', String(ids.length)))
        onChanged?.()
      } else {
        toast.error(r.error || t('common_delete_failed'))
      }
    } catch (e) {
      toast.error((e as Error).message || t('common_delete_failed'))
    }
    void load()
  }

  const confirmPurge = async () => {
    const targets = purgeTargets
    if (!targets) return
    const ids = targets.map((s) => s.id)
    try {
      const r = await sshService.purgeServersBatch(ids)
      if (r.success) {
        toast.success(t('trash_purged').replace('{count}', String(ids.length)))
        onChanged?.()
      } else {
        toast.error(r.error || t('common_delete_failed'))
      }
    } catch (e) {
      toast.error((e as Error).message || t('common_delete_failed'))
    }
    setPurgeTargets(null)
    void load()
  }

  const daysLeft = (s: Server): number | null => {
    if (!s.deletedAt) return null
    return Math.max(0, Math.ceil((s.deletedAt + TRASH_RETENTION_DAYS * DAY_MS - now) / DAY_MS))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-amber-500" />
            {t('trash_title')}
            {servers.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">({servers.length})</span>
            )}
          </DialogTitle>
          <DialogDescription>
            {t('trash_auto_cleanup').replace('{days}', String(TRASH_RETENTION_DAYS))}
          </DialogDescription>
        </DialogHeader>

        {servers.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{t('trash_empty')}</div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1 divide-y divide-border/60">
            <label className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="h-3.5 w-3.5 accent-primary"
              />
              {t('trash_select_all')}
            </label>
            {servers.map((s) => {
              const left = daysLeft(s)
              const checked = selected.has(s.id)
              return (
                <label
                  key={s.id}
                  className={cn(
                    'flex items-center gap-2 px-1 py-2 rounded-md cursor-pointer select-none',
                    checked ? 'bg-primary/5' : 'hover:bg-accent/30',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(s.id)}
                    className="h-3.5 w-3.5 accent-primary flex-shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{s.name}</span>
                      <span className="truncate text-xs text-muted-foreground/70">
                        {s.host}
                        {s.port ? `:${s.port}` : ''}
                      </span>
                    </div>
                    {left !== null && (
                      <div className="text-[11px] text-muted-foreground/60">
                        {t('trash_days_left').replace('{days}', String(left))}
                      </div>
                    )}
                  </div>
                </label>
              )
            })}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common_cancel')}
          </Button>
          <Button
            variant="outline"
            disabled={selected.size === 0}
            onClick={handleRestore}
            className="text-emerald-600"
          >
            <RotateCcw className="h-4 w-4" />
            {t('trash_restore_btn')}
            {selected.size > 0 && ` (${selected.size})`}
          </Button>
          <Button
            variant="destructive"
            disabled={selected.size === 0}
            onClick={() => setPurgeTargets(servers.filter((s) => selected.has(s.id)))}
          >
            <Trash2 className="h-4 w-4" />
            {t('trash_purge_btn')}
            {selected.size > 0 && ` (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>

      <ConfirmDialog
        open={!!purgeTargets}
        title={t('trash_purge_confirm_title')}
        description={t('trash_purge_confirm_desc').replace('{count}', String(purgeTargets?.length ?? 0))}
        confirmText={t('trash_purge_btn')}
        variant="destructive"
        onConfirm={confirmPurge}
        onCancel={() => setPurgeTargets(null)}
      />
    </Dialog>
  )
}
