import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

vi.mock('@open-file-viewer/react', () => ({
  FileViewer: ({ fileName }: { fileName: string }) => (
    <div data-testid="mock-open-file-viewer">{fileName}</div>
  ),
}))

vi.mock('@open-file-viewer/core', () => ({
  imagePlugin: () => ({}),
  videoPlugin: () => ({}),
  audioPlugin: () => ({}),
  textPlugin: () => ({}),
  pdfPlugin: () => ({}),
  officePlugin: () => ({}),
  archivePlugin: () => ({}),
  emailPlugin: () => ({}),
  ofdPlugin: () => ({}),
  epubPlugin: () => ({}),
  xpsPlugin: () => ({}),
  drawingPlugin: () => ({}),
  xmindPlugin: () => ({}),
  fallbackPlugin: () => ({}),
}))

vi.mock('@open-file-viewer/core/style.css', () => ({}))

import { UniversalFileViewer } from '../universal-file-viewer'

describe('UniversalFileViewer with HexViewer integration', () => {
  const origOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetHeight',
  )
  const origOffsetWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'offsetWidth',
  )

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      value: 480,
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      value: 800,
    })
  })

  afterEach(() => {
    cleanup()
    if (origOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'offsetHeight',
        origOffsetHeight,
      )
    }
    if (origOffsetWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        'offsetWidth',
        origOffsetWidth,
      )
    }
    vi.restoreAllMocks()
  })

  it('renders HexViewer directly in chunked mode when totalSize and onLoadRange are provided even with empty data', async () => {
    const backing = new Uint8Array(1024)
    backing[0] = 0x7f
    backing[1] = 0x45
    backing[2] = 0x4c
    backing[3] = 0x46

    const onLoadRange = vi.fn(async (offset: number, len: number) =>
      backing.subarray(offset, offset + len),
    )

    render(
      <UniversalFileViewer
        data={new Uint8Array(0)}
        totalSize={1024}
        onLoadRange={onLoadRange}
        fileName="firmware.bin"
      />,
    )

    await waitFor(() => {
      expect(onLoadRange).toHaveBeenCalled()
      expect(screen.getByText('7F')).toBeInTheDocument()
      expect(screen.getByText('45')).toBeInTheDocument()
      expect(screen.getByText('4C')).toBeInTheDocument()
      expect(screen.getByText('46')).toBeInTheDocument()
    })
  })

  it('auto-selects HexViewer for unknown binary Uint8Array inputs and allows toggling back to preview', () => {
    const bytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00])
    render(<UniversalFileViewer data={bytes} fileName="payload.bin" />)

    expect(screen.getByText('4D')).toBeInTheDocument()
    expect(screen.getByText('5A')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-open-file-viewer')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /预览/ }))
    expect(screen.getByTestId('mock-open-file-viewer')).toHaveTextContent('payload.bin')
  })

  it('allows switching text file preview to Hex mode with lazy TextEncoder conversion', () => {
    render(<UniversalFileViewer data="ABC" fileName="notes.txt" />)

    expect(screen.getByTestId('mock-open-file-viewer')).toHaveTextContent('notes.txt')
    expect(screen.queryByTestId('hex-scroll-container')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Hex/ }))
    expect(screen.getByTestId('hex-scroll-container')).toBeInTheDocument()
    expect(screen.getByText('41')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('43')).toBeInTheDocument()
  })

  it('respects initialMode="hex" and hideModeSwitcher={true}', () => {
    render(
      <UniversalFileViewer
        data="Hi"
        fileName="hello.txt"
        initialMode="hex"
        hideModeSwitcher
      />,
    )

    expect(screen.getByTestId('hex-scroll-container')).toBeInTheDocument()
    expect(screen.getByText('48')).toBeInTheDocument()
    expect(screen.getByText('69')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '预览模式切换' })).not.toBeInTheDocument()
  })

  it('renders empty message when data is null and no chunked loader is given', () => {
    render(<UniversalFileViewer data={null} fileName="missing.dat" />)
    expect(screen.getByText('暂无可预览的文件数据')).toBeInTheDocument()
  })

  it('does not re-trigger Blob arrayBuffer() decoding when parent re-renders with a new inline onError callback', async () => {
    const blob = new Blob([new Uint8Array([0xca, 0xfe, 0xba, 0xbe])])
    const arrayBufferSpy = vi.fn().mockResolvedValue(new Uint8Array([0xca, 0xfe, 0xba, 0xbe]).buffer)
    Object.defineProperty(blob, 'arrayBuffer', { value: arrayBufferSpy })

    const { rerender } = render(
      <UniversalFileViewer
        data={blob}
        fileName="blob.bin"
        initialMode="hex"
        onError={() => {}}
      />,
    )

    await waitFor(() => {
      expect(arrayBufferSpy).toHaveBeenCalledTimes(1)
      expect(screen.getByText('CA')).toBeInTheDocument()
    })

    rerender(
      <UniversalFileViewer
        data={blob}
        fileName="blob.bin"
        initialMode="hex"
        onError={() => {}}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('BE')).toBeInTheDocument()
    })
    expect(arrayBufferSpy).toHaveBeenCalledTimes(1)
  })
})
