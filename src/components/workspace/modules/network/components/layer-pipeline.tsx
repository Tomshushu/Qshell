import { Badge } from '@/components/ui/badge'
import { CheckCircle2, AlertTriangle, XCircle, Clock, Loader2, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StepResult } from '@/types/network'

interface LayerPipelineProps {
  steps: StepResult[]
  currentStepIndex?: number
}

export function LayerPipeline({ steps }: LayerPipelineProps) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/50 overflow-hidden divide-y divide-border/40 shadow-xs">
      {steps.map((step, idx) => {
        return (
          <div
            key={idx}
            className={cn(
              'transition-all duration-150',
              step.status === 'running' && 'bg-primary/5',
              step.status === 'ok' && 'bg-emerald-500/[0.02]',
              step.status === 'warn' && 'bg-amber-500/[0.03]',
              step.status === 'fail' && 'bg-rose-500/[0.04]',
              step.status === 'pending' && 'hover:bg-muted/30'
            )}
          >
            <div className="px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted/60 shrink-0">
                    <StatusIcon status={step.status} />
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-xs font-medium truncate",
                        step.status === 'pending' ? "text-muted-foreground" : "text-foreground font-semibold"
                      )}>
                        {step.name}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 uppercase font-mono tracking-wider bg-background/50 border-border/60">
                        {step.layer}
                      </Badge>
                      {step.durationMs != null && step.durationMs > 0 && (
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono tabular-nums font-medium">
                          {step.durationMs}ms
                        </span>
                      )}
                    </div>
                    {step.summary && (
                      <p className={cn(
                        'text-xs mt-0.5 truncate',
                        step.status === 'ok' && 'text-emerald-600 dark:text-emerald-400',
                        step.status === 'warn' && 'text-amber-600 dark:text-amber-400',
                        step.status === 'fail' && 'text-rose-600 dark:text-rose-400',
                        (step.status === 'pending' || step.status === 'skipped') && 'text-muted-foreground'
                      )}>
                        {step.summary}
                      </p>
                    )}
                  </div>
                </div>

              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
    case 'ok':
      return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
    case 'warn':
      return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
    case 'fail':
      return <XCircle className="h-4 w-4 text-red-500 shrink-0" />
    case 'skipped':
      return <HelpCircle className="h-4 w-4 text-muted-foreground shrink-0 opacity-50" />
    case 'pending':
    default:
      return <Clock className="h-4 w-4 text-muted-foreground shrink-0 opacity-60" />
  }
}
