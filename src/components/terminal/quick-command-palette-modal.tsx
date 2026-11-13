import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Zap,
  Plus,
  Play,
  Edit2,
  Trash2,
  Pin,
  PinOff,
  X,
  CornerDownLeft,
  Terminal as TerminalIcon,
  ArrowLeft,
  Check,
  GripVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Z_LAYER } from "@/lib/z-layer";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/i18n";
import { useShortcutStore } from "@/store/shortcut-store";
import { cn } from "@/lib/utils";
import { sshService } from "@/services/ssh-service";
import type { FavoriteCommand } from "@/services/api/types";
import { QUICK_CMD_COLORS } from "./quick-command-dialog";
import { playSound, SoundType } from "@/lib/sound";
import { useToast } from "@/components/ui/toast";

const INITIAL_PAGE_SIZE = 15;
const PAGE_INCREMENT = 10;
const CUSTOM_ORDER_KEY = "qshell:fav_cmds_custom_order";

// 规范排序器：先置顶再其他，各自分组内优先遵循自定义拖拽顺序，新项/未自定义项按创建时间倒序（最新排最前）
export function applyCommandOrdering(
  cmds: FavoriteCommand[],
  customOrderIds?: string[]
): FavoriteCommand[] {
  const orderMap = new Map<string, number>();
  if (customOrderIds && customOrderIds.length > 0) {
    customOrderIds.forEach((id, idx) => orderMap.set(id, idx));
  }

  return [...cmds].sort((a, b) => {
    // 优先级 1：先按照置顶再其他
    const aPinned = a.pinnedToBar ? 1 : 0;
    const bPinned = b.pinnedToBar ? 1 : 0;
    if (bPinned !== aPinned) {
      return bPinned - aPinned;
    }

    // 优先级 2：若用户已手动拖拽排序，组内按自定义顺序排
    const aCustom = orderMap.has(a.id) ? orderMap.get(a.id)! : -1;
    const bCustom = orderMap.has(b.id) ? orderMap.get(b.id)! : -1;
    if (aCustom !== -1 && bCustom !== -1) {
      return aCustom - bCustom;
    }
    if (aCustom !== -1 && bCustom === -1) {
      return 1;
    }
    if (aCustom === -1 && bCustom !== -1) {
      return -1;
    }

    // 优先级 3：组内按创建时间倒序（最新创建排最前）
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
}

export function QuickCommandPaletteModal() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "form">("list");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [commands, setCommands] = useState<FavoriteCommand[]>([]);
  const [displayLimit, setDisplayLimit] = useState(INITIAL_PAGE_SIZE);

  // 物理级流体拖拽系统状态（Raycast 风格：浮起悬浮卡片 + 虚线占位槽 + 邻居平滑让位）
  const [dragItemIndex, setDragItemIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const isPointerDraggingRef = useRef(false);
  const justDraggedRef = useRef(false);
  const dragStartInfoRef = useRef<{ index: number; startY: number } | null>(null);
  const grabOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragItemRectRef = useRef<{ width: number; height: number } | null>(null);

  // Form states (用于在同一个弹窗内进行增/改)
  const [editingCommand, setEditingCommand] = useState<FavoriteCommand | null>(null);
  const [formDesc, setFormDesc] = useState("");
  const [formCmd, setFormCmd] = useState("");
  const [formAutoExecute, setFormAutoExecute] = useState(true);
  const [formPinnedToBar, setFormPinnedToBar] = useState(false);
  const [formColor, setFormColor] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const formCmdInputRef = useRef<HTMLTextAreaElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const containerRectRef = useRef<DOMRect | null>(null);
  const saveSeqRef = useRef(0);

  // 从后端读取快捷命令列表并应用规范排序（置顶优先 + 时间倒序 / 自定义拖拽顺序）
  const loadCommands = useCallback(async () => {
    try {
      const list = await sshService.listFavCmds();
      let customIds: string[] = [];
      try {
        const saved = localStorage.getItem(CUSTOM_ORDER_KEY);
        if (saved) customIds = JSON.parse(saved);
      } catch {
        /* ignore */
      }
      const sorted = applyCommandOrdering(list || [], customIds);
      setCommands(sorted);
    } catch {
      // 忽略后端初始读取异常
    }
  }, []);

  useEffect(() => {
    void loadCommands();
    const unsub = sshService.onDataMutated((reason) => {
      if (
        reason === "addFavCmd" ||
        reason === "updateFavCmd" ||
        reason === "deleteFavCmd" ||
        reason === "setAllFavCmds"
      ) {
        void loadCommands();
      }
    });
    return unsub;
  }, [loadCommands]);

  // 快捷键处理：capture 阶段拦截以阻止冒泡到全局 useKeyboardShortcuts 造成
  // 重复 toggle；同时尊重用户自定义绑定，并放过输入框内的 AltGr+C 等字符输入。
  useEffect(() => {
    const handleToggle = () => {
      setOpen((prev) => !prev);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT")
      ) {
        return;
      }
      if (!useShortcutStore.getState().matchesAction(e, "terminal.quickCommand")) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setOpen((prev) => !prev);
    };

    window.addEventListener("qshell:toggle-quick-commands", handleToggle);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("qshell:toggle-quick-commands", handleToggle);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  // 打开弹窗时重置视图为列表模式、清空搜索词与高亮，并上焦点
  useEffect(() => {
    if (open) {
      setViewMode("list");
      setQuery("");
      setActiveIndex(0);
      setDisplayLimit(INITIAL_PAGE_SIZE);
      void loadCommands();
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open, loadCommands]);

  // 切换到表单模式时自动聚焦命令内容输入框
  useEffect(() => {
    if (viewMode === "form") {
      const timer = setTimeout(() => {
        formCmdInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [viewMode]);

  // 过滤命令列表：优先置顶项，并支持按名称与命令内容匹配
  const filteredCommands = useMemo(() => {
    const list = [...commands];
    // 排序：置顶在前
    list.sort((a, b) => {
      const aPinned = a.pinnedToBar ? 1 : 0;
      const bPinned = b.pinnedToBar ? 1 : 0;
      return bPinned - aPinned;
    });

    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter(
      (c) =>
        c.desc?.toLowerCase().includes(q) ||
        c.cmd?.toLowerCase().includes(q)
    );
  }, [commands, query]);

  // 分页按需加载展示的命令
  const visibleCommands = useMemo(() => {
    return filteredCommands.slice(0, displayLimit);
  }, [filteredCommands, displayLimit]);

  const hasMore = displayLimit < filteredCommands.length;

  // 触底按需加载下一批
  const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    if (
      hasMore &&
      target.scrollTop + target.clientHeight >= target.scrollHeight - 60
    ) {
      setDisplayLimit((prev) => Math.min(prev + PAGE_INCREMENT, filteredCommands.length));
    }
  };

  // 高亮项随索引变动自动滚动进入可视区域
  useEffect(() => {
    if (filteredCommands.length > 0 && activeIndex >= 0) {
      itemRefs.current[activeIndex]?.scrollIntoView?.({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [activeIndex, filteredCommands.length]);

  // 执行或插入命令
  const handleExecute = useCallback(
    (cmdItem: FavoriteCommand, forceExecute?: boolean) => {
      const willExecute = forceExecute !== undefined ? forceExecute : cmdItem.autoExecute !== false;
      window.dispatchEvent(
        new CustomEvent("insert-terminal-command", {
          detail: {
            command: cmdItem.cmd,
            execute: willExecute,
            source: "quick-command",
          },
        })
      );
      playSound(SoundType.Click);
      setOpen(false);
    },
    []
  );

  // 移动排序核心方法（拖动与键盘 Alt+↑/↓ 共享）
  const handleMoveItem = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= filteredCommands.length ||
        toIndex >= filteredCommands.length
      ) {
        return;
      }

      const currentList = [...filteredCommands];
      const [movedItem] = currentList.splice(fromIndex, 1);
      currentList.splice(toIndex, 0, movedItem);

      // 智能同步目标位置的置顶属性，确保拖动排序视觉结果与数据顺序完全一致
      const targetItem = filteredCommands[toIndex];
      if (targetItem && movedItem.pinnedToBar !== targetItem.pinnedToBar) {
        movedItem.pinnedToBar = targetItem.pinnedToBar;
      }

      setCommands(currentList);
      setActiveIndex(toIndex);

      // 同步保存自定义排序映射
      try {
        localStorage.setItem(CUSTOM_ORDER_KEY, JSON.stringify(currentList.map((c) => c.id)));
      } catch {
        /* ignore */
      }

      const seq = ++saveSeqRef.current;
      try {
        await sshService.setAllFavCmds(currentList);
      } catch {
        if (seq === saveSeqRef.current) {
          toast.error("保存命令排序失败");
          void loadCommands();
        }
      }
    },
    [filteredCommands, loadCommands, toast]
  );

  // 列表视图下的键盘快捷按键交互（↑ ↓ 切换高亮，Enter 执行，Shift+Enter 填入）
  const handleListKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 优先检测：支持 Alt+↑ / Alt+↓ 快捷键直接进行上下排序调整
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const direction = e.key === "ArrowUp" ? -1 : 1;
      const targetIndex = activeIndex + direction;
      if (targetIndex >= 0 && targetIndex < filteredCommands.length) {
        void handleMoveItem(activeIndex, targetIndex);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filteredCommands.length === 0) return;
      const nextIndex = (activeIndex + 1) % filteredCommands.length;
      if (nextIndex >= displayLimit) {
        setDisplayLimit((prev) => Math.min(prev + PAGE_INCREMENT, filteredCommands.length));
      }
      setActiveIndex(nextIndex);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filteredCommands.length === 0) return;
      setActiveIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const item = filteredCommands[activeIndex];
      if (item) {
        handleExecute(item, e.shiftKey ? false : undefined);
      }
      return;
    }

    // Ctrl+N 快速新建
    if ((e.ctrlKey || e.metaKey) && (e.key === "n" || e.key === "N")) {
      e.preventDefault();
      handleOpenAdd();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  // Pointer 拖动排序交互（规避 WebView2/Tauri 原生 HTML5 drag 拦截）
  const handlePointerDown = (e: React.PointerEvent, index: number) => {
    // 仅鼠标左键且非搜索过滤模式下允许拖拽排序
    if (e.button !== 0 || query.trim()) return;

    // 排除操作按钮内部的点击
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("[data-no-drag]")) {
      return;
    }

    const clientX = e.clientX ?? 0;
    const clientY = e.clientY ?? 0;
    const el = itemRefs.current[index];
    if (el) {
      const rect = el.getBoundingClientRect();
      const rectLeft = typeof rect.left === "number" && !isNaN(rect.left) ? rect.left : 0;
      const rectTop = typeof rect.top === "number" && !isNaN(rect.top) ? rect.top : 0;
      dragItemRectRef.current = { width: rect.width || 580, height: rect.height || 40 };
      grabOffsetRef.current = { x: clientX - rectLeft, y: clientY - rectTop };
    }

    if (listContainerRef.current) {
      containerRectRef.current = listContainerRef.current.getBoundingClientRect();
    }

    dragStartInfoRef.current = {
      index,
      startY: clientY,
    };
    isPointerDraggingRef.current = false;
  };

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!dragStartInfoRef.current) return;

      const clientX = e.clientX ?? 0;
      const clientY = e.clientY ?? 0;
      const { index, startY } = dragStartInfoRef.current;
      const dy = clientY - startY;

      // 移动超过 4px 阈值，正式激活 Raycast 级浮动拖拽态
      if (!isPointerDraggingRef.current) {
        if (Math.abs(dy) > 4) {
          isPointerDraggingRef.current = true;
          setDragItemIndex(index);
          setDragOverIndex(index);
          setCursorPos({ x: clientX, y: clientY });
        } else {
          return;
        }
      } else {
        setCursorPos({ x: clientX, y: clientY });
      }

      // 边缘自动滚动与边界极限吸附（防止划出弹窗丢失判定）
      const containerRect = containerRectRef.current;
      const mouseY = clientY;

      if (containerRect) {
        const edgeThreshold = 36;
        if (typeof listContainerRef.current?.scrollBy === "function") {
          if (mouseY < containerRect.top + edgeThreshold) {
            listContainerRef.current.scrollBy({ top: -7, behavior: "auto" });
          } else if (mouseY > containerRect.bottom - edgeThreshold) {
            listContainerRef.current.scrollBy({ top: 7, behavior: "auto" });
          }
        }

        if (mouseY <= containerRect.top) {
          setDragOverIndex(0);
        } else if (mouseY >= containerRect.bottom) {
          setDragOverIndex(visibleCommands.length - 1);
        } else {
          for (let i = 0; i < visibleCommands.length; i++) {
            const el = itemRefs.current[i];
            if (!el) continue;
            const rect = el.getBoundingClientRect();
            if (mouseY >= rect.top - 4 && mouseY <= rect.bottom + 4) {
              setDragOverIndex(i);
              break;
            }
          }
        }
      }
    };

    const handlePointerUp = () => {
      if (!dragStartInfoRef.current) return;

      const fromIndex = dragStartInfoRef.current.index;
      const wasDragging = isPointerDraggingRef.current;

      dragStartInfoRef.current = null;
      isPointerDraggingRef.current = false;
      setCursorPos(null);
      dragItemRectRef.current = null;

      if (wasDragging) {
        justDraggedRef.current = true;
        setTimeout(() => {
          justDraggedRef.current = false;
        }, 120);

        setDragOverIndex((toIndex) => {
          if (toIndex !== null && toIndex !== fromIndex) {
            void handleMoveItem(fromIndex, toIndex);
          }
          return null;
        });
        setDragItemIndex(null);
      } else {
        setDragItemIndex(null);
        setDragOverIndex(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isPointerDraggingRef.current) {
        e.preventDefault();
        e.stopPropagation();
        dragStartInfoRef.current = null;
        isPointerDraggingRef.current = false;
        setDragItemIndex(null);
        setDragOverIndex(null);
        setCursorPos(null);
        dragItemRectRef.current = null;
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [visibleCommands, handleMoveItem]);

  // 命令项点击保护：若刚刚触发了拖拽，则取消执行
  const handleItemClick = (cmdItem: FavoriteCommand) => {
    if (justDraggedRef.current || isPointerDraggingRef.current) {
      return;
    }
    handleExecute(cmdItem);
  };

  // 表单视图下的快捷保存交互（Ctrl+Enter 保存，Esc 返回列表）
  const handleFormKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setViewMode("list");
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSaveForm();
    }
  };

  // 打开新增表单
  const handleOpenAdd = () => {
    setEditingCommand(null);
    setFormDesc("");
    setFormCmd("");
    setFormAutoExecute(true);
    setFormPinnedToBar(false);
    setFormColor(undefined);
    setIsSaving(false);
    setViewMode("form");
  };

  // 打开编辑表单
  const handleEdit = (cmdItem: FavoriteCommand, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCommand(cmdItem);
    setFormDesc(cmdItem.desc || "");
    setFormCmd(cmdItem.cmd || "");
    setFormAutoExecute(cmdItem.autoExecute !== false);
    setFormPinnedToBar(cmdItem.pinnedToBar === true);
    setFormColor(cmdItem.color);
    setIsSaving(false);
    setViewMode("form");
  };

  // 保存新增或修改的表单内容
  const handleSaveForm = async () => {
    const trimmedCmd = formCmd.trim();
    if (!trimmedCmd || isSaving) return;
    const trimmedDesc = formDesc.trim() || trimmedCmd;

    setIsSaving(true);
    try {
      if (editingCommand) {
        await sshService.updateFavCmd(
          editingCommand.id,
          trimmedCmd,
          trimmedDesc,
          formAutoExecute,
          formPinnedToBar,
          formColor,
        );
        toast.success(t("common_success") || "保存成功");
      } else {
        await sshService.addFavCmd(
          trimmedCmd,
          trimmedDesc,
          formAutoExecute,
          formPinnedToBar,
          formColor,
        );
        toast.success(t("common_success") || "添加成功");
      }
      await loadCommands();
      setViewMode("list");
      setEditingCommand(null);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setIsSaving(false);
    }
  };

  // 删除命令
  const handleDelete = async (cmdItem: FavoriteCommand, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await sshService.deleteFavCmd(cmdItem.id);
      toast.success(t("common_success") || "已删除");
      await loadCommands();
    } catch (err) {
      toast.error(String(err));
    }
  };

  // 切换置顶
  const handleTogglePin = async (cmdItem: FavoriteCommand, e: React.MouseEvent) => {
    e.stopPropagation();
    const newPinned = !cmdItem.pinnedToBar;
    try {
      await sshService.updateFavCmd(
        cmdItem.id,
        cmdItem.cmd,
        cmdItem.desc,
        cmdItem.autoExecute,
        newPinned,
        cmdItem.color,
      );
      // 让该命令在新分区中自动进入最前列
      try {
        const saved = localStorage.getItem(CUSTOM_ORDER_KEY);
        if (saved) {
          const ids: string[] = JSON.parse(saved);
          const filtered = ids.filter((id) => id !== cmdItem.id);
          localStorage.setItem(CUSTOM_ORDER_KEY, JSON.stringify([cmdItem.id, ...filtered]));
        }
      } catch {
        /* ignore */
      }
      await loadCommands();
    } catch (err) {
      toast.error(String(err));
    }
  };

  // 颜色解析器
  const getColorBadge = (colorId?: string) => {
    const found = QUICK_CMD_COLORS.find((c) => c.id === colorId);
    if (!found) {
      return {
        dotClass: "bg-emerald-500",
        ringClass: "ring-emerald-500/20",
      };
    }
    return {
      dotClass: found.bg,
      ringClass: `ring-2 ${found.border}/30`,
    };
  };

  const draggedCmdItem = dragItemIndex !== null ? visibleCommands[dragItemIndex] : null;

  return (
    <>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        {/* 半透明毛玻璃沉浸遮罩 */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-modal bg-black/45 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-150" />

        {/* 屏幕正中心半透明弹框容器（一体化容器，固定尺寸与平滑滚动，列表与增删改完全融合） */}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-[50%] top-[50%] z-modal-content translate-x-[-50%] translate-y-[-50%]",
            "w-[640px] max-w-[94vw] h-[480px] max-h-[85vh] rounded-2xl",
            "border border-border/70 dark:border-white/10",
            "bg-background/95 dark:bg-zinc-900/90 backdrop-blur-2xl",
            "shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] dark:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)]",
            "p-0 outline-none overflow-hidden flex flex-col",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-150"
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {viewMode === "list"
              ? (t("quick_cmd_bar") || "快捷命令中心")
              : editingCommand
                ? (t("quick_cmd_edit") || "编辑快捷命令")
                : (t("quick_cmd_add") || "新建快捷命令")}
          </DialogPrimitive.Title>

          {/* ──────────────── 模式一：命令搜索与列表视图 (List Mode) ──────────────── */}
          {viewMode === "list" && (
            <>
              {/* 顶栏：Raycast 风格一体化搜索栏 */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-muted/15 shrink-0">
                <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/10 text-amber-500 shrink-0">
                  <Zap className="h-4 w-4 fill-amber-500/20" />
                </div>

                {/* 沉浸式搜索输入 */}
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIndex(0);
                    setDisplayLimit(INITIAL_PAGE_SIZE);
                  }}
                  onKeyDown={handleListKeyDown}
                  placeholder={
                    t("quick_cmd_modal_search") || "搜索快捷命令... (↑↓ 选择，Enter 执行)"
                  }
                  className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/50 text-foreground outline-none border-none ring-0 focus:outline-none"
                />

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleOpenAdd}
                    className="h-7 px-2.5 text-xs gap-1.5 rounded-lg border-border/60 hover:bg-muted/60 hover:text-foreground transition-all cursor-pointer shadow-2xs font-normal"
                    title="添加新命令 (Ctrl+N)"
                  >
                    <Plus className="h-3.5 w-3.5 text-primary" />
                    <span>{t("quick_cmd_add") || "新建命令"}</span>
                  </Button>

                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                    title={t("common_close") || "关闭 (Esc)"}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* 命令列表展示区（定高容器内平滑滚动与触底按需加载） */}
              <div
                ref={listContainerRef}
                className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1 scrollbar-thin"
                onScroll={handleListScroll}
              >
                {filteredCommands.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground h-full">
                    <div className="p-3 rounded-xl bg-muted/30 mb-3 border border-border/30">
                      <TerminalIcon className="h-5 w-5 opacity-40" />
                    </div>
                    <p className="text-sm font-medium text-foreground/75">
                      {query ? "未找到匹配的快捷命令" : (t("quick_cmd_empty") || "暂无快捷命令")}
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
                      {query
                        ? "可以尝试更换搜索关键词，或点击右上角新建此命令"
                        : "添加常用的 Shell 命令，在任何终端中按 Alt+C 一键直达"}
                    </p>
                    {!query && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleOpenAdd}
                        className="mt-4 h-7.5 px-3 text-xs gap-1.5 rounded-lg border-primary/30 text-primary hover:bg-primary/10 cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>{t("quick_cmd_add") || "新建第一条命令"}</span>
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    {visibleCommands.map((cmdItem, idx) => {
                      const isSelected = idx === activeIndex;
                      const isDraggingThis = idx === dragItemIndex;
                      const isDraggingActive = dragItemIndex !== null;
                      const colorBadge = getColorBadge(cmdItem.color);
                      const canDrag = !query.trim();
                      const rowHeight = (dragItemRectRef.current?.height || 40) + 4;

                      // 1. 若当前项是被拖拽项本身，在列表中展示 Raycast 风格的半透明虚线镂空槽位
                      if (isDraggingThis) {
                        const isTargetPinned = dragOverIndex !== null && filteredCommands[dragOverIndex]?.pinnedToBar;
                        const isMovedItemPinned = draggedCmdItem?.pinnedToBar;

                        let slotText = "松开鼠标置于此处";
                        if (isMovedItemPinned && !isTargetPinned) {
                          slotText = "松开取消置顶并放置于此处";
                        } else if (!isMovedItemPinned && isTargetPinned) {
                          slotText = "📌 松开置顶并放置于此处";
                        }

                        return (
                          <div
                            key={cmdItem.id}
                            ref={(el) => {
                              itemRefs.current[idx] = el;
                            }}
                            className={cn(
                              "flex items-center justify-center px-4 rounded-xl border-2 border-dashed select-none transition-all duration-150 shadow-inner",
                              !isMovedItemPinned && isTargetPinned
                                ? "border-amber-500/50 bg-amber-500/[0.08] text-amber-500 font-medium"
                                : "border-primary/40 bg-primary/[0.04] dark:bg-primary/[0.08] text-primary/70 font-medium"
                            )}
                            style={{
                              height: dragItemRectRef.current?.height || 40,
                            }}
                          >
                            <div className="flex items-center gap-1.5 text-xs">
                              <GripVertical className="h-3.5 w-3.5 animate-pulse" />
                              <span>{slotText}</span>
                            </div>
                          </div>
                        );
                      }

                      // 2. 计算流体平移偏移量（让位动效）：
                      let translateY = 0;
                      if (isDraggingActive && dragItemIndex !== null && dragOverIndex !== null) {
                        if (dragItemIndex < dragOverIndex) {
                          if (idx > dragItemIndex && idx <= dragOverIndex) {
                            translateY = -rowHeight;
                          }
                        } else if (dragItemIndex > dragOverIndex) {
                          if (idx < dragItemIndex && idx >= dragOverIndex) {
                            translateY = rowHeight;
                          }
                        }
                      }

                      return (
                        <div
                          key={cmdItem.id}
                          ref={(el) => {
                            itemRefs.current[idx] = el;
                          }}
                          onPointerDown={(e) => handlePointerDown(e, idx)}
                          onClick={() => handleItemClick(cmdItem)}
                          onMouseEnter={() => !isDraggingActive && setActiveIndex(idx)}
                          style={{
                            transform: translateY !== 0 ? `translateY(${translateY}px)` : undefined,
                            transition: isDraggingActive ? "transform 180ms cubic-bezier(0.2, 0, 0, 1)" : undefined,
                          }}
                          className={cn(
                            "group relative flex items-center justify-between gap-3 px-3 py-2 rounded-xl cursor-pointer select-none touch-none",
                            isSelected
                              ? "bg-black/[0.08] dark:bg-white/[0.12] shadow-2xs text-foreground"
                              : "hover:bg-black/[0.035] dark:hover:bg-white/[0.05] text-foreground/90",
                            isDraggingActive && "pointer-events-none"
                          )}
                        >
                          {/* 左侧：拖动手柄、彩色原点、标签名、命令代码标签 */}
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {canDrag && (
                              <div
                                className="text-muted-foreground/35 hover:text-foreground cursor-grab active:cursor-grabbing p-1 -ml-1.5 shrink-0 transition-opacity opacity-40 hover:opacity-100 group-hover:opacity-100 select-none touch-none"
                                title="按住鼠标拖动排序 (亦可按 Alt+↑/↓)"
                              >
                                <GripVertical className="h-3.5 w-3.5" />
                              </div>
                            )}
                            <span
                              className={cn(
                                "h-2 w-2 rounded-full shrink-0 ring-2",
                                colorBadge.dotClass,
                                colorBadge.ringClass
                              )}
                            />

                            {/* 标签标题 */}
                            <span className="font-medium text-sm text-foreground truncate max-w-[150px] sm:max-w-[200px]">
                              {cmdItem.desc || cmdItem.cmd}
                            </span>

                            {/* 置顶标识 */}
                            {cmdItem.pinnedToBar && (
                              <Pin className="h-3 w-3 text-amber-500 shrink-0 fill-amber-500/20" />
                            )}

                            {/* 命令内容代码预览胶囊 */}
                            <code className="hidden sm:inline-block font-mono text-[11px] px-2 py-0.5 rounded-md bg-muted/60 dark:bg-zinc-800/60 text-muted-foreground truncate max-w-[220px] border border-border/30">
                              {cmdItem.cmd}
                            </code>
                          </div>

                          {/* 右侧：执行策略标识 & 操作按钮群 */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* 自动回车标识胶囊 */}
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-mono border transition-colors",
                                cmdItem.autoExecute !== false
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                                  : "bg-muted/40 text-muted-foreground border-border/30"
                              )}
                              title={
                                cmdItem.autoExecute !== false
                                  ? "回车直接执行"
                                  : "填入输入行，不自动执行"
                              }
                            >
                              <CornerDownLeft className="h-3 w-3" />
                              <span className="text-[10px]">
                                {cmdItem.autoExecute !== false ? "Enter" : "Paste"}
                              </span>
                            </span>

                            {/* 悬浮或选中时才显示的操作小工具栏 */}
                            <div
                              data-no-drag
                              className={cn(
                                "flex items-center gap-0.5 transition-opacity duration-150",
                                isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                              )}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="p-1 rounded-md text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 cursor-pointer transition-colors"
                                onClick={() => handleExecute(cmdItem)}
                                title="立即执行 (Enter)"
                              >
                                <Play className="h-3.5 w-3.5 fill-current" />
                              </button>
                              <button
                                type="button"
                                className={cn(
                                  "p-1 rounded-md cursor-pointer transition-colors",
                                  cmdItem.pinnedToBar
                                  ? "text-amber-500 hover:bg-amber-500/15"
                                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                )}
                                onClick={(e) => handleTogglePin(cmdItem, e)}
                                title={cmdItem.pinnedToBar ? "取消置顶" : "置顶展示"}
                              >
                                {cmdItem.pinnedToBar ? (
                                  <PinOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Pin className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors"
                                onClick={(e) => handleEdit(cmdItem, e)}
                                title="编辑命令"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer transition-colors"
                                onClick={(e) => handleDelete(cmdItem, e)}
                                title="删除命令"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* 触底按需加载提示 */}
                    {hasMore && (
                      <div className="py-2.5 text-center text-xs text-muted-foreground/60 flex items-center justify-center gap-2">
                        <div className="h-3 w-3 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
                        <span>向下滚动加载更多...</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 底栏：极简键盘操作提示指南 */}
              <div className="flex items-center justify-between px-3.5 py-2 border-t border-border/30 bg-muted/20 text-[11px] text-muted-foreground/75 shrink-0">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <kbd className="px-1 py-0.2 rounded bg-background/80 border border-border/50 text-[10px] font-mono shadow-2xs">
                      ↑↓
                    </kbd>
                    <span>选择</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.2 rounded bg-background/80 border border-border/50 text-[10px] font-mono shadow-2xs">
                      Enter
                    </kbd>
                    <span>执行</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-1.5 py-0.2 rounded bg-background/80 border border-border/50 text-[10px] font-mono shadow-2xs">
                      Shift+Enter
                    </kbd>
                    <span>填入</span>
                  </span>
                  <span className="hidden sm:flex items-center gap-1">
                    <kbd className="px-1 py-0.2 rounded bg-background/80 border border-border/50 text-[10px] font-mono shadow-2xs">
                      Ctrl+N
                    </kbd>
                    <span>新建</span>
                  </span>
                  <span className="hidden sm:flex items-center gap-1">
                    <kbd className="px-1 py-0.2 rounded bg-background/80 border border-border/50 text-[10px] font-mono shadow-2xs">
                      Alt+↑↓
                    </kbd>
                    <span>/ 拖拽排序</span>
                  </span>
                  <span className="hidden sm:flex items-center gap-1">
                    <kbd className="px-1 py-0.2 rounded bg-background/80 border border-border/50 text-[10px] font-mono shadow-2xs">
                      Esc
                    </kbd>
                    <span>关闭</span>
                  </span>
                </div>
                <div className="text-[10px] text-muted-foreground/60 tabular-nums">
                  {filteredCommands.length > visibleCommands.length
                    ? `已显示 ${visibleCommands.length} / 共 ${filteredCommands.length} 条`
                    : `共 ${filteredCommands.length} 条`}
                </div>
              </div>
            </>
          )}

          {/* ──────────────── 模式二：同窗内置表单视图 (Form Mode) ──────────────── */}
          {viewMode === "form" && (
            <div onKeyDown={handleFormKeyDown} className="flex flex-col flex-1 h-full min-h-0">
              {/* 内置顶栏：返回按钮与表单标题 */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/15 shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setViewMode("list")}
                    className="flex items-center gap-1 px-1.5 py-1 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                    title="返回列表 (Esc)"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    <span>{t("common_back") || "返回"}</span>
                  </button>
                  <div className="h-3.5 w-px bg-border/60 mx-1" />
                  <span className="font-semibold text-sm tracking-tight text-foreground">
                    {editingCommand
                      ? (t("quick_cmd_edit") || "编辑快捷命令")
                      : (t("quick_cmd_add") || "新建快捷命令")}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                  title={t("common_close") || "关闭"}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* 表单内容区 */}
              <div className="flex-1 min-h-0 p-4 space-y-3.5 overflow-y-auto scrollbar-thin">
                {/* 名称 / 标签 */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    {t("quick_cmd_name") || "名称 / 标签"}
                  </label>
                  <Input
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    placeholder={t("quick_cmd_name_placeholder") || "例：查看内存状态 / Docker 容器"}
                    className="h-8.5 text-xs bg-muted/20 border-border/60 rounded-lg"
                  />
                </div>

                {/* 命令内容 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-foreground">
                      {t("quick_cmd_command") || "命令内容"} <span className="text-destructive">*</span>
                    </label>
                  </div>
                  <textarea
                    ref={formCmdInputRef}
                    value={formCmd}
                    onChange={(e) => setFormCmd(e.target.value)}
                    placeholder={t("quick_cmd_command_placeholder") || "例：free -h 或 docker ps -a"}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs font-mono placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/60"
                  />
                </div>

                {/* 颜色标签选择 */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    {t("quick_cmd_color") || "颜色标识"}
                  </label>
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setFormColor(undefined)}
                      className={cn(
                        "flex h-6 items-center rounded-md px-2 text-[11px] border transition-all cursor-pointer",
                        !formColor
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-border/60 text-muted-foreground hover:bg-muted/40"
                      )}
                    >
                      默认
                    </button>
                    {QUICK_CMD_COLORS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setFormColor(c.id)}
                        className={cn(
                          "h-5.5 w-5.5 rounded-full border-2 transition-transform cursor-pointer relative flex items-center justify-center",
                          c.bg,
                          formColor === c.id
                            ? "scale-110 ring-2 ring-primary ring-offset-2 ring-offset-background border-white"
                            : "border-transparent opacity-80 hover:opacity-100"
                        )}
                        title={c.id}
                      >
                        {formColor === c.id && <Check className="h-3 w-3 text-white" />}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 直接执行开关 */}
                <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/15 p-3">
                  <div className="space-y-0.5 pr-2">
                    <label className="text-xs font-medium text-foreground block cursor-pointer">
                      {t("quick_cmd_auto_exec") || "点击直接执行 (Enter)"}
                    </label>
                    <p className="text-[11px] text-muted-foreground leading-normal">
                      {t("quick_cmd_auto_exec_desc") || "开启后选择此命令立即执行；关闭则仅将命令填入终端命令行"}
                    </p>
                  </div>
                  <Switch
                    checked={formAutoExecute}
                    onCheckedChange={setFormAutoExecute}
                  />
                </div>

                {/* 置顶展示开关 */}
                <div className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/15 p-3">
                  <div className="space-y-0.5 pr-2">
                    <label className="text-xs font-medium text-foreground block cursor-pointer">
                      {t("quick_cmd_pinned") || "置顶在列表前列"}
                    </label>
                    <p className="text-[11px] text-muted-foreground leading-normal">
                      {t("quick_cmd_pinned_desc") || "开启后排在快捷命令列表最前方，方便快捷定位与键盘直达"}
                    </p>
                  </div>
                  <Switch
                    checked={formPinnedToBar}
                    onCheckedChange={setFormPinnedToBar}
                  />
                </div>
              </div>

              {/* 内置表单底栏：保存与取消 */}
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/30 bg-muted/20 shrink-0">
                <span className="text-[11px] text-muted-foreground/60 hidden sm:inline">
                  按 <kbd className="font-mono text-[10px] px-1 py-0.2 rounded bg-background border border-border/50">Ctrl+Enter</kbd> 快速保存，<kbd className="font-mono text-[10px] px-1 py-0.2 rounded bg-background border border-border/50">Esc</kbd> 返回
                </span>

                <div className="flex items-center gap-2 ml-auto">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setViewMode("list")}
                    disabled={isSaving}
                    className="h-7.5 px-3 text-xs rounded-lg"
                  >
                    {t("common_cancel") || "取消"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveForm}
                    disabled={!formCmd.trim() || isSaving}
                    className="h-7.5 px-3.5 text-xs rounded-lg"
                  >
                    {isSaving ? "保存中..." : (t("common_save") || "保存")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>

    {/* Raycast 风格悬浮跟手幽灵卡片 (Floating Ghost Preview) */}
    {dragItemIndex !== null && draggedCmdItem && cursorPos && typeof document !== "undefined" && (() => {
      const railLeft = containerRectRef.current
        ? Math.round(containerRectRef.current.left + 8)
        : Math.round((cursorPos.x ?? 0) - (grabOffsetRef.current.x || 0));
      const railWidth = containerRectRef.current
        ? Math.round(containerRectRef.current.width - 16)
        : (dragItemRectRef.current?.width || 580);
      const ghostHeight = dragItemRectRef.current?.height || 40;
      const rawTop = Math.round((cursorPos.y ?? 0) - (grabOffsetRef.current.y || 0));
      const clampedTop = containerRectRef.current
        ? Math.max(
            containerRectRef.current.top - 6,
            Math.min(containerRectRef.current.bottom - ghostHeight + 6, rawTop)
          )
        : rawTop;

      return createPortal(
        <div
          style={{
            position: "fixed",
            left: railLeft,
            top: clampedTop,
            width: railWidth,
            zIndex: Z_LAYER.DRAG,
            pointerEvents: "none",
          }}
          className={cn(
            "flex items-center justify-between gap-3 px-3 py-2 rounded-xl select-none",
            "bg-background/95 dark:bg-zinc-900/95 backdrop-blur-2xl",
            "border border-primary/50 ring-2 ring-primary/30",
            "shadow-[0_22px_45px_-10px_rgba(0,0,0,0.5)] dark:shadow-[0_25px_50px_-10px_rgba(0,0,0,0.9)]",
            "scale-[1.02] rotate-[0.5deg] cursor-grabbing"
          )}
        >
          {/* 左侧：彩色原点、标签名、命令代码标签 */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="text-primary p-1 -ml-1.5 shrink-0 cursor-grabbing">
              <GripVertical className="h-3.5 w-3.5" />
            </div>
            <span
              className={cn(
                "h-2 w-2 rounded-full shrink-0 ring-2",
                getColorBadge(draggedCmdItem.color).dotClass,
                getColorBadge(draggedCmdItem.color).ringClass
              )}
            />
            <span className="font-semibold text-sm text-foreground truncate max-w-[200px]">
              {draggedCmdItem.desc || draggedCmdItem.cmd}
            </span>
            {draggedCmdItem.pinnedToBar && (
              <Pin className="h-3 w-3 text-amber-500 shrink-0 fill-amber-500/20" />
            )}
            <code className="hidden sm:inline-block font-mono text-[11px] px-2 py-0.5 rounded-md bg-muted/70 text-muted-foreground truncate max-w-[220px] border border-border/40">
              {draggedCmdItem.cmd}
            </code>
          </div>

          {/* 右侧：执行策略标识胶囊 */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-mono border",
                draggedCmdItem.autoExecute !== false
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : "bg-muted/40 text-muted-foreground border-border/30"
              )}
            >
              <CornerDownLeft className="h-3 w-3" />
              <span className="text-[10px]">
                {draggedCmdItem.autoExecute !== false ? "Enter" : "Paste"}
              </span>
            </span>
          </div>
        </div>,
        document.body
      );
    })()}
  </>
  );
}
