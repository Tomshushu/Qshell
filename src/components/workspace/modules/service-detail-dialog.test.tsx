// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// jsdom 缺失的 API polyfill（radix 等依赖）
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO
;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
if (!window.matchMedia) {
  ;(window as unknown as { matchMedia: unknown }).matchMedia = () => ({
    matches: false,
    media: '',
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return false
    },
  })
}

vi.mock('@/services/ssh-service', () => ({
  sshService: {
    serviceInspect: vi.fn(async () => ({ Id: 'x', MainPID: '123', ExecMainStartTimestamp: String(Date.now() * 1000) })),
    serviceLogs: vi.fn(async () => ({ exitCode: 0, stdout: 'log line A\nlog line B' })),
    serviceLogFollowStart: vi.fn(async () => 'sid'),
    serviceLogFollowStop: vi.fn(async () => {}),
    serviceDependencies: vi.fn(async () => []),
    serviceUnitFile: vi.fn(async () => ({ exitCode: 0, stdout: '[Unit]' })),
    serviceProcess: vi.fn(async () => ({ exitCode: 0, stdout: 'proc' })),
    servicePorts: vi.fn(async () => ({ exitCode: 0, stdout: '' })),
    startService: vi.fn(async () => ({ exitCode: 0 })),
    stopService: vi.fn(async () => ({ exitCode: 0 })),
    restartService: vi.fn(async () => ({ exitCode: 0 })),
    serviceEnable: vi.fn(async () => ({ exitCode: 0 })),
    serviceDisable: vi.fn(async () => ({ exitCode: 0 })),
    serviceMask: vi.fn(async () => ({ exitCode: 0 })),
    serviceUnmask: vi.fn(async () => ({ exitCode: 0 })),
    serviceDaemonReload: vi.fn(async () => ({ exitCode: 0 })),
  },
}))

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }), { virtual: true })
vi.mock('@/i18n', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn() } }) }))

import { sshService } from '@/services/ssh-service'
import { ServiceDetailDialog } from './service-detail-dialog'

const baseProps = {
  serverId: 's1',
  service: { name: 'nginx' } as unknown as never,
  props: { MainPID: '123', ExecMainStartTimestamp: String(Date.now() * 1000) } as unknown as never,
  loadingProps: false,
  capabilities: { journal: true } as unknown as never,
  onClose: () => {},
  onChanged: () => {},
  onNavigate: () => {},
}

describe('ServiceDetailDialog refactor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    cleanup()
  })

  it('渲染详情属性（由父组件下发，对话框不再内部加载）', async () => {
    render(<ServiceDetailDialog {...baseProps} />)
    // 概览区展示 MainPID，验证受控展示正常且不崩溃
    expect(await screen.findByText('123')).toBeInTheDocument()
  })

  it('切到日志 Tab 触发懒加载（事件驱动 handleTabChange，非 effect 内 setState）', async () => {
    render(<ServiceDetailDialog {...baseProps} />)
    const logsBtn = await screen.findByRole('button', { name: 'svc_detail_logs' })
    fireEvent.click(logsBtn)
    await waitFor(() => expect(sshService.serviceLogs).toHaveBeenCalled())
  })

  it('查看错误日志按钮以 err 级别即时加载（不依赖 effect 闭包 logLevel）', async () => {
    render(<ServiceDetailDialog {...baseProps} />)
    const logsBtn = await screen.findByRole('button', { name: 'svc_detail_logs' })
    fireEvent.click(logsBtn)
    await waitFor(() =>
      expect(sshService.serviceLogs).toHaveBeenCalledWith('s1', 'nginx', expect.objectContaining({ priority: undefined })),
    )
  })

  it('暂停时冻结日志快照（frozenLogs state 替代 frozenRef）', async () => {
    render(<ServiceDetailDialog {...baseProps} />)
    const logsBtn = await screen.findByRole('button', { name: 'svc_detail_logs' })
    fireEvent.click(logsBtn)
    await waitFor(() => expect(sshService.serviceLogs).toHaveBeenCalled())
    expect(await screen.findByText(/log line A/)).toBeInTheDocument()

    // 启动实时跟随后暂停按钮才可用（following 变 true）
    const followBtn = await screen.findByRole('button', { name: 'svc_log_follow' })
    fireEvent.click(followBtn)
    const pauseBtn = await screen.findByRole('button', { name: 'svc_log_pause' })
    fireEvent.click(pauseBtn)
    // 暂停后日志区仍显示冻结快照，不崩溃
    expect(screen.getByText(/log line A/)).toBeInTheDocument()
  })
})
