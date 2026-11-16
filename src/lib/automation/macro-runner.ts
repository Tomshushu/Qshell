import { interpolateMacros, stripAnsiCodes } from "@/lib/send-expect-matcher";
import { appendChecksumToHex, hexToBytes } from "@/lib/serial-checksum";
import type { LogonScriptContext, SendExpectRule } from "@/types";
import type { MacroSequence, MacroStep, RecordedAction } from "@/types/automation";

/** 将十六进制字符串（空格/0x 可选）解析为字节数组 */
export function parseHexPayload(hex: string): Uint8Array {
  return hexToBytes(hex.replace(/0x/gi, ""));
}

function bytesToLatin1String(bytes: Uint8Array): string {
  let out = "";
  const CHUNK_SIZE = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return out;
}

export interface MacroRunnerOptions {
  context?: LogonScriptContext;
  sendText: (text: string) => Promise<void>;
  sendBytes?: (bytes: Uint8Array) => Promise<boolean>;
  onStep?: (stepIndex: number, step: MacroStep, loop: number) => void;
}

/**
 * 通用宏序列执行器 (P1-05)
 *
 * 与串口快捷发送序列 (`SerialSequenceItem`) 共享同一套数据结构，
 * 同时支持 SSH / Telnet / 本地终端与串口，兼容 ASCII + 宏插值与 HEX + 校验和。
 */
export class MacroRunner {
  private aborted = false;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingReject: ((reason?: unknown) => void) | null = null;

  public stop(): void {
    this.aborted = true;
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (this.pendingReject) {
      const reject = this.pendingReject;
      this.pendingReject = null;
      reject(new Error("Macro execution aborted"));
    }
  }

  public async run(sequence: MacroSequence, options: MacroRunnerOptions): Promise<void> {
    this.aborted = false;
    const enabledSteps = sequence.steps.filter((s) => s.enabled);
    if (enabledSteps.length === 0) return;

    const totalLoops = Math.max(1, sequence.loopCount ?? 1);
    for (let loop = 1; loop <= totalLoops; loop++) {
      for (let i = 0; i < enabledSteps.length; i++) {
        if (this.aborted) {
          throw new Error("Macro execution aborted");
        }
        const step = enabledSteps[i];
        options.onStep?.(i, step, loop);

        if (step.type === "hex") {
          const hexStr = step.checksumType && step.checksumType !== "none"
            ? appendChecksumToHex(step.payload, step.checksumType).resultHex
            : step.payload;
          const bytes = parseHexPayload(hexStr);
          if (options.sendBytes) {
            await options.sendBytes(bytes);
          } else {
            await options.sendText(bytesToLatin1String(bytes));
          }
        } else {
          const interpolated = interpolateMacros(step.payload, options.context);
          await options.sendText(`${interpolated}${step.suffix || ""}`);
        }

        if (this.aborted) {
          throw new Error("Macro execution aborted");
        }

        if (step.delayMs > 0) {
          await new Promise<void>((resolve, reject) => {
            if (this.aborted) {
              reject(new Error("Macro execution aborted"));
              return;
            }
            this.pendingReject = reject;
            this.pendingTimer = setTimeout(() => {
              this.pendingTimer = null;
              this.pendingReject = null;
              resolve();
            }, step.delayMs);
          });
        }
      }
    }
  }
}

/**
 * 会话动作录制器 (P1-04)
 *
 * 捕获用户在终端中键入/粘贴的命令及间隔时间，
 * 一键转换为 JS 自动化脚本、Send-Expect 规则表或可复用的通用宏序列。
 */
export class ActionRecorder {
  private active = false;
  private startAtMs = 0;
  private lastActionMs = 0;
  private lineBuffer = "";
  private actions: RecordedAction[] = [];

  public isRecording(): boolean {
    return this.active;
  }

  public getActions(): RecordedAction[] {
    return [...this.actions];
  }

  public start(nowMs = Date.now()): void {
    this.active = true;
    this.startAtMs = nowMs;
    this.lastActionMs = nowMs;
    this.lineBuffer = "";
    this.actions = [];
  }

  public recordUserInput(data: string, nowMs = Date.now()): void {
    if (!this.active || !data) return;

    // Strip ANSI CSI / SS3 / OSC / 2-byte ESC sequences so arrow keys, Home/End, F-keys, etc.
    // never leave stray sequence fragments (e.g. "[A") in lineBuffer.
    const cleaned = data
      .replace(/\x1b\[[0-9;?<=>]*[ -/]*[@-~]/g, "")
      .replace(/\x1bO[ -/]*[@-~]/g, "")
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
      .replace(/\x1b[@-Z\\-_]/g, "");

    for (const ch of cleaned) {
      if (ch === "\x03" || ch === "\x15") {
        // Ctrl+C / Ctrl+U clears the current line
        this.lineBuffer = "";
      } else if (ch === "\r" || ch === "\n") {
        const cmd = this.lineBuffer;
        this.lineBuffer = "";
        if (cmd.trim().length > 0) {
          this.pushCommand(cmd, nowMs);
        }
      } else if (ch === "\x7f" || ch === "\b") {
        this.lineBuffer = this.lineBuffer.slice(0, -1);
      } else if (ch.charCodeAt(0) >= 32) {
        this.lineBuffer += ch;
      }
    }
  }

  public recordSubmittedCommand(text: string, nowMs = Date.now()): void {
    if (!this.active || !text) return;
    const cleaned = stripAnsiCodes(text);
    const lines = cleaned.split(/\r?\n/);
    for (const line of lines) {
      const cmd = line.trim();
      if (cmd.length > 0) {
        this.pushCommand(cmd, nowMs);
      }
    }
    this.lineBuffer = "";
  }

  public stop(): RecordedAction[] {
    if (this.lineBuffer.trim().length > 0) {
      this.pushCommand(this.lineBuffer, Date.now());
    }
    this.lineBuffer = "";
    this.active = false;
    return this.getActions();
  }

  public toScript(scriptName = "Recorded Script"): string {
    const lines = [
      `// ${scriptName}`,
      `// Recorded ${this.actions.length} command(s)`,
    ];
    for (const action of this.actions) {
      if (action.delaySincePrevMs >= 100) {
        lines.push(`await screen.sleep(${Math.min(action.delaySincePrevMs, 10000)});`);
      }
      lines.push(`await screen.send(${JSON.stringify(action.data)});`);
    }
    return lines.join("\n");
  }

  public toSendExpectRules(defaultExpect = "$"): SendExpectRule[] {
    return this.actions.map((action, idx) => ({
      id: `rec-rule-${idx + 1}-${action.id}`,
      expect: action.expectHint || defaultExpect,
      send: action.data,
      sendEnter: true,
      delayMs: Math.min(Math.max(action.delaySincePrevMs, 0), 5000),
      once: true,
    }));
  }

  public toMacroSequence(name = "Recorded Macro"): MacroSequence {
    const now = Date.now();
    return {
      id: `macro-rec-${now}`,
      name,
      scope: "all",
      loopCount: 1,
      steps: this.actions.map((action, idx) => ({
        id: `step-${idx + 1}-${action.id}`,
        enabled: true,
        name: action.data.slice(0, 24) || `Step ${idx + 1}`,
        type: "ascii",
        payload: action.data,
        suffix: "\r",
        delayMs: Math.min(Math.max(action.delaySincePrevMs, 50), 5000),
      })),
      createdAt: now,
      updatedAt: now,
    };
  }

  private pushCommand(cmd: string, nowMs: number): void {
    const delaySincePrevMs = this.actions.length === 0 ? 0 : Math.max(0, nowMs - this.lastActionMs);
    this.lastActionMs = nowMs;
    this.actions.push({
      id: `act-${this.actions.length + 1}-${nowMs - this.startAtMs}`,
      timestampMs: nowMs,
      kind: "command",
      data: cmd,
      delaySincePrevMs,
    });
  }
}
