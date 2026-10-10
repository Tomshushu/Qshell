import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import type { UploadRecord } from "./terminal-types";

export interface TerminalTransferDialogProps {
  open: boolean;
  uploadRecords: UploadRecord[];
  onCancel: () => void;
}

export function TerminalTransferDialog({
  open,
  uploadRecords,
  onCancel,
}: TerminalTransferDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-md [&>button.absolute]:hidden"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <div className="mb-1 flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-xl",
                uploadRecords[0]?.status === "success"
                  ? "bg-emerald-500/15 text-emerald-500"
                  : uploadRecords[0]?.status === "failed"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-primary/15 text-primary",
              )}
            >
              {uploadRecords[0]?.status === "success" ? (
                <Check className="h-5 w-5 animate-in zoom-in" />
              ) : uploadRecords[0]?.status === "failed" ? (
                <AlertCircle className="h-5 w-5" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin" />
              )}
            </div>
            <div>
              <DialogTitle>
                {t("transfer_sending_with", {
                  protocol: uploadRecords[0]?.protocol || "ZMODEM",
                })}
              </DialogTitle>
              <DialogDescription>
                {uploadRecords[0]?.status === "success"
                  ? t("transfer_completed_closing")
                  : uploadRecords[0]?.protocol === "SFTP"
                    ? t("transfer_uploading_secure")
                    : t("transfer_uploading_session")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="max-h-80 space-y-3 overflow-auto">
          {uploadRecords.map((record) => {
            const percent = record.totalBytes
              ? Math.min(
                  100,
                  ((record.bytes || 0) / record.totalBytes) * 100,
                )
              : 0;
            return (
              <div
                key={record.id}
                className="rounded-xl border border-border/60 bg-muted/25 p-3 text-xs"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {record.files.join(", ")}
                  </span>
                  <span
                    className={
                      record.status === "success"
                        ? "text-emerald-500"
                        : record.status === "failed"
                          ? "text-destructive"
                          : "text-primary"
                    }
                  >
                    {record.status === "success"
                      ? t("sftp_transfer_completed")
                      : record.status === "failed"
                        ? t("sftp_transfer_failed")
                        : record.phase === "preparing"
                          ? t("transfer_connecting")
                          : t("sftp_transfer_transferring")}
                  </span>
                </div>
                {record.totalBytes ? (
                  <>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full bg-primary transition-[width] duration-300",
                          record.status === "uploading" &&
                            "shadow-[0_0_10px_hsl(var(--primary))]",
                        )}
                        style={{
                          width: `${record.status === "success" ? 100 : percent}%`,
                        }}
                      />
                    </div>
                    <div className="mt-1.5 flex justify-between text-muted-foreground">
                      <span>
                        {(
                          (record.status === "success"
                            ? record.totalBytes
                            : record.bytes || 0) /
                          1024 /
                          1024
                        ).toFixed(1)}{" "}
                        / {(record.totalBytes / 1024 / 1024).toFixed(1)} MB
                      </span>
                      <span>
                        {record.status === "success"
                          ? "100"
                          : percent.toFixed(0)}
                        %
                      </span>
                    </div>
                  </>
                ) : record.status === "uploading" ? (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-1/3 animate-[pulse_1s_ease-in-out_infinite] rounded-full bg-primary" />
                  </div>
                ) : null}
                <div className="mt-3 grid grid-cols-[76px_1fr] gap-x-3 gap-y-1.5 text-xs">
                  <span className="text-muted-foreground">
                    {t("transfer_file_name")}:
                  </span>
                  <span className="truncate">
                    {record.files.join(", ")}
                  </span>
                  <span className="text-muted-foreground">
                    {t("transfer_file_size")}:
                  </span>
                  <span>
                    {record.totalBytes
                      ? `${(record.totalBytes / 1024 / 1024).toFixed(2)} MB`
                      : t("transfer_calculating")}
                  </span>
                  <span className="text-muted-foreground">
                    {t("transfer_transferred_size")}:
                  </span>
                  <span>
                    {record.totalBytes
                      ? `${((record.status === "success" ? record.totalBytes : record.bytes || 0) / 1024 / 1024).toFixed(2)} MB`
                      : "—"}
                  </span>
                  <span className="text-muted-foreground">
                    {t("transfer_speed")}:
                  </span>
                  <span>
                    {record.speed
                      ? `${(record.speed / 1024 / 1024).toFixed(2)} MB/Sec`
                      : record.status === "uploading"
                        ? t("transfer_calculating")
                        : "—"}
                  </span>
                  {record.totalFiles ? (
                    <>
                      <span className="text-muted-foreground">
                        {t("transfer_file_count")}:
                      </span>
                      <span>
                        {record.status === "success"
                          ? record.totalFiles
                          : record.completedFiles || 0}{" "}
                        / {record.totalFiles}
                      </span>
                    </>
                  ) : null}
                  <span className="text-muted-foreground">
                    {t("transfer_target")}:
                  </span>
                  <span className="truncate">{record.directory}</span>
                </div>
                {record.error && (
                  <div className="mt-1 text-destructive">
                    {record.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button
            variant={
              uploadRecords.some((record) => record.status === "uploading")
                ? "destructive"
                : "outline"
            }
            onClick={onCancel}
          >
            {uploadRecords.some((record) => record.status === "uploading")
              ? t("transfer_cancel_upload")
              : t("common_close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
