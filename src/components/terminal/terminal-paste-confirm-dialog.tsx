import React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";
import type { PendingPaste } from "./terminal-types";

export interface TerminalPasteConfirmDialogProps {
  pendingPaste: PendingPaste | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function TerminalPasteConfirmDialog({
  pendingPaste,
  onClose,
  onConfirm,
}: TerminalPasteConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={!!pendingPaste}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("tm_paste_confirm_title")}</DialogTitle>
          <DialogDescription>
            {t("tm_paste_confirm_description")}
          </DialogDescription>
        </DialogHeader>
        {pendingPaste && (
          <div className="max-h-48 overflow-auto rounded-md border border-border/60 bg-muted/40 p-3">
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground/80">
              {pendingPaste.text.slice(0, 8000)}
              {pendingPaste.text.length > 8000 ? "\n…" : ""}
            </pre>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("tab_cancel_btn")}
          </Button>
          <Button onClick={onConfirm}>
            {t("tm_paste_confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
