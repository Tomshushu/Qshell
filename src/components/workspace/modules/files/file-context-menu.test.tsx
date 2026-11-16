import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FileContextMenu } from './file-context-menu'
import type { FileEntry } from '@/types'

describe('FileContextMenu', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('clamps archive submenu upward when folder context menu sits near bottom of viewport', () => {
    const origInnerHeight = window.innerHeight
    Object.defineProperty(window, 'innerHeight', {
      value: 600,
      configurable: true,
      writable: true,
    })

    const dirEntry: FileEntry = {
      name: 'logs',
      path: '/var/logs',
      isDirectory: true,
      size: 0,
      modifiedTime: '2026-11-14T00:00:00Z',
      permissions: 'drwxr-xr-x',
    }

    try {
      const ctxMenuRef = React.createRef<HTMLDivElement>()
      render(
        <FileContextMenu
          ctxMenu={{ x: 120, y: 200, file: dirEntry }}
          ctxMenuRef={ctxMenuRef}
          currentPath="/var"
          selectedFiles={[]}
          transferLoading={null}
          isWindows={false}
          onClose={vi.fn()}
          onRefresh={vi.fn()}
          onNewItem={vi.fn()}
          onNativeUpload={vi.fn()}
          onDownloadMultiple={vi.fn()}
          onPreview={vi.fn()}
          onNavigateTo={vi.fn()}
          onOpenEditor={vi.fn()}
          onStartRename={vi.fn()}
          onDownload={vi.fn()}
          onDownloadArchive={vi.fn()}
          onChangePermissions={vi.fn()}
          onShowProperties={vi.fn()}
          onDelete={vi.fn()}
          t={(k) => k}
        />,
      )

      const archiveTriggerBtn = screen.getByTestId('file-menu-archive-trigger')
      const triggerWrap = archiveTriggerBtn.parentElement as HTMLElement | null
      expect(triggerWrap).not.toBeNull()

      vi.spyOn(triggerWrap!, 'getBoundingClientRect').mockReturnValue({
        x: 120,
        y: 510,
        top: 510,
        left: 120,
        bottom: 540,
        right: 340,
        width: 220,
        height: 30,
        toJSON: () => ({}),
      })

      fireEvent.mouseEnter(triggerWrap!)

      const wrapper = screen.getByTestId('file-submenu-wrapper')
      const topPx = parseFloat(wrapper.style.top)
      expect(Number.isFinite(topPx)).toBe(true)
      // trigger top=510, estimatedHeight=200, vh=600, pad=6 => clampedTop=394 => offsetTop=-116
      expect(topPx).toBeLessThan(-6)
      expect(510 + topPx + 200).toBeLessThanOrEqual(600 - 6)
    } finally {
      Object.defineProperty(window, 'innerHeight', {
        value: origInnerHeight,
        configurable: true,
        writable: true,
      })
    }
  })

  it('hides archive download and extract archive actions when isFtp is true', () => {
    const dirEntry: FileEntry = {
      name: 'logs',
      path: '/var/logs',
      isDirectory: true,
      size: 0,
      modifiedTime: '2026-11-14T00:00:00Z',
      permissions: 'drwxr-xr-x',
    }
    const archiveEntry: FileEntry = {
      name: 'backup.tar.gz',
      path: '/var/backup.tar.gz',
      isDirectory: false,
      size: 1024,
      modifiedTime: '2026-11-14T00:00:00Z',
      permissions: '-rw-r--r--',
    }
    const ctxMenuRef = React.createRef<HTMLDivElement>()
    const commonProps = {
      ctxMenuRef,
      currentPath: '/var',
      selectedFiles: [],
      transferLoading: null,
      isWindows: false,
      isFtp: true,
      onClose: vi.fn(),
      onRefresh: vi.fn(),
      onNewItem: vi.fn(),
      onNativeUpload: vi.fn(),
      onDownloadMultiple: vi.fn(),
      onPreview: vi.fn(),
      onNavigateTo: vi.fn(),
      onOpenEditor: vi.fn(),
      onStartRename: vi.fn(),
      onDownload: vi.fn(),
      onDownloadArchive: vi.fn(),
      onExtractArchive: vi.fn(),
      onChangePermissions: vi.fn(),
      onShowProperties: vi.fn(),
      onDelete: vi.fn(),
      t: (k: string) => k,
    }

    const { rerender } = render(
      <FileContextMenu ctxMenu={{ x: 100, y: 100, file: dirEntry }} {...commonProps} />,
    )
    expect(screen.queryByTestId('file-menu-archive-trigger')).toBeNull()

    rerender(
      <FileContextMenu ctxMenu={{ x: 100, y: 100, file: archiveEntry }} {...commonProps} />,
    )
    expect(screen.queryByText('sftp_extract_archive')).toBeNull()
  })

  it('clears copy-path timeout on unmount without throwing', () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const fileEntry: FileEntry = {
      name: 'note.txt',
      path: '/var/note.txt',
      isDirectory: false,
      size: 12,
      modifiedTime: '2026-11-14T00:00:00Z',
      permissions: '-rw-r--r--',
    }
    const ctxMenuRef = React.createRef<HTMLDivElement>()
    const { unmount } = render(
      <FileContextMenu
        ctxMenu={{ x: 100, y: 100, file: fileEntry }}
        ctxMenuRef={ctxMenuRef}
        currentPath="/var"
        selectedFiles={[]}
        transferLoading={null}
        isWindows={false}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onNewItem={vi.fn()}
        onNativeUpload={vi.fn()}
        onDownloadMultiple={vi.fn()}
        onPreview={vi.fn()}
        onNavigateTo={vi.fn()}
        onOpenEditor={vi.fn()}
        onStartRename={vi.fn()}
        onDownload={vi.fn()}
        onDownloadArchive={vi.fn()}
        onChangePermissions={vi.fn()}
        onShowProperties={vi.fn()}
        onDelete={vi.fn()}
        t={(k) => k}
      />,
    )

    fireEvent.click(screen.getByText('fs_copy_path'))
    expect(writeText).toHaveBeenCalledWith('/var/note.txt')
    unmount()
    vi.advanceTimersByTime(2000)
    vi.useRealTimers()
  })
})
