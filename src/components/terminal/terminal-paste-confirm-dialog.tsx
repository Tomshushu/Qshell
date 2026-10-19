import React, { useState } from "react";
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
  onConfirm: (dontAskAgain?: boolean) => void;
}

export function TerminalPasteConfirmDialog({
  pendingPaste,
  onClose,
  onConfirm,
}: TerminalPasteConfirmDialogProps) {
  const { t } = useTranslation();
  const [dontAskAgain, setDontAskAgain] = useState(false);

  const handleClose = () => {
    setDontAskAgain(false);
    onClose();
  };

  const handleConfirm = () => {
    onConfirm(dontAskAgain);
    setDontAskAgain(false);
  };

  return (
    <Dialog
      open={!!pendingPaste}
      onOpenChange={(open) => {
        if (!open) handleClose();
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
        <DialogFooter className="flex flex-row items-center justify-between sm:justify-between">
          <label
            htmlFor="dont-ask-paste"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none"
          >
            <input
              type="checkbox"
              id="dont-ask-paste"
              checked={dontAskAgain}
              onChange={(e) => setDontAskAgain(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
            />
            <span>{t("tm_paste_dont_ask_again") || "不再提示"}</span>
          </label>
          <div className="flex items-center space-x-2">
            <Button variant="outline" onClick={handleClose}>
              {t("tab_cancel_btn")}
            </Button>
            <Button onClick={handleConfirm}>
              {t("tm_paste_confirm")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
