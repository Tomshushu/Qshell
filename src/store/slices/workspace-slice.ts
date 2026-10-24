import type { StateCreator } from "zustand";
import type {
  GroupLeafNode,
  SplitLayoutNode,
  TabGroup,
  WorkspaceDef,
  WorkspaceTab,
} from "@/types";
import {
  clampRatio,
  createGroupLeaf,
  createSplitNode,
  replaceGroupNode,
  updateSplitRatio,
} from "@/utils/split-layout";
import { sshService } from "@/services/ssh-service";
import { playSound, SoundType } from "@/lib/sound";
import { recordConnection } from "@/lib/recent-connections";
import { clearRemotePathCache } from "@/lib/command-intelligence/remote-path-completion";
import { clearDynamicCache } from "@/lib/command-intelligence/dynamic-completion";
import { clearUserAliases } from "@/lib/command-intelligence/alias-map";
import {
  getSerialPortName,
  loadWorkspaceSession,
  newGroupId,
  newWorkspaceId,
  pruneWorkspaces,
  resolveTargetGroupId,
} from "../workspace-helpers";
import type { AppState, WorkspaceSlice } from "../types";

const savedSession = loadWorkspaceSession();

export const createWorkspaceSlice: StateCreator<
  AppState,
  [],
  [],
  WorkspaceSlice
> = (set, get) => ({
  // Tabs（支持页面刷新时从 Session 恢复）
  tabs: savedSession?.tabs ?? [],
  activeTabId: savedSession?.activeTabId ?? null,
  tabColors: {},

  // SFTP 批量打开联动
  sftpPendingOpenServerIds: [],
  openSftpWithServers: (serverIds: string[]) => {
    set({ sftpPendingOpenServerIds: serverIds });
    get().openTab("sftp", "SFTP 传输", "files");
  },
  clearSftpPendingOpenServers: () => {
    set({ sftpPendingOpenServerIds: [] });
  },

  // Split layout
  workspaces: savedSession?.workspaces ?? {},
  groups: savedSession?.groups ?? {},
  layout: savedSession?.layout ?? null,
  lastActiveGroupId: savedSession?.lastActiveGroupId ?? null,
  splitDropTarget: null,

  openTab: (serverId, serverName, module, initialCommand) => {
    recordConnection(serverId);
    // SFTP 是全局单例工作台：已存在则直接跳转，不新建
    const isSingleton = serverId === "sftp";
    // 物理串口通常由操作系统独占；同一串口连接重复双击时复用已有工作台，
    // 避免第二个标签打开同一 COM/TTY 后只得到“端口被占用”。
    const targetServer = get().servers.find((server) => server.id === serverId);
    const isSerialTerminal =
      module === "terminal" &&
      (targetServer?.targetType === "serial" || targetServer?.protocol === "serial");
    const targetSerialPort = isSerialTerminal
      ? getSerialPortName(targetServer)
      : null;
    // 终端与文件模块允许同一服务器打开多个标签（独立会话/路径）
    // 其他模块（overview/services 等）复用已有标签
    const existingTab = isSingleton || isSerialTerminal
      ? get().tabs.find((t) => {
          if (isSingleton) return t.serverId === serverId;
          const openedServer = get().servers.find((server) => server.id === t.serverId);
          return (
            t.module === "terminal" &&
            (t.serverId === serverId ||
              (targetSerialPort !== null &&
                getSerialPortName(openedServer) === targetSerialPort))
          );
        })
      : module === "terminal" || module === "files"
        ? undefined
        : get().tabs.find(
            (t) => t.serverId === serverId && t.module === module,
          );
    if (existingTab) {
      get().setActiveTab(existingTab.id);
      return;
    }
    const tabId = `${serverId}-${module}-${crypto.randomUUID()}`;
    playSound(SoundType.Click);
    set((state) => {
      const gid = newGroupId();
      const groups = {
        ...state.groups,
        [gid]: { id: gid, activeTabId: tabId },
      };
      // 新 tab 是顶层独立标签（无 workspaceId）：全局 layout 必须指向新分组的
      // 单叶子。若沿用 state.layout（分屏 Workspace 的 split 树，真值），
      // TabGroupView 会误判 isWorkspaceSplit，在未分屏的新工作台顶部
      // 多显示一行窗格标题（服务器名）。split 树本体存于
      // workspaces[wsId].layout，切回该 Workspace 标签时由 setActiveTab 同步回来
      const layout = createGroupLeaf(gid);
      const tab: WorkspaceTab = {
        id: tabId,
        serverId,
        serverName,
        module,
        title: serverName,
        initialCommand,
        groupId: gid,
        // 套用该服务器已保存的颜色（关闭后重开仍生效）
        ...(get().tabColors[serverId]
          ? { color: get().tabColors[serverId] }
          : {}),
        // SFTP 固定标签：始终锁定，不可被关闭/解锁
        ...(serverId === "sftp" ? { locked: true } : {}),
      };
      return {
        tabs: [...state.tabs, tab],
        groups,
        layout,
        activeTabId: tabId,
        lastActiveGroupId: gid,
      };
    });
  },

  openServersInSplit: (entries) => {
    if (entries.length === 0) return;
    // 过滤重复 entry（相同 serverId + module 仅保留首个，防止重复窗格）
    const seenEntries = new Set<string>();
    entries = entries.filter((e) => {
      const key = `${e.serverId}-${e.module}`;
      if (seenEntries.has(key)) return false;
      seenEntries.add(key);
      return true;
    });
    if (entries.length === 0) return;
    const current = get();
    const occupiedSerialPorts = new Map<string, WorkspaceTab>();
    for (const tab of current.tabs) {
      const openedServer = current.servers.find((server) => server.id === tab.serverId);
      if (
        tab.module === "terminal" &&
        (openedServer?.targetType === "serial" || openedServer?.protocol === "serial")
      ) {
        const port = getSerialPortName(openedServer);
        if (port) occupiedSerialPorts.set(port, tab);
      }
    }
    const seenSerialPorts = new Set<string>();
    let firstExistingSerialTab: WorkspaceTab | undefined;
    entries = entries.filter((entry) => {
      const target = current.servers.find((server) => server.id === entry.serverId);
      const isSerial =
        entry.module === "terminal" &&
        (target?.targetType === "serial" || target?.protocol === "serial");
      if (!isSerial) return true;
      const port = getSerialPortName(target);
      if (!port) return true;
      const existing = occupiedSerialPorts.get(port);
      if (existing) {
        firstExistingSerialTab ??= existing;
        return false;
      }
      if (seenSerialPorts.has(port)) return false;
      seenSerialPorts.add(port);
      return true;
    });
    if (entries.length === 0) {
      if (firstExistingSerialTab) get().setActiveTab(firstExistingSerialTab.id);
      return;
    }
    // 单个：直接复用 openTab
    if (entries.length === 1) {
      get().openTab(
        entries[0].serverId,
        entries[0].serverName,
        entries[0].module,
      );
      return;
    }
    // 超过 6 个：退化为分别打开独立顶层标签页（不分屏，避免窗格过密不可读）
    if (entries.length > 6) {
      for (const e of entries) {
        get().openTab(e.serverId, e.serverName, e.module);
      }
      return;
    }
    // 2-6 个：在同一个 Workspace 内按 T 字型分屏（每次分割只拆一个窗格）
    playSound(SoundType.Click);
    set((state) => {
      const wsId = newWorkspaceId();
      const groups: Record<string, TabGroup> = { ...state.groups };
      const newTabs: WorkspaceTab[] = [];
      const leaves: GroupLeafNode[] = [];
      for (const e of entries) {
        const gid = newGroupId();
        const tabId = `${e.serverId}-${e.module}-${crypto.randomUUID()}`;
        groups[gid] = { id: gid, activeTabId: tabId };
        const tabColor = get().tabColors[e.serverId];
        newTabs.push({
          id: tabId,
          serverId: e.serverId,
          serverName: e.serverName,
          module: e.module,
          title: e.serverName,
          groupId: gid,
          workspaceId: wsId,
          ...(tabColor ? { color: tabColor } : {}),
        });
        leaves.push(createGroupLeaf(gid));
      }
      // 构造分屏布局树：均采用「左右两列，每列内上下均分」的 T 字型嵌套
      // buildColumn 把一段连续叶子按上下等分嵌套成 column 子树
      const buildColumn = (start: number, end: number): SplitLayoutNode => {
        if (end - start === 1) return leaves[start];
        if (end - start === 2)
          return createSplitNode(
            "column",
            leaves[start],
            leaves[start + 1],
            0.5,
          );
        // 3 个：第一个在上，后两个在下（继续 T 字型嵌套）
        if (end - start === 3) {
          const bottom = createSplitNode(
            "column",
            leaves[start + 1],
            leaves[start + 2],
            0.5,
          );
          return createSplitNode("column", leaves[start], bottom, 1 / 3);
        }
        // 4 个：上 2 + 下 2
        const top = createSplitNode(
          "column",
          leaves[start],
          leaves[start + 1],
          0.5,
        );
        const bottom = createSplitNode(
          "column",
          leaves[start + 2],
          leaves[start + 3],
          0.5,
        );
        return createSplitNode("column", top, bottom, 0.5);
      };
      let layout: SplitLayoutNode;
      if (entries.length === 2) {
        // 左右分屏
        layout = createSplitNode("row", leaves[0], leaves[1], 0.5);
      } else if (entries.length === 3) {
        // T 字型：左侧 1 + 右侧上下 2
        const rightSplit = createSplitNode(
          "column",
          leaves[1],
          leaves[2],
          0.5,
        );
        layout = createSplitNode("row", leaves[0], rightSplit, 0.5);
      } else if (entries.length === 4) {
        // 田字型：左右各一组上下分屏
        const leftSplit = createSplitNode(
          "column",
          leaves[0],
          leaves[1],
          0.5,
        );
        const rightSplit = createSplitNode(
          "column",
          leaves[2],
          leaves[3],
          0.5,
        );
        layout = createSplitNode("row", leftSplit, rightSplit, 0.5);
      } else if (entries.length === 5) {
        // 5 窗格：左列 2 + 右列 3
        const leftSplit = buildColumn(0, 2);
        const rightSplit = buildColumn(2, 5);
        layout = createSplitNode("row", leftSplit, rightSplit, 0.4);
      } else {
        // 6 窗格：左列 3 + 右列 3
        const leftSplit = buildColumn(0, 3);
        const rightSplit = buildColumn(3, 6);
        layout = createSplitNode("row", leftSplit, rightSplit, 0.5);
      }
      const firstTab = newTabs[0];
      const workspaces = {
        ...state.workspaces,
        [wsId]: {
          id: wsId,
          name: `Workspace ${Object.keys(state.workspaces).length + 1}`,
          layout,
        },
      };
      return {
        tabs: [...state.tabs, ...newTabs],
        groups,
        workspaces,
        layout,
        activeTabId: firstTab.id,
        lastActiveGroupId: leaves[0].groupId,
      };
    });
  },

  closeTab: (tabId) =>
    set((state) => {
      // 锁定的 tab 不能关闭
      const tabToClose = state.tabs.find((t) => t.id === tabId);
      if (tabToClose?.locked) return state;
      playSound(SoundType.Click);
      sshService.clearTabSessions(tabId);
      if (tabToClose?.serverId && tabToClose.serverId !== "sftp") {
        const wsConnId = `ws:${tabToClose.serverId}:${tabId}`;
        void sshService.disconnect(wsConnId).catch(() => {});
      }
      if (
        tabToClose?.serverId &&
        !state.tabs.some((t) => t.id !== tabId && t.serverId === tabToClose.serverId)
      ) {
        clearRemotePathCache(tabToClose.serverId);
        clearDynamicCache(tabToClose.serverId);
        clearUserAliases(tabToClose.serverId);
      }

      const newTabs = state.tabs.filter((t) => t.id !== tabId);
      let newActiveId = state.activeTabId;

      if (state.activeTabId === tabId) {
        // SFTP 是常驻固定标签（locked，不可关闭），不代表"还有其它服务器"，
        // 因此排除它后再决定回到哪里：还有服务器就切到相邻服务器，否则回首页。
        const activatable = newTabs.filter((t) => t.serverId !== "sftp");
        const gid = tabToClose?.groupId;
        const groupTabs = gid
          ? activatable.filter((t) => t.groupId === gid)
          : [];
        if (groupTabs.length > 0) {
          // 优先切换到同分组内的相邻标签
          const closedIdxInGroup = state.tabs
            .filter((t) => t.groupId === gid && t.serverId !== "sftp")
            .findIndex((t) => t.id === tabId);
          newActiveId =
            groupTabs[
              Math.min(Math.max(closedIdxInGroup, 0), groupTabs.length - 1)
            ].id;
        } else if (activatable.length === 0) {
          // 没有其它服务器标签了 → 回到首页
          newActiveId = null;
        } else {
          // 分组已空：退到全局相邻标签
          const closedIndex = state.tabs
            .filter((t) => t.serverId !== "sftp")
            .findIndex((t) => t.id === tabId);
          const adjacentIndex = Math.min(
            Math.max(closedIndex, 0),
            activatable.length - 1,
          );
          newActiveId = activatable[adjacentIndex].id;
        }
      }

      // 清理因关闭而变空的分组与坍缩 Workspace
      const pruned = pruneWorkspaces(
        newTabs,
        state.groups,
        state.workspaces,
      );
      const newActiveTab = pruned.tabs.find((t) => t.id === newActiveId);
      const activeWsLayout = newActiveTab?.workspaceId
        ? pruned.workspaces[newActiveTab.workspaceId]?.layout
        : null;

      let layoutNode: SplitLayoutNode | null = activeWsLayout ?? null;
      if (!layoutNode && pruned.tabs.length > 0) {
        const fallbackGid =
          newActiveTab?.groupId || Object.keys(pruned.groups)[0];
        if (fallbackGid) layoutNode = createGroupLeaf(fallbackGid);
      }

      const nextConnected = { ...state.connectedServers };
      const nextServerStates = { ...state.serverStates };
      if (tabToClose?.serverId && tabToClose.serverId !== "sftp") {
        const wsConnId = `ws:${tabToClose.serverId}:${tabId}`;
        delete nextConnected[wsConnId];
        delete nextServerStates[wsConnId];
      }

      return {
        tabs: pruned.tabs,
        activeTabId: newActiveId,
        groups: pruned.groups,
        workspaces: pruned.workspaces,
        layout: layoutNode,
        lastActiveGroupId: newActiveTab?.groupId ?? null,
        broadcastTabIds: state.broadcastTabIds.filter((id) =>
          pruned.tabs.some((t) => t.id === id),
        ),
        connectedServers: nextConnected,
        serverStates: nextServerStates,
      };
    }),

  setActiveTab: (tabId) =>
    set((state) => {
      if (tabId === null) return { activeTabId: null };
      const tab = state.tabs.find((t) => t.id === tabId);
      const gid = tab?.groupId;
      if (!gid || !state.groups[gid]) return { activeTabId: tabId };
      // 切换到不同 tab 时播放轻量导航音
      if (state.activeTabId !== tabId) {
        playSound(SoundType.Navigate);
      }
      // 同步更新 state.layout 为当前 tab 所属 workspace 的 layout：
      // - 有 workspaceId：用对应 workspace 的 layout
      // - 顶层独立 tab（无 workspaceId）：构造单 group 的 leaf layout，
      //   否则保留旧 workspace 的 split layout 会导致 TabGroupView 误判
      //   isWorkspaceSplit，在未分屏的顶层 tab 下多显示窗格 header
      const wsId = tab.workspaceId;
      const newLayout = wsId
        ? (state.workspaces[wsId]?.layout ?? null)
        : gid
          ? createGroupLeaf(gid)
          : null;
      return {
        activeTabId: tabId,
        lastActiveGroupId: gid,
        groups: {
          ...state.groups,
          [gid]: { ...state.groups[gid], activeTabId: tabId },
        },
        layout: newLayout ?? state.layout,
      };
    }),

  switchModule: (tabId, module) =>
    set((state) => {
      const current = state.tabs.find((t) => t.id === tabId);
      if (current && current.module !== module) {
        playSound(SoundType.Navigate);
      }
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? {
                ...t,
                module,
                title: t.serverName,
              }
            : t,
        ),
      };
    }),

  closeOtherTabs: (tabId) =>
    set((state) => {
      // 锁定的 tab 不会被关闭
      const closingTabs = state.tabs.filter((t) => t.id !== tabId && !t.locked);
      closingTabs.forEach((t) => {
        sshService.clearTabSessions(t.id);
        if (t.serverId && t.serverId !== "sftp") {
          void sshService.disconnect(`ws:${t.serverId}:${t.id}`).catch(() => {});
        }
      });
      const newTabs = state.tabs.filter((t) => t.id === tabId || t.locked);
      for (const t of closingTabs) {
        if (!newTabs.some((nt) => nt.serverId === t.serverId)) {
          clearRemotePathCache(t.serverId);
          clearDynamicCache(t.serverId);
          clearUserAliases(t.serverId);
        }
      }
      const nextConnected = { ...state.connectedServers };
      const nextServerStates = { ...state.serverStates };
      for (const t of closingTabs) {
        if (t.serverId && t.serverId !== "sftp") {
          const wsConnId = `ws:${t.serverId}:${t.id}`;
          delete nextConnected[wsConnId];
          delete nextServerStates[wsConnId];
        }
      }
      const pruned = pruneWorkspaces(
        newTabs,
        state.groups,
        state.workspaces,
      );
      const keptTab = pruned.tabs.find((t) => t.id === tabId);
      const gid = keptTab?.groupId ?? null;
      const activeLayout = keptTab?.workspaceId
        ? (pruned.workspaces[keptTab.workspaceId]?.layout ?? null)
        : gid
          ? createGroupLeaf(gid)
          : null;
      playSound(SoundType.Click);
      return {
        tabs: pruned.tabs,
        activeTabId: tabId,
        groups: pruned.groups,
        workspaces: pruned.workspaces,
        layout: activeLayout,
        lastActiveGroupId: gid ?? state.lastActiveGroupId,
        broadcastTabIds: state.broadcastTabIds.filter((id) =>
          pruned.tabs.some((t) => t.id === id),
        ),
        connectedServers: nextConnected,
        serverStates: nextServerStates,
      };
    }),

  closeOtherTabsInWorkspace: (tabId) =>
    set((state) => {
      const currentTab = state.tabs.find((t) => t.id === tabId);
      if (!currentTab) return state;

      // 仅筛选同一 workspace（或无 workspaceId 时的所有分屏）中其它未锁定的标签
      const closingTabs = state.tabs.filter((t) => {
        if (t.id === tabId || t.locked) return false;
        if (currentTab.workspaceId) {
          return t.workspaceId === currentTab.workspaceId;
        }
        return !t.workspaceId && t.groupId !== currentTab.groupId;
      });

      if (closingTabs.length === 0) return state;

      closingTabs.forEach((t) => {
        sshService.clearTabSessions(t.id);
        if (t.serverId && t.serverId !== "sftp") {
          void sshService.disconnect(`ws:${t.serverId}:${t.id}`).catch(() => {});
        }
      });
      const closingIds = new Set(closingTabs.map((t) => t.id));
      const newTabs = state.tabs.filter((t) => !closingIds.has(t.id));

      for (const t of closingTabs) {
        if (!newTabs.some((nt) => nt.serverId === t.serverId)) {
          clearRemotePathCache(t.serverId);
          clearDynamicCache(t.serverId);
          clearUserAliases(t.serverId);
        }
      }

      const nextConnected = { ...state.connectedServers };
      const nextServerStates = { ...state.serverStates };
      for (const t of closingTabs) {
        if (t.serverId && t.serverId !== "sftp") {
          const wsConnId = `ws:${t.serverId}:${t.id}`;
          delete nextConnected[wsConnId];
          delete nextServerStates[wsConnId];
        }
      }

      const pruned = pruneWorkspaces(
        newTabs,
        state.groups,
        state.workspaces,
      );
      const keptTab = pruned.tabs.find((t) => t.id === tabId);
      const gid = keptTab?.groupId ?? null;
      const activeLayout = keptTab?.workspaceId
        ? (pruned.workspaces[keptTab.workspaceId]?.layout ?? null)
        : gid
          ? createGroupLeaf(gid)
          : null;
      playSound(SoundType.Click);
      return {
        tabs: pruned.tabs,
        activeTabId: tabId,
        groups: pruned.groups,
        workspaces: pruned.workspaces,
        layout: activeLayout,
        lastActiveGroupId: gid ?? state.lastActiveGroupId,
        broadcastTabIds: state.broadcastTabIds.filter((id) =>
          pruned.tabs.some((t) => t.id === id),
        ),
        connectedServers: nextConnected,
        serverStates: nextServerStates,
      };
    }),

  closeAllTabs: (force?: boolean) => {
    set((state) => {
      // 锁定的 tab 常规下不关闭；当 force 为 true（如应用锁安全重置）时强制关闭并断开所有 tab
      const closingTabs = force ? state.tabs : state.tabs.filter((t) => !t.locked);
      closingTabs.forEach((t) => {
        sshService.clearTabSessions(t.id);
        if (t.serverId && t.serverId !== "sftp") {
          void sshService.disconnect(`ws:${t.serverId}:${t.id}`).catch(() => {});
        }
      });
      const newTabs = force ? [] : state.tabs.filter((t) => t.locked);
      for (const t of closingTabs) {
        if (!newTabs.some((nt) => nt.serverId === t.serverId)) {
          clearRemotePathCache(t.serverId);
          clearDynamicCache(t.serverId);
          clearUserAliases(t.serverId);
        }
      }
      const nextConnected = { ...state.connectedServers };
      const nextServerStates = { ...state.serverStates };
      for (const t of closingTabs) {
        if (t.serverId && t.serverId !== "sftp") {
          const wsConnId = `ws:${t.serverId}:${t.id}`;
          delete nextConnected[wsConnId];
          delete nextServerStates[wsConnId];
        }
      }
      const pruned = pruneWorkspaces(
        newTabs,
        state.groups,
        state.workspaces,
      );
      playSound(SoundType.Click);
      return {
        tabs: pruned.tabs,
        activeTabId: null,
        groups: pruned.groups,
        workspaces: pruned.workspaces,
        layout: Object.values(pruned.workspaces)[0]?.layout ?? null,
        lastActiveGroupId: Object.keys(pruned.groups)[0] ?? null,
        broadcastTabIds: state.broadcastTabIds.filter((id) =>
          pruned.tabs.some((t) => t.id === id),
        ),
        connectedServers: nextConnected,
        serverStates: nextServerStates,
      };
    });
  },

  reorderTabs: (fromId, toId, position) =>
    set((state) => {
      const fromTab = state.tabs.find((t) => t.id === fromId);
      const toTab = state.tabs.find((t) => t.id === toId);
      if (!fromTab || !toTab || fromId === toId) return state;

      if (fromTab.workspaceId) {
        const wsTabs = state.tabs.filter(
          (t) => t.workspaceId === fromTab.workspaceId,
        );
        const remainingTabs = state.tabs.filter(
          (t) => t.workspaceId !== fromTab.workspaceId,
        );
        const toIndex = remainingTabs.findIndex((t) => t.id === toId);
        if (toIndex === -1) {
          const newTabs = [...state.tabs];
          return { tabs: newTabs };
        }
        const insertIndex = position === "before" ? toIndex : toIndex + 1;
        remainingTabs.splice(insertIndex, 0, ...wsTabs);
        return { tabs: remainingTabs };
      }

      const fromIndex = state.tabs.findIndex((t) => t.id === fromId);
      const toIndex = state.tabs.findIndex((t) => t.id === toId);
      if (fromIndex === -1 || toIndex === -1) return state;
      const newTabs = [...state.tabs];
      const [moved] = newTabs.splice(fromIndex, 1);
      const newToIndex = newTabs.findIndex((t) => t.id === toId);
      const insertIndex =
        position === "before" ? newToIndex : newToIndex + 1;
      newTabs.splice(insertIndex, 0, moved);
      return { tabs: newTabs };
    }),

  duplicateTab: (tabId) =>
    set((state) => {
      const sourceTab = state.tabs.find((t) => t.id === tabId);
      if (!sourceTab) return state;
      playSound(SoundType.Click);
      const newId = `${sourceTab.serverId}-${sourceTab.module}-${crypto.randomUUID()}`;
      const newTab: WorkspaceTab = {
        ...sourceTab,
        id: newId,
        // 复制会话不继承锁定/临时标题
        locked: false,
        tempTitle: undefined,
        // 颜色按 serverId 持久化，复制的是同一台服务器，沿用已保存颜色
        color: state.tabColors[sourceTab.serverId],
      };
      // 插入到源 tab 之后（同分组）
      const sourceIndex = state.tabs.findIndex((t) => t.id === tabId);
      const newTabs = [...state.tabs];
      newTabs.splice(sourceIndex + 1, 0, newTab);
      const gid = sourceTab.groupId;
      return {
        tabs: newTabs,
        activeTabId: newId,
        ...(gid && state.groups[gid]
          ? {
              lastActiveGroupId: gid,
              groups: {
                ...state.groups,
                [gid]: { ...state.groups[gid], activeTabId: newId },
              },
            }
          : {}),
      };
    }),

  renameTab: (tabId, tempTitle) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, tempTitle: tempTitle || undefined } : t,
      ),
    })),

  toggleTabLock: (tabId) =>
    set((state) => {
      // SFTP 固定标签不允许解锁（顶部标签栏常驻，不能取消固定）
      const target = state.tabs.find((t) => t.id === tabId);
      if (target?.serverId === "sftp") return state;
      playSound(SoundType.Toggle);
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, locked: !t.locked } : t,
        ),
      };
    }),

  setTabColor: (tabId, color) =>
    set((state) => {
      const target = state.tabs.find((t) => t.id === tabId);
      if (!target) return state;
      const serverId = target.serverId;
      // 复制当前 tabColors，避免直接 mutate；color 为空则删除该服务器颜色
      const nextTabColors = { ...state.tabColors };
      if (color) nextTabColors[serverId] = color;
      else delete nextTabColors[serverId];
      return {
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, color } : t,
        ),
        tabColors: nextTabColors,
      };
    }),

  // 终端广播：记录已开启广播的 tab，输入时互相转发
  broadcastTabIds: [],
  toggleBroadcastTab: (tabId) =>
    set((state) => {
      playSound(SoundType.Toggle);
      return {
        broadcastTabIds: state.broadcastTabIds.includes(tabId)
          ? state.broadcastTabIds.filter((id) => id !== tabId)
          : [...state.broadcastTabIds, tabId],
      };
    }),

  restoreWindowState: (newTabs, newActiveTabId) =>
    set(() => {
      // 跨窗口迁移的 tab 统一放入一个新分组（新窗口默认无分屏）
      const gid = newGroupId();
      return {
        tabs: newTabs.map((t) => ({ ...t, groupId: gid })),
        activeTabId: newActiveTabId,
        groups: { [gid]: { id: gid, activeTabId: newActiveTabId } },
        layout: createGroupLeaf(gid),
        lastActiveGroupId: gid,
      };
    }),

  mergeTab: (tab) =>
    set((state) => {
      // 如果已存在相同 id 的 tab，不重复添加
      if (state.tabs.some((t) => t.id === tab.id)) {
        const gid0 = state.tabs.find((t) => t.id === tab.id)?.groupId;
        return {
          activeTabId: tab.id,
          ...(gid0 && state.groups[gid0]
            ? {
                lastActiveGroupId: gid0,
                groups: {
                  ...state.groups,
                  [gid0]: { ...state.groups[gid0], activeTabId: tab.id },
                },
              }
            : {}),
        };
      }
      // 合并进来的 tab 进入最近活跃分组（其原 groupId 属于其他窗口，无效）
      let gid = resolveTargetGroupId(state);
      let groups = state.groups;
      let layout = state.layout;
      if (!gid) {
        gid = newGroupId();
        groups = { ...groups, [gid]: { id: gid, activeTabId: tab.id } };
        layout = createGroupLeaf(gid);
      } else {
        groups = {
          ...groups,
          [gid]: { ...groups[gid], activeTabId: tab.id },
        };
      }
      return {
        tabs: [...state.tabs, { ...tab, groupId: gid }],
        groups,
        layout,
        activeTabId: tab.id,
        lastActiveGroupId: gid,
      };
    }),

  // ── 分屏布局操作 ──────────────────────────────────────────────────

  dragging: false,
  dragTabId: null,
  setDragState: (dragging, dragTabId) => set({ dragging, dragTabId }),
  maximizedGroupId: null,
  setMaximizedGroupId: (gid) => set({ maximizedGroupId: gid }),

  splitTab: (tabId, targetGroupId, direction, place) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      const targetTab = state.tabs.find((t) => t.groupId === targetGroupId);
      if (!tab || !targetTab || !state.groups[targetGroupId]) return state;
      // 拒绝无意义拆分提前返回时不响铃
      if (tab.groupId === targetGroupId) {
        const count = state.tabs.filter(
          (t) => t.groupId === targetGroupId,
        ).length;
        if (count <= 1) return state;
      }
      playSound(SoundType.Click);

      let wsId = targetTab.workspaceId ?? null;
      const wsName =
        wsId && state.workspaces[wsId]
          ? state.workspaces[wsId].name
          : `Workspace ${Object.keys(state.workspaces).length + 1}`;
      if (!wsId) wsId = newWorkspaceId();

      const initialLayout =
        targetTab.workspaceId && state.workspaces[targetTab.workspaceId]
          ? state.workspaces[targetTab.workspaceId].layout
          : createGroupLeaf(targetGroupId);

      const newGid = newGroupId();
      const splitNode = createSplitNode(
        direction,
        place === "before"
          ? createGroupLeaf(newGid)
          : createGroupLeaf(targetGroupId),
        place === "before"
          ? createGroupLeaf(targetGroupId)
          : createGroupLeaf(newGid),
      );
      const newLayout = replaceGroupNode(
        initialLayout,
        targetGroupId,
        splitNode,
      );

      const currentTabs = state.tabs.map((t) => {
        if (t.id === tabId) {
          return { ...t, groupId: newGid, workspaceId: wsId };
        }
        if (t.groupId === targetGroupId) {
          return { ...t, workspaceId: wsId };
        }
        return t;
      });

      const newWorkspaces = {
        ...state.workspaces,
        [wsId]: {
          id: wsId,
          name: wsName,
          layout: newLayout,
        },
      };

      const pruned = pruneWorkspaces(
        currentTabs,
        state.groups,
        newWorkspaces,
      );

      return {
        tabs: pruned.tabs,
        groups: pruned.groups,
        workspaces: pruned.workspaces,
        activeTabId: tabId,
        lastActiveGroupId: newGid,
        layout:
          pruned.workspaces[wsId]?.layout ??
          Object.values(pruned.workspaces)[0]?.layout ??
          null,
      };
    }),

  moveTabToGroup: (tabId, targetGroupId) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      const targetTab = state.tabs.find((t) => t.groupId === targetGroupId);
      if (
        !tab ||
        !targetTab ||
        !state.groups[targetGroupId] ||
        tab.groupId === targetGroupId
      )
        return state;
      const wsId = targetTab.workspaceId ?? null;
      const newTabs = state.tabs.map((t) =>
        t.id === tabId
          ? { ...t, groupId: targetGroupId, workspaceId: wsId }
          : t,
      );
      const newGroups = {
        ...state.groups,
        [targetGroupId]: {
          ...state.groups[targetGroupId],
          activeTabId: tabId,
        },
      };
      const pruned = pruneWorkspaces(newTabs, newGroups, state.workspaces);

      let layoutNode: SplitLayoutNode | null =
        wsId && pruned.workspaces[wsId]
          ? pruned.workspaces[wsId].layout
          : null;
      if (!layoutNode && pruned.tabs.length > 0) {
        layoutNode = createGroupLeaf(targetGroupId);
      }

      return {
        tabs: pruned.tabs,
        groups: pruned.groups,
        workspaces: pruned.workspaces,
        activeTabId: tabId,
        lastActiveGroupId: targetGroupId,
        layout: layoutNode,
      };
    }),

  detachTabToTopLevel: (tabId) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab) return state;
      const newGid = newGroupId();
      const newTabs = state.tabs.map((t) =>
        t.id === tabId ? { ...t, groupId: newGid, workspaceId: null } : t,
      );
      const pruned = pruneWorkspaces(
        newTabs,
        state.groups,
        state.workspaces,
      );
      return {
        tabs: pruned.tabs,
        groups: pruned.groups,
        workspaces: pruned.workspaces,
        activeTabId: tabId,
        lastActiveGroupId: newGid,
        // 分离后的 tab 是顶层独立标签且立即成为活跃标签：全局 layout 指向
        // 新分组的单叶子。原 Workspace 的 split 树保留在
        // workspaces[wsId].layout 中，切回该 Workspace 时由 setActiveTab 同步；
        // 若此处沿用 split 树，独立标签顶部会误显一行窗格标题
        layout: createGroupLeaf(newGid),
        maximizedGroupId:
          state.maximizedGroupId === tab.groupId
            ? null
            : state.maximizedGroupId,
      };
    }),

  closeWorkspace: (workspaceId) =>
    set((state) => {
      const wsId =
        workspaceId ||
        (state.tabs.find((t) => t.id === state.activeTabId)?.workspaceId ??
          Object.keys(state.workspaces)[0]);
      if (!wsId) return state;
      if (state.workspaces[wsId]?.locked) return state;

      const closingTabs = state.tabs.filter(
        (t) => t.workspaceId === wsId && !t.locked,
      );

      closingTabs.forEach((t) => {
        sshService.clearTabSessions(t.id);
        if (t.serverId && t.serverId !== "sftp") {
          void sshService.disconnect(`ws:${t.serverId}:${t.id}`).catch(() => {});
        }
      });

      const closingIds = new Set(closingTabs.map((t) => t.id));
      const newTabs = state.tabs.filter((t) => !closingIds.has(t.id));

      for (const t of closingTabs) {
        if (!newTabs.some((nt) => nt.serverId === t.serverId)) {
          clearRemotePathCache(t.serverId);
          clearDynamicCache(t.serverId);
          clearUserAliases(t.serverId);
        }
      }

      const nextConnected = { ...state.connectedServers };
      const nextServerStates = { ...state.serverStates };
      for (const t of closingTabs) {
        if (t.serverId && t.serverId !== "sftp") {
          const wsConnId = `ws:${t.serverId}:${t.id}`;
          delete nextConnected[wsConnId];
          delete nextServerStates[wsConnId];
        }
      }

      const newWorkspaces = { ...state.workspaces };
      delete newWorkspaces[wsId];

      const pruned = pruneWorkspaces(newTabs, state.groups, newWorkspaces);
      const activeStillExists = pruned.tabs.some(
        (t) => t.id === state.activeTabId,
      );
      // 同样排除 SFTP 常驻标签：没有其它服务器时回首页，而不是落到 SFTP 标签
      const fallbackTab = pruned.tabs
        .filter((t) => t.serverId !== "sftp")
        .pop();
      const newActiveId = activeStillExists
        ? state.activeTabId
        : (fallbackTab?.id ?? null);

      playSound(SoundType.Click);
      return {
        tabs: pruned.tabs,
        groups: pruned.groups,
        workspaces: pruned.workspaces,
        activeTabId: newActiveId,
        layout: Object.values(pruned.workspaces)[0]?.layout ?? null,
        maximizedGroupId: null,
        broadcastTabIds: state.broadcastTabIds.filter((id) =>
          pruned.tabs.some((t) => t.id === id),
        ),
        connectedServers: nextConnected,
        serverStates: nextServerStates,
      };
    }),

  renameWorkspace: (workspaceId, name) =>
    set((state) => {
      const ws = state.workspaces[workspaceId];
      if (!ws) return state;
      const trimmed = name.trim();
      return {
        workspaces: {
          ...state.workspaces,
          [workspaceId]: {
            ...ws,
            name: trimmed || ws.name,
          },
        },
      };
    }),

  setWorkspaceColor: (workspaceId, color) =>
    set((state) => {
      const ws = state.workspaces[workspaceId];
      if (!ws) return state;
      const updatedWs = { ...ws };
      if (color) {
        updatedWs.color = color;
      } else {
        delete updatedWs.color;
      }
      return {
        workspaces: {
          ...state.workspaces,
          [workspaceId]: updatedWs,
        },
      };
    }),

  toggleWorkspaceLock: (workspaceId) =>
    set((state) => {
      const ws = state.workspaces[workspaceId];
      if (!ws) return state;
      const nextLocked = !ws.locked;
      return {
        tabs: state.tabs.map((t) =>
          t.workspaceId === workspaceId ? { ...t, locked: nextLocked } : t,
        ),
        workspaces: {
          ...state.workspaces,
          [workspaceId]: {
            ...ws,
            locked: nextLocked,
          },
        },
      };
    }),

  closeOtherWorkspaces: (workspaceId) =>
    set((state) => {
      const currentWs = state.workspaces[workspaceId];
      if (!currentWs) return state;

      const closingTabs = state.tabs.filter((t) => {
        if (t.workspaceId === workspaceId) return false;
        if (t.locked) return false;
        if (t.workspaceId && state.workspaces[t.workspaceId]?.locked) return false;
        return true;
      });

      if (closingTabs.length === 0) return state;

      closingTabs.forEach((t) => {
        sshService.clearTabSessions(t.id);
        if (t.serverId && t.serverId !== "sftp") {
          void sshService.disconnect(`ws:${t.serverId}:${t.id}`).catch(() => {});
        }
      });
      const closingIds = new Set(closingTabs.map((t) => t.id));
      const newTabs = state.tabs.filter((t) => !closingIds.has(t.id));

      for (const t of closingTabs) {
        if (!newTabs.some((nt) => nt.serverId === t.serverId)) {
          clearRemotePathCache(t.serverId);
          clearDynamicCache(t.serverId);
          clearUserAliases(t.serverId);
        }
      }

      const nextConnected = { ...state.connectedServers };
      const nextServerStates = { ...state.serverStates };
      for (const t of closingTabs) {
        if (t.serverId && t.serverId !== "sftp") {
          const wsConnId = `ws:${t.serverId}:${t.id}`;
          delete nextConnected[wsConnId];
          delete nextServerStates[wsConnId];
        }
      }

      const newWorkspaces: Record<string, WorkspaceDef> = {};
      for (const [id, ws] of Object.entries(state.workspaces)) {
        if (id === workspaceId || ws.locked || newTabs.some((t) => t.workspaceId === id)) {
          newWorkspaces[id] = ws;
        }
      }

      const pruned = pruneWorkspaces(newTabs, state.groups, newWorkspaces);
      const activeInCurrentWs = pruned.tabs.find((t) => t.workspaceId === workspaceId);
      const fallbackTab = pruned.tabs.filter((t) => t.serverId !== "sftp").pop();
      const newActiveId = activeInCurrentWs?.id ?? fallbackTab?.id ?? null;

      playSound(SoundType.Click);
      return {
        tabs: pruned.tabs,
        groups: pruned.groups,
        workspaces: pruned.workspaces,
        activeTabId: newActiveId,
        layout: pruned.workspaces[workspaceId]?.layout ?? Object.values(pruned.workspaces)[0]?.layout ?? null,
        maximizedGroupId: null,
        broadcastTabIds: state.broadcastTabIds.filter((id) =>
          pruned.tabs.some((t) => t.id === id),
        ),
        connectedServers: nextConnected,
        serverStates: nextServerStates,
      };
    }),

  focusGroup: (groupId) =>
    set((state) => {
      const group = state.groups[groupId];
      if (!group) return state;
      // 同步更新 state.layout：focusGroup 可能由 TabGroupView 的 onMouseDownCapture 触发，
      // 如果聚焦的分组在不同 workspace 或是顶层独立 tab，不同步 layout 会导致
      // TabGroupView 用旧 layout 误判 isWorkspaceSplit
      const tabId = group.activeTabId ?? state.activeTabId;
      const tab = state.tabs.find((t) => t.id === tabId);
      const wsId = tab?.workspaceId;
      const newLayout = wsId
        ? (state.workspaces[wsId]?.layout ?? null)
        : groupId
          ? createGroupLeaf(groupId)
          : null;
      const nextLayout = newLayout ?? state.layout;
      // 点击已聚焦窗格时三个字段都不会变化，此时必须原样返回 state。
      if (
        state.lastActiveGroupId === groupId &&
        state.activeTabId === tabId &&
        state.layout === nextLayout
      ) {
        return state;
      }
      return {
        lastActiveGroupId: groupId,
        activeTabId: tabId,
        layout: nextLayout,
      };
    }),

  resizeSplit: (splitId, ratio) =>
    set((state) => {
      if (!state.layout) return state;
      const clamped = clampRatio(ratio);
      const newLayout = updateSplitRatio(state.layout, splitId, clamped);
      // 同步更新 workspaces[wsId].layout，否则 SplitLayoutView 渲染 ws.layout 看不到变化
      const wsId = state.tabs.find(
        (t) => t.id === state.activeTabId,
      )?.workspaceId;
      if (wsId && state.workspaces[wsId]) {
        return {
          layout: newLayout,
          workspaces: {
            ...state.workspaces,
            [wsId]: { ...state.workspaces[wsId], layout: newLayout },
          },
        };
      }
      return { layout: newLayout };
    }),

  setSplitDropTarget: (target) =>
    set((state) => {
      const cur = state.splitDropTarget;
      if (cur?.groupId === target?.groupId && cur?.zone === target?.zone)
        return state;
      return { splitDropTarget: target };
    }),
});
