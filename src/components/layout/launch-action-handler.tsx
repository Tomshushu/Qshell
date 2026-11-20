import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { FolderUp } from 'lucide-react'
import { isTauri } from '@/services/api'
import { sshService } from '@/services/ssh-service'
import { useAppStore } from '@/store'
import { useTranslation } from '@/i18n'
import { useToast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Server } from '@/types'

export type LaunchAction =
  | { kind: 'openServer'; server: string }
  | { kind: 'openLocal'; cwd?: string | null }
  | { kind: 'transferFiles'; paths: string[]; targetServer?: string | null }
  | { kind: 'execCommand'; server: string; command: string }

function findMatchingServer(servers: Server[], query?: string | null): Server | undefined {
  const clean = query?.trim()
  if (!clean) return undefined
  const byId = servers.find((s) => s.id === clean)
  if (byId) return byId
  const lower = clean.toLowerCase()
  return servers.find((s) => s.name.trim().toLowerCase() === lower)
}

/**
 * 统一消费后端通过 CLI 启动参数、单实例二次唤醒与 `qshell://` Deep Link 下发的动作。
 * 涉及远端命令执行与文件上传时，必须先经用户弹窗确认，禁止静默触发高危操作。
 */
export function LaunchActionHandler() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const servers = useAppStore((s) => s.servers)
  const openTab = useAppStore((s) => s.openTab)
  const openLocalTab = useAppStore((s) => s.openLocalTab)

  const [execQueue, setExecQueue] = useState<Array<{ server: Server; command: string }>>([])
  type PendingTransferItem = {
    paths: string[]
    targetServerId: string
    remoteDir: string
  }
  const [transferQueue, setTransferQueue] = useState<PendingTransferItem[]>([])
  const pendingExec = execQueue[0] ?? null
  const pendingTransfer = transferQueue[0] ?? null
  const setPendingExec = useCallback((next: { server: Server; command: string } | null) => {
    setExecQueue((prev) => (next ? [...prev, next] : prev.slice(1)))
  }, [])
  const setPendingTransfer = useCallback(
    (
      nextOrUpdater:
        | PendingTransferItem
        | null
        | ((prev: PendingTransferItem | null) => PendingTransferItem | null),
    ) => {
      setTransferQueue((prev) => {
        if (typeof nextOrUpdater === 'function') {
          const updated = nextOrUpdater(prev[0] ?? null)
          if (!updated) return prev.slice(1)
          return [updated, ...prev.slice(1)]
        }
        return nextOrUpdater ? [...prev, nextOrUpdater] : prev.slice(1)
      })
    },
    [],
  )
  const [submittingTransfer, setSubmittingTransfer] = useState(false)

  const fileTransferServers = useMemo(
    () =>
      servers.filter(
        (s) =>
          s.targetType === 'linux' ||
          s.targetType === 'windows' ||
          s.targetType === 'unix' ||
          !s.targetType,
      ),
    [servers],
  )

  const handleAction = useCallback(
    (action: LaunchAction) => {
      const currentServers = useAppStore.getState().servers
      switch (action.kind) {
        case 'openServer': {
          const srv = findMatchingServer(currentServers, action.server)
          if (!srv) {
            toast.warning(t('launch_server_not_found').replace('{server}', action.server))
            return
          }
          openTab(srv.id, srv.name, 'terminal')
          break
        }
        case 'openLocal': {
          openLocalTab(undefined, undefined, action.cwd || undefined)
          break
        }
        case 'execCommand': {
          const srv = findMatchingServer(currentServers, action.server)
          if (!srv) {
            toast.warning(t('launch_server_not_found').replace('{server}', action.server))
            return
          }
          setPendingExec({ server: srv, command: action.command })
          break
        }
        case 'transferFiles': {
          if (!action.paths || action.paths.length === 0) return
          const matched = findMatchingServer(currentServers, action.targetServer)
          const fallback =
            matched ||
            currentServers.find(
              (s) =>
                s.targetType === 'linux' ||
                s.targetType === 'windows' ||
                s.targetType === 'unix' ||
                !s.targetType,
            )
          const defaultDir = fallback?.targetType === 'windows' ? 'C:/' : '/tmp'
          setPendingTransfer({
            paths: action.paths,
            targetServerId: fallback?.id ?? '',
            remoteDir: defaultDir,
          })
          break
        }
      }
    },
    [openLocalTab, openTab, t, toast],
  )

  // 冷启动待处理队列：等待服务器列表首次加载或 1.2s 超时后统一取出
  const drainedRef = useRef(false)
  useEffect(() => {
    if (!isTauri || drainedRef.current) return
    const drain = () => {
      if (drainedRef.current) return
      drainedRef.current = true
      void invoke<LaunchAction[]>('app_take_pending_launch_actions')
        .then((actions) => {
          if (Array.isArray(actions)) {
            actions.forEach(handleAction)
          }
        })
        .catch(() => {})
    }
    if (servers.length > 0) {
      drain()
      return
    }
    const timer = window.setTimeout(drain, 1200)
    return () => window.clearTimeout(timer)
  }, [servers.length, handleAction])

  // 热唤醒事件：single-instance 与 deep-link on_open_url
  useEffect(() => {
    if (!isTauri) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void listen<LaunchAction>('app:launch-action', (event) => {
      if (event.payload) {
        handleAction(event.payload)
      }
    }).then((u) => {
      if (disposed) {
        u()
      } else {
        unlisten = u
      }
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [handleAction])

  const confirmTransferUpload = async () => {
    if (!pendingTransfer || !pendingTransfer.targetServerId || submittingTransfer) return
    const srv = servers.find((s) => s.id === pendingTransfer.targetServerId)
    if (!srv) return
    const remoteDir = pendingTransfer.remoteDir.trim() || (srv.targetType === 'windows' ? 'C:/' : '/tmp')
    const paths = pendingTransfer.paths
    setSubmittingTransfer(true)
    try {
      const res = await sshService.uploadFromPaths(srv.id, remoteDir, paths)
      if (res.success) {
        openTab(srv.id, srv.name, 'files')
        toast.success(`${srv.name}: ${paths.length} -> ${remoteDir}`)
        setPendingTransfer(null)
      } else {
        toast.error(res.error || 'Upload failed')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmittingTransfer(false)
    }
  }

  return (
    <>
      <ConfirmDialog
        open={Boolean(pendingExec)}
        onCancel={() => setPendingExec(null)}
        title={t('launch_exec_confirm_title')}
        description={
          pendingExec
            ? t('launch_exec_confirm_desc')
                .replace('{server}', pendingExec.server.name)
                .replace('{command}', pendingExec.command)
            : ''
        }
        variant="destructive"
        onConfirm={() => {
          if (!pendingExec) return
          openTab(
            pendingExec.server.id,
            pendingExec.server.name,
            'terminal',
            pendingExec.command,
          )
          setPendingExec(null)
        }}
      />

      <Dialog
        open={Boolean(pendingTransfer)}
        onOpenChange={(open) => {
          if (!open && !submittingTransfer) setPendingTransfer(null)
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FolderUp className="h-4 w-4 text-primary" />
              {t('launch_transfer_confirm_title')}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {t('launch_transfer_confirm_desc')}
            </DialogDescription>
          </DialogHeader>
          {pendingTransfer && (
            <div className="space-y-3 py-1 text-xs">
              <div className="rounded border border-border/60 bg-muted/40 p-2 max-h-24 overflow-y-auto space-y-1 font-mono text-[11px]">
                {pendingTransfer.paths.map((p) => (
                  <div key={p} className="truncate" title={p}>
                    {p}
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  {t('launch_transfer_target_server')}
                </label>
                <select
                  value={pendingTransfer.targetServerId}
                  onChange={(e) => {
                    const nextId = e.target.value
                    const nextSrv = servers.find((s) => s.id === nextId)
                    setPendingTransfer((prev) =>
                      prev
                        ? {
                            ...prev,
                            targetServerId: nextId,
                            remoteDir:
                              nextSrv?.targetType === 'windows' ? 'C:/' : '/tmp',
                          }
                        : null,
                    )
                  }}
                  className="w-full h-8 text-xs bg-background border border-input rounded px-2"
                >
                  {fileTransferServers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.host})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  {t('launch_transfer_remote_dir')}
                </label>
                <Input
                  value={pendingTransfer.remoteDir}
                  onChange={(e) =>
                    setPendingTransfer((prev) =>
                      prev ? { ...prev, remoteDir: e.target.value } : null,
                    )
                  }
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={submittingTransfer}
              onClick={() => setPendingTransfer(null)}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!pendingTransfer?.targetServerId || submittingTransfer}
              onClick={() => void confirmTransferUpload()}
            >
              {t('launch_transfer_submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
