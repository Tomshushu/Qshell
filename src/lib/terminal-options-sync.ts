import type { Terminal, ITheme } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

/**
 * 终端选项与主题同步器（Wave 0 U4 底座）。
 *
 * 将原本散落在 `terminal.tsx` 多处 `useEffect` 中的 `term.options` 更新、
 * DomRenderer 前景色兜底、字符尺寸强制重测与纹理清理收敛至此，
 * 为后续 `TERM` 类型、双字体、连字与固定尺寸等扩展提供唯一变更点。
 */

export function resolveBellStyle(bellSoundEnabled?: boolean): "sound" | "visual" {
  return (bellSoundEnabled ?? false) ? "sound" : "visual";
}

/**
 * 背景媒体模式下 `theme.background` 为半透明 `rgba(0,0,0,0)`，
 * xterm 对比度算法会忽略 alpha 误算为纯黑导致前景色发灰，故需降为 1 禁用改写。
 */
export function resolveMinimumContrastRatio(hasBgMedia: boolean): number {
  return hasBgMedia ? 1 : 4.5;
}

/**
 * DomRenderer 回退兜底：不给默认前景色单元格写 inline color，显式将主题前景色
 * 钉到宿主容器与 `.xterm-rows`，防止被全局浅色主题 CSS 继承污染。
 */
export function applyDomRendererForeground(
  host: HTMLElement | null | undefined,
  foreground?: string,
): void {
  if (!host || !foreground) return;
  host.style.color = foreground;
  const rowsEl = host.querySelector(".xterm-rows") as HTMLElement | null;
  if (rowsEl) {
    rowsEl.style.color = foreground;
  }
}

export function clearTerminalTextureAtlasSafely(term: Terminal): void {
  try {
    term.clearTextureAtlas();
  } catch {
    // 终端尚未挂载渲染器或正在销毁时忽略
  }
}

/**
 * 字体族变化后强制 xterm.js 6.x 重新测量字符宽高并清空渲染缓存。
 * 注：xterm 6.x `_charSizeService` 仅有 `measure()` 无 `clear()`。
 */
export function forceXtermCharRemeasure(term: Terminal): void {
  try {
    interface XtermInternalCore {
      _charSizeService?: { measure?: () => void };
      _renderService?: { clear?: () => void };
    }
    const core = (term as unknown as { _core?: XtermInternalCore })._core;
    if (typeof core?._charSizeService?.measure === "function") {
      core._charSizeService.measure();
    }
    if (typeof core?._renderService?.clear === "function") {
      core._renderService.clear();
    }
  } catch {
    // ignore
  }
  clearTerminalTextureAtlasSafely(term);
}

export function syncTerminalBellStyle(term: Terminal, bellSoundEnabled?: boolean): void {
  // xterm 6 的 ITerminalOptions 类型已移除 bellStyle，经 unknown 安全透传
  (term.options as unknown as { bellStyle?: string }).bellStyle =
    resolveBellStyle(bellSoundEnabled);
}

export function syncTerminalThemeOptions(
  term: Terminal,
  xtermTheme: ITheme,
  hasBgMedia: boolean,
  hostOverride?: HTMLElement | null,
): void {
  term.options.minimumContrastRatio = resolveMinimumContrastRatio(hasBgMedia);
  term.options.theme = xtermTheme;
  const host = hostOverride ?? ((term.element as HTMLElement | null) ?? null);
  applyDomRendererForeground(host, xtermTheme.foreground);
  clearTerminalTextureAtlasSafely(term);
}

export function applyTerminalFontSizeOption(
  term: Terminal,
  fitAddon: FitAddon,
  fontSize: number,
  fitFn: (fitAddon: FitAddon, term: Terminal) => void,
  onResized?: (cols: number, rows: number) => void,
): boolean {
  if (term.options.fontSize === fontSize) return false;
  term.options.fontSize = fontSize;
  fitFn(fitAddon, term);
  onResized?.(term.cols, term.rows);
  return true;
}

export function applyTerminalFontFamilyOption(
  term: Terminal,
  fitAddon: FitAddon,
  fontFamily: string,
  fitFn: (fitAddon: FitAddon, term: Terminal) => void,
  onResized?: (cols: number, rows: number) => void,
): boolean {
  if (term.options.fontFamily === fontFamily) return false;
  term.options.fontFamily = fontFamily;
  forceXtermCharRemeasure(term);
  fitFn(fitAddon, term);
  onResized?.(term.cols, term.rows);
  return true;
}

/**
 * 双重字体：把 ASCII 主字体与 CJK 字体拼成一条 CSS 字体链。
 * CJK 字体必须插在通用 `monospace` 之前，否则通用回退会抢先接管中文字形，
 * 导致独立 CJK 字体失效。主字体为空时回退到 monospace。
 */
export function composeTerminalFontFamily(
  asciiFont: string,
  cjkFont?: string,
): string {
  const primary = (asciiFont ?? "monospace").trim() || "monospace";
  const cjk = cjkFont?.trim();
  if (!cjk) return primary;
  // 仅剥离「, monospace」后缀；若主字体本身就是裸 monospace（未指定具体字体），
  // 视为空，避免产出「monospace, CJK, monospace」这类冗余链。
  const base =
    primary === "monospace"
      ? ""
      : primary.replace(/,\s*monospace\s*$/i, "").trim();
  return base ? `${base}, ${cjk}, monospace` : `${cjk}, monospace`;
}

/**
 * 应用双击选词分隔符（xterm `wordSeparator`）。仅影响双击选词边界，无需重测字号。
 */
export function applyTerminalWordSeparatorOption(
  term: Terminal,
  wordSeparator: string,
): boolean {
  if (term.options.wordSeparator === wordSeparator) return false;
  term.options.wordSeparator = wordSeparator;
  return true;
}
