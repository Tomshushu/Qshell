import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  useMetricsStore,
  registerMetricsSubscriber,
  unregisterMetricsSubscriber,
  MAX_CPU_HISTORY,
  MAX_NET_HISTORY,
  MAX_DISK_IO_HISTORY,
} from '../metrics-store'
import { sshService } from '@/services/ssh-service'
import type { SystemMetrics } from '@/types'

vi.mock('@/services/ssh-service', () => ({
  sshService: {
    collectMetrics: vi.fn(),
  },
}))

describe('useMetricsStore', () => {
  const mockServerId = 'server-test-1'

  const mockMetrics: SystemMetrics = {
    cpuUsage: 45.5,
    cpuUsr: 20,
    cpuSys: 20,
    cpuIowait: 5,
    cpuSteal: 0.5,
    cpuIdle: 54.5,
    cpuLoad: [1.2, 0.8, 0.5],
    memoryTotal: 16,
    memoryUsed: 8,
    memPressure: 0.5,
    memAvailableBytes: 8589934592,
    memBreakdown: {
      used: 6,
      systemReserved: 1,
      buffers: 0.5,
      cache: 0.5,
      free: 8,
    },
    memRawKb: {
      total: 16777216,
      free: 8388608,
      buffers: 524288,
      cached: 524288,
      available: 8388608,
      sreclaimable: 0,
      shared: 0,
    },
    swapTotal: 4,
    swapUsed: 1,
    uptime: 12345,
    osName: 'Linux',
    kernelVersion: '5.15.0',
    tcpRetransRate: 0,
    totalProcesses: 100,
    zombieProcesses: 0,
    network: [
      {
        interface: 'eth0',
        rxKbps: 1024,
        txKbps: 512,
        rxPackets: 100,
        txPackets: 100,
        rxErrors: 0,
        txErrors: 0,
        rxDrop: 0,
        txDrop: 0,
        dropRate: 0,
      },
      {
        interface: 'lo',
        rxKbps: 0,
        txKbps: 0,
        rxPackets: 10,
        txPackets: 10,
        rxErrors: 0,
        txErrors: 0,
        rxDrop: 0,
        txDrop: 0,
        dropRate: 0,
      },
    ],
    disks: [
      {
        filesystem: '/dev/sda1',
        mountPoint: '/',
        total: 100,
        used: 40,
        available: 60,
        usePercent: 40,
        category: 'disk',
      },
    ],
    diskIo: [
      {
        device: 'sda',
        readIops: 80,
        writeIops: 40,
        readMbps: 12.5,
        writeMbps: 4.5,
        readKbps: 12500,
        writeKbps: 4500,
        await: 1.2,
        iowait: 0.5,
        util: 0.15,
      },
    ],
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    useMetricsStore.getState().clearServerMetrics(mockServerId)
    // Clean up any remaining subscribers
    unregisterMetricsSubscriber(mockServerId, 'sub-test-all')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initializes with default empty state', () => {
    const state = useMetricsStore.getState().getServerState(mockServerId)
    expect(state.metrics).toBeNull()
    expect(state.cpuHistory).toEqual([])
    expect(state.netHistoryByIface).toEqual({})
    expect(state.diskIoHistory).toEqual([])
    expect(state.error).toBeNull()
  })

  it('refreshes metrics successfully and accumulates ring buffers', async () => {
    vi.mocked(sshService.collectMetrics).mockResolvedValueOnce(mockMetrics)

    const res = await useMetricsStore.getState().refreshServerMetrics(mockServerId)
    expect(res).toEqual(mockMetrics)

    const state = useMetricsStore.getState().getServerState(mockServerId)
    expect(state.metrics).toEqual(mockMetrics)
    expect(state.cpuHistory).toEqual([45.5])
    expect(state.netHistoryByIface['eth0']).toEqual([{ rxKbps: 1024, txKbps: 512 }])
    expect(state.netHistoryByIface['lo']).toEqual([{ rxKbps: 0, txKbps: 0 }])
    expect(state.diskIoHistory.length).toBe(1)
    expect(state.diskIoHistory[0]['sda:throughput']).toBe(17) // 12.5 + 4.5
    expect(state.diskIoHistory[0]['sda:util']).toBe(15) // 0.15 * 100
    expect(state.error).toBeNull()
    expect(state.lastUpdatedAt).toBeGreaterThan(0)
  })

  it('caps history buffers at defined maximum limits', async () => {
    // Run multiple refreshes
    for (let i = 0; i < MAX_CPU_HISTORY + 10; i++) {
      vi.mocked(sshService.collectMetrics).mockResolvedValueOnce({
        ...mockMetrics,
        cpuUsage: i,
      })
      await useMetricsStore.getState().refreshServerMetrics(mockServerId)
    }

    const state = useMetricsStore.getState().getServerState(mockServerId)
    expect(state.cpuHistory.length).toBe(MAX_CPU_HISTORY)
    expect(state.cpuHistory[state.cpuHistory.length - 1]).toBe(MAX_CPU_HISTORY + 9)
    expect(state.netHistoryByIface['eth0'].length).toBe(MAX_NET_HISTORY)
    expect(state.diskIoHistory.length).toBe(MAX_DISK_IO_HISTORY)
  })

  it('locks in-flight requests to prevent duplicate concurrent calls', async () => {
    let resolver: (v: SystemMetrics) => void = () => {}
    const slowPromise = new Promise<SystemMetrics>((resolve) => {
      resolver = resolve
    })

    vi.mocked(sshService.collectMetrics).mockReturnValueOnce(slowPromise)

    const p1 = useMetricsStore.getState().refreshServerMetrics(mockServerId)
    // p2 is called while p1 is still in flight
    const p2 = useMetricsStore.getState().refreshServerMetrics(mockServerId)

    const res2 = await p2
    expect(res2).toBeNull() // Skipped because in-flight
    expect(sshService.collectMetrics).toHaveBeenCalledTimes(1)

    resolver(mockMetrics)
    const res1 = await p1
    expect(res1).toEqual(mockMetrics)
  })

  it('handles error gracefully and sets error state', async () => {
    vi.mocked(sshService.collectMetrics).mockRejectedValueOnce(new Error('SSH channel closed'))

    const res = await useMetricsStore.getState().refreshServerMetrics(mockServerId)
    expect(res).toBeNull()

    const state = useMetricsStore.getState().getServerState(mockServerId)
    expect(state.error).toBe('SSH channel closed')
  })

  it('coordinates subscription speeds dynamically across multiple subscribers', async () => {
    vi.mocked(sshService.collectMetrics).mockResolvedValue(mockMetrics)

    // Sub 1: idle (4000ms)
    registerMetricsSubscriber(mockServerId, 'sub-idle', 'idle')
    expect(sshService.collectMetrics).toHaveBeenCalledTimes(1) // Immediate first fetch

    // Sub 2: normal (2500ms) - should upgrade interval to 2500ms
    registerMetricsSubscriber(mockServerId, 'sub-normal', 'normal')

    // Advance 2500ms
    await vi.advanceTimersByTimeAsync(2500)
    expect(sshService.collectMetrics).toHaveBeenCalledTimes(2)

    // Sub 3: high (1000ms) - should upgrade interval to 1000ms
    registerMetricsSubscriber(mockServerId, 'sub-high', 'high')

    await vi.advanceTimersByTimeAsync(1000)
    expect(sshService.collectMetrics).toHaveBeenCalledTimes(3)

    // Unregister high: should drop back to normal (2500ms)
    unregisterMetricsSubscriber(mockServerId, 'sub-high')

    // 1000ms should NOT trigger now
    await vi.advanceTimersByTimeAsync(1000)
    expect(sshService.collectMetrics).toHaveBeenCalledTimes(3)

    // After 1500ms more (total 2500ms), triggers again
    await vi.advanceTimersByTimeAsync(1500)
    expect(sshService.collectMetrics).toHaveBeenCalledTimes(4)

    // Unregister all
    unregisterMetricsSubscriber(mockServerId, 'sub-normal')
    unregisterMetricsSubscriber(mockServerId, 'sub-idle')

    // After timer expires, no more fetches
    await vi.advanceTimersByTimeAsync(10000)
    expect(sshService.collectMetrics).toHaveBeenCalledTimes(4)
  })
})
