import React from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import { StatusPill } from "../docker-utils";
import type { ComposeImportPreview } from "../docker-types";

export interface DockerComposeImportDialogProps {
  open: boolean;
  importDialog: {
    dirsText: string;
    scanning: boolean;
    importing: boolean;
    previews: ComposeImportPreview[];
    selected: Set<string>;
  } | null;
  setImportDialog: React.Dispatch<
    React.SetStateAction<{
      dirsText: string;
      scanning: boolean;
      importing: boolean;
      previews: ComposeImportPreview[];
      selected: Set<string>;
    } | null>
  >;
  onConfirm: () => void;
  onCancel: () => void;
  onScan: () => void;
}

export function DockerComposeImportDialog({
  open,
  importDialog,
  setImportDialog,
  onConfirm,
  onCancel,
  onScan,
}: DockerComposeImportDialogProps) {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      open={open}
      title={t("dk_compose_import")}
      description={t("dk_compose_import_desc")}
      confirmLabel={t("dk_compose_import_confirm")}
      cancelLabel={t("common_cancel")}
      pending={importDialog?.importing === true}
      onConfirm={onConfirm}
      onCancel={onCancel}
      widthClass="max-w-[640px]"
    >
      {importDialog && (
        <div className="space-y-2.5 text-left">
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block">
              {t("dk_compose_import_dirs")}
            </label>
            <textarea
              className="w-full h-24 px-2.5 py-1.5 rounded-md border border-border bg-background text-xs font-mono outline-none focus:ring-1 focus:ring-ring resize-none"
              placeholder={"/opt/stacks/myapp\n/srv/legacy-stack"}
              value={importDialog.dirsText}
              disabled={importDialog.scanning || importDialog.importing}
              onChange={(e) =>
                setImportDialog((p) => (p ? { ...p, dirsText: e.target.value } : p))
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={onScan}
              disabled={
                importDialog.scanning ||
                importDialog.importing ||
                !importDialog.dirsText.trim()
              }
            >
              {importDialog.scanning ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Search className="h-3 w-3" />
              )}
              {t("dk_compose_import_scan")}
            </Button>
            {importDialog.previews.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {importDialog.selected.size}/{importDialog.previews.length}{" "}
                {t("dk_compose_import_selected")}
              </span>
            )}
          </div>
          {importDialog.previews.length > 0 && (
            <div className="max-h-56 overflow-auto rounded-md border border-border/60 divide-y divide-border/40">
              {importDialog.previews.map((pv) => (
                <label
                  key={pv.dir}
                  className={cn(
                    "flex items-center gap-2 px-2.5 py-2 cursor-pointer hover:bg-muted/30",
                    !pv.valid && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <input
                    type="checkbox"
                    className="accent-primary"
                    disabled={!pv.valid || importDialog.importing}
                    checked={pv.valid && importDialog.selected.has(pv.dir)}
                    onChange={(e) =>
                      setImportDialog((p) => {
                        if (!p) return p;
                        const next = new Set(p.selected);
                        if (e.target.checked) next.add(pv.dir);
                        else next.delete(pv.dir);
                        return { ...p, selected: next };
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[11px] truncate" title={pv.dir}>
                      {pv.dir}
                    </div>
                    {pv.file && (
                      <div className="font-mono text-[10px] text-muted-foreground truncate">
                        {pv.file}
                      </div>
                    )}
                  </div>
                  {pv.valid ? (
                    <StatusPill tone="emerald" label="valid" />
                  ) : (
                    <StatusPill tone="rose" label={pv.error || "invalid"} />
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </ConfirmDialog>
  );
}
