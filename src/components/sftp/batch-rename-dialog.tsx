import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  File,
  Folder,
  Hash,
  Loader2,
  Replace,
  Type,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";

export type BatchRenameTarget = {
  path: string;
  name: string;
  isDirectory: boolean;
};

export type BatchRenameResult = {
  succeeded: number;
  failed: Array<{ path: string; error: string }>;
};

export interface BatchRenameDialogProps {
  open: boolean;
  onClose: () => void;
  items: BatchRenameTarget[];
  onExecuteRename: (
    renames: Array<{ oldPath: string; newPath: string }>,
  ) => Promise<BatchRenameResult>;
  title?: string;
  existingNames?: ReadonlySet<string> | readonly string[];
  targetPlatform?: "windows" | "posix";
}

type RenameMode = "replace" | "affix" | "sequence";

interface PreviewRow {
  item: BatchRenameTarget;
  newName: string;
  newPath: string;
  isUnchanged: boolean;
  validationError: string | null;
  hasCollision: boolean;
}

function splitNameParts(
  name: string,
  isDirectory: boolean,
): { stem: string; extWithDot: string; ext: string } {
  if (isDirectory) {
    return { stem: name, extWithDot: "", ext: "" };
  }
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx <= 0) {
    return { stem: name, extWithDot: "", ext: "" };
  }
  return {
    stem: name.slice(0, dotIdx),
    extWithDot: name.slice(dotIdx),
    ext: name.slice(dotIdx + 1),
  };
}

function buildRenamedPath(oldPath: string, newName: string): string {
  const lastSlash = Math.max(oldPath.lastIndexOf("/"), oldPath.lastIndexOf("\\"));
  if (lastSlash < 0) return newName;
  return oldPath.slice(0, lastSlash + 1) + newName;
}

function validateTargetFileName(
  name: string,
  targetPlatform?: "windows" | "posix",
): string | null {
  if (!name || !name.trim()) return "新名称不能为空";
  if (name === "." || name === "..") return "名称不能为 . 或 ..";
  if (targetPlatform === "windows" && /[\\/:*?"<>|]/.test(name)) {
    return 'Windows 文件名不能包含 \\ / : * ? " < > | 等保留字符';
  }
  if (/[\\/]/.test(name)) return "名称不能包含路径分隔符";
  if (/[\p{Cc}]/u.test(name)) return "名称不能包含控制字符";
  if (name.length > 255) return "名称长度不能超过 255 个字符";
  return null;
}

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function BatchRenameDialog({
  open,
  onClose,
  items,
  onExecuteRename,
  title = "批量重命名",
  existingNames,
  targetPlatform,
}: BatchRenameDialogProps) {
  const { toast } = useToast();

  const [mode, setMode] = useState<RenameMode>("replace");

  // 查找替换状态
  const [findPattern, setFindPattern] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(true);

  // 前后缀状态
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [affixPreserveExt, setAffixPreserveExt] = useState(false);

  // 序号模板状态
  const [sequenceTemplate, setSequenceTemplate] = useState("{name}_{n}");
  const [startIndex, setStartIndex] = useState(1);
  const [padLength, setPadLength] = useState(2);
  const [sequencePreserveExt, setSequencePreserveExt] = useState(true);

  // 执行状态与结果
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<BatchRenameResult | null>(null);
  const [succeededOldPaths, setSucceededOldPaths] = useState<Set<string>>(() => new Set());
  const mountedRef = useRef(true);
  const sessionEpochRef = useRef(0);
  const prevOpenRef = useRef(open);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionEpochRef.current += 1;
    };
  }, []);

  useEffect(() => {
    sessionEpochRef.current += 1;
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open) return;

    // 每次「重新打开」都必须清空上一轮的规则，否则上一次的查找/替换串或序号模板
    // 会被直接套用到新选中的文件上，用户点「应用重命名」就会误改文件名。
    // 只在 false -> true 时重置；同一轮打开中 items 变化不应抹掉正在编辑的规则。
    if (!wasOpen) {
      setMode("replace");
      setFindPattern("");
      setReplaceWith("");
      setUseRegex(false);
      setCaseSensitive(true);
      setPrefix("");
      setSuffix("");
      setAffixPreserveExt(false);
      setSequenceTemplate("{name}_{n}");
      setStartIndex(1);
      setPadLength(2);
      setSequencePreserveExt(true);
    }
    setSubmitting(false);
    setSubmitError(null);
    setExecutionResult(null);
    setSucceededOldPaths(new Set());
  }, [open, items]);

  const activeItems = useMemo(
    () => items.filter((item) => !succeededOldPaths.has(item.path)),
    [items, succeededOldPaths],
  );

  const { previewRows, regexError } = useMemo<{
    previewRows: PreviewRow[];
    regexError: string | null;
  }>(() => {
    let compiledRegex: RegExp | null = null;
    let currentRegexError: string | null = null;

    if (mode === "replace" && findPattern) {
      try {
        if (useRegex) {
          compiledRegex = new RegExp(findPattern, caseSensitive ? "g" : "gi");
        } else if (!caseSensitive) {
          compiledRegex = new RegExp(escapeRegExp(findPattern), "gi");
        }
      } catch (err) {
        currentRegexError =
          err instanceof Error ? err.message : "正则表达式格式无效";
      }
    }

    const safeStart = Number.isFinite(startIndex)
      ? Math.max(0, Math.floor(startIndex))
      : 1;
    const safePad = Number.isFinite(padLength)
      ? Math.max(1, Math.min(12, Math.floor(padLength)))
      : 1;

    const rawRows = activeItems.map((item, idx) => {
      let newName = item.name;

      if (mode === "replace") {
        if (findPattern && !currentRegexError) {
          if (useRegex && compiledRegex) {
            newName = item.name.replace(compiledRegex, replaceWith);
          } else if (!caseSensitive && compiledRegex) {
            newName = item.name.replace(compiledRegex, () => replaceWith);
          } else {
            newName = item.name.split(findPattern).join(replaceWith);
          }
        }
      } else if (mode === "affix") {
        if (affixPreserveExt) {
          const { stem, extWithDot } = splitNameParts(item.name, item.isDirectory);
          newName = `${prefix}${stem}${suffix}${extWithDot}`;
        } else {
          newName = `${prefix}${item.name}${suffix}`;
        }
      } else if (mode === "sequence") {
        const { stem, extWithDot, ext } = splitNameParts(
          item.name,
          item.isDirectory,
        );
        const seqStr = String(safeStart + idx).padStart(safePad, "0");
        const baseName = sequencePreserveExt ? stem : item.name;
        const tpl = sequenceTemplate || "{name}_{n}";
        const hasExtToken = tpl.includes("{ext}");
        const formatted = tpl.replace(/\{(n|name|ext)\}/g, (_, token: string) => {
          if (token === "n") return seqStr;
          if (token === "name") return baseName;
          return ext;
        });
        newName =
          sequencePreserveExt && !hasExtToken && extWithDot
            ? `${formatted}${extWithDot}`
            : formatted;
      }

      const newPath = buildRenamedPath(item.path, newName);
      const validationError = validateTargetFileName(newName, targetPlatform);
      const isUnchanged = newName === item.name;

      return {
        item,
        newName,
        newPath,
        isUnchanged,
        validationError,
      };
    });

    const isWindows = targetPlatform === "windows";
    const normKey = (val: string) => (isWindows ? val.toLowerCase() : val);

    const pathCounts = new Map<string, number>();
    const pendingOldPaths = new Set<string>();
    const selectedNameKeys = new Set<string>();
    for (const row of rawRows) {
      const newPathKey = normKey(row.newPath);
      pathCounts.set(newPathKey, (pathCounts.get(newPathKey) ?? 0) + 1);
      selectedNameKeys.add(normKey(row.item.name));
      if (!row.isUnchanged) {
        pendingOldPaths.add(normKey(row.item.path));
      }
    }

    const existingNameKeys = new Set<string>();
    if (existingNames) {
      for (const existingName of existingNames) {
        existingNameKeys.add(normKey(existingName));
      }
    }

    const finalRows: PreviewRow[] = rawRows.map((row) => {
      const newPathKey = normKey(row.newPath);
      const newNameKey = normKey(row.newName);
      const oldNameKey = normKey(row.item.name);
      const oldPathKey = normKey(row.item.path);
      const collidesWithinBatch =
        (pathCounts.get(newPathKey) ?? 0) > 1 ||
        (!row.isUnchanged &&
          newPathKey !== oldPathKey &&
          pendingOldPaths.has(newPathKey));
      const collidesWithUnselectedSibling =
        !row.isUnchanged &&
        newNameKey !== oldNameKey &&
        existingNameKeys.has(newNameKey) &&
        !selectedNameKeys.has(newNameKey);

      return {
        ...row,
        hasCollision: collidesWithinBatch || collidesWithUnselectedSibling,
      };
    });

    return { previewRows: finalRows, regexError: currentRegexError };
  }, [
    activeItems,
    existingNames,
    targetPlatform,
    mode,
    findPattern,
    replaceWith,
    useRegex,
    caseSensitive,
    prefix,
    suffix,
    affixPreserveExt,
    sequenceTemplate,
    startIndex,
    padLength,
    sequencePreserveExt,
  ]);

  const collisionCount = useMemo(
    () => previewRows.filter((r) => r.hasCollision).length,
    [previewRows],
  );
  const invalidCount = useMemo(
    () => previewRows.filter((r) => r.validationError !== null).length,
    [previewRows],
  );
  const pendingRenames = useMemo(
    () =>
      previewRows
        .filter((r) => !r.isUnchanged && !r.validationError && !r.hasCollision)
        .map((r) => ({ oldPath: r.item.path, newPath: r.newPath })),
    [previewRows],
  );

  const canApply =
    !submitting &&
    !regexError &&
    activeItems.length > 0 &&
    collisionCount === 0 &&
    invalidCount === 0 &&
    pendingRenames.length > 0;

  const handleApply = async () => {
    if (!canApply) return;
    const epoch = sessionEpochRef.current;
    const submittedOldPaths = pendingRenames.map((r) => r.oldPath);
    setSubmitting(true);
    setSubmitError(null);
    setExecutionResult(null);
    // 后端无响应时不能把弹窗永久锁在 submitting 状态（所有关闭入口都被禁用）。
    // 超时只解除 UI 锁定并提示，迟到的结果仍由 sessionEpochRef 兜底，不会串台。
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve(onExecuteRename(pendingRenames)),
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("批量重命名执行超时，请刷新文件列表确认结果")),
            120_000,
          );
        }),
      ]);
      if (!mountedRef.current || sessionEpochRef.current !== epoch) return;
      if (result.failed.length === 0) {
        toast.success(`已成功重命名 ${result.succeeded} 项`);
        onClose();
      } else {
        const failedSet = new Set(result.failed.map((f) => f.path));
        const completed = submittedOldPaths.filter((p) => !failedSet.has(p));
        if (completed.length > 0) {
          setSucceededOldPaths((prev) => {
            const next = new Set(prev);
            for (const p of completed) next.add(p);
            return next;
          });
        }
        setExecutionResult(result);
        toast.error(
          `批量重命名部分失败：成功 ${result.succeeded} 项，失败 ${result.failed.length} 项`,
        );
      }
    } catch (err) {
      if (!mountedRef.current || sessionEpochRef.current !== epoch) return;
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(msg || "批量重命名执行失败");
      toast.error(`批量重命名失败: ${msg}`);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (mountedRef.current && sessionEpochRef.current === epoch) {
        setSubmitting(false);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (isOpen || submitting) return;
        onClose();
      }}
    >
      <DialogContent
        showCloseButton={!submitting}
        className="w-[calc(100vw-2rem)] max-w-2xl max-h-[85vh] flex flex-col p-6 gap-4 overflow-hidden"
      >
        <DialogHeader className="pr-6 space-y-1 text-left sm:text-left shrink-0">
          <DialogTitle className="text-base font-semibold tracking-tight">
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            已选择 {activeItems.length} 个项目，实时预览重命名结果后再确认应用。
          </DialogDescription>
        </DialogHeader>

        {/* 模式切换与规则配置 */}
        <Tabs
          value={mode}
          onValueChange={(v) => setMode(v as RenameMode)}
          className="shrink-0"
        >
          <TabsList className="grid w-full grid-cols-3 h-8">
            <TabsTrigger value="replace" className="text-xs gap-1.5 h-6">
              <Replace className="h-3.5 w-3.5" />
              <span>查找替换</span>
            </TabsTrigger>
            <TabsTrigger value="affix" className="text-xs gap-1.5 h-6">
              <Type className="h-3.5 w-3.5" />
              <span>前后缀</span>
            </TabsTrigger>
            <TabsTrigger value="sequence" className="text-xs gap-1.5 h-6">
              <Hash className="h-3.5 w-3.5" />
              <span>序号模板</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="replace" className="mt-3 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label
                  htmlFor="batch-rename-find"
                  className="text-xs font-medium text-foreground/80"
                >
                  查找内容
                </label>
                <Input
                  id="batch-rename-find"
                  value={findPattern}
                  onChange={(e) => setFindPattern(e.target.value)}
                  placeholder={useRegex ? "输入正则表达式，如 ^log_(\\d+)" : "输入要查找的文本"}
                  className="h-8 text-xs font-mono"
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="batch-rename-replace"
                  className="text-xs font-medium text-foreground/80"
                >
                  替换为
                </label>
                <Input
                  id="batch-rename-replace"
                  value={replaceWith}
                  onChange={(e) => setReplaceWith(e.target.value)}
                  placeholder={useRegex ? "支持 $1 分组引用" : "输入替换后的文本"}
                  className="h-8 text-xs font-mono"
                  disabled={submitting}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useRegex}
                  onChange={(e) => setUseRegex(e.target.checked)}
                  disabled={submitting}
                  className="rounded border-border"
                />
                <span>使用正则表达式</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                  disabled={submitting}
                  className="rounded border-border"
                />
                <span>区分大小写</span>
              </label>
            </div>
          </TabsContent>

          <TabsContent value="affix" className="mt-3 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label
                  htmlFor="batch-rename-prefix"
                  className="text-xs font-medium text-foreground/80"
                >
                  前缀
                </label>
                <Input
                  id="batch-rename-prefix"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  placeholder="例如 backup_"
                  className="h-8 text-xs font-mono"
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="batch-rename-suffix"
                  className="text-xs font-medium text-foreground/80"
                >
                  后缀
                </label>
                <Input
                  id="batch-rename-suffix"
                  value={suffix}
                  onChange={(e) => setSuffix(e.target.value)}
                  placeholder="例如 _v2"
                  className="h-8 text-xs font-mono"
                  disabled={submitting}
                />
              </div>
            </div>
            <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={affixPreserveExt}
                onChange={(e) => setAffixPreserveExt(e.target.checked)}
                disabled={submitting}
                className="rounded border-border"
              />
              <span>保留文件扩展名（将后缀插入扩展名之前）</span>
            </label>
          </TabsContent>

          <TabsContent value="sequence" className="mt-3 space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <div className="sm:col-span-2 space-y-1">
                <label
                  htmlFor="batch-rename-template"
                  className="text-xs font-medium text-foreground/80"
                >
                  命名模板
                </label>
                <Input
                  id="batch-rename-template"
                  value={sequenceTemplate}
                  onChange={(e) => setSequenceTemplate(e.target.value)}
                  placeholder="支持 {name} 与 {n}"
                  className="h-8 text-xs font-mono"
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="batch-rename-start-index"
                  className="text-xs font-medium text-foreground/80"
                >
                  起始序号
                </label>
                <Input
                  id="batch-rename-start-index"
                  type="number"
                  min={0}
                  value={startIndex}
                  onChange={(e) => setStartIndex(Number(e.target.value))}
                  className="h-8 text-xs font-mono"
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="batch-rename-pad-length"
                  className="text-xs font-medium text-foreground/80"
                >
                  补零位数
                </label>
                <Input
                  id="batch-rename-pad-length"
                  type="number"
                  min={1}
                  max={12}
                  value={padLength}
                  onChange={(e) => setPadLength(Number(e.target.value))}
                  className="h-8 text-xs font-mono"
                  disabled={submitting}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sequencePreserveExt}
                  onChange={(e) => setSequencePreserveExt(e.target.checked)}
                  disabled={submitting}
                  className="rounded border-border"
                />
                <span>自动保留原扩展名</span>
              </label>
              <span className="text-[11px] font-mono">
                占位符: {"{name}"} 原名 · {"{n}"} 序号
              </span>
            </div>
          </TabsContent>
        </Tabs>

        {/* 校验与警告提示 */}
        {(regexError || collisionCount > 0 || invalidCount > 0 || submitError) && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive shrink-0"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="space-y-0.5 min-w-0">
              {regexError && <div>正则表达式无效: {regexError}</div>}
              {collisionCount > 0 && (
                <div>存在 {collisionCount} 项重名冲突，请调整规则后再应用。</div>
              )}
              {invalidCount > 0 && (
                <div>存在 {invalidCount} 项非法或空文件名，请修正后再应用。</div>
              )}
              {submitError && <div>{submitError}</div>}
            </div>
          </div>
        )}

        {/* 执行结果失败汇总 */}
        {executionResult && executionResult.failed.length > 0 && (
          <div
            role="alert"
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs space-y-1.5 shrink-0"
          >
            <div className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
              <XCircle className="h-4 w-4 shrink-0" />
              <span>
                部分重命名失败：成功 {executionResult.succeeded} 项，失败{" "}
                {executionResult.failed.length} 项
              </span>
            </div>
            <div className="max-h-24 overflow-y-auto space-y-1 font-mono text-[11px] text-destructive">
              {executionResult.failed.map((f) => (
                <div key={f.path} className="break-all">
                  {f.path}: {f.error}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 实时重命名预览表 */}
        <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-border/60 overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground shrink-0">
            <span>重命名预览 ({pendingRenames.length}/{items.length} 项将更新)</span>
          </div>

          <div className="flex-1 min-h-[140px] max-h-60 overflow-y-auto">
            {previewRows.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
                暂无待重命名项目
              </div>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-muted/60 backdrop-blur-xs text-[11px] text-muted-foreground border-b border-border/50">
                  <tr>
                    <th className="text-left font-medium px-3 py-1.5">原名称</th>
                    <th className="w-6 px-1 py-1.5" aria-hidden="true" />
                    <th className="text-left font-medium px-3 py-1.5">新名称</th>
                    <th className="text-right font-medium px-3 py-1.5 w-24">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 font-mono">
                  {previewRows.map((row) => {
                    const hasIssue = row.hasCollision || row.validationError !== null;
                    return (
                      <tr
                        key={row.item.path}
                        className={cn(
                          hasIssue
                            ? "bg-destructive/5"
                            : row.isUnchanged
                              ? "text-muted-foreground/70"
                              : "bg-emerald-500/5",
                        )}
                      >
                        <td className="px-3 py-1.5 max-w-[200px] truncate" title={row.item.name}>
                          <span className="inline-flex items-center gap-1.5 min-w-0">
                            {row.item.isDirectory ? (
                              <Folder className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                            ) : (
                              <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate">{row.item.name}</span>
                          </span>
                        </td>
                        <td className="px-1 py-1.5 text-center text-muted-foreground">
                          <ArrowRight className="h-3 w-3 inline" />
                        </td>
                        <td
                          className={cn(
                            "px-3 py-1.5 max-w-[200px] truncate",
                            hasIssue && "text-destructive font-medium",
                            !hasIssue && !row.isUnchanged && "text-emerald-600 dark:text-emerald-400 font-medium",
                          )}
                          title={row.newName}
                        >
                          {row.newName || <span className="italic opacity-60">(空)</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          {row.validationError ? (
                            <Badge variant="soft-destructive" className="px-1.5 py-0 text-[10px]">
                              无效
                            </Badge>
                          ) : row.hasCollision ? (
                            <Badge variant="soft-destructive" className="px-1.5 py-0 text-[10px]">
                              名称冲突
                            </Badge>
                          ) : row.isUnchanged ? (
                            <Badge variant="soft" className="px-1.5 py-0 text-[10px]">
                              无变化
                            </Badge>
                          ) : (
                            <Badge variant="soft-success" className="px-1.5 py-0 text-[10px]">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              待应用
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={submitting}
            className="h-8 px-3.5 text-xs"
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleApply()}
            disabled={!canApply}
            className="h-8 px-4 text-xs gap-1.5"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>应用重命名 ({pendingRenames.length})</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
