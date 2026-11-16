import { describe, it, expect, beforeEach } from "vitest";
import { useSessionTrafficStore } from "../session-traffic-store";

describe("useSessionTrafficStore", () => {
  beforeEach(() => {
    useSessionTrafficStore.getState().reset();
  });

  it("initializes traffic stats and computes byte rate on subsequent updates", () => {
    const store = useSessionTrafficStore.getState();
    store.updateTraffic("shell-1", 1024, 512, 1000);

    let stats = useSessionTrafficStore.getState().trafficBySession["shell-1"];
    expect(stats).toEqual({
      rxBytes: 1024,
      txBytes: 512,
      rxRate: 0,
      txRate: 0,
      updatedAt: 1000,
    });

    store.updateTraffic("shell-1", 3072, 1536, 2000);
    stats = useSessionTrafficStore.getState().trafficBySession["shell-1"];
    expect(stats.rxBytes).toBe(3072);
    expect(stats.txBytes).toBe(1536);
    expect(stats.rxRate).toBe(2048);
    expect(stats.txRate).toBe(1024);
  });

  it("clears traffic cleanly on session close", () => {
    const store = useSessionTrafficStore.getState();
    store.updateTraffic("telnet-1", 100, 20, 1000);
    store.updateTraffic("shell-2", 200, 40, 1000);
    store.clearSessionTraffic("telnet-1");

    const map = useSessionTrafficStore.getState().trafficBySession;
    expect(map["telnet-1"]).toBeUndefined();
    expect(map["shell-2"]?.rxBytes).toBe(200);
  });

  it("decays stale non-zero traffic rates back to 0 B/s after idle timeout", () => {
    const store = useSessionTrafficStore.getState();
    store.updateTraffic("ssh-1", 1000, 500, 1000);
    store.updateTraffic("ssh-1", 5000, 2500, 2000);
    expect(useSessionTrafficStore.getState().trafficBySession["ssh-1"]?.rxRate).toBe(4000);

    // Before maxAgeMs expires, rates remain intact
    store.decayStaleTraffic(3000, 1500);
    expect(useSessionTrafficStore.getState().trafficBySession["ssh-1"]?.rxRate).toBe(4000);

    // After maxAgeMs expires, rates decay to 0 while preserving byte totals
    store.decayStaleTraffic(4000, 1500);
    const decayed = useSessionTrafficStore.getState().trafficBySession["ssh-1"];
    expect(decayed?.rxRate).toBe(0);
    expect(decayed?.txRate).toBe(0);
    expect(decayed?.rxBytes).toBe(5000);
    expect(decayed?.txBytes).toBe(2500);
  });
});
