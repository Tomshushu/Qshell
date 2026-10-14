import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
export interface SftpOverwriteDialogProps {
  /** 仅需 title/description 用于展示；确认/取消由 onConfirm/onCancel 回调负责 */
  pendingOverwrite: { title?: string; description?: string } | null;
  onConfirm: () => void;
  onCancel: () => void;
  t: (key: string) => string;
}

export function SftpOverwriteDialog({
  pendingOverwrite,
  onConfirm,
  onCancel,
  t,
}: SftpOverwriteDialogProps) {
  return (
    <Dialog
      open={!!pendingOverwrite}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-md p-0 overflow-hidden gap-0 bg-background">
        <div className="px-6 pt-5 pb-3">
          <DialogTitle className="text-base font-semibold text-foreground">
            {pendingOverwrite?.title ?? t("sftp_rename_overwrite_title")}
          </DialogTitle>
        </div>
        <div className="px-6 pb-4">
          <p className="min-w-0 max-w-full whitespace-pre-wrap break-words text-sm text-muted-foreground leading-relaxed [overflow-wrap:anywhere]">
            {pendingOverwrite?.description ?? ""}
          </p>
        </div>
        <div className="px-6 pb-5 flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="h-8 text-foreground hover:bg-muted"
          >
            {t("sftp_cancel")}
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            className="h-8 px-4 bg-red-500 hover:bg-red-600 text-white"
          >
            {t("sftp_overwrite")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
