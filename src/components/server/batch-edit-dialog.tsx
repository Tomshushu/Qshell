import { useState, useEffect, useMemo, useRef } from 'react'
import { SlidersHorizontal, Loader2, Shield, Plus, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SelectPopover } from '@/components/ui/select-popover'
import { useToast } from '@/components/ui/toast'
import { useTranslation } from '@/i18n'
import { useAppStore } from '@/store'
import { useModalStack } from '@/hooks/use-modal-stack'
import { sshService } from '@/services/ssh-service'
import type { Server } from '@/types'
import type { AuthProfile, ServerBatchPatch } from '@/services/api'

interface BatchEditDialogProps {
  open: boolean
  servers: Server[]
  onClose: () => void
}

function BatchEditForm({
  servers,
  onClose,
}: {
  servers: Server[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { toast } = useToast()

  const catalogTags = useAppStore((s) => s.tags)
  const allServers = useAppStore((s) => s.servers)
  const loadServers = useAppStore((s) => s.loadServers)

  const [authProfiles, setAuthProfiles] = useState<AuthProfile[]>([])
  const [saving, setSaving] = useState(false)
  const [confirmUnlinkOpen, setConfirmUnlinkOpen] = useState(false)
  const pendingPatchRef = useRef<ServerBatchPatch | null>(null)

  // 字段启用开关（未勾选的字段不会出现在 patch 中）
  const [applyTags, setApplyTags] = useState(false)
  const [tagsMode, setTagsMode] = useState<'add' | 'remove' | 'replace'>('add')
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')

  const [applyTimeout, setApplyTimeout] = useState(false)
  const [connectionTimeout, setConnectionTimeout] = useState('30')

  const [applyForwardAgent, setApplyForwardAgent] = useState(false)
  const [forwardAgent, setForwardAgent] = useState(false)

  const [applyAuthProfile, setApplyAuthProfile] = useState(false)
  const [authProfileId, setAuthProfileId] = useState('')

  const [applyTerminalType, setApplyTerminalType] = useState(false)
  const [terminalType, setTerminalType] = useState('')

  useEffect(() => {
    let cancelled = false
    sshService.listAuthProfiles()
      .then((list) => {
        if (!cancelled) setAuthProfiles(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const knownTags = useMemo(
    () => [...new Set([...catalogTags, ...allServers.flatMap((s) => s.tags || [])])].sort(),
    [catalogTags, allServers],
  )

  const mergeDraftTags = (existing: string[], raw: string): string[] => {
    const parts = raw
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
    if (parts.length === 0) return existing
    const next = [...existing]
    for (const part of parts) {
      if (!next.includes(part)) {
        next.push(part)
      }
    }
    return next
  }

  const addDraftTag = (raw?: string) => {
    const value = raw ?? tagDraft
    if (!value.trim()) return
    setTags((prev) => mergeDraftTags(prev, value))
    setTagDraft('')
  }

  const hasAnyField = applyTags || applyTimeout || applyForwardAgent || applyAuthProfile || applyTerminalType
  const hasBoundAuthProfileTarget =
    (applyAuthProfile && Boolean(authProfileId)) ||
    (!applyAuthProfile && servers.some((s) => Boolean(s.authProfileId)))

  const doSave = async (patch: ServerBatchPatch) => {
    setSaving(true)
    try {
      const res = await sshService.batchUpdateServers(
        servers.map((s) => s.id),
        patch,
      )
      if (!res.success) {
        toast.error(res.error || t('batch_edit_failed'))
        return
      }
      await loadServers()
      toast.success(t('batch_edit_success', { count: servers.length }))
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!hasAnyField || servers.length === 0) return

    const patch: ServerBatchPatch = {}
    if (applyTags) {
      patch.tagsMode = tagsMode
      patch.tags = mergeDraftTags(tags, tagDraft)
    }
    if (applyTimeout) {
      const parsed = parseInt(connectionTimeout, 10)
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 300) {
        toast.error(t('batch_edit_timeout_range'))
        return
      }
      patch.connectionTimeout = parsed
    }
    if (applyForwardAgent) {
      patch.forwardAgent = forwardAgent
    }
    if (applyAuthProfile) {
      // 下拉默认首项是「解除绑定」（空串）。勾选了开关却忘记选具体凭证时，
      // 会造成批量解绑误操作；这里用自定义 ConfirmDialog 二次确认，替代原生 window.confirm。
      if (!authProfileId) {
        pendingPatchRef.current = patch
        setConfirmUnlinkOpen(true)
        return
      }
      patch.authProfileId = authProfileId
    }
    if (applyTerminalType) {
      patch.terminalType = terminalType
    }

    await doSave(patch)
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-3 mt-1">
      {/* 1. 标签 */}
      <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
            <input
              type="checkbox"
              checked={applyTags}
              onChange={(e) => setApplyTags(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input text-primary"
            />
            <span>{t('batch_edit_tags')}</span>
          </label>
          {applyTags && (
            <SelectPopover
              value={tagsMode}
              onChange={(v) => setTagsMode((v || 'add') as 'add' | 'remove' | 'replace')}
              options={[
                { value: 'add', label: t('batch_edit_tags_add') },
                { value: 'remove', label: t('batch_edit_tags_remove') },
                { value: 'replace', label: t('batch_edit_tags_replace') },
              ]}
              className="h-7 w-36"
            />
          )}
        </div>
        {applyTags && (
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              <Input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addDraftTag()
                  }
                }}
                placeholder={t('batch_edit_tag_placeholder')}
                className="h-7 text-xs flex-1 bg-background"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addDraftTag()}
                className="h-7 px-2 text-xs"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-primary/10 text-primary border border-primary/20"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => setTags((prev) => prev.filter((x) => x !== tag))}
                      className="hover:text-destructive"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {knownTags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {knownTags.slice(0, 10).map((kt) => (
                  <button
                    key={kt}
                    type="button"
                    onClick={() => addDraftTag(kt)}
                    className="px-1.5 py-0.5 rounded text-[10px] bg-background border border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40 cursor-pointer"
                  >
                    + {kt}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. 全局身份凭证 */}
      <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 space-y-2">
        <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
          <input
            type="checkbox"
            checked={applyAuthProfile}
            onChange={(e) => setApplyAuthProfile(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-input text-primary"
          />
          <span>{t('batch_edit_auth_profile')}</span>
        </label>
        {applyAuthProfile && (
          <SelectPopover
            value={authProfileId}
            onChange={(v) => setAuthProfileId(v ?? '')}
            options={[
              { value: '', label: t('batch_edit_auth_unlink') },
              ...authProfiles.map((p) => ({
                value: p.id,
                label: `${p.name}${p.username ? ` (${p.username})` : ''}`,
              })),
            ]}
            className="h-7 w-full"
          />
        )}
      </div>

      {/* 4. 连接超时 & SSH Agent 转发 */}
      <div className="grid grid-cols-2 gap-2.5 items-start">
        <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 space-y-2">
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
            <input
              type="checkbox"
              checked={applyTimeout}
              onChange={(e) => setApplyTimeout(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input text-primary"
            />
            <span>{t('batch_edit_timeout')}</span>
          </label>
          {applyTimeout ? (
            <Input
              type="number"
              min={1}
              max={300}
              value={connectionTimeout}
              onChange={(e) => setConnectionTimeout(e.target.value)}
              placeholder="30"
              className="h-7 text-xs font-mono bg-background"
            />
          ) : (
            <p className="text-[11px] text-muted-foreground pl-5">
              {t('batch_edit_timeout_default_hint')}
            </p>
          )}
        </div>

        <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 space-y-2">
          <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
            <input
              type="checkbox"
              checked={applyForwardAgent}
              onChange={(e) => setApplyForwardAgent(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input text-primary"
            />
            <span className="flex items-center gap-1">
              <Shield className="h-3 w-3 text-amber-500" />
              {t('batch_edit_forward_agent')}
            </span>
          </label>
          {applyForwardAgent && (
            <div className="space-y-1.5 pt-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  {forwardAgent ? t('batch_edit_forward_on') : t('batch_edit_forward_off')}
                </span>
                <Switch checked={forwardAgent} onCheckedChange={setForwardAgent} />
              </div>
              {hasBoundAuthProfileTarget && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
                  {t('batch_edit_forward_agent_profile_hint')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 5. 终端类型 (TERM) */}
      <div className="rounded-md border border-border/60 bg-muted/20 p-2.5 space-y-2">
        <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
          <input
            type="checkbox"
            checked={applyTerminalType}
            onChange={(e) => setApplyTerminalType(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-input text-primary"
          />
          <span>{t('batch_edit_terminal_type')}</span>
        </label>
        {applyTerminalType && (
          <SelectPopover
            value={terminalType}
            onChange={(v) => setTerminalType(v ?? '')}
            options={[
              { value: '', label: t('batch_edit_terminal_type_inherit') },
              { value: 'xterm-256color', label: 'xterm-256color' },
              { value: 'xterm', label: 'xterm' },
              { value: 'vt100', label: 'vt100' },
              { value: 'vt220', label: 'vt220' },
              { value: 'vt320', label: 'vt320' },
              { value: 'linux', label: 'linux' },
              { value: 'ansi', label: 'ansi' },
              { value: 'scoansi', label: 'scoansi' },
            ]}
            className="h-7 w-full"
          />
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
          {t('common_cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={!hasAnyField || saving || servers.length === 0}>
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {t('batch_edit_apply', { count: servers.length })}
        </Button>
      </div>
      </form>
      <ConfirmDialog
        open={confirmUnlinkOpen}
        variant="destructive"
        title={t('batch_edit_auth_unlink')}
        description={`${t('batch_edit_title')} (${servers.length}) · ${t('batch_edit_auth_profile')}`}
        onConfirm={() => {
          const patch = pendingPatchRef.current
          pendingPatchRef.current = null
          setConfirmUnlinkOpen(false)
          if (patch) {
            patch.authProfileId = ''
            void doSave(patch)
          }
        }}
        onCancel={() => {
          pendingPatchRef.current = null
          setConfirmUnlinkOpen(false)
        }}
      />
    </>
  )
}

export function BatchEditDialog({ open, servers, onClose }: BatchEditDialogProps) {
  const { t } = useTranslation()

  useModalStack('batch-edit-servers', open, onClose)

  const formKey = open ? servers.map((s) => s.id).join(',') : 'closed'

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            {t('batch_edit_title')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('batch_edit_desc', { count: servers.length })}
          </DialogDescription>
        </DialogHeader>
        <BatchEditForm key={formKey} servers={servers} onClose={onClose} />
      </DialogContent>
    </Dialog>
  )
}
