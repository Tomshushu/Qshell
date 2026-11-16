import { useState, useRef, useMemo, useCallback, useLayoutEffect, useEffect } from "react";
import {
  observeElementRect,
  useVirtualizer,
  type Rect,
  type Virtualizer,
} from "@tanstack/react-virtual";
import {
  Copy,
  Check,
  ArrowRight,
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  WrapText,
  Edit3,
  CheckCircle2,
  GitCompare,
  Play,
  Binary,
  Filter,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildBinaryDiffRow,
  scanBinaryBuffersSummary,
  type BinaryDiffRow,
  type BinaryDiffSummary,
} from "@/lib/binary-diff";
import { decodeAsciiPrintable } from "@/components/ui/hex-viewer";
import {
  computeTextDiff,
  applyChunkFromLeft,
  formatBytes,
  type DiffChunk,
  type WordDiffToken,
} from "./text-diff-engine";

export interface BinaryChunkedSourceInput {
  totalSize: number;
  loadRange: (offset: number, len: number) => Promise<Uint8Array>;
}

export interface SideBySideDiffViewerProps {
  leftText?: string;
  rightText?: string;
  onUpdateRightText?: (newRightText: string) => void;
  onUpdateLeftText?: (newLeftText: string) => void;
  onSwitchToEdit?: () => void;
  mode?: "text" | "binary";
  leftBytes?: Uint8Array | null;
  rightBytes?: Uint8Array | null;
  leftBinaryChunked?: BinaryChunkedSourceInput;
  rightBinaryChunked?: BinaryChunkedSourceInput;
}

const LINE_HEIGHT = 22; // 像素，与 font-mono text-xs leading-[22px] 严格吻合
const GUTTER_WIDTH = 34; // 中间贝塞尔曲线连接带宽度
const WRAP_STORAGE_KEY = "qshell_json_diff_wrap_lines";

/**
 * 对比视图默认自动换行，与编辑区 textarea 的软换行排版保持一致：
 * 避免长日志 / 单行长 JSON 在切换「对比」后被挤成一整行，丢失用户原有阅读格式。
 * 用户仍可通过「换行」按钮关闭，偏好会持久化。
 */
function loadWrapLinesPreference(): boolean {
  try {
    const saved = localStorage.getItem(WRAP_STORAGE_KEY);
    if (saved !== null) return saved === "true";
  } catch {
    /* ignore */
  }
  return true;
}

function TextSideBySideDiffViewer({
  leftText = "",
  rightText = "",
  onUpdateRightText,
  onUpdateLeftText,
  onSwitchToEdit,
}: SideBySideDiffViewerProps) {
  const [copiedLeft, setCopiedLeft] = useState(false);
  const [copiedRight, setCopiedRight] = useState(false);
  const [wrapLines, setWrapLines] = useState<boolean>(loadWrapLinesPreference);
  const [activeChunkIndex, setActiveChunkIndex] = useState<number>(0);

  const copyLeftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyRightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copyLeftTimerRef.current) clearTimeout(copyLeftTimerRef.current);
      if (copyRightTimerRef.current) clearTimeout(copyRightTimerRef.current);
    };
  }, []);

  // 计算差异结果
  const diffResult = useMemo(() => {
    return computeTextDiff(leftText, rightText);
  }, [leftText, rightText]);

  const leftLines = useMemo(() => (leftText ? leftText.split(/\r?\n/) : []), [leftText]);
  const rightLines = useMemo(() => (rightText ? rightText.split(/\r?\n/) : []), [rightText]);
  const rowCount = Math.max(leftLines.length, rightLines.length);

  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const gutterScrollRef = useRef<HTMLDivElement>(null);
  const isSyncingScroll = useRef(false);

  const leftContentRefs = useRef(new Map<number, HTMLDivElement>());
  const rightContentRefs = useRef(new Map<number, HTMLDivElement>());
  const measuredHeightsRef = useRef(new Map<number, number>());

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => leftScrollRef.current,
    estimateSize: (idx) =>
      wrapLines ? (measuredHeightsRef.current.get(idx) ?? LINE_HEIGHT) : LINE_HEIGHT,
    overscan: 15,
    initialRect: { width: 800, height: 480 },
    // jsdom 下未 mock offsetHeight 时为 0，回退默认视口尺寸以保证无头测试与首屏兼容
    observeElementRect: (
      instance: Virtualizer<HTMLDivElement, Element>,
      cb: (rect: Rect) => void,
    ) =>
      observeElementRect(instance, (rect) => {
        cb(
          rect.height > 0
            ? rect
            : { width: rect.width > 0 ? rect.width : 800, height: 480 },
        );
      }),
    measureElement: (el) => {
      if (!wrapLines) return LINE_HEIGHT;
      const idxAttr = el.getAttribute("data-index");
      const idx = idxAttr !== null ? Number(idxAttr) : -1;
      if (idx < 0) return LINE_HEIGHT;
      const lh = leftContentRefs.current.get(idx)?.offsetHeight ?? 0;
      const rh = rightContentRefs.current.get(idx)?.offsetHeight ?? 0;
      const h = Math.max(LINE_HEIGHT, lh, rh);
      measuredHeightsRef.current.set(idx, h);
      return h;
    },
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const virtualRangeKey =
    virtualItems.length > 0
      ? `${virtualItems[0].index}:${virtualItems[virtualItems.length - 1].index}`
      : "";

  // 文本或换行模式变化时清空行高缓存并重测可视区
  useLayoutEffect(() => {
    measuredHeightsRef.current.clear();
    rowVirtualizer.measure();
  }, [wrapLines, leftText, rightText, rowVirtualizer]);

  /**
   * 仅对当前挂载的可视行同步左右最大高度与监听宽度变化，
   * 彻底消除大文件下的 2 * rowCount DOM 与 ResizeObserver 膨胀。
   */
  useLayoutEffect(() => {
    if (!wrapLines) return;

    const syncMountedRows = () => {
      for (const item of virtualItems) {
        const idx = item.index;
        const lh = leftContentRefs.current.get(idx)?.offsetHeight ?? 0;
        const rh = rightContentRefs.current.get(idx)?.offsetHeight ?? 0;
        const maxH = Math.max(LINE_HEIGHT, lh, rh);
        const prevH = measuredHeightsRef.current.get(idx);
        if (prevH !== maxH) {
          measuredHeightsRef.current.set(idx, maxH);
          rowVirtualizer.resizeItem(idx, maxH);
        }
      }
    };

    syncMountedRows();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const idxAttr = (entry.target as HTMLElement).dataset.rowIdx;
        const idx = idxAttr !== undefined ? Number(idxAttr) : -1;
        if (idx < 0) continue;
        const lh = leftContentRefs.current.get(idx)?.offsetHeight ?? 0;
        const rh = rightContentRefs.current.get(idx)?.offsetHeight ?? 0;
        const maxH = Math.max(LINE_HEIGHT, lh, rh);
        if (measuredHeightsRef.current.get(idx) !== maxH) {
          measuredHeightsRef.current.set(idx, maxH);
          rowVirtualizer.resizeItem(idx, maxH);
        }
      }
    });

    for (const item of virtualItems) {
      const lEl = leftContentRefs.current.get(item.index);
      const rEl = rightContentRefs.current.get(item.index);
      if (lEl) observer.observe(lEl);
      if (rEl) observer.observe(rEl);
    }

    return () => observer.disconnect();
  }, [wrapLines, virtualRangeKey, virtualItems, rowVirtualizer]);

  const totalContentHeight = rowVirtualizer.getTotalSize() + 80;

  // 左右与中间连接带三方联动滚动
  const handleScrollLeft = useCallback(() => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (leftScrollRef.current) {
      const top = leftScrollRef.current.scrollTop;
      if (rightScrollRef.current) rightScrollRef.current.scrollTop = top;
      if (gutterScrollRef.current) gutterScrollRef.current.scrollTop = top;
    }
    requestAnimationFrame(() => {
      isSyncingScroll.current = false;
    });
  }, []);

  const handleScrollRight = useCallback(() => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;
    if (rightScrollRef.current) {
      const top = rightScrollRef.current.scrollTop;
      if (leftScrollRef.current) leftScrollRef.current.scrollTop = top;
      if (gutterScrollRef.current) gutterScrollRef.current.scrollTop = top;
    }
    requestAnimationFrame(() => {
      isSyncingScroll.current = false;
    });
  }, []);

  // 跳转到指定差异块
  const scrollToChunk = useCallback(
    (index: number) => {
      if (!diffResult.chunks.length) return;
      const targetIdx = (index + diffResult.chunks.length) % diffResult.chunks.length;
      setActiveChunkIndex(targetIdx);
      const chunk = diffResult.chunks[targetIdx];
      const lineIdx = Math.max(0, Math.min(chunk.leftStartLine - 1, Math.max(0, rowCount - 1)));
      const offsetPair = rowVirtualizer.getOffsetForIndex(lineIdx, "start");
      const rawTop = offsetPair ? offsetPair[0] : lineIdx * LINE_HEIGHT;
      const topVal = Math.max(0, rawTop - 40);
      if (leftScrollRef.current) {
        leftScrollRef.current.scrollTo?.({ top: topVal, behavior: "smooth" });
      }
      if (rightScrollRef.current) {
        rightScrollRef.current.scrollTo?.({ top: topVal, behavior: "smooth" });
      }
      if (gutterScrollRef.current) {
        gutterScrollRef.current.scrollTo?.({ top: topVal, behavior: "smooth" });
      }
    },
    [diffResult.chunks, rowCount, rowVirtualizer]
  );

  // 复制功能
  const handleCopyLeft = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(leftText);
      if (!mountedRef.current) return;
      setCopiedLeft(true);
      if (copyLeftTimerRef.current) clearTimeout(copyLeftTimerRef.current);
      copyLeftTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setCopiedLeft(false);
      }, 1500);
    } catch {
      // clipboard unavailable
    }
  }, [leftText]);

  const handleCopyRight = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(rightText);
      if (!mountedRef.current) return;
      setCopiedRight(true);
      if (copyRightTimerRef.current) clearTimeout(copyRightTimerRef.current);
      copyRightTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setCopiedRight(false);
      }, 1500);
    } catch {
      // clipboard unavailable
    }
  }, [rightText]);

  // 合并单个差异块到右侧
  const handleApplyChunk = useCallback(
    (chunk: DiffChunk) => {
      if (!onUpdateRightText) return;
      const updated = applyChunkFromLeft(leftText, rightText, chunk);
      onUpdateRightText(updated);
    },
    [leftText, rightText, onUpdateRightText]
  );

  // 全部同步到右侧
  const handleApplyAll = useCallback(() => {
    if (onUpdateRightText) {
      onUpdateRightText(leftText);
    }
  }, [leftText, onUpdateRightText]);

  // 左右互换
  const handleSwap = useCallback(() => {
    if (onUpdateLeftText && onUpdateRightText) {
      const prevLeft = leftText;
      onUpdateLeftText(rightText);
      onUpdateRightText(prevLeft);
    }
  }, [leftText, rightText, onUpdateLeftText, onUpdateRightText]);

  // 切换自动换行并记住偏好
  const handleToggleWrap = useCallback(() => {
    const next = !wrapLines;
    setWrapLines(next);
    try {
      localStorage.setItem(WRAP_STORAGE_KEY, String(next));
    } catch {
      /* ignore */
    }
  }, [wrapLines]);

  // 构建差异块映射表以便行渲染查询
  const chunkMap = useMemo(() => {
    const leftMap = new Map<number, DiffChunk>();
    const rightMap = new Map<number, DiffChunk>();
    for (const chunk of diffResult.chunks) {
      if (chunk.leftLineCount > 0) {
        for (let l = chunk.leftStartLine; l <= chunk.leftEndLine; l++) {
          leftMap.set(l, chunk);
        }
      }
      if (chunk.rightLineCount > 0) {
        for (let r = chunk.rightStartLine; r <= chunk.rightEndLine; r++) {
          rightMap.set(r, chunk);
        }
      }
    }
    return { leftMap, rightMap };
  }, [diffResult.chunks]);

  // 计算每行单词差异高亮缓存
  const wordDiffMap = useMemo(() => {
    const lTokens = new Map<number, WordDiffToken[]>();
    const rTokens = new Map<number, WordDiffToken[]>();

    for (const line of diffResult.lines) {
      if (line.leftLineNumber && line.leftTokens) {
        lTokens.set(line.leftLineNumber, line.leftTokens);
      }
      if (line.rightLineNumber && line.rightTokens) {
        rTokens.set(line.rightLineNumber, line.rightTokens);
      }
    }
    return { lTokens, rTokens };
  }, [diffResult.lines]);

  // 计算当前可视窗附近的中间连接贝塞尔曲线路径
  const connectorPaths = useMemo(() => {
    const paths: { d: string; type: DiffChunk["type"]; id: string; isActive: boolean }[] = [];
    const w = GUTTER_WIDTH;
    const measurements = rowVirtualizer.measurementsCache;
    const totalSize = rowVirtualizer.getTotalSize();

    const offsetAt = (line: number) => {
      if (line <= 0) return 0;
      if (line >= rowCount) return totalSize;
      return measurements[line]?.start ?? line * LINE_HEIGHT;
    };

    const visStartY =
      virtualItems.length > 0 ? Math.max(0, virtualItems[0].start - 200) : 0;
    const visEndY =
      virtualItems.length > 0
        ? virtualItems[virtualItems.length - 1].end + 200
        : totalSize;

    diffResult.chunks.forEach((chunk, idx) => {
      // 左右区间 Y 均按虚拟化行偏移计算，换行模式下连接带仍严格贴合差异块
      const topL = offsetAt(chunk.leftStartLine - 1);
      const bottomL = chunk.leftLineCount > 0 ? offsetAt(chunk.leftEndLine) : topL + 3;

      const topR = offsetAt(chunk.rightStartLine - 1);
      const bottomR = chunk.rightLineCount > 0 ? offsetAt(chunk.rightEndLine) : topR + 3;

      const minY = Math.min(topL, topR);
      const maxY = Math.max(bottomL, bottomR);
      if (diffResult.chunks.length > 200 && (maxY < visStartY || minY > visEndY)) {
        return;
      }

      const cp1x = w * 0.45;
      const cp2x = w * 0.55;

      const d = `
        M 0 ${topL}
        C ${cp1x} ${topL}, ${cp2x} ${topR}, ${w} ${topR}
        L ${w} ${bottomR}
        C ${cp2x} ${bottomR}, ${cp1x} ${bottomL}, 0 ${bottomL}
        Z
      `;

      paths.push({
        d,
        type: chunk.type,
        id: chunk.id,
        isActive: idx === activeChunkIndex,
      });
    });

    return paths;
  }, [diffResult.chunks, activeChunkIndex, rowVirtualizer, rowCount, virtualItems]);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-background">
      {/* 顶部差异比对工具栏 */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/80 bg-muted/20 px-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 font-semibold text-foreground text-xs">
            <GitCompare className="h-3.5 w-3.5 text-primary" />
            <span>并排差异比对 (Side-by-Side)</span>
          </span>

          {diffResult.isIdentical ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              <CheckCircle2 className="h-3 w-3" />
              <span>两边完全一致</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
              <span>{diffResult.diffCount} 处差异</span>
            </span>
          )}

          {diffResult.chunks.length > 0 && (
            <div className="flex items-center gap-1 ml-2 text-muted-foreground">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 hover:text-foreground cursor-pointer"
                onClick={() => scrollToChunk(activeChunkIndex - 1)}
                title="跳转到上一处差异"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[11px] tabular-nums font-mono">
                {activeChunkIndex + 1}/{diffResult.chunks.length}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 hover:text-foreground cursor-pointer"
                onClick={() => scrollToChunk(activeChunkIndex + 1)}
                title="跳转到下一处差异"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-7 px-2 text-xs gap-1 cursor-pointer",
              wrapLines ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={handleToggleWrap}
            title="切换代码自动换行（默认自动换行，完整保留编辑区排版）"
          >
            <WrapText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">换行</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer gap-1"
            onClick={handleSwap}
            title="左右两侧内容互换"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">互换</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-primary hover:text-primary cursor-pointer gap-1"
            onClick={handleApplyAll}
            title="将左侧全部内容覆写同步到右侧"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            <span>全量同步</span>
          </Button>

          {onSwitchToEdit && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs gap-1 font-medium cursor-pointer shadow-2xs ml-1"
              onClick={onSwitchToEdit}
              title="返回编辑模式修改文本"
            >
              <Edit3 className="h-3.5 w-3.5" />
              <span>返回编辑</span>
            </Button>
          )}
        </div>
      </div>

      {/* 左右双栏并排主视口 */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* 左侧栏 (原始 / 左侧) */}
        <div className="flex flex-1 min-w-0 flex-col border-r border-border/80">
          {/* 左侧顶栏状态条 (与用户截图吻合: 1.4 KB · 3 行) */}
          <div className="flex h-7 shrink-0 items-center justify-between border-b border-border/60 bg-muted/30 px-3 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500" />
              <span className="font-mono text-foreground/90 font-medium">
                {formatBytes(diffResult.leftByteSize)} · {diffResult.leftLineCount} 行
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleCopyLeft}
                className="hover:text-foreground p-0.5 rounded cursor-pointer"
                title="复制左侧文本"
              >
                {copiedLeft ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          </div>

          {/* 左侧行内容滚动区（虚拟化） */}
          <div
            ref={leftScrollRef}
            onScroll={handleScrollLeft}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-auto font-mono text-xs leading-[22px] select-text"
          >
            <div style={{ height: totalContentHeight, minWidth: "100%", position: "relative" }}>
              {virtualItems.map((virtualRow) => {
                const idx = virtualRow.index;
                if (idx >= leftLines.length) return null;
                const lineText = leftLines[idx];
                const lineNum = idx + 1;
                const chunk = chunkMap.leftMap.get(lineNum);
                const isModified = !!chunk;
                const tokens = wordDiffMap.lTokens.get(lineNum);
                const isChunkFirstLine = chunk && chunk.leftStartLine === lineNum;

                return (
                  <div
                    key={`l-${lineNum}`}
                    data-index={idx}
                    ref={wrapLines ? rowVirtualizer.measureElement : undefined}
                    className={cn(
                      "flex min-w-full group",
                      isModified
                        ? "bg-rose-500/10 dark:bg-rose-950/25 text-rose-950 dark:text-rose-100"
                        : "hover:bg-muted/40 text-foreground"
                    )}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      minWidth: "100%",
                      width: wrapLines ? "100%" : "max-content",
                      height: wrapLines ? virtualRow.size : LINE_HEIGHT,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {/* 行号与操作箭头区 (用户截图中行号旁边的 ▶ 操作块) */}
                    <div className="w-14 shrink-0 flex items-center justify-between px-2 select-none border-r border-border/50 bg-muted/15 text-[11px] text-muted-foreground font-mono">
                      <span>{lineNum}</span>
                      {isChunkFirstLine && (
                        <button
                          type="button"
                          onClick={() => handleApplyChunk(chunk)}
                          className="h-4 w-4 inline-flex items-center justify-center rounded text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 active:scale-90 transition-transform cursor-pointer"
                          title="将此差异块应用同步到右侧 (▶)"
                        >
                          <Play className="h-2.5 w-2.5 fill-current" />
                        </button>
                      )}
                    </div>

                    {/* 行文本内容：pre-wrap 保留原有空格与换行，按窗口宽度软换行 */}
                    <div
                      className={cn(
                        "flex-1 min-w-0 px-3 py-0",
                        wrapLines ? "whitespace-pre-wrap break-words" : "whitespace-pre"
                      )}
                    >
                      <div
                        data-row-idx={idx}
                        ref={(el) => {
                          if (el) leftContentRefs.current.set(idx, el);
                          else leftContentRefs.current.delete(idx);
                        }}
                      >
                        {tokens && tokens.length > 0 ? (
                          tokens.map((tok, tIdx) => (
                            <span
                              key={tIdx}
                              className={cn(
                                tok.type === "removed" &&
                                  "bg-rose-500/30 dark:bg-rose-500/40 text-rose-950 dark:text-rose-50 rounded-xs font-semibold"
                              )}
                            >
                              {tok.text}
                            </span>
                          ))
                        ) : (
                          <span>{lineText || " "}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 中间贝塞尔曲线连接带 (SVG Bezier Connector，随滚动同步) */}
        <div
          ref={gutterScrollRef}
          className="relative shrink-0 overflow-hidden select-none bg-muted/10 border-r border-border/80"
          style={{ width: GUTTER_WIDTH }}
        >
          <div style={{ height: totalContentHeight, position: "relative" }}>
            <svg
              className="absolute inset-0 pointer-events-none"
              style={{ width: GUTTER_WIDTH, height: totalContentHeight }}
            >
              {connectorPaths.map((cp) => (
                <path
                  key={cp.id}
                  d={cp.d}
                  className={cn(
                    "transition-colors",
                    cp.type === "delete"
                      ? "fill-rose-500/15 stroke-rose-500/40"
                      : cp.type === "insert"
                      ? "fill-emerald-500/15 stroke-emerald-500/40"
                      : "fill-amber-500/15 stroke-amber-500/40"
                  )}
                  strokeWidth={1}
                />
              ))}
            </svg>
          </div>
        </div>

        {/* 右侧栏 (对比 / 目标) */}
        <div className="flex flex-1 min-w-0 flex-col">
          {/* 右侧顶栏状态条 (与用户截图吻合: 1.1 KB · 2 行) */}
          <div className="flex h-7 shrink-0 items-center justify-between border-b border-border/60 bg-muted/30 px-3 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="font-mono text-foreground/90 font-medium">
                {formatBytes(diffResult.rightByteSize)} · {diffResult.rightLineCount} 行
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleCopyRight}
                className="hover:text-foreground p-0.5 rounded cursor-pointer"
                title="复制右侧文本"
              >
                {copiedRight ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          </div>

          {/* 右侧行内容滚动区（虚拟化） */}
          <div
            ref={rightScrollRef}
            onScroll={handleScrollRight}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-auto font-mono text-xs leading-[22px] select-text"
          >
            <div style={{ height: totalContentHeight, minWidth: "100%", position: "relative" }}>
              {virtualItems.map((virtualRow) => {
                const idx = virtualRow.index;
                if (idx >= rightLines.length) return null;
                const lineText = rightLines[idx];
                const lineNum = idx + 1;
                const chunk = chunkMap.rightMap.get(lineNum);
                const isModified = !!chunk;
                const tokens = wordDiffMap.rTokens.get(lineNum);

                return (
                  <div
                    key={`r-${lineNum}`}
                    className={cn(
                      "flex min-w-full group",
                      isModified
                        ? "bg-emerald-500/10 dark:bg-emerald-950/25 text-emerald-950 dark:text-emerald-100"
                        : "hover:bg-muted/40 text-foreground"
                    )}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      minWidth: "100%",
                      width: wrapLines ? "100%" : "max-content",
                      height: wrapLines ? virtualRow.size : LINE_HEIGHT,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {/* 行号区 */}
                    <div className="w-12 shrink-0 flex items-center justify-between px-2 select-none border-r border-border/50 bg-muted/15 text-[11px] text-muted-foreground font-mono">
                      <span>{lineNum}</span>
                    </div>

                    {/* 行文本内容：pre-wrap 保留原有空格与换行，按窗口宽度软换行 */}
                    <div
                      className={cn(
                        "flex-1 min-w-0 px-3 py-0",
                        wrapLines ? "whitespace-pre-wrap break-words" : "whitespace-pre"
                      )}
                    >
                      <div
                        data-row-idx={idx}
                        ref={(el) => {
                          if (el) rightContentRefs.current.set(idx, el);
                          else rightContentRefs.current.delete(idx);
                        }}
                      >
                        {tokens && tokens.length > 0 ? (
                          tokens.map((tok, tIdx) => (
                            <span
                              key={tIdx}
                              className={cn(
                                tok.type === "added" &&
                                  "bg-emerald-500/30 dark:bg-emerald-500/40 text-emerald-950 dark:text-emerald-50 rounded-xs font-semibold"
                              )}
                            >
                              {tok.text}
                            </span>
                          ))
                        ) : (
                          <span>{lineText || " "}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const BINARY_BYTES_PER_ROW = 16;
const BINARY_PAGE_SIZE = 100;
const BINARY_WINDOW_BYTES = 1024 * 1024;

function formatOffsetHex(offset: number): string {
  const safe = Math.max(0, Math.floor(offset));
  const width = safe > 0xffffffff ? 12 : 8;
  return safe.toString(16).toUpperCase().padStart(width, "0");
}

interface BinarySideCellsProps {
  bytes: Uint8Array;
  changedMask: boolean[];
  side: "left" | "right";
  bytesPerRow?: number;
}

function BinarySideCells({
  bytes,
  changedMask,
  side,
  bytesPerRow = BINARY_BYTES_PER_ROW,
}: BinarySideCellsProps) {
  const highlightClass =
    side === "left"
      ? "bg-rose-500/25 text-rose-700 dark:text-rose-300 font-semibold"
      : "bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 font-semibold";
  const asciiText = decodeAsciiPrintable(bytes);

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex shrink-0 items-center font-mono text-xs">
        {Array.from({ length: bytesPerRow }).map((_, colIdx) => {
          const hasByte = colIdx < bytes.length;
          const isChanged = colIdx < changedMask.length && changedMask[colIdx];
          const gapClass = bytesPerRow === 16 && colIdx === 8 ? "ml-2.5" : "ml-1";

          if (!hasByte && !isChanged) {
            return (
              <span
                key={colIdx}
                className={cn("inline-block w-[2ch] text-center", colIdx > 0 && gapClass)}
              >
                {"  "}
              </span>
            );
          }

          const cellText = hasByte
            ? bytes[colIdx].toString(16).toUpperCase().padStart(2, "0")
            : "--";

          return (
            <span
              key={colIdx}
              data-changed={isChanged ? "true" : undefined}
              className={cn(
                "inline-block w-[2ch] text-center rounded-xs",
                colIdx > 0 && gapClass,
                !hasByte && "text-muted-foreground/50",
                isChanged && highlightClass,
              )}
            >
              {cellText}
            </span>
          );
        })}
      </div>

      <span className="text-border select-none">|</span>

      <div className="flex shrink-0 items-center font-mono text-xs">
        {Array.from({ length: bytesPerRow }).map((_, colIdx) => {
          const hasByte = colIdx < bytes.length;
          const isChanged = colIdx < changedMask.length && changedMask[colIdx];
          if (!hasByte) {
            return (
              <span
                key={colIdx}
                className={cn(
                  "inline-block w-[1ch] text-center text-muted-foreground/40",
                  isChanged && highlightClass,
                )}
              >
                {isChanged ? "." : " "}
              </span>
            );
          }
          return (
            <span
              key={colIdx}
              className={cn(
                "inline-block w-[1ch] text-center rounded-xs",
                isChanged
                  ? highlightClass
                  : "text-emerald-600/80 dark:text-emerald-400/80",
              )}
            >
              {asciiText[colIdx]}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function BinarySideBySideDiffViewer({
  leftBytes,
  rightBytes,
  leftBinaryChunked,
  rightBinaryChunked,
}: SideBySideDiffViewerProps) {
  const [summary, setSummary] = useState<BinaryDiffSummary | null>(null);
  const [windowBuffers, setWindowBuffers] = useState<{
    left: Uint8Array;
    right: Uint8Array;
    windowOffset: number;
  } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyDifferences, setOnlyDifferences] = useState<boolean>(false);
  const [page, setPage] = useState<number>(0);
  const [activeDiffCursor, setActiveDiffCursor] = useState<number>(0);
  const [activeDiffOffset, setActiveDiffOffset] = useState<number | null>(null);
  const [windowState, setWindowState] = useState({
    left: leftBinaryChunked,
    right: rightBinaryChunked,
    leftB: leftBytes,
    rightB: rightBytes,
    offset: 0,
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const hasChunked = Boolean(leftBinaryChunked || rightBinaryChunked);
  const totalLeft = leftBinaryChunked
    ? Math.max(0, Math.floor(leftBinaryChunked.totalSize))
    : (leftBytes?.byteLength ?? 0);
  const totalRight = rightBinaryChunked
    ? Math.max(0, Math.floor(rightBinaryChunked.totalSize))
    : (rightBytes?.byteLength ?? 0);
  const maxTotalSize = Math.max(totalLeft, totalRight);

  const windowOffset =
    windowState.left === leftBinaryChunked &&
    windowState.right === rightBinaryChunked &&
    windowState.leftB === leftBytes &&
    windowState.rightB === rightBytes
      ? windowState.offset
      : 0;

  const updateWindowOffset = useCallback(
    (updater: (prev: number) => number) => {
      setWindowState((prev) => {
        const currentOffset =
          prev.left === leftBinaryChunked &&
          prev.right === rightBinaryChunked &&
          prev.leftB === leftBytes &&
          prev.rightB === rightBytes
            ? prev.offset
            : 0;
        // 最后一个可读窗口的起点 = 小于文件总大小的最大整窗口倍数。
        // 用 floor((size-1)/window) 会在 1MB<size<2MB 时得到 0，导致尾部字节永远无法翻页查看。
        const maxStart =
          maxTotalSize > 0
            ? Math.max(0, Math.ceil(maxTotalSize / BINARY_WINDOW_BYTES) - 1) *
              BINARY_WINDOW_BYTES
            : 0;
        const nextOffset = Math.max(0, Math.min(maxStart, updater(currentOffset)));
        return {
          left: leftBinaryChunked,
          right: rightBinaryChunked,
          leftB: leftBytes,
          rightB: rightBytes,
          offset: nextOffset,
        };
      });
    },
    [leftBinaryChunked, rightBinaryChunked, leftBytes, rightBytes, maxTotalSize],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setProgress(null);

    const run = async () => {
      try {
        let targetLeft: Uint8Array;
        let targetRight: Uint8Array;
        const targetOffset = hasChunked ? windowOffset : 0;

        if (hasChunked) {
          const readWindowSlice = async (
            bytes: Uint8Array | null | undefined,
            chunked: BinaryChunkedSourceInput | undefined,
          ): Promise<Uint8Array> => {
            if (chunked) {
              const remaining = Math.max(
                0,
                Math.floor(chunked.totalSize) - windowOffset,
              );
              const len = Math.min(BINARY_WINDOW_BYTES, remaining);
              if (len <= 0) return new Uint8Array(0);
              const chunk = await chunked.loadRange(windowOffset, len);
              return chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
            }
            const view = bytes ?? new Uint8Array(0);
            if (windowOffset >= view.byteLength) return new Uint8Array(0);
            return view.subarray(
              windowOffset,
              Math.min(view.byteLength, windowOffset + BINARY_WINDOW_BYTES),
            );
          };

          const [leftSlice, rightSlice] = await Promise.all([
            readWindowSlice(leftBytes, leftBinaryChunked),
            readWindowSlice(rightBytes, rightBinaryChunked),
          ]);
          if (controller.signal.aborted) return;
          targetLeft = leftSlice;
          targetRight = rightSlice;
        } else {
          targetLeft = leftBytes ?? new Uint8Array(0);
          targetRight = rightBytes ?? new Uint8Array(0);
        }

        const nextSummary = await scanBinaryBuffersSummary(targetLeft, targetRight, {
          bytesPerRow: BINARY_BYTES_PER_ROW,
          signal: controller.signal,
          onProgress: (processed, total) => {
            if (!controller.signal.aborted) {
              setProgress({ processed, total });
            }
          },
        });
        if (controller.signal.aborted) return;

        setWindowBuffers({
          left: targetLeft,
          right: targetRight,
          windowOffset: targetOffset,
        });
        setSummary(nextSummary);
        setPage(0);
        setActiveDiffCursor(0);
        setActiveDiffOffset(null);
        setLoading(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    };

    void run();

    return () => {
      controller.abort();
    };
  }, [
    hasChunked,
    leftBytes,
    rightBytes,
    leftBinaryChunked,
    rightBinaryChunked,
    windowOffset,
    totalLeft,
    totalRight,
  ]);

  const activeTotalRows = useMemo(() => {
    if (!summary) return 0;
    return onlyDifferences ? summary.changedRowIndices.length : summary.totalRows;
  }, [summary, onlyDifferences]);

  const totalPages =
    activeTotalRows === 0 ? 0 : Math.ceil(activeTotalRows / BINARY_PAGE_SIZE);
  const safePage =
    totalPages === 0 ? 0 : Math.max(0, Math.min(totalPages - 1, page));

  // 仅对当前可见页（最多 100 行 * 16 字节 = 1,600 字节）懒构建 BinaryDiffRow[]
  const pageRows = useMemo<BinaryDiffRow[]>(() => {
    if (!summary || !windowBuffers || activeTotalRows === 0) return [];
    const startIdx = safePage * BINARY_PAGE_SIZE;
    const endIdx = Math.min(activeTotalRows, startIdx + BINARY_PAGE_SIZE);
    const rows: BinaryDiffRow[] = [];
    for (let i = startIdx; i < endIdx; i++) {
      const rowIndex = onlyDifferences ? summary.changedRowIndices[i] : i;
      rows.push(
        buildBinaryDiffRow(
          windowBuffers.left,
          windowBuffers.right,
          rowIndex,
          BINARY_BYTES_PER_ROW,
          windowBuffers.windowOffset,
        ),
      );
    }
    return rows;
  }, [summary, windowBuffers, activeTotalRows, safePage, onlyDifferences]);

  const diffCount = summary?.changedRowIndices.length ?? 0;

  const handleToggleOnlyDifferences = useCallback(() => {
    setOnlyDifferences((prev) => !prev);
    setPage(0);
    setActiveDiffCursor(0);
    setActiveDiffOffset(null);
  }, []);

  const handleJumpNextDiff = useCallback(() => {
    if (!summary || summary.changedRowIndices.length === 0) return;
    const nextCursor =
      activeDiffOffset === null
        ? 0
        : (activeDiffCursor + 1) % summary.changedRowIndices.length;
    const targetRowIdx = summary.changedRowIndices[nextCursor];
    const displayIdx = onlyDifferences ? nextCursor : targetRowIdx;
    const targetPage = Math.floor(displayIdx / BINARY_PAGE_SIZE);
    const targetOffset =
      (windowBuffers?.windowOffset ?? windowOffset) +
      targetRowIdx * BINARY_BYTES_PER_ROW;

    setActiveDiffCursor(nextCursor);
    setPage(targetPage);
    setActiveDiffOffset(targetOffset);

    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const el = container.querySelector<HTMLElement>(
        `[data-diff-offset="${targetOffset}"]`,
      );
      el?.scrollIntoView?.({ block: "nearest" });
    });
  }, [
    summary,
    activeDiffOffset,
    activeDiffCursor,
    onlyDifferences,
    windowBuffers,
    windowOffset,
  ]);

  const isPartialWindow =
    hasChunked && (maxTotalSize > BINARY_WINDOW_BYTES || windowOffset > 0);
  const windowMaxLen = summary
    ? Math.max(summary.totalLeft, summary.totalRight)
    : 0;
  const isWindowIdentical = summary ? summary.diffBytes === 0 : false;
  const isFullIdentical =
    summary !== null && summary.diffBytes === 0 && !isPartialWindow && totalLeft === totalRight;
  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : null;
  const windowEnd = Math.min(maxTotalSize, windowOffset + BINARY_WINDOW_BYTES);
  const windowRangeLabel = `0x${windowOffset.toString(16).toUpperCase()} - 0x${windowEnd.toString(16).toUpperCase()}`;

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-background">
      {/* 顶部二进制差异工具栏 */}
      <div className="flex flex-wrap min-h-9 shrink-0 items-center justify-between gap-2 border-b border-border/80 bg-muted/20 px-3 py-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 font-semibold text-foreground text-xs">
            <Binary className="h-3.5 w-3.5 text-primary" />
            <span>二进制差异比对 (Hex Diff)</span>
          </span>

          {summary && (
            <>
              {isPartialWindow ? (
                isWindowIdentical ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>
                      {totalLeft === totalRight
                        ? "当前窗口一致"
                        : "当前窗口一致（总大小不同）"}
                    </span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full tabular-nums">
                    <span>当前窗口差异 {summary.diffBytes} B</span>
                  </span>
                )
              ) : isFullIdentical ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>两边完全一致</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full tabular-nums">
                  <span>差异 {summary.diffBytes} B</span>
                </span>
              )}

              <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                {isPartialWindow
                  ? `窗口 (${formatBytes(windowMaxLen)}) 相同: ${summary.equalBytes} B (${formatBytes(summary.equalBytes)}) · 差异: ${summary.diffBytes} B`
                  : `相同: ${summary.equalBytes} B (${formatBytes(summary.equalBytes)}) · 差异: ${summary.diffBytes} B`}
              </span>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={onlyDifferences}
            onClick={handleToggleOnlyDifferences}
            disabled={loading || !summary}
            className={cn(
              "h-7 px-2 text-xs gap-1 cursor-pointer",
              onlyDifferences
                ? "bg-primary/15 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            <span>仅显示差异</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleJumpNextDiff}
            disabled={loading || diffCount === 0}
            className="h-7 px-2 text-xs gap-1 cursor-pointer"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            <span>下一处差异</span>
          </Button>

          {totalPages > 0 && (
            <div className="flex items-center gap-1 ml-1 text-muted-foreground">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 cursor-pointer"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage <= 0}
                aria-label="上一页"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[11px] font-mono tabular-nums">
                {safePage + 1}/{totalPages}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 cursor-pointer"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                aria-label="下一页"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* 分块比对分段导航条 */}
      {hasChunked && maxTotalSize > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-1 text-[11px]">
          <span className="font-mono text-muted-foreground tabular-nums">
            分段偏移: {windowRangeLabel}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px] gap-0.5 cursor-pointer"
              onClick={() => updateWindowOffset((o) => o - BINARY_WINDOW_BYTES)}
              disabled={loading || windowOffset <= 0}
            >
              <ChevronLeft className="h-3 w-3" />
              <span>上一分段</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px] gap-0.5 cursor-pointer"
              onClick={() => updateWindowOffset((o) => o + BINARY_WINDOW_BYTES)}
              disabled={loading || windowOffset + BINARY_WINDOW_BYTES >= maxTotalSize}
            >
              <span>下一分段</span>
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* 左右文件字节总览条（明确区分总大小与当前分段窗口） */}
      {summary && (
        <div className="grid grid-cols-2 shrink-0 border-b border-border/60 bg-muted/30 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2 px-3 py-1 border-r border-border/60">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500" />
            <span className="font-mono text-foreground/90 font-medium tabular-nums">
              {isPartialWindow
                ? `左侧总大小: ${formatBytes(totalLeft)} (${totalLeft} B) · 当前窗口: ${formatBytes(summary.totalLeft)}`
                : `左侧: ${formatBytes(totalLeft)} (${totalLeft} B)`}
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="font-mono text-foreground/90 font-medium tabular-nums">
              {isPartialWindow
                ? `右侧总大小: ${formatBytes(totalRight)} (${totalRight} B) · 当前窗口: ${formatBytes(summary.totalRight)}`
                : `右侧: ${formatBytes(totalRight)} (${totalRight} B)`}
            </span>
          </div>
        </div>
      )}

      {/* 主体内容区 */}
      {loading ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span>
            正在执行二进制字节比对{progressPct !== null ? ` (${progressPct}%)` : "..."}
          </span>
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-xs text-destructive">
          <AlertCircle className="h-5 w-5" />
          <span>二进制比对失败: {error}</span>
        </div>
      ) : pageRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-xs text-muted-foreground">
          {onlyDifferences
            ? "未发现字节差异，所有内容均一致"
            : "文件内容为空（0 字节）"}
        </div>
      ) : (
        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-auto font-mono text-xs select-text"
        >
          <div className="min-w-max divide-y divide-border/30">
            {pageRows.map((row) => {
              const isRowActive = activeDiffOffset === row.offset;
              const isRowDiff = row.kind !== "equal";
              return (
                <div
                  key={row.offset}
                  data-diff-offset={row.offset}
                  data-row-kind={row.kind}
                  className={cn(
                    "flex items-center gap-3 px-3 py-1 transition-colors",
                    isRowDiff ? "bg-amber-500/5 hover:bg-amber-500/10" : "hover:bg-muted/30",
                    isRowActive && "ring-1 ring-inset ring-primary/60 bg-primary/10",
                  )}
                >
                  <span className="w-20 shrink-0 text-muted-foreground select-none tabular-nums">
                    {formatOffsetHex(row.offset)}
                  </span>

                  <div className="shrink-0 pr-3 border-r border-border/60">
                    <BinarySideCells
                      bytes={row.leftBytes}
                      changedMask={row.changedMask}
                      side="left"
                    />
                  </div>

                  <div className="shrink-0">
                    <BinarySideCells
                      bytes={row.rightBytes}
                      changedMask={row.changedMask}
                      side="right"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function SideBySideDiffViewer(props: SideBySideDiffViewerProps) {
  if (props.mode === "binary") {
    return <BinarySideBySideDiffViewer {...props} />;
  }
  return <TextSideBySideDiffViewer {...props} />;
}
