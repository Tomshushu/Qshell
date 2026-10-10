import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { ToastProvider } from '../toast-provider'
import { useToast } from '../toast'

vi.mock('@/lib/sound', () => ({
  playSound: vi.fn(),
  SoundType: {
    Success: 'success',
    Error: 'error',
    Notify: 'notify',
    Warn: 'warn',
  },
}))

function TestComponent() {
  const { toast } = useToast()
  return (
    <div>
      <button onClick={() => toast.warning('文件大于 2MB，仅支持只读预览，暂不支持直接编辑')}>
        Trigger Warning
      </button>
      <button onClick={() => toast.success('操作成功')}>
        Trigger Success
      </button>
      <button onClick={() => toast.error('网络连接失败')}>
        Trigger Error
      </button>
    </div>
  )
}

describe('ToastProvider Deduplication', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('deduplicates identical toast messages within short time window', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    )

    const warnBtn = screen.getByText('Trigger Warning')

    // 连续触发两次相同的警告
    act(() => {
      fireEvent.click(warnBtn)
      fireEvent.click(warnBtn)
    })

    // 验证界面上只出现 1 个该警告文本，而不是重复两个
    const warnings = screen.getAllByText('文件大于 2MB，仅支持只读预览，暂不支持直接编辑')
    expect(warnings.length).toBe(1)
  })

  it('allows different toast messages to display simultaneously', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    )

    const warnBtn = screen.getByText('Trigger Warning')
    const successBtn = screen.getByText('Trigger Success')

    act(() => {
      fireEvent.click(warnBtn)
      fireEvent.click(successBtn)
    })

    expect(screen.getByText('文件大于 2MB，仅支持只读预览，暂不支持直接编辑')).toBeTruthy()
    expect(screen.getByText('操作成功')).toBeTruthy()
  })

  it('removes toast when close button is clicked', () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    )

    const successBtn = screen.getByText('Trigger Success')
    act(() => {
      fireEvent.click(successBtn)
    })

    expect(screen.getByText('操作成功')).toBeTruthy()

    const closeBtn = screen.getByRole('button', { name: 'close' })
    act(() => {
      fireEvent.click(closeBtn)
    })

    expect(screen.queryByText('操作成功')).toBeNull()
  })
})
