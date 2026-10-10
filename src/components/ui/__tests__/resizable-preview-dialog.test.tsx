import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ResizablePreviewDialog } from '../resizable-preview-dialog'

describe('ResizablePreviewDialog', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders title, icon, file size and children when open', () => {
    const onOpenChange = vi.fn()
    render(
      <ResizablePreviewDialog
        open={true}
        onOpenChange={onOpenChange}
        title="example.xlsx"
        fileSize={2048}
        icon={<span data-testid="preview-icon">icon</span>}
      >
        <div data-testid="preview-content">Sheet Content</div>
      </ResizablePreviewDialog>
    )

    expect(screen.getByText('example.xlsx')).toBeTruthy()
    expect(screen.getByTestId('preview-icon')).toBeTruthy()
    expect(screen.getByText('2.0 KB')).toBeTruthy()
    expect(screen.getByTestId('preview-content')).toBeTruthy()
  })

  it('triggers onOpenChange(false) when close button is clicked', () => {
    const onOpenChange = vi.fn()
    render(
      <ResizablePreviewDialog
        open={true}
        onOpenChange={onOpenChange}
        title="test.docx"
      >
        <div>Content</div>
      </ResizablePreviewDialog>
    )

    const closeBtn = screen.getByTitle('关闭 (Esc)')
    fireEvent.click(closeBtn)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('toggles maximize and restore state when maximize button is clicked', () => {
    const onOpenChange = vi.fn()
    render(
      <ResizablePreviewDialog
        open={true}
        onOpenChange={onOpenChange}
        title="code.rs"
      >
        <div>Code Content</div>
      </ResizablePreviewDialog>
    )

    const maxBtn = screen.getByTitle('最大化窗口')
    expect(maxBtn).toBeTruthy()

    fireEvent.click(maxBtn)
    expect(screen.getByTitle('还原窗口')).toBeTruthy()

    fireEvent.click(screen.getByTitle('还原窗口'))
    expect(screen.getByTitle('最大化窗口')).toBeTruthy()
  })

  it('does not render content when open is false', () => {
    render(
      <ResizablePreviewDialog
        open={false}
        onOpenChange={vi.fn()}
        title="hidden.txt"
      >
        <div data-testid="hidden-content">Hidden Content</div>
      </ResizablePreviewDialog>
    )

    expect(screen.queryByText('hidden.txt')).toBeNull()
    expect(screen.queryByTestId('hidden-content')).toBeNull()
  })
})
