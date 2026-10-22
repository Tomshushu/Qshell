import React, { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Send,
  History,
  Trash2,
  X,
  ArrowLeftRight,
  ChevronDown,
  Sparkles,
  Repeat2,
  Activity,
  CornerDownLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SelectPopover } from "@/components/ui/select-popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SERIAL_CHECKSUM_OPTIONS,
  type SerialChecksumType,
} from "@/lib/serial-checksum";
import { useTranslation } from "@/i18n";

export interface SerialQuickSendEditorProps {
  open: boolean;
  onClose: () => void;
  serialSendEditorHeight: number;
  setSerialSendEditorHeight: (height: number) => void;
  serialSendType: "ascii" | "hex";
  onSwitchSendType: (type: "ascii" | "hex") => void;
  serialSendText: string;
  setSerialSendText: (text: string) => void;
  hexAnalysis: {
    clean: string;
    hasInvalid: boolean;
    isOdd: boolean;
    bytes: number;
    checksumResult: string;
  } | null;
  serialSendHistory: string[];
  onClearHistory: () => void;
  onSelectHistoryItem: (item: string) => void;
  serialSendSuffix: "\r\n" | "\n" | "\r" | "";
  setSerialSendSuffix: (suffix: "\r\n" | "\n" | "\r" | "") => void;
  serialChecksumType: SerialChecksumType;
  setSerialChecksumType: (type: SerialChecksumType) => void;
  onSendSerialInput: () => void;
  serialEnterToSend: boolean;
  setSerialEnterToSend: React.Dispatch<React.SetStateAction<boolean>>;
  serialAutoSend: boolean;
  setSerialAutoSend: (autoSend: boolean) => void;
  toggleSerialAutoSend: () => void;
  serialAutoSendInterval: number;
  setSerialAutoSendInterval: (interval: number) => void;
  serialAutoSendCount: number;
  serialLineDelay: number;
  swapEndianness: (chunkSize: 2 | 4 | 0) => void;
  toggleHexSpacing: () => void;
}

export function SerialQuickSendEditor({
  open,
  onClose,
  serialSendEditorHeight,
  setSerialSendEditorHeight,
  serialSendType,
  onSwitchSendType,
  serialSendText,
  setSerialSendText,
  hexAnalysis,
  serialSendHistory,
  onClearHistory,
  onSelectHistoryItem,
  serialSendSuffix,
  setSerialSendSuffix,
  serialChecksumType,
  setSerialChecksumType,
  onSendSerialInput,
  serialEnterToSend,
  setSerialEnterToSend,
  serialAutoSend,
  setSerialAutoSend,
  toggleSerialAutoSend,
  serialAutoSendInterval,
  setSerialAutoSendInterval,
  serialAutoSendCount,
  serialLineDelay,
  swapEndianness,
  toggleHexSpacing,
}: SerialQuickSendEditorProps) {
  const { t } = useTranslation();
  const serialSendResizeRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);

  if (!open) return null;

  return (
    <div className="shrink-0 border-t border-border/70 bg-card/95 px-4 pb-3 pt-1.5 shadow-[0_-8px_30px_-12px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-all">
      {/* 1. 顶部极简拖拽条 */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("serial_send_resize")}
        title={t("serial_send_resize")}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          serialSendResizeRef.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            startHeight: serialSendEditorHeight,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const resize = serialSendResizeRef.current;
          if (!resize || resize.pointerId !== event.pointerId) return;
          const maximum = Math.max(140, Math.floor(window.innerHeight * 0.45));
          setSerialSendEditorHeight(
            Math.min(maximum, Math.max(76, resize.startHeight + resize.startY - event.clientY)),
          );
        }}
        onPointerUp={(event) => {
          if (serialSendResizeRef.current?.pointerId !== event.pointerId) return;
          serialSendResizeRef.current = null;
          try {
            event.currentTarget.releasePointerCapture(event.pointerId);
          } catch {
            // 指针捕获可能已被浏览器隐式释放（窗口失焦/手势中断），忽略 NotFoundError
          }
        }}
        onPointerCancel={() => {
          serialSendResizeRef.current = null;
        }}
        className="group -mx-4 -mt-1.5 mb-2 flex h-2.5 cursor-row-resize touch-none items-center justify-center select-none"
      >
        <span className="h-1 w-12 rounded-full bg-border/80 transition-all duration-200 group-hover:w-20 group-hover:bg-primary/80 group-active:bg-primary" />
      </div>

      {/* 2. 顶栏：标题 + 模式胶囊切换 + 计数指标 ｜ 历史记录 + 收起按钮 */}
      <div className="mb-2.5 flex min-w-0 items-center justify-between gap-3 select-none">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-xs font-semibold text-foreground tracking-tight flex items-center gap-1.5 shrink-0">
            <Send className="h-3.5 w-3.5 text-primary" />
            {t("serial_send_editor")}
          </span>

          {/* ASCII / HEX 模式切换胶囊 */}
          <div className="flex h-6 shrink-0 items-center rounded-lg bg-muted/70 p-0.5 ring-1 ring-border/50">
            <button
              type="button"
              onClick={() => onSwitchSendType("ascii")}
              className={cn(
                "h-5 rounded-md px-2 text-[10.5px] font-medium transition-all cursor-pointer",
                serialSendType === "ascii"
                  ? "bg-background text-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="切换为 ASCII 文本模式（若当前为 HEX 则自动解码为文本）"
            >
              {t("serial_send_ascii")}
            </button>
            <button
              type="button"
              onClick={() => onSwitchSendType("hex")}
              className={cn(
                "h-5 rounded-md px-2 text-[10.5px] font-medium transition-all cursor-pointer",
                serialSendType === "hex"
                  ? "bg-background text-foreground font-semibold shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title="切换为 HEX 十六进制模式（若当前为文本则自动编码为 HEX 字节流）"
            >
              HEX
            </button>
          </div>

          {/* 实时计数指标 */}
          <span className="text-[10px] font-mono text-muted-foreground/85 bg-muted/40 border border-border/40 rounded px-1.5 py-0.5 whitespace-nowrap shrink-0">
            {serialSendType === "hex" && hexAnalysis ? (
              `${hexAnalysis.bytes} 字节`
            ) : (
              t("serial_send_summary", {
                lines: serialSendText ? serialSendText.split(/\r\n|\r|\n/).length : 0,
                characters: serialSendText.length,
              })
            )}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* 历史记录下拉菜单 */}
          {serialSendHistory.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-6 shrink-0 items-center gap-1 rounded-lg border border-border/60 bg-muted/30 px-2 text-[10.5px] text-muted-foreground shadow-2xs transition-colors hover:bg-muted/70 hover:text-foreground cursor-pointer"
                  title={t("serial_send_history")}
                >
                  <History className="h-3 w-3" />
                  <span className="hidden sm:inline">{t("serial_send_history")}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="max-h-72 w-80 overflow-y-auto p-1.5">
                <div className="flex items-center justify-between px-2 pb-1.5 pt-0.5 border-b border-border/40 mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t("serial_send_history")}
                  </span>
                  <button
                    type="button"
                    onClick={onClearHistory}
                    className="text-[10px] text-destructive hover:underline flex items-center gap-0.5 cursor-pointer"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                    清空历史
                  </button>
                </div>
                {serialSendHistory.map((item) => (
                  <DropdownMenuItem
                    key={item}
                    onSelect={() => onSelectHistoryItem(item)}
                    className="items-start font-mono text-xs cursor-pointer py-1.5"
                  >
                    <span className="line-clamp-2 whitespace-pre-wrap break-all">{item}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* 收起抽屉按钮 */}
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors cursor-pointer"
            title="收起发送面板"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 3. 中间核心：纯净编辑器 + 右侧参数与发送按钮 */}
      <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-[minmax(0,1fr)_135px]">
        {/* 纯净多行编辑器 */}
        <div className="relative min-w-0 overflow-hidden rounded-xl border border-border/80 bg-background shadow-inner transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
          <textarea
            value={serialSendText}
            onChange={(event) => {
              const value = event.target.value;
              setSerialSendText(value);
              if (!value.trim()) setSerialAutoSend(false);
            }}
            onKeyDown={(event) => {
              if (serialEnterToSend) {
                if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                  event.preventDefault();
                  void onSendSerialInput();
                }
              } else {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void onSendSerialInput();
                }
              }
            }}
            rows={3}
            spellCheck={false}
            placeholder={
              serialSendType === "hex"
                ? t("serial_send_hex_placeholder")
                : t("serial_send_text_placeholder")
            }
            style={{ height: serialSendEditorHeight }}
            className="block w-full resize-none bg-transparent p-2.5 font-mono text-xs leading-5 text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        {/* 右侧控制列 */}
        <div className="flex flex-row sm:flex-col gap-2 justify-between">
          {serialSendType === "ascii" ? (
            <div className="flex flex-col gap-1 w-full">
              <span className="text-[9.5px] font-medium text-muted-foreground select-none">换行结束符</span>
              <SelectPopover
                value={serialSendSuffix}
                onChange={(v) => setSerialSendSuffix(v as typeof serialSendSuffix)}
                options={[
                  { value: "\r\n", label: "CRLF (\\r\\n)" },
                  { value: "\n", label: "LF (\\n)" },
                  { value: "\r", label: "CR (\\r)" },
                  { value: "", label: t("serial_send_no_suffix") },
                ]}
                className="w-full h-8 font-mono text-[11px]"
                ariaLabel={t("serial_send_suffix")}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1 w-full">
              <span className="text-[9.5px] font-medium text-muted-foreground select-none">校验算法</span>
              <SelectPopover
                value={serialChecksumType}
                onChange={(v) => setSerialChecksumType(v as SerialChecksumType)}
                options={SERIAL_CHECKSUM_OPTIONS.map((opt) => ({ value: opt.type, label: opt.label }))}
                className="w-full h-8 font-mono text-[10.5px]"
                ariaLabel="自动计算并追加校验码"
              />
            </div>
          )}

          <Button
            type="button"
            size="sm"
            onClick={onSendSerialInput}
            disabled={!serialSendText || (serialSendType === "hex" && Boolean(hexAnalysis?.hasInvalid))}
            className={cn(
              "h-9 w-full gap-1.5 rounded-lg px-3 text-xs font-semibold shadow-sm sm:mt-auto transition-all cursor-pointer",
              serialAutoSend && "ring-2 ring-emerald-500/50 shadow-[0_0_14px_rgba(16,185,129,0.35)]",
            )}
          >
            <Send className="h-3.5 w-3.5" />
            <span>{t("serial_send_action")}</span>
            <span className="text-[10px] opacity-75 font-mono">
              {serialEnterToSend ? "↵" : "Ctrl+↵"}
            </span>
          </Button>
        </div>
      </div>

      {/* 4. 底栏：左侧辅助工具 & 格式校验 ｜ 右侧循环与快捷键 */}
      <div className="mt-2.5 flex min-h-6 min-w-0 flex-wrap items-center justify-between gap-2.5 text-[11px] text-muted-foreground select-none">
        {/* 左侧：辅助操作与状态 */}
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {serialSendType === "hex" && serialSendText && (
            <>
              {/* 大小端字节序转换 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-6 items-center gap-1 rounded-lg border border-border/60 bg-muted/30 px-2 text-[10.5px] font-mono text-foreground/90 hover:bg-muted/70 transition-colors cursor-pointer"
                    title="大端/小端字节序翻转转换"
                  >
                    <ArrowLeftRight className="h-2.5 w-2.5 text-primary" />
                    <span>大小端</span>
                    <ChevronDown className="h-2 w-2 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="min-w-44 p-1">
                  <DropdownMenuItem
                    onClick={() => swapEndianness(2)}
                    className="text-xs cursor-pointer font-mono py-1.5"
                  >
                    <span>16位 / 双字节翻转</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => swapEndianness(4)}
                    className="text-xs cursor-pointer font-mono py-1.5"
                  >
                    <span>32位 / 四字节翻转</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => swapEndianness(0)}
                    className="text-xs cursor-pointer font-mono py-1.5"
                  >
                    <span>全字节序列倒序</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* 成对空格/去除空格 */}
              <button
                type="button"
                onClick={toggleHexSpacing}
                className="flex h-6 items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 text-[10.5px] font-mono text-foreground/90 hover:bg-muted/70 transition-colors cursor-pointer"
                title={/\s/.test(serialSendText) ? "一键去除所有空格 (如 0102AABB)" : "一键成对添加空格 (如 01 02 AA BB)"}
              >
                <Sparkles className="h-2.5 w-2.5 text-amber-500" />
                {/\s/.test(serialSendText) ? "去除空格" : "成对空格"}
              </button>
            </>
          )}

          {/* 清空按钮 */}
          {serialSendText && (
            <button
              type="button"
              onClick={() => {
                setSerialSendText("");
                setSerialAutoSend(false);
              }}
              className="flex h-6 items-center gap-1 rounded-md border border-border/40 bg-muted/20 px-1.5 text-[10.5px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors cursor-pointer"
              title={t("serial_send_clear")}
            >
              <Trash2 className="h-2.5 w-2.5" />
              <span>{t("serial_send_clear")}</span>
            </button>
          )}

          {/* HEX 格式与校验状态 */}
          {serialSendType === "hex" && hexAnalysis && serialSendText && (
            <div className="flex items-center gap-1.5 font-mono text-[10px] pl-1">
              {hexAnalysis.isOdd && (
                <span className="text-amber-500 font-medium flex items-center gap-0.5">
                  ⚠️ 奇数半字节
                </span>
              )}
              {hexAnalysis.hasInvalid && (
                <span className="text-destructive font-medium flex items-center gap-0.5">
                  ⚠️ 包含非法字符
                </span>
              )}
              {hexAnalysis.checksumResult && (
                <span className="text-emerald-500 font-medium">
                  + 校验: {hexAnalysis.checksumResult}
                </span>
              )}
              {!hexAnalysis.isOdd && !hexAnalysis.hasInvalid && !hexAnalysis.checksumResult && hexAnalysis.bytes > 0 && (
                <span className="text-emerald-500/90 font-medium">✓ 格式正常</span>
              )}
            </div>
          )}
        </div>

        {/* 右侧：循环发送与回车快捷键模式 */}
        <div className="flex items-center gap-2 min-w-0 shrink-0">
          {/* 循环定时发送开关 */}
          <button
            type="button"
            onClick={toggleSerialAutoSend}
            className={cn(
              "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2.5 transition-all cursor-pointer font-medium text-[10.5px]",
              serialAutoSend
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 shadow-2xs"
                : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40",
            )}
          >
            <Repeat2 className={cn("h-3 w-3", serialAutoSend && "animate-spin text-emerald-500")} />
            <span>{t("serial_auto_send")}</span>
          </button>

          {serialAutoSend && (
            <div className="flex h-6 items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2 animate-in fade-in duration-200 text-[10.5px]">
              <span className="text-muted-foreground">{t("serial_auto_interval")}</span>
              <Input
                type="number"
                min={50}
                max={60000}
                step={100}
                value={serialAutoSendInterval}
                onChange={(e) => setSerialAutoSendInterval(parseInt(e.target.value) || 1000)}
                className="h-4.5 w-14 border-0 bg-background/80 rounded px-1 py-0 text-center font-mono text-[10.5px] shadow-none focus-visible:ring-1 focus-visible:ring-emerald-500"
              />
              <span className="text-muted-foreground">ms</span>
              <span className="ml-1.5 inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <Activity className="h-2.5 w-2.5 animate-pulse" />
                已发: {serialAutoSendCount} 包
              </span>
            </div>
          )}

          {serialLineDelay > 0 && (
            <span className="text-[10px] text-muted-foreground/75">
              {t("serial_line_delay", { value: serialLineDelay })}
            </span>
          )}

          {/* 回车快捷键模式切换 */}
          <button
            type="button"
            onClick={() => setSerialEnterToSend((v) => !v)}
            className={cn(
              "flex items-center gap-1 h-6 px-2 rounded-md text-[10.5px] font-mono border transition-colors cursor-pointer",
              serialEnterToSend
                ? "bg-primary/10 border-primary/30 text-primary font-medium"
                : "bg-muted/30 border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/60",
            )}
            title="点击切换：Enter 直接发送 或 Ctrl+Enter 发送"
          >
            <CornerDownLeft className="h-2.5 w-2.5" />
            {serialEnterToSend ? "Enter 发送" : "Ctrl+Enter 发送"}
          </button>
        </div>
      </div>
    </div>
  );
}
