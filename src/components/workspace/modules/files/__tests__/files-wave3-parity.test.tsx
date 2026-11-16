/**
 * @vitest-environment jsdom
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useAppStore } from '@/store'
import { useSettingsDialogStore } from '@/store/settings-dialog-store'
import { FileToolbar } from '../file-toolbar'
import { FileContextMenu } from '../file-context-menu'
import { FilesModule } from '../../files'
import type { FileEntry } from '@/types'

const {
  mockToast,
  mockReadClipboardPath,
  mockSshService,
  mockBackend,
  stableT,
} = vi.hoisted(() => ({
  stableT: (k: string) => k,
  mockToast: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
  mockReadClipboardPath: vi.fn(),
  mockSshService: {
    isExiting: vi.fn(() => false),
    getHomeDirectory: vi.fn(async () => '/home/user'),
    listFiles: vi.fn<(_sid: string, dirPath: string) => Promise<FileEntry[]>>(async () => []),
    statInfo: vi.fn<(_sid: string, _path: string) => Promise<Record<string, unknown> | null>>(
      async () => null,
    ),
    readBinaryFile: vi.fn(async () => btoa('hello world')),
    readFileChunk: vi.fn(async () => ({
      dataBase64: btoa('HELLO_CHUNK'),
      bytesRead: 11,
      totalSize: 12 * 1024 * 1024,
      eof: false,
    })),
    renameFile: vi.fn(async () => ({ exitCode: 0 })),
    startExternalEdit: vi.fn(async () => ({
      sessionId: 'ext-1',
      localPath: '/tmp/ext-file',
      remotePath: '/home/user/alpha.txt',
      fileName: 'alpha.txt',
      serverId: 'srv-1',
    })),
    setTransferRateLimit: vi.fn(async () => undefined),
    setSymlinkPolicy: vi.fn(async () => undefined),
    setExclusionConfig: vi.fn(async () => undefined),
    onTransferProgress: vi.fn(() => () => {}),
    onTransferFailures: vi.fn(() => () => {}),
    beginBusyOperation: vi.fn(),
    endBusyOperation: vi.fn(),
  },
  mockBackend: {
    files: {
      onExternalFileSynced: vi.fn(() => () => {}),
      setRateLimit: vi.fn(async () => undefined),
      setExclusionConfig: vi.fn(async () => undefined),
    },
  },
}))

vi.mock('sonner', () => ({ toast: mockToast }))
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))
vi.mock('@/i18n', () => ({
  useTranslation: () => ({ t: stableT, language: 'zh-CN' }),
}))
vi.mock('@/lib/clipboard-path', () => ({
  readClipboardPath: (...args: unknown[]) => mockReadClipboardPath(...args),
}))
vi.mock('@/services/ssh-service', () => ({
  sshService: mockSshService,
}))
vi.mock('@/services/backend', () => ({
  backend: mockBackend,
}))
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 36,
        size: 36,
        end: (index + 1) * 36,
      })),
    getTotalSize: () => count * 36,
    measureElement: () => {},
    scrollToOffset: () => {},
    scrollToIndex: () => {},
  }),
}))
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(async () => () => {}),
  }),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => null),
  save: vi.fn(async () => null),
}))
vi.mock('@/components/ui/universal-file-viewer', () => ({
  UniversalFileViewer: (props: {
    fileName: string
    initialMode?: string
    totalSize?: number
    onLoadRange?: (offset: number, len: number) => Promise<Uint8Array>
  }) => {
    React.useEffect(() => {
      if (props.onLoadRange) {
        void props.onLoadRange(0, 64)
      }
    }, [props.onLoadRange])
    return (
      <div
        data-testid="mock-universal-viewer"
        data-filename={props.fileName}
        data-mode={props.initialMode}
        data-totalsize={props.totalSize ?? ''}
      />
    )
  },
}))
vi.mock('@/components/ui/code-editor', () => ({
  CodeEditor: (props: {
    value: string
    onValueChange: (val: string) => void
  }) => (
    <textarea
      data-testid="mock-code-editor"
      value={props.value}
      onChange={(e) => props.onValueChange(e.target.value)}
    />
  ),
}))
vi.mock('@/components/sftp/file-diff-dialog', () => ({
  FileDiffDialog: (props: {
    open: boolean
    leftTitle: string
    rightTitle: string
    candidates?: Array<{ id: string; label: string; loadText?: () => Promise<string> }>
    loadBytesPair?: () => Promise<{ left: Uint8Array; right: Uint8Array }>
  }) => {
    React.useEffect(() => {
      if (props.open && props.loadBytesPair) {
        void props.loadBytesPair()
      }
    }, [props.open, props.loadBytesPair])
    if (!props.open) return null
    return (
      <div
        data-testid="mock-file-diff-dialog"
        data-candidates={String(props.candidates?.length ?? 0)}
        data-has-loadtext={String(Boolean(props.candidates?.some((c) => typeof c.loadText === 'function')))}
      >
        {props.leftTitle} vs {props.rightTitle}
      </div>
    )
  },
}))

const t = (key: string) => key

const sampleFiles: FileEntry[] = [
  {
    name: 'large.bin',
    path: '/home/user/large.bin',
    isDirectory: false,
    size: 12 * 1024 * 1024,
    permissions: 'rw-r--r--',
    modifiedTime: '2026-01-01T00:00:00Z',
    owner: 'user',
    group: 'user',
  },
  {
    name: 'alpha.txt',
    path: '/home/user/alpha.txt',
    isDirectory: false,
    size: 12,
    permissions: 'rw-r--r--',
    modifiedTime: '2026-01-01T00:00:00Z',
    owner: 'user',
    group: 'user',
  },
  {
    name: 'beta.txt',
    path: '/home/user/beta.txt',
    isDirectory: false,
    size: 14,
    permissions: 'rw-r--r--',
    modifiedTime: '2026-01-01T00:00:00Z',
    owner: 'user',
    group: 'user',
  },
]

describe('Wave 3 Phase 2 Track C1: Workspace Files Parity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      servers: [],
      transferRateLimit: 0,
      sftpExclusionEnabled: false,
      sftpExclusionPatterns: [],
      sftpRespectGitignore: false,
      sftpIncludePatterns: [],
      sftpMinSizeKb: 0,
      sftpMaxSizeKb: 0,
      externalEditMaxSizeMb: 50,
      pathBookmarks: {},
    })
    mockSshService.listFiles.mockImplementation(async (_sid: string, dirPath: string) => {
      if (dirPath === '/home/user') return sampleFiles
      return []
    })
    mockSshService.readBinaryFile.mockResolvedValue(btoa('hello world'))
  })

  afterEach(() => {
    cleanup()
  })

  it('FileToolbar renders clipboard path jump, view mode switcher, and shortcut to Settings -> SFTP', () => {
    const onClipboardPathJump = vi.fn()
    const onViewModeChange = vi.fn()
    useAppStore.setState({
      transferRateLimit: 1024,
      sftpExclusionEnabled: true,
    })
    render(
      <FileToolbar
        currentPath="/home/user"
        onNavigateTo={vi.fn()}
        bookmarks={[]}
        onAddBookmark={vi.fn()}
        onRemoveBookmark={vi.fn()}
        onToggleBookmark={vi.fn()}
        viewMode="list"
        onViewModeChange={onViewModeChange}
        showHidden={false}
        onToggleShowHidden={vi.fn()}
        onRefresh={vi.fn()}
        loading={false}
        transferLoading={null}
        onNativeUpload={vi.fn()}
        onClipboardPathJump={onClipboardPathJump}
        showTransferPolicy
        searchQuery=""
        setSearchQuery={vi.fn()}
        showNewItem={false}
        newItemType="file"
        newItemName=""
        setNewItemName={vi.fn()}
        onNewItemConfirm={vi.fn()}
        onNewItemCancel={vi.fn()}
        t={t}
      />,
    )

    fireEvent.click(screen.getByTitle('sftp_clipboard_path_jump'))
    expect(onClipboardPathJump).toHaveBeenCalledTimes(1)

    // Shows active rate badge & opens Settings -> SFTP instead of duplicate popover
    const shortcutBtn = screen.getByTitle('sftp_transfer_policy_active')
    expect(screen.getByText('1M/s')).toBeTruthy()
    fireEvent.click(shortcutBtn)
    expect(useSettingsDialogStore.getState().open).toBe(true)
    expect(useSettingsDialogStore.getState().tab).toBe('sftp')

    // Renders unified view mode trigger
    expect(screen.getByTitle('sftp_view_mode')).toBeTruthy()
  })

  it('FileContextMenu exposes batch rename, file compare, and external edit items', () => {
    const onBatchRename = vi.fn()
    const onCompareSelected = vi.fn()
    const onStartExternalEdit = vi.fn()

    const { rerender } = render(
      <FileContextMenu
        ctxMenu={{ x: 100, y: 100, file: sampleFiles[1] }}
        ctxMenuRef={{ current: null }}
        currentPath="/home/user"
        selectedFiles={[sampleFiles[1].path, sampleFiles[2].path]}
        bookmarks={[]}
        onAddBookmark={vi.fn()}
        onRemoveBookmark={vi.fn()}
        showHidden={false}
        onToggleShowHidden={vi.fn()}
        transferLoading={null}
        isWindows={false}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onNewItem={vi.fn()}
        onNativeUpload={vi.fn()}
        onDownloadMultiple={vi.fn()}
        batchRenameCount={2}
        canCompareFiles
        onBatchRename={onBatchRename}
        onCompareSelected={onCompareSelected}
        onStartExternalEdit={onStartExternalEdit}
        onPreview={vi.fn()}
        onNavigateTo={vi.fn()}
        onOpenEditor={vi.fn()}
        onStartRename={vi.fn()}
        onDownload={vi.fn()}
        onDownloadArchive={vi.fn()}
        onExtractArchive={vi.fn()}
        extractingArchive={null}
        onChangePermissions={vi.fn()}
        onShowProperties={vi.fn()}
        onDelete={vi.fn()}
        t={t}
      />,
    )

    fireEvent.click(screen.getByText(/batch_rename_title/))
    expect(onBatchRename).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('对比选中文件'))
    expect(onCompareSelected).toHaveBeenCalledTimes(1)

    rerender(
      <FileContextMenu
        ctxMenu={{ x: 100, y: 100, file: sampleFiles[1] }}
        ctxMenuRef={{ current: null }}
        currentPath="/home/user"
        selectedFiles={[sampleFiles[1].path]}
        bookmarks={[]}
        onAddBookmark={vi.fn()}
        onRemoveBookmark={vi.fn()}
        showHidden={false}
        onToggleShowHidden={vi.fn()}
        transferLoading={null}
        isWindows={false}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onNewItem={vi.fn()}
        onNativeUpload={vi.fn()}
        onDownloadMultiple={vi.fn()}
        batchRenameCount={1}
        canCompareFiles={false}
        onBatchRename={onBatchRename}
        onCompareSelected={onCompareSelected}
        onStartExternalEdit={onStartExternalEdit}
        onPreview={vi.fn()}
        onNavigateTo={vi.fn()}
        onOpenEditor={vi.fn()}
        onStartRename={vi.fn()}
        onDownload={vi.fn()}
        onDownloadArchive={vi.fn()}
        onExtractArchive={vi.fn()}
        extractingArchive={null}
        onChangePermissions={vi.fn()}
        onShowProperties={vi.fn()}
        onDelete={vi.fn()}
        t={t}
      />,
    )

    fireEvent.click(screen.getByText('使用外部编辑器打开'))
    expect(onStartExternalEdit).toHaveBeenCalledWith(sampleFiles[1], 'default')
  })

  it('FilesModule supports clipboard path jump, chunked hex preview (>10MB), batch rename, diff compare, and external edit', async () => {
    render(<FilesModule serverId="srv-1" isConnected />)

    await waitFor(() => {
      expect(screen.getByText('large.bin')).toBeTruthy()
      expect(screen.getByText('alpha.txt')).toBeTruthy()
      expect(screen.getByText('beta.txt')).toBeTruthy()
    })

    // 1. Chunked Hex Preview (>10MB binary file)
    const largeRow = screen.getByText('large.bin').closest('tr') as HTMLElement
    fireEvent.doubleClick(largeRow)

    await waitFor(() => {
      const viewer = screen.getByTestId('mock-universal-viewer')
      expect(viewer.getAttribute('data-filename')).toBe('large.bin')
      expect(viewer.getAttribute('data-mode')).toBe('hex')
      expect(viewer.getAttribute('data-totalsize')).toBe(String(12 * 1024 * 1024))
      expect(mockSshService.readFileChunk).toHaveBeenCalledWith('srv-1', '/home/user/large.bin', 0, 64)
    })
    expect(mockSshService.readBinaryFile).not.toHaveBeenCalledWith('srv-1', '/home/user/large.bin')

    // Close preview dialog
    fireEvent.keyDown(document, { key: 'Escape' })
    const closeBtn = document.querySelector('[data-slot="dialog-close"]') as HTMLElement | null
    if (closeBtn) fireEvent.click(closeBtn)

    // 2. External Edit on single file via context menu
    const alphaRow = screen.getByText('alpha.txt').closest('tr') as HTMLElement
    fireEvent.contextMenu(alphaRow, { clientX: 80, clientY: 80 })
    fireEvent.click(await screen.findByText('使用外部编辑器打开'))
    await waitFor(() => {
      expect(mockSshService.startExternalEdit).toHaveBeenCalledWith(
        'srv-1',
        '/home/user/alpha.txt',
        'default',
        50 * 1024 * 1024,
      )
    })

    // 3. Multi-select alpha.txt & beta.txt -> File Compare
    fireEvent.mouseDown(alphaRow, { button: 0 })
    const betaRow = screen.getByText('beta.txt').closest('tr') as HTMLElement
    fireEvent.mouseDown(betaRow, { button: 0, ctrlKey: true })
    fireEvent.contextMenu(betaRow, { clientX: 90, clientY: 90 })

    fireEvent.click(await screen.findByText('对比选中文件'))
    await waitFor(() => {
      expect(screen.getByTestId('mock-file-diff-dialog').textContent).toContain('alpha.txt vs beta.txt')
      expect(mockSshService.readBinaryFile).toHaveBeenCalledWith('srv-1', '/home/user/alpha.txt')
      expect(mockSshService.readBinaryFile).toHaveBeenCalledWith('srv-1', '/home/user/beta.txt')
    })

    // Close diff dialog, select 3 files (large.bin + alpha.txt + beta.txt) -> passes all 3 candidates
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(largeRow, { button: 0, ctrlKey: true })
    fireEvent.contextMenu(betaRow, { clientX: 90, clientY: 90 })
    expect(await screen.findByText(/已选 3 个 · 可切换/)).toBeTruthy()
    fireEvent.click(screen.getByText('对比选中文件'))
    await waitFor(() => {
      expect(screen.getByTestId('mock-file-diff-dialog').getAttribute('data-candidates')).toBe('3')
    })

    // Close diff dialog and trigger Batch Rename
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.contextMenu(betaRow, { clientX: 90, clientY: 90 })
    fireEvent.click(await screen.findByText(/batch_rename_title/))
    await waitFor(() => {
      expect(screen.getAllByText('batch_rename_title').length).toBeGreaterThanOrEqual(1)
    })
    const batchClose = document.querySelector('[data-slot="dialog-close"]') as HTMLElement | null
    if (batchClose) fireEvent.click(batchClose)

    // 4. Clipboard Path Jump (empty vs valid directory)
    mockReadClipboardPath.mockResolvedValueOnce(null)
    fireEvent.click(screen.getByTitle('sftp_clipboard_path_jump'))
    await waitFor(() => {
      expect(mockToast.info).toHaveBeenCalledWith('sftp_clipboard_path_empty')
    })

    mockReadClipboardPath.mockResolvedValueOnce('/var/log')
    mockSshService.statInfo.mockResolvedValueOnce({
      type: 'directory',
      size: 0,
      permissions: 'rwxr-xr-x',
      modifiedTime: '',
      owner: 'root',
      group: 'root',
    })
    fireEvent.click(screen.getByTitle('sftp_clipboard_path_jump'))
    await waitFor(() => {
      expect(mockSshService.listFiles).toHaveBeenCalledWith('srv-1', '/var/log')
    })
  })

  it('FilesModule supports Ctrl+A (excluding ..), Shift+Click range select, Ctrl+Shift+N, and prunes hidden selections when showHidden toggles off', async () => {
    const filesWithParentAndHidden: FileEntry[] = [
      {
        name: '..',
        path: '/home',
        isDirectory: true,
        size: 0,
        permissions: 'drwxr-xr-x',
        modifiedTime: '',
        owner: 'user',
        group: 'user',
      },
      {
        name: '.env',
        path: '/home/user/.env',
        isDirectory: false,
        size: 20,
        permissions: '-rw-------',
        modifiedTime: '2026-01-01T00:00:00Z',
        owner: 'user',
        group: 'user',
      },
      ...sampleFiles,
    ]
    mockSshService.listFiles.mockResolvedValue(filesWithParentAndHidden)

    render(<FilesModule serverId="srv-1" isConnected />)

    await waitFor(() => {
      expect(screen.getByText('alpha.txt')).toBeTruthy()
      expect(screen.getByText('..')).toBeTruthy()
      expect(screen.getByText('.env')).toBeTruthy()
    })

    // Ctrl+A selects all files except '..'
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true })
    await waitFor(() => {
      const parentRow = screen.getByText('..').closest('tr') as HTMLElement
      const envRow = screen.getByText('.env').closest('tr') as HTMLElement
      const alphaRow = screen.getByText('alpha.txt').closest('tr') as HTMLElement
      expect(parentRow.className).not.toContain('is-selected')
      expect(envRow.className).toContain('is-selected')
      expect(alphaRow.className).toContain('is-selected')
    })

    // Toggle showHidden OFF -> .env is hidden and pruned from selection
    fireEvent.click(screen.getByTitle('sftp_hide_hidden'))
    await waitFor(() => {
      expect(screen.queryByText('.env')).toBeNull()
    })
    // Toggle showHidden back ON -> .env was pruned from selectedFiles (stays unselected)
    fireEvent.click(screen.getByTitle('sftp_show_hidden'))
    await waitFor(() => {
      const envRow = screen.getByText('.env').closest('tr') as HTMLElement
      expect(envRow.className).not.toContain('is-selected')
    })
    fireEvent.click(screen.getByTitle('sftp_hide_hidden'))
    await waitFor(() => {
      expect(screen.queryByText('.env')).toBeNull()
    })
    // Shift+Click range select between alpha.txt and large.bin
    const alphaRow = screen.getByText('alpha.txt').closest('tr') as HTMLElement
    const betaRow = screen.getByText('beta.txt').closest('tr') as HTMLElement
    const largeRow = screen.getByText('large.bin').closest('tr') as HTMLElement
    fireEvent.mouseDown(alphaRow, { button: 0 })
    fireEvent.mouseDown(largeRow, { button: 0, shiftKey: true })
    await waitFor(() => {
      expect(alphaRow.className).toContain('is-selected')
      expect(betaRow.className).toContain('is-selected')
      expect(largeRow.className).toContain('is-selected')
    })

    // Ctrl+Shift+N opens inline new folder input
    fireEvent.keyDown(window, { key: 'N', ctrlKey: true, shiftKey: true })
    await waitFor(() => {
      expect(screen.getByPlaceholderText('fs_new_name_placeholder')).toBeTruthy()
    })
  })

  it('FilesModule disables preview Save until dirty and passes loadText in diffCandidates', async () => {
    render(<FilesModule serverId="srv-1" isConnected />)

    await waitFor(() => {
      expect(screen.getByText('alpha.txt')).toBeTruthy()
    })

    // Open alpha.txt in edit mode (double click editable text file)
    const alphaRow = screen.getByText('alpha.txt').closest('tr') as HTMLElement
    fireEvent.doubleClick(alphaRow)

    const editor = (await screen.findByTestId('mock-code-editor')) as HTMLTextAreaElement
    const saveBtn = screen.getByTitle('fs_save') as HTMLButtonElement
    expect(saveBtn.disabled).toBe(true)

    fireEvent.change(editor, { target: { value: 'hello world modified' } })
    await waitFor(() => {
      expect((screen.getByTitle('fs_save') as HTMLButtonElement).disabled).toBe(false)
    })

    // Close preview (handleClosePreview resets editDirty and editContent)
    fireEvent.keyDown(document, { key: 'Escape' })
    const closeBtn = document.querySelector('[data-slot="dialog-close"]') as HTMLElement | null
    if (closeBtn) fireEvent.click(closeBtn)
    await waitFor(() => {
      expect(screen.queryByTestId('mock-code-editor')).toBeNull()
    })

    // Multi-select alpha.txt & beta.txt -> FileDiffDialog receives candidates with loadText
    fireEvent.mouseDown(alphaRow, { button: 0 })
    const betaRow = screen.getByText('beta.txt').closest('tr') as HTMLElement
    fireEvent.mouseDown(betaRow, { button: 0, ctrlKey: true })
    fireEvent.contextMenu(betaRow, { clientX: 90, clientY: 90 })
    fireEvent.click(await screen.findByText('对比选中文件'))

    await waitFor(() => {
      const diffDlg = screen.getByTestId('mock-file-diff-dialog')
      expect(diffDlg.getAttribute('data-has-loadtext')).toBe('true')
    })
  })

  it('FilesModule FTP mode skips getHomeDirectory, enforces 10MB preview limit, and hides archive actions', async () => {
    useAppStore.setState({
      servers: [
        {
          id: 'srv-ftp',
          name: 'FTP Server',
          host: 'ftp.example.com',
          port: 21,
          username: 'ftpuser',
          authType: 'password',
          fileTransferConfig: JSON.stringify({ protocol: 'ftp' }),
        } as never,
      ],
    })
    const ftpFiles: FileEntry[] = [
      {
        name: 'logs',
        path: '/logs',
        isDirectory: true,
        size: 0,
        permissions: 'drwxr-xr-x',
        modifiedTime: '2026-01-01T00:00:00Z',
      },
      {
        name: 'release.tar.gz',
        path: '/release.tar.gz',
        isDirectory: false,
        size: 1024,
        permissions: '-rw-r--r--',
        modifiedTime: '2026-01-01T00:00:00Z',
      },
      {
        name: 'huge.txt',
        path: '/huge.txt',
        isDirectory: false,
        size: 12 * 1024 * 1024,
        permissions: '-rw-r--r--',
        modifiedTime: '2026-01-01T00:00:00Z',
      },
    ]
    mockSshService.listFiles.mockImplementation(async (_sid: string, dirPath: string) => {
      if (dirPath === '/') return ftpFiles
      return []
    })

    render(<FilesModule serverId="srv-ftp" isConnected />)

    await waitFor(() => {
      expect(screen.getAllByText('logs').some((el) => Boolean(el.closest('tr')))).toBe(true)
      expect(screen.getByText('huge.txt')).toBeTruthy()
    })
    expect(mockSshService.getHomeDirectory).not.toHaveBeenCalled()
    expect(mockSshService.listFiles).toHaveBeenCalledWith('srv-ftp', '/')

    // Previewing 12MB text file hits FTP 10MB preview limit
    const hugeRow = screen.getByText('huge.txt').closest('tr') as HTMLElement
    fireEvent.doubleClick(hugeRow)
    await waitFor(() => {
      expect(mockToast.warning).toHaveBeenCalledWith('fs_preview_too_large (fs_preview_download_hint)')
    })
    expect(mockSshService.readBinaryFile).not.toHaveBeenCalled()

    // Context menu hides Archive Download on directory and Extract Archive on archive
    const logsRow = screen.getAllByText('logs').find((el) => Boolean(el.closest('tr')))!.closest('tr') as HTMLElement
    fireEvent.contextMenu(logsRow, { clientX: 80, clientY: 80 })
    await waitFor(() => {
      expect(screen.getByText('fs_copy_path')).toBeTruthy()
    })
    expect(screen.queryByTestId('file-menu-archive-trigger')).toBeNull()

    const archiveRow = screen.getByText('release.tar.gz').closest('tr') as HTMLElement
    fireEvent.contextMenu(archiveRow, { clientX: 80, clientY: 80 })
    await waitFor(() => {
      expect(screen.getByText('fs_copy_path')).toBeTruthy()
    })
    expect(screen.queryByText('sftp_extract_archive')).toBeNull()
  })
})
