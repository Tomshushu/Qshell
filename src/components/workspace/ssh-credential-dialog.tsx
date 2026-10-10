import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'
import { useTranslation } from '@/i18n'

interface SshCredentialDialogProps {
  open: boolean
  initialUsername: string
  submitting: boolean
  error: string | null
  onSubmit: (username: string, password: string) => void
  onCancel: () => void
}

export function SshCredentialDialog({
  open,
  initialUsername,
  submitting,
  error,
  onSubmit,
  onCancel,
}: SshCredentialDialogProps) {
  const { t } = useTranslation()
  const [username, setUsername] = useState(initialUsername)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const submit = () => {
    const nextUsername = username.trim()
    if (!nextUsername || !password) return
    onSubmit(nextUsername, password)
  }

  return <Dialog open={open} onOpenChange={(value) => { if (!value && !submitting) onCancel() }}>
    <DialogContent className="max-w-[440px] w-[min(440px,calc(100vw-2rem))] p-0 gap-0 overflow-hidden rounded-xl border border-border/80 bg-background shadow-2xl">
      <DialogHeader className="px-5 py-3 border-b border-border/60 bg-muted/20">
        <div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><KeyRound className="h-4 w-4" /></span><DialogTitle className="truncate text-sm font-semibold">{t('ssh_credential_title')}</DialogTitle></div>
      </DialogHeader>

      <div className="p-5">
        <div className="space-y-3 rounded-md border border-border/70 bg-card/20 p-3.5 shadow-2xs">
          <div className="flex items-center gap-3"><label className="w-16 shrink-0 text-right text-xs text-foreground">{t('ssh_credential_username')}:</label><Input autoFocus value={username} onChange={(event) => setUsername(event.target.value)} disabled={submitting} className="h-7 flex-1 text-xs font-mono bg-background" autoComplete="username" /></div>
          <div className="flex items-center gap-3"><label className="w-16 shrink-0 text-right text-xs text-foreground">{t('ssh_credential_password')}:</label><div className="relative flex-1"><Input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} className="h-7 pr-8 text-xs font-mono bg-background" autoComplete="current-password" onKeyDown={(event) => { if (event.key === 'Enter') submit() }} /><button type="button" tabIndex={-1} onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button></div></div>
        </div>

        {error && <div className="mt-3 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border/60 bg-muted/20 px-5 py-2.5">
        <Button size="sm" className="h-7 px-5 text-xs font-semibold" disabled={submitting || !username.trim() || !password} onClick={submit}>{submitting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}{submitting ? t('ssh_credential_verifying') : t('ssh_credential_connect')}</Button>
        <Button variant="outline" size="sm" className="h-7 px-4 text-xs" disabled={submitting} onClick={onCancel}>{t('common_cancel')}</Button>
      </div>
    </DialogContent>
  </Dialog>
}
