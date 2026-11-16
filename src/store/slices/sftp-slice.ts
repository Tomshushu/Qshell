import type { StateCreator } from "zustand";
import { sshService } from "@/services/ssh-service";
import { useTransferQueueStore } from "../transfer-queue-store";
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

/**
 * 获取同一服务器在另一模块对应的 scopeKey：
 * sftp:serverId <-> workspace:serverId 互通，sftp:local 独立保持无 sibling
 */
export const getSiblingScopeKey = (scopeKey: string): string | null => {
  if (scopeKey.startsWith('sftp:') && scopeKey !== 'sftp:local') {
    return `workspace:${scopeKey.slice(5)}`;
  }
  if (scopeKey.startsWith('workspace:')) {
    return `sftp:${scopeKey.slice(10)}`;
  }
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
    // 同一服务器的历史书签相互互通合并（SFTP 与工作台）
    const serverIds = new Set<string>();
    for (const key of Object.keys(result)) {
      if (key.startsWith('sftp:') && key !== 'sftp:local') {
        serverIds.add(key.slice(5));
      } else if (key.startsWith('workspace:')) {
        serverIds.add(key.slice(10));
      }
    }
    for (const sid of serverIds) {
      const sftpKey = `sftp:${sid}`;
      const wsKey = `workspace:${sid}`;
      const sftpList = result[sftpKey] || [];
      const wsList = result[wsKey] || [];
      const merged = Array.from(new Set([...sftpList, ...wsList]));
      result[sftpKey] = merged;
      result[wsKey] = merged;
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

const normalizeOptionalSizeKb = (kb: number | null): number | null => {
  if (kb === null || !Number.isFinite(kb)) return null;
  return Math.max(0, Math.floor(kb));
};

function syncExclusionConfig(state: {
  sftpExclusionEnabled: boolean;
  sftpExclusionPatterns: string[];
  sftpRespectGitignore: boolean;
  sftpIncludePatterns: string[];
  sftpMinSizeKb: number | null;
  sftpMaxSizeKb: number | null;
}): void {
  sshService
    .setExclusionConfig(
      state.sftpExclusionEnabled,
      state.sftpExclusionPatterns,
      state.sftpRespectGitignore,
      {
        includePatterns: state.sftpIncludePatterns,
        minSizeBytes:
          state.sftpMinSizeKb !== null ? state.sftpMinSizeKb * 1024 : null,
        maxSizeBytes:
          state.sftpMaxSizeKb !== null ? state.sftpMaxSizeKb * 1024 : null,
      },
    )
    .catch((err) => {
      console.error("Failed to sync exclusion config to backend:", err);
    });
}

export const createSftpSlice: StateCreator<AppState, [], [], SftpSlice> = (
  set,
  get,
) => ({
  // SFTP Settings Defaults & Setters
  // SFTP 统一文件视图模式：默认 'list'（兼容旧字段 sftpLocalViewMode / sftpRemoteViewMode，始终三字段同步）
  sftpLocalViewMode: "list",
  setSftpLocalViewMode: (mode) =>
    set({
      sftpDefaultViewMode: mode,
      sftpLocalViewMode: mode,
      sftpRemoteViewMode: mode,
    }),
  sftpRemoteViewMode: "list",
  setSftpRemoteViewMode: (mode) =>
    set({
      sftpDefaultViewMode: mode,
      sftpLocalViewMode: mode,
      sftpRemoteViewMode: mode,
    }),
  // 统一隐藏文件开关：默认沿用工作台偏好（true），写入时同步 SFTP 与工作台偏好字段
  sftpShowHidden: getInitialWorkspaceFileShowHidden(),
  setSftpShowHidden: (show) => {
    set({
      sftpShowHidden: show,
      sftpLocalShowHidden: show,
      sftpRemoteShowHidden: show,
      workspaceFileShowHidden: show,
    });
    try {
      localStorage.setItem('qshell.sftp.local.showHidden', String(show));
      localStorage.setItem('qshell.sftp.remote.showHidden', String(show));
      localStorage.setItem('qshell.workspace.files.showHidden', String(show));
    } catch {}
  },
  // 以下两项保留向后兼容与云端同步字段形状，写入时统一触发全局同步
  sftpLocalShowHidden: getInitialWorkspaceFileShowHidden(),
  setSftpLocalShowHidden: (show) => {
    set({
      sftpShowHidden: show,
      sftpLocalShowHidden: show,
      sftpRemoteShowHidden: show,
      workspaceFileShowHidden: show,
    });
    try {
      localStorage.setItem('qshell.sftp.local.showHidden', String(show));
      localStorage.setItem('qshell.sftp.remote.showHidden', String(show));
      localStorage.setItem('qshell.workspace.files.showHidden', String(show));
    } catch {}
  },
  sftpRemoteShowHidden: getInitialWorkspaceFileShowHidden(),
  setSftpRemoteShowHidden: (show) => {
    set({
      sftpShowHidden: show,
      sftpLocalShowHidden: show,
      sftpRemoteShowHidden: show,
      workspaceFileShowHidden: show,
    });
    try {
      localStorage.setItem('qshell.sftp.local.showHidden', String(show));
      localStorage.setItem('qshell.sftp.remote.showHidden', String(show));
      localStorage.setItem('qshell.workspace.files.showHidden', String(show));
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
  // SFTP 传输并发量（1-8）：默认 3
  sftpTransferConcurrency: 3,
  setSftpTransferConcurrency: (n) => {
    const normalized = Math.max(1, Math.min(8, Math.floor(n) || 1));
    set({ sftpTransferConcurrency: normalized });
    useTransferQueueStore.getState().setMaxConcurrent(normalized);
  },
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
    syncExclusionConfig({ ...get(), sftpExclusionEnabled: enabled });
  },
  sftpExclusionPatterns: DEFAULT_SFTP_EXCLUSIONS,
  setSftpExclusionPatterns: (patterns) => {
    set({ sftpExclusionPatterns: patterns });
    syncExclusionConfig({ ...get(), sftpExclusionPatterns: patterns });
  },
  sftpRespectGitignore: false,
  sftpSymlinkPolicy: 'skip',
  setSftpSymlinkPolicy: (policy) => {
    set({ sftpSymlinkPolicy: policy });
    sshService.setSymlinkPolicy(policy).catch((err) => {
      console.error('Failed to sync symlink policy to backend:', err);
    });
  },
  setSftpRespectGitignore: (respect) => {
    set({ sftpRespectGitignore: respect });
    syncExclusionConfig({ ...get(), sftpRespectGitignore: respect });
  },
  // SFTP 双栏布局模式与目录树偏好（P1-15）
  sftpPaneMode: 'dual',
  setSftpPaneMode: (mode) => set({ sftpPaneMode: mode }),
  sftpShowDirectoryTree: false,
  setSftpShowDirectoryTree: (show) => set({ sftpShowDirectoryTree: show }),
  // 外部编辑大小上限（MB，0 表示不限，受后端天花板约束）（P2-18）
  externalEditMaxSizeMb: 10,
  setExternalEditMaxSizeMb: (mb) =>
    set({
      externalEditMaxSizeMb: Number.isFinite(mb)
        ? Math.max(0, Math.floor(mb))
        : 10,
    }),
  // 高级传输包含与大小过滤规则（P2-19）
  sftpIncludePatterns: [],
  setSftpIncludePatterns: (patterns) => {
    set({ sftpIncludePatterns: patterns });
    syncExclusionConfig({ ...get(), sftpIncludePatterns: patterns });
  },
  sftpMinSizeKb: null,
  setSftpMinSizeKb: (kb) => {
    const normalized = normalizeOptionalSizeKb(kb);
    set({ sftpMinSizeKb: normalized });
    syncExclusionConfig({ ...get(), sftpMinSizeKb: normalized });
  },
  sftpMaxSizeKb: null,
  setSftpMaxSizeKb: (kb) => {
    const normalized = normalizeOptionalSizeKb(kb);
    set({ sftpMaxSizeKb: normalized });
    syncExclusionConfig({ ...get(), sftpMaxSizeKb: normalized });
  },

  // 路径收藏统一管理：针对同一服务器，工作台文件与SFTP远程面板双向互通共享
  pathBookmarks: loadLegacyBookmarks(),
  setPathBookmarks: (scopeKey, bookmarks) => {
    const siblingKey = getSiblingScopeKey(scopeKey);
    const updates: Record<string, string[]> = {
      [scopeKey]: bookmarks,
    };
    if (siblingKey) {
      updates[siblingKey] = bookmarks;
    }
    set((prev) => ({
      pathBookmarks: {
        ...prev.pathBookmarks,
        ...updates,
      },
    }));
    try {
      localStorage.setItem(scopeKeyToLegacyKey(scopeKey), JSON.stringify(bookmarks));
      if (siblingKey) {
        localStorage.setItem(scopeKeyToLegacyKey(siblingKey), JSON.stringify(bookmarks));
      }
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
    const siblingKey = getSiblingScopeKey(scopeKey);
    const current = get().pathBookmarks[scopeKey] || [];
    const siblingCurrent = siblingKey ? (get().pathBookmarks[siblingKey] || []) : [];
    const unified = Array.from(new Set([...current, ...siblingCurrent]));
    if (unified.includes(path)) return false;
    if (unified.length >= 50) return false;
    const next = [...unified, path];
    const updates: Record<string, string[]> = {
      [scopeKey]: next,
    };
    if (siblingKey) {
      updates[siblingKey] = next;
    }
    set((prev) => ({
      pathBookmarks: {
        ...prev.pathBookmarks,
        ...updates,
      },
    }));
    try {
      localStorage.setItem(scopeKeyToLegacyKey(scopeKey), JSON.stringify(next));
      if (siblingKey) {
        localStorage.setItem(scopeKeyToLegacyKey(siblingKey), JSON.stringify(next));
      }
    } catch {}
    return true;
  },
  removePathBookmark: (scopeKey, path) => {
    if (!path) return;
    const siblingKey = getSiblingScopeKey(scopeKey);
    const current = get().pathBookmarks[scopeKey] || [];
    const siblingCurrent = siblingKey ? (get().pathBookmarks[siblingKey] || []) : [];
    const unified = Array.from(new Set([...current, ...siblingCurrent]));
    const next = unified.filter((p) => p !== path);
    const updates: Record<string, string[]> = {
      [scopeKey]: next,
    };
    if (siblingKey) {
      updates[siblingKey] = next;
    }
    set((prev) => ({
      pathBookmarks: {
        ...prev.pathBookmarks,
        ...updates,
      },
    }));
    try {
      localStorage.setItem(scopeKeyToLegacyKey(scopeKey), JSON.stringify(next));
      if (siblingKey) {
        localStorage.setItem(scopeKeyToLegacyKey(siblingKey), JSON.stringify(next));
      }
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
    set({
      sftpShowHidden: show,
      sftpLocalShowHidden: show,
      sftpRemoteShowHidden: show,
      workspaceFileShowHidden: show,
    });
    try {
      localStorage.setItem('qshell.sftp.local.showHidden', String(show));
      localStorage.setItem('qshell.sftp.remote.showHidden', String(show));
      localStorage.setItem('qshell.workspace.files.showHidden', String(show));
    } catch {}
  },
});
