import { Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { LocalFileEntry, FileEntry } from "@/services/api/types";
import type { DeleteProgressState } from "./sftp-types";

export interface SftpDeleteDialogProps {
  open: boolean;
  deleteTarget: LocalFileEntry | FileEntry | null;
  deleteMultiPaths: string[] | null;
  deletePending: boolean;
  deleteProgress: DeleteProgressState | null;
  onClose: () => void;
  onConfirm: () => void;
  t: (key: string) => string;
}

export function SftpDeleteDialog({
  open,
  deleteTarget,
  deleteMultiPaths,
  deletePending,
  deleteProgress,
  onClose,
  onConfirm,
  t,
}: SftpDeleteDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (isOpen || deletePending) return;
        onClose();
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[430px] p-6 gap-4 overflow-hidden">
        <div className="flex items-start gap-3.5 pr-4">
          <div
            className={cn(
              "shrink-0 flex h-10 w-10 items-center justify-center rounded-xl border transition-colors",
              deletePending
                ? "bg-red-500/10 text-red-500 border-red-500/20"
                : "bg-destructive/10 text-destructive border-destructive/20",
            )}
          >
            {deletePending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Trash2 className="h-5 w-5 text-destructive" />
            )}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <DialogHeader className="p-0 text-left sm:text-left space-y-1">
              <DialogTitle className="text-base font-semibold text-foreground tracking-tight">
                {deletePending
                  ? t("sftp_deleting_title")
                  : t("sftp_delete_confirm_title")}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground leading-relaxed break-words">
                {deletePending
                  ? t("sftp_deleting_desc")
                  : deleteMultiPaths && deleteMultiPaths.length > 0
                    ? t("sftp_delete_multi_confirm_desc").replace(
                        "{n}",
                        String(deleteMultiPaths.length),
                      )
                    : t("sftp_delete_confirm_desc")
                        .replace(
                          "{type}",
                          deleteTarget?.isDirectory
                            ? t("sftp_folder")
                            : t("sftp_file"),
                        )
                        .replace("{name}", deleteTarget?.name || "")}
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        <div className="min-w-0 max-w-full">
          {deletePending ? (
            <div className="space-y-3" role="status" aria-live="polite">
              <div className="rounded-lg border border-border/50 bg-muted/30 px-3.5 py-2.5">
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-foreground">
                    {t("sftp_deleting_current")}
                  </span>
                  <span className="shrink-0 font-mono font-semibold tabular-nums text-red-500">
                    {deleteProgress
                      ? `${deleteProgress.current}/${deleteProgress.total}`
                      : "…"}
                  </span>
                </div>
                <div
                  className="break-all font-mono text-[11px] text-muted-foreground truncate"
                  title={deleteProgress?.path}
                >
                  {deleteProgress?.path || t("sftp_deleting_preparing")}
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-full animate-pulse rounded-full bg-gradient-to-r from-red-500/35 via-red-500 to-red-500/35" />
              </div>
            </div>
          ) : deleteMultiPaths && deleteMultiPaths.length > 0 ? (
            <div className="max-h-28 overflow-y-auto rounded-lg border border-border/50 bg-muted/25 p-2 text-[11px] font-mono text-muted-foreground space-y-1">
              {deleteMultiPaths.map((p) => (
                <div
                  key={p}
                  className="truncate px-1.5 py-0.5 rounded hover:bg-muted/40"
                  title={p}
                >
                  {p}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-border/50 bg-muted/25 px-3 py-2 text-xs font-mono text-muted-foreground break-all">
              {deleteTarget?.path}
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-end gap-2.5 pt-2 sm:justify-end">
          {!deletePending && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3.5 rounded-lg text-xs font-medium border-border/70 hover:bg-accent/60"
                onClick={onClose}
              >
                {t("sftp_cancel")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-8 px-4 rounded-lg text-xs font-medium shadow-xs gap-1.5"
                onClick={onConfirm}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("sftp_confirm_delete")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
