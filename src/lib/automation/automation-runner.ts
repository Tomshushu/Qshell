import { resolveScriptParameters } from "@/lib/send-expect-matcher";
import type {
  AutomationRuntimeSnapshot,
  AutomationScriptItem,
  AutomationSessionHost,
  MacroSequence,
  RecordedExportFormat,
  TriggerRule,
} from "@/types/automation";
import { ActionRecorder, MacroRunner } from "./macro-runner";
import { ScriptSandbox } from "./script-sandbox";
import {
  loadAutomationScripts,
  loadMacroSequences,
  loadTriggerRules,
  saveAutomationScripts,
  saveMacroSequences,
  saveTriggerRules,
} from "./storage";
import { TriggerEngine, type TriggerMatchEvent } from "./trigger-engine";

interface SessionAutomationState {
  host: AutomationSessionHost;
  triggerEngine: TriggerEngine;
  activeSandbox: ScriptSandbox | null;
  activeMacro: MacroRunner | null;
  recorder: ActionRecorder;
  runningKind: "script" | "macro" | null;
  runningName: string | null;
  circuitBreakerTripped: boolean;
  lastError: string | null;
}

const EMPTY_SNAPSHOT: AutomationRuntimeSnapshot = {
  tabId: "",
  runningKind: null,
  runningName: null,
  isRecording: false,
  recordedCount: 0,
  activeTriggerCount: 0,
  circuitBreakerTripped: false,
  lastError: null,
};

/**
 * 会话级自动化编排中心 (AutomationRunner)
 *
 * 统一托管：
 * - TriggerEngine (P1-01): 基于 OutputStreamObserver 的实时触发响应
 * - ScriptSandbox (P1-16 + P1-06): Web Worker 隔离手动执行/停止 JS 自动化脚本
 * - MacroRunner (P1-05): 跨协议通用宏序列执行
 * - ActionRecorder (P1-04): 输入动作录制与脚本/规则导出
 */
class AutomationRegistry {
  private sessions = new Map<string, SessionAutomationState>();
  private listeners = new Set<() => void>();
  private snapshotCache = new Map<string, AutomationRuntimeSnapshot>();
  /** 每个 tabId 当前挂载的 host effect 数量（切换终端时会出现 1 -> 0 -> 1） */
  private hostRefs = new Map<string, number>();

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public registerHost(host: AutomationSessionHost): () => void {
    const tabId = host.tabId;
    this.hostRefs.set(tabId, (this.hostRefs.get(tabId) ?? 0) + 1);
    const existing = this.sessions.get(tabId);
    if (existing) {
      // termId 变化（切换活动终端）时只更新触发器上下文、保留 recorder 与运行中的脚本/宏，
      // 避免切换标签就静默丢失录制内容并中止自动化。
      existing.host = host;
      existing.triggerEngine.updateContext(host.termId, host.getContext);
      this.notify(tabId);
      return this.createHostRelease(tabId);
    }

    const rules = loadTriggerRules();
    const state: SessionAutomationState = {
      host,
      triggerEngine: new TriggerEngine({
        termId: host.termId,
        rules,
        getContext: host.getContext,
        onAction: (ev) => this.handleTriggerAction(host.tabId, ev),
        onCircuitBreak: (reason) => {
          const cur = this.sessions.get(host.tabId);
          if (cur) {
            cur.circuitBreakerTripped = true;
            cur.lastError = reason;
            this.notify(host.tabId);
          }
          (this.sessions.get(host.tabId)?.host ?? host).toast(`触发器过载保护已暂停：${reason}`, "warning");
        },
        onCircuitRecover: () => {
          const cur = this.sessions.get(host.tabId);
          if (cur) {
            cur.circuitBreakerTripped = false;
            // 断路器恢复后同步清除过期错误，否则 UI 告警条因 lastError 仍常驻。
            cur.lastError = null;
            this.notify(host.tabId);
          }
        },
      }),
      activeSandbox: null,
      activeMacro: null,
      recorder: new ActionRecorder(),
      runningKind: null,
      runningName: null,
      circuitBreakerTripped: false,
      lastError: null,
    };

    state.triggerEngine.start();
    this.sessions.set(tabId, state);
    this.notify(tabId);

    return this.createHostRelease(tabId);
  }

  /**
   * 释放一次 host 挂载。React 切换活动终端时会在同一个 passive-effect flush 内
   * 先执行旧 cleanup、再执行新 setup，如果这里立刻销毁会话，下面「保留录制/脚本」
   * 的 existing 分支就永远不会生效。因此引用计数归零后延迟到微任务再判定：
   * 只要新的 registerHost 及时把引用补回，会话就继续存活。
   */
  private createHostRelease(tabId: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = (this.hostRefs.get(tabId) ?? 1) - 1;
      if (next > 0) {
        this.hostRefs.set(tabId, next);
        return;
      }
      this.hostRefs.delete(tabId);
      queueMicrotask(() => {
        if (this.hostRefs.has(tabId)) return;
        const cur = this.sessions.get(tabId);
        if (!cur) return;
        cur.triggerEngine.stop();
        cur.activeSandbox?.stop();
        cur.activeMacro?.stop();
        this.sessions.delete(tabId);
        this.snapshotCache.delete(tabId);
        this.notify(tabId);
      });
    };
  }

  public updateHostSessionId(tabId: string, termId: string, sessionId?: string): void {
    const session = this.sessions.get(tabId);
    if (!session || session.host.termId !== termId) return;
    if (session.host.sessionId === sessionId) return;
    session.host.sessionId = sessionId;
    this.notify(tabId);
  }

  public refreshTriggers(rules?: TriggerRule[]): void {
    const nextRules = rules ?? loadTriggerRules();
    if (rules) saveTriggerRules(rules);
    for (const [tabId, session] of this.sessions) {
      session.triggerEngine.setRules(nextRules);
      session.circuitBreakerTripped = false;
      session.lastError = null;
      this.notify(tabId);
    }
  }

  public recordUserInput(tabId: string, data: string): void {
    const session = this.sessions.get(tabId);
    if (!session || !session.recorder.isRecording()) return;
    session.recorder.recordUserInput(data);
    this.notify(tabId);
  }

  public recordSubmittedCommand(tabId: string, text: string): void {
    const session = this.sessions.get(tabId);
    if (!session || !session.recorder.isRecording()) return;
    session.recorder.recordSubmittedCommand(text);
    this.notify(tabId);
  }

  public startRecording(tabId: string): boolean {
    const session = this.sessions.get(tabId);
    if (!session) return false;
    session.recorder.start();
    session.lastError = null;
    this.notify(tabId);
    return true;
  }

  public stopRecording(tabId: string, exportAs: "script" | "macro" | "rules", name = "Recorded Automation"): RecordedExportFormat | null {
    const session = this.sessions.get(tabId);
    if (!session) return null;
    session.recorder.stop();

    let result: RecordedExportFormat;
    if (exportAs === "rules") {
      result = { kind: "rules", rules: session.recorder.toSendExpectRules() };
    } else if (exportAs === "macro") {
      const seq = session.recorder.toMacroSequence(name);
      const macros = loadMacroSequences();
      saveMacroSequences([seq, ...macros]);
      result = { kind: "macro", sequence: seq };
    } else {
      const code = session.recorder.toScript(name);
      const item: AutomationScriptItem = {
        id: `script-rec-${Date.now()}`,
        name,
        code,
        updatedAt: Date.now(),
      };
      const scripts = loadAutomationScripts();
      saveAutomationScripts([item, ...scripts]);
      result = { kind: "script", name, code };
    }

    this.notify(tabId);
    return result;
  }

  public async runScript(
    tabId: string,
    script: AutomationScriptItem,
    paramOverrides?: Record<string, string>,
  ): Promise<void> {
    const session = this.sessions.get(tabId);
    if (!session) {
      throw new Error("当前会话未就绪");
    }
    this.stopExecution(tabId);

    const baseCtx = session.host.getContext();
    const resolved = resolveScriptParameters(script.parameters, {
      ...(baseCtx.params || {}),
      ...(paramOverrides || {}),
    });

    if (resolved.missingRequired.length > 0) {
      if (!session.host.prompt) {
        throw new Error(
          `已取消运行（缺少必填参数 ${resolved.missingRequired.map((p) => p.label || p.name).join(", ")}）`,
        );
      }
      for (const reqParam of resolved.missingRequired) {
        const entered = await session.host.prompt(
          `请输入脚本参数 "${reqParam.label || reqParam.name}"`,
          reqParam.defaultValue || "",
        );
        if (entered === null) {
          throw new Error(`已取消运行（缺少必填参数 ${reqParam.name}）`);
        }
        resolved.params[reqParam.name] = entered;
      }
    }

    const sandbox = new ScriptSandbox({
      termId: session.host.termId,
      context: { ...baseCtx, params: resolved.params },
      sendFn: session.host.sendText,
      dialogCallbacks: {
        alert: session.host.alert,
        prompt: session.host.prompt,
        toast: session.host.toast,
      },
    });

    session.activeSandbox = sandbox;
    session.runningKind = "script";
    session.runningName = script.name;
    session.lastError = null;
    this.notify(tabId);

    try {
      await sandbox.run(script.code);
      session.host.toast(`脚本「${script.name}」执行完成`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("aborted")) {
        session.lastError = msg;
        session.host.toast(`脚本执行失败: ${msg}`, "error");
      }
    } finally {
      if (session.activeSandbox === sandbox) {
        session.activeSandbox = null;
        session.runningKind = null;
        session.runningName = null;
        this.notify(tabId);
      }
    }
  }

  public async runMacro(
    tabId: string,
    sequence: MacroSequence,
    paramOverrides?: Record<string, string>,
  ): Promise<void> {
    const session = this.sessions.get(tabId);
    if (!session) {
      throw new Error("当前会话未就绪");
    }
    this.stopExecution(tabId);

    const runner = new MacroRunner();
    const baseCtx = session.host.getContext();
    const ctx = paramOverrides
      ? { ...baseCtx, params: { ...(baseCtx.params || {}), ...paramOverrides } }
      : baseCtx;

    session.activeMacro = runner;
    session.runningKind = "macro";
    session.runningName = sequence.name;
    session.lastError = null;
    this.notify(tabId);

    try {
      await runner.run(sequence, {
        context: ctx,
        sendText: session.host.sendText,
        sendBytes: session.host.sendBytes,
      });
      session.host.toast(`宏序列「${sequence.name}」执行完成`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("aborted")) {
        session.lastError = msg;
        session.host.toast(`宏序列执行失败: ${msg}`, "error");
      }
    } finally {
      if (session.activeMacro === runner) {
        session.activeMacro = null;
        session.runningKind = null;
        session.runningName = null;
        this.notify(tabId);
      }
    }
  }

  public stopExecution(tabId: string): void {
    const session = this.sessions.get(tabId);
    if (!session) return;
    session.activeSandbox?.stop();
    session.activeSandbox = null;
    session.activeMacro?.stop();
    session.activeMacro = null;
    if (session.runningKind !== null) {
      session.runningKind = null;
      session.runningName = null;
      this.notify(tabId);
    }
  }

  public getSnapshot(tabId: string): AutomationRuntimeSnapshot {
    const cached = this.snapshotCache.get(tabId);
    if (cached) return cached;

    const session = this.sessions.get(tabId);
    if (!session) {
      return EMPTY_SNAPSHOT;
    }

    const activeTriggerCount = loadTriggerRules().filter((r) => r.enabled).length;
    const next: AutomationRuntimeSnapshot = {
      tabId,
      runningKind: session.runningKind,
      runningName: session.runningName,
      isRecording: session.recorder.isRecording(),
      recordedCount: session.recorder.getActions().length,
      activeTriggerCount,
      circuitBreakerTripped: session.circuitBreakerTripped,
      lastError: session.lastError,
    };
    this.snapshotCache.set(tabId, next);
    return next;
  }

  private handleTriggerAction(tabId: string, ev: TriggerMatchEvent): void {
    const session = this.sessions.get(tabId);
    if (!session) return;
    const { rule, resolvedPayload } = ev;

    switch (rule.actionType) {
      case "send_text":
        if (resolvedPayload) {
          void session.host.sendText(resolvedPayload).catch((err) => {
            console.error("[Trigger send_text error]:", err);
          });
        }
        break;
      case "toast":
        session.host.toast(resolvedPayload || `触发器命中: ${rule.name}`, "info");
        break;
      case "bell":
        session.host.ringBell?.();
        break;
      case "marker":
        session.host.addMarker?.(resolvedPayload || rule.name);
        break;
      case "highlight":
        session.host.toast(`[高亮标记] ${rule.name}: ${ev.matchedText}`, "warning");
        break;
      case "stop":
        this.stopExecution(tabId);
        session.host.toast(`触发器「${rule.name}」已停止当前自动化任务`, "warning");
        break;
    }
  }

  private notify(tabId: string): void {
    this.snapshotCache.delete(tabId);
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const automationRegistry = new AutomationRegistry();
