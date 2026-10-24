import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HardDrive, Trash2, X } from "lucide-react";
import { useTranslation } from "@/i18n";
import { ListSkeleton } from "../docker-utils";
import type { SystemDfRow } from "@/services/api";

export interface DockerSystemDfModalProps {
  dfModal: {
    loading: boolean;
    rows: SystemDfRow[];
  } | null;
  onClose: () => void;
  onPrune: () => void;
}

export function DockerSystemDfModal({
  dfModal,
  onClose,
  onPrune,
}: DockerSystemDfModalProps) {
  const { t } = useTranslation();

  if (!dfModal) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} className="w-[90vw] max-w-2xl p-0 gap-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm">{t("dk_df_title")}</span>
          </div>
          <button
            className="p-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {dfModal.loading ? (
            <ListSkeleton rows={4} />
          ) : (
            <div className="m-2 rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
              <table className="w-full text-xs">
                <thead className="workspace-table-head">
                  <tr className="text-left text-muted-foreground/70">
                    <th className="px-3 py-2 font-medium tracking-wider text-[10px] uppercase">
                      {t("dk_df_type")}
                    </th>
                    <th className="px-3 py-2 font-medium tracking-wider text-[10px] uppercase">
                      {t("dk_df_total")}
                    </th>
                    <th className="px-3 py-2 font-medium tracking-wider text-[10px] uppercase">
                      {t("dk_df_active")}
                    </th>
                    <th className="px-3 py-2 font-medium tracking-wider text-[10px] uppercase">
                      {t("dk_df_size")}
                    </th>
                    <th className="px-3 py-2 font-medium tracking-wider text-[10px] uppercase">
                      {t("dk_df_reclaimable")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dfModal.rows.map((r) => (
                    <tr
                      key={r.dfType}
                      className="border-b border-border/30 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-2.5 font-medium text-[13px]">{r.dfType}</td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground tabular-nums">
                        {r.total}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground tabular-nums">
                        {r.active}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground tabular-nums">
                        {r.size}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-amber-400 tabular-nums">
                        {r.reclaimable}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-border/60">
          <span className="text-[11px] text-muted-foreground">{t("dk_df_hint")}</span>
          <Button
            variant="destructive"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={onPrune}
            disabled={dfModal.loading}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("dk_df_prune")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
