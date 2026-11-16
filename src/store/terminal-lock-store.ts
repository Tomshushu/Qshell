import { create } from "zustand";

export interface LockedTerminalEntry {
  termId: string;
  tabId: string;
  /** 所属分屏工作台 ID（存在时代表锁定整个工作台） */
  workspaceId?: string;
  /** 锁定时属于该工作台的全部标签 ID（确保分屏内各窗格同步拦截） */
  memberTabIds?: string[];
  serverId?: string;
  lockedAt: number;
}

interface TerminalLockState {
  lockedByTermId: Record<string, LockedTerminalEntry>;
  lockTerminal: (entry: Omit<LockedTerminalEntry, "lockedAt"> & { lockedAt?: number }) => void;
  unlockTerminal: (termId: string) => void;
  unlockTabTerminals: (tabId: string) => void;
  isTermLocked: (termId: string | null | undefined) => boolean;
  isTabLocked: (tabId: string | null | undefined) => boolean;
  isWorkspaceLocked: (workspaceId: string | null | undefined) => boolean;
  isLockedTarget: (termId: string | null | undefined, tabId: string | null | undefined) => boolean;
  getTabLockEntry: (tabId: string | null | undefined) => LockedTerminalEntry | undefined;
  getWorkspaceLockEntry: (workspaceId: string | null | undefined) => LockedTerminalEntry | undefined;
  reset: () => void;
}

/**
 * 局部终端锁运行期状态（仅内存，不影响其他标签页/分屏及后台连接存活）。
 */
export const useTerminalLockStore = create<TerminalLockState>((set, get) => ({
  lockedByTermId: {},

  lockTerminal: (entry) => {
    if (!entry.termId) return;
    set((state) => ({
      lockedByTermId: {
        ...state.lockedByTermId,
        [entry.termId]: {
          ...entry,
          lockedAt: entry.lockedAt ?? Date.now(),
        },
      },
    }));
  },

  unlockTerminal: (termId) => {
    if (!termId) return;
    set((state) => {
      if (!(termId in state.lockedByTermId)) return state;
      const next = { ...state.lockedByTermId };
      delete next[termId];
      return { lockedByTermId: next };
    });
  },

  unlockTabTerminals: (tabId) => {
    if (!tabId) return;
    set((state) => {
      const next: Record<string, LockedTerminalEntry> = {};
      let changed = false;
      for (const [id, entry] of Object.entries(state.lockedByTermId)) {
        if (entry.tabId === tabId) {
          changed = true;
        } else {
          next[id] = entry;
        }
      }
      return changed ? { lockedByTermId: next } : state;
    });
  },

  isTermLocked: (termId) => {
    if (!termId) return false;
    return termId in get().lockedByTermId;
  },

  isTabLocked: (tabId) => {
    if (!tabId) return false;
    return Object.values(get().lockedByTermId).some(
      (e) => e.tabId === tabId || Boolean(e.memberTabIds?.includes(tabId)),
    );
  },

  isWorkspaceLocked: (workspaceId) => {
    if (!workspaceId) return false;
    return Object.values(get().lockedByTermId).some((e) => e.workspaceId === workspaceId);
  },

  isLockedTarget: (termId, tabId) => {
    const state = get();
    return state.isTermLocked(termId) || state.isTabLocked(tabId);
  },

  getTabLockEntry: (tabId) => {
    if (!tabId) return undefined;
    return Object.values(get().lockedByTermId).find(
      (e) => e.tabId === tabId || Boolean(e.memberTabIds?.includes(tabId)),
    );
  },

  getWorkspaceLockEntry: (workspaceId) => {
    if (!workspaceId) return undefined;
    return Object.values(get().lockedByTermId).find((e) => e.workspaceId === workspaceId);
  },

  reset: () => set({ lockedByTermId: {} }),
}));
