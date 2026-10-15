import React, { useRef, useLayoutEffect } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import {
  Sparkles,
  ArrowLeftRight,
  Folder,
  FileText,
  History,
  Terminal as TerminalIcon,
  ChevronRight,
  SlidersHorizontal,
} from "lucide-react";
import type { HintItem } from "@/lib/command-intelligence/completion-engine";
import { FONT_PRESETS } from "@/lib/font-presets";
import type { XtermCoreLike } from "./terminal-types";

export { FONT_PRESETS };

// 搜索高亮装饰配置（常量，避免每次渲染重新创建）
export const SEARCH_DECORATIONS = {
  matchBackground: "#FFD700",
  matchBorder: "#FFD700",
  matchOverviewRuler: "#FFD700",
  activeMatchBackground: "#FF8C00",
  activeMatchBorder: "#FF8C00",
  activeMatchColorOverviewRuler: "#FF8C00",
};

// ESC/BEL 控制字符：运行时构造，避免在正则字面量中出现控制字符（no-control-regex）
export const ESC = String.fromCharCode(0x1b);
export const BEL = String.fromCharCode(0x07);
export const CS19B = String.fromCharCode(0x9b);

export const getXtermCore = (term: Terminal): XtermCoreLike | undefined =>
  (term as unknown as { _core?: XtermCoreLike })._core;

/**
 * 丢弃 xterm.js 尚未解析的输出。
 *
 * xterm.js 的公开 API 没有取消 WriteBuffer 的方法。高频日志场景下，
 * Ctrl+C 已经发到远端以后，旧日志仍可能在 WriteBuffer 中排队数秒，
 * 让用户误以为中断没有生效。这里只清理尚未进入 InputHandler 的块，
 * 不重置终端 buffer、滚动历史或主题状态；已经解析并显示的内容保留。
 */
export const discardPendingXtermWrites = (term: Terminal): number => {
  const writeBuffer = (getXtermCore(term) as any)?._writeBuffer as
    | {
        _writeBuffer?: Array<string | Uint8Array>;
        _callbacks?: Array<(() => void) | undefined>;
        _pendingData?: number;
        _bufferOffset?: number;
        _didUserInput?: boolean;
      }
    | undefined;
  if (!writeBuffer || !Array.isArray(writeBuffer._writeBuffer)) return 0;

  const dropped = writeBuffer._writeBuffer.length;
  writeBuffer._writeBuffer.length = 0;
  if (Array.isArray(writeBuffer._callbacks)) writeBuffer._callbacks.length = 0;
  writeBuffer._pendingData = 0;
  writeBuffer._bufferOffset = 0;
  // 不伪造 _didUserInput：那会让 Ctrl+C 后到达的第一块日志同步解析，
  // 反而可能把大块输出再次压在 UI 线程上。
  writeBuffer._didUserInput = false;
  return dropped;
};

export const stripUnsafeEscapes = (s: string): string => {
  // 移除完整或未终止的 OSC 序列（含可选的 BEL/ST 终止符）
  let out = s.replace(new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)?`, "g"), "");
  // 剔除末尾不完整的转义
  out = out.replace(new RegExp(`${ESC}(?:\\[[0-9;]*)?$`, "g"), "");
  return out;
};

// 录制文件保存可读文本，不把终端渲染用的 ANSI 控制序列写入日志。
// 终端仍接收原始 data，因此彩色显示和光标行为不受影响。
export const stripAnsiForRecording = (s: string): string => {
  return (
    s
      // OSC（标题、超链接等，BEL 或 ST 结束）
      .replace(new RegExp(`${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g"), "")
      // CSI（颜色、光标、清屏等）及 8-bit CSI
      .replace(new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g"), "")
      .replace(new RegExp(`${CS19B}\\[[0-?]*[ -/]*[@-~]`, "g"), "")
      // 其他单字符 ESC 序列
      .replace(new RegExp(`${ESC}[()][0-2A-Z0-9]`, "g"), "")
      .replace(new RegExp(`${ESC}[=><78]`, "g"), "")
      // 避免 Windows/Unix 混合换行产生孤立回车
      .replace(/\r(?!\n)/g, "")
  );
};

/**
 * 智能解析类似 /etc/issue.net 的转义序列宏（如 \S, \r, \m, \s, \n）。
 *
 * Linux 控制台 (agetty) 本地登录会自动展开这些宏为发行版名、内核和架构，
 * 但 OpenSSH 通过 `Banner /etc/issue.net` 直传时原样发送，导致显示原始 "\S Kernel \r on an \m"。
 * 此函数在客户端展示时进行智能解析与友好回填。
 */
export function expandIssueBanner(
  text: string,
  serverInfo?: { osType?: string; osInfo?: string; host?: string; name?: string },
): string {
  if (
    !text ||
    (!text.includes("\\S") &&
      !text.includes("\\s") &&
      !text.includes("\\r") &&
      !text.includes("\\m"))
  ) {
    return text;
  }
  const parts = serverInfo?.osInfo
    ? serverInfo.osInfo.split("|").map((s) => s.trim())
    : [];
  const prettyName =
    parts[0] ||
    (serverInfo?.osType ? serverInfo.osType.toUpperCase() : "Linux");
  const arch = parts[1] || "x86_64";
  const kernel = parts[2] || "";
  const hostname = serverInfo?.name || serverInfo?.host || "localhost";

  return text
    .replace(/\\S/g, prettyName)
    .replace(/\\s/g, "Linux")
    .replace(/\\r/g, kernel)
    .replace(/\\m/g, arch)
    .replace(/\\n/g, hostname);
}

export const writeMotdIfMissing = (
  termInstance: Terminal,
  motd: string,
  history: string,
  serverInfo?: { osType?: string; osInfo?: string; host?: string; name?: string },
) => {
  const expandedMotd = expandIssueBanner(motd, serverInfo);
  const safeMotd = stripUnsafeEscapes(expandedMotd);
  const safeHistory = stripUnsafeEscapes(history);
  if (!safeMotd || !safeMotd.trim()) {
    termInstance.write(safeHistory);
    return;
  }

  const cleanText = (str: string) =>
    str
      .replace(new RegExp(`${ESC}\\[[0-9;]*[a-zA-Z]`, "g"), "")
      .replace(/\s+/g, "")
      .toLowerCase();

  const cleanMotd = cleanText(safeMotd);
  const cleanHistory = cleanText(safeHistory);

  // Check if a sample of the MOTD (first 50 chars) is already in history
  const checkSample = cleanMotd.substring(0, 50);
  if (checkSample && !cleanHistory.includes(checkSample)) {
    const normalizedMotd = safeMotd.replace(/\r?\n/g, "\r\n");
    termInstance.write(normalizedMotd + "\r\n");
  }
  termInstance.write(safeHistory);
};

// pendingBuffer 最大长度上限，防止历史加载期间缓冲区无限增长（C6）
export const BYTES_PER_MB = 1024 * 1024;
export const MAX_PENDING_BUFFER = BYTES_PER_MB;
export const DANGEROUS_COMMAND_RE =
  /(?:^|\s)(?:rm\s+-rf|mkfs(?:\.|\s)|dd\s+if=|shutdown|reboot|poweroff|halt|DROP\s+DATABASE|TRUNCATE\s+TABLE|DELETE\s+FROM)(?:\s|$)/i;
export const MAX_OUTPUT_BYTES_PER_FRAME_DEFAULT = 512 * 1024; // 512KB 默认单帧吞吐量（提升常规刷屏速度）
export const MAX_OUTPUT_BYTES_PER_FRAME_FLOOD = 1 * 1024 * 1024;  // 1MB 洪峰期单帧上限，兼顾吞吐与 Ctrl+C 可取消性
export const FLOOD_THRESHOLD_CHARS = 128 * 1024; // 队列累积超过 128KB 字符时进入高速冲刷模式并节流正则
export const MAX_QUEUE_BUFFER_CHARS = 64 * 1024 * 1024; // 64MB 队列硬上限：防止控制台无休止倾泻导致前端 OOM 崩溃

/**
 * 极速统计换行符，避免 str.split("\n") 瞬间分配几十万小字符串数组导致 GC 停顿与内存膨胀
 */
export function countNewlines(str: string): number {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) === 10) count++;
  }
  return count;
}

/**
 * 按码点边界切片：limit 落在代理对中间时回退一位，避免 emoji 等
 * 增补平面字符被切成孤立代理项，导致 xterm 显示替代字符。
 */
export function sliceCodePointSafe(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const prev = text.charCodeAt(limit - 1);
  const next = text.charCodeAt(limit);
  if (prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    return text.slice(0, limit - 1);
  }
  return text.slice(0, limit);
}

export function formatSerialMetric(value: number, suffix = ""): string {
  if (!Number.isFinite(value) || value <= 0) return `0${suffix}`;
  if (value < 1024) return `${value.toFixed(0)}${suffix}`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}K${suffix}`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}M${suffix}`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)}G${suffix}`;
}

// xterm 的 canvas 在某些 Chromium/DPI 组合下会把最后一列绘制到 viewport
// 滚动条下方。保留两列安全列，避免最后一个字符被裁切；PTY 尺寸同步使用
// 同样的列数，因此不会出现前端显示列数与后端不一致。
export const computeSafeTerminalDimensions = (fitAddon: {
  proposeDimensions: () => { cols: number; rows: number } | undefined;
}): { cols: number; rows: number } | null => {
  const term = (fitAddon as any)._terminal;
  const element = term?.element as HTMLElement | undefined | null;
  const parent = element?.parentElement as HTMLElement | undefined | null;

  // 守卫：容器或元素在 DOM 中处于不可见/坍缩状态（display:none / 宽或高为 0）时直接返回 null
  // 杜绝不可见终端参与列数计算或触发无意义重排，也防止 PTY 被错误 resize 到 0x0
  if (parent) {
    const parentRect = parent.getBoundingClientRect();
    if (parentRect.width <= 0 || parentRect.height <= 0) {
      return null;
    }
  } else if (element) {
    const elRect = element.getBoundingClientRect();
    if (elRect.width <= 0 || elRect.height <= 0) {
      return null;
    }
  }

  const dim = fitAddon.proposeDimensions();
  if (!dim || dim.cols < 2 || dim.rows < 1) return null;

  const cell = term?._core?._renderService?.dimensions?.css?.cell;

  if (parent && cell && cell.height > 0 && cell.width > 0) {
    const parentRect = parent.getBoundingClientRect();
    if (parentRect.width > 0 && parentRect.height > 0) {
      const parentStyle = window.getComputedStyle(parent);
      const padLeft = parseFloat(parentStyle.paddingLeft) || 0;
      const padRight = parseFloat(parentStyle.paddingRight) || 0;
      const borderLeft = parseFloat(parentStyle.borderLeftWidth) || 0;
      const borderRight = parseFloat(parentStyle.borderRightWidth) || 0;
      const scrollbarWidth =
        term.options?.scrollback === 0
          ? 0
          : term.options?.overviewRuler?.width || 14;

      const availWidth = Math.max(
        0,
        parentRect.width - padLeft - padRight - borderLeft - borderRight - scrollbarWidth,
      );

      const exactRows = Math.floor(parentRect.height / cell.height);
      const exactCols = Math.floor(availWidth / cell.width);

      if (exactRows >= 1 && exactCols >= 2) {
        // 动态微调上下余数分配（消除底部空旷感）：
        const remainder = Math.max(0, parentRect.height - exactRows * cell.height);
        const safeBottom = Math.min(3, remainder);
        const safeTop = remainder - safeBottom;

        if (parent.style) {
          parent.style.paddingTop = `${safeTop}px`;
          parent.style.paddingBottom = `${safeBottom}px`;
        }

        const safeCols = Math.min(
          dim.cols > 3 ? dim.cols - 2 : dim.cols,
          exactCols > 3 ? exactCols - 1 : exactCols,
        );
        const safeRows = Math.min(dim.rows, exactRows);
        return {
          cols: Math.max(2, safeCols),
          rows: Math.max(1, safeRows),
        };
      }
    }
  }

  const safeCols = dim.cols > 3 ? dim.cols - 2 : dim.cols;
  return { cols: safeCols, rows: dim.rows };
};

/**
 * 强力同步终端滚动视口与 dimensions（用于分屏拖拽合流、DOM reparent、窗口尺寸变更后的深度对齐）
 */
export function syncTerminalScrollAndDimensions(
  term: Terminal,
  options?: { forceBottom?: boolean },
): void {
  const core = (term as any)._core;
  if (!core) return;
  const buffer = term.buffer?.active;
  if (!buffer) return;

  // 守卫：终端元素已卸载或处于隐藏状态（0x0 像素）时跳过同步，避免对隐藏 DOM 进行无效重排和重绘
  const el = term.element;
  if (el && (el.clientHeight === 0 || el.clientWidth === 0)) {
    return;
  }

  const viewport = core._viewport;
  const renderService = core._renderService;

  // 1. 强制刷新渲染器几何尺寸（防止 reparent 或隐藏恢复后 css.cell / css.canvas 依然为 0）
  try {
    renderService?._renderer?.value?._updateDimensions?.();
  } catch {
    // ignore
  }

  const cell = renderService?.dimensions?.css?.cell;
  const canvas = renderService?.dimensions?.css?.canvas;
  const cellHeight = cell?.height || 0;
  const canvasHeight = canvas?.height || (term.rows * (cellHeight || 1));
  const totalLines = buffer.length || (buffer as any).lines?.length || 0;

  // 2. 强力同步 SmoothScrollableElement 尺寸范围
  if (viewport) {
    // 强制清除旧的 ydisp 缓存，确保后续 _sync 绝不跳过 setScrollPosition
    viewport._latestYDisp = undefined;

    if (viewport._scrollableElement && cellHeight > 0) {
      try {
        viewport._scrollableElement.setScrollDimensions({
          height: canvasHeight > 0 ? canvasHeight : term.rows * cellHeight,
          scrollHeight: cellHeight * totalLines,
        });
      } catch {
        // ignore
      }
    }

    try {
      viewport._sync?.();
    } catch {
      // ignore
    }
  }

  // 3. 视口滚动重对齐
  const shouldGoBottom =
    options?.forceBottom ?? (buffer.viewportY >= buffer.baseY);
  try {
    if (shouldGoBottom) {
      if (typeof (term as any).scrollToBottom === "function") {
        (term as any).scrollToBottom(true);
      }
      if (viewport?.scrollToLine) {
        viewport.scrollToLine(buffer.baseY, true);
      }
    } else {
      if (typeof term.scrollToLine === "function") {
        term.scrollToLine(buffer.viewportY);
      }
      if (viewport?.scrollToLine) {
        viewport.scrollToLine(buffer.viewportY, true);
      }
    }
  } catch {
    // ignore
  }

  // 4. 重绘可视区域
  try {
    term.refresh?.(0, term.rows - 1);
  } catch {
    // ignore
  }
}

export const fitTerminalSafely = (
  fitAddon: FitAddon,
  term: Terminal,
): boolean => {
  const dims = computeSafeTerminalDimensions(fitAddon);
  if (!dims) return false;
  if (term.cols !== dims.cols || term.rows !== dims.rows) {
    const wasAtBottom =
      term.buffer?.active
        ? term.buffer.active.viewportY >= term.buffer.active.baseY
        : true;
    term.resize(dims.cols, dims.rows);
    syncTerminalScrollAndDimensions(term, { forceBottom: wasAtBottom });
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        syncTerminalScrollAndDimensions(term, { forceBottom: wasAtBottom });
      });
    }
    return true;
  }
  return false;
};

// 渲染提示项语义图标（Folder 目录、History 历史、Terminal 命令、SlidersHorizontal 参数等）
export function renderHintItemIcon(hint: HintItem) {
  if (hint.isCorrection) {
    return <Sparkles className="h-3.5 w-3.5 text-rose-400 shrink-0" />;
  }
  if (hint.aliasOf) {
    return <ArrowLeftRight className="h-3.5 w-3.5 text-teal-400 shrink-0" />;
  }
  if (hint.kind === "path") {
    const isDir = hint.label.endsWith("/");
    return isDir ? (
      <Folder className="h-3.5 w-3.5 text-blue-400 shrink-0" />
    ) : (
      <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />
    );
  }
  if (hint.kind === "history") {
    return <History className="h-3.5 w-3.5 text-slate-400 shrink-0" />;
  }
  if (hint.kind === "command") {
    return <TerminalIcon className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
  }
  if (hint.kind === "subcommand") {
    return <ChevronRight className="h-3.5 w-3.5 text-violet-400 shrink-0" />;
  }
  if (hint.kind === "param" || hint.kind === "positional") {
    return <SlidersHorizontal className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
  }
  if (hint.kind === "dynamic") {
    return <Sparkles className="h-3.5 w-3.5 text-cyan-400 shrink-0" />;
  }
  return <TerminalIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" />;
}

/**
 * MED-2：将 state/prop 同步到 ref 的通用 hook，替代
 * `const ref = useRef(v); useEffect(() => { ref.current = v; }, [v]);` 的大量重复样板。
 * 在渲染期直接同步（无 useEffect 的一帧延迟），且不引入额外调度开销。
 */
export function useLatestRef<T>(value: T) {
  const ref = useRef<T>(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

/**
 * 寻找中断响应边界（SIGINT Boundary）
 *
 * 当用户在日志高频刷屏时按下 Ctrl+C 时，网络管道内仍有数十至数百 KB
 * 在途旧日志。远端在处理 SIGINT 后会由 PTY 驱动或 shell 输出中断回显
 * （如 ^C、\x03、\x1b[?2004l 或换行后的 Prompt 提示符标记）。
 *
 * 本函数在排空窗口内扫描首个中断标记的位置：
 * - 找到标记时返回其 offset，上层可将此 offset 之前的在途旧日志一网打尽直接丢弃，
 *   仅保留中断回显与新提示符，实现“秒按秒停，毫秒级返回 Prompt”；
 * - 未找到时返回 -1，上层继续静默丢弃旧日志，杜绝继续刷屏。
 */
export function findSigintBoundary(text: string): number {
  if (!text) return -1;
  const candidates: number[] = [];

  const idxEtx = text.indexOf("\x03");
  if (idxEtx !== -1) candidates.push(idxEtx);

  const idxCaretC = text.indexOf("^C");
  if (idxCaretC !== -1) candidates.push(idxCaretC);

  // Readline 关闭 Bracketed Paste 模式序列（bash/zsh 中断后重绘行常用）
  const idxBracketed = text.indexOf("\x1b[?2004l");
  if (idxBracketed !== -1) candidates.push(idxBracketed);

  // OSC title 序列（Prompt 启动时通常重置终端标题）
  const idxOsc0 = text.indexOf("\x1b]0;");
  if (idxOsc0 !== -1) candidates.push(idxOsc0);
  const idxOsc2 = text.indexOf("\x1b]2;");
  if (idxOsc2 !== -1) candidates.push(idxOsc2);

  // 注意：不要把 \x1b[2K（清除当前行）作为中断标志！
  // 现代 CLI（Docker/npm/yarn/pip/cargo/webpack 等）在每一行进度条和格式化日志中
  // 都极高频输出 \x1b[2K。加入它会导致在途旧日志第一块就误判为到达 Prompt 并提前关闭丢弃窗口。

  if (candidates.length === 0) return -1;
  return Math.min(...candidates);
}

