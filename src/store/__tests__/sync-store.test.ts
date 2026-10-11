import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  useSyncStore,
  GITEE_TOKEN_STORAGE_KEY,
  GITHUB_TOKEN_STORAGE_KEY,
  SYNC_PROVIDER_STORAGE_KEY,
  SYNC_TERMINAL_BACKGROUNDS_STORAGE_KEY,
} from '../sync-store'
import { useAppStore } from '@/store'

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
})
