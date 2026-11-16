export type BinaryDiffRowKind = "equal" | "modified" | "added" | "removed";

export interface BinaryDiffRow {
  offset: number;
  leftBytes: Uint8Array;
  rightBytes: Uint8Array;
  changedMask: boolean[];
  kind: BinaryDiffRowKind;
}

export interface BinaryDiffStats {
  equalBytes: number;
  diffBytes: number;
  totalLeft: number;
  totalRight: number;
  diffOffsetList: number[];
}

export interface BinaryDiffResult {
  rows: BinaryDiffRow[];
  stats: BinaryDiffStats;
  bytesPerRow: number;
  totalRows: number;
  page: number;
  pageSize: number;
  totalPages: number;
  truncatedDiffOffsets: boolean;
}

export interface ChunkedBinarySource {
  totalSize: number;
  readRange: (offset: number, len: number) => Promise<Uint8Array>;
}

export interface BinaryDiffOptions {
  /** 每行对比字节数（默认 16） */
  bytesPerRow?: number;
  /** 分块读取块大小（默认 64KB） */
  chunkSize?: number;
  /** 每处理 N 个分块主动让出微任务队列一次（默认 4） */
  yieldEveryChunks?: number;
  /** 记录差异偏移的最大数量上限，防止 100MB 全异文件 OOM（默认 100_000） */
  maxDiffOffsets?: number;
  /** 可选分页页码（从 0 开始）；省略时返回全部行 */
  page?: number;
  /** 可选分页大小（每页行数）；配合 page 使用 */
  pageSize?: number;
  /** 是否仅保留存在差异的行 */
  onlyChangedRows?: boolean;
  /** 取消信号 */
  signal?: AbortSignal;
  /** 进度回调（已处理字节 / 总字节） */
  onProgress?: (processedBytes: number, totalBytes: number) => void;
}

const DEFAULT_BYTES_PER_ROW = 16;
const DEFAULT_CHUNK_SIZE = 64 * 1024;
const DEFAULT_YIELD_EVERY_CHUNKS = 4;
const DEFAULT_MAX_DIFF_OFFSETS = 100_000;
/** 差异行索引收集上限：100MB 全异文件按 16B/行会产生约 650 万项，需截断防止内存爆炸 */
const MAX_CHANGED_ROW_INDICES = 200_000;

function toUint8Array(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Binary diff aborted", "AbortError");
  }
}

export function paginateBinaryDiffRows(
  rows: BinaryDiffRow[],
  page: number,
  pageSize: number,
): {
  rows: BinaryDiffRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
} {
  const safePageSize = Math.max(1, Math.floor(pageSize) || 1);
  const totalRows = rows.length;
  const totalPages = totalRows === 0 ? 0 : Math.ceil(totalRows / safePageSize);
  const safePage =
    totalPages === 0
      ? 0
      : Math.max(0, Math.min(totalPages - 1, Math.floor(page) || 0));
  const start = safePage * safePageSize;
  return {
    rows: rows.slice(start, start + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    totalRows,
    totalPages,
  };
}

/**
 * 分块异步二进制差异对比引擎（支持 100MB+ 流式/按块读取且不阻塞主线程 FPS）
 */
export async function compareChunkedBinarySources(
  left: ChunkedBinarySource,
  right: ChunkedBinarySource,
  options: BinaryDiffOptions = {},
): Promise<BinaryDiffResult> {
  const bytesPerRow = Math.max(
    1,
    Math.floor(options.bytesPerRow ?? DEFAULT_BYTES_PER_ROW),
  );
  const rawChunkSize = Math.max(
    bytesPerRow,
    Math.floor(options.chunkSize ?? DEFAULT_CHUNK_SIZE),
  );
  // 对齐到 bytesPerRow 整数倍，避免分块边界切断单行
  const chunkSize = Math.max(
    bytesPerRow,
    Math.floor(rawChunkSize / bytesPerRow) * bytesPerRow,
  );
  const yieldEveryChunks = Math.max(
    1,
    Math.floor(options.yieldEveryChunks ?? DEFAULT_YIELD_EVERY_CHUNKS),
  );
  const maxDiffOffsets = Math.max(
    0,
    Math.floor(options.maxDiffOffsets ?? DEFAULT_MAX_DIFF_OFFSETS),
  );
  const onlyChangedRows = options.onlyChangedRows === true;
  const hasPagination =
    typeof options.page === "number" && typeof options.pageSize === "number";
  const requestedPage = hasPagination
    ? Math.max(0, Math.floor(options.page!))
    : 0;
  const requestedPageSize = hasPagination
    ? Math.max(1, Math.floor(options.pageSize!))
    : 0;

  const totalLeft = Math.max(0, Math.floor(left.totalSize));
  const totalRight = Math.max(0, Math.floor(right.totalSize));
  const maxLen = Math.max(totalLeft, totalRight);
  const totalRawRows = maxLen === 0 ? 0 : Math.ceil(maxLen / bytesPerRow);

  const stats: BinaryDiffStats = {
    equalBytes: 0,
    diffBytes: 0,
    totalLeft,
    totalRight,
    diffOffsetList: [],
  };

  if (maxLen === 0) {
    options.onProgress?.(0, 0);
    return {
      rows: [],
      stats,
      bytesPerRow,
      totalRows: 0,
      page: 0,
      pageSize: hasPagination ? requestedPageSize : 0,
      totalPages: 0,
      truncatedDiffOffsets: false,
    };
  }

  const collectedRows: BinaryDiffRow[] = [];
  let matchedRowCounter = 0;
  let truncatedDiffOffsets = false;
  let chunkIndex = 0;

  const pageStartIdx = hasPagination ? requestedPage * requestedPageSize : 0;
  const pageEndIdx = hasPagination
    ? pageStartIdx + requestedPageSize
    : Number.POSITIVE_INFINITY;

  for (let chunkOffset = 0; chunkOffset < maxLen; ) {
    throwIfAborted(options.signal);

    const leftLen = Math.max(
      0,
      Math.min(chunkSize, totalLeft - chunkOffset),
    );
    const rightLen = Math.max(
      0,
      Math.min(chunkSize, totalRight - chunkOffset),
    );

    const [leftChunk, rightChunk] = await Promise.all([
      leftLen > 0
        ? left.readRange(chunkOffset, leftLen)
        : Promise.resolve(new Uint8Array(0)),
      rightLen > 0
        ? right.readRange(chunkOffset, rightLen)
        : Promise.resolve(new Uint8Array(0)),
    ]);

    throwIfAborted(options.signal);

    const chunkMaxLen = Math.max(leftChunk.length, rightChunk.length);
    if (chunkMaxLen === 0) {
      break;
    }
    for (let rel = 0; rel < chunkMaxLen; rel += bytesPerRow) {
      const rowOffset = chunkOffset + rel;
      const rowLeft =
        rel < leftChunk.length
          ? leftChunk.subarray(rel, Math.min(rel + bytesPerRow, leftChunk.length))
          : new Uint8Array(0);
      const rowRight =
        rel < rightChunk.length
          ? rightChunk.subarray(
              rel,
              Math.min(rel + bytesPerRow, rightChunk.length),
            )
          : new Uint8Array(0);

      const rowLen = Math.max(rowLeft.length, rowRight.length);
      const changedMask = new Array<boolean>(rowLen);
      let rowHasDiff = false;

      for (let i = 0; i < rowLen; i++) {
        const hasL = i < rowLeft.length;
        const hasR = i < rowRight.length;
        const changed = !hasL || !hasR || rowLeft[i] !== rowRight[i];
        changedMask[i] = changed;
        if (changed) {
          rowHasDiff = true;
          stats.diffBytes += 1;
          if (stats.diffOffsetList.length < maxDiffOffsets) {
            stats.diffOffsetList.push(rowOffset + i);
          } else {
            truncatedDiffOffsets = true;
          }
        } else {
          stats.equalBytes += 1;
        }
      }

      if (onlyChangedRows && !rowHasDiff) {
        continue;
      }

      const kind: BinaryDiffRowKind =
        rowLeft.length === 0 && rowRight.length > 0
          ? "added"
          : rowRight.length === 0 && rowLeft.length > 0
            ? "removed"
            : rowHasDiff
              ? "modified"
              : "equal";

      const currentMatchIndex = matchedRowCounter;
      matchedRowCounter += 1;

      if (
        !hasPagination ||
        (currentMatchIndex >= pageStartIdx && currentMatchIndex < pageEndIdx)
      ) {
        collectedRows.push({
          offset: rowOffset,
          leftBytes: rowLeft,
          rightBytes: rowRight,
          changedMask,
          kind,
        });
      }
    }

    chunkIndex += 1;
    // 若读取发生短读，仅按两端已对齐读到的最大步长推进；若期望有数据却双双返回空块上面已 break
    const stepAdvance =
      leftChunk.length >= leftLen && rightChunk.length >= rightLen
        ? Math.max(1, chunkMaxLen)
        : Math.max(
            1,
            Math.min(
              leftLen > 0 ? leftChunk.length : Number.POSITIVE_INFINITY,
              rightLen > 0 ? rightChunk.length : Number.POSITIVE_INFINITY,
            ),
          );
    const nextOffset =
      stepAdvance === Number.POSITIVE_INFINITY ? maxLen : chunkOffset + stepAdvance;
    chunkOffset = Math.min(maxLen, nextOffset);
    options.onProgress?.(chunkOffset, maxLen);

    if (chunkOffset < maxLen && chunkIndex % yieldEveryChunks === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      throwIfAborted(options.signal);
    }
  }

  const totalRows = onlyChangedRows ? matchedRowCounter : totalRawRows;
  const effectivePageSize = hasPagination ? requestedPageSize : totalRows;
  const totalPages =
    totalRows === 0 || !hasPagination
      ? totalRows === 0
        ? 0
        : 1
      : Math.ceil(totalRows / requestedPageSize);

  return {
    rows: collectedRows,
    stats,
    bytesPerRow,
    totalRows,
    page: hasPagination ? requestedPage : 0,
    pageSize: effectivePageSize,
    totalPages,
    truncatedDiffOffsets,
  };
}

export interface BinaryDiffSummary {
  equalBytes: number;
  diffBytes: number;
  totalLeft: number;
  totalRight: number;
  totalRows: number;
  bytesPerRow: number;
  changedRowIndices: number[];
  /** changedRowIndices 达到收集上限被截断时置 true，消费方可据此提示差异导航不完整 */
  changedRowIndicesTruncated?: boolean;
}

export interface BinaryDiffScanOptions {
  bytesPerRow?: number;
  chunkSize?: number;
  yieldEveryChunks?: number;
  signal?: AbortSignal;
  onProgress?: (processedBytes: number, totalBytes: number) => void;
}

/**
 * 仅按需构建单行 BinaryDiffRow（供分页虚拟视口懒加载使用，避免对整段缓冲区分配海量行对象）
 */
export function buildBinaryDiffRow(
  left: Uint8Array,
  right: Uint8Array,
  rowIndex: number,
  bytesPerRow = DEFAULT_BYTES_PER_ROW,
  baseOffset = 0,
): BinaryDiffRow {
  const safeBytesPerRow = Math.max(1, Math.floor(bytesPerRow));
  const relOffset = rowIndex * safeBytesPerRow;
  const rowLeft =
    relOffset < left.byteLength
      ? left.subarray(relOffset, Math.min(left.byteLength, relOffset + safeBytesPerRow))
      : new Uint8Array(0);
  const rowRight =
    relOffset < right.byteLength
      ? right.subarray(relOffset, Math.min(right.byteLength, relOffset + safeBytesPerRow))
      : new Uint8Array(0);

  const rowLen = Math.max(rowLeft.length, rowRight.length);
  const changedMask = new Array<boolean>(rowLen);
  let rowHasDiff = false;

  for (let i = 0; i < rowLen; i++) {
    const hasL = i < rowLeft.length;
    const hasR = i < rowRight.length;
    const changed = !hasL || !hasR || rowLeft[i] !== rowRight[i];
    changedMask[i] = changed;
    if (changed) rowHasDiff = true;
  }

  const kind: BinaryDiffRowKind =
    rowLeft.length === 0 && rowRight.length > 0
      ? "added"
      : rowRight.length === 0 && rowLeft.length > 0
        ? "removed"
        : rowHasDiff
          ? "modified"
          : "equal";

  return {
    offset: baseOffset + relOffset,
    leftBytes: rowLeft,
    rightBytes: rowRight,
    changedMask,
    kind,
  };
}

/**
 * 轻量扫描两个内存缓冲区：仅统计相同/差异字节数及发生差异的行索引，不分配任何 BinaryDiffRow 对象
 */
export async function scanBinaryBuffersSummary(
  left: Uint8Array | ArrayBuffer,
  right: Uint8Array | ArrayBuffer,
  options: BinaryDiffScanOptions = {},
): Promise<BinaryDiffSummary> {
  const leftView = toUint8Array(left);
  const rightView = toUint8Array(right);

  const bytesPerRow = Math.max(
    1,
    Math.floor(options.bytesPerRow ?? DEFAULT_BYTES_PER_ROW),
  );
  const rawChunkSize = Math.max(
    bytesPerRow,
    Math.floor(options.chunkSize ?? DEFAULT_CHUNK_SIZE),
  );
  const chunkSize = Math.max(
    bytesPerRow,
    Math.floor(rawChunkSize / bytesPerRow) * bytesPerRow,
  );
  const yieldEveryChunks = Math.max(
    1,
    Math.floor(options.yieldEveryChunks ?? DEFAULT_YIELD_EVERY_CHUNKS),
  );

  const totalLeft = leftView.byteLength;
  const totalRight = rightView.byteLength;
  const maxLen = Math.max(totalLeft, totalRight);
  const totalRows = maxLen === 0 ? 0 : Math.ceil(maxLen / bytesPerRow);

  if (maxLen === 0) {
    throwIfAborted(options.signal);
    options.onProgress?.(0, 0);
    return {
      equalBytes: 0,
      diffBytes: 0,
      totalLeft: 0,
      totalRight: 0,
      totalRows: 0,
      bytesPerRow,
      changedRowIndices: [],
    };
  }

  let equalBytes = 0;
  let diffBytes = 0;
  const changedRowIndices: number[] = [];
  let changedRowIndicesTruncated = false;
  let chunkIndex = 0;

  for (let chunkOffset = 0; chunkOffset < maxLen; chunkOffset += chunkSize) {
    throwIfAborted(options.signal);
    const chunkEnd = Math.min(maxLen, chunkOffset + chunkSize);

    for (let rowOffset = chunkOffset; rowOffset < chunkEnd; rowOffset += bytesPerRow) {
      const rowEnd = Math.min(maxLen, rowOffset + bytesPerRow);
      let rowHasDiff = false;

      for (let abs = rowOffset; abs < rowEnd; abs++) {
        const hasL = abs < totalLeft;
        const hasR = abs < totalRight;
        if (!hasL || !hasR || leftView[abs] !== rightView[abs]) {
          diffBytes += 1;
          rowHasDiff = true;
        } else {
          equalBytes += 1;
        }
      }

      if (rowHasDiff) {
        if (changedRowIndices.length < MAX_CHANGED_ROW_INDICES) {
          changedRowIndices.push(rowOffset / bytesPerRow);
        } else {
          changedRowIndicesTruncated = true;
        }
      }
    }

    chunkIndex += 1;
    options.onProgress?.(chunkEnd, maxLen);

    if (chunkEnd < maxLen && chunkIndex % yieldEveryChunks === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      throwIfAborted(options.signal);
    }
  }

  return {
    equalBytes,
    diffBytes,
    totalLeft,
    totalRight,
    totalRows,
    bytesPerRow,
    changedRowIndices,
    changedRowIndicesTruncated,
  };
}

/**
 * 内存缓冲区异步二进制差异对比（复用分块引擎并周期让出事件循环）
 */
export async function compareBinaryBuffers(
  left: Uint8Array | ArrayBuffer,
  right: Uint8Array | ArrayBuffer,
  options: BinaryDiffOptions = {},
): Promise<BinaryDiffResult> {
  const leftView = toUint8Array(left);
  const rightView = toUint8Array(right);

  const leftSource: ChunkedBinarySource = {
    totalSize: leftView.byteLength,
    readRange: async (offset, len) =>
      leftView.subarray(offset, Math.min(leftView.byteLength, offset + len)),
  };
  const rightSource: ChunkedBinarySource = {
    totalSize: rightView.byteLength,
    readRange: async (offset, len) =>
      rightView.subarray(offset, Math.min(rightView.byteLength, offset + len)),
  };

  return compareChunkedBinarySources(leftSource, rightSource, options);
}
