import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeftRight,
  Binary,
  Check,
  ChevronDown,
  FileText,
  GitCompare,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SideBySideDiffViewer,
  type BinaryChunkedSourceInput,
} from "@/components/terminal/tools/diff/SideBySideDiffViewer";
import { formatBytes } from "@/components/terminal/tools/diff/text-diff-engine";
import {
  BINARY_EXT_SET,
  TEXT_EXT_SET,
  getFileExtension,
} from "@/components/workspace/modules/local-file-picker-utils";
import { decodeTextFile, isBinaryBytes } from "@/utils/text-file-codec";

const DEFAULT_CHUNKED_THRESHOLD_BYTES = 2 * 1024 * 1024;

export interface FileDiffCandidate {
  id: string;
  label: string;
  fileName: string;
  sourceTag?: string;
  path?: string;
  size?: number;
  loadText?: () => Promise<string>;
  loadBytes?: () => Promise<Uint8Array>;
  binaryChunked?: BinaryChunkedSourceInput;
}

export interface FileDiffDialogProps {
  open: boolean;
  onClose: () => void;
  leftTitle: string;
  rightTitle: string;
  leftSize?: number;
  rightSize?: number;
  loadTextPair?: () => Promise<{ leftText: string; rightText: string }>;
  loadBytesPair?: () => Promise<{
    leftBytes: Uint8Array;
    rightBytes: Uint8Array;
  }>;
  leftBinaryChunked?: BinaryChunkedSourceInput;
  rightBinaryChunked?: BinaryChunkedSourceInput;
  initialMode?: "auto" | "text" | "binary";
  candidates?: FileDiffCandidate[];
  initialLeftId?: string;
  initialRightId?: string;
  chunkedThresholdBytes?: number;
}

type DiffViewMode = "text" | "binary";

function isBinaryFileName(name: string): boolean {
  const ext = getFileExtension(name);
  if (!ext) return false;
  if (TEXT_EXT_SET.has(ext)) return false;
  return BINARY_EXT_SET.has(ext);
}

export function FileDiffDialog({
  open,
  onClose,
  leftTitle,
  rightTitle,
  leftSize,
  rightSize,
  loadTextPair,
  loadBytesPair,
  leftBinaryChunked,
  rightBinaryChunked,
  initialMode = "auto",
  candidates,
  initialLeftId,
  initialRightId,
  chunkedThresholdBytes = DEFAULT_CHUNKED_THRESHOLD_BYTES,
}: FileDiffDialogProps) {
  const hasCandidates = Boolean(candidates && candidates.length >= 2);
  const [selectedLeftId, setSelectedLeftId] = useState<string>(
    () => initialLeftId ?? candidates?.[0]?.id ?? "",
  );
  const [selectedRightId, setSelectedRightId] = useState<string>(
    () => initialRightId ?? candidates?.[1]?.id ?? "",
  );

  // 仅在弹窗打开或候选 id 集合真正变化时重置左右选择。
  // 直接依赖 candidates 引用会因父组件重算（如语言切换）把用户手动选择恢复为默认值。
  const candidateIdsKey = candidates?.map((c) => c.id).join("\u0001") ?? "";
  useEffect(() => {
    if (!open || !candidates || candidates.length < 2) return;
    const defaultLeft =
      (initialLeftId && candidates.some((c) => c.id === initialLeftId)
        ? initialLeftId
        : candidates[0]?.id) ?? "";
    const defaultRight =
      (initialRightId && candidates.some((c) => c.id === initialRightId)
        ? initialRightId
        : candidates.find((c) => c.id !== defaultLeft)?.id ?? candidates[1]?.id) ??
      "";
    setSelectedLeftId(defaultLeft);
    setSelectedRightId(defaultRight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, candidateIdsKey, initialLeftId, initialRightId]);

  const leftCandidate = useMemo(
    () =>
      hasCandidates
        ? candidates?.find((c) => c.id === selectedLeftId) ?? candidates?.[0]
        : undefined,
    [hasCandidates, candidates, selectedLeftId],
  );

  const rightCandidate = useMemo(
    () =>
      hasCandidates
        ? candidates?.find((c) => c.id === selectedRightId) ?? candidates?.[1]
        : undefined,
    [hasCandidates, candidates, selectedRightId],
  );

  const activeLeftTitle = leftCandidate?.label ?? leftTitle;
  const activeRightTitle = rightCandidate?.label ?? rightTitle;
  const activeLeftSize = leftCandidate ? leftCandidate.size : leftSize;
  const activeRightSize = rightCandidate ? rightCandidate.size : rightSize;

  const candidateUsesChunked = Boolean(
    leftCandidate &&
      rightCandidate &&
      leftCandidate.binaryChunked &&
      rightCandidate.binaryChunked &&
      (Math.max(leftCandidate.size ?? 0, rightCandidate.size ?? 0) >
        chunkedThresholdBytes ||
        (!leftCandidate.loadText && !leftCandidate.loadBytes) ||
        (!rightCandidate.loadText && !rightCandidate.loadBytes)),
  );

  const candidateIsBinaryPair = Boolean(
    leftCandidate &&
      rightCandidate &&
      (isBinaryFileName(leftCandidate.fileName) ||
        isBinaryFileName(rightCandidate.fileName) ||
        candidateUsesChunked),
  );

  const activeLeftBinaryChunked =
    leftCandidate && rightCandidate
      ? candidateIsBinaryPair
        ? leftCandidate.binaryChunked
        : undefined
      : leftBinaryChunked;

  const activeRightBinaryChunked =
    leftCandidate && rightCandidate
      ? candidateIsBinaryPair
        ? rightCandidate.binaryChunked
        : undefined
      : rightBinaryChunked;

  const activeLoadTextPair = useMemo(() => {
    if (leftCandidate && rightCandidate) {
      if (candidateUsesChunked) return undefined;
      if (!leftCandidate.loadText && !leftCandidate.loadBytes) return undefined;
      if (!rightCandidate.loadText && !rightCandidate.loadBytes) return undefined;
      if (
        leftCandidate.loadBytes &&
        rightCandidate.loadBytes &&
        (!leftCandidate.loadText || !rightCandidate.loadText)
      ) {
        return undefined;
      }
      return async () => {
        const readOne = async (cand: FileDiffCandidate) => {
          if (cand.loadText) return cand.loadText();
          const bytes = await cand.loadBytes!();
          return decodeTextFile(bytes).text;
        };
        const [leftText, rightText] = await Promise.all([
          readOne(leftCandidate),
          readOne(rightCandidate),
        ]);
        return { leftText, rightText };
      };
    }
    return loadTextPair;
  }, [leftCandidate, rightCandidate, candidateUsesChunked, loadTextPair]);

  const activeLoadBytesPair = useMemo(() => {
    if (leftCandidate && rightCandidate) {
      if (candidateUsesChunked) return undefined;
      if (!leftCandidate.loadBytes || !rightCandidate.loadBytes) return undefined;
      return async () => {
        const [leftBytes, rightBytes] = await Promise.all([
          leftCandidate.loadBytes!(),
          rightCandidate.loadBytes!(),
        ]);
        return { leftBytes, rightBytes };
      };
    }
    return loadBytesPair;
  }, [leftCandidate, rightCandidate, candidateUsesChunked, loadBytesPair]);

  const leftFileName = leftCandidate?.fileName ?? activeLeftTitle;
  const rightFileName = rightCandidate?.fileName ?? activeRightTitle;
  const hasConfirmedBinaryByExt =
    isBinaryFileName(leftFileName) || isBinaryFileName(rightFileName);

  const [detectedBinary, setDetectedBinary] = useState(false);
  const [binaryNotice, setBinaryNotice] = useState<string | null>(null);
  const isConfirmedBinary = hasConfirmedBinaryByExt || detectedBinary;

  const hasChunkedBinary = Boolean(
    activeLeftBinaryChunked && activeRightBinaryChunked,
  );
  const canText =
    !isConfirmedBinary && Boolean(activeLoadTextPair || activeLoadBytesPair);
  const canBinary =
    hasChunkedBinary || Boolean(activeLoadBytesPair || activeLoadTextPair);

  const resolvedDefaultMode = useMemo<DiffViewMode>(() => {
    if (isConfirmedBinary && canBinary) return "binary";
    if (initialMode === "text" && canText) return "text";
    if (initialMode === "binary" && canBinary) return "binary";
    if (hasChunkedBinary) return "binary";
    if (!hasCandidates && activeLoadBytesPair && !activeLoadTextPair) return "binary";
    if (activeLoadTextPair && !activeLoadBytesPair) return "text";
    if (hasConfirmedBinaryByExt) return "binary";
    return "text";
  }, [
    isConfirmedBinary,
    canBinary,
    initialMode,
    canText,
    hasChunkedBinary,
    hasCandidates,
    activeLoadBytesPair,
    activeLoadTextPair,
    hasConfirmedBinaryByExt,
  ]);

  const [mode, setMode] = useState<DiffViewMode>(resolvedDefaultMode);
  const [textPair, setTextPair] = useState<{
    leftText: string;
    rightText: string;
  } | null>(null);
  const [bytesPair, setBytesPair] = useState<{
    leftBytes: Uint8Array;
    rightBytes: Uint8Array;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  // 每次重新打开或核心入参变化时重置缓存并恢复初始模式
  useEffect(() => {
    if (!open) {
      setTextPair(null);
      setBytesPair(null);
      setLoading(false);
      setError(null);
      setDetectedBinary(false);
      setBinaryNotice(null);
      return;
    }
    setMode(resolvedDefaultMode);
  }, [open, resolvedDefaultMode]);

  useEffect(() => {
    setTextPair(null);
    setBytesPair(null);
    setError(null);
    setDetectedBinary(false);
    setBinaryNotice(null);
  }, [
    activeLeftTitle,
    activeRightTitle,
    activeLoadTextPair,
    activeLoadBytesPair,
    activeLeftBinaryChunked,
    activeRightBinaryChunked,
  ]);

  // 仅在弹窗打开时按需懒加载当前模式所需的数据
  useEffect(() => {
    if (!open) return;

    if (mode === "binary" && hasChunkedBinary) {
      setLoading(false);
      setError(null);
      return;
    }

    if (mode === "text" && textPair !== null) return;
    if (mode === "binary" && bytesPair !== null) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        if (mode === "text") {
          if (activeLoadTextPair) {
            const pair = await activeLoadTextPair();
            if (!cancelled) {
              if (
                canBinary &&
                (pair.leftText.includes("\0") || pair.rightText.includes("\0"))
              ) {
                const encoder = new TextEncoder();
                setBytesPair({
                  leftBytes: encoder.encode(pair.leftText),
                  rightBytes: encoder.encode(pair.rightText),
                });
                setDetectedBinary(true);
                setBinaryNotice(
                  "检测到二进制内容（含 NUL 字节），已自动切换至 Hex Binary Diff 并禁用文本比对",
                );
                setMode("binary");
                setLoading(false);
                return;
              }
              setTextPair(pair);
              setLoading(false);
            }
            return;
          }
          if (activeLoadBytesPair) {
            const raw = bytesPair ?? (await activeLoadBytesPair());
            if (!cancelled) {
              setBytesPair(raw);
              if (isBinaryBytes(raw.leftBytes) || isBinaryBytes(raw.rightBytes)) {
                setDetectedBinary(true);
                setBinaryNotice(
                  "检测到二进制字节内容，已自动切换至 Hex Binary Diff 并禁用文本比对",
                );
                setMode("binary");
                setLoading(false);
                return;
              }
              setTextPair({
                leftText: decodeTextFile(raw.leftBytes).text,
                rightText: decodeTextFile(raw.rightBytes).text,
              });
              setLoading(false);
            }
            return;
          }
        } else {
          if (activeLoadBytesPair) {
            const raw = await activeLoadBytesPair();
            if (!cancelled) {
              setBytesPair(raw);
              if (isBinaryBytes(raw.leftBytes) || isBinaryBytes(raw.rightBytes)) {
                setDetectedBinary(true);
                if (!hasConfirmedBinaryByExt) {
                  setBinaryNotice(
                    "检测到二进制字节内容，已禁用 Text Diff",
                  );
                }
              }
              setLoading(false);
            }
            return;
          }
          if (activeLoadTextPair) {
            const pair = textPair ?? (await activeLoadTextPair());
            if (!cancelled) {
              const encoder = new TextEncoder();
              setTextPair(pair);
              setBytesPair({
                leftBytes: encoder.encode(pair.leftText),
                rightBytes: encoder.encode(pair.rightText),
              });
              setLoading(false);
            }
            return;
          }
        }
        if (!cancelled) {
          setError("未提供可用的文件数据加载器");
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    mode,
    hasChunkedBinary,
    hasConfirmedBinaryByExt,
    canBinary,
    textPair,
    bytesPair,
    activeLoadTextPair,
    activeLoadBytesPair,
    retryTick,
  ]);

  const handleSelectLeft = useCallback(
    (nextId: string) => {
      if (nextId === selectedRightId) {
        setSelectedRightId(selectedLeftId);
      }
      setSelectedLeftId(nextId);
    },
    [selectedLeftId, selectedRightId],
  );

  const handleSelectRight = useCallback(
    (nextId: string) => {
      if (nextId === selectedLeftId) {
        setSelectedLeftId(selectedRightId);
      }
      setSelectedRightId(nextId);
    },
    [selectedLeftId, selectedRightId],
  );

  const handleSwapSides = useCallback(() => {
    setSelectedLeftId(selectedRightId);
    setSelectedRightId(selectedLeftId);
  }, [selectedLeftId, selectedRightId]);

  const handleRetry = useCallback(() => {
    setError(null);
    if (mode === "text") setTextPair(null);
    else setBytesPair(null);
    setRetryTick((t) => t + 1);
  }, [mode]);

  const formatCandidateTitle = (cand: FileDiffCandidate | undefined, fallbackTitle: string) => {
    if (!cand) return fallbackTitle;
    return cand.path ? `${cand.label}\n${cand.path}` : cand.label;
  };

  const renderCandidateSelector = (side: "left" | "right") => {
    const isLeft = side === "left";
    const cand = isLeft ? leftCandidate : rightCandidate;
    const titleText = isLeft ? activeLeftTitle : activeRightTitle;
    const sizeValue = isLeft ? activeLeftSize : activeRightSize;
    const currentId = isLeft ? selectedLeftId : selectedRightId;
    const otherId = isLeft ? selectedRightId : selectedLeftId;
    const badgeClass = isLeft
      ? "bg-rose-500/10 hover:bg-rose-500/15"
      : "bg-emerald-500/10 hover:bg-emerald-500/15";

    if (!candidates || candidates.length < 3) {
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-foreground/90 max-w-[230px] truncate",
            badgeClass,
          )}
          title={formatCandidateTitle(cand, titleText)}
        >
          <span className="truncate">{titleText}</span>
          {typeof sizeValue === "number" && (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              ({formatBytes(sizeValue)})
            </span>
          )}
        </span>
      );
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-foreground/90 max-w-[240px] cursor-pointer transition-colors border border-border/40",
              badgeClass,
            )}
            title={formatCandidateTitle(cand, titleText)}
            aria-label={isLeft ? "选择左侧对比文件" : "选择右侧对比文件"}
          >
            <span className="truncate">{titleText}</span>
            {typeof sizeValue === "number" && (
              <span className="shrink-0 text-[10px] text-muted-foreground">
                ({formatBytes(sizeValue)})
              </span>
            )}
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 max-h-72 overflow-y-auto">
          {candidates.map((item) => {
            const isCurrent = item.id === currentId;
            const isOther = item.id === otherId;
            return (
              <DropdownMenuItem
                key={item.id}
                onClick={() =>
                  isLeft ? handleSelectLeft(item.id) : handleSelectRight(item.id)
                }
                className="flex items-start justify-between gap-2 py-1.5 text-xs cursor-pointer"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {item.sourceTag && (
                      <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {item.sourceTag}
                      </span>
                    )}
                    <span className="truncate font-mono font-medium text-foreground">
                      {item.fileName}
                    </span>
                    {typeof item.size === "number" && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        ({formatBytes(item.size)})
                      </span>
                    )}
                  </div>
                  {item.path && (
                    <div
                      className="truncate text-[10px] text-muted-foreground/80 mt-0.5 font-mono"
                      title={item.path}
                    >
                      {item.path}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  {isOther && (
                    <span className="text-[10px] text-muted-foreground">对侧</span>
                  )}
                  {isCurrent && <Check className="h-3.5 w-3.5 text-primary" />}
                </div>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="w-[calc(100vw-2rem)] max-w-6xl h-[85vh] max-h-[85vh] p-0 gap-0 flex flex-col overflow-hidden"
      >
        {/* 自定义顶部栏：标题、大小、模式切换与关闭按钮 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-muted/25 px-4 py-2.5 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <GitCompare className="h-4 w-4 shrink-0 text-primary" />
            <DialogTitle className="text-sm font-semibold text-foreground truncate">
              文件对比
            </DialogTitle>
            {candidates && candidates.length >= 3 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary shrink-0">
                候选 {candidates.length} 项
              </span>
            )}
            <DialogDescription className="sr-only">
              对比 {activeLeftTitle} 与 {activeRightTitle} 的文本或二进制字节差异
            </DialogDescription>

            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground min-w-0">
              {renderCandidateSelector("left")}
              {hasCandidates ? (
                <button
                  type="button"
                  onClick={handleSwapSides}
                  className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
                  title="交换左右对比文件"
                  aria-label="交换左右对比文件"
                >
                  <ArrowLeftRight className="h-3 w-3" />
                </button>
              ) : (
                <span className="text-muted-foreground/60">vs</span>
              )}
              {renderCandidateSelector("right")}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div
              className="inline-flex items-center rounded-md border border-border/60 bg-background p-0.5"
              role="group"
              aria-label="对比模式切换"
            >
              <button
                type="button"
                disabled={!canText}
                onClick={() => setMode("text")}
                aria-pressed={mode === "text"}
                title={
                  isConfirmedBinary
                    ? "已确认为二进制文件，禁止切换至文本比对"
                    : undefined
                }
                className={cn(
                  "inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                  mode === "text"
                    ? "bg-primary text-primary-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Text Diff</span>
              </button>
              <button
                type="button"
                disabled={!canBinary}
                onClick={() => setMode("binary")}
                aria-pressed={mode === "binary"}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                  mode === "binary"
                    ? "bg-primary text-primary-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Binary className="h-3.5 w-3.5" />
                <span>Hex Binary Diff</span>
              </button>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-foreground"
              aria-label="关闭文件对比"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* 二进制自动识别提示条 */}
        {binaryNotice && mode === "binary" && (
          <div
            role="status"
            className="flex items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-300 shrink-0"
          >
            <span className="flex items-center gap-1.5">
              <Binary className="h-3.5 w-3.5 shrink-0" />
              <span>{binaryNotice}</span>
            </span>
            <button
              type="button"
              onClick={() => setBinaryNotice(null)}
              className="text-amber-700/70 hover:text-amber-700 dark:text-amber-300/70 dark:hover:text-amber-300 cursor-pointer"
              aria-label="关闭二进制提示"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* 主体视口 */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {loading ? (
            <div
              className="flex flex-1 flex-col items-center justify-center gap-2.5 text-xs text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span>正在加载文件内容...</span>
            </div>
          ) : error ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <AlertCircle className="h-7 w-7 text-destructive" />
              <div className="space-y-1 max-w-md">
                <p className="text-sm font-medium text-foreground">加载对比内容失败</p>
                <p className="text-xs text-destructive break-words">{error}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRetry}
                className="h-8 px-3 text-xs gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>重试</span>
              </Button>
            </div>
          ) : mode === "binary" ? (
            <SideBySideDiffViewer
              mode="binary"
              leftBytes={hasChunkedBinary ? undefined : (bytesPair?.leftBytes ?? null)}
              rightBytes={hasChunkedBinary ? undefined : (bytesPair?.rightBytes ?? null)}
              leftBinaryChunked={hasChunkedBinary ? activeLeftBinaryChunked : undefined}
              rightBinaryChunked={hasChunkedBinary ? activeRightBinaryChunked : undefined}
            />
          ) : (
            <SideBySideDiffViewer
              mode="text"
              leftText={textPair?.leftText ?? ""}
              rightText={textPair?.rightText ?? ""}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
