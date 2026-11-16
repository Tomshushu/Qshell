import { ProgrammableScriptController, stripAnsiCodes } from "@/lib/send-expect-matcher";
import { registerOutputObserver } from "@/lib/terminal-output-bus";
import type { LogonScriptContext } from "@/types";

export interface ScriptSandboxOptions {
  termId?: string;
  context?: LogonScriptContext;
  sendFn: (text: string) => Promise<void>;
  dialogCallbacks?: {
    alert?: (msg: string) => Promise<void>;
    prompt?: (msg: string, def?: string) => Promise<string | null>;
    toast?: (msg: string, type?: "info" | "success" | "warning" | "error") => void;
  };
  /** 仅用于测试自定义 Worker 构造函数 */
  workerFactory?: (scriptUrl: string) => Worker;
}

interface PendingWaiter {
  id: number;
  check: (buffer: string) => { hit: boolean; consumeIndex: number; value: unknown } | null;
  resolve: (val: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * 构建 Web Worker 自动化脚本载体：
 * - Worker 仅用于避免脚本阻塞主 UI（可 terminate 强杀死循环），**不是安全沙箱**；
 *   new Function 参数遮蔽可被 self.fetch / constructor.constructor 等绕过，脚本必须可信。
 * - 通过 postMessage RPC 与主线程 screen / dialog / session 通信
 * - 支持主线程调用 worker.terminate() 瞬时强杀死循环脚本
 */
export function buildSandboxWorkerSource(userCode: string): string {
  const escapedCode = JSON.stringify(userCode);
  return `"use strict";
// CSP 为脚本引擎保留了 'unsafe-eval'，因此要主动封死 Worker 全局上的网络/存储逃逸通道。
// new Function 的形参遮蔽只能挡住同名标识符，self.fetch 等仍可直接访问；
// 这里在用户代码执行前把它们置为不可写的 undefined，缩小脚本被注入时的外传面。
for (const blockedKey of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "indexedDB", "caches"]) {
  try {
    Object.defineProperty(self, blockedKey, { value: undefined, writable: false, configurable: false });
  } catch { /* 宿主已冻结该属性时忽略 */ }
}
const pendingRpc = new Map();
let nextRpcId = 1;

function callHost(method, args) {
  return new Promise((resolve, reject) => {
    const id = nextRpcId++;
    pendingRpc.set(id, { resolve, reject });
    self.postMessage({ type: "rpc", id, method, args });
  });
}

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg) return;
  if (msg.type === "rpc_result") {
    const entry = pendingRpc.get(msg.id);
    if (!entry) return;
    pendingRpc.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error));
    else entry.resolve(msg.result);
    return;
  }
  if (msg.type === "start") {
    const session = Object.freeze({
      ...(msg.session || {}),
      params: Object.freeze({ ...((msg.session && msg.session.params) || {}) }),
    });
    const screen = Object.freeze({
      waitForString: (pattern, timeoutMs = 30000) => callHost("waitForString", [String(pattern ?? ""), Number(timeoutMs)]),
      waitForStrings: (patterns, timeoutMs = 30000) => callHost("waitForStrings", [Array.isArray(patterns) ? patterns.map((p) => String(p ?? "")) : [], Number(timeoutMs)]),
      waitForRegex: (regex, timeoutMs = 30000) => {
        if (!(regex instanceof RegExp) && typeof regex !== "string") {
          return Promise.resolve(null);
        }
        const serialized = regex instanceof RegExp
          ? { source: regex.source, flags: regex.flags }
          : { source: String(regex), flags: "i" };
        return callHost("waitForRegex", [serialized, Number(timeoutMs)]).then((res) => {
          if (!res) return null;
          if (Array.isArray(res)) return res;
          const arr = Array.isArray(res.matches) ? res.matches.slice() : [];
          arr.index = typeof res.index === "number" ? res.index : 0;
          arr.input = typeof res.input === "string" ? res.input : "";
          if (res.groups) arr.groups = res.groups;
          return arr;
        });
      },
      send: (text, appendEnter = true) => callHost("send", [String(text), Boolean(appendEnter)]),
      sleep: (ms) => callHost("sleep", [Number(ms)]),
    });
    const dialog = Object.freeze({
      alert: (message) => callHost("alert", [String(message)]),
      prompt: (message, defaultValue = "") => callHost("prompt", [String(message), String(defaultValue ?? "")]),
      toast: (message, variant = "info") => callHost("toast", [String(message), variant]),
    });

    (async () => {
      const code = ${escapedCode};
      const fn = new Function(
        "screen",
        "session",
        "dialog",
        "fetch",
        "XMLHttpRequest",
        "WebSocket",
        "EventSource",
        "importScripts",
        "navigator",
        "indexedDB",
        "caches",
        "return (async () => {\\n" + code + "\\n})();"
      );
      await fn(screen, session, dialog, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined);
      self.postMessage({ type: "done" });
    })().catch((err) => {
      self.postMessage({ type: "error", message: err && err.message ? err.message : String(err) });
    });
  }
};
self.postMessage({ type: "ready" });`;
}

/**
 * 现代 JS 自动化脚本沙箱执行器 (P1-16)
 *
 * 优先在独立 Web Worker 中执行用户脚本，调用 `stop()` 时直接 `worker.terminate()`，
 * 确保即使出现 `while (true) {}` 死循环也不会冻结主 UI 线程。
 */
export class ScriptSandbox {
  private options: ScriptSandboxOptions;
  private worker: Worker | null = null;
  private fallbackController: ProgrammableScriptController | null = null;
  private unregisterObserver: (() => void) | null = null;
  private outputBuffer = "";
  private waiters = new Map<number, PendingWaiter>();
  private aborted = false;
  private blobUrl: string | null = null;
  private rejectRun: ((reason?: unknown) => void) | null = null;

  constructor(options: ScriptSandboxOptions) {
    this.options = options;
  }

  public feedOutput(rawChunk: string): void {
    if (this.aborted || !rawChunk) return;
    if (this.fallbackController) {
      this.fallbackController.feedOutput(rawChunk);
      return;
    }
    const clean = stripAnsiCodes(rawChunk);
    if (!clean) return;
    this.outputBuffer = (this.outputBuffer + clean).slice(-8192);
    this.flushWaiters();
  }

  private async runWithFallback(code: string): Promise<void> {
    if (this.aborted) {
      throw new Error("Script execution aborted");
    }
    // 主线程降级执行：死循环可能冻结界面，明确告知用户（所有 fallback 路径统一提示）
    this.options.dialogCallbacks?.toast?.(
      "脚本降级到主线程执行；死循环可能暂时卡住界面，请确保脚本可信。",
      "warning",
    );
    const controller = new ProgrammableScriptController(
      this.options.sendFn,
      this.options.context,
      this.options.dialogCallbacks,
    );
    this.fallbackController = controller;
    if (this.outputBuffer) {
      const buffered = this.outputBuffer;
      this.outputBuffer = "";
      controller.feedOutput(buffered);
    }
    try {
      await controller.runScript(code);
    } finally {
      this.cleanup();
    }
  }

  private cleanupWorkerOnly(): void {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // ignore terminate failure
      }
      this.worker = null;
    }
    if (this.blobUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    for (const waiter of this.waiters.values()) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
    this.waiters.clear();
  }

  public async run(code: string): Promise<void> {
    this.aborted = false;
    this.outputBuffer = "";

    if (this.options.termId) {
      this.unregisterObserver = registerOutputObserver({
        id: `automation-sandbox:${this.options.termId}:${Date.now()}`,
        priority: 30,
        bypassThrottle: true,
        onChunk: (ev) => {
          if (ev.termId === this.options.termId) {
            this.feedOutput(ev.rawChunk);
          }
        },
      });
    }

    const canUseWorker =
      typeof this.options.workerFactory === "function" ||
      (typeof Worker !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function");

    if (!canUseWorker) {
      await this.runWithFallback(code);
      return;
    }

    let worker: Worker;
    try {
      const source = buildSandboxWorkerSource(code);
      let workerUrl = "data:application/javascript;charset=utf-8," + encodeURIComponent(source);
      if (!this.options.workerFactory && typeof Blob !== "undefined") {
        const blob = new Blob([source], { type: "application/javascript" });
        this.blobUrl = URL.createObjectURL(blob);
        workerUrl = this.blobUrl;
      }

      worker = this.options.workerFactory
        ? this.options.workerFactory(workerUrl)
        : new Worker(workerUrl);
      this.worker = worker;
    } catch {
      this.cleanupWorkerOnly();
      await this.runWithFallback(code);
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.rejectRun = reject;
      let workerReady = false;

      worker.onmessage = (ev: MessageEvent) => {
        workerReady = true;
        const msg = ev.data;
        if (!msg) return;
        if (msg.type === "ready") {
          return;
        }
        if (msg.type === "done") {
          this.rejectRun = null;
          this.cleanup();
          resolve();
        } else if (msg.type === "error") {
          this.rejectRun = null;
          this.cleanup();
          reject(new Error(msg.message || "Script error"));
        } else if (msg.type === "rpc") {
          void this.handleRpc(msg.id, msg.method, msg.args || [])
            .then((result) => {
              if (!this.aborted && this.worker) {
                this.worker.postMessage({ type: "rpc_result", id: msg.id, result });
              }
            })
            .catch((err) => {
              if (!this.aborted && this.worker) {
                this.worker.postMessage({
                  type: "rpc_result",
                  id: msg.id,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            });
        }
      };

      worker.onerror = (err: ErrorEvent) => {
        if (!workerReady && !this.aborted) {
          this.cleanupWorkerOnly();
          void this.runWithFallback(code).then(
            () => {
              this.rejectRun = null;
              resolve();
            },
            (fallbackErr) => {
              this.rejectRun = null;
              reject(fallbackErr);
            },
          );
          return;
        }
        const message = err?.message || "Worker execution error";
        this.rejectRun = null;
        this.cleanup();
        reject(new Error(message));
      };

      try {
        worker.postMessage({
          type: "start",
          session: {
            username: this.options.context?.username || "",
            host: this.options.context?.host || "",
            port: Number(this.options.context?.port) || 22,
            serverName: this.options.context?.serverName || "",
            params: { ...(this.options.context?.params || {}) },
          },
        });
      } catch {
        if (!this.aborted) {
          this.cleanupWorkerOnly();
          void this.runWithFallback(code).then(
            () => {
              this.rejectRun = null;
              resolve();
            },
            (fallbackErr) => {
              this.rejectRun = null;
              reject(fallbackErr);
            },
          );
        }
      }
    });
  }

  public stop(): void {
    this.aborted = true;
    const reject = this.rejectRun;
    this.rejectRun = null;
    if (this.fallbackController) {
      this.fallbackController.abort();
      this.fallbackController = null;
    }
    this.cleanup();
    if (reject) {
      reject(new Error("Script execution aborted"));
    }
  }

  private cleanup(): void {
    this.cleanupWorkerOnly();
    if (this.fallbackController) {
      this.fallbackController.abort();
      this.fallbackController = null;
    }
    if (this.unregisterObserver) {
      this.unregisterObserver();
      this.unregisterObserver = null;
    }
  }

  private async handleRpc(id: number, method: string, args: unknown[]): Promise<unknown> {
    if (this.aborted) return null;

    switch (method) {
      case "send": {
        const text = String(args[0] ?? "");
        const appendEnter = args[1] !== false;
        const payload = appendEnter && !text.endsWith("\r") && !text.endsWith("\n") ? `${text}\r` : text;
        await this.options.sendFn(payload);
        return true;
      }
      case "sleep": {
        const ms = Math.max(0, Number(args[0]) || 0);
        if (ms <= 0) return true;
        // 纳入 waiters，使 stop()/cleanup 能统一 clearTimeout 并 resolve，
        // 避免长 sleep 定时器在脚本被中止后仍悬挂在主线程上。
        return this.registerWait(id, ms, true, () => null);
      }
      case "alert":
        if (this.options.dialogCallbacks?.alert) {
          await this.options.dialogCallbacks.alert(String(args[0] ?? ""));
        } else {
          this.options.dialogCallbacks?.toast?.(String(args[0] ?? ""), "info");
        }
        return true;
      case "prompt":
        if (this.options.dialogCallbacks?.prompt) {
          return this.options.dialogCallbacks.prompt(String(args[0] ?? ""), String(args[1] ?? ""));
        }
        return null;
      case "toast":
        this.options.dialogCallbacks?.toast?.(
          String(args[0] ?? ""),
          (args[1] as "info" | "success" | "warning" | "error") || "info",
        );
        return true;
      case "waitForString": {
        const pat = String(args[0] ?? "");
        if (!pat) return false;
        const rawTimeout = Number(args[1]);
        const timeoutMs = Number.isFinite(rawTimeout) ? Math.max(0, rawTimeout) : 30000;
        const lower = pat.toLowerCase();
        return this.registerWait(id, timeoutMs, false, (buf) => {
          const idx = buf.toLowerCase().indexOf(lower);
          return idx >= 0 ? { hit: true, consumeIndex: idx + lower.length, value: true } : null;
        });
      }
      case "waitForStrings": {
        const patterns = Array.isArray(args[0]) ? args[0].map((p) => String(p ?? "")) : [];
        if (!patterns.some((p) => p.length > 0)) return -1;
        const rawTimeout = Number(args[1]);
        const timeoutMs = Number.isFinite(rawTimeout) ? Math.max(0, rawTimeout) : 30000;
        return this.registerWait(id, timeoutMs, -1, (buf) => {
          const lowerBuf = buf.toLowerCase();
          for (let i = 0; i < patterns.length; i++) {
            const lp = patterns[i].toLowerCase();
            if (!lp) continue;
            const idx = lowerBuf.indexOf(lp);
            if (idx >= 0) {
              return { hit: true, consumeIndex: idx + lp.length, value: i };
            }
          }
          return null;
        });
      }
      case "waitForRegex": {
        const spec = (args[0] || {}) as { source?: string; flags?: string };
        if (typeof spec.source !== "string" || spec.source.length === 0) {
          return null;
        }
        const rawTimeout = Number(args[1]);
        const timeoutMs = Number.isFinite(rawTimeout) ? Math.max(0, rawTimeout) : 30000;
        let re: RegExp;
        try {
          re = new RegExp(spec.source, spec.flags || "");
        } catch {
          return null;
        }
        return this.registerWait(id, timeoutMs, null, (buf) => {
          re.lastIndex = 0;
          const m = re.exec(buf);
          if (!m) return null;
          return {
            hit: true,
            consumeIndex: m.index + Math.max(1, m[0].length),
            value: {
              matches: Array.from(m),
              index: m.index,
              input: m.input,
              groups: m.groups ? { ...m.groups } : undefined,
            },
          };
        });
      }
      default:
        throw new Error(`Unknown sandbox RPC method: ${method}`);
    }
  }

  private registerWait(
    id: number,
    timeoutMs: number,
    timeoutFallback: unknown,
    check: (buf: string) => { hit: boolean; consumeIndex: number; value: unknown } | null,
  ): Promise<unknown> {
    const immediate = check(this.outputBuffer);
    if (immediate?.hit) {
      this.outputBuffer = this.outputBuffer.slice(immediate.consumeIndex);
      return Promise.resolve(immediate.value);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        resolve(timeoutFallback);
      }, timeoutMs);
      this.waiters.set(id, { id, check, resolve, timer });
    });
  }

  private flushWaiters(): void {
    for (const [id, waiter] of this.waiters) {
      const res = waiter.check(this.outputBuffer);
      if (res?.hit) {
        clearTimeout(waiter.timer);
        this.waiters.delete(id);
        this.outputBuffer = this.outputBuffer.slice(res.consumeIndex);
        waiter.resolve(res.value);
      }
    }
  }
}
