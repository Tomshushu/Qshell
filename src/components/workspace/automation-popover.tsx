import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  Zap,
  Play,
  Square,
  Plus,
  Trash2,
  Circle,
  Code2,
  Bell,
  ListOrdered,
  X,
  Pencil,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import { useAppStore } from "@/store";
import { useModalStack } from "@/hooks/use-modal-stack";
import { Z_LAYER } from "@/lib/z-layer";
import { useToast } from "@/components/ui/toast";
import { SERIAL_CHECKSUM_OPTIONS, type SerialChecksumType } from "@/lib/serial-checksum";
import { automationRegistry } from "@/lib/automation/automation-runner";
import {
  loadAutomationScripts,
  loadMacroSequences,
  loadTriggerRules,
  saveAutomationScripts,
  saveMacroSequences,
  saveTriggerRules,
} from "@/lib/automation/storage";
import type { ScriptParam } from "@/types";
import type {
  AutomationScriptItem,
  MacroSequence,
  MacroStep,
  TriggerActionType,
  TriggerRule,
} from "@/types/automation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AutomationPopoverProps {
  tabId: string;
  serverId: string;
  disabled?: boolean;
  compact?: boolean;
  isDarkTheme?: boolean;
}

type TabKey = "scripts" | "triggers" | "macros";

const DEFAULT_SCRIPT_CODE = `// 自动化示例脚本 (运行于 Web Worker，仅用于避免阻塞界面)
// 注意：脚本是可信代码，并非安全沙箱，请勿运行来源不明的脚本
// 可用: screen.waitForString / send / sleep, dialog.toast / prompt, session.params
await screen.send("echo Qshell Automation Ready");
dialog.toast("自动化脚本执行完毕", "success");`;

function createEmptyMacroStep(index: number): MacroStep {
  return {
    id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    enabled: true,
    name: `Step ${index + 1}`,
    type: "ascii",
    payload: "",
    suffix: "\r",
    delayMs: 50,
    checksumType: "none",
  };
}

export function AutomationPopover({
  tabId,
  serverId,
  disabled,
  compact,
  isDarkTheme,
}: AutomationPopoverProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const tr = useCallback(
    (key: string, fallback: string) => {
      const v = t(key);
      return v === key ? fallback : v;
    },
    [t],
  );

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("scripts");
  const triggerBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 72, right: 16, maxHeight: 520 });

  useModalStack("automation-popover", open, () => setOpen(false));

  const server = useAppStore((s) => s.servers.find((sv) => sv.id === serverId));

  const snapshot = useSyncExternalStore(
    (cb) => automationRegistry.subscribe(cb),
    () => automationRegistry.getSnapshot(tabId),
  );

  const [scripts, setScripts] = useState<AutomationScriptItem[]>(() => loadAutomationScripts());
  const [triggers, setTriggers] = useState<TriggerRule[]>(() => loadTriggerRules());
  const [macros, setMacros] = useState<MacroSequence[]>(() => loadMacroSequences());

  // Script create/edit form
  const [showScriptForm, setShowScriptForm] = useState(false);
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [scriptName, setScriptName] = useState("");
  const [scriptCode, setScriptCode] = useState(DEFAULT_SCRIPT_CODE);
  const [scriptParams, setScriptParams] = useState<ScriptParam[]>([]);

  // Trigger create/edit form
  const [editingTriggerId, setEditingTriggerId] = useState<string | null>(null);
  const [triggerName, setTriggerName] = useState("");
  const [triggerPattern, setTriggerPattern] = useState("");
  const [triggerIsRegex, setTriggerIsRegex] = useState(false);
  const [triggerCaseSensitive, setTriggerCaseSensitive] = useState(false);
  const [triggerAction, setTriggerAction] = useState<TriggerActionType>("send_text");
  const [triggerPayload, setTriggerPayload] = useState("");
  const [triggerCooldownMs, setTriggerCooldownMs] = useState(100);
  const [triggerAppendEnter, setTriggerAppendEnter] = useState(true);
  const [triggerStopProcessing, setTriggerStopProcessing] = useState(false);
  const [showTriggerAdvanced, setShowTriggerAdvanced] = useState(false);

  // Macro create/edit form
  const [showMacroEditor, setShowMacroEditor] = useState(false);
  const [editingMacroId, setEditingMacroId] = useState<string | null>(null);
  const [macroName, setMacroName] = useState("");
  const [macroLoopCount, setMacroLoopCount] = useState(1);
  const [macroScope, setMacroScope] = useState<NonNullable<MacroSequence["scope"]>>("all");
  const [macroSteps, setMacroSteps] = useState<MacroStep[]>(() => [createEmptyMacroStep(0)]);
  const [recordExportKind, setRecordExportKind] = useState<"script" | "macro">("script");

  const serverLogonScript = useMemo<AutomationScriptItem | null>(() => {
    if (!server?.logonScriptsConfig) return null;
    try {
      const cfg = JSON.parse(server.logonScriptsConfig);
      if (cfg?.customScript) {
        return {
          id: `server-logon-${server.id}`,
          name: `${server.name} (${t("auto_server_logon_script")})`,
          code: cfg.customScript,
          parameters: cfg.parameters,
          updatedAt: Date.now(),
        };
      }
    } catch {
      return null;
    }
    return null;
  }, [server, t]);

  const updatePosition = useCallback(() => {
    const vh = typeof window !== "undefined" ? window.innerHeight : 768;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
    const maxHeight = Math.max(200, vh - 24);
    const panelWidth = Math.min(440, vw - 24);
    const rect = triggerBtnRef.current?.getBoundingClientRect();
    const measuredHeight = Math.min(panelRef.current?.offsetHeight || 440, maxHeight);

    if (!rect) {
      setCoords({
        top: Math.max(12, Math.min(72, vh - measuredHeight - 12)),
        right: 16,
        maxHeight,
      });
      return;
    }

    const rawRight = Math.max(12, vw - rect.right);
    const right = Math.min(rawRight, Math.max(12, vw - panelWidth - 12));

    let top = rect.bottom + 6;
    if (top + measuredHeight > vh - 12) {
      const aboveTop = rect.top - measuredHeight - 6;
      if (aboveTop >= 12) {
        top = aboveTop;
      } else {
        top = Math.max(12, vh - measuredHeight - 12);
      }
    }

    setCoords({ top, right, maxHeight });
  }, []);

  useEffect(() => {
    const handleToggleEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<{ tabId?: string }>).detail;
      const matchesTab = detail?.tabId
        ? detail.tabId === tabId
        : useAppStore.getState().activeTabId === tabId;
      if (matchesTab && !disabled) {
        setOpen((v) => !v);
      }
    };
    window.addEventListener("qshell:toggle-automation-popover", handleToggleEvent);
    return () => {
      window.removeEventListener("qshell:toggle-automation-popover", handleToggleEvent);
    };
  }, [tabId, disabled]);

  useEffect(() => {
    if (!open) return;
    setScripts(loadAutomationScripts());
    setTriggers(loadTriggerRules());
    setMacros(loadMacroSequences());

    const onDown = (ev: MouseEvent) => {
      const target = ev.target as Element | null;
      if (!target) return;
      if (
        panelRef.current?.contains(target) ||
        triggerBtnRef.current?.contains(target) ||
        target.closest?.('[data-automation-dialog="true"]')
      ) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, activeTab, showScriptForm, showMacroEditor, showTriggerAdvanced, scripts.length, triggers.length, macros.length, macroSteps.length, updatePosition]);

  const resetScriptForm = () => {
    setEditingScriptId(null);
    setScriptName("");
    setScriptCode(DEFAULT_SCRIPT_CODE);
    setScriptParams([]);
    setShowScriptForm(false);
  };

  const handleOpenNewScript = () => {
    setEditingScriptId(null);
    setScriptName("");
    setScriptCode(DEFAULT_SCRIPT_CODE);
    setScriptParams([]);
    setShowScriptForm(true);
  };

  const handleEditScript = (script: AutomationScriptItem) => {
    setEditingScriptId(script.id);
    setScriptName(script.name);
    setScriptCode(script.code);
    setScriptParams((script.parameters || []).map((p) => ({ ...p })));
    setShowScriptForm(true);
  };

  const handleSaveScript = () => {
    const name = scriptName.trim();
    if (!name || !scriptCode.trim()) return;
    const cleanedParams = scriptParams
      .filter((p) => p.name.trim().length > 0)
      .map((p) => ({
        ...p,
        name: p.name.trim(),
        label: p.label?.trim() || undefined,
        defaultValue: p.defaultValue ?? "",
      }));

    const now = Date.now();
    let next: AutomationScriptItem[];
    if (editingScriptId) {
      next = scripts.map((s) =>
        s.id === editingScriptId
          ? {
              ...s,
              name,
              code: scriptCode,
              parameters: cleanedParams.length > 0 ? cleanedParams : undefined,
              updatedAt: now,
            }
          : s,
      );
    } else {
      const item: AutomationScriptItem = {
        id: `script-${now}`,
        name,
        code: scriptCode,
        parameters: cleanedParams.length > 0 ? cleanedParams : undefined,
        updatedAt: now,
      };
      next = [item, ...scripts];
    }
    setScripts(next);
    saveAutomationScripts(next);
    resetScriptForm();
  };

  const handleDeleteScript = (id: string) => {
    const next = scripts.filter((s) => s.id !== id);
    setScripts(next);
    saveAutomationScripts(next);
    if (editingScriptId === id) resetScriptForm();
  };

  const resetTriggerForm = () => {
    setEditingTriggerId(null);
    setTriggerName("");
    setTriggerPattern("");
    setTriggerIsRegex(false);
    setTriggerCaseSensitive(false);
    setTriggerAction("send_text");
    setTriggerPayload("");
    setTriggerCooldownMs(100);
    setTriggerAppendEnter(true);
    setTriggerStopProcessing(false);
    setShowTriggerAdvanced(false);
  };

  const handleEditTrigger = (rule: TriggerRule) => {
    setEditingTriggerId(rule.id);
    setTriggerName(rule.name);
    setTriggerPattern(rule.pattern);
    setTriggerIsRegex(Boolean(rule.isRegex));
    setTriggerCaseSensitive(Boolean(rule.caseSensitive));
    setTriggerAction(rule.actionType);
    setTriggerPayload(rule.payload ?? "");
    setTriggerCooldownMs(rule.cooldownMs ?? 100);
    setTriggerAppendEnter(rule.appendEnter ?? rule.actionType === "send_text");
    setTriggerStopProcessing(Boolean(rule.stopProcessing));
    setShowTriggerAdvanced(true);
  };

  const handleSaveTrigger = () => {
    const pattern = triggerPattern.trim();
    if (!pattern) return;
    const cooldownMs = Math.max(0, Number(triggerCooldownMs) || 0);
    let next: TriggerRule[];
    if (editingTriggerId) {
      next = triggers.map((r) =>
        r.id === editingTriggerId
          ? {
              ...r,
              name: triggerName.trim() || pattern.slice(0, 24),
              pattern,
              isRegex: triggerIsRegex,
              caseSensitive: triggerCaseSensitive,
              actionType: triggerAction,
              payload: triggerPayload,
              appendEnter: triggerAction === "send_text" ? triggerAppendEnter : false,
              cooldownMs,
              stopProcessing: triggerStopProcessing,
            }
          : r,
      );
    } else {
      const item: TriggerRule = {
        id: `trg-${Date.now()}`,
        name: triggerName.trim() || pattern.slice(0, 24),
        enabled: true,
        pattern,
        isRegex: triggerIsRegex,
        caseSensitive: triggerCaseSensitive,
        actionType: triggerAction,
        payload: triggerPayload,
        appendEnter: triggerAction === "send_text" ? triggerAppendEnter : false,
        cooldownMs,
        stopProcessing: triggerStopProcessing,
      };
      next = [item, ...triggers];
    }
    setTriggers(next);
    saveTriggerRules(next);
    automationRegistry.refreshTriggers(next);
    resetTriggerForm();
  };

  const handleToggleTrigger = (id: string) => {
    const next = triggers.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
    setTriggers(next);
    saveTriggerRules(next);
    automationRegistry.refreshTriggers(next);
  };

  const handleDeleteTrigger = (id: string) => {
    const next = triggers.filter((r) => r.id !== id);
    setTriggers(next);
    saveTriggerRules(next);
    automationRegistry.refreshTriggers(next);
    if (editingTriggerId === id) resetTriggerForm();
  };

  const resetMacroForm = () => {
    setEditingMacroId(null);
    setMacroName("");
    setMacroLoopCount(1);
    setMacroScope("all");
    setMacroSteps([createEmptyMacroStep(0)]);
    setShowMacroEditor(false);
  };

  const handleOpenNewMacro = () => {
    setEditingMacroId(null);
    setMacroName("");
    setMacroLoopCount(1);
    setMacroScope("all");
    setMacroSteps([createEmptyMacroStep(0)]);
    setShowMacroEditor(true);
  };

  const handleEditMacro = (seq: MacroSequence) => {
    setEditingMacroId(seq.id);
    setMacroName(seq.name);
    setMacroLoopCount(Math.max(1, seq.loopCount ?? 1));
    setMacroScope(seq.scope ?? "all");
    setMacroSteps(
      seq.steps.length > 0
        ? seq.steps.map((s) => ({ ...s }))
        : [createEmptyMacroStep(0)],
    );
    setShowMacroEditor(true);
  };

  const handleSaveMacro = () => {
    const validSteps = macroSteps
      .filter((s) => s.payload.trim().length > 0)
      .map((s, idx) => ({
        ...s,
        name: s.name.trim() || `Step ${idx + 1}`,
        delayMs: Math.max(0, Number(s.delayMs) || 0),
        checksumType: s.type === "hex" ? (s.checksumType || "none") : undefined,
        suffix: s.type === "ascii" ? s.suffix : "",
      }));
    if (validSteps.length === 0) return;

    const now = Date.now();
    const resolvedName = macroName.trim() || validSteps[0].payload.slice(0, 24);
    let next: MacroSequence[];
    if (editingMacroId) {
      next = macros.map((m) =>
        m.id === editingMacroId
          ? {
              ...m,
              name: resolvedName,
              scope: macroScope,
              loopCount: Math.max(1, Number(macroLoopCount) || 1),
              steps: validSteps,
              updatedAt: now,
            }
          : m,
      );
    } else {
      const seq: MacroSequence = {
        id: `macro-${now}`,
        name: resolvedName,
        scope: macroScope,
        loopCount: Math.max(1, Number(macroLoopCount) || 1),
        steps: validSteps,
        createdAt: now,
        updatedAt: now,
      };
      next = [seq, ...macros];
    }
    setMacros(next);
    saveMacroSequences(next);
    resetMacroForm();
  };

  const handleDeleteMacro = (id: string) => {
    const next = macros.filter((m) => m.id !== id);
    setMacros(next);
    saveMacroSequences(next);
    if (editingMacroId === id) resetMacroForm();
  };

  const handleMoveMacroStep = (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= macroSteps.length) return;
    const copy = [...macroSteps];
    const [moved] = copy.splice(idx, 1);
    copy.splice(target, 0, moved);
    setMacroSteps(copy);
  };

  const handleRunScript = (script: AutomationScriptItem) => {
    void automationRegistry.runScript(tabId, script).catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err));
    });
  };

  const handleRunMacro = (seq: MacroSequence) => {
    void automationRegistry.runMacro(tabId, seq).catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err));
    });
  };

  const handleToggleRecording = () => {
    if (!snapshot.isRecording) {
      automationRegistry.startRecording(tabId);
      return;
    }
    const res = automationRegistry.stopRecording(
      tabId,
      recordExportKind,
      `${t("auto_recorded_prefix")} ${new Date().toLocaleTimeString()}`,
    );
    if (res?.kind === "script") {
      setScripts(loadAutomationScripts());
      setActiveTab("scripts");
    } else if (res?.kind === "macro") {
      setMacros(loadMacroSequences());
      setActiveTab("macros");
    }
  };

  const isBusy = snapshot.runningKind !== null || snapshot.isRecording;

  return (
    <div className="flex items-center gap-1 flex-shrink-0" data-no-drag>
      <button
        ref={triggerBtnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={t("auto_title")}
        aria-label={t("auto_title")}
        className={cn(
          compact
            ? "h-5 px-1.5 rounded text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
            : "h-6 px-2 rounded-md text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer",
          disabled && "opacity-40 cursor-not-allowed",
          open || isBusy
            ? "bg-amber-500/15 text-amber-500 border border-amber-500/30"
            : compact
              ? isDarkTheme
                ? "text-white/75 hover:bg-white/10 hover:text-white"
                : "text-foreground/75 hover:bg-black/5 hover:text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
        )}
      >
        <Zap className={cn("h-3 w-3", isBusy && "animate-pulse fill-amber-500")} />
        {!compact && <span className="hidden xl:inline">{t("auto_btn_label")}</span>}
        {snapshot.activeTriggerCount > 0 && !snapshot.isRecording && !snapshot.runningKind && (
          <span className="text-[9px] px-1 rounded bg-primary/15 text-primary">
            {snapshot.activeTriggerCount}
          </span>
        )}
        {snapshot.isRecording && (
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping" />
        )}
      </button>

      {snapshot.runningKind !== null && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => automationRegistry.stopExecution(tabId)}
          className={cn(
            compact ? "h-5 w-5" : "h-6 w-6",
            "text-rose-500 hover:bg-rose-500/15",
          )}
          title={`${t("auto_stop")}: ${snapshot.runningName || ""}`}
        >
          <Square className="h-3 w-3 fill-current" />
        </Button>
      )}

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="false"
            aria-label={t("auto_title")}
            data-automation-popover="true"
            style={{
              top: coords.top,
              right: coords.right,
              maxHeight: coords.maxHeight,
              zIndex: Z_LAYER.POPUP,
            }}
            className="fixed flex flex-col w-[440px] max-w-[calc(100vw-24px)] rounded-xl border border-border/80 bg-popover/98 backdrop-blur-md shadow-2xl text-xs overflow-hidden"
          >
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-3.5 py-2.5 border-b border-border/60 bg-muted/30">
              <div className="flex items-center gap-2 min-w-0">
                <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                <span className="font-semibold text-foreground truncate">{t("auto_title")}</span>
                {snapshot.runningName && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 font-medium truncate">
                    {t("auto_running")}: {snapshot.runningName}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground p-0.5 rounded shrink-0"
                aria-label={t("common_close")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Circuit Breaker / Last Error Banner */}
            {(snapshot.circuitBreakerTripped || snapshot.lastError) && (
              <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/25 text-[11px] text-amber-600 dark:text-amber-400">
                <div className="flex items-center gap-1.5 min-w-0">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {snapshot.circuitBreakerTripped
                      ? `${tr("auto_circuit_tripped", "触发器保护已熔断")}: ${snapshot.lastError || ""}`
                      : snapshot.lastError}
                  </span>
                </div>
                {snapshot.circuitBreakerTripped && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1.5 text-[10px] gap-1 shrink-0"
                    onClick={() => automationRegistry.refreshTriggers()}
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    {tr("auto_reset", "重置")}
                  </Button>
                )}
              </div>
            )}

            {/* Segment Tabs */}
            <div className="shrink-0 grid grid-cols-3 border-b border-border/60 bg-muted/15 p-1 gap-1">
              {[
                { key: "scripts" as const, icon: Code2, label: t("auto_tab_scripts") },
                { key: "triggers" as const, icon: Bell, label: t("auto_tab_triggers") },
                { key: "macros" as const, icon: ListOrdered, label: t("auto_tab_macros") },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveTab(item.key)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer",
                      activeTab === item.key
                        ? "bg-background text-foreground shadow-xs border border-border/60"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 p-3 overflow-y-auto space-y-2.5">
              {activeTab === "scripts" && (
                <>
                  <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
                    {tr(
                      "脚本为可信代码，在 Web Worker 中运行仅避免阻塞界面，并非安全沙箱；请勿运行来源不明的脚本。",
                      "Scripts are trusted code. Web Worker only prevents UI blocking — it is not a security sandbox. Do not run scripts from untrusted sources.",
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      {t("auto_scripts_hint")}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px] gap-1"
                      onClick={() => (showScriptForm ? resetScriptForm() : handleOpenNewScript())}
                    >
                      <Plus className="h-3 w-3" />
                      {t("auto_new_script")}
                    </Button>
                  </div>

                  {showScriptForm && (
                    <div className="rounded-lg border border-border/60 bg-background/70 p-2.5 space-y-2">
                      <Input
                        value={scriptName}
                        onChange={(e) => setScriptName(e.target.value)}
                        placeholder={t("auto_script_name_placeholder")}
                        className="h-7 text-xs"
                      />
                      <textarea
                        value={scriptCode}
                        onChange={(e) => setScriptCode(e.target.value)}
                        rows={4}
                        spellCheck={false}
                        className="w-full rounded border border-border/60 bg-zinc-950 text-zinc-100 p-2 font-mono text-[11px] focus:outline-none"
                      />
                      {/* Script Parameters */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>{tr("auto_script_params", "脚本参数 (%P{name} / session.params)")}</span>
                          <button
                            type="button"
                            className="text-primary hover:underline flex items-center gap-0.5 cursor-pointer"
                            onClick={() =>
                              setScriptParams((prev) => [
                                ...prev,
                                { name: "", defaultValue: "", required: false, secret: false },
                              ])
                            }
                          >
                            <Plus className="h-2.5 w-2.5" />
                            {tr("auto_add_param", "添加参数")}
                          </button>
                        </div>
                        {scriptParams.map((param, idx) => (
                          <div key={idx} className="flex items-center gap-1">
                            <Input
                              value={param.name}
                              onChange={(e) =>
                                setScriptParams((prev) =>
                                  prev.map((item, i) => (i === idx ? { ...item, name: e.target.value } : item)),
                                )
                              }
                              placeholder="name"
                              className="h-6 text-[11px] font-mono w-24"
                            />
                            <Input
                              value={param.defaultValue ?? ""}
                              onChange={(e) =>
                                setScriptParams((prev) =>
                                  prev.map((item, i) =>
                                    i === idx ? { ...item, defaultValue: e.target.value } : item,
                                  ),
                                )
                              }
                              placeholder={tr("auto_param_default", "默认值")}
                              className="h-6 text-[11px] flex-1"
                            />
                            <label className="flex items-center gap-0.5 text-[10px] shrink-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(param.required)}
                                onChange={(e) =>
                                  setScriptParams((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { ...item, required: e.target.checked } : item,
                                    ),
                                  )
                                }
                                className="accent-primary"
                              />
                              {tr("auto_param_req", "必填")}
                            </label>
                            <label className="flex items-center gap-0.5 text-[10px] shrink-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(param.secret)}
                                onChange={(e) =>
                                  setScriptParams((prev) =>
                                    prev.map((item, i) =>
                                      i === idx ? { ...item, secret: e.target.checked } : item,
                                    ),
                                  )
                                }
                                className="accent-primary"
                              />
                              {tr("auto_param_secret", "密文")}
                            </label>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-destructive shrink-0"
                              onClick={() =>
                                setScriptParams((prev) => prev.filter((_, i) => i !== idx))
                              }
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-end gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[11px]"
                          onClick={resetScriptForm}
                        >
                          {t("common_cancel")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-6 text-[11px]"
                          onClick={handleSaveScript}
                        >
                          {t("common_save")}
                        </Button>
                      </div>
                    </div>
                  )}

                  {serverLogonScript && (
                    <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-2">
                      <div className="min-w-0 pr-2">
                        <div className="font-medium truncate">{serverLogonScript.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate font-mono">
                          {serverLogonScript.code.split("\n")[0]}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="h-6 px-2 text-[11px] gap-1"
                        onClick={() => handleRunScript(serverLogonScript)}
                      >
                        <Play className="h-3 w-3" />
                        {t("auto_run")}
                      </Button>
                    </div>
                  )}

                  {scripts.length === 0 && !serverLogonScript ? (
                    <p className="text-center py-6 text-muted-foreground text-[11px]">
                      {t("auto_scripts_empty")}
                    </p>
                  ) : (
                    scripts.map((script) => (
                      <div
                        key={script.id}
                        className="flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-2.5 py-2"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-medium truncate">{script.name}</div>
                          <div className="text-[10px] text-muted-foreground truncate font-mono">
                            {script.code.split("\n")[0]}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[11px] gap-1"
                            onClick={() => handleRunScript(script)}
                          >
                            <Play className="h-3 w-3" />
                            {t("auto_run")}
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            title={t("common_edit")}
                            aria-label={t("common_edit")}
                            onClick={() => handleEditScript(script)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-destructive"
                            title={t("common_delete")}
                            onClick={() => handleDeleteScript(script.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}

              {activeTab === "triggers" && (
                <>
                  <div className="rounded-lg border border-border/60 bg-background/60 p-2.5 space-y-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <Input
                        value={triggerName}
                        onChange={(e) => setTriggerName(e.target.value)}
                        placeholder={t("auto_trigger_name")}
                        className="h-7 text-xs"
                      />
                      <Input
                        value={triggerPattern}
                        onChange={(e) => setTriggerPattern(e.target.value)}
                        placeholder={t("auto_trigger_pattern")}
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={triggerAction}
                        onChange={(e) => setTriggerAction(e.target.value as TriggerActionType)}
                        className="h-7 rounded border border-border/60 bg-background px-2 text-[11px]"
                      >
                        <option value="send_text">{t("auto_action_send_text")}</option>
                        <option value="toast">{t("auto_action_toast")}</option>
                        <option value="bell">{t("auto_action_bell")}</option>
                        <option value="marker">{t("auto_action_marker")}</option>
                        <option value="highlight">{t("auto_action_highlight")}</option>
                        <option value="stop">{t("auto_action_stop")}</option>
                      </select>
                      <Input
                        value={triggerPayload}
                        onChange={(e) => setTriggerPayload(e.target.value)}
                        placeholder={t("auto_trigger_payload")}
                        className="h-7 text-xs flex-1 font-mono"
                      />
                      <label className="flex items-center gap-1 text-[10px] shrink-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={triggerIsRegex}
                          onChange={(e) => setTriggerIsRegex(e.target.checked)}
                          className="accent-primary"
                        />
                        Regex
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={handleSaveTrigger}
                        title={editingTriggerId ? t("common_save") : tr("auto_add", "添加")}
                      >
                        {editingTriggerId ? t("common_save") : <Plus className="h-3 w-3" />}
                      </Button>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <button
                        type="button"
                        className="hover:text-foreground cursor-pointer"
                        onClick={() => setShowTriggerAdvanced((v) => !v)}
                      >
                        {showTriggerAdvanced ? "▾ " : "▸ "}
                        {tr("auto_trigger_advanced", "高级选项 (冷却 / 大小写 / 阻断)")}
                      </button>
                      {editingTriggerId && (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground cursor-pointer"
                          onClick={resetTriggerForm}
                        >
                          {t("common_cancel")}
                        </button>
                      )}
                    </div>
                    {showTriggerAdvanced && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 border-t border-border/40 text-[10px]">
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={triggerCaseSensitive}
                            onChange={(e) => setTriggerCaseSensitive(e.target.checked)}
                            className="accent-primary"
                          />
                          {tr("auto_case_sensitive", "区分大小写")}
                        </label>
                        {triggerAction === "send_text" && (
                          <label className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={triggerAppendEnter}
                              onChange={(e) => setTriggerAppendEnter(e.target.checked)}
                              className="accent-primary"
                            />
                            {tr("auto_append_enter", "自动回车")}
                          </label>
                        )}
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={triggerStopProcessing}
                            onChange={(e) => setTriggerStopProcessing(e.target.checked)}
                            className="accent-primary"
                          />
                          {tr("auto_stop_processing", "命中后停止匹配")}
                        </label>
                        <label className="flex items-center gap-1">
                          <span>{tr("auto_cooldown_ms", "冷却(ms)")}</span>
                          <Input
                            type="number"
                            min={0}
                            value={triggerCooldownMs}
                            onChange={(e) => setTriggerCooldownMs(Number(e.target.value) || 0)}
                            className="h-5 w-16 text-[10px] px-1.5"
                          />
                        </label>
                      </div>
                    )}
                  </div>

                  {triggers.length === 0 ? (
                    <p className="text-center py-4 text-muted-foreground text-[11px]">
                      {t("auto_triggers_empty")}
                    </p>
                  ) : (
                    triggers.map((rule) => (
                      <div
                        key={rule.id}
                        className="flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-2.5 py-1.5 gap-2"
                      >
                        <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            onChange={() => handleToggleTrigger(rule.id)}
                            className="accent-primary"
                          />
                          <div className="min-w-0">
                            <div className="font-medium truncate">{rule.name}</div>
                            <div className="text-[10px] text-muted-foreground font-mono truncate">
                              {rule.pattern} ➔ {rule.actionType}
                              {rule.payload ? ` (${rule.payload})` : ""}
                            </div>
                          </div>
                        </label>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            title={t("common_edit")}
                            aria-label={t("common_edit")}
                            onClick={() => handleEditTrigger(rule)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-destructive"
                            title={t("common_delete")}
                            onClick={() => handleDeleteTrigger(rule.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}

              {activeTab === "macros" && (
                <>
                  {/* Recorder strip */}
                  <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/25 px-2.5 py-2 gap-2">
                    <div className="flex items-center gap-2">
                      <Circle
                        className={cn(
                          "h-3 w-3",
                          snapshot.isRecording
                            ? "fill-rose-500 text-rose-500 animate-pulse"
                            : "text-muted-foreground",
                        )}
                      />
                      <span className="text-[11px] font-medium">
                        {snapshot.isRecording
                          ? `${t("auto_recording_count")}: ${snapshot.recordedCount}`
                          : t("auto_recorder_ready")}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={recordExportKind}
                        onChange={(e) => setRecordExportKind(e.target.value as "script" | "macro")}
                        className="h-6 rounded border border-border/60 bg-background px-1.5 text-[10px]"
                      >
                        <option value="script">{t("auto_export_script")}</option>
                        <option value="macro">{t("auto_export_macro")}</option>
                      </select>
                      <Button
                        type="button"
                        size="sm"
                        variant={snapshot.isRecording ? "destructive" : "default"}
                        className="h-6 px-2 text-[11px] gap-1"
                        onClick={handleToggleRecording}
                      >
                        {snapshot.isRecording ? t("auto_stop_record") : t("auto_start_record")}
                      </Button>
                    </div>
                  </div>

                  {/* Multi-step Macro Header */}
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      {tr("auto_macro_multi_hint", "支持多步 ASCII / HEX+校验与循环")}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px] gap-1"
                      onClick={() => (showMacroEditor ? resetMacroForm() : handleOpenNewMacro())}
                    >
                      <Plus className="h-3 w-3" />
                      {tr("auto_new_macro", "新建宏")}
                    </Button>
                  </div>

                  {/* Multi-step Macro Editor */}
                  {showMacroEditor && (
                    <div className="rounded-lg border border-border/60 bg-background/70 p-2.5 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={macroName}
                          onChange={(e) => setMacroName(e.target.value)}
                          placeholder={t("auto_macro_name")}
                          className="h-7 text-xs flex-1"
                        />
                        <label className="flex items-center gap-1 text-[10px] shrink-0">
                          <span>{tr("auto_loop", "循环")}</span>
                          <Input
                            type="number"
                            min={1}
                            value={macroLoopCount}
                            onChange={(e) => setMacroLoopCount(Math.max(1, Number(e.target.value) || 1))}
                            className="h-7 w-14 text-xs px-1.5"
                          />
                        </label>
                        <select
                          value={macroScope}
                          onChange={(e) => setMacroScope(e.target.value as NonNullable<MacroSequence["scope"]>)}
                          className="h-7 rounded border border-border/60 bg-background px-1.5 text-[11px]"
                        >
                          <option value="all">ALL</option>
                          <option value="ssh">SSH</option>
                          <option value="serial">Serial</option>
                          <option value="local">Local</option>
                          <option value="telnet">Telnet</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        {macroSteps.map((step, idx) => (
                          <div
                            key={step.id}
                            className="rounded border border-border/50 bg-card/40 p-1.5 space-y-1"
                          >
                            <div className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={step.enabled}
                                onChange={(e) =>
                                  setMacroSteps((prev) =>
                                    prev.map((s, i) => (i === idx ? { ...s, enabled: e.target.checked } : s)),
                                  )
                                }
                                className="accent-primary shrink-0"
                              />
                              <select
                                value={step.type}
                                onChange={(e) =>
                                  setMacroSteps((prev) =>
                                    prev.map((s, i) =>
                                      i === idx
                                        ? {
                                            ...s,
                                            type: e.target.value as "ascii" | "hex",
                                            suffix: e.target.value === "ascii" ? (s.suffix || "\r") : "",
                                            checksumType: e.target.value === "hex" ? (s.checksumType || "none") : undefined,
                                          }
                                        : s,
                                    ),
                                  )
                                }
                                className="h-6 rounded border border-border/60 bg-background px-1 text-[10px] shrink-0"
                              >
                                <option value="ascii">ASCII</option>
                                <option value="hex">HEX</option>
                              </select>
                              <Input
                                value={step.payload}
                                onChange={(e) =>
                                  setMacroSteps((prev) =>
                                    prev.map((s, i) => (i === idx ? { ...s, payload: e.target.value } : s)),
                                  )
                                }
                                placeholder={step.type === "hex" ? "AA BB 01" : "uname -a"}
                                className="h-6 text-[11px] flex-1 font-mono"
                              />
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-5 w-5 shrink-0"
                                disabled={idx === 0}
                                onClick={() => handleMoveMacroStep(idx, -1)}
                                title={tr("auto_move_up", "上移")}
                              >
                                <ChevronUp className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-5 w-5 shrink-0"
                                disabled={idx === macroSteps.length - 1}
                                onClick={() => handleMoveMacroStep(idx, 1)}
                                title={tr("auto_move_down", "下移")}
                              >
                                <ChevronDown className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-5 w-5 text-destructive shrink-0"
                                disabled={macroSteps.length <= 1}
                                onClick={() =>
                                  setMacroSteps((prev) => prev.filter((_, i) => i !== idx))
                                }
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px]">
                              {step.type === "ascii" ? (
                                <select
                                  value={step.suffix}
                                  onChange={(e) =>
                                    setMacroSteps((prev) =>
                                      prev.map((s, i) =>
                                        i === idx
                                          ? { ...s, suffix: e.target.value as MacroStep["suffix"] }
                                          : s,
                                      ),
                                    )
                                  }
                                  className="h-5 rounded border border-border/60 bg-background px-1 text-[10px]"
                                >
                                  <option value="\r">CR (\r)</option>
                                  <option value="\r\n">CRLF (\r\n)</option>
                                  <option value="\n">LF (\n)</option>
                                  <option value="">None</option>
                                </select>
                              ) : (
                                <select
                                  value={step.checksumType || "none"}
                                  onChange={(e) =>
                                    setMacroSteps((prev) =>
                                      prev.map((s, i) =>
                                        i === idx
                                          ? { ...s, checksumType: e.target.value as SerialChecksumType }
                                          : s,
                                      ),
                                    )
                                  }
                                  className="h-5 rounded border border-border/60 bg-background px-1 text-[10px] max-w-[180px]"
                                >
                                  {SERIAL_CHECKSUM_OPTIONS.map((opt) => (
                                    <option key={opt.type} value={opt.type}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <label className="flex items-center gap-1 ml-auto text-muted-foreground">
                                <span>{tr("auto_delay_ms", "延时(ms)")}</span>
                                <Input
                                  type="number"
                                  min={0}
                                  value={step.delayMs}
                                  onChange={(e) =>
                                    setMacroSteps((prev) =>
                                      prev.map((s, i) =>
                                        i === idx ? { ...s, delayMs: Number(e.target.value) || 0 } : s,
                                      ),
                                    )
                                  }
                                  className="h-5 w-16 text-[10px] px-1"
                                />
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px] gap-1"
                          onClick={() =>
                            setMacroSteps((prev) => [...prev, createEmptyMacroStep(prev.length)])
                          }
                        >
                          <Plus className="h-3 w-3" />
                          {tr("auto_add_step", "添加步骤")}
                        </Button>
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 text-[11px]"
                            onClick={resetMacroForm}
                          >
                            {t("common_cancel")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="h-6 text-[11px]"
                            onClick={handleSaveMacro}
                          >
                            {t("common_save")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {macros.length === 0 ? (
                    <p className="text-center py-4 text-muted-foreground text-[11px]">
                      {t("auto_macros_empty")}
                    </p>
                  ) : (
                    macros.map((seq) => (
                      <div
                        key={seq.id}
                        className="flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-2.5 py-2"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-medium truncate">{seq.name}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {seq.steps.length} {t("auto_macro_steps")}
                            {(seq.loopCount ?? 1) > 1 ? ` · ×${seq.loopCount}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-[11px] gap-1"
                            onClick={() => handleRunMacro(seq)}
                          >
                            <Play className="h-3 w-3" />
                            {t("auto_run")}
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground"
                            title={t("common_edit")}
                            aria-label={t("common_edit")}
                            onClick={() => handleEditMacro(seq)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-destructive"
                            title={t("common_delete")}
                            onClick={() => handleDeleteMacro(seq.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
