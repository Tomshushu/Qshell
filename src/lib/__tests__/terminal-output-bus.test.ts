import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  OUTPUT_BUS_FLOOD_THRESHOLD_CHARS,
  clearOutputBusSession,
  dispatchTerminalOutputObservers,
  registerOutputObserver,
  terminalOutputBus,
} from "@/lib/terminal-output-bus";

describe("terminalOutputBus", () => {
  beforeEach(() => {
    terminalOutputBus.resetAll();
  });

  it("dispatches chunks in ascending priority order and supports unsubscribe", () => {
    const calls: string[] = [];

    const unsubB = registerOutputObserver({
      id: "obs-b",
      priority: 20,
      onChunk: () => calls.push("B"),
    });
    registerOutputObserver({
      id: "obs-a",
      priority: 10,
      onChunk: () => calls.push("A"),
    });

    dispatchTerminalOutputObservers("term-1", "raw", "rendered", "sess-1", 1000);
    expect(calls).toEqual(["A", "B"]);

    unsubB();
    calls.length = 0;
    dispatchTerminalOutputObservers("term-1", "raw2", "rendered2", "sess-1", 1010);
    expect(calls).toEqual(["A"]);
  });

  it("isolates throwing observers so subsequent observers keep running", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const received: string[] = [];

    registerOutputObserver({
      id: "broken",
      priority: 1,
      onChunk: () => {
        throw new Error("boom");
      },
    });
    registerOutputObserver({
      id: "healthy",
      priority: 2,
      onChunk: (e) => received.push(e.rawChunk),
    });

    dispatchTerminalOutputObservers("term-1", "hello", "hello", "sess-1", 1000);
    expect(received).toEqual(["hello"]);
    expect(errSpy).toHaveBeenCalledTimes(1);

    errSpy.mockRestore();
  });

  it("throttles regular observers under flood load while preserving bypassThrottle observers", () => {
    let normalCount = 0;
    let criticalCount = 0;

    registerOutputObserver({
      id: "normal-trigger",
      throttleMs: 100,
      onChunk: () => {
        normalCount += 1;
      },
    });
    registerOutputObserver({
      id: "critical-prompt",
      bypassThrottle: true,
      onChunk: () => {
        criticalCount += 1;
      },
    });

    const floodChunk = "x".repeat(OUTPUT_BUS_FLOOD_THRESHOLD_CHARS + 10);
    // 第 1 块触发洪峰窗口内首次执行
    dispatchTerminalOutputObservers("term-flood", floodChunk, floodChunk, "s1", 1000);
    // 50ms 后仍在 100ms 冷却期内，普通观察者跳过；关键观察者仍放行
    dispatchTerminalOutputObservers("term-flood", "more", "more", "s1", 1050);
    // 超过 100ms 后恢复一次
    dispatchTerminalOutputObservers("term-flood", "after", "after", "s1", 1120);

    expect(normalCount).toBe(2);
    expect(criticalCount).toBe(3);

    clearOutputBusSession("term-flood");
  });
});
