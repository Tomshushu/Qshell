import React, { useMemo } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/code-editor";
import { Pencil, Loader2, X, GitCompare, Check, Save } from "lucide-react";
import { useTranslation } from "@/i18n";
import { QshellLoader } from "@/components/ui/qshell-loader";
import { lineDiff } from "../docker-utils";

export interface ComposeDiffViewProps {
  original: string;
  content: string;
}

export function ComposeDiffView({ original, content }: ComposeDiffViewProps) {
  const { t } = useTranslation();
  const rows = useMemo(() => lineDiff(original, content), [original, content]);

  if (original === content) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        {t("docker_compose_diff_empty")}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-zinc-950 font-mono text-[12px] leading-relaxed">
      {rows.map((r, i) => {
        if (r.type === "same") {
          return (
            <div key={i} className="px-4 py-0.5 text-zinc-500 whitespace-pre-wrap break-all">
              <span className="inline-block w-4 text-zinc-700 select-none"> </span>
              {r.text || "\u00A0"}
            </div>
          );
        }
        if (r.type === "add") {
          return (
            <div
              key={i}
              className="px-4 py-0.5 bg-emerald-500/10 text-emerald-300 whitespace-pre-wrap break-all border-l-2 border-emerald-500/60"
            >
              <span className="inline-block w-4 text-emerald-500 select-none">+</span>
              {r.text || "\u00A0"}
            </div>
          );
        }
        return (
          <div
            key={i}
            className="px-4 py-0.5 bg-rose-500/10 text-rose-300 whitespace-pre-wrap break-all border-l-2 border-rose-500/60"
          >
            <span className="inline-block w-4 text-rose-500 select-none">-</span>
            {r.text || "\u00A0"}
          </div>
        );
      })}
    </div>
  );
}

export interface DockerComposeEditModalProps {
  composeEditModal: {
    path: string;
    content: string;
    original: string;
    loading: boolean;
    saving: boolean;
    error: string | null;
    view: "edit" | "diff";
  } | null;
  setComposeEditModal: React.Dispatch<
    React.SetStateAction<{
      path: string;
      content: string;
      original: string;
      loading: boolean;
      saving: boolean;
      error: string | null;
      view: "edit" | "diff";
    } | null>
  >;
  composeValidating: boolean;
  onValidate: () => void;
  onSave: () => void;
  onClose: () => void;
}

export function DockerComposeEditModal({
  composeEditModal,
  setComposeEditModal,
  composeValidating,
  onValidate,
  onSave,
  onClose,
}: DockerComposeEditModalProps) {
  const { t } = useTranslation();

  if (!composeEditModal) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !composeEditModal.saving) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="w-[92vw] max-w-5xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden"
      >
        {/* 标题栏：编辑图标 + 文件路径 + 关闭按钮 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Pencil className="h-4 w-4 text-sky-400 flex-shrink-0" />
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {t("docker_compose_edit")}
            </span>
            <span
              className="font-mono text-[11px] text-foreground truncate"
              title={composeEditModal.path}
            >
              {composeEditModal.path}
            </span>
          </div>
          <button
            className="p-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-accent transition-colors flex-shrink-0 disabled:opacity-40"
            onClick={onClose}
            disabled={composeEditModal.saving}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 内容区 */}
        {composeEditModal.loading ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm gap-2">
            <QshellLoader size="md" text={t("dk_loading")} />

          </div>
        ) : composeEditModal.error ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <X className="h-8 w-8 text-destructive" />
            <p className="text-sm text-destructive font-medium">
              {t("docker_compose_edit_read_err")}
            </p>
            <pre className="text-[11px] text-muted-foreground font-mono max-w-full overflow-auto whitespace-pre-wrap break-all">
              {composeEditModal.error}
            </pre>
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0">
              {composeEditModal.view === "diff" ? (
                <ComposeDiffView
                  original={composeEditModal.original}
                  content={composeEditModal.content}
                />
              ) : (
                <CodeEditor
                  value={composeEditModal.content}
                  onValueChange={(val) =>
                    setComposeEditModal({ ...composeEditModal, content: val })
                  }
                  fileName={composeEditModal.path}
                  disabled={composeEditModal.saving}
                  className="h-full"
                />
              )}
            </div>
            {/* 底部按钮栏 */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-border/60 gap-3">
              <span className="text-[10px] text-muted-foreground">
                {composeEditModal.content !== composeEditModal.original ? (
                  <span className="text-amber-400">● {t("docker_compose_edit_unsaved")}</span>
                ) : (
                  <span>{t("docker_compose_edit_unchanged")}</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={onClose}
                  disabled={composeEditModal.saving}
                >
                  {t("dk_cancel")}
                </Button>
                {/* Diff/编辑 切换：有改动时 Diff 才有意义，原内容下等同未修改 */}
                <Button
                  size="sm"
                  variant={composeEditModal.view === "diff" ? "default" : "outline"}
                  className="h-8 text-xs gap-1.5"
                  onClick={() =>
                    setComposeEditModal({
                      ...composeEditModal,
                      view: composeEditModal.view === "diff" ? "edit" : "diff",
                    })
                  }
                  disabled={
                    composeEditModal.saving ||
                    composeEditModal.content === composeEditModal.original
                  }
                >
                  <GitCompare className="h-3.5 w-3.5" />
                  {t("docker_compose_diff")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5"
                  onClick={onValidate}
                  disabled={
                    composeEditModal.saving ||
                    composeValidating ||
                    composeEditModal.view === "diff"
                  }
                >
                  {composeValidating ? (
                    <QshellLoader size="xs" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {t("dk_compose_validate")}
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={onSave}
                  disabled={
                    composeEditModal.saving ||
                    composeEditModal.content === composeEditModal.original ||
                    composeEditModal.view === "diff"
                  }
                >
                  {composeEditModal.saving ? (
                    <QshellLoader size="xs" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  {t("docker_compose_edit_save")}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
