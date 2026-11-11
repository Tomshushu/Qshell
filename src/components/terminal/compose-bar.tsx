import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Send,
  ChevronUp,
  ChevronDown,
  Maximize2,
  Minimize2,
  RotateCcw,
  RotateCw,
  Clock,
  Settings2,
  AlertTriangle,
  BookmarkPlus,
  X,
  Check,
  Terminal as TerminalIcon,
  Layers,
  Globe,
  Trash2,
  PenSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";
import type { ComposeTarget, ComposeSendMode } from "@/store/types";
import { sshService } from "@/services/ssh-service";
import { evaluateCommandRisk } from "@/services/ai/risk-evaluator";
import { playSound, SoundType } from "@/lib/sound";
import { useToast } from "@/components/ui/toast";
import { QuickCommandDialog } from "./quick-command-dialog";
import type { FavoriteCommand } from "@/services/api/types";
import { collectGroupIds } from "@/utils/split-layout";

interface TargetInfo {
  tabId: string;
  sessionId: string;
  serverName: string;
  host: string;
}

export interface ComposeBarProps {
  className?: string;
  onFocusTerminal?: () => void;
  activeTermId?: string | null;
  activeSessionId?: string | null;
  tabId?: string | null;
  isDarkTerminal?: boolean;
}

const MIN_COMPOSE_HEIGHT = 100;
const MAX_COMPOSE_HEIGHT = 500;

export function ComposeBar({
  className,
  activeTermId,
  activeSessionId,
  tabId,
  onFocusTerminal,
  isDarkTerminal = true,
}: ComposeBarProps = {}) {
  const { t } = useTranslation();
  const { toast } = useToast();

  // Store state
  const visible = useAppStore((s) => s.terminalComposeBarVisible);
  const setVisible = useAppStore((s) => s.setTerminalComposeBarVisible);
  const expanded = useAppStore((s) => s.terminalComposeBarExpanded);
  const setExpanded = useAppStore((s) => s.setTerminalComposeBarExpanded);
  const height = useAppStore((s) => s.terminalComposeBarHeight);
  const setHeight = useAppStore((s) => s.setTerminalComposeBarHeight);
  const target = useAppStore((s) => s.terminalComposeTarget);
  const setTarget = useAppStore((s) => s.setTerminalComposeTarget);
  const sendMode = useAppStore((s) => s.terminalComposeSendMode);
  const setSendMode = useAppStore((s) => s.setTerminalComposeSendMode);
  const lineByLine = useAppStore((s) => s.terminalComposeLineByLine);
  const setLineByLine = useAppStore((s) => s.setTerminalComposeLineByLine);
  const convertEscapes = useAppStore((s) => s.terminalComposeConvertEscapes);
  const setConvertEscapes = useAppStore((s) => s.setTerminalComposeConvertEscapes);
  const history = useAppStore((s) => s.terminalComposeHistory);
  const addHistory = useAppStore((s) => s.addTerminalComposeHistory);
  const clearHistory = useAppStore((s) => s.clearTerminalComposeHistory);

  // Local text input and undo/redo stacks
  const [text, setText] = useState("");
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [bracketedPaste, setBracketedPaste] = useState(false);

  // Danger confirm modal state
  const [dangerModalOpen, setDangerModalOpen] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [pendingTargets, setPendingTargets] = useState<TargetInfo[]>([]);

  // Quick Command save modal
  const [saveFavOpen, setSaveFavOpen] = useState(false);
  const [favToCreate, setFavToCreate] = useState<FavoriteCommand | null>(null);

  // History popover / dropdown state
  const [historyOpen, setHistoryOpen] = useState(false);

  const [isResizing, setIsResizing] = useState(false);
  const resizeStartY = useRef(0);
  const resizeStartHeight = useRef(height);

  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const tabs = useAppStore((s) => s.tabs);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const workspaces = useAppStore((s) => s.workspaces);
  const layout = useAppStore((s) => s.layout);

  // Focus input helper across microtask, RAF, and timeouts
  const focusInput = useCallback(() => {
    const doFocus = () => {
      if (expanded) {
        textareaRef.current?.focus();
      } else {
        inputRef.current?.focus();
      }
    };
    doFocus();
    requestAnimationFrame(doFocus);
    setTimeout(doFocus, 30);
    setTimeout(doFocus, 80);
  }, [expanded]);

  // Return focus to active terminal (calls custom onFocusTerminal or global event)
  const returnFocus = useCallback(() => {
    if (onFocusTerminal) {
      onFocusTerminal();
    } else {
      window.dispatchEvent(new CustomEvent("focus-active-terminal"));
    }
  }, [onFocusTerminal]);

  // Listen for focus-compose-bar custom event to restore focus from terminal
  useEffect(() => {
    const handleFocusEvent = () => {
      focusInput();
    };
    window.addEventListener("qshell:focus-compose-bar", handleFocusEvent);
    return () => {
      window.removeEventListener("qshell:focus-compose-bar", handleFocusEvent);
    };
  }, [focusInput]);

  // Global toggle listener: self-contained toggle & focus management
  useEffect(() => {
    const handleToggle = () => {
      const isVisible = useAppStore.getState().terminalComposeBarVisible;
      const activeEl = document.activeElement;
      const isInside = Boolean(
        activeEl?.closest?.(".terminal-compose-bar, [data-terminal-compose-bar]")
      );

      // 如果已打开但焦点不在撰写框内，将光标切回聚焦撰写框
      if (isVisible && !isInside) {
        focusInput();
        return;
      }

      // 如果未打开，则打开并聚焦
      if (!isVisible) {
        setVisible(true);
        focusInput();
      } else {
        // 如果已打开且焦点在撰写框内，则关闭并归还终端焦点
        setVisible(false);
        returnFocus();
      }
    };

    window.addEventListener("qshell:toggle-compose-bar", handleToggle);
    return () => {
      window.removeEventListener("qshell:toggle-compose-bar", handleToggle);
    };
  }, [focusInput, setVisible, returnFocus]);

  // Focus input when visible toggles to true
  useEffect(() => {
    if (visible) {
      focusInput();
    }
  }, [visible, focusInput]);

  // Click on background of compose bar automatically brings focus to input
  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('button, [role="button"], [role="menuitem"], a, select, textarea, input')) {
        return;
      }
      focusInput();
    },
    [focusInput]
  );

  // Update text with undo tracking
  const handleTextChange = useCallback(
    (newVal: string) => {
      setUndoStack((prev) => [text, ...prev].slice(0, 30));
      setRedoStack([]);
      setText(newVal);
      setHistoryIndex(-1);
    },
    [text]
  );

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const [previous, ...rest] = undoStack;
    setRedoStack((prev) => [text, ...prev]);
    setUndoStack(rest);
    setText(previous);
  }, [undoStack, text]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const [next, ...rest] = redoStack;
    setUndoStack((prev) => [text, ...prev]);
    setRedoStack(rest);
    setText(next);
  }, [redoStack, text]);

  // Check if current workspace has split screen (more than 1 group/pane)
  const isSplitWorkspace = useMemo(() => {
    if (collectGroupIds(layout).length > 1) return true;
    const effectiveTabId = tabId || activeTabId;
    const curTab = tabs.find((t) => t.id === effectiveTabId);
    if (!curTab?.workspaceId) return false;
    const ws = workspaces[curTab.workspaceId];
    if (!ws) return false;
    return collectGroupIds(ws.layout).length > 1;
  }, [tabId, activeTabId, tabs, workspaces, layout]);

  // 当前分屏工作区内的有效终端数
  const splitTerminalCount = useMemo(() => {
    if (!isSplitWorkspace) return 1;
    const effectiveTabId = tabId || activeTabId;
    const curTab = tabs.find((t) => t.id === effectiveTabId);
    const wsId = curTab?.workspaceId;
    if (wsId && workspaces[wsId]?.layout) {
      const gids = collectGroupIds(workspaces[wsId].layout);
      const wsTabs = tabs.filter((t) => t.workspaceId === wsId && t.module === "terminal");
      return Math.max(gids.length, wsTabs.length);
    }
    const globalGids = collectGroupIds(layout);
    const allTerminalTabs = tabs.filter((t) => t.module === "terminal");
    return Math.max(globalGids.length, allTerminalTabs.length);
  }, [isSplitWorkspace, tabId, activeTabId, tabs, workspaces, layout]);

  // 是否可广播到分屏（必须在分屏模式且分屏终端数 >= 2）
  const canBroadcastToSplit = isSplitWorkspace && splitTerminalCount > 1;

  // 全局全部终端会话数
  const totalTerminalSessionsCount = useMemo(() => {
    return tabs.filter((t) => t.module === "terminal").length;
  }, [tabs]);

  // 是否可广播到全部会话（全局终端数 >= 2）
  const canBroadcastToAll = totalTerminalSessionsCount > 1;

  // 目标状态自愈：当分屏解除或终端减少时，自动将不可用的广播模式退回 active
  useEffect(() => {
    if (target === "split" && !canBroadcastToSplit) {
      setTarget("active");
    } else if (target === "all" && !canBroadcastToAll) {
      setTarget("active");
    }
  }, [target, canBroadcastToSplit, canBroadcastToAll, setTarget]);

  // Compute resolved target sessions
  const getResolvedTargets = useCallback((): TargetInfo[] => {
    const { tabs, servers, activeTabId } = useAppStore.getState();
    const effectiveTabId = tabId || activeTabId;
    const currentTab = tabs.find((t) => t.id === effectiveTabId);
    const currentServer = currentTab ? servers.find((s) => s.id === currentTab.serverId) : undefined;
    const serverName = currentServer?.name || currentTab?.serverName || "Local";
    const host = currentServer?.host || "127.0.0.1";

    if (target === "active") {
      const effSessionId = activeSessionId || (currentTab ? sshService.getTabActiveSessionId(currentTab.id) : undefined);
      if (effSessionId && sshService.isSessionAlive(effSessionId)) {
        return [
          {
            tabId: effectiveTabId || "",
            sessionId: effSessionId,
            serverName,
            host,
          },
        ];
      }
      return [];
    }

    if (target === "split") {
      const results: TargetInfo[] = [];
      const currentWsId = currentTab?.workspaceId;
      // 找出当前工作区（当前分屏窗体）下的所有终端会话
      const splitTabs = tabs.filter(
        (t) => (!currentWsId || t.workspaceId === currentWsId) && t.module === "terminal"
      );
      for (const t of splitTabs) {
        const sid = sshService.getTabActiveSessionId(t.id);
        if (sid && sshService.isSessionAlive(sid)) {
          const sv = servers.find((s) => s.id === t.serverId);
          results.push({
            tabId: t.id,
            sessionId: sid,
            serverName: sv?.name || t.serverName || "Terminal",
            host: sv?.host || "—",
          });
        }
      }
      return results;
    }

    if (target === "all") {
      const results: TargetInfo[] = [];
      for (const t of tabs) {
        if (t.module !== "terminal") continue;
        const sid = sshService.getTabActiveSessionId(t.id);
        if (sid && sshService.isSessionAlive(sid)) {
          const sv = servers.find((s) => s.id === t.serverId);
          results.push({
            tabId: t.id,
            sessionId: sid,
            serverName: sv?.name || t.serverName || "Terminal",
            host: sv?.host || "—",
          });
        }
      }
      return results;
    }

    return [];
  }, [target, activeSessionId, tabId]);

  const resolvedTargets = useMemo(() => getResolvedTargets(), [getResolvedTargets]);

  // Format command (escape replacement, bracketed paste)
  const formatCommand = useCallback(
    (raw: string) => {
      let result = raw;
      if (convertEscapes) {
        result = result
          .replace(/\\n/g, "\n")
          .replace(/\\t/g, "\t")
          .replace(/\\r/g, "\r");
      }
      return result;
    },
    [convertEscapes]
  );

  // Core execution dispatch engine
  const executeDispatch = useCallback(
    async (cmd: string, targets: TargetInfo[]) => {
      if (!cmd.trim() || targets.length === 0) return;

      const formatted = formatCommand(cmd);
      addHistory(cmd);
      playSound(SoundType.Click);

      const isMultiLine = formatted.includes("\n");

      for (const t of targets) {
        try {
          if (lineByLine && isMultiLine) {
            // 逐行延时发送
            const lines = formatted.split(/\r?\n/);
            for (const line of lines) {
              await sshService.writeToShell(t.sessionId, line + "\r");
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          } else if (bracketedPaste) {
            // 括号粘贴模式
            await sshService.writeToShell(
              t.sessionId,
              `\x1b[200~${formatted}\x1b[201~\r`
            );
          } else {
            // 标准发送
            const payload = formatted.endsWith("\r") || formatted.endsWith("\n")
              ? formatted
              : formatted + "\r";
            await sshService.writeToShell(t.sessionId, payload);
          }
        } catch (err) {
          console.error(`[ComposeBar] Failed to send to ${t.serverName} (${t.sessionId}):`, err);
        }
      }

      if (!expanded) {
        setText("");
      }
      returnFocus();
    },
    [formatCommand, addHistory, lineByLine, bracketedPaste, expanded, returnFocus]
  );

  // Trigger dispatch with pre-flight risk checks
  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const targets = getResolvedTargets();
    if (targets.length === 0) {
      toast.warning(t("compose_target_active") + ": 没有可用的活跃终端会话");
      return;
    }

    const risk = evaluateCommandRisk(trimmed);

    // 硬阻断（rm -rf / 等）
    if (risk.isBlocked) {
      toast.error(risk.reasons[0] || "检测到危险指令，已被安全护栏硬阻断！");
      return;
    }

    // 多机广播风险或高危指令：弹出二次确认
    const isMultiTarget = targets.length > 1;
    const isDangerous = risk.level === "dangerous";

    if (isDangerous || (isMultiTarget && risk.level === "notice")) {
      setPendingCommand(trimmed);
      setPendingTargets(targets);
      setDangerModalOpen(true);
      return;
    }

    void executeDispatch(trimmed, targets);
  }, [text, getResolvedTargets, executeDispatch, t]);

  // Single-line input key handler
  const handleSingleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (e.shiftKey) {
        e.preventDefault();
        setExpanded(true);
        setText((prev) => prev + "\n");
        return;
      }
      if (sendMode === "enter") {
        e.preventDefault();
        handleSend();
      }
    } else if (e.key === "ArrowUp") {
      if (history.length === 0) return;
      e.preventDefault();
      const nextIdx = Math.min(history.length - 1, historyIndex + 1);
      setHistoryIndex(nextIdx);
      setText(history[nextIdx] || "");
    } else if (e.key === "ArrowDown") {
      if (history.length === 0) return;
      e.preventDefault();
      const nextIdx = Math.max(-1, historyIndex - 1);
      setHistoryIndex(nextIdx);
      setText(nextIdx === -1 ? "" : history[nextIdx] || "");
    } else if (e.key === "Escape") {
      e.preventDefault();
      setVisible(false);
      returnFocus();
    }
  };

  // Multiline textarea key handler
  const handleMultiKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (sendMode === "enter" && e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      handleSend();
    } else if (
      (sendMode === "ctrl_enter" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) ||
      (e.key === "Enter" && (e.ctrlKey || e.metaKey))
    ) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setVisible(false);
      returnFocus();
    }
  };

  // Drag handle for resizing multiline pane
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartY.current = e.clientY;
    resizeStartHeight.current = height;

    const onMouseMove = (ev: MouseEvent) => {
      const deltaY = resizeStartY.current - ev.clientY;
      const newHeight = Math.max(
        MIN_COMPOSE_HEIGHT,
        Math.min(MAX_COMPOSE_HEIGHT, resizeStartHeight.current + deltaY)
      );
      setHeight(newHeight);
    };

    const onMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      // Trigger resize for terminal canvas
      window.dispatchEvent(new Event("resize"));
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Save current text to quick command
  const handleSaveToQuickCommand = () => {
    if (!text.trim()) return;
    setFavToCreate({
      id: "",
      cmd: text,
      desc: text.split("\n")[0].slice(0, 50),
      createdAt: Date.now(),
      autoExecute: true,
      color: "emerald",
      pinnedToBar: true,
    });
    setSaveFavOpen(true);
  };

  const hasActiveTab = Boolean(activeTabId && tabs.length > 0);
  const currentTab = tabs.find((t) => t.id === (tabId || activeTabId));
  const isTerminalSession = currentTab?.module === "terminal" && currentTab?.serverId !== "sftp";

  if (!visible) return null;
  // 全局解耦挂载时（未指定 tabId 绑定），仅在当前处于终端会话时渲染
  if (!tabId && (!hasActiveTab || !isTerminalSession)) return null;

  const isBroadcast = target !== "active" && resolvedTargets.length > 1;

  return (
    <>
      <div
        className={cn(
          "terminal-compose-bar w-full shrink-0 flex flex-col transition-all duration-150 border-t z-20",
          isBroadcast
            ? "border-amber-500/50 bg-amber-500/[0.04] dark:bg-amber-950/20"
            : "border-border/60 bg-background/95 dark:bg-zinc-900/90",
          "backdrop-blur-md shadow-md",
          className
        )}
        data-terminal-compose-bar="true"
        onClick={handleContainerClick}
        style={{
          height: expanded ? `${height}px` : undefined,
        }}
      >
        {/* Multiline Resize Bar (Top Handle) */}
        {expanded && (
          <div
            onMouseDown={handleResizeStart}
            onDoubleClick={() => setHeight(160)}
            className="flex h-1.5 w-full cursor-ns-resize items-center justify-center hover:bg-primary/20 transition-colors"
            title="上下拖动调节撰写窗口高度 (双击恢复默认高度)"
          >
            <div className="h-1 w-12 rounded-full bg-border/80 hover:bg-primary" />
          </div>
        )}

        {/* Multiline Header Bar (对标 Xshell 8 撰写窗口顶部标题栏与窗口控制) */}
        {expanded && (
          <div className="flex items-center justify-between px-2.5 py-1 bg-muted/40 border-b border-border/40 select-none text-xs shrink-0">
            <div className="flex items-center gap-1.5 text-foreground/85 font-medium">
              <PenSquare className="h-3.5 w-3.5 text-sky-500 shrink-0" />
              <span className="text-[11.5px] font-sans font-semibold tracking-tight">
                {target === "active"
                  ? "撰写: 仅将文本发送到当前会话"
                  : target === "split"
                  ? `撰写: 发送到当前可见窗口 (${resolvedTargets.length}台)`
                  : `撰写: 发送到全部已连接会话 (${resolvedTargets.length}台)`}
              </span>
            </div>

            {/* 右上角窗口控制按钮群 (对标 Xshell 8 标题栏右上角按钮) */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                title={t("compose_btn_collapse") || "收起为单行撰写栏"}
              >
                <Minimize2 className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setHeight(height > 250 ? 160 : 340)}
                className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                title="切换窗口高度 (160px / 340px)"
              >
                <Maximize2 className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setVisible(false);
                  returnFocus();
                }}
                className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                title="关闭撰写窗口 (Esc)"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* 主编辑与交互区域 */}
        {expanded ? (
          /* =====================================================================
           * 模式 2：多行撰写窗口 (Compose Window) —— 对标 Xshell 撰写窗格
           * ===================================================================== */
          <div className="flex flex-1 min-h-0 flex-row">
            {/* 左侧垂直工具栏 (Vertical Tool Gutter) */}
            <div className="flex flex-col items-center justify-between py-1.5 px-1 border-r border-border/40 bg-muted/20 w-8 shrink-0">
              <div className="flex flex-col items-center gap-1">
                {/* 目标选择器按钮 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "h-6 w-6 flex items-center justify-center rounded transition-colors cursor-pointer",
                        isBroadcast
                          ? "text-amber-500 bg-amber-500/10 hover:bg-amber-500/20"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                      title={`分发目标: ${
                        target === "active"
                          ? t("compose_target_active")
                          : target === "split"
                          ? t("compose_target_split")
                          : t("compose_target_all")
                      }`}
                    >
                      {target === "active" ? (
                        <TerminalIcon className="h-3.5 w-3.5" />
                      ) : target === "split" ? (
                        <Layers className="h-3.5 w-3.5 text-amber-500" />
                      ) : (
                        <Globe className="h-3.5 w-3.5 text-rose-500" />
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56 text-xs">
                    <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground">
                      发送目标会话
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={() => setTarget("active")}
                      className="justify-between cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <TerminalIcon className="h-3.5 w-3.5 text-primary" />
                        <span>{t("compose_target_active")}</span>
                      </div>
                      {target === "active" && <Check className="h-3.5 w-3.5 text-primary" />}
                    </DropdownMenuItem>
                    {canBroadcastToSplit && (
                      <DropdownMenuItem
                        onClick={() => setTarget("split")}
                        className="justify-between cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <Layers className="h-3.5 w-3.5 text-amber-500" />
                          <span>{t("compose_target_split")}</span>
                        </div>
                        {target === "split" && <Check className="h-3.5 w-3.5 text-primary" />}
                      </DropdownMenuItem>
                    )}
                    {canBroadcastToAll && (
                      <DropdownMenuItem
                        onClick={() => setTarget("all")}
                        className="justify-between cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <Globe className="h-3.5 w-3.5 text-rose-500" />
                          <span>{t("compose_target_all")}</span>
                        </div>
                        {target === "all" && <Check className="h-3.5 w-3.5 text-primary" />}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* 撤销 (Undo) */}
                <button
                  type="button"
                  disabled={undoStack.length === 0}
                  onClick={handleUndo}
                  className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors cursor-pointer"
                  title="撤销 (Ctrl+Z)"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>

                {/* 重做 (Redo) */}
                <button
                  type="button"
                  disabled={redoStack.length === 0}
                  onClick={handleRedo}
                  className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors cursor-pointer"
                  title="重做 (Ctrl+Y)"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                </button>

                {/* 历史记录下拉 */}
                <DropdownMenu open={historyOpen} onOpenChange={setHistoryOpen}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                      title={t("compose_history_title")}
                    >
                      <Clock className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-80 max-h-64 overflow-y-auto text-xs">
                    <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/40">
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        {t("compose_history_title")}
                      </span>
                      {history.length > 0 && (
                        <button
                          type="button"
                          onClick={clearHistory}
                          className="flex items-center gap-1 text-[10px] text-destructive hover:underline cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>{t("compose_history_clear")}</span>
                        </button>
                      )}
                    </div>
                    {history.length === 0 ? (
                      <div className="p-3 text-center text-muted-foreground/60 text-xs">
                        {t("compose_history_empty")}
                      </div>
                    ) : (
                      history.map((h, i) => (
                        <DropdownMenuItem
                          key={i}
                          onClick={() => {
                            setText(h);
                            setHistoryOpen(false);
                          }}
                          className="cursor-pointer font-mono text-[11px] truncate py-1.5"
                          title={h}
                        >
                          <span className="truncate">{h}</span>
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* 存为快捷命令 */}
                <button
                  type="button"
                  disabled={!text.trim()}
                  onClick={handleSaveToQuickCommand}
                  className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-amber-500 hover:bg-muted disabled:opacity-30 transition-colors cursor-pointer"
                  title={t("compose_save_as_fav")}
                >
                  <BookmarkPlus className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* 底部收起按钮 */}
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                title={t("compose_btn_collapse")}
              >
                <Minimize2 className="h-3 w-3" />
              </button>
            </div>

            {/* 中间多行文本域 */}
            <div className="flex-1 flex flex-col min-w-0 p-1.5">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => handleTextChange(e.target.value)}
                onKeyDown={handleMultiKeyDown}
                placeholder={t("compose_bar_placeholder_multi")}
                className="flex-1 w-full resize-none rounded-md bg-transparent p-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
              />

              {/* 多行窗格底栏信息与执行按钮 */}
              <div className="flex items-center justify-between pt-1 border-t border-border/30 px-1 text-[11px]">
                <div className="flex items-center gap-3 text-muted-foreground">
                  {/* 对标 Xshell 的底部一键多机/分屏广播勾选框 */}
                  {canBroadcastToSplit ? (
                    <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-foreground/80 hover:text-foreground select-none">
                      <input
                        type="checkbox"
                        checked={target === "split"}
                        onChange={(e) => setTarget(e.target.checked ? "split" : "active")}
                        className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-0 cursor-pointer"
                      />
                      <span>发送文本到当前可见窗口</span>
                    </label>
                  ) : canBroadcastToAll ? (
                    <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-foreground/80 hover:text-foreground select-none">
                      <input
                        type="checkbox"
                        checked={target === "all"}
                        onChange={(e) => setTarget(e.target.checked ? "all" : "active")}
                        className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-0 cursor-pointer"
                      />
                      <span>广播到全部已连接会话</span>
                    </label>
                  ) : null}

                  {/* 目标提示胶囊 */}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono",
                      isBroadcast
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {isBroadcast && <AlertTriangle className="h-3 w-3 shrink-0" />}
                    <span>
                      {target === "active"
                        ? "当前会话"
                        : target === "split"
                        ? `当前可见窗口 (${resolvedTargets.length}台)`
                        : `全部会话 (${resolvedTargets.length}台)`}
                    </span>
                  </span>

                  <span className="hidden lg:inline-block text-muted-foreground/60 text-[10px]">
                    {sendMode === "enter"
                      ? "Enter 发送 · Shift+Enter 换行"
                      : "Ctrl+Enter 发送 · Enter 换行"}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {/* 选项菜单 */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1"
                        title="分发设置"
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                        <span className="text-[11px]">设置</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 text-xs">
                      <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground">
                        发送策略
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        onClick={() => setSendMode("enter")}
                        className="justify-between cursor-pointer"
                      >
                        <span>{t("compose_send_enter")}</span>
                        {sendMode === "enter" && <Check className="h-3.5 w-3.5 text-primary" />}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setSendMode("ctrl_enter")}
                        className="justify-between cursor-pointer"
                      >
                        <span>{t("compose_send_ctrl_enter")}</span>
                        {sendMode === "ctrl_enter" && <Check className="h-3.5 w-3.5 text-primary" />}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setLineByLine(!lineByLine)}
                        className="justify-between cursor-pointer"
                      >
                        <span>{t("compose_line_by_line")}</span>
                        {lineByLine && <Check className="h-3.5 w-3.5 text-primary" />}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setConvertEscapes(!convertEscapes)}
                        className="justify-between cursor-pointer"
                      >
                        <span>{t("compose_convert_escapes")}</span>
                        {convertEscapes && <Check className="h-3.5 w-3.5 text-primary" />}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setBracketedPaste(!bracketedPaste)}
                        className="justify-between cursor-pointer"
                      >
                        <span>{t("compose_bracketed_paste")}</span>
                        {bracketedPaste && <Check className="h-3.5 w-3.5 text-primary" />}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* 清空按钮 */}
                  {text && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                      onClick={() => setText("")}
                    >
                      清空
                    </Button>
                  )}

                  {/* 发送按钮 */}
                  <Button
                    size="sm"
                    disabled={!text.trim() || resolvedTargets.length === 0}
                    onClick={handleSend}
                    className={cn(
                      "h-6 px-3 text-xs gap-1.5 font-medium cursor-pointer shadow-xs",
                      isBroadcast
                        ? "bg-amber-600 hover:bg-amber-500 text-white"
                        : "bg-primary hover:bg-primary/90 text-primary-foreground"
                    )}
                  >
                    <Send className="h-3 w-3" />
                    <span>{t("compose_btn_send")}</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* =====================================================================
           * 模式 1：单行紧凑撰写栏 (Compose Bar) —— 默认 34px 高度
           * ===================================================================== */
          <div className="flex items-center gap-1.5 px-2 py-1 h-[34px]">
            {/* 目标下拉按钮 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1 h-6 px-1.5 rounded-md text-[11px] font-medium border transition-colors cursor-pointer shrink-0",
                    isBroadcast
                      ? "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25"
                      : "border-border/60 bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  title="切换分发目标"
                >
                  {target === "active" ? (
                    <TerminalIcon className="h-3 w-3 text-primary" />
                  ) : target === "split" ? (
                    <Layers className="h-3 w-3 text-amber-500" />
                  ) : (
                    <Globe className="h-3 w-3 text-rose-500" />
                  )}
                  <span className="hidden sm:inline-block max-w-[90px] truncate">
                    {target === "active"
                      ? "当前会话"
                      : target === "split"
                      ? `可见窗口(${resolvedTargets.length})`
                      : `全会话(${resolvedTargets.length})`}
                  </span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 text-xs">
                <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground">
                  发送目标会话
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => setTarget("active")}
                  className="justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <TerminalIcon className="h-3.5 w-3.5 text-primary" />
                    <span>{t("compose_target_active")}</span>
                  </div>
                  {target === "active" && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
                {canBroadcastToSplit && (
                  <DropdownMenuItem
                    onClick={() => setTarget("split")}
                    className="justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Layers className="h-3.5 w-3.5 text-amber-500" />
                      <span>{t("compose_target_split")}</span>
                    </div>
                    {target === "split" && <Check className="h-3.5 w-3.5 text-primary" />}
                  </DropdownMenuItem>
                )}
                {canBroadcastToAll && (
                  <DropdownMenuItem
                    onClick={() => setTarget("all")}
                    className="justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5 text-rose-500" />
                      <span>{t("compose_target_all")}</span>
                    </div>
                    {target === "all" && <Check className="h-3.5 w-3.5 text-primary" />}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* 单行文本输入 */}
            <div className="relative flex-1 flex items-center min-w-0">
              <input
                ref={inputRef}
                type="text"
                value={text}
                onChange={(e) => handleTextChange(e.target.value)}
                onKeyDown={handleSingleKeyDown}
                placeholder={t("compose_bar_placeholder_single")}
                className="w-full h-6 px-2 text-xs font-mono bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
              />
            </div>

            {/* 右侧操作按钮群 */}
            <div className="flex items-center gap-1 shrink-0">
              {/* 展开为多行撰写窗口按钮 */}
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                title={t("compose_btn_expand")}
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>

              {/* 设置菜单 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                    title="设置"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 text-xs">
                  <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground">
                    发送策略
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => setSendMode("enter")}
                    className="justify-between cursor-pointer"
                  >
                    <span>{t("compose_send_enter")}</span>
                    {sendMode === "enter" && <Check className="h-3.5 w-3.5 text-primary" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setSendMode("ctrl_enter")}
                    className="justify-between cursor-pointer"
                  >
                    <span>{t("compose_send_ctrl_enter")}</span>
                    {sendMode === "ctrl_enter" && <Check className="h-3.5 w-3.5 text-primary" />}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setLineByLine(!lineByLine)}
                    className="justify-between cursor-pointer"
                  >
                    <span>{t("compose_line_by_line")}</span>
                    {lineByLine && <Check className="h-3.5 w-3.5 text-primary" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setConvertEscapes(!convertEscapes)}
                    className="justify-between cursor-pointer"
                  >
                    <span>{t("compose_convert_escapes")}</span>
                    {convertEscapes && <Check className="h-3.5 w-3.5 text-primary" />}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 发送按钮 */}
              <Button
                size="sm"
                disabled={!text.trim() || resolvedTargets.length === 0}
                onClick={handleSend}
                className={cn(
                  "h-6 px-2.5 text-xs gap-1 font-medium cursor-pointer shadow-2xs",
                  isBroadcast
                    ? "bg-amber-600 hover:bg-amber-500 text-white"
                    : "bg-primary hover:bg-primary/90 text-primary-foreground"
                )}
              >
                <Send className="h-3 w-3" />
                <span className="hidden sm:inline-block">{t("compose_btn_send")}</span>
              </Button>

              {/* 关闭/收起 Bar 按钮 */}
              <button
                type="button"
                onClick={() => {
                  setVisible(false);
                  returnFocus();
                }}
                className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                title="关闭撰写栏 (Esc)"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 高危多机广播安全二次确认对话框 */}
      <Dialog open={dangerModalOpen} onOpenChange={setDangerModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <DialogTitle className="text-base">
                {t("compose_danger_title")}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs pt-1.5 leading-relaxed">
              {t("compose_danger_warning", { count: pendingTargets.length })}
            </DialogDescription>
          </DialogHeader>

          {/* 待执行指令预览卡片 */}
          <div className="p-2.5 rounded-lg border border-destructive/30 bg-destructive/5 font-mono text-xs text-destructive max-h-32 overflow-y-auto whitespace-pre-wrap break-all">
            {pendingCommand}
          </div>

          {/* 目标服务器清单 */}
          <div className="space-y-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              受影响的目标终端列表 ({pendingTargets.length}台)：
            </span>
            <div className="max-h-28 overflow-y-auto rounded border border-border/60 bg-muted/20 p-2 space-y-1 text-xs">
              {pendingTargets.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-muted-foreground">
                  <span className="font-semibold text-foreground truncate max-w-[180px]">
                    {item.serverName}
                  </span>
                  <span className="font-mono text-[10px] opacity-75">{item.host}</span>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDangerModalOpen(false);
                setPendingCommand(null);
              }}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (pendingCommand) {
                  void executeDispatch(pendingCommand, pendingTargets);
                }
                setDangerModalOpen(false);
                setPendingCommand(null);
              }}
            >
              {t("compose_danger_confirm_btn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 存为快捷命令弹窗 */}
      {saveFavOpen && favToCreate && (
        <QuickCommandDialog
          open={saveFavOpen}
          onOpenChange={setSaveFavOpen}
          editingCommand={favToCreate}
          onSave={async (data) => {
            await sshService.addFavCmd(
              data.cmd,
              data.desc,
              data.autoExecute,
              data.pinnedToBar,
              data.color
            );
            setSaveFavOpen(false);
            setFavToCreate(null);
            toast.success("已成功存为快捷命令！");
          }}
        />
      )}
    </>
  );
}
