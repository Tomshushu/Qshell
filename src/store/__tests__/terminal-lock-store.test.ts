import { describe, it, expect, beforeEach } from "vitest";
import { useTerminalLockStore } from "../terminal-lock-store";

describe("useTerminalLockStore", () => {
  beforeEach(() => {
    useTerminalLockStore.getState().reset();
  });

  it("tracks locks per terminal and per tab independently", () => {
    const store = useTerminalLockStore.getState();
    store.lockTerminal({
      termId: "term-a",
      tabId: "tab-1",
      serverId: "srv-1",
      lockedAt: 1000,
    });

    expect(useTerminalLockStore.getState().isTermLocked("term-a")).toBe(true);
    expect(useTerminalLockStore.getState().isTermLocked("term-b")).toBe(false);
    expect(useTerminalLockStore.getState().isTabLocked("tab-1")).toBe(true);
    expect(useTerminalLockStore.getState().isTabLocked("tab-2")).toBe(false);

    store.unlockTerminal("term-a");
    expect(useTerminalLockStore.getState().isTermLocked("term-a")).toBe(false);
    expect(useTerminalLockStore.getState().isTabLocked("tab-1")).toBe(false);
  });

  it("unlockTabTerminals clears all locked panes belonging to a closed tab", () => {
    const store = useTerminalLockStore.getState();
    store.lockTerminal({
      termId: "t1",
      tabId: "tab-1",
    });
    store.lockTerminal({
      termId: "t2",
      tabId: "tab-1",
    });
    store.lockTerminal({
      termId: "t3",
      tabId: "tab-2",
    });

    store.unlockTabTerminals("tab-1");
    expect(useTerminalLockStore.getState().isTermLocked("t1")).toBe(false);
    expect(useTerminalLockStore.getState().isTermLocked("t2")).toBe(false);
    expect(useTerminalLockStore.getState().isTermLocked("t3")).toBe(true);
  });

  it("tracks workspaceId and memberTabIds so sibling panes in a split workspace share lock state", () => {
    const store = useTerminalLockStore.getState();
    store.lockTerminal({
      termId: "term-pane-1",
      tabId: "tab-pane-1",
      workspaceId: "ws-1",
      memberTabIds: ["tab-pane-1", "tab-pane-2"],
      serverId: "srv-1",
    });

    const state = useTerminalLockStore.getState();
    expect(state.isWorkspaceLocked("ws-1")).toBe(true);
    expect(state.isWorkspaceLocked("ws-2")).toBe(false);
    expect(state.getWorkspaceLockEntry("ws-1")?.termId).toBe("term-pane-1");
    expect(state.isTabLocked("tab-pane-1")).toBe(true);
    expect(state.isTabLocked("tab-pane-2")).toBe(true);
    expect(state.isTabLocked("tab-other-ws")).toBe(false);
    expect(state.isLockedTarget("term-pane-1", "tab-pane-1")).toBe(true);
    expect(state.isLockedTarget("term-pane-2", "tab-pane-2")).toBe(true);
    expect(state.isLockedTarget("term-other", "tab-other-ws")).toBe(false);
  });
});
