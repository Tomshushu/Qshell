import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import * as iconv from 'iconv-lite'
import { FileDiffDialog, type FileDiffCandidate } from '../file-diff-dialog'
import { encodeTextFile, isBinaryBytes } from '@/utils/text-file-codec'

vi.mock('@/hooks/use-modal-stack', () => ({
  useModalStack: () => 'modal-test-id',
}))

vi.mock('@/components/terminal/tools/diff/SideBySideDiffViewer', () => ({
  SideBySideDiffViewer: (props: {
    mode: 'text' | 'binary'
    leftText?: string
    rightText?: string
  }) => (
    <div data-testid="mock-diff-viewer" data-mode={props.mode}>
      <span data-testid="mock-left-text">{props.leftText ?? ''}</span>
      <span data-testid="mock-right-text">{props.rightText ?? ''}</span>
    </div>
  ),
}))

describe('FileDiffDialog', () => {
  afterEach(() => {
    cleanup()
  })

  it('supports swapping left and right files in 2-candidate mode', async () => {
    const candidates: FileDiffCandidate[] = [
      {
        id: 'local:/a.txt',
        label: '本地: a.txt',
        fileName: 'a.txt',
        sourceTag: '本地',
        path: '/a.txt',
        size: 12,
        loadText: vi.fn().mockResolvedValue('alpha content'),
      },
      {
        id: 'remote:/b.txt',
        label: '腾讯云: b.txt',
        fileName: 'b.txt',
        sourceTag: '腾讯云',
        path: '/b.txt',
        size: 14,
        loadText: vi.fn().mockResolvedValue('beta content'),
      },
    ]

    render(
      <FileDiffDialog
        open
        onClose={vi.fn()}
        leftTitle="本地: a.txt"
        rightTitle="腾讯云: b.txt"
        candidates={candidates}
        initialLeftId="local:/a.txt"
        initialRightId="remote:/b.txt"
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('mock-left-text').textContent).toBe('alpha content')
      expect(screen.getByTestId('mock-right-text').textContent).toBe('beta content')
    })

    fireEvent.click(screen.getByLabelText('交换左右对比文件'))

    await waitFor(() => {
      expect(screen.getByTestId('mock-left-text').textContent).toBe('beta content')
      expect(screen.getByTestId('mock-right-text').textContent).toBe('alpha content')
    })
  })

  it('allows picking any two candidates and auto-swaps when choosing opposite side in 3+ candidate mode', async () => {
    const loadA = vi.fn().mockResolvedValue('file A')
    const loadB = vi.fn().mockResolvedValue('file B')
    const loadC = vi.fn().mockResolvedValue('file C')

    const candidates: FileDiffCandidate[] = [
      {
        id: 'local:/a.conf',
        label: '本地: a.conf',
        fileName: 'a.conf',
        sourceTag: '本地',
        path: 'C:/work/a.conf',
        size: 6,
        loadText: loadA,
      },
      {
        id: 'local:/c.conf',
        label: '本地: c.conf',
        fileName: 'c.conf',
        sourceTag: '本地',
        path: 'C:/work/c.conf',
        size: 6,
        loadText: loadC,
      },
      {
        id: 'remote:/b.conf',
        label: '腾讯云: b.conf',
        fileName: 'b.conf',
        sourceTag: '腾讯云',
        path: '/etc/b.conf',
        size: 6,
        loadText: loadB,
      },
    ]

    render(
      <FileDiffDialog
        open
        onClose={vi.fn()}
        leftTitle="本地: a.conf"
        rightTitle="腾讯云: b.conf"
        candidates={candidates}
        initialLeftId="local:/a.conf"
        initialRightId="remote:/b.conf"
      />,
    )

    expect(screen.getByText('候选 3 项')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByTestId('mock-left-text').textContent).toBe('file A')
      expect(screen.getByTestId('mock-right-text').textContent).toBe('file B')
    })

    // Open Right dropdown and pick c.conf
    const rightTrigger = screen.getByLabelText('选择右侧对比文件')
    fireEvent.pointerDown(rightTrigger, { button: 0, ctrlKey: false })
    fireEvent.click(rightTrigger)

    const cItem = await screen.findByText('C:/work/c.conf')
    fireEvent.click(cItem)

    await waitFor(() => {
      expect(screen.getByTestId('mock-left-text').textContent).toBe('file A')
      expect(screen.getByTestId('mock-right-text').textContent).toBe('file C')
    })
    expect(loadC).toHaveBeenCalledTimes(1)

    // Open Left dropdown and pick c.conf (currently on Right) -> auto-swaps Right to a.conf
    const leftTrigger = screen.getByLabelText('选择左侧对比文件')
    fireEvent.pointerDown(leftTrigger, { button: 0, ctrlKey: false })
    fireEvent.click(leftTrigger)

    const cItemInLeft = await screen.findByText('C:/work/c.conf')
    fireEvent.click(cItemInLeft)

    await waitFor(() => {
      expect(screen.getByTestId('mock-left-text').textContent).toBe('file C')
      expect(screen.getByTestId('mock-right-text').textContent).toBe('file A')
    })
  })

  it('decodes GBK and UTF-16LE BOM candidates accurately when falling back to loadBytes', async () => {
    const gbkBytes = new Uint8Array(iconv.encode('配置项=中文GBK', 'gbk'))
    const utf16Bytes = encodeTextFile('配置项=UTF16文本', 'utf-16le', true)

    // UTF-16 BOM text must not be misclassified as binary
    expect(isBinaryBytes(utf16Bytes)).toBe(false)
    expect(isBinaryBytes(gbkBytes)).toBe(false)

    const candidates: FileDiffCandidate[] = [
      {
        id: 'left:gbk',
        label: '本地: app.conf',
        fileName: 'app.conf',
        size: gbkBytes.byteLength,
        loadBytes: vi.fn().mockResolvedValue(gbkBytes),
      },
      {
        id: 'right:utf16',
        label: '远程: app.conf',
        fileName: 'app.conf',
        size: utf16Bytes.byteLength,
        loadBytes: vi.fn().mockResolvedValue(utf16Bytes),
      },
    ]

    render(
      <FileDiffDialog
        open
        onClose={vi.fn()}
        leftTitle="本地: app.conf"
        rightTitle="远程: app.conf"
        candidates={candidates}
        initialLeftId="left:gbk"
        initialRightId="right:utf16"
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('mock-diff-viewer').getAttribute('data-mode')).toBe('text')
      expect(screen.getByTestId('mock-left-text').textContent).toBe('配置项=中文GBK')
      expect(screen.getByTestId('mock-right-text').textContent).toBe('配置项=UTF16文本')
    })
  })

  it('auto-detects binary content via isBinaryBytes for unknown/text-like extensions and blocks Text Diff', async () => {
    const textBytes = new TextEncoder().encode('plain text header\n')
    const elfBytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01, 0x02, 0x00])
    expect(isBinaryBytes(elfBytes)).toBe(true)

    const candidates: FileDiffCandidate[] = [
      {
        id: 'left:a.out',
        label: '本地: a.out',
        fileName: 'a.out',
        size: textBytes.byteLength,
        loadBytes: vi.fn().mockResolvedValue(textBytes),
      },
      {
        id: 'right:a.out',
        label: '远程: a.out',
        fileName: 'a.out',
        size: elfBytes.byteLength,
        loadBytes: vi.fn().mockResolvedValue(elfBytes),
      },
    ]

    render(
      <FileDiffDialog
        open
        onClose={vi.fn()}
        leftTitle="本地: a.out"
        rightTitle="远程: a.out"
        candidates={candidates}
        initialLeftId="left:a.out"
        initialRightId="right:a.out"
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('mock-diff-viewer').getAttribute('data-mode')).toBe('binary')
    })

    const textDiffBtn = screen.getByRole('button', { name: /Text Diff/ })
    expect(textDiffBtn).toBeDisabled()
    expect(screen.getByRole('status').textContent).toContain('二进制')
  })
})
