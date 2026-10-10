import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, AlertTriangle, XCircle, Clock, Loader2, ChevronDown, ChevronRight, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import type { StepResult } from '@/types/network'

interface LayerPipelineProps {
  steps: StepResult[]
  currentStepIndex?: number
}

export function LayerPipeline({ steps }: LayerPipelineProps) {
  const { t } = useTranslation()
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

  const toggleExpand = (idx: number) => {
    setExpandedIndex(prev => prev === idx ? null : idx)
  }

  return (
    <div className="space-y-2">
      {steps.map((step, idx) => {
        const isExpanded = expandedIndex === idx
        return (
          <Card
            key={idx}
            className={cn(
              'border transition-all duration-200',
              step.status === 'running' && 'border-primary/60 bg-primary/5 shadow-sm',
              step.status === 'ok' && 'border-green-500/30 bg-green-500/5',
              step.status === 'warn' && 'border-yellow-500/30 bg-yellow-500/5',
              step.status === 'fail' && 'border-red-500/30 bg-red-500/5',
              step.status === 'skipped' && 'border-border/40 opacity-60 bg-muted/20',
              step.status === 'pending' && 'border-border/40 bg-card/50 opacity-70'
            )}
          >
            <CardContent className="p-3">
              <div
                className="flex items-center justify-between gap-3 cursor-pointer select-none"
                onClick={() => toggleExpand(idx)}
              >
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <StatusIcon status={step.status} />
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground truncate">
                        {step.name}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 uppercase font-mono tracking-wider">
                        {step.layer}
                      </Badge>
                      {step.durationMs != null && step.durationMs > 0 && (
                        <span className="text-[11px] text-muted-foreground font-mono">
                          {step.durationMs}ms
                        </span>
                      )}
                    </div>
                    {step.summary && (
                      <p className={cn(
                        'text-xs mt-0.5 truncate',
                        step.status === 'ok' && 'text-green-700 dark:text-green-400',
                        step.status === 'warn' && 'text-yellow-700 dark:text-yellow-400',
                        step.status === 'fail' && 'text-red-700 dark:text-red-400',
                        (step.status === 'pending' || step.status === 'skipped') && 'text-muted-foreground'
                      )}>
                        {step.summary}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {step.detail ? (
                    isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  ) : null}
                </div>
              </div>

              {isExpanded && (step.detail || step.error) && (
                <div className="mt-2.5 pt-2 border-t border-border/40 text-[11px] font-mono">
                  {step.error && (
                    <div className="mb-2 p-2 rounded bg-red-500/10 text-red-600 dark:text-red-400">
                      <strong>Error:</strong> {step.error}
                    </div>
                  )}
                  {step.detail && (
                    <div>
                      <div className="text-[10px] uppercase text-muted-foreground mb-1 font-sans">
                        {t('net_view_raw')}
                      </div>
                      <pre className="p-2 rounded bg-muted/60 text-muted-foreground max-h-48 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed">
                        {step.detail}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
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
