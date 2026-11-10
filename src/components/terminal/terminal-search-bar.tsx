import React, { useRef, useEffect, memo } from "react";
import { Button } from "@/components/ui/button";
import { Search, Loader2, ChevronUp, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import type { SearchState } from "./terminal-types";

export interface TerminalSearchBarProps {
  open: boolean;
  searchText: string;
  onSearchTextChange: (text: string) => void;
  searchState: SearchState;
  searchRegex: boolean;
  onToggleRegex: () => void;
  searchCaseSensitive: boolean;
  onToggleCaseSensitive: () => void;
  searchWholeWord: boolean;
  onToggleWholeWord: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  onFindPrev: () => void;
  onFindNext: () => void;
  onClose: () => void;
}

export const TerminalSearchBar = memo(function TerminalSearchBar({
  open,
  searchText,
  onSearchTextChange,
  searchState,
  searchRegex,
  onToggleRegex,
  searchCaseSensitive,
  onToggleCaseSensitive,
  searchWholeWord,
  onToggleWholeWord,
  onKeyDown,
  onFocus,
  onFindPrev,
  onFindNext,
  onClose,
}: TerminalSearchBarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  // 展开搜索栏时强制聚焦并全选搜索框文本，确保能直接打字
  useEffect(() => {
    if (open) {
      const focusAndSelect = () => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      };
      focusAndSelect();
      const raf = requestAnimationFrame(focusAndSelect);
      const timer = setTimeout(focusAndSelect, 50);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
      };
    }
  }, [open]);

  if (!open) return null;

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();

    // Escape 键关闭搜索栏并将焦点无缝返还给终端
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    // Alt+C 快捷切换区分大小写
    if (e.altKey && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      onToggleCaseSensitive();
      return;
    }

    // Alt+W 快捷切换整词匹配
    if (e.altKey && (e.key === "w" || e.key === "W")) {
      e.preventDefault();
      onToggleWholeWord();
      return;
    }

    // Alt+R 快捷切换正则匹配
    if (e.altKey && (e.key === "r" || e.key === "R")) {
      e.preventDefault();
      onToggleRegex();
      return;
    }

    // Enter 键查找下一个，Shift+Enter 键查找上一个（对标 VS Code / Windows Terminal 标准）
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (e.shiftKey) {
        onFindPrev();
      } else {
        onFindNext();
      }
      return;
    }

    onKeyDown(e);
  };

  return (
    <div
      className={cn(
        "absolute top-2 right-2 z-30 flex items-center gap-1.5 px-2.5 py-1 rounded-xl select-none",
        "border border-slate-200/90 dark:border-white/15",
        "bg-white/95 dark:bg-zinc-900/95 backdrop-blur-2xl",
        "shadow-[0_14px_36px_-6px_rgba(0,0,0,0.18),inset_0_1px_0_0_rgba(255,255,255,0.9)] dark:shadow-[0_20px_40px_-8px_rgba(0,0,0,0.8),inset_0_1px_0_0_rgba(255,255,255,0.12)]",
        "terminal-search-bar animate-in fade-in-0 zoom-in-95 origin-top-right duration-100"
      )}
      data-terminal-search="true"
      onMouseDown={(e) => {
        e.stopPropagation();
        const target = e.target as HTMLElement | null;
        if (target?.closest("button")) return;
        // 点击非 input 区域时阻止浏览器默认行为，确保聚焦不中断
        if (target !== inputRef.current) {
          e.preventDefault();
        }
        inputRef.current?.focus();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        const target = e.target as HTMLElement | null;
        if (!target?.closest("button")) {
          inputRef.current?.focus();
        }
      }}
    >
      {/* 搜索图标与无缝内联输入框 */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <Search className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0 ml-0.5" />
        <input
          ref={inputRef}
          type="text"
          value={searchText}
          onChange={(e) => onSearchTextChange(e.target.value)}
          onFocus={onFocus}
          onKeyDown={handleInputKeyDown}
          placeholder={t("tm_search_placeholder") || "搜索..."}
          className="h-6 w-44 sm:w-52 text-xs bg-transparent border-0 outline-none text-foreground placeholder:text-muted-foreground/45 font-sans focus:outline-none"
          autoFocus
        />
      </div>

      {/* 匹配结果计数指示胶囊 */}
      {searchText && (
        <span
          className={cn(
            "text-[10.5px] font-mono tabular-nums px-1.5 py-0.5 rounded-md whitespace-nowrap min-w-[34px] text-center flex items-center justify-center gap-1 shrink-0 border transition-colors",
            searchState.resultCount > 0
              ? "bg-muted/70 text-muted-foreground border-border/50"
              : searchState.isSearching
                ? "bg-muted/40 text-muted-foreground/60 border-border/30"
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25 font-medium"
          )}
        >
          {searchState.isSearching && (
            <Loader2 className="h-2.5 w-2.5 animate-spin text-primary shrink-0" />
          )}
          {searchState.resultCount > 0
            ? `${searchState.resultIndex + 1}/${searchState.resultCount}${searchState.isCapped ? "+" : ""}`
            : searchState.isSearching
              ? "..."
              : "0/0"}
        </span>
      )}

      {/* 搜索选项微型切换胶囊组 (.* / Aa / \\b) */}
      <div className="flex items-center gap-0.5 shrink-0 bg-muted/40 dark:bg-white/[0.04] p-0.5 rounded-lg border border-border/40">
        {/* 正则模式切换按钮 */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-5.5 w-5.5 rounded-md flex-shrink-0 transition-all cursor-pointer",
            searchRegex
              ? "bg-primary/20 text-primary dark:text-primary-foreground font-semibold shadow-2xs"
              : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/80"
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggleRegex}
          title={
            searchRegex
              ? `${t("tm_search_regex_on")} (Alt+R)`
              : `${t("tm_search_regex_off")} (Alt+R)`
          }
        >
          <span className="font-mono text-[11px] font-bold leading-none tracking-tighter">.*</span>
        </Button>

        {/* 区分大小写切换按钮 */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-5.5 w-5.5 rounded-md flex-shrink-0 transition-all cursor-pointer",
            searchCaseSensitive
              ? "bg-primary/20 text-primary dark:text-primary-foreground font-semibold shadow-2xs"
              : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/80"
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggleCaseSensitive}
          title={`${t("tm_search_case_sensitive")} (Alt+C)`}
        >
          <span className="font-sans text-[11px] font-semibold leading-none">Aa</span>
        </Button>

        {/* 全词匹配切换按钮 */}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-5.5 w-5.5 rounded-md flex-shrink-0 transition-all cursor-pointer",
            searchWholeWord
              ? "bg-primary/20 text-primary dark:text-primary-foreground font-semibold shadow-2xs"
              : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/80"
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onToggleWholeWord}
          title={`${t("tm_search_whole_word")} (Alt+W)`}
        >
          <span className="font-mono text-[11px] font-medium leading-none">\b</span>
        </Button>
      </div>

      {/* 视觉微细分割线 */}
      <div className="h-3.5 w-px bg-border/60 mx-0.5 shrink-0" />

      {/* 结果翻页导航按钮组 */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-5.5 w-5.5 rounded-md flex-shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/80 active:scale-95 transition-all cursor-pointer"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onFindPrev}
          title={`${t("tm_search_prev")} (Shift+Enter)`}
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5.5 w-5.5 rounded-md flex-shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/80 active:scale-95 transition-all cursor-pointer"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onFindNext}
          title={`${t("tm_search_next")} (Enter)`}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* 视觉微细分割线 */}
      <div className="h-3.5 w-px bg-border/60 mx-0.5 shrink-0" />

      {/* 关闭按钮 */}
      <Button
        variant="ghost"
        size="icon"
        className="h-5.5 w-5.5 rounded-md flex-shrink-0 text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 active:scale-95 transition-all cursor-pointer"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClose}
        title={`${t("tm_search_close")} (Esc)`}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
});
