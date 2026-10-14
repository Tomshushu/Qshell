import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Camera, Download, Copy, X, Cpu, MemoryStick, Activity, Network, Container, AlertCircle, Server, Monitor, Clock, Terminal as TerminalIcon, Package, Wrench } from 'lucide-react'
import { sshService } from '@/services/ssh-service'
import { useTranslation } from '@/i18n'
import { cn } from '@/lib/utils'

interface SnapshotRawData {
  serverId: string
  createdAt: number
  metricsRaw?: string
  servicesRaw?: string
  processesRaw?: string
  portsRaw?: string
  dockerRaw?: string
  metricsError?: string
  servicesError?: string
  processesError?: string
  portsError?: string
  dockerError?: string
  systemInfoRaw?: string
  systemInfoError?: string
}

/** 解析 systemInfoRaw（每行 key=value 格式）为字段映射 */
function parseSystemInfo(raw?: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!raw) return result
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const idx = trimmed.indexOf('=')
    if (idx <= 0) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (key) result[key] = value
  }
  return result
}

/** 运行时间秒数格式化为可读文本 */
function formatUptime(secondsStr: string, t: (key: string) => string): string {
  const sec = Number(secondsStr)
  if (!Number.isFinite(sec) || sec < 0) return secondsStr
  const days = Math.floor(sec / 86400)
  const hours = Math.floor((sec % 86400) / 3600)
  const minutes = Math.floor((sec % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}${t('time_days')}`)
  if (hours > 0) parts.push(`${hours}${t('time_hours')}`)
  if (minutes > 0) parts.push(`${minutes}${t('time_minutes')}`)
  return parts.length ? parts.join(' ') : `${sec}${t('time_seconds')}`
}

interface SnapshotModalProps {
  open: boolean
  onClose: () => void
  serverName: string
  serverId: string
}

export function SnapshotModal({ open, onClose, serverName, serverId }: SnapshotModalProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState<'collecting' | 'done' | 'error'>('collecting')
  const [collectProgress, setCollectProgress] = useState(0)
  const [collectLabel, setCollectLabel] = useState(t('snap_collecting_system'))
  const [snapshot, setSnapshot] = useState<SnapshotRawData | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const startCollection = useCallback(async () => {
    setStep('collecting')
    setCollectProgress(0)
    setCollectLabel(t('snap_collecting_system'))
    setSnapshot(null)
    setErrorMessage(null)

    const progressSteps = [
      { label: t('snap_collecting_system_info'), progress: 15 },
      { label: t('snap_collecting_system'), progress: 30 },
      { label: t('snap_collecting_services'), progress: 50 },
      { label: t('snap_collecting_processes'), progress: 70 },
      { label: t('snap_collecting_ports'), progress: 85 },
      { label: t('snap_collecting_docker'), progress: 100 },
    ]

    // Animate progress while the API call is in flight
    let currentStep = 0
    const interval = setInterval(() => {
      if (currentStep < progressSteps.length) {
        setCollectLabel(progressSteps[currentStep].label)
        setCollectProgress(progressSteps[currentStep].progress)
        currentStep++
      }
    }, 800)

    try {
      const result = await sshService.generateSnapshot(serverId)
      clearInterval(interval)
      setCollectProgress(100)
      setCollectLabel(t('snap_collecting_done'))

      if (result) {
        setSnapshot(result as unknown as SnapshotRawData)
        setStep('done')
      } else {
        setErrorMessage(t('snap_err_no_data'))
        setStep('error')
      }
    } catch (e) {
      clearInterval(interval)
      setErrorMessage((e instanceof Error ? e.message : String(e)) || t('snap_err_failed'))
      setStep('error')
    }
  }, [serverId, t])

  useEffect(() => {
    if (open) {
      // 延后到宏任务开始采集，避免在 effect 内同步 setState 触发级联渲染
      const timer = setTimeout(() => {
        startCollection()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [open, startCollection])

  // 解析系统信息为结构化字段
  const systemInfo = useMemo(() => parseSystemInfo(snapshot?.systemInfoRaw), [snapshot?.systemInfoRaw])
  // 运行时间格式化（Windows 输出为秒数，Linux uptime -p 已为可读文本）
  const uptimeDisplay = useMemo(() => {
    const raw = systemInfo.UPTIME
    if (!raw) return ''
    // 若为纯数字（秒），格式化为可读文本；否则保留原文本（如 "up 2 hours, 3 minutes"）
    return /^\d+(\.\d+)?$/.test(raw.trim()) ? formatUptime(raw, t) : raw
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemInfo.UPTIME])
  // 启动时间格式化
  const bootTimeDisplay = useMemo(() => {
    const raw = systemInfo.BOOT_TIME
    if (!raw) return ''
    // Linux uptime -s 输出 "2024-01-01 12:00:00" 格式；Windows 输出 CIM DateTime
    const d = new Date(raw)
    return isNaN(d.getTime()) ? raw : d.toLocaleString()
  }, [systemInfo.BOOT_TIME])

  const handleCopy = async () => {
    if (!snapshot) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: ignore
    }
  }

  const handleDownload = () => {
    if (!snapshot) return
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `snapshot-${serverName}-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" className="bg-card border border-border/60 rounded-xl shadow-2xl w-[min(760px,calc(100vw-2rem))] h-[min(680px,calc(100vh-2rem))] flex flex-col overflow-hidden">
        {/* 标题栏：固定不动 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/60 bg-gradient-to-r from-primary/5 to-transparent flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 flex-shrink-0">
              <Camera className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold truncate">{t('snap_title')}</h2>
              <p className="text-[11px] text-muted-foreground truncate">{serverName}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 中间内容区：可滚动，头部与底部按钮固定 */}
        <div className="flex-1 overflow-y-auto p-5">
          {step === 'collecting' && (
            <div className="py-12">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-3">
                  <Camera className="h-7 w-7 text-primary animate-pulse" />
                </div>
                <p className="text-sm text-muted-foreground">{collectLabel}</p>
              </div>
              <div className="max-w-md mx-auto">
                <Progress value={collectProgress} className="h-1.5" />
                <p className="text-xs text-muted-foreground text-center mt-2">{collectProgress}%</p>
              </div>
            </div>
          )}

          {step === 'error' && (
            <div className="py-12 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500/10 mb-3">
                <AlertCircle className="h-7 w-7 text-red-500" />
              </div>
              <p className="text-sm text-red-500 mb-4 max-w-md mx-auto">{errorMessage}</p>
              <Button variant="outline" size="sm" onClick={startCollection}>{t('snap_retry')}</Button>
            </div>
          )}

          {step === 'done' && snapshot && (
            <Tabs defaultValue="summary">
              <TabsList className="mb-4">
                <TabsTrigger value="summary">{t('snap_tab_summary')}</TabsTrigger>
                <TabsTrigger value="detail">{t('snap_tab_detail')}</TabsTrigger>
                <TabsTrigger value="raw">{t('snap_tab_raw')}</TabsTrigger>
              </TabsList>

              <TabsContent value="summary">
                {/* 状态概览：5 个维度的小卡片 */}
                <div className="grid grid-cols-5 gap-2 mb-4">
                  {[
                    { label: t('snap_system_info'), ok: !snapshot.systemInfoError, icon: <Server className="h-3 w-3" />, color: 'text-primary' },
                    { label: t('snap_system_metrics'), ok: !snapshot.metricsError, icon: <Cpu className="h-3 w-3" />, color: 'text-primary' },
                    { label: t('snap_services'), ok: !snapshot.servicesError, icon: <Activity className="h-3 w-3" />, color: 'text-green-500' },
                    { label: t('snap_ports'), ok: !snapshot.portsError, icon: <Network className="h-3 w-3" />, color: 'text-orange-500' },
                    { label: t('snap_docker'), ok: !snapshot.dockerError, icon: <Container className="h-3 w-3" />, color: 'text-blue-500' },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className={cn(
                        'flex flex-col items-center gap-1 p-2 rounded-lg border text-center transition-colors',
                        item.ok
                          ? 'border-border/50 bg-muted/30'
                          : 'border-red-200 bg-red-500/5'
                      )}
                    >
                      <div className={cn('flex-shrink-0', item.color)}>{item.icon}</div>
                      <span className="text-[10px] text-muted-foreground leading-tight line-clamp-2">{item.label}</span>
                      <span className={cn('text-[10px] font-medium', item.ok ? 'text-emerald-600' : 'text-red-500')}>
                        {item.ok ? '✓' : '✕'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* 结构化系统信息卡片：发行版/版本号/内核/架构/主机名/CPU/运行时间等 */}
                {snapshot.systemInfoError ? (
                  <div className="mt-3 p-3 rounded-lg border border-red-200 bg-red-500/5">
                    <p className="text-xs text-red-500">{t('snap_system_info')}: {snapshot.systemInfoError}</p>
                  </div>
                ) : Object.keys(systemInfo).length > 0 ? (
                  <div className="mt-3 rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
                    <div className="px-3 py-2 border-b border-border/40 bg-muted/30 flex items-center gap-1.5">
                      <Server className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-medium">{t('snap_system_info')}</span>
                    </div>
                    <div className="p-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      {/* 发行版（Ubuntu/CentOS/Debian 等）与版本号 */}
                      {(systemInfo.OS_PRETTY || systemInfo.OS_NAME) && (
                        <div className="flex items-start gap-1.5">
                          <Monitor className="h-3 w-3 mt-0.5 text-muted-foreground/60 flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-muted-foreground">{t('snap_os')}: </span>
                            <span className="font-medium break-all">{systemInfo.OS_PRETTY || systemInfo.OS_NAME}</span>
                            {systemInfo.OS_VERSION && <span className="text-muted-foreground"> ({systemInfo.OS_VERSION})</span>}
                          </div>
                        </div>
                      )}
                      {/* 内核版本 */}
                      {systemInfo.KERNEL && (
                        <div className="flex items-start gap-1.5">
                          <TerminalIcon className="h-3 w-3 mt-0.5 text-muted-foreground/60 flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-muted-foreground">{t('snap_kernel')}: </span>
                            <span className="font-medium break-all">{systemInfo.KERNEL}</span>
                          </div>
                        </div>
                      )}
                      {/* 系统架构 */}
                      {systemInfo.ARCH && (
                        <div className="flex items-start gap-1.5">
                          <Cpu className="h-3 w-3 mt-0.5 text-muted-foreground/60 flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-muted-foreground">{t('snap_arch')}: </span>
                            <span className="font-medium">{systemInfo.ARCH}</span>
                          </div>
                        </div>
                      )}
                      {/* 主机名 */}
                      {systemInfo.HOSTNAME && (
                        <div className="flex items-start gap-1.5">
                          <Server className="h-3 w-3 mt-0.5 text-muted-foreground/60 flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-muted-foreground">{t('snap_hostname')}: </span>
                            <span className="font-medium break-all">{systemInfo.HOSTNAME}</span>
                          </div>
                        </div>
                      )}
                      {/* CPU 型号 */}
                      {systemInfo.CPU_MODEL && (
                        <div className="flex items-start gap-1.5 col-span-2">
                          <Cpu className="h-3 w-3 mt-0.5 text-muted-foreground/60 flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-muted-foreground">{t('snap_cpu_model')}: </span>
                            <span className="font-medium break-all">{systemInfo.CPU_MODEL}</span>
                            {systemInfo.CPU_CORES && <span className="text-muted-foreground"> ({systemInfo.CPU_CORES} {t('snap_cores')}{systemInfo.CPU_LOGICAL ? ` / ${systemInfo.CPU_LOGICAL} ${t('snap_logical')}` : ''})</span>}
                          </div>
                        </div>
                      )}
                      {/* 运行时间 */}
                      {uptimeDisplay && (
                        <div className="flex items-start gap-1.5">
                          <Clock className="h-3 w-3 mt-0.5 text-muted-foreground/60 flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-muted-foreground">{t('snap_uptime')}: </span>
                            <span className="font-medium">{uptimeDisplay}</span>
                          </div>
                        </div>
                      )}
                      {/* 启动时间 */}
                      {bootTimeDisplay && (
                        <div className="flex items-start gap-1.5">
                          <Clock className="h-3 w-3 mt-0.5 text-muted-foreground/60 flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-muted-foreground">{t('snap_boot_time')}: </span>
                            <span className="font-medium break-all">{bootTimeDisplay}</span>
                          </div>
                        </div>
                      )}
                      {/* Shell */}
                      {systemInfo.SHELL && (
                        <div className="flex items-start gap-1.5">
                          <TerminalIcon className="h-3 w-3 mt-0.5 text-muted-foreground/60 flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-muted-foreground">{t('snap_shell')}: </span>
                            <span className="font-medium break-all">{systemInfo.SHELL}</span>
                          </div>
                        </div>
                      )}
                      {/* 包管理器 */}
                      {systemInfo.PKG_MGR && (
                        <div className="flex items-start gap-1.5">
                          <Package className="h-3 w-3 mt-0.5 text-muted-foreground/60 flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-muted-foreground">{t('snap_pkg_mgr')}: </span>
                            <span className="font-medium">{systemInfo.PKG_MGR}</span>
                          </div>
                        </div>
                      )}
                      {/* 制造商（Windows） */}
                      {systemInfo.MANUFACTURER && (
                        <div className="flex items-start gap-1.5">
                          <Wrench className="h-3 w-3 mt-0.5 text-muted-foreground/60 flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-muted-foreground">{t('snap_manufacturer')}: </span>
                            <span className="font-medium break-all">{systemInfo.MANUFACTURER}</span>
                          </div>
                        </div>
                      )}
                      {/* 设备型号（Windows） */}
                      {systemInfo.MODEL && (
                        <div className="flex items-start gap-1.5">
                          <Monitor className="h-3 w-3 mt-0.5 text-muted-foreground/60 flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-muted-foreground">{t('snap_model')}: </span>
                            <span className="font-medium break-all">{systemInfo.MODEL}</span>
                          </div>
                        </div>
                      )}
                      {/* OS Build 号（Windows） */}
                      {systemInfo.OS_BUILD && (
                        <div className="flex items-start gap-1.5">
                          <TerminalIcon className="h-3 w-3 mt-0.5 text-muted-foreground/60 flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-muted-foreground">{t('snap_os_build')}: </span>
                            <span className="font-medium">{systemInfo.OS_BUILD}</span>
                          </div>
                        </div>
                      )}
                      {/* GCC 版本（若存在） */}
                      {systemInfo.GCC && (
                        <div className="flex items-start gap-1.5">
                          <Wrench className="h-3 w-3 mt-0.5 text-muted-foreground/60 flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-muted-foreground">GCC: </span>
                            <span className="font-medium break-all">{systemInfo.GCC}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* Show metrics summary if available */}
                {snapshot.metricsRaw && (
                  <div className="mt-3 rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
                    <div className="px-3 py-2 border-b border-border/40 bg-muted/30 flex items-center gap-1.5">
                      <Cpu className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-medium">{t('snap_system_metrics')}</span>
                    </div>
                    <div className="p-3">
                      <pre className="text-[11px] font-mono whitespace-pre-wrap text-muted-foreground">{snapshot.metricsRaw}</pre>
                    </div>
                  </div>
                )}

                {/* Show errors if any */}
                {(snapshot.metricsError || snapshot.servicesError || snapshot.processesError || snapshot.portsError || snapshot.dockerError || snapshot.systemInfoError) && (
                  <div className="mt-3 rounded-lg border border-red-200 bg-red-500/5 overflow-hidden">
                    <div className="px-3 py-2 border-b border-red-200/50 bg-red-500/10 flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                      <span className="text-xs font-medium text-red-500">{t('snap_partial_error')}</span>
                    </div>
                    <div className="p-3 space-y-1 text-xs text-red-500">
                      {snapshot.systemInfoError && <p>{t('snap_system_info')}: {snapshot.systemInfoError}</p>}
                      {snapshot.metricsError && <p>{t('snap_system_metrics')}: {snapshot.metricsError}</p>}
                      {snapshot.servicesError && <p>{t('snap_service_status')}: {snapshot.servicesError}</p>}
                      {snapshot.processesError && <p>{t('snap_process_list')}: {snapshot.processesError}</p>}
                      {snapshot.portsError && <p>{t('snap_listen_ports')}: {snapshot.portsError}</p>}
                      {snapshot.dockerError && <p>{t('snap_docker')}: {snapshot.dockerError}</p>}
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="detail">
                <div className="space-y-3">
                  {[
                    { title: t('snap_system_info'), icon: <Server className="h-3.5 w-3.5 text-primary" />, raw: snapshot.systemInfoRaw, error: snapshot.systemInfoError },
                    { title: t('snap_service_status'), icon: <Activity className="h-3.5 w-3.5 text-green-500" />, raw: snapshot.servicesRaw, error: snapshot.servicesError },
                    { title: t('snap_process_list'), icon: <Cpu className="h-3.5 w-3.5 text-primary" />, raw: snapshot.processesRaw, error: snapshot.processesError },
                    { title: t('snap_listen_ports'), icon: <Network className="h-3.5 w-3.5 text-orange-500" />, raw: snapshot.portsRaw, error: snapshot.portsError },
                    { title: t('snap_docker_containers'), icon: <Container className="h-3.5 w-3.5 text-blue-500" />, raw: snapshot.dockerRaw, error: snapshot.dockerError },
                    { title: t('snap_system_metrics'), icon: <MemoryStick className="h-3.5 w-3.5 text-primary" />, raw: snapshot.metricsRaw, error: snapshot.metricsError },
                  ].map((item) => (
                    <div key={item.title} className="rounded-lg border border-border/50 bg-muted/20 overflow-hidden">
                      <div className="px-3 py-2 border-b border-border/40 bg-muted/30 flex items-center gap-1.5">
                        {item.icon}
                        <span className="text-xs font-medium">{item.title}</span>
                      </div>
                      <div className="p-3">
                        {item.error ? (
                          <p className="text-xs text-red-500">{item.error}</p>
                        ) : item.raw ? (
                          <pre className="text-[11px] font-mono whitespace-pre-wrap text-muted-foreground">{item.raw}</pre>
                        ) : (
                          <p className="text-xs text-muted-foreground">{t('snap_no_data')}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="raw">
                <pre className="text-[11px] font-mono bg-muted/30 border border-border/50 rounded-lg p-3 overflow-auto max-h-[480px]">
                  {JSON.stringify(snapshot, null, 2)}
                </pre>
              </TabsContent>
            </Tabs>
          )}
        </div>

        {step === 'done' && (
          <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border/60 bg-muted/20 flex-shrink-0">
            <div className="text-[11px] text-muted-foreground">
              {snapshot ? new Date(snapshot.createdAt).toLocaleString() : ''}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5 h-7" onClick={handleCopy}>
                <Copy className="h-3.5 w-3.5" />
                {copied ? t('snap_copied') : t('snap_copied_clipboard')}
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 h-7" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5" />
                {t('snap_save_file')}
              </Button>
              <Button size="sm" className="h-7" onClick={onClose}>{t('snap_close')}</Button>
            </div>
          </div>
        )}

        {step === 'collecting' && (
          <div className="px-5 py-3 border-t border-border/60 bg-muted/20 flex justify-end flex-shrink-0">
            <Button variant="outline" size="sm" className="h-7" onClick={onClose}>{t('snap_cancel')}</Button>
          </div>
        )}

        {step === 'error' && (
          <div className="px-5 py-3 border-t border-border/60 bg-muted/20 flex justify-end gap-2 flex-shrink-0">
            <Button variant="outline" size="sm" className="h-7" onClick={startCollection}>{t('snap_retry')}</Button>
            <Button size="sm" className="h-7" onClick={onClose}>{t('snap_close')}</Button>
          </div>
        )}
      </div>
    </div>
  )
}
