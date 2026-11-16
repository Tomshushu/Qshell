import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearOutputBusSession,
  dispatchTerminalOutputObservers,
  OUTPUT_BUS_FLOOD_THRESHOLD_CHARS,
  terminalOutputBus,
} from "@/lib/terminal-output-bus";
import { TriggerEngine } from "../trigger-engine";
import { buildSandboxWorkerSource, ScriptSandbox } from "../script-sandbox";
import { ActionRecorder, MacroRunner, parseHexPayload } from "../macro-runner";
import { loadMacroSequences, saveMacroSequences, saveTriggerRules } from "../storage";
import { automationRegistry } from "../automation-runner";
import type { MacroSequence, TriggerRule } from "@/types/automation";

describe("Automation Suite (Wave 2 Slice 2B)", () => {
  beforeEach(() => {
    terminalOutputBus.resetAll();
    clearOutputBusSession("term-1");
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
  });

  it("TriggerEngine matches plain & regex rules, enforces cooldown, and stops processing", () => {
    const actions: Array<{ id: string; resolved: string }> = [];
    const rules: TriggerRule[] = [
      {
        id: "r-continue",
        name: "More pager",
        enabled: true,
        pattern: "--More--",
        actionType: "send_text",
        payload: " ",
        cooldownMs: 100,
        stopProcessing: true,
      },
      {
        id: "r-err",
        name: "Error alert",
        enabled: true,
        pattern: "/ERROR:\\s+(\\w+)/i",
        isRegex: true,
        actionType: "toast",
        payload: "Hit %h",
        cooldownMs: 100,
      },
    ];

    const engine = new TriggerEngine({
      termId: "term-1",
      rules,
      getContext: () => ({ host: "10.0.0.5", username: "ops" }),
      onAction: (ev) => actions.push({ id: ev.rule.id, resolved: ev.resolvedPayload }),
    });
    const stop = engine.start();

    // T=1000: --More-- matches first rule and stops processing second
    dispatchTerminalOutputObservers("term-1", "--More-- ERROR: DISK", "--More-- ERROR: DISK");
    // Feed directly with deterministic timestamps for cooldown & regex testing
    engine.handleChunk({
      termId: "term-1",
      rawChunk: "ERROR: TIMEOUT",
      renderedChunk: "ERROR: TIMEOUT",
      timestampMs: 2000,
    });
    // Cooldown 100ms prevents re-fire at 2050
    engine.handleChunk({
      termId: "term-1",
      rawChunk: "ERROR: TIMEOUT",
      renderedChunk: "ERROR: TIMEOUT",
      timestampMs: 2050,
    });
    // Fires again at 2150
    engine.handleChunk({
      termId: "term-1",
      rawChunk: "ERROR: TIMEOUT",
      renderedChunk: "ERROR: TIMEOUT",
      timestampMs: 2150,
    });

    stop();

    expect(actions[0]).toEqual({ id: "r-continue", resolved: " " });
    expect(actions.filter((a) => a.id === "r-err")).toEqual([
      { id: "r-err", resolved: "Hit 10.0.0.5" },
      { id: "r-err", resolved: "Hit 10.0.0.5" },
    ]);
  });

  it("TriggerEngine circuit breaker trips when output exceeds 2MB/s flood threshold", () => {
    const reasons: string[] = [];
    const fires: string[] = [];
    const engine = new TriggerEngine({
      termId: "term-1",
      rules: [
        {
          id: "r1",
          name: "Ping",
          enabled: true,
          pattern: "PING",
          actionType: "bell",
          cooldownMs: 0,
        },
      ],
      onAction: (ev) => fires.push(ev.rule.id),
      onCircuitBreak: (reason) => reasons.push(reason),
    });

    const hugeChunk = "X".repeat(OUTPUT_BUS_FLOOD_THRESHOLD_CHARS + 16) + "PING";
    engine.handleChunk({
      termId: "term-1",
      rawChunk: hugeChunk,
      renderedChunk: hugeChunk,
      timestampMs: 5000,
    });

    expect(reasons.length).toBe(1);
    expect(reasons[0]).toContain("2MB/s");
    expect(fires.length).toBe(0);
  });

  it("ScriptSandbox Worker isolates dangerous globals and hard-terminates infinite loops", async () => {
    const workerSrc = buildSandboxWorkerSource("while (true) {}");
    expect(workerSrc).toContain('"fetch"');
    expect(workerSrc).toContain('"XMLHttpRequest"');
    expect(workerSrc).toContain('"WebSocket"');
    expect(workerSrc).toContain('"importScripts"');

    let terminated = false;
    let fakeWorker: {
      postMessage: (msg: unknown) => void;
      terminate: () => void;
      onmessage: ((ev: MessageEvent) => void) | null;
      onerror: ((ev: ErrorEvent) => void) | null;
    } | null = null;

    const sent: string[] = [];
    const sandbox = new ScriptSandbox({
      termId: "term-1",
      context: { username: "alice", host: "db1", params: { env: "prod" } },
      sendFn: async (text) => {
        sent.push(text);
      },
      workerFactory: () => {
        fakeWorker = {
          onmessage: null,
          onerror: null,
          postMessage(msg: unknown) {
            const payload = msg as { type: string; session?: { params?: Record<string, string> } };
            if (payload.type === "start") {
              expect(payload.session?.params?.env).toBe("prod");
              queueMicrotask(() => {
                fakeWorker?.onmessage?.({
                  data: { type: "rpc", id: 1, method: "send", args: ["deploy " + payload.session?.params?.env, true] },
                } as MessageEvent);
              });
            }
          },
          terminate() {
            terminated = true;
          },
        };
        return fakeWorker as unknown as Worker;
      },
    });

    const runPromise = sandbox.run('await screen.send("deploy " + session.params.env); while (true) {}');
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toEqual(["deploy prod\r"]);

    sandbox.stop();
    await expect(runPromise).rejects.toThrow("aborted");
    expect(terminated).toBe(true);
  });

  it("MacroRunner executes ASCII (%P{name}) and HEX+CRC steps and supports stop()", async () => {
    const texts: string[] = [];
    const byteChunks: Uint8Array[] = [];
    const runner = new MacroRunner();

    expect(Array.from(parseHexPayload("01 03 00 00"))).toEqual([1, 3, 0, 0]);

    const seq: MacroSequence = {
      id: "m1",
      name: "Diag Macro",
      scope: "all",
      loopCount: 1,
      steps: [
        {
          id: "s1",
          enabled: true,
          name: "Check env",
          type: "ascii",
          payload: "echo %P{env}",
          suffix: "\n",
          delayMs: 0,
        },
        {
          id: "s2",
          enabled: true,
          name: "Modbus frame",
          type: "hex",
          payload: "01 03 00 00 00 02",
          suffix: "",
          delayMs: 0,
          checksumType: "modbus-crc16-le",
        },
        {
          id: "s3",
          enabled: false,
          name: "Skipped",
          type: "ascii",
          payload: "never",
          suffix: "\r",
          delayMs: 0,
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    };

    await runner.run(seq, {
      context: { params: { env: "staging" } },
      sendText: async (t) => {
        texts.push(t);
      },
      sendBytes: async (b) => {
        byteChunks.push(b);
        return true;
      },
    });

    expect(texts).toEqual(["echo staging\n"]);
    expect(byteChunks.length).toBe(1);
    expect(byteChunks[0].length).toBe(8); // 6 payload bytes + 2 CRC16-Modbus bytes
  });

  it("ActionRecorder captures input commands and exports script, rules, and macro sequence", () => {
    const recorder = new ActionRecorder();
    recorder.start(1000);
    recorder.recordUserInput("ls -l", 1050);
    recorder.recordUserInput("a\r", 1080); // -> ls -la
    recorder.recordUserInput("pw\x7f\x7fwhoami\r", 1600);
    const actions = recorder.stop();

    expect(actions.map((a) => a.data)).toEqual(["ls -la", "whoami"]);
    const script = recorder.toScript("Inspect");
    expect(script).toContain('await screen.send("ls -la");');
    expect(script).toContain("await screen.sleep(520);");
    expect(script).toContain('await screen.send("whoami");');

    const rules = recorder.toSendExpectRules("$");
    expect(rules.length).toBe(2);
    expect(rules[1].send).toBe("whoami");

    const macro = recorder.toMacroSequence("Saved");
    expect(macro.steps.length).toBe(2);
    expect(macro.steps[0].payload).toBe("ls -la");
  });

  it("storage migrates legacy serial-macro-sequences and automationRegistry orchestrates sessions", async () => {
    localStorage.setItem(
      "serial-macro-sequences",
      JSON.stringify([
        {
          id: "ser-1",
          enabled: true,
          name: "AT",
          type: "ascii",
          payload: "AT",
          suffix: "\r\n",
          delayMs: 10,
          checksumType: "none",
        },
      ]),
    );
    const migrated = loadMacroSequences();
    expect(migrated.length).toBe(1);
    expect(migrated[0].scope).toBe("serial");
    expect(migrated[0].steps[0].payload).toBe("AT");
    saveMacroSequences(migrated);

    const sent: string[] = [];
    const toasts: string[] = [];
    saveTriggerRules([
      {
        id: "t-auto",
        name: "Stop signal",
        enabled: true,
        pattern: "HALT_NOW",
        actionType: "toast",
        payload: "Halted cleanly",
        cooldownMs: 50,
      },
    ]);

    const unregister = automationRegistry.registerHost({
      tabId: "tab-test",
      termId: "term-1",
      sessionId: "sess-1",
      getContext: () => ({ host: "localhost", username: "tester" }),
      sendText: async (text) => {
        sent.push(text);
      },
      toast: (msg) => toasts.push(msg),
    });

    dispatchTerminalOutputObservers("term-1", "HALT_NOW\n", "HALT_NOW\n");
    expect(toasts).toContain("Halted cleanly");

    await automationRegistry.runMacro("tab-test", migrated[0]);
    expect(sent).toEqual(["AT\r\n"]);

    unregister();
  });

  it("TriggerEngine does not re-fire on stale cleanBuffer when unrelated output arrives", () => {
    const fired: string[] = [];
    const engine = new TriggerEngine({
      termId: "term-1",
      rules: [
        {
          id: "r-stale",
          name: "Prompt",
          enabled: true,
          pattern: "READY>",
          actionType: "toast",
          payload: "ok",
          cooldownMs: 100,
        },
      ],
      onAction: (ev) => fired.push(ev.matchedText),
    });

    // 1. Single trigger fires once
    engine.handleChunk({
      termId: "term-1",
      rawChunk: "booting...\nREADY> ",
      renderedChunk: "booting...\nREADY> ",
      timestampMs: 1000,
    });
    expect(fired.length).toBe(1);

    // 2. Unrelated subsequent output chunks (both with and without newline) after cooldown must NOT re-fire
    engine.handleChunk({
      termId: "term-1",
      rawChunk: "unrelated line 1\n",
      renderedChunk: "unrelated line 1\n",
      timestampMs: 1500,
    });
    engine.handleChunk({
      termId: "term-1",
      rawChunk: "more unrelated output",
      renderedChunk: "more unrelated output",
      timestampMs: 2000,
    });
    expect(fired.length).toBe(1);

    // 3. Fresh occurrence DOES fire after cooldown
    engine.handleChunk({
      termId: "term-1",
      rawChunk: "\nREADY> ",
      renderedChunk: "\nREADY> ",
      timestampMs: 2500,
    });
    expect(fired.length).toBe(2);
  });

  it("TriggerEngine resets circuitBreakerTripped in automationRegistry when cooldown finishes", () => {
    const toasts: string[] = [];
    saveTriggerRules([
      {
        id: "r-cb",
        name: "Ping",
        enabled: true,
        pattern: "PING",
        actionType: "bell",
        cooldownMs: 0,
      },
    ]);

    vi.useFakeTimers();
    try {
      const unregister = automationRegistry.registerHost({
        tabId: "tab-cb",
        termId: "term-cb",
        getContext: () => ({ host: "localhost" }),
        sendText: async () => {},
        toast: (m) => toasts.push(m),
      });

      const flood = "X".repeat(OUTPUT_BUS_FLOOD_THRESHOLD_CHARS + 10) + "PING";
      dispatchTerminalOutputObservers("term-cb", flood, flood);
      expect(automationRegistry.getSnapshot("tab-cb").circuitBreakerTripped).toBe(true);

      vi.advanceTimersByTime(1100);
      expect(automationRegistry.getSnapshot("tab-cb").circuitBreakerTripped).toBe(false);
      unregister();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ScriptSandbox falls back to ProgrammableScriptController on Worker throw or immediate onerror, and preserves regex captures", async () => {
    const sent: string[] = [];
    // 1. Synchronous new Worker() throw fallback
    const sandboxThrow = new ScriptSandbox({
      termId: "term-1",
      sendFn: async (text) => {
        sent.push(text);
      },
      workerFactory: () => {
        throw new Error("Worker blocked by CSP");
      },
    });
    await sandboxThrow.run('await screen.send("fallback-ok");');
    expect(sent).toEqual(["fallback-ok\r"]);

    // 2. Immediate onerror before ready handshake fallback
    sent.length = 0;
    const sandboxErr = new ScriptSandbox({
      termId: "term-1",
      sendFn: async (text) => {
        sent.push(text);
      },
      workerFactory: () => {
        const w = {
          onmessage: null as ((ev: MessageEvent) => void) | null,
          onerror: null as ((ev: ErrorEvent) => void) | null,
          postMessage() {
            queueMicrotask(() => {
              w.onerror?.({ message: "Failed to load worker" } as ErrorEvent);
            });
          },
          terminate() {},
        };
        return w as unknown as Worker;
      },
    });
    await sandboxErr.run('await screen.send("onerror-fallback");');
    expect(sent).toEqual(["onerror-fallback\r"]);

    // 3. waitForString("") guard, invalid waitForRegex guard, and regex capture preservation across RPC
    let fakeWorker: {
      onmessage: ((ev: MessageEvent) => void) | null;
      onerror: ((ev: ErrorEvent) => void) | null;
      postMessage: (msg: unknown) => void;
      terminate: () => void;
    } | null = null;
    const rpcResults: Array<{ id: number; result: unknown }> = [];
    const sandboxRpc = new ScriptSandbox({
      termId: "term-1",
      sendFn: async () => {},
      workerFactory: () => {
        fakeWorker = {
          onmessage: null,
          onerror: null,
          postMessage(msg: unknown) {
            const payload = msg as { type: string; id?: number; result?: unknown };
            if (payload.type === "start") {
              queueMicrotask(() => {
                fakeWorker?.onmessage?.({ data: { type: "ready" } } as MessageEvent);
                fakeWorker?.onmessage?.({
                  data: { type: "rpc", id: 1, method: "waitForString", args: ["", 500] },
                } as MessageEvent);
                fakeWorker?.onmessage?.({
                  data: { type: "rpc", id: 2, method: "waitForRegex", args: [{ source: "[bad", flags: "" }, 500] },
                } as MessageEvent);
                fakeWorker?.onmessage?.({
                  data: { type: "rpc", id: 3, method: "waitForRegex", args: [{ source: "user=(?<name>\\w+)", flags: "" }, 500] },
                } as MessageEvent);
                sandboxRpc.feedOutput("prefix user=alice suffix");
              });
            } else if (payload.type === "rpc_result" && payload.id !== undefined) {
              rpcResults.push({ id: payload.id, result: payload.result });
              if (rpcResults.length === 3) {
                queueMicrotask(() => {
                  fakeWorker?.onmessage?.({ data: { type: "done" } } as MessageEvent);
                });
              }
            }
          },
          terminate() {},
        };
        return fakeWorker as unknown as Worker;
      },
    });

    await sandboxRpc.run("/* driver test */");
    expect(rpcResults.find((r) => r.id === 1)?.result).toBe(false);
    expect(rpcResults.find((r) => r.id === 2)?.result).toBeNull();
    const regexRes = rpcResults.find((r) => r.id === 3)?.result as {
      matches: string[];
      index: number;
      input: string;
      groups?: Record<string, string>;
    };
    expect(regexRes.matches[0]).toBe("user=alice");
    expect(regexRes.matches[1]).toBe("alice");
    expect(regexRes.index).toBe(7);
    expect(regexRes.groups).toEqual({ name: "alice" });
  });

  it("ActionRecorder strips CSI/SS3 escapes, clears on Ctrl+C/U, sets step 0 delay=0, and records submitted commands", () => {
    const recorder = new ActionRecorder();
    recorder.start(1000);
    // Arrow up (\x1b[A), Home (\x1b[H / \x1bOH), F5 (\x1b[15~), F1 (\x1bOP)
    recorder.recordUserInput("\x1b[A\x1bOH\x1b[15~\x1bOPecho hi\r", 1500);
    // Ctrl+C (\x03) and Ctrl+U (\x15) discard partial line
    recorder.recordUserInput("rm -rf /\x03whoami\x15id\r", 1800);
    recorder.recordSubmittedCommand("uname -a\ndf -h\n", 2100);
    const actions = recorder.stop();

    expect(actions.map((a) => a.data)).toEqual(["echo hi", "id", "uname -a", "df -h"]);
    expect(actions[0].delaySincePrevMs).toBe(0);
    expect(actions[1].delaySincePrevMs).toBe(300);
  });

  it("MacroRunner.stop() clears pending timeout immediately without completion toast and handles large byte arrays", async () => {
    const toasts: string[] = [];
    const unregister = automationRegistry.registerHost({
      tabId: "tab-macro-stop",
      termId: "term-1",
      getContext: () => ({}),
      sendText: async () => {},
      toast: (msg) => toasts.push(msg),
    });

    const slowMacro: MacroSequence = {
      id: "m-slow",
      name: "Slow",
      scope: "all",
      loopCount: 1,
      steps: [
        { id: "s1", enabled: true, name: "1", type: "ascii", payload: "echo 1", suffix: "\r", delayMs: 10000 },
        { id: "s2", enabled: true, name: "2", type: "ascii", payload: "echo 2", suffix: "\r", delayMs: 0 },
      ],
      createdAt: 1,
      updatedAt: 1,
    };

    const runPromise = automationRegistry.runMacro("tab-macro-stop", slowMacro);
    await new Promise((r) => setTimeout(r, 15));
    automationRegistry.stopExecution("tab-macro-stop");
    await runPromise;

    expect(toasts.some((m) => m.includes("完成"))).toBe(false);
    expect(automationRegistry.getSnapshot("tab-macro-stop").runningKind).toBeNull();
    unregister();

    // Large HEX payload (> 70,000 bytes) without sendBytes should not overflow call stack
    const largeHex = "AA ".repeat(70000).trim();
    const received: string[] = [];
    const runner = new MacroRunner();
    await runner.run(
      {
        id: "m-big",
        name: "Big",
        steps: [
          { id: "sb", enabled: true, name: "big", type: "hex", payload: largeHex, suffix: "", delayMs: 0 },
        ],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        sendText: async (text) => {
          received.push(text);
        },
      },
    );
    expect(received[0].length).toBe(70000);
  });

  it("storage persists migrated serial-macro-sequences on first load and honors subsequent empty save", () => {
    localStorage.setItem(
      "serial-macro-sequences",
      JSON.stringify([
        {
          id: "ser-legacy",
          enabled: true,
          name: "VER",
          type: "ascii",
          payload: "VER",
          suffix: "\r",
          delayMs: 20,
        },
      ]),
    );

    const first = loadMacroSequences();
    expect(first.length).toBe(1);
    expect(localStorage.getItem("qshell-automation-macros")).toBeTruthy();

    saveMacroSequences([]);
    expect(loadMacroSequences()).toEqual([]);
  });
});
