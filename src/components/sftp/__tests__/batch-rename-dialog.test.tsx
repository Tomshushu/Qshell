import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import {
  BatchRenameDialog,
  type BatchRenameResult,
  type BatchRenameTarget,
} from '../batch-rename-dialog'

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    toast: {
      success: mockToastSuccess,
      error: mockToastError,
      info: vi.fn(),
      warning: vi.fn(),
    },
  }),
}))

vi.mock('@/hooks/use-modal-stack', () => ({
  useModalStack: () => 'modal-test-id',
}))

const sampleItems: BatchRenameTarget[] = [
  { path: '/data/log_01.txt', name: 'log_01.txt', isDirectory: false },
  { path: '/data/log_02.txt', name: 'log_02.txt', isDirectory: false },
  { path: '/data/archive', name: 'archive', isDirectory: true },
]

function activateTab(tabButton: HTMLElement) {
  fireEvent.mouseDown(tabButton, { button: 0 })
  fireEvent.click(tabButton)
}

describe('BatchRenameDialog', () => {
  beforeEach(() => {
    mockToastSuccess.mockReset()
    mockToastError.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('supports regex find & replace, previews results, and closes with toast on full success', async () => {
    const onClose = vi.fn()
    const onExecuteRename = vi.fn(
      async (): Promise<BatchRenameResult> => ({
        succeeded: 2,
        failed: [],
      }),
    )

    render(
      <BatchRenameDialog
        open
        onClose={onClose}
        items={sampleItems}
        onExecuteRename={onExecuteRename}
      />,
    )

    fireEvent.click(screen.getByLabelText('使用正则表达式'))
    fireEvent.change(screen.getByLabelText('查找内容'), {
      target: { value: '^log_(\\d+)' },
    })
    fireEvent.change(screen.getByLabelText('替换为'), {
      target: { value: 'app_$1' },
    })

    expect(screen.getByText('app_01.txt')).toBeInTheDocument()
    expect(screen.getByText('app_02.txt')).toBeInTheDocument()

    const applyBtn = screen.getByRole('button', { name: /应用重命名 \(2\)/ })
    expect(applyBtn).toBeEnabled()
    fireEvent.click(applyBtn)

    await waitFor(() => {
      expect(onExecuteRename).toHaveBeenCalledWith([
        { oldPath: '/data/log_01.txt', newPath: '/data/app_01.txt' },
        { oldPath: '/data/log_02.txt', newPath: '/data/app_02.txt' },
      ])
    })

    expect(mockToastSuccess).toHaveBeenCalledWith('已成功重命名 2 项')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('disables apply when regex is invalid or target filenames collide', () => {
    const onClose = vi.fn()
    const onExecuteRename = vi.fn(async () => ({ succeeded: 0, failed: [] }))

    render(
      <BatchRenameDialog
        open
        onClose={onClose}
        items={sampleItems.slice(0, 2)}
        onExecuteRename={onExecuteRename}
      />,
    )

    // Invalid regex
    fireEvent.click(screen.getByLabelText('使用正则表达式'))
    fireEvent.change(screen.getByLabelText('查找内容'), {
      target: { value: '[unclosed' },
    })
    expect(screen.getByText(/正则表达式无效/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /应用重命名/ })).toBeDisabled()

    // Collision: replace 01 or 02 with same constant
    fireEvent.change(screen.getByLabelText('查找内容'), {
      target: { value: '\\d+' },
    })
    fireEvent.change(screen.getByLabelText('替换为'), {
      target: { value: 'same' },
    })
    expect(screen.getByText(/重名冲突/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /应用重命名/ })).toBeDisabled()
  })

  it('supports prefix/suffix and sequence template modes', async () => {
    const onClose = vi.fn()
    const onExecuteRename = vi.fn(
      async (): Promise<BatchRenameResult> => ({
        succeeded: 2,
        failed: [],
      }),
    )

    render(
      <BatchRenameDialog
        open
        onClose={onClose}
        items={sampleItems.slice(0, 2)}
        onExecuteRename={onExecuteRename}
      />,
    )

    // Switch to Prefix & Suffix tab
    activateTab(screen.getByRole('tab', { name: /前后缀/ }))
    fireEvent.change(screen.getByLabelText('前缀'), {
      target: { value: 'pre_' },
    })
    fireEvent.change(screen.getByLabelText('后缀'), {
      target: { value: '.bak' },
    })
    expect(screen.getByText('pre_log_01.txt.bak')).toBeInTheDocument()
    expect(screen.getByText('pre_log_02.txt.bak')).toBeInTheDocument()

    // Switch to Sequence template tab
    activateTab(screen.getByRole('tab', { name: /序号模板/ }))
    fireEvent.change(screen.getByLabelText('命名模板'), {
      target: { value: 'batch_{n}' },
    })
    fireEvent.change(screen.getByLabelText('起始序号'), {
      target: { value: '5' },
    })
    fireEvent.change(screen.getByLabelText('补零位数'), {
      target: { value: '3' },
    })

    expect(screen.getByText('batch_005.txt')).toBeInTheDocument()
    expect(screen.getByText('batch_006.txt')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /应用重命名 \(2\)/ }))
    await waitFor(() => {
      expect(onExecuteRename).toHaveBeenCalledWith([
        { oldPath: '/data/log_01.txt', newPath: '/data/batch_005.txt' },
        { oldPath: '/data/log_02.txt', newPath: '/data/batch_006.txt' },
      ])
    })
  })

  it('displays per-file failure summary and stays open when some renames fail', async () => {
    const onClose = vi.fn()
    const onExecuteRename = vi.fn(
      async (): Promise<BatchRenameResult> => ({
        succeeded: 1,
        failed: [{ path: '/data/log_02.txt', error: 'Permission denied' }],
      }),
    )

    render(
      <BatchRenameDialog
        open
        onClose={onClose}
        items={sampleItems.slice(0, 2)}
        onExecuteRename={onExecuteRename}
      />,
    )

    activateTab(screen.getByRole('tab', { name: /前后缀/ }))
    fireEvent.change(screen.getByLabelText('前缀'), {
      target: { value: 'new_' },
    })

    fireEvent.click(screen.getByRole('button', { name: /应用重命名 \(2\)/ }))

    await waitFor(() => {
      expect(screen.getByText(/部分重命名失败：成功 1 项，失败 1 项/)).toBeInTheDocument()
    })
    expect(screen.getByText('/data/log_02.txt: Permission denied')).toBeInTheDocument()
    expect(mockToastError).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    // 成功后应剔除已完成项，仅保留失败项供用户重试
    expect(screen.getByRole('button', { name: /应用重命名 \(1\)/ })).toBeInTheDocument()
  })

  it('detects chained path collision when newPath matches another pending oldPath', () => {
    const chainItems: BatchRenameTarget[] = [
      { path: '/data/a.txt', name: 'a.txt', isDirectory: false },
      { path: '/data/b.txt', name: 'b.txt', isDirectory: false },
    ]
    render(
      <BatchRenameDialog
        open
        onClose={vi.fn()}
        items={chainItems}
        onExecuteRename={vi.fn(async () => ({ succeeded: 0, failed: [] }))}
      />,
    )

    // 把 a 替换为 b -> a.txt 变成 b.txt（与待改名的 b.txt 原路径碰撞）
    fireEvent.change(screen.getByLabelText('查找内容'), {
      target: { value: 'a' },
    })
    fireEvent.change(screen.getByLabelText('替换为'), {
      target: { value: 'b' },
    })

    expect(screen.getByRole('button', { name: /应用重命名/ })).toBeDisabled()
  })

  it('replaces {n}, {name}, and {ext} in a single pass without re-expanding literal tokens in filenames', () => {
    const literalTokenItems: BatchRenameTarget[] = [
      { path: '/data/report_{n}_{ext}.txt', name: 'report_{n}_{ext}.txt', isDirectory: false },
      { path: '/data/note_{name}_$1.log', name: 'note_{name}_$1.log', isDirectory: false },
    ]

    render(
      <BatchRenameDialog
        open
        onClose={vi.fn()}
        items={literalTokenItems}
        onExecuteRename={vi.fn(async () => ({ succeeded: 2, failed: [] }))}
      />,
    )

    activateTab(screen.getByRole('tab', { name: /序号模板/ }))
    fireEvent.change(screen.getByLabelText('命名模板'), {
      target: { value: '{name}_{n}.{ext}' },
    })

    expect(screen.getByText('report_{n}_{ext}_01.txt')).toBeInTheDocument()
    expect(screen.getByText('note_{name}_$1_02.log')).toBeInTheDocument()
  })

  it('rejects Windows reserved characters when targetPlatform is windows', () => {
    render(
      <BatchRenameDialog
        open
        onClose={vi.fn()}
        items={sampleItems.slice(0, 1)}
        onExecuteRename={vi.fn(async () => ({ succeeded: 0, failed: [] }))}
        targetPlatform="windows"
      />,
    )

    fireEvent.change(screen.getByLabelText('查找内容'), {
      target: { value: '_' },
    })
    fireEvent.change(screen.getByLabelText('替换为'), {
      target: { value: ':' },
    })

    expect(screen.getByText('无效')).toBeInTheDocument()
    expect(screen.getByText(/非法或空文件名/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /应用重命名/ })).toBeDisabled()
  })

  it('flags collision with unselected sibling entries in existingNames and blocks submit', () => {
    render(
      <BatchRenameDialog
        open
        onClose={vi.fn()}
        items={[{ path: '/data/a.txt', name: 'a.txt', isDirectory: false }]}
        existingNames={['a.txt', 'sibling.txt']}
        onExecuteRename={vi.fn(async () => ({ succeeded: 0, failed: [] }))}
      />,
    )

    fireEvent.change(screen.getByLabelText('查找内容'), {
      target: { value: 'a.txt' },
    })
    fireEvent.change(screen.getByLabelText('替换为'), {
      target: { value: 'sibling.txt' },
    })

    expect(screen.getByText('名称冲突')).toBeInTheDocument()
    expect(screen.getByText(/重名冲突/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /应用重命名/ })).toBeDisabled()
  })
})
