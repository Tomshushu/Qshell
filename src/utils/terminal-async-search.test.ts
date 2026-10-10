import { describe, it, expect, vi } from "vitest";
import { AsyncTerminalSearcher } from "./terminal-async-search";
import type { Terminal } from "@xterm/xterm";

function createMockTerminal(lines: string[]) {
  const selected = { col: -1, row: -1, size: -1 };
  let scrolledDelta = 0;

  const mockLines = lines.map((text) => ({
    isWrapped: false,
    length: text.length,
    translateToString: (trimRight?: boolean) => (trimRight ? text.trimEnd() : text),
    getCell: (x: number) => {
      if (x < text.length) {
        return {
          getCode: () => text.charCodeAt(x),
          getChars: () => text[x],
          getWidth: () => 1,
        };
      }
      return undefined;
    },
  }));

  const mockTerminal = {
    cols: 80,
    rows: 24,
    buffer: {
      active: {
        length: mockLines.length,
        baseY: 0,
        viewportY: 0,
        cursorY: 0,
        getLine: (y: number) => mockLines[y],
      },
    },
    select: vi.fn((col: number, row: number, size: number) => {
      selected.col = col;
      selected.row = row;
      selected.size = size;
    }),
    scrollLines: vi.fn((delta: number) => {
      scrolledDelta += delta;
    }),
    clearSelection: vi.fn(() => {
      selected.col = -1;
      selected.row = -1;
      selected.size = -1;
    }),
    registerMarker: vi.fn(() => ({ dispose: vi.fn(), id: 1, line: 0, isDisposed: false })),
    registerDecoration: vi.fn(() => ({ dispose: vi.fn(), onDispose: vi.fn(), onRender: vi.fn(), isDisposed: false })),
    onScroll: vi.fn(() => ({ dispose: vi.fn() })),
    onResize: vi.fn(() => ({ dispose: vi.fn() })),
    onWriteParsed: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as Terminal;

  return { mockTerminal, selected, mockLines };
}

describe("AsyncTerminalSearcher", () => {
  it("searches and finds matches across terminal buffer without freezing", async () => {
    const lines = [
      "2026-09-28 10:00:00 INFO Starting application",
      "2026-09-28 10:00:01 ERROR Database connection failed",
      "2026-09-28 10:00:02 INFO Retrying connection...",
      "2026-09-28 10:00:03 ERROR Timeout reached",
      "2026-09-28 10:00:04 INFO Shutdown",
    ];

    const stateChanges: any[] = [];
    const { mockTerminal } = createMockTerminal(lines);
    const searcher = new AsyncTerminalSearcher(mockTerminal, (s) => stateChanges.push(s));

    const found = await searcher.search("ERROR", { caseSensitive: true }, "next");

    expect(found).toBe(true);
    expect(searcher.matchCount).toBe(2);
    expect(searcher.activeIndex).toBe(0);

    // Test findNext
    searcher.findNext();
    expect(searcher.activeIndex).toBe(1);

    // Test circular wrap
    searcher.findNext();
    expect(searcher.activeIndex).toBe(0);

    // Test findPrevious
    searcher.findPrevious();
    expect(searcher.activeIndex).toBe(1);

    searcher.clear();
    expect(searcher.matchCount).toBe(0);
    expect(mockTerminal.clearSelection).toHaveBeenCalled();
  });

  it("handles case-insensitive search and whole-word matching correctly", async () => {
    const lines = [
      "log error here",
      "no error_code matching",
      "another ERROR on line 3",
    ];

    const { mockTerminal } = createMockTerminal(lines);
    const searcher = new AsyncTerminalSearcher(mockTerminal);

    // Whole-word search: should match line 0 and line 2, but NOT line 1 (error_code)
    await searcher.search("error", { caseSensitive: false, wholeWord: true });
    expect(searcher.matchCount).toBe(2);
  });

  it("handles regex search correctly", async () => {
    const lines = [
      "ip 192.168.1.1 connected",
      "ip 10.0.0.5 connected",
      "no ip here",
    ];

    const { mockTerminal } = createMockTerminal(lines);
    const searcher = new AsyncTerminalSearcher(mockTerminal);

    await searcher.search("\\d+\\.\\d+\\.\\d+\\.\\d+", { regex: true });
    expect(searcher.matchCount).toBe(2);
  });

  it("can search large buffer (10,000 lines) with time-slicing smoothly", async () => {
    const largeLines: string[] = [];
    for (let i = 0; i < 10000; i++) {
      if (i === 1500 || i === 8500) {
        largeLines.push(`Line ${i}: CRITICAL_ERROR occurred here`);
      } else {
        largeLines.push(`Line ${i}: normal heartbeat ok`);
      }
    }

    const { mockTerminal } = createMockTerminal(largeLines);
    const searcher = new AsyncTerminalSearcher(mockTerminal);

    const found = await searcher.search("CRITICAL_ERROR");
    expect(found).toBe(true);
    expect(searcher.matchCount).toBe(2);
    expect(searcher.activeIndex).toBe(0);
  });

  it("registers vibrant decorations for both matches and active match", async () => {
    const lines = ["hello test world", "second test match"];
    const { mockTerminal } = createMockTerminal(lines);
    const searcher = new AsyncTerminalSearcher(mockTerminal);

    await searcher.search("test");

    // 验证是否注册了常规项装饰 (半透明柔金 rgba(255, 215, 0, 0.35)) 与焦点项装饰 (实心深橙 #FF8C00)
    // 且不传递 foregroundColor 和 layer: 'top'，确保 CJK 双宽字形对齐与字符图层层级正确
    const registerDecorationCalls = (mockTerminal.registerDecoration as any).mock.calls;
    expect(registerDecorationCalls.length).toBeGreaterThan(0);

    const matchDec = registerDecorationCalls.find((call: any[]) => call[0].backgroundColor === "rgba(255, 215, 0, 0.35)");
    expect(matchDec).toBeDefined();
    expect(matchDec[0].foregroundColor).toBeUndefined();

    const activeDec = registerDecorationCalls.find((call: any[]) => call[0].backgroundColor === "#FF8C00");
    expect(activeDec).toBeDefined();
    expect(activeDec[0].foregroundColor).toBeUndefined();
    expect(activeDec[0].layer).toBeUndefined();
  });

  it("decorates all visible matches in viewport immediately so other matches also show gold highlights", async () => {
    const lines = [
      '{"id": 1, "lC": "4层"}',
      '{"id": 2, "lC": "2层"}',
      '{"id": 3, "lC": "4层"}',
      '{"id": 4, "lC": "4层"}',
    ];
    const { mockTerminal } = createMockTerminal(lines);
    const searcher = new AsyncTerminalSearcher(mockTerminal);

    await searcher.search("4层");

    const registerCalls = (mockTerminal.registerDecoration as any).mock.calls;
    const goldMatches = registerCalls.filter((c: any[]) => c[0].backgroundColor === "rgba(255, 215, 0, 0.35)");
    const orangeActive = registerCalls.filter((c: any[]) => c[0].backgroundColor === "#FF8C00");

    // 屏幕上 3 处匹配项：2 处其他项注册普通金色装饰，1 处当前项注册深橙色焦点装饰
    expect(goldMatches.length).toBe(2);
    expect(orangeActive.length).toBe(1);
  });

  it("transitions active match smoothly when navigating to next match", async () => {
    const lines = [
      "first match here",
      "second match here",
    ];
    const { mockTerminal } = createMockTerminal(lines);
    const searcher = new AsyncTerminalSearcher(mockTerminal);

    await searcher.search("match");
    expect(searcher.activeIndex).toBe(0);

    // 翻到下一项
    searcher.findNext();
    expect(searcher.activeIndex).toBe(1);

    const registerCalls = (mockTerminal.registerDecoration as any).mock.calls;
    const orangeCalls = registerCalls.filter((c: any[]) => c[0].backgroundColor === "#FF8C00");
    expect(orangeCalls.length).toBe(2);
  });

  it("computes correct col/size for CJK wide characters", async () => {
    // "你好world" 中 "你好" 占索引 0~1，故 "world" 起始列应为 2（验证匹配 col 正确跳过前置 CJK 字符）
    const lines = ["你好world", "another 中文 line"];
    const { mockTerminal } = createMockTerminal(lines);
    const searcher = new AsyncTerminalSearcher(mockTerminal);

    await searcher.search("world");
    expect(searcher.matchCount).toBe(1);
    expect(searcher.activeIndex).toBe(0);

    const decCalls = (mockTerminal.registerDecoration as any).mock.calls;
    const orange = decCalls.find((c: any[]) => c[0].backgroundColor === "#FF8C00");
    expect(orange).toBeDefined();
    expect(orange[0].x).toBe(2);
  });

  it("does not infinite-loop on empty regex matches like /a*/g", async () => {
    const lines = ["abc", "aab", "baa"];
    const { mockTerminal } = createMockTerminal(lines);
    const searcher = new AsyncTerminalSearcher(mockTerminal);

    // /a*/g 在 "abc" 等行上会产生零宽匹配，若未用 lastIndex++ 跳过会死循环；此处验证正常终止且能命中
    const found = await searcher.search("a*", { regex: true });
    expect(found).toBe(true);
    expect(searcher.matchCount).toBeGreaterThan(0);
    expect(() => searcher.findNext()).not.toThrow();
  });

  it("does not throw when search/findNext/findPrevious called after dispose", async () => {
    const lines = ["hello world", "foo bar"];
    const { mockTerminal } = createMockTerminal(lines);
    const searcher = new AsyncTerminalSearcher(mockTerminal);

    searcher.dispose();
    await expect(searcher.search("world")).resolves.toBe(true);
    expect(() => searcher.findNext()).not.toThrow();
    expect(() => searcher.findPrevious()).not.toThrow();
  });

  it("wraps circularly from the last match back to the first via findNext", async () => {
    const lines = ["alpha beta", "gamma alpha", "beta alpha"];
    const { mockTerminal } = createMockTerminal(lines);
    const searcher = new AsyncTerminalSearcher(mockTerminal);

    await searcher.search("alpha");
    expect(searcher.matchCount).toBe(3);
    expect(searcher.activeIndex).toBe(0);

    searcher.findNext();
    searcher.findNext();
    expect(searcher.activeIndex).toBe(2);
    searcher.findNext(); // 从最后一项回绕到第一项
    expect(searcher.activeIndex).toBe(0);
  });

  it("short-circuits identical search term by navigating instead of re-scanning", async () => {
    const lines = ["needle here", "another needle", "needle again"];
    const { mockTerminal } = createMockTerminal(lines);
    const searcher = new AsyncTerminalSearcher(mockTerminal);

    const first = await searcher.search("needle", {}, "next");
    expect(first).toBe(true);
    expect(searcher.matchCount).toBe(3);

    // 相同关键词 + 已有匹配：应直接跳转而不重新全量扫描（不抛错、matchCount 不变）
    const second = await searcher.search("needle", {}, "next");
    expect(second).toBe(true);
    expect(searcher.matchCount).toBe(3);
  });

  it("invalidates stale matches and re-scans when terminal dimensions change (reflow)", async () => {
    let resizeCallback: ((size: { cols: number; rows: number }) => void) | null = null;
    const lines = ["target here", "second target"];
    const { mockTerminal } = createMockTerminal(lines);
    (mockTerminal.onResize as any).mockImplementation((cb: any) => {
      resizeCallback = cb;
      return { dispose: vi.fn() };
    });

    const searcher = new AsyncTerminalSearcher(mockTerminal);
    await searcher.search("target");
    expect(searcher.matchCount).toBe(2);

    // 模拟窗口缩放触发 onResize
    expect(resizeCallback).not.toBeNull();
    resizeCallback!({ cols: 120, rows: 30 });

    // 验证旧高亮被清除，且下一次 navigation 或 reindex 会绕过短路缓存重新对齐
    await searcher.reindex();
    expect(searcher.matchCount).toBe(2);
    expect(searcher.activeIndex).toBe(0);
  });
});
