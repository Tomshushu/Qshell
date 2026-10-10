import React, { useRef, useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";

export interface DockerDeployModalProps {
  deployModal: {
    action: string;
    projectName: string;
    running: boolean;
    exitCode: number | null;
    error?: string;
    startedAt: number;
    lastChunkAt: number;
    text: string;
  } | null;
  onClose: () => void;
  deployTick?: number;
}

export function DockerDeployModal({
  deployModal,
  onClose,
}: DockerDeployModalProps) {
  const { t } = useTranslation();
  const deployScrollRef = useRef<HTMLDivElement>(null);
  const [clockNow, setClockNow] = useState(0);

  useEffect(() => {
    if (deployScrollRef.current) {
      deployScrollRef.current.scrollTop = deployScrollRef.current.scrollHeight;
    }
  }, [deployModal?.text]);

  useEffect(() => {
    if (!deployModal?.running) return;
    const update = () => setClockNow(Date.now());
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [deployModal?.running, deployModal?.startedAt]);

  if (!deployModal) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="w-[92vw] max-w-4xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="font-medium text-sm truncate">
              {t("dk_deploy_title")} · {deployModal.action} - {deployModal.projectName}
            </span>
            {deployModal.running ? (
              <>
                <span className="inline-flex items-center gap-1 text-[11px] text-success flex-shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                  {t("dk_deploy_running")}
                </span>
                {(() => {
                  const now = clockNow || deployModal.startedAt;
                  const elapsed = Math.floor((now - deployModal.startedAt) / 1000);
                  const silent = Math.floor((now - deployModal.lastChunkAt) / 1000);
                  if (silent >= 10) {
                    return (
                      <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 flex-shrink-0">
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        {t("dk_deploy_silent")} {silent}s
                      </span>
                    );
                  }
                  return (
                    <span className="text-[11px] text-muted-foreground flex-shrink-0 tabular-nums">
                      {t("dk_deploy_elapsed")} {elapsed}s
                    </span>
                  );
                })()}
              </>
            ) : (
              <span
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border flex-shrink-0",
                  deployModal.exitCode === 0 && !deployModal.error
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    : "bg-rose-500/10 text-rose-400 border-rose-500/20",
                )}
              >
                {deployModal.exitCode === 0 && !deployModal.error
                  ? t("dk_deploy_success")
                  : `${t("dk_deploy_failed")}${deployModal.exitCode !== null ? ` · exit ${deployModal.exitCode}` : ""}`}
              </span>
            )}
          </div>
          <button
            className="p-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div
          ref={deployScrollRef}
          className="flex-1 overflow-auto p-4 bg-zinc-950 font-mono text-[12px] text-zinc-200 leading-relaxed"
        >
          <pre className="whitespace-pre-wrap break-all">
            {deployModal.text || t("dk_loading")}
          </pre>
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-t border-border/60">
          <span className="text-[11px] text-muted-foreground">{t("dk_deploy_bg_hint")}</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onClose}
          >
            {t("dk_deploy_close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
