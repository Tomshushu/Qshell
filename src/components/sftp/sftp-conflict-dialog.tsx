import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ConflictAction, PendingConflict } from "./sftp-types";

export interface SftpConflictDialogProps {
  pendingConflict: PendingConflict | null;
  conflictApplyToAll: boolean;
  onApplyToAllChange: (apply: boolean) => void;
  onResolve: (action: ConflictAction) => void;
  t: (key: string) => string;
}

export function SftpConflictDialog({
  pendingConflict,
  conflictApplyToAll,
  onApplyToAllChange,
  onResolve,
  t,
}: SftpConflictDialogProps) {
  return (
    <Dialog
      open={!!pendingConflict}
      onOpenChange={(open) => {
        if (!open) onResolve("skip");
      }}
    >
      <DialogContent className="max-w-md p-0 overflow-hidden gap-0 bg-background">
        {/* 标题，普通背景 */}
        <div className="px-6 pt-5 pb-3">
          <DialogTitle className="text-base font-semibold text-foreground">
            {t("sftp_conflict_title")}
          </DialogTitle>
        </div>

        {/* 描述文本 */}
        <div className="px-6 pb-4">
          <p className="min-w-0 max-w-full whitespace-pre-wrap break-words text-sm text-muted-foreground leading-relaxed [overflow-wrap:anywhere]">
            {pendingConflict
              ? t("sftp_conflict_desc")
                  .replace("{name}", pendingConflict.name)
                  .replace("{location}", pendingConflict.location)
              : ""}
          </p>

          {/* 应用到全部复选框 */}
          <label
            htmlFor="conflict-apply-all"
            className="mt-3 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none w-fit"
          >
            <input
              type="checkbox"
              id="conflict-apply-all"
              checked={conflictApplyToAll}
              onChange={(e) => onApplyToAllChange(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
            />
            {t("sftp_conflict_apply_all")}
          </label>
        </div>

        {/* 四个动作按钮，底部一行排列 */}
        <div className="px-6 pb-5 flex items-center justify-between gap-2">
          <Button
            size="sm"
            onClick={() => onResolve("stop")}
            className="h-8 px-4 bg-red-500 hover:bg-red-600 text-white"
          >
            {t("sftp_conflict_stop")}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onResolve("skip")}
              className="h-8 text-foreground hover:bg-muted"
            >
              {t("sftp_conflict_skip")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onResolve("replace")}
              className="h-8"
            >
              {t("sftp_conflict_replace")}
            </Button>
            <Button
              size="sm"
              onClick={() => onResolve("duplicate")}
              className="h-8 px-4 bg-blue-500 hover:bg-blue-600 text-white"
            >
              {t("sftp_conflict_duplicate")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
