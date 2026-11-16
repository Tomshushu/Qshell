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

export function loadTriggerRules(): TriggerRule[] {
  const list = safeParseJson<TriggerRule[]>(TRIGGERS_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function saveTriggerRules(rules: TriggerRule[]): void {
  safeWriteJson(TRIGGERS_KEY, rules);
}

export function loadAutomationScripts(): AutomationScriptItem[] {
  const list = safeParseJson<AutomationScriptItem[]>(SCRIPTS_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function saveAutomationScripts(scripts: AutomationScriptItem[]): void {
  safeWriteJson(SCRIPTS_KEY, scripts);
}

/**
 * 加载通用宏序列，并自动兼容吸收历史上串口模块的 `serial-macro-sequences` 数据
 */
export function loadMacroSequences(): MacroSequence[] {
  if (typeof localStorage !== "undefined" && localStorage.getItem(MACROS_KEY) !== null) {
    const existing = safeParseJson<MacroSequence[]>(MACROS_KEY, []);
    return Array.isArray(existing) ? existing : [];
  }

  const legacySerial = safeParseJson<SerialSequenceItem[]>(LEGACY_SERIAL_MACROS_KEY, []);
  if (Array.isArray(legacySerial) && legacySerial.length > 0) {
    const now = Date.now();
    const migrated: MacroSequence = {
      id: "macro-serial-migrated",
      name: "串口快捷发送序列",
      scope: "serial",
      loopCount: 1,
      steps: legacySerial.map((item) => ({
        id: item.id,
        enabled: item.enabled,
        name: item.name,
        type: item.type,
        payload: item.payload,
        suffix: item.suffix,
        delayMs: item.delayMs,
        checksumType: item.checksumType,
      })),
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
