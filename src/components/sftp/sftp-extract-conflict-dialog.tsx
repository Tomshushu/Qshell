import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { PendingExtractConflict } from "./sftp-types";

export interface SftpExtractConflictDialogProps {
  pendingExtractConflict: PendingExtractConflict | null;
  onResolve: (action: "overwrite" | "keep" | "cancel") => void;
  t: (key: string) => string;
}

export function SftpExtractConflictDialog({
  pendingExtractConflict,
  onResolve,
  t,
}: SftpExtractConflictDialogProps) {
  return (
    <Dialog
      open={!!pendingExtractConflict}
      onOpenChange={(open) => {
        if (!open) onResolve("cancel");
      }}
    >
      <DialogContent className="max-w-md p-0 overflow-hidden gap-0 bg-background">
        <div className="min-w-0 px-6 pt-5 pb-3">
          <DialogTitle className="text-base font-semibold text-foreground">
            {t("sftp_extract_conflict_title")}
          </DialogTitle>
        </div>
        <div className="px-6 pb-4 space-y-2">
          <p className="min-w-0 max-w-full whitespace-pre-wrap break-words text-sm text-muted-foreground leading-relaxed [overflow-wrap:anywhere]">
            {t("sftp_extract_conflict_description")}
          </p>
          <p
            className="truncate rounded bg-muted/60 px-2 py-1.5 font-mono text-xs"
            title={pendingExtractConflict?.destination}
          >
            {pendingExtractConflict?.destination}
          </p>
        </div>
        <div className="px-6 pb-5 flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onResolve("cancel")}
          >
            {t("sftp_cancel")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onResolve("keep")}
          >
            {t("sftp_extract_keep")}
          </Button>
          <Button
            size="sm"
            className="bg-red-500 text-white hover:bg-red-600"
            onClick={() => onResolve("overwrite")}
          >
            {t("sftp_overwrite")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
