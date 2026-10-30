import { useState, useEffect, useRef, useCallback } from "react";
import { useAppStore } from "@/store";
import { ModuleTabs, type SerialToolbarState } from "@/components/workspace/module-tabs";
import { OverviewModule } from "@/components/workspace/modules/overview";
import { TerminalModule } from "@/components/workspace/modules/terminal";
import { ServicesModule } from "@/components/workspace/modules/services";
import { ProcessesModule } from "@/components/workspace/modules/processes";
import { NetworkModule } from "@/components/workspace/modules/network";
import { PortsModule } from "@/components/workspace/modules/ports";
import { FilesModule } from "@/components/workspace/modules/files";
import { DockerModule } from "@/components/workspace/modules/docker";
import { RdpViewerModule } from "@/components/workspace/modules/rdp-viewer";
import { BmcModule } from "@/components/workspace/modules/bmc";
import { ConnectingAnimation } from "@/components/workspace/connecting-animation";
import { ConnectionDiagnosticsDialog } from "@/components/workspace/connection-diagnostics-dialog";
import { SshCredentialDialog } from "@/components/workspace/ssh-credential-dialog";
import { SshKeyCredentialDialog } from "@/components/workspace/ssh-key-credential-dialog";
import { friendlyError } from "@/lib/error-messages";

import { SnapshotModal } from "@/components/workspace/snapshot-modal";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  WifiOff,
  RefreshCw,
  Stethoscope,
  FolderOpen,
  LayoutDashboard,
  Container,
  Wrench,
  Cpu,
  Globe,
  Network,
} from "lucide-react";
import { WorkspaceModuleModal } from "@/components/workspace/workspace-module-modal";
import { cn } from "@/lib/utils";
import { sshService } from "@/services/ssh-service";
import { ConnectionState, SshErrorKind } from "@/services/ssh-connection-state";
import { reconnectManager, useReconnectState } from "@/services/reconnect-manager";
import { backend } from "@/services/api";
import { useTranslation } from "@/i18n";
import { playSound, SoundType } from "@/lib/sound";
import { isModuleAvailable } from "@/services/connection-targets";
import type { SshKey, WorkspaceModule, NavigationContext } from "@/types";

interface WorkspacePageProps {
  isActive: boolean;
  isVisible?: boolean;
  tabId: string;
  /** 分屏窗格模式：隐藏模块切换栏与连接按钮行，仅渲染终端模块，
   *  由外层 TabGroupView 的 Header 提供服务器标题与广播按钮 */
  isSplitPane?: boolean;
}

function isPasswordAuthenticationFailure(error?: string | null, kind?: SshErrorKind): boolean {
  if (kind === SshErrorKind.AuthError) return true;
  if (!error) return false;
  return /missing password|password auth(?:entication)? failed|password authentication rejected|ssh authentication failed|authentication rejected/i.test(error);
}

function isSshAuthenticationFailure(error?: string | null, kind?: SshErrorKind): boolean {
  if (kind === SshErrorKind.AuthError) return true;
  if (!error) return false;
  return /ssh authentication failed|authentication (?:failed|rejected)|public key auth|certificate auth|private key (?:file|path|content)|invalid private key|missing (?:private )?key|passphrase/i.test(error);
}

function isMissingKeyFailure(error?: string | null): boolean {
  if (!error) return false;
  return /missing (?:private )?key|private key path is empty|not found|cannot be resolved|未存储私钥|未存储证书|内容为空/i.test(error);
}

export function WorkspacePage({
  isActive,
  isVisible = true,
  tabId,
  isSplitPane,
}: WorkspacePageProps) {
  const { t } = useTranslation();
  // 按需选择器订阅，避免全 store 变化触发重渲染（如终端字号、提示开关等无关状态变化）
  const tabs = useAppStore((s) => s.tabs);
  const switchModule = useAppStore((s) => s.switchModule);
  const setServerConnected = useAppStore((s) => s.setServerConnected);
  const updateServer = useAppStore((s) => s.updateServer);
  const setServerState = useAppStore((s) => s.setServerState);
  const clearServerState = useAppStore((s) => s.clearServerState);
  const setManualDisconnect = useAppStore((s) => s.setManualDisconnect);
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [showConnectionDiagnostics, setShowConnectionDiagnostics] = useState(false);
  // 终端全屏：由 ModuleTabs 触发，TerminalModule 消费
  const [isTerminalFullscreen, setIsTerminalFullscreen] = useState(false);
  // 终端搜索触发器：ModuleTabs 触发，TerminalModule 注册实现（toggleSearch）
  const terminalSearchTriggerRef = useRef<(() => void) | null>(null);
  const registerTerminalSearchTrigger = useCallback(
    (fn: (() => void) | null) => {
      terminalSearchTriggerRef.current = fn;
    },
    [],
  );
  const terminalOutputActionsRef = useRef<{
    clear: () => void;
    copy: () => Promise<void>;
    toggleRecording: () => Promise<void>;
    recording: boolean;
  } | null>(null);
  const [serialToolbar, setSerialToolbar] = useState<SerialToolbarState | null>(null);
  const registerTerminalOutputActions = useCallback(
    (
      actions: {
        clear: () => void;
        copy: () => Promise<void>;
        toggleRecording: () => Promise<void>;
        recording: boolean;
      } | null,
    ) => {
      terminalOutputActionsRef.current = actions;
    },
    [],
  );
  const terminalGetCwdRef = useRef<(() => string | undefined) | null>(null);
  const registerTerminalGetCwd = useCallback((fn: (() => string | undefined) | null) => {
    terminalGetCwdRef.current = fn;
  }, []);
  const resolveTerminalCwd = useCallback(async (): Promise<string | null> => {
    return terminalGetCwdRef.current?.() ?? null;
  }, []);

  // 终端 cwd 变化推送 → 文件面板订阅：终端侧 OSC 7/标题/cd 拦截触发即时通知，
  // 文件面板订阅后立即跟随（轮询仅作兜底）
  const terminalCwdListenersRef = useRef(new Set<() => void>());
  const notifyTerminalCwdChanged = useCallback(() => {
    terminalCwdListenersRef.current.forEach((fn) => {
      try {
        fn();
      } catch {
        /* 订阅回调异常不影响终端 */
      }
    });
  }, []);
  const subscribeTerminalCwd = useCallback((fn: () => void) => {
    terminalCwdListenersRef.current.add(fn);
    return () => {
      terminalCwdListenersRef.current.delete(fn);
    };
  }, []);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [credentialPromptOpen, setCredentialPromptOpen] = useState(false);
  const [credentialPromptReason, setCredentialPromptReason] = useState<'missing' | 'rejected'>('missing');
  const [credentialPromptError, setCredentialPromptError] = useState<string | null>(null);
  const [credentialSubmitting, setCredentialSubmitting] = useState(false);
  const credentialSubmittingRef = useRef(false);
  const credentialJustSavedRef = useRef(false);
  const credentialPromptDismissedRef = useRef(false);
  const [keyCredentialPromptOpen, setKeyCredentialPromptOpen] = useState(false);
  const [keyCredentialPromptReason, setKeyCredentialPromptReason] = useState<'missing' | 'rejected'>('missing');
  const [keyCredentialPromptError, setKeyCredentialPromptError] = useState<string | null>(null);
  const [keyCredentialSubmitting, setKeyCredentialSubmitting] = useState(false);
  const keyCredentialSubmittingRef = useRef(false);
  const keyCredentialPromptDismissedRef = useRef(false);
  const [terminalReady, setTerminalReady] = useState(false);
  const hasTriedConnect = useRef(false);
  const currentTab = tabs.find((t) => t.id === tabId);
  const serverId = currentTab?.serverId ?? "";
  const server = useAppStore((s) => s.servers.find((sv) => sv.id === serverId));
  const isBmcServer = server?.targetType === "bmc";
  const isSerialServer = server?.targetType === "serial" || server?.protocol === "serial";
  const isRdpServer = server?.protocol === "rdp";
  const connId = tabId && serverId && !isSerialServer && !isRdpServer && !isBmcServer
    ? `ws:${serverId}:${tabId}`
    : serverId;
  const reconnectState = useReconnectState(connId);
  const isConnected = useAppStore((s) =>
    connId ? (s.connectedServers[connId] ?? false) : false,
  );
  // 当前后端状态机状态（Failed/Disconnected 时附带 error/errorKind）
  const serverStateEntry = useAppStore((s) =>
    connId ? s.serverStates[connId] : undefined,
  );
  const usesSshPasswordAuth = server?.protocol === 'ssh' && server?.authType === 'password';
  const usesSshKeyAuth = server?.protocol === 'ssh'
    && (server?.authType === 'privateKey' || server?.authType === 'certificate');
  const missingSshCredentials = Boolean(
    usesSshPasswordAuth && (!server?.username?.trim() || !server?.password?.trim()),
  );
  const missingSshKeyCredentials = Boolean(
    usesSshKeyAuth && (
      !server?.username?.trim()
      || (server.authType === 'certificate'
        ? !(server.sshKeyId || (server.privateKeyPath && server.certificatePath))
        : !(server.sshKeyId || server.privateKeyPath))
    ),
  );
  const connectionBlockedByCredentials = missingSshCredentials
    || credentialPromptOpen
    || missingSshKeyCredentials
    || keyCredentialPromptOpen
    || (serverStateEntry?.errorKind === SshErrorKind.AuthError && (usesSshPasswordAuth || usesSshKeyAuth));
  const terminalAuthenticationBlockReason: 'missing' | 'rejected' | undefined =
    credentialPromptOpen
      ? credentialPromptReason
      : keyCredentialPromptOpen
        ? keyCredentialPromptReason
        : serverStateEntry?.errorKind === SshErrorKind.AuthError
          ? 'rejected'
          : (missingSshCredentials || missingSshKeyCredentials)
            ? 'missing'
            : undefined;

  const openCredentialPrompt = useCallback((reason: 'missing' | 'rejected') => {
    credentialPromptDismissedRef.current = false;
    setCredentialPromptReason(reason);
    setCredentialPromptError(null);
    setCredentialPromptOpen(true);
    setConnectError(null);
  }, []);

  const openKeyCredentialPrompt = useCallback((reason: 'missing' | 'rejected') => {
    keyCredentialPromptDismissedRef.current = false;
    setKeyCredentialPromptReason(reason);
    setKeyCredentialPromptError(null);
    setKeyCredentialPromptOpen(true);
    setConnectError(null);
  }, []);

  const routeAuthenticationFailure = useCallback((error?: string | null, kind?: SshErrorKind) => {
    if (!isSshAuthenticationFailure(error, kind)) return false;
    if (usesSshPasswordAuth) {
      if (isActive || isSplitPane) {
        openCredentialPrompt(error?.toLowerCase().includes('missing password') ? 'missing' : 'rejected');
      } else {
        setConnectError(error || t('ws_conn_failed'));
      }
      return true;
    }
    if (usesSshKeyAuth) {
      if (isActive || isSplitPane) {
        openKeyCredentialPrompt(isMissingKeyFailure(error) ? 'missing' : 'rejected');
      } else {
        setConnectError(error || t('ws_conn_failed'));
      }
      return true;
    }
    return false;
  }, [isActive, isSplitPane, openCredentialPrompt, openKeyCredentialPrompt, t, usesSshKeyAuth, usesSshPasswordAuth]);

  // 用 ref 跟踪是否曾经连接过（不在渲染期间读取）
  const wasConnectedRef = useRef(false);
  // 用 state 驱动 UI 渲染
  const [wasConnected, setWasConnected] = useState(false);
  // 连接音效节流：记录上次播放的连接音效类型 + 时间戳，避免自动重连时反复播放
  const lastConnSoundRef = useRef<{ type: SoundType; time: number } | null>(
    null,
  );
  // 本地 generation 版本号：丢弃乱序到达的旧状态事件，防止触发多余音效
  const knownGenRef = useRef(0);

  // 当 serverId 或 tabId 改变时重置状态
  useEffect(() => {
    credentialSubmittingRef.current = false;
    credentialJustSavedRef.current = false;
    credentialPromptDismissedRef.current = false;
    keyCredentialSubmittingRef.current = false;
    keyCredentialPromptDismissedRef.current = false;
    hasTriedConnect.current = false;
    // 重置连接状态追踪，防止上一个服务器的 wasConnected 污染新服务器
    wasConnectedRef.current = false;
    // 重置音效节流和 generation，防止上一个服务器的状态污染新服务器
    lastConnSoundRef.current = null;
    // 从 store 读取当前服务器的 generation，而非硬编码 0，
    // 避免重置后迟到的事件（generation > 0）通过过滤触发多余音效
    knownGenRef.current =
      useAppStore.getState().serverStates[connId]?.generation ?? 0;

    // 清理弹窗与就绪状态
    setTerminalReady(false);
    setCredentialPromptOpen(false);
    setCredentialPromptError(null);
    setCredentialSubmitting(false);
    setKeyCredentialPromptOpen(false);
    setKeyCredentialPromptError(null);
    setKeyCredentialSubmitting(false);
    setWasConnected(false);
  }, [serverId, tabId, connId]);

  // 当连接断开时，重置终端 Ready 状态；当连接建立时设置 6 秒安全超时兜底，消除死锁
  useEffect(() => {
    if (!isConnected) {
      setTerminalReady(false);
      return;
    }
    // 安全兜底：如果底层连接已 Ready，但因任何原因 6 秒内未收到 onShellReady，自动解除阻塞
    const timer = setTimeout(() => {
      setTerminalReady(true);
    }, 6000);
    return () => clearTimeout(timer);
  }, [isConnected]);

  // 进入分屏模式时自动切换到终端模块：
  // - 分屏只显示终端，避免非终端模块在分屏期间被卸载丢失状态
  // - 退出分屏后保持终端模块，不自动恢复原模块（简化拖拽恢复行为）
  //   用户需要时可手动点击模块标签切换回 Files 等模块
  useEffect(() => {
    if (isSplitPane && currentTab && currentTab.module !== "terminal") {
      switchModule(currentTab.id, "terminal");
    }
  }, [isSplitPane, currentTab, switchModule]);

  // 监听 SSH 连接/断开事件（兼容旧版事件）+ 状态机事件（新）
  useEffect(() => {
    if (!sshService.isAvailable()) return;

    const unsubConnected = backend?.ssh.onConnected((data) => {
      if (data.serverId !== connId && data.serverId !== serverId) return;
      setServerConnected(connId, true);
      // C3.1 修复：移除 setServerState 调用，状态机统一由 onStateChanged 管理，
      // 避免旧版事件（无 generation）覆盖新版 onStateChanged 事件的正确状态
      updateServer(serverId, { lastAccessedAt: Date.now() });
      setConnectError(null);
      wasConnectedRef.current = true;
      setWasConnected(true);
    });
    const unsubDisconnected = backend?.ssh.onDisconnected((data) => {
      if (data.serverId !== connId && data.serverId !== serverId) return;
      setServerConnected(connId, false);
      // C3.1 修复：同上，移除 setServerState 调用
      // 音效统一由下方 onStateChanged 的 Disconnected 分支播放，避免重复
    });
    // 新：监听状态机变更（含错误分类 + generation 版本号）
    // 音效统一在此回调播放：无论从 workspace/terminal/sftp-panel 哪条路径连接，
    // 后端状态机变更都会触发此回调，保证连接音效全局一致
    const unsubStateChanged = sshService.onStateChanged((data) => {
      if (data.serverId !== connId) return;
      console.log(
        `[Workspace Event] ${connId} ssh:state-changed state=${data.state}, gen=${data.generation}`,
      );
      // generation 本地过滤：丢弃乱序到达的旧事件，防止旧状态事件触发多余音效
      if (
        data.generation !== undefined &&
        data.generation < knownGenRef.current
      )
        return;
      if (data.generation !== undefined) knownGenRef.current = data.generation;
      // generation 由 store 内部过滤：< 当前已知 generation 的事件直接丢弃
      setServerState(
        data.serverId,
        data.state,
        data.error,
        data.errorKind,
        data.generation,
      );
      if (data.state === ConnectionState.Ready) {
        setConnectError(null);
        wasConnectedRef.current = true;
        setWasConnected(true);
        // 连接成功：Ping 高频钟铃（类似 macOS 网络连通提示）
        playSound(SoundType.Ping);
        lastConnSoundRef.current = { type: SoundType.Ping, time: Date.now() };
      } else if (data.state === ConnectionState.Failed) {
        if (!routeAuthenticationFailure(data.error, data.errorKind)) {
          setConnectError(data.error ?? t("ws_conn_failed"));
          const isHostKey = data.errorKind === SshErrorKind.HostKeyMismatch || data.error?.toLowerCase().includes("host key");
          if (isHostKey && (isActive || isSplitPane)) {
            setShowConnectionDiagnostics(true);
          }
        }
        // 连接失败：Basso 低沉鼓声
        // 自动重连时避免反复播放：3 秒内已播放过相同音效则跳过
        // （自动重连间隔 2-30 秒，3 秒窗口既能防止抖动反复响，又不影响手动重连的即时反馈）
        const now = Date.now();
        const last = lastConnSoundRef.current;
        if (!last || last.type !== SoundType.Basso || now - last.time > 3000) {
          playSound(SoundType.Basso);
          lastConnSoundRef.current = { type: SoundType.Basso, time: now };
        }
      } else if (data.state === ConnectionState.Disconnected) {
        // 连接被远端/网络断开；保留 wasConnected 以触发自动重连
        setConnectError(data.error ?? null);
        // 被动断开：Submarine 深沉声纳
        // 同样用 3 秒节流，避免网络抖动时反复响
        const now = Date.now();
        const last = lastConnSoundRef.current;
        if (
          !last ||
          last.type !== SoundType.Submarine ||
          now - last.time > 3000
        ) {
          playSound(SoundType.Submarine);
          lastConnSoundRef.current = { type: SoundType.Submarine, time: now };
        }
      }
    });

    return () => {
      unsubConnected?.();
      unsubDisconnected?.();
      unsubStateChanged?.();
    };
  }, [setServerConnected, setServerState, updateServer, serverId, connId, routeAuthenticationFailure, t]);

  const [moduleContext, setModuleContext] = useState<({ module: WorkspaceModule } & NavigationContext) | null>(null);
  // 文件面板：终端下方可折叠面板的开关状态（文件模块不再走弹窗）
  const [filesPanelOpen, setFilesPanelOpen] = useState(false);
  // 滑出动画只在「点击打开」后的短暂窗口内挂载动画类：
  // 若动画类常驻，任何 display:none → 恢复显示的场景（如顶部切换服务器再切回，
  // 工作台为保活渲染）都会重播滑出动画——切换服务器时要求状态保持、纹丝不动
  const [filesPanelAnimActive, setFilesPanelAnimActive] = useState(false);

  // 文件面板高度（像素，可拖拽分隔条调节，跨会话持久化）
  const FILES_PANEL_MIN_HEIGHT = 160;
  const FILES_PANEL_DEFAULT_HEIGHT = 340;
  // 面板滑出动画时长，须与 index.css 中 .files-panel-slide-up 的 0.32s 保持一致
  const FILES_PANEL_ANIM_MS = 320;
  const filesPanelAnimTimerRef = useRef<number | null>(null);
  const [filesPanelHeight, setFilesPanelHeight] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("qshell.files-panel-height");
      const n = saved ? Number(saved) : NaN;
      return Number.isFinite(n) && n >= FILES_PANEL_MIN_HEIGHT ? n : FILES_PANEL_DEFAULT_HEIGHT;
    } catch {
      return FILES_PANEL_DEFAULT_HEIGHT;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("qshell.files-panel-height", String(filesPanelHeight));
    } catch {
      /* 存储不可用时静默忽略 */
    }
  }, [filesPanelHeight]);

  // 工作台内容区容器 ref：用于在拖拽调节时按实际可用高度做上限约束
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const filesResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const filesResizeRafRef = useRef<number | null>(null);
  // 把手同时支持「点击切换」与「拖动调高」：拖动超过阈值后抑制随之而来的 click
  const filesPanelDragMovedRef = useRef(false);
  const startFilesPanelResize = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const container = contentAreaRef.current;
      const maxHeight = Math.max(
        FILES_PANEL_MIN_HEIGHT,
        (container ? container.clientHeight : window.innerHeight) - 140,
      );
      const startY = e.clientY;
      const startHeight = filesPanelHeight;
      filesPanelDragMovedRef.current = false;
      filesResizeRef.current = { startY, startHeight };

      // 拖拽开始：广播 split-resize-start 冻结终端画布像素尺寸并抑制逐帧 fit，
      // 避免拖拽调整高度时 rows/cols 逐帧变动引发 PTY SIGWINCH 信号风暴与日志反复回流跳动
      window.dispatchEvent(new Event("split-resize-start"));

      const onMouseMove = (ev: MouseEvent) => {
        if (!filesResizeRef.current) return;
        // 超过 3px 视为拖动，抬起鼠标后的 click 不再触发收起/展开
        if (Math.abs(ev.clientY - filesResizeRef.current.startY) > 3) {
          filesPanelDragMovedRef.current = true;
        }
        if (filesResizeRafRef.current !== null) return;
        const currentClientY = ev.clientY;
        filesResizeRafRef.current = requestAnimationFrame(() => {
          filesResizeRafRef.current = null;
          if (!filesResizeRef.current) return;
          // 向上拖 = 面板增高；向下拖 = 面板降低
          const delta = filesResizeRef.current.startY - currentClientY;
          const next = Math.max(
            FILES_PANEL_MIN_HEIGHT,
            Math.min(maxHeight, filesResizeRef.current.startHeight + delta),
          );
          setFilesPanelHeight(next);
        });
      };
      const onMouseUp = () => {
        filesResizeRef.current = null;
        if (filesResizeRafRef.current !== null) {
          cancelAnimationFrame(filesResizeRafRef.current);
          filesResizeRafRef.current = null;
        }
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";

        // 拖拽结束：广播 split-resize-end 解除终端画布尺寸冻结，单次平稳对齐最终高度
        window.dispatchEvent(new Event("split-resize-end"));
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
    },
    [filesPanelHeight],
  );

  const handleModuleChange = (module: WorkspaceModule, context?: NavigationContext) => {
    let targetModule = module;
    let targetContext = context;
    if (module === "forward") {
      targetModule = "ports";
      targetContext = { ...context, subTab: "forward" };
    }
    // 文件模块：改为终端下方可折叠面板，点击切换开/关（不切换模块、不弹窗）
    if (targetModule === "files") {
      // telnet / 不支持文件管理的目标类型：不响应，避免按钮高亮但面板不出现
      const filesAvailable =
        isModuleAvailable(server?.targetType, "files") && server?.protocol !== "telnet";
      if (!filesAvailable) return;
      // 面板高度动画期间冻结终端画布（复用分屏拖拽的 split-resize-start/end 机制）：
      // 否则 ResizeObserver 逐帧 fit 导致 rows 反复变化，日志文字上下跳动。
      // 冻结期间画布纹丝不动（底部被面板逐渐覆盖），动画结束后一次性对齐最终尺寸
      window.dispatchEvent(new CustomEvent("split-resize-start"));
      if (filesPanelAnimTimerRef.current) {
        window.clearTimeout(filesPanelAnimTimerRef.current);
      }
      filesPanelAnimTimerRef.current = window.setTimeout(() => {
        filesPanelAnimTimerRef.current = null;
        window.dispatchEvent(new CustomEvent("split-resize-end"));
      }, FILES_PANEL_ANIM_MS + 60);
      // 仅在「由关到开」时挂载滑出动画类（见 filesPanelAnimActive 注释）
      if (!filesPanelOpen) {
        setFilesPanelAnimActive(true);
        window.setTimeout(() => setFilesPanelAnimActive(false), FILES_PANEL_ANIM_MS + 120);
      }
      setFilesPanelOpen((v) => !v);
      // 断连状态下打开文件面板时自动触发重连（与切换模块的行为保持一致）
      if (!isConnected && !connecting && wasConnected && sshService.isAvailable()) {
        reconnectManager.retryImmediately(connId);
        handleConnect();
      }
      return;
    }
    // 如果点击当前已打开的附属功能弹框模块，再次点击则收起/关闭弹框（切回终端）
    if (currentTab && currentTab.module === targetModule && targetModule !== "terminal") {
      switchModule(currentTab.id, "terminal");
      setModuleContext(null);
      window.dispatchEvent(new CustomEvent("focus-active-terminal"));
      return;
    }
    if (currentTab) {
      switchModule(currentTab.id, targetModule);
    }
    if (targetModule === "terminal") {
      window.dispatchEvent(new CustomEvent("focus-active-terminal"));
    }
    if (targetContext) {
      setModuleContext({ module: targetModule, ...targetContext });
    } else {
      setModuleContext(null);
    }
    // 断连状态下切换模块时自动触发重连
    if (
      !isConnected &&
      !connecting &&
      wasConnected &&
      sshService.isAvailable()
    ) {
      reconnectManager.retryImmediately(connId);
      handleConnect();
    }
  };

  // 稳定化的 onShellReady 回调：避免内联箭头函数每次渲染产生新引用，
  // 导致 TerminalModule 的 isConnected effect 频繁重跑触发无退避重连
  const onShellReady = useCallback(() => {
    setTerminalReady(true);
  }, []);

  // 批量关闭其他工作台、分屏坍缩或 Portal 重新挂载时，TerminalModule 本身会保持挂载，
  // 但外层 terminalReady 可能因早期初始化/隐藏状态停留在 false。当前标签重新激活后，
  // 若服务层仍登记着存活的 Shell，则直接恢复 Ready，避免遮罩永久停在 Initializing Session。
  const recoveryKey = `${isActive}:${isConnected}:${tabId}`;
  const [lastRecoveryKey, setLastRecoveryKey] = useState("");
  if (lastRecoveryKey !== recoveryKey) {
    setLastRecoveryKey(recoveryKey);
    if (isActive && isConnected && tabId) {
      const sessionId = sshService.getTabActiveSessionId(tabId);
      if (sessionId && sshService.isSessionAlive(sessionId)) {
        setTerminalReady(true);
      }
    }
  }

  const handleConnect = useCallback(async () => {
    // 这些目标由各自模块建立连接，不能落入通用 SSH 连接链路。
    if (isBmcServer || isSerialServer || isRdpServer) return;
    const skipCredentialPrecheck = credentialJustSavedRef.current;
    credentialJustSavedRef.current = false;
    if (!skipCredentialPrecheck && !wasConnectedRef.current && serverStateEntry?.errorKind === SshErrorKind.AuthError) {
      if (usesSshPasswordAuth) {
        if (isActive || isSplitPane) openCredentialPrompt('rejected');
        return;
      }
      if (usesSshKeyAuth) {
        if (isActive || isSplitPane) openKeyCredentialPrompt('rejected');
        return;
      }
    }
    if (!skipCredentialPrecheck && !wasConnectedRef.current && missingSshCredentials) {
      if (isActive || isSplitPane) {
        credentialPromptDismissedRef.current = false;
        openCredentialPrompt('missing');
      }
      return;
    }
    if (!skipCredentialPrecheck && !wasConnectedRef.current && missingSshKeyCredentials) {
      if (isActive || isSplitPane) {
        keyCredentialPromptDismissedRef.current = false;
        openKeyCredentialPrompt('missing');
      }
      return;
    }
    const t0 = performance.now();
    console.log(
      `[Workspace Connect] ${connId} handleConnect 开始, connecting=true`,
    );
    setConnecting(true);
    setConnectError(null);
    setTerminalReady(false);
    // 手动重连时取消自动重试定时器并复位
    reconnectManager.cancelRetry(connId);
    // 清除手动断开标志，允许后续被动断开时自动重连
    setManualDisconnect(connId, false);
    // 状态机由 onStateChanged 回调统一驱动（含 generation 过滤），
    // handleConnect 只需设置 Connecting 本地推测状态，实际状态以 onStateChanged 为准
    setServerState(connId, ConnectionState.Connecting);
    try {
      const result = await sshService.connect(connId);
      const elapsed = performance.now() - t0;
      console.log(
        `[Workspace Connect] ${connId} IPC 返回: success=${result.success}, 耗时=${elapsed.toFixed(0)}ms`,
      );
      if (result.success === false) {
        const authenticationFailure = routeAuthenticationFailure(result.error);
        if (!authenticationFailure) {
          setConnectError(result.error || t("ws_conn_failed"));
          const isHostKey = result.error?.toLowerCase().includes("host key") || result.error?.toLowerCase().includes("mitm");
          if (isHostKey && (isActive || isSplitPane)) {
            setShowConnectionDiagnostics(true);
          }
        }
        // 不调用 setServerState(Failed)：onStateChanged 的 Failed 事件会正确设置
        // 仅在 onStateChanged 未触发时（如前端超时）作为兜底
        const currentState = useAppStore.getState().serverStates[connId];
        if (
          !currentState ||
          currentState.state === ConnectionState.Connecting
        ) {
          setServerState(
            connId,
            ConnectionState.Failed,
            result.error,
            authenticationFailure ? SshErrorKind.AuthError : undefined,
          );
        }
      } else {
        // onStateChanged(Ready) 已设置 connectedServers=true 和 wasConnected
        // 此处仅作为兜底：若 onStateChanged 未触发（如事件丢失），设置 Ready
        wasConnectedRef.current = true;
        setWasConnected(true);
        const currentState = useAppStore.getState().serverStates[connId];
        if (
          !currentState ||
          currentState.state === ConnectionState.Connecting
        ) {
          setServerState(connId, ConnectionState.Ready);
        }
        console.log(`[Workspace Connect] ${connId} 连接成功`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t("ws_conn_failed");
      console.error(`[Workspace Connect] ${connId} 异常:`, msg);
      const authenticationFailure = routeAuthenticationFailure(msg);
      if (!authenticationFailure) {
        setConnectError(msg);
      }
      const currentState = useAppStore.getState().serverStates[connId];
      if (!currentState || currentState.state === ConnectionState.Connecting) {
        setServerState(
          connId,
          ConnectionState.Failed,
          msg,
          authenticationFailure ? SshErrorKind.AuthError : undefined,
        );
      }
    } finally {
      setConnecting(false);
      console.log(
        `[Workspace Connect] ${connId} handleConnect 完成, 总耗时=${(performance.now() - t0).toFixed(0)}ms`,
      );
    }
  }, [serverId, connId, setServerState, setManualDisconnect, t, isBmcServer, isSerialServer, isRdpServer, missingSshCredentials, missingSshKeyCredentials, openCredentialPrompt, openKeyCredentialPrompt, routeAuthenticationFailure, isActive, isSplitPane, serverStateEntry?.errorKind, usesSshKeyAuth, usesSshPasswordAuth]);

  useEffect(() => {
    if (
      !(isActive || isSplitPane)
      || !usesSshPasswordAuth
      || credentialPromptOpen
      || credentialPromptDismissedRef.current
    ) return;
    const reason = missingSshCredentials
      ? 'missing'
      : serverStateEntry?.errorKind === SshErrorKind.AuthError
        ? 'rejected'
        : null;
    if (!reason) return;
    const timer = setTimeout(() => openCredentialPrompt(reason), 0);
    return () => clearTimeout(timer);
  }, [isActive, isSplitPane, usesSshPasswordAuth, missingSshCredentials, serverStateEntry?.errorKind, credentialPromptOpen, openCredentialPrompt]);

  useEffect(() => {
    if (
      !(isActive || isSplitPane)
      || !usesSshKeyAuth
      || keyCredentialPromptOpen
      || keyCredentialPromptDismissedRef.current
    ) return;
    const reason = missingSshKeyCredentials
      ? 'missing'
      : serverStateEntry?.errorKind === SshErrorKind.AuthError
        ? 'rejected'
        : null;
    if (!reason) return;
    const timer = setTimeout(() => openKeyCredentialPrompt(reason), 0);
    return () => clearTimeout(timer);
  }, [isActive, isSplitPane, usesSshKeyAuth, missingSshKeyCredentials, serverStateEntry?.errorKind, keyCredentialPromptOpen, openKeyCredentialPrompt]);

  const handleCredentialSubmit = useCallback(async (username: string, password: string) => {
    if (!server || credentialSubmittingRef.current) return;
    credentialSubmittingRef.current = true;
    setCredentialSubmitting(true);
    setCredentialPromptError(null);
    try {
      const tested = await sshService.testConnectWithConfig({
        host: server.host,
        port: server.port || 22,
        username,
        authType: 'password',
        password,
        connectionTimeout: server.connectionTimeout || 30,
        targetType: server.targetType || 'linux',
        protocol: 'ssh',
        proxyConfig: server.proxyConfig || undefined,
      });
      if (tested.success === false) {
        setCredentialPromptReason('rejected');
        setCredentialPromptError(
          isPasswordAuthenticationFailure(tested.error)
            ? t('ssh_credential_invalid')
            : tested.error || tested.message || t('ws_conn_failed'),
        );
        return;
      }

      const saved = await sshService.updateServer(server.id, {
        username,
        password,
        authType: 'password',
      });
      if (saved.success === false) {
        setCredentialPromptError(saved.error || t('ssh_credential_save_failed'));
        return;
      }

      updateServer(server.id, { username, password: '•••••', authType: 'password' });
      terminalOutputActionsRef.current?.clear();
      setCredentialPromptOpen(false);
      setCredentialPromptError(null);
      setConnectError(null);
      credentialJustSavedRef.current = true;
      await handleConnect();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('ws_conn_failed');
      setCredentialPromptError(isPasswordAuthenticationFailure(message) ? t('ssh_credential_invalid') : message);
    } finally {
      credentialSubmittingRef.current = false;
      setCredentialSubmitting(false);
    }
  }, [server, t, updateServer, handleConnect]);

  const handleKeyCredentialSubmit = useCallback(async (username: string, key: SshKey) => {
    if (!server || !usesSshKeyAuth || keyCredentialSubmittingRef.current) return;
    const authType = server.authType as 'privateKey' | 'certificate';
    keyCredentialSubmittingRef.current = true;
    setKeyCredentialSubmitting(true);
    setKeyCredentialPromptError(null);
    try {
      const tested = await sshService.testConnectWithConfig({
        host: server.host,
        port: server.port || 22,
        username,
        authType,
        privateKeyPath: key.privateKeyPath,
        certificatePath: authType === 'certificate' ? key.certificatePath : undefined,
        sshKeyId: key.id,
        connectionTimeout: server.connectionTimeout || 30,
        targetType: server.targetType || 'linux',
        protocol: 'ssh',
        proxyConfig: server.proxyConfig || undefined,
      });
      if (tested.success === false) {
        setKeyCredentialPromptReason('rejected');
        setKeyCredentialPromptError(
          isSshAuthenticationFailure(tested.error)
            ? t('ssh_key_credential_invalid')
            : tested.error || tested.message || t('ws_conn_failed'),
        );
        return;
      }

      const updates = {
        username,
        authType,
        sshKeyId: key.id,
        privateKeyPath: key.privateKeyPath || '',
        privateKeyPassphrase: '',
        certificatePath: authType === 'certificate' ? key.certificatePath || '' : '',
      } as const;
      const saved = await sshService.updateServer(server.id, updates);
      if (saved.success === false) {
        setKeyCredentialPromptError(saved.error || t('ssh_key_credential_save_failed'));
        return;
      }

      updateServer(server.id, updates);
      terminalOutputActionsRef.current?.clear();
      setKeyCredentialPromptOpen(false);
      setKeyCredentialPromptError(null);
      setConnectError(null);
      credentialJustSavedRef.current = true;
      await handleConnect();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('ws_conn_failed');
      setKeyCredentialPromptError(
        isSshAuthenticationFailure(message) ? t('ssh_key_credential_invalid') : message,
      );
    } finally {
      keyCredentialSubmittingRef.current = false;
      setKeyCredentialSubmitting(false);
    }
  }, [handleConnect, server, t, updateServer, usesSshKeyAuth]);

  // 已连接的服务器，进入工作台时自动刷新（OverviewModule 组件挂载时会自动刷新）
  // 如果未连接，首次挂载或打开时自动尝试连接（支持多服务器一键批量连接）
  useEffect(() => {
    if (
      !isConnected &&
      !connecting &&
      !hasTriedConnect.current &&
      sshService.isAvailable()
    ) {
      hasTriedConnect.current = true;
      // BMC 带外管理 / 串口连接：不依赖 SSH 连接，首次进入不自动发起 SSH 连接
      // （由各模块内部自行初始化硬件/API 连接）
      if (isBmcServer) return;
      if (isSerialServer) return;
      // RDP 由独立系统客户端启动，不应自动调用 ssh_connect。
      if (isRdpServer) return;
      handleConnect();
    }
  }, [
    isConnected,
    connecting,
    handleConnect,
    isBmcServer,
    isSerialServer,
    isRdpServer,
    currentTab?.module,
  ]);

  const handleDisconnect = async () => {
    reconnectManager.reset(connId);
    wasConnectedRef.current = false; // 手动断开不自动重连
    setWasConnected(false);
    setTerminalReady(false);
    // 设置手动断开标志，阻止终端 onShellClosed 触发自动重连撤销用户操作
    setManualDisconnect(connId, true);
    setServerState(connId, ConnectionState.Disconnecting);
    try {
      await sshService.disconnect(connId);
      setServerConnected(connId, false);
      setServerState(connId, ConnectionState.Disconnected);
      clearServerState(connId);
      // 音效由 onStateChanged 的 Disconnected 分支统一播放
    } catch (e: unknown) {
      console.error("Disconnect error:", e);
      setServerState(connId, ConnectionState.Disconnected);
      // 断开异常时不播音效，避免与 onStateChanged 重复
    }
  };

  // 早期返回放在所有 Hooks 之后
  if (!currentTab) return null;

  // 分屏窗格模式：强制只显示终端模块，不渲染模块切换栏与连接按钮行
  const effectiveModule = isSplitPane ? "terminal" : currentTab.module;
  const isTerminalModule = effectiveModule === "terminal";
  // RDP 模块独立于 SSH 连接，不需要等待 SSH ready
  const isRdpModule = effectiveModule === "rdp";
  // BMC 模块通过 Redfish API (HTTPS) 工作，独立于 SSH 连接
  const isBmcModule = effectiveModule === "bmc";
  const isFullyReady =
    isRdpModule ||
    isBmcModule ||
    isSerialServer ||
    (isConnected && (!isTerminalModule || terminalReady));

  // 是否开启附属功能弹窗（除终端、RDP、BMC、文件外的所有模块，点击后作为工作台附属弹窗弹出）
  const isModalModule =
    !isSplitPane &&
    !isTerminalModule &&
    !isRdpModule &&
    !isBmcModule &&
    effectiveModule !== "files";

  // 文件面板可用性：目标类型支持文件管理（telnet 不支持），分屏模式下隐藏。
  // 保活常驻：断开连接时不卸载面板，保留用户已展开的视图与布局，消除断连时的界面割裂与跳动
  const filesPanelAvailable =
    !isSplitPane &&
    isModuleAvailable(server?.targetType, "files") &&
    server?.protocol !== "telnet";
  // 文件面板是否可见：可用且用户已展开
  const showFilesPanel = filesPanelOpen && filesPanelAvailable;
  // 文件面板是否处于激活态（供 FilesModule 处理拖拽/直达等全局事件）
  const filesPanelActive = isActive && showFilesPanel && !isModalModule;

  const getModalConfig = (mod: WorkspaceModule) => {
    switch (mod) {
      case "files":
        return { title: t("module_files"), icon: <FolderOpen className="h-4 w-4" /> };
      case "overview":
        return { title: t("module_overview"), icon: <LayoutDashboard className="h-4 w-4" /> };
      case "docker":
        return { title: t("module_docker"), icon: <Container className="h-4 w-4" /> };
      case "services":
        return { title: t("module_services"), icon: <Wrench className="h-4 w-4" /> };
      case "processes":
        return { title: t("module_processes"), icon: <Cpu className="h-4 w-4" /> };
      case "network":
        return { title: t("module_network"), icon: <Globe className="h-4 w-4" /> };
      case "ports":
        return { title: t("module_ports"), icon: <Network className="h-4 w-4" /> };
      case "forward":
        return { title: t("module_forward"), icon: <Network className="h-4 w-4" /> };
      default:
        return { title: t(`module_${mod}`), icon: null };
    }
  };

  const modalConfig = getModalConfig(currentTab.module);

  const moduleTabs = !isSplitPane ? (
    <ModuleTabs
      activeModule={currentTab.module}
      onModuleChange={handleModuleChange}
      serverId={serverId}
      tabId={tabId}
      isConnected={isFullyReady}
      connecting={connecting || (isConnected && !terminalReady)}
      connectError={connectError}
      onConnect={handleConnect}
      onDisconnect={handleDisconnect}
      onShowSnapshot={() => setShowSnapshot(true)}
      isTerminalFullscreen={isTerminalFullscreen}
      onToggleTerminalFullscreen={() => setIsTerminalFullscreen((v) => !v)}
      onShowSearch={() => terminalSearchTriggerRef.current?.()}
      onShowDiagnostics={() => setShowConnectionDiagnostics(true)}
      toolbarPosition="top"
      serialToolbar={isSerialServer && currentTab.module === "terminal" ? null : serialToolbar}
      filesPanelOpen={filesPanelOpen}
    />
  ) : null;

  const renderConnectionOverlay = () => (
    <div
      className={`absolute inset-0 z-40 flex flex-col items-center justify-center ${wasConnected ? "bg-background/80 backdrop-blur-sm" : "bg-background"}`}
    >
      {connecting || reconnectState.status === 'reconnecting' || (isConnected && !terminalReady) ? (
        <ConnectingAnimation
          serverName={currentTab.serverName}
          state={serverStateEntry?.state}
        />
      ) : wasConnected ? (
        <>
          {reconnectState.status === 'countdown' ? (
            <>
              <WifiOff className="h-10 w-10 mb-3 text-amber-500 opacity-60 animate-pulse" />
              <p className="text-sm font-medium mb-1">
                {t("reconnect_retrying")
                  .replace("{attempt}", String(reconnectState.attempt))
                  .replace("{max}", String(reconnectState.maxAttempts))}
              </p>
              <p className="text-xs text-muted-foreground mb-3 font-mono">
                {t("reconnect_countdown").replace(
                  "{sec}",
                  String(reconnectState.remainingSec),
                )}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => reconnectManager.retryImmediately(connId)}
                  size="sm"
                  className="gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("reconnect_now")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => reconnectManager.cancelRetry(connId)}
                >
                  {t("reconnect_cancel")}
                </Button>
              </div>
            </>
          ) : reconnectState.status === 'exhausted' ? (
            <>
              <WifiOff className="h-10 w-10 mb-3 opacity-40 text-destructive" />
              <p className="text-sm font-medium mb-1 text-destructive">
                {t("reconnect_exhausted")}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  onClick={() => {
                    reconnectManager.retryImmediately(connId);
                  }}
                  size="sm"
                  className="gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("ws_reconnect")}
                </Button>
                {server && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => setShowConnectionDiagnostics(true)}
                  >
                    <Stethoscope className="h-3.5 w-3.5" />
                    {t("diag_open")}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <WifiOff className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm font-medium mb-1">
                {t("ws_disconnected")}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <Button onClick={handleConnect} size="sm" className="gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" />
                  {t("ws_reconnect")}
                </Button>
                {server && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowConnectionDiagnostics(true)}>
                    <Stethoscope className="h-3.5 w-3.5" />
                    {t("diag_open")}
                  </Button>
                )}
              </div>
            </>
          )}
          {connectError && (
            <p className="text-[11px] text-destructive mt-2">
              {friendlyError(connectError).message}
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <WifiOff className="h-16 w-16 mb-4 opacity-30" />
          <p className="text-lg font-medium mb-2">
            {t("ws_not_connected")}
          </p>
          <p className="text-sm mb-4">{t("ws_not_connected_desc")}</p>
          {connectError && (
            <p className="text-xs text-destructive mb-3 max-w-md text-center">
              {friendlyError(connectError).message}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button onClick={handleConnect} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              {t("ws_btn_connect")}
            </Button>
            {server && connectError && (
              <Button variant="outline" className="gap-2" onClick={() => setShowConnectionDiagnostics(true)}>
                <Stethoscope className="h-4 w-4" />
                {t("diag_open")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-background">
      {moduleTabs}
      {/* Module content */}
      <div ref={contentAreaRef} className="flex-1 overflow-hidden relative bg-canvas/30 flex flex-col">
        {/* RDP / BMC 专属连接遮罩 */}
        {!isFullyReady && (isRdpModule || isBmcModule) && renderConnectionOverlay()}

        {/* 模块内容：
            - 终端模块：始终挂载（即使连接失败），避免 initTerminalAndShell 执行中途组件被卸载
              导致终端创建中断、无任何输出。initTerminalAndShell 内部会调用 sshService.connect
              建立连接，与 handleConnect 通过 connectingPromises 去重，不会引发后端并发连接。
            - RDP 模块：独立于 SSH 连接，始终可渲染
            - 其他模块：仅在已连接(Ready)时渲染，避免在 Connecting 阶段发起请求报错，
              且断开→重连后自然 remount 触发数据重新加载 */}
        {/* 终端主模块：作为工作台底座常驻（文件面板打开时收缩为上方区域），永不卸载断连，日志实时可见 */}
        <div
          className={cn(
            "flex-1 min-h-0 w-full relative",
            (isRdpModule || isBmcModule) && "hidden",
          )}
          onMouseDown={() => {
            window.dispatchEvent(new CustomEvent("focus-active-terminal"));
          }}
        >
          <TerminalModule
            serverId={connId}
            isActive={isActive && effectiveModule === "terminal" && !isModalModule}
            isVisible={isVisible && !isRdpModule && !isBmcModule}
            isConnected={isConnected}
            connectionBlocked={connectionBlockedByCredentials}
            connectionBlockedReason={terminalAuthenticationBlockReason}
            initialCommand={currentTab.initialCommand}
            tabId={tabId}
            onShellReady={onShellReady}
            isSplitPane={isSplitPane}
            isFullscreen={isTerminalFullscreen}
            onToggleFullscreen={() => setIsTerminalFullscreen((v) => !v)}
            registerSearchTrigger={registerTerminalSearchTrigger}
            registerOutputActions={registerTerminalOutputActions}
            registerSerialToolbar={setSerialToolbar}
            registerGetCwd={registerTerminalGetCwd}
            onCwdChange={notifyTerminalCwdChanged}
            onReconnect={handleConnect}
          />
        </div>

        {/* 文件模块：终端下方可折叠面板（边用终端边上传/管理文件）。
            保活渲染：面板收起时仅 CSS 隐藏不卸载，SFTP 连接/目录树/滚动位置得以保留
            （与旧弹窗 keepMounted 语义一致）；收起时 filesPanelActive=false，轮询与订阅自动停止 */}
        {filesPanelAvailable && (
          <>
            {/* 抽屉把手：始终渲染——收起后仍要能再次拉出（不能随面板一起消失）。
                交互只发生在中间胶囊上：左右空白区域不响应点击/拖动，避免误触。
                点击 = 收起/展开；上下拖动 = 调节面板高度；双击 = 恢复默认高度。
                收起/展开只切换 CSS（面板 hidden），FilesModule 不卸载，SFTP 连接与目录树全程保留 */}
            <div
              className={cn(
                "relative z-10 flex h-[10px] shrink-0 items-center justify-center bg-transparent",
                showFilesPanel && "border-t border-border/50",
                filesPanelAnimActive && showFilesPanel && "files-panel-divider-in",
              )}
            >
              <span
                className="flex h-[10px] w-24 cursor-ns-resize select-none items-center justify-center rounded-full border border-foreground/25 bg-foreground/[0.08] shadow-sm transition-colors hover:border-primary/60 hover:bg-foreground/[0.14]"
                onMouseDown={startFilesPanelResize}
                onDoubleClick={() => setFilesPanelHeight(FILES_PANEL_DEFAULT_HEIGHT)}
                onClick={() => {
                  // 拖动后紧随的 click 不应触发收起/展开
                  if (filesPanelDragMovedRef.current) {
                    filesPanelDragMovedRef.current = false;
                    return;
                  }
                  handleModuleChange("files");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleModuleChange("files");
                  }
                }}
                role="button"
                tabIndex={0}
                aria-expanded={showFilesPanel}
                aria-label={showFilesPanel ? "收起文件面板" : "展开文件面板"}
                title={
                  showFilesPanel
                    ? "点击收起文件面板；上下拖动调节高度；双击恢复默认高度"
                    : "点击展开文件面板"
                }
              >
                {/* 图标缩到 8px 后默认 stroke 会等比降到 0.67px，需显式加粗才看得清 */}
                {showFilesPanel ? (
                  <ChevronDown className="h-2 w-2 text-primary" strokeWidth={4} />
                ) : (
                  <ChevronUp className="h-2 w-2 text-primary" strokeWidth={4} />
                )}
              </span>
            </div>

            {/* 文件面板：无标题栏，直接铺满内容区以最大化可用空间（开关由顶部「文件」按钮控制）；
                打开时从底部滑出（height 0 → 目标值，终端被逐渐推上去）。
                动画类仅由 filesPanelAnimActive 窗口控制：切换服务器标签（display 切换）不重播 */}
            <div
              className={cn(
                "shrink-0 flex flex-col bg-background overflow-hidden",
                filesPanelAnimActive && showFilesPanel && "files-panel-slide-up",
                !showFilesPanel && "hidden",
              )}
              style={
                {
                  height: filesPanelHeight,
                  '--fd-panel-h': `${filesPanelHeight}px`,
                } as React.CSSProperties
              }
            >
              <div className="min-h-0 flex-1">
                <FilesModule
                  serverId={connId}
                  isConnected={isConnected}
                  isActive={filesPanelActive}
                  getTerminalCwd={resolveTerminalCwd}
                  subscribeTerminalCwd={subscribeTerminalCwd}
                />
              </div>
            </div>
          </>
        )}

        {/* 附属功能弹窗（监控、Docker、服务、进程、网络、端口等） */}
        {!isSplitPane && (
          <WorkspaceModuleModal
            open={isModalModule}
            onClose={() => {
              handleModuleChange("terminal");
              window.dispatchEvent(new CustomEvent("focus-active-terminal"));
            }}
            title={modalConfig.title}
            icon={modalConfig.icon}
            keepMounted={true}
          >
            {/* 弹框内连接状态提示（未连接时） */}
            {!isFullyReady && isModalModule && renderConnectionOverlay()}

            {/* 其他模块仅在对应 module 激活且已连接时渲染 */}
            {isConnected && (
              <>
                {currentTab.module === "overview" && (
                  <OverviewModule serverId={connId} isActive={isActive} />
                )}
                {currentTab.module === "services" && (
                  <ServicesModule
                    serverId={connId}
                    onNavigate={handleModuleChange}
                    initialSearchQuery={
                      moduleContext?.module === "services"
                        ? moduleContext.searchQuery
                        : undefined
                    }
                  />
                )}
                {currentTab.module === "processes" && (
                  <ProcessesModule
                    serverId={connId}
                    onNavigate={handleModuleChange}
                  />
                )}
                {currentTab.module === "network" && (
                  <NetworkModule
                    serverId={connId}
                    onNavigate={handleModuleChange}
                  />
                )}
                {currentTab.module === "ports" && (
                  <PortsModule
                    serverId={connId}
                    initialSearchQuery={
                      moduleContext?.module === "ports"
                        ? moduleContext.searchQuery
                        : undefined
                    }
                    initialSubTab={
                      moduleContext?.module === "ports"
                        ? moduleContext.subTab
                        : undefined
                    }
                  />
                )}
                {currentTab.module === "docker" && isActive && (
                  <DockerModule
                    serverId={connId}
                    initialView={
                      moduleContext?.module === "docker"
                        ? moduleContext.view
                        : undefined
                    }
                    initialSearchQuery={
                      moduleContext?.module === "docker"
                        ? moduleContext.searchQuery
                        : undefined
                    }
                  />
                )}
                {currentTab.module === "forward" && (
                  <PortsModule serverId={connId} initialSubTab="forward" />
                )}
              </>
            )}
          </WorkspaceModuleModal>
        )}

        {/* RDP 模块：独立于 SSH 连接，无需先建立 SSH 即可启动远程桌面 */}
        {isRdpModule && <RdpViewerModule serverId={serverId} />}

        {/* BMC 模块：通过 Redfish API (HTTPS) 工作，独立于 SSH 连接 */}
        {isBmcModule && <BmcModule serverId={serverId} isActive={isActive} />}
      </div>

      {/* Snapshot modal */}
      <SnapshotModal
        open={showSnapshot}
        onClose={() => setShowSnapshot(false)}
        serverName={currentTab.serverName}
        serverId={serverId}
      />
      {server && (
        <ConnectionDiagnosticsDialog
          open={showConnectionDiagnostics}
          onOpenChange={setShowConnectionDiagnostics}
          server={server}
          error={connectError || serverStateEntry?.error}
          errorKind={serverStateEntry?.errorKind}
          onRetry={() => void handleConnect()}
        />
      )}
      {server && usesSshPasswordAuth && credentialPromptOpen && (
        <SshCredentialDialog
          open={credentialPromptOpen}
          initialUsername={server.username || ''}
          submitting={credentialSubmitting}
          error={credentialPromptError}
          onSubmit={(username, password) => void handleCredentialSubmit(username, password)}
          onCancel={() => {
            credentialPromptDismissedRef.current = true;
            setCredentialPromptOpen(false);
            setCredentialPromptError(null);
          }}
        />
      )}
      {server && usesSshKeyAuth && keyCredentialPromptOpen && (
        <SshKeyCredentialDialog
          open={keyCredentialPromptOpen}
          initialUsername={server.username || ''}
          authType={server.authType as 'privateKey' | 'certificate'}
          initialKeyId={server.sshKeyId}
          reason={keyCredentialPromptReason}
          submitting={keyCredentialSubmitting}
          error={keyCredentialPromptError}
          onSubmit={(username, key) => void handleKeyCredentialSubmit(username, key)}
          onCancel={() => {
            keyCredentialPromptDismissedRef.current = true;
            setKeyCredentialPromptOpen(false);
            setKeyCredentialPromptError(null);
          }}
        />
      )}
    </div>
  );
}
