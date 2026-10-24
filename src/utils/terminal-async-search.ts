/**
 * 异步时间分片终端搜索器 (Async Terminal Searcher)
 *
 * 核心架构（参考 VS Code 视口虚拟化 + 渐进式检索标准）：
 * 1. 彻底解决海量日志（50,000 ~ 100,000+ 行）下搜索冻结 UI 主线程问题。
 * 2. 时间分片（Time-Slicing）：每批次执行严格限制在 8ms 以内，超时让出主线程，保持 60/120fps 流畅。
 * 3. 视口虚拟化高亮（Viewport-Driven Rendering）：
 *    - 无论日志有几十万行，高亮装饰仅对当前屏幕可见视口范围（Viewport）按需动态挂载与回收；
 *    - 离开屏幕的 DOM 装饰自动 dispose，进入屏幕的匹配项 100% 自动点亮金黄色；
 *    - 杜绝传统实现中“历史行耗尽名额导致屏幕发黑”的根本缺陷，DOM 节点数量恒定保持极少（0~60 个）。
 * 4. 醒目主次层级高反差：
 *    - 当前翻动焦点项（Active Match）：实心纯正深橙色（#FF8C00）+ 1.5px 轮廓框 + 滚动条全宽标尺；
 *    - 屏幕内其他匹配项（Other Matches）：半透明柔和金黄（rgba(255, 215, 0, 0.35)）+ 1px 细轮廓 + 滚动条右侧标尺；
 *    - 严格解耦 Selection 选区，彻底消除失焦黑底与闪烁冲突。
 * 5. 终端视口滚动实时联动（onScroll Listener）：用户使用鼠标滚轮或翻页跳转时，视口高亮即时自适应同步。
 */

import type { Terminal, IBuffer, IBufferLine, IDecoration } from "@xterm/xterm";

export interface ISearchOptions {
  regex?: boolean;
  wholeWord?: boolean;
  caseSensitive?: boolean;
  decorations?: boolean;
}

export interface ISearchMatch {
  col: number;
  row: number;
  size: number;
  term: string;
}

export interface ISearchStateChange {
  resultIndex: number;
  resultCount: number;
  isSearching: boolean;
  isCapped: boolean; // 是否达到索引上限（如 1000+）
}

const NON_WORD_CHARACTERS = ' ~!@#$%^&*()+`-=[]{}|\\;:"\',./<>?';
const TIME_BUDGET_MS = 8; // 每切片最大执行毫秒数（<= 8ms）
const MAX_MATCHES_LIMIT = 1000; // 最大索引匹配项数（支持翻阅多达 1000 处匹配）

/**
 * 判断是否为全词匹配边界
 */
function isWholeWord(searchIndex: number, line: string, termLength: number): boolean {
  const leftChar = searchIndex === 0 ? " " : line[searchIndex - 1];
  const rightChar = searchIndex + termLength >= line.length ? " " : line[searchIndex + termLength];
  return NON_WORD_CHARACTERS.includes(leftChar) && NON_WORD_CHARACTERS.includes(rightChar);
}

/**
 * 将终端行翻译为文本字符串并记录物理折行偏移量
 */
function translateBufferLineToStringWithWrap(
  buffer: IBuffer,
  lineIndex: number,
  trimRight: boolean,
): [string, number[]] {
  const strings: string[] = [];
  const lineOffsets: number[] = [0];
  let line = buffer.getLine(lineIndex);

  while (line) {
    const nextLine = buffer.getLine(lineIndex + 1);
    const lineWrapsToNext = nextLine ? nextLine.isWrapped : false;
    let str = line.translateToString(!lineWrapsToNext && trimRight);

    if (lineWrapsToNext && nextLine) {
      const lastCell = line.getCell(line.length - 1);
      const lastCellIsNull = lastCell && lastCell.getCode() === 0 && lastCell.getWidth() === 1;
      if (lastCellIsNull && nextLine.getCell(0)?.getWidth() === 2) {
        str = str.slice(0, -1);
      }
    }

    strings.push(str);
    if (lineWrapsToNext) {
      lineOffsets.push(lineOffsets[lineOffsets.length - 1] + str.length);
    } else {
      break;
    }
    lineIndex++;
    line = nextLine;
  }

  return [strings.join(""), lineOffsets];
}

/**
 * 计算字符在终端缓冲区单元格中的物理列偏移（考虑宽字符和 Emoji）
 */
function stringLengthToBufferSize(line: IBufferLine | undefined, offset: number): number {
  if (!line) return 0;
  for (let i = 0; i < offset; i++) {
    const cell = line.getCell(i);
    if (!cell) break;
    const char = cell.getChars();
    if (char.length > 1) {
      offset -= char.length - 1;
    }
    const nextCell = line.getCell(i + 1);
    if (nextCell && nextCell.getWidth() === 0) {
      offset++;
    }
  }
  return offset;
}

export class AsyncTerminalSearcher {
  private _terminal: Terminal;
  private _searchId = 0;
  private _matches: ISearchMatch[] = [];
  private _activeIndex = -1;
  private _viewportDecorations = new Map<string, IDecoration[]>();
  private _activeDecorations: IDecoration[] = [];
  private _scrollDisposable: { dispose(): void } | null = null;
  private _resizeDisposable: { dispose(): void } | null = null;
  private _writeParsedDisposable: { dispose(): void } | null = null;
  private _resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _writeParsedDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _bufferDirty = false;
  private _lastCols = 0;
  private _lastRows = 0;
  private _currentTerm = "";
  private _currentOptions: ISearchOptions = {};
  private _onStateChange?: (state: ISearchStateChange) => void;

  // ── 性能优化字段 ──
  // 上一次渲染的视口行范围缓存，用于跳过无变化的重复渲染
  private _lastRenderedMinRow = -1;
  private _lastRenderedMaxRow = -1;
  private _lastRenderedActiveKey = "";
  // requestAnimationFrame 节流标记，将连续滚动事件合并为一次渲染
  private _scrollRafPending = false;
  private _scrollRafId: number | null = null;
  // 在 findNext/findPrevious 程序滚动期间抑制 onScroll 触发的重复渲染
  private _suppressScrollRender = false;
  private _disposed = false;

  constructor(terminal: Terminal, onStateChange?: (state: ISearchStateChange) => void) {
    this._terminal = terminal;
    this._onStateChange = onStateChange;
    this._lastCols = terminal?.cols || 0;
    this._lastRows = terminal?.rows || 0;

    // 监听视口滚动（包括鼠标滚轮和 API 滚动），动态刷新当前视口高亮
    // 使用 requestAnimationFrame 节流，每帧最多渲染一次
    if (typeof this._terminal?.onScroll === "function") {
      this._scrollDisposable = this._terminal.onScroll(() => {
        if (this._disposed || !this._currentTerm || this._suppressScrollRender) return;
        if (!this._scrollRafPending) {
          this._scrollRafPending = true;
          this._scrollRafId = requestAnimationFrame(() => {
            this._scrollRafId = null;
            this._scrollRafPending = false;
            if (!this._disposed && this._currentTerm && !this._suppressScrollRender) {
              this._renderViewportDecorations();
            }
          });
        }
      });
    }

    // 核心架构修复：监听终端尺寸变化 (窗口缩放、分屏调整导致物理折行重排)
    // 窗口缩放会导致 xterm 内部执行 reflow，所有文本行的物理列号和折行断点全部发生位移。
    // 旧的匹配坐标 (row, col) 全部失效，若不响应 resize，高亮会错位落在其他文字（如 .sync）上。
    if (typeof this._terminal?.onResize === "function") {
      this._resizeDisposable = this._terminal.onResize(({ cols, rows }) => {
        if (this._disposed || !this._currentTerm) return;
        // 1. 立即清除失效的高亮 DOM 装饰，防止在屏幕上残留错位的高亮框
        this._clearDecorations();
        this._bufferDirty = true;
        this._lastCols = cols;
        this._lastRows = rows;

        // 2. 150ms 防抖重新索引与对齐，保证拖拽窗口过程中不反复全量重算
        if (this._resizeDebounceTimer) {
          clearTimeout(this._resizeDebounceTimer);
        }
        this._resizeDebounceTimer = setTimeout(() => {
          this._resizeDebounceTimer = null;
          if (!this._disposed && this._currentTerm && this._bufferDirty) {
            this.reindex(true);
          }
        }, 150);
      });
    }

    // 监听终端写入解析完成事件 (新日志输出导致行数增长或 scrollback 头部丢弃)
    if (typeof this._terminal?.onWriteParsed === "function") {
      this._writeParsedDisposable = this._terminal.onWriteParsed(() => {
        if (this._disposed || !this._currentTerm) return;
        this._bufferDirty = true;
        if (this._writeParsedDebounceTimer) {
          clearTimeout(this._writeParsedDebounceTimer);
        }
        // 日志倾泻时防抖 300ms 刷新索引，避免频繁刷帧
        this._writeParsedDebounceTimer = setTimeout(() => {
          this._writeParsedDebounceTimer = null;
          if (!this._disposed && this._currentTerm && this._bufferDirty) {
            this.reindex(true);
          }
        }, 300);
      });
    }
  }

  public get activeIndex(): number {
    return this._activeIndex;
  }

  public get matchCount(): number {
    return this._matches.length;
  }

  public get currentTerm(): string {
    return this._currentTerm;
  }

  /**
   * 当终端发生窗口缩放 (resize/reflow) 或日志输出导致行索引位移时，
   * 重新扫描缓冲区并保持当前视口高亮和焦点准确
   */
  public async reindex(noScroll = true): Promise<boolean> {
    if (!this._currentTerm) return false;
    this._bufferDirty = false;
    this._lastCols = this._terminal.cols;
    this._lastRows = this._terminal.rows;
    return this.search(this._currentTerm, this._currentOptions, "next", noScroll, true);
  }

  /**
   * 启动一次新的异步分片检索
   */
  public async search(
    term: string,
    options: ISearchOptions = {},
    direction: "next" | "prev" = "next",
    noScroll = false,
    forceRescan = false,
  ): Promise<boolean> {
    // 保持 search() 的历史 API：dispose 后调用仍是无害的 no-op，
    // 调用方只关心“请求已被接受”，不会因为组件卸载而抛异常或进入异步扫描。
    if (this._disposed) return true;
    const trimmed = term.trim();
    if (!trimmed) {
      this.clear();
      return false;
    }

    // 正则模式校验
    if (options.regex) {
      try {
        new RegExp(term);
      } catch {
        this.clear();
        return false;
      }
    }

    // 如果关键词和选项完全未变，且已经有匹配项，且终端缓冲区尺寸未发生变化，直接执行即时跳转
    if (
      !forceRescan &&
      !this._bufferDirty &&
      this._terminal.cols === this._lastCols &&
      this._terminal.rows === this._lastRows &&
      this._currentTerm === term &&
      this._matches.length > 0 &&
      this._currentOptions.caseSensitive === options.caseSensitive &&
      this._currentOptions.wholeWord === options.wholeWord &&
      this._currentOptions.regex === options.regex
    ) {
      if (direction === "next") {
        this.findNext();
      } else {
        this.findPrevious();
      }
      return true;
    }

    // 每次新搜索自增 searchId，任何正在运行的旧异步分片协程立即自然失效退出
    const searchId = ++this._searchId;
    this._currentTerm = term;
    this._currentOptions = { ...options };
    this._bufferDirty = false;
    this._lastCols = this._terminal.cols;
    this._lastRows = this._terminal.rows;
    this._matches = [];
    this._activeIndex = -1;
    this._clearDecorations();

    this._notifyState(true);

    const buffer = this._terminal.buffer.active;
    const totalLines = buffer.length;
    if (totalLines === 0) {
      this._notifyState(false);
      return false;
    }

    // 第一阶段：快速视口嗅探（Fast Sniffing）
    // 优先检查当前视口前后数十行（通常几毫秒内完成），若命中立即在当前屏幕呈现全部金色高亮与橙色焦点
    const viewportY = buffer.viewportY;
    const sniffStart = Math.max(0, viewportY - 20);
    const sniffEnd = Math.min(totalLines, viewportY + this._terminal.rows + 50);
    const quickMatches = this._scanSyncRange(term, options, sniffStart, sniffEnd);

    let activeMatch: ISearchMatch | null = null;
    if (quickMatches.length > 0) {
      // 预先存入 matches，保证翻页和视口渲染立即有基准数据
      this._matches = [...quickMatches];
      if (direction === "next") {
        activeMatch = quickMatches.find((m) => m.row >= viewportY) || quickMatches[0];
      } else {
        activeMatch = [...quickMatches].reverse().find((m) => m.row <= viewportY) || quickMatches[quickMatches.length - 1];
      }
      if (activeMatch) {
        this._activeIndex = this._matches.indexOf(activeMatch);
        this._selectAndScrollTo(activeMatch, noScroll);
      } else {
        this._renderViewportDecorations(true);
      }
      this._notifyState(true);
    }

    // 第二阶段：异步分片全局扫描（按行号正序从 0 到 totalLines）
    // 每批次 8ms 预算，超时立即 yield 让出主线程
    await this._scanAllAsync(searchId, term, options, activeMatch);

    if (this._disposed || searchId !== this._searchId) return false;

    // 如果视口嗅探未命中但全量找到了匹配项，定位到距离视口最近的匹配项
    if (!activeMatch && this._matches.length > 0) {
      if (direction === "next") {
        const nextIdx = this._matches.findIndex((m) => m.row >= viewportY);
        this._activeIndex = nextIdx >= 0 ? nextIdx : 0;
      } else {
        let prevIdx = -1;
        for (let i = this._matches.length - 1; i >= 0; i--) {
          if (this._matches[i].row <= viewportY) {
            prevIdx = i;
            break;
          }
        }
        this._activeIndex = prevIdx >= 0 ? prevIdx : this._matches.length - 1;
      }
      this._selectAndScrollTo(this._matches[this._activeIndex], noScroll);
    } else if (this._matches.length > 0) {
      this._renderViewportDecorations(true);
    }

    this._notifyState(false);
    return this._matches.length > 0;
  }

  /**
   * 快速同步扫描一小段行（仅用于当前视口极小范围嗅探，通常耗时 < 1ms）
   */
  private _scanSyncRange(
    term: string,
    options: ISearchOptions,
    startRow: number,
    endRow: number,
  ): ISearchMatch[] {
    const results: ISearchMatch[] = [];
    const buffer = this._terminal.buffer.active;
    const cols = this._terminal.cols;

    let regex: RegExp | null = null;
    let needle = term;
    if (options.regex) {
      try {
        regex = new RegExp(term, options.caseSensitive ? "g" : "gi");
      } catch {
        return [];
      }
    } else {
      needle = options.caseSensitive ? term : term.toLowerCase();
    }

    for (let row = startRow; row < endRow; row++) {
      const line = buffer.getLine(row);
      if (!line || line.isWrapped) continue;

      const [stringLine, offsets] = translateBufferLineToStringWithWrap(buffer, row, true);
      if (!stringLine) continue;

      if (regex) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(stringLine)) !== null) {
          if (match[0].length === 0) {
            regex.lastIndex++;
            continue;
          }
          const m = this._createMatch(buffer, cols, row, match.index, match[0].length, match[0], offsets);
          if (m) results.push(m);
        }
      } else {
        const hay = options.caseSensitive ? stringLine : stringLine.toLowerCase();
        let idx = 0;
        while ((idx = hay.indexOf(needle, idx)) !== -1) {
          if (options.wholeWord && !isWholeWord(idx, hay, term.length)) {
            idx += term.length;
            continue;
          }
          const actualTerm = stringLine.slice(idx, idx + term.length);
          const m = this._createMatch(buffer, cols, row, idx, term.length, actualTerm, offsets);
          if (m) results.push(m);
          idx += term.length;
        }
      }
    }

    return results;
  }

  /**
   * 异步时间分片扫描全部行（严格控制每切片 <= 8ms）
   */
  private async _scanAllAsync(
    searchId: number,
    term: string,
    options: ISearchOptions,
    preselectedMatch: ISearchMatch | null,
  ): Promise<void> {
    const buffer = this._terminal.buffer.active;
    const totalLines = buffer.length;
    const cols = this._terminal.cols;

    let regex: RegExp | null = null;
    let needle = term;
    if (options.regex) {
      regex = new RegExp(term, options.caseSensitive ? "g" : "gi");
    } else {
      needle = options.caseSensitive ? term : term.toLowerCase();
    }

    const allMatches: ISearchMatch[] = [];
    let sliceStartTime = performance.now();

    for (let row = 0; row < totalLines; row++) {
      if (this._disposed || searchId !== this._searchId) return;

      if (allMatches.length >= MAX_MATCHES_LIMIT) {
        break;
      }

      // 8ms 预算出让控制
      if (performance.now() - sliceStartTime >= TIME_BUDGET_MS) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (this._disposed || searchId !== this._searchId) return;
        sliceStartTime = performance.now();
        // 增量同步 matches 给 UI 展示进度
        this._matches = allMatches;
        this._notifyState(true);
      }

      const line = buffer.getLine(row);
      if (!line || line.isWrapped) continue;

      const [stringLine, offsets] = translateBufferLineToStringWithWrap(buffer, row, true);
      if (!stringLine) continue;

      if (regex) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(stringLine)) !== null) {
          if (match[0].length === 0) {
            regex.lastIndex++;
            continue;
          }
          const m = this._createMatch(buffer, cols, row, match.index, match[0].length, match[0], offsets);
          if (m) allMatches.push(m);
          if (allMatches.length >= MAX_MATCHES_LIMIT) break;
        }
      } else {
        const hay = options.caseSensitive ? stringLine : stringLine.toLowerCase();
        let idx = 0;
        while ((idx = hay.indexOf(needle, idx)) !== -1) {
          if (options.wholeWord && !isWholeWord(idx, hay, term.length)) {
            idx += term.length;
            continue;
          }
          const actualTerm = stringLine.slice(idx, idx + term.length);
          const m = this._createMatch(buffer, cols, row, idx, term.length, actualTerm, offsets);
          if (m) allMatches.push(m);
          if (allMatches.length >= MAX_MATCHES_LIMIT) break;
          idx += term.length;
        }
      }
    }

    if (this._disposed || searchId !== this._searchId) return;

    this._matches = allMatches;

    // 重新锁定预先选中的焦点项索引
    if (preselectedMatch) {
      const idx = allMatches.findIndex(
        (m) => m.row === preselectedMatch.row && m.col === preselectedMatch.col,
      );
      if (idx >= 0) {
        this._activeIndex = idx;
      } else if (allMatches.length > 0 && this._activeIndex === -1) {
        this._activeIndex = 0;
      }
    } else if (allMatches.length > 0 && this._activeIndex === -1) {
      this._activeIndex = 0;
    }

    // 全量扫描完成后，强制刷新视口高亮
    this._renderViewportDecorations(true);
  }

  /**
   * 将字符串内偏移量转换为终端真实二维坐标 (col, row, size)
   */
  private _createMatch(
    buffer: IBuffer,
    cols: number,
    baseRow: number,
    resultIndex: number,
    matchLen: number,
    matchTerm: string,
    offsets: number[],
  ): ISearchMatch | null {
    let startRowOffset = 0;
    while (startRowOffset < offsets.length - 1 && resultIndex >= offsets[startRowOffset + 1]) {
      startRowOffset++;
    }
    let endRowOffset = startRowOffset;
    while (
      endRowOffset < offsets.length - 1 &&
      resultIndex + matchLen >= offsets[endRowOffset + 1]
    ) {
      endRowOffset++;
    }

    const startColOffset = resultIndex - offsets[startRowOffset];
    const endColOffset = resultIndex + matchLen - offsets[endRowOffset];
    const startLine = buffer.getLine(baseRow + startRowOffset);
    const endLine = buffer.getLine(baseRow + endRowOffset);
    if (!startLine || !endLine) return null;

    const startColIndex = stringLengthToBufferSize(startLine, startColOffset);
    const endColIndex = stringLengthToBufferSize(endLine, endColOffset);
    const size = endColIndex - startColIndex + cols * (endRowOffset - startRowOffset);

    return {
      term: matchTerm,
      col: startColIndex,
      row: baseRow + startRowOffset,
      size,
    };
  }

  /**
   * 创建一组终端装饰对象（通用底层管线，支持多行折行截断）
   */
  private _createMatchDecorationItems(
    match: ISearchMatch,
    backgroundColor: string,
    outline: string,
    rulerColor: string,
    rulerPosition: "right" | "full" | "left" | "center" = "right",
  ): IDecoration[] {
    const decorations: IDecoration[] = [];
    try {
      const buffer = this._terminal.buffer.active;
      let currentCol = match.col;
      let remainingSize = match.size;
      let curRow = match.row;

      while (remainingSize > 0) {
        const amountThisRow = Math.min(this._terminal.cols - currentCol, remainingSize);
        const baseY = buffer.baseY ?? 0;
        const cursorY = buffer.cursorY ?? 0;
        const rowOffset = curRow - baseY - cursorY;
        const marker = this._terminal.registerMarker(rowOffset);
        if (marker) {
          const dec = this._terminal.registerDecoration({
            marker,
            x: currentCol,
            width: amountThisRow,
            backgroundColor,
            overviewRulerOptions: {
              color: rulerColor,
              position: rulerPosition,
            },
          });
          if (dec) {
            dec.onRender?.((element) => {
              element.style.outline = outline;
            });
            decorations.push(dec);
          }
        }
        currentCol = 0;
        remainingSize -= amountThisRow;
        curRow++;
      }
    } catch {
      // 容错保护
    }
    return decorations;
  }

  /**
   * 视口虚拟化高亮渲染器（对齐 VS Code 架构，性能优化版）
   * 
   * 优化要点：
   * 1. 二分查找（Binary Search）：_matches 按 row 有序，O(log N) 定位视口起始位置，替代 O(N) 全量遍历
   * 2. 视口缓存（Viewport Cache）：若视口行范围和 activeIndex 均未变化，直接跳过整个渲染流程
   * 3. 增量 diff：仅 dispose 移出视口的旧装饰 + 创建新进入视口的装饰，不重建已存在的
   * 
   * @param force 强制渲染（跳过缓存检查），用于 activeIndex 变化或首次渲染
   */
  private _renderViewportDecorations(force = false) {
    if (!this._currentTerm || this._matches.length === 0) return;
    const buffer = this._terminal.buffer.active;
    const viewportY = buffer.viewportY;
    const rows = this._terminal.rows;
    // 渲染范围：当前屏幕视口加上下微缓冲
    const minRow = Math.max(0, viewportY - 2);
    const maxRow = viewportY + rows + 2;

    const currentActiveMatch = this._activeIndex >= 0 ? this._matches[this._activeIndex] : null;
    const activeKey = currentActiveMatch ? `${currentActiveMatch.row}:${currentActiveMatch.col}` : "";

    // ── 视口缓存快速跳过 ──
    if (
      !force &&
      minRow === this._lastRenderedMinRow &&
      maxRow === this._lastRenderedMaxRow &&
      activeKey === this._lastRenderedActiveKey
    ) {
      return; // 视口和焦点均未变化，无需重新渲染
    }
    this._lastRenderedMinRow = minRow;
    this._lastRenderedMaxRow = maxRow;
    this._lastRenderedActiveKey = activeKey;

    // ── 二分查找视口起始位置 ──
    // _matches 是按行号升序排列的（扫描顺序保证），用二分查找定位第一个 row >= minRow 的位置
    let lo = 0, hi = this._matches.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._matches[mid].row < minRow) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    const visibleKeys = new Set<string>();

    // 1. 仅遍历视口范围内的 matches（从二分起始位到超出 maxRow 为止）
    for (let i = lo; i < this._matches.length; i++) {
      const match = this._matches[i];
      if (match.row > maxRow) break; // 已超出视口下界，提前终止

      const key = `${match.row}:${match.col}`;
      // 若当前项正是焦点激活项，跳过（由 _activeDecorations 负责独立渲染实心深橙色）
      if (key === activeKey) continue;

      visibleKeys.add(key);

      if (!this._viewportDecorations.has(key)) {
        const decs = this._createMatchDecorationItems(
          match,
          "rgba(255, 215, 0, 0.35)",
          "1px solid rgba(255, 215, 0, 0.45)",
          "#FFD700",
          "right",
        );
        if (decs.length > 0) {
          this._viewportDecorations.set(key, decs);
        }
      }
    }

    // 2. 及时释放离开当前视口范围的普通项装饰（保持 DOM 数量恒定极少）
    // 同时移除 activeKey 对应的旧普通装饰（因为该位置已由 _activeDecorations 接管）
    for (const [key, decs] of this._viewportDecorations.entries()) {
      if (!visibleKeys.has(key)) {
        for (const dec of decs) {
          try {
            dec.dispose();
          } catch {
            // ignore
          }
        }
        this._viewportDecorations.delete(key);
      }
    }
  }

  /**
   * 跳转到下一个匹配项
   */
  public findNext(): boolean {
    if (this._bufferDirty) {
      this._bufferDirty = false;
      if (this._resizeDebounceTimer) {
        clearTimeout(this._resizeDebounceTimer);
        this._resizeDebounceTimer = null;
      }
      if (this._writeParsedDebounceTimer) {
        clearTimeout(this._writeParsedDebounceTimer);
        this._writeParsedDebounceTimer = null;
      }
      this.search(this._currentTerm, this._currentOptions, "next", false, true);
      return true;
    }
    if (this._matches.length === 0) return false;
    this._activeIndex = (this._activeIndex + 1) % this._matches.length;
    const match = this._matches[this._activeIndex];
    this._selectAndScrollTo(match);
    this._notifyState(false);
    return true;
  }

  /**
   * 跳转到上一个匹配项
   */
  public findPrevious(): boolean {
    if (this._bufferDirty) {
      this._bufferDirty = false;
      if (this._resizeDebounceTimer) {
        clearTimeout(this._resizeDebounceTimer);
        this._resizeDebounceTimer = null;
      }
      if (this._writeParsedDebounceTimer) {
        clearTimeout(this._writeParsedDebounceTimer);
        this._writeParsedDebounceTimer = null;
      }
      this.search(this._currentTerm, this._currentOptions, "prev", false, true);
      return true;
    }
    if (this._matches.length === 0) return false;
    this._activeIndex = (this._activeIndex - 1 + this._matches.length) % this._matches.length;
    const match = this._matches[this._activeIndex];
    this._selectAndScrollTo(match);
    this._notifyState(false);
    return true;
  }

  /**
   * 聚焦当前匹配项并平滑滚动视口，渲染高亮焦点框（经典橙色底 #FF8C00 + 醒目轮廓框）
   * 注：此处不调用 terminal.select，避免在失焦/翻动时被系统 Selection 遮盖冲刷为黑底
   */
  private _selectAndScrollTo(match: ISearchMatch, noScroll = false) {
    const buffer = this._terminal.buffer.active;

    // 清理上一个焦点项的装饰
    this._clearActiveDecorations();

    // 为当前焦点项创建高对比度原版经典深橙色（#FF8C00）焦点装饰
    this._activeDecorations = this._createMatchDecorationItems(
      match,
      "#FF8C00",
      "1.5px solid #FF8C00",
      "#FF8C00",
      "full",
    );

    const viewportY = buffer.viewportY;
    const rows = this._terminal.rows;
    // 若目标行不在当前屏幕视口内且未开启 noScroll，平滑居中滚动至目标行
    // 抑制 onScroll 触发的重复渲染，由下方显式调用统一处理
    if (!noScroll && (match.row < viewportY || match.row >= viewportY + rows)) {
      this._suppressScrollRender = true;
      const scrollDelta = match.row - viewportY - Math.floor(rows / 2);
      this._terminal.scrollLines(scrollDelta);
      this._suppressScrollRender = false;
    }

    // 焦点切换/视口平滑移动后，强制刷新视口内所有普通项的高亮状态
    this._renderViewportDecorations(true);
  }

  private _clearActiveDecorations() {
    for (const dec of this._activeDecorations) {
      try {
        dec.dispose();
      } catch {
        // ignore
      }
    }
    this._activeDecorations = [];
  }

  private _clearViewportDecorations() {
    for (const decs of this._viewportDecorations.values()) {
      for (const dec of decs) {
        try {
          dec.dispose();
        } catch {
          // ignore
        }
      }
    }
    this._viewportDecorations.clear();
  }

  private _clearDecorations() {
    this._clearActiveDecorations();
    this._clearViewportDecorations();
    // 清除视口渲染缓存，确保下次 _renderViewportDecorations 不会被跳过
    this._lastRenderedMinRow = -1;
    this._lastRenderedMaxRow = -1;
    this._lastRenderedActiveKey = "";
  }

  /**
   * 清除当前搜索与高亮，打断任何后台搜索协程
   */
  public clear() {
    this._searchId++;
    this._currentTerm = "";
    this._matches = [];
    this._activeIndex = -1;
    this._bufferDirty = false;
    if (this._resizeDebounceTimer) {
      clearTimeout(this._resizeDebounceTimer);
      this._resizeDebounceTimer = null;
    }
    if (this._writeParsedDebounceTimer) {
      clearTimeout(this._writeParsedDebounceTimer);
      this._writeParsedDebounceTimer = null;
    }
    this._clearDecorations();
    try {
      this._terminal.clearSelection();
    } catch {
      // ignore
    }
    this._notifyState(false);
  }

  public dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._searchId++;
    if (this._scrollRafId !== null) {
      cancelAnimationFrame(this._scrollRafId);
      this._scrollRafId = null;
      this._scrollRafPending = false;
    }
    if (this._resizeDebounceTimer) {
      clearTimeout(this._resizeDebounceTimer);
      this._resizeDebounceTimer = null;
    }
    if (this._writeParsedDebounceTimer) {
      clearTimeout(this._writeParsedDebounceTimer);
      this._writeParsedDebounceTimer = null;
    }
    if (this._scrollDisposable) {
      try {
        this._scrollDisposable.dispose();
      } catch {
        // ignore
      }
      this._scrollDisposable = null;
    }
    if (this._resizeDisposable) {
      try {
        this._resizeDisposable.dispose();
      } catch {
        // ignore
      }
      this._resizeDisposable = null;
    }
    if (this._writeParsedDisposable) {
      try {
        this._writeParsedDisposable.dispose();
      } catch {
        // ignore
      }
      this._writeParsedDisposable = null;
    }
    this.clear();
    this._onStateChange = undefined;
  }

  private _notifyState(isSearching: boolean) {
    if (this._disposed || !this._onStateChange) return;
    // 全量扫描进行中 _matches 为部分结果，_activeIndex 可能暂时大于 resultCount，
    // 夹紧避免出现「4801/300」这类荒谬计数
    const count = this._matches.length;
    const idx = count > 0 ? Math.max(0, Math.min(this._activeIndex, count - 1)) : 0;
    this._onStateChange({
      resultIndex: idx,
      resultCount: count,
      isSearching,
      isCapped: count >= MAX_MATCHES_LIMIT,
    });
  }
}
