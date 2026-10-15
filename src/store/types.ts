import type {
  Server,
  ServerGroup,
  SshKey,
  WorkspaceTab,
  WorkspaceModule,
  SplitDirection,
  SplitDropTarget,
  SplitLayoutNode,
  TabGroup,
  WorkspaceDef,
  SftpViewMode,
} from "@/types";
import type { TerminalTheme, TerminalThemeOverride } from "@/utils/terminal-themes";
import type { HighlightRule } from "@/utils/terminal-highlighter";
import type {
  ConnectionState,
  SshErrorKind,
} from "@/services/ssh-connection-state";
import type { UiStyleId } from "@/styles/themes/registry";

export type { UiStyleId } from "@/styles/themes/registry";

/** 单个服务器的状态机快照（持久化保存在内存中，不写入 localStorage） */
export interface ServerStateEntry {
  state: ConnectionState;
  error?: string;
  errorKind?: SshErrorKind;
  /**
   * 状态版本号：与后端 generation 一致，单调递增。
   * 收到事件时若 generation <= 当前值，则丢弃，避免事件乱序导致状态回退。
   */
  generation: number;
}

export interface WorkspaceSessionData {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  workspaces: Record<string, WorkspaceDef>;
  groups: Record<string, TabGroup>;
  layout: SplitLayoutNode | null;
  lastActiveGroupId: string | null;
}

export type AppLockType = "password" | "pattern";

export interface UiSlice {
  // Theme
  theme: "dark" | "light" | "system";
  toggleTheme: () => void;
  setTheme: (theme: "dark" | "light" | "system") => void;
  /** 界面设计语言：可在 registry 中自由扩展（apple、ubuntu、cyberpunk、anime 等） */
  uiStyle: UiStyleId;
  setUiStyle: (style: UiStyleId) => void;
  /** 是否启用主题专属个性化鼠标指针（喵~猫爪、赛博朋克准星等） */
  customCursorEnabled: boolean;
  setCustomCursorEnabled: (enabled: boolean) => void;

  // Language (i18n)
  language: string;
  setLanguage: (lang: string) => void;

  // 通用（全局）音效设置
  /**
   * 全局界面音效总开关：控制所有 playSound()（toast 提示、按钮反馈、面板开合、
   * 文件传输完成、BMC 操作等全部界面音效）。
   * 注意：与终端 BEL 铃声 terminalBellSound 解耦，二者互不影响。
   */
  uiSoundEnabled: boolean;
  setUiSoundEnabled: (enabled: boolean) => void;

  // Dashboard UI
  /**
   * 首页左侧栏宽度（px），由用户拖拽分隔线调整，持久化到 localStorage。
   * 写入时 clamp 到 [SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX]。
   */
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;

  // Application Lock (Termius 风格应用级离席安全锁)
  /** 是否启用全局应用锁 */
  appLockEnabled: boolean;
  /** 应用锁类型：密码/PIN ("password") 或九点图案锁 ("pattern") */
  appLockType: AppLockType;
  /** 应用锁密码加盐哈希（SHA-256） */
  appLockPasswordHash: string | null;
  /** 空闲自动锁定分钟数（0 为从不，如 1, 5, 10, 15, 30, 60） */
  appLockIdleMinutes: number;
  /** 应用冷启动时是否强制要求解锁 */
  appLockOnStartup: boolean;
  /** 当前运行时是否处于锁定状态 */
  isAppLocked: boolean;
  setAppLock: (
    enabled: boolean,
    passwordHash: string | null,
    lockType?: AppLockType,
  ) => void;
  setAppLockType: (lockType: AppLockType) => void;
  setAppLockIdleMinutes: (minutes: number) => void;
  setAppLockOnStartup: (enabled: boolean) => void;
  lockApp: () => void;
  unlockApp: () => void;
}

export interface ServerSlice {
  // Servers
  servers: Server[];
  trashCount: number;
  setTrashCount: (count: number) => void;
  addServer: (server: Server) => void;
  updateServer: (id: string, updates: Partial<Server>) => void;
  deleteServer: (id: string) => void;
  /** 批量删除服务器：单次状态更新，避免逐台触发重渲染与重复 pruneWorkspaces */
  deleteServers: (ids: string[]) => void;
  setServers: (servers: Server[]) => void;
  /** 从 SQLite 重新加载服务器列表 + 回收站计数（恢复/永久清除等变更后调用） */
  loadServers: () => Promise<void>;

  // 服务器分组（树形目录）。注意：与分屏 TabGroup 的 groups 无关
  serverGroups: ServerGroup[];
  setServerGroups: (groups: ServerGroup[]) => void;
  addServerGroup: (group: ServerGroup) => void;
  /** 重命名或移动分组（parentId 变更时后端负责环检测） */
  updateServerGroup: (id: string, updates: Partial<Pick<ServerGroup, "name" | "parentId">>) => void;
  /** 删除分组：同时从 servers 中移除对该子树分组的引用（服务器移出到根目录） */
  deleteServerGroup: (id: string) => void;

  // 标签目录（独立存储，不依赖服务器）
  tags: string[];
  setTags: (tags: string[]) => void;
  /** 从后端加载标签目录 */
  loadTags: () => Promise<void>;
  /** 新增一个标签到目录（本地，已确认后端成功） */
  addTag: (name: string) => void;
  /** 重命名标签：同步更新目录与所有服务器上的该标签 */
  renameTag: (oldName: string, newName: string) => void;
  /** 删除标签：同步从目录与所有服务器上移除 */
  deleteTag: (name: string) => void;

  // SSH Keys
  keys: SshKey[];
  addKey: (key: SshKey) => void;
  updateKey: (id: string, updates: Partial<SshKey>) => void;
  deleteKey: (id: string) => void;
  setKeys: (keys: SshKey[]) => void;

  // Server connection status
  connectedServers: Record<string, boolean>;
  setServerConnected: (serverId: string, connected: boolean) => void;
  syncConnectionState: (connectedIds: string[]) => void;

  // Server connection state machine（权威状态来源）
  serverStates: Record<string, ServerStateEntry>;
  /**
   * 更新服务器状态。
   * 携带 generation：若 <= 当前已知 generation，则丢弃（避免事件乱序）。
   * generation 为可选：未提供时（如前端本地推测的状态）不做过期检查，直接覆盖。
   */
  setServerState: (
    serverId: string,
    state: ConnectionState,
    error?: string,
    errorKind?: SshErrorKind,
    generation?: number,
  ) => void;
  clearServerState: (serverId: string) => void;
  /** 用后端状态同步覆盖前端缓存 */
  syncServerStates: (entries: Record<string, ServerStateEntry>) => void;

  /**
   * 手动断开标志（per-serverId）。
   * handleDisconnect 设置为 true，阻止终端自动重连撤销用户的断开操作。
   * handleConnect / onStateChanged(Ready) 时清除。
   */
  manualDisconnect: Record<string, boolean>;
  setManualDisconnect: (serverId: string, value: boolean) => void;

  // Auto refresh
  autoRefresh: boolean;
  refreshInterval: number; // seconds
  setAutoRefresh: (enabled: boolean) => void;
  setRefreshInterval: (seconds: number) => void;
}

export interface TerminalSlice {
  // Terminal Font Size
  terminalFontSize: number;
  setTerminalFontSize: (size: number | ((prev: number) => number)) => void;

  // Terminal Font Family
  terminalFontFamily: string;
  setTerminalFontFamily: (font: string) => void;

  // Terminal Theme
  terminalThemeId: string;
  setTerminalThemeId: (id: string) => void;
  customTerminalThemes: TerminalTheme[];
  addCustomTerminalTheme: (theme: TerminalTheme) => void;
  deleteCustomTerminalTheme: (id: string) => void;
  updateCustomTerminalTheme: (
    id: string,
    updates: Partial<TerminalTheme>,
  ) => void;
  /** 批量导入自定义主题（导入 JSON 用），返回导入成功的数量 */
  importCustomTerminalThemes: (themes: TerminalTheme[]) => TerminalTheme[];
  /**
   * 系统预设主题的背景图配置覆盖层（不修改只读 PRESET_TERMINAL_THEMES）。
   * key=主题 id，value=背景配置（type/image/videoPath/opacity/blur/size 全部支持）。
   * 运行时由 getTerminalTheme 合并到主题对象；getTerminalTheme 读取 store 最新值。
   * 自定义主题直接写 theme.background，不经过此覆盖层。
   * 持久化到 localStorage，重启后仍生效；clearTerminalThemeOverride 一键恢复默认（含图片/视频清除）。 */
  terminalThemeOverrides: Record<string, TerminalThemeOverride>;
  /** 更新某主题的配置覆盖（浅合并） */
  setTerminalThemeOverride: (
    themeId: string,
    override: TerminalThemeOverride,
  ) => void;
  /** 清除某主题的背景配置覆盖（恢复默认，含图片/视频） */
  clearTerminalThemeOverride: (themeId: string) => void;

  // Terminal Keyword Highlighting
  terminalHighlightEnabled: boolean;
  setTerminalHighlightEnabled: (enabled: boolean) => void;
  terminalHighlightRules: HighlightRule[];
  setTerminalHighlightRules: (rules: HighlightRule[]) => void;
  addHighlightRule: (rule: HighlightRule) => void;
  deleteHighlightRule: (id: string) => void;
  updateHighlightRule: (id: string, updates: Partial<HighlightRule>) => void;

  // Terminal Settings
  terminalAutoReconnect: boolean;
  setTerminalAutoReconnect: (enabled: boolean) => void;
  terminalAntiIdleEnabled: boolean;
  setTerminalAntiIdleEnabled: (enabled: boolean) => void;
  terminalAntiIdleInterval: number;
  setTerminalAntiIdleInterval: (interval: number) => void;
  terminalAntiIdleMode: "enter" | "space_backspace" | "null" | "custom";
  setTerminalAntiIdleMode: (
    mode: "enter" | "space_backspace" | "null" | "custom",
  ) => void;
  terminalAntiIdleCustomString: string;
  setTerminalAntiIdleCustomString: (str: string) => void;
  terminalCopyPaste: boolean;
  setTerminalCopyPaste: (enabled: boolean) => void;
  /** 终端划词快捷工具条开关（选中日志时弹出复制/粘贴/搜索浮动条） */
  terminalSelectionToolbar: boolean;
  setTerminalSelectionToolbar: (enabled: boolean) => void;
  terminalBellSound: boolean;
  setTerminalBellSound: (enabled: boolean) => void;
  terminalDrawBoldInBrightColors: boolean;
  setTerminalDrawBoldInBrightColors: (enabled: boolean) => void;
  /** 终端指令提示开关（命令/参数/路径/动态补全总开关） */
  terminalHintEnabled: boolean;
  setTerminalHintEnabled: (enabled: boolean) => void;
  /** 每个终端的 xterm scrollback 行数，影响可回看日志量和内存占用 */
  terminalScrollbackLines: number;
  setTerminalScrollbackLines: (lines: number) => void;
  /** 终端录制文件的默认保存目录；为空时首次录制会要求选择目录 */
  terminalRecordingDirectory: string;
  setTerminalRecordingDirectory: (path: string) => void;
  terminalEncoding: string;
  setTerminalEncoding: (encoding: string) => void;
  /** 单个终端录制分卷的最大文件大小（MB），范围 50-2048 */
  terminalRecordingMaxSizeMb: number;
  setTerminalRecordingMaxSizeMb: (size: number) => void;
}

export interface SftpSlice {
  // SFTP Settings
  /** SFTP 本地面板默认视图模式：'list' 列表 | 'large' 大图标 | 'medium' 中图标 | 'small' 小图标 */
  sftpLocalViewMode: SftpViewMode;
  setSftpLocalViewMode: (mode: SftpViewMode) => void;
  /** SFTP 远程面板默认视图模式：'list' 列表 | 'large' 大图标 | 'medium' 中图标 | 'small' 小图标 */
  sftpRemoteViewMode: SftpViewMode;
  setSftpRemoteViewMode: (mode: SftpViewMode) => void;
  /** SFTP 本地面板默认是否显示隐藏文件（默认 false） */
  sftpLocalShowHidden: boolean;
  setSftpLocalShowHidden: (show: boolean) => void;
  /** SFTP 远程面板默认是否显示隐藏文件（默认 true） */
  sftpRemoteShowHidden: boolean;
  setSftpRemoteShowHidden: (show: boolean) => void;
  /** SFTP 默认视图模式（向后兼容）：'list' 列表 | 'large' 大图标 | 'medium' 中图标 | 'small' 小图标 */
  sftpDefaultViewMode: SftpViewMode;
  setSftpDefaultViewMode: (mode: SftpViewMode) => void;
  /** SFTP 文件图标主题：'precision' 现代几何 | 'yaru' Ubuntu 官方经典暖橙 | 'developer' 开发者代码 | 'minimal' 极简纯线条 */
  sftpFileIconTheme: "precision" | "yaru" | "developer" | "minimal";
  setSftpFileIconTheme: (theme: "precision" | "yaru" | "developer" | "minimal") => void;
  /** SFTP 传输并发量（1-10），控制同时进行上传/下载的文件数 */
  sftpTransferConcurrency: number;
  setSftpTransferConcurrency: (n: number) => void;
  /** SFTP 传输限速（KB/s），0=不限速；后端用 AtomicU64 存储，应用启动时同步一次 */
  transferRateLimit: number;
  setTransferRateLimit: (kbps: number) => void;
  /** SFTP 传输排除与忽略规则开关 */
  sftpExclusionEnabled: boolean;
  setSftpExclusionEnabled: (enabled: boolean) => void;
  /** SFTP 传输排除与忽略规则列表（支持模式如 .git, *.log, node_modules） */
  sftpExclusionPatterns: string[];
  setSftpExclusionPatterns: (patterns: string[]) => void;
  /** SFTP 上传时是否自动遵循项目根及子目录下的 .gitignore 规则 */
  sftpRespectGitignore: boolean;
  setSftpRespectGitignore: (respect: boolean) => void;
}

export interface WorkspaceSlice {
  // Workspace tabs
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  /** Tab 颜色持久化映射：key=serverId，value=颜色（hex）。tab 本身不持久化（重启后
   *  重新打开工作台），但用户设置的颜色要记住 —— 以 serverId 为键存这里，打开同一
   *  服务器的新 tab 时自动套用。仅存 serverId→颜色，不存 tabId（tab 是临时的）。 */
  tabColors: Record<string, string>;
  /** SFTP 批量打开联动：待在 SFTP 传输面板中批量连接打开的服务器 ID 列表 */
  sftpPendingOpenServerIds: string[];
  openSftpWithServers: (serverIds: string[]) => void;
  clearSftpPendingOpenServers: () => void;
  openTab: (
    serverId: string,
    serverName: string,
    module: WorkspaceModule,
    initialCommand?: string,
  ) => void;
  /**
   * 批量打开多个服务器到同一个分屏工作台。
   * - 1 个：等价于 openTab
   * - 2 个：左右分屏（row）
   * - 3 个：T 字型（左侧 1 + 右侧上下 2）
   * - 4 个：田字型（左右各一组上下分屏）
   * - 5 个：左列 2 + 右列 3
   * - 6 个：左列 3 + 右列 3
   * - >6 个：退化为分别打开独立顶层标签页（不分屏）
   */
  openServersInSplit: (
    entries: {
      serverId: string;
      serverName: string;
      module: WorkspaceModule;
    }[],
  ) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;
  switchModule: (tabId: string, module: WorkspaceModule) => void;
  closeOtherTabs: (tabId: string) => void;
  closeOtherTabsInWorkspace: (tabId: string) => void;
  closeAllTabs: (force?: boolean) => void;
  /** 拖拽排序：将 fromId 移动到 toId 之前/之后 */
  reorderTabs: (
    fromId: string,
    toId: string,
    position: "before" | "after",
  ) => void;
  /** 复制会话：基于现有 tab 创建一个新 tab，打开相同模块 */
  duplicateTab: (tabId: string) => void;
  /** 临时重命名（仅当前会话） */
  renameTab: (tabId: string, tempTitle: string) => void;
  /** 切换锁定状态 */
  toggleTabLock: (tabId: string) => void;
  /** 设置 Tab 颜色：同时写入当前 tab 与持久化映射（tabColors[serverId]），
   *  下次打开同一服务器的 tab 时仍生效。color 为 undefined 表示清除。 */
  setTabColor: (tabId: string, color: string | undefined) => void;
  /** 终端广播：开关打开的 tab 之间互相转发键盘输入 */
  broadcastTabIds: string[];
  toggleBroadcastTab: (tabId: string) => void;
  /** 从 URL 参数恢复窗口状态（拖拽创建新窗口时使用） */
  restoreWindowState: (
    tabs: WorkspaceTab[],
    activeTabId: string | null,
  ) => void;
  /** 合并来自其他窗口的标签页 */
  mergeTab: (tab: WorkspaceTab) => void;

  // ── 分屏布局（T 字型二叉树分屏，不持久化） ─────────────────────────────
  /** 所有 tab 分组（分组内有自己的活跃 tab） */
  groups: Record<string, TabGroup>;
  /** 布局树根节点：split 节点递归二分，叶子为分组；无标签时为 null */
  layout: SplitLayoutNode | null;
  /** 最近交互的分组（决定新 tab / 合并 tab 进入哪个分组） */
  lastActiveGroupId: string | null;
  /** 多窗口分屏工作区集合（按 workspaceId 索引，每个 workspace 含独立的 layout 和 group 集合） */
  workspaces: Record<string, WorkspaceDef>;
  /** 拖拽分屏的实时落点（瞬态 UI 状态） */
  splitDropTarget: SplitDropTarget | null;
  /** 是否正在拖拽 tab / 窗格 */
  dragging: boolean;
  /** 被拖拽的 tab ID */
  dragTabId: string | null;
  setDragState: (dragging: boolean, dragTabId: string | null) => void;
  /** 全屏放大的分组 ID */
  maximizedGroupId: string | null;
  setMaximizedGroupId: (gid: string | null) => void;
  /** 把 tab 拆分到新分组，并在 targetGroupId 的 place 侧按 direction 分屏 */
  splitTab: (
    tabId: string,
    targetGroupId: string,
    direction: SplitDirection,
    place: "before" | "after",
  ) => void;
  /** 把 tab 移动到已有分组 */
  moveTabToGroup: (tabId: string, targetGroupId: string) => void;
  /** 将 tab 从 Workspace 分屏中脱离，放回顶部独立标签 */
  detachTabToTopLevel: (tabId: string) => void;
  /** 关闭整个 Workspace 分屏工作区 */
  closeWorkspace: (workspaceId: string) => void;
  /** 重命名 Workspace 分屏工作区 */
  renameWorkspace: (workspaceId: string, name: string) => void;
  /** 设置 Workspace 分屏工作区标签颜色 */
  setWorkspaceColor: (workspaceId: string, color: string | undefined) => void;
  /** 锁定 / 解锁 Workspace 分屏工作区 */
  toggleWorkspaceLock: (workspaceId: string) => void;
  /** 关闭其它工作区和未锁定的标签 */
  closeOtherWorkspaces: (workspaceId: string) => void;
  /** 点击分组区域时聚焦该分组（新 tab 将打开到此分组） */
  focusGroup: (groupId: string) => void;
  /** 调整某个 split 节点的分割比例 */
  resizeSplit: (splitId: string, ratio: number) => void;
  /** 设置拖拽分屏落点（相同值不会触发重复渲染） */
  setSplitDropTarget: (target: SplitDropTarget | null) => void;
}

export type AppState = UiSlice &
  ServerSlice &
  TerminalSlice &
  SftpSlice &
  WorkspaceSlice;
