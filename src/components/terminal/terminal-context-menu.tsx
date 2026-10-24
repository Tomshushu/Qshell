import { memo } from "react";
import {
  Copy,
  Clipboard,
  ClipboardPaste,
  Search,
  Trash2,
  ChevronRight,
  FileText,
  Lock,
  Sparkles,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { clampMenuToViewport } from "@/lib/menu-position";
import { useTranslation } from "@/i18n";
import type { ContextMenuState } from "./terminal-types";

export interface TerminalContextMenuProps {
  ctxMenu: ContextMenuState | null;
  isLightTerminal?: boolean;
  onClose: () => void;
  onCopy: () => void;
  onCopyAll: () => void;
  onPaste: () => void;
  onPasteSelection: () => void;
  onSearch: () => void;
  onClearScreen: () => void;
  onClearScrollback: () => void;
  onClearAll: () => void;
  onLockSession?: () => void;
  onToggleRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  onOpenLogFile: () => void;
  onOpenLogFolder: () => void;
  onChooseLogDirectory: () => void;
  onAIDiagnosis?: () => void;
  onAIDiagnoseRecent?: () => void;
  onAIExplainShell?: () => void;
  activeTermId: string | null;
  recordingTermIds: Set<string>;
  recordingPausedIds: Set<string>;
  isOpening: boolean;
}

export const TerminalContextMenu = memo(function TerminalContextMenu({
  ctxMenu,
  isLightTerminal = false,
  onClose,
  onCopy,
  onCopyAll,
  onPaste,
  onPasteSelection,
  onSearch,
  onClearScreen,
  onClearScrollback,
  onClearAll,
  onLockSession,
  onToggleRecording,
  onPauseRecording,
  onResumeRecording,
  onOpenLogFile,
  onOpenLogFolder,
  onChooseLogDirectory,
  onAIDiagnosis,
  onAIDiagnoseRecent,
  onAIExplainShell,
  activeTermId,
  recordingTermIds,
  recordingPausedIds,
  isOpening,
}: TerminalContextMenuProps) {
  const { t } = useTranslation();

  if (!ctxMenu) return null;

  // 边界检测：预估宽度 220（含右侧快捷键提示），高度 440（含 AI 项、清屏与录制子项，留足余量避免底部溢出）
  const pos = clampMenuToViewport(ctxMenu.x, ctxMenu.y, 220, 440);
  const isSubmenuLeft =
    typeof window !== "undefined" && pos.left + 220 + 210 > window.innerWidth;

  return (
    <div
      className={cn(
        "fixed z-50 min-w-[190px] rounded-xl select-none transition-all duration-150 animate-in fade-in zoom-in-95 p-1 terminal-context-menu",
        isLightTerminal
          ? "bg-white/90 text-slate-800 border border-slate-200/80 shadow-[0_12px_32px_-6px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.04)] backdrop-blur-xl"
          : "bg-[#13141f]/92 text-slate-100 border border-white/10 shadow-[0_16px_36px_-8px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl",
      )}
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 复制 */}
      <button
        type="button"
        className={cn(
          "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
          isLightTerminal
            ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
            : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
          !ctxMenu.hasSelection && "opacity-40 pointer-events-none",
        )}
        onClick={onCopy}
      >
        <Copy className="h-3.5 w-3.5 text-sky-400 shrink-0" />
        <span className="truncate tracking-tight font-sans text-[11.5px]">{t("tm_copy")}</span>
        <span className={cn("ml-auto text-[10px] font-mono tracking-tight", isLightTerminal ? "text-slate-400" : "text-slate-400/70")}>
          Ctrl+Shift+C
        </span>
      </button>

      {/* 复制全部输出 */}
      <button
        type="button"
        className={cn(
          "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
          isLightTerminal
            ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
            : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
        )}
        onClick={onCopyAll}
      >
        <Copy className="h-3.5 w-3.5 text-sky-400 shrink-0" />
        <span className="truncate tracking-tight font-sans text-[11.5px]">{t("tm_copy_all")}</span>
      </button>

      {/* 粘贴 */}
      <button
        type="button"
        className={cn(
          "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
          isLightTerminal
            ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
            : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
        )}
        onClick={onPaste}
      >
        <ClipboardPaste className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        <span className="truncate tracking-tight font-sans text-[11.5px]">{t("tm_paste")}</span>
        <span className={cn("ml-auto text-[10px] font-mono tracking-tight", isLightTerminal ? "text-slate-400" : "text-slate-400/70")}>
          Ctrl+Shift+V
        </span>
      </button>

      {/* 粘贴选中内容 */}
      <button
        type="button"
        className={cn(
          "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
          isLightTerminal
            ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
            : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
          !ctxMenu.hasSelection && "opacity-40 pointer-events-none",
        )}
        onClick={onPasteSelection}
      >
        <Clipboard className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        <span className="truncate tracking-tight font-sans text-[11.5px]">{t("tm_paste_selected")}</span>
      </button>

      {/* AI 诊断选中文本 */}
      {onAIDiagnosis && ctxMenu.hasSelection && (
        <>
          <div className={cn("h-px my-1 mx-2", isLightTerminal ? "bg-slate-200/80" : "bg-white/10")} />
          <button
            type="button"
            className={cn(
              "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
              isLightTerminal
                ? "text-purple-700 hover:bg-purple-50 hover:text-purple-900"
                : "text-purple-300 hover:bg-purple-500/15 hover:text-purple-200",
            )}
            onClick={onAIDiagnosis}
          >
            <Sparkles className="h-3.5 w-3.5 text-purple-400 shrink-0" />
            <span className="truncate tracking-tight font-sans text-[11.5px] font-medium">
              {t("tm_ai_diagnosis_menu") || "AI 诊断选中文本"}
            </span>
          </button>
        </>
      )}

      {/* AI 拆解选中文本指令 (Explain Shell) */}
      {onAIExplainShell && ctxMenu.hasSelection && (
        <button
          type="button"
          data-testid="terminal-menu-ai-explain-shell"
          className={cn(
            "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
            isLightTerminal
              ? "text-sky-700 hover:bg-sky-50 hover:text-sky-900"
              : "text-sky-300 hover:bg-sky-500/15 hover:text-sky-200",
          )}
          onClick={onAIExplainShell}
        >
          <Layers className="h-3.5 w-3.5 text-sky-400 shrink-0" />
          <span className="truncate tracking-tight font-sans text-[11.5px] font-medium">
            {t("tm_ai_explain_shell") || "拆解并解释指令 (Explain)"}
          </span>
        </button>
      )}

      {/* AI 诊断终端最新报错/输出 */}
      {onAIDiagnoseRecent && !ctxMenu.hasSelection && (
        <>
          <div className={cn("h-px my-1 mx-2", isLightTerminal ? "bg-slate-200/80" : "bg-white/10")} />
          <button
            type="button"
            data-testid="terminal-menu-ai-diagnose-recent"
            className={cn(
              "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
              isLightTerminal
                ? "text-purple-700 hover:bg-purple-50 hover:text-purple-900"
                : "text-purple-300 hover:bg-purple-500/15 hover:text-purple-200",
            )}
            onClick={onAIDiagnoseRecent}
          >
            <Sparkles className="h-3.5 w-3.5 text-purple-400 shrink-0" />
            <span className="truncate tracking-tight font-sans text-[11.5px] font-medium">
              {t("tm_ai_diagnosis_recent") || "AI 诊断终端报错/输出"}
            </span>
          </button>
        </>
      )}

      <div className={cn("h-px my-1 mx-2", isLightTerminal ? "bg-slate-200/80" : "bg-white/10")} />

      {/* 搜索 */}
      <button
        type="button"
        className={cn(
          "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
          isLightTerminal
            ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
            : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
        )}
        onClick={(e) => {
          e.stopPropagation();
          onSearch();
        }}
      >
        <Search className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        <span className="truncate tracking-tight font-sans text-[11.5px]">{t("tm_search")}</span>
        <span className={cn("ml-auto text-[10px] font-mono tracking-tight", isLightTerminal ? "text-slate-400" : "text-slate-400/70")}>
          Ctrl+Shift+F
        </span>
      </button>

      <div className={cn("h-px my-1 mx-2", isLightTerminal ? "bg-slate-200/80" : "bg-white/10")} />

      {/* 清屏：悬停展开子菜单 */}
      <div className="relative group">
        <button
          type="button"
          className={cn(
            "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
            isLightTerminal
              ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
              : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Trash2 className="h-3.5 w-3.5 text-rose-400 shrink-0" />
          <span className="truncate tracking-tight font-sans text-[11.5px]">{t("tm_clear")}</span>
          <ChevronRight className="h-3.5 w-3.5 ml-auto opacity-60" />
        </button>
        <div
          className={cn(
            "hidden group-hover:block absolute top-0 -mt-1 min-w-[190px] rounded-xl overflow-hidden select-none transition-all duration-150 animate-in fade-in zoom-in-95 p-1 z-50",
            isSubmenuLeft ? "right-full" : "left-full",
            isLightTerminal
              ? "bg-white/95 text-slate-800 border border-slate-200/80 shadow-[0_12px_32px_-6px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.04)] backdrop-blur-xl"
              : "bg-[#13141f]/95 text-slate-100 border border-white/10 shadow-[0_16px_36px_-8px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl",
          )}
        >
          <button
            type="button"
            className={cn(
              "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
              isLightTerminal
                ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
                : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
            )}
            onClick={onClearScreen}
          >
            <span className="truncate tracking-tight font-sans text-[11.5px]">{t("tm_clear_screen")}</span>
            <span className={cn("ml-auto text-[10px] font-mono tracking-tight", isLightTerminal ? "text-slate-400" : "text-slate-400/70")}>
              L
            </span>
          </button>
          <button
            type="button"
            className={cn(
              "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
              isLightTerminal
                ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
                : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
            )}
            onClick={onClearScrollback}
          >
            <span className="truncate tracking-tight font-sans text-[11.5px]">{t("tm_clear_scrollback")}</span>
            <span className={cn("ml-auto text-[10px] font-mono tracking-tight", isLightTerminal ? "text-slate-400" : "text-slate-400/70")}>
              O
            </span>
          </button>
          <button
            type="button"
            className={cn(
              "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
              isLightTerminal
                ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
                : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
            )}
            onClick={onClearAll}
          >
            <span className="truncate tracking-tight font-sans text-[11.5px]">{t("tm_clear_all")}</span>
            <span className={cn("ml-auto text-[10px] font-mono tracking-tight", isLightTerminal ? "text-slate-400" : "text-slate-400/70")}>
              N
            </span>
          </button>
        </div>
      </div>

      <div className={cn("h-px my-1 mx-2", isLightTerminal ? "bg-slate-200/80" : "bg-white/10")} />

      {/* 锁定会话 */}
      {onLockSession && (
        <button
          type="button"
          className={cn(
            "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left text-amber-500/90 hover:text-amber-500",
            isLightTerminal ? "hover:bg-amber-500/10" : "hover:bg-amber-500/15",
          )}
          onClick={onLockSession}
        >
          <Lock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span className="truncate tracking-tight font-sans text-[11.5px]">{t("tm_lock_session") || "锁定会话"}</span>
          <span className={cn("ml-auto text-[10px] font-mono tracking-tight", isLightTerminal ? "text-amber-600/70" : "text-amber-400/70")}>
            Ctrl+Alt+L
          </span>
        </button>
      )}

      {onLockSession && (
        <div className={cn("h-px my-1 mx-2", isLightTerminal ? "bg-slate-200/80" : "bg-white/10")} />
      )}

      {/* 日志：悬停展开子菜单 */}
      <div className="relative group">
        <button
          type="button"
          className={cn(
            "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
            isLightTerminal
              ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
              : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <FileText className="h-3.5 w-3.5 text-violet-400 shrink-0" />
          <span className="truncate tracking-tight font-sans text-[11.5px]">{t("tm_log")}</span>
          <ChevronRight className="h-3.5 w-3.5 ml-auto opacity-60" />
        </button>
        <div
          className={cn(
            "hidden group-hover:block absolute top-0 -mt-1 min-w-[200px] rounded-xl overflow-hidden select-none transition-all duration-150 animate-in fade-in zoom-in-95 p-1 z-50",
            isSubmenuLeft ? "right-full" : "left-full",
            isLightTerminal
              ? "bg-white/95 text-slate-800 border border-slate-200/80 shadow-[0_12px_32px_-6px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.04)] backdrop-blur-xl"
              : "bg-[#13141f]/95 text-slate-100 border border-white/10 shadow-[0_16px_36px_-8px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl",
          )}
        >
          <button
            type="button"
            className={cn(
              "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
              isLightTerminal
                ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
                : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
            )}
            onClick={onToggleRecording}
          >
            <span className="truncate tracking-tight font-sans text-[11.5px]">
              {activeTermId && recordingTermIds.has(activeTermId)
                ? t("recording_stop_menu")
                : t("recording_start_menu")}
            </span>
          </button>
          <button
            type="button"
            className={cn(
              "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
              activeTermId &&
                recordingTermIds.has(activeTermId) &&
                !recordingPausedIds.has(activeTermId)
                ? isLightTerminal
                  ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
                  : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100"
                : "opacity-40 pointer-events-none",
            )}
            onClick={onPauseRecording}
          >
            <span className="truncate tracking-tight font-sans text-[11.5px]">{t("recording_pause_menu")}</span>
          </button>
          <button
            type="button"
            className={cn(
              "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
              activeTermId && recordingPausedIds.has(activeTermId)
                ? isLightTerminal
                  ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
                  : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100"
                : "opacity-40 pointer-events-none",
            )}
            onClick={onResumeRecording}
          >
            <span className="truncate tracking-tight font-sans text-[11.5px]">{t("recording_resume_menu")}</span>
          </button>

          <div className={cn("h-px my-1 mx-2", isLightTerminal ? "bg-slate-200/80" : "bg-white/10")} />

          <button
            type="button"
            disabled={isOpening}
            className={cn(
              "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
              isOpening
                ? "opacity-50 pointer-events-none"
                : isLightTerminal
                  ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
                  : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
            )}
            onClick={onOpenLogFile}
          >
            <span className="truncate tracking-tight font-sans text-[11.5px]">{t("recording_open_file")}</span>
          </button>
          <button
            type="button"
            disabled={isOpening}
            className={cn(
              "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
              isOpening
                ? "opacity-50 pointer-events-none"
                : isLightTerminal
                  ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
                  : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
            )}
            onClick={onOpenLogFolder}
          >
            <span className="truncate tracking-tight font-sans text-[11.5px]">{t("recording_open_folder")}</span>
          </button>
          <button
            type="button"
            className={cn(
              "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
              isLightTerminal
                ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
                : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
            )}
            onClick={onChooseLogDirectory}
          >
            <span className="truncate tracking-tight font-sans text-[11.5px]">{t("recording_choose_dir")}</span>
          </button>
        </div>
      </div>
    </div>
  );
});
