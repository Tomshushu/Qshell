import { Loader2, Check, AlertCircle } from "lucide-react";
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
import { ArchiveFileIcon } from "@/components/ui/file-icons";

export interface SftpExtractionProgressDialogProps {
  open: boolean;
  status: "running" | "success" | "failed";
  phase: string;
  path: string;
  progress: number;
  onClose: () => void;
  t: (key: string) => string;
}

export function SftpExtractionProgressDialog({
  open,
  status,
  phase,
  path,
  progress,
  onClose,
  t,
}: SftpExtractionProgressDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && status !== "running") onClose();
      }}
    >
      <DialogContent className="max-w-lg overflow-hidden p-0 bg-background">
        <DialogHeader className="border-b border-border/60 bg-muted/20 px-6 py-5 text-left sm:text-left">
          <div className="flex min-w-0 items-center gap-4 pr-6">
            <div
              className={cn(
                "relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl",
                status === "success"
                  ? "bg-green-500/10"
                  : status === "failed"
                    ? "bg-red-500/10"
                    : "bg-primary/10",
              )}
            >
              {status === "running" ? (
                <>
                  <span className="absolute inset-1 animate-pulse rounded-xl bg-primary/10" />
                  <ArchiveFileIcon className="relative h-7 w-7 text-primary" />
                  <Loader2 className="absolute -bottom-1 -right-1 h-5 w-5 animate-spin rounded-full bg-background p-0.5 text-primary" />
                </>
              ) : status === "success" ? (
                <Check className="h-8 w-8 text-green-500" />
              ) : (
                <AlertCircle className="h-8 w-8 text-red-500" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-base">
                {status === "success"
                  ? t("sftp_extract_success")
                  : status === "failed"
                    ? phase === t("sftp_extract_phase_canceled")
                      ? t("sftp_extract_phase_canceled")
                      : t("sftp_extract_failed")
                    : t("sftp_extract_progress_title")}
              </DialogTitle>
              <DialogDescription className="mt-1 min-h-5 text-sm">
                {phase || t("sftp_extract_phase_prepare")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-w-0 w-full space-y-5 px-6 py-5">
          <div className="min-w-0 rounded-lg border border-border/60 bg-muted/20 px-3.5 py-3">
            <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
              {t("sftp_extract_progress_file")}
            </div>
            <div
              className="truncate text-xs text-foreground"
              title={path || undefined}
            >
              {path}
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-muted-foreground">
                  {t("sftp_extract_progress_status")}
                </div>
                <div
                  className={cn(
                    "mt-0.5 truncate text-sm font-medium",
                    status === "success"
                      ? "text-green-600"
                      : status === "failed"
                        ? "text-red-500"
                        : "text-foreground",
                  )}
                >
                  {phase || t("sftp_extract_progress_processing")}
                </div>
              </div>
              <div
                className={cn(
                  "w-16 shrink-0 text-right font-mono text-2xl font-semibold tabular-nums leading-none",
                  status === "success"
                    ? "text-green-600"
                    : status === "failed"
                      ? "text-red-500"
                      : "text-primary",
                )}
              >
                {progress}%
              </div>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "relative h-full overflow-hidden rounded-full transition-[width] duration-700 ease-out",
                  status === "failed"
                    ? "bg-red-500"
                    : status === "success"
                      ? "bg-green-500"
                      : "bg-primary",
                )}
                style={{ width: `${progress}%` }}
              >
                {status === "running" && (
                  <span className="absolute inset-y-0 -left-1/2 w-1/2 animate-[pulse_1.2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/55 to-transparent" />
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {[
              { label: t("sftp_extract_step_validate"), threshold: 8 },
              { label: t("sftp_extract_step_prepare"), threshold: 22 },
              { label: t("sftp_extract_step_extract"), threshold: 52 },
              { label: t("sftp_extract_step_finish"), threshold: 100 },
            ].map((step, index) => {
              const reached = progress >= step.threshold;
              const current =
                reached &&
                (index === 3 || progress < [22, 52, 100, 101][index]);
              const active = status === "running" && current;
              return (
                <div key={step.label} className="min-w-0 text-center">
                  <div
                    className={cn(
                      "mx-auto mb-1.5 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold transition-colors",
                      status === "failed" && current
                        ? "border-red-500 bg-red-500 text-white"
                        : reached
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-muted-foreground",
                    )}
                  >
                    {status === "failed" && current ? (
                      <AlertCircle className="h-3 w-3" />
                    ) : reached && !active ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      index + 1
                    )}
                  </div>
                  <div
                    className={cn(
                      "truncate text-[10px]",
                      reached ? "text-foreground" : "text-muted-foreground",
                    )}
                    title={step.label}
                  >
                    {step.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <DialogFooter className="border-t border-border/60 px-6 py-3">
          <Button
            variant="outline"
            size="sm"
            disabled={status === "running"}
            onClick={onClose}
          >
            {t("sftp_extract_progress_close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
