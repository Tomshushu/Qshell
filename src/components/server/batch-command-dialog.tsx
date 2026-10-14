/**
 * 批量命令执行弹窗（P0-4）
 *
 * 从首页多选的服务器中过滤出可执行 SSH 命令的目标（排除 BMC 类型），
 * 输入命令后并发下发。每台服务器执行结果实时显示在表格中。
 *
 * 复用 BatchBmcPowerDialog 的交互模式：选择态 -> 执行中 -> 结果态。
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from '@/i18n'
import { backend } from '@/services/api'
import { playSound, SoundType } from '@/lib/sound'
import type { Server } from '@/types'
import type { BatchExecuteItem, BatchExecuteResult } from '@/services/api'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  TerminalSquare,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Copy,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'

interface BatchCommandDialogProps {
  open: boolean
  /** 已过滤为可执行 SSH 命令的选中服务器（非 BMC） */
  servers: Server[]
  onClose: () => void
}

/** 单台结果展示（含展开状态） */
interface ResultRow extends BatchExecuteItem {
  name: string
  host: string
  expanded: boolean
}

export function BatchCommandDialog({ open, servers, onClose }: BatchCommandDialogProps) {
  const { t } = useTranslation()
  const [command, setCommand] = useState('')
  const [timeoutSecs, setTimeoutSecs] = useState(30)
  const [executing, setExecuting] = useState(false)
  // 已完成的结果（按完成顺序填充，serverId -> ResultRow）
  const [results, setResults] = useState<Map<string, ResultRow>>(new Map())
  // 完成数量，用于显示进度
  const [doneCount, setDoneCount] = useState(0)
  const unlistenRef = useRef<(() => void) | null>(null)

  // 订阅批量执行进度事件
  useEffect(() => {
    if (!open || !executing) return
    if (!backend) return
    const unsub = backend.ssh.onBatchExecuteProgress((data) => {
      const server = servers.find((s) => s.id === data.serverId)
      if (!server) return
      setResults((prev) => {
        const next = new Map(prev)
        next.set(data.serverId, {
          ...data.item,
          name: server.name,
          host: server.host,
          expanded: prev.get(data.serverId)?.expanded ?? false,
        })
        return next
      })
      setDoneCount((c) => c + 1)
    })
    unlistenRef.current = unsub
    return () => {
      unsub()
      unlistenRef.current = null
    }
  }, [open, executing, servers])

  // 关闭时重置状态
  const handleClose = () => {
    unlistenRef.current?.()
    unlistenRef.current = null
    setResults(new Map())
    setDoneCount(0)
    setExecuting(false)
    setCommand('')
    setTimeoutSecs(30)
    onClose()
  }

  const handleExecute = async () => {
    if (!command.trim() || executing || servers.length === 0) return
    if (!backend) return
    setExecuting(true)
    setResults(new Map())
    setDoneCount(0)
    playSound(SoundType.Warn)
    try {
      const result: BatchExecuteResult = await backend.ssh.batchExecute(
        servers.map((s) => s.id),
        command.trim(),
        timeoutSecs,
      )
      // 用最终结果覆盖（保证顺序与去重一致性）
      const finalMap = new Map<string, ResultRow>()
      for (const item of result.items) {
        const server = servers.find((s) => s.id === item.serverId)
        if (!server) continue
        finalMap.set(item.serverId, {
          ...item,
          name: server.name,
          host: server.host,
          expanded: false,
        })
      }
      setResults(finalMap)
      setDoneCount(result.total)
      if (result.failed === 0) {
        playSound(SoundType.Confirm)
      }
    } catch (e) {
      // 整体失败：把错误铺到所有服务器
      const errMap = new Map<string, ResultRow>()
      const errMsg = e instanceof Error ? e.message : String(e)
      for (const s of servers) {
        errMap.set(s.id, {
          serverId: s.id,
          success: false,
          stdout: '',
          stderr: '',
          exitCode: -1,
          error: errMsg,
          name: s.name,
          host: s.host,
          expanded: false,
        })
      }
      setResults(errMap)
      setDoneCount(servers.length)
    } finally {
      setExecuting(false)
    }
  }

  const handleToggleExpand = (serverId: string) => {
    setResults((prev) => {
      const next = new Map(prev)
      const row = next.get(serverId)
      if (row) {
        next.set(serverId, { ...row, expanded: !row.expanded })
      }
      return next
    })
  }

  const handleCopyOutput = (row: ResultRow) => {
    const output = row.stdout || row.stderr || row.error || ''
    if (output) {
      void navigator.clipboard.writeText(output)
    }
  }

  const total = servers.length
  const succeeded = useMemo(() => Array.from(results.values()).filter((r) => r.success).length, [results])
  const failed = results.size - succeeded
  const hasResult = results.size > 0

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-1.5">
            <TerminalSquare className="h-4 w-4 text-primary" />
            {t('batch_cmd_title')}
          </DialogTitle>
          <DialogDescription>
            {t('batch_cmd_desc_prefix')}
            <span className="mx-0.5 font-medium text-foreground">{total}</span>
            {t('batch_cmd_desc_suffix')}
          </DialogDescription>
        </DialogHeader>

        {hasResult ? (
          /* ============ 结果态 ============ */
          <div className="space-y-2">
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-emerald-500">
                <CheckCircle2 className="h-4 w-4" />
                {t('batch_cmd_success')} {succeeded}
              </span>
              {failed > 0 && (
                <span className="flex items-center gap-1.5 text-red-500">
                  <XCircle className="h-4 w-4" />
                  {t('batch_cmd_failed')} {failed}
                </span>
              )}
              {executing && (
                <span className="flex items-center gap-1.5 text-muted-foreground ml-auto">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  {doneCount}/{total}
                </span>
              )}
            </div>

            <div className="rounded-md border border-border/60 max-h-[360px] overflow-y-auto">
              {servers.map((s) => {
                const row = results.get(s.id)
                if (!row) {
                  // 还在执行中（未收到结果）
                  return (
                    <div key={s.id} className="px-3 py-1.5 border-b border-border/30 last:border-0 text-xs flex items-center gap-2">
                      <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground flex-shrink-0" />
                      <span className="font-medium truncate flex-1">{s.name}</span>
                      <span className="text-muted-foreground tabular-nums flex-shrink-0">{t('batch_cmd_running')}</span>
                    </div>
                  )
                }
                return (
                  <div key={s.id} className="border-b border-border/30 last:border-0">
                    <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => handleToggleExpand(s.id)}
                        className="flex-shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        {row.expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      </button>
                      {row.success ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                      )}
                      <span className="font-medium truncate flex-1">{s.name}</span>
                      <span className="text-muted-foreground tabular-nums flex-shrink-0">
                        {row.exitCode >= 0 ? `exit=${row.exitCode}` : 'N/A'}
                      </span>
                      {row.expanded && (row.stdout || row.stderr || row.error) && (
                        <button
                          type="button"
                          onClick={() => handleCopyOutput(row)}
                          className="text-muted-foreground hover:text-foreground flex-shrink-0"
                          title={t('batch_cmd_copy_output')}
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    {row.expanded && (row.stdout || row.stderr || row.error) && (
                      <div className="px-3 pb-2 pt-0.5 bg-muted/40">
                        {row.error && (
                          <pre className="text-[11px] text-red-500 dark:text-red-400 whitespace-pre-wrap break-all font-mono">
                            {row.error}
                          </pre>
                        )}
                        {row.stderr && (
                          <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap break-all font-mono">
                            {row.stderr}
                          </pre>
                        )}
                        {row.stdout && (
                          <pre className="text-[11px] text-foreground/80 whitespace-pre-wrap break-all font-mono">
                            {row.stdout}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex justify-end pt-1">
              <Button variant="outline" size="sm" onClick={handleClose}>
                {executing ? t('cd_default_cancel') : t('ed_ok')}
              </Button>
            </div>
          </div>
        ) : (
          /* ============ 选择态 ============ */
          <div className="space-y-3">
            {/* 命令输入 */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">{t('batch_cmd_command_label')}</p>
              <Input
                value={command}
                maxLength={4096}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={t('batch_cmd_command_placeholder')}
                disabled={executing}
                autoFocus
                onKeyDown={(e) => {
                  // Ctrl/Cmd+Enter 快速执行
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && command.trim() && !executing) {
                    e.preventDefault()
                    void handleExecute()
                  }
                }}
              />
            </div>

            {/* 超时输入 */}
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                {t('batch_cmd_timeout_label')}
              </p>
              <Input
                type="number"
                min={5}
                max={120}
                maxLength={3}
                value={timeoutSecs}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  if (!isNaN(n)) setTimeoutSecs(Math.min(120, Math.max(5, n)))
                }}
                disabled={executing}
                className="w-20 h-7 text-xs"
              />
              <span className="text-[11px] text-muted-foreground">5-120s</span>
            </div>

            {/* 目标列表 */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">{t('batch_cmd_targets')}</p>
              <div className="rounded-md border border-border/60 max-h-[180px] overflow-y-auto">
                {servers.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30 last:border-0 text-xs">
                    <TerminalSquare className="h-3 w-3 text-primary flex-shrink-0" />
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
                disabled={!command.trim() || executing}
                onClick={() => void handleExecute()}
              >
                {executing ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
                {t('batch_cmd_execute')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
