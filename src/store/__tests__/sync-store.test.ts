import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  useSyncStore,
  GITEE_TOKEN_STORAGE_KEY,
  GITHUB_TOKEN_STORAGE_KEY,
  SYNC_PROVIDER_STORAGE_KEY,
  SYNC_TERMINAL_BACKGROUNDS_STORAGE_KEY,
} from '../sync-store'
import { useAppStore } from '@/store'
import * as giteeAdapter from '@/services/sync/gitee-sync-adapter'

const { mockRemote, mockSshService } = vi.hoisted(() => {
  return {
    mockRemote: { content: '' },
    mockSshService: {
      listServers: vi.fn(async () => []),
      listTrashServers: vi.fn(async () => []),
      listServersForSync: vi.fn(async () => [
        { id: 'srv-1', name: 'Test Server', host: '192.168.1.10', port: 22, username: 'root', authType: 'password', password: 'secretpassword', tags: '["prod"]' },
      ]),
      listGroups: vi.fn(async () => [{ id: 'grp-1', name: 'Production', parentId: null }]),
      listKeys: vi.fn(async () => []),
      listKeysForSync: vi.fn(async () => [{ id: 'key-1', name: 'My Key', keyType: 'private', privateKeyContent: 'PRIVATE KEY CONTENT' }]),
      addServer: vi.fn(async () => ({ success: true })),
      updateServer: vi.fn(async () => ({ success: true })),
      addGroup: vi.fn(async () => ({ success: true })),
      addKey: vi.fn(async () => ({ success: true })),
      updateKey: vi.fn(async () => ({ success: true })),
      listTags: vi.fn(async () => ['prod']),
      listTagsAll: vi.fn(async () => [{ id: 'tag-1', name: 'prod', createdAt: 1000 }]),
      restoreTags: vi.fn(async () => 1),
      listKnownHosts: vi.fn(async () => [{ host: '192.168.1.10', port: 22, keyType: 'ssh-ed25519', keyValue: 'AAAAC3Nza...', fingerprint: 'SHA256:abc', createdAt: 1000 }]),
      restoreKnownHosts: vi.fn(async () => 1),
      listFavCmds: vi.fn(async () => [{ id: 'fav-1', cmd: 'docker ps', desc: 'List containers', createdAt: 1000 }]),
      restoreFavCmds: vi.fn(async () => ({ success: true })),
      listBookmarksAll: vi.fn(async () => [{ id: 'bm-1', serverId: 'srv-1', path: '/var/log/syslog', alias: 'Syslog', createdAt: 1000 }]),
      restoreBookmarks: vi.fn(async () => ({ success: true })),
      listBackgroundsForSync: vi.fn(async () => [{ name: 'bg-1.mp4', mediaType: 'video' as const, dataBase64: 'AAAA' }]),
      restoreBackgrounds: vi.fn(async () => 1),
    },
  }
})

vi.mock('@/services/sync/gitee-sync-adapter', () => ({
  verifyGiteeToken: vi.fn(async (token: string) => {
    if (token === 'valid_gitee_token') {
      return {
        success: true,
        user: { id: 1, login: 'gitee_user', name: 'Gitee Tester', avatar_url: '', html_url: '' },
      }
    }
    return { success: false, error: 'Invalid Gitee token' }
  }),
  uploadBackupFile: vi.fn(async (_token: string, _owner: string, content: string) => {
    mockRemote.content = content
    return { success: true, sha: 'gitee_sha123' }
  }),
  downloadBackupFile: vi.fn(async () => ({
    success: true,
    content: mockRemote.content,
  })),
  getBackupHistory: vi.fn(async () => ({ success: true, history: [] })),
}))

vi.mock('@/services/sync/github-sync-adapter', () => ({
  verifyGitHubToken: vi.fn(async (token: string) => {
    if (token === 'valid_github_token') {
      return {
        success: true,
        user: { id: 2, login: 'github_user', name: 'GitHub Tester', avatar_url: '', html_url: '' },
      }
    }
    return { success: false, error: 'Invalid GitHub token' }
  }),
  uploadBackupFile: vi.fn(async (_token: string, _owner: string, content: string) => {
    mockRemote.content = content
    return { success: true, sha: 'github_sha456' }
  }),
  downloadBackupFile: vi.fn(async () => ({
    success: true,
    content: mockRemote.content,
  })),
  getBackupHistory: vi.fn(async () => ({ success: true, history: [] })),
}))

vi.mock('@/services/ssh-service', () => ({
  sshService: mockSshService,
}))

describe('Sync Store (Dual Engine Gitee + GitHub & Full Profile E2EE)', () => {
  beforeEach(() => {
    localStorage.clear()
    mockRemote.content = ''
    useSyncStore.setState({
      provider: 'gitee',
      giteeToken: '',
      githubToken: '',
      masterPassword: '',
      syncPasswords: true,
      syncTerminalBackgrounds: true,
      giteeUser: null,
      githubUser: null,
      currentUser: null,
      currentToken: '',
      isConfigured: false,
      isSyncing: false,
      lastSyncTime: null,
      lastSyncResult: null,
      historyList: [],
    })
  })

  it('sets Gitee token and updates configured state on valid token', async () => {
    const res = await useSyncStore.getState().setGiteeToken('valid_gitee_token')
    expect(res.success).toBe(true)
    expect(useSyncStore.getState().isConfigured).toBe(true)
    expect(useSyncStore.getState().currentUser?.login).toBe('gitee_user')
    expect(localStorage.getItem(GITEE_TOKEN_STORAGE_KEY)).toBe('valid_gitee_token')
  })

  it('rejects invalid Gitee token', async () => {
    const res = await useSyncStore.getState().setGiteeToken('bad_token')
    expect(res.success).toBe(false)
    expect(useSyncStore.getState().isConfigured).toBe(false)
    expect(useSyncStore.getState().currentUser).toBeNull()
  })

  it('switches between Gitee and GitHub providers smoothly', async () => {
    // 绑定 Gitee
    await useSyncStore.getState().setGiteeToken('valid_gitee_token')
    expect(useSyncStore.getState().provider).toBe('gitee')
    expect(useSyncStore.getState().isConfigured).toBe(true)

    // 切换到 GitHub (尚未配置)
    useSyncStore.getState().setProvider('github')
    expect(useSyncStore.getState().provider).toBe('github')
    expect(useSyncStore.getState().isConfigured).toBe(false)
    expect(localStorage.getItem(SYNC_PROVIDER_STORAGE_KEY)).toBe('github')

    // 绑定 GitHub
    const resGh = await useSyncStore.getState().setGitHubToken('valid_github_token')
    expect(resGh.success).toBe(true)
    expect(useSyncStore.getState().isConfigured).toBe(true)
    expect(useSyncStore.getState().currentUser?.login).toBe('github_user')
    expect(localStorage.getItem(GITHUB_TOKEN_STORAGE_KEY)).toBe('valid_github_token')

    // 切回 Gitee 仍保持 Gitee 账号配置状态
    useSyncStore.getState().setProvider('gitee')
    expect(useSyncStore.getState().provider).toBe('gitee')
    expect(useSyncStore.getState().isConfigured).toBe(true)
    expect(useSyncStore.getState().currentUser?.login).toBe('gitee_user')
  })

  it('clears token per provider cleanly', async () => {
    await useSyncStore.getState().setGiteeToken('valid_gitee_token')
    useSyncStore.getState().clearGiteeToken()
    expect(useSyncStore.getState().isConfigured).toBe(false)
    expect(useSyncStore.getState().giteeToken).toBe('')
    expect(localStorage.getItem(GITEE_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('requires token and password before backup', async () => {
    const resWithoutToken = await useSyncStore.getState().backup('pwd')
    expect(resWithoutToken.success).toBe(false)
    expect(resWithoutToken.error).toContain('请先绑定并验证')

    await useSyncStore.getState().setGiteeToken('valid_gitee_token')
    const resWithoutPassword = await useSyncStore.getState().backup('')
    expect(resWithoutPassword.success).toBe(false)
    expect(resWithoutPassword.error).toContain('请先设置用于端到端加密的同步主密码')
  })

  it('allows toggling syncPasswords and persists preference', () => {
    expect(useSyncStore.getState().syncPasswords).toBe(true)
    useSyncStore.getState().setSyncPasswords(false)
    expect(useSyncStore.getState().syncPasswords).toBe(false)
    expect(localStorage.getItem('qshell_sync_include_credentials')).toBe('false')

    useSyncStore.getState().setSyncPasswords(true)
    expect(useSyncStore.getState().syncPasswords).toBe(true)
    expect(localStorage.getItem('qshell_sync_include_credentials')).toBe('true')
  })

  it('allows toggling syncTerminalBackgrounds and persists preference', () => {
    expect(useSyncStore.getState().syncTerminalBackgrounds).toBe(true)
    useSyncStore.getState().setSyncTerminalBackgrounds(false)
    expect(useSyncStore.getState().syncTerminalBackgrounds).toBe(false)
    expect(localStorage.getItem(SYNC_TERMINAL_BACKGROUNDS_STORAGE_KEY)).toBe('false')

    useSyncStore.getState().setSyncTerminalBackgrounds(true)
    expect(useSyncStore.getState().syncTerminalBackgrounds).toBe(true)
    expect(localStorage.getItem(SYNC_TERMINAL_BACKGROUNDS_STORAGE_KEY)).toBe('true')
  })

  it('performs full profile E2EE backup and restore across all assets', async () => {
    // 1. 设置偏好与状态
    useAppStore.setState({
      theme: 'dark',
      uiStyle: 'compact',
      terminalFontSize: 16,
      terminalFontFamily: '"Cascadia Code", monospace',
      terminalThemeId: 'custom-1',
      customTerminalThemes: [
        {
          id: 'custom-1',
          name: 'Cyber Theme',
          type: 'dark',
          ui: { background: '#000000', foreground: '#ffffff', cursor: '#00ff00', cursorForeground: '#000000', selection: '#333333', selectionForeground: '#ffffff' },
          background: {
            type: 'video',
            videoPath: 'C:\\Users\\Test\\AppData\\Roaming\\com.qshell.app\\backgrounds\\bg-cyber.mp4',
            opacity: 0.8,
          },
          ansi: { black: '#0', red: '#1', green: '#2', yellow: '#3', blue: '#4', magenta: '#5', cyan: '#6', white: '#7', brightBlack: '#8', brightRed: '#9', brightGreen: '#a', brightYellow: '#b', brightBlue: '#c', brightMagenta: '#d', brightCyan: '#e', brightWhite: '#f' },
        },
      ],
      terminalHighlightEnabled: true,
      terminalHighlightRules: [],
    })

    localStorage.setItem('trae:recent-connections', JSON.stringify([{ serverId: 'srv-1', at: 123456 }]))
    localStorage.setItem('trae:command-history', JSON.stringify(['uptime', 'top']))
    localStorage.setItem('qshell_cmd_favorites', JSON.stringify([{ cmd: 'ls -la', desc: 'list files' }]))

    // 2. 绑定 Token 与主密码
    await useSyncStore.getState().setGiteeToken('valid_gitee_token')
    useSyncStore.getState().setMasterPassword('MyMasterPassword123!')

    // 3. 执行备份
    const backupRes = await useSyncStore.getState().backup()
    expect(backupRes.success).toBe(true)
    expect(mockRemote.content).toBeTruthy()

    // 4. 重置本地偏好和历史以验证恢复效果
    useAppStore.setState({
      theme: 'light',
      uiStyle: 'modern',
      terminalFontSize: 14,
      terminalThemeId: 'default',
      customTerminalThemes: [],
    })
    localStorage.removeItem('trae:recent-connections')
    localStorage.removeItem('trae:command-history')
    localStorage.removeItem('qshell_cmd_favorites')

    // 5. 执行恢复
    const restoreRes = await useSyncStore.getState().restore()
    expect(restoreRes.success).toBe(true)
    expect(restoreRes.stats).toBeDefined()
    expect(restoreRes.stats?.servers).toBe(1)
    expect(restoreRes.stats?.groups).toBe(1)
    expect(restoreRes.stats?.sshKeys).toBe(1)
    expect(restoreRes.stats?.tags).toBe(1)
    expect(restoreRes.stats?.knownHosts).toBe(1)
    expect(restoreRes.stats?.favCmds).toBe(1)
    expect(restoreRes.stats?.bookmarks).toBe(1)
    expect(restoreRes.stats?.backgrounds).toBe(1)

    // 6. 验证恢复后的本地偏好与历史记录
    expect(useAppStore.getState().theme).toBe('dark')
    expect(useAppStore.getState().uiStyle).toBe('compact')
    expect(useAppStore.getState().terminalFontSize).toBe(16)
    expect(useAppStore.getState().terminalThemeId).toBe('custom-1')
    expect(useAppStore.getState().customTerminalThemes.length).toBe(1)

    expect(JSON.parse(localStorage.getItem('trae:recent-connections') || '[]')).toEqual([{ serverId: 'srv-1', at: 123456 }])
    expect(JSON.parse(localStorage.getItem('trae:command-history') || '[]')).toEqual(['uptime', 'top'])
    expect(JSON.parse(localStorage.getItem('qshell_cmd_favorites') || '[]')).toEqual([{ cmd: 'ls -la', desc: 'list files' }])

    // 验证底层 restore 函数均被调用
    expect(mockSshService.restoreTags).toHaveBeenCalled()
    expect(mockSshService.restoreKnownHosts).toHaveBeenCalled()
    expect(mockSshService.restoreFavCmds).toHaveBeenCalled()
    expect(mockSshService.restoreBookmarks).toHaveBeenCalled()
    expect(mockSshService.restoreBackgrounds).toHaveBeenCalled()
  })

  it('compares cloud and local configuration on startup and only syncs when inconsistent', async () => {
    const store = useSyncStore.getState()
    await store.setToken('valid_gitee_token', 'gitee')
    store.setMasterPassword('auto_sync_pwd')
    expect(store.autoSync).toBe(true)

    const restoreSpy = vi.spyOn(useSyncStore.getState(), 'restore')
    const backupSpy = vi.spyOn(useSyncStore.getState(), 'backup')

    // 1. 当配置指纹完全一致时：零同步请求
    const matchingPayload = {
      format: 'qshell-backup-package',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      servers: [{ id: 'srv-1', name: 'Test Server', host: '192.168.1.10', port: 22, username: 'root', tags: '["prod"]' }],
      groups: [{ id: 'grp-1', name: 'Production', parentId: null }],
      sshKeys: [{ id: 'key-1', name: 'My Key', keyType: 'private' }],
    }
    const encryptedMatching = await import('@/utils/crypto-sync').then((m) =>
      m.encryptData(JSON.stringify(matchingPayload), 'auto_sync_pwd')
    )
    vi.mocked(giteeAdapter.getBackupHistory).mockResolvedValueOnce({
      success: true,
      history: [{ sha: 'sha-1', message: 'test', date: new Date().toISOString() }],
    })
    vi.mocked(giteeAdapter.downloadBackupFile).mockResolvedValueOnce({
      success: true,
      content: encryptedMatching,
    })

    await useSyncStore.getState().checkStartupSync()
    expect(restoreSpy).not.toHaveBeenCalled()
    expect(backupSpy).not.toHaveBeenCalled()

    // 2. 当云端存在更新快照且与本地不一致时：自动还原到本地
    const newerCloudPayload = {
      ...matchingPayload,
      servers: [
        ...matchingPayload.servers,
        { id: 'srv-2', name: 'New Cloud Server', host: '192.168.1.20', port: 22, username: 'root' },
      ],
    }
    const encryptedNewer = await import('@/utils/crypto-sync').then((m) =>
      m.encryptData(JSON.stringify(newerCloudPayload), 'auto_sync_pwd')
    )
    vi.mocked(giteeAdapter.getBackupHistory).mockResolvedValueOnce({
      success: true,
      history: [{ sha: 'sha-cloud-newer', message: 'cloud newer', date: new Date(Date.now() + 10000).toISOString() }],
    })
    vi.mocked(giteeAdapter.downloadBackupFile).mockResolvedValueOnce({
      success: true,
      content: encryptedNewer,
    })
    useSyncStore.setState({
      lastSyncTime: new Date(Date.now() - 50000).toISOString(),
    })

    await useSyncStore.getState().checkStartupSync()
    expect(restoreSpy).toHaveBeenCalledTimes(1)

    // 3. 当禁用 autoSync 时：启动检测跳过
    restoreSpy.mockClear()
    backupSpy.mockClear()
    useSyncStore.getState().setAutoSync(false)
    await useSyncStore.getState().checkStartupSync()
    expect(restoreSpy).not.toHaveBeenCalled()
    expect(backupSpy).not.toHaveBeenCalled()
  })

  it('should paginate backup history starting with 3 snapshots and support load more and collapse', async () => {
    useSyncStore.setState({
      provider: 'gitee',
      currentToken: 'valid_gitee_token',
      currentUser: { id: 1, login: 'gitee_user', name: 'Gitee Tester', avatar_url: '', html_url: '' },
      historyLimit: 3,
      hasMoreHistory: false,
    })

    const mock3Snapshots = [
      { sha: 'sha-1', message: 'v1', date: '2026-10-15T10:00:00Z' },
      { sha: 'sha-2', message: 'v2', date: '2026-10-15T11:00:00Z' },
      { sha: 'sha-3', message: 'v3', date: '2026-10-15T12:00:00Z' },
    ]
    vi.mocked(giteeAdapter.getBackupHistory).mockResolvedValueOnce({
      success: true,
      history: mock3Snapshots,
    })

    await useSyncStore.getState().fetchHistory()
    expect(giteeAdapter.getBackupHistory).toHaveBeenCalledWith('valid_gitee_token', 'gitee_user', undefined, undefined, 3)
    expect(useSyncStore.getState().historyList).toHaveLength(3)
    expect(useSyncStore.getState().hasMoreHistory).toBe(true)

    // Load more history (increments limit by 10 -> 13)
    const mockMoreSnapshots = [
      ...mock3Snapshots,
      { sha: 'sha-4', message: 'v4', date: '2026-10-15T13:00:00Z' },
    ]
    vi.mocked(giteeAdapter.getBackupHistory).mockResolvedValueOnce({
      success: true,
      history: mockMoreSnapshots,
    })

    await useSyncStore.getState().loadMoreHistory()
    expect(giteeAdapter.getBackupHistory).toHaveBeenCalledWith('valid_gitee_token', 'gitee_user', undefined, undefined, 13)
    expect(useSyncStore.getState().historyLimit).toBe(13)
    expect(useSyncStore.getState().historyList).toHaveLength(4)
    // Returned 4 items, which is < 13, so hasMoreHistory should be false
    expect(useSyncStore.getState().hasMoreHistory).toBe(false)

    // Reset history limit back to 3
    vi.mocked(giteeAdapter.getBackupHistory).mockResolvedValueOnce({
      success: true,
      history: mock3Snapshots,
    })

    await useSyncStore.getState().resetHistoryLimit()
    expect(giteeAdapter.getBackupHistory).toHaveBeenCalledWith('valid_gitee_token', 'gitee_user', undefined, undefined, 3)
    expect(useSyncStore.getState().historyLimit).toBe(3)
    expect(useSyncStore.getState().historyList).toHaveLength(3)
  })

  it('successfully backs up and restores pathBookmarks, file sort preferences, and AI settings', async () => {
    useSyncStore.setState({
      provider: 'gitee',
      currentToken: 'valid_gitee_token',
      currentUser: { id: 1, login: 'gitee_user', name: 'Gitee Tester', avatar_url: '', html_url: '' },
      masterPassword: 'sync_test_pwd_123456',
    })

    // Setup initial store preferences and bookmarks
    useAppStore.setState({
      sftpLocalSortField: 'size',
      sftpLocalSortOrder: 'desc',
      sftpRemoteSortField: 'modified',
      sftpRemoteSortOrder: 'desc',
      workspaceFileSortField: 'size',
      workspaceFileSortDirection: 'desc',
      workspaceFileShowHidden: false,
      pathBookmarks: {
        'sftp:local': ['/local/dir1', '/local/dir2'],
        'sftp:srv-1': ['/remote/var/log'],
        'workspace:srv-1': ['/var/www'],
      },
    })

    localStorage.setItem('qshell_ai_settings', JSON.stringify({ provider: 'deepseek', apiKey: 'sk-test-ai' }))
    localStorage.setItem('qshell_ai_master_enabled', 'true')

    // 1. Backup
    const backupRes = await useSyncStore.getState().backup()
    expect(backupRes.success).toBe(true)

    // 2. Wipe local store and localStorage
    useAppStore.setState({
      sftpLocalSortField: 'name',
      sftpLocalSortOrder: 'asc',
      sftpRemoteSortField: 'name',
      sftpRemoteSortOrder: 'asc',
      workspaceFileSortField: 'name',
      workspaceFileSortDirection: 'asc',
      workspaceFileShowHidden: true,
      pathBookmarks: {},
    })
    localStorage.clear()

    // 3. Restore
    const restoreRes = await useSyncStore.getState().restore('sync_test_pwd_123456')
    expect(restoreRes.success).toBe(true)
    expect(restoreRes.stats?.pathBookmarks).toBe(4)

    // 4. Verify restored store state
    const appState = useAppStore.getState()
    expect(appState.sftpLocalSortField).toBe('size')
    expect(appState.sftpLocalSortOrder).toBe('desc')
    expect(appState.sftpRemoteSortField).toBe('modified')
    expect(appState.sftpRemoteSortOrder).toBe('desc')
    expect(appState.workspaceFileSortField).toBe('size')
    expect(appState.workspaceFileSortDirection).toBe('desc')
    expect(appState.workspaceFileShowHidden).toBe(false)
    expect(appState.pathBookmarks['sftp:local']).toEqual(['/local/dir1', '/local/dir2'])
    expect(appState.pathBookmarks['sftp:srv-1']).toEqual(['/remote/var/log'])
    expect(appState.pathBookmarks['workspace:srv-1']).toEqual(['/var/www'])

    // 5. Verify restored localStorage backward compatibility
    expect(JSON.parse(localStorage.getItem('sftp-bookmarks-local') || '[]')).toEqual(['/local/dir1', '/local/dir2'])
    expect(JSON.parse(localStorage.getItem('sftp-bookmarks-srv-1') || '[]')).toEqual(['/remote/var/log'])
    expect(JSON.parse(localStorage.getItem('file-bookmarks-srv-1') || '[]')).toEqual(['/var/www'])
    expect(localStorage.getItem('qshell.sftp.local.sortField')).toBe('size')
    expect(localStorage.getItem('qshell.sftp.local.sortOrder')).toBe('desc')
    expect(localStorage.getItem('qshell.sftp.remote.sortField')).toBe('modified')
    expect(localStorage.getItem('qshell.sftp.remote.sortOrder')).toBe('desc')
    expect(localStorage.getItem('qshell.workspace.files.sortField')).toBe('size')
    expect(localStorage.getItem('qshell.workspace.files.sortDirection')).toBe('desc')
    expect(localStorage.getItem('qshell.workspace.files.showHidden')).toBe('false')
    expect(JSON.parse(localStorage.getItem('qshell_ai_settings') || '{}')).toEqual({ provider: 'deepseek', apiKey: 'sk-test-ai' })
    expect(localStorage.getItem('qshell_ai_master_enabled')).toBe('true')
  })
})


