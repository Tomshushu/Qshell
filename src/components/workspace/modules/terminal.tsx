import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Loader2,
  ArrowUp,
  ArrowDown,
  Check,
  Minimize2,
  Binary,
  Send,
  ChevronDown,
  Play,
  Pause,
  Cable,
  Zap,
  Trash2,
  ListOrdered,
  FileUp,
  RefreshCw,
  WifiOff,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SerialSequenceDialog,
  type SerialSequenceItem,
} from "./serial-sequence-dialog";
import { SerialIapDialog } from "./serial-iap-dialog";
import {
  type SerialChecksumType,
  appendChecksumToHex,
} from "@/lib/serial-checksum";
import { decodeBase64Bytes, formatSerialHex } from "@/lib/serial-utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sshService } from "@/services/ssh-service";
import { backend } from "@/services/api";
import { useAppStore } from "@/store";
import { ConnectionState } from "@/services/ssh-connection-state";
import { reconnectManager } from "@/services/reconnect-manager";
import { useTranslation } from "@/i18n";
import { QshellLoader } from "@/components/ui/qshell-loader";
import {
  matchHints,
  applyHint,
  type HintItem,
  type HintResult,
} from "@/lib/command-intelligence/completion-engine";
import { matchRemotePath } from "@/lib/command-intelligence/remote-path-completion";
import { fetchDynamicHints } from "@/lib/command-intelligence/dynamic-completion";
import {
  recordCommand,
  suggestHistory,
} from "@/lib/command-intelligence/command-history";
import { invalidateRankingCache } from "@/lib/command-intelligence/ranking";
import {
  parseAliasOutput,
  isUserAliasesLoaded,
  setUserAliases,
} from "@/lib/command-intelligence/alias-map";
import { detectPlatform } from "@/lib/command-intelligence/platform-detector";
import {
  recordMarkovTransition,
  getMarkovHintItems,
  updateSessionEntities,
  boostHintsWithRecentEntities,
} from "@/lib/command-intelligence/markov-chain";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { AsyncTerminalSearcher } from "@/utils/terminal-async-search";
import { terminalWebglManager } from "@/services/terminal-webgl-manager";
import {
  getTerminalTheme,
  themeToXtermTheme,
  getTerminalBgOverlay,
} from "@/utils/terminal-themes";
import { getVideoSrc } from "@/lib/terminal-background";
import { highlightKeywords } from "@/utils/terminal-highlighter";
import {
  redactCommandForSession,
  serializeSessionEvent,
  type SessionEventType,
} from "@/lib/session-recording";

import { useToast } from "@/components/ui/toast";
import { playSound, SoundType } from "@/lib/sound";
import { useShortcutStore } from "@/store/shortcut-store";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readFile, stat } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import ZmodemModule from "zmodem.js";
// Browser bundle augments the core with Browser.send_files/save_to_disk.
// Keep the core import above for tree-shakeable protocol types and resolve
// the browser helpers from the bundle at runtime.
import "zmodem.js/dist/zmodem.devel.js";
import "@xterm/xterm/css/xterm.css";



import {
  type TerminalInstance,
  type TerminalModuleProps,
  type SerialOpenConfig,
  type ZmodemOfferLike,
  type ZmodemSessionLike,
  type ZmodemDetectionLike,
  type ZmodemSentryLike,
  type ZmodemModuleLike,
  FONT_PRESETS,
  getXtermCore,
  discardPendingXtermWrites,
  findSigintBoundary,
  stripUnsafeEscapes,
  writeMotdIfMissing,
  writeChunked,
  stripAnsiForRecording,
  MAX_PENDING_BUFFER,
  DANGEROUS_COMMAND_RE,
  MAX_OUTPUT_BYTES_PER_FRAME_DEFAULT,
  MAX_OUTPUT_BYTES_PER_FRAME_FLOOD,
  FLOOD_THRESHOLD_CHARS,
  MAX_QUEUE_BUFFER_CHARS,
  countNewlines,
  sliceCodePointSafe,
  formatSerialMetric,
  computeSafeTerminalDimensions,
  syncTerminalScrollAndDimensions,
  fitTerminalSafely,
  useLatestRef,
  serialTextWriteQueues,
  writeSerialTextWithDelays,
  clearSerialWriteQueue,
  TerminalPasteConfirmDialog,
  TerminalTransferDialog,
  TerminalContextMenu,
  TerminalSelectionToolbar,
  TerminalSearchBar,
  TerminalRecordingBadge,
  TerminalHintPanel,
  SerialQuickSendEditor,
  normalizeShellCommandText,
  formatTerminalPasteData,
  TerminalConnectionOverlay,
} from "@/components/terminal";
import { EditServerDialog } from "@/components/server/edit-server-dialog";
import { useAIStore } from "@/store/ai-store";
import {
  extractPathFromShellTitle,
  resolveRelativePath,
} from "@/utils/terminal-path-utils";

export {
  FONT_PRESETS,
  computeSafeTerminalDimensions,
  syncTerminalScrollAndDimensions,
  fitTerminalSafely,
};

function isInteractiveOrInputElement(el: Element | null): boolean {
  if (!el || typeof (el as any).closest !== "function") return false;
  // 1. 处于搜索栏内部
  if (el.closest(".terminal-search-bar, [data-terminal-search]")) {
    return true;
  }
  // 2. 处于 AI 助手悬浮窗、代码卡片或抽屉内部
  if (
    el.closest(
      '[data-testid="ai-assistant-dialog"], .ai-assistant-card, [data-ai-assistant], .floating-ai-assistant'
    )
  ) {
    return true;
  }
  // 3. 处于任何弹窗、菜单、下拉框、Portal 内部
  if (
    el.closest(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="combobox"], [data-radix-portal], [data-radix-popper-content-wrapper], .modal, .dialog'
    )
  ) {
    return true;
  }
  // 3. 处于表单输入控件（排除 xterm 自身的辅助 textarea）
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    if (el.classList?.contains("xterm-helper-textarea")) {
      return false;
    }
    return true;
  }
  if ((el as HTMLElement).isContentEditable) {
    return true;
  }
  return false;
}

export function TerminalModule({
  serverId,
  isActive = true,
  isVisible = true,
  isConnected = true,
  connectionBlocked = false,
  connectionBlockedReason,
  initialCommand,
  tabId,
  onShellReady,
  isSplitPane,
  isFullscreen = false,
  onToggleFullscreen,
  registerSearchTrigger,
  registerOutputActions,
  registerSerialToolbar,
  registerGetCwd,
  onCwdChange,
  onReconnect,
}: TerminalModuleProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const toastRef = useLatestRef(toast);
  const onReconnectRef = useLatestRef(onReconnect);
  const isConnectedRef = useLatestRef(isConnected);
  const isVisibleRef = useLatestRef(isVisible);
  const baseServerId = serverId.startsWith("ws:")
    ? serverId.slice(3).split(":")[0]
    : serverId.startsWith("sftp:")
      ? serverId.slice(5)
      : serverId;
  const server = useAppStore((s) => s.servers.find((sv) => sv.id === baseServerId));
  const isSerialConsole = server?.targetType === "serial" || server?.protocol === "serial";
  const serialToolbarAvailable = (termId: string | null, terminalMap: Map<string, TerminalInstance>) =>
    Boolean(termId && terminalMap.get(termId)?.status === "connected");
  const serialConfigSummary = useMemo(() => {
    try {
      const config = server?.serialConfig ? JSON.parse(server.serialConfig) : {};
      const parity = config.parity === "odd" ? "O" : config.parity === "even" ? "E" : "N";
      return {
        frame: `${config.dataBits || 8}${parity}${config.stopBits || 1}`,
        flow: config.flowControl === "hardware" ? "RTS/CTS" : config.flowControl === "software" ? "XON/XOFF" : t("serial_none"),
      };
    } catch {
      return { frame: "8N1", flow: t("serial_none") };
    }
  }, [server?.serialConfig, t]);
  const [terminals, setTerminals] = useState<Map<string, TerminalInstance>>(
    new Map(),
  );
  const [activeTermId, setActiveTermId] = useState<string | null>(null);
  const activeTermIdRef = useRef(activeTermId);
  const [peekRawTerminals, setPeekRawTerminals] = useState<Set<string>>(new Set());
  const [editServerOpen, setEditServerOpen] = useState(false);
  useEffect(() => {
    activeTermIdRef.current = activeTermId;
  }, [activeTermId]);
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    hasSelection: boolean;
  } | null>(null);
  const ctxMenuRef = useLatestRef(ctxMenu);
  // 划词快捷浮动操作条状态
  const [selectionToolbar, setSelectionToolbar] = useState<{
    visible: boolean;
    x: number;
    y: number;
    text: string;
  } | null>(null);
  const selectionTimerRef = useRef<number | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const showSearchRef = useRef(false);
  showSearchRef.current = showSearch;
  const [searchText, setSearchText] = useState("");
  const searchTextRef = useLatestRef(searchText);
  // HIGH-1：合并搜索结果/状态为单一 state 对象，避免在 xterm 回调等非 React 事件
  // 上下文里因 4 次独立 setState 未被自动批处理而触发多次重渲染。
  const [searchState, setSearchState] = useState({
    resultIndex: -1,
    resultCount: 0,
    isSearching: false,
    isCapped: false,
  });
  const [pendingPaste, setPendingPaste] = useState<{
    text: string;
    sessionId: string;
  } | null>(null);
  const [recordingTermIds, setRecordingTermIds] = useState<Set<string>>(
    new Set(),
  );
  // 已暂停的录制（保留文件但不写入，可继续）
  const [recordingPausedIds, setRecordingPausedIds] = useState<Set<string>>(
    new Set(),
  );

  // 应用锁：触发全局应用锁（Termius 风格）
  const handleTriggerAppLock = useCallback(() => {
    const { appLockEnabled, appLockPasswordHash, lockApp } = useAppStore.getState();
    if (appLockEnabled && appLockPasswordHash) {
      lockApp();
    } else {
      window.dispatchEvent(
        new CustomEvent("open-app-lock-setup", {
          detail: { lockImmediately: true },
        }),
      );
    }
  }, []);
  const [terminalDragOver, setTerminalDragOver] = useState(false);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [uploadRecords, setUploadRecords] = useState<
    Array<{
      id: string;
      files: string[];
      directory: string;
      protocol: "ZMODEM" | "SFTP";
      status: "uploading" | "success" | "failed";
      phase?: "preparing" | "transferring";
      error?: string;
      at: number;
      bytes?: number;
      totalBytes?: number;
      speed?: number;
      totalFiles?: number;
      completedFiles?: number;
      transferId?: string;
      tmpPath?: string;
    }>
  >([]);
  const [serialDtr, setSerialDtr] = useState(true);
  const [serialRts, setSerialRts] = useState(true);
  const [serialSignals, setSerialSignals] = useState<{
    cts: boolean;
    dsr: boolean;
    ri: boolean;
    cd: boolean;
  }>({ cts: false, dsr: false, ri: false, cd: false });
  const [serialTimestampMode, setSerialTimestampMode] = useState(false);
  const [serialHexViewMode, setSerialHexViewMode] = useState(false);
  const [serialQuickSendOpen, setSerialQuickSendOpen] = useState(false);
  const [serialSendText, setSerialSendText] = useState("");
  const [serialSendType, setSerialSendType] = useState<"ascii" | "hex">("ascii");
  const [serialSendSuffix, setSerialSendSuffix] = useState<"\r\n" | "\n" | "\r" | "">("\r\n");
  const [serialAutoSend, setSerialAutoSend] = useState(false);
  const [serialAutoSendInterval, setSerialAutoSendInterval] = useState(1000);
  const [serialBreakDuration, setSerialBreakDuration] = useState(250);
  const [serialBreakMenuOpen, setSerialBreakMenuOpen] = useState(false);
  const [serialCustomBreakInput, setSerialCustomBreakInput] = useState("");
  const [serialLineDelay, setSerialLineDelay] = useState(0);
  const [serialCharDelay, setSerialCharDelay] = useState(0);
  const [serialNewlineMode, setSerialNewlineMode] = useState<"auto" | "crlf" | "lf" | "cr" | "raw">("auto");
  const [serialSendEditorHeight, setSerialSendEditorHeight] = useState(92);
  const [serialEncodingLabel, setSerialEncodingLabel] = useState("utf-8");
  const [serialLocalEcho, setSerialLocalEcho] = useState(false);
  const [serialDisplayPaused, setSerialDisplayPaused] = useState(false);
  const [serialStats, setSerialStats] = useState({ rxBytes: 0, txBytes: 0, rxRate: 0, txRate: 0 });
  const [serialFileProgress, setSerialFileProgress] = useState<{
    name: string;
    sent: number;
    total: number;
  } | null>(null);
  const [serialSendHistory, setSerialSendHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("serial-send-history") || "[]").slice(0, 30);
    } catch {
      return [];
    }
  });
  const [serialAutoSendCount, setSerialAutoSendCount] = useState(0);
  const [serialEnterToSend, setSerialEnterToSend] = useState(true);
  const [serialChecksumType, setSerialChecksumType] = useState<SerialChecksumType>("none");
  const [serialSequenceDialogOpen, setSerialSequenceDialogOpen] = useState(false);
  const [serialIapDialogOpen, setSerialIapDialogOpen] = useState(false);

  const hexAnalysis = useMemo(() => {
    if (serialSendType !== "hex") return null;
    const clean = serialSendText.replace(/[^0-9a-fA-F]/g, "");
    const hasInvalid = /[^0-9a-fA-F\s]/.test(serialSendText);
    const isOdd = clean.length % 2 !== 0;
    const bytes = Math.floor(clean.length / 2);
    let checksumResult = "";
    if (serialChecksumType !== "none" && !isOdd && !hasInvalid && clean.length > 0) {
      const res = appendChecksumToHex(clean, serialChecksumType);
      if (res.valid) checksumResult = res.checksumHex;
    }
    return { clean, hasInvalid, isOdd, bytes, checksumResult };
  }, [serialSendText, serialSendType, serialChecksumType]);

  const serialAutoSendInFlightRef = useRef(false);
  const serialFileTransferActiveRef = useRef(false);
  const serialFileSenderRef = useRef<((path: string) => Promise<boolean>) | null>(null);
  const serialLocalEchoRef = useLatestRef(serialLocalEcho);
  const serialDisplayPausedRef = useLatestRef(serialDisplayPaused);
  const serialPausedOutputRef = useRef(new Map<string, string>());
  const serialStatsSampleRef = useRef<{ sessionId: string; rxBytes: number; txBytes: number; at: number } | null>(null);
  const serialLineDelayRef = useLatestRef(serialLineDelay);
  const serialCharDelayRef = useLatestRef(serialCharDelay);
  const serialEncodingLabelRef = useLatestRef(serialEncodingLabel);

  // MED-2：串口 ref 同步 useEffect 已由 useLatestRef 取代（声明见上方），删除此处重复同步
  const serialTimestampModeRef = useLatestRef(serialTimestampMode);
  const serialHexViewModeRef = useLatestRef(serialHexViewMode);

  useEffect(() => {
    if (server?.targetType !== "serial" && server?.protocol !== "serial") return;
    try {
      const config = server.serialConfig ? JSON.parse(server.serialConfig) : {};
      setSerialEncodingLabel(config.encoding || "utf-8");
      setSerialLineDelay(Math.max(0, Number(config.lineDelayMs) || 0));
      setSerialCharDelay(Math.max(0, Number(config.charDelayMs) || 0));
      setSerialNewlineMode(config.newlineMode || "auto");
      setSerialBreakDuration(Math.max(10, Number(config.breakDurationMs) || 250));
      setSerialLocalEcho(config.localEcho === true);
      setSerialDtr(config.dtr ?? true);
      setSerialRts(config.rts ?? true);
    } catch {
      setSerialEncodingLabel("utf-8");
      setSerialLineDelay(0);
      setSerialCharDelay(0);
      setSerialNewlineMode("auto");
      setSerialBreakDuration(250);
      setSerialLocalEcho(false);
    }
  }, [server?.targetType, server?.protocol, server?.serialConfig]);

  const serialNewlineModeRef = useLatestRef(serialNewlineMode);

  const serialLineStartMapRef = useRef(new Map<string, boolean>());
  const serialAutoSendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const zmodemSessionsRef = useRef(
    new Map<string, { session: ZmodemSessionLike; zmodem: ZmodemModuleLike }>(),
  );
  const zmodemSentriesRef = useRef(new Map<string, ZmodemSentryLike>());
  const pendingZmodemPathsRef = useRef<string[] | null>(null);
  const zmodemTransferStarterRef = useRef<
    ((paths: string[]) => Promise<boolean>) | null
  >(null);
  const zmodemHandshakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const transferAutoCloseTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const pendingSftpRecordRef = useRef<string | null>(null);
  const sftpFileProgressRef = useRef(new Map<string, Map<string, number>>());
  const [pendingOutputCounts, setPendingOutputCounts] = useState<
    Map<string, number>
  >(new Map());
  // 全局 AI 总开关
  const enableAiGlobal = useAIStore((s) => s.enableAiGlobal);
  // E7：搜索正则模式开关
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  // MED-2：搜索开关相关 ref 改用 useLatestRef
  const searchRegexRef = useLatestRef(searchRegex);
  const searchCaseSensitiveRef = useLatestRef(searchCaseSensitive);
  const searchWholeWordRef = useLatestRef(searchWholeWord);
  // 搜索输入防抖计时器：避免快速连续按键打字时高频触发全量 50k 行扫描
  const searchDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    return () => {
      if (searchDebounceTimerRef.current) {
        clearTimeout(searchDebounceTimerRef.current);
        searchDebounceTimerRef.current = null;
      }
    };
  }, []);
  // 指令提示相关状态
  const [cmdHints, setCmdHints] = useState<HintItem[]>([]);
  const [hintIndex, setHintIndex] = useState(0);
  const [hintVisible, setHintVisible] = useState(false);
  // 路径/动态补全的异步请求中：远端 ls / docker ps 有 RTT，
  // 期间显示「补全中…」，避免按 Tab 时面板瞬间消失、看起来像没反应。
  const [hintLoading, setHintLoading] = useState(false);
  // 「补全中」延迟显示的定时器：快速输入时每个请求几十毫秒就返回，
  // 立即显示会闪烁干扰，只有超过阈值才真正显示（见 scheduleHintLoading）。
  const hintLoadingTimerRef = useRef<number | null>(null);
  const currentInputRef = useRef(""); // 追踪当前输入行
  // MED-2：指令提示相关 ref 改用 useLatestRef
  const cmdHintsRef = useLatestRef(cmdHints); // 闭包中访问最新值
  const hintResultRef = useRef<HintResult | null>(null); // 当前引擎结果（供 Tab 补全用）
  const hintIndexRef = useLatestRef(hintIndex);
  // 提示框可见性 ref：供 onData 闭包读取最新值，决定退格时是否更新提示
  const hintVisibleRef = useLatestRef(hintVisible);
  // 远程路径补全请求版本号：每次发起新请求自增，过期请求的结果被丢弃
  const pathFetchIdRef = useRef(0);
  // 键盘 ↑↓ 导航时滚动选中项到可见区域。
  // 仅在 hintIndex 变化时触发，不影响 onMouseEnter（鼠标 hover 自带可见性）。
  // 使用 rAF 确保 DOM 已渲染到最新 hintIndex 对应的高亮项。
  useEffect(() => {
    if (!hintVisible || cmdHints.length === 0) return;
    const raf = requestAnimationFrame(() => {
      const container = terminalContainerRef.current;
      if (!container) return;
      const el = container.querySelector(
        `[data-hint-idx="${hintIndex}"]`,
      ) as HTMLElement | null;
      el?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(raf);
  }, [hintIndex, hintVisible, cmdHints.length]);
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  const xtermInstances = useRef<
    Map<
      string,
      {
        term: Terminal;
        fitAddon: FitAddon;
        asyncSearcher: AsyncTerminalSearcher;
        sessionId?: string;
        cleanup?: (isReconnecting?: boolean) => void;
        sessionCleanup?: () => void;
        termCleanup?: () => void;
      }
    >
  >(new Map());
  const recordingTermIdsRef = useRef<Set<string>>(new Set());
  const recordingFilePathsRef = useRef<Map<string, string>>(new Map());
  type RecordingFileState = {
    directory: string;
    baseName: string;
    path: string;
    bytes: number;
    part: number;
    maxBytes: number;
    sessionPath: string;
    startedAt: number;
    sessionId: string;
  };
  const recordingFileStatesRef = useRef<Map<string, RecordingFileState>>(
    new Map(),
  );
  const recordingWriteChainsRef = useRef<Map<string, Promise<void>>>(new Map());
  // 录制写入采用串行 Promise 链。磁盘或杀毒软件短暂变慢时，如果无限追加
  // 闭包，日志内容会被整个保留在 JS 堆中，最终把长时间运行的工作台拖垮。
  // 超过上限立即停止该终端录制，已排队内容仍会按原顺序尽力落盘。
  const recordingPendingCharsRef = useRef<Map<string, number>>(new Map());
  const MAX_RECORDING_PENDING_CHARS = 8 * 1024 * 1024;
  const recordingWriteErrorNotifiedRef = useRef<Set<string>>(new Set());
  const recordingPausedRef = useRef<Set<string>>(new Set());
  // 停止录制后仍保留最近一次日志路径，便于"打开日志文件"在停止后可用
  const recordingLastPathRef = useRef<Map<string, string>>(new Map());
  const terminalCwdRef = useRef<Map<string, string>>(new Map());
  const homeDirRef = useRef<string>("");
  // 终端 cwd 变化推送：文件面板据此即时跟随（避免轮询延迟）
  const onCwdChangeRef = useRef(onCwdChange);
  useEffect(() => {
    onCwdChangeRef.current = onCwdChange;
  }, [onCwdChange]);
  // 记录终端 cwd 并对外推送变化事件；仅当是活跃终端时推送（文件面板跟随活跃终端）
  const recordTerminalCwd = useCallback((termId: string, cwd: string) => {
    if (!cwd) return;
    terminalCwdRef.current.set(termId, cwd);
    // 文件面板只认绝对路径；home 未就绪时的 `~` 占位形式仅内部补全使用，不外推
    if (termId === activeTermIdRef.current && cwd.startsWith("/")) {
      onCwdChangeRef.current?.(cwd);
    }
  }, []);
  const shellIntegrationRef = useRef<
    Map<
      string,
      {
        phase: "prompt" | "input" | "output" | "finished";
        exitCode?: number;
        startedAt?: number;
        command?: string;
        durationMs?: number;
      }
    >
  >(new Map());
  const pendingCommandRef = useRef<Map<string, string>>(new Map());
  // 记录每个终端上一次成功提交执行的指令，用于马尔可夫转移连招预测
  const lastSubmittedCommandPerTermRef = useRef<Map<string, string>>(new Map());
  type CommandMarkerEntry = {
    marker: { line: number; isDisposed: boolean; dispose: () => void };
    command: string;
    exitCode?: number;
    durationMs?: number;
  };
  const commandMarkersRef = useRef<Map<string, CommandMarkerEntry[]>>(new Map());
  const [commandMarkerVersion, setCommandMarkerVersion] = useState(0);
  const commandMarkerCursorRef = useRef<Map<string, number>>(new Map());
  const pendingOutputCountsRef = useRef<Map<string, number>>(new Map());
  // Ctrl+C 返回后端已发出的最后一个输出序号。Tauri/WebView 事件可能已经
  // 排在 IPC 队列里但尚未执行；序号过滤可以在回调层直接丢弃这些旧日志，
  // 避免它们重新进入 xterm WriteBuffer。
  const discardedShellOutputThroughRef = useRef<Map<string, number>>(new Map());
  // 记录用户是否主动通过滚轮/滚动条向上翻看历史（区别于分屏/窗口 resize 导致的被动折行位移）
  const userScrolledUpRef = useRef<Map<string, boolean>>(new Map());
  const pendingOutputFrameRef = useRef<number | null>(null);
  // 高吞吐块队列（对齐 VS Code 架构）：使用 string[] 块数组而非大字符串拼接，彻底消除 ConsString 内存膨胀
  const outputWriteQueuesRef = useRef<
    Map<
      string,
      {
        term: Terminal;
        chunks: string[];
        totalChars: number;
        wasScrolledUp: boolean;
        viewportY: number;
        needsHighlight?: boolean;
      }
    >
  >(new Map());
  const outputWriteFrameRef = useRef<number | null>(null);
  // 用户上滚查看历史时才使用外层队列；普通跟随输出直接交给 xterm.js 的
  // WriteBuffer。历史队列仍限制单终端一个写入帧，避免滚动位置被并行写入破坏。
  const outputWriteInFlightRef = useRef<Set<string>>(new Set());
  const outputWriteTokenRef = useRef<Map<string, number>>(new Map());
  // 普通跟随模式直接交给 xterm.js 自己的 WriteBuffer；这里仅统计已交给
  // xterm、尚未执行完 callback 的字符量，用于给 SSH 读取做高低水位流控。
  const xtermPendingCharsRef = useRef<Map<string, number>>(new Map());
  // 满速物理吞吐高低水位流控阈值（对标 VS Code / RFC 4254 标准）：
  // 高水位 1MB，低水位 256KB。滞后差量 768KB，杜绝频繁 pause/resume 抖动；
  // 同时确保在途积压受控，避免极端日志倾泻占满主线程与内存导致 Ctrl+C 严重滞后。
  const XTERM_HIGH_WATERMARK_CHARS = 1024 * 1024; // 1 MB
  const XTERM_LOW_WATERMARK_CHARS = 256 * 1024;   // 256 KB
  const HIGH_WATERMARK_CHARS = 1024 * 1024;       // 1 MB
  const LOW_WATERMARK_CHARS = 256 * 1024;         // 256 KB
  // 记录各会话是否正处于高水位暂停状态
  const pausedShellsRef = useRef<Map<string, boolean>>(new Map());
  // 记录各会话处于 Ctrl+C 快速排空窗口的截止时间戳 (ms)，在此窗口内丢弃在途旧日志并严禁触发 pauseShell
  const sigintActiveUntilRef = useRef<Map<string, number>>(new Map());
  // 记录排空窗口内已丢弃的字符数（防爆上限保护，默认 4MB）
  const sigintDroppedCharsRef = useRef<Map<string, number>>(new Map());
  const termContainerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const terminalsRef = useRef<Map<string, TerminalInstance>>(new Map());
  const blockedNoticeRef = useRef<Map<string, string>>(new Map());
  const reconnectingRef = useRef<Set<string>>(new Set()); // 防止重连竞态
  const isUnmountedRef = useRef(false);
  // H2 修复：rebuildInputFromBuffer 的 pending 标记。
  // 调历史/删词后设置此 flag，下一次用户实际输入字符时若 flag 仍为 true，
  // 说明 setTimeout 回调可能读到了过时 buffer（SSH 异步回显未到达），
  // 此时立即补读一次 buffer 再处理输入，避免 currentInputRef 错位。
  const needsRebuildRef = useRef(false);
  // H3 修复：resize 节流定时器改为 per-terminal Map，避免多终端 resize 互相覆盖
  const resizeTimersRef = useRef<Map<string, number>>(new Map());
  // 防抖读取 xterm 当前输入行的定时器；组件卸载时必须取消，避免回调继续
  // 持有已销毁的 Terminal 实例。
  const rebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 获取终端设置用于连接状态输出
  const terminalFontSize = useAppStore((s) => s.terminalFontSize);
  const setTerminalFontSize = useAppStore((s) => s.setTerminalFontSize);
  const terminalFontFamily = useAppStore((s) => s.terminalFontFamily);

  // 终端主题与高亮配置
  const terminalThemeId = useAppStore((s) => s.terminalThemeId);
  const customTerminalThemes = useAppStore((s) => s.customTerminalThemes);
  const terminalThemeOverrides = useAppStore((s) => s.terminalThemeOverrides);

  const terminalHighlightEnabled = useAppStore(
    (s) => s.terminalHighlightEnabled,
  );
  const terminalHighlightRules = useAppStore((s) => s.terminalHighlightRules);
  const terminalCopyPaste = useAppStore((s) => s.terminalCopyPaste);
  const terminalPasteWarnEnabled = useAppStore(
    (s) => s.terminalPasteWarnEnabled ?? true,
  );
  const setTerminalPasteWarnEnabled = useAppStore(
    (s) => s.setTerminalPasteWarnEnabled,
  );
  const terminalSelectionToolbar = useAppStore(
    (s) => s.terminalSelectionToolbar ?? true,
  );
  const terminalSelectionToolbarRef = useLatestRef(terminalSelectionToolbar);
  const terminalBellSound = useAppStore((s) => s.terminalBellSound);
  // ref 镜像：onBell 回调只注册一次，直接用闭包变量会读到过期值，导致开关改了不生效
  const terminalBellSoundRef = useLatestRef(terminalBellSound ?? false);
  const terminalDrawBoldInBrightColors = useAppStore(
    (s) => s.terminalDrawBoldInBrightColors,
  );
  // 指令提示总开关（设置面板 / Ctrl+Shift+H 快捷键切换）
  const terminalHintEnabled = useAppStore((s) => s.terminalHintEnabled);
  const setTerminalHintEnabled = useAppStore((s) => s.setTerminalHintEnabled);
  const terminalScrollbackLines = useAppStore((s) => s.terminalScrollbackLines);
  const terminalRecordingDirectory = useAppStore(
    (s) => s.terminalRecordingDirectory,
  );
  const setTerminalRecordingDirectory = useAppStore(
    (s) => s.setTerminalRecordingDirectory,
  );
  const terminalRecordingMaxSizeMb = useAppStore(
    (s) => s.terminalRecordingMaxSizeMb,
  );
  const terminalEncoding = useAppStore((s) => s.terminalEncoding);

  // 编码变更只影响文本通道；ZMODEM 仍由独立的二进制通道处理。
  useEffect(() => {
    for (const { sessionId } of xtermInstances.current.values()) {
      if (sessionId) {
        void sshService
          .setShellEncoding(sessionId, terminalEncoding)
          .catch((error) => {
            console.warn("[Terminal] failed to switch encoding:", error);
          });
      }
    }
  }, [terminalEncoding]);
  // 全局自动重连开关（设置面板，默认开启）
  const terminalAutoReconnect = useAppStore((s) => s.terminalAutoReconnect);
  // 防空闲保活配置（默认关闭，因底层已有 15s 纯 SSH 协议心跳，避免向终端注入字符破坏日志）
  const terminalAntiIdleEnabled = useAppStore(
    (s) => s.terminalAntiIdleEnabled ?? false,
  );
  const terminalAntiIdleInterval = useAppStore(
    (s) => s.terminalAntiIdleInterval ?? 60,
  );
  const terminalAntiIdleMode = useAppStore(
    (s) => s.terminalAntiIdleMode ?? "null",
  );
  const terminalAntiIdleCustomString = useAppStore(
    (s) => s.terminalAntiIdleCustomString ?? "",
  );

  // 手动断开标志（per-serverId）：handleDisconnect 设置为 true，阻止终端自动重连
  const manualDisconnect = useAppStore((s) =>
    serverId ? (s.manualDisconnect[serverId] ?? false) : false,
  );
  // MED-2：以下 ref 改用 useLatestRef，消除重复的 useEffect 同步样板
  const terminalScrollbackLinesRef = useLatestRef(terminalScrollbackLines);
  // 全局自动重连开关 ref，默认开启
  const terminalAutoReconnectRef = useLatestRef(terminalAutoReconnect ?? false);

  // 防空闲保活 refs
  const terminalAntiIdleEnabledRef = useLatestRef(terminalAntiIdleEnabled);
  const terminalAntiIdleIntervalRef = useLatestRef(terminalAntiIdleInterval);
  const terminalAntiIdleModeRef = useLatestRef(terminalAntiIdleMode);
  const terminalAntiIdleCustomStringRef = useLatestRef(terminalAntiIdleCustomString);

  // 会话最后活动时间戳记录（sessionId -> timestamp），用于防空闲超时判定
  const lastActivityTimesRef = useRef<Map<string, number>>(new Map());

  // ── 防空闲断开保活机制 (Anti-Idle Keepalive) ─────────────────────────
  // 业界标准实现：在终端会话空闲超过设定间隔后，静默向 Shell 发送保活字符序列（默认 \0 NUL 空字符），
  // 既能重置 Linux 内核与 Bash 的输入活跃计时器，又在 TTY 驱动中被静默丢弃（不换行、不回显、不移动光标）。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (!terminalAntiIdleEnabledRef.current) return;
      if (isUnmountedRef.current) return;

      const intervalSec = terminalAntiIdleIntervalRef.current || 60;
      const intervalMs = intervalSec * 1000;
      const mode = terminalAntiIdleModeRef.current || "null";
      const customStr = terminalAntiIdleCustomStringRef.current || "";

      let payload = "\0"; // 默认静默发送 \0 (NUL 空字符)
      if (mode === "enter") {
        payload = "\r";
      } else if (mode === "space_backspace") {
        payload = " \b";
      } else if (mode === "null") {
        payload = "\0";
      } else if (mode === "custom") {
        payload =
          customStr
            .replace(/\\r/g, "\r")
            .replace(/\\n/g, "\n")
            .replace(/\\t/g, "\t")
            .replace(/\\0/g, "\0")
            .replace(/\\b/g, "\b") || "\0";
      }

      const now = Date.now();
      for (const inst of terminalsRef.current.values()) {
        if (
          inst.status !== "connected" ||
          !inst.sessionId ||
          !sshService.isSessionAlive(inst.sessionId)
        ) {
          continue;
        }

        // 串口文件传输时跳过，避免损坏传输流
        if (serialFileTransferActiveRef.current) {
          continue;
        }

        // 用户正在向上翻看历史日志时跳过，避免注入控制字符破坏当前浏览或引发假新输出
        if (userScrolledUpRef.current.get(inst.id) === true) {
          continue;
        }

        const lastActivity =
          lastActivityTimesRef.current.get(inst.sessionId) || 0;
        if (now - lastActivity >= intervalMs) {
          lastActivityTimesRef.current.set(inst.sessionId, now);
          void sshService.writeToShell(inst.sessionId, payload).catch(() => {});
        }
      }
    };

    // MED-1：按需调度而非固定 5s 轮询。轮询间隔取「用户设定间隔的一半」与 5s 的较大值，
    // 避免用户设定极长间隔（如 300s）时仍每 5s 空转遍历所有终端；同时每次重新调度都读取最新
    // interval 设置，用户在运行中调大/调小间隔都能立即生效，不会因固定周期而漏发保活。
    const schedule = () => {
      const intervalSec = terminalAntiIdleIntervalRef.current || 60;
      const delay = Math.max(5000, (intervalSec * 1000) / 2);
      timer = setTimeout(() => {
        tick();
        schedule();
      }, delay);
    };
    schedule();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  // 手动断开标志 ref：供回调内读取最新值，避免 handleDisconnect 后终端自动重连撤销用户操作
  const manualDisconnectRef = useRef(manualDisconnect);
  useEffect(() => {
    manualDisconnectRef.current = manualDisconnect;
  }, [manualDisconnect]);
  // 指令提示开关 ref：供 runMatchHints 闭包读取最新值，避免依赖抖动
  const terminalHintEnabledRef = useRef(terminalHintEnabled ?? true);
  useEffect(() => {
    terminalHintEnabledRef.current = terminalHintEnabled ?? true;
    // 开关关闭时立即清空当前提示及挂起的异步请求
    if (!terminalHintEnabled) {
      pathFetchIdRef.current += 1;
      if (hintLoadingTimerRef.current !== null) {
        window.clearTimeout(hintLoadingTimerRef.current);
        hintLoadingTimerRef.current = null;
      }
      setHintLoading(false);
      setCmdHints([]);
      setHintVisible(false);
    }
  }, [terminalHintEnabled]);

  // 已打开终端也立即采用新的 scrollback 上限；xterm 会自行裁剪最旧内容。
  useEffect(() => {
    xtermInstances.current.forEach(({ term }) => {
      term.options.scrollback = terminalScrollbackLines;
    });
  }, [terminalScrollbackLines]);


  // 监听终端铃声配置变化，动态调整所有终端实例的 bellStyle。
  // 仅负责终端收到 BEL (\x07) 时的响铃；全局界面音效由 store.uiSoundEnabled 控制，二者已解耦。
  useEffect(() => {
    const enabled = terminalBellSound ?? false;
    xtermInstances.current.forEach(({ term }) => {
      // 关闭铃声时改为 visual：静默 + 视觉闪烁（xterm.css 已引入），与设置项描述一致
      // xterm 6 的 ITerminalOptions 类型已移除 bellStyle（运行时仍支持），经 unknown 写入
      (term.options as unknown as { bellStyle?: string }).bellStyle = enabled
        ? "sound"
        : "visual";
    });
  }, [terminalBellSound]);

  // 监听粗体文本高亮变化，动态调整所有终端实例
  useEffect(() => {
    xtermInstances.current.forEach(({ term }) => {
      term.options.drawBoldTextInBrightColors =
        terminalDrawBoldInBrightColors ?? true;
    });
  }, [terminalDrawBoldInBrightColors]);

  // MED-2：以下 ref 改用 useLatestRef，消除重复的 useEffect 同步样板
  const highlightEnabledRef = useLatestRef(terminalHighlightEnabled);
  const highlightRulesRef = useLatestRef(terminalHighlightRules);

  // 终端模块活跃状态 ref：window 级 keydown 监听器通过此 ref 判断是否应响应，
  // 避免终端被 hidden 隐藏后（切换到文件管理器等其他模块），字号/提示等快捷键仍被错误触发
  const isActiveRef = useLatestRef(isActive);

  // 视口与活跃状态变化时，动态向全局 WebGL 协调器同步可见性
  // 只有真正前台可见的终端获得 WebGL 加速；后台终端平滑降级为 DOM 渲染，
  // 彻底杜绝触碰浏览器 8~16 个 WebGL 上下文硬限制
  useEffect(() => {
    terminals.forEach((_, termId) => {
      const isTermVisible = isVisible && activeTermId === termId;
      terminalWebglManager.updateState(termId, { isVisible: isTermVisible });
    });
  }, [isVisible, activeTermId, terminals]);

  // 当前生效的终端主题（单一主题模式）
  // 传入 terminalThemeOverrides 合并系统预设主题的背景图覆盖层配置
  const activeTheme = useMemo(
    () =>
      getTerminalTheme(
        terminalThemeId,
        customTerminalThemes,
        terminalThemeOverrides,
      ),
    [terminalThemeId, customTerminalThemes, terminalThemeOverrides],
  );
  // createTerminal/initTerminalAndShell 是长生命周期回调；通过 ref 获取最新
  // 主题，避免后创建的终端仍使用组件初次渲染时捕获的旧主题。
  const activeThemeRef = useLatestRef(activeTheme);

  // 广播目标按工作台的当前活动终端维护。一个工作台内可以有多个
  // xterm/session，但隐藏终端不应接收广播，避免同一台服务器重复执行命令。
  useEffect(() => {
    if (!tabId) return;
    const sessionId = activeTermId
      ? xtermInstances.current.get(activeTermId)?.sessionId
      : undefined;
    sshService.setTabActiveSession(tabId, sessionId);
    return () => {
      sshService.setTabActiveSession(tabId, undefined);
    };
  }, [tabId, activeTermId, terminals]);

  // 同步 terminals state 到 ref，供回调中使用最新值
  useEffect(() => {
    terminalsRef.current = terminals;
  }, [terminals]);

  // 根据输入匹配指令提示（命令名 + 子命令/参数 + 路径 + 历史推荐）
  const platform = useMemo(() => {
    if (server?.targetType === "network") return "network";
    return detectPlatform(server?.osType, server?.osInfo);
  }, [server?.targetType, server?.osType, server?.osInfo]);
  // 问题 10 修复：platform 通过 ref 传递，避免 runMatchHints 闭包捕获 stale platform。
  // 服务器 OS 探测完成前 platform='universal'，探测后变为具体发行版（如 'debian'）。
  // 若 runMatchHints 依赖 platform，已存在终端的 onData/customKeyEventHandler 闭包会持有旧值，
  // 导致不兼容命令不标灰。改用 ref 后 runMatchHints 引用稳定，所有闭包自动读取最新 platform。
  const platformRef = useLatestRef(platform);

  /**
   * 显示「补全中…」：延迟 300ms 且只对最新请求生效。
   *
   * 快速输入时每次按键都会发起新请求、几十毫秒就返回，立即显示会不断闪烁；
   * 延迟后只有「远端确实慢」（>300ms）才出现，且过期请求不会误显示。
   */
  const scheduleHintLoading = useCallback((myId: number) => {
    if (hintLoadingTimerRef.current !== null) {
      window.clearTimeout(hintLoadingTimerRef.current);
    }
    hintLoadingTimerRef.current = window.setTimeout(() => {
      hintLoadingTimerRef.current = null;
      if (!isUnmountedRef.current && pathFetchIdRef.current === myId) {
        setHintLoading(true);
      }
    }, 300);
  }, []);

  /** 清除「补全中…」及其定时器 */
  const clearHintLoading = useCallback(() => {
    if (hintLoadingTimerRef.current !== null) {
      window.clearTimeout(hintLoadingTimerRef.current);
      hintLoadingTimerRef.current = null;
    }
    setHintLoading(false);
  }, []);

  /**
   * 懒加载用户真实 shell 别名（~/.bashrc / ~/.bash_aliases / ~/.zshrc）。
   *
   * 仅在 SSH Linux/macOS 会话且连接成功后加载；请求成功才标记已加载，
   * 若连接未就绪或短暂失败允许后续重试。
   */
  const aliasFetchInflightRef = useRef<Set<string>>(new Set());
  const serverRef = useLatestRef(server);
  const ensureAliasesLoaded = useCallback((sid: string) => {
    if (!sid || isUserAliasesLoaded(sid) || aliasFetchInflightRef.current.has(sid)) return;
    const srv = serverRef.current;
    if (
      srv?.targetType === "serial" ||
      srv?.protocol === "serial" ||
      srv?.protocol === "telnet" ||
      srv?.targetType === "network" ||
      srv?.targetType === "bmc"
    ) {
      return;
    }
    aliasFetchInflightRef.current.add(sid);
    void sshService
      .execute(
        sid,
        "cat ~/.bashrc ~/.bash_aliases ~/.zshrc 2>/dev/null | grep -E '^[[:space:]]*alias[[:space:]]' || true",
      )
      .then((r) => {
        aliasFetchInflightRef.current.delete(sid);
        if (r?.success) {
          setUserAliases(sid, parseAliasOutput(r.stdout ?? ""));
        }
      })
      .catch(() => {
        aliasFetchInflightRef.current.delete(sid);
      });
  }, []);

  const runMatchHints = useCallback(
    (input: string, opts?: { silent?: boolean }) => {
      const silent = opts?.silent ?? false;
      // 每次重新匹配先复位 loading（含定时器）；异步分支稍后会重新排期
      clearHintLoading();
      // 指令提示总开关关闭时，不显示任何提示
      if (!terminalHintEnabledRef.current) {
        setCmdHints([]);
        setHintVisible(false);
        hintResultRef.current = null;
        return;
      }

      // 终端状态感知保护：
      // 1. 备用屏幕（Alternate Screen，如 vim / htop / less / tmux / nano）中严禁弹出补全框
      // 2. 密码输入或交互确认提示行（Password: / Passphrase: / [y/N] / (yes/no)）严禁弹出补全框
      const curTermId = activeTermIdRef.current;
      const activeTerm = curTermId
        ? xtermInstances.current.get(curTermId)?.term
        : undefined;
      if (activeTerm) {
        try {
          const buf = activeTerm.buffer?.active;
          if (buf?.type === "alternate") {
            pathFetchIdRef.current += 1;
            setCmdHints([]);
            setHintVisible(false);
            return;
          }
          if (buf) {
            const curLine = buf
              .getLine(buf.baseY + buf.cursorY)
              ?.translateToString(true) ?? "";
            if (
              /(?:password|passphrase|密码)[^:：]*[:：]\s*$/i.test(curLine) ||
              /\[(?:y\/n|yes\/no)\]|\((?:yes\/no)\)/i.test(curLine)
            ) {
              pathFetchIdRef.current += 1;
              setCmdHints([]);
              setHintVisible(false);
              return;
            }
          }
        } catch {
          /* ignore buffer inspection error */
        }
      }

      // 懒加载用户别名（不阻塞本次补全，加载完成后下次输入生效）
      ensureAliasesLoaded(serverId);
      // silent 模式：↑↓调历史、退格删改等非主动输入场景，只更新内部 hintResultRef
      // （供 Tab 补全仍能工作），但不弹出提示框，避免干扰翻历史。
      if (silent) {
        // H4 修复：silent 模式也自增 pathFetchIdRef，使之前 pending 的异步请求失效，
        // 避免其 resolve 后意外弹出提示框干扰历史导航
        pathFetchIdRef.current += 1;
        const result = matchHints(input, 12, platformRef.current, serverId);
        hintResultRef.current = result;
        return;
      }
      const result = matchHints(input, 12, platformRef.current, serverId);
      hintResultRef.current = result;

      // 若处于命令阶段但末尾为空格（如刚输入 `sudo ` 尚未敲入目标命令首字母），暂不弹出命令面板
      if (/\s$/.test(input) && result.phase === "command") {
        pathFetchIdRef.current += 1;
        setCmdHints([]);
        setHintVisible(false);
        return;
      }

      const cwd = curTermId
        ? terminalCwdRef.current.get(curTermId) ?? homeDirRef.current
        : homeDirRef.current;
      const prevCmd = curTermId
        ? lastSubmittedCommandPerTermRef.current.get(curTermId)
        : undefined;
      const scopeId = serverId || curTermId || "default";

      // 提取上一条命令执行后的终端末尾输出（最多 12 行），用于报错感知与智能修复推荐
      let recentOutput = "";
      if (prevCmd && activeTerm) {
        try {
          const buf = activeTerm.buffer?.active;
          if (buf) {
            const curAbsY = buf.baseY + buf.cursorY;
            const startY = Math.max(0, curAbsY - 12);
            const outLines: string[] = [];
            for (let y = startY; y < curAbsY; y++) {
              const l = buf.getLine(y)?.translateToString(true)?.trim();
              if (l) outLines.push(l);
            }
            recentOutput = outLines.join("\n");
          }
        } catch {
          /* ignore */
        }
      }

      // 统一计算高优先级「预测层候选」（报错智能修复 + 马尔可夫连招 + 全阶段三维上下文历史）
      const buildPredictiveHints = (staticItems: HintItem[]): HintItem[] => {
        const trimmed = input.trim();
        if (!trimmed) return [];
        const markovHints = getMarkovHintItems(prevCmd, input, cwd, 2, {
          scopeId,
          serverId,
          lastOutput: recentOutput,
          platform: platformRef.current,
        });
        const markovLabels = new Set(markovHints.map((m) => m.label));
        const staticLabels = new Set(staticItems.map((i) => i.label));

        // 全阶段上下文历史推荐（支持命令/子命令/参数/动态阶段及多词缩写，按 ServerId+CWD 加权）
        const histBudget = result.phase === "command" ? 2 : 3;
        const rawHist = suggestHistory(input, histBudget, {
          serverId,
          cwd: cwd || undefined,
        });
        const dedupHist = rawHist.filter((h) => {
          if (markovLabels.has(h.label) || staticLabels.has(h.label)) return false;
          if (h.label === trimmed) return false;
          return true;
        });
        return [...markovHints, ...dedupHist];
      };

      const applyHintList = (list: HintItem[]) => {
        if (list.length > 0) {
          const firstEnabledIdx = list.findIndex((h) => !h.disabled);
          setCmdHints(list);
          setHintIndex(firstEnabledIdx >= 0 ? firstEnabledIdx : 0);
          setHintVisible(true);
        } else {
          setCmdHints([]);
          setHintVisible(false);
        }
      };

      const chainNames = result.commandChain.map((c) => c.cmd);

      // 动态补全阶段：流式合成（先秒出匹配的连招/历史完整命令，再异步合入远端实时资源）
      if (result.phase === "dynamic" && result.dynamicProvider) {
        const predictive = buildPredictiveHints([]);
        if (predictive.length > 0) {
          applyHintList(predictive);
        } else {
          setCmdHints([]);
          setHintVisible(false);
        }
        pathFetchIdRef.current += 1;
        const myId = pathFetchIdRef.current;
        scheduleHintLoading(myId);
        const provider = result.dynamicProvider;
        const tokens = result.tokens ?? [];
        const currentToken = result.currentToken ?? "";
        fetchDynamicHints(
          serverId,
          provider,
          chainNames,
          tokens,
          currentToken,
          cwd || undefined,
        )
          .then((remoteItems) => {
            if (isUnmountedRef.current) return;
            if (pathFetchIdRef.current !== myId) return;
            clearHintLoading();
            const boostedRemote = boostHintsWithRecentEntities(
              remoteItems,
              chainNames,
              scopeId,
            );
            const predLabels = new Set(predictive.map((p) => p.label));
            const merged = [
              ...predictive,
              ...boostedRemote.filter((r) => !predLabels.has(r.label)),
            ];
            applyHintList(merged);
          })
          .catch((err) => {
            console.warn("[Terminal] fetchDynamicHints failed:", err);
            if (pathFetchIdRef.current === myId) clearHintLoading();
          });
        return;
      }

      // 路径阶段：流式合成（先展示匹配的连招/历史，再异步拉取远程目录条目并结合最近实体置顶）
      if (result.phase === "path" && result.expectingPath) {
        const predictive = buildPredictiveHints([]);
        if (predictive.length > 0) {
          applyHintList(predictive);
        } else {
          setCmdHints([]);
          setHintVisible(false);
        }
        const pathInput = input.match(/\S*$/)?.[0] ?? "";
        pathFetchIdRef.current += 1;
        const myId = pathFetchIdRef.current;
        scheduleHintLoading(myId);
        const pathFilterMode = result.pathFilterMode ?? "all";
        const containerMode = result.commandChain[0]?.cmd === "docker";
        matchRemotePath(
          serverId,
          pathInput,
          20,
          cwd || undefined,
          pathFilterMode,
          containerMode,
        )
          .then((remoteItems) => {
            if (isUnmountedRef.current) return;
            if (pathFetchIdRef.current !== myId) return;
            clearHintLoading();
            const boostedRemote = boostHintsWithRecentEntities(
              remoteItems,
              chainNames,
              scopeId,
            );
            const predLabels = new Set(predictive.map((p) => p.label));
            const merged = [
              ...predictive,
              ...boostedRemote.filter((r) => !predLabels.has(r.label)),
            ];
            applyHintList(merged);
          })
          .catch((err) => {
            console.warn("[Terminal] matchRemotePath failed:", err);
            if (pathFetchIdRef.current === myId) clearHintLoading();
          });
        return;
      }

      // 非路径/非动态阶段：自增版本号，使之前 pending 的异步请求失效
      pathFetchIdRef.current += 1;

      // 融合预测层（报错修复 + 马尔可夫连招 + 上下文历史）与静态命令/子命令/参数层
      const predictive = buildPredictiveHints(result.items);
      const predLabels = new Set(predictive.map((p) => p.label));
      const items = [
        ...predictive,
        ...result.items.filter((item) => !predLabels.has(item.label)),
      ];

      applyHintList(items);
    },
    [clearHintLoading, ensureAliasesLoaded, scheduleHintLoading, serverId],
  );

  // 提示面板关闭后恢复终端焦点（React 卸载面板 DOM 后执行）
  const prevHintVisibleRef = useRef(hintVisible);
  useEffect(() => {
    if (prevHintVisibleRef.current && !hintVisible) {
      const raf = requestAnimationFrame(() => {
        if (showSearchRef.current && document.activeElement?.closest?.(".terminal-search-bar, [data-terminal-search]")) {
          return;
        }
        if (isInteractiveOrInputElement(document.activeElement)) return;
        const active = xtermInstances.current.get(activeTermId || "");
        if (active) active.term.focus();
      });
      prevHintVisibleRef.current = hintVisible;
      return () => cancelAnimationFrame(raf);
    }
    prevHintVisibleRef.current = hintVisible;
  }, [hintVisible, activeTermId]);

  // 提示面板位置缓存：当面板从关闭→打开或候选项更新时计算位置，
  // 杜绝固定 280px 导致向上弹出时与输入行悬空 100px+ 的问题
  const [hintPanelStyle, setHintPanelStyle] = useState<React.CSSProperties>({
    left: 8,
    top: 8,
  });
  useEffect(() => {
    if (!hintVisible || cmdHints.length === 0) return;
    // 面板打开或内容更新时计算一次位置（下一帧确保 DOM 已渲染）
    const raf = requestAnimationFrame(() => {
      // 内联 getActiveTerm 逻辑，避免引用未初始化的 useCallback
      const termInst = activeTermId
        ? xtermInstances.current.get(activeTermId)
        : undefined;
      const term = termInst?.term || null;
      const container = terminalContainerRef.current;
      if (!term || !container) return;
      try {
        const buf = term.buffer.active;
        const cursorX = buf.cursorX ?? 0;
        const cursorY = buf.cursorY ?? 0;
        const screenEl = container.querySelector(
          ".xterm-screen",
        ) as HTMLElement | null;
        const screenRect = screenEl?.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const screenOffsetTop = screenRect
          ? screenRect.top - containerRect.top
          : 0;
        const screenOffsetLeft = screenRect
          ? screenRect.left - containerRect.left
          : 0;
        const screenH = screenEl?.clientHeight ?? container.clientHeight;
        const screenW = screenEl?.clientWidth ?? container.clientWidth;
        const cellHeight = screenH / Math.max(1, term.rows);
        const cellWidth = screenW / Math.max(1, term.cols);
        const containerW = container.clientWidth;
        const containerH = container.clientHeight;
        const cursorBottomY = screenOffsetTop + (cursorY + 1) * cellHeight;
        const cursorTopY = screenOffsetTop + cursorY * cellHeight;
        const panelW = 360;
        // 判断放在上方还是下方：若下方空间足以容纳 180px 或者光标在上半区，则放下方；否则紧贴光标上方
        const placeBelow =
          cursorBottomY + 180 <= containerH ||
          cursorBottomY < containerH / 2;

        setHintPanelStyle({
          left: Math.max(
            8,
            Math.min(
              screenOffsetLeft + cursorX * cellWidth,
              containerW - panelW - 8,
            ),
          ),
          ...(placeBelow
            ? {
                top: Math.round(cursorBottomY + 4),
                bottom: "auto",
              }
            : {
                bottom: Math.round(Math.max(4, containerH - cursorTopY + 4)),
                top: "auto",
              }),
          maxHeight: placeBelow
            ? Math.min(240, Math.max(60, containerH - cursorBottomY - 12))
            : Math.min(240, Math.max(60, cursorTopY - 12)),
        });
      } catch {
        /* 降级用默认位置 */
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [hintVisible, activeTermId, cmdHints]);

  // 当活跃终端切换或者组件挂载完毕后，自动给活跃终端上焦点
  useEffect(() => {
    if (activeTermId) {
      // 延迟一帧，确保容器渲染完毕并完成挂载
      const raf = requestAnimationFrame(() => {
        const active = xtermInstances.current.get(activeTermId);
        if (active && active.term) {
          active.term.focus();
        }
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [activeTermId]);

  // 切换活跃终端时清空指令提示状态，避免跨终端状态污染（B3 简化方案）
  useEffect(() => {
    pathFetchIdRef.current += 1;
    clearHintLoading();
    currentInputRef.current = "";
    setCmdHints([]);
    setHintIndex(0);
    setHintVisible(false);
  }, [activeTermId, clearHintLoading]);

  // 监听字体大小变化，动态调整所有终端实例的字号并 resize 后端 PTY
  useEffect(() => {
    xtermInstances.current.forEach(({ term, fitAddon, sessionId }) => {
      if (term.options.fontSize !== terminalFontSize) {
        term.options.fontSize = terminalFontSize;
        try {
          fitTerminalSafely(fitAddon, term);
          if (sessionId) {
            sshService.resizeShell(sessionId, term.cols, term.rows);
          }
        } catch (e) {
          console.warn("[Terminal] Fit failed on font size change:", e);
        }
      }
    });
  }, [terminalFontSize]);

  // E6：字号快捷键Ctrl+= 放大、Ctrl+- 缩小、Ctrl+0 重置为默认 13px
  useEffect(() => {
    const DEFAULT_FONT_SIZE = 13;
    const handler = (e: KeyboardEvent) => {
      // 终端模块非活跃时不响应（避免在文件管理器等其他模块中错误触发）
      if (!isActiveRef.current) return;
      // 仅在按下 Ctrl（Mac 上也支持 Cmd）时触发，且不与 Shift/Alt 组合
      const hasModifier =
        e.ctrlKey || (navigator.userAgent.includes("Mac") && e.metaKey);
      if (!hasModifier || e.shiftKey || e.altKey) return;
      const key = e.key;
      if (key === "=" || key === "+") {
        e.preventDefault();
        setTerminalFontSize((prev: number) => prev + 1);
      } else if (key === "-" || key === "_") {
        e.preventDefault();
        setTerminalFontSize((prev: number) => prev - 1);
      } else if (key === "0") {
        e.preventDefault();
        setTerminalFontSize(DEFAULT_FONT_SIZE);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setTerminalFontSize]);

  // Ctrl+Shift+H 切换指令提示开关（H = Hint）
  // 使用 ref 读取最新 toast 状态，避免 effect 频繁重建
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 终端模块非活跃时不响应（避免在文件管理器等其他模块中错误触发）
      if (!isActiveRef.current) return;
      const hasModifier =
        e.ctrlKey || (navigator.userAgent.includes("Mac") && e.metaKey);
      if (!hasModifier || !e.shiftKey || e.altKey) return;
      if (e.key === "H" || e.key === "h") {
        e.preventDefault();
        const next = !terminalHintEnabledRef.current;
        setTerminalHintEnabled(next);
        terminalHintEnabledRef.current = next;
        // 关闭时立即清空提示；开启时不主动弹出（等用户输入触发）
        if (!next) {
          pathFetchIdRef.current += 1;
          clearHintLoading();
          setCmdHints([]);
          setHintVisible(false);
        }
        if (next) {
          toastRef.current?.success(t("term_hint_enabled_toast_on"));
        } else {
          toastRef.current?.info(t("term_hint_enabled_toast_off"));
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setTerminalHintEnabled, t]);

  // 监听字体类型变化，动态调整所有终端实例的字体并 resize 后端 PTY
  useEffect(() => {
    let cancelled = false;
    const updateFonts = async () => {
      try {
        if (document.fonts && typeof document.fonts.load === "function") {
          // 提取首个字体族名（逗号分隔的 fallback 列表中的第一个），避免 fonts.load 解析失败
          const primaryFont = terminalFontFamily
            .split(",")[0]
            .trim()
            .replace(/["']/g, "");
          await document.fonts.load(`12px "${primaryFont}"`);
        }
      } catch (e) {
        console.warn("[Terminal] Font load check failed:", e);
      }

      // 字体加载完成后检查组件是否已卸载或 effect 已被清理
      if (cancelled || isUnmountedRef.current) return;

      xtermInstances.current.forEach(({ term, fitAddon, sessionId }) => {
        if (term.options.fontFamily !== terminalFontFamily) {
          term.options.fontFamily = terminalFontFamily;
          // 强制 xterm.js 重新测量字符尺寸。
          // 注意：xterm.js 6.x 的 ICharSizeService 接口只有 measure()，没有 clear()。
          // 之前用 clear() 是 no-op，导致字符宽度测量错误后不重新测量，
          // selection 起点会偏移到 col 1，第一个字符选中后视觉不高亮且 getSelection() 丢失。
          // measure() 在尺寸变化时触发 onCharSizeChange → handleCharSizeChanged → 渲染器重建尺寸。
          try {
            interface XtermCore {
              _charSizeService?: { measure?: () => void };
              _renderService?: { clear?: () => void };
            }
            const core = (term as unknown as { _core?: XtermCore })._core;
            if (
              core &&
              core._charSizeService &&
              typeof core._charSizeService.measure === "function"
            ) {
              core._charSizeService.measure();
            }
            if (
              core &&
              core._renderService &&
              typeof core._renderService.clear === "function"
            ) {
              core._renderService.clear();
            }
          } catch {
            // ignore
          }

          try {
            fitTerminalSafely(fitAddon, term);
            if (sessionId) {
              sshService.resizeShell(sessionId, term.cols, term.rows);
            }
          } catch (e) {
            console.warn("[Terminal] Fit failed on font family change:", e);
          }
        }
      });
    };

    updateFonts();
    return () => {
      cancelled = true;
    };
  }, [terminalFontFamily]);

  // 监听主题变化，动态更新终端的颜色主题样式
  useEffect(() => {
    const xtermTheme = themeToXtermTheme(activeTheme);
    const refreshes: Array<() => void> = [];
    xtermInstances.current.forEach(({ term }) => {
      term.options.minimumContrastRatio = 1;
      term.options.theme = xtermTheme;
      // WebGL renderer 会缓存包含颜色信息的字形纹理。只修改 theme 时，已有字形
      // （尤其是当前选区）可能继续沿用旧前景色，看起来像 selectionForeground
      // 没有生效。清理纹理后再刷新，确保 Canvas 与 WebGL 渲染路径表现一致。
      try {
        term.clearTextureAtlas();
      } catch {
        // 终端尚未挂载渲染器或正在销毁时无需处理
      }
      terminalWebglManager.clearAllTextureAtlases();
      // xterm 通常会在 options.theme setter 中触发重绘，但在隐藏标签、
      // WebGL context 切换或主题覆盖层变化时不一定立即刷新。显式刷新
      // 可以保证所有服务器/分屏实例在切换主题后显示一致，不影响会话。
      refreshes.push(() => {
        try {
          if (term.rows > 0) term.refresh(0, term.rows - 1);
        } catch {
          // 终端正在销毁时忽略刷新异常
        }
      });
    });
    if (refreshes.length > 0) {
      const frame = requestAnimationFrame(() =>
        refreshes.forEach((refresh) => refresh()),
      );
      return () => cancelAnimationFrame(frame);
    }
  }, [activeTheme]);

  // 背景媒体模式切换：把背景图/视频直接渲染到 .xterm 元素自身，
  // 彻底消除外部背景图层与 canvas 区域不完全重合导致的 1-2mm 边缘留白。
  //
  // 实现方式：
  // - 图片：通过 CSS 变量 --xterm-bg-image 设置到 .xterm 元素，由 CSS 规则渲染为 background-image
  //         有模糊时改用 ::before 伪元素承载（避免 filter:blur 模糊文字）
  // - 视频：动态创建 <video> 元素插入 .xterm 内部首位（z-index:0，位于 canvas 下方）
  //         每次 src 变化时重建 video 元素，确保切换流畅
  // - 内部层透明：.xterm-viewport/.xterm-screen 等被 CSS 强制 background:transparent
  // - canvas 半透明：themeToXtermTheme 在有背景时把 background 降为 rgba(α≤0.95)
  const bgImage = activeTheme.background?.image;
  const bgVideoPath = activeTheme.background?.videoPath;
  const hasBgMedia = !!(bgImage || bgVideoPath);
  const bgSizeMode = activeTheme.background?.size;
  const bgBlur = activeTheme.background?.blur;
  // 压暗色：由 .xterm 自身 background-color 承载，覆盖整个区域（含 canvas 未覆盖的底部）。
  // canvas 完全透明只画文字，避免 canvas 区域与非 canvas 区域色差。
  const bgOverlay = getTerminalBgOverlay(activeTheme);
  useEffect(() => {
    termContainerRefs.current.forEach((container) => {
      if (!container) return;
      // .xterm 可能在 term.open 之前还未创建，但 .term-host 的背景变量
      // 不依赖 .xterm，必须先设置（否则 term.open 前容器无背景）。
      // .xterm 的 has-bg-image class 仅用于让内部层透明，可延迟到 .xterm 存在后再加。
      const xtermEl = container.querySelector(".xterm") as HTMLElement | null;

      // 旧的动态 video 元素（video 插入在父容器 container 内）。
      // 注意：不在此处无条件 remove——本 effect 因 terminals/activeTermId 变化高频重跑，
      // 无条件 remove+新建会让视频从头重启（闪烁），改为按 src 是否变化幂等重建（见下方）
      const oldVideo = container.querySelector<HTMLVideoElement>(".xterm-bg-video");

      if (hasBgMedia) {
        // 背景图与压暗色设在父容器（.term-host，即 container 自身），
        // .xterm 透明叠加其上，canvas 完全透明只画文字——避免 canvas 与
        // 容器尺寸不一致时的边缘留白/色差。
        container.classList.add("has-bg-image");
        if (xtermEl) xtermEl.classList.add("has-bg-image");
        // 设置背景尺寸和模糊参数
        container.style.setProperty(
          "--xterm-bg-size",
          bgSizeMode === "contain"
            ? "contain"
            : bgSizeMode === "center"
              ? "auto"
              : "cover",
        );
        const blurValue = bgBlur && bgBlur > 0 ? `${bgBlur}px` : "0px";
        container.style.setProperty("--xterm-bg-blur", blurValue);
        // 压暗色：由 .term-host::after 承载，覆盖整个区域
        container.style.setProperty("--xterm-bg-overlay", bgOverlay);
        // data-bg-blur 属性用于 CSS 选择器判断是否启用 ::before 模糊层
        if (bgBlur && bgBlur > 0) {
          container.setAttribute("data-bg-blur", "1");
        } else {
          container.removeAttribute("data-bg-blur");
        }

        if (bgImage) {
          // 图片背景：设置 CSS 变量，CSS 规则会渲染为 .term-host 的 background-image
          if (oldVideo) oldVideo.remove();
          container.style.setProperty("--xterm-bg-image", `url("${bgImage}")`);
        } else if (bgVideoPath) {
          // 视频背景：清空图片背景变量，动态创建 video 元素插入父容器首位
          container.style.setProperty("--xterm-bg-image", "none");
          const videoSrc = getVideoSrc(bgVideoPath);
          if (videoSrc) {
            // 幂等重建：同 src 的 video 已存在则保留（remove+新建会重启播放、闪烁），
            // 仅同步可变样式（object-fit/模糊）；src 变化或首次创建才新建元素
            if (
              oldVideo &&
              oldVideo.getAttribute("src") === videoSrc
            ) {
              oldVideo.style.objectFit =
                bgSizeMode === "contain"
                  ? "contain"
                  : bgSizeMode === "center"
                    ? "none"
                    : "cover";
              if (bgBlur && bgBlur > 0) {
                oldVideo.style.filter = `blur(${bgBlur}px)`;
                oldVideo.style.margin = `-${bgBlur}px`;
              } else {
                oldVideo.style.filter = "";
                oldVideo.style.margin = "";
              }
            } else {
              if (oldVideo) oldVideo.remove();
              const video = document.createElement("video");
              video.className = "xterm-bg-video";
              video.src = videoSrc;
              video.muted = true;
              video.autoplay = true;
              video.loop = true;
              video.playsInline = true;
              // 根据尺寸模式设置 object-fit
              video.style.objectFit =
                bgSizeMode === "contain"
                  ? "contain"
                  : bgSizeMode === "center"
                    ? "none"
                    : "cover";
              // 模糊滤镜
              if (bgBlur && bgBlur > 0) {
                video.style.filter = `blur(${bgBlur}px)`;
                video.style.margin = `-${bgBlur}px`;
              }
              // 插入到父容器内部首位，位于 .xterm 下方
              container.insertBefore(video, container.firstChild);
            }
          } else if (oldVideo) {
            // videoSrc 无效：清理残留 video
            oldVideo.remove();
          }
        }
      } else {
        if (oldVideo) oldVideo.remove();
        container.classList.remove("has-bg-image");
        if (xtermEl) xtermEl.classList.remove("has-bg-image");
        container.removeAttribute("data-bg-blur");
        container.style.removeProperty("--xterm-bg-image");
        container.style.removeProperty("--xterm-bg-size");
        container.style.removeProperty("--xterm-bg-blur");
        container.style.removeProperty("--xterm-bg-overlay");
      }
    });
  }, [
    hasBgMedia,
    terminals,
    activeTermId,
    bgImage,
    bgVideoPath,
    bgSizeMode,
    bgBlur,
    bgOverlay,
  ]);

  // term.open() 在终端初始化 effect 中异步执行，背景 effect 可能先于
  // .xterm DOM 创建完成。多终端/分屏时这个时序更容易出现，导致 host
  // 有背景但 xterm 内层仍保留不透明底色。监听子节点创建，补齐透明类，
  // 不重建 video，避免 MutationObserver 与视频插入互相触发。
  useEffect(() => {
    const syncXtermBackgroundClass = () => {
      termContainerRefs.current.forEach((container) => {
        const xtermEl = container.querySelector(".xterm") as HTMLElement | null;
        if (!xtermEl) return;
        if (hasBgMedia) {
          xtermEl.classList.add("has-bg-image");
        } else {
          xtermEl.classList.remove("has-bg-image");
        }
      });
    };

    syncXtermBackgroundClass();
    const root = terminalContainerRef.current;
    if (!root) return;
    let frame: number | null = null;
    const observer = new MutationObserver((records) => {
      if (!records.some((record) => record.type === "childList")) return;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        syncXtermBackgroundClass();
      });
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [hasBgMedia, terminals, activeTermId]);

  // 标签切换后，xterm 可能在隐藏期间重建 viewport/screen。重新应用主题
  // 和背景透明层，并在下一帧刷新当前实例，避免切回终端后背景被 canvas 遮住。
  useEffect(() => {
    if (!activeTermId) return;
    const instance = xtermInstances.current.get(activeTermId);
    const container = termContainerRefs.current.get(activeTermId);
    if (!instance || !container) return;
    const xtermEl = container.querySelector(".xterm") as HTMLElement | null;
    if (hasBgMedia) {
      container.classList.add("has-bg-image");
      xtermEl?.classList.add("has-bg-image");
    } else {
      container.classList.remove("has-bg-image");
      xtermEl?.classList.remove("has-bg-image");
    }
    instance.term.options.theme = themeToXtermTheme(activeTheme);
    try {
      instance.term.clearTextureAtlas();
    } catch {
      // 终端尚未挂载渲染器或正在销毁时无需处理
    }
    const frame = requestAnimationFrame(() => {
      try {
        fitTerminalSafely(instance.fitAddon, instance.term);
        if (instance.term.rows > 0)
          instance.term.refresh(0, instance.term.rows - 1);
        if (showSearchRef.current && document.activeElement?.closest?.(".terminal-search-bar, [data-terminal-search]")) return;
        if (isInteractiveOrInputElement(document.activeElement)) return;
        instance.term.focus();
      } catch {
        // 终端正在关闭时忽略刷新异常
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [activeTermId, activeTheme, hasBgMedia]);

  // 监听终端右键菜单事件
  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!container) return;

    const handler = (e: Event) => {
      if (selectionTimerRef.current !== null) {
        clearTimeout(selectionTimerRef.current);
        selectionTimerRef.current = null;
      }
      setSelectionToolbar(null);

      const detail = (e as CustomEvent).detail;
      setCtxMenu({
        x: detail.x,
        y: detail.y,
        hasSelection: detail.hasSelection,
      });
    };
    container.addEventListener("terminal-contextmenu", handler);
    return () => container.removeEventListener("terminal-contextmenu", handler);
  }, []);

  // 点击其他地方关闭右键菜单
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    // 右键关闭：终端实例/划词工具条/终端区域已通过 preventDefault 表示「这次右键由我处理」，
    // 此时应让菜单按新坐标重新打开，而不是立刻被这个全局监听关掉（否则第二次右键看起来没反应）
    const onWindowContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as Element | null;
      if (target?.closest?.(".terminal-context-menu")) return;
      setCtxMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", onWindowContextMenu);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", onWindowContextMenu);
    };
  }, [ctxMenu]);

  // 获取当前活跃终端的 term 实例
  const getActiveTerm = useCallback((): Terminal | null => {
    if (!activeTermId) return null;
    return xtermInstances.current.get(activeTermId)?.term || null;
  }, [activeTermId]);

  /**
   * 确保活跃终端获得焦点并激活闪烁输入光标（同步 0ms + 多帧双重保险调度）
   */
  const focusActiveTerm = useCallback((force = false) => {
    if (isUnmountedRef.current) return;
    const activeEl = document.activeElement;
    // 非强制模式下，若焦点处于搜索栏内部，不得抢夺搜索栏输入框焦点
    if (!force && showSearchRef.current && activeEl?.closest?.(".terminal-search-bar, [data-terminal-search]")) {
      return;
    }

    // 处于模态弹窗或对话框内部时严禁抢夺焦点
    if (activeEl?.closest?.('[role="dialog"], [role="alertdialog"], .modal, .dialog')) {
      return;
    }
    // 非强制模式下，若焦点在其它合法表单输入控件中（且不是正在关闭的搜索栏），不得抢夺
    if (!force && isInteractiveOrInputElement(activeEl)) return;
    if (!force && (!isActiveRef.current || !isVisibleRef.current)) return;

    const targetId = activeTermIdRef.current || activeTermId;
    if (!targetId) return;
    const info = xtermInstances.current.get(targetId);
    if (!info?.term) return;

    const doFocus = () => {
      if (isUnmountedRef.current) return;
      const el = document.activeElement;
      if (!force && showSearchRef.current && el?.closest?.(".terminal-search-bar, [data-terminal-search]")) return;
      if (el?.closest?.('[role="dialog"], [role="alertdialog"], .modal, .dialog')) return;
      if (!force && isInteractiveOrInputElement(el)) return;
      if (!force && (!isActiveRef.current || !isVisibleRef.current)) return;
      try {
        info.term.focus();
        const textarea = (info.term as any).textarea || (info.term as any)._core?._textarea;
        if (textarea && document.activeElement !== textarea) {
          textarea.focus({ preventScroll: true });
        }
      } catch {
        // ignore
      }
    };

    // 1. 同步立即聚焦，实现 0ms 响应
    doFocus();

    // 2. 双帧 RAF 调度，对抗模态框卸载、CSS 动画及分屏重排的时序竞争
    requestAnimationFrame(() => {
      doFocus();
      requestAnimationFrame(() => {
        doFocus();
      });
    });
  }, [activeTermId]);

  /**
   * 从 xterm buffer 重建当前输入行内容（剥离 prompt 前缀）。
   *
   * 用于 ↑↓ 调历史、Ctrl+W 删词等无法精确追踪的场景：
   * shell 实际显示的内容（如 `docker logs -f`）可能与 currentInputRef 不一致，
   * 此时从 buffer 读取光标行真实文本，确保后续补全阶段判定正确。
   *
   * Prompt 剥离启发式：找行内最后一个 prompt 结束符位置，取其后内容。
   * 常见 prompt 结束符：`$ ` / `# ` / `> ` / `% `（后接命令文本）。
   *
   * @param term 当前终端实例
   */
  // 防抖定时器 ref：防止快速按键时多个 rebuildInputFromBuffer 并发执行竞态
  const rebuildInputFromBuffer = useCallback(
    (term: Terminal) => {
      // H2 修复：设置 pending 标记，下次用户按键时若仍未完成则补读 buffer。
      // 同时将延迟从 0ms 提高到 80ms，覆盖大多数 SSH 场景的回显延迟（LAN <1ms，跨城 10-50ms）。
      // 跨境 SSH（100-300ms）仍可能读到旧 buffer，由 needsRebuildRef 兜底补读。
      needsRebuildRef.current = true;
      // 清除上一个挂起的 rebuild，防止快速输入时多个回调并发竞争写入 currentInputRef
      if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current);
      rebuildTimerRef.current = setTimeout(() => {
        rebuildTimerRef.current = null;
        if (isUnmountedRef.current) return;
        try {
          const buf = term.buffer.active;
          const cy = buf.baseY + buf.cursorY;
          const line = buf.getLine(cy);
          if (!line) {
            needsRebuildRef.current = false;
            return;
          }
          const fullText = line.translateToString(true); // true: trim trailing whitespace
          if (!fullText) {
            currentInputRef.current = "";
            setCmdHints([]);
            setHintVisible(false);
            needsRebuildRef.current = false;
            return;
          }
          // 剥离 prompt：找最后一个 prompt 结束符（$ / # / > / % / ❯ / ➜ 后跟空格或直接结尾）的位置
          // 用 lastIndexOf 找最后一个 `$ ` / `# ` / `> ` / `% `，取其后内容
          // 这样即使 prompt 中含这些字符（如 user@host:~$ 中的 ~），也能正确定位最后一个
          let cmdText = fullText;
          const markers = ["$ ", "# ", "> ", "% ", "❯ ", "➜ ", "❯", "➜"];
          let lastIdx = -1;
          let markerLen = 0;
          for (const mk of markers) {
            const idx = fullText.lastIndexOf(mk);
            if (idx > lastIdx) {
              lastIdx = idx;
              markerLen = mk.length;
            }
          }
          if (lastIdx >= 0) {
            cmdText = fullText.slice(lastIdx + markerLen).trim();
          } else if (/[$#>%❯➜]\s*$/.test(fullText)) {
            // 整行就是纯 prompt（无命令），视为空输入
            cmdText = "";
          }
          currentInputRef.current = cmdText;
          // 调历史/删词场景，不主动弹提示（用户诉求：翻历史时提示框干扰）。
          // silent 模式仍更新 hintResultRef，Tab 补全仍可用。
          runMatchHints(cmdText, { silent: true });
          needsRebuildRef.current = false;
        } catch {
          // buffer 读取失败，保持原状
          needsRebuildRef.current = false;
        }
      }, 80);
    },
    [runMatchHints],
  );

  // 复制选中内容
  const handleCopy = useCallback(() => {
    const term = getActiveTerm();
    if (!term) return;
    const selection = term.getSelection();
    if (selection) {
      try {
        navigator.clipboard.writeText(selection);
        playSound(SoundType.Click);
      } catch {
        toastRef.current?.warning(t("tm_toast_copy_failed"));
      }
    }
    setCtxMenu(null);
    term.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getActiveTerm]);

  // AI 选中文本诊断触发

  const handleAIDiagnosisFromContext = useCallback(() => {
    const term = getActiveTerm();
    const selection = term?.getSelection();
    setCtxMenu(null);
    if (selection) {
      useAIStore.getState().openDiagnosis(selection);
    }
  }, [getActiveTerm]);

  // AI 拆解选中文本指令触发 (Explain Shell)
  const handleAIExplainShellFromContext = useCallback(() => {
    const term = getActiveTerm();
    const selection = term?.getSelection();
    setCtxMenu(null);
    if (selection) {
      useAIStore.getState().openExplainShell(selection);
    }
  }, [getActiveTerm]);

  // 粘贴安全确认阈值（字符数）。超过此值或包含换行时先确认。
  const PASTE_WARN_THRESHOLD = 10000;

  // 实际写入粘贴内容。确认流程和普通粘贴都最终走这里，避免绕过广播/输入状态同步。
  const writePasteToShells = (currentSid: string, data: string) => {
    if (!data) return;
    // 保底防线：若数据含有 Windows CRLF，统一清洗为规范换行，消除 PTY ICRNL 双换行隐患
    const cleanData = data.includes("\r\n") ? normalizeShellCommandText(data) : data;
    lastActivityTimesRef.current.set(currentSid, Date.now());
    // 串口会话不参与输入广播：字节精确的点对点通道，既不做广播源也不做广播目标
    const isSerial = server?.targetType === "serial" || server?.protocol === "serial";
    if (sshService.isSessionAlive(currentSid)) {
      // A raw file transfer must remain byte-exact. Drop interactive input while
      // it owns the port so keyboard/paste bytes cannot corrupt the file stream.
      if (isSerial && serialFileTransferActiveRef.current) return;
      const writePromise = isSerial
        ? writeSerialTextWithDelays(
            currentSid,
            cleanData,
            serialEncodingLabelRef.current,
            serialLineDelayRef.current,
            serialCharDelayRef.current,
          )
        : sshService.writeToShell(currentSid, cleanData);
      void writePromise.then(() => {
        if (isSerial && serialLocalEchoRef.current) {
          const terminal = Array.from(xtermInstances.current.values()).find(
            (instance) => instance.sessionId === currentSid,
          )?.term;
          terminal?.write(cleanData);
        }
      }).catch((error) => {
        toastRef.current.error(error instanceof Error ? error.message : String(error));
      });
    }
    if (!tabId) return;
    if (isSerial) return; // 串口源不广播
    const { broadcastTabIds, tabs, servers } = useAppStore.getState();
    if (!broadcastTabIds.includes(tabId)) return;
    for (const otherTabId of broadcastTabIds) {
      if (otherTabId === tabId) continue;
      // 串口目标跳过广播
      const otherTab = tabs.find((t) => t.id === otherTabId);
      const otherServer = otherTab ? servers.find((sv) => sv.id === otherTab.serverId) : undefined;
      if (otherServer?.targetType === "serial" || otherServer?.protocol === "serial") continue;
      const sid = sshService.getTabActiveSessionId(otherTabId);
      if (sid && sshService.isSessionAlive(sid)) {
        lastActivityTimesRef.current.set(sid, Date.now());
        void sshService.writeToShell(sid, cleanData).catch(() => {});
      }
    }
  };

  const writePasteText = useCallback(
    (text: string, sessionId: string, options?: { execute?: boolean }) => {
      if (!text) return;
      playSound(SoundType.Click);

      // 文本经 normalizeShellCommandText 清洗后，CRLF 已转为规范单 \n，且反斜杠尾随空白已剥离。
      // 保持 bracketedPaste: false 可避免触发 Bash 5.1+ Readline Active Region 灰底反显选中效果，
      // 既保证多行续行指令 100% 作为单一指令执行，又呈现出最干净的原生命令行视觉。
      const formatted = formatTerminalPasteData(text, {
        bracketedPaste: false,
        execute: options?.execute,
      });

      // 粘贴和键盘输入必须使用同一广播路由，避免粘贴时绕过广播策略。
      writePasteToShells(sessionId, formatted);
      // 问题 7 修复：快捷键/右键粘贴绕过 onData，currentInputRef 不会更新。
      // 粘贴后延迟从 buffer 重建 currentInputRef，确保后续补全/历史记录基于真实输入行。
      // 多行粘贴时 \n 会触发 shell 执行，buffer 只剩下一行的 prompt，重建结果为空——正确。
      // 单行粘贴时 buffer 显示粘贴内容 + 已有输入，重建得到完整命令——正确。
      const term = getActiveTerm();
      if (term) {
        setTimeout(() => {
          if (isUnmountedRef.current) return;
          rebuildInputFromBuffer(term);
        }, 120);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getActiveTerm, rebuildInputFromBuffer, tabId, server],
  );

  // 方案 A（智能免打扰模式）：
  // 日常多行命令（如 curl、docker run 等续行脚本）直接平滑粘贴进终端，不弹窗打扰；
  // 仅在文本超大（超过 10,000 字符）且开启保护时提示确认，防止卡死终端。
  const pasteTextToShell = useCallback(
    (text: string, sessionId: string) => {
      if (!text) return;
      const normalized = normalizeShellCommandText(text);
      if (terminalPasteWarnEnabled && normalized.length > PASTE_WARN_THRESHOLD) {
        setPendingPaste({ text: normalized, sessionId });
        return;
      }
      writePasteText(normalized, sessionId);
    },
    [writePasteText, terminalPasteWarnEnabled],
  );

  // 统一的广播入口：向当前 session 写入数据，并在当前 tab 开启广播时
  // 转发到其他开启广播的 tab 的所有 session。
  // 供 onData / Tab 补全 / 提示项点击 / 粘贴等场景复用，确保广播行为一致。
  const broadcastToShells = useCallback(
    (currentSid: string, data: string) => {
      writePasteToShells(currentSid, data);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabId],
  );

  // 标准 POSIX 终端中断控制（Ctrl+C / SIGINT）：
  // 遵循行业标准行为（对标 VS Code / Xshell / Windows Terminal）：
  // 1. 立即清空当前终端的前端待渲染队列（消除任何未消费的排队延迟）
  // 2. 解除高水位暂停状态并通知后端
  // 3. 向后端/远程发送 \x03 (SIGINT)，触发远端 POSIX TTY 驱动排空并杀死正在运行的命令
  const handleSigint = useCallback(
    (targetTermId?: string) => {
      const tid = targetTermId || activeTermId;
      if (!tid) return;
      const inst = xtermInstances.current.get(tid);
      const sid = inst?.sessionId;
      const term = inst?.term;

      // 1. 立即清空前端待渲染积压队列（消除任何排队延迟）
      outputWriteQueuesRef.current.delete(tid);
      outputWriteInFlightRef.current.delete(tid);
      xtermPendingCharsRef.current.delete(tid);
      // xterm.js 的 WriteBuffer 没有公开取消 API。远端已经收到 SIGINT 后，
      // 尚未解析的旧日志如果继续排队，会把新 prompt 延迟数秒才显示。
      if (term) {
        discardPendingXtermWrites(term);
      }
      if (sid) {
        // 开启 1000ms 快速排空窗口：丢弃旧在途日志，同时严禁 pauseShell 暂停 SSH 读取
        sigintActiveUntilRef.current.set(sid, Date.now() + 1000);
        sigintDroppedCharsRef.current.set(sid, 0);
      }
      if (sid && pausedShellsRef.current.get(sid)) {
        pausedShellsRef.current.delete(sid);
        sshService.resumeShell(sid);
      }

      // 2. 通过专用快速通道向后端/远程发送 \x03 (SIGINT)。
      // 普通 writeToShell 与高频日志共用有界队列，可能把 Ctrl+C 排到几十秒之后；
      // interruptShell 在后端绕过该队列，直接唤醒 reader 写入 PTY。
      if (sid) {
        void sshService
          .interruptShell(sid)
          .then((sequence) => {
            if (!Number.isFinite(sequence)) return;
            const previous = discardedShellOutputThroughRef.current.get(sid) ?? 0;
            if (sequence > previous) {
              discardedShellOutputThroughRef.current.set(sid, sequence);
            }
          })
          .catch((error) => {
            console.warn("[Terminal] Ctrl+C failed:", error);
          });
        if (tabId) {
          const { broadcastTabIds, tabs, servers } = useAppStore.getState();
          for (const otherTabId of broadcastTabIds) {
            if (otherTabId === tabId) continue;
            // 串口目标不支持 SIGINT，跳过
            const otherTab = tabs.find((t) => t.id === otherTabId);
            const otherServer = otherTab ? servers.find((sv) => sv.id === otherTab.serverId) : undefined;
            if (otherServer?.targetType === "serial" || otherServer?.protocol === "serial") continue;
            const otherSid = sshService.getTabActiveSessionId(otherTabId);
            if (otherSid && sshService.isSessionAlive(otherSid)) {
              sigintActiveUntilRef.current.set(otherSid, Date.now() + 1000);
              sigintDroppedCharsRef.current.set(otherSid, 0);
              void sshService
                .interruptShell(otherSid)
                .then((sequence) => {
                  if (!Number.isFinite(sequence)) return;
                  const previous =
                    discardedShellOutputThroughRef.current.get(otherSid) ?? 0;
                  if (sequence > previous) {
                    discardedShellOutputThroughRef.current.set(otherSid, sequence);
                  }
                })
                .catch(() => {});
            }
          }
        }
      }

      // 3. 中断后立即重置视口状态，回到底部并清除未读新输出角标
      if (term) {
        term.scrollToBottom();
      }
      userScrolledUpRef.current.set(tid, false);
      if (pendingOutputCountsRef.current.delete(tid)) {
        setPendingOutputCounts(new Map(pendingOutputCountsRef.current));
      }

      // 4. 清理输入和提示
      pathFetchIdRef.current += 1;
      clearHintLoading();
      currentInputRef.current = "";
      setCmdHints([]);
      setHintVisible(false);

      // 5. 聚焦终端
      term?.focus();
    },
    [activeTermId, clearHintLoading, tabId],
  );

  // 在 window 冒泡阶段再兜底一次。xterm 的 custom key handler 通常足够；
  // 使用冒泡而不是捕获，确保同一按键不会同时触发 xterm handler 和 window
  // handler，避免一次 Ctrl+C 发送两次 SIGINT。只有 xterm 没接住按键时，
  // window 监听才会接管。
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (!isActiveRef.current || event.altKey || event.shiftKey) return;
      const isMac = navigator.userAgent.includes("Mac");
      if (isMac ? (!event.ctrlKey || event.metaKey) : !event.ctrlKey) return;
      if (event.key?.toLowerCase() !== "c") return;

      // 关键防护 1：检查是否有非终端内部的文本选区（例如用户在 AI 助手、侧边栏、弹窗中划选了文字）
      // 若存在外部选区，Ctrl+C 必须作为复制执行，严禁发送 SIGINT 杀死正在运行的命令！
      const winSelection = window.getSelection();
      const externalSelectedText = winSelection?.toString();
      if (externalSelectedText && externalSelectedText.length > 0) {
        const anchorNode = winSelection?.anchorNode;
        const focusNode = winSelection?.focusNode;
        const hasTermNode = Array.from(xtermInstances.current.values()).some((info) => {
          const el = info.term.element;
          return (anchorNode && el?.contains(anchorNode)) || (focusNode && el?.contains(focusNode));
        });
        if (!hasTermNode) {
          try {
            navigator.clipboard.writeText(externalSelectedText);
          } catch {
            /* ignore */
          }
          return;
        }
      }

      // 关键防护 2：若当前焦点处于非终端交互控件（如 AI 助手、搜索栏、弹窗输入框）内部，直接放行
      if (isInteractiveOrInputElement(document.activeElement)) {
        return;
      }

      const target = event.target as Node | null;
      let targetTermId: string | undefined;
      if (target) {
        for (const [termId, info] of xtermInstances.current) {
          if (info.term.element?.contains(target)) {
            targetTermId = termId;
            break;
          }
        }
      }
      // Only intercept Ctrl+C when the event originated inside an xterm
      // element. Falling back to the active terminal here steals normal copy
      // behavior from search fields, path inputs, dialogs, and other controls
      // rendered beside the terminal.
      if (!targetTermId) return;
      event.preventDefault();
      event.stopPropagation();
      handleSigint(targetTermId);
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [activeTermId, handleSigint]);

  // 快捷键 Ctrl+Alt+L (Mac: Cmd+Alt+L) 触发应用锁
  useEffect(() => {
    const onWindowLockKeyDown = (event: KeyboardEvent) => {
      if (!isActiveRef.current) return;
      const isMac = navigator.userAgent.includes("Mac");
      const key = event.key?.toLowerCase();
      const isLock =
        (event.ctrlKey && event.altKey && (key === "l" || event.code === "KeyL")) ||
        (isMac && event.metaKey && event.altKey && (key === "l" || event.code === "KeyL"));
      if (isLock) {
        event.preventDefault();
        event.stopPropagation();
        handleTriggerAppLock();
      }
    };
    window.addEventListener("keydown", onWindowLockKeyDown);
    return () => window.removeEventListener("keydown", onWindowLockKeyDown);
  }, [handleTriggerAppLock]);

  // 粘贴剪贴板内容
  const handlePaste = useCallback(async () => {
    const term = getActiveTerm();
    if (!term) return;
    const sessionId = xtermInstances.current.get(activeTermId || "")?.sessionId;
    if (!sessionId) return;
    try {
      const text = await navigator.clipboard.readText();
      if (isUnmountedRef.current) return;
      if (text) {
        pasteTextToShell(text, sessionId);
      }
    } catch {
      toastRef.current?.warning(t("tm_toast_paste_failed"));
    }
    setCtxMenu(null);
    term.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getActiveTerm, activeTermId, pasteTextToShell]);

  // 粘贴选中内容（将当前选中内容直接发送到终端）
  const handlePasteSelection = useCallback(() => {
    const term = getActiveTerm();
    if (!term) return;
    const sessionId = xtermInstances.current.get(activeTermId || "")?.sessionId;
    if (!sessionId) return;
    const selection = term.getSelection();
    if (selection) {
      pasteTextToShell(selection, sessionId);
    }
    setCtxMenu(null);
    term.focus();
  }, [getActiveTerm, activeTermId, pasteTextToShell]);

  // 获取当前活跃终端的 asyncSearcher
  const getActiveAsyncSearcher = useCallback((): AsyncTerminalSearcher | null => {
    if (!activeTermId) return null;
    return xtermInstances.current.get(activeTermId)?.asyncSearcher || null;
  }, [activeTermId]);

  // 执行搜索（采用 8ms 时间分片异步调度，杜绝 10 万行搜索冻结）
  const doSearch = useCallback(
    (text: string, direction: "next" | "prev" = "next", immediate = false) => {
      // 1. 如果存在未执行的防抖任务，先清理
      if (searchDebounceTimerRef.current) {
        clearTimeout(searchDebounceTimerRef.current);
        searchDebounceTimerRef.current = null;
      }

      const asyncSearcher = getActiveAsyncSearcher();
      if (!asyncSearcher || text.length === 0) {
        setSearchState({ resultIndex: -1, resultCount: 0, isSearching: false, isCapped: false });
        if (asyncSearcher) {
          asyncSearcher.clear();
        }
        return;
      }

      // 执行搜索的核心逻辑
      const execute = () => {
        searchDebounceTimerRef.current = null;
        if (isUnmountedRef.current) return;
        const currentSearcher = getActiveAsyncSearcher();
        if (!currentSearcher) return;

        // 正则模式合法性校验
        if (searchRegexRef.current) {
          try {
            new RegExp(text);
          } catch {
            toastRef.current.warning(t("tm_toast_invalid_regex"));
            setSearchState({ resultIndex: -1, resultCount: 0, isSearching: false, isCapped: false });
            return;
          }
        }

        currentSearcher.search(
          text,
          {
            caseSensitive: searchCaseSensitiveRef.current,
            wholeWord: searchWholeWordRef.current,
            regex: searchRegexRef.current,
            decorations: true,
          },
          direction,
        );
      };

      if (immediate) {
        execute();
      } else {
        // 用户敲键盘输入时，防抖 200ms
        searchDebounceTimerRef.current = setTimeout(execute, 200);
      }
    },
    // 故意省略依赖：getActiveAsyncSearcher 等通过 ref 读取最新值，避免把不稳定回调列入 deps 引发重订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getActiveAsyncSearcher, t],
  );

  // 关闭搜索栏
  const closeSearch = useCallback(() => {
    if (searchDebounceTimerRef.current) {
      clearTimeout(searchDebounceTimerRef.current);
      searchDebounceTimerRef.current = null;
    }
    showSearchRef.current = false;
    setShowSearch(false);
    setSearchText("");
    setSearchState({ resultIndex: -1, resultCount: 0, isSearching: false, isCapped: false });
    playSound(SoundType.Close);
    const asyncSearcher = getActiveAsyncSearcher();
    if (asyncSearcher) {
      asyncSearcher.clear();
    }
    focusActiveTerm(true);
    requestAnimationFrame(() => {
      focusActiveTerm(true);
      requestAnimationFrame(() => {
        focusActiveTerm(true);
      });
    });
  }, [getActiveAsyncSearcher, focusActiveTerm]);

  // 查找下一个匹配项（参考 VS Code 标准行为：Enter / F3）
  const handleFindNext = useCallback(() => {
    const text = searchTextRef.current;
    const searcher = getActiveAsyncSearcher();
    if (
      searcher &&
      searcher.currentTerm === text &&
      searcher.matchCount > 0
    ) {
      searcher.findNext();
      setSearchState((s) => ({
        ...s,
        resultIndex: searcher.activeIndex,
        resultCount: searcher.matchCount,
      }));
    } else if (text) {
      doSearch(text, "next", true);
    }
  }, [getActiveAsyncSearcher, searchTextRef, doSearch]);

  // 查找上一个匹配项（参考 VS Code 标准行为：Shift+Enter / Shift+F3）
  const handleFindPrev = useCallback(() => {
    const text = searchTextRef.current;
    const searcher = getActiveAsyncSearcher();
    if (
      searcher &&
      searcher.currentTerm === text &&
      searcher.matchCount > 0
    ) {
      searcher.findPrevious();
      setSearchState((s) => ({
        ...s,
        resultIndex: searcher.activeIndex,
        resultCount: searcher.matchCount,
      }));
    } else if (text) {
      doSearch(text, "prev", true);
    }
  }, [getActiveAsyncSearcher, searchTextRef, doSearch]);

  const handleFindNextRef = useLatestRef(handleFindNext);
  const handleFindPrevRef = useLatestRef(handleFindPrev);

  // 搜索功能（打开搜索面板或预填选中文字）
  const handleSearch = useCallback(() => {
    showSearchRef.current = true;
    const term = getActiveTerm();
    const selection = term?.getSelection() || "";
    setCtxMenu(null);
    setShowSearch(true);
    playSound(SoundType.Open);
    setSearchState({ resultIndex: -1, resultCount: 0, isSearching: false, isCapped: false });
    if (selection) {
      setSearchText(selection);
      setTimeout(() => {
        if (isUnmountedRef.current) return;
        doSearch(selection, "next", true);
      }, 50);
    } else {
      setSearchText("");
    }
    const focusSearchInput = () => {
      if (isUnmountedRef.current) return;
      const searchInput = document.querySelector<HTMLInputElement>(
        ".terminal-search-bar input",
      );
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    };
    focusSearchInput();
    requestAnimationFrame(focusSearchInput);
    setTimeout(focusSearchInput, 30);
    setTimeout(focusSearchInput, 100);
    setTimeout(focusSearchInput, 250);
  }, [getActiveTerm, doSearch]);

  // 切换搜索面板开关（已打开则关闭，未打开则调用 handleSearch 打开并预填当前选区）
  const toggleSearch = useCallback(() => {
    if (!showSearch) {
      handleSearch();
    } else {
      closeSearch();
    }
  }, [showSearch, handleSearch, closeSearch]);

  // 将 toggleSearch 注册给外层（供 ModuleTabs 上的搜索按钮调用）
  useEffect(() => {
    registerSearchTrigger?.(toggleSearch);
    return () => registerSearchTrigger?.(null);
  }, [toggleSearch, registerSearchTrigger]);

  // 切换活动终端时，同步对应终端的检索状态
  useEffect(() => {
    if (!activeTermId) return;
    const searcher = xtermInstances.current.get(activeTermId)?.asyncSearcher;
    if (searcher && searcher.currentTerm) {
      setSearchState((s) => ({
        ...s,
        resultIndex: searcher.activeIndex,
        resultCount: searcher.matchCount,
      }));
    } else if (showSearchRef.current && searchText) {
      doSearch(searchText, "next", true);
    } else {
      setSearchState((s) => ({ ...s, resultIndex: -1, resultCount: 0 }));
    }
  }, [activeTermId, doSearch, searchText]);

  // 输出写入时遵循终端常规行为：停留在底部则跟随新日志；用户已上滚
  // 查阅历史时保持当前位置。输出仍持续进入 xterm 的 scrollback。
  // 核心调度冲刷循环：从块队列消费数据并以自适应预算（64KB ~ 512KB）写入 xterm
  const flushTerminalOutputQueues = useCallback(() => {
    outputWriteFrameRef.current = null;
    if (isUnmountedRef.current) {
      outputWriteQueuesRef.current.clear();
      return;
    }
    const entries = Array.from(outputWriteQueuesRef.current.entries());

    for (const [queuedTermId, item] of entries) {
      if (!item.chunks || item.chunks.length === 0 || item.totalChars <= 0) {
        outputWriteQueuesRef.current.delete(queuedTermId);
        continue;
      }
      if (outputWriteInFlightRef.current.has(queuedTermId)) continue;

      // 弹性单帧预算：积压严重或未上滚时单帧放大（MAX_OUTPUT_BYTES_PER_FRAME_FLOOD），以极速冲刷排空，杜绝内存中形成“堰塞湖”
      const isFlooding = item.totalChars > FLOOD_THRESHOLD_CHARS || !item.wasScrolledUp;
      const frameBudget = isFlooding
        ? MAX_OUTPUT_BYTES_PER_FRAME_FLOOD
        : MAX_OUTPUT_BYTES_PER_FRAME_DEFAULT;

      const frameChunks: string[] = [];
      let frameChars = 0;

      while (item.chunks.length > 0 && frameChars < frameBudget) {
        const nextChunk = item.chunks[0];
        const remainingBudget = frameBudget - frameChars;

        if (nextChunk.length <= remainingBudget) {
          item.chunks.shift();
          frameChunks.push(nextChunk);
          frameChars += nextChunk.length;
        } else {
          // 当前 chunk 大于剩余预算，仅对该单个 chunk 做安全边界截断，无需对整个历史进行大切片
          let head = sliceCodePointSafe(nextChunk, remainingBudget);
          if (!head && nextChunk.length > 0 && frameChars === 0) {
            // 防御保护：若极端边界下单字代理项切片为空且尚未消费任何字符，强制消费该字符保证向前推进
            head = nextChunk.slice(0, Math.min(2, nextChunk.length));
          }
          const tail = nextChunk.slice(head.length);
          frameChunks.push(head);
          frameChars += head.length;
          if (tail) {
            item.chunks[0] = tail;
          } else {
            item.chunks.shift();
          }
          break;
        }
      }

      item.totalChars = Math.max(0, item.totalChars - frameChars);

      // 低水位背压解除（对齐 VS Code / RFC 4254 标准）：
      // 当待渲染积压降至 LOW_WATERMARK 以下时，通知后端恢复读取
      const inst = xtermInstances.current.get(queuedTermId);
      const sid = inst?.sessionId;
      if (sid && item.totalChars <= LOW_WATERMARK_CHARS) {
        if (pausedShellsRef.current.get(sid)) {
          pausedShellsRef.current.delete(sid);
          sshService.resumeShell(sid);
        }
      }

      if (item.chunks.length === 0) {
        outputWriteQueuesRef.current.delete(queuedTermId);
        if (sid && pausedShellsRef.current.get(sid)) {
          pausedShellsRef.current.delete(sid);
          sshService.resumeShell(sid);
        }
      }

      const frameRaw = frameChunks.join("");
      if (!frameRaw) continue;

      // 洪峰期高亮节流：海量日志倾泻（人眼无法阅读）时跳过昂贵正则，大幅削减 CPU 占用与短命字符串产生
      const isHighThroughput = item.totalChars > 64 * 1024 || isFlooding;
      const frameData =
        item.needsHighlight === false || isHighThroughput
          ? frameRaw
          : highlightKeywords(
              frameRaw,
              highlightEnabledRef.current,
              highlightRulesRef.current,
            );

      const capturedWasScrolledUp = item.wasScrolledUp;
      const writeToken = (outputWriteTokenRef.current.get(queuedTermId) ?? 0) + 1;
      outputWriteTokenRef.current.set(queuedTermId, writeToken);
      outputWriteInFlightRef.current.add(queuedTermId);
      const isWriteCancelled = () =>
        isUnmountedRef.current ||
        !outputWriteInFlightRef.current.has(queuedTermId) ||
        outputWriteTokenRef.current.get(queuedTermId) !== writeToken;

      // 写入完成后的收尾逻辑（未读计数 + 调度下一帧冲刷）
      const finalizeWrite = () => {
        if (isWriteCancelled()) return;
        outputWriteInFlightRef.current.delete(queuedTermId);
        if (capturedWasScrolledUp) {
          // 终端可能在异步写入期间已被用户滚到底部，此时无需记数
          if (item.term.buffer.active.viewportY < item.term.buffer.active.baseY) {
            const current = pendingOutputCountsRef.current.get(queuedTermId) ?? 0;
            const newLines = Math.max(1, countNewlines(frameRaw));
            // HIGH-2：高频输出帧中不再每次都拷贝整张 Map。直接原地更新 ref Map，
            // 真正的 React state 副本由下方 rAF 每帧仅生成一次，既保证引用变化触发重渲染，
            // 又避免每帧双倍 Map 分配造成的 GC 压力。
            pendingOutputCountsRef.current.set(queuedTermId, current + newLines);
            if (pendingOutputFrameRef.current === null) {
              pendingOutputFrameRef.current = requestAnimationFrame(() => {
                pendingOutputFrameRef.current = null;
                setPendingOutputCounts(new Map(pendingOutputCountsRef.current));
              });
            }
          }
        }
        if (outputWriteQueuesRef.current.has(queuedTermId) && outputWriteFrameRef.current === null) {
          outputWriteFrameRef.current = window.setTimeout(flushTerminalOutputQueues, 0);
        }
      };

      // U1 修复：大帧拆分写。单帧最高可达 1MB，一次性 term.write 会让 xterm
      // 同步解析整块并长时间占用主线程（键盘输入饥饿）。这里切成 64KB 块逐块
      // write，块间让出宏任务，使键盘事件 / rAF 能及时抢占，消除洪峰期输入延迟。
      const LARGE_FRAME_CHUNK_BYTES = 64 * 1024;
      if (frameData.length > LARGE_FRAME_CHUNK_BYTES) {
        void (async () => {
          let offset = 0;
          while (offset < frameData.length) {
            if (isWriteCancelled()) {
              return;
            }
            const chunk = frameData.slice(offset, offset + LARGE_FRAME_CHUNK_BYTES);
            offset += LARGE_FRAME_CHUNK_BYTES;
            await new Promise<void>((resolve) => item.term.write(chunk, () => resolve()));
            if (isWriteCancelled()) {
              return;
            }
            // 块间让出宏任务，让键盘事件、rAF 等及时执行
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
          finalizeWrite();
        })();
      } else {
        item.term.write(frameData, finalizeWrite);
      }
    }

    // 若队列中仍有未消费完的积压数据，调度下一帧继续冲刷直至完全排空
    if (
      outputWriteQueuesRef.current.size > 0 &&
      outputWriteFrameRef.current === null &&
      Array.from(outputWriteQueuesRef.current.keys()).some(
        (termId) => !outputWriteInFlightRef.current.has(termId),
      )
    ) {
      outputWriteFrameRef.current = window.setTimeout(flushTerminalOutputQueues, 0);
    }
  }, []);

  // 输出写入时遵循终端常规行为：停留在底部则跟随新日志；用户已上滚
  // 查阅历史时保持当前位置。输出仍持续进入 xterm 的 scrollback。
  const writeTerminalOutput = useCallback(
    (termId: string, term: Terminal, data: string, needsHighlight = true) => {
      if (!data) return;

      const buffer = term.buffer.active;
      // 核心：必须区分「用户主动向上翻看历史」与「分屏/窗口 resize 导致的被动折行计算差值」
      // 只有在用户主动上滚且视口确实不在底部时，才触发新输出计数
      const isUserScrolledUp =
        userScrolledUpRef.current.get(termId) === true &&
        buffer.viewportY < buffer.baseY;

      const existing = outputWriteQueuesRef.current.get(termId);

      // 极速直通快速通道（Fast Path）：
      // 绝大多数常规使用与日志流场景下，用户停留在底部（未上滚查看历史），
      // 此时既不需要冻结视口，也不需要计算未读行数角标。
      // 当终端处于空闲状态（无在途异步解析）时直接调用 term.write()，交互零延迟；
      // 当已有积压或上一次 write 仍在进行中时，合流至 outputWriteQueuesRef 进行微任务/帧聚合，
      // 既保障大块合并解析的峰值吞吐，又避免逐包同步调用打满主线程造成掉帧与按键饥饿。
      const pendingChars = xtermPendingCharsRef.current.get(termId) ?? 0;
      const isWriteBusy =
        outputWriteInFlightRef.current.has(termId) || pendingChars >= 64 * 1024;

      if (!isUserScrolledUp && !existing && !isWriteBusy) {
        // 高频日志块不要逐块跑用户正则高亮。Docker/程序日志通常每个事件只有几 KB，
        // 但连续执行高亮会把主线程 CPU 吃满，远端读取随之被 SSH 窗口反压；
        // 大块输出仍保留 ANSI 原色，普通短命令继续支持关键词高亮。
        const processed =
          // 日志流通常每块都带换行；逐块跑关键词正则会把主线程占满，
          // 进而拖慢 xterm 解析和 SSH 窗口消费。只给很短的单行交互输出高亮。
          needsHighlight &&
          highlightEnabledRef.current &&
          data.length <= 2 * 1024 &&
          !data.includes("\n") &&
          !data.includes("\r")
            ? highlightKeywords(data, true, highlightRulesRef.current)
            : data;
        const sid = xtermInstances.current.get(termId)?.sessionId;
        const pendingBefore = xtermPendingCharsRef.current.get(termId) ?? 0;
        const pendingAfter = pendingBefore + data.length;
        xtermPendingCharsRef.current.set(termId, pendingAfter);
        const isSigintDraining = Boolean(sid && sigintActiveUntilRef.current.has(sid));
        if (
          !isSigintDraining &&
          sid &&
          pendingAfter >= XTERM_HIGH_WATERMARK_CHARS &&
          !pausedShellsRef.current.get(sid)
        ) {
          pausedShellsRef.current.set(sid, true);
          sshService.pauseShell(sid);
        }
        term.write(processed, () => {
          const pendingNow = xtermPendingCharsRef.current.get(termId) ?? 0;
          const pendingRemaining = Math.max(0, pendingNow - data.length);
          if (pendingRemaining === 0) {
            xtermPendingCharsRef.current.delete(termId);
          } else {
            xtermPendingCharsRef.current.set(termId, pendingRemaining);
          }
          if (
            sid &&
            pendingRemaining <= XTERM_LOW_WATERMARK_CHARS &&
            pausedShellsRef.current.get(sid)
          ) {
            pausedShellsRef.current.delete(sid);
            sshService.resumeShell(sid);
          }
          if (outputWriteQueuesRef.current.has(termId) && outputWriteFrameRef.current === null) {
            outputWriteFrameRef.current = window.setTimeout(flushTerminalOutputQueues, 0);
          }
        });
        return;
      }

      let totalChars = data.length;
      if (!existing) {
        outputWriteQueuesRef.current.set(termId, {
          term,
          chunks: [data],
          totalChars: data.length,
          wasScrolledUp: isUserScrolledUp,
          viewportY: isUserScrolledUp ? buffer.viewportY : buffer.baseY,
          needsHighlight,
        });
      } else {
        existing.term = term;
        existing.chunks.push(data);
        existing.totalChars += data.length;

        // 流控防爆内存保护：当单终端待渲染积压超过 64MB 时淘汰最旧的积压块，保证内存恒定可控
        if (existing.totalChars > MAX_QUEUE_BUFFER_CHARS) {
          while (existing.chunks.length > 1 && existing.totalChars > MAX_QUEUE_BUFFER_CHARS / 2) {
            const dropped = existing.chunks.shift();
            if (dropped) {
              existing.totalChars -= dropped.length;
            }
          }
        }
        // 丢弃后更新 totalChars，使下方背压判断基于丢弃后的真实积压（否则丢弃后仍会误判高水位触发 pause）
        totalChars = existing.totalChars;
        // MED-3：wasScrolledUp 仅在首次判定为用户上滚时置 true，之后不再被后续帧覆盖为 false。
        // 避免两帧之间用户「先上滚再下滚」导致本批次已积压块被错误标记为未上滚（少算新输出计数）。
        // 是否真正计入新输出仍由冲刷时的实时 viewport 检查（viewportY >= baseY）兜底。
        if (isUserScrolledUp) {
          existing.wasScrolledUp = true;
          existing.viewportY = buffer.viewportY;
        }
        if (existing.needsHighlight === undefined) {
          existing.needsHighlight = needsHighlight;
        } else if (needsHighlight) {
          existing.needsHighlight = true;
        }
      }

      // 高水位背压触发（对齐 VS Code / RFC 4254 标准）：
      // 当待渲染积压超过 HIGH_WATERMARK 时，通知后端暂停从 SSH 通道拉取数据，
      // 迫使远端正在高速输出的进程（如 docker logs -f）在管道写满后自然阻塞等待。
      const inst = xtermInstances.current.get(termId);
      const sid = inst?.sessionId;
      const isSigintDrainingSlow = Boolean(sid && sigintActiveUntilRef.current.has(sid));
      if (!isSigintDrainingSlow && sid && totalChars >= HIGH_WATERMARK_CHARS) {
        if (!pausedShellsRef.current.get(sid)) {
          pausedShellsRef.current.set(sid, true);
          sshService.pauseShell(sid);
        }
      }

      if (outputWriteFrameRef.current === null) {
        outputWriteFrameRef.current = window.setTimeout(flushTerminalOutputQueues, 0);
      }
    },
    [flushTerminalOutputQueues],
  );

  const appendSessionEvent = useCallback(
    async (
      termId: string,
      type: SessionEventType,
      payload: Record<string, unknown> = {},
    ) => {
      const state = recordingFileStatesRef.current.get(termId);
      if (!state) return;
      await writeTextFile(
        state.sessionPath,
        serializeSessionEvent(state.startedAt, type, payload),
        { append: true },
      );
    },
    [],
  );

  const queueSessionEvent = useCallback(
    (
      termId: string,
      type: SessionEventType,
      payload: Record<string, unknown> = {},
    ) => {
      if (!recordingFileStatesRef.current.has(termId)) return;
      const previous =
        recordingWriteChainsRef.current.get(termId) ?? Promise.resolve();
      const write = previous
        .then(() => appendSessionEvent(termId, type, payload))
        .catch((error) => {
          console.error("[Terminal Recording] failed to append session event:", error);
          if (!recordingWriteErrorNotifiedRef.current.has(termId)) {
            recordingWriteErrorNotifiedRef.current.add(termId);
            toastRef.current.error(
              t("recording_index_write_failed", {
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        });
      recordingWriteChainsRef.current.set(termId, write);
    },
    [appendSessionEvent, t],
  );

  const rememberSubmittedCommand = useCallback(
    (termId: string, command: string) => {
      const clean = command.trim();
      if (!clean) return;
      pendingCommandRef.current.set(termId, clean);

      const scopeId = serverId || termId;
      updateSessionEntities(clean, scopeId);

      // 本地马尔可夫模型自适应强化学习：记录相邻执行命令转移对
      const prevCmd = lastSubmittedCommandPerTermRef.current.get(termId);
      const currentCwd = terminalCwdRef.current.get(termId);
      if (prevCmd && prevCmd !== clean) {
        recordMarkovTransition(prevCmd, clean, currentCwd, scopeId);
      }
      lastSubmittedCommandPerTermRef.current.set(termId, clean);

      // cd 指令智能追踪：当用户键入 cd /path 等命令时，及时推导并更新终端工作目录。
      // 仅对「纯路径」形式的 cd 做乐观推导：含变量($)、命令连接(&&/;)、管道(|)、
      // 重定向(>)、通配(*?)、反引号、多参数(空格)或 `cd -` 时跳过，避免记录错误
      // cwd（这类情况交给后续 Shell 标题更新纠正，最终以 statInfo 校验兜底）。
      if (/^cd(\s+|$)/i.test(clean)) {
        const target = clean.replace(/^cd\s*/i, "").trim().replace(/^['"]|['"]$/g, "");
        const isSimplePath = !!target && !/[\s$&|;<>*?`]/.test(target) && !target.startsWith("-");
        if (!target || target === "~") {
          // home 已知用绝对路径；未知时记录 shell 语义的 `~`（补全侧 toShellPath 支持
          // `"$HOME/..."` 展开），保证 cd 链条不断裂，后续相对推导不会落到错误基准。
          recordTerminalCwd(termId, homeDirRef.current || "~");
        } else if (isSimplePath && target.startsWith("/")) {
          recordTerminalCwd(termId, target);
        } else if (isSimplePath && target.startsWith("~/") && homeDirRef.current) {
          const resolved = target.replace(/^~/, homeDirRef.current.replace(/\/+$/, ""));
          recordTerminalCwd(termId, resolved);
        } else if (isSimplePath && target.startsWith("~/")) {
          // home 尚未取到时的 `~/x`：保留 ~ 前缀原样记录（toShellPath 会展开 $HOME）
          recordTerminalCwd(termId, target);
        } else if (isSimplePath) {
          // 相对路径（含 ./ ../ ..）
          // 基准：已跟踪 cwd → home → `~`（home 未就绪时的占位，防止 cd 链断裂：
          // 例 `cd deploy` 在 home 未就绪时记为 ~/deploy，后续 `cd iot-gateway`
          // → ~/deploy/iot-gateway，而不是错落到 /home/hongyan/iot-gateway）。
          const current =
            terminalCwdRef.current.get(termId) || homeDirRef.current || "~";
          const resolved = resolveRelativePath(current, target);
          if (resolved) {
            recordTerminalCwd(termId, resolved);
          }
        }
      }

      queueSessionEvent(termId, "command", {
        command: redactCommandForSession(clean),
        cwd: terminalCwdRef.current.get(termId),
      });
    },
    [queueSessionEvent],
  );

  const appendRecordingData = useCallback(
    async (termId: string, data: string) => {
      const state = recordingFileStatesRef.current.get(termId);
      if (!state || !data) return;

      // 按 UTF-8 字节数切分，保证每个分卷不会超过配置上限（中文/ANSI 清理后的多字节文本也正确）。
      let remaining = data;
      const encoder = new TextEncoder();
      while (remaining.length > 0) {
        const remainingBytes = state.maxBytes - state.bytes;
        if (remainingBytes <= 0) {
          state.part += 1;
          state.bytes = 0;
          state.path = await join(
            state.directory,
            `${state.baseName}-part-${String(state.part).padStart(3, "0")}.log.txt`,
          );
          await writeTextFile(state.path, "", { create: true });
          recordingFilePathsRef.current.set(termId, state.path);
          await appendSessionEvent(termId, "part", {
            part: state.part,
            file: `${state.baseName}-part-${String(state.part).padStart(3, "0")}.log.txt`,
          });
          continue;
        }

        const fullBytes = encoder.encode(remaining).byteLength;
        if (fullBytes <= remainingBytes) {
          const offset = state.bytes;
          await writeTextFile(state.path, remaining, { append: true });
          state.bytes += fullBytes;
          await appendSessionEvent(termId, "output", {
            part: state.part,
            offset,
            bytes: fullBytes,
          });
          break;
        }

        // 二分查找能放入当前分卷的最大字符前缀，避免在多字节字符中间截断。
        const chars = Array.from(remaining);
        let low = 1;
        let high = chars.length;
        let fit = 0;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          const candidateBytes = encoder.encode(
            chars.slice(0, mid).join(""),
          ).byteLength;
          if (candidateBytes <= remainingBytes) {
            fit = mid;
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }
        // 配置下限为 50 MB，单个 Unicode 字符不会大到无法写入；保留兜底避免死循环。
        if (fit === 0) {
          state.part += 1;
          state.bytes = 0;
          state.path = await join(
            state.directory,
            `${state.baseName}-part-${String(state.part).padStart(3, "0")}.log.txt`,
          );
          await writeTextFile(state.path, "", { create: true });
          recordingFilePathsRef.current.set(termId, state.path);
          await appendSessionEvent(termId, "part", {
            part: state.part,
            file: `${state.baseName}-part-${String(state.part).padStart(3, "0")}.log.txt`,
          });
          continue;
        }
        const chunk = chars.slice(0, fit).join("");
        const offset = state.bytes;
        const chunkBytes = encoder.encode(chunk).byteLength;
        await writeTextFile(state.path, chunk, { append: true });
        state.bytes += chunkBytes;
        await appendSessionEvent(termId, "output", {
          part: state.part,
          offset,
          bytes: chunkBytes,
        });
        remaining = chars.slice(fit).join("");
      }
    },
    [appendSessionEvent],
  );

  // 远端输出始终写入终端；用户上滚时由 writeTerminalOutput 保持视口位置。
  const writeShellOutput = useCallback(
    (termId: string, term: Terminal, data: string, rawData?: string) => {
      let outputData = data;
      const inst = xtermInstances.current.get(termId);
      const sid = inst?.sessionId;

      // Ctrl+C 极速排空通道：若会话正处于中断窗口内，静默丢弃在途旧日志，直到检测到中断回显（^C/Prompt）
      if (sid && sigintActiveUntilRef.current.has(sid)) {
        const until = sigintActiveUntilRef.current.get(sid)!;
        const now = Date.now();
        if (now > until) {
          sigintActiveUntilRef.current.delete(sid);
          sigintDroppedCharsRef.current.delete(sid);
        } else {
          const markerIdx = findSigintBoundary(outputData);
          if (markerIdx !== -1) {
            // 找到中断响应标志（^C、\x03、\x1b[?2004l、Prompt 序列等）：截取该标志之后的内容（保留 ^C 与 Prompt），退出排空窗口
            outputData = outputData.slice(markerIdx);
            sigintActiveUntilRef.current.delete(sid);
            sigintDroppedCharsRef.current.delete(sid);
          } else {
            // 尚未到达中断响应，丢弃在途旧日志
            const dropped = (sigintDroppedCharsRef.current.get(sid) ?? 0) + outputData.length;
            if (dropped < 16 * 1024 * 1024) {
              sigintDroppedCharsRef.current.set(sid, dropped);
              return; // 直接丢弃在途旧日志，屏幕瞬间定格，杜绝任何残余日志刷屏！
            } else {
              sigintActiveUntilRef.current.delete(sid);
              sigintDroppedCharsRef.current.delete(sid);
            }
          }
        }
      }

      const isSerialSession = server?.targetType === "serial" || server?.protocol === "serial";
      if (isSerialSession) {
        if (serialHexViewModeRef.current) {
          const bytes = rawData ? decodeBase64Bytes(rawData) : new TextEncoder().encode(data);
          // 用数组 push + join 替代逐字节字符串拼接，避免高速串口下 O(n²) 复制卡死主线程
          const hexParts: string[] = [];
          for (let i = 0; i < bytes.length; i++) {
            const hex = bytes[i].toString(16).toUpperCase().padStart(2, "0");
            hexParts.push(hex, " ");
            if ((i + 1) % 16 === 0) hexParts.push("\r\n");
          }
          outputData = hexParts.join("");
        } else {
          // 换行模式转换
          if (serialNewlineModeRef.current === "crlf" || serialNewlineModeRef.current === "auto") {
            outputData = outputData.replace(/(?<!\r)\n/g, "\r\n");
          } else if (serialNewlineModeRef.current === "lf") {
            outputData = outputData.replace(/\r\n/g, "\n");
          }

          // 毫秒时间戳前缀注入
          if (serialTimestampModeRef.current) {
            const isStart = serialLineStartMapRef.current.get(termId) ?? true;
            const now = new Date();
            const h = String(now.getHours()).padStart(2, "0");
            const m = String(now.getMinutes()).padStart(2, "0");
            const s = String(now.getSeconds()).padStart(2, "0");
            const ms = String(now.getMilliseconds()).padStart(3, "0");
            const ts = `\x1b[90m[${h}:${m}:${s}.${ms}]\x1b[0m `;

            // 用数组 push + join 替代逐字符拼接，避免时间戳注入变成 O(n²)
            const tsParts: string[] = [];
            let atStart = isStart;
            for (let i = 0; i < outputData.length; i++) {
              const ch = outputData[i];
              if (atStart && ch !== "\r" && ch !== "\n") {
                tsParts.push(ts);
                atStart = false;
              }
              tsParts.push(ch);
              if (ch === "\n") {
                atStart = true;
              }
            }
            serialLineStartMapRef.current.set(termId, atStart);
            outputData = tsParts.join("");
          }
        }
      }

      if (
        recordingTermIdsRef.current.has(termId) &&
        !recordingPausedRef.current.has(termId)
      ) {
        if (recordingFileStatesRef.current.has(termId)) {
          const previous =
            recordingWriteChainsRef.current.get(termId) ?? Promise.resolve();
          const recordableData = stripAnsiForRecording(outputData);
          if (recordableData) {
            const pendingChars = recordingPendingCharsRef.current.get(termId) ?? 0;
            if (pendingChars + recordableData.length > MAX_RECORDING_PENDING_CHARS) {
              // 录制不能反过来拖住 SSH/xterm 主链路。停止接收新的录制块，
              // 让已有链条自然排空并释放闭包，避免磁盘变慢时无限涨内存。
              const active = new Set(recordingTermIdsRef.current);
              active.delete(termId);
              recordingTermIdsRef.current = active;
              recordingPendingCharsRef.current.delete(termId);
              recordingFileStatesRef.current.delete(termId);
              recordingWriteChainsRef.current.delete(termId);
              if (!recordingWriteErrorNotifiedRef.current.has(termId)) {
                recordingWriteErrorNotifiedRef.current.add(termId);
                if (!isUnmountedRef.current) {
                  setRecordingTermIds(active);
                  toastRef.current.warning(t("term_recording_overflow"));
                }
              }
            } else {
              recordingPendingCharsRef.current.set(
                termId,
                pendingChars + recordableData.length,
              );
            const write = previous
              .then(() => appendRecordingData(termId, recordableData))
              .catch((error) => {
              console.error(
                "[Terminal Recording] failed to append output:",
                error,
              );
              if (!recordingWriteErrorNotifiedRef.current.has(termId)) {
                recordingWriteErrorNotifiedRef.current.add(termId);
                const active = new Set(recordingTermIdsRef.current);
                active.delete(termId);
                recordingTermIdsRef.current = active;
                recordingFileStatesRef.current.delete(termId);
                recordingWriteChainsRef.current.delete(termId);
                recordingPendingCharsRef.current.delete(termId);
                if (!isUnmountedRef.current) {
                  setRecordingTermIds(active);
                  toastRef.current.error(
                    t("term_recording_failed", {
                      error: error instanceof Error ? error.message : String(error),
                    }),
                  );
                }
              }
              })
              .finally(() => {
                const current = recordingPendingCharsRef.current.get(termId) ?? 0;
                const remaining = Math.max(0, current - recordableData.length);
                if (remaining > 0) recordingPendingCharsRef.current.set(termId, remaining);
                else recordingPendingCharsRef.current.delete(termId);
              });
            recordingWriteChainsRef.current.set(termId, write);
            }
          }
        }
      }
      if (isSerialSession && serialDisplayPausedRef.current) {
        // 暂停仅冻结显示，不阻断驱动接收和录制。限制为 2 MiB，避免长期暂停耗尽内存。
        const previous = serialPausedOutputRef.current.get(termId) || "";
        const combined = previous + outputData;
        serialPausedOutputRef.current.set(termId, combined.slice(-2 * 1024 * 1024));
        return;
      }
      // 串口会话不做关键词高亮；其余会话在 writeTerminalOutput 帧冲刷处统一高亮
      writeTerminalOutput(termId, term, outputData, !isSerialSession);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appendRecordingData, writeTerminalOutput],
  );

  const toggleRecording = useCallback(
    async (termId: string) => {
      const next = new Set(recordingTermIdsRef.current);
      if (next.has(termId)) {
        const fileState = recordingFileStatesRef.current.get(termId);
        // 先从 ref 移除，停止新的输出进入写入队列，再等待已排队内容落盘。
        next.delete(termId);
        recordingTermIdsRef.current = next;
        if (fileState) {
          const previous =
            recordingWriteChainsRef.current.get(termId) ?? Promise.resolve();
          recordingWriteChainsRef.current.set(
            termId,
            previous.then(() =>
              appendSessionEvent(termId, "session_end", {
                parts: fileState.part,
                bytesInLastPart: fileState.bytes,
              }),
            ),
          );
        }
        // 等待已排队的追加写入完成，确保提示出现时文件包含最后一段输出。
        const pendingWrite = recordingWriteChainsRef.current.get(termId);
        if (pendingWrite) await pendingWrite;
        recordingFileStatesRef.current.delete(termId);
        recordingFilePathsRef.current.delete(termId);
        recordingWriteChainsRef.current.delete(termId);
        recordingPendingCharsRef.current.delete(termId);
        recordingWriteErrorNotifiedRef.current.delete(termId);
        if (recordingPausedRef.current.delete(termId)) {
          setRecordingPausedIds(new Set(recordingPausedRef.current));
        }
        if (fileState) {
          const message =
            fileState.part > 1
              ? t("recording_saved_parts_with_index", {
                  count: fileState.part,
                  directory: fileState.directory,
                  index: fileState.sessionPath,
                })
              : t("recording_saved_with_index", {
                  path: fileState.path,
                  index: fileState.sessionPath,
                });
          toastRef.current.success(message);
        }
      } else {
        let directory = terminalRecordingDirectory;
        if (!directory) {
          const selected = await openDialog({
            directory: true,
            multiple: false,
            title: t("recording_select_directory"),
          });
          if (typeof selected !== "string" || !selected) return;
          directory = selected;
          setTerminalRecordingDirectory(selected);
        }
        const safeName = (server?.name || "terminal").replace(
          /[<>:"/\\|?*\p{Cc}]/gu,
          "_",
        );
        const baseName = `${safeName}-${new Date().toISOString().replace(/[:.]/g, "-")}-${termId.slice(-8)}`;
        const filePath = await join(directory, `${baseName}-part-001.log.txt`);
        const sessionPath = await join(directory, `${baseName}.session.jsonl`);
        const startedAt = Date.now();
        const recordingSessionId = crypto.randomUUID();
        try {
          await writeTextFile(filePath, "", { create: true });
          await writeTextFile(
            sessionPath,
            serializeSessionEvent(startedAt, "session_start", {
              sessionId: recordingSessionId,
              terminalId: termId,
              shellSessionId:
                terminalsRef.current.get(termId)?.sessionId ?? null,
              serverId,
              serverName: server?.name || "terminal",
              host: server?.host,
              port: server?.port,
              username: server?.username,
              encoding: terminalEncoding,
              firstPart: `${baseName}-part-001.log.txt`,
            }),
            { create: true },
          );
        } catch (error) {
          toastRef.current.error(
            t("recording_create_failed", {
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          return;
        }
        next.add(termId);
        recordingFilePathsRef.current.set(termId, filePath);
        recordingLastPathRef.current.set(termId, filePath);
        recordingFileStatesRef.current.set(termId, {
          directory,
          baseName,
          path: filePath,
          bytes: 0,
          part: 1,
          maxBytes: terminalRecordingMaxSizeMb * 1024 * 1024,
          sessionPath,
          startedAt,
          sessionId: recordingSessionId,
        });
        recordingWriteErrorNotifiedRef.current.delete(termId);
        recordingPendingCharsRef.current.set(termId, 0);
        recordingWriteChainsRef.current.set(termId, Promise.resolve());
        toastRef.current.success(t("recording_started"));
      }
      recordingTermIdsRef.current = next;
      setRecordingTermIds(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      appendRecordingData,
      appendSessionEvent,
      server?.name,
      server?.host,
      server?.port,
      server?.username,
      serverId,
      setTerminalRecordingDirectory,
      terminalRecordingDirectory,
      terminalRecordingMaxSizeMb,
      terminalEncoding,
    ],
  );

  // 创建新终端
  const createTerminal = useCallback(async () => {
    // 一个工作台只维护一个 Shell，避免隐藏会话重复执行广播和丢失主题/输出状态。
    if (terminalsRef.current.size >= 1) {
      toastRef.current.info(t("tm_single_terminal_only"));
      return;
    }
    const termId = `term-${crypto.randomUUID()}`;
    const termNumber = terminals.size + 1;
    const newInstance: TerminalInstance = {
      id: termId,
      name: `Terminal ${termNumber}`,
      sessionId: null,
      status: "connecting",
      reconnectAttempt: 0,
      autoReconnect: true,
    };

    // 关键修复：必须同步设置 terminalsRef.current，不能放在 setTerminals updater 内。
    // 原因：setTerminals 的 updater 在 React 渲染时才执行（异步），
    // 但 requestAnimationFrame 可能在渲染之前触发 → initTerminalAndShell →
    // waitForStableContainer 读取 terminalsRef.current 时仍为旧值 → hasTerm=false
    // → container 返回 null → 终端无输出。
    const nextMap = new Map(terminalsRef.current).set(termId, newInstance);
    terminalsRef.current = nextMap;
    setTerminals(nextMap);
    setActiveTermId(termId);

    // 等待 DOM 渲染容器后初始化
    // 关键：initTerminalAndShell 是 async 函数，在 try 块之外（term.open / 事件注册等）
    // 抛出的异常不会被子 catch 块捕获，导致 Promise rejection 未处理，
    // onShellReady 永远不会被调用 → terminalReady 永久 false → overlay 永久卡住。
    // .catch() 作为安全网：记录错误 + 调用 onShellReady + 设置终端错误状态。
    requestAnimationFrame(() => {
      initTerminalAndShell(termId, serverId).catch((err) => {
        console.error(
          `[Terminal Init] ${serverId} initTerminalAndShell 异常（被 .catch 捕获）:`,
          err,
        );
        setTerminals((prev) => {
          const next = new Map(prev);
          const inst = next.get(termId);
          if (inst) {
            next.set(termId, {
              ...inst,
              status: "error",
              error: err.message || String(err),
            });
          }
          terminalsRef.current = next;
          return next;
        });
        const xinst = xtermInstances.current.get(termId);
        if (xinst?.term) {
          xinst.term.writeln("\r\n\x1b[33m" + t("tm_disconnected_hint") + "\x1b[0m");
          xinst.term.focus();
        }
        onShellReady?.();
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, terminals.size, connectionBlocked, connectionBlockedReason]);

  // 重连终端
  // isAutoReconnect=true 表示由自动重连定时器触发；false（默认）表示用户手动触发
  const reconnectTerminal = useCallback(
    async (termId: string, isAutoReconnect = false) => {
      // 防止竞态：如果已经在重连中，忽略重复请求
      if (reconnectingRef.current.has(termId)) return;
      reconnectingRef.current.add(termId);

      const currentServer = server || useAppStore.getState().servers.find((s) => s.id === baseServerId);
      const host = currentServer?.host;
      const port = currentServer?.port || 22;
      const username = currentServer?.username;
      const isTelnet = currentServer?.protocol === "telnet";
      const isSerial = currentServer?.targetType === "serial" || currentServer?.protocol === "serial";

      // 手动重连：重置计数器与 autoReconnect 标记，并通知全局 ReconnectManager 立即重连
      if (!isAutoReconnect) {
        setTerminals((prev) => {
          const next = new Map(prev);
          const inst = next.get(termId);
          if (inst) {
            next.set(termId, {
              ...inst,
              reconnectAttempt: 0,
              autoReconnect: true,
            });
          }
          terminalsRef.current = next;
          return next;
        });
        if (!isTelnet && !isSerial) {
          reconnectManager.retryImmediately(serverId);
        }
      }

      const xtermInfo = xtermInstances.current.get(termId);
      if (!xtermInfo) {
        reconnectingRef.current.delete(termId);
        onShellReady?.();
        return;
      }

      // 清理旧连接
      if (xtermInfo.cleanup) {
        xtermInfo.cleanup(true);
      }

      let serialCfg: SerialOpenConfig = {
        portName: host || "COM1",
        baudRate: currentServer?.port || 115200,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
        dtr: true,
        rts: true,
        encoding: terminalEncoding || "utf-8",
      };
      if (currentServer?.serialConfig) {
        try {
          const parsed = JSON.parse(currentServer.serialConfig);
          serialCfg = { ...serialCfg, ...parsed };
        } catch {
          // 忽略异常
        }
      }

      // E2：手动重连进度反馈在终端内输出进度信息
      if (isSerial) {
        xtermInfo.term.writeln(
          `\r\n\x1b[90m${t("term_connecting_serial", { port: serialCfg.portName, baud: serialCfg.baudRate })}\x1b[0m`,
        );
      } else if (isTelnet) {
        xtermInfo.term.writeln(
          `\r\n\x1b[90m${t("term_connecting_telnet", { host: host || "Telnet", port: String(port) })}\x1b[0m`,
        );
      } else {
        if (host && username) {
          xtermInfo.term.writeln(
            `\r\n\x1b[90m${t("term_connecting_ssh", { username, host, port: String(port) })}\x1b[0m`,
          );
        } else {
          xtermInfo.term.writeln(
            `\r\n\x1b[90m${t("term_connecting_server")}\x1b[0m`,
          );
        }
      }

      // E2：手动重连也使用 'reconnecting' 状态，状态徽章统一显示"重连中"
      setTerminals((prev) => {
        const next = new Map(prev);
        const inst = next.get(termId);
        if (inst) {
          next.set(termId, {
            ...inst,
            status: "reconnecting",
            sessionId: null,
          });
        }
        terminalsRef.current = next;
        return next;
      });

      // 收集创建过程中的清理函数，防止抛错导致订阅泄漏（B1/B2）
      const cleanups: Array<() => void> = [];

      try {
        if (!isTelnet && !isSerial) {
          // SSH 路径：确保 SSH 底层连接存在（若已连接，后端会立即返回 Ok）
          const connResult = await sshService.connect(serverId);
          if (isUnmountedRef.current || !xtermInstances.current.has(termId)) {
            reconnectingRef.current.delete(termId);
            return;
          }
          if (!connResult.success) {
            xtermInfo.term.writeln(
              `\r\n\x1b[31m${t("tm_connection_failed")}: ${connResult.error || t("common_unknown_error")}\x1b[0m`,
            );
            onShellReady?.();
            throw new Error(connResult.message || t("tm_err_ssh"));
          }

          xtermInfo.term.writeln(
            `\x1b[32m${t("tm_connection_established")}.\x1b[0m\r\n`,
          );
        }

        // 用当前 xterm 尺寸创建 Shell
        try {
          fitTerminalSafely(xtermInfo.fitAddon, xtermInfo.term);
        } catch (e) {
          console.warn("[Terminal] fit failed during reconnect:", e);
        }
        const cols = xtermInfo.term.cols > 0 ? xtermInfo.term.cols : 80;
        const rows = xtermInfo.term.rows > 0 ? xtermInfo.term.rows : 24;
        const result = isSerial
          ? await sshService.createSerialShell(
              serverId,
              serialCfg.portName,
              serialCfg.baudRate,
              serialCfg.dataBits,
              serialCfg.stopBits,
              serialCfg.parity,
              serialCfg.flowControl,
              serialCfg.dtr,
              serialCfg.rts,
              serialCfg.encoding || terminalEncoding,
              serialCfg.deviceVid,
              serialCfg.devicePid,
              serialCfg.deviceSerialNumber,
            )
          : isTelnet
          ? await sshService.createTelnetShell(
              serverId,
              host ?? "",
              port,
              cols,
              rows,
              15,
              terminalEncoding,
            )
          : await sshService.createShell(
              serverId,
              cols,
              rows,
              terminalEncoding,
            );
        if (isUnmountedRef.current || !xtermInstances.current.has(termId)) {
          if (result.success && result.sessionId) {
            void sshService.closeShell(result.sessionId).catch(() => {});
          }
          reconnectingRef.current.delete(termId);
          return;
        }
        if (!result.success || !result.sessionId) {
          xtermInfo.term.write("\r\x1b[2K");
          xtermInfo.term.writeln(
            `\r\n\x1b[31m${t("tm_reconnect_failed")}: ${result.error}\x1b[0m`,
          );
          xtermInfo.term.writeln(
            "\x1b[33m" + t("tm_disconnected_hint") + "\x1b[0m",
          );
          xtermInfo.term.focus();
          setTerminals((prev) => {
            const next = new Map(prev);
            const inst = next.get(termId);
            if (inst) {
              next.set(termId, {
                ...inst,
                status: "error",
                error: result.error,
              });
            }
            terminalsRef.current = next;
            return next;
          });
          reconnectingRef.current.delete(termId);
          onShellReady?.();
          // 自动重连失败：由全局 ReconnectManager 调度下一次尝试
          if (isAutoReconnect && !isTelnet && !isSerial) {
            reconnectManager.scheduleNextAttempt(serverId, result.error, null);
          }
          return;
        }

        const sessionId = result.sessionId;
        if (isSerial) {
          useAppStore.getState().setServerState(serverId, ConnectionState.Ready);
          if (baseServerId && baseServerId !== serverId) {
            useAppStore.getState().setServerState(baseServerId, ConnectionState.Ready);
          }
        }

        // 关键修复：createShell 成功后立即将 closeShell 加入 cleanups，
        // 确保后续任何路径（isUnmounted/异常）都能关闭新 session 防止泄漏
        let newSessionClosed = false;
        cleanups.push(() => {
          if (newSessionClosed) return;
          newSessionClosed = true;
          sshService.closeShell(sessionId).catch(() => {});
        });
        let sessionCleanupDone = false;
        const sessionCleanup = () => {
          if (sessionCleanupDone) return;
          sessionCleanupDone = true;
          // 断连/关闭：使所有 in-flight 的路径/动态补全请求失效（resolve 后会被版本号丢弃）；
          // 若该会话属于当前活跃终端，同时清掉补全面板状态，避免旧补全列表残留到新会话。
          pathFetchIdRef.current += 1;
          if (termId === activeTermIdRef.current) {
            setCmdHints([]);
            setHintVisible(false);
            setHintLoading(false);
            if (hintLoadingTimerRef.current !== null) {
              window.clearTimeout(hintLoadingTimerRef.current);
              hintLoadingTimerRef.current = null;
            }
          }
          const current = xtermInstances.current.get(termId);
          if (current?.term) discardPendingXtermWrites(current.term);
          outputWriteQueuesRef.current.delete(termId);
          outputWriteInFlightRef.current.delete(termId);
          // 取消串口延迟发送队列，防止某次挂起阻塞后续输入
          clearSerialWriteQueue(sessionId);
          xtermPendingCharsRef.current.delete(termId);
          serialPausedOutputRef.current.delete(termId);
          const resizeTimer = resizeTimersRef.current.get(sessionId);
          if (resizeTimer) {
            window.clearTimeout(resizeTimer);
            resizeTimersRef.current.delete(sessionId);
          }
          pausedShellsRef.current.delete(sessionId);
          sigintActiveUntilRef.current.delete(sessionId);
          sigintDroppedCharsRef.current.delete(sessionId);
          lastActivityTimesRef.current.delete(sessionId);
          discardedShellOutputThroughRef.current.delete(sessionId);
          const zmodem = zmodemSessionsRef.current.get(sessionId);
          if (zmodem) {
            try { zmodem.session.abort?.(); } catch { /* session may already be closed */ }
            zmodemSessionsRef.current.delete(sessionId);
            void sshService.shellZmodemEnd(sessionId).catch(() => {});
          }
          zmodemSentriesRef.current.delete(sessionId);
          cleanups.slice().reverse().forEach((fn) => {
            try {
              fn();
            } catch {
              // 忽略重复/异常清理
            }
          });
          if (tabId) {
            sshService.unregisterTabSession(tabId, sessionId);
          }
          if (current?.sessionId === sessionId) {
            xtermInstances.current.set(termId, {
              ...current,
              sessionId: undefined,
            });
          }
        };

        // 更新 sessionId 到 xtermInstances，供复制粘贴事件使用
        if (isUnmountedRef.current || !sshService.isSessionAlive(sessionId)) {
          cleanups.slice().reverse().forEach((fn) => {
            try {
              fn();
            } catch {
              // 忽略异常
            }
          });
          reconnectingRef.current.delete(termId);
          return;
        }

        // 关键：更新 xtermInstances 中的 sessionId，供 Tab 补全 / 复制粘贴等
        // 通过 xtermInstances.current.get(termId)?.sessionId 读取的场景使用。
        // 若不更新，重连后这些场景会拿到旧的（已关闭的）sessionId，导致输入丢失。
        const xinst = xtermInstances.current.get(termId);
        if (xinst) xtermInstances.current.set(termId, { ...xinst, sessionId });

        // 重连得到的是全新 shell 进程，PWD 已回到 home：清空重连前的 cwd 缓存，
        // 否则相对路径补全会继续 ls 旧目录（表现为「cd 前缀什么都不提示」）。
        terminalCwdRef.current.delete(termId);

        // 注册到 tab 会话管理
        if (tabId) {
          sshService.registerTabSession(tabId, sessionId);
        }

        setTerminals((prev) => {
          const next = new Map(prev);
          const inst = next.get(termId);
          if (inst) {
            next.set(termId, {
              ...inst,
              sessionId,
              status: "connected",
              reconnectAttempt: 0,
              autoReconnect: true,
            });
          }
          terminalsRef.current = next;
          return next;
        });

        // 重连成功：重置全局 ReconnectManager 状态；自动重连成功时弹 toast 提示
        if (!isTelnet && !isSerial) {
          reconnectManager.reset(serverId);
        }
        if (isAutoReconnect) {
          toastRef.current.success(t("term_auto_reconnect_success"));
        }

        // 统一的安全无竞态 Shell 输出监听与历史获取流
        let historyWritten = false;
        let pendingBuffer = "";

        const unsubscribe = sshService.onShellOutput((data) => {
          if (data.sessionId === sessionId) {
            const discardedThrough =
              discardedShellOutputThroughRef.current.get(sessionId) ?? 0;
            if (
              typeof data.sequence === "number" &&
              data.sequence <= discardedThrough
            ) {
              return;
            }
            lastActivityTimesRef.current.set(sessionId, Date.now());
            // 高亮已移至 writeTerminalOutput 帧冲刷处（合并后执行一次），此处透传原始文本
            if (!historyWritten) {
              pendingBuffer += data.data;
              // C6：限制 pendingBuffer 长度，防止历史加载期间无限增长
              if (pendingBuffer.length > MAX_PENDING_BUFFER) {
                pendingBuffer = pendingBuffer.slice(-MAX_PENDING_BUFFER);
              }
            } else {
              writeShellOutput(termId, xtermInfo.term, data.data, data.rawData);
            }
          }
        });
        cleanups.push(unsubscribe);

        // 补获已缓冲的历史数据并渲染
        let historyData: string | null = null;
        try {
          const history = await sshService.getShellHistory(sessionId);
          historyData = history;
          if (history) {
            const safeHistory = stripUnsafeEscapes(
              isSerial
                ? history
                : highlightKeywords(
                    history,
                    highlightEnabledRef.current,
                    highlightRulesRef.current,
                  ),
            );
            await writeChunked(
              xtermInfo.term,
              safeHistory,
              64 * 1024,
              undefined,
              () => isUnmountedRef.current || !sshService.isSessionAlive(sessionId),
            );
          }
        } catch (e) {
          console.error("Failed to get shell history during reconnect:", e);
        }

        // B8：历史加载为长 await，期间组件可能已卸载，需检查并释放已创建的订阅
        if (isUnmountedRef.current || !sshService.isSessionAlive(sessionId)) {
          cleanups.slice().reverse().forEach((fn) => {
            try {
              fn();
            } catch {
              // 忽略异常
            }
          });
          reconnectingRef.current.delete(termId);
          return;
        }

        // 标记历史渲染完毕，并冲刷在加载历史期间接收到的实时缓冲数据
        historyWritten = true;
        if (pendingBuffer) {
          const bufferToWrite = historyData && historyData.endsWith(pendingBuffer) ? "" : pendingBuffer;
          if (bufferToWrite) {
            if (isSerial) writeShellOutput(termId, xtermInfo.term, bufferToWrite);
            else writeTerminalOutput(termId, xtermInfo.term, stripUnsafeEscapes(bufferToWrite));
          }
        }

        const unsubscribeClosed = sshService.onShellClosed((data) => {
          if (data.sessionId === sessionId) {
            sessionCleanup();
            if (isUnmountedRef.current) return;
            // 检查是否应该自动重连：全局开关开启、终端标记允许、组件未卸载、非手动断开
            // 串口设备拔出（device_disconnected）除外：设备不在位时重连必然失败，
            // 只会触发有限次数的无意义重试与 toast 刷屏，等待用户重新插入后手动重连
            const inst = terminalsRef.current.get(termId);
            const shouldAuto =
              terminalAutoReconnectRef.current &&
              inst?.autoReconnect &&
              !isUnmountedRef.current &&
              !manualDisconnectRef.current &&
              data.reason !== "device_disconnected";
            if (shouldAuto) {
              if (!isTelnet && !isSerial) {
                reconnectManager.scheduleNextAttempt(serverId, data.reason || "Shell closed", null);
              }
              setTerminals((prev) => {
                const next = new Map(prev);
                const it = next.get(termId);
                if (it) {
                  next.set(termId, { ...it, status: "reconnecting", sessionId: null });
                }
                terminalsRef.current = next;
                return next;
              });
            } else {
              if (isSerial) {
                useAppStore.getState().setServerState(serverId, ConnectionState.Disconnected);
                if (baseServerId && baseServerId !== serverId) {
                  useAppStore.getState().setServerState(baseServerId, ConnectionState.Disconnected);
                }
              }
              // E1：断线提示增强终端内醒目 writeln + toast.warning 双重提示
              xtermInfo.term.writeln(
                "\r\n\x1b[33m" + t("tm_disconnected_hint") + "\x1b[0m",
              );
              xtermInfo.term.focus();
              toastRef.current.warning(t("tm_disconnected"));
              setTerminals((prev) => {
                const next = new Map(prev);
                const it = next.get(termId);
                if (it) {
                  next.set(termId, {
                    ...it,
                    status: "disconnected",
                    sessionId: null,
                  });
                }
                terminalsRef.current = next;
                return next;
              });
            }
          }
        });
        cleanups.push(unsubscribeClosed);

        const unsubscribeError = sshService.onShellError((data) => {
          if (data.sessionId === sessionId) {
            sessionCleanup();
            if (isUnmountedRef.current) return;
            xtermInfo.term.writeln(
              `\r\n\x1b[31mShell Error: ${data.error}\x1b[0m`,
            );
            // E1：Shell 错误也属于断线场景，补充 toast.warning 提示
            toastRef.current.warning(t("tm_disconnected"));
            const inst = terminalsRef.current.get(termId);
            // 串口设备拔出（device_disconnected）：设备不在位时重连必然失败，跳过自动重连
            const shouldAuto =
              terminalAutoReconnectRef.current &&
              inst?.autoReconnect &&
              !isUnmountedRef.current &&
              data.reason !== "device_disconnected";

            if (shouldAuto) {
              if (!isTelnet && !isSerial) {
                reconnectManager.scheduleNextAttempt(serverId, data.error, null);
              }
              setTerminals((prev) => {
                const next = new Map(prev);
                const it = next.get(termId);
                if (it) {
                  next.set(termId, { ...it, status: "reconnecting", sessionId: null });
                }
                terminalsRef.current = next;
                return next;
              });
            } else {
              xtermInfo.term.writeln(
                "\r\n\x1b[33m" + t("tm_disconnected_hint") + "\x1b[0m",
              );
              xtermInfo.term.focus();
              setTerminals((prev) => {
                const next = new Map(prev);
                const it = next.get(termId);
                if (it) {
                  next.set(termId, {
                    ...it,
                    status: "error",
                    error: data.error,
                  });
                }
                terminalsRef.current = next;
                return next;
              });
            }
          }
        });
        cleanups.push(unsubscribeError);

        const inputDataDisposable = xtermInfo.term.onData((data) => {
          if (useAppStore.getState().isAppLocked) return;
          if (sessionId) {
            lastActivityTimesRef.current.set(sessionId, Date.now());
          }
          userScrolledUpRef.current.set(termId, false);
          if (pendingOutputCountsRef.current.has(termId)) {
            const next = new Map(pendingOutputCountsRef.current);
            next.delete(termId);
            pendingOutputCountsRef.current = next;
            setPendingOutputCounts(next);
          }
          // 断连/重连中状态下按 Enter 触发手动重连（取消自动重连计时器）
          const inst = terminalsRef.current.get(termId);
          if (
            !inst ||
            inst.status === "disconnected" ||
            inst.status === "error" ||
            inst.status === "reconnecting"
          ) {
            if (data === "\r" || data === "\n") {
              onReconnectRef.current?.();
              reconnectTerminal(termId);
            }
            return;
          }

          // 追踪当前输入行，用于指令提示
          const submittedCommand =
            data === "\r" || data === "\n"
              ? currentInputRef.current.trim()
              : "";
          if (data === "\r" || data === "\n") {
            // 回车执行命令：记录到历史，再清空输入追踪
            // 注：customKeyEventHandler 对 Enter 做智能判断——命令完整匹配或
            // 非命令阶段时放行执行，仅前缀补全模式才拦截；此处即真正执行命令
            if (currentInputRef.current.trim()) {
              rememberSubmittedCommand(termId, submittedCommand);
              recordCommand(currentInputRef.current);
              // 新命令入历史后令排名缓存失效，下一次补全即反映最新频次
              invalidateRankingCache();
            }
            pathFetchIdRef.current += 1;
            clearHintLoading();
            currentInputRef.current = "";
            setCmdHints([]);
            setHintVisible(false);
          } else if (data === "\x7f" || data === "\b") {
            // 退格：提示框已可见时同步更新内容（输入为空时自动关闭）；
            // 提示框不可见时不主动弹出（避免干扰翻历史等场景），仅 silent 更新 hintResultRef。
            currentInputRef.current = currentInputRef.current.slice(0, -1);
            if (hintVisibleRef.current) {
              runMatchHints(currentInputRef.current);
            } else {
              runMatchHints(currentInputRef.current, { silent: true });
            }
          } else if (data === "\x03" || data === "\x1c") {
            // 收到终端中断信号 (Ctrl+C / Ctrl+\)，立即排空待渲染队列并发送中断
            handleSigint(termId);
            return;
          } else if (data === "\x15") {
            // Ctrl+U 清空当前行
            pathFetchIdRef.current += 1;
            clearHintLoading();
            currentInputRef.current = "";
            setCmdHints([]);
            setHintVisible(false);
          } else if (
            data.length >= 1 &&
            [...data].every(
              (c) => c.charCodeAt(0) >= 32 && !c.startsWith("\x1b"),
            )
          ) {
            // 普通可打印字符（含 CJK 多字节输入），追加到输入追踪（B5）
            // H2 修复：若上一次 rebuildInputFromBuffer 仍未完成（needsRebuildRef=true），
            // 说明 setTimeout 回调可能读到了过时 buffer（跨境 SSH 回显延迟），
            // 此时立即从 buffer 补读一次，避免 currentInputRef 错位导致后续补全错误。
            if (needsRebuildRef.current) {
              const tForRebuild = xtermInstances.current.get(termId)?.term;
              if (tForRebuild) {
                try {
                  const buf = tForRebuild.buffer.active;
                  const cy = buf.baseY + buf.cursorY;
                  const line = buf.getLine(cy);
                  if (line) {
                    const fullText = line.translateToString(true);
                    const markers = [
                      "$ ",
                      "# ",
                      "> ",
                      "% ",
                      "❯ ",
                      "➜ ",
                      "❯",
                      "➜",
                    ];
                    let lastIdx = -1;
                    let markerLen = 0;
                    for (const mk of markers) {
                      const idx = fullText.lastIndexOf(mk);
                      if (idx > lastIdx) {
                        lastIdx = idx;
                        markerLen = mk.length;
                      }
                    }
                    const cmdText =
                      lastIdx >= 0
                        ? fullText.slice(lastIdx + markerLen).trim()
                        : /[$#>%❯➜]\s*$/.test(fullText)
                          ? ""
                          : fullText;
                    currentInputRef.current = cmdText;
                  }
                } catch {
                  /* buffer 读取失败，沿用原 currentInputRef */
                }
                needsRebuildRef.current = false;
              }
            }
            currentInputRef.current += data;
            runMatchHints(currentInputRef.current);
          } else {
            // 其他控制序列（方向键 \x1b[A/B 调历史、Ctrl+W \x17 删词、Ctrl+A \x01、Ctrl+E \x05 等），
            // 无法精确追踪——但从 buffer 重建当前行内容。
            // 关键修复：↑ 调历史后 shell 显示 `docker logs -f`，但 currentInputRef 已失效，
            // 必须从 buffer 读取真实内容，否则后续输入容器名时会被误判为命令阶段。
            // 先关闭当前提示（避免重建前显示错位），延迟从 buffer 重建
            pathFetchIdRef.current += 1;
            clearHintLoading();
            setCmdHints([]);
            setHintVisible(false);
            // 用当前终端实例重建（普通模式与迁移模式都已注册到 xtermInstances）
            const tForRebuild = xtermInstances.current.get(termId)?.term;
            if (tForRebuild) rebuildInputFromBuffer(tForRebuild);
          }

          if (sessionId) {
            // 广播执行危险命令前强制确认，并明确展示目标数量/名称。
            if (
              submittedCommand &&
              tabId &&
              useAppStore.getState().broadcastTabIds.includes(tabId) &&
              DANGEROUS_COMMAND_RE.test(submittedCommand)
            ) {
              const state = useAppStore.getState();
              // 按 serverId 去重：同一服务器开了多个广播 tab 时，旧实现按 tabId
              // 列出同名多次、计数虚高（"2 个目标"实为 1 台服务器）。改为以 serverId
              // 为键去重，count 与列表均按服务器数计。同服务器多会话的重复执行属
              // 用户自主开启的广播（已决定不做互斥），不在此提示范围内。
              const seenServers = new Map<string, string>(); // serverId -> serverName
              for (const id of state.broadcastTabIds) {
                if (id === tabId) continue;
                const tab = state.tabs.find((t) => t.id === id);
                if (!tab) continue;
                if (!seenServers.has(tab.serverId)) {
                  seenServers.set(tab.serverId, tab.serverName || id);
                }
              }
              const targets = Array.from(seenServers.values());
              if (targets.length > 0) {
                const targetText =
                  targets.slice(0, 5).join("、") +
                  (targets.length > 5
                    ? t("broadcast_more_targets", { count: targets.length })
                    : "");
                const confirmed = window.confirm(
                  t("broadcast_danger_confirm", {
                    command: submittedCommand,
                    count: targets.length,
                    targets: targetText,
                  }),
                );
                if (!confirmed) return;
              }
            }
            // 统一通过广播入口写入：当前 tab 未开启广播时仅写入当前 session，
            // 开启广播时同步转发到其他开启广播的 tab 的所有 session。
            broadcastToShells(sessionId, data);
          }
        });
        cleanups.push(() => inputDataDisposable.dispose());

        // 监听 BEL 控制字符（\x07）：xterm.js v6 的 bellStyle:'sound' 不自动播放，
        // 需在此回调中自行用 WebAudio 合成提示音。受「开启终端铃声」开关控制。
        const bellDisposableA = xtermInfo.term.onBell(() => {
          // 仅开启铃声时播放；关闭时静默，由 bellStyle:'visual' 提供闪烁提示
          if (terminalBellSoundRef.current) playSound(SoundType.Bell);
        });
        cleanups.push(() => bellDisposableA.dispose());

        const resizeDisposable = xtermInfo.term.onResize(({ cols, rows }) => {
          queueSessionEvent(termId, "resize", { cols, rows });
          // D2：节流 resizeShell 调用，避免拖拽调整尺寸时频繁触发后端
          const existing = resizeTimersRef.current.get(sessionId);
          if (existing) window.clearTimeout(existing);
          const timer = window.setTimeout(() => {
            sshService.resizeShell(sessionId, cols, rows);
            resizeTimersRef.current.delete(sessionId);
          }, 150);
          resizeTimersRef.current.set(sessionId, timer);
        });
        cleanups.push(() => resizeDisposable.dispose());
        // H3 修复：cleanup 时清理该 terminal 的 resize timer
        cleanups.push(() => {
          const t = resizeTimersRef.current.get(sessionId);
          if (t) {
            window.clearTimeout(t);
            resizeTimersRef.current.delete(sessionId);
          }
        });

        const inst = xtermInstances.current.get(termId);
        if (inst) {
          const inheritedTermCleanup = inst.termCleanup;
          xtermInstances.current.set(termId, {
            ...inst,
            sessionId,
            sessionCleanup,
            termCleanup: inheritedTermCleanup,
            cleanup: (isReconnecting = false) => {
              // 成功路径：统一执行当前会话的清理函数（B1/B2）
              // closeShell 已在 cleanups 中（用 newSessionClosed 标志防重复关闭）
              // 先卸载事件订阅，再关闭远端 Shell，避免 close 事件在清理期间
              // 重新触发状态更新或重连。
              sessionCleanup();
              if (tabId) {
                sshService.unregisterTabSession(tabId, sessionId);
              }
              // 关键修复：右键菜单、鼠标滚轮、选中文本以及终端事件监听器属于 Terminal 实例级资源，
              // 只有在非重连场景（终端彻底关闭或组件卸载）时才予以移除；重连时必须保留！
              if (!isReconnecting) {
                inheritedTermCleanup?.();
              }
            },
          });
        }

        reconnectingRef.current.delete(termId);
        if (sessionId) {
          lastActivityTimesRef.current.set(sessionId, Date.now());
        }
        onShellReady?.();
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // 失败时逆序释放已收集的清理函数，防止订阅泄漏（B1/B2）
        cleanups.slice().reverse().forEach((fn) => {
          try {
            fn();
          } catch {
            // 忽略异常
          }
        });
        // 关键修复：重连失败时终端视图仍停留在当前界面，绝不能移除 DOM 监听器（右键菜单、复制、回车等），
        // 确保用户仍可右键复制错误信息或按回车重试
        xtermInfo.term.writeln(
          `\r\n\x1b[31m${t("tm_reconnect_failed")}: ${errMsg}\x1b[0m`,
        );
        xtermInfo.term.writeln(
          "\x1b[33m" + t("tm_disconnected_hint") + "\x1b[0m",
        );
        xtermInfo.term.focus();
        setTerminals((prev) => {
          const next = new Map(prev);
          const inst = next.get(termId);
          if (inst) {
            next.set(termId, { ...inst, status: "error", error: errMsg });
          }
          terminalsRef.current = next;
          return next;
        });
        reconnectingRef.current.delete(termId);
        onShellReady?.();
        // 自动重连失败：由全局 ReconnectManager 调度下一次尝试
        if (isAutoReconnect && !isTelnet && !isSerial) {
          reconnectManager.scheduleNextAttempt(serverId, errMsg, null);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      serverId,
      runMatchHints,
      broadcastToShells,
      server,
      onShellReady,
      writeShellOutput,
    ],
  );

  const reconnectTerminalRef = useLatestRef(reconnectTerminal);

  // 订阅全局统一 ReconnectManager，使终端内状态、重试倒计时与顶部工作台标签完全同步收敛
  useEffect(() => {
    if (!serverId) return;
    const isTelnet = server?.protocol === "telnet";
    const isSerial = server?.targetType === "serial" || server?.protocol === "serial";
    if (isTelnet || isSerial) return;

    let lastStatus = "";

    const unsubscribe = reconnectManager.subscribe(serverId, (state) => {
      if (isUnmountedRef.current) return;

      if (state.status === "countdown") {
        setTerminals((prev) => {
          const next = new Map(prev);
          prev.forEach((inst, tId) => {
            next.set(tId, {
              ...inst,
              status: "reconnecting",
              reconnectAttempt: state.attempt,
            });
          });
          terminalsRef.current = next;
          return next;
        });
      } else if (state.status === "reconnecting") {
        setTerminals((prev) => {
          const next = new Map(prev);
          prev.forEach((inst, tId) => {
            next.set(tId, {
              ...inst,
              status: "reconnecting",
              reconnectAttempt: state.attempt,
            });
          });
          terminalsRef.current = next;
          return next;
        });
        if (lastStatus !== "reconnecting") {
          xtermInstances.current.forEach(({ term }) => {
            term.writeln(`\r\n\x1b[90m${t("term_reconnecting_server")}\x1b[0m`);
          });
        }
      } else if (state.status === "exhausted") {
        setTerminals((prev) => {
          const next = new Map(prev);
          prev.forEach((inst, tId) => {
            next.set(tId, {
              ...inst,
              status: "error",
              error: state.error || t("term_auto_reconnect_failed"),
              reconnectAttempt: 0,
            });
          });
          terminalsRef.current = next;
          return next;
        });
        xtermInstances.current.forEach(({ term }) => {
          term.writeln(`\r\n\x1b[31m[${t("term_auto_reconnect_failed")}]\x1b[0m\r\n`);
        });
        toastRef.current.error(t("term_auto_reconnect_failed"));
      } else if (state.status === "idle") {
        // 如果服务器连接重新 Ready 且终端尚未恢复 Session，自动重连 Shell
        const serverState = useAppStore.getState().serverStates[serverId];
        if (serverState?.state === ConnectionState.Ready) {
          terminalsRef.current.forEach((inst, tId) => {
            if (!inst.sessionId && inst.status !== "connected") {
              reconnectTerminal(tId, true);
            }
          });
        }
      }
      lastStatus = state.status;
    });

    return () => {
      unsubscribe();
    };
  }, [serverId, server?.protocol, server?.targetType, reconnectTerminal, t]);

  // 初始化 xterm 和 SSH Shell
  const initTerminalAndShell = useCallback(
    async (termId: string, sId: string) => {
      console.log(
        `[Terminal Init] ${sId} initTerminalAndShell 开始, termId=${termId}, isUnmounted=${isUnmountedRef.current}`,
      );
      // 等待容器初始化并获得有效尺寸后再渲染终端
      const waitForStableContainer = (): Promise<HTMLDivElement | null> =>
        new Promise((resolve) => {
          let attempts = 0;
          const check = () => {
            if (isUnmountedRef.current || !terminalsRef.current.has(termId)) {
              resolve(null);
              return;
            }
            attempts++;
            // DOM 挂载异常时不能无限 requestAnimationFrame 空转；最多等待约
            // 2 秒，交给上层错误状态/重连流程处理，避免隐藏工作台长期占用主线程。
            if (attempts > 120) {
              resolve(null);
              return;
            }
            const el = termContainerRefs.current.get(termId);
            if (!el) {
              requestAnimationFrame(check);
              return;
            }
            const rect = el.getBoundingClientRect();
            // 只要容器在 DOM 中且具有基本尺寸即可初始化；若尝试超过 30 帧（约 500ms），只要 DOM 节点存在即强行初始化
            if ((rect.width > 50 && rect.height > 50) || attempts > 30) {
              resolve(el);
              return;
            }
            requestAnimationFrame(check);
          };
          check();
        });

      const container = await waitForStableContainer();
      console.log(
        `[Terminal Init] ${sId} container=${container ? "OK" : "NULL"}`,
      );
      if (!container) {
        // 容器不可用（组件卸载或终端被移除），仍需触发 onShellReady
        // 防止遮罩永久卡住
        console.log(
          `[Terminal Init] ${sId} container 不可用，调用 onShellReady 并返回`,
        );
        onShellReady?.();
        return;
      }

      // 收集创建过程中的清理函数，防止抛错导致订阅泄漏（B1/B2）
      // 在 initTerminalAndShell 最顶部声明，避免在前面的 addon 监听注册处触发 TDZ 错误
      const cleanups: Array<() => void> = [];
      const termCleanups: Array<() => void> = [];
      let termCleanupDone = false;
      const doTermCleanup = () => {
        if (termCleanupDone) return;
        termCleanupDone = true;
        termCleanups.slice().reverse().forEach((fn) => {
          try {
            fn();
          } catch {
            // 忽略异常
          }
        });
      };

      const containerRect = container.getBoundingClientRect();
      console.log(
        `[Terminal Init] ${sId} container 尺寸: ${containerRect.width}x${containerRect.height}`,
      );

      // 新建终端必须读取实时主题：该回调可能来自较早的 render，不能直接
      // 使用闭包中的 activeTheme，否则新开的终端会回退到旧主题。
      const themeAtInit = activeThemeRef.current;
      const bgAtInit = themeAtInit.background;
      const hasBgMediaAtInit = !!(bgAtInit?.image || bgAtInit?.videoPath);
      const bgOverlayAtInit = getTerminalBgOverlay(themeAtInit);

      // 创建 xterm 实例
      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: terminalFontSize,
        fontFamily: terminalFontFamily,
        allowProposedApi: true,
        scrollback: terminalScrollbackLinesRef.current,
        rightClickSelectsWord: true,
        // xterm 6 类型已移除 fastScrollModifier / bellStyle（运行时仍支持），经展开绕过多余属性检查
        ...(({ fastScrollModifier: "shift", bellStyle: (terminalBellSound ?? false) ? "sound" : "visual" }) as object),
        fastScrollSensitivity: 5,
        scrollSensitivity: 1,
        drawBoldTextInBrightColors: terminalDrawBoldInBrightColors ?? true,
        // minimumContrastRatio 设为 1（关闭逐字符相对亮度反色循环，日志高频倾泻时大幅减少 CPU 开销）
        minimumContrastRatio: 1,
        // 允许背景透明：themeToXtermTheme 在有背景图时把 background 降为半透明 rgba，
        // 必须开启 allowTransparency 才能让 xterm canvas 透出底层背景图 div。
        allowTransparency: true,
        // 滚动条宽度设为 10px，易于鼠标精准抓取拖动，且 fit 算法已自动扣除此宽度
        overviewRuler: { width: 10 },
        theme: themeToXtermTheme(themeAtInit),
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      console.log(`[Terminal Init] ${sId} term.open() 开始`);
      term.open(container);
      console.log(`[Terminal Init] ${sId} term.open() 完成`);

      // Shell integration 基础协议：支持 OSC 7 当前目录和 OSC 52 剪贴板。
      // 这些处理器只影响桌面端能力，不改变 SSH 原始数据流。
      const osc7Disposable = term.parser.registerOscHandler(7, (value) => {
        try {
          const raw = value.includes(";")
            ? value.slice(value.indexOf(";") + 1)
            : value;
          const uri = new URL(raw);
          const cwd = decodeURIComponent(uri.pathname || "/");
          recordTerminalCwd(termId, cwd);
          queueSessionEvent(termId, "cwd", { cwd });
        } catch {
          // 非标准 OSC 7 内容忽略，不影响终端输出
        }
        return false;
      });
      const updateShellTitle = (value: string) => {
        const title = value.trim();
        if (!title) return false;
        // 尝试从 shellTitle 中自动提取当前工作目录（兼容常见 Linux/Unix 发行版默认 PS1 标题）
        const extracted = extractPathFromShellTitle(title, homeDirRef.current);
        if (extracted) {
          recordTerminalCwd(termId, extracted);
        }
        queueSessionEvent(termId, "title", { title });
        setTerminals((prev) => {
          const current = prev.get(termId);
          if (!current || current.customName || current.shellTitle === title)
            return prev;
          const next = new Map(prev);
          next.set(termId, { ...current, shellTitle: title });
          terminalsRef.current = next;
          return next;
        });
        return false;
      };
      // OSC 0/2：Shell 可动态设置窗口标题，映射到当前终端标签但不覆盖用户重命名。
      const osc0Disposable = term.parser.registerOscHandler(
        0,
        updateShellTitle,
      );
      const osc2Disposable = term.parser.registerOscHandler(
        2,
        updateShellTitle,
      );
      const osc52Disposable = term.parser.registerOscHandler(52, (value) => {
        if (!terminalCopyPaste) return false;
        try {
          const encoded = value.slice(value.indexOf(";") + 1);
          if (!encoded || encoded === "?") return false;
          const bytes = Uint8Array.from(atob(encoded), (ch) =>
            ch.charCodeAt(0),
          );
          const text = new TextDecoder().decode(bytes);
          navigator.clipboard.writeText(text).catch(() => {});
        } catch {
          // 非法 Base64 或剪贴板权限不足时静默忽略
        }
        return false;
      });
      // OSC 133：记录命令边界、退出码、耗时，并创建可跳转的 xterm marker。
      const osc133Disposable = term.parser.registerOscHandler(133, (value) => {
        const marker = value.split(";")[0];
        const phase =
          marker === "A"
            ? "prompt"
            : marker === "B"
              ? "input"
              : marker === "C"
                ? "output"
                : marker === "D"
                  ? "finished"
                  : null;
        if (!phase) return false;
        const exitCode =
          marker === "D" ? Number(value.split(";")[1]) : undefined;
        const previous = shellIntegrationRef.current.get(termId);
        const command = pendingCommandRef.current.get(termId) ?? previous?.command;
        const startedAt = marker === "C" ? Date.now() : previous?.startedAt;
        const durationMs =
          marker === "D" && startedAt ? Math.max(0, Date.now() - startedAt) : undefined;
        shellIntegrationRef.current.set(termId, {
          phase,
          ...(Number.isFinite(exitCode) ? { exitCode } : {}),
          ...(startedAt ? { startedAt } : {}),
          ...(command ? { command } : {}),
          ...(typeof durationMs === "number" ? { durationMs } : {}),
        });
        if (marker === "C") {
          const xtermMarker = term.registerMarker(0);
          if (xtermMarker && command) {
            const entries = commandMarkersRef.current.get(termId) ?? [];
            entries.push({ marker: xtermMarker, command });
            while (entries.length > 200) entries.shift()?.marker.dispose();
            commandMarkersRef.current.set(termId, entries);
            setCommandMarkerVersion((version) => version + 1);
          }
          queueSessionEvent(termId, "command_start", {
            command: command ? redactCommandForSession(command) : undefined,
            cwd: terminalCwdRef.current.get(termId),
          });
        }
        if (marker === "D") {
          queueSessionEvent(termId, "command_end", {
            command: command ? redactCommandForSession(command) : undefined,
            exitCode: Number.isFinite(exitCode) ? exitCode : undefined,
            durationMs,
          });
          const entries = commandMarkersRef.current.get(termId);
          const last = entries?.at(-1);
          if (last && last.command === command) {
            last.exitCode = Number.isFinite(exitCode) ? exitCode : undefined;
            last.durationMs = durationMs;
            setCommandMarkerVersion((version) => version + 1);
          }
          pendingCommandRef.current.delete(termId);
        }
        if (phase === "finished" && Number.isFinite(exitCode)) {
          setTerminals((prev) => {
            const current = prev.get(termId);
            if (
              !current ||
              (current.lastExitCode === exitCode &&
                current.lastCommand === command &&
                current.lastCommandDurationMs === durationMs)
            )
              return prev;
            const next = new Map(prev);
            next.set(termId, {
              ...current,
              lastExitCode: exitCode,
              lastCommand: command,
              lastCommandDurationMs: durationMs,
            });
            terminalsRef.current = next;
            return next;
          });
        }
        return false;
      });
      termCleanups.push(
        () => osc7Disposable.dispose(),
        () => osc0Disposable.dispose(),
        () => osc2Disposable.dispose(),
        () => osc52Disposable.dispose(),
        () => osc133Disposable.dispose(),
      );

      // 新建终端的 term.open() 可能晚于背景同步 effect。此处在 xterm
      // DOM 已真实创建后再次绑定背景层，确保新增终端与首个终端一致。
      const syncNewTerminalBackground = () => {
        const xtermEl = container.querySelector(".xterm") as HTMLElement | null;
        if (!hasBgMediaAtInit) {
          container.classList.remove("has-bg-image");
          xtermEl?.classList.remove("has-bg-image");
          return;
        }
        container.classList.add("has-bg-image");
        xtermEl?.classList.add("has-bg-image");
        const size = bgAtInit?.size;
        const blur = bgAtInit?.blur;
        container.style.setProperty(
          "--xterm-bg-size",
          size === "contain" ? "contain" : size === "center" ? "auto" : "cover",
        );
        container.style.setProperty(
          "--xterm-bg-blur",
          blur && blur > 0 ? `${blur}px` : "0px",
        );
        container.style.setProperty("--xterm-bg-overlay", bgOverlayAtInit);
        container.style.setProperty(
          "--xterm-bg-image",
          bgAtInit?.image ? `url("${bgAtInit.image}")` : "none",
        );
        if (blur && blur > 0) container.setAttribute("data-bg-blur", "1");
        else container.removeAttribute("data-bg-blur");

        if (
          bgAtInit?.videoPath &&
          !container.querySelector(".xterm-bg-video")
        ) {
          const videoSrc = getVideoSrc(bgAtInit.videoPath);
          if (videoSrc) {
            const video = document.createElement("video");
            video.className = "xterm-bg-video";
            video.src = videoSrc;
            video.muted = true;
            video.autoplay = true;
            video.loop = true;
            video.playsInline = true;
            video.style.objectFit =
              size === "contain"
                ? "contain"
                : size === "center"
                  ? "none"
                  : "cover";
            if (blur && blur > 0) {
              video.style.filter = `blur(${blur}px)`;
              video.style.margin = `-${blur}px`;
            }
            container.insertBefore(video, container.firstChild);
          }
        }
      };
      syncNewTerminalBackground();
      requestAnimationFrame(syncNewTerminalBackground);

      // 强刷新 Xterm.js 字符尺寸测量与 fit()，确保字体完全就绪后字符宽度精准对齐鼠标点选网格
      // 避免因为 web font 延迟加载读到较窄的系统 fallback 字体尺寸，导致鼠标在首字右半部分按下时
      // 被 xterm 误判定为 col 1（导致从左向右框选时丢掉 col 0 首字，无法复制/粘贴首字）。
      // 注意：xterm.js 6.x 的 ICharSizeService 接口只有 measure()，没有 clear()。
      // 之前调用 clear() 因 typeof 检查不通过是 no-op，所以必须用 measure() 才能真正重新测量。
      const refreshCharSizeAndFit = () => {
        try {
          const core = getXtermCore(term);
          if (
            core &&
            core._charSizeService &&
            typeof core._charSizeService.measure === "function"
          ) {
            // measure() 在 width/height 变化时触发 onCharSizeChange → handleCharSizeChanged
            // → renderer 重建 dimensions 并 refresh；这是字体加载完成后修正尺寸的核心入口
            core._charSizeService.measure();
          }
          if (
            core &&
            core._renderService &&
            typeof core._renderService.clear === "function"
          ) {
            core._renderService.clear();
          }
          fitTerminalSafely(fitAddon, term);
        } catch { /* 重测/自适应失败可忽略 */ }
      };

      refreshCharSizeAndFit();

      if (typeof document !== "undefined" && document.fonts) {
        document.fonts.ready
          .then(() => {
            if (!isUnmountedRef.current) {
              refreshCharSizeAndFit();
            }
          })
          .catch(() => {});
      }

      requestAnimationFrame(() => {
        if (!isUnmountedRef.current) {
          refreshCharSizeAndFit();
        }
      });

      // 注册到全局 WebGL 渲染器协调器（受配额控制、LRU 动态置换与 Context Loss 熔断保护）
      // 确保活跃上下文严格控制在安全配额内（<= 8），可见终端优先拥有 WebGL，后台终端降级为 DOM，
      // 从根源上消除跨分屏/多标签场景下的 WebGL 争抢与 Context Loss 风暴。
      const hasFractionalDpr =
        typeof window !== "undefined" &&
        Math.abs(window.devicePixelRatio % 1) > 0.001;
      const isTermVisible =
        isVisible && (activeTermId === termId || activeTermId === null);

      terminalWebglManager.registerTerminal({
        termId,
        term,
        isVisible: isTermVisible,
        hasBgMedia: hasBgMediaAtInit,
        hasFractionalDpr,
      });

      termCleanups.push(() => {
        terminalWebglManager.unregisterTerminal(termId);
      });
      console.log(`[Terminal Init] ${sId} WebGL 渲染器协调管理初始化完成`);

      // 初始化异步分片检索器 (时间分片 8ms 调度，杜绝 10 万行搜索冻结)
      const asyncSearcher = new AsyncTerminalSearcher(term, (state) => {
        if (!isUnmountedRef.current && activeTermIdRef.current === termId) {
          setSearchState({
            resultIndex: state.resultIndex,
            resultCount: state.resultCount,
            isSearching: state.isSearching,
            isCapped: state.isCapped,
          });
        }
      });
      termCleanups.push(() => asyncSearcher.dispose());

      // 用户滚到底部后清除该终端的新输出计数；上滚期间不影响远端输出。
      // 注意：xterm.js 的 onScroll 回调参数类型是 IEvent<number>，直接传递 viewportY 位置值
      const scrollDisposable = term.onScroll((newPosition) => {
        if (newPosition >= term.buffer.active.baseY) {
          userScrolledUpRef.current.set(termId, false);
          const queued = outputWriteQueuesRef.current.get(termId);
          if (queued) {
            queued.wasScrolledUp = false;
            queued.viewportY = term.buffer.active.baseY;
          }
          if (pendingOutputCountsRef.current.has(termId)) {
            const next = new Map(pendingOutputCountsRef.current);
            next.delete(termId);
            pendingOutputCountsRef.current = next;
            setPendingOutputCounts(next);
          }
        }
      });
      termCleanups.push(() => scrollDisposable.dispose());

      // 终端级常驻兜底：若 DOM 级键盘拦截未捕获（如移动端虚拟键盘、IME 换行、剪贴板等），
      // 在断连状态下通过 onData 捕获回车并触发重连
      const fallbackDataDisposable = term.onData((data) => {
        if (useAppStore.getState().isAppLocked) return;
        const inst = terminalsRef.current.get(termId);
        const status = inst?.status;
        const currentSessionId = xtermInstances.current.get(termId)?.sessionId;
        const isDisconnected =
          !inst ||
          status === "disconnected" ||
          status === "error" ||
          status === "reconnecting" ||
          !currentSessionId ||
          !isConnectedRef.current;

        if (isDisconnected && !reconnectingRef.current.has(termId)) {
          if (data === "\r" || data === "\n") {
            onReconnectRef.current?.();
            void reconnectTerminalRef.current(termId);
          }
        }
      });
      termCleanups.push(() => fallbackDataDisposable.dispose());

      // 跨平台终端快捷键绑定：Windows/Linux 为 Ctrl+F / Ctrl+Shift+F 搜索，Ctrl+Shift+C/V 复制粘贴；Mac 为 Cmd+C/V/F
      term.attachCustomKeyEventHandler((event) => {
        if (event.type === "keydown") {
          // 若当前打开了搜索栏，在终端内按 Esc 优先关闭搜索栏（对标 VS Code / Windows Terminal 标准行为）
          if (event.key === "Escape" && showSearchRef.current) {
            event.preventDefault();
            event.stopPropagation();
            closeSearch();
            return false;
          }

          // 若当前打开了搜索栏，在终端内按 F3 / Shift+F3 无缝翻阅搜索匹配项（无需中断终端输入）
          if (event.key === "F3" && showSearchRef.current) {
            event.preventDefault();
            event.stopPropagation();
            if (event.shiftKey) {
              handleFindPrevRef.current();
            } else {
              handleFindNextRef.current();
            }
            return false;
          }

          // 若当前应用处于锁屏状态，拦截所有按键输入，阻止任何数据传输到远端
          if (useAppStore.getState().isAppLocked) {
            event.preventDefault();
            event.stopPropagation();
            return false;
          }

          // 断连 / 错误 / 重连中 / 未建立连接状态下按 Enter 触发重连（对标 Electerm / Tabby / FinalShell）
          if (
            (event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter") &&
            !event.shiftKey &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey
          ) {
            const inst = terminalsRef.current.get(termId);
            const status = inst?.status;
            const currentSessionId = xtermInstances.current.get(termId)?.sessionId;
            const isDisconnected =
              !inst ||
              status === "disconnected" ||
              status === "error" ||
              status === "reconnecting" ||
              !currentSessionId ||
              !isConnectedRef.current;

            if (isDisconnected) {
              event.preventDefault();
              event.stopPropagation();
              if (!reconnectingRef.current.has(termId)) {
                onReconnectRef.current?.();
                void reconnectTerminalRef.current(termId);
              }
              return false;
            }
          }

          // F11 切换终端全屏：xterm 默认会消费 F1-F12 功能键序列，
          const shortcutStore = useShortcutStore.getState();

          // 终端全屏切换（支持自定义快捷键，默认 F11）
          if (shortcutStore.matchesAction(event, "terminal.fullscreen") && onToggleFullscreen) {
            event.preventDefault();
            event.stopPropagation();
            onToggleFullscreen();
            return false;
          }

          // 终端离席锁屏快捷键（支持自定义，默认 Mod+Alt+L）
          if (shortcutStore.matchesAction(event, "app.lock")) {
            event.preventDefault();
            event.stopPropagation();
            handleTriggerAppLock();
            return false;
          }

          // 全局/标签页快捷键动态透传白名单（SkipShell 机制）：
          // 若命中了任一用户自定义的全局动作（如命令面板、新标签、关标签、切标签等），
          // 返回 false 阻止 xterm.js 捕获/消费，让原生 DOM 事件自由冒泡到 window 的全局快捷键监听器
          if (shortcutStore.isGlobalAction(event)) {
            return false;
          }

          const isMac = navigator.userAgent.includes("Mac");
          const isC = event.keyCode === 67 || event.code === "KeyC" || event.key?.toLowerCase() === "c";

          // 复制（支持自定义快捷键，默认 Win/Linux: Ctrl+Shift+C，Mac: Cmd+C）
          const isCopy = shortcutStore.matchesAction(event, "terminal.copy");
          if (isCopy) {
            event.preventDefault();
            event.stopPropagation();
            const selection = term.getSelection();
            if (selection) {
              try {
                navigator.clipboard.writeText(selection);
              } catch {
                /* ignore */
              }
            }
            term.clearSelection();
            return false;
          }

          // Windows/Linux 下 Ctrl+C，或者 Mac 下按 Control+C：立即发送中断 (SIGINT)。
          if (
            (!isMac && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && isC) ||
            (isMac && event.ctrlKey && !event.metaKey && isC)
          ) {
            // 关键保护 1：检查是否有非当前终端内部的文本选区（例如用户在 AI 助手、侧边栏、弹窗中选中了教程文本/内容）
            // 如果用户选中的是外部内容，Ctrl+C 必须作为复制处理，严禁发送 SIGINT 杀死终端命令！
            const winSelection = window.getSelection();
            const externalSelectedText = winSelection?.toString();
            if (externalSelectedText && externalSelectedText.length > 0) {
              const anchorNode = winSelection?.anchorNode;
              const focusNode = winSelection?.focusNode;
              const termEl = term.element;
              const isSelectionInThisTerm = Boolean(
                (anchorNode && termEl?.contains(anchorNode)) ||
                (focusNode && termEl?.contains(focusNode))
              );
              if (!isSelectionInThisTerm) {
                // 选区位于外部（如 AI 助手、侧边栏、文档弹窗），优先复制外部选区文本并放行
                try {
                  navigator.clipboard.writeText(externalSelectedText);
                } catch {
                  /* ignore */
                }
                return true;
              }
            }

            // 关键保护 2：若当前焦点处于非终端交互控件（如 AI 助手、搜索栏、弹窗输入框）内部，直接放行
            if (isInteractiveOrInputElement(document.activeElement)) {
              return true;
            }

            event.preventDefault();
            event.stopPropagation();
            handleSigint(termId);
            return false;
          }

          // 粘贴（支持自定义快捷键，默认 Win/Linux: Ctrl+Shift+V，Mac: Cmd+V）
          const isPaste = shortcutStore.matchesAction(event, "terminal.paste");
          if (isPaste) {
            event.preventDefault();
            event.stopPropagation();
            navigator.clipboard
              .readText()
              .then((text) => {
                const sid = xtermInstances.current.get(termId)?.sessionId;
                if (text && sid) {
                  // 通过统一入口粘贴，大文本时给出二次安全提示
                  pasteTextToShell(text, sid);
                }
              })
              .catch(() => {
                /* ignore */
              });
            term.focus();
            return false;
          }

          // 搜索（支持自定义快捷键，默认 Mod+F）
          const isSearch = shortcutStore.matchesAction(event, "terminal.search");
          if (isSearch) {
            event.preventDefault();
            event.stopPropagation();
            handleSearch();
            return false;
          }

          // Tab: 指令提示补全（参考 Warp/Fig 等成熟终端）
          // - Tab：补全选中项，补全后关闭提示框（不自动进入下一阶段）
          // - Enter：始终透传给 shell 执行命令，绝不补全
          //   用户诉求：输入 ls 后回车应执行 ls，而非被提示框补全成 lsof。
          //   补全统一由 Tab 负责，Enter 永远执行。
          if (event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.shiftKey) {
            const hints = cmdHintsRef.current;
            if (hints.length > 0) {
              // 无任何可用（非禁用）候选时不拦截 Tab，交还给远端 Shell 原生补全
              const hint = hints.find((h, i) => !h.disabled && i >= hintIndexRef.current)
                || hints.find(h => !h.disabled);
              if (!hint) {
                setCmdHints([]);
                setHintVisible(false);
                return true;
              }
              // Tab 补全选中项（跳过禁用项）
              event.preventDefault();
              const sid = xtermInstances.current.get(termId)?.sessionId;
              if (sid) {
                // Tab 补全不带尾随空格：补全后停留在当前 token，
                // 用户需手动按空格才会进入下一阶段（参数/子命令提示）。
                const {
                  insertText: rawInsert,
                  newInput: rawNewInput,
                  cursorBack,
                } = applyHint(currentInputRef.current, hint);
                const insertText = rawInsert.replace(/\s+$/, "");
                const newInput = rawNewInput.replace(/\s+$/, "");
                if (insertText) {
                  const moveLeft =
                    cursorBack && cursorBack > 0
                      ? "\x1b[D".repeat(cursorBack)
                      : "";
                  broadcastToShells(sid, insertText + moveLeft);
                  currentInputRef.current =
                    cursorBack && cursorBack > 0 && newInput.length >= cursorBack
                      ? newInput.slice(0, -cursorBack)
                      : newInput;
                  // Tab 补全成功反馈音（受全局音效开关控制）
                  playSound(SoundType.Complete);
                  // 补全后关闭提示框：避免立即弹出下一阶段提示干扰用户
                  setCmdHints([]);
                  setHintVisible(false);
                } else {
                  setCmdHints([]);
                  setHintVisible(false);
                }
              }
              return false;
            }
          }
          // 上下键：提示框存在时翻阅提示项，提示框不存在时透传给 shell 翻历史。
          // 配合 silent 模式（调历史不弹提示），两者互不干扰：
          // - 用户主动输入字符 → 弹提示 → 上下键翻提示项
          // - 用户按↑↓调历史 → silent 不弹提示 → 上下键透传翻历史
          if (cmdHintsRef.current.length > 0) {
            if (event.key === "ArrowUp") {
              const hints = cmdHintsRef.current;
              // 防御性：idx 越界时先归零（理论上不会越界，但快速切换 cmdHints 时有一瞬间可能）
              const idx = Math.min(hintIndexRef.current, hints.length - 1);
              // 向上查找下一个非禁用项（跳过 disabled，避免高亮到不可用项）
              let next = -1;
              for (let i = idx - 1; i >= 0; i -= 1) {
                if (!hints[i].disabled) { next = i; break; }
              }
              if (next < 0) {
                for (let i = hints.length - 1; i > idx; i -= 1) {
                  if (!hints[i].disabled) { next = i; break; }
                }
              }
              if (next >= 0) {
                // 同步更新 ref，防止快速连按时 useEffect 未及时同步导致跳步
                hintIndexRef.current = next;
                setHintIndex(next);
              }
              return false; // 拦截，翻提示项
            }
            if (event.key === "ArrowDown") {
              const hints = cmdHintsRef.current;
              const idx = Math.min(hintIndexRef.current, hints.length - 1);
              // 向下查找下一个非禁用项
              let next = -1;
              for (let i = idx + 1; i < hints.length; i += 1) {
                if (!hints[i].disabled) { next = i; break; }
              }
              if (next < 0) {
                for (let i = 0; i < idx; i += 1) {
                  if (!hints[i].disabled) { next = i; break; }
                }
              }
              if (next >= 0) {
                hintIndexRef.current = next;
                setHintIndex(next);
              }
              return false; // 拦截，翻提示项
            }
            // Esc 关闭提示
            if (event.key === "Escape") {
              setCmdHints([]);
              setHintVisible(false);
              return false;
            }
          }
        }
        return true;
      });

      // 右键菜单
      const contextMenuHandler = (e: Event) => {
        e.preventDefault();
        setSelectionToolbar(null);
        const selection = term.getSelection();
        const hasSelection = !!selection;

        // 如果启用了选中文本自动复制 & 右击粘贴
        if (useAppStore.getState().terminalCopyPaste ?? false) {
          if (hasSelection) {
            navigator.clipboard.writeText(selection);
          } else {
            navigator.clipboard
              .readText()
              .then((text) => {
                const sessId = xtermInstances.current.get(termId)?.sessionId;
                if (sessId && text) {
                  // E3：通过统一入口粘贴，大文本时给出 toast.warning 提示
                  pasteTextToShell(text, sessId);
                }
              })
              .catch((err) => console.warn("Failed to read clipboard:", err));
          }
          return;
        }

        // 触发自定义事件通知 React 显示菜单
        const containerEl = terminalContainerRef.current;
        if (containerEl) {
          containerEl.dispatchEvent(
            new CustomEvent("terminal-contextmenu", {
              bubbles: true,
              detail: {
                x: (e as MouseEvent).clientX,
                y: (e as MouseEvent).clientY,
                hasSelection,
              },
            }),
          );
        }
      };
      container.addEventListener("contextmenu", contextMenuHandler);
      // DOM 监听器加入 termCleanups，确保仅在终端彻底销毁/卸载时移除（重连时保持活跃）
      termCleanups.push(() =>
        container.removeEventListener("contextmenu", contextMenuHandler),
      );

      // 精准计算划词快捷工具条的锚定坐标：
      // 1. 若鼠标在容器可视区内释放，直接以鼠标落下的坐标为准（顺应用户操作直觉）
      // 2. 若鼠标拖拽超出应用窗口或容器边界：
      //    - 从左向右拖拽（正向）：智能锚定在终端选区终点（右侧）或容器右边界
      //    - 从右向左拖拽（反向）：智能锚定在终端选区起点（左侧）或容器左边界
      const getSelectionAnchorCoordinates = (
        fallbackX: number,
        fallbackY: number,
        isForward: boolean,
      ): { x: number; y: number } => {
        const containerRect = container.getBoundingClientRect();

        // 检查鼠标释放点是否在终端容器内（留 5px 边缘宽容度）
        const isWithinContainer =
          fallbackX >= containerRect.left - 5 &&
          fallbackX <= containerRect.right + 5 &&
          fallbackY >= containerRect.top - 5 &&
          fallbackY <= containerRect.bottom + 5;

        // 如果鼠标在终端容器内部释放，严格以鼠标落下的位置为准！
        if (isWithinContainer) {
          return {
            x: Math.max(
              containerRect.left + 10,
              Math.min(fallbackX, containerRect.right - 10),
            ),
            y: Math.max(
              containerRect.top + 10,
              Math.min(fallbackY, containerRect.bottom - 10),
            ),
          };
        }

        // 仅当鼠标滑出应用窗口或容器边界时，根据划选方向（正向/反向）智能锚定选区端点
        try {
          const selRange = term.getSelectionPosition();
          if (selRange) {
            const screenEl = container.querySelector(
              ".xterm-screen",
            ) as HTMLElement | null;
            const screenRect =
              screenEl?.getBoundingClientRect() ?? containerRect;
            const cellWidth = screenRect.width / Math.max(1, term.cols);
            const cellHeight = screenRect.height / Math.max(1, term.rows);
            const viewportY = term.buffer.active.viewportY ?? 0;

            // 正向划选（从前往后）取 end；反向划选（从后往前）取 start
            const targetPos = isForward ? selRange.end : selRange.start;
            const lineInViewport = targetPos.y - viewportY;

            if (lineInViewport >= 0 && lineInViewport < term.rows) {
              const x = screenRect.left + targetPos.x * cellWidth;
              const y = screenRect.top + lineInViewport * cellHeight;
              const clampedX = Math.max(
                containerRect.left + 10,
                Math.min(x, containerRect.right - 10),
              );
              const clampedY = Math.max(
                containerRect.top + 10,
                Math.min(y, containerRect.bottom - 10),
              );
              return { x: clampedX, y: clampedY };
            }
          }
        } catch {
          /* fallback */
        }

        // 兜底夹紧
        const clampedX = Math.max(
          containerRect.left + 10,
          Math.min(fallbackX, containerRect.right - 10),
        );
        const clampedY = Math.max(
          containerRect.top + 10,
          Math.min(fallbackY, containerRect.bottom - 10),
        );
        return { x: clampedX, y: clampedY };
      };

      // 追踪当前终端是否处于鼠标左键划选状态及起始坐标
      let isSelectingThisTerm = false;
      const mouseDownPosRef = { x: 0, y: 0 };

      // 鼠标按下时清除快捷工具条并标记划选开始
      const mouseDownHandler = (e: MouseEvent) => {
        if (e.button === 0) {
          isSelectingThisTerm = true;
          mouseDownPosRef.x = e.clientX;
          mouseDownPosRef.y = e.clientY;
          if (selectionTimerRef.current !== null) {
            clearTimeout(selectionTimerRef.current);
            selectionTimerRef.current = null;
          }
          setSelectionToolbar(null);
        }
      };
      container.addEventListener("mousedown", mouseDownHandler);
      termCleanups.push(() =>
        container.removeEventListener("mousedown", mouseDownHandler),
      );

      // 统一唤起划词工具条函数
      const triggerSelectionToolbar = (
        fallbackX: number,
        fallbackY: number,
        isForward: boolean = true,
      ) => {
        if (isUnmountedRef.current) return;
        if (ctxMenuRef.current) return;

        if (useAppStore.getState().terminalCopyPaste ?? false) {
          const selection = term.getSelection();
          if (selection) {
            navigator.clipboard.writeText(selection);
          }
        }

        if (terminalSelectionToolbarRef.current) {
          if (selectionTimerRef.current !== null) {
            clearTimeout(selectionTimerRef.current);
          }
          selectionTimerRef.current = window.setTimeout(() => {
            selectionTimerRef.current = null;
            if (isUnmountedRef.current) return;
            // 关键防护 2：如果当前右键菜单已经打开，绝对不弹划词工具条
            if (ctxMenuRef.current) return;

            const sel = term.getSelection();
            if (sel && sel.trim().length > 0) {
              const coords = getSelectionAnchorCoordinates(
                fallbackX,
                fallbackY,
                isForward,
              );
              setSelectionToolbar({
                visible: true,
                x: coords.x,
                y: coords.y,
                text: sel,
              });
            } else {
              setSelectionToolbar(null);
            }
          }, 25);
        }
      };

      // 鼠标抬起时处理自动复制与划词快捷工具条（全局 window 监听，防止拖出容器或拖出窗口释放时漏判）
      const globalMouseUpHandler = (e: MouseEvent) => {
        if (!isSelectingThisTerm) return;
        isSelectingThisTerm = false;

        // 仅允许鼠标左键（button === 0）触发划词快捷条！右键或中键抬起时不触发
        if (e.button !== 0) {
          if (selectionTimerRef.current !== null) {
            clearTimeout(selectionTimerRef.current);
            selectionTimerRef.current = null;
          }
          setSelectionToolbar(null);
          return;
        }

        const isForward =
          e.clientX !== mouseDownPosRef.x
            ? e.clientX > mouseDownPosRef.x
            : e.clientY >= mouseDownPosRef.y;

        triggerSelectionToolbar(e.clientX, e.clientY, isForward);
      };
      window.addEventListener("mouseup", globalMouseUpHandler);
      termCleanups.push(() =>
        window.removeEventListener("mouseup", globalMouseUpHandler),
      );

      // 兜底监听 1：鼠标拖拽出应用并在外部松开后移动回窗口（buttons === 0 时意味着左键已释放）
      const globalMouseMoveHandler = (e: MouseEvent) => {
        if (isSelectingThisTerm && e.buttons === 0) {
          isSelectingThisTerm = false;
          const isForward =
            e.clientX !== mouseDownPosRef.x
              ? e.clientX > mouseDownPosRef.x
              : e.clientY >= mouseDownPosRef.y;
          triggerSelectionToolbar(e.clientX, e.clientY, isForward);
        }
      };
      window.addEventListener("mousemove", globalMouseMoveHandler);
      termCleanups.push(() =>
        window.removeEventListener("mousemove", globalMouseMoveHandler),
      );

      // 兜底监听 2：鼠标一直向左/向右滑出整个应用窗口边界时，立即触发已划选文本的快捷弹框
      const documentMouseLeaveHandler = (e: MouseEvent) => {
        if (isSelectingThisTerm) {
          isSelectingThisTerm = false;
          const isForward =
            e.clientX !== mouseDownPosRef.x
              ? e.clientX > mouseDownPosRef.x
              : e.clientY >= mouseDownPosRef.y;
          triggerSelectionToolbar(e.clientX, e.clientY, isForward);
        }
      };
      document.documentElement.addEventListener(
        "mouseleave",
        documentMouseLeaveHandler,
      );
      termCleanups.push(() =>
        document.documentElement.removeEventListener(
          "mouseleave",
          documentMouseLeaveHandler,
        ),
      );

      // Ctrl / Cmd + Mouse Wheel 动态缩放终端字号
      const wheelHandler = (e: WheelEvent) => {
        setCtxMenu(null);
        if (selectionTimerRef.current !== null) {
          clearTimeout(selectionTimerRef.current);
          selectionTimerRef.current = null;
        }
        setSelectionToolbar(null);
        const isMac = navigator.userAgent.includes("Mac");
        const hasModifier = e.ctrlKey || (isMac && e.metaKey);
        if (hasModifier) {
          e.preventDefault();
          e.stopPropagation(); // 阻止事件继续下发到 Xterm.js 核心元素，防止触发滚动
          const setSize = useAppStore.getState().setTerminalFontSize;
          if (e.deltaY < 0) {
            setSize((prev: number) => prev + 1);
          } else {
            setSize((prev: number) => prev - 1);
          }
        } else {
          // 滚动事件自愈保护：如果检测到 SmoothScrollableElement 尺寸失步或 scrollHeight <= height（但 buffer 实际上有多行）
          // 则立即同步 scrollableElement 尺寸与位置，防止滚轮事件被 validateScrollPosition 锁死丢弃
          const core = (term as any)._core;
          const viewport = core?._viewport;
          const scrollable = viewport?._scrollableElement?._scrollable;
          const buf = term.buffer?.active;
          if (scrollable?._state && buf) {
            const { height, scrollHeight } = scrollable._state;
            const total = buf.length || (buf as any).lines?.length || 0;
            if (scrollHeight <= height && total > term.rows) {
              syncTerminalScrollAndDimensions(term);
            }
          }

          if (e.deltaY < 0) {
            // 用户主动向上翻阅历史，才标记 userScrolledUp
            userScrolledUpRef.current.set(termId, true);
          } else if (e.deltaY > 0) {
            // 向下滚动，若已到达最底部则立即清除上滚标记和新输出提示
            if (typeof requestAnimationFrame === "function") {
              requestAnimationFrame(() => {
                const buffer = term.buffer?.active;
                if (buffer && buffer.viewportY >= buffer.baseY - 1) {
                  userScrolledUpRef.current.set(termId, false);
                  if (pendingOutputCountsRef.current.has(termId)) {
                    const next = new Map(pendingOutputCountsRef.current);
                    next.delete(termId);
                    pendingOutputCountsRef.current = next;
                    setPendingOutputCounts(next);
                  }
                }
              });
            }
          }
        }
      };
      container.addEventListener("wheel", wheelHandler, {
        capture: true,
        passive: false,
      });
      termCleanups.push(() =>
        container.removeEventListener("wheel", wheelHandler, {
          capture: true,
        } as EventListenerOptions),
      );
      termCleanups.push(() => {
        outputWriteQueuesRef.current.delete(termId);
        outputWriteInFlightRef.current.delete(termId);
        xtermPendingCharsRef.current.delete(termId);
      });

      // 等待一帧并等待字体加载完成，以防 Xterm 字符尺寸测量偏差导致汉字挤压
      console.log(`[Terminal Init] ${sId} 等待 rAF + 字体加载`);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      try {
        if (document.fonts && typeof document.fonts.load === "function") {
          console.log(`[Terminal Init] ${sId} document.fonts.load 开始`);
          // 用实际字号加载字体：xterm 用 terminalFontSize 测量 cellWidth，
          // 之前用 12px 加载可能与实际字号字体不同步（不同字号的字形 hinting 略有差异）
          await document.fonts.load(
            `${terminalFontSize}px ${terminalFontFamily}`,
          );
          console.log(`[Terminal Init] ${sId} document.fonts.load 完成`);
        }
      } catch (e) {
        console.warn(`[Terminal Init] ${sId} document.fonts.load 异常:`, e);
      }

      // await 后检查组件是否已卸载，防止泄漏 xterm 实例和 Shell 会话
      if (isUnmountedRef.current) {
        term.dispose();
        cleanups.slice().reverse().forEach((fn) => {
          try {
            fn();
          } catch {
            // 忽略异常
          }
        });
        doTermCleanup();
        return;
      }

      // 字体加载完成后强制 xterm.js 重新测量字符尺寸，修正初次测量可能用到的 fallback 字体宽度。
      // 之前用 clear() 是 no-op（ICharSizeService 接口只有 measure()），导致后续不重新测量，
      // selection 起点偏移、第一个字符选中后视觉不高亮且 getSelection() 丢失。
      try {
        const core = getXtermCore(term);
        if (
          core &&
          core._charSizeService &&
          typeof core._charSizeService.measure === "function"
        ) {
          core._charSizeService.measure();
        }
        if (
          core &&
          core._renderService &&
          typeof core._renderService.clear === "function"
        ) {
          core._renderService.clear();
        }
      } catch {
        // ignore
      }

      try {
        console.log(`[Terminal Init] ${sId} fitAddon.fit() 开始`);
        fitTerminalSafely(fitAddon, term);
        console.log(`[Terminal Init] ${sId} fitAddon.fit() 完成`);
      } catch (e) {
        console.warn("[Terminal] Initial fit failed:", e);
      }

      console.log(
        `[Terminal Init] ${sId} xtermInstances.set, cols=${term.cols}, rows=${term.rows}`,
      );
      xtermInstances.current.set(termId, {
        term,
        fitAddon,
        asyncSearcher,
        termCleanup: doTermCleanup,
      });

      // 等待用户补充/修正认证时仍保留完整的 xterm 界面，并把状态写入终端缓冲区。
      // 此路径只创建本地终端，不发起 SSH，也不会触发后台重连；凭据验证成功后
      // isConnected effect 会复用当前 xterm，通过 reconnectTerminal 创建真实 Shell。
      if (connectionBlocked) {
        const currentServer = server || useAppStore.getState().servers.find((s) => s.id === baseServerId);
        const host = currentServer?.host;
        const port = currentServer?.port || 22;
        const username = currentServer?.username || t("ssh_credential_username");
        const noticeKey = connectionBlockedReason || "missing";
        const notice = connectionBlockedReason === "rejected"
          ? t("tm_auth_rejected_terminal")
          : t("tm_auth_required_terminal");
        if (host) {
          term.writeln(`\x1b[90mConnecting to ${username}@${host}:${port}...\x1b[0m`);
        } else {
          term.writeln(`\x1b[90mConnecting to ${username}...\x1b[0m`);
        }
        term.writeln(
          `${connectionBlockedReason === "rejected" ? "\x1b[31m" : "\x1b[33m"}${notice}\x1b[0m`,
        );
        term.writeln(
          "\x1b[33m" + t("tm_disconnected_hint") + "\x1b[0m",
        );
        term.focus();
        blockedNoticeRef.current.set(termId, noticeKey);
        setTerminals((prev) => {
          const next = new Map(prev);
          const inst = next.get(termId);
          if (inst) {
            next.set(termId, {
              ...inst,
              status: connectionBlockedReason === "rejected" ? "error" : "disconnected",
              error: notice,
            });
          }
          terminalsRef.current = next;
          return next;
        });
        const localInstance = xtermInstances.current.get(termId);
        if (localInstance) {
          xtermInstances.current.set(termId, {
            ...localInstance,
            termCleanup: doTermCleanup,
            cleanup: (isReconnecting = false) => {
              // 从本地等待认证状态切换到真实 Shell 时必须保留 xterm 的
              // 搜索、右键、快捷键和背景监听；关闭/卸载时才完整清理。
              if (isReconnecting) return;
              cleanups.slice().reverse().forEach((cleanup) => {
                try { cleanup(); } catch { /* 忽略异常 */ }
              });
              doTermCleanup();
            },
          });
        }
        onShellReady?.();
        return;
      }

      // 用 xterm 实际尺寸创建 Shell，避免 PTY 与终端尺寸不匹配导致内容重复/错位
      let cols = term.cols > 0 ? term.cols : 80;
      let rows = term.rows > 0 ? term.rows : 24;

      // 创建 Shell 会话（SSH 或 Telnet）
      try {
        let sessionId: string;
        let bannerText: string | undefined;

        const currentServer = server || useAppStore.getState().servers.find((s) => s.id === baseServerId);
        const host = currentServer?.host;
        const port = currentServer?.port || 22;
        const username = currentServer?.username || "root";
        const isTelnet = currentServer?.protocol === "telnet";
        const isSerial = currentServer?.targetType === "serial" || currentServer?.protocol === "serial";

        if (isSerial) {
          // ===== Serial 串口路径：直连本地/USB串口硬件，跳过 SSH 与 MOTD =====
          let serialCfg: SerialOpenConfig = {
            portName: host || "COM1",
            baudRate: currentServer?.port || 115200,
            dataBits: 8,
            stopBits: 1,
            parity: "none",
            flowControl: "none",
            dtr: true,
            rts: true,
            encoding: terminalEncoding || "utf-8",
          };
          if (currentServer?.serialConfig) {
            try {
              const parsed = JSON.parse(currentServer.serialConfig);
              serialCfg = { ...serialCfg, ...parsed };
            } catch {
              // 忽略异常
            }
          }

          term.writeln(
            `\x1b[90m正在打开串口 ${serialCfg.portName} (${serialCfg.baudRate} baud, ${serialCfg.dataBits}${serialCfg.parity?.[0]?.toUpperCase() ?? ''}${serialCfg.stopBits})...\x1b[0m`,
          );
          console.log(
            `[Terminal Init] ${sId} 调用 sshService.createSerialShell(port=${serialCfg.portName}, baud=${serialCfg.baudRate})...`,
          );
          const result = await sshService.createSerialShell(
            sId,
            serialCfg.portName,
            serialCfg.baudRate,
            serialCfg.dataBits,
            serialCfg.stopBits,
            serialCfg.parity,
            serialCfg.flowControl,
            serialCfg.dtr,
            serialCfg.rts,
            serialCfg.encoding || terminalEncoding,
            serialCfg.deviceVid,
            serialCfg.devicePid,
            serialCfg.deviceSerialNumber,
          );
          console.log(
            `[Terminal Init] ${sId} createSerialShell 返回: success=${result.success}, sessionId=${result.sessionId?.slice(0, 8) ?? "none"}`,
          );

          if (isUnmountedRef.current) {
            if (result.success && result.sessionId) {
              sshService.closeShell(result.sessionId).catch(() => {});
            }
            throw new Error("Component unmounted during createSerialShell");
          }

          if (!result.success || !result.sessionId) {
            setTerminals((prev) => {
              const next = new Map(prev);
              const inst = next.get(termId);
              if (inst) {
                next.set(termId, {
                  ...inst,
                  status: "error",
                  error: result.error || "无法打开串口",
                });
              }
              terminalsRef.current = next;
              return next;
            });
            term.writeln(
              `\r\n\x1b[31mError: ${result.error || "无法打开串口"}\x1b[0m`,
            );
            term.writeln(
              "\x1b[33m" + t("tm_disconnected_hint") + "\x1b[0m",
            );
            term.focus();
            onShellReady?.();
            cleanups.slice().reverse().forEach((fn) => {
              try {
                fn();
              } catch {
                // 忽略异常
              }
            });
            return;
          }
          sessionId = result.sessionId;
          useAppStore.getState().setServerState(sId, ConnectionState.Ready);
          if (baseServerId && baseServerId !== sId) {
            useAppStore.getState().setServerState(baseServerId, ConnectionState.Ready);
          }
        } else if (isTelnet) {
          // ===== Telnet 路径：直接 TCP+Telnet 连接，跳过 SSH 底层连接与 MOTD =====
          term.writeln(
            `\x1b[90mConnecting to ${host}:${port} (Telnet)...\x1b[0m`,
          );
          console.log(
            `[Terminal Init] ${sId} 调用 sshService.createTelnetShell(host=${host}, port=${port})...`,
          );
          const result = await sshService.createTelnetShell(
            sId,
            host ?? "",
            port,
            cols,
            rows,
            15,
            terminalEncoding,
          );
          console.log(
            `[Terminal Init] ${sId} createTelnetShell 返回: success=${result.success}, sessionId=${result.sessionId?.slice(0, 8) ?? "none"}`,
          );

          if (isUnmountedRef.current) {
            if (result.success && result.sessionId) {
              sshService.closeShell(result.sessionId).catch(() => {});
            }
            throw new Error("Component unmounted during createTelnetShell");
          }

          if (!result.success || !result.sessionId) {
            setTerminals((prev) => {
              const next = new Map(prev);
              const inst = next.get(termId);
              if (inst) {
                next.set(termId, {
                  ...inst,
                  status: "error",
                  error: result.error || t("tm_err_shell"),
                });
              }
              terminalsRef.current = next;
              return next;
            });
            term.writeln(
              `\r\n\x1b[31mError: ${result.error || t("tm_err_shell")}\x1b[0m`,
            );
            term.writeln(
              "\x1b[33m" + t("tm_disconnected_hint") + "\x1b[0m",
            );
            term.focus();
            onShellReady?.();
            cleanups.slice().reverse().forEach((fn) => {
              try {
                fn();
              } catch {
                // 忽略异常
              }
            });
            return;
          }
          sessionId = result.sessionId;
        } else {
          // ===== SSH 路径：原有逻辑 =====
          if (host) {
            term.writeln(
              `\x1b[90mConnecting to ${username}@${host}:${port}...\x1b[0m`,
            );
          } else {
            term.writeln(
              `\x1b[90mConnecting to server...\x1b[0m`,
            );
          }

          // 确保 SSH 底层连接存在（若已连接，后端会立即返回 Ok）
          console.log(`[Terminal Init] ${sId} 调用 sshService.connect...`);
          const connResult = await sshService.connect(sId);
          console.log(
            `[Terminal Init] ${sId} sshService.connect 返回: success=${connResult.success}`,
          );

          // await 后检查卸载，防止创建出无人管理的 Shell 会话
          if (isUnmountedRef.current) {
            console.log(
              `[Terminal Init] ${sId} 组件已卸载（connect 后），抛出异常`,
            );
            throw new Error("Component unmounted during connect");
          }
          if (!connResult.success) {
            term.writeln(
              `\r\n\x1b[31mConnection failed: ${connResult.error || "Unknown error"}\x1b[0m`,
            );
            term.writeln(
              "\x1b[33m" + t("tm_disconnected_hint") + "\x1b[0m",
            );
            term.focus();
            onShellReady?.();
            throw new Error(connResult.message || t("tm_err_ssh"));
          }

          // 连接建立后重新 fit 并更新尺寸，确保传递给后端 PTY 的 rows/cols 绝对准确
          try {
            fitTerminalSafely(fitAddon, term);
            if (term.cols > 0) cols = term.cols;
            if (term.rows > 0) rows = term.rows;
          } catch { /* 测量失败时沿用默认 cols/rows */ }

          console.log(
            `[Terminal Init] ${sId} 调用 sshService.createShell(cols=${cols}, rows=${rows})...`,
          );
          const result = await sshService.createShell(
            sId,
            cols,
            rows,
            terminalEncoding,
          );
          console.log(
            `[Terminal Init] ${sId} createShell 返回: success=${result.success}, sessionId=${result.sessionId?.slice(0, 8) ?? "none"}`,
          );

          // await 后检查卸载，防止注册订阅到已卸载的组件
          if (isUnmountedRef.current) {
            if (result.success && result.sessionId) {
              sshService.closeShell(result.sessionId).catch(() => {});
            }
            throw new Error("Component unmounted during createShell");
          }

          if (!result.success || !result.sessionId) {
            setTerminals((prev) => {
              const next = new Map(prev);
              const inst = next.get(termId);
              if (inst) {
                next.set(termId, {
                  ...inst,
                  status: "error",
                  error: result.error || t("tm_err_shell"),
                });
              }
              terminalsRef.current = next;
              return next;
            });
            term.writeln(
              `\r\n\x1b[31mError: ${result.error || t("tm_err_shell")}\x1b[0m`,
            );
            term.writeln(
              "\x1b[33m" + t("tm_disconnected_hint") + "\x1b[0m",
            );
            term.focus();
            onShellReady?.();
            cleanups.slice().reverse().forEach((fn) => {
              try {
                fn();
              } catch {
                // 忽略异常
              }
            });
            return;
          }
          sessionId = result.sessionId;
          bannerText = result.banner;
          // 新建 shell 的 PWD 是 home：清掉可能残留的旧 cwd（同 termId 复用场景），
          // 避免相对路径补全列到上一个会话的目录。
          terminalCwdRef.current.delete(termId);
        }

        // 关键修复：createShell 成功后立即将 closeShell 加入 cleanups，
        // 确保后续任何路径（isUnmounted/异常/catch）都能关闭 session 防止泄漏。
        // 用 sessionClosed 标志防止成功路径的 cleanup 重复关闭。
        let sessionClosed = false;
        cleanups.push(() => {
          if (sessionClosed) return;
          sessionClosed = true;
          sshService.closeShell(sessionId).catch(() => {});
        });
        let sessionCleanupDone = false;
        const sessionCleanup = () => {
          if (sessionCleanupDone) return;
          sessionCleanupDone = true;
          // 断连/关闭：使所有 in-flight 的路径/动态补全请求失效（resolve 后会被版本号丢弃）；
          // 若该会话属于当前活跃终端，同时清掉补全面板状态，避免旧补全列表残留到新会话。
          pathFetchIdRef.current += 1;
          if (termId === activeTermIdRef.current) {
            setCmdHints([]);
            setHintVisible(false);
            setHintLoading(false);
            if (hintLoadingTimerRef.current !== null) {
              window.clearTimeout(hintLoadingTimerRef.current);
              hintLoadingTimerRef.current = null;
            }
          }
          const current = xtermInstances.current.get(termId);
          if (current?.term) discardPendingXtermWrites(current.term);
          outputWriteQueuesRef.current.delete(termId);
          outputWriteInFlightRef.current.delete(termId);
          // 取消串口延迟发送队列，防止某次挂起阻塞后续输入
          clearSerialWriteQueue(sessionId);
          xtermPendingCharsRef.current.delete(termId);
          serialPausedOutputRef.current.delete(termId);
          const resizeTimer = resizeTimersRef.current.get(sessionId);
          if (resizeTimer) {
            window.clearTimeout(resizeTimer);
            resizeTimersRef.current.delete(sessionId);
          }
          pausedShellsRef.current.delete(sessionId);
          sigintActiveUntilRef.current.delete(sessionId);
          sigintDroppedCharsRef.current.delete(sessionId);
          lastActivityTimesRef.current.delete(sessionId);
          discardedShellOutputThroughRef.current.delete(sessionId);
          const zmodem = zmodemSessionsRef.current.get(sessionId);
          if (zmodem) {
            try { zmodem.session.abort?.(); } catch { /* session may already be closed */ }
            zmodemSessionsRef.current.delete(sessionId);
            void sshService.shellZmodemEnd(sessionId).catch(() => {});
          }
          zmodemSentriesRef.current.delete(sessionId);
          cleanups.slice().reverse().forEach((fn) => {
            try {
              fn();
            } catch {
              // 忽略重复/异常清理
            }
          });
          if (tabId) {
            sshService.unregisterTabSession(tabId, sessionId);
          }
          if (current?.sessionId === sessionId) {
            xtermInstances.current.set(termId, {
              ...current,
              sessionId: undefined,
            });
          }
        };

        term.writeln(`\x1b[32mConnection established.\x1b[0m\r\n`);

        // Send the initial command (e.g. docker exec) after the shell is ready
        if (initialCommand) {
          sshService.writeToShell(sessionId, initialCommand + "\r");
        }

        onShellReady?.();

        // 保存 sessionId 到 xtermInstances，供复制粘贴事件使用
        const xinst = xtermInstances.current.get(termId);
        if (xinst) xtermInstances.current.set(termId, { ...xinst, sessionId });

        // 注册到 tab 会话管理（拖拽迁移时通过 tabId 获取会话列表）
        if (tabId) {
          sshService.registerTabSession(tabId, sessionId);
        }

        setTerminals((prev) => {
          const next = new Map(prev);
          const inst = next.get(termId);
          if (inst) {
            next.set(termId, {
              ...inst,
              sessionId,
              status: "connected",
              reconnectAttempt: 0,
              autoReconnect: true,
            });
          }
          terminalsRef.current = next;
          return next;
        });

        // 统一的安全无竞态 Shell 输出监听与历史获取流
        let historyWritten = false;
        let pendingBuffer = "";

        // 监听 Shell 输出
        const unsubscribe = sshService.onShellOutput((data) => {
          if (data.sessionId === sessionId) {
            const discardedThrough =
              discardedShellOutputThroughRef.current.get(sessionId) ?? 0;
            if (
              typeof data.sequence === "number" &&
              data.sequence <= discardedThrough
            ) {
              return;
            }
            lastActivityTimesRef.current.set(sessionId, Date.now());
            // 高亮已移至 writeTerminalOutput 帧冲刷处（合并后执行一次），此处透传原始文本
            if (!historyWritten) {
              pendingBuffer += data.data;
              // C6：限制 pendingBuffer 长度，防止历史加载期间无限增长
              if (pendingBuffer.length > MAX_PENDING_BUFFER) {
                pendingBuffer = pendingBuffer.slice(-MAX_PENDING_BUFFER);
              }
            } else {
              writeShellOutput(termId, term, data.data, data.rawData);
            }
          }
        });
        cleanups.push(unsubscribe);

        // 补获已缓冲的历史数据并渲染
        let historyData: string | null = null;
        try {
          const history = await sshService.getShellHistory(sessionId);
          historyData = history;
          // await 后检查卸载，防止向已卸载的终端写入数据
          if (isUnmountedRef.current || !sshService.isSessionAlive(sessionId)) {
            cleanups.slice().reverse().forEach((fn) => {
              try {
                fn();
              } catch {
                // 忽略异常
              }
            });
            return;
          }
          if (bannerText) {
            // 欢迎语存在时，使用 writeMotdIfMissing 检查欢迎语是否已在 history 中，避免重复写入
            const safeHistory = stripUnsafeEscapes(
              isSerial
                ? history || ""
                : highlightKeywords(
                    history || "",
                    highlightEnabledRef.current,
                    highlightRulesRef.current,
                  ),
            );
            await writeMotdIfMissing(
              term,
              bannerText,
              safeHistory,
              currentServer,
              () => isUnmountedRef.current || Boolean(sessionId && !sshService.isSessionAlive(sessionId)),
            );
          } else if (history) {
            const safeHistory = stripUnsafeEscapes(
              isSerial
                ? history
                : highlightKeywords(
                    history,
                    highlightEnabledRef.current,
                    highlightRulesRef.current,
                  ),
            );
            await writeChunked(
              term,
              safeHistory,
              64 * 1024,
              undefined,
              () => isUnmountedRef.current || Boolean(sessionId && !sshService.isSessionAlive(sessionId)),
            );
          }
        } catch (e) {
          console.error("Failed to get shell history:", e);
        }

        if (isUnmountedRef.current || (sessionId && !sshService.isSessionAlive(sessionId))) {
          sessionCleanup();
          return;
        }

        // 标记历史渲染完毕，并冲刷在加载历史期间接收到的实时缓冲数据
        historyWritten = true;
        if (pendingBuffer) {
          // 若 pendingBuffer 已在拉取的 history 尾部出现，避免重复写入
          const bufferToWrite = historyData && historyData.endsWith(pendingBuffer) ? "" : pendingBuffer;
          if (bufferToWrite) {
            if (isSerial) writeShellOutput(termId, term, bufferToWrite);
            else writeTerminalOutput(termId, term, stripUnsafeEscapes(bufferToWrite));
          }
        }
        if (sessionId) {
          lastActivityTimesRef.current.set(sessionId, Date.now());
        }
        onShellReady?.();
        term.focus(); // 连接成功且数据就绪，立即上焦点可输入

        // 监听 Shell 关闭
        const unsubscribeClosed = sshService.onShellClosed((data) => {
          if (data.sessionId === sessionId) {
            // 无论是否进入自动重连，都先移除本会话的全局订阅，避免
            // 断线后回调闭包继续保留终端和 sessionId。
            sessionCleanup();
            if (isUnmountedRef.current) return;
            // 检查是否应该自动重连：全局开关开启、终端标记允许、组件未卸载、非手动断开
            // 串口设备拔出（device_disconnected）除外：设备不在位时重连必然失败
            const inst = terminalsRef.current.get(termId);
            const shouldAuto =
              terminalAutoReconnectRef.current &&
              inst?.autoReconnect &&
              !isUnmountedRef.current &&
              !manualDisconnectRef.current &&
              data.reason !== "device_disconnected";
            if (shouldAuto) {
              if (!isTelnet && !isSerial) {
                reconnectManager.scheduleNextAttempt(sId, data.reason || "Shell closed", null);
              }
              setTerminals((prev) => {
                const next = new Map(prev);
                const it = next.get(termId);
                if (it) {
                  next.set(termId, { ...it, status: "reconnecting", sessionId: null });
                }
                terminalsRef.current = next;
                return next;
              });
            } else {
              if (isSerial) {
                useAppStore.getState().setServerState(sId, ConnectionState.Disconnected);
                if (baseServerId && baseServerId !== sId) {
                  useAppStore.getState().setServerState(baseServerId, ConnectionState.Disconnected);
                }
              }
              // E1：断线提示增强终端内醒目 writeln + toast.warning 双重提示
              term.writeln(
                "\r\n\x1b[33m" + t("tm_disconnected_hint") + "\x1b[0m",
              );
              term.focus();
              toastRef.current.warning(t("tm_disconnected"));
              setTerminals((prev) => {
                const next = new Map(prev);
                const it = next.get(termId);
                if (it) {
                  next.set(termId, {
                    ...it,
                    status: "disconnected",
                    sessionId: null,
                  });
                }
                terminalsRef.current = next;
                return next;
              });
            }
          }
        });
        cleanups.push(unsubscribeClosed);

        const unsubscribeError = sshService.onShellError((data) => {
          if (data.sessionId === sessionId) {
            sessionCleanup();
            if (isUnmountedRef.current) return;
            term.writeln(`\r\n\x1b[31mShell Error: ${data.error}\x1b[0m`);
            // E1：Shell 错误也属于断线场景，补充 toast.warning 提示
            toastRef.current.warning(t("tm_disconnected"));
            const serverName = server?.name || "Unknown";
            if (backend) {
              backend.auditLogs
                .record(
                  "backend",
                  serverName,
                  "Terminal session crash/error",
                  "failed",
                  data.error,
                )
                .catch(() => {});
            }
            const inst = terminalsRef.current.get(termId);
            // 串口设备拔出（device_disconnected）：设备不在位时重连必然失败，跳过自动重连
            const shouldAuto =
              terminalAutoReconnectRef.current &&
              inst?.autoReconnect &&
              !isUnmountedRef.current &&
              data.reason !== "device_disconnected";

            if (shouldAuto) {
              if (!isTelnet && !isSerial) {
                reconnectManager.scheduleNextAttempt(sId, data.error, null);
              }
              setTerminals((prev) => {
                const next = new Map(prev);
                const it = next.get(termId);
                if (it) {
                  next.set(termId, { ...it, status: "reconnecting", sessionId: null });
                }
                terminalsRef.current = next;
                return next;
              });
            } else {
              term.writeln(
                "\r\n\x1b[33m" + t("tm_disconnected_hint") + "\x1b[0m",
              );
              term.focus();
              setTerminals((prev) => {
                const next = new Map(prev);
                const it = next.get(termId);
                if (it) {
                  next.set(termId, {
                    ...it,
                    status: "error",
                    error: data.error,
                  });
                }
                terminalsRef.current = next;
                return next;
              });
            }
          }
        });
        cleanups.push(unsubscribeError);

        // 监听终端输入
        const inputDataDisposable = term.onData((data) => {
          if (useAppStore.getState().isAppLocked) return;
          if (sessionId) {
            lastActivityTimesRef.current.set(sessionId, Date.now());
          }
          userScrolledUpRef.current.set(termId, false);
          if (pendingOutputCountsRef.current.has(termId)) {
            const next = new Map(pendingOutputCountsRef.current);
            next.delete(termId);
            pendingOutputCountsRef.current = next;
            setPendingOutputCounts(next);
          }
          // 断连/重连中状态下按 Enter 触发手动重连（取消自动重连计时器）
          const inst = terminalsRef.current.get(termId);
          if (
            !inst ||
            inst.status === "disconnected" ||
            inst.status === "error" ||
            inst.status === "reconnecting"
          ) {
            if (data === "\r" || data === "\n") {
              onReconnectRef.current?.();
              reconnectTerminal(termId);
            }
            return;
          }

          // 追踪当前输入行，用于指令提示与历史记录
          if (data === "\r" || data === "\n") {
            // 回车执行命令：记录到历史（附带主机与工作目录上下文），再清空输入追踪
            if (currentInputRef.current.trim()) {
              const curCwd =
                terminalCwdRef.current.get(termId) ?? homeDirRef.current;
              rememberSubmittedCommand(termId, currentInputRef.current);
              recordCommand(currentInputRef.current, {
                serverId,
                cwd: curCwd,
              });
              // 新命令入历史后令排名缓存失效，下一次补全即反映最新频次
              invalidateRankingCache();
            }
            pathFetchIdRef.current += 1;
            clearHintLoading();
            currentInputRef.current = "";
            setCmdHints([]);
            setHintVisible(false);
          } else if (/[\r\n]/.test(data)) {
            // 粘贴或批量输入包含换行符：拆分处理，保存完成的命令到历史记录
            const parts = data.split(/[\r\n]+/);
            for (let idx = 0; idx < parts.length - 1; idx++) {
              const part = parts[idx];
              const fullCmd = idx === 0 ? currentInputRef.current + part : part;
              if (fullCmd.trim()) {
                const curCwd =
                  terminalCwdRef.current.get(termId) ?? homeDirRef.current;
                rememberSubmittedCommand(termId, fullCmd);
                recordCommand(fullCmd, {
                  serverId,
                  cwd: curCwd,
                });
                // 新命令入历史后令排名缓存失效，下一次补全即反映最新频次
                invalidateRankingCache();
              }
            }
            pathFetchIdRef.current += 1;
            clearHintLoading();
            currentInputRef.current = parts[parts.length - 1] || "";
            setCmdHints([]);
            setHintVisible(false);
          } else if (data === "\x7f" || data === "\b") {
            // 退格：提示框已可见时同步更新内容（输入为空时自动关闭）；
            // 提示框不可见时不主动弹出（避免干扰翻历史等场景），仅 silent 更新 hintResultRef。
            currentInputRef.current = currentInputRef.current.slice(0, -1);
            if (hintVisibleRef.current) {
              runMatchHints(currentInputRef.current);
            } else {
              runMatchHints(currentInputRef.current, { silent: true });
            }
          } else if (data === "\x03" || data === "\x1c") {
            // 收到终端中断信号 (Ctrl+C / Ctrl+\)，立即排空待渲染队列并发送中断
            handleSigint(termId);
            return;
          } else if (data === "\x15") {
            // Ctrl+U 清空当前行
            pathFetchIdRef.current += 1;
            clearHintLoading();
            currentInputRef.current = "";
            setCmdHints([]);
            setHintVisible(false);
          } else if (
            data.length >= 1 &&
            [...data].every(
              (c) => c.charCodeAt(0) >= 32 && !c.startsWith("\x1b"),
            )
          ) {
            // 普通可打印字符（含 CJK 多字节输入），追加到输入追踪（B5）
            // H2 修复：若上一次 rebuildInputFromBuffer 仍未完成（needsRebuildRef=true），
            // 说明 setTimeout 回调可能读到了过时 buffer（跨境 SSH 回显延迟），
            // 此时立即从 buffer 补读一次，避免 currentInputRef 错位导致后续补全错误。
            if (needsRebuildRef.current) {
              const tForRebuild = xtermInstances.current.get(termId)?.term;
              if (tForRebuild) {
                try {
                  const buf = tForRebuild.buffer.active;
                  const cy = buf.baseY + buf.cursorY;
                  const line = buf.getLine(cy);
                  if (line) {
                    const fullText = line.translateToString(true);
                    const markers = [
                      "$ ",
                      "# ",
                      "> ",
                      "% ",
                      "❯ ",
                      "➜ ",
                      "❯",
                      "➜",
                    ];
                    let lastIdx = -1;
                    let markerLen = 0;
                    for (const mk of markers) {
                      const idx = fullText.lastIndexOf(mk);
                      if (idx > lastIdx) {
                        lastIdx = idx;
                        markerLen = mk.length;
                      }
                    }
                    const cmdText =
                      lastIdx >= 0
                        ? fullText.slice(lastIdx + markerLen).trim()
                        : /[$#>%❯➜]\s*$/.test(fullText)
                          ? ""
                          : fullText;
                    currentInputRef.current = cmdText;
                  }
                } catch {
                  /* buffer 读取失败，沿用原 currentInputRef */
                }
                needsRebuildRef.current = false;
              }
            }
            currentInputRef.current += data;
            runMatchHints(currentInputRef.current);
          } else {
            // 其他控制序列（方向键 \x1b[A/B 调历史、Ctrl+W \x17 删词、Ctrl+A \x01、Ctrl+E \x05 等），
            // 无法精确追踪——但从 buffer 重建当前行内容。
            // 关键修复：↑ 调历史后 shell 显示 `docker logs -f`，但 currentInputRef 已失效，
            // 必须从 buffer 读取真实内容，否则后续输入容器名时会被误判为命令阶段。
            // 先关闭当前提示（避免重建前显示错位），延迟从 buffer 重建
            pathFetchIdRef.current += 1;
            clearHintLoading();
            setCmdHints([]);
            setHintVisible(false);
            // 用当前终端实例重建（普通模式与迁移模式都已注册到 xtermInstances）
            const tForRebuild = xtermInstances.current.get(termId)?.term;
            if (tForRebuild) rebuildInputFromBuffer(tForRebuild);
          }

          if (sessionId) {
            // 统一通过广播入口写入：当前 tab 未开启广播时仅写入当前 session，
            // 开启广播时同步转发到其他开启广播的 tab 的所有 session。
            broadcastToShells(sessionId, data);
          }
        });
        cleanups.push(() => inputDataDisposable.dispose());

        // 监听 BEL 控制字符（\x07）：xterm.js v6 的 bellStyle:'sound' 不自动播放，
        // 需在此回调中自行用 WebAudio 合成提示音。受「开启终端铃声」开关控制。
        const bellDisposable = term.onBell(() => {
          // 同上：仅开启铃声时播放，关闭时静默 + 视觉闪烁
          if (terminalBellSoundRef.current) playSound(SoundType.Bell);
        });
        cleanups.push(() => bellDisposable.dispose());

        // 监听终端大小变化
        const resizeDisposable = term.onResize(({ cols, rows }) => {
          queueSessionEvent(termId, "resize", { cols, rows });
          // D2：节流 resizeShell 调用，避免拖拽调整尺寸时频繁触发后端
          const existing = resizeTimersRef.current.get(sessionId);
          if (existing) window.clearTimeout(existing);
          const timer = window.setTimeout(() => {
            sshService.resizeShell(sessionId, cols, rows);
            resizeTimersRef.current.delete(sessionId);
          }, 150);
          resizeTimersRef.current.set(sessionId, timer);
        });
        cleanups.push(() => resizeDisposable.dispose());
        // H3 修复：cleanup 时清理该 terminal 的 resize timer
        cleanups.push(() => {
          const t = resizeTimersRef.current.get(sessionId);
          if (t) {
            window.clearTimeout(t);
            resizeTimersRef.current.delete(sessionId);
          }
        });

        // Shell 创建后延迟重新 fit，处理容器尺寸在创建过程中可能变化的情况
        // 这确保 PTY 尺寸与 xterm 最终尺寸完全一致
        const fitDelayTimer = window.setTimeout(() => {
          try {
            const prevCols = term.cols;
            const prevRows = term.rows;
            fitTerminalSafely(fitAddon, term);
            if (term.cols !== prevCols || term.rows !== prevRows) {
              sshService.resizeShell(sessionId, term.cols, term.rows);
            }
          } catch {
            // ignore
          }
        }, 300);

        // 保存清理函数
        const inst = xtermInstances.current.get(termId);
        if (inst)
          xtermInstances.current.set(termId, {
            ...inst,
            sessionCleanup,
            termCleanup: doTermCleanup,
            cleanup: (isReconnecting = false, isClosing = false) => {
              // 成功路径：统一执行会话级清理函数（B1/B2），并清理延迟 fit 定时器（B7）
              // 重连/关闭场景下需要直接关闭旧 session（sessionClosed 标志防止重复关闭）
              if ((isReconnecting || isClosing) && !sessionClosed) {
                sessionClosed = true;
                sshService.closeShell(sessionId).catch(() => {});
              }
              // 先卸载事件订阅，再关闭远端 Shell，避免 close 事件在清理期间
              // 重新触发状态更新或重连。
              sessionCleanup();
              if (fitDelayTimer) window.clearTimeout(fitDelayTimer);
              if (tabId) {
                sshService.unregisterTabSession(tabId, sessionId);
              }
              // 关键修复：右键菜单、鼠标滚轮、选中文本以及终端事件监听器属于 Terminal 实例级资源，
              // 只有在非重连场景（终端彻底关闭或组件卸载）时才予以移除；重连时必须保留！
              if (!isReconnecting) {
                doTermCleanup();
              }
            },
          });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // 失败时逆序释放已收集的清理函数，防止订阅泄漏（B1/B2）
        cleanups.slice().reverse().forEach((fn) => {
          try {
            fn();
          } catch {
            // 忽略异常
          }
        });
        setTerminals((prev) => {
          const next = new Map(prev);
          const inst = next.get(termId);
          if (inst) {
            next.set(termId, { ...inst, status: "error", error: errMsg });
          }
          terminalsRef.current = next;
          return next;
        });
        term.writeln(`\r\n\x1b[31mConnection Error: ${errMsg}\x1b[0m`);
        onShellReady?.();
        // 关键修复：错误状态下不要移除右键菜单、滚轮等 DOM 监听器，确保用户可右键复制错误或按回车重连
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      serverId,
      runMatchHints,
      initialCommand,
      broadcastToShells,
      reconnectTerminal,
      server,
      pasteTextToShell,
      writeShellOutput,
      connectionBlocked,
      connectionBlockedReason,
      t,
    ],
  );

  const getActiveOutput = useCallback(() => {
    const term = getActiveTerm();
    if (!term) return "";
    const lines: string[] = [];
    for (let i = 0; i < term.buffer.active.length; i++) {
      lines.push(term.buffer.active.getLine(i)?.translateToString(true) ?? "");
    }
    return lines.join("\n");
  }, [getActiveTerm]);

  const handleAIDiagnoseRecentOutput = useCallback(() => {
    setCtxMenu(null);
    const fullOutput = getActiveOutput();
    if (!fullOutput) return;
    const lines = fullOutput.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
    const recentLines = lines.slice(-40).join("\n");
    if (recentLines) {
      useAIStore.getState().openDiagnosis(recentLines);
    }
  }, [getActiveOutput]);

  const clearActiveOutput = useCallback(() => {
    const term = getActiveTerm();
    if (!term) return;
    if (activeTermId) {
      outputWriteQueuesRef.current.delete(activeTermId);
    }
    term.clear();
    term.scrollToBottom();
    playSound(SoundType.Click);
  }, [getActiveTerm, activeTermId]);

  // 清屏菜单（仿 Xshell）：仅清屏，保留滚动缓冲区
  const handleClearScreen = useCallback(() => {
    const term = getActiveTerm();
    if (!term) return;
    term.write("\x1b[2J\x1b[H");
    term.scrollToBottom();
    playSound(SoundType.Click);
    setCtxMenu(null);
  }, [getActiveTerm]);

  // 清屏菜单：仅清除滚动缓冲区，保留当前屏幕内容
  const handleClearScrollback = useCallback(() => {
    const term = getActiveTerm();
    if (!term) return;
    term.write("\x1b[3J");
    playSound(SoundType.Click);
    setCtxMenu(null);
  }, [getActiveTerm]);

  // 清屏菜单：同时清除屏幕与滚动缓冲区（显式转义，避免依赖 term.clear() 的版本差异）
  const handleClearAll = useCallback(() => {
    const term = getActiveTerm();
    if (!term) return;
    if (activeTermId) {
      outputWriteQueuesRef.current.delete(activeTermId);
    }
    term.write("\x1b[2J\x1b[3J\x1b[H");
    term.scrollToBottom();
    playSound(SoundType.Click);
    setCtxMenu(null);
  }, [getActiveTerm, activeTermId]);

  // 日志菜单（仿 Xshell）：开始/停止记录
  const handleToggleRecordingMenu = useCallback(() => {
    const termId = activeTermId;
    setCtxMenu(null);
    if (!termId) {
      toastRef.current?.warning(t("tm_single_terminal_only"));
      return;
    }
    void toggleRecording(termId);
  }, [activeTermId, toggleRecording]);

  // 日志菜单：暂停记录（保留文件，暂不写入）
  const handlePauseRecordingMenu = useCallback(() => {
    const termId = activeTermId;
    setCtxMenu(null);
    if (!termId || !recordingTermIdsRef.current.has(termId)) return;
    recordingPausedRef.current.add(termId);
    setRecordingPausedIds(new Set(recordingPausedRef.current));
    toastRef.current?.info(t("recording_paused"));
  }, [activeTermId]);

  // 日志菜单：继续记录
  const handleResumeRecordingMenu = useCallback(() => {
    const termId = activeTermId;
    setCtxMenu(null);
    if (!termId) return;
    if (recordingPausedRef.current.delete(termId)) {
      setRecordingPausedIds(new Set(recordingPausedRef.current));
      toastRef.current?.info(t("recording_resumed"));
    }
  }, [activeTermId]);

  const [isOpening, setIsOpening] = useState(false);

  // 日志菜单：在系统默认应用中打开当前日志文件
  const handleOpenLogFile = useCallback(async () => {
    if (isOpening) return;
    const termId = activeTermId;
    setCtxMenu(null);
    const filePath = termId
      ? (recordingFileStatesRef.current.get(termId)?.path ??
        recordingLastPathRef.current.get(termId))
      : undefined;
    if (!filePath) {
      toastRef.current?.warning(t("recording_no_active_file"));
      return;
    }
    if (isOpening) return;
    setIsOpening(true);
    try {
      await invoke("open_path", { path: filePath });
    } catch (error) {
      toastRef.current?.error(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setIsOpening(false);
    }
  }, [activeTermId, isOpening]);

  // 日志菜单：在系统文件管理器中打开日志目录
  const handleOpenLogFolder = useCallback(async () => {
    if (isOpening) return;
    setCtxMenu(null);
    let dir = terminalRecordingDirectory;
    if (!dir) {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: t("recording_select_directory"),
      });
      if (typeof selected !== "string" || !selected) return;
      dir = selected;
      setTerminalRecordingDirectory(selected);
    }
    setIsOpening(true);
    try {
      await invoke("open_path", { path: dir });
    } catch (error) {
      toastRef.current?.error(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setIsOpening(false);
    }
  }, [terminalRecordingDirectory, setTerminalRecordingDirectory, isOpening]);

  // 日志菜单：设置/更改日志保存目录
  const handleChooseLogDirectory = useCallback(async () => {
    setCtxMenu(null);
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: t("recording_select_directory"),
    });
    if (typeof selected !== "string" || !selected) return;
    setTerminalRecordingDirectory(selected);
    toastRef.current?.success(t("recording_dir_saved"));
  }, [setTerminalRecordingDirectory]);

  // 右键菜单打开时，L/O/N 触发清屏（仿 Xshell 菜单助记符）。
  // 用捕获阶段拦截：防止按键被 xterm 抢走并误发到 shell。
  useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (k === "l" || k === "o" || k === "n") {
        e.preventDefault();
        e.stopPropagation();
        if (k === "l") handleClearScreen();
        else if (k === "o") handleClearScrollback();
        else handleClearAll();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ctxMenu, handleClearScreen, handleClearScrollback, handleClearAll]);

  const copyAllOutput = useCallback(async () => {
    const output = getActiveOutput();
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      toastRef.current.success(t("tm_toast_copy_success"));
    } catch {
      toastRef.current.warning(t("tm_toast_copy_failed"));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getActiveOutput]);

  useEffect(() => {
    if (isSplitPane) return;
    registerOutputActions?.({
      clear: clearActiveOutput,
      copy: copyAllOutput,
      toggleRecording: async () => {
        if (activeTermId) await toggleRecording(activeTermId);
      },
      recording: activeTermId ? recordingTermIds.has(activeTermId) : false,
    });
    return () => registerOutputActions?.(null);
  }, [
    isSplitPane,
    registerOutputActions,
    clearActiveOutput,
    copyAllOutput,
    activeTermId,
    recordingTermIds,
    toggleRecording,
  ]);

  // 异步拉取并缓存远程用户的 home 目录路径，供路径解析时替换 ~ 使用。
  // 等待首个 Shell 连接就绪后再拉取，彻底杜绝 SFTP 通道抢占首个会话连接导致 MOTD 丢失。
  const hasConnectedShell = Array.from(terminals.values()).some(
    (t) => t.status === "connected" && !!t.sessionId,
  );
  useEffect(() => {
    if (!isConnected || !serverId || !hasConnectedShell) return;
    sshService
      .getHomeDirectory(serverId)
      .then((h) => {
        if (h && h !== "/") {
          homeDirRef.current = h;
        }
      })
      .catch(() => {});
  }, [isConnected, serverId, hasConnectedShell]);

  // 向外层工作台注册获取当前终端 CWD 的回调
  useEffect(() => {
    if (!registerGetCwd) return;
    const getCwd = () => {
      if (!activeTermId) return undefined;
      const cwd = terminalCwdRef.current.get(activeTermId);
      if (cwd && (cwd.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(cwd))) {
        return cwd;
      }
      const term = terminals.get(activeTermId);
      if (term?.shellTitle) {
        const extracted = extractPathFromShellTitle(term.shellTitle, homeDirRef.current);
        if (extracted) {
          terminalCwdRef.current.set(activeTermId, extracted);
          return extracted;
        }
      }
      return homeDirRef.current || undefined;
    };
    registerGetCwd(getCwd);
    return () => registerGetCwd(null);
  }, [registerGetCwd, activeTermId, terminals]);

  const jumpToLatestOutput = useCallback(() => {
    if (!activeTermId) return;
    const term = xtermInstances.current.get(activeTermId)?.term;
    if (!term) return;
    userScrolledUpRef.current.set(activeTermId, false);
    const queued = outputWriteQueuesRef.current.get(activeTermId);
    if (queued) {
      queued.wasScrolledUp = false;
      queued.viewportY = term.buffer.active.baseY;
    }
    const next = new Map(pendingOutputCountsRef.current);
    next.delete(activeTermId);
    pendingOutputCountsRef.current = next;
    setPendingOutputCounts(next);
    try {
      syncTerminalScrollAndDimensions(term, { forceBottom: true });
      term.focus();
    } catch {
      // ignore
    }
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        try {
          syncTerminalScrollAndDimensions(term, { forceBottom: true });
          term.focus();
        } catch {
          // ignore
        }
      });
    }
  }, [activeTermId]);

  const jumpCommandMarker = useCallback(
    (direction: "previous" | "next") => {
      if (!activeTermId) return;
      const term = xtermInstances.current.get(activeTermId)?.term;
      const entries = (commandMarkersRef.current.get(activeTermId) ?? []).filter(
        (entry) => !entry.marker.isDisposed,
      );
      if (!term || entries.length === 0) return;
      const current = commandMarkerCursorRef.current.get(activeTermId);
      const fallback = direction === "previous" ? entries.length : -1;
      const nextIndex = Math.max(
        0,
        Math.min(
          entries.length - 1,
          (current ?? fallback) + (direction === "previous" ? -1 : 1),
        ),
      );
      commandMarkerCursorRef.current.set(activeTermId, nextIndex);
      term.scrollToLine(entries[nextIndex].marker.line);
      term.focus();
      setCommandMarkerVersion((version) => version + 1);
    },
    [activeTermId],
  );

  const activeCommandMarkers = useMemo(() => {
    void commandMarkerVersion;
    if (!activeTermId) return [];
    return (commandMarkersRef.current.get(activeTermId) ?? []).filter(
      (entry) => !entry.marker.isDisposed,
    );
  }, [activeTermId, commandMarkerVersion]);

  // 分屏 divider 拖拽中：冻结所有可见 .term-host 的像素尺寸（Termius 式钉住画布）
  // 并抑制 ResizeObserver 的逐帧 fit。拖拽期间窗格尺寸高频变化，若终端跟随 resize，
  // WebGL 渲染器会反复清屏/概率性 context loss，表现为终端文字整体消失。
  // 拖拽开始/结束由 split-layout-view 广播 split-resize-start/end。
  const isSplitDragResizingRef = useRef(false);

  // 自动调整终端大小（只对当前可见终端）
  // 关键：统一使用 computeSafeTerminalDimensions 保留安全列，先测量再分组。
  // display:none 的保活实例（其他 tab / 隐藏模块）proposeDimensions 会拿到过期的旧列数，
  // 若参与 min 计算会把可见终端"压窄"（右侧大片空白）。
  // 同一 SSH 会话分屏到多个可见窗格时，PTY 只有一套列数，取各窗格最小 cols/rows
  // 统一 resize——较宽窗格的留白是共享会话的固有约束（与 Xshell 等终端行为一致）。
  // 隐藏实例不参与计算；等它重新可见时 ResizeObserver 会再次触发对齐。
  const fitAllVisibleTerminals = useCallback(() => {
    const groups = new Map<
      string,
      { term: Terminal; termId: string; cols: number; rows: number }[]
    >();
    xtermInstances.current.forEach((info, termId) => {
      const dim = computeSafeTerminalDimensions(info.fitAddon);
      // 隐藏 / 0 尺寸实例：不参与计算，也绝不把 PTY resize 到 0
      if (!dim) return;
      // 使用 sessionId 分组（同一会话分屏取最小值），断连时 sessionId 为 undefined，
      // 用 termId 兜底避免所有断连终端被错误合并到同一组
      const groupKey = info.sessionId ?? termId;
      const list = groups.get(groupKey) ?? [];
      list.push({ term: info.term, termId, cols: dim.cols, rows: dim.rows });
      groups.set(groupKey, list);
    });

    groups.forEach((instances) => {
      let minCols = Infinity;
      let minRows = Infinity;
      for (const item of instances) {
        minCols = Math.min(minCols, item.cols);
        minRows = Math.min(minRows, item.rows);
      }
      if (!Number.isFinite(minCols) || minCols < 2 || minRows < 1) return;
      for (const { term, termId } of instances) {
        try {
          const userScrolledUp = userScrolledUpRef.current.get(termId) === true;
          const sizeChanged = term.cols !== minCols || term.rows !== minRows;
          if (sizeChanged) {
            term.resize(minCols, minRows);
            if (!userScrolledUp) {
              syncTerminalScrollAndDimensions(term, { forceBottom: true });
              const queued = outputWriteQueuesRef.current.get(termId);
              if (queued) {
                queued.wasScrolledUp = false;
                queued.viewportY = term.buffer?.active?.baseY ?? 0;
              }
              if (pendingOutputCountsRef.current.has(termId)) {
                const next = new Map(pendingOutputCountsRef.current);
                next.delete(termId);
                pendingOutputCountsRef.current = next;
                setPendingOutputCounts(next);
              }
            } else {
              syncTerminalScrollAndDimensions(term, { forceBottom: false });
            }
            if (typeof requestAnimationFrame === "function") {
              requestAnimationFrame(() => {
                try {
                  const stillScrolledUp =
                    userScrolledUpRef.current.get(termId) === true;
                  syncTerminalScrollAndDimensions(term, {
                    forceBottom: !stillScrolledUp,
                  });
                } catch {
                  // ignore
                }
              });
            }
          }
        } catch {
          // ignore
        }
      }
    });
  }, []);

  // F4/F5: 分屏拖拽会导致 portalTarget 在 slot 和 0x0 fallback 之间移动，触发 ResizeObserver。
  // - F5: 容器尺寸为 0 时跳过 fit，避免把后端 PTY resize 到 0x0 导致输出丢失（不可逆）
  // - F4: fit 成功后补一次 refresh，确保渲染器用新尺寸重绘现有 buffer（不清空 scrollback）
  useEffect(() => {
    let resizeRafId: number | null = null;

    const guardContainerZero = () => {
      // F5: 容器在 0x0 fallback 或 hidden 状态时跳过，避免 PTY 被 resize 到 0x0
      const container = terminalContainerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return true;
      }
      return false;
    };

    const handleResize = () => {
      // 模块处于隐藏状态时直接跳过，杜绝后台标签响应 resize
      if (!isVisibleRef.current) return;
      // 分屏拖拽中：跳过逐帧 fit，保持终端画布旧尺寸（内容稳定，至多右侧被
      // 裁剪/留白），松手后由 split-resize-end 统一对齐到最终尺寸
      if (isSplitDragResizingRef.current) return;
      if (guardContainerZero()) return;
      if (resizeRafId !== null) return;
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = null;
        if (isUnmountedRef.current || !isVisibleRef.current) return;
        fitAllVisibleTerminals();
      });
    };

    // 分屏拖拽开始：钉住所有可见终端宿主的像素尺寸（Termius 式）。
    // 拖拽期间面板尺寸高频变化，把 .term-host 冻结在拖拽开始时的像素尺寸上：
    // 终端画布完全不动（超出面板的部分被 overflow-hidden 裁剪），
    // 任何 resize 路径（fit / WebGL DPR 监听 / xterm 测量）都看不到尺寸变化，
    // 从根源上杜绝拖拽期间的清屏、重排与 WebGL context loss 抖动。
    const handleSplitResizeStart = () => {
      isSplitDragResizingRef.current = true;
      termContainerRefs.current.forEach((el) => {
        // 隐藏实例（非活跃终端/其他标签）无有效尺寸，跳过
        if (el.classList.contains("hidden")) return;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;
        el.style.width = `${rect.width}px`;
        el.style.height = `${rect.height}px`;
      });
    };

    // 解除冻结：清空内联宽高，.term-host 回到 inset-0 跟随面板尺寸
    const unfreezeTermHosts = () => {
      termContainerRefs.current.forEach((el) => {
        el.style.width = "";
        el.style.height = "";
      });
    };

    // 兜底：拖拽中窗口失焦导致 mouseup 丢失时解除冻结并复位标志，
    // 避免标志永久卡住、终端从此不再自适应尺寸
    const handleWindowBlur = () => {
      if (!isSplitDragResizingRef.current) return;
      isSplitDragResizingRef.current = false;
      unfreezeTermHosts();
      if (!guardContainerZero()) fitAllVisibleTerminals();
    };

    // 分屏比例拖拽松手：解除冻结，一次性把所有终端对齐到新面板尺寸
    const handleSplitResizeEnd = () => {
      isSplitDragResizingRef.current = false;
      unfreezeTermHosts();
      if (guardContainerZero()) return;
      fitAllVisibleTerminals();
    };

    // 标签页插拔到新 slot（拖拽分屏挂载、解散分屏独立等）：Chromium 会将子级滚动层重置到 0，
    // 必须由双帧进行完整的几何测量与视口自愈对齐
    const handleTabSlotMoved = (e: Event) => {
      const custom = e as CustomEvent<{ tabId?: string }>;
      if (custom.detail?.tabId && tabId && custom.detail.tabId !== tabId) {
        return;
      }
      if (guardContainerZero()) return;
      fitAllVisibleTerminals();
      requestAnimationFrame(() => {
        if (isUnmountedRef.current) return;
        fitAllVisibleTerminals();
        if (activeTermId) {
          const info = xtermInstances.current.get(activeTermId);
          if (info) {
            syncTerminalScrollAndDimensions(info.term, {
              forceBottom: userScrolledUpRef.current.get(activeTermId) !== true,
            });
            if (isActiveRef.current) {
              try {
                info.term.focus();
              } catch {
                // ignore
              }
            }
          }
        }
      });
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("split-resize-start", handleSplitResizeStart);
    window.addEventListener("split-resize-end", handleSplitResizeEnd);
    window.addEventListener("tab-slot-moved", handleTabSlotMoved);
    window.addEventListener("tab-split-complete", handleTabSlotMoved);
    const observer = new ResizeObserver(handleResize);
    if (terminalContainerRef.current) {
      observer.observe(terminalContainerRef.current);
    }

    return () => {
      if (resizeRafId !== null) {
        cancelAnimationFrame(resizeRafId);
        resizeRafId = null;
      }
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("split-resize-start", handleSplitResizeStart);
      window.removeEventListener("split-resize-end", handleSplitResizeEnd);
      window.removeEventListener("tab-slot-moved", handleTabSlotMoved);
      window.removeEventListener("tab-split-complete", handleTabSlotMoved);
      observer.disconnect();
    };
  }, [fitAllVisibleTerminals, tabId, activeTermId]);

  // 组件卸载时清理所有终端
  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      if (pendingOutputFrameRef.current !== null) {
        cancelAnimationFrame(pendingOutputFrameRef.current);
        pendingOutputFrameRef.current = null;
      }
      if (outputWriteFrameRef.current !== null) {
        window.clearTimeout(outputWriteFrameRef.current);
        outputWriteFrameRef.current = null;
      }
      if (rebuildTimerRef.current !== null) {
        window.clearTimeout(rebuildTimerRef.current);
        rebuildTimerRef.current = null;
      }
      if (hintLoadingTimerRef.current !== null) {
        window.clearTimeout(hintLoadingTimerRef.current);
        hintLoadingTimerRef.current = null;
      }
      pathFetchIdRef.current += 1;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      outputWriteQueuesRef.current.clear();
      outputWriteInFlightRef.current.clear();
      outputWriteTokenRef.current.clear();
      xtermPendingCharsRef.current.clear();

      // H3 修复：清理所有 resize 节流定时器，防止卸载后向已关闭的 session 发送 resizeShell
      resizeTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      // eslint-disable-next-line react-hooks/exhaustive-deps
      resizeTimersRef.current.clear();
      xtermInstances.current.forEach(({ term, cleanup, termCleanup }) => {
        // 正常连接实例的 cleanup 会同时释放会话和终端级资源；认证阻塞或
        // 初始化失败时可能只有 termCleanup，没有 session cleanup，不能漏掉
        // contextmenu/mouse/wheel/搜索器等外部资源。
        if (cleanup) cleanup();
        else termCleanup?.();
        term.dispose();
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
      xtermInstances.current.clear();
      zmodemSentriesRef.current.clear();
      zmodemSessionsRef.current.clear();
      pendingZmodemPathsRef.current = null;
      pendingSftpRecordRef.current = null;
      sftpFileProgressRef.current.clear();
      if (zmodemHandshakeTimerRef.current) {
        clearTimeout(zmodemHandshakeTimerRef.current);
        zmodemHandshakeTimerRef.current = null;
      }
      if (transferAutoCloseTimerRef.current) {
        clearTimeout(transferAutoCloseTimerRef.current);
        transferAutoCloseTimerRef.current = null;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
      userScrolledUpRef.current.clear();
      commandMarkersRef.current.forEach((entries) =>
        entries.forEach((entry) => entry.marker.dispose()),
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
      commandMarkersRef.current.clear();

      commandMarkerCursorRef.current.clear();
      // eslint-disable-next-line react-hooks/exhaustive-deps
      pendingCommandRef.current.clear();
      // eslint-disable-next-line react-hooks/exhaustive-deps
      shellIntegrationRef.current.clear();
      recordingTermIdsRef.current.clear();
      recordingFilePathsRef.current.clear();
      recordingFileStatesRef.current.clear();
      recordingWriteChainsRef.current.clear();
      recordingPendingCharsRef.current.clear();
      recordingWriteErrorNotifiedRef.current.clear();
      recordingPausedRef.current.clear();
      recordingLastPathRef.current.clear();
      terminalCwdRef.current.clear();
      commandMarkerCursorRef.current.clear();
      pendingOutputCountsRef.current.clear();
      discardedShellOutputThroughRef.current.clear();
      serialPausedOutputRef.current.clear();
      serialLineStartMapRef.current.clear();
      pausedShellsRef.current.clear();
      sigintActiveUntilRef.current.clear();
      sigintDroppedCharsRef.current.clear();
      lastActivityTimesRef.current.clear();
      blockedNoticeRef.current.clear();
      reconnectingRef.current.clear();
      serialFileTransferActiveRef.current = false;
      serialAutoSendInFlightRef.current = false;
      if (serialAutoSendTimerRef.current) {
        clearInterval(serialAutoSendTimerRef.current);
        serialAutoSendTimerRef.current = null;
      }
    };
  }, []);

  // 自动创建第一个终端
  useEffect(() => {
    let active = true;
    // 恢复大量独立工作台时只连接当前可见标签，避免应用启动瞬间并发建立
    // 数十个 SSH 会话；分屏窗格均为可见内容，仍应立即初始化。
    const shouldInitializeTerminal = isActive || !!isSplitPane;
    if (shouldInitializeTerminal && terminals.size === 0) {
      const timer = setTimeout(() => {
        if (!active) return;
        createTerminal();
      }, 50);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }
  }, [createTerminal, isActive, isSplitPane, terminals.size]);

  // 已存在的终端在连接过程中发生认证失败时，把提示追加到终端缓冲区。
  // 相同原因只写一次；认证修复成功后清除标记，未来再次失败仍可正常提示。
  useEffect(() => {
    if (!activeTermId) return;
    if (!connectionBlocked) {
      blockedNoticeRef.current.delete(activeTermId);
      return;
    }
    const instance = xtermInstances.current.get(activeTermId);
    if (!instance) return;
    const noticeKey = connectionBlockedReason || "missing";
    if (blockedNoticeRef.current.get(activeTermId) === noticeKey) return;
    const notice = connectionBlockedReason === "rejected"
      ? t("tm_auth_rejected_terminal")
      : t("tm_auth_required_terminal");
    instance.term.writeln(
      `\r\n${connectionBlockedReason === "rejected" ? "\x1b[31m" : "\x1b[33m"}${notice}\x1b[0m`,
    );
    blockedNoticeRef.current.set(activeTermId, noticeKey);
  }, [activeTermId, connectionBlocked, connectionBlockedReason, t]);

  // 当连接状态重新变为 true 时，自动重连处于断连状态的活跃终端，并触发 onShellReady
  // 关键：从依赖中移除 terminals（用 terminalsRef 读取），避免 terminals 状态变化触发 effect 重跑导致无限重连循环。
  // 重连失败后状态置为 'error' 会重建 terminals Map，若在依赖中会再次触发本 effect → 再次 reconnect → 死循环。
  // 最小重连间隔（2s）：避免 onShellReady/reconnectTerminal 引用变化导致 effect 频繁重跑，
  // 在终端处于 error/disconnected 状态时无退避地向后端 spam createShell 请求
  const lastReconnectTimeRef = useRef(0);
  useEffect(() => {
    if (isConnected && activeTermId && !connectionBlocked) {
      // 用 ref 读取最新状态，不建立对 terminals 的响应式依赖
      const inst = terminalsRef.current.get(activeTermId);
      if (inst) {
        if (inst.status === "disconnected" || inst.status === "error") {
          // 底层连接已就绪(isConnected=true)，终端处于断连或错误状态时自动恢复 Shell 会话并解除阻塞
          const now = Date.now();
          if (now - lastReconnectTimeRef.current < 2000) return;
          lastReconnectTimeRef.current = now;
          reconnectTerminal(activeTermId);
        } else if (inst.status === "connected") {
          onShellReady?.();
        }
      }
    }
  }, [isConnected, activeTermId, isActive, reconnectTerminal, onShellReady, connectionBlocked]);

  // 当活跃终端切换、可见性改变或模块激活时，立即调整大小并聚焦（0ms 同步 + 多帧双重保险）
  useEffect(() => {
    if (!activeTermId || !isVisible || !isActive) return;
    if (showSearchRef.current && document.activeElement?.closest?.(".terminal-search-bar, [data-terminal-search]")) return;
    if (isInteractiveOrInputElement(document.activeElement)) return;
    // 0ms 同步立即聚焦，保证切换瞬间光标处于激活闪烁输入状态
    focusActiveTerm(true);

    let rafId: number | null = null;
    let timerId: number | null = null;

    rafId = requestAnimationFrame(() => {
      if (isUnmountedRef.current) return;
      fitAllVisibleTerminals();
      if (showSearchRef.current && document.activeElement?.closest?.(".terminal-search-bar, [data-terminal-search]")) return;
      if (isInteractiveOrInputElement(document.activeElement)) return;
      focusActiveTerm(true);
      rafId = requestAnimationFrame(() => {
        if (isUnmountedRef.current) return;
        if (showSearchRef.current && document.activeElement?.closest?.(".terminal-search-bar, [data-terminal-search]")) return;
        if (isInteractiveOrInputElement(document.activeElement)) return;
        focusActiveTerm(true);
      });
    });

    // 弹窗关闭过渡动画（如 Radix 模态退出过渡动画约 50ms）结束后再次校准焦点
    timerId = window.setTimeout(() => {
      if (isUnmountedRef.current) return;
      if (showSearchRef.current && document.activeElement?.closest?.(".terminal-search-bar, [data-terminal-search]")) return;
      if (isInteractiveOrInputElement(document.activeElement)) return;
      focusActiveTerm(true);
    }, 60);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [activeTermId, isVisible, isActive, fitAllVisibleTerminals, focusActiveTerm]);

  // 监听全局聚焦事件及系统窗口激活事件（切回应用窗口、关闭上层弹窗等无缝恢复终端聚焦）
  useEffect(() => {
    const handleFocusTrigger = () => {
      if (!isActiveRef.current || !isVisibleRef.current) return;
      if (showSearchRef.current && document.activeElement?.closest?.(".terminal-search-bar, [data-terminal-search]")) return;
      if (isInteractiveOrInputElement(document.activeElement)) return;
      focusActiveTerm(true);
      queueMicrotask(() => {
        if (!isActiveRef.current || !isVisibleRef.current) return;
        if (showSearchRef.current && document.activeElement?.closest?.(".terminal-search-bar, [data-terminal-search]")) return;
        if (isInteractiveOrInputElement(document.activeElement)) return;
        focusActiveTerm(true);
      });
      requestAnimationFrame(() => {
        if (!isActiveRef.current || !isVisibleRef.current) return;
        if (showSearchRef.current && document.activeElement?.closest?.(".terminal-search-bar, [data-terminal-search]")) return;
        if (isInteractiveOrInputElement(document.activeElement)) return;
        focusActiveTerm(true);
      });
      window.setTimeout(() => {
        if (!isActiveRef.current || !isVisibleRef.current) return;
        if (showSearchRef.current && document.activeElement?.closest?.(".terminal-search-bar, [data-terminal-search]")) return;
        if (isInteractiveOrInputElement(document.activeElement)) return;
        focusActiveTerm(true);
      }, 60);
    };

    const handleInsertCommand = (e: Event) => {
      const customEvent = e as CustomEvent<{ command?: string; execute?: boolean }>;
      if (!isActiveRef.current || !isVisibleRef.current) return;
      const cmd = customEvent.detail?.command;
      if (!cmd) return;

      const activeId = activeTermIdRef.current || activeTermId;
      let targetSessionId: string | null = null;

      if (activeId) {
        targetSessionId =
          terminalsRef.current.get(activeId)?.sessionId ||
          xtermInstances.current.get(activeId)?.sessionId ||
          null;
      }

      // 兜底：若 activeId 未能对应活跃 session，从当前终端实例列表中寻找第一个有效连接的 sessionId
      if (!targetSessionId || !sshService.isSessionAlive(targetSessionId)) {
        for (const [id, inst] of terminalsRef.current.entries()) {
          if (inst.sessionId && sshService.isSessionAlive(inst.sessionId)) {
            targetSessionId = inst.sessionId;
            activeTermIdRef.current = id;
            setActiveTermId(id);
            break;
          }
        }
      }

      if (!targetSessionId || !sshService.isSessionAlive(targetSessionId)) {
        for (const [id, inst] of xtermInstances.current.entries()) {
          if (inst.sessionId && sshService.isSessionAlive(inst.sessionId)) {
            targetSessionId = inst.sessionId;
            activeTermIdRef.current = id;
            setActiveTermId(id);
            break;
          }
        }
      }

      if (targetSessionId) {
        writePasteText(cmd, targetSessionId, {
          execute: customEvent.detail.execute,
        });

        const termToFocus = activeId
          ? xtermInstances.current.get(activeId)?.term
          : Array.from(xtermInstances.current.values())[0]?.term;
        if (termToFocus) {
          try {
            termToFocus.focus();
          } catch {
            /* ignore */
          }
        }
      }
    };

    window.addEventListener("insert-terminal-command", handleInsertCommand);
    window.addEventListener("focus-active-terminal", handleFocusTrigger);
    window.addEventListener("focus", handleFocusTrigger);

    return () => {
      window.removeEventListener("insert-terminal-command", handleInsertCommand);
      window.removeEventListener("focus-active-terminal", handleFocusTrigger);
      window.removeEventListener("focus", handleFocusTrigger);
    };
  }, [focusActiveTerm, writePasteText]);

  // 鼠标交互焦点跟随：点击终端区域（且不在搜索栏内部）时，主动让搜索栏失焦，并将键盘焦点无缝转移给终端
  useEffect(() => {
    const handlePointerOrMouseDownCapture = (e: MouseEvent | PointerEvent) => {
      if (!isActiveRef.current || !isVisibleRef.current) return;
      const target = e.target as Element | null;
      if (!target) return;

      // 1. 若点击在搜索栏内部，绝对不打扰搜索栏输入
      if (target.closest?.(".terminal-search-bar, [data-terminal-search]")) {
        return;
      }

      // 2. 若点击在终端区域内（画布、行、滚动容器或终端外层容器）：
      const container = terminalContainerRef.current;
      const isTerminalTarget =
        container?.contains(target) ||
        Boolean(target.closest?.(".xterm, .xterm-screen, .xterm-viewport, .term-host"));

      // 点击终端外的其它 UI（侧边栏/文件树/标签页等）时关闭划词浮动条，
      // 避免其一直悬浮遮挡；浮动条自身（role=toolbar）除外，否则点它的按钮会先被卸载
      const isSelectionToolbar = !!target.closest?.('[role="toolbar"]');
      if (!isSelectionToolbar && !isTerminalTarget) {
        setSelectionToolbar(null);
        return;
      }

      if (isTerminalTarget) {
        // 用户鼠标点击了终端，主动释放搜索框焦点并聚焦终端
        const searchInput = document.querySelector<HTMLInputElement>(
          ".terminal-search-bar input",
        );
        if (searchInput && (document.activeElement === searchInput || searchInput.contains(document.activeElement))) {
          searchInput.blur();
        }

        // 立即且多帧可靠聚焦活跃终端
        focusActiveTerm(true);
      }
    };

    window.addEventListener("pointerdown", handlePointerOrMouseDownCapture, true);
    window.addEventListener("mousedown", handlePointerOrMouseDownCapture, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerOrMouseDownCapture, true);
      window.removeEventListener("mousedown", handlePointerOrMouseDownCapture, true);
    };
  }, [focusActiveTerm]);

  // 全局按键兜底拦截与输入路由：当焦点因点击空白区、Tab 栏等临时脱离终端时，按键自动定向输入终端
  useEffect(() => {
    const handleKeydownCapture = (e: KeyboardEvent) => {
      if (!isActiveRef.current || !isVisibleRef.current) return;
      if (useAppStore.getState().isAppLocked) return;

      const activeEl = document.activeElement;
      const targetEl = e.target as Element | null;

      // 1. 如果事件目标或当前焦点在搜索栏内部：
      const isInsideSearchBar = Boolean(
        activeEl?.closest?.(".terminal-search-bar, [data-terminal-search]") ||
        targetEl?.closest?.(".terminal-search-bar, [data-terminal-search]"),
      );

      if (isInsideSearchBar) {
        // 在搜索栏内部按 Esc 键直接关闭搜索栏并返还焦点给终端
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeSearch();
          return;
        }
        // 在搜索栏内按 Ctrl+F / Cmd+F 全选已有输入
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
          e.preventDefault();
          e.stopPropagation();
          const searchInput = document.querySelector<HTMLInputElement>(
            ".terminal-search-bar input",
          );
          if (searchInput) {
            searchInput.focus();
            searchInput.select();
          }
          return;
        }
        // 其余按键（包含 Enter 查下一个、Shift+Enter 查上一个、字符输入、中文 IME 等）
        // 完全交由搜索栏原生处理，严禁流向终端 Shell
        return;
      }

      // 2. 如果焦点或事件目标位于合法表单输入框、对话框或菜单中，严禁干扰
      if (isInteractiveOrInputElement(activeEl) || isInteractiveOrInputElement(targetEl)) {
        return;
      }

      // 3. 判断是否处于 xterm 终端聚焦区域（xterm-helper-textarea 或 xterm 内部 DOM）
      const isTerminalEl =
        (activeEl &&
          (activeEl.tagName?.toLowerCase() === "textarea" &&
            activeEl.classList?.contains("xterm-helper-textarea"))) ||
        activeEl?.closest?.(".xterm, .xterm-screen, .xterm-viewport") ||
        targetEl?.closest?.(".xterm, .xterm-screen, .xterm-viewport");

      if (isTerminalEl) {
        // 终端已聚焦状态下：
        // (1) 若搜索栏打开且按下 Esc：关闭搜索栏并保持终端焦点（对标 VS Code / Windows Terminal 标准）
        if (showSearchRef.current && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeSearch();
          return;
        }
        // (2) Ctrl+F / Cmd+F：打开或聚焦搜索栏
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
          e.preventDefault();
          e.stopPropagation();
          handleSearch();
          return;
        }
        // (3) 若搜索栏打开且按下 F3 / Shift+F3：在搜索结果间导航
        if (showSearchRef.current && e.key === "F3") {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) {
            handleFindPrevRef.current();
          } else {
            handleFindNextRef.current();
          }
          return;
        }
        // 其它按键：终端正常输入，放行给 xterm 原生处理（包含回车 Enter 执行命令、打字等）
        return;
      }

      // 4. 焦点脱离终端（例如点击了空白背景、Tab 栏等）：
      // 如果搜索栏打开：
      if (showSearchRef.current) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeSearch();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
          e.preventDefault();
          e.stopPropagation();
          handleSearch();
          return;
        }
        if (e.key === "F3") {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) {
            handleFindPrevRef.current();
          } else {
            handleFindNextRef.current();
          }
          return;
        }
      }

      // 忽略单独的修饰键
      if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) {
        focusActiveTerm(true);
        return;
      }

      // 忽略系统级功能键（F1~F12 等）
      if (e.key.startsWith("F") && e.key.length <= 3) {
        return;
      }

      // 忽略 Alt/Meta 组合快捷键（如 Alt+Tab、Alt+F4、Cmd+Q 等）
      if (e.altKey || (navigator.userAgent.includes("Mac") && e.metaKey)) {
        return;
      }

      // 忽略 Ctrl+K / Cmd+K 命令面板
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        return;
      }

      // Ctrl+F / Cmd+F 打开或聚焦终端搜索栏
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        handleSearch();
        return;
      }

      const targetId = activeTermIdRef.current || activeTermId;
      if (!targetId) return;
      const xtermInfo = xtermInstances.current.get(targetId);
      if (!xtermInfo?.term) return;

      // 立即重定向焦点回终端
      focusActiveTerm(true);

      // 断连状态下按回车触发重连
      if (
        (e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter") &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey
      ) {
        const inst = terminalsRef.current.get(targetId);
        const status = inst?.status;
        const currentSessionId = xtermInfo.sessionId;
        const isDisconnected =
          !inst ||
          status === "disconnected" ||
          status === "error" ||
          status === "reconnecting" ||
          !currentSessionId ||
          !isConnectedRef.current;

        if (isDisconnected) {
          e.preventDefault();
          e.stopPropagation();
          if (!reconnectingRef.current.has(targetId)) {
            onReconnectRef.current?.();
            void reconnectTerminalRef.current(targetId);
          }
          return;
        }
      }

      // 针对丢失焦点时按下的首个有效键，通过 term.input 派发，避免因事件目标在 body 导致丢失字符
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        xtermInfo.term.input("\r");
      } else if (e.key === "Backspace") {
        e.preventDefault();
        e.stopPropagation();
        xtermInfo.term.input("\x7f");
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        xtermInfo.term.input("\t");
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        xtermInfo.term.input(e.key);
      } else if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
        const code = e.key.toUpperCase().charCodeAt(0);
        if (code >= 65 && code <= 90) {
          e.preventDefault();
          e.stopPropagation();
          xtermInfo.term.input(String.fromCharCode(code - 64));
        }
      }
    };

    window.addEventListener("keydown", handleKeydownCapture, true);
    return () => {
      window.removeEventListener("keydown", handleKeydownCapture, true);
    };
  }, [activeTermId, focusActiveTerm]);

  // Esc 退出全屏 / F11 切换全屏（终端活跃时生效）
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      // F11 切换全屏
      if (e.key === "F11" && onToggleFullscreen) {
        e.preventDefault();
        e.stopPropagation();
        onToggleFullscreen();
        return;
      }
      // Esc 退出全屏（仅全屏时，搜索栏未开启时优先退出全屏）
      if (e.key === "Escape" && isFullscreen && onToggleFullscreen) {
        if (showSearchRef.current) {
          // 搜索栏打开时优先交由搜索栏关闭逻辑处理，避免误退全屏
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onToggleFullscreen();
      }
    };
    // 使用捕获阶段：xterm.js 会在目标/冒泡阶段消费 Esc 并发送给远端，
    // 捕获阶段可确保全屏退出优先执行，同时避免该 Esc 继续进入 Shell。
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isActive, isFullscreen, onToggleFullscreen]);


  // ZMODEM：服务器执行 rz 时，后端将二进制握手透传到这里；
  // 由 zmodem.js 协议栈处理，选中的本地文件通过同一 SSH channel 发送。
  useEffect(() => {
    const detected = sshService.onShellZmodemDetected(
      ({ sessionId, data: initialData }) => {
        // Every terminal module subscribes to the global event stream. Only the
        // module that owns the session may create a sentry for it.
        const ownsSession = Array.from(xtermInstances.current.values()).some(
          (info) => info.sessionId === sessionId,
        );
        if (!ownsSession) return;
        const Zmodem = ((globalThis as { Zmodem?: ZmodemModuleLike }).Zmodem ??
          (ZmodemModule as unknown)) as ZmodemModuleLike;
        if (!Zmodem?.Sentry) return;
        const toBase64 = (octets: number[]) => {
          let out = "";
          for (let i = 0; i < octets.length; i += 0x8000) {
            out += String.fromCharCode(...octets.slice(i, i + 0x8000));
          }
          return btoa(out);
        };
        const sentry = new Zmodem.Sentry({
          to_terminal: (octets: number[]) => {
            const text = new TextDecoder().decode(new Uint8Array(octets));
            const termId = Array.from(xtermInstances.current.entries()).find(
              ([, info]) => info.sessionId === sessionId,
            )?.[0];
            if (termId) xtermInstances.current.get(termId)?.term.write(text);
          },
          sender: (octets: number[]) => {
            const data = toBase64(octets);
            void sshService.shellZmodemWrite(sessionId, data);
          },
          on_detect: (detection: ZmodemDetectionLike) => {
            const session = detection.confirm();
            if (zmodemHandshakeTimerRef.current) {
              clearTimeout(zmodemHandshakeTimerRef.current);
              zmodemHandshakeTimerRef.current = null;
            }
            if (session.type === "receive") {
              zmodemSessionsRef.current.set(sessionId, {
                session,
                zmodem: Zmodem,
              });
              session.on?.("offer", (offer: ZmodemOfferLike) => {
                const details = offer.get_details?.() ?? {};
                const name = details.name || "download";
                void saveDialog({
                  title: t("zmodem_save_file"),
                  defaultPath: name,
                })
                  .then(async (targetPath) => {
                    if (!targetPath || isUnmountedRef.current) {
                      offer.skip();
                      return;
                    }
                    try {
                      const payloads = await offer.accept();
                      if (isUnmountedRef.current) return;
                      const totalLen = payloads.reduce(
                        (sum, p) => sum + p.length,
                        0,
                      );
                      const merged = new Uint8Array(totalLen);
                      let offset = 0;
                      for (const p of payloads) {
                        merged.set(p, offset);
                        offset += p.length;
                      }
                      await writeFile(targetPath, merged);
                      toastRef.current.success(
                        t("zmodem_save_success", { name }),
                      );
                    } catch (error: unknown) {
                      toastRef.current.error(
                        error instanceof Error
                          ? error.message
                          : t("zmodem_transfer_failed"),
                      );
                    }
                  })
                  .catch(() => {
                    try {
                      offer.skip();
                    } catch {
                      /* session already closed */
                    }
                  });
              });
              session.on?.("session_end", () => {
                zmodemSessionsRef.current.delete(sessionId);
                void sshService.shellZmodemEnd(sessionId);
              });
              try {
                void session.start?.();
              } catch {
                /* ignore */
              }
              return;
            }
            if (session.type !== "send") {
              detection.deny();
              return;
            }
            zmodemSessionsRef.current.set(sessionId, {
              session,
              zmodem: Zmodem,
            });
            const droppedPaths = pendingZmodemPathsRef.current;
            if (droppedPaths?.length) {
              pendingZmodemPathsRef.current = null;
              queueMicrotask(() => {
                void zmodemTransferStarterRef.current?.(droppedPaths);
              });
              return;
            }
            void openDialog({
              multiple: true,
              directory: false,
              title: t("zmodem_select_files"),
            })
              .then(async (selected) => {
                if (isUnmountedRef.current) return;
                const paths = selected
                  ? Array.isArray(selected)
                    ? selected
                    : [selected]
                  : [];
                if (paths.length === 0) {
                  detection.deny();
                  return;
                }
                const files = await Promise.all(
                  paths.map(async (path) => {
                    const bytes = await readFile(path);
                    const name = path.split(/[\\/]/).pop() || "file";
                    return new File([bytes], name, {
                      lastModified: Date.now(),
                    });
                  }),
                );
                if (isUnmountedRef.current) return;
                const sendFiles = Zmodem.Browser?.send_files;
                if (!sendFiles) {
                  toastRef.current.error(t("zmodem_module_unavailable"));
                  return;
                }
                const result = sendFiles(session, files);
                void result
                  .then(() => zmodemSessionsRef.current.delete(sessionId))
                  .catch((error: unknown) => {
                    toastRef.current.error(
                      error instanceof Error
                        ? error.message
                        : t("zmodem_transfer_failed"),
                    );
                  });
              })
              .catch(() => {
                try {
                  detection.deny();
                } catch {
                  /* session already closed */
                }
              });
          },
          on_retract: () => {},
        });
        zmodemSentriesRef.current.set(sessionId, sentry);
        if (initialData) {
          const bytes = Uint8Array.from(atob(initialData), (ch) =>
            ch.charCodeAt(0),
          );
          sentry.consume?.(bytes);
        }
      },
    );
    const data = sshService.onShellZmodemData(({ sessionId, data }) => {
      const sentry = zmodemSentriesRef.current.get(sessionId);
      if (!sentry) return;
      const bytes = Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0));
      sentry.consume?.(bytes);
    });
    const ended = sshService.onShellZmodemEnd(({ sessionId }) => {
      zmodemSentriesRef.current.delete(sessionId);
      zmodemSessionsRef.current.delete(sessionId);
      void sshService.shellZmodemEnd(sessionId);
    });
    return () => {
      detected();
      data();
      ended();
      zmodemSentriesRef.current.clear();
      // eslint-disable-next-line react-hooks/exhaustive-deps
      zmodemSessionsRef.current.clear();
      if (zmodemHandshakeTimerRef.current)
        clearTimeout(zmodemHandshakeTimerRef.current);
      if (transferAutoCloseTimerRef.current)
        clearTimeout(transferAutoCloseTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendZmodemDroppedPaths = useCallback(async (paths: string[]) => {
    if (isUnmountedRef.current) return false;
    const sessionEntry = Array.from(zmodemSessionsRef.current.entries())[0];
    if (!sessionEntry) return false;
    const [, entry] = sessionEntry;
    const sendFiles = entry.zmodem?.Browser?.send_files;
    if (typeof sendFiles !== "function") return false;
    const files = await Promise.all(
      paths.map(async (path) => {
        const bytes = await readFile(path);
        const name = path.split(/[\\/]/).pop() || "file";
        return new File([bytes], name, { lastModified: Date.now() });
      }),
    );
    if (isUnmountedRef.current) return false;
    const recordId = crypto.randomUUID();
    setShowTransferDialog(true);
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const startedAt = Date.now();
    setUploadRecords([
      {
        id: recordId,
        files: files.map((file) => file.name),
        directory: t("transfer_current_session"),
        protocol: "ZMODEM",
        status: "uploading",
        phase: "transferring",
        at: startedAt,
        bytes: 0,
        totalBytes,
        speed: 0,
      },
    ]);
    let transferred = 0;
    try {
      await sendFiles(entry.session, files, {
        on_progress: (_file: File, _transfer: unknown, piece: Uint8Array) => {
          transferred += piece?.byteLength || 0;
          if (isUnmountedRef.current) return;
          const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.1);
          setUploadRecords((prev) =>
            prev.map((record) =>
              record.id === recordId
                ? {
                    ...record,
                    bytes: Math.min(transferred, totalBytes),
                    speed: transferred / elapsedSeconds,
                  }
                : record,
            ),
          );
        },
      });
      if (isUnmountedRef.current) return true;
      setUploadRecords((prev) =>
        prev.map((record) =>
          record.id === recordId
            ? {
                ...record,
                status: "success",
                bytes: totalBytes,
                speed:
                  transferred / Math.max((Date.now() - startedAt) / 1000, 0.1),
              }
            : record,
        ),
      );
      transferAutoCloseTimerRef.current = setTimeout(() => {
        setShowTransferDialog(false);
        setUploadRecords([]);
        transferAutoCloseTimerRef.current = null;
      }, 1400);
    } catch (error) {
      if (isUnmountedRef.current) return true;
      setUploadRecords((prev) =>
        prev.map((record) =>
          record.id === recordId
            ? {
                ...record,
                status: "failed",
                error: error instanceof Error ? error.message : String(error),
              }
            : record,
        ),
      );
      toastRef.current.error(
        error instanceof Error ? error.message : t("zmodem_transfer_failed"),
      );
    }
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  zmodemTransferStarterRef.current = sendZmodemDroppedPaths;

  useEffect(() => {
    const unsubscribe = sshService.onTransferProgress((data) => {
      if (isUnmountedRef.current) return;
      const recordId = pendingSftpRecordRef.current;
      if (!recordId || data.type !== "upload") return;
      setUploadRecords((prev) =>
        prev.map((record) => {
          if (record.id !== recordId || record.protocol !== "SFTP")
            return record;
          const fileProgress =
            sftpFileProgressRef.current.get(recordId) ||
            new Map<string, number>();
          if (data.totalType === "bytes" && data.fileName) {
            fileProgress.set(
              data.fileName,
              Math.max(fileProgress.get(data.fileName) || 0, data.current),
            );
            sftpFileProgressRef.current.set(recordId, fileProgress);
          }
          const batchBytes = Array.from(fileProgress.values()).reduce(
            (sum, current) => sum + current,
            0,
          );
          const bytes = data.totalType === "bytes" ? batchBytes : record.bytes;
          // 多文件时后端 data.total 是“当前文件大小”，不能覆盖批次总大小。
          const totalBytes =
            record.totalBytes ||
            (record.files.length === 1 &&
            data.totalType === "bytes" &&
            data.total > 0
              ? data.total
              : undefined);
          const elapsed = Math.max((Date.now() - record.at) / 1000, 0.1);
          return {
            ...record,
            transferId: data.transferId || record.transferId,
            tmpPath: data.tmpPath || record.tmpPath,
            bytes,
            totalBytes,
            completedFiles:
              data.totalType === "count" ? data.current : record.completedFiles,
            totalFiles:
              data.totalType === "count" && data.total > 0
                ? data.total
                : record.totalFiles,
            speed: bytes ? bytes / elapsed : record.speed,
            status:
              data.done === false
                ? "failed"
                : data.done === true
                  ? "success"
                  : record.status,
            error: data.error || record.error,
          };
        }),
      );
      if (data.done !== undefined) {
        pendingSftpRecordRef.current = null;
        sftpFileProgressRef.current.delete(recordId);
      }
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  const uploadDroppedPathsViaSftp = useCallback(
    async (paths: string[]) => {
      if (isUnmountedRef.current || !activeTermId || !serverId || paths.length === 0) return;
      let cwd = terminalCwdRef.current.get(activeTermId);
      if (!cwd?.startsWith("/")) {
        try {
          cwd = await sshService.getHomeDirectory(serverId);
        } catch {
          cwd = "/";
        }
      }
      if (!cwd?.startsWith("/")) cwd = "/";
      const recordId = crypto.randomUUID();
      let batchTotalBytes: number | undefined;
      let batchTotalFiles: number | undefined;
      try {
        const stats = await sshService.getLocalUploadStats(paths);
        batchTotalBytes = stats.totalBytes;
        batchTotalFiles = stats.totalFiles;
      } catch {
        batchTotalBytes = undefined;
      }
      if (isUnmountedRef.current) return;
      pendingSftpRecordRef.current = recordId;
      sftpFileProgressRef.current.set(recordId, new Map());
      setShowTransferDialog(true);
      setUploadRecords([
        {
          id: recordId,
          files: paths.map((path) => path.split(/[\\/]/).pop() || path),
          directory: cwd,
          protocol: "SFTP",
          status: "uploading",
          phase: "transferring",
          at: Date.now(),
          bytes: 0,
          totalBytes: batchTotalBytes,
          speed: 0,
          completedFiles: 0,
          totalFiles: batchTotalFiles,
        },
      ]);
      try {
        const result = await sshService.uploadFromPaths(serverId, cwd, paths);
        if (isUnmountedRef.current) return;
        if (!result.success)
          throw new Error(result.error || t("sftp_upload_failed"));
        setUploadRecords((prev) =>
          prev.map((record) =>
            record.id === recordId
              ? {
                  ...record,
                  status: "success",
                  bytes: record.totalBytes || record.bytes,
                }
              : record,
          ),
        );
        pendingSftpRecordRef.current = null;
        sftpFileProgressRef.current.delete(recordId);
        transferAutoCloseTimerRef.current = setTimeout(() => {
          setShowTransferDialog(false);
          setUploadRecords([]);
          transferAutoCloseTimerRef.current = null;
        }, 1400);
      } catch (error) {
        pendingSftpRecordRef.current = null;
        sftpFileProgressRef.current.delete(recordId);
        if (isUnmountedRef.current) return;
        setUploadRecords((prev) =>
          prev.map((record) =>
            record.id === recordId
              ? {
                  ...record,
                  status: "failed",
                  error: error instanceof Error ? error.message : String(error),
                }
              : record,
          ),
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTermId, serverId],
  );

  const cancelActiveTransfer = useCallback(() => {
    if (zmodemHandshakeTimerRef.current) {
      clearTimeout(zmodemHandshakeTimerRef.current);
      zmodemHandshakeTimerRef.current = null;
    }
    if (transferAutoCloseTimerRef.current) {
      clearTimeout(transferAutoCloseTimerRef.current);
      transferAutoCloseTimerRef.current = null;
    }
    pendingZmodemPathsRef.current = null;
    const active = Array.from(zmodemSessionsRef.current.entries())[0];
    if (active) {
      const [sessionId, entry] = active;
      try {
        entry.session?.abort?.();
      } catch {
        /* session may already be closed */
      }
      zmodemSessionsRef.current.delete(sessionId);
      void sshService.shellZmodemEnd(sessionId);
      setUploadRecords((prev) =>
        prev.map((record) =>
          record.status === "uploading"
            ? {
                ...record,
                status: "failed",
                error: t("sftp_transfer_user_canceled"),
              }
            : record,
        ),
      );
    }
    const sftpRecord = uploadRecords.find(
      (record) => record.protocol === "SFTP" && record.status === "uploading",
    );
    if (sftpRecord?.transferId) {
      void (async () => {
        try {
          await sshService.cancelTransfer(sftpRecord.transferId!);
        } catch {
          /* task may already be done */
        }
        if (sftpRecord.tmpPath) {
          await new Promise<void>((resolve) => setTimeout(resolve, 200));
          try {
            await sshService.cleanupTmpFile(serverId, sftpRecord.tmpPath, true);
          } catch {
            /* best effort */
          }
        }
      })();
    }
    pendingSftpRecordRef.current = null;
    sftpFileProgressRef.current.clear();
    setUploadRecords([]);
    setShowTransferDialog(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, uploadRecords]);

  const handleTerminalDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setTerminalDragOver(false);
      const files = Array.from(event.dataTransfer.files) as Array<
        File & { path?: string }
      >;
      const paths = files
        .map((file) => file.path)
        .filter((path): path is string => Boolean(path));
      if (paths.length > 0) {
        await uploadDroppedPathsViaSftp(paths);
      }
    },
    [uploadDroppedPathsViaSftp],
  );

  // Tauri 2 桌面端通过当前 WebView 的原生拖放事件提供真实路径；
  // 浏览器 File.path 在 WebView 中通常为空，不能作为主路径来源。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const promise = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        if (!isActive || event.payload.paths.length === 0) return;

        const paths = event.payload.paths.filter(
          (path) => !path.toLowerCase().endsWith("inputfiles.lst"),
        );
        void uploadDroppedPathsViaSftp(paths);
      }
    });
    promise
      .then((cleanup) => {
        if (cancelled) cleanup();
        else unlisten = cleanup;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isActive, uploadDroppedPathsViaSftp]);

  // 串口硬件引脚状态 (CTS/DSR/RI/CD) 周期性轮询
  const activeSessionId = activeTermId ? terminals.get(activeTermId)?.sessionId : null;
  useEffect(() => {
    if (!isActive || (server?.targetType !== "serial" && server?.protocol !== "serial")) return;
    const sessionId = activeSessionId || (activeTermId ? xtermInstances.current.get(activeTermId)?.sessionId : null);
    if (!sessionId) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const pollSignals = async () => {
      const [signalsResult, statsResult] = await Promise.allSettled([
        sshService.getSerialSignals(sessionId),
        sshService.getSerialStats(sessionId),
      ]);
      if (
        isUnmountedRef.current ||
        !Array.from(xtermInstances.current.values()).some(
          (instance) => instance.sessionId === sessionId,
        )
      ) {
        return;
      }
      if (signalsResult.status === "fulfilled") setSerialSignals(signalsResult.value);
      if (statsResult.status === "fulfilled") {
        const now = Date.now();
        const stats = statsResult.value;
        const previous = serialStatsSampleRef.current;
        const elapsed = previous?.sessionId === sessionId ? Math.max((now - previous.at) / 1000, 0.001) : 0;
        setSerialStats({
          rxBytes: stats.rxBytes,
          txBytes: stats.txBytes,
          rxRate: elapsed > 0 ? Math.max(0, stats.rxBytes - previous!.rxBytes) / elapsed : 0,
          txRate: elapsed > 0 ? Math.max(0, stats.txBytes - previous!.txBytes) / elapsed : 0,
        });
        serialStatsSampleRef.current = { sessionId, rxBytes: stats.rxBytes, txBytes: stats.txBytes, at: now };
      }
    };

    pollSignals();
    timer = setInterval(pollSignals, 1500);
    return () => {
      if (timer) clearInterval(timer);
      if (serialStatsSampleRef.current?.sessionId === sessionId) serialStatsSampleRef.current = null;
    };
  }, [isActive, activeTermId, activeSessionId, server?.targetType, server?.protocol]);

  // 串口控制函数（Xshell / SecureCRT 级 Break 打断与 DTR/RTS 控制）
  const sendSerialBreak = useCallback(async (customMs?: number) => {
    const sessionId = activeTermId ? xtermInstances.current.get(activeTermId)?.sessionId : null;
    if (!sessionId) return;
    if (serialFileTransferActiveRef.current) {
      toastRef.current.warning(t("serial_file_send_busy"));
      return;
    }
    const dur = customMs || serialBreakDuration || 250;
    try {
      const result = await sshService.setSerialBreak(sessionId, dur);
      if (!result.success) throw new Error(result.error || "Backend failed to send Break");
      toastRef.current.success(t("term_break_sent", { dur }), 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toastRef.current.error(t("term_break_failed", { error: msg }), 3000);
    }
  }, [activeTermId, serialBreakDuration, t]);

  const toggleSerialDtr = useCallback(async () => {
    const sessionId = activeTermId ? xtermInstances.current.get(activeTermId)?.sessionId : null;
    if (!sessionId) return;
    if (serialFileTransferActiveRef.current) {
      toastRef.current.warning(t("serial_file_send_busy"));
      return;
    }
    const next = !serialDtr;
    try {
      const result = await sshService.setSerialDtr(sessionId, next);
      if (!result.success) throw new Error(result.error || "Backend failed to set DTR");
      setSerialDtr(next);
      toastRef.current.info(t("term_dtr_set", { level: next ? "HIGH" : "LOW" }), 1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toastRef.current.error(t("term_dtr_failed", { error: msg }), 3000);
    }
  }, [activeTermId, serialDtr, t]);

  const toggleSerialRts = useCallback(async () => {
    const sessionId = activeTermId ? xtermInstances.current.get(activeTermId)?.sessionId : null;
    if (!sessionId) return;
    if (serialFileTransferActiveRef.current) {
      toastRef.current.warning(t("serial_file_send_busy"));
      return;
    }
    const next = !serialRts;
    try {
      const result = await sshService.setSerialRts(sessionId, next);
      if (!result.success) throw new Error(result.error || "Backend failed to set RTS");
      setSerialRts(next);
      toastRef.current.info(t("term_rts_set", { level: next ? "HIGH" : "LOW" }), 1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toastRef.current.error(t("term_rts_failed", { error: msg }), 3000);
    }
  }, [activeTermId, serialRts, t]);

  const toggleSerialHexViewMode = useCallback(async () => {
    const sessionId = activeTermId ? xtermInstances.current.get(activeTermId)?.sessionId : null;
    const next = !serialHexViewMode;
    setSerialHexViewMode(next);
    if (!sessionId) return;
    try {
      const historyRaw = await sshService.getSerialHistoryRaw(sessionId);
      const rawBytes = decodeBase64Bytes(historyRaw);
      const activeTerm = activeTermId ? xtermInstances.current.get(activeTermId) : null;
      if (activeTerm) {
        activeTerm.term.clear();
        if (next) {
          const hexOutput = formatSerialHex(rawBytes);
          activeTerm.term.write(hexOutput);
        } else {
          const compactHex = Array.from(rawBytes, (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join(" ");
          const text = await sshService.decodeSerialHex(compactHex, serialEncodingLabel);
          activeTerm.term.write(text);
        }
      }
    } catch {
      // 忽略异常
    }
  }, [activeTermId, serialHexViewMode, serialEncodingLabel]);

  const reconnectSerial = useCallback(async () => {
    if (activeTermId) {
      await reconnectTerminal(activeTermId);
    }
  }, [activeTermId, reconnectTerminal]);

  const disconnectSerial = useCallback(async () => {
    const sessionId = activeTermId ? xtermInstances.current.get(activeTermId)?.sessionId : null;
    if (sessionId) {
      await sshService.closeShell(sessionId);
    }
    useAppStore.getState().setServerState(serverId, ConnectionState.Disconnected);
    if (baseServerId && baseServerId !== serverId) {
      useAppStore.getState().setServerState(baseServerId, ConnectionState.Disconnected);
    }
  }, [activeTermId, serverId, baseServerId]);

  const sendSerialFilePath = useCallback(async (path: string) => {
    const sessionId = activeTermId ? xtermInstances.current.get(activeTermId)?.sessionId : null;
    if (!sessionId || !sshService.isSessionAlive(sessionId)) {
      toastRef.current.warning(t("serial_connect_first"));
      return false;
    }
    if (serialFileTransferActiveRef.current) {
      toastRef.current.warning(t("serial_file_send_busy"));
      return false;
    }
    serialFileTransferActiveRef.current = true;
    try {
      // Finish any delayed keyboard/paste write that was queued before the file
      // transfer acquired the port. New interactive input is blocked above.
      await serialTextWriteQueues.get(sessionId)?.catch(() => undefined);
      const metadata = await stat(path);
      if (!metadata.isFile) throw new Error(t("serial_file_regular_only"));
      if (metadata.size <= 0) throw new Error(t("serial_file_empty"));
      if (metadata.size > 256 * 1024 * 1024) throw new Error(t("serial_file_too_large"));
      const bytes = await readFile(path);
      if (isUnmountedRef.current) return false;
      const name = path.split(/[\\/]/).pop() || "file.bin";
      setSerialFileProgress({ name, sent: 0, total: bytes.byteLength });
      // Keep each blocking driver write near 250ms so cancellation remains
      // responsive even at low baud rates. 8N1 is approximately 10 bits/byte.
      const configuredBaud = Math.max(1, Number(server?.port) || 115200);
      const chunkSize = Math.max(16, Math.min(4096, Math.floor(configuredBaud / 10 / 4)));
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        if (!serialFileTransferActiveRef.current) throw new Error(t("serial_file_send_cancelled"));
        const chunk = Array.from(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength)));
        const result = await sshService.writeSerialRaw(sessionId, chunk);
        if (!result.success) throw new Error(result.error || t("serial_file_write_failed"));
        if (isUnmountedRef.current) return false;
        setSerialFileProgress({
          name,
          sent: Math.min(offset + chunk.length, bytes.byteLength),
          total: bytes.byteLength,
        });
      }
      toastRef.current.success(t("serial_file_send_success", { name }));
      return true;
    } catch (error) {
      if (isUnmountedRef.current) return false;
      toastRef.current.error(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      serialFileTransferActiveRef.current = false;
      if (!isUnmountedRef.current) setSerialFileProgress(null);
    }
  }, [activeTermId, server?.port, t]);

  useEffect(() => {
    serialFileSenderRef.current = sendSerialFilePath;
    return () => {
      if (serialFileSenderRef.current === sendSerialFilePath) serialFileSenderRef.current = null;
    };
  }, [sendSerialFilePath]);

  const sendSerialFile = useCallback(async () => {
    const selected = await openDialog({
      multiple: false,
      directory: false,
      title: t("serial_select_file"),
    });
    if (typeof selected === "string" && selected) await sendSerialFilePath(selected);
  }, [sendSerialFilePath, t]);

  const getActiveSerialSessionId = useCallback(() => {
    const sessionId = activeTermId
      ? xtermInstances.current.get(activeTermId)?.sessionId
      : null;
    if (!sessionId || !sshService.isSessionAlive(sessionId)) {
      toastRef.current.warning(t("serial_connect_first"));
      return null;
    }
    return sessionId;
  }, [activeTermId, t]);

  const exportSerialRaw = useCallback(async () => {
    const sessionId = getActiveSerialSessionId();
    if (!sessionId) return;
    try {
      const bytes = decodeBase64Bytes(await sshService.getSerialHistoryRaw(sessionId));
      if (bytes.byteLength === 0) {
        toastRef.current.info(t("serial_export_empty"));
        return;
      }
      const path = await saveDialog({
        title: t("serial_export_raw"),
        defaultPath: `serial-${Date.now()}.bin`,
        filters: [{ name: "Binary", extensions: ["bin"] }],
      });
      if (!path) return;
      await writeFile(path, bytes);
      toastRef.current.success(t("serial_export_saved", { path }));
    } catch (error) {
      toastRef.current.error(t("serial_export_failed", {
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [getActiveSerialSessionId, t]);

  const exportSerialText = useCallback(async () => {
    const sessionId = getActiveSerialSessionId();
    if (!sessionId) return;
    try {
      const bytes = decodeBase64Bytes(await sshService.getSerialHistoryRaw(sessionId));
      if (bytes.byteLength === 0) {
        toastRef.current.info(t("serial_export_empty"));
        return;
      }
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
      const text = await sshService.decodeSerialHex(hex, serialEncodingLabelRef.current);
      const path = await saveDialog({
        title: t("serial_export_text"),
        defaultPath: `serial-${Date.now()}.txt`,
        filters: [{ name: "Text", extensions: ["txt", "log"] }],
      });
      if (!path) return;
      await writeTextFile(path, text, { create: true });
      toastRef.current.success(t("serial_export_saved", { path }));
    } catch (error) {
      toastRef.current.error(t("serial_export_failed", {
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [getActiveSerialSessionId, t]);

  const clearSerialBuffers = useCallback(async () => {
    const sessionId = getActiveSerialSessionId();
    if (!sessionId || !activeTermId) return;
    const active = xtermInstances.current.get(activeTermId);
    active?.term.clear();
    serialPausedOutputRef.current.delete(activeTermId);
    serialLineStartMapRef.current.delete(activeTermId);
    setPendingOutputCounts((previous) => {
      const next = new Map(previous);
      next.delete(activeTermId);
      pendingOutputCountsRef.current = next;
      return next;
    });
    toastRef.current.success(t("serial_buffers_cleared"), 1800);
  }, [activeTermId, getActiveSerialSessionId, t]);

  const toggleSerialDisplayPause = useCallback(() => {
    setSerialDisplayPaused((paused) => {
      const next = !paused;
      serialDisplayPausedRef.current = next;
      if (!next && activeTermId) {
        const buffered = serialPausedOutputRef.current.get(activeTermId);
        const activeTerm = xtermInstances.current.get(activeTermId)?.term;
        serialPausedOutputRef.current.delete(activeTermId);
        if (buffered && activeTerm)
          writeTerminalOutput(activeTermId, activeTerm, buffered, false);
      }
      return next;
    });
  }, [activeTermId, writeTerminalOutput]);

  const handleSendSequenceStep = useCallback(async (item: SerialSequenceItem) => {
    const sessionId = activeTermId ? xtermInstances.current.get(activeTermId)?.sessionId : null;
    if (!sessionId || !sshService.isSessionAlive(sessionId)) {
      toastRef.current.warning(t("serial_connect_first"));
      return false;
    }
    try {
      if (item.type === "hex") {
        let hexPayload = item.payload;
        if (item.checksumType && item.checksumType !== "none") {
          const res = appendChecksumToHex(hexPayload, item.checksumType);
          if (!res.valid) {
            toastRef.current.error(res.error || "校验码计算失败");
            return false;
          }
          hexPayload = res.resultHex;
        }
        const res = await sshService.writeSerialHex(sessionId, hexPayload);
        if (!res.success) toastRef.current.error(res.error || "HEX 发送失败");
        else if (serialLocalEchoRef.current) {
          xtermInstances.current.get(activeTermId || "")?.term.write(`\x1b[90m[TX] ${hexPayload}\x1b[0m\r\n`);
        }
        return res.success;
      } else {
        const payload = item.payload + item.suffix;
        await writeSerialTextWithDelays(
          sessionId,
          payload,
          serialEncodingLabelRef.current,
          serialLineDelayRef.current,
          serialCharDelayRef.current,
        );
        if (serialLocalEchoRef.current) {
          xtermInstances.current.get(activeTermId || "")?.term.write(payload);
        }
        return true;
      }
    } catch (error) {
      toastRef.current.error(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [activeTermId, t]);



  // HEX 空格智能切换（有空格则一键去除，无空格则一键成对加空格）
  const toggleHexSpacing = useCallback(() => {
    const clean = serialSendText.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
    if (!clean) return;
    if (/\s/.test(serialSendText)) {
      setSerialSendText(clean);
    } else {
      const pairs = clean.match(/.{1,2}/g) || [];
      setSerialSendText(pairs.join(" "));
    }
  }, [serialSendText]);

  // HEX 大小端字节序转换 (Big-Endian ↔ Little-Endian)
  // chunkSize: 2 = 16位/双字节翻转, 4 = 32位/四字节翻转, 0 = 全部字节完全倒序
  const swapEndianness = useCallback((chunkSize: 2 | 4 | 0) => {
    const clean = serialSendText.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
    if (!clean || clean.length % 2 !== 0) {
      toastRef.current.warning(t("term_hex_input_invalid"));
      return;
    }
    const bytes = clean.match(/.{1,2}/g) || [];
    if (bytes.length === 0) return;

    const resultBytes: string[] = [];
    if (chunkSize === 0) {
      resultBytes.push(...[...bytes].reverse());
    } else if (chunkSize === 2) {
      for (let i = 0; i < bytes.length; i += 2) {
        if (i + 1 < bytes.length) {
          resultBytes.push(bytes[i + 1], bytes[i]);
        } else {
          resultBytes.push(bytes[i]);
        }
      }
    } else if (chunkSize === 4) {
      for (let i = 0; i < bytes.length; i += 4) {
        const chunk = bytes.slice(i, i + 4);
        resultBytes.push(...chunk.reverse());
      }
    }

    if (/\s/.test(serialSendText)) {
      setSerialSendText(resultBytes.join(" "));
    } else {
      setSerialSendText(resultBytes.join(""));
    }
    toastRef.current.success(
      chunkSize === 2
        ? t("term_endian_flipped_16")
        : chunkSize === 4
          ? t("term_endian_flipped_32")
          : t("term_bytes_reversed"),
      1500
    );
  }, [serialSendText, t]);

  // 模式切换时自动双向转换内容（ASCII ↔ HEX）
  const handleSwitchSendType = useCallback(async (newType: "ascii" | "hex") => {
    if (newType === serialSendType) return;
    const text = serialSendText.trim();
    if (!text) {
      setSerialSendType(newType);
      return;
    }

    if (newType === "hex") {
      // 切换为 HEX：若已是 HEX 则规范化空格，否则按 UTF-8 编码转为 HEX 字符串
      const isAlreadyHex = /^[0-9a-fA-F\s]+$/.test(text) && text.replace(/\s+/g, "").length % 2 === 0;
      if (isAlreadyHex) {
        const clean = text.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
        const pairs = clean.match(/.{1,2}/g) || [];
        setSerialSendText(pairs.join(" "));
      } else {
        try {
          setSerialSendText(await sshService.encodeSerialText(serialSendText, serialEncodingLabel));
        } catch (error) {
          toastRef.current.error(error instanceof Error ? error.message : String(error));
          return;
        }
      }
    } else {
      // 切换为 ASCII：尝试将当前 HEX 字节解码为字符
      const clean = text.replace(/[^0-9a-fA-F]/g, "");
      if (clean.length > 0 && clean.length % 2 === 0) {
        try {
          setSerialSendText(await sshService.decodeSerialHex(clean, serialEncodingLabel));
        } catch (error) {
          toastRef.current.error(error instanceof Error ? error.message : String(error));
          return;
        }
      }
    }
    setSerialSendType(newType);
  }, [serialSendText, serialSendType, serialEncodingLabel]);

  // 串口发送函数（支持 ASCII 文本 / 原始十六进制 HEX / 校验码自动追加 / 行间延时节流）
  const handleSendSerialInput = useCallback(async () => {
    const sessionId = activeTermId ? xtermInstances.current.get(activeTermId)?.sessionId : null;
    if (!sessionId || !sshService.isSessionAlive(sessionId)) {
      toastRef.current.warning(t("serial_connect_first"));
      return false;
    }
    if (!serialSendText) return false;

    try {
      if (serialSendType === "hex") {
        let hexToSend = serialSendText;
        if (serialChecksumType !== "none") {
          const checkRes = appendChecksumToHex(serialSendText, serialChecksumType);
          if (checkRes.valid) {
            hexToSend = checkRes.resultHex;
          } else {
            toastRef.current.error(`校验码计算失败: ${checkRes.error}`, 2500);
            return false;
          }
        }
        const res = await sshService.writeSerialHex(sessionId, hexToSend);
        if (!res.success) {
          toastRef.current.error(`HEX 发送失败: ${res.error}`, 2500);
          return false;
        }
        if (serialLocalEchoRef.current) {
          xtermInstances.current.get(activeTermId || "")?.term.write(`\x1b[90m[TX] ${hexToSend}\x1b[0m\r\n`);
        }
      } else {
        const payload = serialSendText + serialSendSuffix;
        await writeSerialTextWithDelays(
          sessionId,
          payload,
          serialEncodingLabel,
          serialLineDelay,
          serialCharDelay,
        );
        if (serialLocalEchoRef.current) {
          xtermInstances.current.get(activeTermId || "")?.term.write(payload);
        }
      }
      const historyValue = serialSendText.trim();
      if (historyValue) {
        setSerialSendHistory((previous) => {
          const next = [historyValue, ...previous.filter((item) => item !== historyValue)].slice(0, 30);
          localStorage.setItem("serial-send-history", JSON.stringify(next));
          return next;
        });
      }
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toastRef.current.error(`发送失败: ${msg}`, 3000);
      return false;
    }
  }, [activeTermId, serialSendText, serialSendType, serialChecksumType, serialSendSuffix, serialEncodingLabel, serialLineDelay, serialCharDelay, t]);

  const runSerialAutoSendTick = useCallback(async () => {
    if (serialAutoSendInFlightRef.current) return;
    serialAutoSendInFlightRef.current = true;
    try {
      const sent = await handleSendSerialInput();
      if (sent) {
        setSerialAutoSendCount((c) => c + 1);
      } else {
        setSerialAutoSend(false);
      }
    } finally {
      serialAutoSendInFlightRef.current = false;
    }
  }, [handleSendSerialInput]);

  const toggleSerialAutoSend = useCallback(() => {
    if (serialAutoSend) {
      setSerialAutoSend(false);
      setSerialAutoSendCount(0);
      return;
    }
    if (!serialSendText.trim()) {
      toastRef.current.warning(t("serial_auto_send_empty"));
      return;
    }
    // 启动时立即发送一次，并初始化计数器
    setSerialAutoSendCount(0);
    setSerialAutoSend(true);
    void runSerialAutoSendTick();
  }, [runSerialAutoSendTick, serialAutoSend, serialSendText, t]);

  // 串口定时循环自动发送
  useEffect(() => {
    if (serialAutoSend && serialSendText.trim()) {
      if (serialAutoSendTimerRef.current) clearInterval(serialAutoSendTimerRef.current);
      serialAutoSendTimerRef.current = setInterval(() => {
        void runSerialAutoSendTick();
      }, Math.min(60000, Math.max(50, serialAutoSendInterval)));
    } else {
      if (serialAutoSendTimerRef.current) {
        clearInterval(serialAutoSendTimerRef.current);
        serialAutoSendTimerRef.current = null;
      }
    }
    return () => {
      if (serialAutoSendTimerRef.current) {
        clearInterval(serialAutoSendTimerRef.current);
        serialAutoSendTimerRef.current = null;
      }
    };
  }, [serialAutoSend, serialAutoSendInterval, runSerialAutoSendTick, serialSendText]);

  // 将串口状态与操作实时注册给外层 ModuleTabs 顶栏（实现整齐单行无缝内嵌）
  useEffect(() => {
    if (!registerSerialToolbar) return;
    if (!isActive || (server?.targetType !== "serial" && server?.protocol !== "serial")) {
      registerSerialToolbar(null);
      return;
    }

    registerSerialToolbar({
      portName: server?.host || "COM1",
      baudRate: server?.port || 115200,
      signals: serialSignals,
      dtr: serialDtr,
      rts: serialRts,
      toggleDtr: toggleSerialDtr,
      toggleRts: toggleSerialRts,
      breakDuration: serialBreakDuration,
      setBreakDuration: setSerialBreakDuration,
      sendBreak: sendSerialBreak,
      timestampMode: serialTimestampMode,
      toggleTimestampMode: () => setSerialTimestampMode((v) => !v),
      hexViewMode: serialHexViewMode,
      toggleHexViewMode: toggleSerialHexViewMode,
      quickSendOpen: serialQuickSendOpen,
      toggleQuickSendOpen: () => setSerialQuickSendOpen((v) => !v),
      connected: activeTermId
        ? terminals.get(activeTermId)?.status === "connected"
        : false,
      reconnect: reconnectSerial,
      disconnect: disconnectSerial,
      localEcho: serialLocalEcho,
      toggleLocalEcho: () => setSerialLocalEcho((value) => !value),
      displayPaused: serialDisplayPaused,
      toggleDisplayPause: toggleSerialDisplayPause,
      stats: serialStats,
      sendFile: sendSerialFile,
      openSequenceDialog: () => setSerialSequenceDialogOpen(true),
      openIapDialog: () => setSerialIapDialogOpen(true),
    });

    return () => {
      registerSerialToolbar(null);
    };
  }, [
    registerSerialToolbar,
    isActive,
    server?.targetType,
    server?.protocol,
    server?.host,
    server?.port,
    serialSignals,
    serialDtr,
    serialRts,
    toggleSerialDtr,
    toggleSerialRts,
    serialBreakDuration,
    sendSerialBreak,
    serialTimestampMode,
    serialHexViewMode,
    toggleSerialHexViewMode,
    serialQuickSendOpen,
    activeTermId,
    terminals,
    reconnectSerial,
    disconnectSerial,
    serialLocalEcho,
    serialDisplayPaused,
    toggleSerialDisplayPause,
    serialStats,
    sendSerialFile,
  ]);

  const serialConnected =
    !!activeTermId && terminals.get(activeTermId)?.status === "connected";

  // U5：稳定传给子组件的回调引用，配合子组件的 React.memo，避免搜索输入等高频
  // state 变化导致无关子组件（右键菜单 / 划词工具条等）无谓重渲染。
  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);
  const handleCopyAllOutput = useCallback(() => {
    void copyAllOutput();
  }, [copyAllOutput]);
  const openLogFile = useCallback(() => {
    void handleOpenLogFile();
  }, [handleOpenLogFile]);
  const openLogFolder = useCallback(() => {
    void handleOpenLogFolder();
  }, [handleOpenLogFolder]);
  const chooseLogDirectory = useCallback(() => {
    void handleChooseLogDirectory();
  }, [handleChooseLogDirectory]);
  const closeSelectionToolbar = useCallback(() => setSelectionToolbar(null), []);
  const handleSelectionContextMenu = useCallback((x: number, y: number) => {
    setSelectionToolbar(null);
    setCtxMenu({ x, y, hasSelection: true });
  }, []);
  const handleHoverHint = useCallback(
    (i: number) => {
      hintIndexRef.current = i;
      setHintIndex(i);
    },
    [hintIndexRef],
  );
  const handleSelectHint = useCallback(
    (hint: HintItem) => {
      const termId = activeTermIdRef.current;
      const session = termId ? terminalsRef.current.get(termId) : undefined;
      if (session?.sessionId) {
        const { insertText, newInput, cursorBack } = applyHint(
          currentInputRef.current,
          hint,
        );
        if (insertText) {
          const trimmedInsert = insertText.replace(/\s+$/, "");
          const trimmedInput = newInput.replace(/\s+$/, "");
          if (trimmedInsert) {
            const moveLeft =
              cursorBack && cursorBack > 0 ? "\x1b[D".repeat(cursorBack) : "";
            broadcastToShells(session.sessionId, trimmedInsert + moveLeft);
            currentInputRef.current =
              cursorBack && cursorBack > 0 && trimmedInput.length >= cursorBack
                ? trimmedInput.slice(0, -cursorBack)
                : trimmedInput;
            playSound(SoundType.Complete);
          }
        }
      }
      setCmdHints([]);
      setHintVisible(false);
    },
    [activeTermIdRef, broadcastToShells],
  );
  const searchTextLatestRef = useLatestRef(searchText);
  const handleSearchTextChange = useCallback(
    (val: string) => {
      setSearchText(val);
      doSearch(val, "next", false);
    },
    [doSearch],
  );
  const handleToggleRegex = useCallback(() => {
    const next = !searchRegexRef.current;
    searchRegexRef.current = next;
    setSearchRegex(next);
    if (searchTextLatestRef.current) {
      doSearch(searchTextLatestRef.current, "next", true);
    }
  }, [doSearch, searchRegexRef, searchTextLatestRef]);
  const handleToggleCaseSensitive = useCallback(() => {
    const next = !searchCaseSensitiveRef.current;
    searchCaseSensitiveRef.current = next;
    setSearchCaseSensitive(next);
    if (searchTextLatestRef.current) {
      doSearch(searchTextLatestRef.current, "next", true);
    }
  }, [doSearch, searchCaseSensitiveRef, searchTextLatestRef]);
  const handleToggleWholeWord = useCallback(() => {
    const next = !searchWholeWordRef.current;
    searchWholeWordRef.current = next;
    setSearchWholeWord(next);
    if (searchTextLatestRef.current) {
      doSearch(searchTextLatestRef.current, "next", true);
    }
  }, [doSearch, searchTextLatestRef, searchWholeWordRef]);
  const handleSearchBarKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.select();
        return;
      }
      if (e.key === "F3" && !e.nativeEvent.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) {
          handleFindPrev();
        } else {
          handleFindNext();
        }
      }
    },
    [handleFindNext, handleFindPrev],
  );
  const pendingPasteLatestRef = useLatestRef(pendingPaste);
  const handleClosePasteConfirm = useCallback(() => setPendingPaste(null), []);
  const handleConfirmPaste = useCallback(
    (dontAskAgain: boolean) => {
      if (dontAskAgain) {
        setTerminalPasteWarnEnabled(false);
      }
      const currentPaste = pendingPasteLatestRef.current;
      if (currentPaste) {
        writePasteText(currentPaste.text, currentPaste.sessionId);
      }
      setPendingPaste(null);
    },
    [pendingPasteLatestRef, setTerminalPasteWarnEnabled, writePasteText],
  );

  return (
    <div
      className={cn(
        "flex h-full",
        isSerialConsole ? "flex-row" : "flex-col",
        isFullscreen && !isSplitPane && "fixed inset-0 z-50 bg-background",
      )}
    >
      {isSerialConsole && (
        <aside className={cn(
          "flex h-full w-64 shrink-0 flex-col border-r border-border/70 theme-glass-panel",
        )}>
          {/* 头部：连接状态 + 端口/波特率 + 连接操作 */}
          <div className="border-b border-border/60 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", serialConnected ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-muted-foreground/40")} />
                <span className="truncate text-xs font-semibold text-foreground">{t("status_serial_mode")}</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{serialConnected ? t("serial_connected") : t("status_serial_disconnected")}</span>
            </div>
            <div className="mt-1.5 flex items-stretch gap-1.5 text-[10px]">
              <div className="min-w-0 flex-1 rounded-md border border-border/60 bg-background/70 px-2 py-1"><span className="block text-muted-foreground">{t("serial_port_name")}</span><span className="block truncate font-mono text-foreground">{server?.host || "—"}</span></div>
              <div className="min-w-0 flex-1 rounded-md border border-border/60 bg-background/70 px-2 py-1"><span className="block text-muted-foreground">{t("serial_baud")}</span><span className="block truncate font-mono text-foreground">{server?.port || 115200}</span></div>
            </div>
            <button type="button" onClick={serialConnected ? disconnectSerial : reconnectSerial} className="mt-1.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-border/70 bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted">
              {serialConnected ? <WifiOff className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {serialConnected ? t("serial_disconnect") : t("serial_reconnect")}
            </button>
          </div>

          {/* 主体：紧凑双列布局，常规窗口高度下无需滚动即可展示全部功能 */}
          <div className="flex-1 overflow-y-auto px-3 py-2.5">
            {/* 速率（悬停查看累计收发）与帧配置 */}
            <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/50 px-2 py-1.5 font-mono text-[10px]" title={`${t("serial_rx_total")}: ${serialStats.rxBytes.toLocaleString()} B\n${t("serial_tx_total")}: ${serialStats.txBytes.toLocaleString()} B`}>
              <span className="text-emerald-600 dark:text-emerald-400">RX {formatSerialMetric(serialStats.rxRate, "/s")}</span>
              <span className="text-sky-600 dark:text-sky-400">TX {formatSerialMetric(serialStats.txRate, "/s")}</span>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-[10px]">
              <div className="rounded-md bg-muted/35 px-2 py-1.5"><span className="block text-muted-foreground">{t("serial_frame_format")}</span><span className="font-mono text-foreground">{serialConfigSummary.frame}</span></div>
              <div className="rounded-md bg-muted/35 px-2 py-1.5"><span className="block text-muted-foreground">{t("serial_flow")}</span><span className="font-mono text-foreground">{serialConfigSummary.flow}</span></div>
              <div className="rounded-md bg-muted/35 px-2 py-1.5"><span className="block text-muted-foreground">{t("serial_encoding_short")}</span><span className="font-mono uppercase text-foreground">{serialEncodingLabel}</span></div>
              <div className="rounded-md bg-muted/35 px-2 py-1.5"><span className="block text-muted-foreground">{t("serial_newline_short")}</span><span className="font-mono uppercase text-foreground">{serialNewlineMode}</span></div>
            </div>
            <div className="mt-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("serial_hardware")}</p>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" disabled={!serialToolbarAvailable(activeTermId, terminals)} onClick={toggleSerialDtr} className={cn("flex h-7 items-center justify-between rounded-md border px-2 text-xs transition-colors", serialDtr ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border/60 bg-background/50 text-muted-foreground")}><span>DTR</span><span className="font-mono text-[10px]">{serialDtr ? "HIGH" : "LOW"}</span></button>
                <button type="button" disabled={!serialToolbarAvailable(activeTermId, terminals)} onClick={toggleSerialRts} className={cn("flex h-7 items-center justify-between rounded-md border px-2 text-xs transition-colors", serialRts ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-border/60 bg-background/50 text-muted-foreground")}><span>RTS</span><span className="font-mono text-[10px]">{serialRts ? "HIGH" : "LOW"}</span></button>
              </div>
              {/* Break：点击发送，右侧下拉选择时长（预设 + 自定义毫秒数） */}
              <div className="mt-1.5 flex h-7 overflow-hidden rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                <button type="button" disabled={!serialToolbarAvailable(activeTermId, terminals)} onClick={() => void sendSerialBreak(serialBreakDuration)} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-xs transition-colors hover:bg-amber-500/15 disabled:opacity-40" title={t("serial_send_break", { duration: serialBreakDuration })}>
                  <Zap className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Break {serialBreakDuration}ms</span>
                </button>
                <DropdownMenu open={serialBreakMenuOpen} onOpenChange={setSerialBreakMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <button type="button" disabled={!serialToolbarAvailable(activeTermId, terminals)} className="flex w-6 items-center justify-center border-l border-amber-500/25 transition-colors hover:bg-amber-500/15 disabled:opacity-40" title={t("serial_break_duration")}>
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40 p-1">
                    {[100, 250, 500, 1000, 3000].map((ms) => (
                      <DropdownMenuItem key={ms} onClick={() => { setSerialBreakDuration(ms); setSerialBreakMenuOpen(false); }} className="justify-between text-xs cursor-pointer">
                        <span>{ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}</span>
                        {serialBreakDuration === ms && <Check className="h-3.5 w-3.5" />}
                      </DropdownMenuItem>
                    ))}
                    <div className="mt-1 flex items-center gap-1 border-t border-border/50 p-1 pt-2" onClick={(event) => event.stopPropagation()}>
                      <input type="number" min={10} max={10000} value={serialCustomBreakInput} onChange={(event) => setSerialCustomBreakInput(event.target.value)} placeholder={t("serial_custom_break")} className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-[10px] font-mono" />
                      <button type="button" onClick={() => { const value = Math.min(10000, Math.max(10, parseInt(serialCustomBreakInput) || serialBreakDuration)); setSerialBreakDuration(value); setSerialCustomBreakInput(""); setSerialBreakMenuOpen(false); }} className="h-7 cursor-pointer rounded bg-primary px-2 text-[10px] text-primary-foreground">{t("serial_apply")}</button>
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <div className="mt-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("serial_display")}</p>
              <div className="grid grid-cols-2 gap-1.5">
                <button type="button" onClick={() => setSerialTimestampMode((value) => !value)} className={cn("flex h-7 items-center justify-between gap-1 rounded-md border px-2 text-[11px] transition-colors", serialTimestampMode ? "border-primary/40 bg-primary/10 text-primary" : "border-border/60 bg-background/50 text-muted-foreground hover:bg-muted")}><span className="truncate">{t("serial_timestamp")}</span><span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", serialTimestampMode ? "bg-primary" : "bg-muted-foreground/30")} /></button>
                <button type="button" disabled={!serialToolbarAvailable(activeTermId, terminals)} onClick={() => void toggleSerialHexViewMode()} className={cn("flex h-7 items-center justify-between gap-1 rounded-md border px-2 text-[11px] transition-colors disabled:opacity-40", serialHexViewMode ? "border-primary/40 bg-primary/10 text-primary" : "border-border/60 bg-background/50 text-muted-foreground hover:bg-muted")}><span className="truncate">HEX</span><span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", serialHexViewMode ? "bg-primary" : "bg-muted-foreground/30")} /></button>
                <button type="button" onClick={() => setSerialLocalEcho((value) => !value)} className={cn("flex h-7 items-center justify-between gap-1 rounded-md border px-2 text-[11px] transition-colors", serialLocalEcho ? "border-primary/40 bg-primary/10 text-primary" : "border-border/60 bg-background/50 text-muted-foreground hover:bg-muted")}><span className="truncate">{t("serial_local_echo")}</span><span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", serialLocalEcho ? "bg-primary" : "bg-muted-foreground/30")} /></button>
                <button type="button" disabled={!serialToolbarAvailable(activeTermId, terminals)} onClick={toggleSerialDisplayPause} className={cn("flex h-7 items-center justify-between gap-1 rounded-md border px-2 text-[11px] transition-colors disabled:opacity-40", serialDisplayPaused ? "border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-300" : "border-border/60 bg-background/50 text-muted-foreground hover:bg-muted")}><span className="truncate">{serialDisplayPaused ? t("serial_resume_display") : t("serial_pause_display")}</span>{serialDisplayPaused ? <Play className="h-3 w-3 shrink-0" /> : <Pause className="h-3 w-3 shrink-0" />}</button>
              </div>
            </div>
            <div className="mt-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("serial_tools")}</p>
              <button type="button" onClick={() => setSerialQuickSendOpen((value) => !value)} className={cn("flex h-7 w-full items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors", serialQuickSendOpen ? "border-primary bg-primary text-primary-foreground shadow-xs" : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20")}><Send className="h-3 w-3 shrink-0" /><span className="truncate">{t("serial_quick_send")}</span></button>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <button type="button" disabled={!serialToolbarAvailable(activeTermId, terminals)} onClick={() => void sendSerialFile()} className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/50 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"><FileUp className="h-3 w-3 shrink-0" /><span className="truncate">{t("serial_send_file")}</span></button>
                <button type="button" onClick={() => void exportSerialText()} className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/50 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Download className="h-3 w-3 shrink-0" /><span className="truncate">{t("serial_export_text")}</span></button>
                <button type="button" onClick={() => void exportSerialRaw()} className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/50 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Binary className="h-3 w-3 shrink-0" /><span className="truncate">{t("serial_export_raw")}</span></button>
                <button type="button" onClick={() => setSerialSequenceDialogOpen(true)} className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/50 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><ListOrdered className="h-3 w-3 shrink-0" /><span className="truncate">{t("serial_sequence")}</span></button>
                <button type="button" disabled={!serialToolbarAvailable(activeTermId, terminals)} onClick={() => setSerialIapDialogOpen(true)} className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/50 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"><Cable className="h-3 w-3 shrink-0" /><span className="truncate">{t("serial_iap")}</span></button>
                <button type="button" disabled={!serialToolbarAvailable(activeTermId, terminals)} onClick={() => void clearSerialBuffers()} className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/50 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"><Trash2 className="h-3 w-3 shrink-0" /><span className="truncate">{t("serial_clear_buffers")}</span></button>
              </div>
            </div>
          </div>
        </aside>
      )}
      <div className={isSerialConsole ? "flex min-w-0 flex-1 flex-col" : "contents"}>
      {/* Terminal area */}
      <div
        ref={terminalContainerRef}
        className="flex-1 h-full w-full relative overflow-hidden"
        onContextMenu={(e) => {
          // 兜底：终端容器之外的空白区域/覆盖层上的右键也要能弹出菜单。
          // 每个终端实例的 contextmenu 监听已处理并 preventDefault，这里跳过避免重复处理。
          if (e.defaultPrevented) return;
          e.preventDefault();
          setSelectionToolbar(null);
          const inst = activeTermId ? xtermInstances.current.get(activeTermId) : undefined;
          const hasSelection = !!inst?.term.getSelection();
          setCtxMenu({ x: e.clientX, y: e.clientY, hasSelection });
        }}
        onMouseDown={(e) => {
          const target = e.target as Element | null;
          // 点击搜索栏内部时，保持搜索栏焦点
          if (target?.closest?.(".terminal-search-bar, [data-terminal-search]")) {
            return;
          }
          if (isInteractiveOrInputElement(target)) {
            return;
          }

          // 用户点击终端区域，主动释放搜索框焦点并聚焦终端
          const searchInput = document.querySelector<HTMLInputElement>(
            ".terminal-search-bar input",
          );
          if (searchInput && (document.activeElement === searchInput || searchInput.contains(document.activeElement))) {
            searchInput.blur();
          }

          if (tabId) {
            const s = useAppStore.getState();
            const curTab = s.tabs.find((item) => item.id === tabId);
            if (curTab?.groupId && s.lastActiveGroupId !== curTab.groupId) {
              s.focusGroup(curTab.groupId);
            }
            if (s.activeTabId !== tabId) {
              s.setActiveTab(tabId);
            }
          }
          if (activeTermId) {
            focusActiveTerm(true);
            const xtermInfo = xtermInstances.current.get(activeTermId);
            if (xtermInfo) {
              try {
                // 仅当滚动容器尺寸真实失步时才执行校准，正常点击不无谓重排视口
                const core = (xtermInfo.term as any)._core;
                const scrollable = core?._viewport?._scrollableElement?._scrollable;
                const buf = xtermInfo.term.buffer?.active;
                const total = buf?.length || (buf as any)?.lines?.length || 0;
                if (
                  scrollable?._state &&
                  total > xtermInfo.term.rows &&
                  scrollable._state.scrollHeight <= scrollable._state.height
                ) {
                  syncTerminalScrollAndDimensions(xtermInfo.term);
                }
              } catch {
                // ignore
              }
            }
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setTerminalDragOver(true);
        }}
        onDragLeave={() => setTerminalDragOver(false)}
        onDrop={handleTerminalDrop}
        style={
          {
            backgroundColor: activeTheme.ui.background,
            "--xterm-term-bg": activeTheme.ui.background,
          } as React.CSSProperties
        }
      >
        {serialFileProgress && (
          <div className="absolute right-3 top-3 z-30 w-72 rounded-xl border border-border/70 bg-background/95 p-3 shadow-xl backdrop-blur">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground" title={serialFileProgress.name}>
                  {t("term_sending_file", { name: serialFileProgress.name })}
                </div>
                <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                  {serialFileProgress.sent.toLocaleString()} / {serialFileProgress.total.toLocaleString()} B
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px] text-destructive"
                onClick={() => { serialFileTransferActiveRef.current = false; }}
              >
                {t("common_cancel")}
              </Button>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150"
                style={{ width: `${serialFileProgress.total > 0 ? Math.min(100, (serialFileProgress.sent / serialFileProgress.total) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}
        <TerminalTransferDialog
          open={showTransferDialog}
          uploadRecords={uploadRecords}
          onCancel={cancelActiveTransfer}
        />
        {terminalDragOver && (
          <div className="absolute inset-3 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-primary text-sm text-primary pointer-events-none theme-glass-subtle">
            {t("fs_drag_upload_hint")}
          </div>
        )}
        <TerminalRecordingBadge
          activeTermId={activeTermId}
          recordingTermIds={recordingTermIds}
          recordingPausedIds={recordingPausedIds}
          isOpening={isOpening}
          onResumeRecording={handleResumeRecordingMenu}
          onPauseRecording={handlePauseRecordingMenu}
          onOpenLogFile={handleOpenLogFile}
          onStopRecording={handleToggleRecordingMenu}
        />
        {/* 背景媒体（图片/视频）与压暗色渲染在每个终端的 .term-host 父容器上，
            覆盖整个区域；.xterm 透明叠加其上，canvas 完全透明只画文字。
            这样无论 canvas 高度是否填满容器，整个区域都是统一的"背景图+压暗色"，
            彻底消除边缘留白和色差。详见上方 useEffect。 */}
        {Array.from(terminals.entries()).map(([termId, inst]) => (
          <div
            key={termId}
            className={cn(
              "absolute inset-0",
              activeTermId !== termId && "hidden",
            )}
          >
            <div
              ref={(el) => {
                if (el) {
                  termContainerRefs.current.set(termId, el);
                } else {
                  termContainerRefs.current.delete(termId);
                }
              }}
              className="term-host absolute inset-0"
            />
            <TerminalConnectionOverlay
              status={inst.status}
              error={inst.error}
              reconnectAttempt={inst.reconnectAttempt}
              server={server}
              termName={inst.name}
              isPeekRaw={peekRawTerminals.has(termId)}
              onTogglePeekRaw={() => {
                setPeekRawTerminals((prev) => {
                  const next = new Set(prev);
                  if (next.has(termId)) next.delete(termId);
                  else next.add(termId);
                  return next;
                });
              }}
              onReconnect={() => reconnectTerminal(termId)}
              onEditServer={baseServerId ? () => setEditServerOpen(true) : undefined}
            />
          </div>
        ))}

        {activeTermId && (pendingOutputCounts.get(activeTermId) ?? 0) > 0 && (
          <button
            type="button"
            onClick={jumpToLatestOutput}
            className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-primary/40 bg-background/95 px-3 py-1.5 text-xs text-primary shadow-lg backdrop-blur-sm hover:bg-accent"
            title={t("tm_jump_latest_output")}
          >
            <ArrowDown className="h-3.5 w-3.5" />
            <span>{t("tm_new_output_hint")}</span>
          </button>
        )}


        {activeTermId && activeCommandMarkers.length > 0 && (
          <div className="absolute bottom-3 left-3 z-20 flex items-center gap-1 rounded-lg border border-border/60 bg-background/90 p-1 shadow-md backdrop-blur-sm">
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => jumpCommandMarker("previous")}
              title={t("tm_previous_command")}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => jumpCommandMarker("next")}
              title={t("tm_next_command")}
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            {(() => {
              const latest = activeCommandMarkers.at(-1);
              if (!latest) return null;
              return (
                <span className="max-w-48 truncate border-l border-border/60 pl-2 pr-1 font-mono text-[10px] text-muted-foreground" title={latest.command}>
                  {typeof latest.exitCode === "number" && (
                    <span className={latest.exitCode === 0 ? "text-emerald-500" : "text-destructive"}>
                      {latest.exitCode === 0 ? "✓" : `✕ ${latest.exitCode}`}
                    </span>
                  )}{" "}
                  {latest.durationMs != null ? `${latest.durationMs} ms · ` : ""}
                  {latest.command}
                </span>
              );
            })()}
          </div>
        )}

        {hintLoading && !hintVisible && (
          <div className="pointer-events-none absolute right-3 top-3 z-30 flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <QshellLoader size="xs" text={t("hint_loading")} />

          </div>
        )}

        <TerminalHintPanel
          visible={hintVisible}
          hints={cmdHints}
          hintIndex={hintIndex}
          isLightTerminal={activeTheme?.type === "light"}
          activeUsage={hintResultRef.current?.usage}
          style={hintPanelStyle}
          onHoverHint={handleHoverHint}
          onSelectHint={handleSelectHint}
        />

        {terminals.size === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <p className="text-sm mb-2">{t("tm_no_terminal")}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => createTerminal()}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> {t("tm_new_terminal")}
            </Button>
          </div>
        )}

        <TerminalSearchBar
          open={showSearch}
          searchText={searchText}
          onSearchTextChange={handleSearchTextChange}
          searchState={searchState}
          searchRegex={searchRegex}
          onToggleRegex={handleToggleRegex}
          searchCaseSensitive={searchCaseSensitive}
          onToggleCaseSensitive={handleToggleCaseSensitive}
          searchWholeWord={searchWholeWord}
          onToggleWholeWord={handleToggleWholeWord}
          onKeyDown={handleSearchBarKeyDown}
          onFindPrev={handleFindPrev}
          onFindNext={handleFindNext}
          onClose={closeSearch}
        />



        {/* 全屏退出按钮（悬浮在终端区域右上角，保持小尺寸避免遮挡内容） */}
        {isFullscreen && !isSplitPane && onToggleFullscreen && (
          <button
            className="absolute right-[7px] top-0.5 z-[60] flex h-5 w-5 items-center justify-center rounded-md border border-white/10 bg-black/35 text-white/70 shadow-sm backdrop-blur-sm transition-colors hover:bg-black/55 hover:text-white"
            onClick={() => {
              onToggleFullscreen();
              playSound(SoundType.Toggle);
            }}
            title={`${t("tm_exit_fullscreen")} (Esc/F11)`}
          >
            <Minimize2 className="h-3 w-3" />
          </button>
        )}
      </div>

      <SerialQuickSendEditor
        open={Boolean((server?.targetType === "serial" || server?.protocol === "serial") && serialQuickSendOpen)}
        onClose={() => setSerialQuickSendOpen(false)}
        serialSendEditorHeight={serialSendEditorHeight}
        setSerialSendEditorHeight={setSerialSendEditorHeight}
        serialSendType={serialSendType}
        onSwitchSendType={handleSwitchSendType}
        serialSendText={serialSendText}
        setSerialSendText={setSerialSendText}
        hexAnalysis={hexAnalysis}
        serialSendHistory={serialSendHistory}
        onClearHistory={() => {
          setSerialSendHistory([]);
          localStorage.removeItem("serial-send-history");
        }}
        onSelectHistoryItem={(item) => setSerialSendText(item)}
        serialSendSuffix={serialSendSuffix}
        setSerialSendSuffix={setSerialSendSuffix}
        serialChecksumType={serialChecksumType}
        setSerialChecksumType={setSerialChecksumType}
        onSendSerialInput={handleSendSerialInput}
        serialEnterToSend={serialEnterToSend}
        setSerialEnterToSend={setSerialEnterToSend}
        serialAutoSend={serialAutoSend}
        setSerialAutoSend={setSerialAutoSend}
        toggleSerialAutoSend={toggleSerialAutoSend}
        serialAutoSendInterval={serialAutoSendInterval}
        setSerialAutoSendInterval={setSerialAutoSendInterval}
        serialAutoSendCount={serialAutoSendCount}
        serialLineDelay={serialLineDelay}
        swapEndianness={swapEndianness}
        toggleHexSpacing={toggleHexSpacing}
      />

      </div>

      {/* 多指令序列自动化发送弹窗 */}
      <SerialSequenceDialog
        open={serialSequenceDialogOpen}
        onOpenChange={setSerialSequenceDialogOpen}
        onSendStep={handleSendSequenceStep}
        isConnected={
          activeTermId
            ? terminals.get(activeTermId)?.status === "connected"
            : false
        }
      />

      {/* 串口 IAP 固件离线升级弹窗 */}
      <SerialIapDialog
        open={serialIapDialogOpen}
        sessionId={
          activeTermId ? terminals.get(activeTermId)?.sessionId || "" : ""
        }
        serverName={server?.name}
        portName={server?.host}
        baudRate={server?.port}
        onClose={() => setSerialIapDialogOpen(false)}
      />

      <TerminalContextMenu
        ctxMenu={ctxMenu}
        isLightTerminal={activeTheme?.type === "light"}
        onClose={closeCtxMenu}
        onCopy={handleCopy}
        onCopyAll={handleCopyAllOutput}
        onPaste={handlePaste}
        onPasteSelection={handlePasteSelection}
        onSearch={handleSearch}
        onClearScreen={handleClearScreen}
        onClearScrollback={handleClearScrollback}
        onClearAll={handleClearAll}
        onToggleRecording={handleToggleRecordingMenu}
        onPauseRecording={handlePauseRecordingMenu}
        onResumeRecording={handleResumeRecordingMenu}
        onOpenLogFile={openLogFile}
        onOpenLogFolder={openLogFolder}
        onChooseLogDirectory={chooseLogDirectory}
        activeTermId={activeTermId}
        recordingTermIds={recordingTermIds}
        recordingPausedIds={recordingPausedIds}
        isOpening={isOpening}
        onLockSession={handleTriggerAppLock}
        onAIDiagnosis={enableAiGlobal ? handleAIDiagnosisFromContext : undefined}
        onAIDiagnoseRecent={enableAiGlobal ? handleAIDiagnoseRecentOutput : undefined}
        onAIExplainShell={enableAiGlobal ? handleAIExplainShellFromContext : undefined}
      />

      <TerminalSelectionToolbar
        visible={!!selectionToolbar?.visible}
        x={selectionToolbar?.x ?? 0}
        y={selectionToolbar?.y ?? 0}
        selectedText={selectionToolbar?.text ?? ""}
        isLightTerminal={activeTheme?.type === "light"}
        onClose={closeSelectionToolbar}
        onCopy={handleCopy}
        onPasteSelection={handlePasteSelection}
        onSearch={handleSearch}
        onContextMenu={handleSelectionContextMenu}
      />

      <TerminalPasteConfirmDialog
        pendingPaste={pendingPaste}
        onClose={handleClosePasteConfirm}
        onConfirm={handleConfirmPaste}
      />

      {baseServerId && editServerOpen && (
        <EditServerDialog
          open={editServerOpen}
          onClose={() => setEditServerOpen(false)}
          serverId={baseServerId}
          onSaved={() => {
            if (activeTermId) {
              void reconnectTerminal(activeTermId);
            }
          }}
        />
      )}
    </div>
  );
}
