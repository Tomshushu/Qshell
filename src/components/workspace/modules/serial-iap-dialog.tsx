import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import sshService from '@/services/ssh-service'
import type { FirmwareInfo, SerialIapConfig, SerialIapProgress } from '@/services/api/types'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import {
  Cpu,
  Upload,
  FileCode,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Copy,
  Trash2,
  Zap,
  Activity,
  Layers,
  ChevronDown,
  ChevronUp,
  RotateCw,
  HardDrive,
  Hash,
  Clock,
  Check,
} from 'lucide-react'

interface SerialIapDialogProps {
  open: boolean
  sessionId: string
  serverName?: string
  portName?: string
  baudRate?: number
  onClose: () => void
}

export function SerialIapDialog({
  open,
  sessionId,
  serverName,
  portName,
  baudRate,
  onClose,
}: SerialIapDialogProps) {
  const { toast } = useToast()
  const { language } = useTranslation()
  const tr = useCallback((zh: string, en: string) => language.startsWith('zh') ? zh : en, [language])
  const [filePath, setFilePath] = useState('')
  const [firmwareInfo, setFirmwareInfo] = useState<FirmwareInfo | null>(null)
  const [parsing, setParsing] = useState(false)

  // 协议模式配置
  // 协议标识：由后端透传给 IAP 引擎，这里放宽为 string，选项列表见下方协议 Pill 单选组
  const [protocol, setProtocol] = useState<SerialIapConfig['protocol']>('ymodem-1k')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [preCommand, setPreCommand] = useState('')
  const [preBreakDuration, setPreBreakDuration] = useState('0')
  const [preDelayMs, setPreDelayMs] = useState('800')
  const [timeoutSecs, setTimeoutSecs] = useState('60')
  const [maxRetries, setMaxRetries] = useState('10')
  const [rawChunkSize, setRawChunkSize] = useState('256')
  const [rawDelayMs, setRawDelayMs] = useState('20')
  const [expectedSha256, setExpectedSha256] = useState('')
  const [verificationCommand, setVerificationCommand] = useState('')
  const [verificationExpected, setVerificationExpected] = useState('')
  const [postDelayMs, setPostDelayMs] = useState('1500')
  const [pendingConfig, setPendingConfig] = useState<SerialIapConfig | null>(null)

  // 传输运行态
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<SerialIapProgress | null>(null)
  const [logs, setLogs] = useState<Array<{ id: string; time: string; text: string; type: 'info' | 'send' | 'recv' | 'warn' | 'error' | 'success' }>>([])
  const [iapHistory, setIapHistory] = useState<Array<{
    id: string; fileName: string; sha256: string; protocol: string; startedAt: number;
    finishedAt: number; result: string; message: string;
  }>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem('serial-iap-history') || '[]')
      return Array.isArray(value)
        ? value.filter((item) => item && typeof item.id === 'string' && typeof item.fileName === 'string' && typeof item.sha256 === 'string' && typeof item.protocol === 'string' && typeof item.startedAt === 'number' && typeof item.finishedAt === 'number' && typeof item.result === 'string' && typeof item.message === 'string').slice(0, 50)
        : []
    } catch { return [] }
  })
  const logContainerRef = useRef<HTMLDivElement>(null)
  const startInFlightRef = useRef(false)
  const runMetaRef = useRef<{ fileName: string; sha256: string; protocol: string; startedAt: number } | null>(null)

  // 自动滚动日志
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logs])

  const appendLog = useCallback((text: string, type: 'info' | 'send' | 'recv' | 'warn' | 'error' | 'success' = 'info') => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    setLogs((prev) => [...prev.slice(-499), { id: `${Date.now()}-${Math.random()}`, time, text, type }])
  }, [])

  // 选择固件文件
  const handleSelectFile = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          { name: tr('固件镜像 (*.bin, *.hex)', 'Firmware images (*.bin, *.hex)'), extensions: ['bin', 'hex', 'raw'] },
          { name: tr('所有文件 (*.*)', 'All files (*.*)'), extensions: ['*'] },
        ],
      })
      if (!selected || typeof selected !== 'string') return

      setFilePath(selected)
      setFirmwareInfo(null)
      setParsing(true)
      appendLog(`${tr('已选定固件文件', 'Selected firmware')}: ${selected}`, 'info')

      try {
        const info = await sshService.parseFirmware(selected)
        setFirmwareInfo(info)
        appendLog(
          `${tr('固件解析成功', 'Firmware parsed')}: ${info.fileName} (${info.formattedSize}, ${tr('类型', 'type')}: ${info.fileType.toUpperCase()}${info.startAddress ? `, ${tr('基地址', 'base')}: ${info.startAddress}` : ''}, CRC32: ${info.crc32})`,
          'success',
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setFirmwareInfo(null)
        toast.error(`${tr('固件解析失败', 'Firmware parsing failed')}: ${msg}`)
        appendLog(`${tr('固件解析异常', 'Firmware parsing error')}: ${msg}`, 'error')
      } finally {
        setParsing(false)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`${tr('打开文件对话框失败', 'Failed to open file picker')}: ${msg}`)
    }
  }

  // 监听 IAP 遥测进度事件
  useEffect(() => {
    if (!open) return
    const unlisten = sshService.onSerialIapProgress((data) => {
      if (data.sessionId !== sessionId) return
      setProgress(data)

      if (data.log) {
        let type: 'info' | 'send' | 'recv' | 'warn' | 'error' | 'success' = 'info'
        if (data.log.includes('[SEND]')) type = 'send'
        else if (data.log.includes('[RECV]')) type = 'recv'
        else if (data.log.includes('[RETRY]') || data.log.includes('[WARN]')) type = 'warn'
        else if (data.log.includes('[ERROR]') || data.log.includes('[CANCELLED]')) type = 'error'
        else if (data.log.includes('[SUCCESS]')) type = 'success'
        appendLog(data.log, type)
      }

      if (data.phase === 'completed' || data.phase === 'verified') {
        setIsRunning(false)
        startInFlightRef.current = false
        toast.success(data.phase === 'verified' ? tr('固件传输完成，设备响应验证成功', 'Firmware transferred and device response verified') : tr('协议传输已完成，请确认设备已正常烧写并启动', 'Protocol transfer completed; confirm that the device was flashed and restarted'))
      } else if (data.phase === 'error') {
        setIsRunning(false)
        startInFlightRef.current = false
        toast.error(`${tr('升级失败', 'Upgrade failed')}: ${data.error || data.message}`)
      } else if (data.phase === 'cancelled') {
        setIsRunning(false)
        startInFlightRef.current = false
        toast.info(tr('固件升级已中止', 'Firmware upgrade aborted'))
      }

      if (['completed', 'verified', 'error', 'cancelled'].includes(data.phase) && runMetaRef.current) {
        const entry = {
          id: crypto.randomUUID(),
          ...runMetaRef.current,
          finishedAt: Date.now(),
          result: data.phase,
          message: data.error || data.message,
        }
        try {
          const previous = JSON.parse(localStorage.getItem('serial-iap-history') || '[]')
          const safePrevious = Array.isArray(previous)
            ? previous.filter((item) => item && typeof item.id === 'string' && typeof item.fileName === 'string' && typeof item.sha256 === 'string')
            : []
          const next = [entry, ...safePrevious].slice(0, 50)
          localStorage.setItem('serial-iap-history', JSON.stringify(next))
          setIapHistory(next)
        } catch {
          localStorage.setItem('serial-iap-history', JSON.stringify([entry]))
          setIapHistory([entry])
        }
        runMetaRef.current = null
      }
    })

    return () => {
      unlisten()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId, appendLog, tr])

  // 开始升级
  const handleStartIap = async () => {
    if (startInFlightRef.current || isRunning) return
    if (!filePath || !firmwareInfo) {
      toast.warning(tr('请先选择有效的 .bin 或 .hex 固件文件', 'Select a valid .bin or .hex firmware file'))
      return
    }

    const timeout = Number(timeoutSecs)
    const retries = Number(maxRetries)
    const preDelay = Number(preDelayMs)
    const breakDuration = Number(preBreakDuration)
    const rawDelay = Number(rawDelayMs)
    const rawSize = Number(rawChunkSize)
    const postDelay = Number(postDelayMs)
    if (!Number.isFinite(timeout) || timeout < 5 || timeout > 300) return void toast.warning(tr('握手超时范围应为 5–300 秒', 'Handshake timeout must be 5–300 seconds'))
    if (!Number.isInteger(retries) || retries < 1 || retries > 50) return void toast.warning(tr('重试次数范围应为 1–50', 'Retries must be between 1 and 50'))
    if (!Number.isFinite(preDelay) || preDelay < 0 || preDelay > 60000) return void toast.warning(tr('前置等待范围应为 0–60000 ms', 'Pre-trigger delay must be 0–60000ms'))
    if (!Number.isFinite(breakDuration) || breakDuration < 0 || breakDuration > 10000) return void toast.warning(tr('Break 时长范围应为 0–10000 ms', 'Break duration must be 0–10000ms'))
    if (!Number.isFinite(rawDelay) || rawDelay < 0 || rawDelay > 5000) return void toast.warning(tr('Raw 包间延时范围应为 0–5000 ms', 'Raw inter-chunk delay must be 0–5000ms'))
    if (protocol === 'raw' && (!Number.isInteger(rawSize) || rawSize < 64 || rawSize > 4096)) return void toast.warning(tr('Raw 单包大小范围应为 64–4096 字节', 'Raw chunk size must be 64–4096 bytes'))
    if (!Number.isFinite(postDelay) || postDelay < 0 || postDelay > 120000) return void toast.warning(tr('升级后等待范围应为 0–120000 ms', 'Post-upgrade delay must be 0–120000ms'))
    if (Boolean(verificationCommand.trim()) !== Boolean(verificationExpected)) return void toast.warning(tr('升级后验证命令与期望响应必须同时填写', 'Verification command and expected response must both be provided'))
    if (expectedSha256.trim() && !/^[0-9a-fA-F]{64}$/.test(expectedSha256.trim())) return void toast.warning(tr('期望 SHA256 必须是 64 位十六进制字符串', 'Expected SHA256 must contain 64 hexadecimal characters'))

    const config: SerialIapConfig = {
      sessionId,
      filePath,
      protocol,
      packetSize: protocol.endsWith('-1k') ? 1024 : protocol === 'raw' ? rawSize : 128,
      timeoutSecs: timeout,
      maxRetries: retries,
      preCommand: preCommand.trim() ? preCommand : undefined,
      preBreakDurationMs: parseInt(preBreakDuration) > 0 ? parseInt(preBreakDuration) : undefined,
      preDelayMs: preDelay,
      rawChunkDelayMs: rawDelay,
      expectedSha256: expectedSha256.trim() || undefined,
      verificationCommand: verificationCommand.trim() || undefined,
      verificationExpected: verificationExpected || undefined,
      postDelayMs: postDelay,
    }

    setPendingConfig(config)
  }

  const confirmStartIap = async () => {
    const config = pendingConfig
    if (!config || !firmwareInfo || startInFlightRef.current || isRunning) return
    setPendingConfig(null)
    startInFlightRef.current = true
    setIsRunning(true)
    setProgress(null)
    appendLog(`========================================`, 'info')
    appendLog(`🚀 ${tr('启动串口 IAP 升级', 'Starting serial IAP upgrade')}: ${firmwareInfo.fileName}`, 'info')
    appendLog(`⚙️ ${tr('模式', 'Mode')}: ${protocol.toUpperCase()}, ${tr('单包大小', 'packet size')}: ${config.packetSize} ${tr('字节', 'bytes')}`, 'info')
    runMetaRef.current = { fileName: firmwareInfo.fileName, sha256: firmwareInfo.sha256, protocol, startedAt: Date.now() }

    try {
      const result = await sshService.startSerialIap(config)
      if (!result.success) {
        startInFlightRef.current = false
        runMetaRef.current = null
        setIsRunning(false)
        toast.error(`${tr('启动 IAP 失败', 'Failed to start IAP')}: ${result.error || tr('未知错误', 'Unknown error')}`)
        appendLog(`${tr('启动失败', 'Start failed')}: ${result.error}`, 'error')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      startInFlightRef.current = false
      runMetaRef.current = null
      setIsRunning(false)
      toast.error(`${tr('调用 IAP 引擎失败', 'IAP engine call failed')}: ${msg}`)
      appendLog(`${tr('调用异常', 'Invocation error')}: ${msg}`, 'error')
    }
  }

  // 中止升级
  const handleCancelIap = async () => {
    try {
      appendLog(`[ACTION] ${tr('正在发送取消指令并中止升级...', 'Sending cancel request and aborting...')}`, 'warn')
      const result = await sshService.cancelSerialIap(sessionId)
      if (!result.success) throw new Error(result.error || tr('后端未能取消升级', 'Backend could not cancel the upgrade'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`${tr('取消失败', 'Cancellation failed')}: ${msg}`)
    }
  }

  // 格式化时间
  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs) || secs < 0) return '00:00'
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  // 格式化速率
  const formatSpeed = (bps: number) => {
    if (!bps || isNaN(bps) || bps <= 0) return '0.00 KB/s'
    if (bps < 1024) return `${bps.toFixed(0)} B/s`
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(2)} KB/s`
    return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`
  }

  const percent = progress && progress.totalBytes > 0
    ? Math.min(100, Math.round((progress.bytesSent * 100) / progress.totalBytes))
    : 0

  return (
    <Dialog open={open} onOpenChange={(v) => !isRunning && !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden border-border/80 shadow-2xl bg-background/95 backdrop-blur-xl">
        {pendingConfig && firmwareInfo && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-2xl border border-amber-500/35 bg-background p-5 shadow-2xl">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full bg-amber-500/15 p-2 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-foreground">{tr('确认开始固件升级', 'Confirm firmware upgrade')}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {tr('升级期间串口会被独占。请确认目标设备、固件和协议正确，并确保设备供电稳定且不要拔出串口。', 'The serial port is exclusively locked during the upgrade. Verify the target, firmware, and protocol, keep power stable, and do not unplug the device.')}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-xl border border-border/60 bg-muted/25 p-3 text-xs">
                <span className="text-muted-foreground">{tr('目标设备', 'Target')}</span>
                <span className="truncate font-medium text-foreground">{serverName || tr('当前串口', 'Current serial port')} · {portName || 'Serial'} @ {baudRate || 115200}</span>
                <span className="text-muted-foreground">{tr('固件', 'Firmware')}</span>
                <span className="truncate font-medium text-foreground" title={firmwareInfo.fileName}>{firmwareInfo.fileName} · {firmwareInfo.formattedSize}</span>
                <span className="text-muted-foreground">SHA256</span>
                <span className="break-all font-mono text-[10px] text-foreground">{firmwareInfo.sha256}</span>
                <span className="text-muted-foreground">{tr('协议', 'Protocol')}</span>
                <span className="font-mono font-medium text-foreground">{pendingConfig.protocol.toUpperCase()} · {pendingConfig.packetSize}B</span>
                <span className="text-muted-foreground">{tr('结果验证', 'Verification')}</span>
                <span className={pendingConfig.verificationCommand ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                  {pendingConfig.verificationCommand ? tr('已配置设备响应验证', 'Device response verification configured') : tr('未配置；只能确认协议传输完成', 'Not configured; only protocol transfer can be confirmed')}
                </span>
              </div>
              {pendingConfig.protocol === 'raw' && (
                <p className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/8 px-3 py-2 text-[11px] leading-relaxed text-rose-600 dark:text-rose-400">
                  {tr('Raw 模式没有握手、ACK 或自动重传，除非配置升级后验证，否则无法判断设备是否正确接收。', 'Raw mode has no handshake, ACK, or automatic retry. Configure post-upgrade verification if delivery must be confirmed.')}
                </p>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setPendingConfig(null)} className="h-8 text-xs">{tr('返回检查', 'Review')}</Button>
                <Button size="sm" onClick={() => void confirmStartIap()} className="h-8 bg-amber-600 text-xs text-white hover:bg-amber-700">
                  {tr('已确认，开始升级', 'Confirm and start')}
                </Button>
              </div>
            </div>
          </div>
        )}
        {/* 顶部 Header */}
        <DialogHeader className="px-6 py-4 border-b border-border/60 bg-muted/20 flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center text-primary shadow-sm shrink-0">
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold flex items-center gap-2">
                {tr('串口 IAP 固件升级', 'Serial IAP firmware upgrade')}
                <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-mono">
                  {tr('通用串口 Bootloader', 'Generic serial bootloader')}
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                <span>{tr('目标:', 'Target:')} {serverName || tr('当前串口', 'Current serial port')}</span>
                {portName && <span className="font-mono font-medium text-foreground">({portName} @ {baudRate || 115200} baud)</span>}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 text-xs">
          {/* 1. 固件文件选择卡片 */}
          <div className="rounded-xl border border-border/70 bg-card p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                <FileCode className="h-3.5 w-3.5 text-primary" />
                {tr('固件镜像文件', 'Firmware image')} (.bin / .hex)
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={isRunning || parsing}
                onClick={handleSelectFile}
                className="h-7 text-xs gap-1.5 border-primary/40 hover:border-primary cursor-pointer hover:bg-primary/5"
              >
                <Upload className="h-3.5 w-3.5 text-primary" />
                {tr('浏览本地文件', 'Browse')}
              </Button>
            </div>

            {firmwareInfo ? (
              <div className="rounded-lg bg-muted/40 border border-border/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-foreground truncate">{firmwareInfo.fileName}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 uppercase font-semibold">
                      {firmwareInfo.fileType}
                    </span>
                  </div>
                  <span className="font-mono font-semibold text-foreground shrink-0">{firmwareInfo.formattedSize}</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-muted-foreground pt-1 border-t border-border/40 font-mono">
                  <div className="flex items-center gap-1">
                    <Hash className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                    <span>CRC32: <span className="text-foreground font-semibold">{firmwareInfo.crc32}</span></span>
                  </div>
                  {firmwareInfo.startAddress && (
                    <div className="flex items-center gap-1">
                      <HardDrive className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                      <span>{tr('基地址:', 'Base address:')} <span className="text-foreground font-semibold">{firmwareInfo.startAddress}</span></span>
                    </div>
                  )}
                  <div className="flex items-center gap-1 col-span-2 sm:col-span-1 truncate" title={firmwareInfo.sha256}>
                    <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                    <span className="truncate">SHA: {firmwareInfo.sha256.substring(0, 10)}...</span>
                  </div>
                </div>
              </div>
            ) : (
              <div
                onClick={!isRunning ? handleSelectFile : undefined}
                className={cn(
                  "border-2 border-dashed border-border/70 rounded-xl p-5 text-center flex flex-col items-center justify-center gap-1.5 transition-colors cursor-pointer bg-muted/10 hover:bg-primary/5 hover:border-primary/50",
                  isRunning && "cursor-not-allowed opacity-60",
                )}
              >
                <Upload className="h-6 w-6 text-muted-foreground/60 mb-0.5" />
                <p className="text-xs font-medium text-foreground">{tr('点击选择固件文件', 'Select a firmware file')}</p>
                <p className="text-[11px] text-muted-foreground">{tr('支持单片机通用二进制 (.bin) 与 Intel HEX (.hex) 格式，自动识别内存布局', 'Supports binary (.bin) and Intel HEX (.hex) images with automatic memory-layout detection')}</p>
              </div>
            )}
          </div>

          {/* 2. 协议与高级配置卡片 */}
          <div className="rounded-xl border border-border/70 bg-card p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                <Layers className="h-3.5 w-3.5 text-primary" />
                {tr('传输协议模式', 'Transfer protocol')}
              </label>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer transition-colors"
              >
                <span>{tr('高级选项', 'Advanced')}</span>
                {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            </div>

            {/* 协议 Pill 单选组 */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                { key: 'ymodem-1k', label: tr('YModem-1K (推荐)', 'YModem-1K (recommended)'), desc: tr('1024B 大包 + CRC16 校验', '1024B packets + CRC16') },
                { key: 'ymodem', label: tr('YModem 标准', 'YModem standard'), desc: tr('128B 分包 + CRC16 校验', '128B packets + CRC16') },
                { key: 'xmodem-1k', label: 'XModem-1K', desc: tr('1024B 分包 + CRC16 校验', '1024B packets + CRC16') },
                { key: 'xmodem', label: 'XModem', desc: tr('经典单包 CRC / 校验和', 'Classic CRC/checksum packets') },
                { key: 'raw', label: tr('Raw 延时分包', 'Raw delayed chunks'), desc: tr('简易 Bootloader 定长流式下发', 'Fixed-size stream for simple bootloaders') },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  disabled={isRunning}
                  onClick={() => setProtocol(item.key as SerialIapConfig['protocol'])}
                  className={cn(
                    "flex flex-col text-left p-2.5 rounded-lg border text-xs transition-all cursor-pointer",
                    protocol === item.key
                      ? "border-primary bg-primary/10 text-foreground font-medium shadow-xs"
                      : "border-border/60 bg-muted/20 text-muted-foreground hover:border-border hover:bg-muted/40",
                    isRunning && "cursor-not-allowed opacity-60",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">{item.label}</span>
                    {protocol === item.key && <Check className="h-3 w-3 text-primary shrink-0" />}
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{item.desc}</span>
                </button>
              ))}
            </div>
            <p className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[10.5px] leading-relaxed text-amber-700 dark:text-amber-300">
              {tr('仅适用于设备 Bootloader 已实现对应 X/YModem 或 Raw 接收协议的场景；这不是 STM32、ESP32、NXP 等厂商私有烧录协议。', 'Use only when the device bootloader implements the selected X/YModem or Raw receiver. This is not a vendor-specific STM32, ESP32, or NXP flashing protocol.')}
            </p>

            {/* 高级折叠面板 */}
            {showAdvanced && (
              <div className="pt-3 border-t border-border/50 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">{tr('前置唤醒指令（可选）', 'Pre-trigger command (optional)')}</label>
                  <Input
                    placeholder={tr('如 reboot iap\\r\\n 或 1', 'For example reboot iap\\r\\n or 1')}
                    value={preCommand}
                    disabled={isRunning}
                    onChange={(e) => setPreCommand(e.target.value)}
                    className="h-7 text-xs font-mono"
                  />
                  <span className="text-[10px] text-muted-foreground">{tr('在启动 IAP 传输前先通过串口发送该指令引导设备', 'Send this command before transfer to enter the bootloader')}</span>
                </div>

                <div className="sm:col-span-2">
                  <label className="text-[11px] text-muted-foreground mb-1 block">{tr('发布固件 SHA256（可选，推荐生产环境填写）', 'Published firmware SHA256 (optional, recommended in production)')}</label>
                  <Input
                    value={expectedSha256}
                    disabled={isRunning}
                    onChange={(e) => setExpectedSha256(e.target.value.replace(/\s/g, ''))}
                    placeholder={tr('64 位 SHA256；启动前与实际固件强制比对', '64-character SHA256 verified before transfer')}
                    className="h-7 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">{tr('升级后验证命令（可选）', 'Post-upgrade verification command (optional)')}</label>
                  <Input
                    value={verificationCommand}
                    disabled={isRunning}
                    onChange={(e) => setVerificationCommand(e.target.value)}
                    placeholder={tr('如 version\\r\\n', 'For example version\\r\\n')}
                    className="h-7 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">{tr('期望响应内容（与验证命令配套）', 'Expected response')}</label>
                  <Input
                    value={verificationExpected}
                    disabled={isRunning}
                    onChange={(e) => setVerificationExpected(e.target.value)}
                    placeholder={tr('如 v1.2.3 或 CRC OK', 'For example v1.2.3 or CRC OK')}
                    className="h-7 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">{tr('传输后等待设备就绪 (ms)', 'Wait for device after transfer (ms)')}</label>
                  <Input
                    type="number"
                    min={0}
                    max={120000}
                    value={postDelayMs}
                    disabled={isRunning}
                    onChange={(e) => setPostDelayMs(e.target.value)}
                    className="h-7 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">{tr('前置 Break 打断脉冲 (ms)', 'Pre-transfer Break pulse (ms)')}</label>
                  <Input
                    type="number"
                    placeholder={tr('0 为不发送，如 250', '0 disables it; for example 250')}
                    value={preBreakDuration}
                    disabled={isRunning}
                    onChange={(e) => setPreBreakDuration(e.target.value)}
                    className="h-7 text-xs font-mono"
                  />
                  <span className="text-[10px] text-muted-foreground">{tr('用于打断 U-Boot 倒计时或单片机自动启动', 'Interrupt a U-Boot countdown or MCU auto-start')}</span>
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">{tr('前置动作后等待 (ms)', 'Wait after pre-trigger (ms)')}</label>
                  <Input
                    type="number"
                    min={0}
                    max={60000}
                    value={preDelayMs}
                    disabled={isRunning}
                    onChange={(e) => setPreDelayMs(e.target.value)}
                    className="h-7 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">{tr('握手超时时间 (秒)', 'Handshake timeout (seconds)')}</label>
                  <Input
                    type="number"
                    value={timeoutSecs}
                    disabled={isRunning}
                    onChange={(e) => setTimeoutSecs(e.target.value)}
                    className="h-7 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">{tr('单包最大重传重试次数', 'Maximum retries per packet')}</label>
                  <Input
                    type="number"
                    value={maxRetries}
                    disabled={isRunning}
                    onChange={(e) => setMaxRetries(e.target.value)}
                    className="h-7 text-xs font-mono"
                  />
                </div>

                {protocol === 'raw' && (
                  <>
                    <div>
                      <label className="text-[11px] text-muted-foreground mb-1 block">{tr('Raw 单包字节大小', 'Raw chunk size')}</label>
                      <Input
                        type="number"
                        value={rawChunkSize}
                        disabled={isRunning}
                        onChange={(e) => setRawChunkSize(e.target.value)}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground mb-1 block">{tr('Raw 包间发送延时 (ms)', 'Raw inter-chunk delay (ms)')}</label>
                      <Input
                        type="number"
                        value={rawDelayMs}
                        disabled={isRunning}
                        onChange={(e) => setRawDelayMs(e.target.value)}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {iapHistory.length > 0 && (
            <div className="rounded-xl border border-border/70 bg-card p-4 space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  {tr('最近升级记录', 'Recent upgrades')}
                </label>
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => {
                    localStorage.removeItem('serial-iap-history')
                    setIapHistory([])
                  }}
                  className="text-[10.5px] text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  {tr('清空记录', 'Clear history')}
                </button>
              </div>
              <div className="divide-y divide-border/50 rounded-lg border border-border/50 overflow-hidden">
                {iapHistory.slice(0, 5).map((item) => (
                  <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_90px_120px] items-center gap-2 px-3 py-2 text-[10.5px] bg-muted/15">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground" title={item.fileName}>{item.fileName}</div>
                      <div className="truncate font-mono text-muted-foreground" title={item.sha256}>SHA256 {item.sha256.slice(0, 16)}…</div>
                    </div>
                    <span className="font-mono text-muted-foreground">{item.protocol.toUpperCase()}</span>
                    <div className="text-right">
                      <div className={cn('font-medium', item.result === 'verified' || item.result === 'completed' ? 'text-emerald-600 dark:text-emerald-400' : item.result === 'cancelled' ? 'text-amber-500' : 'text-rose-500')}>
                        {item.result === 'verified' ? tr('验证成功', 'Verified') : item.result === 'completed' ? tr('传输完成', 'Transferred') : item.result === 'cancelled' ? tr('已取消', 'Cancelled') : tr('失败', 'Failed')}
                      </div>
                      <div className="text-muted-foreground">{new Date(item.finishedAt).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. 实时可视化升级大屏 */}
          <div className="rounded-xl border border-border/70 bg-card p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
                <Activity className="h-3.5 w-3.5 text-primary" />
                {tr('升级进度与遥测指标', 'Upgrade progress and telemetry')}
              </label>
              <span className="text-[11px] font-mono text-muted-foreground">
                {progress ? progress.message : tr('准备就绪', 'Ready')}
              </span>
            </div>

            {/* 动态发光进度条 */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-mono">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  {progress?.phase === 'handshaking' && <RotateCw className="h-3 w-3 animate-spin text-amber-500" />}
                  {progress?.phase === 'transferring' && <Zap className="h-3 w-3 text-emerald-500 animate-pulse" />}
                  {(progress?.phase === 'completed' || progress?.phase === 'verified') && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                  {progress?.phase === 'error' && <XCircle className="h-3 w-3 text-rose-500" />}
                  {progress?.phase ? progress.phase.toUpperCase() : 'IDLE'}
                </span>
                <span className="font-bold text-primary">{percent}%</span>
              </div>
              <div className="h-2.5 w-full bg-muted/60 rounded-full overflow-hidden border border-border/40 relative">
                <div
                  className={cn(
                    "h-full transition-all duration-300 rounded-full",
                    progress?.phase === 'error' ? 'bg-rose-500 shadow-[0_0_10px_#f43f5e]' :
                    (progress?.phase === 'completed' || progress?.phase === 'verified') ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' :
                    progress?.phase === 'handshaking' ? 'bg-amber-500 shadow-[0_0_10px_#f59e0b]' :
                    'bg-primary shadow-[0_0_10px_rgba(var(--primary),0.6)]',
                  )}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>

            {/* 6 块核心遥测指标卡片 */}
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-1">
              <div className="bg-muted/30 border border-border/40 rounded-lg p-2 text-center">
                <span className="text-[10px] text-muted-foreground block">{tr('已发/总计', 'Sent/total')}</span>
                <span className="text-xs font-mono font-semibold text-foreground">
                  {progress ? `${(progress.bytesSent / 1024).toFixed(1)}K` : '0K'}/{firmwareInfo ? `${(firmwareInfo.sizeBytes / 1024).toFixed(1)}K` : '0K'}
                </span>
              </div>

              <div className="bg-muted/30 border border-border/40 rounded-lg p-2 text-center">
                <span className="text-[10px] text-muted-foreground block">{tr('传输速率', 'Speed')}</span>
                <span className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  {progress ? formatSpeed(progress.speedBps) : '0.00 KB/s'}
                </span>
              </div>

              <div className="bg-muted/30 border border-border/40 rounded-lg p-2 text-center">
                <span className="text-[10px] text-muted-foreground block">{tr('当前包号', 'Packet')}</span>
                <span className="text-xs font-mono font-semibold text-foreground">
                  {progress ? `${progress.currentPacket}/${progress.totalPackets}` : '0/0'}
                </span>
              </div>

              <div className="bg-muted/30 border border-border/40 rounded-lg p-2 text-center">
                <span className="text-[10px] text-muted-foreground block">{tr('重试次数', 'Retries')}</span>
                <span className={cn("text-xs font-mono font-semibold", progress && progress.retries > 0 ? "text-amber-500 font-bold" : "text-foreground")}>
                  {progress ? progress.retries : 0}
                </span>
              </div>

              <div className="bg-muted/30 border border-border/40 rounded-lg p-2 text-center">
                <span className="text-[10px] text-muted-foreground block">{tr('已用时间', 'Elapsed')}</span>
                <span className="text-xs font-mono font-semibold text-foreground">
                  {progress ? formatTime(progress.elapsedSecs) : '00:00'}
                </span>
              </div>

              <div className="bg-muted/30 border border-border/40 rounded-lg p-2 text-center">
                <span className="text-[10px] text-muted-foreground block">{tr('预估剩余', 'Remaining')}</span>
                <span className="text-xs font-mono font-semibold text-foreground">
                  {progress ? formatTime(progress.estimatedRemainingSecs) : '00:00'}
                </span>
              </div>
            </div>

            {/* 协议日志视窗 */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{tr('交互日志', 'Protocol log')}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const text = logs.map((l) => `[${l.time}] ${l.text}`).join('\n')
                      navigator.clipboard.writeText(text)
                      toast.success(tr('日志已复制到剪贴板', 'Log copied to clipboard'))
                    }}
                    className="hover:text-foreground flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Copy className="h-3 w-3" />
                    {tr('复制', 'Copy')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLogs([])}
                    className="hover:text-foreground flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                    {tr('清空', 'Clear')}
                  </button>
                </div>
              </div>

              <div
                ref={logContainerRef}
                className="h-36 rounded-lg bg-slate-950 text-slate-100 p-2.5 font-mono text-[11px] overflow-y-auto space-y-1 border border-border/50 select-text"
              >
                {logs.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500">
                    {tr('等待开始 IAP 升级，交互帧将在此处实时显示...', 'Waiting to start; protocol frames will appear here...')}
                  </div>
                ) : (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      className={cn(
                        "leading-relaxed break-all",
                        log.type === 'send' && 'text-blue-400',
                        log.type === 'recv' && 'text-emerald-400',
                        log.type === 'warn' && 'text-amber-400',
                        log.type === 'error' && 'text-rose-400 font-semibold',
                        log.type === 'success' && 'text-emerald-300 font-bold',
                        log.type === 'info' && 'text-slate-300',
                      )}
                    >
                      <span className="text-slate-500 mr-1.5 select-none">[{log.time}]</span>
                      {log.text}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="px-6 py-3.5 border-t border-border/60 bg-muted/20 flex items-center justify-between">
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-ping mr-0.5" />
            <span>{tr('升级期间串口将被独占；完成后请依据验证结果确认设备状态', 'The serial port is locked during upgrade; confirm device state from the verification result')}</span>
          </div>

          <div className="flex items-center gap-2">
            {isRunning ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleCancelIap}
                className="h-8 text-xs gap-1.5 cursor-pointer shadow-sm"
              >
                <XCircle className="h-3.5 w-3.5" />
                {tr('中止升级', 'Abort upgrade')}
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                disabled={!firmwareInfo}
                onClick={handleStartIap}
                className="h-8 text-xs gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold cursor-pointer shadow-md transition-all hover:shadow-primary/20"
              >
                <Upload className="h-3.5 w-3.5" />
                {tr('开始 IAP 升级', 'Start IAP upgrade')}
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              disabled={isRunning}
              onClick={onClose}
              className="h-8 text-xs cursor-pointer border-border/70"
            >
              {tr('关闭', 'Close')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
