import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Play,
  Loader2,
  AlertTriangle,
  Globe,
  Zap,
  Activity,
  Layers,
} from 'lucide-react'
import { useTranslation } from '@/i18n'
import type { NetworkRun, StepResult } from '@/types/network'
import { LayerPipeline } from '../components/layer-pipeline'
import { VerdictCard } from '../components/verdict-card'
import { sshService } from '@/services/ssh-service'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

interface DiagnosticsTabProps {
  serverId: string
  initialTarget?: string
  initialPort?: number
}

const DEFAULT_PIPELINE_STEPS: StepResult[] = [
  { layer: 'dns', name: '1. DNS 域名解析', status: 'pending' },
  { layer: 'route', name: '2. 路由优选', status: 'pending' },
  { layer: 'l3', name: '3. L3 / ICMP 连通性', status: 'pending' },
  { layer: 'tcp', name: '4. L4 TCP 端口握手', status: 'pending' },
  { layer: 'tls', name: '5. L5 TLS / SSL 证书', status: 'pending' },
  { layer: 'http', name: '6. L6 HTTP 应用层请求', status: 'pending' },
]

export function DiagnosticsTab({
  serverId,
  initialTarget = '',
  initialPort = 443,
}: DiagnosticsTabProps) {
  const { t } = useTranslation()
  const [target, setTarget] = useState(initialTarget)
  const [port, setPort] = useState(String(initialPort))
  const [protocol, setProtocol] = useState<'https' | 'http' | 'tcp'>('https')
  const [isRunning, setIsRunning] = useState(false)
  const [currentRun, setCurrentRun] = useState<NetworkRun | null>(null)
  const [pipelineSteps, setPipelineSteps] = useState<StepResult[]>(DEFAULT_PIPELINE_STEPS)
  const [validationError, setValidationError] = useState<string | null>(null)

  // Advanced Tools State
  const [advTool, setAdvTool] = useState<'ping' | 'trace' | 'dns' | 'http'>('ping')
  const [advTarget, setAdvTarget] = useState(initialTarget || '8.8.8.8')
  const [advCount, setAdvCount] = useState('4')
  const [traceMode, setTraceMode] = useState<'icmp' | 'tcp' | 'udp'>('icmp')
  const [advLoading, setAdvLoading] = useState(false)
  const [advOutput, setAdvOutput] = useState<string | null>(null)

  // Listen for real-time progressive steps
  useEffect(() => {
    let unlistenStep: UnlistenFn | undefined
    let unlistenDone: UnlistenFn | undefined

    if (currentRun?.id) {
      const stepChannel = `net://run/${currentRun.id}/step`
      const doneChannel = `net://run/${currentRun.id}/done`

      listen<StepResult>(stepChannel, (event) => {
        setPipelineSteps((prev) => {
          const idx = prev.findIndex((s) => s.layer === event.payload.layer)
          if (idx >= 0) {
            const copy = [...prev]
            copy[idx] = event.payload
            return copy
          }
          return [...prev, event.payload]
        })
      }).then((fn) => {
        unlistenStep = fn
      })

      listen<NetworkRun>(doneChannel, (event) => {
        setCurrentRun(event.payload)
        setPipelineSteps(event.payload.steps)
        setIsRunning(false)
      }).then((fn) => {
        unlistenDone = fn
      })
    }

    return () => {
      unlistenStep?.()
      unlistenDone?.()
    }
  }, [currentRun?.id])

  const handleRunDiagnosis = async () => {
    setValidationError(null)
    const cleanTarget = target.trim()
    if (!cleanTarget) {
      setValidationError(t('net_err_input'))
      return
    }
    if (/\s/.test(cleanTarget)) {
      setValidationError(t('net_err_space'))
      return
    }
    if (/[;|&$`]/.test(cleanTarget)) {
      setValidationError(t('net_err_invalid'))
      return
    }

    const portNum = parseInt(port, 10)
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setValidationError(t('net_err_port'))
      return
    }

    setIsRunning(true)
    setCurrentRun(null)
    setPipelineSteps(
      DEFAULT_PIPELINE_STEPS.map((s) => ({
        ...s,
        status: 'pending' as const,
        durationMs: undefined,
        summary: undefined,
        detail: undefined,
        error: undefined,
      }))
    )

    try {
      const runResult = await sshService.runQuickCheck(
        serverId,
        cleanTarget,
        portNum,
        protocol
      )
      setCurrentRun(runResult)
      if (runResult.steps && runResult.steps.length > 0) {
        setPipelineSteps(runResult.steps)
      }
    } catch (err) {
      console.error('Quick check failed:', err)
      setValidationError(err instanceof Error ? err.message : t('net_err_execute'))
    } finally {
      setIsRunning(false)
    }
  }

  const handleRunAdvTool = async () => {
    if (!advTarget.trim()) return
    setAdvLoading(true)
    setAdvOutput(null)

    try {
      if (advTool === 'ping') {
        const countNum = parseInt(advCount, 10) || 4
        const res = await sshService.runPing(serverId, advTarget.trim(), countNum)
        setAdvOutput(res)
      } else if (advTool === 'trace') {
        const res = await sshService.runTraceroute(serverId, advTarget.trim(), traceMode)
        setAdvOutput(res)
      } else if (advTool === 'dns') {
        const res = await sshService.dnsLookup(serverId, advTarget.trim())
        setAdvOutput(res.stdout || res.stderr)
      } else if (advTool === 'http') {
        const res = await sshService.httpCheck(
          serverId,
          advTarget.startsWith('http') ? advTarget : `https://${advTarget}`
        )
        setAdvOutput(res.stdout || res.stderr)
      }
    } catch (err) {
      setAdvOutput(err instanceof Error ? err.message : '执行失败')
    } finally {
      setAdvLoading(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 h-full overflow-y-auto p-4 space-y-4">
      {/* 6-Layer Quick Check Input Section */}
      <Card className="border border-border/70 bg-card/60 shadow-xs">
        <CardHeader className="p-3.5 pb-2">
          <CardTitle className="text-sm font-semibold flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <span>{t('net_diag_quick_title')}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground text-[11px]">{t('net_diag_proto_label')}:</span>
              <div className="flex items-center rounded-lg border border-border/50 bg-muted/40 p-0.5 text-xs font-mono">
                {(['https', 'http', 'tcp'] as const).map((proto) => (
                  <button
                    key={proto}
                    type="button"
                    onClick={() => {
                      setProtocol(proto)
                      if (proto === 'https') setPort('443')
                      else if (proto === 'http') setPort('80')
                    }}
                    className={`px-2 py-0.5 rounded-md transition-all text-[11px] font-medium uppercase ${
                      protocol === proto ? 'bg-background font-bold text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {proto}
                  </button>
                ))}
              </div>
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent className="p-3.5 pt-1 space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1">
              <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder={t('net_input_placeholder')}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isRunning && handleRunDiagnosis()}
                className="h-8 pl-8 text-xs font-mono bg-background/80"
              />
            </div>
            <Input
              placeholder={t('net_port_placeholder')}
              value={port}
              onChange={(e) => setPort(e.target.value)}
              className="h-8 w-18 text-xs font-mono text-center shrink-0 bg-background/80"
            />
            <Button
              onClick={handleRunDiagnosis}
              disabled={!target.trim() || isRunning}
              className="h-8 text-xs gap-1.5 px-3.5 shrink-0 font-medium"
            >
              {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
              {isRunning ? t('net_diag_running') : t('net_diag_run_btn')}
            </Button>
          </div>

          {validationError && (
            <div className="p-2 rounded bg-red-500/10 text-red-600 dark:text-red-400 text-xs flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Diagnosis Verdict Card */}
      {currentRun?.verdict && (
        <VerdictCard verdict={currentRun.verdict} run={currentRun} />
      )}

      {/* 6-Layer Visual Pipeline */}
      <div className="space-y-2">
        <div className="flex items-center justify-between pb-1 border-b">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-primary" />
            分层诊断流水线 (L1 - L6)
          </h4>
          {currentRun && (
            <span className="text-[11px] font-mono text-muted-foreground">
              耗时: {currentRun.finishedAt ? `${currentRun.finishedAt - currentRun.startedAt}ms` : '进行中...'}
            </span>
          )}
        </div>
        <LayerPipeline steps={pipelineSteps} />
      </div>

      {/* Advanced Diagnostics Tools Section */}
      <Card className="border shadow-sm mt-6">
        <CardHeader className="p-3.5 pb-2 border-b bg-muted/20">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-primary" />
              {t('net_diag_adv_tools')}
            </CardTitle>

            <div className="flex items-center rounded-md border bg-muted/50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setAdvTool('ping')}
                className={`px-2 py-0.5 rounded transition-colors ${
                  advTool === 'ping' ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                {t('net_diag_ping_tool')}
              </button>
              <button
                type="button"
                onClick={() => setAdvTool('trace')}
                className={`px-2 py-0.5 rounded transition-colors ${
                  advTool === 'trace' ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                {t('net_diag_trace_tool')}
              </button>
              <button
                type="button"
                onClick={() => setAdvTool('dns')}
                className={`px-2 py-0.5 rounded transition-colors ${
                  advTool === 'dns' ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                DNS 查询
              </button>
              <button
                type="button"
                onClick={() => setAdvTool('http')}
                className={`px-2 py-0.5 rounded transition-colors ${
                  advTool === 'http' ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                {t('net_diag_curl_tool')}
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-3.5 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="输入目标主机名或 IP"
              value={advTarget}
              onChange={(e) => setAdvTarget(e.target.value)}
              className="h-8 text-xs font-mono w-60"
            />

            {advTool === 'ping' && (
              <Input
                placeholder="次数 (默认 4)"
                value={advCount}
                onChange={(e) => setAdvCount(e.target.value)}
                className="h-8 text-xs font-mono w-24"
              />
            )}

            {advTool === 'trace' && (
              <div className="flex items-center rounded border bg-muted/40 p-0.5 text-[11px] font-mono">
                <button
                  type="button"
                  onClick={() => setTraceMode('icmp')}
                  className={`px-2 py-0.5 rounded ${traceMode === 'icmp' ? 'bg-background font-bold text-foreground' : 'text-muted-foreground'}`}
                >
                  ICMP
                </button>
                <button
                  type="button"
                  onClick={() => setTraceMode('tcp')}
                  className={`px-2 py-0.5 rounded ${traceMode === 'tcp' ? 'bg-background font-bold text-foreground' : 'text-muted-foreground'}`}
                >
                  TCP (-T)
                </button>
                <button
                  type="button"
                  onClick={() => setTraceMode('udp')}
                  className={`px-2 py-0.5 rounded ${traceMode === 'udp' ? 'bg-background font-bold text-foreground' : 'text-muted-foreground'}`}
                >
                  UDP (-U)
                </button>
              </div>
            )}

            <Button
              size="sm"
              onClick={handleRunAdvTool}
              disabled={!advTarget.trim() || advLoading}
              className="h-8 text-xs gap-1 px-3"
            >
              {advLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 fill-current" />}
              执行测试
            </Button>
          </div>

          {advOutput && (
            <div className="space-y-1">
              <span className="text-[11px] text-muted-foreground font-medium">执行输出结果:</span>
              <pre className="p-3 rounded-lg bg-muted/50 border font-mono text-xs text-foreground max-h-60 overflow-auto whitespace-pre-wrap leading-relaxed">
                {advOutput}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
