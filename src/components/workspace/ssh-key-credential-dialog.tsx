import { useMemo, useState } from 'react'
import { Award, KeyRound, Loader2, Plus, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { EditKeyDialog } from '@/components/key/edit-key-dialog'
import { useTranslation } from '@/i18n'
import { useAppStore } from '@/store'
import type { SshKey } from '@/types'

interface SshKeyCredentialDialogProps {
  open: boolean
  initialUsername: string
  authType: 'privateKey' | 'certificate'
  initialKeyId?: string
  reason: 'missing' | 'rejected'
  submitting: boolean
  error: string | null
  onSubmit: (username: string, key: SshKey) => void
  onCancel: () => void
}

function maskPath(path?: string) {
  if (!path) return ''
  const parts = path.split(/[\\/]/)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : path
}

export function SshKeyCredentialDialog({
  open,
  initialUsername,
  authType,
  initialKeyId,
  reason,
  submitting,
  error,
  onSubmit,
  onCancel,
}: SshKeyCredentialDialogProps) {
  const { t } = useTranslation()
  const keys = useAppStore((state) => state.keys)
  const [username, setUsername] = useState(initialUsername)
  const [selectedKeyId, setSelectedKeyId] = useState(initialKeyId || '')
  const [newKeyOpen, setNewKeyOpen] = useState(false)

  const compatibleKeys = useMemo(
    () => keys.filter((key) => {
      const isCertificate = key.keyType === 'certificate' || (!key.keyType && !!key.certificatePath)
      return authType === 'certificate' ? isCertificate : !isCertificate
    }),
    [authType, keys],
  )
  const selectedKey = compatibleKeys.find((key) => key.id === selectedKeyId)

  const submit = () => {
    const nextUsername = username.trim()
    if (!nextUsername || !selectedKey) return
    onSubmit(nextUsername, selectedKey)
  }

  return <>
    <Dialog open={open} onOpenChange={(value) => { if (!value && !submitting && !newKeyOpen) onCancel() }}>
      <DialogContent className="max-w-[500px] w-[min(500px,calc(100vw-2rem))] p-0 gap-0 overflow-hidden rounded-xl border border-border/80 bg-background shadow-2xl">
        <DialogHeader className="px-5 py-3 border-b border-border/60 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {authType === 'certificate' ? <Award className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
            </span>
            <DialogTitle className="truncate text-sm font-semibold">
              {authType === 'certificate' ? t('ssh_key_credential_cert_title') : t('ssh_key_credential_key_title')}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-3.5 p-5">
          <div className="rounded-md border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
            {reason === 'rejected' ? t('ssh_key_credential_rejected_desc') : t('ssh_key_credential_missing_desc')}
          </div>

          <div className="flex items-center gap-3">
            <label className="w-16 shrink-0 text-right text-xs text-foreground">{t('ssh_credential_username')}:</label>
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={submitting}
              className="h-7 flex-1 text-xs font-mono bg-background"
              autoComplete="username"
            />
          </div>

          <fieldset className="rounded-md border border-border/70 bg-card/20 p-3.5 pt-1 shadow-2xs">
            <legend className="px-1.5 text-xs font-medium text-foreground">{t('ssh_key_credential_choose')}</legend>
            <div className="max-h-52 min-h-28 overflow-y-auto rounded-md border border-border/60 bg-background">
              {compatibleKeys.length === 0 ? (
                <div className="flex min-h-28 flex-col items-center justify-center gap-1 px-4 text-center text-xs text-muted-foreground">
                  <KeyRound className="h-5 w-5 opacity-50" />
                  <span>{authType === 'certificate' ? t('ssh_key_credential_no_cert') : t('ssh_key_credential_no_key')}</span>
                </div>
              ) : compatibleKeys.map((key) => {
                const selected = key.id === selectedKeyId
                return <button
                  key={key.id}
                  type="button"
                  disabled={submitting}
                  onClick={() => setSelectedKeyId(key.id)}
                  onDoubleClick={() => {
                    const nextUsername = username.trim()
                    if (nextUsername) onSubmit(nextUsername, key)
                  }}
                  className={`flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left transition-colors last:border-b-0 ${selected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'}`}
                >
                  {(key.keyType === 'certificate' || (!key.keyType && key.certificatePath)) ? <Award className="h-4 w-4 shrink-0" /> : <KeyRound className="h-4 w-4 shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{key.name}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {maskPath(key.privateKeyPath) || t('ssh_key_credential_encrypted_store')}
                      {key.certificatePath ? ` · ${maskPath(key.certificatePath)}` : ''}
                    </span>
                  </span>
                  {key.privateKeyPassphrase && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                </button>
              })}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={submitting}
              onClick={() => setNewKeyOpen(true)}
              className="mt-2 h-7 w-full gap-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              {authType === 'certificate' ? t('ssh_key_credential_new_cert') : t('ssh_key_credential_new_key')}
            </Button>
          </fieldset>

          {error && <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
          <div className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span>{t('ssh_key_credential_save_hint')}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/60 bg-muted/20 px-5 py-2.5">
          <Button size="sm" className="h-7 px-5 text-xs font-semibold" disabled={submitting || !username.trim() || !selectedKey} onClick={submit}>
            {submitting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            {submitting ? t('ssh_credential_verifying') : t('ssh_credential_connect')}
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-4 text-xs" disabled={submitting} onClick={onCancel}>{t('common_cancel')}</Button>
        </div>
      </DialogContent>
    {/* EditKeyDialog 嵌套进外层 Dialog 内（而非兄弟节点），共享 DismissableLayer 作用域，
        关闭新建密钥弹框时不会误关外层认证弹框。 */}
    {newKeyOpen && <EditKeyDialog
      open={newKeyOpen}
      onClose={() => setNewKeyOpen(false)}
      initialKeyType={authType === 'certificate' ? 'certificate' : 'private'}
      onSaveSuccess={(key) => {
        setSelectedKeyId(key.id)
        setNewKeyOpen(false)
      }}
    />}
    </Dialog>
  </>
}
