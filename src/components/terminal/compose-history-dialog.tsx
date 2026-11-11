import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAppStore } from "@/store";
import { useTranslation } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import {
  Clock,
  Trash2,
  Copy,
  CornerDownLeft,
  X,
  FileCode,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ComposeHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (command: string) => void;
}

export function ComposeHistoryDialog({
  open,
  onOpenChange,
  onSelect,
}: ComposeHistoryDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const history = useAppStore((state) => state.terminalComposeHistory);
  const removeHistory = useAppStore((state) => state.removeTerminalComposeHistory);
  const clearHistory = useAppStore((state) => state.clearTerminalComposeHistory);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search input when dialog opens
  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      setSearchQuery("");
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }
  }, [open]);

  // Filter history based on search query
  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return history;
    const q = searchQuery.toLowerCase();
    return history.filter((item) => item.toLowerCase().includes(q));
  }, [history, searchQuery]);

  const handleCopy = async (cmd: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(cmd);
      toast.success(t("compose_history_copied") || "已复制到剪贴板");
    } catch {
      toast.error("复制失败");
    }
  };

  const handleDeleteItem = (cmd: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeHistory(cmd);
    toast.success(t("compose_history_deleted") || "已删除该条历史记录");
  };

  const handleConfirmClearAll = () => {
    clearHistory();
    setClearConfirmOpen(false);
    toast.success(t("compose_history_cleared") || "已清空所有历史撰写记录");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (filteredHistory.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % filteredHistory.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + filteredHistory.length) % filteredHistory.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const current = filteredHistory[activeIndex];
      if (current) {
        onSelect(current);
        onOpenChange(false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="max-w-2xl w-[92vw] sm:max-w-2xl p-0 gap-0 overflow-hidden rounded-2xl border border-border/70 bg-background/95 dark:bg-zinc-900/95 backdrop-blur-2xl shadow-2xl flex flex-col"
        >
          <DialogTitle className="sr-only">
            {t("compose_history_title")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            搜索与管理历史撰写命令
          </DialogDescription>

          {/* 顶栏：Raycast 风格一体化搜索栏 */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-muted/15 shrink-0">
            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/10 text-amber-500 shrink-0">
              <Clock className="h-4 w-4" />
            </div>

            {/* 沉浸式搜索输入 */}
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                t("compose_history_search_placeholder") ||
                "搜索历史撰写... (↑↓ 选择，Enter 填入)"
              }
              className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/50 text-foreground outline-none border-none ring-0 focus:outline-none"
            />

            <div className="flex items-center gap-2 shrink-0">
              {history.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setClearConfirmOpen(true)}
                  className="h-7 px-2.5 text-xs gap-1.5 rounded-lg border-border/60 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-all cursor-pointer shadow-2xs font-normal text-muted-foreground"
                  title="全部删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>全部删除</span>
                </Button>
              )}

              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                title="关闭 (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 列表展示区 */}
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1 scrollbar-thin max-h-[420px]">
            {filteredHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <div className="p-3 rounded-xl bg-muted/30 mb-3 border border-border/30">
                  <Clock className="h-5 w-5 opacity-40" />
                </div>
                <p className="text-sm font-medium text-foreground/75">
                  {searchQuery ? "未找到匹配的历史撰写" : t("compose_history_empty")}
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
                  {searchQuery
                    ? "可以尝试更换搜索关键词查找命令"
                    : "在下方撰写栏发送命令后将自动保存在此"}
                </p>
              </div>
            ) : (
              filteredHistory.map((item, idx) => {
                const isSelected = idx === activeIndex;
                const lines = item.split(/\r?\n/);
                const isMultiLine = lines.length > 1;
                const firstLine = lines[0] || "";

                return (
                  <div
                    key={`${idx}-${item.slice(0, 20)}`}
                    onClick={() => {
                      onSelect(item);
                      onOpenChange(false);
                    }}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={cn(
                      "group relative flex items-center justify-between gap-3 px-3 py-2 rounded-xl cursor-pointer select-none transition-colors",
                      isSelected
                        ? "bg-black/[0.08] dark:bg-white/[0.12] shadow-2xs text-foreground"
                        : "hover:bg-black/[0.035] dark:hover:bg-white/[0.05] text-foreground/90"
                    )}
                  >
                    {/* 左侧：彩色原点、命令内容、多行标识 */}
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="h-2 w-2 rounded-full shrink-0 ring-2 ring-primary/20 bg-primary/80" />

                      {/* 命令内容 */}
                      <span className="font-mono text-sm font-medium text-foreground truncate max-w-[360px] sm:max-w-[460px]">
                        {firstLine}
                      </span>

                      {/* 多行行数胶囊 */}
                      {isMultiLine && (
                        <Badge
                          variant="outline"
                          className="text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground border-border/40 bg-muted/40 shrink-0"
                        >
                          {lines.length} 行
                        </Badge>
                      )}
                    </div>

                    {/* 右侧：回车填入胶囊 & 操作小工具栏 */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Enter 填入胶囊 */}
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-mono border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                        title="填入"
                      >
                        <CornerDownLeft className="h-3 w-3" />
                        <span className="text-[10px]">Enter 填入</span>
                      </span>

                      {/* 操作按钮群 */}
                      <div
                        className={cn(
                          "flex items-center gap-0.5 transition-opacity duration-150",
                          isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        )}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer transition-colors"
                          onClick={(e) => handleCopy(item, e)}
                          title="复制指令"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/15 cursor-pointer transition-colors"
                          onClick={(e) => handleDeleteItem(item, e)}
                          title="删除此条"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog for Clear All */}
      <ConfirmDialog
        open={clearConfirmOpen}
        title={t("compose_history_clear")}
        description={t("compose_history_clear_confirm")}
        confirmText={t("compose_history_clear")}
        cancelText="取消"
        variant="destructive"
        onConfirm={handleConfirmClearAll}
        onCancel={() => setClearConfirmOpen(false)}
      />
    </>
  );
}
