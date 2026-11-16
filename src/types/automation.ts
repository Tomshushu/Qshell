import type { LogonScriptContext, ScriptParam, SendExpectRule } from "@/types";
import type { SerialChecksumType } from "@/lib/serial-checksum";

export type TriggerActionType =
  | "send_text"
  | "toast"
  | "bell"
  | "marker"
  | "highlight"
  | "stop";

export interface TriggerRule {
  id: string;
  name: string;
  enabled: boolean;
  pattern: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  /** 同一规则最小触发冷却时间（毫秒，默认 100ms） */
  cooldownMs?: number;
  actionType: TriggerActionType;
  /** send_text / toast / highlight 载荷文本 */
  payload?: string;
  appendEnter?: boolean;
  /** 命中该规则后是否停止继续匹配后续规则 */
  stopProcessing?: boolean;
}

export interface MacroStep {
  id: string;
  enabled: boolean;
  name: string;
  type: "ascii" | "hex";
  payload: string;
  suffix: "\r\n" | "\n" | "\r" | "";
  delayMs: number;
  checksumType?: SerialChecksumType;
}

export interface MacroSequence {
  id: string;
  name: string;
  scope?: "all" | "ssh" | "serial" | "local" | "telnet";
  loopCount?: number;
  steps: MacroStep[];
  createdAt: number;
  updatedAt: number;
}

export interface AutomationScriptItem {
  id: string;
  name: string;
  description?: string;
  code: string;
  parameters?: ScriptParam[];
  updatedAt: number;
}

export interface RecordedAction {
  id: string;
  timestampMs: number;
  kind: "command" | "wait";
  data: string;
  delaySincePrevMs: number;
  expectHint?: string;
}

export interface AutomationSessionHost {
  tabId: string;
  termId: string;
  sessionId?: string;
  protocol?: string;
  getContext: () => LogonScriptContext;
  sendText: (text: string) => Promise<void>;
  sendBytes?: (bytes: Uint8Array) => Promise<boolean>;
  toast: (message: string, variant?: "info" | "success" | "warning" | "error") => void;
  ringBell?: () => void;
  addMarker?: (label: string) => void;
  prompt?: (message: string, defaultValue?: string) => Promise<string | null>;
  alert?: (message: string) => Promise<void>;
}

export interface AutomationRuntimeSnapshot {
  tabId: string;
  runningKind: "script" | "macro" | null;
  runningName: string | null;
  isRecording: boolean;
  recordedCount: number;
  activeTriggerCount: number;
  circuitBreakerTripped: boolean;
  lastError: string | null;
}

export type RecordedExportFormat =
  | { kind: "script"; name: string; code: string }
  | { kind: "rules"; rules: SendExpectRule[] }
  | { kind: "macro"; sequence: MacroSequence };
