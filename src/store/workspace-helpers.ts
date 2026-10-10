import type {
  Server,
  WorkspaceTab,
  TabGroup,
  WorkspaceDef,
  SplitLayoutNode,
} from "@/types";
import {
  collectGroupIds,
  removeGroupNode,
} from "@/utils/split-layout";
import { SESSION_WORKSPACE_KEY } from "./constants";
import type { WorkspaceSessionData } from "./types";

export function loadWorkspaceSession(): WorkspaceSessionData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_WORKSPACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceSessionData;
    if (parsed && Array.isArray(parsed.tabs)) {
      return parsed;
    }
  } catch {
    // 忽略异常
  }
  return null;
}

export function saveWorkspaceSession(data: WorkspaceSessionData) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_WORKSPACE_KEY, JSON.stringify(data));
  } catch {
    // 忽略异常
  }
}

export function getSerialPortName(server: Server | undefined): string | null {
  if (!server) return null;
  let configured = "";
  if (server.serialConfig) {
    try {
      configured = String(JSON.parse(server.serialConfig)?.portName || "");
    } catch {
      // 兼容旧数据：host 仍是串口名称的可靠回退字段。
    }
  }
  const value = (configured || server.host || "").trim();
  return value ? value.toLocaleLowerCase() : null;
}

// ── 分屏布局辅助函数 ──────────────────────────────────────────────────────

export function newGroupId(): string {
  return `group-${crypto.randomUUID()}`;
}

export function newWorkspaceId(): string {
  return `ws-${crypto.randomUUID()}`;
}

/**
 * 决定新打开的 / 合并进来的 tab 应进入的分组。
 * 优先级：全局活跃 tab 所在组 > 最近活跃组 > 布局中第一个组；无可用组时返回 null（需新建）。
 */
export function resolveTargetGroupId(state: {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  groups: Record<string, TabGroup>;
  lastActiveGroupId: string | null;
}): string | null {
  const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
  if (activeTab?.groupId && state.groups[activeTab.groupId])
    return activeTab.groupId;
  if (state.lastActiveGroupId && state.groups[state.lastActiveGroupId])
    return state.lastActiveGroupId;
  return Object.keys(state.groups)[0] ?? null;
}

/**
 * 遍历所有 Workspace 与标签页，清理没有任何 tab 的空分组与过度坍缩的分屏（<=1 窗格时解散为独立标签页）。
 */
export function pruneWorkspaces(
  tabs: WorkspaceTab[],
  groups: Record<string, TabGroup>,
  workspaces: Record<string, WorkspaceDef>,
): {
  tabs: WorkspaceTab[];
  groups: Record<string, TabGroup>;
  workspaces: Record<string, WorkspaceDef>;
} {
  let currentTabs = [...tabs];
  const newWorkspaces: Record<string, WorkspaceDef> = {};

  for (const [wsId, ws] of Object.entries(workspaces)) {
    let wsLayout: SplitLayoutNode | null = ws.layout;
    let changed = true;
    while (changed && wsLayout) {
      changed = false;
      for (const gid of collectGroupIds(wsLayout)) {
        const hasTabInWs = currentTabs.some(
          (t) => t.groupId === gid && t.workspaceId === wsId,
        );
        if (!hasTabInWs) {
          wsLayout = removeGroupNode(wsLayout, gid);
          changed = true;
          break;
        }
      }
    }

    const remainingGids = collectGroupIds(wsLayout);
    if (remainingGids.length > 1 && wsLayout) {
      newWorkspaces[wsId] = { ...ws, layout: wsLayout };
    } else {
      currentTabs = currentTabs.map((t) =>
        t.workspaceId === wsId ? { ...t, workspaceId: null } : t,
      );
    }
  }

  const usedGroupIds = new Set(
    currentTabs.map((t) => t.groupId).filter((gid): gid is string => !!gid),
  );
  const newGroups: Record<string, TabGroup> = {};
  for (const gid of usedGroupIds) {
    const g = groups[gid];
    const groupTabs = currentTabs.filter((t) => t.groupId === gid);
    const activeValid =
      g?.activeTabId && groupTabs.some((t) => t.id === g.activeTabId);
    newGroups[gid] = {
      id: gid,
      activeTabId: activeValid ? g.activeTabId : (groupTabs[0]?.id ?? null),
    };
  }

  return { tabs: currentTabs, groups: newGroups, workspaces: newWorkspaces };
}
