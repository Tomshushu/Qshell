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
import { DEV_TOOLS, guessBestToolId } from "./tools/tool-registry";

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

  const searchInputRef = useRef<HTMLInputElement>(null);

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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
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
        "devtools-scope fixed z-[60] flex flex-col overflow-hidden rounded-xl",
        "border border-border bg-card/95 backdrop-blur-xl shadow-xl",
        "select-text transition-[box-shadow,border-color] duration-150 ease-out",
        (dragging || resizing) && "transition-none select-none"
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
      {/* 顶部标题栏 */}
      <div
        onPointerDown={handleDragStart}
        onDoubleClick={() => setIsMaximized((m) => !m)}
        className="flex h-11 shrink-0 cursor-move select-none items-center justify-between border-b border-border bg-muted/40 px-4"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Terminal className="h-3.5 w-3.5" />
          </div>
          <span className="text-[13px] font-semibold text-foreground">开发运维工具箱</span>
          <span className="rounded-md border border-border bg-background/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            DevTools
          </span>
        </div>

        <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setIsMaximized((m) => !m)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
            title={isMaximized ? "还原窗口" : "最大化 (双击标题栏)"}
          >
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive cursor-pointer"
            title="关闭 (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 工作台双栏主体 */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 左侧：搜索与工具分类导航 */}
        <div className="flex min-h-0 w-52 shrink-0 flex-col border-r border-border bg-muted/25">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索工具..."
                className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-9 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              <button
                type="button"
                onClick={handlePasteAndJump}
                className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                title="读取剪贴板，自动跳转到对应工具"
              >
                <ClipboardPaste className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* 平铺工具列表（无需多余分类，一目了然） */}
          <div className="flex-1 space-y-1 overflow-y-auto p-2">
            {filteredTools.map((tool) => {
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
                    "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors cursor-pointer select-none",
                    isActive
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
                  )}
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                    )}
                  />
                  <span className="truncate">{tool.name}</span>
                </button>
              );
            })}

            {filteredTools.length === 0 && (
              <div className="flex flex-col items-center gap-1.5 py-10 text-center">
                <Search className="h-5 w-5 text-muted-foreground/60" />
                <span className="text-xs text-muted-foreground">没有匹配的工具</span>
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="text-xs text-primary hover:underline cursor-pointer"
                >
                  清除搜索
                </button>
              </div>
            )}
          </div>

          <div className="flex shrink-0 select-none items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            <span>Ctrl+F 搜索 · Esc 关闭</span>
            <span className="tabular-nums">{filteredTools.length} 个工具</span>
          </div>
        </div>

        {/* 右侧：主工具交互区域 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background/40">
          {!activeTool.hideHeader && (
            <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
              <div className="flex min-w-0 items-center gap-2">
                {(() => {
                  const ActiveIcon = activeTool.icon;
                  return <ActiveIcon className="h-4 w-4 shrink-0 text-primary" />;
                })()}
                <span className="truncate text-[13px] font-semibold text-foreground">
                  {activeTool.name}
                </span>
                <span className="hidden truncate text-xs text-muted-foreground md:inline">
                  — {activeTool.description}
                </span>
              </div>
              <span className="hidden shrink-0 rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground lg:inline">
                {activeTool.categoryLabel}
              </span>
            </div>
          )}

          {/* 工具组件容器 */}
          <div
            className={cn(
              "flex-1",
              activeTool.hideHeader
                ? "flex flex-col min-h-0 overflow-hidden"
                : "overflow-y-auto"
            )}
            data-devtools-content
          >
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
