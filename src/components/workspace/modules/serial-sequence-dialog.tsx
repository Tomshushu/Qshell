import { useState, useEffect, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Play,
  Square,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Copy,
  Activity,
  ListOrdered,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import {
  SERIAL_CHECKSUM_OPTIONS,
  type SerialChecksumType,
  appendChecksumToHex,
} from "@/lib/serial-checksum";
import { SelectPopover } from '@/components/ui/select-popover'

export interface SerialSequenceItem {
  id: string;
  enabled: boolean;
  name: string;
  type: "ascii" | "hex";
  payload: string;
  suffix: "\r\n" | "\n" | "\r" | "";
  delayMs: number;
  checksumType: SerialChecksumType;
}

function isSerialSequenceItem(value: unknown): value is SerialSequenceItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.enabled === "boolean" &&
    typeof item.name === "string" &&
    (item.type === "ascii" || item.type === "hex") &&
    typeof item.payload === "string" &&
    ["\r\n", "\n", "\r", ""].includes(String(item.suffix)) &&
    typeof item.delayMs === "number" &&
    item.delayMs >= 0 &&
    item.delayMs <= 60000 &&
    SERIAL_CHECKSUM_OPTIONS.some((option) => option.type === item.checksumType)
  );
}

interface SerialSequenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSendStep: (item: SerialSequenceItem) => Promise<boolean>;
  isConnected: boolean;
}

export function SerialSequenceDialog({
  open,
  onOpenChange,
  onSendStep,
  isConnected,
}: SerialSequenceDialogProps) {
  const { language } = useTranslation();
  const tr = useCallback((zh: string, en: string) => language.startsWith("zh") ? zh : en, [language]);
  const [items, setItems] = useState<SerialSequenceItem[]>(() => {
    try {
      const saved = localStorage.getItem("serial-macro-sequences");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.filter(isSerialSequenceItem).slice(0, 500);
      }
    } catch {
      // 解析失败时回退到空列表
    }
    return [];
  });

  const [isRunning, setIsRunning] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [loopCountLimit, setLoopCountLimit] = useState(0); // 0 = 无限循环
  const [completedLoops, setCompletedLoops] = useState(0);
  const isRunningRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem("serial-macro-sequences", JSON.stringify(items));
    } catch {
      // 持久化失败（如隐私模式）忽略，不影响内存态
    }
  }, [items]);

  const stopExecution = useCallback(() => {
    isRunningRef.current = false;
    setIsRunning(false);
    setActiveStepIndex(null);
  }, []);

  const runSequence = async (loop: boolean) => {
    if (!isConnected || isRunningRef.current) return;
    const enabledItems = items.filter((it) => it.enabled && it.payload.trim());
    if (enabledItems.length === 0) return;

    isRunningRef.current = true;
    setIsRunning(true);
    setIsLooping(loop);
    setCompletedLoops(0);

    let loopCounter = 0;
    while (isRunningRef.current) {
      for (let i = 0; i < items.length; i++) {
        if (!isRunningRef.current) break;
        const item = items[i];
        if (!item.enabled || !item.payload.trim()) continue;

        setActiveStepIndex(i);
        const success = await onSendStep(item);
        if (!success) {
          isRunningRef.current = false;
          break;
        }

        if (item.delayMs > 0 && isRunningRef.current) {
          const deadline = Date.now() + Math.min(item.delayMs, 60000);
          while (isRunningRef.current && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, Math.min(50, deadline - Date.now())));
          }
        }
      }

      if (!isRunningRef.current) break;

      loopCounter++;
      setCompletedLoops(loopCounter);

      if (!loop) break;
      if (loopCountLimit > 0 && loopCounter >= loopCountLimit) break;
      if (!isRunningRef.current) break;
    }

    stopExecution();
  };

  const addItem = () => {
    if (isRunningRef.current) return;
    const newItem: SerialSequenceItem = {
      id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      enabled: true,
      name: `${tr("指令", "Command")} ${items.length + 1}`,
      type: "ascii",
      payload: "",
      suffix: "\r\n",
      delayMs: 500,
      checksumType: "none",
    };
    setItems((prev) => [...prev, newItem]);
  };

  const updateItem = (id: string, partial: Partial<SerialSequenceItem>) => {
    if (isRunningRef.current) return;
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...partial } : it))
    );
  };

  const removeItem = (id: string) => {
    if (isRunningRef.current) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const duplicateItem = (index: number) => {
    if (isRunningRef.current) return;
    const original = items[index];
    const copy: SerialSequenceItem = {
      ...original,
      id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${original.name} (${tr("副本", "copy")})`,
    };
    const next = [...items];
    next.splice(index + 1, 0, copy);
    setItems(next);
  };

  const moveItem = (index: number, direction: "up" | "down") => {
    if (isRunningRef.current) return;
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === items.length - 1) return;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const next = [...items];
    const temp = next[index];
    next[index] = next[targetIndex];
    next[targetIndex] = temp;
    setItems(next);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!isRunning) onOpenChange(v); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden bg-background">
        {/* 对话框顶栏 */}
        <DialogHeader className="px-5 pr-12 py-3.5 border-b border-border/60 bg-muted/15 select-none">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                <ListOrdered className="h-4.5 w-4.5" />
              </div>
              <div>
                <DialogTitle className="text-sm font-semibold text-foreground tracking-tight">
                  {tr("多指令自动化序列发送器", "Command sequence runner")}
                </DialogTitle>
                <DialogDescription className="text-[11.5px] text-muted-foreground mt-0.5">
                  {tr("配置多步指令流水线，支持独立延时、校验码自动追加、单步调试与循环压测。", "Build multi-step command flows with delays, checksums, step testing, and loop execution.")}
                </DialogDescription>
              </div>
            </div>

            {items.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded border border-border/50">
                  {tr("已添加", "Added")} {items.length} {tr("条指令", "commands")}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isRunning}
                  onClick={() => { if (!isRunningRef.current) setItems([]); }}
                  className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                  title={tr("清空所有指令", "Clear all commands")}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  {tr("清空列表", "Clear list")}
                </Button>
              </div>
            )}
          </div>
        </DialogHeader>

        {/* 序列指令列表区 */}
        <div className="flex-1 overflow-y-auto px-5 py-3.5 space-y-2.5">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground select-none">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/40 mb-3 border border-border/60">
                <ListOrdered className="h-6 w-6 text-muted-foreground/60" />
              </div>
              <p className="text-sm font-medium text-foreground">{tr("暂无指令步骤", "No command steps")}</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                {tr("点击下方按钮添加多步指令，支持文本与 HEX 格式、自动校验码追加与流水线延时控制。", "Add steps in text or HEX format, append checksums automatically, and control per-step delays.")}
              </p>
              <Button
                onClick={addItem}
                size="sm"
                className="mt-4 gap-1.5 h-8 text-xs font-semibold cursor-pointer shadow-sm"
              >
                <Plus className="h-3.5 w-3.5" />
                {tr("添加第一条指令", "Add first command")}
              </Button>
            </div>
          ) : (
            <>
              {items.map((item, index) => {
                const isStepActive = isRunning && activeStepIndex === index;
                const previewHex =
                  item.type === "hex" && item.checksumType !== "none" && item.payload.trim()
                    ? appendChecksumToHex(item.payload, item.checksumType).resultHex
                    : "";

                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex flex-col gap-2 p-3 rounded-xl border transition-all shadow-2xs",
                      isStepActive
                        ? "border-primary bg-primary/10 shadow-[0_0_14px_rgba(59,130,246,0.25)] ring-1 ring-primary"
                        : item.enabled
                        ? "border-border/70 bg-card hover:border-border/90"
                        : "border-border/40 bg-muted/20 opacity-60"
                    )}
                  >
                    {/* 上半行：序号、名称、模式切换、格式/校验参数、延时、单步、操作 */}
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        onChange={(e) => updateItem(item.id, { enabled: e.target.checked })}
                        className="h-3.5 w-3.5 rounded border-border cursor-pointer accent-primary shrink-0"
                        title={tr("是否启用该步骤", "Enable this step")}
                      />

                      <span className="font-mono text-xs font-bold text-muted-foreground/90 bg-muted/60 px-1.5 py-0.5 rounded border border-border/50 shrink-0">
                        {String(index + 1).padStart(2, "0")}
                      </span>

                      {/* 步骤名称输入 */}
                      <Input
                        value={item.name}
                        onChange={(e) => updateItem(item.id, { name: e.target.value })}
                        placeholder={tr("指令备注名称", "Command label")}
                        className="h-7 text-xs flex-1 min-w-[110px] max-w-[180px] font-medium bg-background/80"
                      />

                      {/* ASCII / HEX 模式切换胶囊 */}
                      <div className="flex h-7 shrink-0 items-center rounded-lg bg-muted/70 p-0.5 ring-1 ring-border/50">
                        <button
                          type="button"
                          onClick={() => updateItem(item.id, { type: "ascii" })}
                          className={cn(
                            "h-6 rounded-md px-2 text-[10.5px] font-medium transition-all cursor-pointer",
                            item.type === "ascii"
                              ? "bg-background text-foreground font-semibold shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {tr("文本", "Text")}
                        </button>
                        <button
                          type="button"
                          onClick={() => updateItem(item.id, { type: "hex" })}
                          className={cn(
                            "h-6 rounded-md px-2 text-[10.5px] font-medium transition-all cursor-pointer",
                            item.type === "hex"
                              ? "bg-background text-foreground font-semibold shadow-xs"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          HEX
                        </button>
                      </div>

                      {/* 换行符（文本模式）或 校验算法（HEX 模式） */}
                      {item.type === "ascii" ? (
                        <SelectPopover
                          value={item.suffix}
                          onChange={(v) => updateItem(item.id, { suffix: v as typeof item.suffix })}
                          options={[
                            { value: "\r\n", label: "CRLF (\\r\\n)" },
                            { value: "\n", label: "LF (\\n)" },
                            { value: "\r", label: "CR (\\r)" },
                            { value: "", label: tr("无换行", "No line ending") },
                          ]}
                          className="h-7"
                          panelClassName="w-44"
                          ariaLabel={tr("发送追加换行符", "Append line ending")}
                        />
                      ) : (
                        <SelectPopover
                          value={item.checksumType}
                          onChange={(v) => updateItem(item.id, { checksumType: v as SerialChecksumType })}
                          options={SERIAL_CHECKSUM_OPTIONS.map((opt) => ({ value: opt.type, label: opt.label }))}
                          className="h-7 max-w-[160px]"
                          panelClassName="w-44"
                          ariaLabel={tr("自动计算并追加校验码", "Calculate and append checksum")}
                        />
                      )}

                      {/* 延时 (ms) */}
                      <div className="flex items-center gap-1 bg-muted/40 px-2 py-0.5 rounded-lg border border-border/50 text-xs font-mono shrink-0">
                        <span className="text-muted-foreground text-[10px]">{tr("延时:", "Delay:")}</span>
                        <Input
                          type="number"
                          min={0}
                          max={60000}
                          step={50}
                          value={item.delayMs}
                          onChange={(e) =>
                            updateItem(item.id, {
                              delayMs: Math.max(0, parseInt(e.target.value) || 0),
                            })
                          }
                          className="h-5.5 w-12 border-0 bg-transparent text-center px-0 text-xs shadow-none p-0 focus-visible:ring-0"
                        />
                        <span className="text-muted-foreground text-[10px]">ms</span>
                      </div>

                      {/* 单步测试按钮 */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2.5 text-xs gap-1 text-primary border-primary/30 hover:bg-primary/10 cursor-pointer shrink-0 ml-auto"
                        onClick={() => void onSendStep(item)}
                        disabled={isRunning || !isConnected || !item.payload.trim()}
                        title={tr("单步调试发送此指令", "Send this step")}
                      >
                        <Play className="h-3 w-3" />
                        <span>{tr("单步", "Test")}</span>
                      </Button>

                      {/* 排序与操作按钮组 */}
                      <div className="flex items-center gap-0.5 border-l border-border/50 pl-1.5 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6.5 w-6.5 text-muted-foreground hover:text-foreground cursor-pointer"
                          disabled={index === 0}
                          onClick={() => moveItem(index, "up")}
                          title={tr("上移", "Move up")}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6.5 w-6.5 text-muted-foreground hover:text-foreground cursor-pointer"
                          disabled={index === items.length - 1}
                          onClick={() => moveItem(index, "down")}
                          title={tr("下移", "Move down")}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6.5 w-6.5 text-muted-foreground hover:text-foreground cursor-pointer"
                          onClick={() => duplicateItem(index)}
                          title={tr("复制为新步骤", "Duplicate step")}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6.5 w-6.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                          onClick={() => removeItem(item.id)}
                          title={tr("删除步骤", "Delete step")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* 下半行：Payload 输入框与实时预览 */}
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Input
                          value={item.payload}
                          onChange={(e) => updateItem(item.id, { payload: e.target.value })}
                          placeholder={
                            item.type === "hex"
                              ? tr("输入 HEX 字节 (如 01 03 00 00 00 02)", "Enter HEX bytes (for example 01 03 00 00 00 02)")
                              : tr("输入文本指令 (如 AT+CSQ)", "Enter a text command (for example AT+CSQ)")
                          }
                          className="h-8 text-xs font-mono bg-background border-border/70 focus-visible:ring-primary/20"
                        />
                      </div>
                      {previewHex && (
                        <span className="text-[10.5px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1.5 rounded-lg whitespace-nowrap shrink-0">
                          {tr("实际发送:", "Send:")} {previewHex}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              <Button
                variant="outline"
                size="sm"
                onClick={addItem}
                className="w-full h-8.5 text-xs border-dashed gap-1.5 mt-2 font-medium hover:border-primary hover:text-primary transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                {tr("添加指令步骤", "Add command step")}
              </Button>
            </>
          )}
        </div>

        {/* 底部控制操作栏 */}
        <div className="px-5 py-3 border-t border-border/60 bg-muted/20 flex items-center justify-between select-none">
          <div className="flex items-center gap-3">
            {/* 循环参数 */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{tr("循环次数:", "Loops:")}</span>
              <Input
                type="number"
                min={0}
                max={99999}
                value={loopCountLimit}
                disabled={isRunning}
                onChange={(e) => setLoopCountLimit(Math.max(0, parseInt(e.target.value) || 0))}
                className="h-7 w-16 text-center font-mono text-xs bg-background"
                title={tr("0 表示无限循环", "0 means unlimited")}
              />
              <span className="text-[10.5px] text-muted-foreground">{tr("(0 = 无限)", "(0 = unlimited)")}</span>
            </div>

            {isRunning && (
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-primary/10 border border-primary/20 text-primary text-xs font-medium animate-pulse">
                <Activity className="h-3.5 w-3.5 animate-spin" />
                <span>
                  {tr("正在执行", "Running")} {isLooping ? `[${tr("第", "loop ")}${completedLoops + 1}${tr(" 轮", "")}]` : ""}
                  {activeStepIndex !== null ? ` (${tr("步骤", "step")} ${activeStepIndex + 1}/${items.length})` : ""}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isRunning ? (
              <Button
                variant="destructive"
                size="sm"
                className="h-8.5 gap-1.5 text-xs font-semibold cursor-pointer shadow-sm"
                onClick={stopExecution}
              >
                <Square className="h-3.5 w-3.5" />
                {tr("停止执行", "Stop")}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8.5 gap-1.5 text-xs font-medium cursor-pointer"
                  onClick={() => runSequence(false)}
                  disabled={!isConnected || items.filter((i) => i.enabled && i.payload.trim()).length === 0}
                >
                  <Play className="h-3.5 w-3.5 text-primary" />
                  {tr("单次执行全部", "Run once")}
                </Button>
                <Button
                  size="sm"
                  className="h-8.5 gap-1.5 text-xs font-semibold cursor-pointer shadow-sm"
                  onClick={() => runSequence(true)}
                  disabled={!isConnected || items.filter((i) => i.enabled && i.payload.trim()).length === 0}
                >
                  <Play className="h-3.5 w-3.5" />
                  {tr("循环流水线执行", "Run in loop")}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
