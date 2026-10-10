import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckCircle2, AlertOctagon, AlertTriangle, Download, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import type { Verdict, NetworkRun } from '@/types/network'
import { sshService } from '@/services/ssh-service'

interface VerdictCardProps {
  verdict: Verdict
  run?: NetworkRun
  onExport?: (format: 'html' | 'json' | 'csv') => void
}

export function VerdictCard({ verdict, run, onExport }: VerdictCardProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const isHealthy = !verdict.failedLayer && verdict.causes.length === 0
  const isWarning = !verdict.failedLayer && verdict.causes.length > 0
  const isFailed = !!verdict.failedLayer

  const handleCopySummary = async () => {
    const text = `[Network Diagnosis Result]\nSummary: ${verdict.summary}\nFailed Layer: ${verdict.failedLayer || 'None'}\nCauses:\n${verdict.causes.map(c => `- ${c}`).join('\n')}\nActions:\n${verdict.nextActions.map(a => `- ${a}`).join('\n')}`
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExport = async (format: 'html' | 'json') => {
    if (onExport) {
      onExport(format)
      return
    }
    if (run?.id) {
      try {
        const result = await sshService.exportNetworkReport(run.id, format)
        const blob = new Blob([result.content], {
          type: format === 'html' ? 'text/html;charset=utf-8' : 'application/json;charset=utf-8'
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = result.filename
        a.click()
        URL.revokeObjectURL(url)
      } catch (err) {
        console.error('Export failed:', err)
      }
    }
  }

  return (
    <Card className={cn(
      'border-l-4 shadow-sm transition-all',
      isHealthy && 'border-l-green-500 bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-900',
      isWarning && 'border-l-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-900',
      isFailed && 'border-l-red-500 bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-900'
    )}>
      <CardHeader className="pb-2 pt-3 px-4 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          {isHealthy && <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />}
          {isWarning && <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />}
          {isFailed && <AlertOctagon className="h-5 w-5 text-red-600 dark:text-red-400" />}
          <CardTitle className="text-sm font-semibold">
            {t('net_diag_verdict_title')}
          </CardTitle>
          {verdict.failedLayer && (
            <Badge variant="destructive" className="uppercase font-mono text-[11px] tracking-wider px-2 py-0.5">
              {t('net_diag_failed_layer')}: {verdict.failedLayer}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopySummary}
            className="h-7 text-xs px-2 gap-1 text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? t('net_copy_success') : t('common_copy') || '复制'}
          </Button>
          {run && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleExport('html')}
              className="h-7 text-xs px-2 gap-1"
            >
              <Download className="h-3.5 w-3.5" />
              {t('net_diag_export_report')}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-3.5 pt-1 space-y-2.5 text-xs">
        <div className={cn(
          'p-2 rounded text-xs font-medium leading-relaxed',
          isHealthy && 'bg-green-100/60 dark:bg-green-900/40 text-green-900 dark:text-green-200',
          isWarning && 'bg-yellow-100/60 dark:bg-yellow-900/40 text-yellow-900 dark:text-yellow-200',
          isFailed && 'bg-red-100/60 dark:bg-red-900/40 text-red-900 dark:text-red-200'
        )}>
          {verdict.summary}
        </div>

        {verdict.nextActions.length > 0 && (
          <div>
            <span className="font-semibold text-foreground flex items-center gap-1 mb-1">
              {t('net_diag_actions')}:
            </span>
            <ul className="space-y-1 pl-4 list-disc text-muted-foreground leading-relaxed">
              {verdict.nextActions.map((action, i) => (
                <li key={i}>{action}</li>
              ))}
            </ul>
          </div>
        )}

        {verdict.causes.length > 0 && (
          <div>
            <span className="font-semibold text-foreground flex items-center gap-1 mb-1">
              {t('net_diag_causes')}:
            </span>
            <ul className="space-y-1 pl-4 list-disc text-muted-foreground leading-relaxed">
              {verdict.causes.map((cause, i) => (
                <li key={i}>{cause}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
