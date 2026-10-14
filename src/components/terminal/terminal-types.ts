import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { AsyncTerminalSearcher } from "@/utils/terminal-async-search";

export interface TerminalInstance {
  id: string;
  name: string;
  shellTitle?: string;
  customName?: boolean;
  lastExitCode?: number;
  lastCommand?: string;
  lastCommandDurationMs?: number;
  sessionId: string | null;
  status:
    | "connecting"
    | "connected"
    | "disconnected"
    | "error"
    | "reconnecting";
  error?: string;
  /** 当前自动重连尝试次数（成功后归零） */
  reconnectAttempt: number;
  /** 是否允许自动重连（用户主动关闭时设为 false） */
  autoReconnect: boolean;
}

export interface TerminalModuleProps {
  serverId: string;
  isActive?: boolean;
  isVisible?: boolean;
  isConnected?: boolean;
  /** 缺少 SSH 凭据或正在等待用户修正认证时，暂停创建/重连 Shell。 */
  connectionBlocked?: boolean;
  /** 认证阻断原因，用于在终端内展示状态而不是空白占位页。 */
  connectionBlockedReason?: "missing" | "rejected";
  /** Optional command to send to the shell immediately after creation (e.g. docker exec) */
  initialCommand?: string;
  /** 当前 tab ID，用于注册 shell 会话关联（广播时获取会话列表） */
  tabId?: string;
  /** Callback triggered when the initial shell is fully created or fails */
  onShellReady?: () => void;
  /** 分屏窗格模式：隐藏终端工具栏（新建/重连/清理/搜索/字体/字号/主题/状态/全屏），
   *  仅保留终端内容区，由外层 TabGroupView 的 Header 提供服务器标题与广播按钮 */
  isSplitPane?: boolean;
  /** 终端全屏：由外层 ModuleTabs 触发，控制终端覆盖整个工作区 */
  isFullscreen?: boolean;
  /** 切换全屏（Esc 键退出时回调） */
  onToggleFullscreen?: () => void;
  /** 注册搜索触发器：将 TerminalModule 内部的 toggleSearch 暴露给外层调用，
   *  用于 ModuleTabs 上的搜索按钮控制搜索面板的开关 */
  registerSearchTrigger?: (fn: (() => void) | null) => void;
  /** 将当前终端的输出操作注册给工作台顶部工具栏。 */
  registerOutputActions?: (
    actions: {
      clear: () => void;
      copy: () => Promise<void>;
      toggleRecording: () => Promise<void>;
      recording: boolean;
    } | null,
  ) => void;
  /** 注册串口专属顶栏控制状态（暴露给外层 ModuleTabs 统一单行渲染） */
  registerSerialToolbar?: (
    toolbar: import("@/components/workspace/module-tabs").SerialToolbarState | null,
  ) => void;
  /** 注册终端工作目录获取函数：供外层工作台在切换到文件模块等场景时获取当前终端所在目录 */
  registerGetCwd?: (fn: (() => string | undefined) | null) => void;
  /** 终端当前工作目录变化回调（活跃终端 cd / OSC 7 上报时触发），供文件面板即时跟随 */
  onCwdChange?: (cwd: string) => void;
  /** 用户在终端内触发手动重连（如断开状态下按回车）时的回调，用于唤醒工作台顶层连接流程与认证提示 */
  onReconnect?: () => void;
}

// xterm.js 内部核心对象（ICharSizeService / IRenderService 未在公开类型中导出）
export interface XtermCoreLike {
  _charSizeService?: { measure?: () => void };
  _renderService?: {
    clear?: () => void;
    _renderer?: {
      value?: {
        _updateDimensions?: () => void;
      };
    };
    dimensions?: {
      css?: {
        cell?: { width: number; height: number };
        canvas?: { width: number; height: number };
      };
    };
  };
  _viewport?: {
    _latestYDisp?: number;
    _scrollableElement?: {
      setScrollDimensions: (dimensions: { height: number; scrollHeight: number }) => void;
    };
    _sync?: () => void;
    scrollToLine?: (line: number, isSmooth?: boolean) => void;
  };
}

/** 串口打开参数（与 sshService.createSerialShell 参数一致） */
export interface SerialOpenConfig {
  portName: string;
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: string;
  flowControl: string;
  dtr: boolean;
  rts: boolean;
  encoding?: string;
  deviceVid?: number;
  devicePid?: number;
  deviceSerialNumber?: string;
}

// zmodem.js 未随包提供类型声明，按需描出本项目用到的最小接口
export interface ZmodemOfferLike {
  get_details?: () => {
    name?: string;
    size?: number;
    mtime?: Date;
    mode?: number;
    files_remaining?: number;
    bytes_remaining?: number;
  };
  skip: () => void;
  accept: (opts?: unknown) => Promise<Uint8Array[]>;
}

export interface ZmodemSessionLike {
  type?: string;
  abort?: () => void;
  on?: {
    (event: "offer", handler: (offer: ZmodemOfferLike) => void): void;
    (event: string, handler: (arg?: unknown) => void): void;
  };
  start?: () => Promise<unknown>;
}

export interface ZmodemDetectionLike {
  confirm: () => ZmodemSessionLike;
  deny: () => void;
}

export interface ZmodemSentryLike {
  consume?: (chunk: Uint8Array) => void;
}

export interface ZmodemModuleLike {
  Sentry?: new (opts: {
    to_terminal?: (octets: number[]) => void;
    sender?: (octets: number[]) => void;
    on_detect?: (detection: ZmodemDetectionLike) => void;
    /** zmodem.js 内部重传/回退回调，透传即可 */
    on_retract?: () => void;
  }) => ZmodemSentryLike;
  Browser?: {
    send_files?: (
      session: ZmodemSessionLike,
      files: File[],
      opts?: {
        on_progress?: (file: File, transfer: unknown, piece: Uint8Array) => void;
        on_send_response?: (xfer: unknown) => void;
      },
    ) => Promise<unknown>;
  };
}

export interface ContextMenuState {
  x: number;
  y: number;
  hasSelection: boolean;
}

export interface SearchState {
  resultIndex: number;
  resultCount: number;
  isSearching: boolean;
  isCapped: boolean;
}

export interface PendingPaste {
  text: string;
  sessionId: string;
}

export interface UploadRecord {
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
}

export interface SerialSignals {
  cts: boolean;
  dsr: boolean;
  ri: boolean;
  cd: boolean;
}

export interface SerialStats {
  rxBytes: number;
  txBytes: number;
  rxRate: number;
  txRate: number;
}

export interface SerialFileProgress {
  name: string;
  sent: number;
  total: number;
}

export interface RecordingFileState {
  directory: string;
  baseName: string;
  path: string;
  bytes: number;
  part: number;
  maxBytes: number;
  sessionPath: string;
  startedAt: number;
  sessionId: string;
}

export interface ShellIntegrationState {
  phase: "prompt" | "input" | "output" | "finished";
  exitCode?: number;
  startedAt?: number;
  command?: string;
  durationMs?: number;
}

export interface CommandMarkerItem {
  marker: unknown;
  exitCode?: number;
  command?: string;
  durationMs?: number;
}

export interface XtermInstanceHolder {
  term: Terminal;
  fitAddon: FitAddon;
  asyncSearcher: AsyncTerminalSearcher;
  sessionId?: string;
  cleanup?: (isReconnecting?: boolean) => void;
  termCleanup?: () => void;
}
