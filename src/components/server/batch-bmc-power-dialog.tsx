/**
 * 批量 BMC 电源操作弹窗
 *
 * 从首页多选的服务器中过滤出 BMC 类型，选择一种电源动作后并行下发。
 * 危险操作：需明确选择动作 + 列出全部目标服务器确认。
 */

import { useState } from 'react'
import { useTranslation } from '@/i18n'
import { backend } from '@/services/api'
import { playSound, SoundType } from '@/lib/sound'
import type { Server } from '@/types'
import type { BmcPowerAction } from '@/services/api/types'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Power,
  Moon,
  RotateCw,
  PowerOff,
  ServerCog,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react'

/** 批量场景的常用动作（完整 7 种动作请到单机 BMC 面板执行） */
const BATCH_ACTIONS: {
  action: BmcPowerAction
  labelKey: string
  icon: React.ComponentType<{ className?: string }>
  destructive: boolean
}[] = [
  { action: 'on', labelKey: 'bmc_power_on', icon: Power, destructive: false },
  { action: 'gracefulShutdown', labelKey: 'bmc_power_graceful_shutdown', icon: Moon, destructive: true },
  { action: 'forceRestart', labelKey: 'bmc_power_force_restart', icon: RotateCw, destructive: true },
  { action: 'forceOff', labelKey: 'bmc_power_force_off', icon: PowerOff, destructive: true },
]

interface BatchBmcPowerDialogProps {
  open: boolean
  /** 已过滤为 BMC 类型的选中服务器 */
  servers: Server[]
  onClose: () => void
}

export function BatchBmcPowerDialog({ open, servers, onClose }: BatchBmcPowerDialogProps) {
  const { t } = useTranslation()
  const [action, setAction] = useState<BmcPowerAction | null>(null)
  const [executing, setExecuting] = useState(false)
  // 结果：null=未执行；{ok, failed:[{name, error}]}
  const [result, setResult] = useState<{ ok: number; failed: Array<{ name: string; error: string }> } | null>(null)

  const handleExecute = async () => {
    if (!action || executing) return
    setExecuting(true)
    playSound(SoundType.Warn)
    try {
      const settled = await Promise.allSettled(
        servers.map(async (s) => {
          const r = await backend?.bmc.powerAction(s.id, action)
          if (!r?.success) throw new Error(r?.error || t('bmc_power_failed'))
          return s
        }),
      )
      const ok = settled.filter((r) => r.status === 'fulfilled').length
      const failed: Array<{ name: string; error: string }> = []
      settled.forEach((r, i) => {
        if (r.status === 'rejected') {
          failed.push({
            name: servers[i].name,
            error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          })
        }
      })
      setResult({ ok, failed })
      if (failed.length === 0) {
        playSound(SoundType.Confirm)
      }
    } finally {
      setExecuting(false)
    }
  }

  const handleClose = () => {
    // 关闭时重置（下次打开回到选择态）
    setResult(null)
    setAction(null)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-1.5">
            <ServerCog className="h-4 w-4 text-primary" />
            {t('bmc_batch_title')}
          </DialogTitle>
          <DialogDescription>
            {t('bmc_batch_desc_prefix')}
            <span className="mx-0.5 font-medium text-foreground">{servers.length}</span>
            {t('bmc_batch_desc_suffix')}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          /* ============ 结果态 ============ */
          <div className="space-y-2">
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-emerald-500">
                <CheckCircle2 className="h-4 w-4" />
                {t('bmc_batch_success')} {result.ok}
              </span>
              {result.failed.length > 0 && (
                <span className="flex items-center gap-1.5 text-red-500">
                  <XCircle className="h-4 w-4" />
                  {t('bmc_batch_failed')} {result.failed.length}
                </span>
              )}
            </div>
            {result.failed.length > 0 && (
              <div className="rounded-md border border-border/60 max-h-[200px] overflow-y-auto">
                {result.failed.map((f) => (
                  <div key={f.name} className="px-3 py-1.5 border-b border-border/30 last:border-0">
                    <p className="text-xs font-medium truncate">{f.name}</p>
                    <p className="text-[11px] text-muted-foreground break-all">{f.error}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end pt-1">
              <Button variant="outline" size="sm" onClick={handleClose}>{t('ed_ok')}</Button>
            </div>
          </div>
        ) : (
          /* ============ 选择态 ============ */
          <div className="space-y-3">
            {/* 动作选择 */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">{t('bmc_batch_action')}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {BATCH_ACTIONS.map(({ action: a, labelKey, icon: Icon, destructive }) => (
                  <button
                    key={a}
                    type="button"
                    disabled={executing}
                    onClick={() => { setAction(a); playSound(SoundType.Toggle) }}
                    className={cn(
                      'flex items-center justify-center gap-1.5 h-8 rounded-md border text-xs font-medium transition-colors',
                      action === a
                        ? destructive
                          ? 'border-red-500/60 bg-red-500/10 text-red-600 dark:text-red-400'
                          : 'border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            </div>

            {/* 目标列表 */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">{t('bmc_batch_targets')}</p>
              <div className="rounded-md border border-border/60 max-h-[140px] overflow-y-auto">
                {servers.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30 last:border-0 text-xs">
                    <ServerCog className="h-3 w-3 text-orange-500 flex-shrink-0" />
                    <span className="font-medium truncate">{s.name}</span>
                    <span className="ml-auto text-muted-foreground tabular-nums flex-shrink-0">{s.host}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" disabled={executing} onClick={handleClose}>
                {t('cd_default_cancel')}
              </Button>
              <Button
                size="sm"
                variant={action && BATCH_ACTIONS.find((x) => x.action === action)?.destructive ? 'destructive' : 'default'}
                disabled={!action || executing}
                onClick={() => void handleExecute()}
              >
                {executing
                  ? <RefreshCw className="h-3 w-3 animate-spin" />
                  : null}
                {t('bmc_batch_execute')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
