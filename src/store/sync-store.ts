/**
 * src/store/sync-store.ts
 *
 * Qshell 云端多端同步状态中心（Gitee + GitHub 双擎驱动）：
 * 1. 采用零知识端到端加密（E2EE），主密码绝不上云；
 * 2. 支持自由切换 Gitee（国内 15ms 秒级直连）与 GitHub（全球开发者首选）；
 * 3. 独立持久化两个平台的 Token、用户信息与最后同步时间；
 * 4. 从云端拉取、解密并原子性还原到本地 SQLite 与 Zustand Store；
 * 5. 全量同步：服务器、分组、SSH密钥库、标签目录、已知主机指纹、收藏指令、书签、终端背景媒体与全量偏好设置；
 * 6. 历史版本快照回滚能力（基于平台原生 Git Commit 历史）。
 */

import { create } from 'zustand'
import { encryptData, decryptData } from '@/utils/crypto-sync'
import * as giteeAdapter from '@/services/sync/gitee-sync-adapter'
import * as githubAdapter from '@/services/sync/github-sync-adapter'
import { sshService } from '@/services/ssh-service'
import { useAppStore } from '@/store'
import { loadLegacyBookmarks } from '@/store/slices/sftp-slice'
import { translate } from '@/i18n'
import type { Server, ServerGroup, LogBookmark } from '@/types'
import type {
  SshKey,
  TagRow,
  KnownHostRecord,
  FavoriteCommand,
  SyncBackgroundItem,
} from '@/services/api/types'
import type { TerminalTheme } from '@/utils/terminal-themes'

export type SyncProvider = 'gitee' | 'github'

export interface SyncUser {
  id: number
  login: string
  name: string
  avatar_url: string
  html_url: string
}

export interface BackupCommitInfo {
  sha: string
  message: string
  date: string
}

export const SYNC_PROVIDER_STORAGE_KEY = 'qshell_sync_provider'
export const GITEE_TOKEN_STORAGE_KEY = 'qshell_gitee_sync_token'
export const GITHUB_TOKEN_STORAGE_KEY = 'qshell_github_sync_token'
export const GITEE_LAST_SYNC_STORAGE_KEY = 'qshell_gitee_last_sync_time'
export const GITHUB_LAST_SYNC_STORAGE_KEY = 'qshell_github_last_sync_time'
export const MASTER_PASSWORD_STORAGE_KEY = 'qshell_sync_master_password'
export const SYNC_INCLUDE_CREDENTIALS_STORAGE_KEY = 'qshell_sync_include_credentials'
export const SYNC_TERMINAL_BACKGROUNDS_STORAGE_KEY = 'qshell_sync_terminal_backgrounds'
export const AUTO_SYNC_STORAGE_KEY = 'qshell_sync_auto_sync'

export interface RestoreStats {
  servers: number
  groups: number
  sshKeys?: number
  tags?: number
  favCmds?: number
  knownHosts?: number
  bookmarks?: number
  backgrounds?: number
  pathBookmarks?: number
}

export interface SyncPayload {
  format: 'qshell-backup-package'
  version: string
  timestamp: string
  servers: Server[]
  groups: ServerGroup[]
  sshKeys?: SshKey[]
  preferences?: Record<string, unknown>
  favorites?: unknown[]
  favCmds?: FavoriteCommand[]
  tags?: TagRow[]
  knownHosts?: KnownHostRecord[]
  bookmarks?: LogBookmark[]
  backgrounds?: SyncBackgroundItem[]
  recentConnections?: Array<{ serverId: string; at: number }>
  commandHistory?: string[]
  pathBookmarks?: Record<string, string[]>
  aiSettings?: unknown
  aiConfiguredProviders?: unknown[]
  aiMasterEnabled?: boolean
}

export interface SyncState {
  provider: SyncProvider
  giteeToken: string
  githubToken: string
  masterPassword: string
  syncPasswords: boolean
  syncTerminalBackgrounds: boolean
  autoSync: boolean

  giteeUser: SyncUser | null
  githubUser: SyncUser | null

  // 活跃提供商的聚合计算状态
  currentUser: SyncUser | null
  currentToken: string
  isConfigured: boolean
  isSyncing: boolean
  lastSyncTime: string | null
  lastSyncResult: { success: boolean; msg: string } | null
  historyList: BackupCommitInfo[]
  historyLimit: number
  hasMoreHistory: boolean
  isLoadingMoreHistory: boolean
  isSyncDialogOpen: boolean

  // Actions
  init: () => Promise<void>
  setProvider: (provider: SyncProvider) => void
  setToken: (token: string, targetProvider?: SyncProvider) => Promise<{ success: boolean; error?: string }>
  clearToken: (targetProvider?: SyncProvider) => void
  setMasterPassword: (pwd: string) => void
  clearMasterPassword: () => void
  setSyncPasswords: (enabled: boolean) => void
  setSyncTerminalBackgrounds: (enabled: boolean) => void
  setAutoSync: (enabled: boolean) => void
  triggerAutoSync: (source?: string) => void
  checkStartupSync: () => Promise<void>
  backup: (overridePassword?: string) => Promise<{ success: boolean; error?: string }>
  restore: (
    overridePassword?: string,
    commitSha?: string,
  ) => Promise<{ success: boolean; stats?: RestoreStats; error?: string }>
  fetchHistory: (limit?: number) => Promise<void>
  loadMoreHistory: () => Promise<void>
  resetHistoryLimit: () => Promise<void>
  openSyncDialog: () => void
  closeSyncDialog: () => void

  // 针对现有逻辑的别名兼容（确保原有 Gitee 单元测试及调用 100% 正常）
  setGiteeToken: (token: string) => Promise<{ success: boolean; error?: string }>
  clearGiteeToken: () => void
  backupToGitee: (overridePassword?: string) => Promise<{ success: boolean; error?: string }>
  restoreFromGitee: (
    overridePassword?: string,
    commitSha?: string,
  ) => Promise<{ success: boolean; stats?: RestoreStats; error?: string }>

  setGitHubToken: (token: string) => Promise<{ success: boolean; error?: string }>
  clearGitHubToken: () => void
  backupToGitHub: (overridePassword?: string) => Promise<{ success: boolean; error?: string }>
  restoreFromGitHub: (
    overridePassword?: string,
    commitSha?: string,
  ) => Promise<{ success: boolean; stats?: RestoreStats; error?: string }>
}

function getSavedItem(key: string): string {
  try {
    return localStorage.getItem(key)?.trim() || ''
  } catch {
    return ''
  }
}

function setSavedItem(key: string, val: string): void {
  try {
    localStorage.setItem(key, val)
  } catch {
    /* ignore */
  }
}

function removeSavedItem(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

function normalizeMediaPath(p: string | undefined): string | undefined {
  if (!p) return undefined
  if (p.startsWith('data:')) return p
  if (p.startsWith('media://')) return p
  const match = p.match(/(?:backgrounds[/\\]|^|asset:\/\/[^/]+\/|https?:\/\/[^/]+\/)([^/?#/\\]+\.[a-zA-Z0-9]+)(?:[?#]|$)/)
  if (match && match[1]) {
    return `media://${match[1]}`
  }
  return p
}

async function resolveMediaPath(p: string | undefined, isVideo = false): Promise<string | undefined> {
  if (!p) return undefined
  if (!p.startsWith('media://')) return p
  const filename = p.replace('media://', '')
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      const { appDataDir, join } = await import('@tauri-apps/api/path')
      const dir = await appDataDir()
      const localFilePath = await join(dir, 'backgrounds', filename)
      if (isVideo) {
        return localFilePath
      } else {
        const { convertFileSrc } = await import('@tauri-apps/api/core')
        return convertFileSrc(localFilePath)
      }
    } catch {
      return p
    }
  }
  return p
}

function computeConfigFingerprint(
  servers: any[],
  groups: any[],
  keys: any[],
): string {
  const normServers = (servers || [])
    .map((s) => ({
      id: s.id,
      name: s.name,
      host: s.host,
      port: s.port,
      username: s.username,
      groupId: s.groupId || '',
      tags: typeof s.tags === 'string' ? s.tags : JSON.stringify(s.tags || []),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const normGroups = (groups || [])
    .map((g) => ({ id: g.id, name: g.name, parentId: g.parentId || '' }))
    .sort((a, b) => a.id.localeCompare(b.id))

  const normKeys = (keys || [])
    .map((k) => ({ id: k.id, name: k.name, keyType: k.keyType }))
    .sort((a, b) => a.id.localeCompare(b.id))

  return JSON.stringify({ s: normServers, g: normGroups, k: normKeys })
}

export const useSyncStore = create<SyncState>((set, get) => ({
  provider: 'gitee',
  giteeToken: '',
  githubToken: '',
  masterPassword: '',
  syncPasswords: true,
  syncTerminalBackgrounds: true,
  autoSync: true,
  giteeUser: null,
  githubUser: null,
  currentUser: null,
  currentToken: '',
  isConfigured: false,
  isSyncing: false,
  lastSyncTime: null,
  lastSyncResult: null,
  historyList: [],
  historyLimit: 3,
  hasMoreHistory: false,
  isLoadingMoreHistory: false,
  isSyncDialogOpen: false,

  openSyncDialog: () => set({ isSyncDialogOpen: true }),
  closeSyncDialog: () => set({ isSyncDialogOpen: false }),

  init: async () => {
    let savedProvider: SyncProvider = 'gitee'
    try {
      const p = localStorage.getItem(SYNC_PROVIDER_STORAGE_KEY)
      if (p === 'github' || p === 'gitee') {
        savedProvider = p
      }
    } catch {
      /* ignore */
    }

    const savedGiteeToken = getSavedItem(GITEE_TOKEN_STORAGE_KEY)
    const savedGitHubToken = getSavedItem(GITHUB_TOKEN_STORAGE_KEY)
    const savedGiteeSyncTime = getSavedItem(GITEE_LAST_SYNC_STORAGE_KEY) || null
    const savedGitHubSyncTime = getSavedItem(GITHUB_LAST_SYNC_STORAGE_KEY) || null
    const savedMasterPassword = getSavedItem(MASTER_PASSWORD_STORAGE_KEY)
    let savedAutoSync = true
    try {
      const a = localStorage.getItem(AUTO_SYNC_STORAGE_KEY)
      if (a !== null) {
        savedAutoSync = a === 'true'
      }
    } catch {
      /* ignore */
    }

    const currentToken = savedProvider === 'gitee' ? savedGiteeToken : savedGitHubToken
    const currentSyncTime = savedProvider === 'gitee' ? savedGiteeSyncTime : savedGitHubSyncTime

    set({
      provider: savedProvider,
      giteeToken: savedGiteeToken,
      githubToken: savedGitHubToken,
      masterPassword: savedMasterPassword,
      syncPasswords: true,
      syncTerminalBackgrounds: true,
      autoSync: savedAutoSync,
      currentToken,
      isConfigured: Boolean(currentToken),
      lastSyncTime: currentSyncTime,
    })

    // 静默验证当前提供商令牌
    if (savedProvider === 'gitee' && savedGiteeToken) {
      const res = await giteeAdapter.verifyGiteeToken(savedGiteeToken)
      if (res.success && res.user) {
        set({ giteeUser: res.user, currentUser: res.user, isConfigured: true })
        void get().fetchHistory()
      } else {
        set({ isConfigured: false, giteeUser: null, currentUser: null })
      }
    } else if (savedProvider === 'github' && savedGitHubToken) {
      const res = await githubAdapter.verifyGitHubToken(savedGitHubToken)
      if (res.success && res.user) {
        set({ githubUser: res.user, currentUser: res.user, isConfigured: true })
        void get().fetchHistory()
      } else {
        set({ isConfigured: false, githubUser: null, currentUser: null })
      }
    }
  },

  setProvider: (newProvider: SyncProvider) => {
    setSavedItem(SYNC_PROVIDER_STORAGE_KEY, newProvider)
    const { giteeToken, githubToken, giteeUser, githubUser } = get()

    const currentToken = newProvider === 'gitee' ? giteeToken : githubToken
    const currentUser = newProvider === 'gitee' ? giteeUser : githubUser
    const lastSyncTimeKey = newProvider === 'gitee' ? GITEE_LAST_SYNC_STORAGE_KEY : GITHUB_LAST_SYNC_STORAGE_KEY
    const lastSyncTime = getSavedItem(lastSyncTimeKey) || null

    set({
      provider: newProvider,
      currentToken,
      currentUser,
      isConfigured: Boolean(currentToken && currentUser),
      lastSyncTime,
      lastSyncResult: null,
      historyList: [],
      historyLimit: 3,
      hasMoreHistory: false,
      isLoadingMoreHistory: false,
    })

    if (currentToken && currentUser) {
      void get().fetchHistory()
    } else if (currentToken && !currentUser) {
      // 若有令牌但尚未拉取用户，则触发验证
      void get().setToken(currentToken, newProvider)
    }
  },

  setToken: async (token: string, targetProvider?: SyncProvider) => {
    const prov = targetProvider || get().provider
    const trimmed = token.trim()
    if (!trimmed) {
      return { success: false, error: translate('sync_err_token_invalid', { platform: prov === 'gitee' ? 'Gitee' : 'GitHub' }) }
    }

    set({ isSyncing: true })
    if (prov === 'gitee') {
      const res = await giteeAdapter.verifyGiteeToken(trimmed)
      set({ isSyncing: false })
      if (res.success && res.user) {
        setSavedItem(GITEE_TOKEN_STORAGE_KEY, trimmed)
        set({
          giteeToken: trimmed,
          giteeUser: res.user,
          ...(get().provider === 'gitee'
            ? {
                currentToken: trimmed,
                currentUser: res.user,
                isConfigured: true,
                lastSyncResult: null,
              }
            : {}),
        })
        void get().fetchHistory()
        return { success: true }
      }
      return { success: false, error: res.error || translate('sync_err_gitee_token_failed') }
    } else {
      const res = await githubAdapter.verifyGitHubToken(trimmed)
      set({ isSyncing: false })
      if (res.success && res.user) {
        setSavedItem(GITHUB_TOKEN_STORAGE_KEY, trimmed)
        set({
          githubToken: trimmed,
          githubUser: res.user,
          ...(get().provider === 'github'
            ? {
                currentToken: trimmed,
                currentUser: res.user,
                isConfigured: true,
                lastSyncResult: null,
              }
            : {}),
        })
        void get().fetchHistory()
        return { success: true }
      }
      return { success: false, error: res.error || translate('sync_err_github_token_failed') }
    }
  },

  clearToken: (targetProvider?: SyncProvider) => {
    const prov = targetProvider || get().provider
    if (prov === 'gitee') {
      removeSavedItem(GITEE_TOKEN_STORAGE_KEY)
      set({
        giteeToken: '',
        giteeUser: null,
        ...(get().provider === 'gitee'
          ? {
              currentToken: '',
              currentUser: null,
              isConfigured: false,
              historyList: [],
            }
          : {}),
      })
    } else {
      removeSavedItem(GITHUB_TOKEN_STORAGE_KEY)
      set({
        githubToken: '',
        githubUser: null,
        ...(get().provider === 'github'
          ? {
              currentToken: '',
              currentUser: null,
              isConfigured: false,
              historyList: [],
            }
          : {}),
      })
    }
  },

  setMasterPassword: (pwd: string) => {
    const trimmed = pwd.trim()
    setSavedItem(MASTER_PASSWORD_STORAGE_KEY, trimmed)
    set({ masterPassword: trimmed })
  },

  clearMasterPassword: () => {
    removeSavedItem(MASTER_PASSWORD_STORAGE_KEY)
    set({ masterPassword: '' })
  },

  setSyncPasswords: (enabled: boolean) => {
    setSavedItem(SYNC_INCLUDE_CREDENTIALS_STORAGE_KEY, String(enabled))
    set({ syncPasswords: enabled })
  },

  setSyncTerminalBackgrounds: (enabled: boolean) => {
    setSavedItem(SYNC_TERMINAL_BACKGROUNDS_STORAGE_KEY, String(enabled))
    set({ syncTerminalBackgrounds: enabled })
  },

  setAutoSync: (enabled: boolean) => {
    setSavedItem(AUTO_SYNC_STORAGE_KEY, String(enabled))
    set({ autoSync: enabled })
  },

  triggerAutoSync: () => {},

  checkStartupSync: async () => {
    const { provider, currentToken, currentUser, masterPassword, autoSync, isSyncing, lastSyncTime } = get()
    if (!currentToken || !currentUser || !masterPassword || !autoSync || isSyncing) {
      return
    }

    try {
      await get().fetchHistory()
      const history = get().historyList
      if (history.length === 0) {
        // 云端仓库尚无历史备份，若本地已有服务器资产，则自动初次备份上云
        const localServers = await sshService.listServers()
        if (localServers.length > 0) {
          await get().backup()
        }
        return
      }

      // 1. 获取云端最新快照密文并尝试本地解密比对
      let downloadRes: { success: boolean; content?: string; error?: string }
      if (provider === 'gitee') {
        downloadRes = await giteeAdapter.downloadBackupFile(currentToken, currentUser.login)
      } else {
        downloadRes = await githubAdapter.downloadBackupFile(currentToken, currentUser.login)
      }

      if (!downloadRes.success || !downloadRes.content) {
        return
      }

      const decryptedPlaintext = await decryptData(downloadRes.content, masterPassword)
      const cloudPayload: SyncPayload = JSON.parse(decryptedPlaintext)
      if (cloudPayload.format !== 'qshell-backup-package') {
        return
      }

      // 2. 提取本地配置指纹与云端配置指纹进行一致性比对
      const localServers = await sshService.listServersForSync()
      const localGroups = await sshService.listGroups()
      const localKeys = await sshService.listKeysForSync()

      const cloudFp = computeConfigFingerprint(
        cloudPayload.servers || [],
        cloudPayload.groups || [],
        cloudPayload.sshKeys || [],
      )
      const localFp = computeConfigFingerprint(localServers, localGroups, localKeys)

      // 3. 若配置指纹完全一致，说明本地与云端已保持同步，无需产生任何云端提交与同步读写
      if (cloudFp === localFp) {
        return
      }

      // 4. 若不一致，判定云端较新还是本地较新
      const cloudCommitTime = history[0]?.date ? new Date(history[0].date).getTime() : 0
      const localLastTime = lastSyncTime ? new Date(lastSyncTime).getTime() : 0

      if (!lastSyncTime || cloudCommitTime > localLastTime) {
        // 云端存在更新快照（由其他设备上传），自动拉取并还原到本地
        await get().restore()
      } else {
        // 本地有未上云改动，自动推送备份至云端
        await get().backup()
      }
    } catch (err) {
      console.warn('[AutoSync] Startup comparison failed silently:', err)
    }
  },

  backup: async (overridePassword?: string) => {
    const { provider, currentToken, currentUser, masterPassword, syncPasswords, syncTerminalBackgrounds } = get()
    const password = overridePassword !== undefined ? overridePassword : masterPassword

    const providerLabel = provider === 'gitee' ? 'Gitee' : 'GitHub'
    if (!currentToken || !currentUser) {
      return { success: false, error: translate('sync_err_bind_first', { platform: providerLabel }) }
    }
    if (!password || password.trim().length === 0) {
      return { success: false, error: translate('sync_err_set_pwd_first') }
    }

    set({ isSyncing: true, lastSyncResult: null })

    try {
      // 1. 提取全量服务器、分组与 SSH 密钥
      let servers: Server[] = []
      let groups: ServerGroup[] = []
      let sshKeys: SshKey[] = []
      try {
        servers = await sshService.listServersForSync()
        groups = await sshService.listGroups()
        sshKeys = await sshService.listKeysForSync()
      } catch {
        servers = useAppStore.getState().servers || []
        sshKeys = useAppStore.getState().keys || []
      }

      // 若用户关闭了密码同步，剥离敏感密码与口令
      if (!syncPasswords) {
        servers = servers.map((s) => ({
          ...s,
          password: '',
          privateKeyPassphrase: '',
        }))
        sshKeys = sshKeys.map((k) => ({
          ...k,
          privateKeyContent: '',
          privateKeyPassphrase: '',
          certificateContent: '',
        }))
      }

      // 提取独立字典与资源：标签、已知主机、收藏指令、书签
      let tags: TagRow[] = []
      let knownHosts: KnownHostRecord[] = []
      let favCmds: FavoriteCommand[] = []
      let bookmarks: LogBookmark[] = []
      try {
        tags = await sshService.listTagsAll()
      } catch {
        /* ignore */
      }
      try {
        knownHosts = await sshService.listKnownHosts()
      } catch {
        /* ignore */
      }
      try {
        favCmds = await sshService.listFavCmds()
      } catch {
        /* ignore */
      }
      try {
        bookmarks = await sshService.listBookmarksAll()
      } catch {
        /* ignore */
      }

      // 提取终端自定义背景图片与视频
      let backgrounds: SyncBackgroundItem[] = []
      if (syncTerminalBackgrounds) {
        try {
          backgrounds = await sshService.listBackgroundsForSync()
        } catch {
          /* ignore */
        }
      }

      // 提取核心偏好与个性化设置
      const appState = useAppStore.getState()

      // 规范化自定义主题中的媒体路径（转换为 media://filename）
      const normalizedThemes = (appState.customTerminalThemes || []).map((t) => {
        if (!t.background) return t
        return {
          ...t,
          background: {
            ...t.background,
            image: normalizeMediaPath(t.background.image),
            videoPath: normalizeMediaPath(t.background.videoPath),
          },
        }
      })

      const normalizedOverrides: Record<string, unknown> = {}
      if (appState.terminalThemeOverrides) {
        for (const [themeId, override] of Object.entries(appState.terminalThemeOverrides)) {
          if (!override) continue
          normalizedOverrides[themeId] = {
            ...override,
            image: normalizeMediaPath(override.image),
            videoPath: normalizeMediaPath(override.videoPath),
          }
        }
      }

      const preferences: Record<string, unknown> = {
        theme: appState.theme,
        uiStyle: appState.uiStyle,
        customCursorEnabled: appState.customCursorEnabled,
        uiSoundEnabled: appState.uiSoundEnabled,
        autoRefresh: appState.autoRefresh,
        refreshInterval: appState.refreshInterval,
        terminalFontSize: appState.terminalFontSize,
        terminalFontFamily: appState.terminalFontFamily,
        terminalThemeId: appState.terminalThemeId,
        customTerminalThemes: normalizedThemes,
        terminalThemeOverrides: normalizedOverrides,
        terminalHighlightEnabled: appState.terminalHighlightEnabled,
        terminalHighlightRules: appState.terminalHighlightRules,
        terminalAutoReconnect: appState.terminalAutoReconnect,
        terminalAntiIdleEnabled: appState.terminalAntiIdleEnabled,
        terminalAntiIdleInterval: appState.terminalAntiIdleInterval,
        terminalAntiIdleMode: appState.terminalAntiIdleMode,
        terminalAntiIdleCustomString: appState.terminalAntiIdleCustomString,
        terminalCopyPaste: appState.terminalCopyPaste,
        terminalSelectionToolbar: appState.terminalSelectionToolbar,
        terminalBellSound: appState.terminalBellSound,
        terminalDrawBoldInBrightColors: appState.terminalDrawBoldInBrightColors,
        terminalHintEnabled: appState.terminalHintEnabled,
        terminalScrollbackLines: appState.terminalScrollbackLines,
        terminalWindowSizeKb: appState.terminalWindowSizeKb,
        terminalRecordingDirectory: appState.terminalRecordingDirectory,
        terminalEncoding: appState.terminalEncoding,
        terminalRecordingMaxSizeMb: appState.terminalRecordingMaxSizeMb,
        sftpDefaultViewMode: appState.sftpDefaultViewMode,
        sftpLocalViewMode: appState.sftpLocalViewMode,
        sftpRemoteViewMode: appState.sftpRemoteViewMode,
        sftpLocalShowHidden: appState.sftpLocalShowHidden,
        sftpRemoteShowHidden: appState.sftpRemoteShowHidden,
        sftpFileIconTheme: appState.sftpFileIconTheme,
        sftpTransferConcurrency: appState.sftpTransferConcurrency,
        transferRateLimit: appState.transferRateLimit,
        sftpExclusionEnabled: appState.sftpExclusionEnabled,
        sftpExclusionPatterns: appState.sftpExclusionPatterns,
        sftpRespectGitignore: appState.sftpRespectGitignore,
        sftpLocalSortField: appState.sftpLocalSortField,
        sftpLocalSortOrder: appState.sftpLocalSortOrder,
        sftpRemoteSortField: appState.sftpRemoteSortField,
        sftpRemoteSortOrder: appState.sftpRemoteSortOrder,
        workspaceFileSortField: appState.workspaceFileSortField,
        workspaceFileSortDirection: appState.workspaceFileSortDirection,
        workspaceFileShowHidden: appState.workspaceFileShowHidden,
        sidebarWidth: appState.sidebarWidth,
        language: appState.language,
        tabColors: appState.tabColors,
        appLockEnabled: appState.appLockEnabled,
        appLockType: appState.appLockType,
        appLockPasswordHash: appState.appLockPasswordHash,
        appLockIdleMinutes: appState.appLockIdleMinutes,
      }

      let favorites: unknown[] = []
      try {
        const favRaw = localStorage.getItem('qshell_cmd_favorites')
        if (favRaw) favorites = JSON.parse(favRaw)
      } catch {
        /* ignore */
      }

      let recentConnections: Array<{ serverId: string; at: number }> = []
      try {
        const rcRaw = localStorage.getItem('trae:recent-connections')
        if (rcRaw) recentConnections = JSON.parse(rcRaw)
      } catch {
        /* ignore */
      }

      let commandHistory: string[] = []
      try {
        const chRaw = localStorage.getItem('trae:command-history')
        if (chRaw) commandHistory = JSON.parse(chRaw)
      } catch {
        /* ignore */
      }

      const pathBookmarks: Record<string, string[]> = {
        ...loadLegacyBookmarks(),
        ...(appState.pathBookmarks || {}),
      }

      let aiSettings: unknown = undefined
      let aiConfiguredProviders: unknown[] | undefined = undefined
      let aiMasterEnabled: boolean | undefined = undefined
      try {
        const aiRaw = localStorage.getItem('qshell_ai_settings')
        if (aiRaw) aiSettings = JSON.parse(aiRaw)
        const provRaw = localStorage.getItem('qshell_ai_configured_providers')
        if (provRaw) aiConfiguredProviders = JSON.parse(provRaw)
        const masterRaw = localStorage.getItem('qshell_ai_master_enabled')
        if (masterRaw !== null) aiMasterEnabled = masterRaw === 'true'
      } catch {
        /* ignore */
      }

      const payload: SyncPayload = {
        format: 'qshell-backup-package',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        servers,
        groups,
        sshKeys,
        tags,
        knownHosts,
        favCmds,
        bookmarks,
        backgrounds,
        preferences,
        favorites,
        recentConnections,
        commandHistory,
        pathBookmarks,
        aiSettings,
        aiConfiguredProviders,
        aiMasterEnabled,
      }

      // 2. 本地 AES-256-GCM 加密
      const encryptedJson = await encryptData(JSON.stringify(payload), password, '2.0.0')

      // 3. 提交到私有仓库
      let uploadRes: { success: boolean; sha?: string; error?: string }
      if (provider === 'gitee') {
        uploadRes = await giteeAdapter.uploadBackupFile(currentToken, currentUser.login, encryptedJson)
      } else {
        uploadRes = await githubAdapter.uploadBackupFile(currentToken, currentUser.login, encryptedJson)
      }

      if (!uploadRes.success) {
        set({
          isSyncing: false,
          lastSyncResult: { success: false, msg: uploadRes.error || translate('sync_err_upload_failed', { platform: providerLabel }) },
        })
        return { success: false, error: uploadRes.error }
      }

      const nowIso = new Date().toISOString()
      const lastSyncKey = provider === 'gitee' ? GITEE_LAST_SYNC_STORAGE_KEY : GITHUB_LAST_SYNC_STORAGE_KEY
      setSavedItem(lastSyncKey, nowIso)

      set({
        isSyncing: false,
        lastSyncTime: nowIso,
        lastSyncResult: {
          success: true,
          msg: translate('sync_msg_backup_success', { count: servers.length, platform: providerLabel }),
        },
      })

      void get().fetchHistory()
      return { success: true }
    } catch (err: unknown) {
      const errorMsg = (err as Error)?.message || translate('sync_err_backup_exception')
      set({
        isSyncing: false,
        lastSyncResult: { success: false, msg: errorMsg },
      })
      return { success: false, error: errorMsg }
    }
  },

  restore: async (overridePassword?: string, commitSha?: string) => {
    const { provider, currentToken, currentUser, masterPassword } = get()
    const password = overridePassword !== undefined ? overridePassword : masterPassword

    const providerLabel = provider === 'gitee' ? 'Gitee' : 'GitHub'
    if (!currentToken || !currentUser) {
      return { success: false, error: translate('sync_err_bind_first', { platform: providerLabel }) }
    }
    if (!password || password.trim().length === 0) {
      return { success: false, error: translate('sync_err_enter_pwd') }
    }

    set({ isSyncing: true, lastSyncResult: null })

    try {
      // 1. 从云端拉取密文
      let downloadRes: { success: boolean; content?: string; error?: string }
      if (provider === 'gitee') {
        downloadRes = await giteeAdapter.downloadBackupFile(
          currentToken,
          currentUser.login,
          undefined,
          undefined,
          commitSha,
        )
      } else {
        downloadRes = await githubAdapter.downloadBackupFile(
          currentToken,
          currentUser.login,
          undefined,
          undefined,
          commitSha,
        )
      }

      if (!downloadRes.success || !downloadRes.content) {
        set({
          isSyncing: false,
          lastSyncResult: { success: false, msg: downloadRes.error || translate('sync_err_download_failed') },
        })
        return { success: false, error: downloadRes.error }
      }

      // 2. 本地端到端解密
      const decryptedPlaintext = await decryptData(downloadRes.content, password)
      const payload: SyncPayload = JSON.parse(decryptedPlaintext)

      if (payload.format !== 'qshell-backup-package' || !Array.isArray(payload.servers)) {
        throw new Error(translate('sync_err_invalid_format'))
      }

      // 3. 还原分组到本地 SQLite
      let restoredGroupsCount = 0
      try {
        const existingGroups = await sshService.listGroups()
        const resolvedGroupSet = new Set(existingGroups.map((g) => g.id))
        resolvedGroupSet.add('host')
        let currentRemaining = [...(payload.groups || [])].filter((g) => g.id)

        let progress = true
        while (currentRemaining.length > 0 && progress) {
          progress = false
          const nextRemaining: typeof currentRemaining = []
          for (const g of currentRemaining) {
            const pid = g.parentId?.trim()
            if (!pid || pid === 'host' || resolvedGroupSet.has(pid)) {
              await sshService.addGroup(g.name, pid || null, g.id)
              resolvedGroupSet.add(g.id)
              restoredGroupsCount++
              progress = true
            } else {
              nextRemaining.push(g)
            }
          }
          currentRemaining = nextRemaining
          if (!progress && currentRemaining.length > 0) {
            // 存在孤立或环形父分组引用，降级挂载到根目录 (host)
            for (const g of currentRemaining) {
              await sshService.addGroup(g.name, 'host', g.id)
              resolvedGroupSet.add(g.id)
              restoredGroupsCount++
            }
            break
          }
        }
      } catch (err) {
        console.warn('[Sync] Failed to restore groups:', err)
      }

      // 3.5 还原 SSH 密钥库到本地 SQLite
      let restoredKeysCount = 0
      if (Array.isArray(payload.sshKeys) && payload.sshKeys.length > 0) {
        try {
          const existingKeys = await sshService.listKeys()
          const existingKeyMap = new Map(existingKeys.map((k) => [k.id, k]))
          for (const k of payload.sshKeys) {
            if (existingKeyMap.has(k.id)) {
              await sshService.updateKey(k.id, k)
            } else {
              await sshService.addKey(k)
            }
            restoredKeysCount++
          }
        } catch (err) {
          console.warn('[Sync] Failed to restore SSH keys:', err)
        }
      }

      // 3.6 还原标签目录到本地 SQLite
      let restoredTagsCount = 0
      if (Array.isArray(payload.tags) && payload.tags.length > 0) {
        try {
          restoredTagsCount = await sshService.restoreTags(payload.tags)
        } catch (err) {
          console.warn('[Sync] Failed to restore tags:', err)
        }
      }

      // 3.7 还原已知主机指纹
      let restoredKnownHostsCount = 0
      if (Array.isArray(payload.knownHosts) && payload.knownHosts.length > 0) {
        try {
          restoredKnownHostsCount = await sshService.restoreKnownHosts(payload.knownHosts)
        } catch (err) {
          console.warn('[Sync] Failed to restore known hosts:', err)
        }
      }

      // 3.8 还原收藏指令
      let restoredFavCmdsCount = 0
      if (Array.isArray(payload.favCmds) && payload.favCmds.length > 0) {
        try {
          await sshService.restoreFavCmds(payload.favCmds)
          restoredFavCmdsCount = payload.favCmds.length
        } catch (err) {
          console.warn('[Sync] Failed to restore favCmds:', err)
        }
      }

      // 3.9 还原书签
      let restoredBookmarksCount = 0
      if (Array.isArray(payload.bookmarks) && payload.bookmarks.length > 0) {
        try {
          await sshService.restoreBookmarks(payload.bookmarks)
          restoredBookmarksCount = payload.bookmarks.length
        } catch (err) {
          console.warn('[Sync] Failed to restore bookmarks:', err)
        }
      }

      // 3.10 还原终端自定义背景图片与视频文件
      let restoredBgCount = 0
      if (Array.isArray(payload.backgrounds) && payload.backgrounds.length > 0) {
        try {
          restoredBgCount = await sshService.restoreBackgrounds(payload.backgrounds)
        } catch (err) {
          console.warn('[Sync] Failed to restore background media:', err)
        }
      }

      // 4. 还原服务器到本地 SQLite
      let importedCount = 0
      try {
        const existingServers = await sshService.listServers()
        const existingServerMap = new Map(existingServers.map((s) => [s.id, s]))

        for (const s of payload.servers) {
          if (existingServerMap.has(s.id)) {
            await sshService.updateServer(s.id, s)
          } else {
            await sshService.addServer(s)
          }
          importedCount++
        }
      } catch (err) {
        console.warn('[Sync] Database import error, applying to in-memory store:', err)
      }

      // 5. 还原全量偏好设置
      if (payload.preferences) {
        const prefs = payload.preferences

        // 动态解析恢复主题与覆盖层中的本地媒体路径
        let restoredThemes = (prefs.customTerminalThemes as TerminalTheme[]) || []
        if (Array.isArray(restoredThemes)) {
          restoredThemes = await Promise.all(
            restoredThemes.map(async (t) => {
              if (!t.background) return t
              const newImage = await resolveMediaPath(t.background.image, false)
              const newVideo = await resolveMediaPath(t.background.videoPath, true)
              return {
                ...t,
                background: {
                  ...t.background,
                  image: newImage,
                  videoPath: newVideo,
                },
              }
            })
          )
        }

        let restoredOverrides: Record<string, unknown> | undefined = undefined
        if (prefs.terminalThemeOverrides && typeof prefs.terminalThemeOverrides === 'object') {
          restoredOverrides = {}
          for (const [themeId, rawOv] of Object.entries(prefs.terminalThemeOverrides as Record<string, any>)) {
            if (!rawOv) continue
            const newImage = await resolveMediaPath(rawOv.image, false)
            const newVideo = await resolveMediaPath(rawOv.videoPath, true)
            restoredOverrides[themeId] = {
              ...rawOv,
              image: newImage,
              videoPath: newVideo,
            }
          }
        }

        useAppStore.setState((prev) => ({
          ...prev,
          theme: (prefs.theme as typeof prev.theme) ?? prev.theme,
          uiStyle: (prefs.uiStyle as typeof prev.uiStyle) ?? prev.uiStyle,
          customCursorEnabled: (prefs.customCursorEnabled as boolean) ?? prev.customCursorEnabled,
          uiSoundEnabled: (prefs.uiSoundEnabled as boolean) ?? prev.uiSoundEnabled,
          autoRefresh: (prefs.autoRefresh as boolean) ?? prev.autoRefresh,
          refreshInterval: (prefs.refreshInterval as number) ?? prev.refreshInterval,
          terminalFontSize: (prefs.terminalFontSize as number) ?? prev.terminalFontSize,
          terminalFontFamily: (prefs.terminalFontFamily as string) ?? prev.terminalFontFamily,
          terminalThemeId: (prefs.terminalThemeId as string) ?? prev.terminalThemeId,
          customTerminalThemes: restoredThemes ?? prev.customTerminalThemes,
          terminalThemeOverrides: (restoredOverrides as typeof prev.terminalThemeOverrides) ?? prev.terminalThemeOverrides,
          terminalHighlightEnabled: (prefs.terminalHighlightEnabled as boolean) ?? prev.terminalHighlightEnabled,
          terminalHighlightRules: (prefs.terminalHighlightRules as typeof prev.terminalHighlightRules) ?? prev.terminalHighlightRules,
          terminalAutoReconnect: (prefs.terminalAutoReconnect as boolean) ?? prev.terminalAutoReconnect,
          terminalAntiIdleEnabled: (prefs.terminalAntiIdleEnabled as boolean) ?? prev.terminalAntiIdleEnabled,
          terminalAntiIdleInterval: (prefs.terminalAntiIdleInterval as number) ?? prev.terminalAntiIdleInterval,
          terminalAntiIdleMode: (prefs.terminalAntiIdleMode as typeof prev.terminalAntiIdleMode) ?? prev.terminalAntiIdleMode,
          terminalAntiIdleCustomString: (prefs.terminalAntiIdleCustomString as string) ?? prev.terminalAntiIdleCustomString,
          terminalCopyPaste: (prefs.terminalCopyPaste as boolean) ?? prev.terminalCopyPaste,
          terminalSelectionToolbar: (prefs.terminalSelectionToolbar as boolean) ?? prev.terminalSelectionToolbar,
          terminalBellSound: (prefs.terminalBellSound as boolean) ?? prev.terminalBellSound,
          terminalDrawBoldInBrightColors: (prefs.terminalDrawBoldInBrightColors as boolean) ?? prev.terminalDrawBoldInBrightColors,
          terminalHintEnabled: (prefs.terminalHintEnabled as boolean) ?? prev.terminalHintEnabled,
          terminalScrollbackLines: (prefs.terminalScrollbackLines as number) ?? prev.terminalScrollbackLines,
          terminalWindowSizeKb: (prefs.terminalWindowSizeKb as number) ?? prev.terminalWindowSizeKb,
          terminalRecordingDirectory: (prefs.terminalRecordingDirectory as string) ?? prev.terminalRecordingDirectory,
          terminalEncoding: (prefs.terminalEncoding as string) ?? prev.terminalEncoding,
          terminalRecordingMaxSizeMb: (prefs.terminalRecordingMaxSizeMb as number) ?? prev.terminalRecordingMaxSizeMb,
          sftpDefaultViewMode: (prefs.sftpDefaultViewMode as typeof prev.sftpDefaultViewMode) ?? prev.sftpDefaultViewMode,
          sftpLocalViewMode: (prefs.sftpLocalViewMode as typeof prev.sftpLocalViewMode) ?? prev.sftpLocalViewMode,
          sftpRemoteViewMode: (prefs.sftpRemoteViewMode as typeof prev.sftpRemoteViewMode) ?? prev.sftpRemoteViewMode,
          sftpLocalShowHidden: (prefs.sftpLocalShowHidden as boolean) ?? prev.sftpLocalShowHidden,
          sftpRemoteShowHidden: (prefs.sftpRemoteShowHidden as boolean) ?? prev.sftpRemoteShowHidden,
          sftpFileIconTheme: (prefs.sftpFileIconTheme as typeof prev.sftpFileIconTheme) ?? prev.sftpFileIconTheme,
          sftpTransferConcurrency: (prefs.sftpTransferConcurrency as number) ?? prev.sftpTransferConcurrency,
          transferRateLimit: (prefs.transferRateLimit as number) ?? prev.transferRateLimit,
          sftpExclusionEnabled: (prefs.sftpExclusionEnabled as boolean) ?? prev.sftpExclusionEnabled,
          sftpExclusionPatterns: (prefs.sftpExclusionPatterns as string[]) ?? prev.sftpExclusionPatterns,
          sftpRespectGitignore: (prefs.sftpRespectGitignore as boolean) ?? prev.sftpRespectGitignore,
          sftpLocalSortField: (prefs.sftpLocalSortField as typeof prev.sftpLocalSortField) ?? prev.sftpLocalSortField,
          sftpLocalSortOrder: (prefs.sftpLocalSortOrder as typeof prev.sftpLocalSortOrder) ?? prev.sftpLocalSortOrder,
          sftpRemoteSortField: (prefs.sftpRemoteSortField as typeof prev.sftpRemoteSortField) ?? prev.sftpRemoteSortField,
          sftpRemoteSortOrder: (prefs.sftpRemoteSortOrder as typeof prev.sftpRemoteSortOrder) ?? prev.sftpRemoteSortOrder,
          workspaceFileSortField: (prefs.workspaceFileSortField as typeof prev.workspaceFileSortField) ?? prev.workspaceFileSortField,
          workspaceFileSortDirection: (prefs.workspaceFileSortDirection as typeof prev.workspaceFileSortDirection) ?? prev.workspaceFileSortDirection,
          workspaceFileShowHidden: (prefs.workspaceFileShowHidden as boolean) ?? prev.workspaceFileShowHidden,
          sidebarWidth: (prefs.sidebarWidth as number) ?? prev.sidebarWidth,
          language: (prefs.language as typeof prev.language) ?? prev.language,
          tabColors: (prefs.tabColors as typeof prev.tabColors) ?? prev.tabColors,
          appLockEnabled: (prefs.appLockEnabled as boolean) ?? prev.appLockEnabled,
          appLockType: (prefs.appLockType as typeof prev.appLockType) ?? prev.appLockType,
          appLockPasswordHash: (prefs.appLockPasswordHash as string) ?? prev.appLockPasswordHash,
          appLockIdleMinutes: (prefs.appLockIdleMinutes as number) ?? prev.appLockIdleMinutes,
        }))
      }

      // 5.5 还原全量路径收藏（SFTP 与工作台）
      let restoredPathBookmarksCount = 0
      if (payload.pathBookmarks && typeof payload.pathBookmarks === 'object') {
        try {
          useAppStore.getState().setAllPathBookmarks(payload.pathBookmarks)
          for (const list of Object.values(payload.pathBookmarks)) {
            if (Array.isArray(list)) {
              restoredPathBookmarksCount += list.length
            }
          }
        } catch (err) {
          console.warn('[Sync] Failed to restore pathBookmarks:', err)
        }
      }

      // 5.6 还原 AI 配置与偏好同步回写
      if (payload.preferences) {
        try {
          const p = payload.preferences
          if (p.sftpLocalSortField) localStorage.setItem('qshell.sftp.local.sortField', String(p.sftpLocalSortField))
          if (p.sftpLocalSortOrder) localStorage.setItem('qshell.sftp.local.sortOrder', String(p.sftpLocalSortOrder))
          if (p.sftpRemoteSortField) localStorage.setItem('qshell.sftp.remote.sortField', String(p.sftpRemoteSortField))
          if (p.sftpRemoteSortOrder) localStorage.setItem('qshell.sftp.remote.sortOrder', String(p.sftpRemoteSortOrder))
          if (p.workspaceFileSortField) localStorage.setItem('qshell.workspace.files.sortField', String(p.workspaceFileSortField))
          if (p.workspaceFileSortDirection) localStorage.setItem('qshell.workspace.files.sortDirection', String(p.workspaceFileSortDirection))
          if (typeof p.workspaceFileShowHidden === 'boolean') localStorage.setItem('qshell.workspace.files.showHidden', String(p.workspaceFileShowHidden))
        } catch {}
      }
      if (payload.aiSettings) {
        try {
          localStorage.setItem('qshell_ai_settings', JSON.stringify(payload.aiSettings))
        } catch {}
      }
      if (Array.isArray(payload.aiConfiguredProviders)) {
        try {
          localStorage.setItem('qshell_ai_configured_providers', JSON.stringify(payload.aiConfiguredProviders))
        } catch {}
      }
      if (typeof payload.aiMasterEnabled === 'boolean') {
        try {
          localStorage.setItem('qshell_ai_master_enabled', String(payload.aiMasterEnabled))
        } catch {}
      }

      // 6. 还原命令收藏、最近连接与历史记录到本地
      if (Array.isArray(payload.favorites)) {
        try {
          localStorage.setItem('qshell_cmd_favorites', JSON.stringify(payload.favorites))
        } catch {
          /* ignore */
        }
      }
      if (Array.isArray(payload.recentConnections)) {
        try {
          localStorage.setItem('trae:recent-connections', JSON.stringify(payload.recentConnections))
        } catch {
          /* ignore */
        }
      }
      if (Array.isArray(payload.commandHistory)) {
        try {
          localStorage.setItem('trae:command-history', JSON.stringify(payload.commandHistory))
        } catch {
          /* ignore */
        }
      }

      // 7. 触发工作台刷新与事件广播
      await useAppStore.getState().loadServers()
      try {
        const refreshedKeys = await sshService.listKeys()
        useAppStore.getState().setKeys(refreshedKeys)
      } catch {
        /* ignore */
      }
      try {
        const refreshedGroups = await sshService.listGroups()
        useAppStore.getState().setServerGroups(refreshedGroups)
      } catch {
        /* ignore */
      }
      try {
        await useAppStore.getState().loadTags()
      } catch {
        /* ignore */
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('refresh-terminal-theme'))
        window.dispatchEvent(new Event('recent-connections-changed'))
      }

      const nowIso = new Date().toISOString()
      const lastSyncKey = provider === 'gitee' ? GITEE_LAST_SYNC_STORAGE_KEY : GITHUB_LAST_SYNC_STORAGE_KEY
      setSavedItem(lastSyncKey, nowIso)

      set({
        isSyncing: false,
        lastSyncTime: nowIso,
        lastSyncResult: {
          success: true,
          msg: translate('sync_msg_restore_success', { platform: providerLabel, count: importedCount }),
        },
      })

      return {
        success: true,
        stats: {
          servers: importedCount,
          pathBookmarks: restoredPathBookmarksCount,
          groups: restoredGroupsCount,
          sshKeys: restoredKeysCount,
          tags: restoredTagsCount,
          knownHosts: restoredKnownHostsCount,
          favCmds: restoredFavCmdsCount,
          bookmarks: restoredBookmarksCount,
          backgrounds: restoredBgCount,
        },
      }
    } catch (err: unknown) {
      const errorMsg = (err as Error)?.message || translate('sync_err_restore_exception')
      set({
        isSyncing: false,
        lastSyncResult: { success: false, msg: errorMsg },
      })
      return { success: false, error: errorMsg }
    }
  },

  fetchHistory: async (limit?: number) => {
    const { provider, currentToken, currentUser, historyLimit } = get()
    if (!currentToken || !currentUser) return

    const effectiveLimit = limit ?? historyLimit ?? 3
    let res: { success: boolean; history?: BackupCommitInfo[]; error?: string }
    if (provider === 'gitee') {
      res = await giteeAdapter.getBackupHistory(currentToken, currentUser.login, undefined, undefined, effectiveLimit)
    } else {
      res = await githubAdapter.getBackupHistory(currentToken, currentUser.login, undefined, undefined, effectiveLimit)
    }

    if (res.success && res.history) {
      set({
        historyList: res.history,
        hasMoreHistory: res.history.length >= effectiveLimit,
      })
    }
  },

  loadMoreHistory: async () => {
    const currentLimit = get().historyLimit
    const newLimit = currentLimit + 10
    set({ isLoadingMoreHistory: true })
    await get().fetchHistory(newLimit)
    const list = get().historyList
    set({
      historyLimit: newLimit,
      hasMoreHistory: list.length >= newLimit,
      isLoadingMoreHistory: false,
    })
  },

  resetHistoryLimit: async () => {
    set({ historyLimit: 3, isLoadingMoreHistory: false })
    await get().fetchHistory(3)
  },

  // 现有方法别名（100% 保持原有兼容性）
  setGiteeToken: async (token: string) => get().setToken(token, 'gitee'),
  clearGiteeToken: () => get().clearToken('gitee'),
  backupToGitee: async (pwd?: string) => {
    get().setProvider('gitee')
    return get().backup(pwd)
  },
  restoreFromGitee: async (pwd?: string, sha?: string) => {
    get().setProvider('gitee')
    return get().restore(pwd, sha)
  },

  setGitHubToken: async (token: string) => get().setToken(token, 'github'),
  clearGitHubToken: () => get().clearToken('github'),
  backupToGitHub: async (pwd?: string) => {
    get().setProvider('github')
    return get().backup(pwd)
  },
  restoreFromGitHub: async (pwd?: string, sha?: string) => {
    get().setProvider('github')
    return get().restore(pwd, sha)
  },
}))
