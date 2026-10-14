import { Check, AlertCircle } from "lucide-react";
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
import type { SftpDiagnostics } from "@/services/api/types";

export interface SftpDiagnosticsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sftpDiagnostics: SftpDiagnostics | null;
  t: (key: string) => string;
}

export function SftpDiagnosticsDialog({
  open,
  onOpenChange,
  sftpDiagnostics,
  t,
}: SftpDiagnosticsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("sftp_diag_title")}</DialogTitle>
          <DialogDescription>{t("sftp_diag_desc")}</DialogDescription>
        </DialogHeader>
        {sftpDiagnostics && (
          <div className="space-y-4 max-h-[55vh] overflow-y-auto -mx-1 px-1">
            {/* 状态概览 */}
            <div
              className={cn(
                "flex items-center gap-2 p-3 rounded-lg",
                sftpDiagnostics.status === "healthy" &&
                  "bg-green-50 text-green-700 dark:bg-emerald-500/10 dark:text-emerald-400",
                sftpDiagnostics.status === "warning" &&
                  "bg-yellow-50 text-yellow-700 dark:bg-amber-500/10 dark:text-amber-400",
                sftpDiagnostics.status === "critical" &&
                  "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400",
                sftpDiagnostics.status === "skipped" &&
                  "bg-gray-50 text-gray-700 dark:bg-muted dark:text-muted-foreground",
              )}
            >
              {sftpDiagnostics.status === "healthy" && (
                <Check className="h-5 w-5" />
              )}
              {sftpDiagnostics.status === "warning" && (
                <AlertCircle className="h-5 w-5" />
              )}
              {sftpDiagnostics.status === "critical" && (
                <AlertCircle className="h-5 w-5" />
              )}
              <span className="font-medium">
                {sftpDiagnostics.status === "healthy" &&
                  t("sftp_diag_status_healthy")}
                {sftpDiagnostics.status === "warning" &&
                  t("sftp_diag_status_warning")}
                {sftpDiagnostics.status === "critical" &&
                  t("sftp_diag_status_critical")}
                {sftpDiagnostics.status === "skipped" &&
                  t("sftp_diag_status_skipped")}
              </span>
            </div>

            {/* 问题列表 */}
            {sftpDiagnostics.issues.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">
                  {t("sftp_diag_issues_header")}
                </h4>
                {sftpDiagnostics.issues.map((issue, i) => (
                  <div
                    key={i}
                    className={cn(
                      "p-2 rounded text-sm",
                      issue.severity === "critical"
                        ? "bg-red-50 text-red-700"
                        : "bg-yellow-50 text-yellow-700",
                    )}
                  >
                    <span className="font-medium">[{issue.severity}]</span>{" "}
                    {issue.message}
                  </div>
                ))}
              </div>
            )}

            {/* 修复建议 */}
            {sftpDiagnostics.recommendations.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">
                  {t("sftp_diag_suggestions_header")}
                </h4>
                {sftpDiagnostics.recommendations.map((rec, i) => (
                  <div
                    key={i}
                    className="p-2 rounded bg-blue-50 text-blue-700 text-sm"
                  >
                    {rec.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>
            {t("sftp_diag_close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
