import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import type { FavoriteCommand } from "@/services/api/types";

export const QUICK_CMD_COLORS = [
  { id: "blue", hex: "#3b82f6", bg: "bg-blue-500", border: "border-blue-500" },
  { id: "emerald", hex: "#10b981", bg: "bg-emerald-500", border: "border-emerald-500" },
  { id: "amber", hex: "#f59e0b", bg: "bg-amber-500", border: "border-amber-500" },
  { id: "red", hex: "#ef4444", bg: "bg-red-500", border: "border-red-500" },
  { id: "purple", hex: "#8b5cf6", bg: "bg-purple-500", border: "border-purple-500" },
  { id: "cyan", hex: "#06b6d4", bg: "bg-cyan-500", border: "border-cyan-500" },
] as const;

interface QuickCommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingCommand?: FavoriteCommand | null;
  onSave: (command: {
    cmd: string;
    desc: string;
    autoExecute: boolean;
    pinnedToBar: boolean;
    color?: string;
  }) => Promise<void>;
}

export function QuickCommandDialog({
  open,
  onOpenChange,
  editingCommand,
  onSave,
}: QuickCommandDialogProps) {
  const { t } = useTranslation();
  const [desc, setDesc] = useState("");
  const [cmd, setCmd] = useState("");
  const [autoExecute, setAutoExecute] = useState(true);
  const [pinnedToBar, setPinnedToBar] = useState(true);
  const [selectedColor, setSelectedColor] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (editingCommand) {
        setDesc(editingCommand.desc || "");
        setCmd(editingCommand.cmd || "");
        setAutoExecute(editingCommand.autoExecute !== false);
        setPinnedToBar(editingCommand.pinnedToBar !== false);
        setSelectedColor(editingCommand.color || undefined);
      } else {
        setDesc("");
        setCmd("");
        setAutoExecute(true);
        setPinnedToBar(true);
        setSelectedColor(undefined);
      }
      setIsSaving(false);
    }
  }, [open, editingCommand]);

  const handleSave = async () => {
    const trimmedCmd = cmd.trim();
    if (!trimmedCmd) return;
    const trimmedDesc = desc.trim() || trimmedCmd;

    setIsSaving(true);
    try {
      await onSave({
        cmd: trimmedCmd,
        desc: trimmedDesc,
        autoExecute,
        pinnedToBar,
        color: selectedColor || undefined,
      });
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {editingCommand ? t("quick_cmd_edit") : t("quick_cmd_add")}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2 text-sm">
          {/* 名称 / 标签 */}
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-foreground">
              {t("quick_cmd_name")}
            </label>
            <Input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={t("quick_cmd_name_placeholder")}
              className="h-8 text-xs"
              autoFocus={!editingCommand}
            />
          </div>

          {/* 指令内容 */}
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-foreground">
              {t("quick_cmd_command")} <span className="text-destructive">*</span>
            </label>
            <textarea
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              placeholder={t("quick_cmd_command_placeholder")}
              rows={3}
              className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {/* 颜色标识 */}
          <div className="grid gap-1.5">
            <label className="text-xs font-medium text-foreground">
              {t("quick_cmd_color")}
            </label>
            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => setSelectedColor(undefined)}
                className={cn(
                  "flex h-6 items-center rounded px-2 text-[11px] border transition-all",
                  !selectedColor
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border/60 text-muted-foreground hover:bg-muted"
                )}
              >
                默认
              </button>
              {QUICK_CMD_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedColor(c.hex)}
                  className={cn(
                    "h-6 w-6 rounded-full border-2 transition-transform",
                    c.bg,
                    selectedColor === c.hex
                      ? "scale-110 ring-2 ring-primary ring-offset-2 ring-offset-background border-white"
                      : "border-transparent opacity-80 hover:opacity-100"
                  )}
                  title={c.id}
                />
              ))}
            </div>
          </div>

          {/* 直接执行开关 */}
          <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
            <div className="space-y-0.5 pr-2">
              <label className="text-xs font-medium text-foreground block cursor-pointer">
                {t("quick_cmd_auto_exec")}
              </label>
              <p className="text-[11px] text-muted-foreground leading-normal">
                {t("quick_cmd_auto_exec_desc")}
              </p>
            </div>
            <Switch
              checked={autoExecute}
              onCheckedChange={setAutoExecute}
            />
          </div>

          {/* 固定在快捷栏开关 */}
          <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
            <div className="space-y-0.5 pr-2">
              <label className="text-xs font-medium text-foreground block cursor-pointer">
                {t("quick_cmd_pinned")}
              </label>
              <p className="text-[11px] text-muted-foreground leading-normal">
                {t("quick_cmd_pinned_desc")}
              </p>
            </div>
            <Switch
              checked={pinnedToBar}
              onCheckedChange={setPinnedToBar}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            {t("common_cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={!cmd.trim() || isSaving}
          >
            {t("common_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
