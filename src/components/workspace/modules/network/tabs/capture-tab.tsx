import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  FileDown,
  Play,
  Loader2,
  AlertTriangle,
  Radio,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react'
import { useTranslation } from '@/i18n'
import type { InterfaceInfo, CaptureResult } from '@/types/network'
import { sshService } from '@/services/ssh-service'

interface CaptureTabProps {
  serverId: string
  interfaces: InterfaceInfo[]
}

export function CaptureTab({ serverId, interfaces }: CaptureTabProps) {
  const { t } = useTranslation()
  const [selectedIface, setSelectedIface] = useState<string>(interfaces[0]?.name || 'eth0')
  const [bpfFilter, setBpfFilter] = useState('')
  const [maxPackets, setMaxPackets] = useState('500')
  const [durationSecs, setDurationSecs] = useState('15')
  const [isCapturing, setIsCapturing] = useState(false)
  const [captureResult, setCaptureResult] = useState<CaptureResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleStartCapture = async () => {
    setError(null)
    setCaptureResult(null)
    setIsCapturing(true)

    try {
      const res = await sshService.startNetworkCapture(serverId, {
        iface: selectedIface,
        filter: bpfFilter.trim() || undefined,
        maxPackets: parseInt(maxPackets, 10) || 500,
        durationSecs: parseInt(durationSecs, 10) || 15,
      })
      setCaptureResult(res)
      if (!res.success) {
        setError(res.error || '抓包未捕获到有效数据包')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '抓包执行失败')
    } finally {
      setIsCapturing(false)
    }
  }

  const handleDownloadPcap = () => {
    if (!captureResult?.pcapBase64) return
    try {
      const byteCharacters = atob(captureResult.pcapBase64)
      const byteNumbers = new Array(byteCharacters.length)
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i)
      }
      const byteArray = new Uint8Array(byteNumbers)
      const blob = new Blob([byteArray], { type: 'application/vnd.tcpdump.pcap' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `capture_${selectedIface}_${Date.now()}.pcap`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Download error:', err)
    }
  }

  return (
    <div className="flex-1 min-h-0 h-full overflow-y-auto p-4 space-y-4">
      {/* Notice Card */}
      <Card className="border-l-4 border-l-primary bg-muted/20 shadow-none">
        <CardContent className="p-3.5 flex items-start gap-2.5 text-xs text-muted-foreground">
          <ShieldAlert className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold text-foreground">抓包安全说明与权限限制</span>
            <p className="leading-relaxed">
              {t('net_cap_notice')}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Capture Configuration Card */}
      <Card className="border shadow-sm">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Radio className="h-4 w-4 text-primary" />
            <span>{t('net_cap_title')}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-2 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            {/* Interface selection */}
            <div>
              <label className="text-muted-foreground font-medium block mb-1.5">
                {t('net_cap_iface')}
              </label>
              <select
                value={selectedIface}
                onChange={(e) => setSelectedIface(e.target.value)}
                disabled={isCapturing}
                className="w-full h-8 px-2.5 rounded-md border bg-background text-foreground font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {interfaces.map((iface) => (
                  <option key={iface.name} value={iface.name}>
                    {iface.name} ({iface.state})
                  </option>
                ))}
              </select>
            </div>

            {/* Max packets */}
            <div>
              <label className="text-muted-foreground font-medium block mb-1.5">
                {t('net_cap_max_packets')} (100 - 5000)
              </label>
              <Input
                value={maxPackets}
                onChange={(e) => setMaxPackets(e.target.value)}
                disabled={isCapturing}
                className="h-8 text-xs font-mono"
              />
            </div>

            {/* Duration seconds */}
            <div>
              <label className="text-muted-foreground font-medium block mb-1.5">
                {t('net_cap_duration')} (5 - 60s)
              </label>
              <Input
                value={durationSecs}
                onChange={(e) => setDurationSecs(e.target.value)}
                disabled={isCapturing}
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>

          {/* BPF Filter */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground font-medium">
                {t('net_cap_filter')}
              </label>
              <div className="flex items-center gap-1.5 text-[11px] font-mono">
                <span className="text-muted-foreground">预设模版:</span>
                <button
                  type="button"
                  onClick={() => setBpfFilter('port 80 or port 443')}
                  className="px-1.5 py-0.5 rounded bg-muted hover:bg-accent text-foreground text-[10px]"
                >
                  Web (80/443)
                </button>
                <button
                  type="button"
                  onClick={() => setBpfFilter('icmp')}
                  className="px-1.5 py-0.5 rounded bg-muted hover:bg-accent text-foreground text-[10px]"
                >
                  ICMP
                </button>
                <button
                  type="button"
                  onClick={() => setBpfFilter('port 53')}
                  className="px-1.5 py-0.5 rounded bg-muted hover:bg-accent text-foreground text-[10px]"
                >
                  DNS (53)
                </button>
                <button
                  type="button"
                  onClick={() => setBpfFilter('')}
                  className="px-1.5 py-0.5 rounded bg-muted hover:bg-accent text-muted-foreground text-[10px]"
                >
                  清空
                </button>
              </div>
            </div>
            <Input
              placeholder={t('net_cap_filter_placeholder')}
              value={bpfFilter}
              onChange={(e) => setBpfFilter(e.target.value)}
              disabled={isCapturing}
              className="h-8 text-xs font-mono"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              onClick={handleStartCapture}
              disabled={isCapturing || !selectedIface}
              className="h-8 text-xs gap-1.5 px-4 font-medium"
            >
              {isCapturing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
              {isCapturing ? t('net_cap_capturing') : t('net_cap_start_btn')}
            </Button>
          </div>

          {error && (
            <div className="p-2.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="whitespace-pre-wrap">{error}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Capture Result Section */}
      {captureResult && captureResult.success && (
        <Card className="border border-green-500/30 bg-green-500/5 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="text-sm font-semibold text-foreground">
                  {t('net_cap_success')}
                </span>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {captureResult.fileSizeBytes} Bytes
                </Badge>
              </div>

              {captureResult.pcapBase64 && (
                <Button
                  onClick={handleDownloadPcap}
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                >
                  <FileDown className="h-4 w-4" />
                  {t('net_cap_download')}
                </Button>
              )}
            </div>

            <div className="p-2.5 rounded bg-muted/40 font-mono text-[11px] text-muted-foreground space-y-1">
              <div>远端临时文件路径: <span className="text-foreground">{captureResult.remotePath}</span></div>
              <div>包大小: <span className="text-foreground">{captureResult.fileSizeBytes} 字节</span></div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
