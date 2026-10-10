import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "@/store";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  X,
  Copy,
  Lock,
  Unlock,
  Pencil,
  Palette,
  Plus,
  ChevronLeft,
  ChevronRight,
  ArrowLeftRight,
  Radio,
  Search,
} from "lucide-react";
import type { WorkspaceTab, WorkspaceDef } from "@/types";
import { useTranslation } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { backend, isTauri } from "@/services/api";
import {
  computeDropZone,
  zoneToSplit,
  collectGroupIds,
} from "@/utils/split-layout";
import { clampMenuToViewport } from "@/lib/menu-position";
import {
  buildGroupTree,
  buildGroupPathMap,
  collectSubtreeIds,
  type GroupTreeNode,
} from "@/lib/server-groups";
import { OsIcon } from "@/pages/dashboard";
import { GroupFilterChip, UNGROUPED_FILTER } from "@/components/ui/group-tree-picker";
import { Button } from "@/components/ui/button";

// 预设颜色选项
const TAB_COLORS = [
  { nameKey: "color_default", value: undefined },
  { nameKey: "color_red", value: "#ef4444" },
  { nameKey: "color_orange", value: "#f97316" },
  { nameKey: "color_yellow", value: "#eab308" },
  { nameKey: "color_green", value: "#22c55e" },
  { nameKey: "color_cyan", value: "#06b6d4" },
  { nameKey: "color_blue", value: "#3b82f6" },
  { nameKey: "color_purple", value: "#a855f7" },
  { nameKey: "color_pink", value: "#ec4899" },
];

// ── 拖拽常量 ──────────────────────────────────────────────────────────────
// 鼠标移动超过此距离才视为拖拽（避免点击时微小抖动误触发）
const DRAG_THRESHOLD = 5;
// 拖拽时标签之间平滑过渡的动画时长 (ms)
const SLIDE_TRANSITION_MS = 200;

/** 缓存的 tab 原始布局信息 */
interface CachedTabLayout {
  id: string;
  left: number; // 相对 container 的左边缘
  width: number;
  centerX: number; // 相对 container 的中心 X
}

interface TabStripProps {
  /** 全部标签（已按顺序排列，可能分属不同分屏分组） */
  tabs: WorkspaceTab[];
  className?: string;
}

/**
 * 统一标签条：渲染全部标签（无论是否分屏），始终由顶层 TabBar 渲染。
 * 承载标签的拖拽排序、拖拽分屏落点检测、拖出新窗口、右键菜单等全部交互。
 * 分屏时各窗格不再渲染独立标签条；窗格中正在显示的标签在本条内高亮。
 */
export function TabStrip({ tabs, className }: TabStripProps) {
  const { t } = useTranslation();
  const activeTabId = useAppStore((s) => s.activeTabId);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs);
  const reorderTabs = useAppStore((s) => s.reorderTabs);
  const duplicateTab = useAppStore((s) => s.duplicateTab);
  const renameTab = useAppStore((s) => s.renameTab);
  const toggleTabLock = useAppStore((s) => s.toggleTabLock);
  const setTabColor = useAppStore((s) => s.setTabColor);
  const connectedServers = useAppStore((s) => s.connectedServers);
  const serverStates = useAppStore((s) => s.serverStates);
  const groups = useAppStore((s) => s.groups);
  const layout = useAppStore((s) => s.layout);
  const workspaces = useAppStore((s) => s.workspaces);
  const splitTab = useAppStore((s) => s.splitTab);
  const moveTabToGroup = useAppStore((s) => s.moveTabToGroup);
  const setSplitDropTarget = useAppStore((s) => s.setSplitDropTarget);
  const detachTabToTopLevel = useAppStore((s) => s.detachTabToTopLevel);
  const closeWorkspace = useAppStore((s) => s.closeWorkspace);
  const renameWorkspace = useAppStore((s) => s.renameWorkspace);
  const setWorkspaceColor = useAppStore((s) => s.setWorkspaceColor);
  const toggleWorkspaceLock = useAppStore((s) => s.toggleWorkspaceLock);
  const closeOtherWorkspaces = useAppStore((s) => s.closeOtherWorkspaces);
  const openTab = useAppStore((s) => s.openTab);
  const dragging = useAppStore((s) => s.dragging);
  const dragTabId = useAppStore((s) => s.dragTabId);
  const setDragState = useAppStore((s) => s.setDragState);
  const allTabsCount = useAppStore((s) => s.tabs.length);
  const broadcastTabIds = useAppStore((s) => s.broadcastTabIds);
  const { toast } = useToast();
  const servers = useAppStore((s) => s.servers);
  const serverGroups = useAppStore((s) => s.serverGroups);

  // 所有 workspace 分组 id 集合：判断拖拽来源是否为 workspace 窗格
  const workspaceGids = useMemo(
    () => new Set(collectGroupIds(layout)),
    [layout],
  );

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renamingWsId, setRenamingWsId] = useState<string | null>(null);
  const [renameWsValue, setRenameWsValue] = useState("");
  const [showCloseOthersConfirm, setShowCloseOthersConfirm] = useState<
    string | null
  >(null);
  const [showCloseWsOthersConfirm, setShowCloseWsOthersConfirm] = useState<
    string | null
  >(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState<string | null>(null);
  const [showServerPicker, setShowServerPicker] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [serverQuery, setServerQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tabScrollState, setTabScrollState] = useState({
    overflow: false,
    left: false,
    right: false,
  });

  // ── 拖拽相关 ─────────────────────────────────────────────────────────
  const [dragStartRect, setDragStartRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  // 标签条容器
  const tabBarRef = useRef<HTMLDivElement>(null);
  // 各 tab DOM 元素
  const tabElemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // 初始鼠标位置
  const mouseStartRef = useRef({ x: 0, y: 0 });
  // 鼠标按下时被拖拽 tab 的 DOM rect
  const dragTabRectRef = useRef<DOMRect | null>(null);
  // 是否越过了拖拽阈值
  const dragActiveRef = useRef(false);
  // 防止 mouseup 后的 click 事件激活 tab
  const wasDraggedRef = useRef(false);

  // tab 的 store 排序缓存
  const tabOrderRef = useRef<string[]>([]);
  // 拖拽开始时快照的布局信息（不受 CSS transform 影响）
  const cachedLayoutsRef = useRef<CachedTabLayout[]>([]);
  const cachedDragWidthRef = useRef(0);

  // 顶部标签条项目 ID 序列（包含 ws- 前缀的 Workspace 项及独立 tab 项）
  const topItemIds = useMemo(() => {
    const ids: string[] = [];
    const renderedWs = new Set<string>();
    tabs.forEach((t) => {
      if (t.workspaceId && workspaces[t.workspaceId]) {
        if (!renderedWs.has(t.workspaceId)) {
          renderedWs.add(t.workspaceId);
          ids.push(`ws-${t.workspaceId}`);
        }
      } else {
        ids.push(t.id);
      }
    });
    return ids;
  }, [tabs, workspaces]);

  // 相同服务器同模块打开多个会话时，自动递增序号：第一个为 "服务器名"，后续为 "服务器名 (1)", "服务器名 (2)"
  const duplicateIndexMap = useMemo(() => {
    const counts = new Map<string, number>();
    const indexMap = new Map<string, number>();
    for (const tab of tabs) {
      if (tab.tempTitle) continue;
      const key = `${tab.serverId}-${tab.module}`;
      const c = counts.get(key) || 0;
      indexMap.set(tab.id, c);
      counts.set(key, c + 1);
    }
    const res = new Map<string, number>();
    for (const tab of tabs) {
      if (tab.tempTitle) continue;
      const key = `${tab.serverId}-${tab.module}`;
      if ((counts.get(key) || 0) > 1) {
        res.set(tab.id, indexMap.get(tab.id) || 0);
      }
    }
    return res;
  }, [tabs]);

  const getCleanTabTitle = useCallback((tab: WorkspaceTab) => {
    if (tab.tempTitle) return tab.tempTitle;
    let base = tab.serverName || tab.title || "";
    // 剥离历史持久化数据或现有标题可能携带的 " - 模块名" / " - Terminal" 等后缀
    base = base.replace(
      /\s*-\s*(terminal|files|overview|services|processes|network|ports|docker|rdp|bmc|forward|终端|文件|监控|服务|进程|网络|端口|远程桌面|带外管理|端口转发)$/i,
      ""
    ).trim();
    const dupIdx = duplicateIndexMap.get(tab.id);
    return dupIdx && dupIdx > 0 ? `${base} (${dupIdx})` : base;
  }, [duplicateIndexMap]);

  useEffect(() => {
    tabOrderRef.current = topItemIds;
  }, [topItemIds]);

  useEffect(() => {
    const container = tabBarRef.current;
    if (!container || !activeTabId) return;
    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    const itemId = activeTab?.workspaceId
      ? `ws-${activeTab.workspaceId}`
      : activeTabId;
    const element = tabElemRefs.current.get(itemId);
    if (!element) return;
    const left = element.offsetLeft;
    const right = left + element.offsetWidth;
    const viewportLeft = container.scrollLeft;
    const viewportRight = viewportLeft + container.clientWidth;
    const margin = 10;
    if (left < viewportLeft + margin) {
      container.scrollTo({
        left: Math.max(0, left - margin),
        behavior: "smooth",
      });
    } else if (right > viewportRight - margin) {
      container.scrollTo({
        left: right - container.clientWidth + margin,
        behavior: "smooth",
      });
    }
  }, [activeTabId, tabs, workspaces]);

  // 监听来自 Workspace 分屏窗格 Header 的拖拽事件
  useEffect(() => {
    const handlePaneDragStart = (e: Event) => {
      const customEv = e as CustomEvent<{
        tabId: string;
        clientX: number;
        clientY: number;
        rect: DOMRect;
      }>;
      if (!customEv.detail) return;
      const { tabId, clientX, clientY, rect } = customEv.detail;

      // 规格化为与顶部普通标签完全一致的标准 Tab 尺寸 (宽 160px，高 28px)
      const tabElem = tabElemRefs.current.get(tabId);
      const standardWidth = tabElem
        ? Math.min(tabElem.getBoundingClientRect().width, 200)
        : 160;
      const standardHeight = rect.height > 0 ? Math.min(rect.height, 32) : 28;

      // 锚定鼠标抓取点在虚拟 Tab 的横向约 1/3 处（偏左贴近图标与标题），纵向居中
      const left = clientX - Math.min(standardWidth / 3, 50);
      const top = clientY - standardHeight / 2;

      const normalizedRect =
        typeof DOMRect !== "undefined"
          ? new DOMRect(left, top, standardWidth, standardHeight)
          : ({
              x: left,
              y: top,
              left,
              top,
              width: standardWidth,
              height: standardHeight,
              right: left + standardWidth,
              bottom: top + standardHeight,
              toJSON: () => ({}),
            } as DOMRect);

      dragTabRectRef.current = normalizedRect;
      mouseStartRef.current = { x: clientX, y: clientY };
      dragActiveRef.current = false;
      wasDraggedRef.current = false;
      setDragState(false, tabId);
    };
    window.addEventListener("pane-drag-start", handlePaneDragStart);
    return () => {
      window.removeEventListener("pane-drag-start", handlePaneDragStart);
    };
  }, [setDragState]);

  // ── 右键菜单关闭逻辑 ─────────────────────────────────────────────────
  useEffect(() => {
    if (!ctxMenu) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-ctx-menu]")) return;
      setCtxMenu(null);
    };
    const timer = setTimeout(() => {
      window.addEventListener("click", close);
      window.addEventListener("contextmenu", close);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [ctxMenu]);

  // ── 核心拖拽逻辑 ─────────────────────────────────────────────────────

  /**
   * 拖拽激活瞬间：快照所有 tab 的原始布局。
   * 之后整个拖拽过程都使用缓存值，不再读 getBoundingClientRect。
   */
  const cacheTabLayouts = useCallback((dragId: string) => {
    const container = tabBarRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft;

    const layouts: CachedTabLayout[] = [];
    for (const id of tabOrderRef.current) {
      const el = tabElemRefs.current.get(id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      layouts.push({
        id,
        left: rect.left - containerRect.left + scrollLeft,
        width: rect.width,
        centerX: rect.left - containerRect.left + scrollLeft + rect.width / 2,
      });
    }
    cachedLayoutsRef.current = layouts;
    cachedDragWidthRef.current =
      layouts.find((l) => l.id === dragId)?.width ?? 0;
  }, []);

  /**
   * 根据鼠标在容器内的 X 坐标，计算被拖拽 tab 应插入的"非拖拽"索引。
   * 比较各 tab 的*原始*中心点 — 与 Chrome/FinalShell 行为一致。
   */
  const getDropIndex = useCallback(
    (mouseXInScrollContent: number, dragId: string): number => {
      const others = cachedLayoutsRef.current.filter((l) => l.id !== dragId);
      if (others.length === 0) return 0;
      for (let i = 0; i < others.length; i++) {
        if (mouseXInScrollContent < others[i].centerX) return i;
      }
      return others.length;
    },
    [],
  );

  /**
   * 对非拖拽的 tab 施加 CSS translateX，让它们"滑动让位"。
   */
  const applySlideTransforms = useCallback(
    (dragId: string, dropIndex: number) => {
      const order = tabOrderRef.current;
      const dragIdx = order.indexOf(dragId);
      if (dragIdx === -1) return;
      const dragWidth = cachedDragWidthRef.current;

      let nonDragIdx = 0;
      for (let i = 0; i < order.length; i++) {
        const id = order[i];
        if (id === dragId) continue;
        const el = tabElemRefs.current.get(id);
        if (el) {
          let shift = 0;
          if (i < dragIdx && dropIndex <= nonDragIdx) {
            shift = dragWidth; // 右移
          } else if (i > dragIdx && dropIndex > nonDragIdx) {
            shift = -dragWidth; // 左移
          }
          el.style.transition = `transform ${SLIDE_TRANSITION_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
          el.style.transform = shift !== 0 ? `translateX(${shift}px)` : "";
        }
        nonDragIdx++;
      }
    },
    [],
  );

  /** 清理所有拖拽状态 & DOM 样式 */
  const cleanupDrag = useCallback(() => {
    tabElemRefs.current.forEach((el) => {
      el.style.transition = "";
      el.style.transform = "";
      el.style.zIndex = "";
      el.style.pointerEvents = "";
    });
    dragActiveRef.current = false;
    dragTabRectRef.current = null;
    setDragState(false, null);
    setDragStartRect(null);
    setSplitDropTarget(null);
  }, [setSplitDropTarget, setDragState]);

  /** 将当前 dropIndex 提交到 store */
  const commitReorder = useCallback(
    (dragId: string, dropIndex: number) => {
      const order = tabOrderRef.current;
      if (order.indexOf(dragId) === -1) return;
      const otherIds = order.filter((id) => id !== dragId);
      if (otherIds.length === 0) return;
      const targetItemId =
        dropIndex >= otherIds.length
          ? otherIds[otherIds.length - 1]
          : otherIds[dropIndex];
      const position = dropIndex >= otherIds.length ? "after" : "before";

      const fromTabId = dragId.startsWith("ws-")
        ? tabs.find((t) => t.workspaceId === dragId.replace("ws-", ""))?.id
        : dragId;

      const toTabId = targetItemId.startsWith("ws-")
        ? tabs.find((t) => t.workspaceId === targetItemId.replace("ws-", ""))
            ?.id
        : targetItemId;

      if (fromTabId && toTabId) {
        reorderTabs(fromTabId, toTabId, position);
      }
    },
    [tabs, reorderTabs],
  );

  // ── 全局鼠标事件（mouseDown 后挂载） ──────────────────────────────────
  useEffect(() => {
    if (!dragTabId) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - mouseStartRef.current.x;
      const dy = e.clientY - mouseStartRef.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 还没越过阈值
      if (!dragActiveRef.current && dist < DRAG_THRESHOLD) return;

      // 首次激活
      if (!dragActiveRef.current) {
        if (isTauri && allTabsCount === 1) {
          backend?.window.startDragging().catch(console.error);
          cleanupDrag();
          return;
        }

        dragActiveRef.current = true;
        wasDraggedRef.current = true;
        cacheTabLayouts(dragTabId);
        if (dragTabRectRef.current) {
          const { left, top, width, height } = dragTabRectRef.current;
          setDragStartRect({ left, top, width, height });
        }
        setDragState(true, dragTabId);

        // 拖拽独立顶层 Tab 时，主区域自动显示相邻窗口的内容 session
        if (dragTabId === activeTabId && !dragTabId.startsWith("ws-")) {
          const dragTabObj = tabs.find((t) => t.id === dragTabId);
          // 只有拖拽独立顶层服务器标签时才切换背景展现相邻独立标签
          if (dragTabObj && !dragTabObj.workspaceId) {
            const adjacentTab = tabs.find(
              (t) => t.id !== dragTabId && !t.workspaceId,
            );
            if (adjacentTab) {
              setActiveTab(adjacentTab.id);
            }
          }
        }
      }

      const container = tabBarRef.current;
      if (!container || !dragTabRectRef.current) return;
      const containerRect = container.getBoundingClientRect();

      // 鼠标是否仍在"本标签条"范围内（组内排序模式）
      const inStrip =
        e.clientX >= containerRect.left &&
        e.clientX <= containerRect.right &&
        e.clientY >= containerRect.top - 4 &&
        e.clientY <= containerRect.bottom + 4;

      // ── 更新 Portal 预览的位置（直接操作 DOM） ──
      const portalEl = document.getElementById("drag-preview-portal");
      if (portalEl) {
        const origLeft = dragTabRectRef.current.left;
        const origTop = dragTabRectRef.current.top;
        portalEl.style.left = `${origLeft + dx}px`;
        portalEl.style.top = `${origTop + dy}px`;
      }

      if (inStrip) {
        // ── 组内排序模式：清除分屏落点，让其他 tab 按插入位置让位 ──
        setSplitDropTarget(null);

        // 自动滚动
        const mouseX = e.clientX;
        const scrollThreshold = 80;
        const maxScrollSpeed = 12;
        if (mouseX < containerRect.left + scrollThreshold) {
          const ratio =
            (containerRect.left + scrollThreshold - mouseX) / scrollThreshold;
          const speed = Math.min(
            maxScrollSpeed,
            Math.round(ratio * maxScrollSpeed),
          );
          container.scrollLeft -= speed;
        } else if (mouseX > containerRect.right - scrollThreshold) {
          const ratio =
            (mouseX - (containerRect.right - scrollThreshold)) /
            scrollThreshold;
          const speed = Math.min(
            maxScrollSpeed,
            Math.round(ratio * maxScrollSpeed),
          );
          container.scrollLeft += speed;
        }

        const mouseXInScrollContent =
          e.clientX - containerRect.left + container.scrollLeft;
        const dropIdx = getDropIndex(mouseXInScrollContent, dragTabId);
        applySlideTransforms(dragTabId, dropIdx);
        return;
      }

      // ── 离开本标签条：复位让位动画，进入分屏落点检测模式 ──
      applySlideTransforms(dragTabId, tabOrderRef.current.indexOf(dragTabId));

      // Workspace 标签只在顶栏左右拖拽重排，绝对不触发分屏落点
      if (dragTabId.startsWith("ws-")) {
        setSplitDropTarget(null);
        return;
      }

      const pointEl = document.elementFromPoint(e.clientX, e.clientY);

      // 1. 检测是否落在主内容区当前可视的分屏窗格上 ([data-split-group-id])
      const hitEl = pointEl?.closest<HTMLElement>("[data-split-group-id]");
      if (hitEl?.dataset.splitGroupId) {
        const targetGid = hitEl.dataset.splitGroupId;
        const targetTab = tabs.find((t) => t.groupId === targetGid);
        const activeTabObj = tabs.find((t) => t.id === activeTabId);
        const dragTabObj = tabs.find((t) => t.id === dragTabId);

        // 校验 Termius 规则：
        // 允许合并到同 Workspace 窗格，或当前活跃可视 Workspace 窗格，或任意独立服务器窗口
        const isTargetInActiveWs =
          targetTab?.workspaceId &&
          (targetTab.workspaceId === dragTabObj?.workspaceId ||
            targetTab.workspaceId === activeTabObj?.workspaceId);
        const isTargetStandalone = !targetTab?.workspaceId;

        if (isTargetInActiveWs || isTargetStandalone) {
          const rect = hitEl.getBoundingClientRect();
          setSplitDropTarget({
            groupId: targetGid,
            zone: computeDropZone(e.clientX, e.clientY, rect, false),
          });
          return;
        }
      }

      // 2. 检测是否落在顶部标签栏的【独立服务器标签页】上 ([data-tab-id])
      const onTopTab = pointEl?.closest<HTMLElement>("[data-tab-id]");
      if (onTopTab?.dataset.tabId) {
        const targetTabId = onTopTab.dataset.tabId;
        const targetTab = tabs.find((t) => t.id === targetTabId);

        // 校验 Termius 规则：
        // 当前窗口是服务器窗口时，拖拽可合并到另一个独立服务器标签页组成新 Workspace；
        // 绝不给 Workspace 标签页设置落点（禁止将服务器合并进非活跃 Workspace）
        if (
          targetTab &&
          !targetTab.workspaceId &&
          targetTab.id !== dragTabId &&
          targetTab.groupId
        ) {
          setSplitDropTarget({
            groupId: targetTab.groupId,
            zone: "right",
          });
          return;
        }
      }

      setSplitDropTarget(null);
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragActiveRef.current) {
        cleanupDrag();
        return;
      }
      wasDraggedRef.current = true;

      // 优先提交分屏落点（所有拖拽到窗格上的行为均为分屏重新排布，严禁合并/覆盖）
      const drop = useAppStore.getState().splitDropTarget;
      if (drop) {
        // BMC 带外管理标签禁止分屏（只有一个模块，分屏后无法渲染终端）
        const dragServer = servers.find(
          (s) => s.id === tabs.find((t) => t.id === dragTabId)?.serverId,
        );
        if (dragServer?.targetType === "bmc") {
          setSplitDropTarget(null);
          cleanupDrag();
          return;
        }
        const zone = drop.zone === "center" ? "right" : drop.zone;
        const { direction, place } = zoneToSplit(zone);
        splitTab(dragTabId, drop.groupId, direction, place);
        cleanupDrag();
        window.dispatchEvent(
          new CustomEvent("tab-split-complete", {
            detail: { tabId: dragTabId },
          }),
        );
        window.dispatchEvent(new Event("resize"));
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event("resize"));
        });
        return;
      }

      // 提交组内重排或脱离 Workspace 回到顶部独立标签
      const container = tabBarRef.current;
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const inStrip =
          e.clientX >= containerRect.left &&
          e.clientX <= containerRect.right &&
          e.clientY >= containerRect.top - 4 &&
          e.clientY <= containerRect.bottom + 4;
        if (inStrip) {
          if (dragTabId.startsWith("ws-")) {
            // Workspace 整体标签放手：仅重排顺序，绝对不可拆解 Workspace
            const mouseXInScrollContent =
              e.clientX - containerRect.left + container.scrollLeft;
            const dropIdx = getDropIndex(mouseXInScrollContent, dragTabId);
            commitReorder(dragTabId, dropIdx);
          } else {
            const dragTab = tabs.find((t) => t.id === dragTabId);
            const isFromWorkspacePane =
              dragTab?.groupId && workspaceGids.has(dragTab.groupId);
            if (isFromWorkspacePane) {
              // 将 Workspace 窗格中的服务器 Header 拖回顶部标签栏，再次还原
              detachTabToTopLevel(dragTabId);
            } else {
              const mouseXInScrollContent =
                e.clientX - containerRect.left + container.scrollLeft;
              const dropIdx = getDropIndex(mouseXInScrollContent, dragTabId);
              commitReorder(dragTabId, dropIdx);
            }
          }
        }
      }
      cleanupDrag();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cleanupDrag();
      }
    };

    // 兜底：鼠标拖出窗口外释放（Tauri 原生窗口边界外不会收到 mouseup）或窗口失焦时清理拖拽状态
    // 避免拖拽状态永久卡死导致 portal 预览残留、tab transform 样式不回滚
    const handleBlur = () => {
      if (dragActiveRef.current) {
        cleanupDrag();
      }
    };
    const handleVisibilityChange = () => {
      if (document.hidden && dragActiveRef.current) {
        cleanupDrag();
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dragTabId,
    tabs,
    allTabsCount,
    closeTab,
    cleanupDrag,
    getDropIndex,
    applySlideTransforms,
    commitReorder,
    cacheTabLayouts,
    moveTabToGroup,
    splitTab,
    setSplitDropTarget,
  ]);

  // ── 事件处理 ──────────────────────────────────────────────────────────

  const handleMouseDown = (e: React.MouseEvent, tab: WorkspaceTab) => {
    if (e.button !== 0) return;
    if (renamingTabId === tab.id) return;
    if ((e.target as HTMLElement).closest("button")) return;

    const el = tabElemRefs.current.get(tab.id);
    if (el) {
      dragTabRectRef.current = el.getBoundingClientRect();
    }

    mouseStartRef.current = { x: e.clientX, y: e.clientY };
    dragActiveRef.current = false;
    wasDraggedRef.current = false;
    setDragState(false, tab.id);
  };

  const handleContextMenu = (e: React.MouseEvent, tab: WorkspaceTab) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, tab });
  };

  const startRename = (tab: WorkspaceTab) => {
    setRenamingTabId(tab.id);
    const currentDisplayTitle = getCleanTabTitle(tab);
    setRenameValue(currentDisplayTitle);
    setCtxMenu(null);
  };

  const confirmRename = () => {
    if (renamingTabId) {
      const trimmed = renameValue.trim();
      const currentTab = tabs.find((t) => t.id === renamingTabId);
      const defaultTitle = currentTab
        ? (currentTab.serverName || currentTab.title || "")
            .replace(
              /\s*-\s*(terminal|files|overview|services|processes|network|ports|docker|rdp|bmc|forward|终端|文件|监控|服务|进程|网络|端口|远程桌面|带外管理|端口转发)$/i,
              "",
            )
            .trim()
        : "";
      // 若与默认标题一致或为空，清空 tempTitle 回退为动态显示
      const nextTitle = !trimmed || trimmed === defaultTitle ? "" : trimmed;
      renameTab(renamingTabId, nextTitle);
    }
    setRenamingTabId(null);
    setRenameValue("");
  };

  const cancelRename = () => {
    setRenamingTabId(null);
    setRenameValue("");
  };

  const startRenameWorkspace = (ws: WorkspaceDef) => {
    setRenamingWsId(ws.id);
    setRenameWsValue(ws.name);
    setCtxMenu(null);
  };

  const confirmRenameWorkspace = () => {
    if (renamingWsId) {
      renameWorkspace(renamingWsId, renameWsValue);
    }
    setRenamingWsId(null);
    setRenameWsValue("");
  };

  const cancelRenameWorkspace = () => {
    setRenamingWsId(null);
    setRenameWsValue("");
  };

  const setTabRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) tabElemRefs.current.set(id, el);
    else tabElemRefs.current.delete(id);
  }, []);

  const openSelectedServer = useCallback(
    (serverId: string) => {
      const server = servers.find((item) => item.id === serverId);
      if (!server) return;
      if (server.targetType === "windows") {
        const hasSsh = Boolean(server.port && server.port > 0);
        const hasRdp = Boolean(server.rdpPort && server.rdpPort > 0);
        if (hasSsh) {
          openTab(server.id, server.name, "terminal");
        } else if (hasRdp) {
          void backend?.rdp.launch({
            serverId: server.id,
            rdpPort: server.rdpPort,
          });
        } else {
          toast.warning(t("server_no_port") || "未配置连接端口");
        }
      } else {
        openTab(
          server.id,
          server.name,
          server.targetType === "bmc" ? "bmc" : "terminal",
        );
      }
      setSelectedServerId(null);
      setServerQuery("");
      setGroupFilter(null);
      setTagFilter(null);
      setShowServerPicker(false);
    },
    [servers, openTab, toast, t],
  );

  // 所有标签提取
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    servers.forEach((s) => {
      if (Array.isArray(s.tags)) {
        s.tags.forEach((tag) => tagSet.add(tag));
      }
    });
    return Array.from(tagSet).sort();
  }, [servers]);

  // 分组计数（含子树继承与标签过滤联动）
  const groupFilterCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let ungrouped = 0;
    for (const s of servers) {
      if (tagFilter && !(Array.isArray(s.tags) && s.tags.includes(tagFilter))) {
        continue;
      }
      if (s.groupId) {
        counts.set(s.groupId, (counts.get(s.groupId) || 0) + 1);
      } else {
        ungrouped++;
      }
    }
    const tree = buildGroupTree(serverGroups);
    const rollup = (nodes: GroupTreeNode[]): number => {
      let sum = 0;
      for (const n of nodes) {
        const own = counts.get(n.group.id) || 0;
        const sub = rollup(n.children);
        const total = own + sub;
        counts.set(n.group.id, total);
        sum += total;
      }
      return sum;
    };
    rollup(tree);
    return { counts, ungrouped };
  }, [serverGroups, servers, tagFilter]);

  // 分组路径映射（用于列表展示所属分组路径）
  const groupPathMap = useMemo(
    () => buildGroupPathMap(serverGroups),
    [serverGroups],
  );

  // 最终筛选的服务器列表
  const filteredServers = useMemo(() => {
    const query = serverQuery.trim().toLocaleLowerCase();
    return servers.filter((s) => {
      // 1. 文本搜索（名称 / IP / 用户名 / 标签）
      if (query) {
        const matchText = `${s.name} ${s.host} ${s.username} ${(s.tags || []).join(" ")}`.toLocaleLowerCase();
        if (!matchText.includes(query)) return false;
      }
      // 2. 标签过滤
      if (tagFilter) {
        if (!Array.isArray(s.tags) || !s.tags.includes(tagFilter)) return false;
      }
      // 3. 分组过滤
      if (groupFilter === UNGROUPED_FILTER) {
        return !s.groupId || !serverGroups.some((g) => g.id === s.groupId);
      }
      if (groupFilter) {
        const validGroupIds = collectSubtreeIds(serverGroups, groupFilter);
        return Boolean(s.groupId && validGroupIds.has(s.groupId));
      }
      return true;
    });
  }, [servers, serverQuery, groupFilter, tagFilter, serverGroups]);

  const handleTabBarWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      const canScroll = element.scrollWidth > element.clientWidth;
      if (!canScroll) return;
      // 标签栏采用横向布局；将普通鼠标滚轮的垂直增量映射为横向滚动，
      // 同时保留触控板/Shift+滚轮提供的 deltaX。
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      if (delta === 0) return;
      event.preventDefault();
      element.scrollLeft += delta;
    },
    [],
  );

  const updateTabScrollState = useCallback(() => {
    const element = tabBarRef.current;
    if (!element) return;
    const overflow = element.scrollWidth > element.clientWidth + 1;
    const next = {
      overflow,
      left: overflow && element.scrollLeft > 2,
      right:
        overflow &&
        element.scrollLeft + element.clientWidth < element.scrollWidth - 2,
    };
    setTabScrollState((current) =>
      current.overflow === next.overflow &&
      current.left === next.left &&
      current.right === next.right
        ? current
        : next,
    );
  }, []);

  useEffect(() => {
    const element = tabBarRef.current;
    if (!element) return;
    updateTabScrollState();
    const resizeObserver = new ResizeObserver(updateTabScrollState);
    const mutationObserver = new MutationObserver(updateTabScrollState);
    resizeObserver.observe(element);
    mutationObserver.observe(element, { childList: true, subtree: true });
    element.addEventListener("scroll", updateTabScrollState, {
      passive: true,
    });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      element.removeEventListener("scroll", updateTabScrollState);
    };
  }, [updateTabScrollState]);

  useEffect(() => {
    requestAnimationFrame(updateTabScrollState);
  }, [topItemIds, updateTabScrollState]);

  useEffect(() => {
    if (!showServerPicker) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowServerPicker(false);
        setSelectedServerId(null);
        setServerQuery("");
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showServerPicker]);

  // ── 渲染 ──────────────────────────────────────────────────────────────

  return (
    <div
      className={cn("relative flex items-center h-full select-none", className)}
    >
      {/* 标签页容器 */}
      <div
        ref={tabBarRef}
        className="tab-strip-scroll flex items-center h-full overflow-x-auto flex-1"
        onWheel={handleTabBarWheel}
      >
        {(() => {
          const renderedItems: React.ReactNode[] = [];
          const renderedWorkspaceIds = new Set<string>();

          tabs.forEach((tab) => {
            if (tab.workspaceId && workspaces[tab.workspaceId]) {
              const wsId = tab.workspaceId;
              if (!renderedWorkspaceIds.has(wsId)) {
                renderedWorkspaceIds.add(wsId);
                const ws = workspaces[wsId];
                const isWorkspaceFocused =
                  activeTabId &&
                  tabs.some(
                    (t) => t.id === activeTabId && t.workspaceId === wsId,
                  );
                const firstWsTab = tabs.find((t) => t.workspaceId === wsId);
                if (!firstWsTab) return;

                const wsItemId = `ws-${wsId}`;
                const isDraggingThis = dragTabId === wsItemId && dragging;
                // Workspace 内任一 tab 开启广播，则在 Workspace 标签上显示呼吸图标
                const wsHasBroadcast = tabs.some(
                  (t) =>
                    t.workspaceId === wsId && broadcastTabIds.includes(t.id),
                );
                const wsTabs = tabs.filter((t) => t.workspaceId === wsId);
                const activeWsTab =
                  wsTabs.find((t) => t.id === activeTabId) ||
                  wsTabs[0] ||
                  firstWsTab;
                const isWsConnected = wsTabs.some(
                  (t) => (connectedServers[`ws:${t.serverId}:${t.id}`] ?? connectedServers[t.serverId]) ?? false,
                );
                const isWsConnecting = wsTabs.some((t) => {
                  const s = serverStates[`ws:${t.serverId}:${t.id}`] ?? serverStates[t.serverId];
                  return s?.state === "connecting" || s?.state === "authenticating";
                });
                const wsServer = servers.find((s) => s.id === activeWsTab?.serverId);
                const isWsBmc = wsServer?.targetType === "bmc";
                const isWsRdp = wsServer?.targetType === "rdp" || wsServer?.protocol === "rdp";
                const isWsSerial =
                  wsServer?.targetType === "serial" ||
                  wsServer?.protocol === "serial" ||
                  wsServer?.osType === "serial";
                const isWsOnline = isWsConnected || isWsBmc || isWsRdp;
                const wsStatusTitle = isWsBmc
                  ? t("bmc_ready") || "BMC 就绪"
                  : isWsRdp
                    ? t("rdp_ready") || "远程桌面"
                    : isWsConnecting
                      ? t("btn_connecting") || "连接中..."
                      : isWsConnected
                        ? t("btn_connected") || "已连接"
                        : t("status_disconnected") || "已断开";

                const isRenamingWs = renamingWsId === wsId;
                const wsColor = ws.color;

                renderedItems.push(
                  <div
                    key={wsItemId}
                    data-tab-id={wsItemId}
                    ref={(el) => setTabRef(wsItemId, el)}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return;
                      if (
                        (e.target as HTMLElement).closest("button") ||
                        (e.target as HTMLElement).closest("input")
                      )
                        return;
                      const el = tabElemRefs.current.get(wsItemId);
                      if (el) {
                        dragTabRectRef.current = el.getBoundingClientRect();
                      }
                      mouseStartRef.current = { x: e.clientX, y: e.clientY };
                      dragActiveRef.current = false;
                      wasDraggedRef.current = false;
                      setDragState(false, wsItemId);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setCtxMenu({ x: e.clientX, y: e.clientY, workspace: ws });
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startRenameWorkspace(ws);
                    }}
                    className={cn(
                      "theme-tab-item relative my-0.5 flex h-[calc(100%-6px)] max-w-[220px] shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap px-3 text-xs group",
                      isWorkspaceFocused ? "is-active mx-1" : "mx-0.5",
                      isDraggingThis && "invisible pointer-events-none",
                      dragging && !isDraggingThis && "transition-transform",
                      wsColor && "colored-tab",
                    )}
                    style={
                      wsColor
                        ? ({
                            borderLeftColor: wsColor,
                            borderLeftWidth: 3,
                            "--tab-custom-color": wsColor,
                          } as React.CSSProperties)
                        : undefined
                    }
                    onClick={() => {
                      if (wasDraggedRef.current) {
                        wasDraggedRef.current = false;
                        return;
                      }
                      const activeInWs = tabs.find(
                        (t) => t.id === activeTabId && t.workspaceId === wsId,
                      );
                      if (activeInWs) {
                        setActiveTab(activeInWs.id);
                      } else {
                        setActiveTab(firstWsTab.id);
                      }
                      window.dispatchEvent(new CustomEvent("focus-active-terminal"));
                    }}
                    title={ws.name}
                  >

                    {/* 状态圆点 */}
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full shrink-0 transition-all duration-300",
                        isWsOnline
                          ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.85)] ring-1 ring-background/60"
                          : isWsConnecting
                            ? "bg-amber-400 animate-pulse shadow-[0_0_6px_rgba(251,191,36,0.85)] ring-1 ring-background/60"
                            : "bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.7)] ring-1 ring-background/60"
                      )}
                      title={wsStatusTitle}
                    />

                    {/* 系统图标 */}
                    <span
                      className={cn(
                        "h-3.5 w-3.5 flex-shrink-0 overflow-hidden rounded-[3px] transition-all duration-200",
                        !isWsOnline && !isWsConnecting
                          ? "grayscale opacity-60 contrast-75"
                          : isWsConnecting
                            ? "opacity-80"
                            : "opacity-100"
                      )}
                      title={wsStatusTitle}
                    >
                      <OsIcon
                        osType={wsServer?.osType}
                        osInfo={wsServer?.osInfo}
                        targetType={isWsSerial ? "serial" : wsServer?.targetType}
                        className="h-full w-full"
                      />
                    </span>

                    {isRenamingWs ? (
                      <input
                        ref={(el) => {
                          if (el) {
                            setTimeout(() => {
                              el.focus();
                              el.select();
                            }, 0);
                          }
                        }}
                        autoFocus
                        value={renameWsValue}
                        onChange={(e) => setRenameWsValue(e.target.value)}
                        onFocus={(e) => e.target.select()}
                        onBlur={confirmRenameWorkspace}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") confirmRenameWorkspace();
                          if (e.key === "Escape") cancelRenameWorkspace();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="bg-transparent border-b border-primary outline-none text-xs w-[130px] max-w-[150px] px-0.5"
                      />
                    ) : (
                      <span className="min-w-0 truncate">
                        {ws.name}
                      </span>
                    )}

                    {/* 锁定图标 */}
                    {ws.locked && (
                      <Lock className="h-3 w-3 text-warning flex-shrink-0" />
                    )}

                    {wsHasBroadcast && (
                      <Radio
                        className={cn(
                          "h-3 w-3 flex-shrink-0 animate-broadcast-breath",
                          isWorkspaceFocused
                            ? "text-primary dark:text-white"
                            : "text-primary",
                        )}
                      />
                    )}
                    {!ws.locked && (
                      <button
                        className={cn(
                          "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded transition-all duration-200 hover:bg-muted-foreground/20 active:scale-90",
                          isWorkspaceFocused
                            ? "opacity-70 hover:opacity-100"
                            : "opacity-0 group-hover:opacity-100",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          closeWorkspace(wsId);
                        }}
                        title={t("tb_close")}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>,
                );
              }
              return;
            }

            // isActive = 焦点窗格正在显示的 tab（全局活跃）；
            // isPaneShown = 某个窗格正在显示的 tab（分屏时可能多个同时成立，仅焦点窗格的主高亮）
            const groupActiveId = tab.groupId
              ? groups[tab.groupId]?.activeTabId
              : null;
            const isActive = tab.id === activeTabId;
            const isPaneShown = tab.id === groupActiveId;
            const isRenaming = renamingTabId === tab.id;
            const displayTitle = getCleanTabTitle(tab);
            const isDraggingThis = dragTabId === tab.id && dragging;
            const wsConnId = `ws:${tab.serverId}:${tab.id}`;
            const isConnected = (connectedServers[wsConnId] ?? connectedServers[tab.serverId]) ?? false;
            const stateEntry = serverStates[wsConnId] ?? serverStates[tab.serverId];
            const isConnecting =
              stateEntry?.state === "connecting" ||
              stateEntry?.state === "authenticating";
            // BMC 带外管理通过 Redfish (HTTPS) 工作，不依赖 SSH 连接，
            // 顶部 Tab 状态指示器应显示"已就绪"而非"已断开"
            const tabServer = servers.find((s) => s.id === tab.serverId);
            const isBmcTab = tabServer?.targetType === "bmc";
            const isRdpTab = tabServer?.targetType === "rdp" || tabServer?.protocol === "rdp";
            // OsIcon 只按 osType / targetType 判定类型，不识别 protocol，
            // 因此串口（protocol === 'serial'）需在此归一为 targetType='serial'，
            // 否则会被误显示成默认的 Linux 图标。
            const isSerialTab =
              tabServer?.targetType === "serial" ||
              tabServer?.protocol === "serial" ||
              tabServer?.osType === "serial";

            const isOnline = isConnected || isBmcTab || isRdpTab;
            const tabStatusTitle = isBmcTab
              ? t("bmc_ready") || "BMC 就绪"
              : isRdpTab
                ? t("rdp_ready") || "远程桌面"
                : isConnecting
                  ? t("btn_connecting") || "连接中..."
                  : isConnected
                    ? t("btn_connected") || "已连接"
                    : t("status_disconnected") || "已断开";
            const fullTabTitle = `${displayTitle} (${tabStatusTitle})`;

            renderedItems.push(
              <div
                key={tab.id}
                data-tab-id={tab.id}
                ref={(el) => setTabRef(tab.id, el)}
                onMouseDown={(e) => handleMouseDown(e, tab)}
                onContextMenu={(e) => handleContextMenu(e, tab)}
                className={cn(
                  "theme-tab-item relative my-0.5 flex h-[calc(100%-6px)] max-w-[220px] shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap px-3 text-xs group",
                  isActive ? "is-active mx-1" : "mx-0.5",
                  // 被拖拽中的 tab：占位隐藏
                  isDraggingThis && "invisible pointer-events-none",
                  // 拖拽中非目标 tab 的过渡
                  dragging && !isDraggingThis && "transition-transform",
                  tab.color && "colored-tab",
                )}
                style={
                  tab.color
                    ? ({
                        borderLeftColor: tab.color,
                        borderLeftWidth: 3,
                        "--tab-custom-color": tab.color,
                      } as React.CSSProperties)
                    : undefined
                }
                onClick={() => {
                  if (wasDraggedRef.current) {
                    wasDraggedRef.current = false;
                    return;
                  }
                  setActiveTab(tab.id);
                  window.dispatchEvent(new CustomEvent("focus-active-terminal"));
                }}
                title={fullTabTitle}
              >
                {/* 状态圆点 */}
                {tab.serverId !== "sftp" && (
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full shrink-0 transition-all duration-300",
                      isOnline
                        ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.85)] ring-1 ring-background/60"
                        : isConnecting
                          ? "bg-amber-400 animate-pulse shadow-[0_0_6px_rgba(251,191,36,0.85)] ring-1 ring-background/60"
                          : "bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.7)] ring-1 ring-background/60"
                    )}
                    title={tabStatusTitle}
                  />
                )}

                {tab.serverId === "sftp" ? (
                  <ArrowLeftRight className="h-3.5 w-3.5 flex-shrink-0" />
                ) : (
                  <span
                    className={cn(
                      "h-3.5 w-3.5 flex-shrink-0 overflow-hidden rounded-[3px] transition-all duration-200",
                      !isOnline && !isConnecting
                        ? "grayscale opacity-60 contrast-75"
                        : isConnecting
                          ? "opacity-80"
                          : "opacity-100",
                    )}
                    title={tabStatusTitle}
                  >
                    <OsIcon
                      osType={tabServer?.osType}
                      osInfo={tabServer?.osInfo}
                      targetType={isSerialTab ? "serial" : tabServer?.targetType}
                      className="h-full w-full"
                    />
                  </span>
                )}

                {isRenaming ? (
                  <input
                    ref={(el) => {
                      if (el) {
                        setTimeout(() => {
                          el.focus();
                          el.select();
                        }, 0);
                      }
                    }}
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    onBlur={confirmRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmRename();
                      if (e.key === "Escape") cancelRename();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="bg-transparent border-b border-primary outline-none text-xs w-[130px] max-w-[150px] px-0.5"
                  />
                ) : (
                  // 不用 flex-1：否则标题会撑满剩余宽度，把关闭按钮顶到最右侧，
                  // 名称与 × 之间出现大片空白。不伸展时 × 紧跟标题。
                  <span className="min-w-0 truncate">
                    {displayTitle}
                  </span>
                )}

                {/* 广播呼吸图标：当前 tab 开启终端广播时显示 */}
                {broadcastTabIds.includes(tab.id) && (
                  <Radio
                    className={cn(
                      "h-3 w-3 flex-shrink-0 animate-broadcast-breath",
                      isActive
                        ? "text-primary dark:text-white"
                        : "text-primary",
                    )}
                  />
                )}

                {/* 锁定图标 */}
                {tab.locked && (
                  <Lock className="h-3 w-3 text-warning flex-shrink-0" />
                )}

                {/* 关闭按钮 */}
                {!tab.locked && (
                  <button
                    className={cn(
                      "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded transition-all duration-200 hover:bg-muted-foreground/20 active:scale-90",
                      isActive
                        ? "opacity-70 hover:opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowCloseConfirm(tab.id);
                    }}
                    title={t("tb_close")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>,
            );
          });

          return renderedItems;
        })()}
        <button
          type="button"
          className="mx-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/50 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title={t("tb_open_other_servers")}
          aria-label={t("tb_open_other_servers")}
          onClick={() => {
            setSelectedServerId(null);
            setServerQuery("");
            setGroupFilter(null);
            setTagFilter(null);
            setShowServerPicker(true);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {tabScrollState.left && (
        <button
          type="button"
          className="absolute left-1 top-1/2 z-20 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-background/95 text-foreground shadow-md backdrop-blur-sm hover:bg-accent"
          title={t("tb_scroll_left")}
          aria-label={t("tb_scroll_left")}
          onClick={() =>
            tabBarRef.current?.scrollBy({ left: -320, behavior: "smooth" })
          }
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}
      {tabScrollState.right && (
        <button
          type="button"
          className="absolute right-1 top-1/2 z-20 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-border/70 bg-background/95 text-foreground shadow-md backdrop-blur-sm hover:bg-accent"
          title={t("tb_scroll_right")}
          aria-label={t("tb_scroll_right")}
          onClick={() =>
            tabBarRef.current?.scrollBy({ left: 320, behavior: "smooth" })
          }
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}

      {showServerPicker &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[12vh]"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget)
                setShowServerPicker(false);
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget)
                setShowServerPicker(false);
            }}
          >
            <div
              className="w-[min(640px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border/60 glass-strong shadow-2xl"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-b border-border/60 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">
                      {t("tb_open_other_servers")}
                    </h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {t("tb_open_other_servers_desc")}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                    onClick={() => setShowServerPicker(false)}
                    aria-label={t("common_close")}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex h-8 items-center gap-2 rounded-md border border-border bg-muted/20 px-2">
                  <Search className="h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    autoFocus
                    value={serverQuery}
                    onChange={(event) => setServerQuery(event.target.value)}
                    placeholder={t("tb_server_search_placeholder")}
                    className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                  />
                  {serverQuery && (
                    <button
                      type="button"
                      onClick={() => setServerQuery("")}
                      className="p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {/* 分组与标签筛选条（与 SFTP 面板一致） */}
                {(serverGroups.length > 0 || allTags.length > 0) && (
                  <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
                    {serverGroups.length > 0 && (
                      <>
                        <GroupFilterChip
                          groups={serverGroups}
                          value={groupFilter}
                          onChange={setGroupFilter}
                          counts={groupFilterCounts.counts}
                          ungroupedCount={groupFilterCounts.ungrouped}
                        />
                        {allTags.length > 0 && (
                          <span className="w-px h-3.5 bg-border/60 mx-0.5" />
                        )}
                      </>
                    )}
                    {allTags.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[11px] text-muted-foreground mr-0.5">
                          {t("dashboard_filter_tags")}:
                        </span>
                        <button
                          type="button"
                          onClick={() => setTagFilter(null)}
                          className={cn(
                            "px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer",
                            tagFilter === null
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted/60 text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {t("dashboard_filter_all")}
                        </button>
                        {allTags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() =>
                              setTagFilter(tagFilter === tag ? null : tag)
                            }
                            className={cn(
                              "px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer",
                              tagFilter === tag
                                ? "bg-primary text-primary-foreground"
                                : "bg-primary/10 text-primary hover:bg-primary/20",
                            )}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="max-h-[min(52vh,420px)] overflow-y-auto p-1.5 flex flex-col gap-0.5">
                {filteredServers.length === 0 ? (
                  <div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
                    <Search className="h-7 w-7 text-muted-foreground/35" />
                    <span>{t("dashboard_no_matches")}</span>
                  </div>
                ) : (
                  filteredServers.map((s) => {
                    const isSelected = selectedServerId === s.id;
                    const groupName = s.groupId
                      ? groupPathMap?.get(s.groupId) ||
                        serverGroups.find((g) => g.id === s.groupId)?.name
                      : null;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={cn(
                          "flex h-8 w-full items-center gap-3 rounded-md px-2 text-left transition-all select-none border border-transparent cursor-pointer",
                          isSelected
                            ? "bg-primary/10 text-primary border-primary/20"
                            : "hover:bg-accent/40 text-foreground",
                        )}
                        onClick={() => setSelectedServerId(s.id)}
                        onDoubleClick={() => openSelectedServer(s.id)}
                      >
                        <OsIcon
                          osType={s.osType}
                          osInfo={s.osInfo}
                          targetType={s.targetType}
                          className="h-4 w-4 shrink-0 overflow-hidden rounded"
                        />
                        {/* 名称 */}
                        <span
                          className="w-[140px] shrink-0 truncate text-xs font-medium"
                          title={s.name || s.host}
                        >
                          {s.name || s.host}
                        </span>
                        {/* IP/Host */}
                        <span
                          className="w-[110px] shrink-0 truncate font-mono text-[11px] tabular-nums text-muted-foreground"
                          title={s.host}
                        >
                          {s.host}
                        </span>
                        {/* 端口 */}
                        <span className="w-[46px] shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">
                          {s.port || 22}
                        </span>
                        {/* 用户名 */}
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-[11px] tabular-nums text-muted-foreground/70"
                          title={s.username}
                        >
                          {s.username}
                        </span>
                        {/* 所属分组（显示分组路径） */}
                        {groupName && (
                          <span
                            className="shrink-0 max-w-[120px] truncate text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground border border-border/40 font-normal"
                            title={groupName}
                          >
                            {groupName}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground flex items-center justify-between">
                <span>
                  {selectedServerId
                    ? t("tb_double_click_to_open")
                    : t("tb_select_server_hint")}
                </span>
                {selectedServerId && (
                  <Button
                    size="sm"
                    className="h-6 text-xs px-3 cursor-pointer"
                    onClick={() => openSelectedServer(selectedServerId)}
                  >
                    {t("dash_btn_connect") || "连接"}
                  </Button>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 右键菜单 */}
      {ctxMenu &&
        createPortal(
          (() => {
            // 主菜单位置：夹紧到视口内（预估宽度 200，高度 360）
            const mainPos = clampMenuToViewport(ctxMenu.x, ctxMenu.y, 200, 360);
            // 颜色子菜单方向：右侧空间不足时向左展开
            const vw = window.innerWidth;
            const mainW = 200;
            const colorSubW = 210;
            const rightSpace = vw - (mainPos.left + mainW) - 4;
            const colorSide = rightSpace >= colorSubW + 4 ? "right" : "left";

            // Workspace 复合标签右键菜单
            if (ctxMenu.workspace) {
              const ws = ctxMenu.workspace;
              const hasOtherClosable = tabs.some((t) => {
                if (t.workspaceId === ws.id) return false;
                if (t.locked) return false;
                if (t.workspaceId && workspaces[t.workspaceId]?.locked) return false;
                return true;
              });

              return (
                <div
                  data-ctx-menu
                  className="fixed z-[100] min-w-[180px] glass-strong border border-border/60 rounded-xl shadow-lg py-1.5 text-xs"
                  style={{ left: mainPos.left, top: mainPos.top }}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  {/* 重命名 */}
                  <CtxMenuItem
                    icon={<Pencil className="h-3.5 w-3.5" />}
                    label={t("tb_rename")}
                    onClick={() => startRenameWorkspace(ws)}
                  />

                  {/* 锁定 / 解锁 */}
                  <CtxMenuItem
                    icon={
                      ws.locked ? (
                        <Unlock className="h-3.5 w-3.5" />
                      ) : (
                        <Lock className="h-3.5 w-3.5 text-warning" />
                      )
                    }
                    label={ws.locked ? t("tb_unlock") : t("tb_lock")}
                    onClick={() => {
                      toggleWorkspaceLock(ws.id);
                      setCtxMenu(null);
                    }}
                  />

                  {/* 设置标签颜色 */}
                  <div className="relative group/color">
                    <button
                      className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-accent text-left transition-colors duration-150"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Palette className="h-3.5 w-3.5" />
                      <span>{t("tab_set_color")}</span>
                      <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground/80" />
                    </button>
                    {/* 颜色子菜单：根据右侧空间向右/向左拉出 */}
                    <div
                      className={cn(
                        "absolute top-0 z-[101] hidden group-hover/color:block",
                        colorSide === "right"
                          ? "left-[calc(100%-4px)] pl-2"
                          : "right-[calc(100%-4px)] pr-2",
                      )}
                    >
                      <div className="glass-strong border border-border/60 rounded-xl shadow-lg p-2 min-w-[210px] grid grid-cols-3 gap-1.5">
                        {TAB_COLORS.map((color) => (
                          <button
                            key={color.nameKey}
                            className="flex flex-col items-center gap-1 p-1 rounded-lg hover:bg-accent text-[10px] transition-colors duration-150"
                            onClick={() => {
                              setWorkspaceColor(ws.id, color.value);
                              setCtxMenu(null);
                            }}
                            title={t(color.nameKey)}
                          >
                            {color.value ? (
                              <div
                                className="h-5 w-5 rounded-full border border-white/20 shadow-sm"
                                style={{ backgroundColor: color.value }}
                              />
                            ) : (
                              <div className="h-5 w-5 rounded-full border border-dashed border-muted-foreground/50 flex items-center justify-center">
                                <span className="text-[10px] text-muted-foreground">
                                  ✕
                                </span>
                              </div>
                            )}
                            <span className="truncate max-w-[50px]">
                              {t(color.nameKey)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <CtxMenuDivider />

                  {/* 关闭当前 */}
                  <CtxMenuItem
                    icon={<X className="h-3.5 w-3.5" />}
                    label={t("tab_close_current")}
                    disabled={ws.locked}
                    onClick={() => {
                      if (!ws.locked) {
                        closeWorkspace(ws.id);
                        setCtxMenu(null);
                      }
                    }}
                  />

                  {/* 关闭其他 */}
                  <CtxMenuItem
                    icon={<Plus className="h-3.5 w-3.5 rotate-45" />}
                    label={t("tab_close_others")}
                    disabled={!hasOtherClosable}
                    onClick={() => {
                      setShowCloseWsOthersConfirm(ws.id);
                      setCtxMenu(null);
                    }}
                  />
                </div>
              );
            }

            if (!ctxMenu.tab) return null;
            return (
              <div
                data-ctx-menu
                className="fixed z-[100] min-w-[180px] glass-strong border border-border/60 rounded-xl shadow-lg py-1.5 text-xs"
                style={{ left: mainPos.left, top: mainPos.top }}
                onClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.preventDefault()}
              >
                {/* 仅终端会话标签支持：复制会话 / 重命名 */}
                {ctxMenu.tab.serverId !== "sftp" && (
                  <>
                    <CtxMenuItem
                      icon={<Copy className="h-3.5 w-3.5" />}
                      label={t("tb_duplicate")}
                      onClick={() => {
                        duplicateTab(ctxMenu.tab.id);
                        setCtxMenu(null);
                      }}
                    />

                    <CtxMenuItem
                      icon={<Pencil className="h-3.5 w-3.5" />}
                      label={t("tb_rename")}
                      onClick={() => startRename(ctxMenu.tab)}
                    />

                    <CtxMenuDivider />
                  </>
                )}

                {/* 所有标签共用项：锁定 / 解锁 & 标签颜色 */}
                <CtxMenuItem
                  icon={
                    ctxMenu.tab.locked ? (
                      <Unlock className="h-3.5 w-3.5" />
                    ) : (
                      <Lock className="h-3.5 w-3.5" />
                    )
                  }
                  label={ctxMenu.tab.locked ? t("tb_unlock") : t("tb_lock")}
                  onClick={() => {
                    toggleTabLock(ctxMenu.tab.id);
                    setCtxMenu(null);
                  }}
                />

                <div className="relative group/color">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-accent text-left transition-colors duration-150"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Palette className="h-3.5 w-3.5" />
                    <span>{t("tab_set_color")}</span>
                    <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground/80" />
                  </button>
                  {/* 颜色子菜单：根据右侧空间向右/向左拉出 */}
                  <div
                    className={cn(
                      "absolute top-0 z-[101] hidden group-hover/color:block",
                      colorSide === "right"
                        ? "left-[calc(100%-4px)] pl-2"
                        : "right-[calc(100%-4px)] pr-2",
                    )}
                  >
                    <div className="glass-strong border border-border/60 rounded-xl shadow-lg p-2 min-w-[210px] grid grid-cols-3 gap-1.5">
                      {TAB_COLORS.map((color) => (
                        <button
                          key={color.nameKey}
                          className="flex flex-col items-center gap-1 p-1 rounded-lg hover:bg-accent text-[10px] transition-colors duration-150"
                          onClick={() => {
                            setTabColor(ctxMenu.tab.id, color.value);
                            setCtxMenu(null);
                          }}
                          title={t(color.nameKey)}
                        >
                          {color.value ? (
                            <div
                              className="h-5 w-5 rounded-full border border-white/20 shadow-sm"
                              style={{ backgroundColor: color.value }}
                            />
                          ) : (
                            <div className="h-5 w-5 rounded-full border border-dashed border-muted-foreground/60 flex items-center justify-center">
                              <span className="text-[8px] leading-none text-muted-foreground">
                                X
                              </span>
                            </div>
                          )}
                          <span className="truncate max-w-[48px]">
                            {t(color.nameKey)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <CtxMenuDivider />

                <CtxMenuItem
                  icon={<X className="h-3.5 w-3.5" />}
                  label={t("tab_close_current")}
                  disabled={ctxMenu.tab.locked}
                  onClick={() => {
                    if (!ctxMenu.tab.locked) {
                      setShowCloseConfirm(ctxMenu.tab.id);
                      setCtxMenu(null);
                    }
                  }}
                />

                <CtxMenuItem
                  icon={<Plus className="h-3.5 w-3.5 rotate-45" />}
                  label={t("tab_close_others")}
                  onClick={() => {
                    setShowCloseOthersConfirm(ctxMenu.tab.id);
                    setCtxMenu(null);
                  }}
                />
              </div>
            );
          })(),
          document.body,
        )}

      {/* 关闭确认 */}
      <ConfirmDialog
        open={!!showCloseConfirm}
        title={t("tab_confirm_close_title")}
        description={t("tab_confirm_close_desc")}
        confirmLabel={t("tab_confirm_close_btn")}
        cancelLabel={t("tab_cancel_btn")}
        onConfirm={() => {
          if (showCloseConfirm) closeTab(showCloseConfirm);
          setShowCloseConfirm(null);
        }}
        onCancel={() => setShowCloseConfirm(null)}
      />

      {/* 关闭其他确认 */}
      <ConfirmDialog
        open={!!showCloseOthersConfirm}
        title={t("tab_confirm_close_others_title")}
        description={t("tab_confirm_close_others_desc")}
        confirmLabel={t("tab_confirm_close_others_btn")}
        cancelLabel={t("tab_cancel_btn")}
        onConfirm={() => {
          if (showCloseOthersConfirm) closeOtherTabs(showCloseOthersConfirm);
          setShowCloseOthersConfirm(null);
        }}
        onCancel={() => setShowCloseOthersConfirm(null)}
      />

      {/* 关闭其他分屏工作区确认 */}
      <ConfirmDialog
        open={!!showCloseWsOthersConfirm}
        title={t("tab_confirm_close_others_title")}
        description={t("tab_confirm_close_others_desc")}
        confirmLabel={t("tab_confirm_close_others_btn")}
        cancelLabel={t("tab_cancel_btn")}
        onConfirm={() => {
          if (showCloseWsOthersConfirm) {
            closeOtherWorkspaces(showCloseWsOthersConfirm);
          }
          setShowCloseWsOthersConfirm(null);
        }}
        onCancel={() => setShowCloseWsOthersConfirm(null)}
      />


      {/* 拖拽时的 Portal 浮动预览 */}
      {dragging &&
        dragTabId &&
        (() => {
          if (dragTabId.startsWith("ws-")) {
            const wsId = dragTabId.replace("ws-", "");
            const ws = workspaces[wsId];
            if (!ws) return null;
            const wsTabs = tabs.filter((t) => t.workspaceId === wsId);
            const activeWsTab =
              wsTabs.find((t) => t.id === activeTabId) ||
              wsTabs[0];
            const wsServer = servers.find((s) => s.id === activeWsTab?.serverId);
            const isWsBmc = wsServer?.targetType === "bmc";
            const isWsRdp = wsServer?.targetType === "rdp" || wsServer?.protocol === "rdp";
            const isWsSerial =
              wsServer?.targetType === "serial" ||
              wsServer?.protocol === "serial" ||
              wsServer?.osType === "serial";
            const isWsConnected = wsTabs.some(
              (t) => (connectedServers[`ws:${t.serverId}:${t.id}`] ?? connectedServers[t.serverId]) ?? false,
            );
            const isWsOnline = isWsConnected || isWsBmc || isWsRdp;

            const style: React.CSSProperties = {
              position: "fixed",
              left: dragStartRect ? dragStartRect.left : 0,
              top: dragStartRect ? dragStartRect.top : 0,
              width: dragStartRect ? Math.min(dragStartRect.width, 200) : "auto",
              maxWidth: 200,
              height: dragStartRect ? dragStartRect.height : "auto",
              zIndex: 9999,
              pointerEvents: "none",
            };
            const wsColor = ws.color;
            return createPortal(
              <div
                id="drag-preview-portal"
                style={{
                  ...style,
                  ...(wsColor
                    ? ({
                        borderLeftColor: wsColor,
                        borderLeftWidth: 3,
                        "--tab-custom-color": wsColor,
                      } as React.CSSProperties)
                    : {}),
                }}
                className={cn(
                  "theme-tab-item is-active relative flex items-center gap-2 px-3.5 shadow-xl opacity-95 text-xs font-semibold select-none !cursor-grabbing",
                  wsColor && "colored-tab",
                )}
              >
                {/* 颜色条 */}
                {wsColor && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md"
                    style={{ backgroundColor: wsColor }}
                  />
                )}

                <span
                  className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    isWsOnline
                      ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.85)] ring-1 ring-background/60"
                      : "bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.7)] ring-1 ring-background/60",
                  )}
                />

                <span
                  className={cn(
                    "h-3.5 w-3.5 flex-shrink-0 overflow-hidden rounded-[3px]",
                    !isWsOnline && "grayscale opacity-60 contrast-75",
                  )}
                >
                  <OsIcon
                    osType={wsServer?.osType}
                    osInfo={wsServer?.osInfo}
                    targetType={isWsSerial ? "serial" : wsServer?.targetType}
                    className="h-full w-full"
                  />
                </span>

                <span className="font-semibold tracking-wide truncate min-w-0 flex-1">
                  {ws.name}
                </span>

                {/* 锁定图标 */}
                {ws.locked && (
                  <Lock className="h-3 w-3 text-warning flex-shrink-0" />
                )}

                {!ws.locked && (
                  <div className="h-4 w-4 rounded-md flex items-center justify-center opacity-70 flex-shrink-0 ml-1">
                    <X className="h-3 w-3" />
                  </div>
                )}
              </div>,
              document.body,
            );
          }

          const dragTab = tabs.find((t) => t.id === dragTabId);
          if (!dragTab) return null;
          const displayTitle = getCleanTabTitle(dragTab);

          const style: React.CSSProperties = {
            position: "fixed",
            left: dragStartRect ? dragStartRect.left : 0,
            top: dragStartRect ? dragStartRect.top : 0,
            width: dragStartRect ? Math.min(dragStartRect.width, 200) : "auto",
            maxWidth: 200,
            height: dragStartRect ? dragStartRect.height : "auto",
            zIndex: 9999,
            pointerEvents: "none",
          };

          const tabColor = dragTab.color;
          return createPortal(
            <div
              id="drag-preview-portal"
              style={{
                ...style,
                ...(tabColor
                  ? ({
                      borderLeftColor: tabColor,
                      borderLeftWidth: 3,
                      "--tab-custom-color": tabColor,
                    } as React.CSSProperties)
                  : {}),
              }}
              className={cn(
                "theme-tab-item is-active relative flex items-center gap-2 px-3.5 shadow-xl opacity-95 text-xs font-semibold select-none !cursor-grabbing",
                tabColor && "colored-tab",
              )}
            >
              {/* 颜色条 */}
              {dragTab.color && (
                <div
                  className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md"
                  style={{ backgroundColor: dragTab.color }}
                />
              )}

              {(() => {
                const dragServer = servers.find((s) => s.id === dragTab.serverId);
                const isDragBmc = dragServer?.targetType === "bmc";
                const isDragRdp = dragServer?.targetType === "rdp" || dragServer?.protocol === "rdp";
                // OsIcon 只按 osType / targetType 判定，不识别 protocol，
                // 串口需归一为 targetType='serial'，否则回退成默认 Linux 图标。
                const isDragSerial =
                  dragServer?.targetType === "serial" ||
                  dragServer?.protocol === "serial" ||
                  dragServer?.osType === "serial";
                const dragConnected =
                  dragTab.serverId
                    ? ((connectedServers[`ws:${dragTab.serverId}:${dragTab.id}`] ?? connectedServers[dragTab.serverId]) ?? false)
                    : false;
                const isDragOnline = dragConnected || isDragBmc || isDragRdp;
                return (
                  <>
                    {dragTab.serverId !== "sftp" && (
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full shrink-0",
                          isDragOnline
                            ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.85)] ring-1 ring-background/60"
                            : "bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.7)] ring-1 ring-background/60"
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        "h-3.5 w-3.5 flex-shrink-0 overflow-hidden rounded-[3px]",
                        !isDragOnline && "grayscale opacity-60 contrast-75"
                      )}
                    >
                      <OsIcon
                        osType={dragServer?.osType}
                        osInfo={dragServer?.osInfo}
                        targetType={isDragSerial ? "serial" : dragServer?.targetType}
                        className="h-full w-full"
                      />
                    </span>
                  </>
                );
              })()}

              <span className="font-semibold tracking-wide truncate min-w-0 flex-1">
                {displayTitle}
              </span>

              {/* 锁定图标 */}
              {dragTab.locked && (
                <Lock className="h-3 w-3 text-warning flex-shrink-0" />
              )}

              {/* 关闭按钮预览 */}
              {!dragTab.locked && (
                <div className="h-4 w-4 rounded-md flex items-center justify-center opacity-70 flex-shrink-0 ml-1">
                  <X className="h-3 w-3" />
                </div>
              )}
            </div>,
            document.body,
          );
        })()}
    </div>
  );
}

// ── 辅助类型 & 组件 ──────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  tab?: WorkspaceTab;
  workspace?: WorkspaceDef;
}

function CtxMenuItem({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-accent text-left transition-colors duration-150",
        disabled && "opacity-40 cursor-not-allowed hover:bg-transparent",
      )}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function CtxMenuDivider() {
  return <div className="h-px bg-border/60 my-1 mx-1" />;
}
