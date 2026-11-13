import { useState, useRef, useMemo, useCallback } from "react";
import {
  Copy,
  Check,
  ArrowRight,
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  WrapText,
  Edit3,
  CheckCircle2,
  GitCompare,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  computeTextDiff,
  applyChunkFromLeft,
  formatBytes,
  type DiffChunk,
  type WordDiffToken,
} from "./text-diff-engine";

interface SideBySideDiffViewerProps {
  leftText: string;
  rightText: string;
  onUpdateRightText?: (newRightText: string) => void;
  onUpdateLeftText?: (newLeftText: string) => void;
  onSwitchToEdit?: () => void;
}

const LINE_HEIGHT = 22; // 像素，与 font-mono text-xs leading-[22px] 严格吻合
const GUTTER_WIDTH = 34; // 中间贝塞尔曲线连接带宽度

export function SideBySideDiffViewer({
  leftText,
  rightText,
  onUpdateRightText,
  onUpdateLeftText,
  onSwitchToEdit,
}: SideBySideDiffViewerProps) {
  const [copiedLeft, setCopiedLeft] = useState(false);
  const [copiedRight, setCopiedRight] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const [activeChunkIndex, setActiveChunkIndex] = useState<number>(0);

  // 计算差异结果
  const diffResult = useMemo(() => {
    return computeTextDiff(leftText, rightText);
  }, [leftText, rightText]);

  const leftLines = useMemo(() => (leftText ? leftText.split(/\r?\n/) : []), [leftText]);
  const rightLines = useMemo(() => (rightText ? rightText.split(/\r?\n/) : []), [rightText]);

  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const gutterScrollRef = useRef<HTMLDivElement>(null);
  const isSyncingScroll = useRef(false);

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
      const targetTop = (Math.max(1, chunk.leftStartLine) - 1) * LINE_HEIGHT - 40;
      const topVal = Math.max(0, targetTop);
      if (leftScrollRef.current) {
        leftScrollRef.current.scrollTo({ top: topVal, behavior: "smooth" });
      }
      if (rightScrollRef.current) {
        rightScrollRef.current.scrollTo({ top: topVal, behavior: "smooth" });
      }
      if (gutterScrollRef.current) {
        gutterScrollRef.current.scrollTo({ top: topVal, behavior: "smooth" });
      }
    },
    [diffResult.chunks]
  );

  // 复制功能
  const handleCopyLeft = useCallback(async () => {
    await navigator.clipboard.writeText(leftText);
    setCopiedLeft(true);
    setTimeout(() => setCopiedLeft(false), 1500);
  }, [leftText]);

  const handleCopyRight = useCallback(async () => {
    await navigator.clipboard.writeText(rightText);
    setCopiedRight(true);
    setTimeout(() => setCopiedRight(false), 1500);
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

  // 计算中间连接贝塞尔曲线路径
  const connectorPaths = useMemo(() => {
    const paths: { d: string; type: DiffChunk["type"]; id: string; isActive: boolean }[] = [];
    const w = GUTTER_WIDTH;

    diffResult.chunks.forEach((chunk, idx) => {
      // 左侧区间 Y (以 0-based 像素计算)
      const topL = (chunk.leftStartLine - 1) * LINE_HEIGHT;
      const bottomL = chunk.leftLineCount > 0 ? chunk.leftEndLine * LINE_HEIGHT : topL + 3;

      // 右侧区间 Y
      const topR = (chunk.rightStartLine - 1) * LINE_HEIGHT;
      const bottomR = chunk.rightLineCount > 0 ? chunk.rightEndLine * LINE_HEIGHT : topR + 3;

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
  }, [diffResult.chunks, activeChunkIndex]);

  const totalContentHeight = Math.max(leftLines.length, rightLines.length) * LINE_HEIGHT + 80;

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
            onClick={() => setWrapLines((v) => !v)}
            title="切换代码自动换行"
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

          {/* 左侧行内容滚动区 */}
          <div
            ref={leftScrollRef}
            onScroll={handleScrollLeft}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-auto font-mono text-xs leading-[22px] select-text"
          >
            <div style={{ minHeight: totalContentHeight }}>
              {leftLines.map((lineText, idx) => {
                const lineNum = idx + 1;
                const chunk = chunkMap.leftMap.get(lineNum);
                const isModified = !!chunk;
                const tokens = wordDiffMap.lTokens.get(lineNum);
                const isChunkFirstLine = chunk && chunk.leftStartLine === lineNum;

                return (
                  <div
                    key={`l-${lineNum}`}
                    className={cn(
                      "flex min-w-full group",
                      isModified
                        ? "bg-rose-500/10 dark:bg-rose-950/25 text-rose-950 dark:text-rose-100"
                        : "hover:bg-muted/40 text-foreground"
                    )}
                    style={{ height: wrapLines ? "auto" : LINE_HEIGHT }}
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

                    {/* 行文本内容 */}
                    <div
                      className={cn(
                        "flex-1 px-3 py-0",
                        wrapLines ? "whitespace-pre-wrap break-all" : "whitespace-pre"
                      )}
                    >
                      {tokens && tokens.length > 0 ? (
                        tokens.map((tok, tIdx) => (
                          <span
                            key={tIdx}
                            className={cn(
                              tok.type === "removed" &&
                                "bg-rose-500/30 dark:bg-rose-500/40 text-rose-950 dark:text-rose-50 rounded-xs px-0.5 font-semibold"
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

          {/* 右侧行内容滚动区 */}
          <div
            ref={rightScrollRef}
            onScroll={handleScrollRight}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-auto font-mono text-xs leading-[22px] select-text"
          >
            <div style={{ minHeight: totalContentHeight }}>
              {rightLines.map((lineText, idx) => {
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
                    style={{ height: wrapLines ? "auto" : LINE_HEIGHT }}
                  >
                    {/* 行号区 */}
                    <div className="w-12 shrink-0 flex items-center justify-between px-2 select-none border-r border-border/50 bg-muted/15 text-[11px] text-muted-foreground font-mono">
                      <span>{lineNum}</span>
                    </div>

                    {/* 行文本内容 */}
                    <div
                      className={cn(
                        "flex-1 px-3 py-0",
                        wrapLines ? "whitespace-pre-wrap break-all" : "whitespace-pre"
                      )}
                    >
                      {tokens && tokens.length > 0 ? (
                        tokens.map((tok, tIdx) => (
                          <span
                            key={tIdx}
                            className={cn(
                              tok.type === "added" &&
                                "bg-emerald-500/30 dark:bg-emerald-500/40 text-emerald-950 dark:text-emerald-50 rounded-xs px-0.5 font-semibold"
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
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
