import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { QshellLoader } from '@/components/ui/qshell-loader'
import { friendlyError } from '@/lib/error-messages'
import type { AuthInteractionRequest } from '@/services/api/types'

export type SshCredentialDialogProps =
  | {
      mode?: 'credentials'
      open: boolean
      initialUsername: string
      submitting: boolean
      error: string | null
      onSubmit: (username: string, password: string) => void
      onCancel: () => void
    }
  | {
      mode: 'interaction'
      open: boolean
      interactionRequest: AuthInteractionRequest
      submitting: boolean
      error: string | null
      onSubmitInteraction: (responses: string[]) => void
      onCancel: () => void
    }

function CredentialsForm({
  initialUsername,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  initialUsername: string
  submitting: boolean
  error: string | null
  onSubmit: (username: string, password: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [username, setUsername] = useState(initialUsername)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const submit = () => {
    const nextUsername = username.trim()
    if (!nextUsername || !password) return
    onSubmit(nextUsername, password)
  }

  return (
    <>
      <DialogHeader className="px-5 py-3 border-b border-border/60 bg-muted/20">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KeyRound className="h-4 w-4" />
          </span>
          <DialogTitle className="truncate text-sm font-semibold">
            {t('ssh_credential_title')}
          </DialogTitle>
        </div>
      </DialogHeader>

      <div className="p-5">
        <div className="space-y-3 rounded-md border border-border/70 bg-card/20 p-3.5 shadow-2xs">
          <div className="flex items-center gap-3">
            <label className="w-16 shrink-0 text-right text-xs text-foreground">
              {t('ssh_credential_username')}:
            </label>
            <Input
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={submitting}
              className="h-7 flex-1 text-xs font-mono bg-background"
              autoComplete="username"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="w-16 shrink-0 text-right text-xs text-foreground">
              {t('ssh_credential_password')}:
            </label>
            <div className="relative flex-1">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
                className="h-7 pr-8 text-xs font-mono bg-background"
                autoComplete="current-password"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submit()
                }}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {friendlyError(error).message}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border/60 bg-muted/20 px-5 py-2.5">
        <Button
          size="sm"
          className="h-7 px-5 text-xs font-semibold gap-1.5"
          disabled={submitting || !username.trim() || !password}
          onClick={submit}
        >
          {submitting ? <QshellLoader size="xs" /> : null}
          {submitting ? t('ssh_credential_verifying') : t('ssh_credential_connect')}
        </Button>
        <Button variant="outline" size="sm" className="h-7 px-4 text-xs" disabled={submitting} onClick={onCancel}>
          {t('common_cancel')}
        </Button>
      </div>
    </>
  )
}

function InteractionForm({
  request,
  submitting,
  error,
  onSubmitInteraction,
  onCancel,
}: {
  request: AuthInteractionRequest
  submitting: boolean
  error: string | null
  onSubmitInteraction: (responses: string[]) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [responses, setResponses] = useState<string[]>(() =>
    request.prompts.map(() => ''),
  )
  const [revealed, setRevealed] = useState<Record<number, boolean>>({})
  const [remainingSecs, setRemainingSecs] = useState<number>(request.timeoutSecs || 90)
  const expiredRef = useRef(false)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  const isExpired = remainingSecs <= 0

  useEffect(() => {
    const id = window.setInterval(() => {
      setRemainingSecs((prev) => {
        if (prev <= 1) {
          // 倒计时归零：自动取消交互认证，避免界面停留 0 秒却仍可提交导致后端超时报错。
          // expiredRef 保证只触发一次（父组件可能因 submitting 变化重渲染本组件）。
          if (!expiredRef.current) {
            expiredRef.current = true
            onCancelRef.current()
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [request.requestId])

  const submit = () => {
    if (submitting || isExpired) return
    onSubmitInteraction(responses)
  }

  return (
    <>
      <DialogHeader className="px-5 py-3 border-b border-border/60 bg-muted/20">
        <div className="flex items-center justify-between gap-2 pr-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <DialogTitle className="truncate text-sm font-semibold">
              {request.title.trim() || t('ssh_auth_interaction_title')}
            </DialogTitle>
          </div>
          <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground tabular-nums">
            {t('ssh_auth_interaction_timeout_hint').replace('{seconds}', String(remainingSecs))}
          </span>
        </div>
      </DialogHeader>

      <div className="p-5 space-y-3">
        <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
          {request.instructions.trim() || t('ssh_auth_interaction_default_desc')}
        </p>

        <div className="space-y-3 rounded-md border border-border/70 bg-card/20 p-3.5 shadow-2xs">
          {request.prompts.map((item, idx) => {
            const isMasked = !item.echo && !revealed[idx]
            return (
              <div key={`${request.requestId}-${idx}`} className="space-y-1">
                <label className="block text-xs font-medium text-foreground break-words">
                  {item.prompt}
                </label>
                <div className="relative">
                  <Input
                    autoFocus={idx === 0}
                    type={isMasked ? 'password' : 'text'}
                    value={responses[idx] ?? ''}
                    disabled={submitting || isExpired}
                    autoComplete="one-time-code"
                    className="h-8 pr-8 text-xs font-mono bg-background"
                    onChange={(event) => {
                      const val = event.target.value
                      setResponses((prev) => {
                        const next = [...prev]
                        next[idx] = val
                        return next
                      })
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && idx === request.prompts.length - 1) {
                        submit()
                      }
                    }}
                  />
                  {!item.echo && (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setRevealed((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {revealed[idx] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {friendlyError(error).message}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border/60 bg-muted/20 px-5 py-2.5">
        <Button
          size="sm"
          className="h-7 px-5 text-xs font-semibold gap-1.5"
          disabled={submitting || isExpired}
          onClick={submit}
        >
          {submitting ? <QshellLoader size="xs" /> : null}
          {submitting ? t('ssh_auth_interaction_submitting') : t('ssh_auth_interaction_submit')}
        </Button>
        <Button variant="outline" size="sm" className="h-7 px-4 text-xs" disabled={submitting || isExpired} onClick={onCancel}>
          {t('common_cancel')}
        </Button>
      </div>
    </>
  )
}

export function SshCredentialDialog(props: SshCredentialDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={(value) => {
        if (!value && !props.submitting) props.onCancel()
      }}
    >
      <DialogContent className="max-w-[440px] w-[min(440px,calc(100vw-2rem))] p-0 gap-0 overflow-hidden rounded-xl border border-border/80 bg-background shadow-2xl">
        {props.mode === 'interaction' ? (
          <InteractionForm
            key={props.interactionRequest.requestId}
            request={props.interactionRequest}
            submitting={props.submitting}
            error={props.error}
            onSubmitInteraction={props.onSubmitInteraction}
            onCancel={props.onCancel}
          />
        ) : (
          <CredentialsForm
            initialUsername={props.initialUsername}
            submitting={props.submitting}
            error={props.error}
            onSubmit={props.onSubmit}
            onCancel={props.onCancel}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
