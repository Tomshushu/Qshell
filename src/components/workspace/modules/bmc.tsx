/**
 * BMC 带外管理模块（Redfish API）
 *
 * 通过 Redfish HTTPS API 对服务器 BMC 进行带外管理：
 * - 系统信息（厂商/型号/序列号/BIOS/CPU/内存/健康状态）
 * - 电源控制（开机/关机/重启等，危险操作需确认）
 * - 传感器监控（温度/风扇/电压/电源模块 + 整机功耗）
 * - 硬件事件日志（SEL）
 * - 机箱定位指示灯开关
 * - BMC Web 管理界面（KVM 控制台）入口
 *
 * 独立于 SSH 连接：Redfish 请求由 Rust 后端直接发起（信任自签名证书）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '@/i18n'
import { useAppStore } from '@/store'
import { backend } from '@/services/api'
import { playSound, SoundType } from '@/lib/sound'
import { appendBmcSamples, getBmcHistory } from '@/lib/bmc-history'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ErrorDialog } from '@/components/ui/error-dialog'
import { SelectPopover } from '@/components/ui/select-popover'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  ServerCog,
  RefreshCw,
  ExternalLink,
  Lightbulb,
  Power,
  PowerOff,
  RotateCw,
  Moon,
  Zap,
  ActivitySquare,
  Thermometer,
  Fan,
  Cable,
  CircuitBoard,
  Trash2,
  TrendingUp,
  Compass,
  Search,
  Download,
  Sparkles,
} from 'lucide-react'
import type {
  BmcOverview,
  BmcSensor,
  BmcSensorResult,
  BmcLogResult,
  BmcPowerAction,
  BmcBootTarget,
} from '@/services/api/types'
import { cn } from '@/lib/utils'

interface BmcModuleProps {
  serverId: string
  isActive: boolean
}

/** 电源操作定义 */
const POWER_ACTIONS: {
  action: BmcPowerAction
  labelKey: string
  icon: React.ComponentType<{ className?: string }>
  destructive: boolean
}[] = [
  { action: 'on', labelKey: 'bmc_power_on', icon: Power, destructive: false },
  { action: 'gracefulShutdown', labelKey: 'bmc_power_graceful_shutdown', icon: Moon, destructive: true },
  { action: 'forceOff', labelKey: 'bmc_power_force_off', icon: PowerOff, destructive: true },
  { action: 'gracefulRestart', labelKey: 'bmc_power_graceful_restart', icon: RotateCw, destructive: true },
  { action: 'forceRestart', labelKey: 'bmc_power_force_restart', icon: Zap, destructive: true },
  { action: 'powerCycle', labelKey: 'bmc_power_cycle', icon: CircuitBoard, destructive: true },
  { action: 'nmi', labelKey: 'bmc_power_nmi', icon: ActivitySquare, destructive: true },
]

/** 开机引导项目标定义 */
const BOOT_TARGETS: {
  target: BmcBootTarget
  labelKey: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { target: 'None', labelKey: 'bmc_boot_none', icon: RotateCw },
  { target: 'BiosSetup', labelKey: 'bmc_boot_bios', icon: ServerCog },
  { target: 'Pxe', labelKey: 'bmc_boot_pxe', icon: Cable },
  { target: 'Cd', labelKey: 'bmc_boot_cd', icon: CircuitBoard },
  { target: 'Hdd', labelKey: 'bmc_boot_hdd', icon: ActivitySquare },
]

/** 硬件 SEL 智能人话诊断结构 */
interface SelDiagnosis {
  title: string
  hint: string
}

/** 针对高频硬件报错进行中文白话诊断与排查建议提示 */
function diagnoseSel(msg: string): SelDiagnosis | null {
  const m = msg.toLowerCase()
  if (m.includes('ecc') || m.includes('correctable memory') || m.includes('dimm')) {
    return {
      title: 'ECC 内存故障预警',
      hint: '检测到内存插槽存在 ECC 校验错误，建议计划停机拔插金手指或更换故障槽位内存条。',
    }
  }
  if (m.includes('redundancy lost') || m.includes('power supply') || m.includes('psu') || m.includes('power loss')) {
    return {
      title: '电源冗余丢失',
      hint: '某个电源模块供电中断或脱落，当前失去双电源冗余保护，请检查机房 PDU 供电线路。',
    }
  }
  if (m.includes('thermal trip') || m.includes('overheat') || m.includes('temperature above') || m.includes('temp fatal') || m.includes('throttl')) {
    return {
      title: 'CPU/系统过热保护',
      hint: '处理器或主板温度达到结温保护点，已触发降频或关机保护，请检查风扇转速与风道散热。',
    }
  }
  if ((m.includes('fan') && (m.includes('fail') || m.includes('degraded') || m.includes('stop') || m.includes('lower'))) || m.includes('fan missing')) {
    return {
      title: '风扇故障/转速异常',
      hint: '机箱风扇转速低于下限阈值或停转，请尽快清理风扇灰尘或更换风扇模块。',
    }
  }
  if (m.includes('drive') && (m.includes('fail') || m.includes('degraded') || m.includes('rebuild') || m.includes('predictive failure') || m.includes('fault'))) {
    return {
      title: '硬盘故障/阵列降级',
      hint: '检测到物理硬盘 SMART 异常或 RAID 阵列降级，请核对坏盘槽位并及时热插拔替换。',
    }
  }
  if (m.includes('voltage') && (m.includes('irregular') || m.includes('undervoltage') || m.includes('overvoltage') || m.includes('critical'))) {
    return {
      title: '主板供电电压异常',
      hint: '检测到供电电压波动超出临界阈值，请排查主板供电模块与机房供电质量。',
    }
  }
  return null
}

/** 健康状态展示配置 */
function healthStyle(status?: string): { color: string; bg: string } {
  switch ((status ?? '').toLowerCase()) {
    case 'ok':
      return { color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/30' }
    case 'warning':
      return { color: 'text-amber-500', bg: 'bg-amber-500/10 border-amber-500/30' }
    case 'critical':
      return { color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/30' }
    default:
      return { color: 'text-muted-foreground', bg: 'bg-muted border-border' }
  }
}

/** 传感器状态点颜色 */
function sensorDot(status: string): string {
  switch (status) {
    case 'ok': return 'bg-emerald-500'
    case 'warning': return 'bg-amber-500'
    case 'critical': return 'bg-red-500'
    default: return 'bg-muted-foreground/40'
  }
}

/** 电源状态展示 */
function powerStateView(state: string | undefined, t: (k: string) => string): { label: string; color: string } {
  switch ((state ?? '').toLowerCase()) {
    case 'on': return { label: t('bmc_state_on'), color: 'text-emerald-500' }
    case 'off': return { label: t('bmc_state_off'), color: 'text-muted-foreground' }
    case 'poweringon': return { label: t('bmc_state_powering_on'), color: 'text-amber-500' }
    case 'poweringoff': return { label: t('bmc_state_powering_off'), color: 'text-amber-500' }
    default: return { label: t('bmc_state_unknown'), color: 'text-muted-foreground' }
  }
}

/** SEL 严重级别样式 */
function severityStyle(severity: string): { label: string; cls: string } {
  const s = severity.toLowerCase()
  if (s === 'critical') return { label: 'Critical', cls: 'text-red-500 bg-red-500/10' }
  if (s === 'warning') return { label: 'Warning', cls: 'text-amber-500 bg-amber-500/10' }
  if (s === 'ok') return { label: 'OK', cls: 'text-emerald-500 bg-emerald-500/10' }
  return { label: 'Info', cls: 'text-muted-foreground bg-muted' }
}

/** 格式化 ISO 时间为本地时间 */
function formatTime(iso: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

/** 信息行 */
function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] text-muted-foreground flex-shrink-0">{label}</span>
      <span className="text-xs font-medium text-foreground text-right truncate" title={String(value ?? '-')}>
        {value ?? '-'}
      </span>
    </div>
  )
}

/** 传感器行（带量程进度仪表） */
function SensorRow({ sensor }: { sensor: BmcSensor }) {
  const hasUpper = typeof sensor.upperThreshold === 'number' && sensor.upperThreshold > 0
  const percent = hasUpper
    ? Math.min(100, Math.max(0, (sensor.reading / sensor.upperThreshold!) * 100))
    : null

  return (
    <div className="py-1.5 border-b border-border/30 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', sensorDot(sensor.status))} />
          <span className="text-xs truncate" title={sensor.name}>{sensor.name}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {sensor.upperThreshold !== undefined && (
            <span className="text-[10px] text-muted-foreground">≤{sensor.upperThreshold}</span>
          )}
          <span className={cn(
            'text-xs font-semibold tabular-nums',
            sensor.status === 'critical' ? 'text-red-500' : sensor.status === 'warning' ? 'text-amber-500' : 'text-foreground',
          )}>
            {sensor.reading}
            <span className="text-[10px] font-normal text-muted-foreground ml-0.5">{sensor.unit}</span>
          </span>
        </div>
      </div>
      {percent !== null && (
        <div className="mt-1 h-1 w-full rounded-full bg-muted/60 overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              percent >= 90 ? 'bg-red-500' : percent >= 75 ? 'bg-amber-500' : 'bg-emerald-500/70',
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  )
}

/** 趋势图分类 */
type TrendCategory = 'temp' | 'fan' | 'volt' | 'power'

/** 趋势弹窗标题与单位映射（Redfish 标准单位） */
const TREND_META: Record<TrendCategory, { titleKey: string; unit: string }> = {
  temp: { titleKey: 'bmc_temperatures', unit: '°C' },
  fan: { titleKey: 'bmc_fans', unit: 'RPM' },
  volt: { titleKey: 'bmc_voltages', unit: 'V' },
  power: { titleKey: 'bmc_total_power', unit: 'W' },
}

/** 趋势曲线色板（分类着色，与语义无关） */
const TREND_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16']

/** 格式化时间戳为 HH:mm */
function formatTick(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** 传感器历史趋势弹窗：按分类展示最近采样曲线 */
function BmcTrendDialog({
  open, onClose, serverId, category, unit, title,
}: {
  open: TrendCategory | null
  onClose: () => void
  serverId: string
  category: TrendCategory
  unit: string
  title: string
}) {
  const { t } = useTranslation()

  // 打开瞬间从 localStorage 读取快照并聚合（渲染期计算，避免 effect 级联渲染）
  const { rows, series } = useMemo(() => {
    if (!open) return { rows: [] as Array<Record<string, number>>, series: [] as string[] }
    const hist = getBmcHistory(serverId)
    const prefix = `${category}:`
    const keys = Object.keys(hist).filter((k) => k.startsWith(prefix))
    // 按最新值降序取 top8，避免传感器过多时曲线不可读
    const latest = (k: string) => hist[k][hist[k].length - 1]?.[1] ?? -Infinity
    const top = [...keys].sort((a, b) => latest(b) - latest(a)).slice(0, 8)
    // 同一轮采样的所有传感器共用时间戳，按时间戳聚合为图表行
    const rowMap = new Map<number, Record<string, number>>()
    for (const k of top) {
      for (const [ts, v] of hist[k]) {
        const row = rowMap.get(ts) ?? { ts }
        row[k] = v
        rowMap.set(ts, row)
      }
    }
    return {
      rows: [...rowMap.values()].sort((a, b) => a.ts - b.ts),
      series: top,
    }
  }, [open, serverId, category])

  const seriesLabel = (k: string) => (category === 'power' ? t('bmc_total_power') : k.slice(category.length + 1))

  return (
    <Dialog open={open !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-primary" />
            {title}
          </DialogTitle>
        </DialogHeader>
        {series.length === 0 || rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-10 text-center">{t('bmc_trend_empty')}</p>
        ) : (
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="ts" tickFormatter={formatTick} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={44} />
                <Tooltip
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString()}
                  formatter={(value, name) => [`${value} ${unit}`, name]}
                />
                {series.map((k, i) => (
                  <Line
                    key={k}
                    type="monotone"
                    dataKey={k}
                    name={seriesLabel(k)}
                    stroke={TREND_COLORS[i % TREND_COLORS.length]}
                    strokeWidth={1.6}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function BmcModule({ serverId, isActive }: BmcModuleProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const server = useAppStore((s) => s.servers.find((sv) => sv.id === serverId))

  const [overview, setOverview] = useState<BmcOverview | null>(null)
  const [sensors, setSensors] = useState<BmcSensorResult | null>(null)
  const [logs, setLogs] = useState<BmcLogResult | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [sensorsLoading, setSensorsLoading] = useState(false)
  const [logsLoading, setLogsLoading] = useState(false)
  const [powerPending, setPowerPending] = useState<string | null>(null)
  const [bootSetting, setBootSetting] = useState(false)
  const [ledToggling, setLedToggling] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState(10)
  const [errorDialog, setErrorDialog] = useState<{ open: boolean; message: string }>({ open: false, message: '' })
  const [confirmAction, setConfirmAction] = useState<BmcPowerAction | null>(null)
  const [trendCat, setTrendCat] = useState<TrendCategory | null>(null)
  const [clearingLogs, setClearingLogs] = useState(false)
  const [clearConfirm, setClearConfirm] = useState(false)
  const [selSearch, setSelSearch] = useState('')
  const [selSeverity, setSelSeverity] = useState('all')

  // 并发保护：避免刷新重入
  const overviewRefreshingRef = useRef(false)
  const sensorsRefreshingRef = useRef(false)
  const logsRefreshingRef = useRef(false)

  const loadOverview = useCallback(async (silent = false): Promise<BmcOverview | null> => {
    if (overviewRefreshingRef.current) return null
    overviewRefreshingRef.current = true
    if (!silent) setOverviewLoading(true)
    try {
      const r = await backend?.bmc.getOverview(serverId)
      if (r) {
        setOverview(r)
        if (!r.success && r.error) {
          // 静默刷新（自动刷新/电源操作后）失败时不弹模态框，避免打断用户
          if (!silent) setErrorDialog({ open: true, message: r.error })
        }
      }
      return r ?? null
    } catch (e) {
      if (!silent) setErrorDialog({ open: true, message: e instanceof Error ? e.message : String(e) })
      return null
    } finally {
      overviewRefreshingRef.current = false
      setOverviewLoading(false)
    }
  }, [serverId])

  const loadSensors = useCallback(async (silent = false) => {
    if (sensorsRefreshingRef.current) return
    sensorsRefreshingRef.current = true
    if (!silent) setSensorsLoading(true)
    try {
      const r = await backend?.bmc.getSensors(serverId)
      if (r) setSensors(r)
      // 采样成功时顺带记录历史（供趋势图使用；失败静默，不阻断主流程）
      if (r?.success) {
        const samples: Array<{ key: string; value: number }> = []
        for (const s of r.temperatures) {
          if (typeof s.reading === 'number') samples.push({ key: `temp:${s.name}`, value: s.reading })
        }
        for (const s of r.fans) {
          if (typeof s.reading === 'number') samples.push({ key: `fan:${s.name}`, value: s.reading })
        }
        for (const s of r.voltages) {
          if (typeof s.reading === 'number') samples.push({ key: `volt:${s.name}`, value: s.reading })
        }
        if (typeof r.totalPowerWatts === 'number') {
          samples.push({ key: 'power:total', value: r.totalPowerWatts })
        }
        appendBmcSamples(serverId, samples)
      }
    } catch { /* 传感器失败不打断主界面（下次刷新重试） */ }
    finally {
      sensorsRefreshingRef.current = false
      setSensorsLoading(false)
    }
  }, [serverId])

  const loadLogs = useCallback(async (silent = false) => {
    if (logsRefreshingRef.current) return
    logsRefreshingRef.current = true
    if (!silent) setLogsLoading(true)
    try {
      const r = await backend?.bmc.getLogs(serverId)
      if (r) setLogs(r)
    } catch { /* 日志失败不打断主界面 */ }
    finally {
      logsRefreshingRef.current = false
      setLogsLoading(false)
    }
  }, [serverId])

  const refreshAll = useCallback(async () => {
    playSound(SoundType.Toggle)
    await Promise.all([loadOverview(), loadSensors(), loadLogs()])
  }, [loadOverview, loadSensors, loadLogs])

  // serverId 切换时重置数据（渲染期调整状态，避免 effect 内 setState 级联渲染）
  const [prevServerId, setPrevServerId] = useState(serverId)
  if (prevServerId !== serverId) {
    setPrevServerId(serverId)
    setOverview(null)
    setSensors(null)
    setLogs(null)
    setOverviewLoading(true)
    // 重置弹窗状态，避免旧服务器的内容残留
    setErrorDialog({ open: false, message: '' })
    setConfirmAction(null)
    setTrendCat(null)
    setClearConfirm(false)
    setSelSearch('')
    setSelSeverity('all')
  }

  // 首次挂载/激活时加载（effect 内定义异步函数发起，与 overview 模块模式一致）
  useEffect(() => {
    if (!isActive) return
    const load = async () => {
      await Promise.allSettled([loadOverview(), loadSensors(), loadLogs()])
    }
    load()
  }, [serverId, isActive, loadOverview, loadSensors, loadLogs])

  // 自动刷新（用户自定义间隔）
  useEffect(() => {
    if (!autoRefresh || !isActive) return
    const timer = setInterval(() => {
      void loadSensors(true)
      void loadOverview(true)
      void loadLogs(true)
    }, Math.max(3, refreshInterval) * 1_000)
    return () => clearInterval(timer)
  }, [autoRefresh, isActive, refreshInterval, loadSensors, loadOverview, loadLogs])

  // 电源状态轮询：电源操作后每 2s 静默刷新，直到脱离过渡态（On/Off/Unknown）或超时
  const powerPollRef = useRef<number | null>(null)
  const stopPowerPoll = useCallback(() => {
    if (powerPollRef.current !== null) {
      clearTimeout(powerPollRef.current)
      powerPollRef.current = null
    }
  }, [])
  const pollPowerState = useCallback(() => {
    stopPowerPoll()
    const startedAt = Date.now()
    const schedule = (delay: number) => {
      const id = window.setTimeout(() => void tick(id), delay)
      powerPollRef.current = id
    }
    const tick = async (myId: number) => {
      const r = await loadOverview(true)
      if (powerPollRef.current !== myId) return
      const st = r?.powerState
      const transitioning = st === 'PoweringOn' || st === 'PoweringOff'
      if (st && !transitioning) {
        stopPowerPoll()
        void loadSensors(true)
        void loadLogs(true)
        return
      }
      if (Date.now() - startedAt > 120_000) {
        stopPowerPoll()
        return
      }
      schedule(2_000)
    }
    schedule(2_000)
  }, [loadOverview, loadSensors, loadLogs, stopPowerPoll])

  useEffect(() => stopPowerPoll, [stopPowerPoll, serverId])

  // 电源操作执行
  const executePowerAction = useCallback(async (action: BmcPowerAction) => {
    setPowerPending(action)
    try {
      const r = await backend?.bmc.powerAction(serverId, action)
      if (r?.success) {
        playSound(SoundType.Confirm)
        toast.success(r.message || t('bmc_power_sent'))
        pollPowerState()
      } else {
        setErrorDialog({ open: true, message: r?.error || t('bmc_power_failed') })
      }
    } catch (e) {
      setErrorDialog({ open: true, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setPowerPending(null)
      setConfirmAction(null)
    }
  }, [serverId, t, toast, pollPowerState])

  // 开机引导项设置
  const handleSetBootSource = useCallback(async (target: string) => {
    setBootSetting(true)
    try {
      const r = await backend?.bmc.setBootSource(serverId, target)
      if (r?.success) {
        playSound(SoundType.Confirm)
        toast.success(r.message || t('bmc_boot_set_success'))
        void loadOverview(true)
      } else {
        toast.error(r?.error || t('bmc_boot_set_failed'))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBootSetting(false)
    }
  }, [serverId, t, toast, loadOverview])

  // 清空硬件事件日志
  const handleClearLogs = useCallback(async () => {
    setClearingLogs(true)
    try {
      const r = await backend?.bmc.clearLogs(serverId)
      if (r?.success) {
        playSound(SoundType.Confirm)
        toast.success(r.message || t('bmc_clear_log_done'))
        await loadLogs()
      } else {
        setErrorDialog({ open: true, message: r?.error || t('bmc_clear_log_failed') })
      }
    } catch (e) {
      setErrorDialog({ open: true, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setClearingLogs(false)
      setClearConfirm(false)
    }
  }, [serverId, t, toast, loadLogs])

  // 过滤后的 SEL 日志
  const filteredLogs = useMemo(() => {
    if (!logs?.entries) return []
    return logs.entries.filter((entry) => {
      if (selSeverity !== 'all' && entry.severity.toLowerCase() !== selSeverity.toLowerCase()) {
        return false
      }
      if (selSearch.trim()) {
        const query = selSearch.toLowerCase()
        const matchMsg = (entry.message || '').toLowerCase().includes(query)
        const matchId = (entry.id || '').toLowerCase().includes(query)
        const matchSev = (entry.severity || '').toLowerCase().includes(query)
        if (!matchMsg && !matchId && !matchSev) return false
      }
      return true
    })
  }, [logs, selSeverity, selSearch])

  // 导出 SEL 为 CSV 报障单
  const handleExportSelCsv = useCallback(() => {
    if (!logs?.entries || logs.entries.length === 0) {
      toast.error(t('bmc_log_empty'))
      return
    }
    const headers = ['ID', 'Time (ISO)', 'Time (Local)', 'Severity', 'Diagnosis', 'Message']
    const rows = logs.entries.map((e) => {
      const diag = diagnoseSel(e.message)
      const diagText = diag ? `[${diag.title}] ${diag.hint}` : '-'
      const escape = (str: string) => `"${(str || '').replace(/"/g, '""')}"`
      return [
        escape(e.id),
        escape(e.created),
        escape(formatTime(e.created)),
        escape(e.severity),
        escape(diagText),
        escape(e.message),
      ].join(',')
    })

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const dateStr = new Date().toISOString().slice(0, 10)
    link.href = url
    link.download = `${server?.name || serverId}_SEL_${dateStr}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast.success(`${t('bmc_sel_export_csv')}: ${logs.entries.length} ${t('bmc_log_count')}`)
  }, [logs, server?.name, serverId, t, toast])

  // 定位指示灯开关
  const handleToggleLed = useCallback(async (on: boolean) => {
    setLedToggling(true)
    try {
      const r = await backend?.bmc.setIdentifyLed(serverId, on)
      if (r?.success) {
        toast.success(on ? t('bmc_led_lit') : t('bmc_led_off'))
        void loadOverview(true)
      } else {
        toast.error(r?.error || t('bmc_led_failed'))
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLedToggling(false)
    }
  }, [serverId, t, toast, loadOverview])

  // 打开 BMC Web 管理界面（KVM 控制台）
  const handleOpenWebConsole = useCallback(async () => {
    const url = overview?.webUrl
      || `https://${server?.host || ''}:${server?.bmcPort || 443}`
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(url)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }, [overview?.webUrl, server?.host, server?.bmcPort, toast])

  const ps = powerStateView(overview?.powerState, t)
  const hs = healthStyle(overview?.healthStatus)
  const ledOn = (overview?.indicatorLed ?? '').toLowerCase() === 'lit'

  // ============ 初始加载中 ============
  if (overviewLoading && !overview) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <ServerCog className="h-10 w-10 animate-pulse" />
        <p className="text-sm">{t('bmc_connecting')}</p>
      </div>
    )
  }

  // ============ 加载失败（从未成功过） ============
  if (overview && !overview.success) {
    return (
      <>
        <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
          <ServerCog className="h-12 w-12 opacity-30" />
          <div className="text-center">
            <p className="text-sm font-medium mb-1">{t('bmc_load_failed')}</p>
            <p className="text-xs text-destructive max-w-md">{overview.error}</p>
          </div>
          <Button onClick={() => void loadOverview()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            {t('ws_reconnect')}
          </Button>
        </div>
        <ErrorDialog
          open={errorDialog.open}
          message={errorDialog.message}
          onClose={() => setErrorDialog({ open: false, message: '' })}
        />
      </>
    )
  }

  return (
    <div className="flex flex-col h-full bg-transparent select-none">
      {/* ============ 顶部操作栏 ============ */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/60 bg-card shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <ServerCog className="h-4 w-4 text-primary flex-shrink-0" />
          <span className="text-sm font-semibold truncate">{server?.name || serverId}</span>
          <span className={cn('text-xs px-2 py-0.5 rounded-md border', hs.bg, hs.color)}>
            {t('bmc_health')}: {overview?.healthStatus || '-'}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            {t('bmc_auto_refresh')}
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
          </label>
          {autoRefresh && (
            <SelectPopover
              value={String(refreshInterval)}
              onChange={(v) => setRefreshInterval(Number(v))}
              options={[5, 10, 15, 30, 60].map((s) => ({ value: String(s), label: `${s}s` }))}
              placeholder={t('bmc_refresh_interval')}
              className="h-7"
              ariaLabel={t('bmc_refresh_interval')}
            />
          )}
          <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={() => void refreshAll()}>
            <RefreshCw className={cn('h-3 w-3', overviewLoading || sensorsLoading || logsLoading ? 'animate-spin' : '')} />
            {t('bmc_refresh')}
          </Button>
          <Button size="sm" className="h-7 gap-1.5" onClick={() => void handleOpenWebConsole()}>
            <ExternalLink className="h-3 w-3" />
            {t('bmc_web_console')}
          </Button>
        </div>
      </div>

      <div className="p-3 overflow-auto flex-1 space-y-3">

      {/* ============ 第一行：系统信息 / BMC 信息 / 电源控制 ============ */}
      <div className="grid grid-cols-3 gap-3">
        {/* 系统信息卡片 */}
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <ServerCog className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold">{t('bmc_sys_info')}</span>
            </div>
            <div className="divide-y divide-border/20">
              <InfoRow label={t('bmc_manufacturer')} value={overview?.manufacturer} />
              <InfoRow label={t('bmc_model')} value={overview?.model} />
              <InfoRow label={t('bmc_serial')} value={overview?.serialNumber} />
              <InfoRow label={t('bmc_bios')} value={overview?.biosVersion} />
              <InfoRow label={t('bmc_cpu')} value={overview?.cpuModel
                ? `${overview.cpuModel}${overview.cpuCount ? ` × ${overview.cpuCount}` : ''}`
                : undefined} />
              <InfoRow label={t('bmc_memory')} value={overview?.totalMemoryGb !== undefined
                ? `${overview.totalMemoryGb} GB` : undefined} />
            </div>
          </CardContent>
        </Card>

        {/* BMC 管理器卡片 */}
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Cable className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold">{t('bmc_manager_info')}</span>
            </div>
            <div className="divide-y divide-border/20">
              <InfoRow label={t('bmc_bmc_model')} value={overview?.bmcModel} />
              <InfoRow label={t('bmc_firmware')} value={overview?.bmcFirmware} />
              <InfoRow label={t('bmc_ip')} value={overview?.bmcIp} />
              <InfoRow label={t('bmc_mac')} value={overview?.bmcMac} />
            </div>
            {/* 定位指示灯 */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30">
              <div className="flex items-center gap-1.5">
                <Lightbulb className={cn('h-3.5 w-3.5', ledOn ? 'text-amber-500' : 'text-muted-foreground')} />
                <span className="text-xs">{t('bmc_identify_led')}</span>
              </div>
              <Switch
                checked={ledOn}
                disabled={ledToggling}
                onCheckedChange={(v) => void handleToggleLed(v)}
              />
            </div>
          </CardContent>
        </Card>

        {/* 电源控制与开机引导项卡片 */}
        <Card className={cn('border-l-4', overview?.powerState === 'On' ? 'border-l-emerald-500' : 'border-l-muted-foreground/40')}>
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5">
                <Power className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold">{t('bmc_power_control')}</span>
              </div>
              <span className={cn('text-sm font-bold', ps.color)}>{ps.label}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {POWER_ACTIONS.map(({ action, labelKey, icon: Icon, destructive }) => (
                <Button
                  key={action}
                  variant={destructive ? 'outline' : 'secondary'}
                  size="sm"
                  className={cn(
                    'h-7 text-[11px] justify-center gap-1',
                    destructive && 'text-red-500 hover:text-red-600 hover:bg-red-500/10 hover:border-red-500/30',
                    action === 'on' && !destructive && 'text-emerald-600 dark:text-emerald-400',
                  )}
                  disabled={powerPending !== null}
                  onClick={() => {
                    playSound(SoundType.Open)
                    if (destructive) {
                      setConfirmAction(action)
                    } else {
                      void executePowerAction(action)
                    }
                  }}
                >
                  {powerPending === action
                    ? <RefreshCw className="h-3 w-3 animate-spin" />
                    : <Icon className="h-3 w-3" />}
                  {t(labelKey)}
                </Button>
              ))}
            </div>

            {/* 下次开机引导项设置 (Boot Source Override) */}
            <div className="mt-2 pt-2 border-t border-border/30">
              <div className="flex items-center justify-between gap-1 mb-1">
                <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                  <Compass className="h-3 w-3 text-primary" />
                  <span>{t('bmc_boot_override')}</span>
                </div>
                <span className="text-[10px] text-muted-foreground truncate max-w-[120px]" title={overview?.bootSourceTarget || t('bmc_boot_none')}>
                  {overview?.bootSourceTarget && overview.bootSourceTarget !== 'None'
                    ? `${overview.bootSourceTarget} (${overview.bootSourceEnabled || 'Once'})`
                    : t('bmc_boot_none')}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {BOOT_TARGETS.map(({ target, labelKey, icon: Icon }) => {
                  const isCurrent = (overview?.bootSourceTarget || 'None').toLowerCase() === target.toLowerCase()
                  return (
                    <Button
                      key={target}
                      variant={isCurrent ? 'default' : 'outline'}
                      size="sm"
                      disabled={bootSetting}
                      className={cn(
                        'h-6 text-[10px] justify-center gap-0.5 px-1',
                        isCurrent && 'bg-primary text-primary-foreground font-semibold',
                      )}
                      onClick={() => void handleSetBootSource(target)}
                    >
                      <Icon className="h-2.5 w-2.5 flex-shrink-0" />
                      <span className="truncate">{t(labelKey)}</span>
                    </Button>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ============ 第二行：传感器 ============ */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Thermometer className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold">{t('bmc_sensors')}</span>
            </div>
            <div className="flex items-center gap-3">
              {sensors?.totalPowerWatts !== undefined && (
                <span className="text-xs text-muted-foreground">
                  {t('bmc_total_power')}: <span className="font-semibold text-foreground tabular-nums">{sensors.totalPowerWatts} W</span>
                </span>
              )}
              <button
                type="button"
                title={t('bmc_trend')}
                onClick={() => setTrendCat('power')}
                className="p-0.5 rounded text-muted-foreground hover:text-primary transition-colors"
              >
                <TrendingUp className="h-3 w-3" />
              </button>
              {sensorsLoading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
          </div>

          {sensors && !sensors.success && (
            <p className="text-xs text-muted-foreground py-4 text-center">{sensors.error}</p>
          )}

          <div className="grid grid-cols-4 gap-3">
            {/* 温度 */}
            <div>
              <div className="flex items-center gap-1 mb-1 text-muted-foreground">
                <Thermometer className="h-3 w-3" />
                <span className="text-[11px] font-medium">{t('bmc_temperatures')}</span>
                <button
                  type="button"
                  title={t('bmc_trend')}
                  onClick={() => setTrendCat('temp')}
                  className="ml-auto p-0.5 rounded hover:text-primary transition-colors"
                >
                  <TrendingUp className="h-3 w-3" />
                </button>
              </div>
              <div className="max-h-[180px] overflow-y-auto">
                {(sensors?.temperatures ?? []).map((s) => <SensorRow key={s.name} sensor={s} />)}
                {(!sensors || sensors.temperatures.length === 0) && (
                  <p className="text-[11px] text-muted-foreground py-2">-</p>
                )}
              </div>
            </div>
            {/* 风扇 */}
            <div>
              <div className="flex items-center gap-1 mb-1 text-muted-foreground">
                <Fan className="h-3 w-3" />
                <span className="text-[11px] font-medium">{t('bmc_fans')}</span>
                <button
                  type="button"
                  title={t('bmc_trend')}
                  onClick={() => setTrendCat('fan')}
                  className="ml-auto p-0.5 rounded hover:text-primary transition-colors"
                >
                  <TrendingUp className="h-3 w-3" />
                </button>
              </div>
              <div className="max-h-[180px] overflow-y-auto">
                {(sensors?.fans ?? []).map((s) => <SensorRow key={s.name} sensor={s} />)}
                {(!sensors || sensors.fans.length === 0) && (
                  <p className="text-[11px] text-muted-foreground py-2">-</p>
                )}
              </div>
            </div>
            {/* 电压 */}
            <div>
              <div className="flex items-center gap-1 mb-1 text-muted-foreground">
                <Zap className="h-3 w-3" />
                <span className="text-[11px] font-medium">{t('bmc_voltages')}</span>
                <button
                  type="button"
                  title={t('bmc_trend')}
                  onClick={() => setTrendCat('volt')}
                  className="ml-auto p-0.5 rounded hover:text-primary transition-colors"
                >
                  <TrendingUp className="h-3 w-3" />
                </button>
              </div>
              <div className="max-h-[180px] overflow-y-auto">
                {(sensors?.voltages ?? []).map((s) => <SensorRow key={s.name} sensor={s} />)}
                {(!sensors || sensors.voltages.length === 0) && (
                  <p className="text-[11px] text-muted-foreground py-2">-</p>
                )}
              </div>
            </div>
            {/* 电源模块 */}
            <div>
              <div className="flex items-center gap-1 mb-1 text-muted-foreground">
                <Cable className="h-3 w-3" />
                <span className="text-[11px] font-medium">{t('bmc_psus')}</span>
              </div>
              <div className="max-h-[180px] overflow-y-auto">
                {(sensors?.powerSupplies ?? []).map((p) => (
                  <div key={p.name} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/30 last:border-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', sensorDot(p.status))} />
                      <span className="text-xs truncate" title={p.name}>{p.name}</span>
                    </div>
                    <span className="text-xs font-semibold tabular-nums flex-shrink-0">
                      {p.powerWatts !== undefined ? `${p.powerWatts} W` : '-'}
                    </span>
                  </div>
                ))}
                {(!sensors || sensors.powerSupplies.length === 0) && (
                  <p className="text-[11px] text-muted-foreground py-2">-</p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ============ 第三行：硬件事件日志（SEL） ============ */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <div className="flex items-center gap-1.5 min-w-0">
              <ActivitySquare className="h-3.5 w-3.5 text-primary flex-shrink-0" />
              <span className="text-xs font-semibold">{t('bmc_event_log')}</span>
              {logs?.success && (
                <span className="text-[11px] text-muted-foreground">
                  ({filteredLogs.length}/{logs.entries.length})
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {/* 搜索框 */}
              <div className="relative">
                <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={selSearch}
                  onChange={(e) => setSelSearch(e.target.value)}
                  placeholder={t('bmc_sel_search_placeholder')}
                  className="h-6 w-36 pl-6 pr-2 text-[11px] bg-card border border-border/60 rounded-md outline-none focus:border-primary/50"
                />
              </div>

              {/* 级别筛选 */}
              <SelectPopover
                value={selSeverity}
                onChange={(v) => setSelSeverity(v ?? 'all')}
                options={[
                  { value: 'all', label: '全部级别' },
                  { value: 'critical', label: 'Critical' },
                  { value: 'warning', label: 'Warning' },
                  { value: 'ok', label: 'OK' },
                  { value: 'info', label: 'Info' },
                ]}
                className="h-6 text-[11px]"
                ariaLabel={t('bmc_sel_severity')}
              />

              {/* 导出 CSV */}
              {logs?.success && logs.entries.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[11px] gap-1 px-2"
                  onClick={handleExportSelCsv}
                  title={t('bmc_sel_export_csv')}
                >
                  <Download className="h-3 w-3" />
                  <span>{t('bmc_sel_export_csv')}</span>
                </Button>
              )}

              {/* 清空日志 */}
              {logs?.success && logs.entries.length > 0 && (
                <button
                  type="button"
                  title={t('bmc_clear_log')}
                  disabled={clearingLogs}
                  onClick={() => setClearConfirm(true)}
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                >
                  {clearingLogs ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </button>
              )}

              {logsLoading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
          </div>

          {!logs?.success && (
            <p className="text-xs text-muted-foreground py-4 text-center">{logs?.error || t('bmc_log_empty')}</p>
          )}

          {logs?.success && (
            <div className="m-2 max-h-[260px] overflow-y-auto rounded-xl border border-border/60 bg-card shadow-sm">
              <table className="w-full text-xs">
                <thead className="workspace-table-head">
                  <tr className="text-left text-muted-foreground">
                    <th className="px-2 py-1.5 font-medium w-[140px]">{t('bmc_log_time')}</th>
                    <th className="px-2 py-1.5 font-medium w-[75px]">{t('bmc_log_severity')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('bmc_log_message')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-center py-6 text-muted-foreground text-xs">
                        {t('bmc_log_empty')}
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((entry) => {
                      const sev = severityStyle(entry.severity)
                      const diag = diagnoseSel(entry.message)
                      return (
                        <tr key={`${entry.id}-${entry.created}`} className="border-t border-border/20 hover:bg-accent/30">
                          <td className="px-2 py-1.5 text-muted-foreground tabular-nums whitespace-nowrap">
                            {formatTime(entry.created)}
                          </td>
                          <td className="px-2 py-1.5">
                            <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', sev.cls)}>
                              {sev.label}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex flex-col gap-0.5">
                              <span className="break-all">{entry.message || '-'}</span>
                              {diag && (
                                <div className="flex items-center gap-1.5 text-[10px] bg-primary/10 border border-primary/20 text-primary px-2 py-0.5 rounded mt-0.5" title={diag.hint}>
                                  <Sparkles className="h-2.5 w-2.5 flex-shrink-0" />
                                  <span className="font-semibold">{diag.title}:</span>
                                  <span className="text-muted-foreground">{diag.hint}</span>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============ 弹窗 ============ */}
      <ErrorDialog
        open={errorDialog.open}
        message={errorDialog.message}
        onClose={() => setErrorDialog({ open: false, message: '' })}
      />

      <ConfirmDialog
        open={confirmAction !== null}
        title={t('bmc_power_confirm_title')}
        description={`${t('bmc_power_confirm_desc')}${confirmAction ? t(POWER_ACTIONS.find((p) => p.action === confirmAction)?.labelKey ?? '') : ''}」?`}
        variant="destructive"
        confirmText={t('bmc_power_confirm_yes')}
        cancelText={t('cd_default_cancel')}
        onConfirm={() => { if (confirmAction) void executePowerAction(confirmAction) }}
        onCancel={() => setConfirmAction(null)}
      />

      <ConfirmDialog
        open={clearConfirm}
        title={t('bmc_clear_log')}
        description={t('bmc_clear_log_confirm')}
        variant="destructive"
        confirmText={t('bmc_clear_log')}
        cancelText={t('cd_default_cancel')}
        onConfirm={() => void handleClearLogs()}
        onCancel={() => setClearConfirm(false)}
      />

      <BmcTrendDialog
        open={trendCat}
        onClose={() => setTrendCat(null)}
        serverId={serverId}
        category={trendCat ?? 'temp'}
        unit={trendCat ? TREND_META[trendCat].unit : ''}
        title={trendCat ? t(TREND_META[trendCat].titleKey) : ''}
      />
      </div>
    </div>
  )
}
