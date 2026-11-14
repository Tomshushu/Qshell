import { describe, it, expect, beforeEach } from "vitest";
import { useModalStackStore } from "@/store/modal-stack-store";

describe("useModalStackStore", () => {
  beforeEach(() => {
    useModalStackStore.getState().reset();
  });

  it("tracks push order and identifies only the topmost modal", () => {
    const store = useModalStackStore.getState();

    store.pushModal("settings-dialog");
    expect(useModalStackStore.getState().isTopModal("settings-dialog")).toBe(true);
    expect(useModalStackStore.getState().topModalId()).toBe("settings-dialog");

    store.pushModal("known-hosts-confirm");
    expect(useModalStackStore.getState().isTopModal("settings-dialog")).toBe(false);
    expect(useModalStackStore.getState().isTopModal("known-hosts-confirm")).toBe(true);
    expect(useModalStackStore.getState().topModalId()).toBe("known-hosts-confirm");

    store.removeModal("known-hosts-confirm");
    expect(useModalStackStore.getState().isTopModal("settings-dialog")).toBe(true);
    expect(useModalStackStore.getState().topModalId()).toBe("settings-dialog");
  });

  it("promotes re-pushed modal to the top without duplicating entries", () => {
    const store = useModalStackStore.getState();

    store.pushModal("m1");
    store.pushModal("m2");
    store.pushModal("m1");

    expect(useModalStackStore.getState().stack).toEqual(["m2", "m1"]);
    expect(useModalStackStore.getState().isTopModal("m1")).toBe(true);
  });

  it("ignores empty ids and safely handles removing absent ids", () => {
    const store = useModalStackStore.getState();

    store.pushModal("");
    store.removeModal("missing");

    expect(useModalStackStore.getState().stack).toEqual([]);
    expect(useModalStackStore.getState().topModalId()).toBeNull();
  });
});
