import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  X,
  ExternalLink,
  Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useMetricsStore, useMetricsSubscription } from '@/store/metrics-store'
import type { ProcessInfo, DiskInfo } from '@/types'

const POS_STORAGE_KEY_V2 = 'qshell_floating_hud_pos_v2'
const POS_STORAGE_KEY_V3 = 'qshell_floating_hud_pos_v3'

export interface HudPosition {
  anchorX: 'right' | 'left'
  anchorY: 'top' | 'bottom'
  offsetRight?: number
  offsetLeft?: number
  offsetTop?: number
  offsetBottom?: number
}

export interface FloatingMetricsHudProps {
  serverId: string
  isConnected: boolean
  visible?: boolean
  onClose?: () => void
  onOpenFullOverview?: () => void
}

/** 安全数值格式化：非有限数（含 undefined / null）返回 '0'，避免后端字段缺失时 toFixed 崩溃 */
const safeFixed = (v: number | undefined | null, n: number) =>
  Number.isFinite(v as number) ? (v as number).toFixed(n) : '0'
/** 安全数值转换：非有限数返回 0，用于求和与排序 */
const safeNum = (v?: number | null) => (Number.isFinite(v as number) ? (v as number) : 0)

/** 格式化运行时间 (如 "347 天" 或 "12 天 4 小时") */
function formatUptime(seconds?: number): string {
  if (!seconds || seconds <= 0) return '-'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) {
    return hours > 0 ? `${days} 天 ${hours} 小时` : `${days} 天`
  }
  if (hours > 0) {
    return `${hours} 小时 ${mins} 分`
  }
  return `${mins} 分钟`
}

/** 格式化网络吞吐速率 (Kbps 转换为 B/s, KB/s, MB/s) */
function formatNetRate(kbps: number): string {
  if (!Number.isFinite(kbps) || kbps <= 0) return '0 B/s'
  const bytesPerSec = (kbps * 1000) / 8
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
}

/** 格式化磁盘大小 (GB 转换为人性化的 M/G，如 364M, 68.8G) */
function formatDiskSize(gb: number): string {
  if (!Number.isFinite(gb) || gb <= 0) return '0M'
  if (gb < 1) {
    const mb = gb * 1024
    return `${Math.round(mb)}M`
  }
  const formatted = gb % 1 === 0 ? gb.toFixed(0) : gb.toFixed(1)
  return `${formatted}G`
}

/** 格式化进程内存占用 */
function formatProcMem(p: ProcessInfo): string {
  const kb = p.rss || 0
  if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(1)}G`
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)}M`
  if (kb > 0) return `${kb}K`
  return `${(p.memory || 0).toFixed(1)}%`
}

/** 提取主可执行文件名 (如 /usr/bin/redis-server -> redis-server) */
function getShortCommand(cmd: string): string {
  if (!cmd) return '-'
  const trimmed = cmd.trim()
  const first = trimmed.split(/\s+/)[0]
  return first.split('/').pop() || first
}

/** 颜色辅助函数 */
function getProgressColor(pct: number) {
  if (pct >= 85) return 'bg-destructive'
  if (pct >= 70) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function getTextColor(pct: number) {
  if (pct >= 85) return 'text-destructive font-semibold'
  if (pct >= 70) return 'text-amber-500 font-semibold'
  return 'text-emerald-500'
}

// ==================== 1. 主工作区悬浮监控卡片 (原生拖拽、完整功能、去除了右上角下拉折叠按钮) ====================
/** 局部错误边界：指标数据异常时只隐藏监控卡片，不让 React 错误冒泡到全局导致整屏白屏 */
class HudErrorBoundary extends React.Component<
  { serverId: string; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.warn('[MetricsHud] 指标渲染异常，已隐藏悬浮监控卡片:', error)
  }

  componentDidUpdate(prevProps: { serverId: string }) {
    if (this.state.failed && prevProps.serverId !== this.props.serverId) {
      this.setState({ failed: false })
    }
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function FloatingMetricsHud(props: FloatingMetricsHudProps) {
  return (
    <HudErrorBoundary serverId={props.serverId}>
      <FloatingMetricsHudInner {...props} />
    </HudErrorBoundary>
  )
}

function FloatingMetricsHudInner({
  serverId,
  isConnected,
  visible = true,
  onClose,
  onOpenFullOverview,
}: FloatingMetricsHudProps) {
  // 进程排序方式 (cpu | memory)
  const [procSort, setProcSort] = useState<'cpu' | 'memory'>('cpu')
  // 选中的网络接口（'all' 或指定网卡名称，默认恢复历史选择或留空等待网卡列表选择首个）
  const [selectedIface, setSelectedIface] = useState<string>(() => {
    try {
      return localStorage.getItem('qshell_floating_hud_iface') || ''
    } catch {
      return ''
    }
  })
  const [ifaceMenuOpen, setIfaceMenuOpen] = useState(false)
  // 鼠标悬停在网络波形图上时查看特定点位的上传/下载速率（解决无标度问题）
  const [hoveredNet, setHoveredNet] = useState<{
    rxKbps: number
    txKbps: number
    x: number
    percent: number
  } | null>(null)

  // 订阅共享监控 Store：面板显示时按 normal(2.5s) 高效获取监控与进程快照
  useMetricsSubscription(
    serverId,
    Boolean(isConnected && visible && serverId),
    'normal',
  )

  // 纯只读共享 Store
  const serverState = useMetricsStore((s) => s.serverStates[serverId])
  const metrics = serverState?.metrics
  const topProcesses = serverState?.topProcesses || []

  // 稳定排序网卡列表：以 eth 开头的排在最前，其次为 ens/enp，虚拟网卡 lo/docker 排在最后
  const sortedNetwork = useMemo(() => {
    const list = metrics?.network || []
    return list.slice().sort((a, b) => {
      const aName = a.interface.toLowerCase()
      const bName = b.interface.toLowerCase()

      const aEth = aName.startsWith('eth')
      const bEth = bName.startsWith('eth')
      if (aEth !== bEth) return aEth ? -1 : 1

      const aEns = aName.startsWith('en')
      const bEns = bName.startsWith('en')
      if (aEns !== bEns) return aEns ? -1 : 1

      const aVir =
        aName.startsWith('docker') ||
        aName.startsWith('br-') ||
        aName.startsWith('veth') ||
        aName === 'lo'
      const bVir =
        bName.startsWith('docker') ||
        bName.startsWith('br-') ||
        bName.startsWith('veth') ||
        bName === 'lo'
      if (aVir !== bVir) return aVir ? 1 : -1

      return aName.localeCompare(bName)
    })
  }, [metrics?.network])

  // 网卡列表到达时，若未指定或所选特定网卡不存在，优先自动选中 eth0 或列表第一项（与 FinalShell 一致）
  useEffect(() => {
    if (sortedNetwork.length === 0) return
    if (!selectedIface) {
      const preferred = sortedNetwork[0]?.interface || 'all'
      setSelectedIface(preferred)
    } else if (selectedIface !== 'all') {
      const exists = sortedNetwork.some((n) => n.interface === selectedIface)
      if (!exists) {
        const preferred = sortedNetwork[0]?.interface || 'all'
        setSelectedIface(preferred)
      }
    }
  }, [sortedNetwork, selectedIface])

  const netHistory = useMemo(() => {
    const byIface = serverState?.netHistoryByIface
    if (!byIface) return []
    return byIface[selectedIface] || byIface['all'] || []
  }, [serverState?.netHistoryByIface, selectedIface])

  // 坐标位置（基于边缘智能吸附与相对锚定，窗口最大化或缩放时始终保持相对边缘距离不变）
  const [position, setPosition] = useState<HudPosition | null>(() => {
    try {
      const savedV3 = localStorage.getItem(POS_STORAGE_KEY_V3)
      if (savedV3) return JSON.parse(savedV3)
      // 清理旧版本 v2 遗留的绝对坐标，防止最大化后漂移在屏幕中间
      localStorage.removeItem(POS_STORAGE_KEY_V2)
    } catch {
      /* ignore */
    }
    return null
  })

  const hudRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)
  const dragStartOffsetRef = useRef({ x: 0, y: 0 })

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (
      (e.target as HTMLElement).closest('button') ||
      (e.target as HTMLElement).closest('select') ||
      (e.target as HTMLElement).closest('[data-no-drag]')
    ) {
      return
    }
    const el = hudRef.current
    if (!el) return

    isDraggingRef.current = true
    const rect = el.getBoundingClientRect()
    dragStartOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
    el.setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    const parent = hudRef.current?.parentElement
    if (!parent) return

    const parentRect = parent.getBoundingClientRect()
    const hudRect = hudRef.current!.getBoundingClientRect()

    let newX = e.clientX - parentRect.left - dragStartOffsetRef.current.x
    let newY = e.clientY - parentRect.top - dragStartOffsetRef.current.y

    const maxX = Math.max(0, parentRect.width - hudRect.width - 8)
    const maxY = Math.max(0, parentRect.height - hudRect.height - 8)

    newX = Math.max(8, Math.min(maxX, newX))
    newY = Math.max(8, Math.min(maxY, newY))

    const offsetRight = Math.max(8, parentRect.width - newX - hudRect.width)
    const offsetLeft = newX
    const offsetBottom = Math.max(8, parentRect.height - newY - hudRect.height)
    const offsetTop = newY

    // 智能边缘吸附：靠近右半区则锚定 right（窗口放大后依然吸附在右侧），靠左半区则锚定 left
    const anchorX: 'right' | 'left' = offsetRight < offsetLeft ? 'right' : 'left'
    const anchorY: 'top' | 'bottom' = offsetBottom < offsetTop ? 'bottom' : 'top'

    const newPos: HudPosition = {
      anchorX,
      anchorY,
      offsetRight: anchorX === 'right' ? Math.round(offsetRight) : undefined,
      offsetLeft: anchorX === 'left' ? Math.round(offsetLeft) : undefined,
      offsetTop: anchorY === 'top' ? Math.round(offsetTop) : undefined,
      offsetBottom: anchorY === 'bottom' ? Math.round(offsetBottom) : undefined,
    }

    setPosition(newPos)
  }, [])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    try {
      hudRef.current?.releasePointerCapture(e.pointerId)
      if (position) {
        localStorage.setItem(POS_STORAGE_KEY_V3, JSON.stringify(position))
      }
    } catch {
      /* ignore */
    }
  }, [position])

  // 双击顶部标题栏可恢复默认右上角位置
  const handleResetPosition = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setPosition(null)
    try {
      localStorage.removeItem(POS_STORAGE_KEY_V3)
      localStorage.removeItem(POS_STORAGE_KEY_V2)
    } catch {
      /* ignore */
    }
  }, [])

  // 窗口尺寸发生变化时（如从普通缩放变为最大化，或分屏调整尺寸），确保卡片不越界
  useEffect(() => {
    const handleResize = () => {
      if (!position || !hudRef.current?.parentElement) return
      const parent = hudRef.current.parentElement
      const parentRect = parent.getBoundingClientRect()
      const hudRect = hudRef.current.getBoundingClientRect()

      if (position.anchorX === 'right' && position.offsetRight !== undefined) {
        const maxOffsetRight = Math.max(8, parentRect.width - hudRect.width - 8)
        if (position.offsetRight > maxOffsetRight) {
          setPosition((prev) => (prev ? { ...prev, offsetRight: maxOffsetRight } : null))
        }
      } else if (position.anchorX === 'left' && position.offsetLeft !== undefined) {
        const maxOffsetLeft = Math.max(8, parentRect.width - hudRect.width - 8)
        if (position.offsetLeft > maxOffsetLeft) {
          setPosition((prev) => (prev ? { ...prev, offsetLeft: maxOffsetLeft } : null))
        }
      }

      if (position.anchorY === 'bottom' && position.offsetBottom !== undefined) {
        const maxOffsetBottom = Math.max(8, parentRect.height - hudRect.height - 8)
        if (position.offsetBottom > maxOffsetBottom) {
          setPosition((prev) => (prev ? { ...prev, offsetBottom: maxOffsetBottom } : null))
        }
      } else if (position.anchorY === 'top' && position.offsetTop !== undefined) {
        const maxOffsetTop = Math.max(8, parentRect.height - hudRect.height - 8)
        if (position.offsetTop > maxOffsetTop) {
          setPosition((prev) => (prev ? { ...prev, offsetTop: maxOffsetTop } : null))
        }
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [position])

  const hudStyle = useMemo<React.CSSProperties>(() => {
    if (!position) {
      return {
        right: '16px',
        top: '12px',
        position: 'absolute',
      }
    }

    const s: React.CSSProperties = {
      position: 'absolute',
    }

    if (position.anchorX === 'right') {
      s.right = `${position.offsetRight ?? 16}px`
    } else {
      s.left = `${position.offsetLeft ?? 16}px`
    }

    if (position.anchorY === 'bottom') {
      s.bottom = `${position.offsetBottom ?? 12}px`
    } else {
      s.top = `${position.offsetTop ?? 12}px`
    }

    return s
  }, [position])

  // 计算聚合核心指标
  const summary = useMemo(() => {
    if (!metrics) {
      return {
        uptimeStr: '-',
        loadStr: '0.00, 0.00, 0.00',
        cpuUsage: 0,
        memUsed: 0,
        memTotal: 0,
        memPercent: 0,
        swapUsed: 0,
        swapTotal: 0,
        swapPercent: 0,
        rxKbps: 0,
        txKbps: 0,
        disks: [] as DiskInfo[],
        level: 'normal' as 'normal' | 'warning' | 'critical',
        available: true,
        isWindows: false,
        hasUptime: false,
        hasLoad: false,
        hasSwap: false,
        hasDisks: false,
        hasNetwork: false,
        processCpuAvailable: true,
      }
    }

    const cpuUsage = Math.min(100, Math.max(0, metrics.cpuUsage || 0))
    const memTotal = metrics.memoryTotal || 0
    const memUsed = metrics.memoryUsed || 0
    const memPercent = memTotal > 0 ? Math.min(100, Math.round((memUsed / memTotal) * 100)) : 0

    const swapTotal = metrics.swapTotal || 0
    const swapUsed = metrics.swapUsed || 0
    const swapPercent = swapTotal > 0 ? Math.min(100, Math.round((swapUsed / swapTotal) * 100)) : 0

    // Windows / 部分网络设备后端不提供 load average（返回空数组），空数组是 truthy，
    // 不能用 `|| [0,0,0]` 兜底；长度不足或元素非数值时降级显示 '-'。
    const loadArr = Array.isArray(metrics.cpuLoad) ? metrics.cpuLoad : []
    const loadStr = loadArr.length >= 3
      ? [0, 1, 2].map((i) => safeFixed(loadArr[i], 2)).join(', ')
      : '-'

    let rxKbps = 0
    let txKbps = 0
    if (selectedIface === 'all' || !selectedIface) {
      metrics.network?.forEach((n) => {
        rxKbps += safeNum(n.rxKbps)
        txKbps += safeNum(n.txKbps)
      })
    } else {
      const match = sortedNetwork.find((n) => n.interface === selectedIface)
      if (match) {
        rxKbps = safeNum(match.rxKbps)
        txKbps = safeNum(match.txKbps)
      }
    }

    const allDisks = metrics.disks || []

    let level: 'normal' | 'warning' | 'critical' = 'normal'
    if (cpuUsage >= 85 || memPercent >= 85) {
      level = 'critical'
    } else if (cpuUsage >= 70 || memPercent >= 70) {
      level = 'warning'
    }

    return {
      uptimeStr: formatUptime(metrics.uptime),
      loadStr,
      cpuUsage,
      memUsed,
      memTotal,
      memPercent,
      swapUsed,
      swapTotal,
      swapPercent,
      rxKbps,
      txKbps,
      disks: allDisks,
      level,
      available: metrics.metricsAvailable !== false,
      isWindows: metrics.platform === 'windows',
      hasUptime: safeNum(metrics.uptime) > 0,
      hasLoad: loadArr.length >= 3,
      hasSwap: swapTotal > 0,
      hasDisks: allDisks.length > 0,
      hasNetwork: (metrics.network || []).length > 0,
      processCpuAvailable: metrics.platform !== 'windows',
    }
  }, [metrics, selectedIface, sortedNetwork])

  // 排序过滤出 Top 4 进程
  const displayProcesses = useMemo(() => {
    return topProcesses
      .slice()
      .sort((a, b) => {
        if (procSort === 'cpu') {
          return safeNum(b.cpu) - safeNum(a.cpu)
        }
        const aMem = a.rss || a.memory || 0
        const bMem = b.rss || b.memory || 0
        return bMem - aMem
      })
      .slice(0, 4)
  }, [topProcesses, procSort])

  // 生成网络 Mini Sparkline (取最近 30 点)
  const sparklineSvg = useMemo(() => {
    const points = netHistory.slice(-30)
    if (points.length < 2) return null

    const width = 240
    const height = 36
    const maxVal = Math.max(50, ...points.map((p) => Math.max(p.rxKbps, p.txKbps)))

    const rxPathPoints: string[] = []
    const txPathPoints: string[] = []

    points.forEach((p, index) => {
      const x = (index / (points.length - 1)) * width
      const yRx = height - (Math.min(maxVal, p.rxKbps) / maxVal) * (height - 4)
      const yTx = height - (Math.min(maxVal, p.txKbps) / maxVal) * (height - 4)
      rxPathPoints.push(`${x.toFixed(1)},${yRx.toFixed(1)}`)
      txPathPoints.push(`${x.toFixed(1)},${yTx.toFixed(1)}`)
    })

    const rxD = `M ${rxPathPoints.join(' L ')}`
    const txD = `M ${txPathPoints.join(' L ')}`
    const rxAreaD = `${rxD} L ${width},${height} L 0,${height} Z`

    return { rxD, txD, rxAreaD, width, height, points, maxVal }
  }, [netHistory])

  // 尚未拿到快照 / 采集失败 / 主机不支持指标时都不渲染，绝不展示全 0 的假指标
  if (!visible || !isConnected || !metrics || metrics.metricsAvailable === false) return null

  // 状态指示点颜色
  const statusDotClass =
    summary.level === 'critical'
      ? 'bg-destructive animate-ping'
      : summary.level === 'warning'
        ? 'bg-amber-500'
        : 'bg-emerald-500'

  return (
    <div
      ref={hudRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={hudStyle}
      className={cn(
        'z-30 select-none',
        'rounded-xl',
        // 苹果液态玻璃 (Apple Liquid Glass) 质感：超高斯毛玻璃 + 饱和度色彩增益
        'backdrop-blur-2xl backdrop-saturate-150',
        // 晶透折射边缘与半透底色
        'border border-white/45 dark:border-white/15',
        'bg-white/65 dark:bg-zinc-950/45',
        // 顶端镜面反光高光 (Apple Specular Rim) + 弥散阴影
        'shadow-[inset_0_1.5px_1px_0_rgba(255,255,255,0.7),0_20px_50px_-10px_rgba(0,0,0,0.18)]',
        'dark:shadow-[inset_0_1.5px_1px_0_rgba(255,255,255,0.2),0_24px_56px_-12px_rgba(0,0,0,0.65)]',
        'text-foreground p-3.5 w-72 sm:w-80',
      )}
    >
      <div className="flex flex-col gap-2.5 text-xs font-sans">
        {/* 1. 顶部栏 (运行时间、负载与关闭按钮，去除了右上角下拉折叠按钮) */}
        <div
          className="pb-2.5 border-b border-black/5 dark:border-white/10 cursor-grab active:cursor-grabbing"
          onDoubleClick={handleResetPosition}
          title="按住鼠标左键可任意拖拽位置，双击可恢复至右上角默认位置"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-75', statusDotClass)} />
                <span className={cn('relative inline-flex rounded-full h-2 w-2', statusDotClass.split(' ')[0])} />
              </span>
              <span className="font-semibold text-xs tracking-tight">实时系统监控</span>
            </div>

            <div className="flex items-center gap-0.5" data-no-drag>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-destructive hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors"
                onClick={onClose}
                title="关闭悬浮监控"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* 运行时间与系统负载：Windows 无 loadavg，缺真实数据的项直接不显示 */}
          {(summary.hasUptime || summary.hasLoad) && (
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground tabular-nums gap-2">
              {summary.hasUptime && (
                <span className="truncate" title={`运行时间: ${summary.uptimeStr}`}>
                  运行 {summary.uptimeStr}
                </span>
              )}
              {summary.hasLoad && (
                <span className="shrink-0" title={`系统负载: ${summary.loadStr}`}>
                  负载 {summary.loadStr}
                </span>
              )}
            </div>
          )}
        </div>

        {/* 2. 核心指标进度条 (CPU / 内存 / 交换 - FinalShell 经典条状) */}
        <div className="flex flex-col gap-1.5 font-mono text-[11px]">
          {/* CPU 进度条 */}
          <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-muted-foreground font-sans text-xs">CPU</span>
            <div className="relative flex-1 h-5 bg-black/[0.04] dark:bg-white/[0.06] rounded-md border border-black/5 dark:border-white/[0.08] overflow-hidden flex items-center px-1.5 backdrop-blur-xs">
              <div
                className={cn('absolute left-0 top-0 bottom-0 opacity-40 transition-all duration-300', getProgressColor(summary.cpuUsage))}
                style={{ width: `${summary.cpuUsage}%` }}
              />
              <span className={cn('relative z-10 font-medium tabular-nums', getTextColor(summary.cpuUsage))}>
                {summary.cpuUsage.toFixed(0)}%
              </span>
            </div>
          </div>

          {/* 内存 进度条 */}
          <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-muted-foreground font-sans text-xs">内存</span>
            <div className="relative flex-1 h-5 bg-black/[0.04] dark:bg-white/[0.06] rounded-md border border-black/5 dark:border-white/[0.08] overflow-hidden flex items-center justify-between px-1.5 backdrop-blur-xs">
              <div
                className={cn('absolute left-0 top-0 bottom-0 opacity-40 transition-all duration-300', getProgressColor(summary.memPercent))}
                style={{ width: `${summary.memPercent}%` }}
              />
              <span className={cn('relative z-10 font-medium tabular-nums', getTextColor(summary.memPercent))}>
                {summary.memPercent}%
              </span>
              <span className="relative z-10 text-[10px] text-muted-foreground tabular-nums">
                {summary.memUsed.toFixed(1)}G/{summary.memTotal.toFixed(1)}G
              </span>
            </div>
          </div>

          {/* 交换 进度条：Windows 页面文件无真实值时不展示，不显示 0/0 */}
          <div className="flex items-center gap-2" style={{ display: summary.hasSwap ? undefined : 'none' }}>
            <span className="w-8 shrink-0 text-muted-foreground font-sans text-xs">交换</span>
            <div className="relative flex-1 h-5 bg-black/[0.04] dark:bg-white/[0.06] rounded-md border border-black/5 dark:border-white/[0.08] overflow-hidden flex items-center justify-between px-1.5 backdrop-blur-xs">
              <div
                className={cn('absolute left-0 top-0 bottom-0 opacity-40 transition-all duration-300', getProgressColor(summary.swapPercent))}
                style={{ width: `${summary.swapPercent}%` }}
              />
              <span className="relative z-10 font-medium tabular-nums text-muted-foreground">
                {summary.swapPercent}%
              </span>
              <span className="relative z-10 text-[10px] text-muted-foreground tabular-nums">
                {summary.swapTotal > 0 ? `${summary.swapUsed.toFixed(1)}G/${summary.swapTotal.toFixed(1)}G` : '0/0'}
              </span>
            </div>
          </div>
        </div>

        {/* 3. 实时进程排行：无进程数据时整块隐藏，不再永久显示"加载进程列表中..." */}
        <div
          className="border border-black/5 dark:border-white/10 rounded-xl overflow-hidden bg-black/[0.02] dark:bg-white/[0.03] backdrop-blur-md"
          style={{ display: displayProcesses.length > 0 ? undefined : 'none' }}
        >
          {/* 表头与排序切换 */}
          <div className="grid grid-cols-[66px_50px_1fr] bg-black/[0.03] dark:bg-white/[0.05] text-[10px] font-medium text-center border-b border-black/5 dark:border-white/10">
            <button
              type="button"
              onClick={() => setProcSort('memory')}
              className={cn(
                'py-1 transition-colors hover:text-foreground',
                procSort === 'memory' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground',
              )}
            >
              内存
            </button>
            <button
              type="button"
              onClick={() => setProcSort('cpu')}
              className={cn(
                'py-1 transition-colors hover:text-foreground border-l border-black/5 dark:border-white/10',
                procSort === 'cpu' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground',
              )}
            >
              CPU
            </button>
            <div className="py-1 text-left pl-2 text-muted-foreground border-l border-black/5 dark:border-white/10 font-sans">
              命令
            </div>
          </div>

          {/* 进程行列表 */}
          <div className="divide-y divide-black/5 dark:divide-white/[0.06] text-[11px] font-mono">
            {displayProcesses.length === 0 ? (
              <div className="py-3 text-center text-muted-foreground/60 text-[10px]">
                加载进程列表中...
              </div>
            ) : (
              displayProcesses.map((p) => (
                <div
                  key={p.pid}
                  className="grid grid-cols-[66px_50px_1fr] items-center hover:bg-muted/30 py-0.5 px-0.5 text-center"
                  title={`PID ${p.pid} | CPU: ${safeFixed(p.cpu, 1)}% | MEM: ${formatProcMem(p)}\n命令: ${p.command}`}
                >
                  <span className={cn('tabular-nums truncate', procSort === 'memory' && 'text-primary font-medium')}>
                    {formatProcMem(p)}
                  </span>
                  <span className={cn('tabular-nums truncate border-l border-border/20', procSort === 'cpu' && 'text-primary font-medium')}>
                    {summary.processCpuAvailable ? `${safeFixed(p.cpu, 1)}%` : '-'}
                  </span>
                  <span className="text-left pl-2 truncate font-sans text-foreground/90 border-l border-border/20">
                    {getShortCommand(p.command)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 4. 网络速率与实时波形：无网卡采样数据时整块隐藏，不显示 0 B/s */}
        <div className={cn(
          "border border-black/5 dark:border-white/10 rounded-xl p-1.5 bg-black/[0.02] dark:bg-white/[0.03] flex flex-col gap-1",
          ifaceMenuOpen ? "relative z-30" : "relative z-10",
        )} style={{ display: summary.hasNetwork ? undefined : 'none' }}>
          <div className="flex items-center justify-between text-[10px] font-mono leading-none">
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-0.5 text-orange-500 font-medium">
                <ArrowUp className="h-2.5 w-2.5" />
                {formatNetRate(hoveredNet ? hoveredNet.txKbps : summary.txKbps)}
              </span>
              <span className="flex items-center gap-0.5 text-emerald-500 font-medium">
                <ArrowDown className="h-2.5 w-2.5" />
                {formatNetRate(hoveredNet ? hoveredNet.rxKbps : summary.rxKbps)}
              </span>
              {hoveredNet && (
                <span className="text-[9px] text-muted-foreground/75 font-sans select-none animate-in fade-in-0">
                  (采样点)
                </span>
              )}
            </div>

            {/* 网卡选择下拉菜单 (FinalShell 样式: eth0 ▼, 更加小巧精致) */}
            <div className="relative z-30" data-no-drag>
              <button
                type="button"
                onClick={() => setIfaceMenuOpen((v) => !v)}
                className="flex items-center gap-0.5 text-[9.5px] font-mono bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-foreground border border-black/10 dark:border-white/15 rounded px-1.5 py-0.5 h-4.5 transition-colors cursor-pointer select-none"
                title="点击切换网卡"
              >
                <span className="truncate max-w-[65px]">
                  {selectedIface === 'all' ? '全部' : selectedIface}
                </span>
                <ChevronDown className={cn("h-2.5 w-2.5 text-muted-foreground transition-transform duration-150", ifaceMenuOpen && "rotate-180")} />
              </button>

              {/* 悬浮网卡切换菜单 (eth 置顶且固定不晃动) */}
              {ifaceMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIfaceMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[170px] max-w-[230px] max-h-60 overflow-y-auto bg-white dark:bg-zinc-950 border border-slate-200/90 dark:border-white/15 rounded-xl shadow-[0_16px_40px_-6px_rgba(0,0,0,0.3),0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[0_20px_50px_-8px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.1)] p-1 text-xs animate-in fade-in-0 zoom-in-95 origin-top-right select-none">
                    <div className="px-2 py-1 text-[10px] font-medium text-slate-500 dark:text-slate-400 border-b border-black/5 dark:border-white/10 mb-1 flex items-center justify-between sticky top-0 bg-white dark:bg-zinc-950 z-10">
                      <span>选择监控网卡</span>
                      <span className="text-[9px] opacity-70">共 {sortedNetwork.length} 个</span>
                    </div>

                    {/* 全部选项 */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedIface('all')
                        setIfaceMenuOpen(false)
                        try { localStorage.setItem('qshell_floating_hud_iface', 'all') } catch { /* ignore */ }
                      }}
                      className={cn(
                        'w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[11px] font-mono text-left transition-all active:scale-[0.98] cursor-pointer',
                        selectedIface === 'all'
                          ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                          : 'hover:bg-slate-100 dark:hover:bg-white/10 text-slate-800 dark:text-slate-200',
                      )}
                    >
                      <span>全部 (总流量)</span>
                      {selectedIface === 'all' && <Check className="h-3 w-3 shrink-0" />}
                    </button>

                    {/* 单网卡列表 (eth 开头固定在最前面，右侧速率固定宽度不抖动) */}
                    {sortedNetwork.map((n) => (
                      <button
                        key={n.interface}
                        type="button"
                        onClick={() => {
                          setSelectedIface(n.interface)
                          setIfaceMenuOpen(false)
                          try { localStorage.setItem('qshell_floating_hud_iface', n.interface) } catch { /* ignore */ }
                        }}
                        className={cn(
                          'w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-[11px] font-mono text-left transition-all active:scale-[0.98] cursor-pointer',
                          selectedIface === n.interface
                            ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                            : 'hover:bg-slate-100 dark:hover:bg-white/10 text-slate-800 dark:text-slate-200',
                        )}
                      >
                        <span className="truncate">{n.interface}</span>
                        <div className="flex items-center gap-1.5 ml-2 shrink-0">
                          <span className={cn('text-[9px] w-14 text-right tabular-nums', selectedIface === n.interface ? 'text-primary-foreground/80' : 'text-slate-500 dark:text-slate-400')}>
                            ↓{formatNetRate(n.rxKbps)}
                          </span>
                          {selectedIface === n.interface && <Check className="h-3 w-3 shrink-0" />}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* SVG 实时波形图 (鼠标悬停显示精确上下行点位速率) */}
          {sparklineSvg ? (
            <div
              className="w-full h-9 rounded bg-muted/30 border border-border/30 overflow-hidden relative cursor-crosshair select-none"
              onPointerMove={(e) => {
                if (!sparklineSvg || sparklineSvg.points.length < 2) return
                const rect = e.currentTarget.getBoundingClientRect()
                if (rect.width <= 0) return
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                const pts = sparklineSvg.points
                const index = Math.min(pts.length - 1, Math.max(0, Math.round(ratio * (pts.length - 1))))
                const pt = pts[index]
                const x = (index / (pts.length - 1)) * sparklineSvg.width
                setHoveredNet({
                  rxKbps: pt.rxKbps,
                  txKbps: pt.txKbps,
                  x,
                  percent: ratio * 100,
                })
              }}
              onPointerLeave={() => {
                setHoveredNet(null)
              }}
            >
              <svg
                viewBox={`0 0 ${sparklineSvg.width} ${sparklineSvg.height}`}
                className="w-full h-full preserve-3d pointer-events-none"
                preserveAspectRatio="none"
              >
                <path d={sparklineSvg.rxAreaD} fill="rgba(16, 185, 129, 0.15)" />
                <path d={sparklineSvg.rxD} fill="none" stroke="#10b981" strokeWidth="1.2" />
                <path d={sparklineSvg.txD} fill="none" stroke="#f97316" strokeWidth="1.2" />

                {/* 鼠标悬停位置垂直虚线与数据节点 */}
                {hoveredNet && (
                  <>
                    <line
                      x1={hoveredNet.x}
                      y1="0"
                      x2={hoveredNet.x}
                      y2={sparklineSvg.height}
                      stroke="currentColor"
                      strokeWidth="1"
                      strokeDasharray="2,2"
                      className="text-foreground/40"
                    />
                    <circle
                      cx={hoveredNet.x}
                      cy={sparklineSvg.height - (Math.min(sparklineSvg.maxVal, hoveredNet.rxKbps) / sparklineSvg.maxVal) * (sparklineSvg.height - 4)}
                      r="2.5"
                      fill="#10b981"
                      stroke="white"
                      strokeWidth="0.8"
                    />
                    <circle
                      cx={hoveredNet.x}
                      cy={sparklineSvg.height - (Math.min(sparklineSvg.maxVal, hoveredNet.txKbps) / sparklineSvg.maxVal) * (sparklineSvg.height - 4)}
                      r="2.5"
                      fill="#f97316"
                      stroke="white"
                      strokeWidth="0.8"
                    />
                  </>
                )}
              </svg>

              {/* 悬停浮层气泡 (精巧透明 HUD 标度提示) */}
              {hoveredNet && (
                <div
                  className="pointer-events-none absolute top-1 z-20 -translate-x-1/2 flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-zinc-950/90 dark:bg-zinc-900/95 text-white text-[9px] font-mono shadow-md border border-white/10 backdrop-blur-sm whitespace-nowrap animate-in fade-in-0 zoom-in-95"
                  style={{
                    left: `${Math.max(22, Math.min(78, hoveredNet.percent))}%`,
                  }}
                >
                  <span className="text-orange-400">↑ {formatNetRate(hoveredNet.txKbps)}</span>
                  <span className="text-zinc-500">|</span>
                  <span className="text-emerald-400">↓ {formatNetRate(hoveredNet.rxKbps)}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="h-9 rounded bg-muted/20 border border-border/30 flex items-center justify-center text-[10px] text-muted-foreground/60">
              等待下一轮网络采样
            </div>
          )}
        </div>

        {/* 5. 完整磁盘分区列表：无真实分区数据时整块隐藏 */}
        <div
          className="border border-black/5 dark:border-white/10 rounded-xl overflow-hidden bg-black/[0.02] dark:bg-white/[0.03] relative z-0"
          style={{ display: summary.hasDisks ? undefined : 'none' }}
        >
          <div className="grid grid-cols-[1fr_96px] bg-black/[0.03] dark:bg-white/[0.05] text-[10px] font-medium text-center border-b border-black/5 dark:border-white/10 py-1 px-2 text-muted-foreground font-sans">
            <span className="text-left">路径</span>
            <span className="text-right">可用/大小</span>
          </div>

          <div className="divide-y divide-black/5 dark:divide-white/[0.06] font-mono text-[11px] max-h-36 overflow-y-auto">
            {summary.disks.length === 0 ? (
              <div className="py-2 text-center text-muted-foreground/60 text-[10px]">
                无磁盘挂载信息
              </div>
            ) : (
              summary.disks.map((d) => (
                <div
                  key={d.mountPoint}
                  className="relative grid grid-cols-[1fr_96px] items-center px-2 py-1 hover:bg-muted/30 text-xs overflow-hidden"
                >
                  {/* 背景占用率微量填充条 */}
                  <div
                    className={cn('absolute left-0 top-0 bottom-0 opacity-15 pointer-events-none', getProgressColor(d.usePercent))}
                    style={{ width: `${d.usePercent}%` }}
                  />

                  <span className="relative z-10 truncate font-sans text-[11px]" title={`${d.filesystem} -> ${d.mountPoint}`}>
                    {d.mountPoint}
                  </span>
                  <span className="relative z-10 text-right tabular-nums text-[10px] text-muted-foreground">
                    {formatDiskSize(d.available)}/{formatDiskSize(d.total)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 6. 底部操作栏 */}
        <div className="flex items-center justify-between pt-1 border-t border-black/5 dark:border-white/10 text-[10px] relative z-0">
          <Button
            variant="link"
            size="sm"
            onClick={onOpenFullOverview}
            className="h-auto p-0 text-[11px] text-primary hover:underline flex items-center gap-1 font-medium"
          >
            <span>更多监控指标 (图表/进程/IO)</span>
            <ExternalLink className="h-3 w-3" />
          </Button>
          <span className="text-muted-foreground/60">实时刷新</span>
        </div>
      </div>
    </div>
  )
}

// ==================== 2. 底栏常驻性能监控触发胶囊 ====================
export function StatusBarMetricsPill({
  serverId,
  isConnected,
}: {
  serverId: string
  isConnected: boolean
}) {
  const [isHudOpen, setIsHudOpen] = useState(false)

  // 监听工作台内悬浮监控卡片的可见性状态
  useEffect(() => {
    const onVisChanged = (e: Event) => {
      const ce = e as CustomEvent<{ visible: boolean; serverId?: string }>
      if (!ce.detail?.serverId || ce.detail.serverId === serverId) {
        setIsHudOpen(Boolean(ce.detail?.visible))
      }
    }
    window.addEventListener('metrics-hud-visibility-changed', onVisChanged)
    return () => window.removeEventListener('metrics-hud-visibility-changed', onVisChanged)
  }, [serverId])

  // 订阅共享监控 Store（底栏常驻使用 idle 速度，不消耗额外高频资源）
  useMetricsSubscription(serverId, isConnected, 'idle')

  const serverState = useMetricsStore((s) => s.serverStates[serverId])
  const metrics = serverState?.metrics

  const summary = useMemo(() => {
    if (!metrics) return { cpu: 0, ram: 0, rxKbps: 0, txKbps: 0, level: 'normal' as 'normal' | 'warning' | 'critical' }
    const cpu = Math.min(100, Math.max(0, metrics.cpuUsage || 0))
    const memTotal = metrics.memoryTotal || 0
    const memUsed = metrics.memoryUsed || 0
    const ram = memTotal > 0 ? Math.min(100, Math.round((memUsed / memTotal) * 100)) : 0
    let rxKbps = 0
    let txKbps = 0
    metrics.network?.forEach((n) => {
      rxKbps += n.rxKbps
      txKbps += n.txKbps
    })
    let level: 'normal' | 'warning' | 'critical' = 'normal'
    if (cpu >= 85 || ram >= 85) level = 'critical'
    else if (cpu >= 70 || ram >= 70) level = 'warning'
    return { cpu, ram, rxKbps, txKbps, level }
  }, [metrics])

  // 采集失败/主机不支持时不显示底栏假 0 值，也不提供打开空卡片的入口
  if (!metrics || metrics.metricsAvailable === false) return null
  const hasNetwork = (metrics.network?.length ?? 0) > 0

  const statusDotClass =
    summary.level === 'critical'
      ? 'bg-destructive animate-ping'
      : summary.level === 'warning'
        ? 'bg-amber-500'
        : 'bg-emerald-500'

  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(new CustomEvent('toggle-metrics-hud'))
      }}
      className={cn(
        'flex items-center gap-1.5 px-2 py-0.5 rounded font-mono tabular-nums transition-all active:scale-95 cursor-pointer border select-none h-5 text-[10px]',
        'bg-muted/40 hover:bg-muted text-foreground',
        isHudOpen ? 'border-primary/50' : 'border-border/40 hover:border-border',
      )}
      title={isHudOpen ? '点击收起实时系统监控卡片' : '点击打开实时系统监控卡片'}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-75', statusDotClass)} />
        <span className={cn('relative inline-flex rounded-full h-1.5 w-1.5', statusDotClass.split(' ')[0])} />
      </span>
      {/* CPU */}
      <span className="inline-flex items-center gap-1 shrink-0">
        <span className="text-[9px] font-sans font-medium text-muted-foreground/70">CPU</span>
        <span className={cn('inline-block w-[28px] text-right font-mono font-semibold tabular-nums', getTextColor(summary.cpu))}>
          {summary.cpu.toFixed(0)}%
        </span>
      </span>

      <div className="h-2.5 w-px bg-border/60 shrink-0" />

      {/* RAM */}
      <span className="inline-flex items-center gap-1 shrink-0">
        <span className="text-[9px] font-sans font-medium text-muted-foreground/70">RAM</span>
        <span className={cn('inline-block w-[28px] text-right font-mono font-semibold tabular-nums', getTextColor(summary.ram))}>
          {summary.ram}%
        </span>
      </span>

      {/* 网络速率 */}
      {hasNetwork && (
        <>
          <div className="h-2.5 w-px bg-border/60 shrink-0" />
          <span className="hidden sm:inline-flex items-center gap-2 text-[9.5px] shrink-0">
            <span className="inline-flex items-center gap-0.5 text-emerald-500 font-mono">
              <span className="text-[10px] leading-none">↓</span>
              <span className="inline-block w-[44px] text-right tabular-nums truncate">
                {formatNetRate(summary.rxKbps)}
              </span>
            </span>
            <span className="inline-flex items-center gap-0.5 text-orange-500 font-mono">
              <span className="text-[10px] leading-none">↑</span>
              <span className="inline-block w-[44px] text-right tabular-nums truncate">
                {formatNetRate(summary.txKbps)}
              </span>
            </span>
          </span>
        </>
      )}
    </button>
  )
}
