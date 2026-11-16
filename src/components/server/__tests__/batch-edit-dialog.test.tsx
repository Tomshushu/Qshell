import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { BatchEditDialog } from '../batch-edit-dialog'
import type { Server } from '@/types'

const mockBatchUpdateServers = vi.fn()
const mockListAuthProfiles = vi.fn()
const mockLoadServers = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()

vi.mock('@/services/ssh-service', () => ({
  sshService: {
    batchUpdateServers: (...args: unknown[]) => mockBatchUpdateServers(...args),
    listAuthProfiles: (...args: unknown[]) => mockListAuthProfiles(...args),
  },
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      serverGroups: [
        { id: 'grp-host', name: '主机', parentId: null, createdAt: 0, updatedAt: 0 },
        { id: 'grp-prod', name: '生产集群', parentId: 'grp-host', createdAt: 0, updatedAt: 0 },
      ],
      tags: ['prod', 'web'],
      servers: [],
      loadServers: mockLoadServers,
    }),
}))

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    toast: {
      success: mockToastSuccess,
      error: mockToastError,
    },
  }),
}))

import zhCN from '@/i18n/locales/zh-CN'

vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    language: 'zh-CN',
    t: (key: string, params?: Record<string, unknown>) => {
      const template = (zhCN as Record<string, string>)[key] ?? key
      if (!params) return template
      return Object.entries(params).reduce(
        (acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)),
        template,
      )
    },
  }),
}))

vi.mock('@/hooks/use-modal-stack', () => ({
  useModalStack: vi.fn(),
}))

const sampleServers: Server[] = [
  {
    id: 'srv-1',
    name: 'Node 1',
    host: '10.0.0.1',
    port: 22,
    username: 'root',
    authType: 'password',
    tags: [],
    favorite: false,
    status: 'unknown',
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'srv-2',
    name: 'Node 2',
    host: '10.0.0.2',
    port: 22,
    username: 'root',
    authType: 'password',
    tags: [],
    favorite: false,
    status: 'unknown',
    createdAt: 0,
    updatedAt: 0,
  },
]

describe('BatchEditDialog', () => {
  beforeAll(() => {
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    }
  })

  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockListAuthProfiles.mockResolvedValue([
      {
        id: 'prof-1',
        name: 'Prod Root',
        username: 'deploy',
        authType: 'password',
        forwardAgent: true,
        createdAt: 0,
        updatedAt: 0,
      },
    ])
    mockBatchUpdateServers.mockResolvedValue({ success: true, message: '2' })
    mockLoadServers.mockResolvedValue(undefined)
  })

  it('keeps apply button disabled until at least one field checkbox is selected', async () => {
    render(<BatchEditDialog open={true} servers={sampleServers} onClose={vi.fn()} />)
    expect(screen.queryByText('所属分组')).not.toBeInTheDocument()
    const applyBtn = screen.getByRole('button', { name: '应用修改 (2)' })
    expect(applyBtn).toBeDisabled()

    fireEvent.click(screen.getByText('连接超时 (秒)'))
    expect(applyBtn).not.toBeDisabled()
  })

  it('submits only checked fields and refreshes servers on success', async () => {
    const onClose = vi.fn()
    render(<BatchEditDialog open={true} servers={sampleServers} onClose={onClose} />)

    // 勾选并修改连接超时 + SSH Agent 转发
    fireEvent.click(screen.getByText('连接超时 (秒)'))
    const timeoutInput = screen.getByDisplayValue('30')
    fireEvent.change(timeoutInput, { target: { value: '60' } })

    fireEvent.click(screen.getByText('SSH Agent 转发'))
    const toggle = screen.getByRole('switch')
    fireEvent.click(toggle)

    fireEvent.click(screen.getByRole('button', { name: '应用修改 (2)' }))

    await waitFor(() => {
      expect(mockBatchUpdateServers).toHaveBeenCalledWith(['srv-1', 'srv-2'], {
        connectionTimeout: 60,
        forwardAgent: true,
      })
    })
    await waitFor(() => {
      expect(mockLoadServers).toHaveBeenCalled()
      expect(mockToastSuccess).toHaveBeenCalledWith('已原子更新 2 台服务器配置')
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('adds tag chips and submits batch tag patch', async () => {
    const onClose = vi.fn()
    render(<BatchEditDialog open={true} servers={sampleServers} onClose={onClose} />)

    fireEvent.click(screen.getByText('标签调整'))
    const input = screen.getByPlaceholderText('输入标签后回车添加...')
    fireEvent.change(input, { target: { value: 'canary' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    fireEvent.click(screen.getByRole('button', { name: '应用修改 (2)' }))

    await waitFor(() => {
      expect(mockBatchUpdateServers).toHaveBeenCalledWith(['srv-1', 'srv-2'], {
        tagsMode: 'add',
        tags: ['canary'],
      })
    })
  })

  it('commits uncommitted tagDraft on submit without requiring Enter', async () => {
    const onClose = vi.fn()
    render(<BatchEditDialog open={true} servers={sampleServers} onClose={onClose} />)

    fireEvent.click(screen.getByText('标签调整'))
    const input = screen.getByPlaceholderText('输入标签后回车添加...')
    fireEvent.change(input, { target: { value: 'edge, beta' } })

    fireEvent.click(screen.getByRole('button', { name: '应用修改 (2)' }))

    await waitFor(() => {
      expect(mockBatchUpdateServers).toHaveBeenCalledWith(['srv-1', 'srv-2'], {
        tagsMode: 'add',
        tags: ['edge', 'beta'],
      })
    })
  })

  it('shows timeout default hint and keeps submit disabled when 0 servers selected', () => {
    render(<BatchEditDialog open={true} servers={[]} onClose={vi.fn()} />)
    expect(screen.getByText('默认 30 秒（1~300）')).toBeInTheDocument()
    fireEvent.click(screen.getByText('连接超时 (秒)'))
    expect(screen.getByRole('button', { name: '应用修改 (0)' })).toBeDisabled()
  })

  it('warns about auth profile precedence when forwarding agent is toggled on bound servers', () => {
    const boundServers: Server[] = [
      { ...sampleServers[0], authProfileId: 'prof-1' },
      sampleServers[1],
    ]
    render(<BatchEditDialog open={true} servers={boundServers} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('SSH Agent 转发'))
    expect(
      screen.getByText('注意：已绑定全局身份凭证的服务器，连接时将优先以凭证内的 Agent 转发设置为准。'),
    ).toBeInTheDocument()
  })

  it('supports extended TERM options such as vt320 and submits terminalType patch', async () => {
    render(<BatchEditDialog open={true} servers={sampleServers} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('终端类型 (TERM)'))
    fireEvent.click(screen.getByRole('button', { name: '继承全局默认设置' }))
    fireEvent.click(screen.getByText('vt320'))
    fireEvent.click(screen.getByRole('button', { name: '应用修改 (2)' }))

    await waitFor(() => {
      expect(mockBatchUpdateServers).toHaveBeenCalledWith(['srv-1', 'srv-2'], {
        terminalType: 'vt320',
      })
    })
  })
})
