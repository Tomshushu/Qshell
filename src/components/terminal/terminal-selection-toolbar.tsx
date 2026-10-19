import React, { useState, useEffect, useRef } from "react";
import { Copy, ClipboardPaste, Search, Globe, Check, Sparkles, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import { playSound, SoundType } from "@/lib/sound";
import { useAIStore } from "@/store/ai-store";

export interface TerminalSelectionToolbarProps {
  visible: boolean;
  x: number;
  y: number;
  selectedText: string;
  isLightTerminal?: boolean;
  onClose: () => void;
  onCopy: () => void;
  onPasteSelection: () => void;
  onSearch: () => void;
}

const openExternalUrl = async (url: string) => {
  try {
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } else {
      window.open(url, "_blank");
    }
  } catch {
    window.open(url, "_blank");
  }
};

/**
 * 边界吸附计算：弹框左上角与选中区域右边对齐，并向下展开
 */
function clampToolbarPosition(x: number, y: number, width = 148, height = 205) {
  const padding = 10;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1000;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  // 弹框左边缘与选区右边缘对齐（留 6px 呼吸间隙）
  let left = x + 6;
  // 如果超出右视口，自动摆放在选区左侧
  if (left + width > vw - padding) {
    left = Math.max(padding, x - width - 6);
  }
  left = Math.max(padding, Math.min(left, vw - width - padding));

  // 弹框左上角从选区当前行位置顺着向下展开
  let top = y + 4;
  // 底部溢出处理：如果底部放不下，则向上翻折
  if (top + height > vh - padding) {
    top = Math.max(padding, y - height - 4);
  }
  // 视口边界严格夹紧（防止超出版界或被完全隐藏）
  top = Math.max(padding, Math.min(top, vh - height - padding));

  return { left, top };
}

export function TerminalSelectionToolbar({
  visible,
  x,
  y,
  selectedText,
  isLightTerminal = false,
  onClose,
  onCopy,
  onPasteSelection,
  onSearch,
}: TerminalSelectionToolbarProps) {
  const { t } = useTranslation();
  const enableAiGlobal = useAIStore((s) => s.enableAiGlobal);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  if (!visible || !selectedText) return null;

  const pos = clampToolbarPosition(x, y);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCopy();
    setCopied(true);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      onClose();
    }, 450);
  };

  const handlePaste = (e: React.MouseEvent) => {
    e.stopPropagation();
    playSound(SoundType.Click);
    onPasteSelection();
    onClose();
  };

  const handleSearch = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSearch();
    onClose();
  };

  const handleWebSearch = (e: React.MouseEvent) => {
    e.stopPropagation();
    playSound(SoundType.Click);
    const query = selectedText.trim().slice(0, 300);
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    void openExternalUrl(url);
    onClose();
  };

  const handleAIDiagnosis = (e: React.MouseEvent) => {
    e.stopPropagation();
    playSound(SoundType.Click);
    useAIStore.getState().openDiagnosis(selectedText);
    onClose();
  };

  const handleExplainShell = (e: React.MouseEvent) => {
    e.stopPropagation();
    playSound(SoundType.Click);
    useAIStore.getState().openExplainShell(selectedText);
    onClose();
  };

  return (
    <div
      role="toolbar"
      aria-label="Selection Toolbar"
      className={cn(
        "fixed z-50 flex flex-col w-[148px] rounded-xl overflow-hidden select-none transition-all duration-150 animate-in fade-in zoom-in-95 p-1",
        isLightTerminal
          ? "bg-white/90 text-slate-800 border border-slate-200/80 shadow-[0_12px_32px_-6px_rgba(0,0,0,0.18),0_0_0_1px_rgba(0,0,0,0.04)] backdrop-blur-xl"
          : "bg-[#13141f]/92 text-slate-100 border border-white/10 shadow-[0_16px_36px_-8px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl",
      )}
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 复制 */}
      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
          isLightTerminal
            ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
            : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
        )}
        title={t("tm_copy") || "复制"}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0 animate-in zoom-in-50" />
        ) : (
          <Copy className="h-3.5 w-3.5 text-sky-400 shrink-0" />
        )}
        <span
          className={cn(
            "truncate tracking-tight font-sans text-[11.5px]",
            copied && "text-emerald-400 font-semibold",
          )}
        >
          {copied ? (t("tm_copied") || "已复制") : (t("tm_copy") || "复制")}
        </span>
      </button>

      {/* 粘贴至终端命令行 */}
      <button
        type="button"
        onClick={handlePaste}
        className={cn(
          "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
          isLightTerminal
            ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
            : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
        )}
        title={t("tm_paste_selection_hint") || "将选中内容直接粘贴到命令行"}
      >
        <ClipboardPaste className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        <span className="truncate tracking-tight font-sans text-[11.5px]">
          {t("tm_paste_to_shell") || "粘贴至终端"}
        </span>
      </button>

      {/* AI 智能诊断 */}
      {enableAiGlobal && (
        <button
          type="button"
          onClick={handleAIDiagnosis}
          className={cn(
            "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
            isLightTerminal
              ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
              : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
          )}
          title={t("tm_ai_diagnosis_tooltip")}
        >
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="truncate tracking-tight font-sans text-[11.5px] font-medium text-primary">
            {t("tm_ai_diagnose")}
          </span>
        </button>
      )}

      {/* 拆解复合指令 (Explain Shell) */}
      {enableAiGlobal && (
        <button
          type="button"
          data-testid="selection-toolbar-explain-shell"
          onClick={handleExplainShell}
          className={cn(
            "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
            isLightTerminal
              ? "text-sky-700 hover:bg-sky-50 hover:text-sky-900"
              : "text-sky-300 hover:bg-sky-500/15 hover:text-sky-200",
          )}
          title={t("tm_ai_explain_shell_tooltip") || "将选中指令进行乐高积木式拆解与管道流转分析"}
        >
          <Layers className="h-3.5 w-3.5 text-sky-400 shrink-0" />
          <span className="truncate tracking-tight font-sans text-[11.5px] font-medium text-sky-600 dark:text-sky-400">
            {t("tm_ai_explain_shell") || "拆解指令 (Explain)"}
          </span>
        </button>
      )}

      {/* 区分核心操作与辅助工具的分隔线，完全继承 HintPanel 风格 */}
      <div
        className={cn(
          "h-px my-1 mx-2",
          isLightTerminal ? "bg-slate-200/80" : "bg-white/10",
        )}
      />

      {/* 在终端中搜索 */}
      <button
        type="button"
        onClick={handleSearch}
        className={cn(
          "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
          isLightTerminal
            ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
            : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
        )}
        title={t("tm_search_tooltip")}
      >
        <Search className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        <span className="truncate tracking-tight font-sans text-[11.5px]">
          {t("tm_search")}
        </span>
      </button>

      {/* 网页搜索 */}
      <button
        type="button"
        onClick={handleWebSearch}
        className={cn(
          "group flex items-center gap-2 px-2.5 py-1.5 rounded-lg mx-0.5 cursor-pointer transition-colors text-xs font-mono w-full text-left",
          isLightTerminal
            ? "text-slate-700 hover:bg-slate-900/[0.06] hover:text-slate-900"
            : "text-slate-300 hover:bg-white/[0.08] hover:text-slate-100",
        )}
        title={t("tm_web_search_tooltip")}
      >
        <Globe className="h-3.5 w-3.5 text-purple-400 shrink-0" />
        <span className="truncate tracking-tight font-sans text-[11.5px]">
          {t("tm_web_search")}
        </span>
      </button>
    </div>
  );
}
