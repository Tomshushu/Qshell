import React, { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Terminal, Check, Sparkles } from "lucide-react";
import { useTranslation } from "@/i18n";
import { playSound, SoundType } from "@/lib/sound";

export interface SnippetParam {
  key: string;
  raw: string;
  label: string;
  defaultValue: string;
}

/**
 * 提取命令模板中的参数变量，形如 `{{port:22}}` 或 `{{container}}`
 */
export function extractSnippetParams(template: string): SnippetParam[] {
  const regex = /\{\{([^}:|]+)(?:[:|]([^}]*))?\}\}/g;
  const params: SnippetParam[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    const key = match[1].trim();
    if (!seen.has(key)) {
      seen.add(key);
      params.push({
        key,
        raw: match[0],
        label: key,
        defaultValue: match[2]?.trim() || "",
      });
    }
  }
  return params;
}

/**
 * 将参数值填入模板字符串
 */
export function interpolateSnippet(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{\{([^}:|]+)(?:[:|]([^}]*))?\}\}/g, (_, key, def) => {
    const trimmedKey = key.trim();
    const val = values[trimmedKey];
    if (val !== undefined && val.trim() !== "") {
      return val;
    }
    return def ? def.trim() : `{{${trimmedKey}}}`;
  });
}

export interface ParameterizedSnippetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: string;
  description?: string;
  onConfirm: (interpolatedCommand: string, action: "copy" | "insert") => void;
  hasInsertTarget?: boolean;
}

export function ParameterizedSnippetDialog({
  open,
  onOpenChange,
  template,
  description,
  onConfirm,
  hasInsertTarget = false,
}: ParameterizedSnippetDialogProps) {
  const { t } = useTranslation();
  const params = useMemo(() => extractSnippetParams(template), [template]);

  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  // 打开时重置参数值为默认值
  useEffect(() => {
    if (open) {
      const initial: Record<string, string> = {};
      for (const p of params) {
        initial[p.key] = p.defaultValue;
      }
      setValues(initial);
      setCopied(false);
    }
  }, [open, params]);

  const previewCommand = useMemo(
    () => interpolateSnippet(template, values),
    [template, values],
  );

  const handleCopy = () => {
    playSound(SoundType.CLICK);
    onConfirm(previewCommand, "copy");
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      onOpenChange(false);
    }, 800);
  };

  const handleInsert = () => {
    playSound(SoundType.SWITCH);
    onConfirm(previewCommand, "insert");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-6 gap-5">
        <DialogHeader className="gap-1.5">
          <div className="flex items-center gap-2 text-primary">
            <Sparkles className="h-4 w-4" />
            <DialogTitle className="text-base font-semibold">
              {t("snippet_param_dialog_title")}
            </DialogTitle>
          </div>
          {description && (
            <DialogDescription className="text-xs text-muted-foreground">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>

        {/* 动态参数输入表单 */}
        <div className="space-y-3 max-h-[300px] overflow-y-auto px-0.5">
          {params.map((p, idx) => (
            <div key={p.key} className="space-y-1">
              <label className="text-[11px] font-medium text-foreground flex items-center justify-between">
                <span>{p.label}</span>
                {p.defaultValue && (
                  <span className="text-[10px] text-muted-foreground/60 font-mono">
                    默认: {p.defaultValue}
                  </span>
                )}
              </label>
              <Input
                value={values[p.key] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [p.key]: e.target.value }))
                }
                placeholder={p.defaultValue || `输入 ${p.label}...`}
                className="h-8 text-xs font-mono"
                autoFocus={idx === 0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (hasInsertTarget) {
                      handleInsert();
                    } else {
                      handleCopy();
                    }
                  }
                }}
              />
            </div>
          ))}
        </div>

        {/* 实时指令预览 */}
        <div className="space-y-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            {t("snippet_param_preview")}
          </span>
          <div className="p-3 rounded-md bg-muted/50 border border-border/50 font-mono text-xs text-foreground break-all select-all">
            {previewCommand}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("common_cancel")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleCopy}
            className="gap-1.5"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {t("snippet_param_copy")}
          </Button>
          {hasInsertTarget && (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleInsert}
              className="gap-1.5"
            >
              <Terminal className="h-3.5 w-3.5" />
              {t("snippet_param_insert")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
