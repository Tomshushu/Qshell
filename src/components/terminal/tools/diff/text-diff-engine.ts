/**
 * text-diff-engine.ts
 * 高性能通用文本差异比对引擎（支持普通字符串、日志、配置与 JSON 文本）
 * 提供：
 * 1. 行级 Myers/LCS 差异算法，生成对齐差异块 (Diff Chunks)
 * 2. 行内字符/单词细粒度差异高亮 (Intra-line Word Diff)
 * 3. 差异块合并/应用支持 (Chunk Merge)
 */

export type DiffType = "same" | "delete" | "insert" | "modify";

export interface WordDiffToken {
  text: string;
  type: "same" | "removed" | "added";
}

export interface DiffLine {
  leftLineNumber: number | null; // 1-based, null 表示该行为占位或在左侧不存在
  rightLineNumber: number | null; // 1-based, null 表示该行为占位或在右侧不存在
  type: DiffType;
  leftText: string;
  rightText: string;
  leftTokens?: WordDiffToken[];
  rightTokens?: WordDiffToken[];
  chunkId?: string;
}

export interface DiffChunk {
  id: string;
  type: "delete" | "insert" | "modify";
  leftStartLine: number; // 1-based
  leftEndLine: number;   // 1-based (inclusive)
  rightStartLine: number;
  rightEndLine: number;
  leftLineCount: number;
  rightLineCount: number;
}

export interface DiffResult {
  lines: DiffLine[];
  chunks: DiffChunk[];
  leftLineCount: number;
  rightLineCount: number;
  leftByteSize: number;
  rightByteSize: number;
  isIdentical: boolean;
  diffCount: number; // 差异块数量
}

/**
 * 格式化字节数，如 "1.4 KB", "850 B"
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

/**
 * 计算字符串的 UTF-8 字节大小
 */
export function getByteSize(str: string): number {
  if (typeof Blob !== "undefined") {
    try {
      return new Blob([str]).size;
    } catch {
      // fallback
    }
  }
  return new TextEncoder().encode(str).length;
}

/**
 * 将单行文本分词（支持中英文、单词、标点、空白符）
 */
function tokenizeLine(str: string): string[] {
  if (!str) return [];
  const matches = str.match(/[\w\u4e00-\u9fa5]+|[^\w\s\u4e00-\u9fa5]+|\s+/g);
  return matches || [str];
}

const MAX_LCS_DP_CELLS = 1_000_000;
const MAX_LCS_ANCHOR_DEPTH = 6;
const MAX_GREEDY_WINDOW = 2048;
const MAX_WORD_DIFF_LINE_LENGTH = 4096;
const MAX_WORD_DIFF_PAIRS = 2000;

function lowerBound(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

/**
 * 标准二维 DP 求解区间 [aStart, aEnd) 与 [bStart, bEnd) 的精确 LCS
 */
function dpLCS<T>(
  a: T[],
  aStart: number,
  aEnd: number,
  b: T[],
  bStart: number,
  bEnd: number,
  equals: (x: T, y: T) => boolean,
): { aIndices: number[]; bIndices: number[] } {
  const n = aEnd - aStart;
  const m = bEnd - bStart;
  if (n <= 0 || m <= 0) {
    return { aIndices: [], bIndices: [] };
  }

  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 1; i <= n; i++) {
    const aItem = a[aStart + i - 1];
    const row = dp[i];
    const prevRow = dp[i - 1];
    for (let j = 1; j <= m; j++) {
      if (equals(aItem, b[bStart + j - 1])) {
        row[j] = prevRow[j - 1] + 1;
      } else {
        const up = prevRow[j];
        const left = row[j - 1];
        row[j] = up >= left ? up : left;
      }
    }
  }

  const aMatched: number[] = [];
  const bMatched: number[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (equals(a[aStart + i - 1], b[bStart + j - 1])) {
      aMatched.push(aStart + i - 1);
      bMatched.push(bStart + j - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return {
    aIndices: aMatched.reverse(),
    bIndices: bMatched.reverse(),
  };
}

/**
 * Patience LIS：找出仅在两段中各出现一次的唯一锚点，并求其最长递增公共子序列
 */
function findUniqueAnchors<T>(
  a: T[],
  aStart: number,
  aEnd: number,
  b: T[],
  bStart: number,
  bEnd: number,
): Array<{ aIdx: number; bIdx: number }> {
  const aUnique = new Map<T, number>();
  for (let i = aStart; i < aEnd; i++) {
    const key = a[i];
    aUnique.set(key, aUnique.has(key) ? -1 : i);
  }

  const bUnique = new Map<T, number>();
  for (let j = bStart; j < bEnd; j++) {
    const key = b[j];
    bUnique.set(key, bUnique.has(key) ? -1 : j);
  }

  const candidates: Array<{ aIdx: number; bIdx: number }> = [];
  for (let i = aStart; i < aEnd; i++) {
    const key = a[i];
    if (aUnique.get(key) === i) {
      const bIdx = bUnique.get(key);
      if (bIdx !== undefined && bIdx >= 0) {
        candidates.push({ aIdx: i, bIdx });
      }
    }
  }

  if (candidates.length === 0) return [];

  // O(K log K) LIS on bIdx
  const tails: number[] = [];
  const tailCandIdx: number[] = [];
  const prevCandIdx = new Int32Array(candidates.length).fill(-1);

  for (let k = 0; k < candidates.length; k++) {
    const val = candidates[k].bIdx;
    const pos = lowerBound(tails, val);
    tails[pos] = val;
    tailCandIdx[pos] = k;
    if (pos > 0) {
      prevCandIdx[k] = tailCandIdx[pos - 1];
    }
  }

  const lis: Array<{ aIdx: number; bIdx: number }> = [];
  let cur = tailCandIdx[tails.length - 1];
  while (cur !== undefined && cur >= 0) {
    lis.push(candidates[cur]);
    cur = prevCandIdx[cur];
  }
  return lis.reverse();
}

/**
 * 哈希索引 + 有界窗口贪婪匹配（O((N+M) log freq)），避免大文件 O(N*M) 退化
 */
function boundedHashGreedyLCS<T>(
  a: T[],
  aStart: number,
  aEnd: number,
  b: T[],
  bStart: number,
  bEnd: number,
  equals: (x: T, y: T) => boolean,
): { aIndices: number[]; bIndices: number[] } {
  const bPositions = new Map<T, number[]>();
  for (let j = bStart; j < bEnd; j++) {
    const key = b[j];
    const list = bPositions.get(key);
    if (list) {
      list.push(j);
    } else {
      bPositions.set(key, [j]);
    }
  }

  const m = bEnd - bStart;
  const window = Math.min(MAX_GREEDY_WINDOW, Math.max(256, Math.ceil(m / 8)));
  const aMatched: number[] = [];
  const bMatched: number[] = [];
  let bCursor = bStart;
  let noMatchStreak = 0;

  for (let i = aStart; i < aEnd && bCursor < bEnd; i++) {
    const positions = bPositions.get(a[i]);
    if (!positions) {
      noMatchStreak++;
      continue;
    }
    const posIdx = lowerBound(positions, bCursor);
    if (posIdx >= positions.length) {
      noMatchStreak++;
      continue;
    }
    const j = positions[posIdx];
    const withinWindow = j - bCursor <= window;
    const twoLineSync =
      noMatchStreak >= 32 &&
      i + 1 < aEnd &&
      j + 1 < bEnd &&
      equals(a[i + 1], b[j + 1]);

    if (withinWindow || twoLineSync) {
      aMatched.push(i);
      bMatched.push(j);
      bCursor = j + 1;
      noMatchStreak = 0;
    } else {
      noMatchStreak++;
    }
  }

  return { aIndices: aMatched, bIndices: bMatched };
}

function solveRangeLCS<T>(
  a: T[],
  aStart: number,
  aEnd: number,
  b: T[],
  bStart: number,
  bEnd: number,
  equals: (x: T, y: T) => boolean,
  depth: number,
  outA: number[],
  outB: number[],
): void {
  // 1. 剥离公共前缀
  while (aStart < aEnd && bStart < bEnd && equals(a[aStart], b[bStart])) {
    outA.push(aStart);
    outB.push(bStart);
    aStart++;
    bStart++;
  }

  // 2. 剥离公共后缀
  const suffixA: number[] = [];
  const suffixB: number[] = [];
  while (aEnd > aStart && bEnd > bStart && equals(a[aEnd - 1], b[bEnd - 1])) {
    aEnd--;
    bEnd--;
    suffixA.push(aEnd);
    suffixB.push(bEnd);
  }

  const n = aEnd - aStart;
  const m = bEnd - bStart;

  if (n > 0 && m > 0) {
    if (n * m <= MAX_LCS_DP_CELLS) {
      const res = dpLCS(a, aStart, aEnd, b, bStart, bEnd, equals);
      for (let k = 0; k < res.aIndices.length; k++) {
        outA.push(res.aIndices[k]);
        outB.push(res.bIndices[k]);
      }
    } else {
      const anchors =
        depth < MAX_LCS_ANCHOR_DEPTH
          ? findUniqueAnchors(a, aStart, aEnd, b, bStart, bEnd)
          : [];
      if (anchors.length > 0) {
        let curA = aStart;
        let curB = bStart;
        for (const anchor of anchors) {
          solveRangeLCS(
            a,
            curA,
            anchor.aIdx,
            b,
            curB,
            anchor.bIdx,
            equals,
            depth + 1,
            outA,
            outB,
          );
          outA.push(anchor.aIdx);
          outB.push(anchor.bIdx);
          curA = anchor.aIdx + 1;
          curB = anchor.bIdx + 1;
        }
        solveRangeLCS(a, curA, aEnd, b, curB, bEnd, equals, depth + 1, outA, outB);
      } else {
        const res = boundedHashGreedyLCS(a, aStart, aEnd, b, bStart, bEnd, equals);
        for (let k = 0; k < res.aIndices.length; k++) {
          outA.push(res.aIndices[k]);
          outB.push(res.bIndices[k]);
        }
      }
    }
  }

  for (let k = suffixA.length - 1; k >= 0; k--) {
    outA.push(suffixA[k]);
    outB.push(suffixB[k]);
  }
}

/**
 * 通用 LCS 最长公共子序列算法（前缀/后缀裁剪 + 有界 DP + 唯一行锚点 + 哈希有界窗口兜底）
 */
function computeLCS<T>(a: T[], b: T[], equals: (x: T, y: T) => boolean): { aIndices: number[]; bIndices: number[] } {
  if (a.length === 0 || b.length === 0) {
    return { aIndices: [], bIndices: [] };
  }
  const outA: number[] = [];
  const outB: number[] = [];
  solveRangeLCS(a, 0, a.length, b, 0, b.length, equals, 0, outA, outB);
  return { aIndices: outA, bIndices: outB };
}

/**
 * 计算单行内单词/字符级差异
 */
export function computeWordDiff(
  leftStr: string,
  rightStr: string
): { leftTokens: WordDiffToken[]; rightTokens: WordDiffToken[] } {
  if (leftStr === rightStr) {
    return {
      leftTokens: [{ text: leftStr, type: "same" }],
      rightTokens: [{ text: rightStr, type: "same" }],
    };
  }

  const aTokens = tokenizeLine(leftStr);
  const bTokens = tokenizeLine(rightStr);

  const { aIndices, bIndices } = computeLCS(aTokens, bTokens, (x, y) => x === y);

  const aSet = new Set(aIndices);
  const bSet = new Set(bIndices);

  const leftTokens: WordDiffToken[] = [];
  for (let i = 0; i < aTokens.length; i++) {
    leftTokens.push({
      text: aTokens[i],
      type: aSet.has(i) ? "same" : "removed",
    });
  }

  const rightTokens: WordDiffToken[] = [];
  for (let j = 0; j < bTokens.length; j++) {
    rightTokens.push({
      text: bTokens[j],
      type: bSet.has(j) ? "same" : "added",
    });
  }

  return { leftTokens, rightTokens };
}

/**
 * 核心差异计算引擎：计算左侧与右侧文本的行级与块级差异
 */
export function computeTextDiff(leftText: string, rightText: string): DiffResult {
  const leftLines = leftText ? leftText.split(/\r?\n/) : [];
  const rightLines = rightText ? rightText.split(/\r?\n/) : [];

  const leftByteSize = getByteSize(leftText);
  const rightByteSize = getByteSize(rightText);

  if (leftText === rightText) {
    const lines: DiffLine[] = leftLines.map((t, idx) => ({
      leftLineNumber: idx + 1,
      rightLineNumber: idx + 1,
      type: "same",
      leftText: t,
      rightText: t,
    }));
    return {
      lines,
      chunks: [],
      leftLineCount: leftLines.length,
      rightLineCount: rightLines.length,
      leftByteSize,
      rightByteSize,
      isIdentical: true,
      diffCount: 0,
    };
  }

  // 1. 行级匹配 (LCS)
  const { aIndices, bIndices } = computeLCS(leftLines, rightLines, (x, y) => x === y);

  // 2. 构建行对比流
  const diffLines: DiffLine[] = [];
  const chunks: DiffChunk[] = [];

  let aPtr = 0;
  let bPtr = 0;
  const matchCount = aIndices.length;

  let chunkCounter = 0;
  let wordDiffPairsUsed = 0;

  for (let m = 0; m <= matchCount; m++) {
    const nextAMatch = m < matchCount ? aIndices[m] : leftLines.length;
    const nextBMatch = m < matchCount ? bIndices[m] : rightLines.length;

    const hasDelete = nextAMatch > aPtr;
    const hasInsert = nextBMatch > bPtr;

    if (hasDelete || hasInsert) {
      chunkCounter++;
      const chunkId = `chunk-${chunkCounter}`;
      const chunkType: DiffChunk["type"] =
        hasDelete && hasInsert ? "modify" : hasDelete ? "delete" : "insert";

      const leftSub = leftLines.slice(aPtr, nextAMatch);
      const rightSub = rightLines.slice(bPtr, nextBMatch);

      const chunk: DiffChunk = {
        id: chunkId,
        type: chunkType,
        leftStartLine: hasDelete ? aPtr + 1 : nextAMatch,
        leftEndLine: hasDelete ? nextAMatch : nextAMatch,
        rightStartLine: hasInsert ? bPtr + 1 : nextBMatch,
        rightEndLine: hasInsert ? nextBMatch : nextBMatch,
        leftLineCount: leftSub.length,
        rightLineCount: rightSub.length,
      };
      chunks.push(chunk);

      // 生成差异行（如果是 modify，做成按对或者单独排布）
      const maxSub = Math.max(leftSub.length, rightSub.length);
      for (let k = 0; k < maxSub; k++) {
        const hasL = k < leftSub.length;
        const hasR = k < rightSub.length;
        const lLineNum = hasL ? aPtr + k + 1 : null;
        const rLineNum = hasR ? bPtr + k + 1 : null;
        const lStr = hasL ? leftSub[k] : "";
        const rStr = hasR ? rightSub[k] : "";

        let leftTokens: WordDiffToken[] | undefined;
        let rightTokens: WordDiffToken[] | undefined;

        if (hasL && hasR) {
          if (
            wordDiffPairsUsed < MAX_WORD_DIFF_PAIRS &&
            lStr.length <= MAX_WORD_DIFF_LINE_LENGTH &&
            rStr.length <= MAX_WORD_DIFF_LINE_LENGTH
          ) {
            // modify 行：计算行内字符级别细粒度高亮
            wordDiffPairsUsed++;
            const wordDiff = computeWordDiff(lStr, rStr);
            leftTokens = wordDiff.leftTokens;
            rightTokens = wordDiff.rightTokens;
          } else {
            leftTokens = [{ text: lStr, type: "removed" }];
            rightTokens = [{ text: rStr, type: "added" }];
          }
        } else if (hasL) {
          leftTokens = [{ text: lStr, type: "removed" }];
        } else if (hasR) {
          rightTokens = [{ text: rStr, type: "added" }];
        }

        diffLines.push({
          leftLineNumber: lLineNum,
          rightLineNumber: rLineNum,
          type: chunkType,
          leftText: lStr,
          rightText: rStr,
          leftTokens,
          rightTokens,
          chunkId,
        });
      }

      aPtr = nextAMatch;
      bPtr = nextBMatch;
    }

    // 匹配的相同行
    if (m < matchCount) {
      diffLines.push({
        leftLineNumber: aPtr + 1,
        rightLineNumber: bPtr + 1,
        type: "same",
        leftText: leftLines[aPtr],
        rightText: rightLines[bPtr],
      });
      aPtr++;
      bPtr++;
    }
  }

  return {
    lines: diffLines,
    chunks,
    leftLineCount: leftLines.length,
    rightLineCount: rightLines.length,
    leftByteSize,
    rightByteSize,
    isIdentical: false,
    diffCount: chunks.length,
  };
}

/**
 * 将指定差异块从左侧合并同步到右侧
 */
export function applyChunkFromLeft(
  leftText: string,
  rightText: string,
  chunk: DiffChunk
): string {
  const leftLines = leftText.split(/\r?\n/);
  const rightLines = rightText.split(/\r?\n/);

  // 截取左侧块的内容
  const leftReplacement = chunk.leftLineCount > 0
    ? leftLines.slice(chunk.leftStartLine - 1, chunk.leftEndLine)
    : [];

  // 在右侧替换对应范围
  const rightStartIdx = chunk.rightLineCount > 0
    ? chunk.rightStartLine - 1
    : chunk.rightStartLine; // 插入点
  const deleteCount = chunk.rightLineCount;

  rightLines.splice(rightStartIdx, deleteCount, ...leftReplacement);
  return rightLines.join("\n");
}
