import type { StateCreator } from "zustand";
import type { TerminalTheme } from "@/utils/terminal-themes";
import { PRESET_TERMINAL_THEMES } from "@/utils/terminal-themes";
import { DEFAULT_HIGHLIGHT_RULES } from "../constants";
import type { AppState, TerminalSlice } from "../types";

export const createTerminalSlice: StateCreator<
  AppState,
  [],
  [],
  TerminalSlice
> = (set, get) => ({
  // Terminal Font Size
  terminalFontSize: 13, // 默认 13px
  setTerminalFontSize: (size) =>
    set((state) => {
      const val =
        typeof size === "function" ? size(state.terminalFontSize) : size;
      return { terminalFontSize: Math.max(9, Math.min(30, val)) };
    }),

  // Terminal Font Family
  terminalFontFamily: '"Cascadia Code", monospace',
  setTerminalFontFamily: (font) => set({ terminalFontFamily: font }),

  // Terminal Theme
  terminalThemeId: "termius-dark",
  setTerminalThemeId: (id) => set({ terminalThemeId: id }),
  customTerminalThemes: [],
  addCustomTerminalTheme: (theme) =>
    set((state) => ({
      customTerminalThemes: [...state.customTerminalThemes, theme],
    })),
  deleteCustomTerminalTheme: (id) =>
    set((state) => {
      // 删除后若当前激活主题引用了被删 ID，回退到同类型预设主题，避免引用悬空
      const deleted = state.customTerminalThemes.find((t) => t.id === id);
      const patch: Partial<AppState> = {
        customTerminalThemes: state.customTerminalThemes.filter(
          (t) => t.id !== id,
        ),
      };
      if (state.terminalThemeId === id) {
        patch.terminalThemeId =
          deleted?.type === "light" ? "termius-light" : "termius-dark";
      }
      return patch;
    }),
  updateCustomTerminalTheme: (id, updates) =>
    set((state) => ({
      customTerminalThemes: state.customTerminalThemes.map((t) =>
        t.id === id ? { ...t, ...updates } : t,
      ),
    })),
  terminalThemeOverrides: {},
  setTerminalThemeOverride: (themeId, override) =>
    set((state) => ({
      terminalThemeOverrides: {
        ...state.terminalThemeOverrides,
        [themeId]: {
          ...state.terminalThemeOverrides[themeId],
          ...override,
        },
      },
    })),
  clearTerminalThemeOverride: (themeId) =>
    set((state) => {
      const rest = { ...state.terminalThemeOverrides };
      delete rest[themeId];
      return { terminalThemeOverrides: rest };
    }),
  importCustomTerminalThemes: (themes) => {
    // 跳过与现有自定义/预设主题 ID 冲突的项；冲突项自动追加 -import 后缀
    const state = get();
    const existingIds = new Set<string>([
      ...state.customTerminalThemes.map((t) => t.id),
      ...PRESET_TERMINAL_THEMES.map((t) => t.id),
    ]);
    const dedup: TerminalTheme[] = [];
    for (const t of themes) {
      let id = t.id;
      let counter = 1;
      while (existingIds.has(id)) {
        id = `${t.id}-import${counter > 1 ? counter : ""}`;
        counter++;
      }
      existingIds.add(id);
      dedup.push({ ...t, id });
    }
    if (dedup.length > 0) {
      set((s) => ({
        customTerminalThemes: [...s.customTerminalThemes, ...dedup],
      }));
    }
    // 返回实际导入的主题数组（含重命名后的真实 ID），供调用方选中
    return dedup;
  },

  // Terminal Keyword Highlighting
  terminalHighlightEnabled: true,
  setTerminalHighlightEnabled: (enabled) =>
    set({ terminalHighlightEnabled: enabled }),
  terminalHighlightRules: [...DEFAULT_HIGHLIGHT_RULES],
  setTerminalHighlightRules: (rules) =>
    set({ terminalHighlightRules: rules }),
  addHighlightRule: (rule) =>
    set((state) => ({
      terminalHighlightRules: [...state.terminalHighlightRules, rule],
    })),
  deleteHighlightRule: (id) =>
    set((state) => ({
      terminalHighlightRules: state.terminalHighlightRules.filter(
        (r) => r.id !== id,
      ),
    })),
  updateHighlightRule: (id, updates) =>
    set((state) => ({
      terminalHighlightRules: state.terminalHighlightRules.map((r) =>
        r.id === id ? { ...r, ...updates } : r,
      ),
    })),

  // New Terminal Settings Defaults & Setters
  terminalAutoReconnect: false,
  setTerminalAutoReconnect: (enabled) =>
    set({ terminalAutoReconnect: enabled }),
  terminalAntiIdleEnabled: false,
  setTerminalAntiIdleEnabled: (enabled) =>
    set({ terminalAntiIdleEnabled: enabled }),
  terminalAntiIdleInterval: 60,
  setTerminalAntiIdleInterval: (interval) =>
    set({
      terminalAntiIdleInterval: Math.max(
        10,
        Math.min(3600, Math.floor(interval) || 60),
      ),
    }),
  terminalAntiIdleMode: "null",
  setTerminalAntiIdleMode: (mode) => set({ terminalAntiIdleMode: mode }),
  terminalAntiIdleCustomString: "",
  setTerminalAntiIdleCustomString: (str) =>
    set({ terminalAntiIdleCustomString: str }),
  terminalCopyPaste: false,
  setTerminalCopyPaste: (enabled) => set({ terminalCopyPaste: enabled }),
  terminalBellSound: false,
  setTerminalBellSound: (enabled) => set({ terminalBellSound: enabled }),
  terminalDrawBoldInBrightColors: true,
  setTerminalDrawBoldInBrightColors: (enabled) =>
    set({ terminalDrawBoldInBrightColors: enabled }),
  // 指令提示默认开启：作为终端核心生产力功能
  terminalHintEnabled: true,
  setTerminalHintEnabled: (enabled) =>
    set({ terminalHintEnabled: enabled }),
  // 日志内存限制：默认 5000 行轻量低内存，范围 1000~128000 行。
  terminalScrollbackLines: 5000,
  setTerminalScrollbackLines: (lines) =>
    set({
      terminalScrollbackLines: Math.max(
        1000,
        Math.min(128000, Math.floor(lines) || 5000),
      ),
    }),
  terminalRecordingDirectory: "",
  setTerminalRecordingDirectory: (path) =>
    set({ terminalRecordingDirectory: path.trim() }),
  terminalEncoding: "default",
  setTerminalEncoding: (encoding) =>
    set({ terminalEncoding: encoding || "default" }),
  terminalRecordingMaxSizeMb: 200,
  setTerminalRecordingMaxSizeMb: (size) =>
    set({
      terminalRecordingMaxSizeMb: Math.max(
        50,
        Math.min(2048, Math.floor(size) || 200),
      ),
    }),
});
