import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Search,
  Copy,
  Check,
  ArrowRight,
  Binary,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const DEFAULT_PAGE_SIZE = 64 * 1024;
const DEFAULT_MAX_CACHED_PAGES = 32;
const ROW_HEIGHT = 24;
const MAX_VIRTUAL_HEIGHT_PX = 16_000_000;
const ROWS_PER_WINDOW = 524_288;

export interface FormattedHexLine {
  offsetHex: string;
  hexLeft: string;
  hexRight: string;
  hexColumn: string;
  ascii: string;
  formatted: string;
}

/**
 * 将字节序列解码为可打印 ASCII 字符，不可见控制字符/非 ASCII 字节显示为 `.`
 */
export function decodeAsciiPrintable(bytes: Uint8Array | number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
  }
  return out;
}

/**
 * 将指定偏移处的一行字节格式化为标准十六进制转储行：
 * `00000000  |  XX XX ... XX   XX ... XX  |  ................`
 */
export function formatHexLine(
  offset: number,
  bytes: Uint8Array | number[],
  bytesPerRow: 8 | 16 = 16,
): FormattedHexLine {
  const safeOffset = Math.max(0, Math.floor(offset));
  const hexWidth = safeOffset > 0xffffffff ? 12 : 8;
  const offsetHex = safeOffset
    .toString(16)
    .toUpperCase()
    .padStart(hexWidth, "0");

  const hexCells: string[] = [];
  for (let i = 0; i < bytesPerRow; i++) {
    if (i < bytes.length) {
      hexCells.push(bytes[i].toString(16).toUpperCase().padStart(2, "0"));
    } else {
      hexCells.push("  ");
    }
  }

  let hexLeft = "";
  let hexRight = "";
  let hexColumn = "";

  if (bytesPerRow === 16) {
    hexLeft = hexCells.slice(0, 8).join(" ");
    hexRight = hexCells.slice(8, 16).join(" ");
    hexColumn = `${hexLeft}   ${hexRight}`;
  } else {
    hexLeft = hexCells.join(" ");
    hexRight = "";
    hexColumn = hexLeft;
  }

  const ascii = decodeAsciiPrintable(bytes);
  const formatted = `${offsetHex}  |  ${hexColumn}  |  ${ascii}`;

  return {
    offsetHex,
    hexLeft,
    hexRight,
    hexColumn,
    ascii,
    formatted,
  };
}

/** 解析跳转偏移输入（支持 `0x1A0` 十六进制或十进制数字） */
export function parseOffsetInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    const parsed = Number.parseInt(trimmed.slice(2), 16);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

/** 解析 HEX 搜索模式（如 `"4D 5A"` 或 `"4d5a"`）为字节数组 */
export function parseHexPattern(raw: string): Uint8Array | null {
  const cleaned = raw.trim().replace(/[\s,;:-]+/g, "");
  if (!cleaned || cleaned.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(cleaned)) {
    return null;
  }
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function findBytesIndex(
  haystack: Uint8Array,
  needle: Uint8Array,
  fromIndex: number,
): number {
  if (needle.length === 0 || haystack.length < needle.length) return -1;
  const maxStart = haystack.length - needle.length;
  for (let i = Math.max(0, fromIndex); i <= maxStart; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

export interface HexViewerProps {
  /** 内存数据源（支持 Uint8Array / ArrayBuffer） */
  data?: Uint8Array | ArrayBuffer | null;
  /** 分块加载模式总字节数（配合 onLoadRange 使用，支持 100MB+ 大文件） */
  totalSize?: number;
  /** 分块按需拉取字节范围回调 */
  onLoadRange?: (offset: number, len: number) => Promise<Uint8Array>;
  fileName?: string;
  className?: string;
  initialBytesPerRow?: 8 | 16;
  pageSize?: number;
  maxCachedPages?: number;
}

export function HexViewer({
  data,
  totalSize,
  onLoadRange,
  fileName,
  className,
  initialBytesPerRow = 16,
  pageSize = DEFAULT_PAGE_SIZE,
  maxCachedPages = DEFAULT_MAX_CACHED_PAGES,
}: HexViewerProps) {
  const [bytesPerRow, setBytesPerRow] = useState<8 | 16>(initialBytesPerRow);
  const [selectedOffset, setSelectedOffset] = useState<number | null>(null);
  const [jumpInput, setJumpInput] = useState<string>("");
  const [jumpError, setJumpError] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<"ascii" | "hex">("ascii");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchMatch, setSearchMatch] = useState<{
    offset: number;
    length: number;
  } | null>(null);
  const [searchStatus, setSearchStatus] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [copiedKind, setCopiedKind] = useState<"offset" | "hex" | null>(null);
  const [chunkError, setChunkError] = useState<string | null>(null);
  const [activeWindow, setActiveWindow] = useState<number>(0);
  const [cacheVersion, setCacheVersion] = useState<number>(0);

  const parentRef = useRef<HTMLDivElement>(null);
  const pageCacheRef = useRef<Map<number, Uint8Array>>(new Map());
  const inFlightPagesRef = useRef<Map<number, Promise<Uint8Array>>>(new Map());
  const failedPagesRef = useRef<Set<number>>(new Set());
  const pendingScrollRowRef = useRef<number | null>(null);
  const searchTokenRef = useRef<number>(0);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef<boolean>(true);
  const sourceEpochRef = useRef<number>(0);

  const memoryBytes = useMemo<Uint8Array | null>(() => {
    if (!data) return null;
    if (data instanceof Uint8Array) return data;
    return new Uint8Array(data);
  }, [data]);

  const isChunkedMode = !memoryBytes && typeof onLoadRange === "function";
  const effectiveTotalSize = memoryBytes
    ? memoryBytes.byteLength
    : Math.max(0, Math.floor(totalSize ?? 0));
  const safePageSize = Math.max(256, Math.floor(pageSize));
  const totalRows =
    effectiveTotalSize === 0 ? 0 : Math.ceil(effectiveTotalSize / bytesPerRow);
  const isWindowed = totalRows * ROW_HEIGHT > MAX_VIRTUAL_HEIGHT_PX;
  const totalWindows = isWindowed ? Math.ceil(totalRows / ROWS_PER_WINDOW) : 1;
  const safeWindow = Math.max(0, Math.min(totalWindows - 1, activeWindow));
  const windowStartRow = isWindowed ? safeWindow * ROWS_PER_WINDOW : 0;
  const windowEndRow = isWindowed
    ? Math.min(totalRows, windowStartRow + ROWS_PER_WINDOW)
    : totalRows;
  const windowRowCount = Math.max(0, windowEndRow - windowStartRow);

  // 数据源变化时清空分块缓存与搜索状态
  useEffect(() => {
    sourceEpochRef.current += 1;
    pageCacheRef.current.clear();
    inFlightPagesRef.current.clear();
    failedPagesRef.current.clear();
    pendingScrollRowRef.current = null;
    searchTokenRef.current += 1;
    setSearchMatch(null);
    setSearchStatus(null);
    setChunkError(null);
    setActiveWindow(0);
    setIsSearching(false);
    setSelectedOffset(effectiveTotalSize > 0 ? 0 : null);
    setCacheVersion((v) => v + 1);
  }, [memoryBytes, onLoadRange, totalSize, effectiveTotalSize]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sourceEpochRef.current += 1;
      searchTokenRef.current += 1;
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const touchCachePage = useCallback(
    (pageIndex: number, bytes: Uint8Array) => {
      const cache = pageCacheRef.current;
      if (cache.has(pageIndex)) {
        cache.delete(pageIndex);
      }
      cache.set(pageIndex, bytes);
      while (cache.size > Math.max(1, maxCachedPages)) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey === undefined) break;
        cache.delete(oldestKey);
      }
    },
    [maxCachedPages],
  );

  const ensurePage = useCallback(
    (pageIndex: number): Promise<Uint8Array> | null => {
      if (!isChunkedMode || !onLoadRange) return null;
      const offset = pageIndex * safePageSize;
      if (offset >= effectiveTotalSize) return null;

      const cached = pageCacheRef.current.get(pageIndex);
      if (cached) {
        touchCachePage(pageIndex, cached);
        return Promise.resolve(cached);
      }

      const existing = inFlightPagesRef.current.get(pageIndex);
      if (existing) return existing;

      const requestLen = Math.min(safePageSize, effectiveTotalSize - offset);
      const reqEpoch = sourceEpochRef.current;
      const req = onLoadRange(offset, requestLen)
        .then((chunk) => {
          const normalized =
            chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          if (!mountedRef.current || sourceEpochRef.current !== reqEpoch) {
            return normalized;
          }
          touchCachePage(pageIndex, normalized);
          inFlightPagesRef.current.delete(pageIndex);
          failedPagesRef.current.delete(pageIndex);
          setChunkError(null);
          setCacheVersion((v) => v + 1);
          return normalized;
        })
        .catch((err) => {
          if (mountedRef.current && sourceEpochRef.current === reqEpoch) {
            inFlightPagesRef.current.delete(pageIndex);
            failedPagesRef.current.add(pageIndex);
            const msg = err instanceof Error ? err.message : String(err);
            setChunkError(msg || "分块加载失败");
          }
          throw err;
        });

      inFlightPagesRef.current.set(pageIndex, req);
      return req;
    },
    [
      isChunkedMode,
      onLoadRange,
      safePageSize,
      effectiveTotalSize,
      touchCachePage,
    ],
  );

  const readRowSync = useCallback(
    (rowOffset: number, rowLen: number): { bytes: Uint8Array | null; loading: boolean } => {
      if (memoryBytes) {
        return {
          bytes: memoryBytes.subarray(
            rowOffset,
            Math.min(memoryBytes.byteLength, rowOffset + rowLen),
          ),
          loading: false,
        };
      }
      if (!isChunkedMode) {
        return { bytes: new Uint8Array(0), loading: false };
      }
      const out = new Uint8Array(rowLen);
      let filled = 0;
      while (filled < rowLen) {
        const abs = rowOffset + filled;
        const pageIdx = Math.floor(abs / safePageSize);
        const page = pageCacheRef.current.get(pageIdx);
        if (!page) {
          return { bytes: null, loading: true };
        }
        const pageStart = abs - pageIdx * safePageSize;
        if (pageStart >= page.length) {
          return { bytes: out.subarray(0, filled), loading: false };
        }
        const take = Math.min(rowLen - filled, page.length - pageStart);
        out.set(page.subarray(pageStart, pageStart + take), filled);
        filled += take;
      }
      return { bytes: out, loading: false };
    },
    [memoryBytes, isChunkedMode, safePageSize],
  );

  const rowVirtualizer = useVirtualizer({
    count: windowRowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    initialRect: { width: 800, height: 480 },
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    if (pendingScrollRowRef.current !== null) {
      const targetRow = pendingScrollRowRef.current;
      pendingScrollRowRef.current = null;
      rowVirtualizer.scrollToIndex(targetRow, { align: "start" });
    }
  }, [safeWindow, windowRowCount, rowVirtualizer]);

  // 当可视行跨越尚未缓存的分块页时，按需触发异步拉取
  useEffect(() => {
    if (!isChunkedMode || virtualItems.length === 0) return;
    const neededPages = new Set<number>();
    for (const item of virtualItems) {
      const startOffset = (windowStartRow + item.index) * bytesPerRow;
      const endOffset = Math.min(
        effectiveTotalSize - 1,
        startOffset + bytesPerRow - 1,
      );
      if (endOffset < startOffset) continue;
      const pStart = Math.floor(startOffset / safePageSize);
      const pEnd = Math.floor(endOffset / safePageSize);
      for (let p = pStart; p <= pEnd; p++) {
        if (!pageCacheRef.current.has(p) && !failedPagesRef.current.has(p)) {
          neededPages.add(p);
        }
      }
    }
    neededPages.forEach((p) => {
      void ensurePage(p)?.catch(() => {});
    });
  }, [
    isChunkedMode,
    virtualItems,
    windowStartRow,
    bytesPerRow,
    effectiveTotalSize,
    safePageSize,
    ensurePage,
    cacheVersion,
  ]);

  const scrollToOffset = useCallback(
    (targetOffset: number) => {
      if (effectiveTotalSize <= 0) return;
      const clamped = Math.max(0, Math.min(effectiveTotalSize - 1, targetOffset));
      setSelectedOffset(clamped);
      const globalRowIndex = Math.floor(clamped / bytesPerRow);
      const targetWindow = isWindowed
        ? Math.floor(globalRowIndex / ROWS_PER_WINDOW)
        : 0;
      const localRowIndex = globalRowIndex - targetWindow * ROWS_PER_WINDOW;
      if (isWindowed && targetWindow !== safeWindow) {
        pendingScrollRowRef.current = localRowIndex;
        setActiveWindow(targetWindow);
      } else {
        rowVirtualizer.scrollToIndex(localRowIndex, { align: "start" });
      }
    },
    [effectiveTotalSize, bytesPerRow, isWindowed, safeWindow, rowVirtualizer],
  );

  const handleRetryChunks = useCallback(() => {
    failedPagesRef.current.clear();
    setChunkError(null);
    setCacheVersion((v) => v + 1);
  }, []);

  const handleSwitchWindow = useCallback(
    (nextWindow: number) => {
      const clamped = Math.max(0, Math.min(totalWindows - 1, nextWindow));
      pendingScrollRowRef.current = 0;
      setActiveWindow(clamped);
    },
    [totalWindows],
  );

  const handleJump = useCallback(() => {
    if (effectiveTotalSize <= 0) return;
    const parsed = parseOffsetInput(jumpInput);
    if (parsed === null) {
      setJumpError("无效偏移（请输入 0x... 或十进制数字）");
      return;
    }
    setJumpError(null);
    scrollToOffset(parsed);
  }, [effectiveTotalSize, jumpInput, scrollToOffset]);

  const handleFind = useCallback(async () => {
    if (effectiveTotalSize <= 0) return;
    const raw = searchQuery;
    if (!raw.trim()) {
      setSearchMatch(null);
      setSearchStatus(null);
      return;
    }

    let needle: Uint8Array | null = null;
    if (searchMode === "hex") {
      needle = parseHexPattern(raw);
      if (!needle) {
        setSearchStatus("HEX 格式无效（例如 4D 5A）");
        return;
      }
    } else {
      needle = new TextEncoder().encode(raw);
    }

    if (needle.length === 0) return;
    const startFrom = searchMatch
      ? (searchMatch.offset + 1) % effectiveTotalSize
      : 0;

    if (memoryBytes) {
      let found = findBytesIndex(memoryBytes, needle, startFrom);
      if (found < 0 && startFrom > 0) {
        found = findBytesIndex(memoryBytes, needle, 0);
      }
      if (found >= 0) {
        setSearchMatch({ offset: found, length: needle.length });
        setSearchStatus(
          `0x${found.toString(16).toUpperCase().padStart(8, "0")}`,
        );
        scrollToOffset(found);
      } else {
        setSearchMatch(null);
        setSearchStatus("未找到匹配");
      }
      return;
    }

    if (isChunkedMode && onLoadRange) {
      const token = ++searchTokenRef.current;
      setIsSearching(true);
      setSearchStatus("扫描中...");
      try {
        const totalPages = Math.ceil(effectiveTotalSize / safePageSize);
        const startPage = Math.floor(startFrom / safePageSize);
        const startInPage = startFrom - startPage * safePageSize;
        const overlap = Math.max(0, needle.length - 1);
        const totalSteps = startInPage > 0 ? totalPages + 1 : totalPages;

        for (let step = 0; step < totalSteps; step++) {
          if (searchTokenRef.current !== token) return;
          const isWrapStartPage = startInPage > 0 && step === totalPages;
          const p = isWrapStartPage ? startPage : (startPage + step) % totalPages;
          const pageOffset = p * safePageSize;
          const desiredLen = isWrapStartPage
            ? Math.min(
                safePageSize + overlap,
                startInPage + overlap,
                effectiveTotalSize - pageOffset,
              )
            : Math.min(safePageSize + overlap, effectiveTotalSize - pageOffset);

          let chunk: Uint8Array | null = null;
          const cachedCurrent = pageCacheRef.current.get(p);
          if (cachedCurrent) {
            if (desiredLen <= cachedCurrent.length) {
              chunk = cachedCurrent.subarray(0, desiredLen);
            } else {
              const cachedNext = pageCacheRef.current.get(p + 1);
              if (cachedNext) {
                const extra = Math.min(
                  desiredLen - cachedCurrent.length,
                  cachedNext.length,
                );
                const combined = new Uint8Array(cachedCurrent.length + extra);
                combined.set(cachedCurrent, 0);
                combined.set(cachedNext.subarray(0, extra), cachedCurrent.length);
                chunk = combined;
              }
            }
          }

          if (!chunk) {
            const loaded = await onLoadRange(pageOffset, desiredLen);
            if (searchTokenRef.current !== token) return;
            chunk = loaded instanceof Uint8Array ? loaded : new Uint8Array(loaded);
          }

          if (chunk.length === 0) {
            break;
          }

          const localStart = step === 0 ? startInPage : 0;
          const idx = findBytesIndex(chunk, needle, localStart);
          if (idx >= 0 && (!isWrapStartPage || idx < startInPage)) {
            const absOffset = pageOffset + idx;
            setSearchMatch({ offset: absOffset, length: needle.length });
            setSearchStatus(
              `0x${absOffset.toString(16).toUpperCase().padStart(8, "0")}`,
            );
            scrollToOffset(absOffset);
            return;
          }

          if (step % 4 === 3) {
            await Promise.resolve();
          }
        }
        if (searchTokenRef.current === token) {
          setSearchMatch(null);
          setSearchStatus("未找到匹配");
        }
      } catch (err) {
        if (searchTokenRef.current === token) {
          const msg = err instanceof Error ? err.message : String(err);
          setChunkError(msg || "分块加载失败");
          setSearchStatus("查找失败");
        }
      } finally {
        if (searchTokenRef.current === token) {
          setIsSearching(false);
        }
      }
    }
  }, [
    effectiveTotalSize,
    searchQuery,
    searchMode,
    searchMatch,
    memoryBytes,
    isChunkedMode,
    onLoadRange,
    safePageSize,
    scrollToOffset,
  ]);

  const handleCopy = useCallback(
    async (kind: "offset" | "hex") => {
      const target = selectedOffset ?? 0;
      let text = "";
      if (kind === "offset") {
        text = `0x${target.toString(16).toUpperCase().padStart(8, "0")}`;
      } else {
        const rowStart = Math.floor(target / bytesPerRow) * bytesPerRow;
        const rowLen = Math.min(bytesPerRow, effectiveTotalSize - rowStart);
        let { bytes } = readRowSync(rowStart, Math.max(0, rowLen));
        if ((!bytes || bytes.length === 0) && isChunkedMode && rowLen > 0) {
          const reqEpoch = sourceEpochRef.current;
          const pStart = Math.floor(rowStart / safePageSize);
          const pEnd = Math.floor((rowStart + rowLen - 1) / safePageSize);
          const pagePromises: Promise<readonly [number, Uint8Array]>[] = [];
          for (let p = pStart; p <= pEnd; p++) {
            const pReq = ensurePage(p);
            if (pReq) {
              pagePromises.push(pReq.then((chunk) => [p, chunk] as const));
            }
          }
          try {
            const loadedPages = await Promise.all(pagePromises);
            if (!mountedRef.current || sourceEpochRef.current !== reqEpoch) return;
            const pageMap = new Map<number, Uint8Array>(loadedPages);
            const assembled = new Uint8Array(rowLen);
            let filled = 0;
            while (filled < rowLen) {
              const abs = rowStart + filled;
              const pageIdx = Math.floor(abs / safePageSize);
              const pageBytes =
                pageMap.get(pageIdx) ?? pageCacheRef.current.get(pageIdx);
              if (!pageBytes) break;
              const pageStart = abs - pageIdx * safePageSize;
              if (pageStart >= pageBytes.length) break;
              const take = Math.min(rowLen - filled, pageBytes.length - pageStart);
              assembled.set(pageBytes.subarray(pageStart, pageStart + take), filled);
              filled += take;
            }
            bytes = assembled.subarray(0, filled);
          } catch {
            return;
          }
        }
        if (!bytes || bytes.length === 0) return;
        text = Array.from(bytes)
          .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
          .join(" ");
      }
      try {
        await navigator.clipboard?.writeText(text);
        if (!mountedRef.current) return;
        setCopiedKind(kind);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => {
          if (mountedRef.current) setCopiedKind(null);
        }, 1500);
      } catch {
        // clipboard unavailable in restricted contexts
      }
    },
    [
      selectedOffset,
      bytesPerRow,
      effectiveTotalSize,
      readRowSync,
      isChunkedMode,
      safePageSize,
      ensurePage,
    ],
  );

  const selectedHexLabel =
    selectedOffset !== null
      ? `0x${selectedOffset.toString(16).toUpperCase().padStart(8, "0")}`
      : "—";

  const isOffsetMatched = useCallback(
    (absOffset: number) =>
      searchMatch !== null &&
      absOffset >= searchMatch.offset &&
      absOffset < searchMatch.offset + searchMatch.length,
    [searchMatch],
  );

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-lg border border-border/60 bg-background text-foreground",
        className,
      )}
    >
      {/* 紧凑顶部工具栏 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2 text-xs">
        <div className="flex items-center gap-1.5 font-medium">
          <Binary className="h-3.5 w-3.5 text-primary" />
          <span className="max-w-[180px] truncate" title={fileName}>
            {fileName || "Hex View"}
          </span>
          <Badge variant="soft" className="px-1.5 py-0 text-[10px]">
            只读
          </Badge>
          <span className="text-muted-foreground tabular-nums">
            {formatByteSize(effectiveTotalSize)}
          </span>
          <span className="text-muted-foreground/70 tabular-nums">
            ({selectedHexLabel})
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {/* 每行字节数切换 */}
          <div className="flex items-center rounded-md border border-border/60 bg-background p-0.5">
            {([8, 16] as const).map((cols) => (
              <button
                key={cols}
                type="button"
                onClick={() => setBytesPerRow(cols)}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[11px] font-mono transition-colors",
                  bytesPerRow === cols
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {cols}B
              </button>
            ))}
          </div>

          {/* 跳转偏移 */}
          <div className="flex items-center gap-1">
            <Input
              value={jumpInput}
              onChange={(e) => {
                setJumpInput(e.target.value);
                if (jumpError) setJumpError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleJump();
              }}
              placeholder="跳转 0x... / 十进制"
              aria-label="跳转偏移"
              className="h-7 w-32 px-2 font-mono text-[11px]"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={handleJump}
              disabled={effectiveTotalSize === 0}
              aria-label="执行跳转"
            >
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>

          {/* 查找 ASCII / HEX */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() =>
                setSearchMode((m) => (m === "ascii" ? "hex" : "ascii"))
              }
              className="h-7 rounded-md border border-border/60 bg-background px-2 font-mono text-[10px] font-medium text-muted-foreground hover:text-foreground"
              title="切换搜索模式 (ASCII / HEX)"
            >
              {searchMode.toUpperCase()}
            </button>
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleFind();
              }}
              placeholder={
                searchMode === "hex" ? "查找 HEX (如 4D 5A)" : "查找 ASCII..."
              }
              aria-label="查找十六进制或ASCII"
              className="h-7 w-36 px-2 font-mono text-[11px]"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => void handleFind()}
              disabled={effectiveTotalSize === 0 || isSearching}
              aria-label="查找下一个"
            >
              {isSearching ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Search className="h-3 w-3" />
              )}
            </Button>
          </div>

          {/* 复制偏移 / HEX */}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => void handleCopy("offset")}
            disabled={effectiveTotalSize === 0}
            title="复制选中偏移"
          >
            {copiedKind === "offset" ? (
              <Check className="mr-1 h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="mr-1 h-3 w-3" />
            )}
            偏移
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => void handleCopy("hex")}
            disabled={effectiveTotalSize === 0}
            title="复制当前行 HEX"
          >
            {copiedKind === "hex" ? (
              <Check className="mr-1 h-3 w-3 text-emerald-500" />
            ) : (
              <Copy className="mr-1 h-3 w-3" />
            )}
            HEX
          </Button>
        </div>
      </div>

      {/* 分块加载错误提示 */}
      {chunkError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive"
        >
          <span className="flex items-center gap-1.5 min-w-0 truncate">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">分块加载失败: {chunkError}</span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px] gap-1 shrink-0"
            onClick={handleRetryChunks}
          >
            <RotateCcw className="h-3 w-3" />
            重试
          </Button>
        </div>
      )}

      {/* 超大文件行分段导航栏 */}
      {isWindowed && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-muted/20 px-3 py-1 text-[11px]">
          <span className="font-mono text-muted-foreground tabular-nums">
            分段 {safeWindow + 1}/{totalWindows} (0x
            {(windowStartRow * bytesPerRow).toString(16).toUpperCase()} - 0x
            {Math.min(effectiveTotalSize, windowEndRow * bytesPerRow)
              .toString(16)
              .toUpperCase()}
            )
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px] gap-0.5"
              onClick={() => handleSwitchWindow(safeWindow - 1)}
              disabled={safeWindow <= 0}
            >
              <ChevronLeft className="h-3 w-3" />
              上一分段
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px] gap-0.5"
              onClick={() => handleSwitchWindow(safeWindow + 1)}
              disabled={safeWindow >= totalWindows - 1}
            >
              下一分段
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* 状态提示行 */}
      {(jumpError || searchStatus) && (
        <div className="flex items-center gap-3 border-b border-border/40 bg-muted/20 px-3 py-1 text-[11px]">
          {jumpError && <span className="text-destructive">{jumpError}</span>}
          {searchStatus && (
            <span className="font-mono text-muted-foreground">
              查找结果: {searchStatus}
            </span>
          )}
        </div>
      )}

      {/* 虚拟化十六进制主视口 */}
      {effectiveTotalSize === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-xs text-muted-foreground">
          文件内容为空（0 字节）
        </div>
      ) : (
        <div
          ref={parentRef}
          className="flex-1 overflow-auto bg-background font-mono text-xs select-text"
          data-testid="hex-scroll-container"
        >
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualItems.map((virtualRow) => {
              const globalRowIndex = windowStartRow + virtualRow.index;
              const rowOffset = globalRowIndex * bytesPerRow;
              const expectedLen = Math.min(
                bytesPerRow,
                effectiveTotalSize - rowOffset,
              );
              const { bytes, loading } = readRowSync(rowOffset, expectedLen);
              const line = bytes
                ? formatHexLine(rowOffset, bytes, bytesPerRow)
                : formatHexLine(rowOffset, [], bytesPerRow);

              return (
                <div
                  key={globalRowIndex}
                  data-index={globalRowIndex}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="flex items-center whitespace-pre px-3 leading-6 hover:bg-muted/40"
                >
                  {/* Offset Column */}
                  <span className="shrink-0 text-muted-foreground select-none">
                    {line.offsetHex}
                  </span>
                  <span className="mx-2 text-border select-none">|</span>

                  {/* Hex Bytes */}
                  {loading || !bytes ? (
                    <span className="text-muted-foreground/60">
                      {Array.from({ length: expectedLen }, () => "--").join(" ")}
                      {expectedLen < bytesPerRow
                        ? " ".repeat((bytesPerRow - expectedLen) * 3)
                        : ""}
                    </span>
                  ) : (
                    <div className="flex shrink-0 items-center">
                      {Array.from({ length: bytesPerRow }).map((_, colIdx) => {
                        const absOffset = rowOffset + colIdx;
                        const hasByte = colIdx < bytes.length;
                        const gapClass =
                          bytesPerRow === 16 && colIdx === 8 ? "ml-3" : "ml-1";
                        if (!hasByte) {
                          return (
                            <span
                              key={colIdx}
                              className={cn(
                                "inline-block w-[2ch] text-center",
                                colIdx > 0 && gapClass,
                              )}
                            >
                              {"  "}
                            </span>
                          );
                        }
                        const byteHex = bytes[colIdx]
                          .toString(16)
                          .toUpperCase()
                          .padStart(2, "0");
                        const selected = selectedOffset === absOffset;
                        const matched = isOffsetMatched(absOffset);
                        return (
                          <span
                            key={colIdx}
                            onClick={() => setSelectedOffset(absOffset)}
                            data-offset={absOffset}
                            className={cn(
                              "inline-block w-[2ch] cursor-pointer rounded-xs text-center",
                              colIdx > 0 && gapClass,
                              selected &&
                                "bg-primary text-primary-foreground font-semibold",
                              !selected &&
                                matched &&
                                "bg-amber-500/30 text-amber-300 font-semibold",
                            )}
                          >
                            {byteHex}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  <span className="mx-2 text-border select-none">|</span>

                  {/* ASCII Column */}
                  <div className="flex shrink-0 items-center text-emerald-600 dark:text-emerald-400">
                    {loading || !bytes ? (
                      <span className="text-muted-foreground/50">
                        {".".repeat(expectedLen)}
                      </span>
                    ) : (
                      Array.from(bytes).map((b, colIdx) => {
                        const absOffset = rowOffset + colIdx;
                        const ch =
                          b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
                        const selected = selectedOffset === absOffset;
                        const matched = isOffsetMatched(absOffset);
                        return (
                          <span
                            key={colIdx}
                            onClick={() => setSelectedOffset(absOffset)}
                            className={cn(
                              "inline-block w-[1ch] cursor-pointer text-center",
                              selected &&
                                "bg-primary text-primary-foreground font-semibold",
                              !selected &&
                                matched &&
                                "bg-amber-500/30 text-amber-300 font-semibold",
                            )}
                          >
                            {ch}
                          </span>
                        );
                      })
                    )}
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
