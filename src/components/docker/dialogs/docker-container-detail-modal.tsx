import React, { useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  X,
  FileText,
  BarChart3,
  Info,
  Folder,
  Container,
  RefreshCw,
  Search,
  Copy,
  Check,
  Cpu,
  MemoryStick,
  Network,
  HardDrive,
  RotateCcw,
  ChevronLeft,
  Upload,
  File as FileIcon,
  Download,
  Trash2,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import type { DockerContainer as DockerContainerType } from "@/types";
import type { StatsData } from "../docker-types";
import { renderAnsiLine, stripAnsi, StructuredInspect, formatSize } from "../docker-utils";

export interface DockerContainerDetailModalProps {
  modal: {
    type: "logs" | "stats" | "inspect" | "files";
    container: DockerContainerType;
  } | null;
  onClose: () => void;
  onSwitchTab: (tab: "logs" | "stats" | "inspect" | "files") => void;

  // Logs
  logsLoading: boolean;
  logsPollingFailed: boolean;
  logSearchQuery: string;
  setLogSearchQuery: (q: string) => void;
  logFilterError: boolean;
  setLogFilterError: React.Dispatch<React.SetStateAction<boolean>>;
  logWrapLines: boolean;
  setLogWrapLines: React.Dispatch<React.SetStateAction<boolean>>;
  logsPaused: boolean;
  onToggleLogsPaused: () => void;
  filteredLogs: string;
  logLines: string[];
  logVirtualizer: {
    getTotalSize: () => number;
    getVirtualItems: () => Array<{ key: string | number; index: number; start: number; size: number }>;
  };
  logsScrollRef: React.RefObject<HTMLDivElement | null>;
  logsStickBottomRef: React.MutableRefObject<boolean>;
  onClearLogsView: () => void;

  // Inspect
  inspectSearchQuery: string;
  setInspectSearchQuery: (q: string) => void;
  inspectFilterLines: boolean;
  setInspectFilterLines: React.Dispatch<React.SetStateAction<boolean>>;
  inspectCopied: boolean;
  onCopyInspect: () => void;
  inspectTab: "structured" | "raw";
  setInspectTab: (tab: "structured" | "raw") => void;
  inspectData: string;
  filteredInspect: string;

  // Stats
  statsCurrent: StatsData | null;
  statsHistory: Array<StatsData & { time: string }>;
  statsError: string | null;
  onRetryStats: () => void;

  // Files
  filesPath: string;
  filesLoading: boolean;
  filesError: string | null;
  filesList: Array<{ name: string; isDir: boolean; size: number; modified: string }>;
  actionLoading: string | null;
  onNavigateFiles: (path: string) => void;
  onRefreshFiles: () => void;
  onFileUpload: () => void;
  onOpenHostPicker: () => void;
  onFileDownload: (file: { name: string; isDir: boolean; size: number; modified: string }) => void;
  onPromptFileDelete: (file: { name: string; isDir: boolean; size: number; modified: string }) => void;
}

export function DockerContainerDetailModal({
  modal,
  onClose,
  onSwitchTab,
  logsLoading,
  logsPollingFailed,
  logSearchQuery,
  setLogSearchQuery,
  logFilterError,
  setLogFilterError,
  logWrapLines,
  setLogWrapLines,
  logsPaused,
  onToggleLogsPaused,
  filteredLogs,
  logLines,
  logVirtualizer,
  logsScrollRef,
  logsStickBottomRef,
  onClearLogsView,
  inspectSearchQuery,
  setInspectSearchQuery,
  inspectFilterLines,
  setInspectFilterLines,
  inspectCopied,
  onCopyInspect,
  inspectTab,
  setInspectTab,
  inspectData,
  filteredInspect,
  statsCurrent,
  statsHistory,
  statsError,
  onRetryStats,
  filesPath,
  filesLoading,
  filesError,
  filesList,
  actionLoading,
  onNavigateFiles,
  onRefreshFiles,
  onFileUpload,
  onOpenHostPicker,
  onFileDownload,
  onPromptFileDelete,
}: DockerContainerDetailModalProps) {
  const { t } = useTranslation();

  if (!modal) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="w-[96vw] max-w-7xl h-[92vh] flex flex-col p-0 gap-0 overflow-hidden"
      >
        {/* 全局关闭按钮 */}
        <div className="absolute top-0 right-0 z-20 p-3">
          <button
            className="p-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
            onClick={onClose}
            title={t("common_close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab 切换：日志 / 监控 / 详情 / 文件；右侧显示当前容器名 */}
        <div className="flex items-center gap-1 px-4 pt-3 pr-12">
          {([
            { key: "logs" as const, label: t("dk_logs"), icon: <FileText className="h-3.5 w-3.5" /> },
            { key: "stats" as const, label: t("dk_status"), icon: <BarChart3 className="h-3.5 w-3.5" /> },
            { key: "inspect" as const, label: t("dk_detail"), icon: <Info className="h-3.5 w-3.5" /> },
            { key: "files" as const, label: t("dk_files"), icon: <Folder className="h-3.5 w-3.5" /> },
          ]).map((tab) => (
            <button
              key={tab.key}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors",
                modal.type === tab.key
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50",
              )}
              onClick={() => onSwitchTab(tab.key)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
          <span
            className="ml-auto flex items-center gap-1.5 min-w-0 flex-shrink-0"
            title={modal.container.name}
          >
            <Container className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-[11px] text-muted-foreground truncate">
              {modal.container.name}
            </span>
          </span>
        </div>

        {/* 1. Logs Tab */}
        {modal.type === "logs" && (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 gap-4 flex-wrap">
              <div className="flex items-center gap-2 flex-shrink-0">
                <FileText className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">
                  {t("dk_container_logs")} - {modal.container.name}
                </span>
                {logsLoading && (
                  <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
                {!logsLoading && (
                  <span
                    className={cn(
                      "flex items-center gap-1 text-[10px]",
                      logsPollingFailed ? "text-destructive" : "text-success",
                    )}
                  >
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full animate-pulse",
                        logsPollingFailed ? "bg-destructive" : "bg-success",
                      )}
                    />
                    {t("dk_realtime")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
                <div className="relative max-w-xs flex-shrink-0">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={logSearchQuery}
                    onChange={(e) => setLogSearchQuery(e.target.value)}
                    placeholder={t("dk_search_logs")}
                    className="h-7 pl-8 pr-6 text-xs bg-muted/50 w-36 focus:w-48 transition-all duration-200"
                  />
                  {logSearchQuery && (
                    <button
                      onClick={() => setLogSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <Button
                  variant={logFilterError ? "destructive" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-2.5 flex-shrink-0"
                  onClick={() => setLogFilterError((prev) => !prev)}
                >
                  {t("dk_show_errors")}
                </Button>
                <Button
                  variant={logWrapLines ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-2.5 flex-shrink-0"
                  onClick={() => setLogWrapLines((prev) => !prev)}
                >
                  {t("dk_wrap")}
                </Button>
                <Button
                  variant={logsPaused ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-2.5 flex-shrink-0"
                  onClick={onToggleLogsPaused}
                >
                  {logsPaused ? t("dk_logs_resume") : t("dk_logs_pause")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5 flex-shrink-0"
                  onClick={() => {
                    const blob = new Blob([stripAnsi(filteredLogs)], {
                      type: "text/plain;charset=utf-8",
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `docker_logs_${modal.container.name}.log`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }}
                >
                  {t("dk_download_log")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5 flex-shrink-0"
                  onClick={onClearLogsView}
                >
                  {t("dk_clear_view")}
                </Button>
              </div>
            </div>
            <div
              ref={logsScrollRef as any}
              onScroll={(e) => {
                const el = e.currentTarget;
                logsStickBottomRef.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              }}
              className={cn(
                "flex-1 overflow-auto bg-zinc-950 p-4 font-mono text-[12px] text-zinc-200 leading-relaxed",
                !logWrapLines && "overflow-x-auto",
              )}
            >
              {!filteredLogs ? (
                <span className="text-zinc-500">{t("dk_no_logs")}</span>
              ) : logWrapLines ? (
                logLines.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all">
                    {renderAnsiLine(line) || "\u00A0"}
                  </div>
                ))
              ) : (
                <div style={{ height: logVirtualizer.getTotalSize(), position: "relative" }}>
                  {logVirtualizer.getVirtualItems().map((vi) => (
                    <div
                      key={vi.key}
                      style={{
                        position: "absolute",
                        top: vi.start,
                        height: vi.size,
                        left: 0,
                        right: 0,
                      }}
                      className="whitespace-pre"
                    >
                      {renderAnsiLine(logLines[vi.index]) || "\u00A0"}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* 2. Inspect Tab */}
        {modal.type === "inspect" && (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 gap-4 flex-wrap">
              <div className="flex items-center gap-2 flex-shrink-0">
                <Info className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">
                  {t("dk_container_detail")} - {modal.container.name}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
                <div className="relative max-w-xs flex-shrink-0">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={inspectSearchQuery}
                    onChange={(e) => setInspectSearchQuery(e.target.value)}
                    placeholder={t("dk_search_config")}
                    className="h-7 pl-8 pr-6 text-xs bg-muted/50 w-36 focus:w-48 transition-all duration-200"
                  />
                  {inspectSearchQuery && (
                    <button
                      onClick={() => setInspectSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <Button
                  variant={inspectFilterLines ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-2.5 flex-shrink-0"
                  onClick={() => setInspectFilterLines((prev) => !prev)}
                  disabled={!inspectSearchQuery}
                >
                  {t("dk_show_match")}
                </Button>
                <button
                  className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground text-xs flex items-center gap-1 flex-shrink-0"
                  onClick={onCopyInspect}
                  title={t("dk_copy")}
                >
                  {inspectCopied ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  className="p-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
                  onClick={onClose}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-1 px-4 pt-2.5 pb-2 border-b border-border/40 flex-shrink-0">
              <Button
                variant={inspectTab === "structured" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => setInspectTab("structured")}
              >
                {t("dk_ins_structured")}
              </Button>
              <Button
                variant={inspectTab === "raw" ? "default" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => setInspectTab("raw")}
              >
                {t("dk_ins_raw")}
              </Button>
            </div>
            {inspectTab === "structured" ? (
              <div className="flex-1 overflow-auto p-4">
                {(() => {
                  try {
                    const parsed = JSON.parse(inspectData);
                    const item = Array.isArray(parsed) ? parsed[0] : parsed;
                    if (item && typeof item === "object") {
                      return <StructuredInspect data={item as Record<string, unknown>} t={t} />;
                    }
                  } catch {
                    // 数据尚未加载或非 JSON
                  }
                  return (
                    <div className="text-center text-muted-foreground text-sm py-8">
                      {t("dk_ins_parse_fail")}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="flex-1 overflow-auto p-4 bg-zinc-950 text-[12px] font-mono text-zinc-300 leading-relaxed">
                <pre className="whitespace-pre-wrap break-all text-zinc-300">
                  {filteredInspect}
                </pre>
              </div>
            )}
          </>
        )}

        {/* 3. Stats Tab */}
        {modal.type === "stats" && (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">
                  {t("dk_resource")} - {modal.container.name}
                </span>
                <span className="flex items-center gap-1 text-[10px] text-success">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                  {t("dk_realtime")}
                </span>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {statsCurrent ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-border/60 bg-card/50 p-3">
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
                        <Cpu className="h-3 w-3 text-primary" /> CPU
                      </div>
                      <div className="text-xl font-semibold text-foreground tabular-nums">
                        {statsCurrent.cpuPerc.toFixed(2)}%
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-card/50 p-3">
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                        <MemoryStick className="h-3 w-3" /> {t("dk_mem")}
                      </div>
                      <div className="text-xl font-semibold text-foreground tabular-nums">
                        {statsCurrent.memPerc.toFixed(2)}%
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {statsCurrent.memUsed.toFixed(1)} / {statsCurrent.memTotal.toFixed(0)} MiB
                      </div>
                      <div className="mt-1.5 flex h-1 rounded-full overflow-hidden bg-muted">
                        <div
                          className="bg-emerald-500"
                          style={{ width: `${Math.min(100, statsCurrent.memPerc)}%` }}
                        />
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-card/50 p-3">
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                        <Network className="h-3 w-3" /> {t("dk_net_io")}
                      </div>
                      <div className="text-xs font-medium tabular-nums">
                        <div>↓ {statsCurrent.netRx.toFixed(1)} KB</div>
                        <div>↑ {statsCurrent.netTx.toFixed(1)} KB</div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-card/50 p-3">
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-1">
                        <HardDrive className="h-3 w-3" /> {t("dk_disk_io")}
                      </div>
                      <div className="text-xs font-medium tabular-nums">
                        <div>{t("dk_read")} {statsCurrent.blockRead.toFixed(1)} KB</div>
                        <div>{t("dk_write")} {statsCurrent.blockWrite.toFixed(1)} KB</div>
                      </div>
                    </div>
                  </div>

                  {/* CPU AreaChart */}
                  <div className="rounded-xl border border-border/60 bg-card/50 p-3">
                    <div className="text-xs font-medium mb-2">{t("dk_cpu_usage")} (%)</div>
                    <ResponsiveContainer width="100%" height={120}>
                      <AreaChart data={statsHistory}>
                        <defs>
                          <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                        <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" />
                        <YAxis tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" domain={[0, "auto"]} />
                        <RechartsTooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                        <Area type="monotone" dataKey="cpuPerc" stroke="var(--color-primary)" fill="url(#cpuGrad)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Mem AreaChart */}
                  <div className="rounded-xl border border-border/60 bg-card/50 p-3">
                    <div className="text-xs font-medium mb-2">{t("dk_mem_usage")} (%)</div>
                    <ResponsiveContainer width="100%" height={120}>
                      <AreaChart data={statsHistory}>
                        <defs>
                          <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                        <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" />
                        <YAxis tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" domain={[0, "auto"]} />
                        <RechartsTooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                        <Area type="monotone" dataKey="memPerc" stroke="var(--color-success)" fill="url(#memGrad)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Net I/O AreaChart */}
                  <div className="rounded-xl border border-border/60 bg-card/50 p-3">
                    <div className="text-xs font-medium mb-2">{t("dk_net_io")} (KB)</div>
                    <ResponsiveContainer width="100%" height={120}>
                      <AreaChart data={statsHistory}>
                        <defs>
                          <linearGradient id="netRxGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="netTxGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#c084fc" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#c084fc" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                        <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" />
                        <YAxis tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" domain={[0, "auto"]} />
                        <RechartsTooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                        <Area type="monotone" dataKey="netRx" name="RX" stroke="#60a5fa" fill="url(#netRxGrad)" strokeWidth={2} />
                        <Area type="monotone" dataKey="netTx" name="TX" stroke="#c084fc" fill="url(#netTxGrad)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Block I/O AreaChart */}
                  <div className="rounded-xl border border-border/60 bg-card/50 p-3">
                    <div className="text-xs font-medium mb-2">{t("dk_disk_io")} (KB)</div>
                    <ResponsiveContainer width="100%" height={120}>
                      <AreaChart data={statsHistory}>
                        <defs>
                          <linearGradient id="blkRGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="blkWGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#facc15" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#facc15" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                        <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" />
                        <YAxis tick={{ fontSize: 10 }} stroke="var(--color-muted-foreground)" domain={[0, "auto"]} />
                        <RechartsTooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                        <Area type="monotone" dataKey="blockRead" name={t("dk_read")} stroke="#2dd4bf" fill="url(#blkRGrad)" strokeWidth={2} />
                        <Area type="monotone" dataKey="blockWrite" name={t("dk_write")} stroke="#facc15" fill="url(#blkWGrad)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* PID Badge */}
                  <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-border/50 bg-muted/40 text-[11px] text-muted-foreground">
                    <Cpu className="h-3 w-3" />
                    {t("dk_process_count")}:
                    <span className="font-medium text-foreground tabular-nums">
                      {statsCurrent.pids}
                    </span>
                  </div>
                </>
              ) : statsError ? (
                <div className="flex flex-col items-center justify-center h-full text-destructive text-sm gap-2 px-4">
                  <BarChart3 className="h-8 w-8 opacity-30" />
                  <span>{t("dk_err_status")}</span>
                  <span className="text-xs text-muted-foreground font-mono max-w-md text-center break-all">
                    {statsError}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs mt-2"
                    onClick={onRetryStats}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    {t("common_retry")}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  {t("dk_loading")}
                </div>
              )}
            </div>
          </>
        )}

        {/* 4. Files Tab */}
        {modal.type === "files" && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60">
              <button
                className="p-1 rounded hover:bg-accent text-muted-foreground disabled:opacity-30"
                disabled={filesPath === "/"}
                onClick={() => {
                  const parent = filesPath.replace(/\/[^/]*$/, "") || "/";
                  onNavigateFiles(parent);
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="font-mono text-xs text-muted-foreground truncate flex-1" title={filesPath}>
                {filesPath}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                disabled={actionLoading === "file-ul"}
                onClick={onFileUpload}
                title={t("dk_files_upload_local_hint")}
              >
                <Upload className="h-3 w-3" /> {t("dk_files_upload")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                disabled={actionLoading === "host-copy"}
                onClick={onOpenHostPicker}
                title={t("dk_files_host_copy_hint")}
              >
                <HardDrive className="h-3 w-3" /> {t("dk_files_host_copy")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={onRefreshFiles}
                disabled={filesLoading}
              >
                <RefreshCw className={cn("h-3 w-3", filesLoading && "animate-spin")} />
              </Button>
            </div>
            <div className="flex-1 overflow-auto">
              {filesLoading ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin" /> {t("dk_loading")}
                </div>
              ) : filesError ? (
                <div className="flex items-center justify-center h-full text-destructive text-sm px-4 text-center">
                  {filesError}
                </div>
              ) : filesList.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  {t("dk_files_empty")}
                </div>
              ) : (
                <div className="m-2 rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
                  <table className="w-full text-xs">
                    <tbody>
                      {filesList.map((e) => (
                        <tr key={e.name} className="border-b border-border/30 hover:bg-muted/30">
                          <td className="px-4 py-2 w-8 text-muted-foreground">
                            {e.isDir ? (
                              <Folder className="h-3.5 w-3.5" />
                            ) : (
                              <FileIcon className="h-3.5 w-3.5" />
                            )}
                          </td>
                          <td className="px-2 py-2 font-mono truncate max-w-[280px]">
                            {e.isDir ? (
                              <button
                                className="hover:underline text-left"
                                onClick={() => {
                                  onNavigateFiles(`${filesPath === "/" ? "" : filesPath}/${e.name}`);
                                }}
                              >
                                {e.name}/
                              </button>
                            ) : (
                              <span>{e.name}</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground w-24 text-right">
                            {e.isDir ? "" : formatSize(e.size)}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground w-44 truncate">
                            {e.modified}
                          </td>
                          <td className="px-2 py-2 text-right w-24 whitespace-nowrap">
                            {!e.isDir && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                disabled={actionLoading === `file-dl-${e.name}`}
                                onClick={() => onFileDownload(e)}
                                title={t("dk_files_download")}
                              >
                                <Download className="h-3 w-3" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive hover:text-destructive"
                              disabled={actionLoading === `file-del-${e.name}`}
                              onClick={() => onPromptFileDelete(e)}
                              title={t("dk_files_delete")}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
