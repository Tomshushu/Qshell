import React, { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAppStore } from "@/store";
import { useTranslation } from "@/i18n";
import { useToast } from "@/components/ui/toast";
import {
  Clock,
  Trash2,
  Copy,
  CornerDownLeft,
  Search,
  X,
  FileCode,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

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
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

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
      toast.success(t("compose_history_copied"));
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="max-w-2xl w-[92vw] sm:max-w-2xl max-h-[85vh] flex flex-col p-6 gap-4"
        >
          {/* Header with integrated Actions and Close Button */}
          <DialogHeader className="flex flex-row items-center justify-between pb-3 border-b border-border/40 space-y-0">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-xs shrink-0">
                <Clock className="h-4.5 w-4.5" />
              </div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-base font-semibold text-foreground tracking-tight">
                  {t("compose_history_title")}
                </DialogTitle>
                <Badge
                  variant="secondary"
                  className="text-[11px] font-mono px-2 py-0.5 h-5 rounded-full font-normal bg-muted text-muted-foreground border border-border/40"
                >
                  共 {history.length} 条
                </Badge>
              </div>
              <DialogDescription className="sr-only">
                {t("compose_history_title")}
              </DialogDescription>
            </div>

            {/* Right-aligned Header Controls: Clear All + Close Button */}
            <div className="flex items-center gap-1.5 shrink-0">
              {history.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setClearConfirmOpen(true)}
                  className="h-8 px-2.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1.5 transition-colors cursor-pointer rounded-lg"
                  title={t("compose_history_clear")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{t("compose_history_clear")}</span>
                </Button>
              )}

              {history.length > 0 && <div className="h-4 w-px bg-border/60 mx-1" />}

              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-lg cursor-pointer"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>

          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("compose_history_search_placeholder")}
              className="pl-9 pr-8 h-9 text-xs bg-muted/30 border-border/60 hover:bg-muted/50 focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-primary/40 rounded-lg transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer"
                title="清除搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* History List */}
          <div className="flex-1 overflow-y-auto max-h-[48vh] pr-1.5 space-y-2.5">
            {filteredHistory.length === 0 ? (
              <div className="py-14 flex flex-col items-center justify-center text-center space-y-3 text-muted-foreground">
                <div className="h-12 w-12 rounded-2xl bg-muted/40 border border-border/40 flex items-center justify-center text-muted-foreground/40">
                  <Clock className="h-6 w-6 stroke-[1.5]" />
                </div>
                <div>
                  <p className="text-xs font-medium text-foreground/80">
                    {searchQuery ? "未找到匹配的历史撰写记录" : t("compose_history_empty")}
                  </p>
                  <p className="text-[11px] text-muted-foreground/70 mt-1">
                    {searchQuery
                      ? "尝试输入其他关键字进行查找"
                      : "在撰写栏发送命令后将自动沉淀记录到此列表中"}
                  </p>
                </div>
              </div>
            ) : (
              filteredHistory.map((item, idx) => {
                const lines = item.split(/\r?\n/);
                const isMultiLine = lines.length > 1;

                return (
                  <div
                    key={`${idx}-${item.slice(0, 20)}`}
                    onClick={() => {
                      onSelect(item);
                      onOpenChange(false);
                    }}
                    className="group relative flex flex-col p-3 rounded-lg border border-border/60 bg-card hover:bg-accent/30 hover:border-primary/40 transition-all cursor-pointer shadow-2xs"
                  >
                    {/* Top Meta info & Actions */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <FileCode className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                        <span className="font-mono text-[11px] font-semibold text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded border border-border/40">
                          #{filteredHistory.length - idx}
                        </span>
                        {isMultiLine && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground border-border/60 bg-background/50"
                          >
                            {lines.length} 行
                          </Badge>
                        )}
                      </div>

                      {/* Action buttons on card */}
                      <div className="flex items-center gap-1 opacity-90 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-6 px-2.5 text-[11px] font-medium text-primary hover:bg-primary hover:text-primary-foreground gap-1 transition-colors cursor-pointer shadow-2xs"
                          onClick={() => {
                            onSelect(item);
                            onOpenChange(false);
                          }}
                          title={t("compose_history_apply")}
                        >
                          <CornerDownLeft className="h-3 w-3" />
                          <span>填入</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer"
                          onClick={(e) => handleCopy(item, e)}
                          title="复制指令"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                          onClick={(e) => handleDeleteItem(item, e)}
                          title={t("compose_history_delete_item")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Command Content */}
                    <div className="mt-2 p-2.5 rounded-md bg-muted/40 group-hover:bg-muted/60 border border-border/40 font-mono text-xs text-foreground/90 whitespace-pre-wrap break-all max-h-36 overflow-y-auto select-text leading-relaxed transition-colors">
                      {item}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer with Hint and Close Button */}
          <DialogFooter className="pt-3 border-t border-border/40 flex flex-row items-center justify-between sm:justify-between text-[11px] text-muted-foreground">
            <span className="text-muted-foreground/70">
              💡 提示：点击条目或「填入」直接写入终端，按 <kbd className="px-1 py-0.5 bg-muted rounded border border-border/60 text-[10px] font-mono text-foreground">Esc</kbd> 退出
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-3"
              onClick={() => onOpenChange(false)}
            >
              关闭
            </Button>
          </DialogFooter>
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
