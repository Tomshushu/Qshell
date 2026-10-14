import type { StateCreator } from "zustand";
import { sshService } from "@/services/ssh-service";
import { HOST_GROUP_ID } from "@/lib/server-groups";
import { isReady as isStateReady } from "@/services/ssh-connection-state";
import { clearRemotePathCache } from "@/lib/command-intelligence/remote-path-completion";
import { clearProcessSnapshotStore } from "@/components/workspace/modules/process-store";
import { pruneWorkspaces } from "../workspace-helpers";
import type { AppState, ServerSlice, ServerStateEntry } from "../types";

export const createServerSlice: StateCreator<AppState, [], [], ServerSlice> = (
  set,
  get,
) => ({
  // Servers
  servers: [],
  trashCount: 0,
  addServer: (server) =>
    set((state) => ({ servers: [...state.servers, server] })),
  setTrashCount: (count) => set({ trashCount: count }),
  updateServer: (id, updates) =>
    set((state) => {
      const nextServer = state.servers.find((server) => server.id === id);
      const nextName = updates.name ?? nextServer?.name;
      const nextProtocol = updates.protocol ?? nextServer?.protocol;
      return {
        servers: state.servers.map((s) =>
          s.id === id ? { ...s, ...updates, updatedAt: Date.now() } : s,
        ),
        // 名称或主协议变更时同步现有工作台。SSH→RDP 自动切到远程桌面；
        // RDP→SSH 时仅把原 RDP 标签切回终端，避免留下不可见模块造成空白页。
        tabs: state.tabs.map((tab) => {
          if (tab.serverId !== id) return tab;
          const module =
            nextProtocol === "rdp"
              ? "rdp"
              : tab.module === "rdp"
                ? "terminal"
                : tab.module;
          return {
            ...tab,
            module,
            serverName: nextName ?? tab.serverName,
            title: nextName ?? tab.serverName,
          };
        }),
      };
    }),
  deleteServer: (id) => {
    clearRemotePathCache(id);
    clearProcessSnapshotStore(id);
    set((state) => {
      const tabsToDelete = state.tabs.filter((t) => t.serverId === id);
      tabsToDelete.forEach((t) => {
        sshService.clearTabSessions(t.id);
        if (t.serverId !== "sftp") {
          void sshService.disconnect(`ws:${t.serverId}:${t.id}`).catch(() => {});
        }
      });
      const newTabs = state.tabs.filter((t) => t.serverId !== id);
      const pruned = pruneWorkspaces(
        newTabs,
        state.groups,
        state.workspaces,
      );
      // 清理已删除服务器的连接状态，防止 connectedServers/serverStates 字典无限增长
      const restConnected: typeof state.connectedServers = { ...state.connectedServers };
      delete restConnected[id];
      const restServerStates: typeof state.serverStates = { ...state.serverStates };
      delete restServerStates[id];
      for (const t of tabsToDelete) {
        delete restConnected[`ws:${t.serverId}:${t.id}`];
        delete restServerStates[`ws:${t.serverId}:${t.id}`];
      }
      return {
        servers: state.servers.filter((s) => s.id !== id),
        tabs: pruned.tabs,
        activeTabId:
          state.activeTabId &&
          state.tabs.find((t) => t.id === state.activeTabId)?.serverId ===
            id
            ? null
            : state.activeTabId,
        groups: pruned.groups,
        workspaces: pruned.workspaces,
        layout: Object.values(pruned.workspaces)[0]?.layout ?? null,
        connectedServers: restConnected,
        serverStates: restServerStates,
      };
    });
  },
  deleteServers: (ids) => {
    for (const id of ids) {
      clearRemotePathCache(id);
      clearProcessSnapshotStore(id);
    }
    set((state) => {
      if (ids.length === 0) return state;
      const idSet = new Set(ids);
      const tabsToDelete = state.tabs.filter((t) => idSet.has(t.serverId));
      tabsToDelete.forEach((t) => {
        sshService.clearTabSessions(t.id);
        if (t.serverId !== "sftp") {
          void sshService.disconnect(`ws:${t.serverId}:${t.id}`).catch(() => {});
        }
      });
      const newTabs = state.tabs.filter((t) => !idSet.has(t.serverId));
      // 只 prune 一次，避免 N 台服务器执行 N 遍工作区裁剪
      const pruned = pruneWorkspaces(
        newTabs,
        state.groups,
        state.workspaces,
      );
      // 清理已删除服务器的连接状态/标签颜色，防止字典无限增长
      const connectedServers = { ...state.connectedServers };
      const serverStates = { ...state.serverStates };
      const tabColors = { ...state.tabColors };
      for (const id of ids) {
        delete connectedServers[id];
        delete serverStates[id];
        delete tabColors[id];
      }
      for (const t of tabsToDelete) {
        delete connectedServers[`ws:${t.serverId}:${t.id}`];
        delete serverStates[`ws:${t.serverId}:${t.id}`];
      }
      const activeTab = state.activeTabId
        ? state.tabs.find((t) => t.id === state.activeTabId)
        : undefined;
      return {
        servers: state.servers.filter((s) => !idSet.has(s.id)),
        tabs: pruned.tabs,
        activeTabId:
          activeTab && idSet.has(activeTab.serverId) ? null : state.activeTabId,
        groups: pruned.groups,
        workspaces: pruned.workspaces,
        layout: Object.values(pruned.workspaces)[0]?.layout ?? null,
        connectedServers,
        serverStates,
        tabColors,
      };
    });
  },
  setServers: (servers) => {
    const serverIds = new Set([...servers.map((s) => s.id), "sftp"]);
    const serverNameMap = new Map(servers.map((s) => [s.id, s.name]));
    set((state) => {
      // 清理引用已删除服务器的标签页，并同步服务器名称
      const validTabs = state.tabs
        .filter((t) => serverIds.has(t.serverId))
        .map((t) => {
          const updatedName = serverNameMap.get(t.serverId);
          if (updatedName && updatedName !== t.serverName) {
            return {
              ...t,
              serverName: updatedName,
              title: updatedName,
            };
          }
          return t;
        });
      const activeStillValid = validTabs.some(
        (t) => t.id === state.activeTabId,
      );
      const pruned = pruneWorkspaces(
        validTabs,
        state.groups,
        state.workspaces,
      );
      // 清理已删除服务器的连接状态
      const newConnected: Record<string, boolean> = {};
      const newServerStates: Record<string, ServerStateEntry> = {};
      for (const sid of serverIds) {
        if (state.connectedServers[sid] !== undefined)
          newConnected[sid] = state.connectedServers[sid];
        if (state.serverStates[sid] !== undefined)
          newServerStates[sid] = state.serverStates[sid];
      }
      return {
        servers,
        tabs: pruned.tabs,
        activeTabId: activeStillValid
          ? state.activeTabId
          : pruned.tabs.length > 0
            ? pruned.tabs[pruned.tabs.length - 1].id
            : null,
        groups: pruned.groups,
        workspaces: pruned.workspaces,
        layout: Object.values(pruned.workspaces)[0]?.layout ?? null,
        connectedServers: newConnected,
        serverStates: newServerStates,
      };
    });
  },

  // 从 SQLite 重新加载服务器列表 + 回收站计数
  loadServers: async () => {
    try {
      const dbServers = await sshService.listServers();
      // sshService.listServers 已由适配层归一化（snake_case→camelCase、tags/protocols JSON 解析），
      // 此处不再白名单重建——旧写法会丢失 rdpPort/bmcPort/lastDisconnectedAt 等字段
      const normalizedServers = dbServers;
      get().setServers(normalizedServers);
      try {
        const trash = await sshService.listTrashServers();
        get().setTrashCount(trash.length);
      } catch (e) {
        console.error("Failed to load trash count:", e);
      }
    } catch (e) {
      console.error("Failed to load servers:", e);
    }
  },

  // 服务器分组（树形目录）
  serverGroups: [],
  setServerGroups: (groups) => set({ serverGroups: groups }),
  addServerGroup: (group) =>
    set((state) => ({ serverGroups: [...state.serverGroups, group] })),
  updateServerGroup: (id, updates) =>
    set((state) => ({
      serverGroups: state.serverGroups.map((g) =>
        g.id === id ? { ...g, ...updates, updatedAt: Date.now() } : g,
      ),
    })),
  deleteServerGroup: (id) =>
    set((state) => {
      // 计算被删除子树的全部分组 ID（BFS）
      const removed = new Set<string>([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const g of state.serverGroups) {
          if (g.parentId && removed.has(g.parentId) && !removed.has(g.id)) {
            removed.add(g.id);
            changed = true;
          }
        }
      }
      return {
        serverGroups: state.serverGroups.filter((g) => !removed.has(g.id)),
        // 组内服务器移到「服务器」分组（不删除服务器本身）
        servers: state.servers.map((s) =>
          s.groupId && removed.has(s.groupId)
            ? { ...s, groupId: HOST_GROUP_ID }
            : s,
        ),
      };
    }),

  // 标签目录（独立存储）
  tags: [],
  setTags: (tags) => set({ tags: [...new Set(tags)].sort() }),
  loadTags: async () => {
    try {
      const tags = await sshService.listTags();
      set({ tags: [...new Set(tags)].sort() });
    } catch (e) {
      console.error("Failed to load tags:", e);
    }
  },
  addTag: (name) =>
    set((state) => {
      if (state.tags.includes(name)) return state;
      return { tags: [...state.tags, name].sort() };
    }),
  renameTag: (oldName, newName) =>
    set((state) => ({
      tags: state.tags.map((t) => (t === oldName ? newName : t)).sort(),
      servers: state.servers.map((s) =>
        (s.tags || []).includes(oldName)
          ? { ...s, tags: s.tags!.map((t) => (t === oldName ? newName : t)) }
          : s,
      ),
    })),
  deleteTag: (name) =>
    set((state) => ({
      tags: state.tags.filter((t) => t !== name),
      servers: state.servers.map((s) =>
        (s.tags || []).includes(name)
          ? { ...s, tags: s.tags!.filter((t) => t !== name) }
          : s,
      ),
    })),

  // SSH Keys
  keys: [],
  addKey: (key) => set((state) => ({ keys: [...state.keys, key] })),
  updateKey: (id, updates) =>
    set((state) => ({
      keys: state.keys.map((k) =>
        k.id === id ? { ...k, ...updates, updatedAt: Date.now() } : k,
      ),
    })),
  deleteKey: (id) =>
    set((state) => ({ keys: state.keys.filter((k) => k.id !== id) })),
  setKeys: (keys) => set({ keys }),

  // Connection status
  connectedServers: {},
  // 注意：setServerConnected 不再直接写 connectedServers。
  // connectedServers 由 setServerState 同步维护，并受 generation 校验保护。
  setServerConnected: (serverId, connected) => {
    set((state) => {
      const existing = state.serverStates[serverId];
      if (existing) {
        return state;
      }
      return {
        connectedServers: {
          ...state.connectedServers,
          [serverId]: connected,
        },
      };
    });
  },
  manualDisconnect: {},
  setManualDisconnect: (serverId, value) =>
    set((state) => ({
      manualDisconnect: { ...state.manualDisconnect, [serverId]: value },
    })),
  syncConnectionState: (connectedIds) =>
    set(() => {
      const connectedServers: Record<string, boolean> = {};
      for (const id of connectedIds) {
        connectedServers[id] = true;
      }
      return { connectedServers };
    }),

  // Connection state machine
  serverStates: {},
  setServerState: (serverId, state, error, errorKind, generation) =>
    set((state_) => {
      const prev = state_.serverStates[serverId];
      // generation 过期检查：若新事件 generation <= 已知 generation，则丢弃
      if (
        generation !== undefined &&
        prev &&
        prev.generation !== undefined
      ) {
        if (generation < prev.generation) {
          return state_;
        }
      }
      const nextEntry: ServerStateEntry = {
        state,
        error,
        errorKind,
        generation: generation ?? prev?.generation ?? 0,
      };
      // 连接成功时清除手动断开标志
      const nextManualDisconnect = isStateReady(state)
        ? { ...state_.manualDisconnect, [serverId]: false }
        : state_.manualDisconnect;
      return {
        serverStates: {
          ...state_.serverStates,
          [serverId]: nextEntry,
        },
        // 同步更新 connectedServers（向后兼容旧逻辑）
        connectedServers: {
          ...state_.connectedServers,
          [serverId]: isStateReady(state),
        },
        manualDisconnect: nextManualDisconnect,
      };
    }),
  clearServerState: (serverId) =>
    set((state_) => {
      const next = { ...state_.serverStates };
      delete next[serverId];
      const nextConnected = { ...state_.connectedServers };
      delete nextConnected[serverId];
      const nextManualDisconnect = { ...state_.manualDisconnect };
      delete nextManualDisconnect[serverId];
      return {
        serverStates: next,
        connectedServers: nextConnected,
        manualDisconnect: nextManualDisconnect,
      };
    }),
  syncServerStates: (entries) =>
    set((state_) => {
      // 同步派生 connectedServers
      const nextConnected = { ...state_.connectedServers };
      for (const [id, entry] of Object.entries(entries)) {
        nextConnected[id] = isStateReady(entry.state);
      }
      return { serverStates: entries, connectedServers: nextConnected };
    }),

  // Auto refresh
  autoRefresh: true,
  refreshInterval: 10,
  setAutoRefresh: (enabled) => set({ autoRefresh: enabled }),
  setRefreshInterval: (seconds) => set({ refreshInterval: seconds }),
});
