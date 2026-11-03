import { useState, useRef, useEffect, useMemo } from "react";
import {
  X,
  Maximize2,
  Minimize2,
  Search,
  Terminal,
  ClipboardPaste,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { playSound, SoundType } from "@/lib/sound";
import { useTextFormatterStore } from "@/store/text-formatter-store";
import { DEV_TOOLS, guessBestToolId, type ToolItem } from "./tools/tool-registry";

const DEFAULT_WIDTH = 980;
const DEFAULT_HEIGHT = 650;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 440;
const VIEWPORT_PADDING = 16;

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface PanelSize {
  width: number;
  height: number;
}

export function FloatingTextFormatter() {
  const open = useTextFormatterStore((s) => s.open);
  const seed = useTextFormatterStore((s) => s.seed);
  const closeTextFormatter = useTextFormatterStore((s) => s.closeTextFormatter);

  const [activeToolId, setActiveToolId] = useState<string>("json");
  const [searchQuery, setSearchQuery] = useState("");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<PanelSize | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);

  const dragRef = useRef<{
    startX: number;
    startY: number;
    startPosX: number;
    startPosY: number;
  } | null>(null);

  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startPosX: number;
    startPosY: number;
    direction: ResizeDirection;
  } | null>(null);

  // 监听 Escape 键快速关闭弹窗，以及 Ctrl+F 聚焦搜索
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        playSound(SoundType.Close);
        closeTextFormatter();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, closeTextFormatter]);

  // 打开时根据 seed 智能推荐激活的工具
  useEffect(() => {
    if (!open) return;
    if (seed && seed.trim()) {
      const bestId = guessBestToolId(seed);
      setActiveToolId(bestId);
    } else {
      setActiveToolId("json");
    }
    setSearchQuery("");
  }, [open, seed]);

  const handlePasteAndJump = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        const clean = text.trim();
        useTextFormatterStore.getState().openTextFormatter(clean);
        const best = guessBestToolId(clean);
        setActiveToolId(best);
        playSound(SoundType.Click);
      }
    } catch {
      /* ignore */
    }
  };

  const getDefaultPos = () => {
    if (typeof window === "undefined") return { x: 80, y: 80 };
    const w = size?.width ?? DEFAULT_WIDTH;
    const h = size?.height ?? DEFAULT_HEIGHT;
    const x = Math.max(VIEWPORT_PADDING, (window.innerWidth - w) / 2);
    const y = Math.max(VIEWPORT_PADDING, (window.innerHeight - h) / 2);
    return { x, y };
  };

  const handleDragStart = (e: React.PointerEvent) => {
    if (isMaximized) return;
    e.preventDefault();
    const cur = pos ?? getDefaultPos();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: cur.x,
      startPosY: cur.y,
    };
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const curW = size?.width ?? DEFAULT_WIDTH;
      const curH = size?.height ?? DEFAULT_HEIGHT;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const clampedX = Math.max(
        VIEWPORT_PADDING,
        Math.min(vw - curW - VIEWPORT_PADDING, dragRef.current.startPosX + dx),
      );
      const clampedY = Math.max(
        VIEWPORT_PADDING,
        Math.min(vh - curH - VIEWPORT_PADDING, dragRef.current.startPosY + dy),
      );
      setPos({ x: clampedX, y: clampedY });
    };
    const onUp = () => {
      setDragging(false);
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleResizePointerDown = (
    direction: ResizeDirection,
    e: React.PointerEvent,
  ) => {
    if (isMaximized) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const curPos = pos ?? getDefaultPos();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: size?.width ?? DEFAULT_WIDTH,
      startH: size?.height ?? DEFAULT_HEIGHT,
      startPosX: curPos.x,
      startPosY: curPos.y,
      direction,
    };
    setResizing(true);

    const onMove = (ev: PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const dx = ev.clientX - r.startX;
      const dy = ev.clientY - r.startY;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const maxW = vw - VIEWPORT_PADDING * 2;
      const maxH = vh - VIEWPORT_PADDING * 2;

      let newW = r.startW;
      let newH = r.startH;
      let newX = r.startPosX;
      let newY = r.startPosY;

      if (r.direction.includes("e")) {
        newW = Math.min(Math.max(MIN_WIDTH, r.startW + dx), maxW);
        if (newX + newW > vw - VIEWPORT_PADDING) {
          newX = Math.max(VIEWPORT_PADDING, vw - VIEWPORT_PADDING - newW);
        }
      } else if (r.direction.includes("w")) {
        newW = Math.min(Math.max(MIN_WIDTH, r.startW - dx), maxW);
        newX = Math.max(
          VIEWPORT_PADDING,
          r.startPosX + (r.startW - newW),
        );
      }

      if (r.direction.includes("s")) {
        newH = Math.min(Math.max(MIN_HEIGHT, r.startH + dy), maxH);
        if (newY + newH > vh - VIEWPORT_PADDING) {
          newY = Math.max(VIEWPORT_PADDING, vh - VIEWPORT_PADDING - newH);
        }
      } else if (r.direction.includes("n")) {
        newH = Math.min(Math.max(MIN_HEIGHT, r.startH - dy), maxH);
        newY = Math.max(
          VIEWPORT_PADDING,
          r.startPosY + (r.startH - newH),
        );
      }

      setSize({ width: newW, height: newH });
      setPos({ x: newX, y: newY });
    };

    const onUp = () => {
      setResizing(false);
      resizeRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleClose = () => {
    playSound(SoundType.Close);
    closeTextFormatter();
  };

  // 搜索过滤工具
  const filteredTools = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return DEV_TOOLS;
    return DEV_TOOLS.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.keywords.some((k) => k.toLowerCase().includes(q))
    );
  }, [searchQuery]);

  // 按分类分组
  const groupedTools = useMemo(() => {
    const groups: Array<{ categoryLabel: string; items: ToolItem[] }> = [];
    const catMap = new Map<string, ToolItem[]>();

    filteredTools.forEach((tool) => {
      const list = catMap.get(tool.categoryLabel) || [];
      list.push(tool);
      catMap.set(tool.categoryLabel, list);
    });

    catMap.forEach((items, categoryLabel) => {
      groups.push({ categoryLabel, items });
    });

    return groups;
  }, [filteredTools]);

  const activeTool = DEV_TOOLS.find((t) => t.id === activeToolId) || DEV_TOOLS[0];
  const ActiveComponent = activeTool.component;

  if (!open) return null;

  const width = size?.width ?? DEFAULT_WIDTH;
  const height = size?.height ?? DEFAULT_HEIGHT;
  const rawPos = pos ?? getDefaultPos();
  const finalPos = {
    x:
      typeof window !== "undefined"
        ? Math.max(
            VIEWPORT_PADDING,
            Math.min(window.innerWidth - width - VIEWPORT_PADDING, rawPos.x),
          )
        : rawPos.x,
    y:
      typeof window !== "undefined"
        ? Math.max(
            VIEWPORT_PADDING,
            Math.min(window.innerHeight - height - VIEWPORT_PADDING, rawPos.y),
          )
        : rawPos.y,
  };

  return (
    <div
      className={cn(
        "fixed z-[60] flex flex-col overflow-hidden rounded-2xl",
        "border border-black/10 dark:border-white/10",
        "bg-white/90 dark:bg-zinc-950/90 backdrop-blur-2xl backdrop-saturate-150",
        "shadow-[0_24px_70px_-12px_rgba(0,0,0,0.35),inset_0_1px_0_0_rgba(255,255,255,0.4)] dark:shadow-[0_24px_70px_-12px_rgba(0,0,0,0.7),inset_0_1px_0_0_rgba(255,255,255,0.08)]",
        "select-text transition-all duration-150 ease-out",
        (dragging || resizing) && "transition-none select-none",
        isMaximized && "rounded-none border-none inset-3"
      )}
      style={
        isMaximized
          ? {
              left: `${VIEWPORT_PADDING}px`,
              top: `${VIEWPORT_PADDING}px`,
              width: `calc(100vw - ${VIEWPORT_PADDING * 2}px)`,
              height: `calc(100vh - ${VIEWPORT_PADDING * 2}px)`,
            }
          : {
              left: `${finalPos.x}px`,
              top: `${finalPos.y}px`,
              width: `${width}px`,
              height: `${height}px`,
              maxWidth: `calc(100vw - ${VIEWPORT_PADDING * 2}px)`,
              maxHeight: `calc(100vh - ${VIEWPORT_PADDING * 2}px)`,
            }
      }
    >
      {/* 顶部标题与控制栏 (苹果液态玻璃与极简视窗控件) */}
      <div
        onPointerDown={handleDragStart}
        onDoubleClick={() => setIsMaximized((m) => !m)}
        className="flex items-center justify-between px-3.5 py-2 border-b border-black/5 dark:border-white/10 select-none cursor-move shrink-0 bg-black/[0.02] dark:bg-white/[0.02]"
      >
        <div className="flex items-center gap-2 text-xs font-medium text-foreground tracking-tight">
          <Terminal className="h-3.5 w-3.5 text-primary/80" />
          <span>开发运维工具箱</span>
          <span className="text-[10px] font-mono text-muted-foreground/50 border-l border-black/10 dark:border-white/10 pl-2">DevTools</span>
        </div>

        <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setIsMaximized((m) => !m)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground active:scale-90 transition-all cursor-pointer"
            title={isMaximized ? "还原窗口" : "最大化"}
          >
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive active:scale-90 transition-all cursor-pointer"
            title="关闭 (Escape)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 工作台双栏主体 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左侧：搜索与工具分类导航栏 (紧凑高密设计，消除AI塑料感) */}
        <div className="w-48 shrink-0 border-r border-black/5 dark:border-white/10 bg-black/[0.015] dark:bg-white/[0.015] flex flex-col min-h-0">
          {/* 单行紧凑搜索栏 + 剪贴板识别按钮 */}
          <div className="p-2 border-b border-black/5 dark:border-white/10">
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索工具..."
                className="w-full rounded-md border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] pl-8 pr-7 py-1 text-xs text-foreground placeholder:text-muted-foreground/45 outline-none focus:border-primary/50 transition-colors"
              />
              <button
                type="button"
                onClick={handlePasteAndJump}
                className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 active:scale-90 transition-all cursor-pointer"
                title="读取剪贴板自动跳转对应工具"
              >
                <ClipboardPaste className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* 分组工具菜单列表 */}
          <div className="flex-1 overflow-y-auto p-1.5 space-y-2.5">
            {groupedTools.map((group) => (
              <div key={group.categoryLabel} className="space-y-0.5">
                <div className="px-2 py-0.5 text-[9.5px] font-mono font-medium text-muted-foreground/50 uppercase tracking-wider">
                  {group.categoryLabel}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((tool) => {
                    const Icon = tool.icon;
                    const isActive = tool.id === activeToolId;
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        onClick={() => {
                          setActiveToolId(tool.id);
                          playSound(SoundType.Click);
                        }}
                        className={cn(
                          "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-all cursor-pointer select-none active:scale-[0.98]",
                          isActive
                            ? "bg-black/5 dark:bg-white/10 text-foreground font-medium shadow-2xs"
                            : "text-muted-foreground hover:text-foreground hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                        )}
                      >
                        <Icon className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground/70")} />
                        <span className="truncate">{tool.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {filteredTools.length === 0 && (
              <div className="py-6 text-center text-xs text-muted-foreground/50">
                无匹配工具
              </div>
            )}
          </div>

          {/* 底部极简小贴士 */}
          <div className="p-2 border-t border-black/5 dark:border-white/10 text-[10px] text-muted-foreground/50 flex items-center justify-between select-none">
            <span className="font-mono">Esc 关闭</span>
            <span className="font-mono text-[9px] tabular-nums">{filteredTools.length} 项</span>
          </div>
        </div>

        {/* 右侧：主工具交互区域 */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0 bg-transparent">
          {/* 工具顶栏单行轻量标题 */}
          <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-black/5 dark:border-white/10 shrink-0 bg-black/[0.01] dark:bg-white/[0.01]">
            <div className="flex items-center gap-2 truncate">
              {(() => {
                const ActiveIcon = activeTool.icon;
                return <ActiveIcon className="h-3.5 w-3.5 text-primary/80 shrink-0" />;
              })()}
              <span className="font-medium text-xs text-foreground truncate">
                {activeTool.name}
              </span>
              <span className="text-[11px] text-muted-foreground/50 hidden sm:inline truncate">
                · {activeTool.description}
              </span>
            </div>
          </div>

          {/* 工具组件容器 */}
          <div className="flex-1 overflow-y-auto">
            <ActiveComponent initialSeed={seed} />
          </div>
        </div>
      </div>

      {/* 8 个方向拖拽手柄 (非最大化状态下) */}
      {!isMaximized && (
        <>
          <div onPointerDown={(e) => handleResizePointerDown("n", e)} className="absolute top-0 left-2 right-2 h-1 cursor-ns-resize" />
          <div onPointerDown={(e) => handleResizePointerDown("s", e)} className="absolute bottom-0 left-2 right-2 h-1 cursor-ns-resize" />
          <div onPointerDown={(e) => handleResizePointerDown("w", e)} className="absolute left-0 top-2 bottom-2 w-1 cursor-ew-resize" />
          <div onPointerDown={(e) => handleResizePointerDown("e", e)} className="absolute right-0 top-2 bottom-2 w-1 cursor-ew-resize" />
          <div onPointerDown={(e) => handleResizePointerDown("nw", e)} className="absolute top-0 left-0 w-3 h-3 cursor-nwse-resize" />
          <div onPointerDown={(e) => handleResizePointerDown("ne", e)} className="absolute top-0 right-0 w-3 h-3 cursor-nesw-resize" />
          <div onPointerDown={(e) => handleResizePointerDown("sw", e)} className="absolute bottom-0 left-0 w-3 h-3 cursor-nesw-resize" />
          <div onPointerDown={(e) => handleResizePointerDown("se", e)} className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize" />
        </>
      )}
    </div>
  );
}
