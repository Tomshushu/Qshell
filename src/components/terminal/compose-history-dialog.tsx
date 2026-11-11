import React, { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
          className="max-w-2xl w-[92vw] sm:max-w-2xl max-h-[85vh] flex flex-col p-5 gap-4"
          aria-describedby="compose-history-description"
        >
          {/* Header */}
          <DialogHeader className="flex flex-row items-center justify-between pb-2 border-b border-border/40 space-y-0">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold flex items-center gap-2">
                  <span>{t("compose_history_title")}</span>
                  <Badge variant="secondary" className="text-[11px] px-1.5 py-0 h-5">
                    {history.length}
                  </Badge>
                </DialogTitle>
                <DialogDescription id="compose-history-description" className="text-xs text-muted-foreground mt-0.5">
                  点击任意历史记录可直接填入撰写输入框，支持单独删除和全部清空
                </DialogDescription>
              </div>
            </div>

            {/* Clear All Button */}
            {history.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setClearConfirmOpen(true)}
                className="h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30 gap-1.5 cursor-pointer shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{t("compose_history_clear")}</span>
              </Button>
            )}
          </DialogHeader>

          {/* Search Box */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("compose_history_search_placeholder")}
              className="pl-8 pr-8 h-8 text-xs bg-muted/40 focus-visible:ring-1"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* History List */}
          <div className="flex-1 overflow-y-auto max-h-[50vh] pr-1 space-y-2">
            {filteredHistory.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-muted-foreground/60 space-y-2">
                <Clock className="h-10 w-10 stroke-[1.2] opacity-40" />
                <p className="text-xs">
                  {searchQuery ? "未找到匹配的历史撰写记录" : t("compose_history_empty")}
                </p>
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
                    className="group relative flex flex-col p-3 rounded-lg border border-border/50 bg-card hover:bg-accent/40 hover:border-primary/40 transition-all cursor-pointer shadow-2xs"
                  >
                    {/* Top Meta info & Actions */}
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <FileCode className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                        <span className="text-[11px] text-muted-foreground font-mono">
                          #{filteredHistory.length - idx}
                        </span>
                        {isMultiLine && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1 py-0 h-4 font-normal text-muted-foreground border-border/60"
                          >
                            {lines.length} 行
                          </Badge>
                        )}
                      </div>

                      {/* Action buttons on card */}
                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px] text-primary gap-1 hover:bg-primary/10"
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
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                          onClick={(e) => handleCopy(item, e)}
                          title="复制指令"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={(e) => handleDeleteItem(item, e)}
                          title={t("compose_history_delete_item")}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    {/* Command Content */}
                    <div className="relative font-mono text-xs text-foreground/90 whitespace-pre-wrap break-all line-clamp-6 bg-muted/30 rounded p-2 border border-border/30">
                      {item}
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
