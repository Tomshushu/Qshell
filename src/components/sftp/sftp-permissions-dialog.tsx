import { Save, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { FileEntry } from "@/services/api/types";
import type { PermissionsState } from "./sftp-types";

// Custom Switch component for Edit Permissions UI
export function Switch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
          checked ? "translate-x-4" : "translate-x-1",
        )}
      />
    </button>
  );
}

export interface SftpPermissionsDialogProps {
  permissionsTarget: FileEntry | null;
  perms: PermissionsState;
  setPerms: React.Dispatch<React.SetStateAction<PermissionsState>>;
  permsSymbol: string;
  octalDisplay: string;
  ownerUser: string;
  setOwnerUser: (val: string) => void;
  ownerGroup: string;
  setOwnerGroup: (val: string) => void;
  permissionsRecursive: boolean;
  setPermissionsRecursive: (val: boolean) => void;
  permSaving: boolean;
  onClose: () => void;
  onSave: () => void;
  t: (key: string) => string;
}

export function SftpPermissionsDialog({
  permissionsTarget,
  perms,
  setPerms,
  permsSymbol,
  octalDisplay,
  ownerUser,
  setOwnerUser,
  ownerGroup,
  setOwnerGroup,
  permissionsRecursive,
  setPermissionsRecursive,
  permSaving,
  onClose,
  onSave,
  t,
}: SftpPermissionsDialogProps) {
  return (
    <Dialog
      open={!!permissionsTarget}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-[420px] rounded-xl p-5 border border-border/60 glass-strong">
        <DialogHeader className="flex flex-row items-center justify-between pb-3 border-b">
          <DialogTitle className="text-sm font-bold text-foreground">
            {t("sftp_perm_title")}
          </DialogTitle>
        </DialogHeader>

        {permissionsTarget && (
          <div className="flex flex-col gap-4 py-3 text-xs text-foreground">
            {/* Path */}
            <div className="text-[11px] text-muted-foreground font-mono truncate select-all">
              {permissionsTarget.path}
            </div>

            {/* 权限明细读数：随开关实时变化的权限串 + 八进制 */}
            <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-md">
              <div>
                <p className="text-[11px] text-muted-foreground">
                  {t("fperm_perm_string")}
                </p>
                <p className="text-base font-mono font-bold">{permsSymbol}</p>
              </div>
              <div className="border-l border-border pl-4">
                <p className="text-[11px] text-muted-foreground">
                  {t("fperm_octal")}
                </p>
                <p className="text-base font-mono font-bold">{octalDisplay}</p>
              </div>
            </div>

            {/* Table */}
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] font-bold text-[11px] text-muted-foreground border-b pb-1">
                <span>{t("sftp_perm_file_access")}</span>
                <span className="text-center">{t("sftp_perm_read")}</span>
                <span className="text-center">{t("sftp_perm_write")}</span>
                <span className="text-center">{t("sftp_perm_execute")}</span>
              </div>

              {/* Owner */}
              <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] items-center">
                <span className="text-muted-foreground">
                  {t("sftp_perm_owner")}
                </span>
                <div className="flex justify-center">
                  <Switch
                    checked={perms.owner.read}
                    onCheckedChange={(checked) =>
                      setPerms((prev) => ({
                        ...prev,
                        owner: { ...prev.owner, read: checked },
                      }))
                    }
                  />
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={perms.owner.write}
                    onCheckedChange={(checked) =>
                      setPerms((prev) => ({
                        ...prev,
                        owner: { ...prev.owner, write: checked },
                      }))
                    }
                  />
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={perms.owner.execute}
                    onCheckedChange={(checked) =>
                      setPerms((prev) => ({
                        ...prev,
                        owner: { ...prev.owner, execute: checked },
                      }))
                    }
                  />
                </div>
              </div>

              {/* Groups */}
              <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] items-center">
                <span className="text-muted-foreground">
                  {t("sftp_perm_group")}
                </span>
                <div className="flex justify-center">
                  <Switch
                    checked={perms.group.read}
                    onCheckedChange={(checked) =>
                      setPerms((prev) => ({
                        ...prev,
                        group: { ...prev.group, read: checked },
                      }))
                    }
                  />
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={perms.group.write}
                    onCheckedChange={(checked) =>
                      setPerms((prev) => ({
                        ...prev,
                        group: { ...prev.group, write: checked },
                      }))
                    }
                  />
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={perms.group.execute}
                    onCheckedChange={(checked) =>
                      setPerms((prev) => ({
                        ...prev,
                        group: { ...prev.group, execute: checked },
                      }))
                    }
                  />
                </div>
              </div>

              {/* Others */}
              <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] items-center">
                <span className="text-muted-foreground">
                  {t("sftp_perm_others")}
                </span>
                <div className="flex justify-center">
                  <Switch
                    checked={perms.others.read}
                    onCheckedChange={(checked) =>
                      setPerms((prev) => ({
                        ...prev,
                        others: { ...prev.others, read: checked },
                      }))
                    }
                  />
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={perms.others.write}
                    onCheckedChange={(checked) =>
                      setPerms((prev) => ({
                        ...prev,
                        others: { ...prev.others, write: checked },
                      }))
                    }
                  />
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={perms.others.execute}
                    onCheckedChange={(checked) =>
                      setPerms((prev) => ({
                        ...prev,
                        others: { ...prev.others, execute: checked },
                      }))
                    }
                  />
                </div>
              </div>
            </div>

            {/* Ownership */}
            <div className="flex flex-col gap-2.5 mt-2 border-t pt-3">
              <span className="font-bold text-[11px] text-muted-foreground">
                {t("sftp_perm_ownership")}
              </span>

              <div className="flex justify-between items-center h-8">
                <span className="text-muted-foreground">
                  {t("sftp_perm_user")}
                </span>
                <input
                  type="text"
                  value={ownerUser}
                  onChange={(e) => setOwnerUser(e.target.value)}
                  className="bg-transparent text-right border-none outline-none font-mono text-[11px] text-foreground cursor-text max-w-[180px]"
                />
              </div>

              <div className="flex justify-between items-center h-8">
                <span className="text-muted-foreground">
                  {t("sftp_perm_group")}
                </span>
                <input
                  type="text"
                  value={ownerGroup}
                  onChange={(e) => setOwnerGroup(e.target.value)}
                  className="bg-transparent text-right border-none outline-none font-mono text-[11px] text-foreground cursor-text max-w-[180px]"
                />
              </div>

              {/* Recursive switch — 仅对文件夹显示 */}
              {permissionsTarget.isDirectory && (
                <div className="flex justify-between items-center h-8 border-t border-dashed pt-2.5 mt-1">
                  <span className="text-muted-foreground">
                    {t("sftp_perm_apply_recursively")}
                  </span>
                  <Switch
                    checked={permissionsRecursive}
                    onCheckedChange={setPermissionsRecursive}
                  />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 mt-4">
              <Button
                onClick={onSave}
                size="sm"
                className="rounded-lg px-4"
                disabled={permSaving}
              >
                {permSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Save className="h-4 w-4 mr-1" />
                )}
                {t("sftp_perm_save")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
