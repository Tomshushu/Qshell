import type { SerialSequenceItem } from "@/components/workspace/modules/serial-sequence-dialog";
import type {
  AutomationScriptItem,
  MacroSequence,
  MacroStep,
  TriggerRule,
} from "@/types/automation";

const TRIGGERS_KEY = "qshell-automation-triggers";
const MACROS_KEY = "qshell-automation-macros";
const SCRIPTS_KEY = "qshell-automation-scripts";
const LEGACY_SERIAL_MACROS_KEY = "serial-macro-sequences";

function safeParseJson<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWriteJson(key: string, value: unknown): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage quota / private mode
  }
}

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * 逐元素校验持久化数据。localStorage 可能被旧版本、手工编辑或同步写入脏数据，
 * 只做 `Array.isArray` 判断会让 null / 字符串 / 缺字段元素进入 TriggerEngine、
 * MacroRunner 等消费方，冷启动时直接空值解引用崩溃。
 */
function sanitizeList<T>(raw: unknown, restore: (item: Dict) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const result: T[] = [];
  for (const item of raw) {
    if (!isDict(item)) continue;
    const restored = restore(item);
    if (restored !== null) result.push(restored);
  }
  return result;
}

const TRIGGER_ACTIONS = new Set<string>([
  "send_text",
  "toast",
  "bell",
  "marker",
  "highlight",
  "stop",
]);

// 校验和类型白名单：与 serial-checksum 的 SerialChecksumType 枚举对齐，
// 脏数据写入未知类型时直接降级为 undefined（不计算校验和），避免穿透到宏执行层。
const CHECKSUM_TYPES = new Set<string>([
  "none",
  "modbus-crc16-le",
  "modbus-crc16-be",
  "crc16-ccitt-xmodem",
  "crc16-ccitt-ffff",
  "crc32",
]);

// 宏作用域白名单：与 MacroSequence["scope"] 对齐，非法值回退到 "all"。
const MACRO_SCOPES = new Set<string>(["all", "ssh", "serial", "local", "telnet"]);

function asChecksumType(value: unknown): MacroStep["checksumType"] {
  return typeof value === "string" && CHECKSUM_TYPES.has(value)
    ? (value as MacroStep["checksumType"])
    : undefined;
}

export function loadTriggerRules(): TriggerRule[] {
  return sanitizeList<TriggerRule>(
    safeParseJson<unknown>(TRIGGERS_KEY, []),
    (r) => {
      if (typeof r.id !== "string" || !r.id) return null;
      if (typeof r.pattern !== "string") return null;
      const actionType = asString(r.actionType, "toast");
      return {
        id: r.id,
        name: asString(r.name, r.id),
        enabled: r.enabled !== false,
        pattern: r.pattern,
        isRegex: r.isRegex === true,
        caseSensitive: r.caseSensitive === true,
        cooldownMs:
          typeof r.cooldownMs === "number" && Number.isFinite(r.cooldownMs)
            ? r.cooldownMs
            : undefined,
        actionType: (
          TRIGGER_ACTIONS.has(actionType) ? actionType : "toast"
        ) as TriggerRule["actionType"],
        payload: typeof r.payload === "string" ? r.payload : undefined,
        appendEnter: r.appendEnter === true,
        stopProcessing: r.stopProcessing === true,
      };
    },
  );
}

export function saveTriggerRules(rules: TriggerRule[]): void {
  safeWriteJson(TRIGGERS_KEY, rules);
}

export function loadAutomationScripts(): AutomationScriptItem[] {
  return sanitizeList<AutomationScriptItem>(
    safeParseJson<unknown>(SCRIPTS_KEY, []),
    (s) => {
      if (typeof s.id !== "string" || !s.id) return null;
      if (typeof s.code !== "string") return null;
      return {
        id: s.id,
        name: asString(s.name, s.id),
        description: typeof s.description === "string" ? s.description : undefined,
        code: s.code,
        parameters: Array.isArray(s.parameters)
          ? (s.parameters.filter(isDict) as unknown as AutomationScriptItem["parameters"])
          : undefined,
        updatedAt: asNumber(s.updatedAt, Date.now()),
      };
    },
  );
}

export function saveAutomationScripts(scripts: AutomationScriptItem[]): void {
  safeWriteJson(SCRIPTS_KEY, scripts);
}

/**
 * 加载通用宏序列，并自动兼容吸收历史上串口模块的 `serial-macro-sequences` 数据
 */
function sanitizeMacroStep(item: Dict): MacroStep | null {
  if (typeof item.id !== "string" || !item.id) return null;
  const type = item.type === "hex" ? "hex" : "ascii";
  const suffix =
    item.suffix === "\r\n" || item.suffix === "\n" || item.suffix === "\r" || item.suffix === ""
      ? item.suffix
      : "\r\n";
  return {
    id: item.id,
    enabled: item.enabled !== false,
    name: asString(item.name, item.id),
    type,
    payload: asString(item.payload),
    suffix,
    delayMs: Math.max(0, asNumber(item.delayMs, 0)),
    checksumType: asChecksumType(item.checksumType),
  };
}

export function loadMacroSequences(): MacroSequence[] {
  if (typeof localStorage !== "undefined" && localStorage.getItem(MACROS_KEY) !== null) {
    return sanitizeList<MacroSequence>(
      safeParseJson<unknown>(MACROS_KEY, []),
      (m) => {
        if (typeof m.id !== "string" || !m.id) return null;
        const steps = Array.isArray(m.steps)
          ? m.steps
              .filter(isDict)
              .map(sanitizeMacroStep)
              .filter((s): s is MacroStep => s !== null)
          : [];
        return {
          id: m.id,
          name: asString(m.name, m.id),
          scope:
            typeof m.scope === "string" && MACRO_SCOPES.has(m.scope)
              ? (m.scope as MacroSequence["scope"])
              : "all",
          loopCount: Math.max(1, asNumber(m.loopCount, 1)),
          steps,
          createdAt: asNumber(m.createdAt, Date.now()),
          updatedAt: asNumber(m.updatedAt, Date.now()),
        };
      },
    );
  }

  const legacySerial = sanitizeList<SerialSequenceItem>(
    safeParseJson<unknown>(LEGACY_SERIAL_MACROS_KEY, []),
    (item) => {
      if (typeof item.id !== "string" || !item.id) return null;
      return {
        id: item.id,
        enabled: item.enabled !== false,
        name: asString(item.name, item.id),
        type: item.type === "hex" ? "hex" : "ascii",
        payload: asString(item.payload),
        suffix:
          item.suffix === "\r\n" || item.suffix === "\n" || item.suffix === "\r" || item.suffix === ""
            ? item.suffix
            : "\r\n",
        delayMs: Math.max(0, asNumber(item.delayMs, 0)),
        checksumType: asChecksumType(item.checksumType),
      } as SerialSequenceItem;
    },
  );
  if (legacySerial.length > 0) {
    const now = Date.now();
    const migrated: MacroSequence = {
      id: "macro-serial-migrated",
      name: "串口快捷发送序列",
      scope: "serial",
      loopCount: 1,
      steps: legacySerial
        .map((item) => sanitizeMacroStep(item as unknown as Dict))
        .filter((s): s is MacroStep => s !== null),
      createdAt: now,
      updatedAt: now,
    };
    const migratedList = [migrated];
    saveMacroSequences(migratedList);
    return migratedList;
  }
  return [];
}

export function saveMacroSequences(sequences: MacroSequence[]): void {
  safeWriteJson(MACROS_KEY, sequences);
}

export function createMacroStepFromSerial(item: SerialSequenceItem): MacroStep {
  return {
    id: item.id,
    enabled: item.enabled,
    name: item.name,
    type: item.type,
    payload: item.payload,
    suffix: item.suffix,
    delayMs: item.delayMs,
    checksumType: item.checksumType,
  };
}
