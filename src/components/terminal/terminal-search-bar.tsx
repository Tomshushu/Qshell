import React, { useRef, useEffect, memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Loader2, Regex, ArrowUp, ArrowDown, X } from "lucide-react";
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

  return (
    <div
      className="absolute top-2 right-2 z-10 flex items-center gap-1 bg-card border rounded-xl shadow-lg dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_12px_28px_-4px_rgba(0,0,0,0.7)] ring-1 ring-white/5 backdrop-blur-md p-1.5 terminal-search-bar"
      data-terminal-search="true"
      onMouseDown={(e) => {
        e.stopPropagation();
        const target = e.target as HTMLElement | null;
        if (!target?.closest("button")) {
          inputRef.current?.focus();
        }
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
      <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      <Input
        ref={inputRef}
        value={searchText}
        onChange={(e) => onSearchTextChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={(e) => {
          e.stopPropagation();
          // Escape 键关闭搜索栏并将焦点无缝返还给终端
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
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
        }}
        placeholder={t("tm_search_placeholder")}
        className="h-6 w-48 text-xs border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
        autoFocus
      />
      {searchText && (
        <span className="text-[10px] font-mono tabular-nums text-muted-foreground whitespace-nowrap min-w-[40px] text-center flex items-center justify-center gap-1">
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
      {/* E7：正则模式切换按钮 */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-5 w-5 flex-shrink-0",
          searchRegex
            ? "bg-accent text-emerald-400"
            : "text-muted-foreground",
        )}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggleRegex}
        title={
          searchRegex ? t("tm_search_regex_on") : t("tm_search_regex_off")
        }
      >
        <Regex className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-5 w-5 flex-shrink-0 text-[10px] font-semibold",
          searchCaseSensitive
            ? "bg-accent text-foreground"
            : "text-muted-foreground",
        )}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggleCaseSensitive}
        title={t("tm_search_case_sensitive")}
      >
        Aa
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-5 w-5 flex-shrink-0 text-[10px] font-semibold",
          searchWholeWord
            ? "bg-accent text-foreground"
            : "text-muted-foreground",
        )}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggleWholeWord}
        title={t("tm_search_whole_word")}
      >
        \b
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 flex-shrink-0"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onFindPrev}
        title={t("tm_search_prev")}
      >
        <ArrowUp className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 flex-shrink-0"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onFindNext}
        title={t("tm_search_next")}
      >
        <ArrowDown className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 flex-shrink-0"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClose}
        title={t("tm_search_close")}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
});
