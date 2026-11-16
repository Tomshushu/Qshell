import { describe, it, expect, vi } from "vitest";
import type { Terminal, ITheme } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import {
  applyDomRendererForeground,
  applyTerminalFontFamilyOption,
  applyTerminalFontSizeOption,
  applyTerminalWordSeparatorOption,
  composeTerminalFontFamily,
  resolveBellStyle,
  resolveMinimumContrastRatio,
  syncTerminalBellStyle,
  syncTerminalThemeOptions,
} from "@/lib/terminal-options-sync";

function createFakeTerminal(initial: { fontSize?: number; fontFamily?: string } = {}) {
  const measureMock = vi.fn();
  const clearRenderMock = vi.fn();
  const clearTextureAtlasMock = vi.fn();

  const term = {
    cols: 120,
    rows: 36,
    element: null as HTMLElement | null,
    options: {
      fontSize: initial.fontSize ?? 13,
      fontFamily: initial.fontFamily ?? "monospace",
      minimumContrastRatio: 4.5,
      theme: {},
    },
    clearTextureAtlas: clearTextureAtlasMock,
    _core: {
      _charSizeService: { measure: measureMock },
      _renderService: { clear: clearRenderMock },
    },
  } as unknown as Terminal;

  return { term, measureMock, clearRenderMock, clearTextureAtlasMock };
}

describe("terminal-options-sync", () => {
  it("resolves bellStyle and minimumContrastRatio consistently", () => {
    expect(resolveBellStyle(true)).toBe("sound");
    expect(resolveBellStyle(false)).toBe("visual");
    expect(resolveBellStyle(undefined)).toBe("visual");

    expect(resolveMinimumContrastRatio(true)).toBe(1);
    expect(resolveMinimumContrastRatio(false)).toBe(4.5);
  });

  it("writes bellStyle onto xterm options", () => {
    const { term } = createFakeTerminal();
    syncTerminalBellStyle(term, true);
    expect((term.options as unknown as { bellStyle?: string }).bellStyle).toBe("sound");
    syncTerminalBellStyle(term, false);
    expect((term.options as unknown as { bellStyle?: string }).bellStyle).toBe("visual");
  });

  it("pins DomRenderer foreground on host and .xterm-rows during theme sync", () => {
    const { term, clearTextureAtlasMock } = createFakeTerminal();
    const host = document.createElement("div");
    const rows = document.createElement("div");
    rows.className = "xterm-rows";
    host.appendChild(rows);

    const theme: ITheme = { background: "#111111", foreground: "#e2e8f0" };
    syncTerminalThemeOptions(term, theme, true, host);

    expect(term.options.minimumContrastRatio).toBe(1);
    expect(term.options.theme).toBe(theme);
    expect(host.style.color).toBe("rgb(226, 232, 240)");
    expect(rows.style.color).toBe("rgb(226, 232, 240)");
    expect(clearTextureAtlasMock).toHaveBeenCalledTimes(1);

    applyDomRendererForeground(null, "#ffffff");
  });

  it("skips no-op font changes and triggers fit + remeasure when changed", () => {
    const { term, measureMock, clearRenderMock, clearTextureAtlasMock } =
      createFakeTerminal({ fontSize: 14, fontFamily: "JetBrains Mono" });
    const fitAddon = {} as FitAddon;
    const fitFn = vi.fn();
    const onResize = vi.fn();

    expect(applyTerminalFontSizeOption(term, fitAddon, 14, fitFn, onResize)).toBe(false);
    expect(fitFn).not.toHaveBeenCalled();

    expect(applyTerminalFontSizeOption(term, fitAddon, 16, fitFn, onResize)).toBe(true);
    expect(term.options.fontSize).toBe(16);
    expect(fitFn).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith(120, 36);

    expect(
      applyTerminalFontFamilyOption(term, fitAddon, "JetBrains Mono", fitFn, onResize),
    ).toBe(false);

    expect(
      applyTerminalFontFamilyOption(term, fitAddon, "Cascadia Code", fitFn, onResize),
    ).toBe(true);
    expect(term.options.fontFamily).toBe("Cascadia Code");
    expect(measureMock).toHaveBeenCalledTimes(1);
    expect(clearRenderMock).toHaveBeenCalledTimes(1);
    expect(clearTextureAtlasMock).toHaveBeenCalledTimes(1);
    expect(fitFn).toHaveBeenCalledTimes(2);
  });

  it("composes ASCII + CJK font chain with CJK inserted before monospace fallback", () => {
    // 无 CJK 字体时原样返回主字体
    expect(composeTerminalFontFamily('"Cascadia Code", monospace', "")).toBe(
      '"Cascadia Code", monospace',
    );
    expect(
      composeTerminalFontFamily('"Cascadia Code", monospace', undefined),
    ).toBe('"Cascadia Code", monospace');

    // CJK 字体必须插到通用 monospace 之前
    expect(
      composeTerminalFontFamily(
        '"Cascadia Code", monospace',
        '"Microsoft YaHei", "微软雅黑"',
      ),
    ).toBe('"Cascadia Code", "Microsoft YaHei", "微软雅黑", monospace');

    // 主字体为空时回退 monospace
    expect(composeTerminalFontFamily("", "SimSun")).toBe("SimSun, monospace");
    expect(composeTerminalFontFamily("   ", "SimSun")).toBe("SimSun, monospace");
  });

  it("applies word separator only on change", () => {
    const { term } = createFakeTerminal();
    const opts = term.options as unknown as { wordSeparator?: string };
    opts.wordSeparator = ' ()[]{}\'"';
    expect(applyTerminalWordSeparatorOption(term, ' ()[]{}\'"')).toBe(false);
    expect(applyTerminalWordSeparatorOption(term, " -_")).toBe(true);
    expect(opts.wordSeparator).toBe(" -_");
  });
});
