import { interpolateMacros, stripAnsiCodes } from "@/lib/send-expect-matcher";
import {
  OUTPUT_BUS_FLOOD_THRESHOLD_CHARS,
  registerOutputObserver,
  type OutputChunkEvent,
} from "@/lib/terminal-output-bus";
import type { LogonScriptContext } from "@/types";
import type { TriggerRule } from "@/types/automation";

/**
 * 检测灾难性回溯正则（ReDoS）：
 * - 量词修饰的分组内部仍含量词，如 (a+)+、(a*)*、(\w+)+、(a|aa)+
 * - 反向引用配合量词，如 (a+)\1+
 * 采用保守的启发式：宁可拒绝少量安全的复杂模式，也不让主线程被冻结。
 */
function isCatastrophicRegex(source: string): boolean {
  // 逐个匹配 ( ... ) 后紧跟量词 (+ * {n,}) 的结构，检查括号内部是否也含量词
  const quantifiedGroup = /\(([^()]*[+*][^()]*)\)\s*[+*{]/g;
  if (quantifiedGroup.test(source)) return true;
  // 反向引用 + 量词
  if (/\\[1-9]\s*[+*{]/.test(source)) return true;
  return false;
}

export interface TriggerMatchEvent {
  rule: TriggerRule;
  matchedText: string;
  resolvedPayload: string;
  timestampMs: number;
}

export interface TriggerEngineOptions {
  termId: string;
  rules: TriggerRule[];
  getContext?: () => LogonScriptContext;
  onAction: (event: TriggerMatchEvent) => void;
  onCircuitBreak?: (reason: string) => void;
  onCircuitRecover?: () => void;
}

const DEFAULT_COOLDOWN_MS = 100;
const MAX_TRIGGERS_PER_SEC = 50;
const CIRCUIT_BREAK_COOLDOWN_MS = 1000;
const BUFFER_MAX_LEN = 4096;

/**
 * 终端实时触发器引擎（基于 Wave 0 OutputStreamObserver 总线）
 *
 * - 支持文本子串 / `/regex/flags` 正则匹配
 * - 内置规则级冷却（默认 100ms）与 >2MB/s 或超频断路器
 * - 支持 Send Text / Toast / Bell / Marker / Highlight / Stop 动作
 */
export class TriggerEngine {
  private termId: string;
  private rules: TriggerRule[] = [];
  private getContext?: () => LogonScriptContext;
  private onAction: (event: TriggerMatchEvent) => void;
  private onCircuitBreak?: (reason: string) => void;
  private onCircuitRecover?: () => void;

  private unregister: (() => void) | null = null;
  private cleanBuffer = "";
  private bufferBaseOffset = 0;
  private consumedOffsetByRule = new Map<string, number>();
  private ruleSignatures = new Map<string, string>();
  private lastFiredByRule = new Map<string, number>();

  private trafficWindowStart = 0;
  private trafficChars = 0;
  private firesInWindow = 0;
  private circuitOpenUntil = 0;
  private circuitRecoverTimer: ReturnType<typeof setTimeout> | null = null;
  private compiledCache = new Map<string, RegExp | null>();

  constructor(options: TriggerEngineOptions) {
    this.termId = options.termId;
    this.getContext = options.getContext;
    this.onAction = options.onAction;
    this.onCircuitBreak = options.onCircuitBreak;
    this.onCircuitRecover = options.onCircuitRecover;
    this.setRules(options.rules);
  }

  /** 宿主 termId / 上下文变化时原地更新，避免重建整个触发器导致录制与运行状态丢失 */
  public updateContext(termId: string, getContext?: () => LogonScriptContext): void {
    if (this.termId === termId && this.getContext === getContext) return;
    const wasRunning = Boolean(this.unregister);
    if (wasRunning) this.stop();
    this.termId = termId;
    this.getContext = getContext;
    // 清理与新 term 无关的缓冲与消费游标，防止旧会话输出被误判
    this.cleanBuffer = "";
    this.bufferBaseOffset = 0;
    this.consumedOffsetByRule.clear();
    this.lastFiredByRule.clear();
    if (wasRunning) this.start();
  }

  public setRules(rules: TriggerRule[]): void {
    this.rules = rules.filter((r) => r.enabled && Boolean(r.pattern));
    this.compiledCache.clear();
    const bufferEndOffset = this.bufferBaseOffset + this.cleanBuffer.length;
    const nextSignatures = new Map<string, string>();
    const nextConsumed = new Map<string, number>();
    for (const rule of this.rules) {
      const sig = `${rule.pattern}|${Boolean(rule.isRegex)}|${Boolean(rule.caseSensitive)}`;
      nextSignatures.set(rule.id, sig);
      if (this.ruleSignatures.get(rule.id) === sig && this.consumedOffsetByRule.has(rule.id)) {
        nextConsumed.set(rule.id, this.consumedOffsetByRule.get(rule.id)!);
      } else {
        nextConsumed.set(rule.id, bufferEndOffset);
      }
    }
    this.ruleSignatures = nextSignatures;
    this.consumedOffsetByRule = nextConsumed;
  }

  public start(): () => void {
    if (this.unregister) return this.unregister;
    this.unregister = registerOutputObserver({
      id: `automation-triggers:${this.termId}`,
      priority: 45,
      bypassThrottle: false,
      throttleMs: 100,
      onChunk: (event) => this.handleChunk(event),
    });
    return () => this.stop();
  }

  public stop(): void {
    if (this.unregister) {
      this.unregister();
      this.unregister = null;
    }
    if (this.circuitRecoverTimer) {
      clearTimeout(this.circuitRecoverTimer);
      this.circuitRecoverTimer = null;
    }
    this.circuitOpenUntil = 0;
    this.cleanBuffer = "";
    this.bufferBaseOffset = 0;
    this.consumedOffsetByRule.clear();
    this.ruleSignatures.clear();
    this.lastFiredByRule.clear();
  }

  public handleChunk(event: OutputChunkEvent): void {
    if (event.termId !== this.termId || this.rules.length === 0) return;

    const now = event.timestampMs || Date.now();
    if (this.circuitOpenUntil > 0) {
      if (now < this.circuitOpenUntil) {
        return;
      }
      this.resetCircuit();
    }

    if (now - this.trafficWindowStart >= 1000) {
      this.trafficWindowStart = now;
      this.trafficChars = 0;
      this.firesInWindow = 0;
    }

    this.trafficChars += event.rawChunk.length;
    if (this.trafficChars > OUTPUT_BUS_FLOOD_THRESHOLD_CHARS) {
      this.tripCircuit(now, "Output flood > 2MB/s");
      return;
    }

    const stripped = stripAnsiCodes(event.rawChunk);
    if (!stripped) return;

    this.cleanBuffer += stripped;
    if (this.cleanBuffer.length > BUFFER_MAX_LEN) {
      const overflow = this.cleanBuffer.length - BUFFER_MAX_LEN;
      this.cleanBuffer = this.cleanBuffer.slice(overflow);
      this.bufferBaseOffset += overflow;
    }
    const bufferEndOffset = this.bufferBaseOffset + this.cleanBuffer.length;

    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i];
      const consumedOffset = this.consumedOffsetByRule.get(rule.id) ?? 0;
      const startIdx = Math.max(0, consumedOffset - this.bufferBaseOffset);
      const slice = startIdx > 0 ? this.cleanBuffer.slice(startIdx) : this.cleanBuffer;
      if (!slice) continue;

      const match = this.matchRuleInSlice(rule, slice);
      if (!match) continue;

      // Advance past the matched span so unrelated subsequent output never re-triggers stale buffer text.
      const nextConsumed = this.bufferBaseOffset + startIdx + Math.max(1, match.matchEnd);
      this.consumedOffsetByRule.set(rule.id, nextConsumed);

      const cooldown = Math.max(0, rule.cooldownMs ?? DEFAULT_COOLDOWN_MS);
      const lastFired = this.lastFiredByRule.get(rule.id) ?? 0;
      if (cooldown > 0 && now - lastFired < cooldown) {
        continue;
      }

      this.firesInWindow += 1;
      if (this.firesInWindow > MAX_TRIGGERS_PER_SEC) {
        this.tripCircuit(now, `Trigger frequency exceeded ${MAX_TRIGGERS_PER_SEC}/sec`);
        return;
      }

      this.lastFiredByRule.set(rule.id, now);
      const ctx = this.getContext?.();
      let payload = rule.payload ? interpolateMacros(rule.payload, ctx) : "";
      if (rule.actionType === "send_text" && rule.appendEnter && payload && !payload.endsWith("\r") && !payload.endsWith("\n")) {
        payload = `${payload}\r`;
      }

      this.onAction({
        rule,
        matchedText: match.matchedText,
        resolvedPayload: payload,
        timestampMs: now,
      });

      if (rule.stopProcessing) {
        for (let j = i + 1; j < this.rules.length; j++) {
          const laterRule = this.rules[j];
          const prev = this.consumedOffsetByRule.get(laterRule.id) ?? 0;
          if (bufferEndOffset > prev) {
            this.consumedOffsetByRule.set(laterRule.id, bufferEndOffset);
          }
        }
        break;
      }
    }
  }

  private resetCircuit(): void {
    if (this.circuitRecoverTimer) {
      clearTimeout(this.circuitRecoverTimer);
      this.circuitRecoverTimer = null;
    }
    this.circuitOpenUntil = 0;
    this.onCircuitRecover?.();
  }

  private tripCircuit(now: number, reason: string): void {
    this.circuitOpenUntil = now + CIRCUIT_BREAK_COOLDOWN_MS;
    if (this.circuitRecoverTimer) {
      clearTimeout(this.circuitRecoverTimer);
    }
    this.circuitRecoverTimer = setTimeout(() => {
      this.circuitRecoverTimer = null;
      if (this.circuitOpenUntil > 0) {
        this.circuitOpenUntil = 0;
        this.onCircuitRecover?.();
      }
    }, CIRCUIT_BREAK_COOLDOWN_MS);
    this.onCircuitBreak?.(reason);
  }

  private matchRuleInSlice(
    rule: TriggerRule,
    slice: string,
  ): { matchedText: string; matchEnd: number } | null {
    if (rule.isRegex || (rule.pattern.startsWith("/") && rule.pattern.lastIndexOf("/") > 0)) {
      const re = this.getCompiledRegex(rule);
      if (!re) return null;
      re.lastIndex = 0;
      const m = re.exec(slice);
      if (!m) return null;
      return {
        matchedText: m[0],
        matchEnd: m.index + m[0].length,
      };
    }

    if (rule.caseSensitive) {
      const idx = slice.indexOf(rule.pattern);
      return idx >= 0
        ? { matchedText: rule.pattern, matchEnd: idx + rule.pattern.length }
        : null;
    }

    const lowerPat = rule.pattern.toLowerCase();
    const idx = slice.toLowerCase().indexOf(lowerPat);
    return idx >= 0
      ? { matchedText: slice.slice(idx, idx + rule.pattern.length), matchEnd: idx + rule.pattern.length }
      : null;
  }

  private getCompiledRegex(rule: TriggerRule): RegExp | null {
    if (this.compiledCache.has(rule.id)) {
      return this.compiledCache.get(rule.id) ?? null;
    }
    let compiled: RegExp | null = null;
    try {
      let source = rule.pattern;
      let flags = rule.caseSensitive ? "" : "i";
      if (source.startsWith("/") && source.lastIndexOf("/") > 0) {
        const lastSlash = source.lastIndexOf("/");
        const explicitFlags = source.slice(lastSlash + 1);
        source = source.slice(1, lastSlash);
        flags = explicitFlags || flags;
      }
      // ReDoS 防护：拒绝过长的模式与「量词组内再含量词」的灾难性回溯模式（如 (a+)+、(a*)*）。
      // 触发器正则在 UI 主线程执行，一条恶意/误配模式即可冻结窗口，故在编译期直接拦截。
      if (source.length <= 200 && !isCatastrophicRegex(source)) {
        compiled = new RegExp(source, flags);
      }
    } catch {
      compiled = null;
    }
    this.compiledCache.set(rule.id, compiled);
    return compiled;
  }
}
