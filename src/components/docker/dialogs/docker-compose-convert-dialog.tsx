import React from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n";

export interface DockerComposeConvertDialogProps {
  open: boolean;
  convertDialog: {
    runCmd: string;
    name: string;
    dir: string;
    dirTouched?: boolean;
    creating?: boolean;
  } | null;
  setConvertDialog: React.Dispatch<
    React.SetStateAction<{
      runCmd: string;
      name: string;
      dir: string;
      dirTouched?: boolean;
      creating?: boolean;
    } | null>
  >;
  convertPreview: { yaml: string; error: string | null };
  onConfirm: () => void;
  onCancel: () => void;
}

export function DockerComposeConvertDialog({
  open,
  convertDialog,
  setConvertDialog,
  convertPreview,
  onConfirm,
  onCancel,
}: DockerComposeConvertDialogProps) {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      open={open}
      title={t("dk_compose_convert")}
      description={t("dk_compose_convert_desc")}
      confirmLabel={t("dk_compose_convert_confirm")}
      cancelLabel={t("common_cancel")}
      pending={convertDialog?.creating === true}
      onConfirm={onConfirm}
      onCancel={onCancel}
      widthClass="max-w-[680px]"
    >
      {convertDialog && (
        <div className="space-y-2.5 text-left">
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block">
              {t("dk_compose_convert_cmd")}
            </label>
            <textarea
              className="w-full h-20 px-2.5 py-1.5 rounded-md border border-border bg-background text-xs font-mono outline-none focus:ring-1 focus:ring-ring resize-none"
              placeholder={
                "docker run -d --name web -p 8080:80 -e TZ=Asia/Shanghai -v /data:/usr/share/nginx/html --restart unless-stopped nginx:latest"
              }
              value={convertDialog.runCmd}
              disabled={convertDialog.creating}
              onChange={(e) =>
                setConvertDialog((p) => (p ? { ...p, runCmd: e.target.value } : p))
              }
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground mb-1 block">
              {t("dk_compose_convert_yaml")}
            </label>
            <pre className="w-full h-40 px-2.5 py-1.5 rounded-md border border-border bg-zinc-950 text-[11px] font-mono text-zinc-200 overflow-auto whitespace-pre-wrap">
              {convertPreview.yaml || (
                <span className="text-muted-foreground">
                  {convertPreview.error || t("dk_compose_convert_placeholder")}
                </span>
              )}
            </pre>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">
                {t("dk_compose_create_name")} *
              </label>
              <Input
                className="h-8 text-xs font-mono"
                value={convertDialog.name}
                disabled={convertDialog.creating}
                onChange={(e) =>
                  setConvertDialog((p) =>
                    p
                      ? {
                          ...p,
                          name: e.target.value,
                          dir: p.dirTouched ? p.dir : `/opt/stacks/${e.target.value}`,
                        }
                      : p,
                  )
                }
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground mb-1 block">
                {t("dk_compose_create_dir")} *
              </label>
              <Input
                className="h-8 text-xs font-mono"
                value={convertDialog.dir}
                disabled={convertDialog.creating}
                onChange={(e) =>
                  setConvertDialog((p) =>
                    p ? { ...p, dir: e.target.value, dirTouched: true } : p,
                  )
                }
              />
            </div>
          </div>
        </div>
      )}
    </ConfirmDialog>
  );
}
