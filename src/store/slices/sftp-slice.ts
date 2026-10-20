import type { StateCreator } from "zustand";
import { sshService } from "@/services/ssh-service";
import { DEFAULT_SFTP_EXCLUSIONS } from "../constants";
import type { AppState, SftpSlice } from "../types";

export const scopeKeyToLegacyKey = (scopeKey: string): string => {
  if (scopeKey === 'sftp:local') return 'sftp-bookmarks-local';
  if (scopeKey.startsWith('sftp:')) return `sftp-bookmarks-${scopeKey.slice(5)}`;
  if (scopeKey.startsWith('workspace:')) return `file-bookmarks-${scopeKey.slice(10)}`;
  return `bookmarks-${scopeKey}`;
};

export const legacyKeyToScopeKey = (legacyKey: string): string | null => {
  if (legacyKey === 'sftp-bookmarks-local') return 'sftp:local';
  if (legacyKey.startsWith('sftp-bookmarks-')) return `sftp:${legacyKey.slice('sftp-bookmarks-'.length)}`;
  if (legacyKey.startsWith('file-bookmarks-')) return `workspace:${legacyKey.slice('file-bookmarks-'.length)}`;
  return null;
};

export const loadLegacyBookmarks = (): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  if (typeof window === 'undefined' || !window.localStorage) return result;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const scopeKey = legacyKeyToScopeKey(key);
      if (scopeKey) {
        try {
          const val = localStorage.getItem(key);
          if (val) {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) {
              result[scopeKey] = parsed;
            }
          }
        } catch {}
      }
    }
  } catch {}
  return result;
};

const getInitialWorkspaceFileSortField = (): 'name' | 'size' | 'modifiedTime' => {
  if (typeof window === 'undefined' || !window.localStorage) return 'name';
  try {
    const saved = localStorage.getItem('qshell.workspace.files.sortField');
    if (saved === 'name' || saved === 'size' || saved === 'modifiedTime') return saved;
  } catch {}
  return 'name';
};

const getInitialWorkspaceFileSortDirection = (): 'asc' | 'desc' => {
  if (typeof window === 'undefined' || !window.localStorage) return 'asc';
  try {
    const saved = localStorage.getItem('qshell.workspace.files.sortDirection');
    if (saved === 'asc' || saved === 'desc') return saved;
  } catch {}
  return 'asc';
};

const getInitialWorkspaceFileShowHidden = (): boolean => {
  if (typeof window === 'undefined' || !window.localStorage) return true;
  try {
    const saved = localStorage.getItem('qshell.workspace.files.showHidden');
    if (saved !== null) return saved === 'true';
  } catch {}
  return true;
};

export const createSftpSlice: StateCreator<AppState, [], [], SftpSlice> = (
  set,
  get,
) => ({
  // SFTP Settings Defaults & Setters
  // SFTP 本地面板默认视图模式：默认 'list'
  sftpLocalViewMode: "list",
  setSftpLocalViewMode: (mode) => set({ sftpLocalViewMode: mode }),
  // SFTP 远程面板默认视图模式：默认 'list'
  sftpRemoteViewMode: "list",
  setSftpRemoteViewMode: (mode) => set({ sftpRemoteViewMode: mode }),
  // SFTP 本地面板默认是否显示隐藏文件：默认 false
  sftpLocalShowHidden: false,
  setSftpLocalShowHidden: (show) => {
    set({ sftpLocalShowHidden: show });
    try {
      localStorage.setItem('qshell.sftp.local.showHidden', String(show));
    } catch {}
  },
  // SFTP 远程面板默认是否显示隐藏文件：默认 true
  sftpRemoteShowHidden: true,
  setSftpRemoteShowHidden: (show) => {
    set({ sftpRemoteShowHidden: show });
    try {
      localStorage.setItem('qshell.sftp.remote.showHidden', String(show));
    } catch {}
  },
  // SFTP 本地面板默认排序：默认 'name' / 'asc'
  sftpLocalSortField: 'name',
  setSftpLocalSortField: (field) => {
    set({ sftpLocalSortField: field });
    try {
      localStorage.setItem('qshell.sftp.local.sortField', field);
    } catch {}
  },
  sftpLocalSortOrder: 'asc',
  setSftpLocalSortOrder: (order) => {
    set({ sftpLocalSortOrder: order });
    try {
      localStorage.setItem('qshell.sftp.local.sortOrder', order);
    } catch {}
  },
  // SFTP 远程面板默认排序：默认 'name' / 'asc'
  sftpRemoteSortField: 'name',
  setSftpRemoteSortField: (field) => {
    set({ sftpRemoteSortField: field });
    try {
      localStorage.setItem('qshell.sftp.remote.sortField', field);
    } catch {}
  },
  sftpRemoteSortOrder: 'asc',
  setSftpRemoteSortOrder: (order) => {
    set({ sftpRemoteSortOrder: order });
    try {
      localStorage.setItem('qshell.sftp.remote.sortOrder', order);
    } catch {}
  },
  // SFTP 默认视图模式（向后兼容）：默认 'list'
  sftpDefaultViewMode: "list",
  setSftpDefaultViewMode: (mode) =>
    set({
      sftpDefaultViewMode: mode,
      sftpLocalViewMode: mode,
      sftpRemoteViewMode: mode,
    }),
  // SFTP 文件图标主题：默认 'developer'
  sftpFileIconTheme: "developer",
  setSftpFileIconTheme: (theme) => set({ sftpFileIconTheme: theme }),
  // SFTP 传输并发量（1-10）：默认 3
  sftpTransferConcurrency: 3,
  setSftpTransferConcurrency: (n) =>
    set({
      sftpTransferConcurrency: Math.max(
        1,
        Math.min(10, Math.floor(n) || 1),
      ),
    }),
  // 传输限速（KB/s）：默认 0=不限速；负值归一化为 0
  transferRateLimit: 0,
  setTransferRateLimit: (kbps) => {
    const normalized = Math.max(0, Math.floor(kbps) || 0);
    set({ transferRateLimit: normalized });
    // 立即同步到后端，避免仅在 SFTP 面板挂载时才生效（dashboard 上改设置也能生效）
    sshService.setTransferRateLimit(normalized).catch((err) => {
      console.error("Failed to sync transfer rate limit to backend:", err);
    });
  },
  // SFTP 传输排除与忽略规则（默认关闭，保持纯粹的文件传输）
  sftpExclusionEnabled: false,
  setSftpExclusionEnabled: (enabled) => {
    set({ sftpExclusionEnabled: enabled });
    const { sftpExclusionPatterns, sftpRespectGitignore } = get();
    sshService
      .setExclusionConfig(enabled, sftpExclusionPatterns, sftpRespectGitignore)
      .catch((err) => {
        console.error("Failed to sync exclusion config to backend:", err);
      });
  },
  sftpExclusionPatterns: DEFAULT_SFTP_EXCLUSIONS,
  setSftpExclusionPatterns: (patterns) => {
    set({ sftpExclusionPatterns: patterns });
    const { sftpExclusionEnabled, sftpRespectGitignore } = get();
    sshService
      .setExclusionConfig(sftpExclusionEnabled, patterns, sftpRespectGitignore)
      .catch((err) => {
        console.error("Failed to sync exclusion config to backend:", err);
      });
  },
  sftpRespectGitignore: false,
  setSftpRespectGitignore: (respect) => {
    set({ sftpRespectGitignore: respect });
    const { sftpExclusionEnabled, sftpExclusionPatterns } = get();
    sshService
      .setExclusionConfig(sftpExclusionEnabled, sftpExclusionPatterns, respect)
      .catch((err) => {
        console.error("Failed to sync exclusion config to backend:", err);
      });
  },

  // 路径收藏统一管理
  pathBookmarks: loadLegacyBookmarks(),
  setPathBookmarks: (scopeKey, bookmarks) => {
    set((prev) => ({
      pathBookmarks: {
        ...prev.pathBookmarks,
        [scopeKey]: bookmarks,
      },
    }));
    try {
      localStorage.setItem(scopeKeyToLegacyKey(scopeKey), JSON.stringify(bookmarks));
    } catch {}
  },
  setAllPathBookmarks: (all) => {
    set((prev) => ({
      pathBookmarks: {
        ...prev.pathBookmarks,
        ...all,
      },
    }));
    try {
      for (const [scopeKey, list] of Object.entries(all)) {
        if (Array.isArray(list)) {
          localStorage.setItem(scopeKeyToLegacyKey(scopeKey), JSON.stringify(list));
        }
      }
    } catch {}
  },
  addPathBookmark: (scopeKey, path) => {
    if (!path) return false;
    const current = get().pathBookmarks[scopeKey] || [];
    if (current.includes(path)) return false;
    if (current.length >= 50) return false;
    const next = [...current, path];
    set((prev) => ({
      pathBookmarks: {
        ...prev.pathBookmarks,
        [scopeKey]: next,
      },
    }));
    try {
      localStorage.setItem(scopeKeyToLegacyKey(scopeKey), JSON.stringify(next));
    } catch {}
    return true;
  },
  removePathBookmark: (scopeKey, path) => {
    if (!path) return;
    const current = get().pathBookmarks[scopeKey] || [];
    const next = current.filter((p) => p !== path);
    set((prev) => ({
      pathBookmarks: {
        ...prev.pathBookmarks,
        [scopeKey]: next,
      },
    }));
    try {
      localStorage.setItem(scopeKeyToLegacyKey(scopeKey), JSON.stringify(next));
    } catch {}
  },

  // 工作台文件模块偏好
  workspaceFileSortField: getInitialWorkspaceFileSortField(),
  setWorkspaceFileSortField: (field) => {
    set({ workspaceFileSortField: field });
    try {
      localStorage.setItem('qshell.workspace.files.sortField', field);
    } catch {}
  },
  workspaceFileSortDirection: getInitialWorkspaceFileSortDirection(),
  setWorkspaceFileSortDirection: (dir) => {
    set({ workspaceFileSortDirection: dir });
    try {
      localStorage.setItem('qshell.workspace.files.sortDirection', dir);
    } catch {}
  },
  workspaceFileShowHidden: getInitialWorkspaceFileShowHidden(),
  setWorkspaceFileShowHidden: (show) => {
    set({ workspaceFileShowHidden: show });
    try {
      localStorage.setItem('qshell.workspace.files.showHidden', String(show));
    } catch {}
  },
});
