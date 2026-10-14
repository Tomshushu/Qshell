import { useState } from "react";
import { useAppStore } from "@/store";
import type { WorkspaceModule } from "@/types";
import { useTranslation } from "@/i18n";
import { isModuleAvailable } from "@/services/connection-targets";
import {
  LayoutDashboard,
  Terminal,
  Wrench,
  Cpu,
  Globe,
  Network,
  FolderOpen,
  Container,
  Monitor,
  Wifi,
  WifiOff,
  AlertCircle,
  Camera,
  Loader2,
  Radio,
  Palette,
  Maximize2,
  Minimize2,
  Search,
  ServerCog,
  Zap,
  Binary,
  Send,
  ChevronDown,
  Check,
  Pause,
  Play,
  FileUp,
  ListOrdered,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TransferPanel } from "@/components/workspace/transfer-panel";
import { TerminalThemeDialog } from "@/components/workspace/modules/terminal-theme-dialog";
import { playSound, SoundType } from "@/lib/sound";

const modules: {
  key: WorkspaceModule;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "terminal", icon: Terminal },
  { key: "overview", icon: LayoutDashboard },
  { key: "files", icon: FolderOpen },
  { key: "rdp", icon: Monitor },
  { key: "docker", icon: Container },
  { key: "services", icon: Wrench },
  { key: "processes", icon: Cpu },
  { key: "network", icon: Globe },
  { key: "ports", icon: Network },
  { key: "bmc", icon: ServerCog },
];

export interface SerialToolbarState {
  portName: string;
  baudRate: number;
  signals: { cts: boolean; dsr: boolean; ri: boolean; cd: boolean };
  dtr: boolean;
  rts: boolean;
  toggleDtr: () => void;
  toggleRts: () => void;
  breakDuration: number;
  setBreakDuration: (ms: number) => void;
  sendBreak: (ms?: number) => void;
  timestampMode: boolean;
  toggleTimestampMode: () => void;
  hexViewMode: boolean;
  toggleHexViewMode: () => void;
  quickSendOpen: boolean;
  toggleQuickSendOpen: () => void;
  connected: boolean;
  reconnect: () => void;
  disconnect: () => void;
  localEcho: boolean;
  toggleLocalEcho: () => void;
  displayPaused: boolean;
  toggleDisplayPause: () => void;
  stats: { rxBytes: number; txBytes: number; rxRate: number; txRate: number };
  sendFile: () => void;
  openSequenceDialog?: () => void;
  openIapDialog?: () => void;
}

function formatSerialMetric(value: number, suffix = ""): string {
  if (!Number.isFinite(value) || value <= 0) return `0${suffix}`;
  if (value < 1024) return `${value.toFixed(0)}${suffix}`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}K${suffix}`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}M${suffix}`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)}G${suffix}`;
}

interface ModuleTabsProps {
  activeModule: WorkspaceModule;
  onModuleChange: (m: WorkspaceModule) => void;
  serverId: string;
  tabId: string;
  isConnected: boolean;
  connecting: boolean;
  connectError: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onShowSnapshot: () => void;
  isTerminalFullscreen: boolean;
  onToggleTerminalFullscreen: () => void;
  /** 触发终端搜索面板（开/关切换），由 ModuleTabs 触发，TerminalModule 消费 */
  onShowSearch?: () => void;
  /** 触发网络连接诊断弹窗 */
  onShowDiagnostics?: () => void;
  toolbarPosition?: "top" | "left" | "bottom" | "right";
  /** 串口专属工具条状态与操作（直接内嵌在顶栏） */
  serialToolbar?: SerialToolbarState | null;
  /** 文件面板（终端下方）是否展开：用于高亮文件按钮、展示传输进度 */
  filesPanelOpen?: boolean;
}

export function ModuleTabs({
  activeModule,
  onModuleChange,
  serverId,
  tabId,
  isConnected,
  connecting,
  connectError,
  onConnect,
  onDisconnect,
  onShowSnapshot,
  isTerminalFullscreen,
  onToggleTerminalFullscreen,
  onShowSearch,
  onShowDiagnostics,
  toolbarPosition = "top",
  serialToolbar,
  filesPanelOpen,
}: ModuleTabsProps) {
  const { t } = useTranslation();
  const [showThemeDialog, setShowThemeDialog] = useState(false);
  const [customBreakInput, setCustomBreakInput] = useState("");
  const [breakDropdownOpen, setBreakDropdownOpen] = useState(false);
  // 按连接目标类型过滤可见的工作区模块（linux 保持全部，其余类型按注册表声明）
  const server = useAppStore((s) => s.servers.find((sv) => sv.id === serverId));
  const broadcastTabIds = useAppStore((s) => s.broadcastTabIds);
  const tabs = useAppStore((s) => s.tabs);
  const toggleBroadcastTab = useAppStore((s) => s.toggleBroadcastTab);
  const isBroadcasting = broadcastTabIds.includes(tabId);
  // 按 serverId 去重：同一服务器开了多个广播 tab 时，避免 hover 提示里同名重复列出、
  // 计数虚高（与危险命令确认框的去重逻辑一致）。
  const seenServers = new Map<string, string>(); // serverId -> serverName
  for (const id of broadcastTabIds) {
    if (id === tabId) continue;
    const tab = tabs.find((t) => t.id === id);
    if (!tab) continue;
    if (!seenServers.has(tab.serverId)) {
      seenServers.set(tab.serverId, tab.serverName || id);
    }
  }
  const broadcastTargets = Array.from(seenServers.values());
  const broadcastTargetTitle =
    broadcastTargets.length > 0
      ? t("broadcast_targets_title", {
          count: broadcastTargets.length,
          targets: broadcastTargets.join(", "),
        })
      : t("broadcast_no_targets");
  const targetType = server?.targetType;
  const protocols = server?.protocols || ["ssh"];
  const visibleModules = modules.filter(({ key }) => {
    // 先按 targetType 过滤
    if (!isModuleAvailable(targetType, key)) return false;
    // RDP 是独立系统客户端会话。仅当当前主协议为 RDP 时显示 RDP 模块，
    // 避免把监控/文件/终端等 SSH 模块错误挂载到纯 RDP 工作台。
    if (server?.protocol === "rdp") return key === "rdp";
    // 再按 protocols 过滤：
    //   rdp 模块仅当 protocols 包含 'rdp' 时可见
    //   terminal/files/forward 仅当 protocols 包含 'ssh' 时可见
    //   其余模块（overview/services/processes/...）不受 protocols 限制
    if (key === "rdp") return protocols.includes("rdp");
    if (key === "terminal")
      return protocols.includes("ssh") || protocols.includes("telnet") || protocols.includes("serial") || targetType === "serial" || targetType === "network";
    if (key === "files" || key === "forward")
      return protocols.includes("ssh");
    return true;
  });

  const vertical = toolbarPosition === "left" || toolbarPosition === "right";

  return (
    <div
      className={cn(
        "theme-module-nav flex glass relative z-50 flex-shrink-0",
        vertical
          ? "w-48 min-w-48 flex-col border-y-0"
          : "items-center border-b h-8 px-1.5",
        toolbarPosition === "left" && "border-r",
        toolbarPosition === "right" && "border-l",
        toolbarPosition === "bottom" && "border-t border-b-0",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 no-scrollbar scroll-smooth",
          vertical
            ? "flex-1 flex-col overflow-y-auto"
            : "items-center flex-1 overflow-x-auto gap-0.5",
        )}
      >
        {visibleModules.map(({ key, icon: Icon }) => (
          <button
            key={key}
            className={cn(
              "theme-module-item flex flex-shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap text-[11px] rounded-lg",
              vertical
                ? "w-full justify-start px-3.5 py-2 is-vertical"
                : "mx-0.5 my-0.5 px-2.5 py-1 is-horizontal",
              (activeModule === key || (key === "files" && filesPanelOpen)) &&
                "is-active",
            )}
            onClick={() => onModuleChange(key)}
          >
            <Icon className="h-3.5 w-3.5 flex-shrink-0 opacity-85" />
            <span className="truncate max-w-[120px]">{t(`module_${key}`)}</span>
          </button>
        ))}

        {/* 串口专属控制组（直插顶栏单行，零遮挡终端画布） */}
        {(targetType === "serial" || server?.protocol === "serial") && serialToolbar && !vertical && (
          <div className="flex items-center gap-1.5 pl-2.5 ml-1.5 border-l border-border/50 shrink-0 select-none py-0.5">
            {/* === 1. 前半部分：连接状态与硬件引脚信号 === */}
            {/* 连接 / 断开按钮 */}
            <button
              type="button"
              onClick={serialToolbar.connected ? serialToolbar.disconnect : serialToolbar.reconnect}
              className={cn(
                "flex h-5.5 items-center gap-1 rounded border px-1.5 text-[10px] font-medium transition-colors cursor-pointer",
                serialToolbar.connected
                  ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                  : "border-border/50 bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              title={serialToolbar.connected ? t("serial_disconnect") : t("serial_reconnect")}
            >
              {serialToolbar.connected ? <Wifi className="h-2.5 w-2.5" /> : <WifiOff className="h-2.5 w-2.5" />}
              {serialToolbar.connected ? t("serial_connected") : t("serial_reconnect")}
            </button>

            <div
              className="flex h-5.5 items-center gap-1.5 rounded border border-border/40 bg-muted/25 px-1.5 font-mono text-[9.5px] text-muted-foreground"
              title={`${t("serial_rx_total")}: ${serialToolbar.stats.rxBytes.toLocaleString()} B\n${t("serial_tx_total")}: ${serialToolbar.stats.txBytes.toLocaleString()} B`}
            >
              <span className="text-emerald-600 dark:text-emerald-400">RX {formatSerialMetric(serialToolbar.stats.rxRate, "/s")}</span>
              <span className="text-sky-600 dark:text-sky-400">TX {formatSerialMetric(serialToolbar.stats.txRate, "/s")}</span>
            </div>

            <div className="flex h-5.5 items-center gap-1.5 rounded border border-border/40 bg-muted/25 px-1.5 font-mono text-[9px]" title="CTS / DSR / RI / CD">
              {Object.entries(serialToolbar.signals).map(([name, active]) => (
                <span key={name} className="flex items-center gap-0.5 text-muted-foreground">
                  <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500 shadow-[0_0_5px_#10b981]" : "bg-muted-foreground/30")} />
                  {name.toUpperCase()}
                </span>
              ))}
            </div>

            <div className="flex h-5.5 items-center rounded border border-border/40 bg-muted/25 p-0.5 font-mono text-[9.5px]">
              <button type="button" disabled={!serialToolbar.connected} onClick={serialToolbar.toggleDtr} className={cn("h-4.5 rounded px-1 transition-colors disabled:opacity-40", serialToolbar.dtr ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "text-muted-foreground hover:bg-muted")}>DTR</button>
              <button type="button" disabled={!serialToolbar.connected} onClick={serialToolbar.toggleRts} className={cn("h-4.5 rounded px-1 transition-colors disabled:opacity-40", serialToolbar.rts ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "text-muted-foreground hover:bg-muted")}>RTS</button>
            </div>

            <div className="flex h-5.5 items-stretch">
              <button type="button" disabled={!serialToolbar.connected} onClick={() => serialToolbar.sendBreak(serialToolbar.breakDuration)} className="flex items-center gap-1 rounded-l border border-amber-500/35 bg-amber-500/10 px-1.5 text-[10px] text-amber-700 hover:bg-amber-500/20 disabled:opacity-40 dark:text-amber-300" title={t("serial_send_break", { duration: serialToolbar.breakDuration })}>
                <Zap className="h-2.5 w-2.5" />Break {serialToolbar.breakDuration}ms
              </button>
              <DropdownMenu open={breakDropdownOpen} onOpenChange={setBreakDropdownOpen}>
                <DropdownMenuTrigger asChild>
                  <button type="button" disabled={!serialToolbar.connected} className="rounded-r border-y border-r border-amber-500/35 bg-amber-500/10 px-0.5 text-amber-700 hover:bg-amber-500/20 disabled:opacity-40 dark:text-amber-300" title={t("serial_break_duration")}><ChevronDown className="h-2.5 w-2.5" /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44 p-1">
                  {[100, 250, 500, 1000, 3000].map((ms) => (
                    <DropdownMenuItem key={ms} onClick={() => { serialToolbar.setBreakDuration(ms); setBreakDropdownOpen(false); }} className="justify-between text-xs cursor-pointer">
                      <span>{ms} ms</span>{serialToolbar.breakDuration === ms && <Check className="h-3.5 w-3.5" />}
                    </DropdownMenuItem>
                  ))}
                  <div className="mt-1 flex items-center gap-1 border-t border-border/50 p-1 pt-2" onClick={(event) => event.stopPropagation()}>
                    <input type="number" min={10} max={10000} value={customBreakInput} onChange={(event) => setCustomBreakInput(event.target.value)} placeholder={t("serial_custom_break")} className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-[10px] font-mono" />
                    <button type="button" onClick={() => { const value = Math.min(10000, Math.max(10, parseInt(customBreakInput) || serialToolbar.breakDuration)); serialToolbar.setBreakDuration(value); setCustomBreakInput(""); setBreakDropdownOpen(false); }} className="h-7 rounded bg-primary px-2 text-[10px] text-primary-foreground">{t("serial_apply")}</button>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <button type="button" onClick={serialToolbar.toggleTimestampMode} className={cn("h-5.5 rounded border px-1.5 text-[10px] transition-colors", serialToolbar.timestampMode ? "border-primary/40 bg-primary/15 text-primary" : "border-border/40 bg-muted/25 text-muted-foreground hover:bg-muted/60")}>{t("serial_timestamp")}</button>
            <button type="button" disabled={!serialToolbar.connected} onClick={serialToolbar.toggleHexViewMode} className={cn("h-5.5 rounded border px-1.5 text-[10px] transition-colors disabled:opacity-40", serialToolbar.hexViewMode ? "border-primary/40 bg-primary/15 text-primary" : "border-border/40 bg-muted/25 text-muted-foreground hover:bg-muted/60")}><Binary className="mr-1 inline h-2.5 w-2.5" />HEX</button>
            <button type="button" onClick={serialToolbar.toggleLocalEcho} className={cn("h-5.5 rounded border px-1.5 text-[10px] transition-colors", serialToolbar.localEcho ? "border-primary/40 bg-primary/15 text-primary" : "border-border/40 bg-muted/25 text-muted-foreground hover:bg-muted/60")}>{t("serial_local_echo")}</button>
            <button type="button" disabled={!serialToolbar.connected} onClick={serialToolbar.toggleDisplayPause} className={cn("flex h-5.5 items-center gap-1 rounded border px-1.5 text-[10px] transition-colors disabled:opacity-40", serialToolbar.displayPaused ? "border-amber-500/40 bg-amber-500/15 text-amber-600" : "border-border/40 bg-muted/25 text-muted-foreground hover:bg-muted/60")}>
              {serialToolbar.displayPaused ? <Play className="h-2.5 w-2.5" /> : <Pause className="h-2.5 w-2.5" />}{serialToolbar.displayPaused ? t("serial_resume_display") : t("serial_pause_display")}
            </button>

            {/* === 3. 发送控制 === */}
            {/* 快速发送面板开关 */}
            <button
              type="button"
              onClick={serialToolbar.toggleQuickSendOpen}
              className={cn(
                "h-5.5 flex items-center gap-1 rounded px-1.5 text-[10px] border transition-colors cursor-pointer",
                serialToolbar.quickSendOpen
                  ? "bg-primary text-primary-foreground border-primary font-medium shadow-xs"
                  : "bg-muted/30 text-muted-foreground border-border/40 hover:text-foreground hover:bg-muted/60",
              )}
              title={t("serial_quick_send_help")}
            >
              <Send className="h-2.5 w-2.5" />
              {t("serial_quick_send")}
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="h-5.5 flex items-center gap-1 rounded px-1.5 text-[10px] border border-border/40 bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer"
                  title={t("serial_tools")}
                >
                  <Wrench className="h-2.5 w-2.5" />
                  {t("serial_tools")}
                  <ChevronDown className="h-2.5 w-2.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 p-1">
                <DropdownMenuItem disabled={!serialToolbar.connected} onClick={serialToolbar.sendFile} className="text-xs cursor-pointer">
                  <FileUp className="mr-2 h-3.5 w-3.5" />
                  {t("serial_send_file")}
                </DropdownMenuItem>
                {serialToolbar.openSequenceDialog && (
                  <DropdownMenuItem onClick={serialToolbar.openSequenceDialog} className="text-xs cursor-pointer">
                    <ListOrdered className="mr-2 h-3.5 w-3.5" />
                    {t("serial_sequence")}
                  </DropdownMenuItem>
                )}
                {serialToolbar.openIapDialog && (
                  <DropdownMenuItem disabled={!serialToolbar.connected} onClick={serialToolbar.openIapDialog} className="text-xs cursor-pointer text-emerald-700 dark:text-emerald-300">
                    <Cpu className="mr-2 h-3.5 w-3.5" />
                    {t("serial_iap")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      <div
        className={cn(
          "flex gap-1 flex-shrink-0",
          vertical
            ? "flex-col items-stretch gap-1.5 px-3 py-3 border-t border-border/40 bg-background/20"
            : "items-center px-2 border-l border-border/40",
        )}
      >
        {/* 终端广播按钮：仅在终端模块显示，开启后输入同步到所有开启广播的终端 */}
        {activeModule === "terminal" && (
          <button
            className={cn(
              cn(
                "flex h-6 flex-shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] transition-colors",
                vertical && "w-full justify-start px-3",
              ),
              isBroadcasting
                ? "bg-primary/20 text-primary font-medium"
                : "text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent/40",
            )}
            onClick={() => toggleBroadcastTab(tabId)}
            title={
              isBroadcasting
                ? t("broadcast_enabled_hint", { targets: broadcastTargetTitle })
                : t("broadcast_disabled_hint", {
                    targets: broadcastTargetTitle,
                  })
            }
          >
            <Radio className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{t("broadcast_label")}</span>
          </button>
        )}
        {activeModule !== "bmc" && targetType !== "serial" && server?.protocol !== "serial" && server?.protocol !== "rdp" && (
          <>
            {!isConnected ? (
              <Button
                size="sm"
                className="h-6 text-[10px] gap-1 px-2 flex-shrink-0 overflow-hidden"
                onClick={onConnect}
                disabled={connecting}
              >
                {connecting ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />{" "}
                    <span className="truncate">{t("btn_connecting")}</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3 w-3 flex-shrink-0" />{" "}
                    <span className="truncate">{t("btn_connect")}</span>
                  </>
                )}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0 text-success"
                onClick={onDisconnect}
                title={t("btn_connected")}
              >
                <Wifi className="h-3 w-3" />
              </Button>
            )}
            {connectError && (
              <button
                type="button"
                onClick={onShowDiagnostics}
                className="text-[10px] text-destructive truncate max-w-[130px] ml-1 hover:underline cursor-pointer flex items-center gap-1 bg-destructive/10 hover:bg-destructive/15 px-1.5 py-0.5 rounded transition-colors"
                title={`${connectError} (${t("diag_open") || "查看诊断"})`}
              >
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span className="truncate">{connectError}</span>
              </button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 flex-shrink-0"
              onClick={onShowSnapshot}
              disabled={!isConnected}
              title={t("btn_snapshot")}
            >
              <Camera className="h-3 w-3" />
            </Button>
          </>
        )}
        {activeModule === "terminal" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={() => onShowSearch?.()}
            title={t("tm_search")}
          >
            <Search className="h-3 w-3" />
          </Button>
        )}
        {activeModule === "terminal" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0 text-emerald-400 hover:text-emerald-500 hover:bg-emerald-500/5"
            onClick={() => {
              setShowThemeDialog(true);
              playSound(SoundType.Open);
            }}
            title={t("tm_theme_appearance")}
          >
            <Palette className="h-3 w-3" />
          </Button>
        )}
        {filesPanelOpen && <TransferPanel />}
        {activeModule === "terminal" && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0"
            onClick={() => {
              onToggleTerminalFullscreen();
              playSound(SoundType.Toggle);
            }}
            title={`${isTerminalFullscreen ? t("tm_exit_fullscreen") : t("tm_fullscreen")} (F11)`}
          >
            {isTerminalFullscreen ? (
              <Minimize2 className="h-3 w-3" />
            ) : (
              <Maximize2 className="h-3 w-3" />
            )}
          </Button>
        )}
      </div>

      <TerminalThemeDialog
        open={showThemeDialog}
        onOpenChange={setShowThemeDialog}
      />
    </div>
  );
}
