import type { SendExpectRule, LogonScriptsConfig, LogonScriptContext, ScriptParam } from "@/types";
export type { LogonScriptContext, ScriptParam };

/**
 * 去除 ANSI 控制序列与光标/标题转义码，还原纯文本供规则匹配
 */
export function stripAnsiCodes(input: string): string {
  if (!input) return "";
  return input
    // CSI codes: \x1b[ ... letter
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    // OSC codes: \x1b] ... BEL or ST
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, "")
    // 2-byte escape sequences
    .replace(/\x1b[@-Z\\-_]/g, "");
}

/**
 * 宏变量替换引擎 (对标 Xshell %u, %h, %p 等)
 * - %u: 用户名 (username)
 * - %h: 主机 (host)
 * - %p: 端口 (port)
 * - %n: 服务器名 (serverName)
 * - %d: 当前日期 (YYYY-MM-DD)
 * - %t: 当前时间 (HH:MM:SS)
 * - %P{name}: 显式脚本参数值 (来自 context.params[name])
 * - %%: 转义百分号 %
 */
export function interpolateMacros(input: string, context?: LogonScriptContext): string {
  if (!input) return "";
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 8);

  return input.replace(/%(?:P\{([a-zA-Z0-9_.-]+)\}|([uhpndts%]))/g, (match, paramName: string | undefined, code: string | undefined) => {
    if (paramName !== undefined) {
      return context?.params?.[paramName] ?? "";
    }
    switch (code) {
      case "u":
        return context?.username ?? "";
      case "h":
        return context?.host ?? "";
      case "p":
        return String(context?.port ?? 22);
      case "n":
      case "s":
        return context?.serverName ?? "";
      case "d":
        return dateStr;
      case "t":
        return timeStr;
      case "%":
        return "%";
      default:
        return match;
    }
  });
}

/**
 * 解析并合并脚本参数清单与覆盖值，同时收集需要日志脱敏的 secret 值
 */
export function resolveScriptParameters(
  parameters?: ScriptParam[],
  overrides?: Record<string, string>
): { params: Record<string, string>; secretValues: string[]; missingRequired: ScriptParam[] } {
  const params: Record<string, string> = { ...(overrides || {}) };
  const secretValues: string[] = [];
  const missingRequired: ScriptParam[] = [];

  if (Array.isArray(parameters)) {
    for (const p of parameters) {
      const name = p.name?.trim();
      if (!name) continue;
      const val = params[name] ?? p.defaultValue ?? "";
      params[name] = val;
      if (p.secret && val) {
        secretValues.push(val);
      }
      if (p.required && !val) {
        missingRequired.push(p);
      }
    }
  }

  return { params, secretValues, missingRequired };
}

/**
 * 将字符串中的敏感参数值替换为脱敏占位符 "******"
 */
export function redactSecretValues(text: string, secretValues: string[]): string {
  if (!text || secretValues.length === 0) return text;
  let result = text;
  const sorted = [...new Set(secretValues.filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const secret of sorted) {
    result = result.split(secret).join("******");
  }
  return result;
}

export type SendStep =
  | { type: "send"; text: string }
  | { type: "pause"; ms: number };

/**
 * 解析发送字符串为分步执行计划 (支持 \p 延时与标准转义符)
 * - 规则级延时 delayMs 会作为首个 pause 步骤加入
 * - \p 或 \p1000 解析为暂停 1000 毫秒（\p500 为暂停 500 毫秒）
 * - \r, \n, \t, \b, \\ 进行标准字符转义
 * - 若 appendEnter !== false，在序列末尾补发回车 \r
 */
export function parseSendSteps(
  rawSend: string,
  delayMs?: number,
  appendEnter: boolean = true
): SendStep[] {
  const steps: SendStep[] = [];

  // 1. 规则级前置延时（等待远端 TTY 缓冲就绪）
  if (delayMs && delayMs > 0) {
    steps.push({ type: "pause", ms: delayMs });
  }

  if (!rawSend && !appendEnter) {
    return steps;
  }

  let curText = "";
  // 正则拆分 token: \p\d*, \r, \n, \t, \b, \\, 或普通文本
  const tokenRegex = /(\\p\d*|\\r|\\n|\\t|\\b|\\\\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(rawSend)) !== null) {
    if (match.index > lastIndex) {
      curText += rawSend.slice(lastIndex, match.index);
    }
    const token = match[0];
    if (token.startsWith("\\p")) {
      if (curText) {
        steps.push({ type: "send", text: curText });
        curText = "";
      }
      const digits = token.slice(2);
      const ms = digits ? parseInt(digits, 10) : 1000;
      steps.push({ type: "pause", ms: Math.max(10, ms) });
    } else if (token === "\\r") {
      curText += "\r";
    } else if (token === "\\n") {
      curText += "\n";
    } else if (token === "\\t") {
      curText += "\t";
    } else if (token === "\\b") {
      curText += "\b";
    } else if (token === "\\\\") {
      curText += "\\";
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < rawSend.length) {
    curText += rawSend.slice(lastIndex);
  }

  if (appendEnter) {
    if (!curText.endsWith("\r")) {
      curText += "\r";
    }
  }

  if (curText) {
    steps.push({ type: "send", text: curText });
  }

  return steps;
}

/**
 * 合并全局/分组默认配置与服务器独立配置
 */
export function mergeGlobalLogonConfig(
  serverConfig?: LogonScriptsConfig | null,
  globalConfig?: LogonScriptsConfig | null
): LogonScriptsConfig | null {
  if (!serverConfig && !globalConfig) return null;
  if (!serverConfig) return globalConfig?.enabled ? globalConfig : null;
  if (!serverConfig.inheritGlobal || !globalConfig?.enabled) return serverConfig;

  // 继承模式：以全局规则为基础优先注入，紧接着追加服务器特有规则
  const combinedRules = [...(globalConfig.rules || []), ...(serverConfig.rules || [])];
  const mergedParamsMap = new Map<string, ScriptParam>();
  for (const p of globalConfig.parameters || []) {
    if (p.name?.trim()) mergedParamsMap.set(p.name.trim(), p);
  }
  for (const p of serverConfig.parameters || []) {
    if (p.name?.trim()) mergedParamsMap.set(p.name.trim(), p);
  }
  const mergedParameters = Array.from(mergedParamsMap.values());
  return {
    ...globalConfig,
    ...serverConfig,
    enabled: true,
    rules: combinedRules,
    parameters: mergedParameters.length > 0 ? mergedParameters : undefined,
    mode: serverConfig.mode || globalConfig.mode || "rules",
    timeoutPolicy: serverConfig.timeoutPolicy || globalConfig.timeoutPolicy || "ignore",
  };
}

export interface SendExpectExecutionState {
  config: LogonScriptsConfig;
  rules: SendExpectRule[];
  pendingRuleIds: Set<string>;
  buffer: string;
  triggeredCount: number;
  lastTriggeredAt: number;
  timeoutTimers: Map<string, ReturnType<typeof setTimeout>>;
  context?: LogonScriptContext;
  scriptRunner?: ProgrammableScriptController | null;
}

export type TimeoutCallback = (
  rule: SendExpectRule,
  action: "ignore" | "warn" | "disconnect"
) => void;

/**
 * 根据服务器配置与全局配置初始化状态机
 */
export function createSendExpectState(
  configInput?: string | LogonScriptsConfig | null,
  context?: LogonScriptContext,
  onTimeout?: TimeoutCallback,
  globalConfig?: LogonScriptsConfig | null
): SendExpectExecutionState | null {
  if (!configInput && !globalConfig?.enabled) return null;

  try {
    let parsed: LogonScriptsConfig;
    if (!configInput) {
      const merged = mergeGlobalLogonConfig(null, globalConfig);
      if (!merged) return null;
      parsed = merged;
    } else {
      parsed =
        typeof configInput === "string" ? JSON.parse(configInput) : configInput;

      // 若配置了继承全局规则，进行合并
      if (parsed.inheritGlobal && globalConfig) {
        const merged = mergeGlobalLogonConfig(parsed, globalConfig);
        if (merged) parsed = merged;
      }
    }

    if (!parsed.enabled) return null;

    const timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();

    // 模式 1：声明式规则列表 (Rules Mode)
    if (parsed.mode !== "script") {
      if (!Array.isArray(parsed.rules) || parsed.rules.length === 0) {
        return null;
      }
      const validRules = parsed.rules.filter(
        (r) => r.expect && r.expect.trim().length > 0 && r.send !== undefined
      );
      if (validRules.length === 0) return null;

      // 注册超时定时器
      if (onTimeout) {
        for (const rule of validRules) {
          const timeoutMs = (rule.timeoutSec || 30) * 1000;
          const action = rule.onTimeoutAction || parsed.timeoutPolicy || "ignore";
          if (timeoutMs > 0 && timeoutMs <= 300000) {
            const timer = setTimeout(() => {
              onTimeout(rule, action);
            }, timeoutMs);
            timeoutTimers.set(rule.id, timer);
          }
        }
      }

      return {
        config: parsed,
        rules: validRules,
        pendingRuleIds: new Set(validRules.map((r) => r.id)),
        buffer: "",
        triggeredCount: 0,
        lastTriggeredAt: 0,
        timeoutTimers,
        context,
      };
    }

    // 模式 2：可编程脚本模式 (Programmable Script Mode)
    return {
      config: parsed,
      rules: [],
      pendingRuleIds: new Set(),
      buffer: "",
      triggeredCount: 0,
      lastTriggeredAt: 0,
      timeoutTimers,
      context,
    };
  } catch {
    return null;
  }
}

/**
 * 流式处理 Shell 输出数据块
 */
export function processSendExpectChunk(
  state: SendExpectExecutionState,
  rawChunk: string,
  onTrigger: (rule: SendExpectRule, steps: SendStep[]) => void
): void {
  // 如果是可编程脚本模式，交给脚本运行器 feed 数据
  if (state.config.mode === "script") {
    state.scriptRunner?.feedOutput(rawChunk);
    return;
  }

  if (state.pendingRuleIds.size === 0 || !rawChunk) return;

  // 1. 过滤 ANSI 颜色/控制字符
  const cleanText = stripAnsiCodes(rawChunk);
  if (!cleanText) return;

  // 2. 追加至滑动窗口（保留末尾 4096 字符，杜绝内存无限积压）
  state.buffer = (state.buffer + cleanText).slice(-4096);

  // 3. 按照规则顺序依次扫描
  for (const rule of state.rules) {
    if (!state.pendingRuleIds.has(rule.id)) continue;

    let matched = false;
    let matchEnd = -1;

    const trimmedExpect = rule.expect.trim();

    // 正则模式：形如 /pattern/flags
    if (
      trimmedExpect.startsWith("/") &&
      trimmedExpect.lastIndexOf("/") > 0 &&
      trimmedExpect.length > 2
    ) {
      try {
        const lastSlash = trimmedExpect.lastIndexOf("/");
        const pattern = trimmedExpect.slice(1, lastSlash);
        const flags = trimmedExpect.slice(lastSlash + 1) || "i";
        const regex = new RegExp(pattern, flags);
        const match = regex.exec(state.buffer);
        if (match) {
          matched = true;
          matchEnd = match.index + match[0].length;
        }
      } catch {
        // 正则解析异常时降级为普通子串匹配
      }
    }

    // 默认子串匹配（不区分大小写）
    if (!matched) {
      const idx = state.buffer.toLowerCase().indexOf(trimmedExpect.toLowerCase());
      if (idx !== -1) {
        matched = true;
        matchEnd = idx + trimmedExpect.length;
      }
    }

    if (matched) {
      // 清空已匹配区间之前的缓冲，防止同一片段反复触发
      state.buffer = matchEnd >= 0 ? state.buffer.slice(matchEnd) : "";
      state.triggeredCount++;
      state.lastTriggeredAt = Date.now();

      // 清除该规则可能存在的超时计时器
      const timer = state.timeoutTimers.get(rule.id);
      if (timer) {
        clearTimeout(timer);
        state.timeoutTimers.delete(rule.id);
      }

      // 如果是单次匹配规则（默认），从待触发集合中移除
      if (rule.once !== false) {
        state.pendingRuleIds.delete(rule.id);
      }

      // 宏变量插值与发送步骤解析
      const interpolatedSend = interpolateMacros(rule.send, state.context);
      const steps = parseSendSteps(
        interpolatedSend,
        rule.delayMs,
        rule.sendEnter !== false
      );

      onTrigger(rule, steps);
      // 每一轮数据块处理只触发最优先的一条规则，后续输出留待下次 tick
      break;
    }
  }
}

/**
 * 销毁状态，释放所有超时计时器并中止脚本运行
 */
export function cleanupSendExpectState(
  state: SendExpectExecutionState | null | undefined
): void {
  if (!state) return;
  for (const timer of state.timeoutTimers.values()) {
    clearTimeout(timer);
  }
  state.timeoutTimers.clear();
  state.pendingRuleIds.clear();
  state.buffer = "";
  if (state.scriptRunner) {
    state.scriptRunner.abort();
    state.scriptRunner = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 现代可编程交互脚本引擎 (JavaScript/TypeScript Async Script Sandbox)
// 彻底解决 Xshell 必须安装 Python / VBScript 的环境配置痛点
// ─────────────────────────────────────────────────────────────────────────────

export interface ScriptScreenAPI {
  waitForString: (pattern: string, timeoutMs?: number) => Promise<boolean>;
  waitForStrings: (patterns: string[], timeoutMs?: number) => Promise<number>;
  waitForRegex: (
    regex: string | RegExp,
    timeoutMs?: number
  ) => Promise<RegExpExecArray | null>;
  send: (text: string, appendEnter?: boolean) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
}

export interface ScriptSessionAPI {
  username: string;
  host: string;
  port: number;
  serverName: string;
  params: Record<string, string>;
}

export interface ScriptDialogAPI {
  alert: (message: string) => Promise<void>;
  prompt: (message: string, defaultValue?: string) => Promise<string | null>;
  toast: (
    message: string,
    type?: "info" | "success" | "warning" | "error"
  ) => void;
}

export interface ScriptRuntimeEnv {
  screen: ScriptScreenAPI;
  session: ScriptSessionAPI;
  dialog: ScriptDialogAPI;
}

interface PendingWaitCondition {
  id: string;
  check: (buffer: string) => any;
  resolve: (result: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ProgrammableScriptController {
  private buffer: string = "";
  private pendingWaits: Map<string, PendingWaitCondition> = new Map();
  private abortController: AbortController = new AbortController();
  private isDestroyed: boolean = false;

  constructor(
    private sendFn: (text: string) => Promise<void>,
    private context?: LogonScriptContext,
    private dialogCallbacks?: {
      alert?: (msg: string) => Promise<void>;
      prompt?: (msg: string, def?: string) => Promise<string | null>;
      toast?: (msg: string, type?: "info" | "success" | "warning" | "error") => void;
    }
  ) {}

  public feedOutput(rawChunk: string): void {
    if (this.isDestroyed || !rawChunk) return;
    const clean = stripAnsiCodes(rawChunk);
    if (!clean) return;
    this.buffer = (this.buffer + clean).slice(-8192);

    for (const [id, condition] of this.pendingWaits) {
      const res = condition.check(this.buffer);
      if (res !== undefined && res !== null && res !== false && res !== -1) {
        clearTimeout(condition.timer);
        this.pendingWaits.delete(id);
        condition.resolve(res);
      }
    }
  }

  public createRuntime(): ScriptRuntimeEnv {
    const session: ScriptSessionAPI = {
      username: this.context?.username || "",
      host: this.context?.host || "",
      port: Number(this.context?.port) || 22,
      serverName: this.context?.serverName || "",
      params: { ...(this.context?.params || {}) },
    };

    const screen: ScriptScreenAPI = {
      waitForString: (pattern: string, timeoutMs: number = 30000) => {
        return new Promise<boolean>((resolve) => {
          if (this.isDestroyed || !pattern) return resolve(false);
          const safeTimeout = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 30000;
          const lowerPat = pattern.toLowerCase();
          const existingIdx = this.buffer.toLowerCase().indexOf(lowerPat);
          if (existingIdx !== -1) {
            this.buffer = this.buffer.slice(existingIdx + lowerPat.length);
            return resolve(true);
          }

          const id = `wait-str-${Date.now()}-${Math.random()}`;
          const timer = setTimeout(() => {
            this.pendingWaits.delete(id);
            resolve(false);
          }, safeTimeout);

          this.pendingWaits.set(id, {
            id,
            check: (buf) => {
              const idx = buf.toLowerCase().indexOf(lowerPat);
              if (idx !== -1) {
                this.buffer = buf.slice(idx + lowerPat.length);
                return true;
              }
              return false;
            },
            resolve,
            timer,
          });
        });
      },

      waitForStrings: (patterns: string[], timeoutMs: number = 30000) => {
        return new Promise<number>((resolve) => {
          if (this.isDestroyed || !Array.isArray(patterns) || !patterns.some((p) => Boolean(p))) {
            return resolve(-1);
          }
          const safeTimeout = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 30000;
          const lowerList = patterns.map((p) => (p ? p.toLowerCase() : ""));
          const lowerBuf = this.buffer.toLowerCase();
          for (let i = 0; i < lowerList.length; i++) {
            const lp = lowerList[i];
            if (!lp) continue;
            const idx = lowerBuf.indexOf(lp);
            if (idx !== -1) {
              this.buffer = this.buffer.slice(idx + lp.length);
              return resolve(i);
            }
          }

          const id = `wait-strs-${Date.now()}-${Math.random()}`;
          const timer = setTimeout(() => {
            this.pendingWaits.delete(id);
            resolve(-1);
          }, safeTimeout);

          this.pendingWaits.set(id, {
            id,
            check: (buf) => {
              const curLower = buf.toLowerCase();
              for (let i = 0; i < lowerList.length; i++) {
                const lp = lowerList[i];
                if (!lp) continue;
                const idx = curLower.indexOf(lp);
                if (idx !== -1) {
                  this.buffer = buf.slice(idx + lp.length);
                  return i;
                }
              }
              return -1;
            },
            resolve,
            timer,
          });
        });
      },

      waitForRegex: (regexInput: string | RegExp, timeoutMs: number = 30000) => {
        return new Promise<RegExpExecArray | null>((resolve) => {
          if (this.isDestroyed) return resolve(null);
          if (typeof regexInput === "string" && !regexInput) return resolve(null);
          let re: RegExp;
          try {
            if (regexInput instanceof RegExp) {
              re = new RegExp(regexInput.source, regexInput.flags);
            } else if (typeof regexInput === "string") {
              re = new RegExp(regexInput, "i");
            } else {
              return resolve(null);
            }
          } catch {
            return resolve(null);
          }

          const safeTimeout = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 30000;
          re.lastIndex = 0;
          const match = re.exec(this.buffer);
          if (match) {
            this.buffer = this.buffer.slice(match.index + Math.max(1, match[0].length));
            return resolve(match);
          }

          const id = `wait-re-${Date.now()}-${Math.random()}`;
          const timer = setTimeout(() => {
            this.pendingWaits.delete(id);
            resolve(null);
          }, safeTimeout);

          this.pendingWaits.set(id, {
            id,
            check: (buf) => {
              re.lastIndex = 0;
              const m = re.exec(buf);
              if (m) {
                this.buffer = buf.slice(m.index + Math.max(1, m[0].length));
                return m;
              }
              return null;
            },
            resolve,
            timer,
          });
        });
      },

      send: async (text: string, appendEnter: boolean = true) => {
        if (this.isDestroyed) return;
        const payload = text + (appendEnter ? "\r" : "");
        await this.sendFn(payload);
      },

      sleep: (ms: number) => {
        return new Promise((resolve) => setTimeout(resolve, ms));
      },
    };

    const dialog: ScriptDialogAPI = {
      alert: async (msg: string) => {
        if (this.dialogCallbacks?.alert) {
          await this.dialogCallbacks.alert(msg);
        } else {
          this.dialogCallbacks?.toast?.(msg, "info");
        }
      },
      prompt: async (msg: string, def?: string) => {
        if (this.dialogCallbacks?.prompt) {
          return await this.dialogCallbacks.prompt(msg, def);
        }
        return def ?? null;
      },
      toast: (msg: string, type = "info") => {
        this.dialogCallbacks?.toast?.(msg, type);
      },
    };

    return { screen, session, dialog };
  }

  public async runScript(code: string): Promise<void> {
    if (!code || !code.trim() || this.isDestroyed) return;
    const runtime = this.createRuntime();

    try {
      // 构造受控异步沙箱函数
      const scriptFn = new Function(
        "screen",
        "session",
        "dialog",
        `return (async () => {
          ${code}
        })();`
      );
      await scriptFn(runtime.screen, runtime.session, runtime.dialog);
    } catch (err) {
      console.warn("[LogonScript Programmable Engine] Script error:", err);
      runtime.dialog.toast(
        `登录脚本异常: ${err instanceof Error ? err.message : String(err)}`,
        "error"
      );
    }
  }

  public abort(): void {
    this.isDestroyed = true;
    this.abortController.abort();
    for (const item of this.pendingWaits.values()) {
      clearTimeout(item.timer);
    }
    this.pendingWaits.clear();
    this.buffer = "";
  }
}
