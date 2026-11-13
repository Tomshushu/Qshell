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

/**
 * 通用 LCS 最长公共子序列算法（带快速哈希映射）
 */
function computeLCS<T>(a: T[], b: T[], equals: (x: T, y: T) => boolean): { aIndices: number[]; bIndices: number[] } {
  const n = a.length;
  const m = b.length;

  if (n === 0 || m === 0) {
    return { aIndices: [], bIndices: [] };
  }

  // 针对特别长数组设置上限保护，防止超出内存限制 (例如 5000+ 行)
  const maxCells = 5000 * 5000;
  if (n * m > maxCells) {
    // 降级为快速贪婪匹配
    return greedyLCS(a, b, equals);
  }

  // 标准二维 DP
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (equals(a[i - 1], b[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        const up = dp[i - 1][j];
        const left = dp[i][j - 1];
        dp[i][j] = up >= left ? up : left;
      }
    }
  }

  const aMatched: number[] = [];
  const bMatched: number[] = [];
  let i = n;
  let j = m;

  while (i > 0 && j > 0) {
    if (equals(a[i - 1], b[j - 1])) {
      aMatched.push(i - 1);
      bMatched.push(j - 1);
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

function greedyLCS<T>(a: T[], b: T[], equals: (x: T, y: T) => boolean): { aIndices: number[]; bIndices: number[] } {
  const aMatched: number[] = [];
  const bMatched: number[] = [];
  let bStart = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = bStart; j < b.length; j++) {
      if (equals(a[i], b[j])) {
        aMatched.push(i);
        bMatched.push(j);
        bStart = j + 1;
        break;
      }
    }
  }
  return { aIndices: aMatched, bIndices: bMatched };
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
          // modify 行：计算行内字符级别细粒度高亮
          const wordDiff = computeWordDiff(lStr, rStr);
          leftTokens = wordDiff.leftTokens;
          rightTokens = wordDiff.rightTokens;
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
