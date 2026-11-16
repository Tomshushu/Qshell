import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ZmodemModule from "zmodem.js";
import "zmodem.js/dist/zmodem.devel.js";
import type {
  ZmodemSentryLike,
  ZmodemSessionLike,
} from "@/components/terminal/terminal-types";
import {
  canSendZmodemBytes,
  closeZmodemSendSession,
  disposeAllZmodemSessions,
  disposeZmodemSession,
  stopZmodemKeepalive,
  type ZmodemActiveSessionEntry,
} from "./terminal-zmodem";

function getZmodem() {
  return (globalThis as { Zmodem?: any }).Zmodem ?? (ZmodemModule as any);
}

describe("terminal-zmodem lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts Send session, stops 5s ZSINIT keepalive, and ends backend once on cancel", () => {
    const Zmodem = getZmodem();
    const zmodemSessions = new Map<string, ZmodemActiveSessionEntry>();
    const zmodemSentries = new Map<string, ZmodemSentryLike>();
    const disposingIds = new Set<string>();
    const shellZmodemEnd = vi.fn().mockResolvedValue({ success: true });
    const sentPayloads: number[][] = [];
    const sessionId = "ssh-sess-1";

    let capturedSession: ZmodemSessionLike | null = null;
    const sentry = new Zmodem.Sentry({
      to_terminal: () => {},
      sender: (octets: number[]) => {
        if (!canSendZmodemBytes(sessionId, sentry, zmodemSentries, () => true)) {
          return;
        }
        sentPayloads.push(octets);
      },
      on_detect: (detection: any) => {
        const session = detection.confirm();
        capturedSession = session;
        zmodemSessions.set(sessionId, { session, zmodem: Zmodem });
        session.on?.("session_end", () => {
          disposeZmodemSession({
            sessionId,
            zmodemSessions,
            zmodemSentries,
            disposingIds,
            abort: false,
            endBackend: true,
            shellZmodemEnd,
          });
        });
      },
      on_retract: () => {},
    });

    zmodemSentries.set(sessionId, sentry);

    // Feed real ZRINIT from remote `rz`
    const zrinitBytes = new Uint8Array(
      Zmodem.Header.build("ZRINIT", ["CANFDX", "CANOVIO", "CANFC32"]).to_hex(),
    );
    sentry.consume(zrinitBytes);
    expect(capturedSession).not.toBeNull();
    expect(capturedSession!.type).toBe("send");

    // Simulate user canceling `rz` file dialog before any file is sent
    disposeZmodemSession({
      sessionId,
      zmodemSessions,
      zmodemSentries,
      disposingIds,
      abort: true,
      endBackend: true,
      shellZmodemEnd,
    });

    // ABORT_SEQUENCE (CANs + BSs) should be sent once, and backend notified once
    expect(sentPayloads.length).toBe(1);
    expect(sentPayloads[0]).toContain(0x18);
    expect(shellZmodemEnd).toHaveBeenCalledTimes(1);
    expect(shellZmodemEnd).toHaveBeenCalledWith(sessionId);
    expect(zmodemSessions.size).toBe(0);
    expect(zmodemSentries.size).toBe(0);

    // Advance well past multiple 5-second keepalive intervals: ZERO ZSINIT bytes (`**02000000400c47`) may fire!
    sentPayloads.length = 0;
    vi.advanceTimersByTime(30_000);
    expect(sentPayloads).toEqual([]);
  });

  it("closes Send session cleanly (ZFIN -> OO) or falls back to abort without leaking timers", async () => {
    const Zmodem = getZmodem();
    const sentFrames: string[] = [];
    let activeSession: any = null;

    const sentry = new Zmodem.Sentry({
      to_terminal: () => {},
      sender: (octets: number[]) => {
        sentFrames.push(String.fromCharCode(...octets));
      },
      on_detect: (detection: any) => {
        activeSession = detection.confirm();
      },
      on_retract: () => {},
    });

    sentry.consume(
      new Uint8Array(
        Zmodem.Header.build("ZRINIT", ["CANFDX", "CANOVIO", "CANFC32"]).to_hex(),
      ),
    );
    expect(activeSession).not.toBeNull();

    // Start close handshake (`ZFIN`), then simulate peer replying `ZFIN`
    const expectedZfin = new Uint8Array(Zmodem.Header.build("ZFIN").to_hex());
    const expectedZfinStr = String.fromCharCode(...expectedZfin);
    const closePromise = closeZmodemSendSession(activeSession, 3000);
    expect(sentFrames.some((frame) => frame === expectedZfinStr)).toBe(true);

    sentry.consume(expectedZfin);
    await closePromise;

    // Peer ZFIN acknowledged with OVER_AND_OUT (`OO`), no keepalive leaks afterwards
    expect(sentFrames.some((frame) => frame === "OO")).toBe(true);
    sentFrames.length = 0;
    vi.advanceTimersByTime(20_000);
    expect(sentFrames).toEqual([]);
  });

  it("falls back to abort if peer never replies ZFIN to close()", async () => {
    const abort = vi.fn();
    const session: ZmodemSessionLike & { _keepalive_timeout?: ReturnType<typeof setTimeout> } = {
      type: "send",
      close: () => new Promise(() => {}),
      abort,
    };
    session._keepalive_timeout = setTimeout(() => {
      throw new Error("keepalive timer should have been cleared");
    }, 5000);

    const promise = closeZmodemSendSession(session, 1500);
    vi.advanceTimersByTime(1500);
    await promise;

    expect(abort).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
  });

  it("does not trigger recursive shellZmodemEnd when cleaning up from backend onShellZmodemEnd event", () => {
    const zmodemSessions = new Map<string, ZmodemActiveSessionEntry>();
    const zmodemSentries = new Map<string, ZmodemSentryLike>();
    const shellZmodemEnd = vi.fn();
    const abort = vi.fn();

    zmodemSessions.set("s1", {
      session: { type: "send", abort },
      zmodem: {},
    });
    zmodemSentries.set("s1", { consume: () => {} });

    disposeZmodemSession({
      sessionId: "s1",
      zmodemSessions,
      zmodemSentries,
      abort: false,
      endBackend: false,
      shellZmodemEnd,
    });

    expect(abort).not.toHaveBeenCalled();
    expect(shellZmodemEnd).not.toHaveBeenCalled();
    expect(zmodemSessions.size).toBe(0);
    expect(zmodemSentries.size).toBe(0);
  });

  it("disposeAllZmodemSessions cleans up all sessions and stopZmodemKeepalive clears internal timer", () => {
    const keepaliveFired = vi.fn();
    const session: any = {
      _keepalive_timeout: setTimeout(keepaliveFired, 5000),
      _keepalive_promise: Promise.resolve(),
      abort: vi.fn(),
    };
    stopZmodemKeepalive(session);
    vi.advanceTimersByTime(10_000);
    expect(keepaliveFired).not.toHaveBeenCalled();

    const zmodemSessions = new Map<string, ZmodemActiveSessionEntry>([
      ["s1", { session, zmodem: {} }],
    ]);
    const zmodemSentries = new Map<string, ZmodemSentryLike>([
      ["s1", {}],
    ]);
    const shellZmodemEnd = vi.fn().mockResolvedValue(undefined);
    disposeAllZmodemSessions({
      zmodemSessions,
      zmodemSentries,
      abort: true,
      endBackend: true,
      shellZmodemEnd,
    });

    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(shellZmodemEnd).toHaveBeenCalledWith("s1");
    expect(zmodemSessions.size).toBe(0);
    expect(zmodemSentries.size).toBe(0);
  });
});
