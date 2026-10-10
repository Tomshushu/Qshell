import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  History,
  GitCompare,
  Trash2,
  Download,
  RefreshCw,
  Activity,
} from 'lucide-react'
import { useTranslation } from '@/i18n'
import type { NetworkRunSummary, NetworkRun, RunDiff } from '@/types/network'
import { sshService } from '@/services/ssh-service'
import { LayerPipeline } from '../components/layer-pipeline'
import { VerdictCard } from '../components/verdict-card'

interface HistoryTabProps {
  serverId?: string
  runs: NetworkRunSummary[]
  loading: boolean
  onRefresh: () => void
}

export function HistoryTab({
  runs,
  loading,
  onRefresh,
}: HistoryTabProps) {
  const { t } = useTranslation()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activeRun, setActiveRun] = useState<NetworkRun | null>(null)
  const [runDetailOpen, setRunDetailOpen] = useState(false)
  const [diffResult, setDiffResult] = useState<RunDiff | null>(null)
  const [diffOpen, setDiffOpen] = useState(false)
  const [comparing, setComparing] = useState(false)

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id)
      }
      if (prev.length >= 2) {
        return [prev[1], id]
      }
      return [...prev, id]
    })
  }

  const handleViewDetails = async (id: string) => {
    try {
      const run = await sshService.getNetworkRun(id)
      if (run) {
        setActiveRun(run)
        setRunDetailOpen(true)
      }
    } catch (err) {
      console.error('Failed to get run details:', err)
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await sshService.deleteNetworkRun(id)
      setSelectedIds((prev) => prev.filter((i) => i !== id))
      onRefresh()
    } catch (err) {
      console.error('Failed to delete run:', err)
    }
  }

  const handleCompare = async () => {
    if (selectedIds.length !== 2) return
    setComparing(true)
    try {
      const diff = await sshService.compareNetworkRuns(selectedIds[0], selectedIds[1])
      setDiffResult(diff)
      setDiffOpen(true)
    } catch (err) {
      console.error('Failed to compare runs:', err)
    } finally {
      setComparing(false)
    }
  }

  const handleExport = async (id: string, format: 'html' | 'json' | 'csv') => {
    try {
      const res = await sshService.exportNetworkReport(id, format)
      const mime =
        format === 'html'
          ? 'text/html;charset=utf-8'
          : format === 'json'
          ? 'application/json;charset=utf-8'
          : 'text/csv;charset=utf-8'
      const blob = new Blob([res.content], { type: mime })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed:', err)
    }
  }

  return (
    <div className="flex-1 min-h-0 h-full flex flex-col overflow-hidden p-4 space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between pb-2 border-b">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{t('net_hist_title')}</h3>
          <span className="text-xs text-muted-foreground">({runs.length})</span>
        </div>

        <div className="flex items-center gap-2">
          {selectedIds.length === 2 && (
            <Button
              size="sm"
              onClick={handleCompare}
              disabled={comparing}
              className="h-7 text-xs gap-1.5"
            >
              <GitCompare className="h-3.5 w-3.5" />
              {t('net_hist_compare_btn')}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            className="h-7 text-xs gap-1"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {t('net_refresh')}
          </Button>
        </div>
      </div>

      {/* Runs Table / Cards */}
      <div className="flex-1 min-h-0 overflow-auto">
        {runs.length === 0 ? (
          <div className="py-24 text-center text-xs text-muted-foreground">
            <History className="h-10 w-10 mx-auto mb-2 opacity-30" />
            {t('net_hist_empty')}
          </div>
        ) : (
          <div className="border rounded-lg bg-card overflow-hidden">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-muted/95 backdrop-blur-xs z-10">
                <tr className="border-b border-border/60 text-muted-foreground text-[11px] font-medium">
                  <th className="py-2.5 px-3 w-10 text-center">对比</th>
                  <th className="py-2.5 px-3">{t('net_hist_target')}</th>
                  <th className="py-2.5 px-3">{t('net_hist_status')}</th>
                  <th className="py-2.5 px-3">{t('net_diag_failed_layer')}</th>
                  <th className="py-2.5 px-3">{t('net_hist_duration')}</th>
                  <th className="py-2.5 px-3">{t('net_hist_time')}</th>
                  <th className="py-2.5 px-3 text-right">{t('net_hist_actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y font-mono text-[11px]">
                {runs.map((r) => {
                  const isChecked = selectedIds.includes(r.id)
                  const dateStr = new Date(r.startedAt).toLocaleString()
                  return (
                    <tr
                      key={r.id}
                      onClick={() => handleViewDetails(r.id)}
                      className={`hover:bg-muted/30 transition-colors cursor-pointer ${
                        isChecked ? 'bg-primary/5' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleSelect(r.id)}
                          className="rounded border-gray-300 text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer"
                        />
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-foreground">
                        {r.target}
                        {r.port && <span className="text-muted-foreground font-normal">:{r.port}</span>}
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1.5 py-0 font-mono ${
                            r.status === 'ok'
                              ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30'
                              : r.status === 'warn'
                              ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30'
                              : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30'
                          }`}
                        >
                          {r.status.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3">
                        {r.failedLayer ? (
                          <span className="text-red-500 font-bold uppercase">{r.failedLayer}</span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground">
                        {r.durationMs != null ? `${r.durationMs}ms` : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground font-sans text-[11px]">
                        {dateStr}
                      </td>
                      <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1 font-sans">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleExport(r.id, 'html')}
                            className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground gap-1"
                            title="导出 HTML"
                          >
                            <Download className="h-3 w-3" />
                            HTML
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => handleDelete(r.id, e)}
                            className="h-6 px-1.5 text-[10px] text-red-500 hover:bg-red-500/10"
                            title={t('net_hist_delete')}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Run Details Modal */}
      <Dialog open={runDetailOpen} onOpenChange={setRunDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <span>体检记录详情: {activeRun?.spec.target}</span>
            </DialogTitle>
          </DialogHeader>

          {activeRun && (
            <div className="space-y-4 text-xs">
              {activeRun.verdict && (
                <VerdictCard verdict={activeRun.verdict} run={activeRun} />
              )}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  分层流水线记录
                </span>
                <LayerPipeline steps={activeRun.steps} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Diff Modal */}
      <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <GitCompare className="h-4 w-4 text-primary" />
              <span>{t('net_hist_diff_title')}</span>
            </DialogTitle>
          </DialogHeader>

          {diffResult && (
            <div className="space-y-4 text-xs">
              {/* Top comparison summary */}
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border bg-muted/20 font-mono">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase">Run A (基准)</div>
                  <div className="font-bold text-foreground text-sm mt-0.5">{diffResult.runA.spec.target}</div>
                  <div className="text-muted-foreground text-[10px]">
                    {new Date(diffResult.runA.startedAt).toLocaleString()}
                  </div>
                  <Badge variant="outline" className="mt-1 text-[9px] uppercase">
                    Status: {diffResult.runA.status}
                  </Badge>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase">Run B (比对)</div>
                  <div className="font-bold text-foreground text-sm mt-0.5">{diffResult.runB.spec.target}</div>
                  <div className="text-muted-foreground text-[10px]">
                    {new Date(diffResult.runB.startedAt).toLocaleString()}
                  </div>
                  <Badge variant="outline" className="mt-1 text-[9px] uppercase">
                    Status: {diffResult.runB.status}
                  </Badge>
                </div>
              </div>

              {/* Diff points */}
              <div className="space-y-2 font-mono">
                {diffResult.dnsDiff && (
                  <div className="p-3 rounded-lg border bg-yellow-500/5 border-yellow-500/20">
                    <span className="font-semibold text-foreground block mb-1">DNS 解析差异:</span>
                    <p className="text-muted-foreground">{diffResult.dnsDiff}</p>
                  </div>
                )}
                {diffResult.routeDiff && (
                  <div className="p-3 rounded-lg border bg-yellow-500/5 border-yellow-500/20">
                    <span className="font-semibold text-foreground block mb-1">选路差异:</span>
                    <p className="text-muted-foreground">{diffResult.routeDiff}</p>
                  </div>
                )}
                {diffResult.latencyDiffMs != null && (
                  <div className="p-3 rounded-lg border bg-muted/30">
                    <span className="font-semibold text-foreground block mb-1">耗时差异:</span>
                    <p className="text-muted-foreground">
                      Run B 耗时相较 Run A 变化: {diffResult.latencyDiffMs > 0 ? `+${diffResult.latencyDiffMs}ms` : `${diffResult.latencyDiffMs}ms`}
                    </p>
                  </div>
                )}
                {!diffResult.dnsDiff && !diffResult.routeDiff && (
                  <div className="p-4 text-center text-muted-foreground bg-muted/20 rounded-lg">
                    两次体检的 DNS 解析与路由出接口一致，无明显拓扑漂移。
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
