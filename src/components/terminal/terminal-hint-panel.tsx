import React from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import type { HintItem } from "@/lib/command-intelligence/completion-engine";
import { renderHintItemIcon } from "./terminal-utils";

export interface TerminalHintPanelProps {
  visible: boolean;
  hints: HintItem[];
  hintIndex: number;
  isLightTerminal: boolean;
  style?: React.CSSProperties;
  onSelectHint: (hint: HintItem) => void;
  onHoverHint: (index: number) => void;
}

export function TerminalHintPanel({
  visible,
  hints,
  hintIndex,
  isLightTerminal,
  style,
  onSelectHint,
  onHoverHint,
}: TerminalHintPanelProps) {
  const { t } = useTranslation();

  if (!visible || hints.length === 0) return null;

  return (
    <div
      className={cn(
        "absolute z-30 flex flex-col w-[340px] max-w-[calc(100vw-32px)] rounded-xl overflow-hidden select-none transition-all duration-150 animate-in fade-in zoom-in-95 p-1",
        isLightTerminal
          ? "bg-white/90 text-slate-800 border border-slate-200/80 shadow-[0_12px_32px_-6px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.04)] backdrop-blur-xl"
          : "bg-[#13141f]/92 text-slate-100 border border-white/10 shadow-[0_16px_36px_-8px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl",
      )}
      style={style}
    >
      <div className="flex-1 min-h-0 overflow-y-auto max-h-[inherit] py-0.5 space-y-0.5 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
        {hints.map((hint, i) => {
          const prevKind = i > 0 ? hints[i - 1].kind : null;
          const showHistDivider =
            prevKind === "history" && hint.kind !== "history";
          const isSelected = i === hintIndex;

          return (
            <div key={`${hint.kind}-${hint.label}-${i}`}>
              {showHistDivider && (
                <div
                  className={cn(
                    "h-px my-1 mx-2",
                    isLightTerminal ? "bg-slate-200/80" : "bg-white/10",
                  )}
                />
              )}
              <div
                data-hint-idx={i}
                className={cn(
                  "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono",
                  isSelected
                    ? isLightTerminal
                      ? "bg-slate-900/10 text-slate-900 font-semibold shadow-xs"
                      : "bg-white/15 text-white font-semibold shadow-xs ring-1 ring-white/10"
                    : isLightTerminal
                      ? "text-slate-700 hover:bg-slate-900/[0.05] hover:text-slate-900"
                      : "text-slate-300 hover:bg-white/[0.06] hover:text-slate-100",
                  hint.disabled && !isSelected && "opacity-40",
                )}
                title={
                  hint.disabled
                    ? (hint.disabledReason ?? t("tm_hint_not_applicable"))
                    : hint.desc || undefined
                }
                onClick={() => {
                  if (hint.disabled) return;
                  onSelectHint(hint);
                }}
                onMouseEnter={() => onHoverHint(i)}
              >
                {/* 语义图标 */}
                {renderHintItemIcon(hint)}

                {/* 候选主词条 */}
                <span className="truncate shrink-0 max-w-[65%] tracking-tight">
                  {hint.label}
                </span>

                {/* 参数占位提示（如 <file> / <msg>） */}
                {hint.requiresValue && hint.valueHint && (
                  <span
                    className={cn(
                      "text-[10.5px] shrink-0 font-mono",
                      isSelected
                        ? "opacity-80"
                        : "opacity-45 text-muted-foreground",
                    )}
                  >
                    {hint.valueHint}
                  </span>
                )}

                {/* 说明描述（靠右淡色展示，不喧宾夺主） */}
                {(hint.desc || hint.aliasOf) && (
                  <span
                    className={cn(
                      "text-[10.5px] truncate flex-1 text-right ml-1 font-sans select-none",
                      isSelected
                        ? isLightTerminal
                          ? "text-slate-600"
                          : "text-slate-300/80"
                        : isLightTerminal
                          ? "text-slate-400"
                          : "text-slate-400/60",
                    )}
                  >
                    {hint.aliasOf
                      ? `alias → ${hint.aliasOf}`
                      : hint.disabled && hint.disabledReason
                        ? hint.disabledReason
                        : hint.desc}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
