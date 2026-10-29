import { useState, useRef, useEffect, useMemo } from "react";
import { Braces, Copy, Check, X, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import { playSound, SoundType } from "@/lib/sound";
import { useTextFormatterStore } from "@/store/text-formatter-store";
import { detectFormatters } from "./text-formatters";

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;
const VIEWPORT_PADDING = 16;

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface PanelSize {
  width: number;
  height: number;
}

export function FloatingTextFormatter() {
  const { t } = useTranslation();
  const open = useTextFormatterStore((s) => s.open);
  const seed = useTextFormatterStore((s) => s.seed);
  const closeTextFormatter = useTextFormatterStore((s) => s.closeTextFormatter);

  const [input, setInput] = useState("");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<PanelSize | null>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [lastTypeKey, setLastTypeKey] = useState<string | null>(null);

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

  // 打开时注入预填充内容：终端选中文本直接格式化，无需再点按钮
  useEffect(() => {
    if (!open) return;
    setActiveId(null);
    setCopied(false);
    if (seed.trim()) {
      const f = detectFormatters(seed)[0];
      if (f) {
        setLastTypeKey(f.labelKey);
        try {
          const result = f.format(seed);
          if (result !== null && result !== seed) {
            setInput(result);
            return;
          }
        } catch {
          /* 格式化失败则原样显示 */
        }
      }
    }
    setLastTypeKey(null);
    setInput(seed);
  }, [open, seed]);

  const formatters = useMemo(() => detectFormatters(input), [input]);
  const active =
    formatters.find((f) => f.id === activeId) ?? formatters[0] ?? null;

  // 手动格式化：粘贴内容后点击按钮触发
  const handleFormat = () => {
    if (!input.trim()) return;
    const fs = detectFormatters(input);
    const f = fs.find((x) => x.id === activeId) ?? fs[0];
    if (!f) return;
    setLastTypeKey(f.labelKey);
    playSound(SoundType.Click);
    try {
      const result = f.format(input);
      if (result !== null && result !== input) {
        setInput(result);
        setCopied(false);
      }
    } catch {
      /* 格式化失败保持原样 */
    }
  };

  const handleDragStart = (e: React.PointerEvent) => {
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
      setPos({
        x: dragRef.current.startPosX + dx,
        y: dragRef.current.startPosY + dy,
      });
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

  // 8 方向拖拽调整大小
  const handleResizePointerDown = (
    direction: ResizeDirection,
    e: React.PointerEvent,
  ) => {
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
      if (!resizeRef.current) return;
      const r = resizeRef.current;
      const dx = ev.clientX - r.startX;
      const dy = ev.clientY - r.startY;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const maxW = Math.max(MIN_WIDTH, vw - VIEWPORT_PADDING * 2);
      const maxH = Math.max(MIN_HEIGHT, vh - VIEWPORT_PADDING * 2);

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

  const handleCopy = async () => {
    if (!input) return;
    try {
      await navigator.clipboard.writeText(input);
      playSound(SoundType.Click);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  };

  if (!open) return null;

  const finalPos = pos ?? getDefaultPos();
  const width = size?.width ?? DEFAULT_WIDTH;
  const height = size?.height ?? DEFAULT_HEIGHT;

  return (
    <div
      className={cn(
        "fixed z-[60] flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/95 backdrop-blur-xl shadow-[0_16px_48px_-8px_rgba(0,0,0,0.6)] select-text animate-in fade-in zoom-in-95",
        (dragging || resizing) && "transition-none select-none",
      )}
      style={{
        left: `${finalPos.x}px`,
        top: `${finalPos.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        maxWidth: `calc(100vw - ${VIEWPORT_PADDING * 2}px)`,
        maxHeight: `calc(100vh - ${VIEWPORT_PADDING * 2}px)`,
      }}
    >
      {/* Header 拖拽栏 */}
      <div
        onPointerDown={handleDragStart}
        className="flex items-center justify-between px-3 py-2.5 border-b border-border/60 select-none cursor-move shrink-0 bg-muted/30"
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <Braces className="h-4 w-4 text-sky-400" />
          <span>{t("fmt_dialog_title")}</span>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          title={t("tab_cancel_btn")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 类型 tab（多类型命中时切换） */}
      {formatters.length > 1 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2 shrink-0">
          {formatters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setActiveId(f.id);
                setCopied(false);
              }}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] transition-colors cursor-pointer border",
                active?.id === f.id
                  ? "bg-primary/15 text-primary border-primary/40 font-medium"
                  : "text-muted-foreground border-border/60 hover:bg-accent/50",
              )}
            >
              {t(f.labelKey)}
            </button>
          ))}
        </div>
      )}

      {/* 单输入框：粘贴内容，点击格式化按钮就地格式化 */}
      <div className="mx-3 mt-2.5 flex-1 min-h-0">
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setActiveId(null);
            setCopied(false);
            setLastTypeKey(null);
          }}
          placeholder={t("fmt_input_placeholder")}
          spellCheck={false}
          className="h-full w-full resize-none rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/40"
        />
      </div>

      {/* 底部操作栏 */}
      <div className="flex items-center justify-between px-3 py-2.5 border-t border-border/60 shrink-0">
        <span className="truncate text-[11px] text-muted-foreground">
          {lastTypeKey
            ? t("fmt_detected_type", { type: t(lastTypeKey) })
            : active
              ? t("fmt_detected_type", { type: t(active.labelKey) })
              : t("fmt_no_type")}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleFormat}
            disabled={!input.trim()}
            className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            title={t("fmt_format_btn_tooltip")}
          >
            <Wand2 className="h-3.5 w-3.5 text-sky-400" />
            {t("fmt_format_btn")}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!input}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? t("fmt_copied") : t("fmt_copy")}
          </button>
        </div>
      </div>

      {/* 四边 resize 手柄 */}
      <div
        className="absolute top-0 left-3 right-3 h-2 cursor-ns-resize z-20"
        onPointerDown={(e) => handleResizePointerDown("n", e)}
      />
      <div
        className="absolute bottom-0 left-3 right-3 h-2 cursor-ns-resize z-20"
        onPointerDown={(e) => handleResizePointerDown("s", e)}
      />
      <div
        className="absolute top-3 bottom-3 left-0 w-2 cursor-ew-resize z-20"
        onPointerDown={(e) => handleResizePointerDown("w", e)}
      />
      <div
        className="absolute top-3 bottom-3 right-0 w-2 cursor-ew-resize z-20"
        onPointerDown={(e) => handleResizePointerDown("e", e)}
      />

      {/* 四角 resize 手柄，右下角带视觉把手 */}
      <div
        className="absolute top-0 left-0 w-3.5 h-3.5 cursor-nwse-resize z-30"
        onPointerDown={(e) => handleResizePointerDown("nw", e)}
      />
      <div
        className="absolute top-0 right-0 w-3.5 h-3.5 cursor-nesw-resize z-30"
        onPointerDown={(e) => handleResizePointerDown("ne", e)}
      />
      <div
        className="absolute bottom-0 left-0 w-3.5 h-3.5 cursor-nesw-resize z-30"
        onPointerDown={(e) => handleResizePointerDown("sw", e)}
      />
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-30 flex items-end justify-end p-0.5"
        onPointerDown={(e) => handleResizePointerDown("se", e)}
        title={t("fmt_resize_hint")}
      >
        <svg
          viewBox="0 0 10 10"
          className="h-2.5 w-2.5 text-muted-foreground/50"
        >
          <path
            d="M9 1L1 9M9 5L5 9"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
          />
        </svg>
      </div>
    </div>
  );
}

function getDefaultPos(): { x: number; y: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  return {
    x: Math.max(
      VIEWPORT_PADDING,
      Math.round((vw - DEFAULT_WIDTH) / 2),
    ),
    y: Math.max(
      VIEWPORT_PADDING,
      Math.round((vh - DEFAULT_HEIGHT) / 4),
    ),
  };
}
