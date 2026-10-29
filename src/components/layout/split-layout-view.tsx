import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  memo,
} from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "@/store";
import type {
  DropZone,
  SplitContainerNode,
  SplitLayoutNode,
  WorkspaceTab,
} from "@/types";
import { WorkspacePage } from "@/pages/workspace";
import { SftpPanel } from "@/components/layout/sftp-panel";
import { cn } from "@/lib/utils";
import { collectGroupIds, removeGroupNode } from "@/utils/split-layout";
import { getTerminalTheme } from "@/utils/terminal-themes";
import {
  Server,
  Cable,
  Cpu,
  Router,
  X,
  PanelTopOpen,
  Radio,
  Copy,
  Check,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { playSound, SoundType } from "@/lib/sound";
import { useTranslation } from "@/i18n";

/**
 * 分屏布局视图：递归渲染 T 字型二叉树布局。
 * - split 节点：按 direction 水平/垂直排列两个子树，中间为可拖拽分隔条；
 *   子树尺寸用 flexBasis 百分比表达，窗口尺寸变化时按比例自适应。
 * - group 叶子：一个 tab 分组的内容区（组内 Header + 活跃标签内容 + 拖拽落点预览）。
 */
export function SplitLayoutView() {
  const workspaces = useAppStore((s) => s.workspaces);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  const dragging = useAppStore((s) => s.dragging);
  const dragTabId = useAppStore((s) => s.dragTabId);
  const terminalThemeId = useAppStore((s) => s.terminalThemeId);
  const customTerminalThemes = useAppStore((s) => s.customTerminalThemes);
  const terminalThemeOverrides = useAppStore((s) => s.terminalThemeOverrides);
  const terminalTheme = useMemo(
    () =>
      getTerminalTheme(
        terminalThemeId,
        customTerminalThemes,
        terminalThemeOverrides,
      ),
    [terminalThemeId, customTerminalThemes, terminalThemeOverrides],
  );
  const isDarkTheme = terminalTheme.type !== "light";

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId),
    [tabs, activeTabId],
  );
  const dragTab = useMemo(
    () => tabs.find((t) => t.id === dragTabId),
    [tabs, dragTabId],
  );

  // 所有 Standalone 独立标签的 groupId 列表
  const standaloneGroupIds = useMemo(() => {
    const set = new Set<string>();
    tabs.forEach((t) => {
      if (!t.workspaceId && t.groupId) {
        set.add(t.groupId);
      }
    });
    return Array.from(set);
  }, [tabs]);

  const activeWsId = activeTab?.workspaceId ?? null;

  return (
    <div
      className="h-full w-full relative overflow-hidden bg-background"
    >
      {/* 1. 渲染所有 Workspace 分屏（CSS hidden 控制显隐，全时保持 DOM 挂载和 SSH 会话） */}
      {Object.values(workspaces).map((ws) => {
        const isVisible = ws.id === activeWsId;

        // 拖拽本 Workspace 内的某窗格 Header 时，背景预览动态展示【临时扣除该窗格后局部坍缩】的自适应布局
        let displayLayout = ws.layout;
        if (
          dragging &&
          dragTab &&
          dragTab.workspaceId === ws.id &&
          dragTab.groupId
        ) {
          const gids = collectGroupIds(ws.layout);
          if (gids.length > 1 && gids.includes(dragTab.groupId)) {
            displayLayout =
              removeGroupNode(ws.layout, dragTab.groupId) ?? ws.layout;
          }
        }

        const isSplit = collectGroupIds(displayLayout).length > 1;

        return (
          <div
            key={ws.id}
            className={cn(
              isVisible ? "h-full w-full" : "hidden",
              isSplit ? "p-1" : "bg-background",
            )}
            style={{
              backgroundColor: isSplit ? terminalTheme.ui.background : undefined,
            }}
          >
            <LayoutNodeView node={displayLayout} isDarkTheme={isDarkTheme} />
          </div>
        );
      })}

      {/* 2. 渲染所有 Standalone 顶层标签（CSS hidden 控制显隐，全时保持 DOM 挂载和 SSH 会话） */}
      {standaloneGroupIds.map((gid) => {
        const isVisible = !activeWsId && activeTab?.groupId === gid;
        return (
          <div key={gid} className={isVisible ? "h-full w-full" : "hidden"}>
            <TabGroupView groupId={gid} />
          </div>
        );
      })}

      {/* 3. 全时持久挂载所有 tab 的会话组件（通过 React Portal 挂载到对应 slot，降级到 fallback，绝不 Unmount 终端） */}
      {/* fallback 用 0x0 绝对定位容器（不是 display:none），确保 portalTarget 挂入时内容不可见但不被 unmount */}
      <div
        id="persistent-tab-portal-fallback"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          overflow: "hidden",
          pointerEvents: "none",
        }}
      />
      <div id="persistent-tab-portal-container" className="hidden">
        {tabs.map((tab) => (
          <PersistentTabSlot
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
          />
        ))}
      </div>
    </div>
  );
}

const PersistentTabSlot = memo(function PersistentTabSlot({
  tab,
  isActive,
}: {
  tab: WorkspaceTab;
  isActive: boolean;
}) {
  const groupId = tab.groupId;
  // 核心：每个 tab 专属的、引用永不变的固定 DOM 节点作为 Portal target。
  // 因为 Portal target 在 tab 生命周期内永远不变，React 绝不会 unmount/remount TabContent，
  // 从而彻底杜绝拖拽分屏时 SSH 终端因 DOM 重排而断开重连。
  // 通过原生 appendChild 把这个节点"移动"到正确的 slot 内部 —— React 不感知此 DOM 操作，不触发生命周期。
  const [portalTarget] = useState<HTMLDivElement>(() => {
    const el = document.createElement("div");
    // 绝对定位：不占布局空间，多个 tab 的 portalTarget 可叠加在同一 slot 内，仅靠 isVisible 控制显隐
    el.style.position = "absolute";
    el.style.inset = "0";
    return el;
  });
  // 跟踪 portalTarget 是否已挂到正确的 slot（用于决定内容显隐）
  const [isOnSlot, setIsOnSlot] = useState(false);

  // 把 portalTarget 移动到正确的 slot（或 fallback）内部
  const moveToSlot = useCallback(() => {
    const slot = groupId
      ? document.getElementById(`pane-slot-${groupId}`)
      : null;
    const fallback = document.getElementById("persistent-tab-portal-fallback");
    const parent = slot || fallback;
    if (!parent) return;
    // 仅在真实位置不符时移动 DOM，避免重复触发 MutationObserver
    if (portalTarget.parentElement !== parent) {
      parent.appendChild(portalTarget);
      // DOM 移动到新 slot 后，Chromium 会重置其子级滚动容器的 scrollTop 为 0。
      // 必须派发 tab-slot-moved，通知终端实例重新测量并对齐视口
      window.dispatchEvent(
        new CustomEvent("tab-slot-moved", {
          detail: { tabId: tab.id, groupId },
        }),
      );
    }
    const nowOnSlot = Boolean(slot && portalTarget.parentElement === slot);
    setIsOnSlot((prev) => (prev === nowOnSlot ? prev : nowOnSlot));
  }, [groupId, portalTarget, tab.id]);

  // groupId 变化时，在 commit 阶段（paint 前）同步移动 portalTarget 到正确 slot 并同步可见性。
  useLayoutEffect(() => {
    moveToSlot();
    const g = useAppStore.getState().groups[groupId || ""];
    const isGroupActive = g?.activeTabId ? tab.id === g.activeTabId : true;
    const slot = groupId
      ? document.getElementById(`pane-slot-${groupId}`)
      : null;
    const isVisibleNow =
      Boolean(slot && portalTarget.parentElement === slot) && isGroupActive;
    // The portal host is intentionally managed outside React's tree so the
    // terminal component survives pane moves without remounting.

    portalTarget.style.display = isVisibleNow ? "block" : "none";
  }, [moveToSlot, groupId, tab.id, portalTarget]);

  // 监听 DOM 重排（slot 被 React 重建、拖拽分屏、新 slot 出现等）。
  useEffect(() => {
    let rafId: number | null = null;
    const observer = new MutationObserver((mutations) => {
      // 稳定性熔断：若已挂载在正确 slot 上，直接忽略后续一切无关 DOM 变更，绝不重复调度
      const slot = groupId
        ? document.getElementById(`pane-slot-${groupId}`)
        : null;
      if (slot && portalTarget.parentElement === slot) {
        return;
      }
      // 仅在有子节点新增时触发检查，忽略终端文本输出/属性修改等普通变更
      const hasAdded = mutations.some((m) => m.addedNodes.length > 0);
      if (!hasAdded) return;

      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        moveToSlot();
      });
    });

    const root =
      document.getElementById("persistent-tab-portal-container")?.parentElement ||
      document.body;
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [groupId, moveToSlot, portalTarget]);

  // 组件卸载时清理 portalTarget
  useEffect(() => {
    return () => {
      portalTarget.remove();
    };
  }, [portalTarget]);

  // 响应式读取 group 信息（原代码用 getState 非响应式，可能导致 isGroupActive 不更新）
  const group = useAppStore((s) => (groupId ? s.groups[groupId] : undefined));
  const isGroupActive = group?.activeTabId
    ? tab.id === group.activeTabId
    : true;
  const isVisible = isOnSlot && isGroupActive;

  // 保证隐藏标签的宿主层 display:none，彻底杜绝不可见层的透明全屏容器拦截下层的鼠标点击与上下滚轮事件
  useEffect(() => {
    portalTarget.style.display = isVisible ? "block" : "none";
  }, [isVisible, portalTarget]);

  // 判断当前 tab 是否处于分屏窗格中（所属 workspace 的 layout 含 >1 个 group）。
  // 分屏窗格模式下 WorkspacePage 只渲染终端，隐藏模块切换栏与连接按钮行。
  const isSplitPane = useAppStore((s) => {
    const wsId = tab.workspaceId;
    if (!wsId) return false;
    const ws = s.workspaces[wsId];
    if (!ws) return false;
    return collectGroupIds(ws.layout).length > 1;
  });

  return createPortal(
    <div
      className={isVisible ? "h-full w-full relative" : "hidden"}
      onMouseDownCapture={() => {
        if (tab.groupId) {
          useAppStore.getState().focusGroup(tab.groupId);
        }
        window.dispatchEvent(new CustomEvent("focus-active-terminal"));
      }}
    >
      <TabContent
        tab={tab}
        isActive={isActive}
        isVisible={isVisible}
        isSplitPane={isSplitPane}
      />
    </div>,
    portalTarget,
  );
});

function LayoutNodeView({
  node,
  isDarkTheme,
}: {
  node: SplitLayoutNode;
  isDarkTheme: boolean;
}) {
  if (node.type === "group") {
    return <TabGroupView key={`g-${node.groupId}`} groupId={node.groupId} />;
  }
  return (
    <SplitContainerView
      key={node.id}
      node={node}
      isDarkTheme={isDarkTheme}
    />
  );
}

// ── split 节点：双子树 + 可拖拽分隔条 ─────────────────────────────────────

function SplitContainerView({
  node,
  isDarkTheme,
}: {
  node: SplitContainerNode;
  isDarkTheme: boolean;
}) {
  const { t } = useTranslation();
  const resizeSplit = useAppStore((s) => s.resizeSplit);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const isRow = node.direction === "row";
  const dragHandlersRef = useRef<{ move: ((ev: MouseEvent) => void) | null; up: (() => void) | null }>({ move: null, up: null });

  // 组件卸载时安全清理未完成的拖拽监听，并派发 split-resize-end 恢复终端自适应
  useEffect(() => {
    return () => {
      const { move, up } = dragHandlersRef.current;
      if (move) window.removeEventListener("mousemove", move);
      if (up) window.removeEventListener("mouseup", up);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (move || up) {
        window.dispatchEvent(new Event("split-resize-end"));
      }
    };
  }, []);

  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    // 拖拽开始：通知终端实例抑制 ResizeObserver 的逐帧 fit。
    // 高频 term.resize 会让 WebGL 渲染器反复清屏（重绘赶不上清屏），
    // 表现为拖拽期间终端文字整体消失；松手后由 split-resize-end 统一对齐。
    window.dispatchEvent(new Event("split-resize-start"));

    // 用 rAF 节流 mousemove，避免高频 resizeSplit 触发整棵 layout 树重渲染
    const onMove = (ev: MouseEvent) => {
      if (rafRef.current !== null) return;
      const clientX = ev.clientX;
      const clientY = ev.clientY;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const ratio = isRow
          ? (clientX - rect.left) / rect.width
          : (clientY - rect.top) / rect.height;
        resizeSplit(node.id, ratio);
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      dragHandlersRef.current = { move: null, up: null };
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // 拖拽结束：通知所有终端实例重新 fit（拖拽过程中不逐帧 fit，避免 PTY resize 抖动）
      window.dispatchEvent(new Event("split-resize-end"));
    };

    dragHandlersRef.current = { move: onMove, up: onUp };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full w-full min-h-0 min-w-0 overflow-hidden",
        isRow ? "flex-row" : "flex-col",
      )}
    >
      <div
        key={`child0-${node.children[0].type === "group" ? node.children[0].groupId : node.children[0].id}`}
        style={{ flexBasis: `calc(${node.ratio * 100}% - 1.5px)` }}
        className="flex-shrink-0 flex-grow-0 min-h-0 min-w-0 overflow-hidden"
      >
        <LayoutNodeView node={node.children[0]} isDarkTheme={isDarkTheme} />
      </div>
      {/* 分隔条：极细 1px 微分界线，超大无感拖拽捕获热区 */}
      <div
        onMouseDown={handleDividerMouseDown}
        onDoubleClick={() => resizeSplit(node.id, 0.5)}
        title={t("split_reset_ratio")}
        className={cn(
          "group relative z-20 flex-shrink-0 flex items-center justify-center select-none bg-transparent transition-colors",
          isRow ? "w-[3px] cursor-col-resize" : "h-[3px] cursor-row-resize",
        )}
      >
        {/* 增大拖拽捕获热区：左右/上下各向外扩展 4px */}
        <div
          className={cn(
            "absolute z-10",
            isRow
              ? "inset-y-0 -left-1 -right-1 cursor-col-resize"
              : "inset-x-0 -top-1 -bottom-1 cursor-row-resize",
          )}
        />
        {/* 极细 1px 微分界线：清晰对比度（深色 24% 白 / 浅色 20% 黑），未选中窗口间分界清晰柔和而不刺眼 */}
        <div
          className={cn(
            "transition-colors duration-150",
            isDarkTheme
              ? "bg-white/[0.24] group-hover:bg-sky-400"
              : "bg-black/[0.20] group-hover:bg-sky-500",
            isRow
              ? "w-[1px] h-full"
              : "h-[1px] w-full",
          )}
        />
        {/* 悬停微胶囊把手：平时隐藏，鼠标悬停时柔和亮起，提供直观的拖拽操作反馈 */}
        <div
          className={cn(
            "absolute z-10 rounded-full transition-all duration-150 opacity-0 group-hover:opacity-100 pointer-events-none",
            isDarkTheme
              ? "bg-sky-400 shadow-[0_0_8px_#38bdf8]"
              : "bg-sky-500 shadow-[0_0_6px_#0284c7]",
            isRow ? "w-1 h-8" : "h-1 w-8",
          )}
        />
      </div>
      <div
        key={`child1-${node.children[1].type === "group" ? node.children[1].groupId : node.children[1].id}`}
        className="flex-1 min-h-0 min-w-0 overflow-hidden"
      >
        <LayoutNodeView node={node.children[1]} isDarkTheme={isDarkTheme} />
      </div>
    </div>
  );
}

// ── group 叶子：组内 Header + 活跃标签内容 + 落点预览 ──────────────────────

function TabGroupView({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const servers = useAppStore((s) => s.servers);
  const allTabs = useAppStore((s) => s.tabs);
  const group = useAppStore((s) => s.groups[groupId]);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const dropTarget = useAppStore((s) => s.splitDropTarget);
  const focusGroup = useAppStore((s) => s.focusGroup);

  const layout = useAppStore((s) => s.layout);
  const detachTabToTopLevel = useAppStore((s) => s.detachTabToTopLevel);
  const broadcastTabIds = useAppStore((s) => s.broadcastTabIds);
  const toggleBroadcastTab = useAppStore((s) => s.toggleBroadcastTab);
  const broadcastAllTabs = useAppStore((s) => s.broadcastAllTabs);
  const broadcastToSplit = useAppStore((s) => s.broadcastToSplit);
  const clearBroadcast = useAppStore((s) => s.clearBroadcast);
  const terminalThemeId = useAppStore((s) => s.terminalThemeId);
  const customTerminalThemes = useAppStore((s) => s.customTerminalThemes);
  const terminalThemeOverrides = useAppStore((s) => s.terminalThemeOverrides);

  const terminalTheme = useMemo(
    () =>
      getTerminalTheme(
        terminalThemeId,
        customTerminalThemes,
        terminalThemeOverrides,
      ),
    [terminalThemeId, customTerminalThemes, terminalThemeOverrides],
  );
  const isDarkTheme = terminalTheme.type !== "light";

  const workspaceGids = useMemo(
    () => new Set(collectGroupIds(layout)),
    [layout],
  );
  const isWorkspaceSplit = workspaceGids.size > 1;

  const tabs = useMemo(
    () => allTabs.filter((t) => t.groupId === groupId),
    [allTabs, groupId],
  );
  // 组内活跃 tab：优先分组记录，兜底组内第一个
  const groupActiveTabId = group?.activeTabId ?? tabs[0]?.id ?? null;
  const activeTab = useMemo(
    () => tabs.find((t) => t.id === groupActiveTabId) ?? tabs[0],
    [tabs, groupActiveTabId],
  );

  const lastActiveGroupId = useAppStore((s) => s.lastActiveGroupId);
  // 焦点分组 = 全局活跃 tab 所在分组 或 最近激活分组（视觉上沿高亮提示）
  const isFocusedGroup =
    (lastActiveGroupId !== null && lastActiveGroupId === groupId) ||
    (activeTabId !== null && tabs.some((t) => t.id === activeTabId));
  const showDropOverlay = dropTarget?.groupId === groupId;

  const containerRef = useRef<HTMLDivElement>(null);

  // 原生捕获监听：即使事件发生在 createPortal 内部的 xterm 终端区域，也能捕获并激活当前分组
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleNativeMouseDown = () => {
      focusGroup(groupId);
    };
    el.addEventListener("mousedown", handleNativeMouseDown, true);
    return () => {
      el.removeEventListener("mousedown", handleNativeMouseDown, true);
    };
  }, [groupId, focusGroup]);

  const isBroadcasting = activeTab ? broadcastTabIds.includes(activeTab.id) : false;
  // 分屏窗格顶部标题：自定义 tempTitle 优先；若同时有 IP，将 IP 独立为可一键复制的胶囊组件。
  // 关闭/迁移 tab 的瞬间 servers 可能还没同步，短暂查不到对应服务器，
  // 此时退化为仅显示名称，避免出现 "name undefined"。
  const paneHost = activeTab ? servers.find((s) => s.id === activeTab.serverId)?.host : undefined;
  const serverTitle = activeTab?.tempTitle || activeTab?.serverName || "";
  const isHostSameAsTitle = Boolean(paneHost && paneHost === serverTitle);

  const [copiedHost, setCopiedHost] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopyHost = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!paneHost) return;
      try {
        await navigator.clipboard.writeText(paneHost);
        setCopiedHost(true);
        if (copyTimeoutRef.current) {
          clearTimeout(copyTimeoutRef.current);
        }
        copyTimeoutRef.current = setTimeout(() => {
          setCopiedHost(false);
        }, 1500);
        playSound(SoundType.Click);
      } catch {
        // clipboard write fallback
      }
    },
    [paneHost],
  );

  useEffect(() => {
    setCopiedHost(false);
  }, [paneHost]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  if (tabs.length === 0 || !activeTab) return null;

  const activeColor = terminalTheme.ui.activeBorder || (isDarkTheme ? "#38bdf8" : "#0284c7");

  return (
    <div
      ref={containerRef}
      data-split-group
      data-split-group-id={groupId}
      className={cn(
        "relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden transition-[box-shadow] duration-150",
        isWorkspaceSplit ? "rounded-[6px]" : "bg-background",
      )}
      style={{
        backgroundColor: isWorkspaceSplit ? terminalTheme.ui.background : undefined,
        boxShadow:
          isWorkspaceSplit && isFocusedGroup
            ? `inset 0 0 0 1.5px ${activeColor}`
            : undefined,
      }}
      onMouseDownCapture={() => focusGroup(groupId)}
    >
      {/* 分屏窗格 Header（当处在 Workspace 分屏状态时显示）：背景与当前终端主题统一 */}
      {isWorkspaceSplit && (
        <div
          className={cn(
            "h-7 border-b px-3 flex items-center justify-between text-xs select-none cursor-grab active:cursor-grabbing transition-colors shrink-0",
            isDarkTheme ? "hover:bg-white/[0.04]" : "hover:bg-black/[0.03]",
          )}
          style={{
            backgroundColor: terminalTheme.ui.background,
            borderBottomColor: isDarkTheme
              ? "rgba(255, 255, 255, 0.12)"
              : "rgba(0, 0, 0, 0.10)",
          }}
          onMouseDown={(e) => {
            if (
              (e.target as HTMLElement).closest("button") ||
              (e.target as HTMLElement).closest("[data-no-drag]")
            ) {
              return;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            window.dispatchEvent(
              new CustomEvent("pane-drag-start", {
                detail: {
                  tabId: activeTab.id,
                  clientX: e.clientX,
                  clientY: e.clientY,
                  rect,
                },
              }),
            );
          }}
        >
          <div className="flex items-center gap-1.5 min-w-0 mr-2">
            {(() => {
              const srv = servers.find((s) => s.id === activeTab.serverId);
              const isBmc = srv?.targetType === "bmc";
              const isSerial =
                srv?.targetType === "serial" ||
                srv?.protocol === "serial" ||
                srv?.osType === "serial";
              const isNetwork =
                srv?.targetType === "network" || srv?.osType === "network";
              const PaneIcon = isSerial
                ? Cable
                : isBmc
                  ? Cpu
                  : isNetwork
                    ? Router
                    : Server;
              return (
                <PaneIcon
                  className="h-3.5 w-3.5 shrink-0"
                  style={{
                    color: terminalTheme.ui.foreground,
                    opacity: isFocusedGroup ? 0.9 : 0.6,
                  }}
                />
              );
            })()}
            {isHostSameAsTitle ? (
              <button
                type="button"
                data-no-drag
                onClick={handleCopyHost}
                onMouseDown={(e) => e.stopPropagation()}
                title={copiedHost ? t("status_ip_copied") : t("status_copy_ip")}
                aria-label={copiedHost ? t("status_ip_copied") : t("status_copy_ip")}
                className={cn(
                  "group/ip inline-flex items-center gap-1 max-w-[140px] px-1.5 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer select-text shrink-0",
                  isDarkTheme
                    ? "hover:bg-white/10 active:bg-white/15"
                    : "hover:bg-black/5 active:bg-black/10",
                  copiedHost && "text-emerald-500 font-medium",
                )}
                style={{
                  color: copiedHost
                    ? undefined
                    : terminalTheme.ui.foreground,
                  opacity: copiedHost ? 1 : isFocusedGroup ? 0.95 : 0.65,
                  backgroundColor: isDarkTheme
                    ? "rgba(255, 255, 255, 0.05)"
                    : "rgba(0, 0, 0, 0.04)",
                }}
              >
                <span className="truncate text-left font-medium">{paneHost}</span>
                {copiedHost ? (
                  <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                ) : (
                  <Copy className="h-2.5 w-2.5 shrink-0 opacity-40 group-hover/ip:opacity-100 transition-opacity" />
                )}
              </button>
            ) : (
              <div className="flex items-center gap-1 min-w-0">
                <span
                  className="text-xs truncate max-w-[120px] sm:max-w-[160px] shrink-0 font-medium"
                  style={{
                    color: terminalTheme.ui.foreground,
                    opacity: isFocusedGroup ? 1 : 0.65,
                  }}
                  title={serverTitle}
                >
                  {serverTitle}
                </span>
                {paneHost && (
                  <button
                    type="button"
                    data-no-drag
                    onClick={handleCopyHost}
                    onMouseDown={(e) => e.stopPropagation()}
                    title={copiedHost ? t("status_ip_copied") : t("status_copy_ip")}
                    aria-label={copiedHost ? t("status_ip_copied") : t("status_copy_ip")}
                    className={cn(
                      "group/ip inline-flex items-center gap-1 max-w-[130px] px-1.5 py-0.5 rounded text-[11px] font-mono transition-colors cursor-pointer select-text shrink-0",
                      isDarkTheme
                        ? "hover:bg-white/10 active:bg-white/15"
                        : "hover:bg-black/5 active:bg-black/10",
                      copiedHost && "text-emerald-500 font-medium",
                    )}
                    style={{
                      color: copiedHost ? undefined : terminalTheme.ui.foreground,
                      opacity: copiedHost ? 1 : isFocusedGroup ? 0.9 : 0.65,
                      backgroundColor: isDarkTheme
                        ? "rgba(255, 255, 255, 0.05)"
                        : "rgba(0, 0, 0, 0.04)",
                    }}
                  >
                    <span className="truncate text-left">{paneHost}</span>
                    {copiedHost ? (
                      <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                    ) : (
                      <Copy className="h-2.5 w-2.5 shrink-0 opacity-40 group-hover/ip:opacity-100 transition-opacity" />
                    )}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* 广播按钮：开启后键盘输入同步到所有开启广播的终端 */}
            <div className="flex items-center">
              <button
                className={cn(
                  "h-5 px-1.5 rounded-l text-[10px] flex items-center gap-1 transition-colors",
                  isBroadcasting
                    ? "bg-primary/20 text-primary font-medium"
                    : isDarkTheme
                      ? "hover:bg-white/10"
                      : "hover:bg-black/5",
                )}
                style={{
                  color: isBroadcasting
                    ? undefined
                    : terminalTheme.ui.foreground,
                  opacity: isBroadcasting ? 1 : 0.75,
                }}
                onClick={() => toggleBroadcastTab(activeTab.id)}
                title={
                  isBroadcasting
                    ? t("broadcast_split_enabled")
                    : t("broadcast_split_disabled")
                }
              >
                <Radio className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{t("broadcast_label")}</span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      "h-5 px-0.5 rounded-r text-[10px] flex items-center transition-colors",
                      isBroadcasting
                        ? "bg-primary/20 text-primary"
                        : isDarkTheme
                          ? "hover:bg-white/10"
                          : "hover:bg-black/5",
                    )}
                    style={{
                      color: isBroadcasting
                        ? undefined
                        : terminalTheme.ui.foreground,
                      opacity: isBroadcasting ? 1 : 0.75,
                    }}
                    title={t("broadcast_more")}
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 p-1">
                  <DropdownMenuItem
                    onClick={() => broadcastToSplit(activeTab.id)}
                    className="text-xs cursor-pointer"
                  >
                    {t("broadcast_select_split")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={broadcastAllTabs}
                    className="text-xs cursor-pointer"
                  >
                    {t("broadcast_select_all")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={clearBroadcast}
                    className="text-xs cursor-pointer"
                  >
                    {t("broadcast_clear_all")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* 将当前窗格恢复为顶部独立工作台 */}
            <button
              className={cn(
                "p-1 rounded transition-colors",
                isDarkTheme ? "hover:bg-white/10" : "hover:bg-black/5",
              )}
              style={{
                color: terminalTheme.ui.foreground,
                opacity: 0.75,
              }}
              onClick={() => detachTabToTopLevel(activeTab.id)}
              title={t("split_restore_workspace")}
              aria-label={t("split_restore_workspace")}
            >
              <PanelTopOpen className="h-3 w-3" />
            </button>

            {/* 关闭按钮 */}
            <button
              className={cn(
                "p-1 rounded hover:bg-destructive/20 hover:text-destructive transition-colors",
                isDarkTheme ? "hover:bg-white/10" : "hover:bg-black/5",
              )}
              style={{
                color: terminalTheme.ui.foreground,
                opacity: 0.75,
              }}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("qshell:request-close-tab", {
                    detail: activeTab.id,
                  }),
                )
              }
              title={t("tb_close")}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* 组内标签内容 Slot 容器（由 PersistentTabSlot 持久化挂载 Terminal 内容，防止 Unmount 黑屏） */}
      <div
        id={`pane-slot-${groupId}`}
        data-group-slot={groupId}
        className="flex-1 overflow-hidden relative min-h-0"
      />

      {/* 拖拽分屏落点预览 */}
      {showDropOverlay && <DropZoneOverlay zone={dropTarget.zone} />}

      {/* 分屏状态下活跃窗格边缘指示线条（位于顶层，pointer-events-none 穿透鼠标，杜绝终端画布遮盖边缘线条） */}
      {isWorkspaceSplit && isFocusedGroup && (
        <div
          className="pointer-events-none absolute inset-0 z-30 rounded-[6px] transition-all duration-150"
          style={{
            boxShadow: `inset 0 0 0 1.5px ${activeColor}`,
          }}
        />
      )}
    </div>
  );
}

/** 按 tab 类型渲染对应内容（与原 App.tsx 渲染逻辑一致） */
function TabContent({
  tab,
  isActive,
  isVisible,
  isSplitPane,
}: {
  tab: WorkspaceTab;
  isActive: boolean;
  isVisible: boolean;
  isSplitPane: boolean;
}) {
  if (tab.serverId === "sftp") {
    return <SftpPanel />;
  }
  return (
    <WorkspacePage
      isActive={isActive}
      isVisible={isVisible}
      tabId={tab.id}
      isSplitPane={isSplitPane}
    />
  );
}

// ── 落点预览遮罩 ──────────────────────────────────────────────────────────

function DropZoneOverlay({ zone }: { zone: DropZone }) {
  return (
    <div className="absolute inset-0 z-40 pointer-events-none">
      <div
        className={cn(
          "absolute bg-primary/20 border-2 border-primary/80 rounded-[8px] transition-all duration-75",
          zone === "left" && "inset-y-0 left-0 w-1/2",
          zone === "right" && "inset-y-0 right-0 w-1/2",
          zone === "top" && "inset-x-0 top-0 h-1/2",
          zone === "bottom" && "inset-x-0 bottom-0 h-1/2",
          zone === "center" && "inset-0",
        )}
      />
    </div>
  );
}
