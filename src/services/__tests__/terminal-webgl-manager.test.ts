import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TerminalWebglManager } from "../terminal-webgl-manager";
import type { Terminal } from "@xterm/xterm";

let lossCallback: (() => void) | null = null;
const mockDispose = vi.fn();
const mockClearTextureAtlas = vi.fn();

vi.mock("@xterm/addon-webgl", () => {
  return {
    WebglAddon: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.onContextLoss = vi.fn().mockImplementation((cb: () => void) => {
        lossCallback = cb;
      });
      this.dispose = mockDispose;
      this.clearTextureAtlas = mockClearTextureAtlas;
    }),
  };
});

function createMockTerminal(): Terminal {
  return {
    rows: 24,
    cols: 80,
    loadAddon: vi.fn(),
    refresh: vi.fn(),
  } as unknown as Terminal;
}

describe("TerminalWebglManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    lossCallback = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allocates WebGL addon for visible terminal under context quota", () => {
    const manager = new TerminalWebglManager({ maxActiveContexts: 4 });
    const term = createMockTerminal();

    const ok = manager.registerTerminal({
      termId: "t1",
      term,
      isVisible: true,
    });

    expect(ok).toBe(true);
    expect(manager.getActiveCount()).toBe(1);
    expect(manager.isWebglActive("t1")).toBe(true);
    expect(term.loadAddon).toHaveBeenCalledTimes(1);
    expect(term.refresh).toHaveBeenCalled();
  });

  it("does not allocate WebGL for terminal with bgMedia, but allows fractional DPR", () => {
    const manager = new TerminalWebglManager({ maxActiveContexts: 4 });
    const term1 = createMockTerminal();
    const term2 = createMockTerminal();

    const ok1 = manager.registerTerminal({
      termId: "t1",
      term: term1,
      isVisible: true,
      hasBgMedia: true,
    });
    expect(ok1).toBe(false);
    expect(manager.isWebglActive("t1")).toBe(false);

    const ok2 = manager.registerTerminal({
      termId: "t2",
      term: term2,
      isVisible: true,
      hasFractionalDpr: true,
    });
    expect(ok2).toBe(true);
    expect(manager.isWebglActive("t2")).toBe(true);
    expect(manager.getActiveCount()).toBe(1);
  });

  it("evicts oldest hidden terminal when maxActiveContexts is reached", () => {
    const manager = new TerminalWebglManager({ maxActiveContexts: 2 });
    const term1 = createMockTerminal();
    const term2 = createMockTerminal();
    const term3 = createMockTerminal();

    // t1, t2 both visible
    manager.registerTerminal({ termId: "t1", term: term1, isVisible: true });
    manager.registerTerminal({ termId: "t2", term: term2, isVisible: true });
    expect(manager.getActiveCount()).toBe(2);

    // t1 becomes hidden (user switched to another tab)
    manager.updateState("t1", { isVisible: false });

    // Now t3 arrives and wants WebGL
    manager.registerTerminal({ termId: "t3", term: term3, isVisible: true });

    // t1 was hidden, so t1 should have been evicted to make room for t3
    expect(manager.isWebglActive("t1")).toBe(false);
    expect(mockDispose).toHaveBeenCalledTimes(1);
    expect(manager.isWebglActive("t2")).toBe(true);
    expect(manager.isWebglActive("t3")).toBe(true);
    expect(manager.getActiveCount()).toBe(2);
  });

  it("trips circuit breaker on repeated context loss to prevent infinite thrashing loop", () => {
    const manager = new TerminalWebglManager({
      maxActiveContexts: 4,
      contextLossThreshold: 2,
      contextLossWindowMs: 10_000,
      contextLossRetryDelayMs: 500,
    });
    const term = createMockTerminal();

    manager.registerTerminal({ termId: "t1", term, isVisible: true });
    expect(manager.isWebglActive("t1")).toBe(true);

    // First context loss occurs
    expect(lossCallback).not.toBeNull();
    lossCallback!();

    expect(manager.isWebglActive("t1")).toBe(false);
    expect(manager.isCircuitBroken("t1")).toBe(false);

    // Advance timer to allow retry
    vi.advanceTimersByTime(500);
    expect(manager.isWebglActive("t1")).toBe(true);

    // Second context loss occurs within window
    lossCallback!();
    expect(manager.isCircuitBroken("t1")).toBe(true);
    expect(manager.isWebglActive("t1")).toBe(false);

    // Advance timer: should NOT retry anymore because circuit is broken
    vi.advanceTimersByTime(1000);
    expect(manager.isWebglActive("t1")).toBe(false);
    expect(term.loadAddon).toHaveBeenCalledTimes(2); // Only initial + 1 retry, no further attempts
  });

  it("unregisters terminal and cleans up resources properly", () => {
    const manager = new TerminalWebglManager({ maxActiveContexts: 4 });
    const term = createMockTerminal();

    manager.registerTerminal({ termId: "t1", term, isVisible: true });
    expect(manager.getActiveCount()).toBe(1);

    manager.unregisterTerminal("t1");
    expect(manager.getActiveCount()).toBe(0);
    expect(manager.isWebglActive("t1")).toBe(false);
    expect(mockDispose).toHaveBeenCalled();
  });

  it("suspends WebGL when hidden for 3 seconds, and re-attaches upon becoming visible", () => {
    const manager = new TerminalWebglManager({ maxActiveContexts: 4 });
    const term = createMockTerminal();

    manager.registerTerminal({ termId: "t1", term, isVisible: true });
    expect(manager.isWebglActive("t1")).toBe(true);

    // Hide terminal
    manager.updateState("t1", { isVisible: false });
    // Still active immediately (grace period of 3s)
    expect(manager.isWebglActive("t1")).toBe(true);

    // Advance 3s
    vi.advanceTimersByTime(3000);
    // Now detached to save GPU / avoid memory thrashing in background
    expect(manager.isWebglActive("t1")).toBe(false);
    expect(mockDispose).toHaveBeenCalledTimes(1);

    // Re-surface to visible
    manager.updateState("t1", { isVisible: true });
    expect(manager.isWebglActive("t1")).toBe(true);
    expect(term.loadAddon).toHaveBeenCalledTimes(2);
  });

  it("cancels suspend timer if terminal becomes visible again within grace period", () => {
    const manager = new TerminalWebglManager({ maxActiveContexts: 4 });
    const term = createMockTerminal();

    manager.registerTerminal({ termId: "t1", term, isVisible: true });
    expect(manager.isWebglActive("t1")).toBe(true);

    // Briefly switch tab (hidden for 1s)
    manager.updateState("t1", { isVisible: false });
    vi.advanceTimersByTime(1000);
    expect(manager.isWebglActive("t1")).toBe(true);

    // Switch back before 3s
    manager.updateState("t1", { isVisible: true });
    vi.advanceTimersByTime(3000);

    // WebGL should NEVER have been disposed
    expect(manager.isWebglActive("t1")).toBe(true);
    expect(mockDispose).not.toHaveBeenCalled();
  });
});
