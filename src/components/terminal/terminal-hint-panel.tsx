import React, { memo } from "react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import type { HintItem } from "@/lib/command-intelligence/completion-engine";
import { renderHintItemIcon } from "./terminal-utils";

export interface TerminalHintPanelProps {
  visible: boolean;
  hints: HintItem[];
  hintIndex: number;
  isLightTerminal: boolean;
  activeUsage?: string;
  style?: React.CSSProperties;
  onSelectHint: (hint: HintItem) => void;
  onHoverHint: (index: number) => void;
}

export const TerminalHintPanel = memo(function TerminalHintPanel({
  visible,
  hints,
  hintIndex,
  isLightTerminal,
  activeUsage,
  style,
  onSelectHint,
  onHoverHint,
}: TerminalHintPanelProps) {
  const { t } = useTranslation();

  if (!visible || hints.length === 0) return null;

  const selectedHint = hints[Math.min(Math.max(0, hintIndex), hints.length - 1)];
  const usageText =
    selectedHint?.usage ||
    activeUsage ||
    selectedHint?.examples?.[0]?.cmd;

  return (
    <div
      className={cn(
        "absolute z-30 flex flex-col w-[360px] max-w-[calc(100vw-32px)] rounded-xl overflow-hidden select-none transition-all duration-150 animate-in fade-in zoom-in-95 p-1",
        isLightTerminal
          ? "bg-white/92 text-slate-800 border border-slate-200/80 shadow-[0_12px_32px_-6px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.04)] backdrop-blur-xl"
          : "bg-[#13141f]/94 text-slate-100 border border-white/10 shadow-[0_16px_36px_-8px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl",
      )}
      style={style}
    >
      <div className="flex-1 min-h-0 overflow-y-auto max-h-[inherit] py-0.5 space-y-0.5 scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent">
        {hints.map((hint, i) => {
          const prevKind = i > 0 ? hints[i - 1].kind : null;
          const isPrevPredictive = prevKind === "history" || prevKind === "markov";
          const isCurPredictive = hint.kind === "history" || hint.kind === "markov";
          const showHistDivider = isPrevPredictive && !isCurPredictive;
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
                onMouseEnter={() => {
                  if (hint.disabled) return;
                  onHoverHint(i);
                }}
              >
                {/* 语义图标 */}
                {renderHintItemIcon(hint)}

                {/* 候选主词条：自适应伸缩并在超长时优雅省略，确保右侧频次/说明永远有展示空间 */}
                <span className="truncate min-w-0 flex-1 tracking-tight">
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

                {/* 语义徽标（报错修复 / 最近操作 / 当前目录 / 连招） */}
                {hint.badge && (
                  <span
                    className={cn(
                      "text-[9.5px] px-1.5 py-0.2 rounded font-sans shrink-0 leading-4",
                      hint.badge === "报错修复"
                        ? isLightTerminal
                          ? "bg-amber-500/15 text-amber-700"
                          : "bg-amber-500/20 text-amber-300"
                        : hint.badge === "最近操作" || hint.badge === "当前目录"
                          ? isLightTerminal
                            ? "bg-emerald-500/15 text-emerald-700"
                            : "bg-emerald-500/20 text-emerald-300"
                          : isLightTerminal
                            ? "bg-indigo-500/12 text-indigo-700"
                            : "bg-indigo-500/20 text-indigo-300",
                    )}
                  >
                    {hint.badge}
                  </span>
                )}

                {/* 说明描述（已有 badge 时自动剥离重复的前缀词，超过 99 次封顶显示 99+ 次） */}
                {(hint.desc || hint.aliasOf) && (
                  <span
                    className={cn(
                      "text-[10.5px] truncate shrink-0 max-w-[42%] text-right ml-1 font-sans select-none",
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
                        : hint.badge
                          ? hint.desc.replace(
                              /^(?:报错修复|连招推荐|习惯连招|最近操作|当前目录|同主机)\s*·\s*/,
                              "",
                            )
                          : hint.desc}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部 Usage 签名与快捷键轻量提示栏 */}
      <div
        className={cn(
          "flex items-center justify-between gap-2 px-2.5 py-1 mt-0.5 border-t text-[10px] select-none",
          isLightTerminal
            ? "border-slate-200/70 text-slate-500"
            : "border-white/8 text-slate-400/75",
        )}
      >
        <span className="truncate font-mono flex-1 min-w-0">
          {usageText ? `用法: ${usageText}` : selectedHint?.desc || ""}
        </span>
        <span className="shrink-0 font-sans opacity-75">
          Tab 补全 · Esc 关闭
        </span>
      </div>
    </div>
  );
});
