import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clipboard, KeyRound, Loader2, Network, RefreshCw, RotateCcw, ShieldCheck, XCircle } from 'lucide-react'
import type { Server } from '@/types'
import { sshService } from '@/services/ssh-service'
import type { SshErrorKind } from '@/services/ssh-connection-state'
import { buildConnectionDiagnosticReport, validateConnectionConfiguration } from '@/lib/connection-diagnostics'
import { useTranslation } from '@/i18n'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

interface DiagnosticStep {
  id: 'config' | 'dns' | 'tcp' | 'identity' | 'auth'
  labelKey: string
  status: StepStatus
  detail?: string
  durationMs?: number
}

interface ConnectionDiagnosticsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  server: Server
  error?: string | null
  errorKind?: SshErrorKind
  onRetry: () => void
}

const initialSteps = (): DiagnosticStep[] => [
  { id: 'config', labelKey: 'diag_step_config', status: 'pending' },
  { id: 'dns', labelKey: 'diag_step_dns', status: 'pending' },
  { id: 'tcp', labelKey: 'diag_step_tcp', status: 'pending' },
  { id: 'identity', labelKey: 'diag_step_identity', status: 'pending' },
  { id: 'auth', labelKey: 'diag_step_auth', status: 'pending' },
]

export function ConnectionDiagnosticsDialog({
  open,
  onOpenChange,
  server,
  error,
  errorKind,
  onRetry,
}: ConnectionDiagnosticsDialogProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [steps, setSteps] = useState<DiagnosticStep[]>(initialSteps)
  const [running, setRunning] = useState(false)
  const [finalError, setFinalError] = useState(error ?? '')
  const runIdRef = useRef(0)

  const updateStep = useCallback((id: DiagnosticStep['id'], patch: Partial<DiagnosticStep>) => {
    setSteps((current) => current.map((step) => step.id === id ? { ...step, ...patch } : step))
  }, [])

  const report = useMemo(
    () => buildConnectionDiagnosticReport(server, finalError || error || '', errorKind),
    [server, finalError, error, errorKind],
  )

  const runDiagnostics = useCallback(async () => {
    const currentRun = ++runIdRef.current
    setRunning(true)
    setFinalError(error ?? '')
    setSteps(initialSteps())

    const issues = validateConnectionConfiguration(server)
    updateStep('config', {
      status: issues.length === 0 ? 'success' : 'failed',
      detail: issues.length === 0 ? t('diag_config_valid') : t('diag_config_missing', { fields: issues.join(', ') }),
    })
    if (issues.length > 0) {
      setRunning(false)
      return
    }

    const preliminary = buildConnectionDiagnosticReport(server, error ?? '', errorKind)
    updateStep('dns', { status: 'running', detail: `${preliminary.entryHost}:${preliminary.entryPort}` })
    updateStep('tcp', { status: 'running' })
    try {
      const endpoint = await sshService.diagnoseEndpoint(
        preliminary.entryHost,
        preliminary.entryPort,
        Math.min(server.connectionTimeout ?? 6, 10),
      )
      if (currentRun !== runIdRef.current) return
      const dns = endpoint.checks.find((step) => step.kind === 'dns')
      const tcp = endpoint.checks.find((step) => step.kind === 'tcp')
      updateStep('dns', {
        status: dns?.success ? 'success' : 'failed',
        detail: dns?.detail || dns?.message,
        durationMs: dns?.durationMs,
      })
      updateStep('tcp', {
        status: tcp?.success ? 'success' : 'failed',
        detail: tcp?.detail || tcp?.message,
        durationMs: tcp?.durationMs,
      })
      if (!endpoint.reachable) {
        updateStep('identity', { status: 'skipped', detail: t('diag_skipped_unreachable') })
        updateStep('auth', { status: 'skipped', detail: t('diag_skipped_unreachable') })
        setFinalError(tcp?.detail || tcp?.message || error || '')
        setRunning(false)
        return
      }
    } catch (endpointError) {
      if (currentRun !== runIdRef.current) return
      const detail = endpointError instanceof Error ? endpointError.message : String(endpointError)
      updateStep('dns', { status: 'failed', detail })
      updateStep('tcp', { status: 'failed', detail })
      updateStep('identity', { status: 'skipped' })
      updateStep('auth', { status: 'skipped' })
      setFinalError(detail)
      setRunning(false)
      return
    }

    if (server.authType === 'sshAgent') {
      updateStep('identity', { status: 'running' })
      try {
        const status = await sshService.testSshAgent()
        const identities = status.available ? await sshService.listAgentIdentities() : []
        if (currentRun !== runIdRef.current) return
        const selectedIdentityFound = !server.agentIdentity || identities.some(
          (identity) => `${identity.algorithm} ${identity.publicKeyBase64}` === server.agentIdentity,
        )
        const success = status.available && identities.length > 0 && selectedIdentityFound
        updateStep('identity', {
          status: success ? 'success' : 'failed',
          detail: success
            ? t('diag_agent_identities', { count: identities.length })
            : status.message || t('diag_agent_unavailable'),
        })
        if (!success) {
          updateStep('auth', { status: 'skipped', detail: t('diag_skipped_identity') })
          setFinalError(status.message || t('diag_agent_unavailable'))
          setRunning(false)
          return
        }
      } catch (agentError) {
        if (currentRun !== runIdRef.current) return
        const detail = agentError instanceof Error ? agentError.message : String(agentError)
        updateStep('identity', { status: 'failed', detail })
        updateStep('auth', { status: 'skipped', detail: t('diag_skipped_identity') })
        setFinalError(detail)
        setRunning(false)
        return
      }
    } else {
      updateStep('identity', {
        status: 'success',
        detail: t(`diag_identity_${server.authType}`),
      })
    }

    updateStep('auth', { status: 'running' })
    try {
      const startedAt = performance.now()
      const result = await sshService.testConnectWithConfig({
        id: server.id,
        host: server.host,
        port: server.port,
        username: server.username,
        authType: server.authType,
        // Empty secrets intentionally tell the backend to use the encrypted values
        // already stored for this server. Credentials never need to enter localStorage.
        sshKeyId: server.sshKeyId,
        agentIdentity: server.agentIdentity,
        connectionTimeout: Math.min(server.connectionTimeout ?? 15, 20),
        targetType: server.targetType,
        protocol: server.protocol,
        proxyConfig: server.proxyConfig ?? undefined,
      })
      if (currentRun !== runIdRef.current) return
      const durationMs = Math.round(performance.now() - startedAt)
      updateStep('auth', {
        status: result.success ? 'success' : 'failed',
        detail: result.success ? t('diag_auth_success') : result.error || result.message,
        durationMs,
      })
      if (!result.success) setFinalError(result.error || result.message || error || '')
      else setFinalError('')
    } catch (authError) {
      if (currentRun !== runIdRef.current) return
      const detail = authError instanceof Error ? authError.message : String(authError)
      updateStep('auth', { status: 'failed', detail })
      setFinalError(detail)
    } finally {
      if (currentRun === runIdRef.current) setRunning(false)
    }
  }, [error, errorKind, server, t, updateStep])

  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => void runDiagnostics(), 0)
      return () => {
        window.clearTimeout(timer)
        runIdRef.current += 1
      }
    }
    // A new open is a new diagnostic request; runDiagnostics deliberately remains
    // outside the dependency list to avoid restarting while step state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const resetHostKey = async () => {
    const result = await sshService.resetKnownHost(server.id)
    if (!result.success) {
      toast.error(result.error || t('diag_reset_host_key_failed'))
      return
    }
    toast.success(t('diag_reset_host_key_done'))
    await runDiagnostics()
  }

  const copyReport = async () => {
    const text = [
      `${server.name} (${server.host}:${server.port})`,
      `${t('diag_report_summary')}: ${t(report.summaryKey)}`,
      ...steps.map((step) => `${t(step.labelKey)}: ${step.status}${step.detail ? ` - ${step.detail}` : ''}`),
      finalError ? `${t('diag_technical_detail')}: ${finalError}` : '',
    ].filter(Boolean).join('\n')
    await navigator.clipboard.writeText(text)
    toast.success(t('diag_report_copied'))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-6 py-5">
          <DialogTitle className="flex items-center gap-2">
            <Network className="h-5 w-5 text-primary" />
            {t('diag_title')}
          </DialogTitle>
          <DialogDescription>
            {server.name} · {report.usesProxy ? t('diag_first_hop_proxy') : t('diag_first_hop_direct')} · {report.entryHost}:{report.entryPort}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-5 overflow-y-auto px-6 py-5">
          <div className="space-y-2">
            {steps.map((step) => {
              const Icon = step.status === 'running' ? Loader2 : step.status === 'success' ? CheckCircle2 : step.status === 'failed' ? XCircle : step.status === 'skipped' ? AlertTriangle : ShieldCheck
              return (
                <div key={step.id} className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/15 px-3.5 py-3">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${step.status === 'running' ? 'animate-spin text-primary' : step.status === 'success' ? 'text-emerald-500' : step.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{t(step.labelKey)}</span>
                      {typeof step.durationMs === 'number' && <span className="font-mono text-[10px] text-muted-foreground">{step.durationMs} ms</span>}
                    </div>
                    {step.detail && <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{step.detail}</p>}
                  </div>
                </div>
              )
            })}
          </div>

          {!running && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-start gap-2.5">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold">{t(report.summaryKey)}</p>
                  <div className="mt-3 space-y-3">
                    {report.recommendations.map((recommendation) => (
                      <div key={recommendation.code}>
                        <p className="text-xs font-medium">{t(recommendation.titleKey)}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t(recommendation.descriptionKey)}</p>
                        {recommendation.action === 'resetHostKey' && (
                          <Button variant="outline" size="sm" className="mt-2 h-7 gap-1.5 text-xs" onClick={() => void resetHostKey()}>
                            <RotateCcw className="h-3.5 w-3.5" /> {t('diag_reset_host_key')}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {finalError && (
            <details className="rounded-lg border border-border/60 px-3 py-2 text-xs">
              <summary className="cursor-pointer select-none font-medium text-muted-foreground">{t('diag_technical_detail')}</summary>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">{finalError}</pre>
            </details>
          )}
        </div>

        <DialogFooter className="border-t border-border/60 px-6 py-4">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void copyReport()}>
            <Clipboard className="h-3.5 w-3.5" /> {t('diag_copy_report')}
          </Button>
          <div className="flex-1" />
          <Button variant="outline" size="sm" className="gap-1.5" disabled={running} onClick={() => void runDiagnostics()}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t('diag_run_again')}
          </Button>
          <Button size="sm" disabled={running || !report.retryable} onClick={() => { onOpenChange(false); onRetry() }}>
            {t('conn_btn_retry')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
