import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { FloatingMetricsHud, StatusBarMetricsPill } from '../floating-metrics-hud'
import { sshService } from '@/services/ssh-service'
import { useMetricsStore } from '@/store/metrics-store'
import type { SystemMetrics, ProcessInfo } from '@/types'

const mockMetrics: SystemMetrics = {
  cpuUsage: 35.5,
  cpuUsr: 20,
  cpuSys: 15,
  cpuIowait: 0.5,
  cpuSteal: 0,
  cpuIdle: 64.5,
  cpuLoad: [1.2, 0.85, 0.64],
  memoryUsed: 3.5,
  memoryTotal: 8.0,
  memPressure: 0.43,
  memAvailableBytes: 4.5 * 1024 * 1024 * 1024,
  memBreakdown: {
    used: 3.5,
    systemReserved: 0.5,
    buffers: 0.2,
    cache: 1.8,
    free: 2.0,
  },
  memRawKb: {
    total: 8000000,
    free: 2000000,
    buffers: 200000,
    cached: 1800000,
    available: 4500000,
    sreclaimable: 100000,
    shared: 50000,
  },
  swapUsed: 0.2,
  swapTotal: 2.0,
  disks: [
    {
      filesystem: '/dev/vda1',
      mountPoint: '/',
      used: 45,
      total: 100,
      usePercent: 45,
      available: 55,
      category: 'disk',
    },
    {
      filesystem: 'tmpfs',
      mountPoint: '/run',
      used: 0.001,
      total: 0.356,
      usePercent: 1,
      available: 0.355,
      category: 'tmpfs',
    },
    {
      filesystem: 'tmpfs',
      mountPoint: '/dev/shm',
      used: 0,
      total: 1.8,
      usePercent: 0,
      available: 1.8,
      category: 'tmpfs',
    },
  ],
  diskIo: [],
  network: [
    {
      interface: 'docker0',
      rxPackets: 200,
      txPackets: 100,
      rxErrors: 0,
      txErrors: 0,
      rxDrop: 0,
      txDrop: 0,
      dropRate: 0,
      rxKbps: 10,
      txKbps: 5,
    },
    {
      interface: 'ens33',
      rxPackets: 400,
      txPackets: 300,
      rxErrors: 0,
      txErrors: 0,
      rxDrop: 0,
      txDrop: 0,
      dropRate: 0,
      rxKbps: 500,
      txKbps: 200,
    },
    {
      interface: 'eth0',
      rxPackets: 1000,
      txPackets: 500,
      rxErrors: 0,
      txErrors: 0,
      rxDrop: 0,
      txDrop: 0,
      dropRate: 0,
      rxKbps: 8000,
      txKbps: 400,
    },
    {
      interface: 'eth1',
      rxPackets: 800,
      txPackets: 400,
      rxErrors: 0,
      txErrors: 0,
      rxDrop: 0,
      txDrop: 0,
      dropRate: 0,
      rxKbps: 1200,
      txKbps: 300,
    },
  ],
  tcpRetransRate: 0,
  uptime: 347 * 86400,
  osName: 'Ubuntu 22.04',
  kernelVersion: '5.15.0',
  totalProcesses: 120,
  zombieProcesses: 0,
}

const mockProcesses: ProcessInfo[] = [
  {
    pid: 101,
    ppid: 1,
    user: 'root',
    cpu: 1.3,
    memory: 0.8,
    vsz: 50000,
    rss: 27900,
    stat: 'S',
    nice: 0,
    startTimeTicks: 100,
    start: '00:00',
    cgroup: '',
    command: '/usr/local/bin/redis-server *:6379',
  },
  {
    pid: 102,
    ppid: 1,
    user: 'java',
    cpu: 1.0,
    memory: 12.5,
    vsz: 800000,
    rss: 458100,
    stat: 'S',
    nice: 0,
    startTimeTicks: 100,
    start: '00:00',
    cgroup: '',
    command: 'java -jar app.jar',
  },
]

describe('FloatingMetricsHud', () => {
  beforeEach(() => {
    localStorage.clear()
    useMetricsStore.getState().clearServerMetrics('srv-1')
    vi.spyOn(sshService, 'collectMetrics').mockResolvedValue(mockMetrics)
    vi.spyOn(sshService, 'listProcesses').mockResolvedValue(mockProcesses)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders nothing when not connected or invisible', () => {
    const { container: c1 } = render(
      <FloatingMetricsHud
        serverId="srv-1"
        isConnected={false}
        visible={true}
        onClose={vi.fn()}
        onOpenFullOverview={vi.fn()}
      />,
    )
    expect(c1.firstChild).toBeNull()

    const { container: c2 } = render(
      <FloatingMetricsHud
        serverId="srv-1"
        isConnected={true}
        visible={false}
        onClose={vi.fn()}
        onOpenFullOverview={vi.fn()}
      />,
    )
    expect(c2.firstChild).toBeNull()
  })

  it('renders full monitoring card with uptime/load on single line, process %, and disks', async () => {
    useMetricsStore.setState((state) => ({
      serverStates: {
        ...state.serverStates,
        'srv-1': {
          ...(state.serverStates['srv-1'] || {
            metrics: null,
            topProcesses: [],
            netHistoryByIface: {},
            diskIoHistory: [],
            lastUpdatedAt: null,
            loading: false,
            error: null,
          }),
          metrics: mockMetrics,
          topProcesses: mockProcesses,
        },
      },
    }))

    const onClose = vi.fn()
    const onOpenFullOverview = vi.fn()

    await act(async () => {
      render(
        <FloatingMetricsHud
          serverId="srv-1"
          isConnected={true}
          visible={true}
          onClose={onClose}
          onOpenFullOverview={onOpenFullOverview}
        />,
      )
    })

    // 1. 标题与状态点
    expect(screen.getByText('实时系统监控')).toBeInTheDocument()

    // 2. 运行时间与负载（单行排布）
    expect(screen.getByText(/运行\s*347\s*天/)).toBeInTheDocument()
    expect(screen.getByText(/负载\s*1\.20,\s*0\.85,\s*0\.64/)).toBeInTheDocument()

    // 3. 核心指标进度条与文本
    expect(screen.getByText(/36%/)).toBeInTheDocument()
    expect(screen.getByText(/44%/)).toBeInTheDocument()
    expect(screen.getByText(/3\.5G\/8\.0G/)).toBeInTheDocument()

    // 4. 进程排行表头与数据
    expect(screen.getAllByText('内存').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('CPU').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('命令')).toBeInTheDocument()
    expect(screen.getByText('redis-server')).toBeInTheDocument()
    expect(screen.getByText('java')).toBeInTheDocument()

    // 5. 磁盘分区列表
    expect(screen.getByText('/')).toBeInTheDocument()
    expect(screen.getByText('/run')).toBeInTheDocument()
    expect(screen.getByText('/dev/shm')).toBeInTheDocument()

    // 6. 底部操作栏与关闭按钮
    const overviewLink = screen.getByText(/更多监控指标/)
    fireEvent.click(overviewLink)
    expect(onOpenFullOverview).toHaveBeenCalledTimes(1)

    const closeBtn = screen.getByTitle('关闭悬浮监控')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('allows switching network interface via dropdown with eth0 at top', async () => {
    useMetricsStore.setState((state) => ({
      serverStates: {
        ...state.serverStates,
        'srv-1': {
          ...(state.serverStates['srv-1'] || {
            metrics: null,
            topProcesses: [],
            netHistoryByIface: {},
            diskIoHistory: [],
            lastUpdatedAt: null,
            loading: false,
            error: null,
          }),
          metrics: mockMetrics,
          topProcesses: mockProcesses,
        },
      },
    }))

    await act(async () => {
      render(
        <FloatingMetricsHud
          serverId="srv-1"
          isConnected={true}
          visible={true}
          onClose={vi.fn()}
          onOpenFullOverview={vi.fn()}
        />,
      )
    })

    const ifaceTrigger = screen.getByTitle('点击切换网卡')
    expect(ifaceTrigger).toHaveTextContent('eth0')

    // 点击打开网卡菜单
    fireEvent.click(ifaceTrigger)
    expect(screen.getByText('选择监控网卡')).toBeInTheDocument()
    expect(screen.getByText('全部 (总流量)')).toBeInTheDocument()

    // 验证下拉菜单内 eth 开头的网卡排在最前
    const menuContainer = screen.getByText('选择监控网卡').parentElement!.parentElement!
    const menuButtons = Array.from(menuContainer.querySelectorAll('button')).map((b) => b.textContent || '')
    expect(menuButtons[0]).toContain('全部 (总流量)')
    expect(menuButtons[1]).toContain('eth0')
    expect(menuButtons[2]).toContain('eth1')
    expect(menuButtons[3]).toContain('ens33')
    expect(menuButtons[4]).toContain('docker0')

    // 切换为全部
    const allOption = screen.getByRole('button', { name: /全部 \(总流量\)/ })
    fireEvent.click(allOption)
    expect(screen.queryByText('选择监控网卡')).not.toBeInTheDocument()
    expect(ifaceTrigger).toHaveTextContent('全部')
  })

  it('displays point-in-time network speed when hovering over waveform sparkline', async () => {
    useMetricsStore.setState((state) => ({
      serverStates: {
        ...state.serverStates,
        'srv-1': {
          ...(state.serverStates['srv-1'] || {
            metrics: null,
            topProcesses: [],
            netHistoryByIface: {},
            diskIoHistory: [],
            lastUpdatedAt: null,
            loading: false,
            error: null,
          }),
          metrics: mockMetrics,
          topProcesses: mockProcesses,
          netHistoryByIface: {
            eth0: [
              { rxKbps: 1000, txKbps: 200 },
              { rxKbps: 5000, txKbps: 800 },
              { rxKbps: 9000, txKbps: 1500 },
            ],
            all: [
              { rxKbps: 1000, txKbps: 200 },
              { rxKbps: 5000, txKbps: 800 },
              { rxKbps: 9000, txKbps: 1500 },
            ],
          },
        },
      },
    }))

    await act(async () => {
      render(
        <FloatingMetricsHud
          serverId="srv-1"
          isConnected={true}
          visible={true}
          onClose={vi.fn()}
          onOpenFullOverview={vi.fn()}
        />,
      )
    })

    const chart = document.querySelector('.cursor-crosshair')
    expect(chart).toBeInTheDocument()

    chart!.getBoundingClientRect = vi.fn(
      () =>
        ({
          width: 240,
          height: 36,
          top: 0,
          left: 0,
          right: 240,
          bottom: 36,
          x: 0,
          y: 0,
          toJSON: () => {},
        }) as DOMRect,
    )

    fireEvent.pointerMove(chart!, { clientX: 120, clientY: 20 })
    expect(screen.getByText('(采样点)')).toBeInTheDocument()

    fireEvent.pointerLeave(chart!)
    expect(screen.queryByText('(采样点)')).not.toBeInTheDocument()
  })

  it('smartly anchors to right edge when dragged so position stays relative to right on maximize', async () => {
    useMetricsStore.setState((state) => ({
      serverStates: {
        ...state.serverStates,
        'srv-1': {
          ...(state.serverStates['srv-1'] || {
            metrics: null,
            topProcesses: [],
            netHistoryByIface: {},
            diskIoHistory: [],
            lastUpdatedAt: null,
            loading: false,
            error: null,
          }),
          metrics: mockMetrics,
          topProcesses: mockProcesses,
        },
      },
    }))

    const { container } = render(
      <div style={{ width: 1000, height: 800, position: 'relative' }}>
        <FloatingMetricsHud
          serverId="srv-1"
          isConnected={true}
          visible={true}
          onClose={vi.fn()}
          onOpenFullOverview={vi.fn()}
        />
      </div>,
    )

    const hudCard = container.querySelector('.rounded-xl.border') as HTMLDivElement
    expect(hudCard).toBeInTheDocument()

    // 默认未拖拽时：右侧固定 16px，顶部 12px
    expect(hudCard.style.right).toBe('16px')
    expect(hudCard.style.top).toBe('12px')

    // 模拟 mock getBoundingClientRect
    const parentEl = hudCard.parentElement!
    parentEl.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 800,
      right: 1000,
      bottom: 800,
      x: 0,
      y: 0,
      toJSON: () => {},
    }) as DOMRect)

    hudCard.getBoundingClientRect = vi.fn(() => ({
      left: 664,
      top: 12,
      width: 320,
      height: 400,
      right: 984,
      bottom: 412,
      x: 664,
      y: 12,
      toJSON: () => {},
    }) as DOMRect)

    hudCard.setPointerCapture = vi.fn()
    hudCard.releasePointerCapture = vi.fn()

    // 拖动到靠右侧位置 (newX = 660, offsetRight = 1000 - 660 - 320 = 20px)
    fireEvent.pointerDown(hudCard, { clientX: 700, clientY: 20, pointerId: 1 })
    fireEvent.pointerMove(hudCard, { clientX: 696, clientY: 28, pointerId: 1 })
    fireEvent.pointerUp(hudCard, { pointerId: 1 })

    // 验证保存为锚定到 right 边缘，而非绝对 left
    const saved = JSON.parse(localStorage.getItem('qshell_floating_hud_pos_v3') || '{}')
    expect(saved.anchorX).toBe('right')
    expect(saved.offsetRight).toBeDefined()
    expect(hudCard.style.right).toBe(`${saved.offsetRight}px`)

    // 双击标题栏可重置回右上角默认位置
    const titleBar = hudCard.querySelector('.cursor-grab') as HTMLDivElement
    fireEvent.doubleClick(titleBar)
    expect(localStorage.getItem('qshell_floating_hud_pos_v3')).toBeNull()
    expect(hudCard.style.right).toBe('16px')
    expect(hudCard.style.top).toBe('12px')
  })

  it('renders with Apple Liquid Glass frosted styling without opacity setting controls', async () => {
    useMetricsStore.setState((state) => ({
      serverStates: {
        ...state.serverStates,
        'srv-1': {
          ...(state.serverStates['srv-1'] || {
            metrics: null,
            topProcesses: [],
            netHistoryByIface: {},
            diskIoHistory: [],
            lastUpdatedAt: null,
            loading: false,
            error: null,
          }),
          metrics: mockMetrics,
          topProcesses: mockProcesses,
        },
      },
    }))

    const { container } = render(
      <FloatingMetricsHud
        serverId="srv-1"
        isConnected={true}
        visible={true}
        onClose={vi.fn()}
        onOpenFullOverview={vi.fn()}
      />,
    )

    const hudCard = container.querySelector('.rounded-xl.border') as HTMLDivElement
    expect(hudCard).toBeInTheDocument()

    // 采用苹果液态玻璃效果：高斯毛玻璃 + 色彩增益 + 晶透光晕
    expect(hudCard.className).toContain('backdrop-blur-2xl')
    expect(hudCard.className).toContain('backdrop-saturate-150')

    // 移除了容器层级的全局 opacity 设定（不糊文字）
    expect(hudCard.style.opacity).toBe('')

    // 移除了冗余的透明度调节按钮与设置面板
    expect(screen.queryByTitle(/卡片透明度/)).not.toBeInTheDocument()
    expect(screen.queryByText('卡片透明度')).not.toBeInTheDocument()
  })
})

describe('StatusBarMetricsPill', () => {
  beforeEach(() => {
    localStorage.clear()
    useMetricsStore.getState().clearServerMetrics('srv-1')
    useMetricsStore.setState((state) => ({
      serverStates: {
        ...state.serverStates,
        'srv-1': {
          ...(state.serverStates['srv-1'] || {
            metrics: null,
            topProcesses: [],
            netHistoryByIface: {},
            diskIoHistory: [],
            lastUpdatedAt: null,
            loading: false,
            error: null,
          }),
          metrics: mockMetrics,
          topProcesses: mockProcesses,
        },
      },
    }))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders status bar pill, dispatches toggle-metrics-hud on click, and listens to visibility changes', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')

    await act(async () => {
      render(<StatusBarMetricsPill serverId="srv-1" isConnected={true} />)
    })

    const pill = screen.getByTitle('点击打开实时系统监控卡片')
    expect(pill).toBeInTheDocument()
    expect(pill).toHaveTextContent(/CPU\s*36%/)
    expect(pill).toHaveTextContent(/RAM\s*44%/)

    // 点击底栏胶囊广播 toggle-metrics-hud
    fireEvent.click(pill)
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'toggle-metrics-hud' }),
    )

    // 当工作区通知 HUD 展开时，底栏胶囊高亮并切换 title
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('metrics-hud-visibility-changed', {
          detail: { visible: true, serverId: 'srv-1' },
        }),
      )
    })

    expect(screen.getByTitle('点击收起实时系统监控卡片')).toBeInTheDocument()
  })
})
