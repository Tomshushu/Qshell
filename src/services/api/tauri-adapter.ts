/**
 * Tauri 后端适配器
 *
 * 通过 @tauri-apps/api 的 invoke() 调用 Rust commands，
 * 通过 listen() 监听 Tauri 事件。
 *
 * 实现 BackendAdapter 接口，前端业务代码通过 `backend` 单例
 * 访问后端能力，不直接依赖 Tauri API。
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { BackendAdapter } from "./types";
import type {
  CommandResult,
  OperationResult,
  ConnectResult,
  DetectOsResult,
  CreateShellResult,
  TestConnectionResult,
  TestConnectWithConfigResult,
  EndpointDiagnosticResult,
  FileDownloadResult,
  FileUploadResult,
  FileStatInfo,
  DockerImage,
  DockerNetwork,
  DockerVolume,
  DockerOverview,
  ComposeStreamEvent,
  SystemDfRow,
  DockerFileEntry,
  DockerCpResult,
  TransferProgressData,
  LocalUploadStats,
  ShellOutputData,
  ShellClosedData,
  ShellErrorData,
  SshEventData,
  ServerProbeProgress,
  FavoriteCommand,
  LocalDirectoryResult,
  QuickAccessPath,
  KnownHostRecord,
  SftpDiagnostics,
  TailHandle,
  SshStateResult,
  ConnectionStateData,
  ImportResult,
  AuditLog,
  GenerateKeyRequest,
  GenerateKeyResult,
  SshAgentIdentity,
  SshAgentStatus,
  ServiceResourceRawMap,
  BmcOverview,
  BmcSensorResult,
  BmcLogResult,
  BmcPowerAction,
  BatchExecuteResult,
  BatchExecuteProgress,
  ForwardSpec,
  ForwardInfo,
  TagRow,
  SyncBackgroundItem,
  LogBookmark,
} from "./types";
import { ConnectionState } from "@/services/ssh-connection-state";
import type {
  Server,
  ServerGroup,
  SshKey,
  SshKeyInput,
  SshKeyUpdate,
  SystemMetrics,
  ServiceInfo,
  ServiceCapabilities,
  ServiceProps,
  ServiceDependencies,
  ProcessInfo,
  PortInfo,
  DockerContainer,
  FileEntry,
  NetOverview,
  InterfaceInfo,
  RouteView,
  RouteGetResult,
  DnsConfigInfo,
  ConnPage,
  NeighborInfo,
  EthtoolInfo,
  HostCapabilities,
  NetworkRun,
  NetworkRunSummary,
  RunDiff,
  CaptureResult,
  ExportResult,
} from "@/types";

// ==================== 环境检测 ====================

/**
 * 检测是否在 Tauri 环境中运行。
 * Tauri 2.x 会在 window 上注入 __TAURI_INTERNALS__ 对象。
 */
function isTauriAvailable(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

// ==================== 事件监听管理 ====================

/**
 * Shell 事件回调集合（支持多订阅者）
 *
 * Rust 后端只发射 `ssh:shell-output` 事件，其中关闭/错误信息
 * 以文本标记（[Session closed] / [Shell Error]）嵌入在 data 中。
 * 这里在适配层解析这些标记，合成独立的 shell-closed / shell-error 事件，
 * 让前端回调能正确触发终端清理逻辑。
 */
const shellOutputCallbacks = new Set<(data: ShellOutputData) => void>();
const shellClosedCallbacks = new Set<(data: ShellClosedData) => void>();
const shellErrorCallbacks = new Set<(data: ShellErrorData) => void>();
// Zmodem 透传事件回调（P0-3）
const shellZmodemDetectedCallbacks = new Set<
  (data: { sessionId: string; data?: string }) => void
>();
const shellZmodemDataCallbacks = new Set<
  (data: { sessionId: string; data: string }) => void
>();
const shellZmodemEndCallbacks = new Set<
  (data: { sessionId: string }) => void
>();
// 批量执行进度事件回调（P0-4）
const batchProgressCallbacks = new Set<(data: BatchExecuteProgress) => void>();

// 任一工作台的过期回调都不能中断同一 Tauri 事件上的其他终端；同时把异常
// 变成可诊断日志，避免事件线程被同步异常打断造成“偶发不刷新/不关闭”。
function notifySafely<T>(callbacks: Set<(data: T) => void>, data: T): void {
  callbacks.forEach((callback) => {
    try {
      callback(data);
    } catch (error) {
      console.error("[Terminal Event] subscriber failed:", error);
    }
  });
}

let shellListenerInitialized = false;
let shellListenerPromise: Promise<void> | null = null;

/**
 * 确保 Shell 事件监听器已注册。
 *
 * H1 修复：原实现将 initialized flag 在 await listen() 之前置位，
 * 并发调用方误认为已就绪，导致首个 shell 的初始输出/关闭事件丢失。
 * 改为 promise 共享 + flag 后置模式（对齐 ensureSshConnectionListener）。
 */
function ensureShellListener(): Promise<void> {
  if (shellListenerInitialized) return Promise.resolve();
  if (shellListenerPromise) return shellListenerPromise;
  shellListenerPromise = (async () => {
    // ssh:shell-output：纯数据流，不再从中解析关闭/错误标记
    // （原先通过文本匹配 [Session closed]/[Shell Error] 会被用户 echo 误触发）
    await listen<ShellOutputData>("ssh:shell-output", (event) => {
      const data = event.payload;
      notifySafely(shellOutputCallbacks, data);
    });
    // ssh:shell-closed：后端在 shell reader 退出时发射的独立事件
    // 串口模块额外携带 reason（如 device_disconnected），转发给上层决定是否自动重连
    await listen<ShellOutputData & { reason?: string }>("ssh:shell-closed", (event) => {
      const data = event.payload;
      notifySafely(shellClosedCallbacks, {
        sessionId: data.sessionId,
        reason: data.reason,
      });
    });
    // ssh:shell-error：后端在 shell reader 异常退出时发射的独立事件
    // 串口模块额外携带 reason（device_disconnected），转发给上层决定是否自动重连
    await listen<ShellOutputData & { error?: string; reason?: string }>("ssh:shell-error", (event) => {
      const data = event.payload;
      notifySafely(shellErrorCallbacks, {
        sessionId: data.sessionId,
        error: data.error || data.data || "Shell error",
        reason: data.reason,
      });
    });
    // ssh:shell-zmodem-detected：后端检测到 Zmodem 起始序列，前端进入 Zmodem UI 模式
    await listen<{ sessionId: string; data?: string }>(
      "ssh:shell-zmodem-detected",
      (event) => {
        const data = event.payload;
        notifySafely(shellZmodemDetectedCallbacks, data);
      },
    );
    // ssh:shell-zmodem-data：base64 编码的 Zmodem 二进制数据流
    await listen<{ sessionId: string; data: string }>(
      "ssh:shell-zmodem-data",
      (event) => {
        const data = event.payload;
        notifySafely(shellZmodemDataCallbacks, data);
      },
    );
    // ssh:shell-zmodem-end：Zmodem 传输结束（正常完成 / 用户取消 / 会话异常）
    await listen<{ sessionId: string }>("ssh:shell-zmodem-end", (event) => {
      const data = event.payload;
      notifySafely(shellZmodemEndCallbacks, data);
    });
    // ssh:batch-progress：批量命令执行进度（每完成一台推送一次）
    await listen<BatchExecuteProgress>("ssh:batch-progress", (event) => {
      const data = event.payload;
      notifySafely(batchProgressCallbacks, data);
    });
    shellListenerInitialized = true;
  })().catch((error) => {
    // A transient WebView/Tauri startup failure must not permanently poison
    // all later shell subscriptions with the same rejected Promise.
    shellListenerPromise = null;
    throw error;
  });
  return shellListenerPromise;
}

// ==================== Tail 事件监听管理 ====================

/**
 * Tail 事件回调：sessionId -> callback
 *
 * Rust 后端通过 `logs:tail:data` 事件推送 tail 输出，
 * payload 为 { sessionId, data }。
 * 适配层根据 sessionId 路由到对应的 tail 回调。
 */
const tailCallbacks = new Map<string, (data: string) => void>();
// H2 修复：缓冲未路由的 tail 事件。logs_start_tail IPC 返回前，
// reader task 可能已 emit 携带 realSessionId 的初始行事件，
// 此时 tailCallbacks 中尚无该 sessionId 的 callback，事件会被丢弃。
// 缓冲后由 logs.tail 在注册 callback 时冲刷。
const pendingTailEvents = new Map<string, string[]>();
let tailListenerInitialized = false;
let tailListenerPromise: Promise<void> | null = null;

/** H1 修复：promise 共享 + flag 后置，避免初始化竞态 */
function ensureTailListener(): Promise<void> {
  if (tailListenerInitialized) return Promise.resolve();
  if (tailListenerPromise) return tailListenerPromise;
  tailListenerPromise = (async () => {
    await listen<{ sessionId: string; data: string }>(
      "logs:tail:data",
      (event) => {
        const { sessionId, data } = event.payload;
        const cb = tailCallbacks.get(sessionId);
        if (cb) {
          cb(data);
        } else {
          // H2: callback 尚未注册（logs_start_tail IPC 未返回），缓冲事件待冲刷
          const buf = pendingTailEvents.get(sessionId);
          if (buf) {
            buf.push(data);
          } else {
            pendingTailEvents.set(sessionId, [data]);
          }
        }
      },
    );
    tailListenerInitialized = true;
  })().catch((error) => {
    tailListenerPromise = null;
    throw error;
  });
  return tailListenerPromise;
}

// ==================== 传输进度事件 ====================

const transferProgressCallbacks = new Set<
  (data: TransferProgressData) => void
>();
let transferListenerInitialized = false;

// ==================== Compose 部署输出事件 ====================

const dockerOutputCallbacks = new Set<(e: ComposeStreamEvent) => void>();
let dockerOutputListenerInitialized = false;
let dockerOutputListenerPromise: Promise<void> | null = null;

function ensureDockerOutputListener(): Promise<void> {
  if (dockerOutputListenerInitialized) return Promise.resolve();
  if (dockerOutputListenerPromise) return dockerOutputListenerPromise;
  dockerOutputListenerPromise = (async () => {
    await listen<ComposeStreamEvent>("docker:compose-output", (event) => {
      dockerOutputCallbacks.forEach((cb) => cb(event.payload));
    });
    dockerOutputListenerInitialized = true;
  })().catch((error) => {
    dockerOutputListenerPromise = null;
    throw error;
  });
  return dockerOutputListenerPromise;
}
let transferListenerPromise: Promise<void> | null = null;

/** H1 修复：promise 共享 + flag 后置，避免初始化竞态 */
function ensureTransferListener(): Promise<void> {
  if (transferListenerInitialized) return Promise.resolve();
  if (transferListenerPromise) return transferListenerPromise;
  transferListenerPromise = (async () => {
    await listen<TransferProgressData>("transfer:progress", (event) => {
      const data = event.payload;
      // A stale panel or a third-party subscriber must not abort delivery to
      // every other transfer consumer on the same Tauri event.
      transferProgressCallbacks.forEach((cb) => {
        try {
          cb(data);
        } catch (error) {
          console.error("[Transfer Event] subscriber failed:", error);
        }
      });
    });
    transferListenerInitialized = true;
  })().catch((error) => {
    // Permit a later subscription to retry if the initial IPC listener setup
    // failed (for example during a transient WebView/Tauri startup race).
    transferListenerPromise = null;
    throw error;
  });
  return transferListenerPromise;
}

// ==================== SSH 连接事件 ====================

const sshConnectedCallbacks = new Set<(data: SshEventData) => void>();
const sshDisconnectedCallbacks = new Set<(data: SshEventData) => void>();
const sshStateChangedCallbacks = new Set<(data: ConnectionStateData) => void>();
const serverOsDetectedCallbacks = new Set<
  (data: { serverId: string; osType: string; osInfo: string }) => void
>();
let sshConnectionListenerInitialized = false;
let sshConnectionListenerPromise: Promise<void> | null = null;

/**
 * 确保 SSH 事件监听器已注册。
 *
 * **竞态修复**：原实现用 `void ensureSshConnectionListener()` fire-and-forget，
 * 导致 workspace mount 时订阅事件后立即触发 handleConnect()，
 * 后端 emit 的 `ssh:state-changed` / `ssh:connected` 事件可能在
 * `listen()` IPC 完成注册之前到达，事件全部丢失。
 *
 * 修复：在 `ssh_connect` IPC 之前 await 此函数，确保监听器已注册。
 * 使用 promise 缓存避免重复初始化（首次调用 await，后续调用返回同一 promise）。
 */
function ensureSshConnectionListener(): Promise<void> {
  if (sshConnectionListenerInitialized) return Promise.resolve();
  if (sshConnectionListenerPromise) return sshConnectionListenerPromise;
  sshConnectionListenerPromise = (async () => {
    await listen<SshEventData>("ssh:connected", (event) => {
      sshConnectedCallbacks.forEach((cb) => cb(event.payload));
    });
    await listen<SshEventData>("ssh:disconnected", (event) => {
      sshDisconnectedCallbacks.forEach((cb) => cb(event.payload));
    });
    await listen<ConnectionStateData>("ssh:state-changed", (event) => {
      sshStateChangedCallbacks.forEach((cb) => cb(event.payload));
    });
    await listen<{ serverId: string; osType: string; osInfo: string }>(
      "server:os-detected",
      (event) => {
        serverOsDetectedCallbacks.forEach((cb) => cb(event.payload));
      },
    );
    sshConnectionListenerInitialized = true;
  })().catch((error) => {
    sshConnectionListenerPromise = null;
    throw error;
  });
  return sshConnectionListenerPromise;
}

// ==================== 串口 IAP 升级进度事件 ====================

const serialIapProgressCallbacks = new Set<(data: import('./types').SerialIapProgress) => void>();
let serialIapListenerInitialized = false;
let serialIapListenerPromise: Promise<void> | null = null;

function ensureSerialIapListener(): Promise<void> {
  if (serialIapListenerInitialized) return Promise.resolve();
  if (serialIapListenerPromise) return serialIapListenerPromise;
  serialIapListenerPromise = (async () => {
    await listen<import('./types').SerialIapProgress>("serial:iap-progress", (event) => {
      serialIapProgressCallbacks.forEach((cb) => cb(event.payload));
    });
    serialIapListenerInitialized = true;
  })().catch((error) => {
    serialIapListenerPromise = null;
    throw error;
  });
  return serialIapListenerPromise;
}

// ==================== 辅助函数 ====================

/**
 * 安全调用 invoke，统一错误处理。
 * Tauri command 返回 Err(String) 时，invoke 会 reject，
 * 这里将其转为 reject(Error)。
 */
async function safeInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    const message =
      typeof e === "string" ? e : ((e as Error).message || String(e));
    throw new Error(message, { cause: e });
  }
}

/**
 * 调用返回 JSON 字符串的 command，自动 parse。
 * Rust 端 servers_list / files_list 等返回 String（JSON），
 * 需要 parse 为对应类型。
 */
async function invokeJson<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const json = await safeInvoke<string>(cmd, args);
  try {
    return JSON.parse(json) as T;
  } catch (e) {
    // JSON 解析失败时记录原始字符串，便于排查后端返回非 JSON 的问题
    // 例如 docker_ps 的 stdout 被 stderr 错误信息污染
    console.error(
      `[invokeJson] ${cmd} JSON.parse 失败:`,
      e instanceof Error ? e.message : e,
    );
    console.error(
      `[invokeJson] ${cmd} 原始返回（前 500 字符）:`,
      json.slice(0, 500),
    );
    console.error(`[invokeJson] ${cmd} 原始返回长度:`, json.length);
    throw new Error(
      `JSON.parse 失败: ${e instanceof Error ? e.message : String(e)} (cmd=${cmd}, len=${json.length})`,
      { cause: e },
    );
  }
}

// ==================== 适配器实现 ====================

// 模块加载时立即初始化 SSH 事件监听器（如果 Tauri 可用）
// 这样 workspace mount 时监听器已经注册好，避免事件丢失
if (isTauriAvailable()) {
  void ensureSshConnectionListener();
  // H1 修复：预初始化 shell/tail/transfer 监听器，
  // 确保首个 shell 创建时监听器已就绪，避免初始输出事件丢失
  void ensureShellListener();
  void ensureTailListener();
  void ensureTransferListener();
}

/** 后端 server_groups_list 返回的原始行（snake_case / camelCase 兼容） */
interface RawServerGroup {
  id: string;
  name: string;
  parent_id?: string | null;
  parentId?: string | null;
  created_at?: number;
  createdAt?: number;
  updated_at?: number;
  updatedAt?: number;
}

/**
 * 标准化从后端返回的 Server 数据结构。
 * 确保存储在 SQLite 中的 JSON 字符串（如 tags, protocols）正确解析为 JS 数组。
 */
function normalizeServer(raw: Record<string, unknown> | null): Server {
  if (!raw) return raw as unknown as Server;
  let tags = raw.tags;
  if (typeof tags === "string") {
    try {
      const parsed = JSON.parse(tags);
      tags = Array.isArray(parsed) ? parsed : [];
    } catch {
      tags = [];
    }
  } else if (!Array.isArray(tags)) {
    tags = [];
  }

  let protocols = raw.protocols;
  if (typeof protocols === "string") {
    try {
      const parsed = JSON.parse(protocols);
      protocols = Array.isArray(parsed) ? parsed : [raw.protocol || "ssh"];
    } catch {
      protocols = [raw.protocol || "ssh"];
    }
  } else if (!Array.isArray(protocols)) {
    protocols = [raw.protocol || "ssh"];
  }

  return {
    ...raw,
    authType: raw.auth_type || raw.authType || "password",
    privateKeyPath: raw.private_key_path || raw.privateKeyPath || "",
    privateKeyPassphrase: raw.private_key_passphrase || raw.privateKeyPassphrase,
    agentIdentity: raw.agent_identity || raw.agentIdentity,
    certificatePath: raw.certificate_path || raw.certificatePath,
    sshKeyId: raw.ssh_key_id || raw.sshKeyId,
    tags,
    protocols,
    targetType: raw.target_type || raw.targetType || "linux",
    protocol: raw.protocol || "ssh",
    rdpPort: raw.rdp_port !== undefined && raw.rdp_port !== null
      ? Number(raw.rdp_port)
      : (raw.rdpPort !== undefined && raw.rdpPort !== null ? Number(raw.rdpPort) : 0),
    bmcPort: raw.bmc_port || raw.bmcPort || 443,
    osType: raw.os_type || raw.osType || "",
    osInfo: raw.os_info || raw.osInfo || "",
    proxyConfig: raw.proxy_config || raw.proxyConfig || null,
    tunnelsConfig: raw.tunnels_config || raw.tunnelsConfig || null,
    keysConfig: raw.keys_config || raw.keysConfig || null,
    serialConfig: raw.serial_config || raw.serialConfig || null,
    groupId: raw.group_id || raw.groupId || null,
    lastAccessedAt: raw.last_accessed_at || raw.lastAccessedAt,
    lastDisconnectedAt: raw.last_disconnected_at || raw.lastDisconnectedAt,
    lastError: raw.last_error || raw.lastError,
    createdAt: raw.created_at || raw.createdAt,
    updatedAt: raw.updated_at || raw.updatedAt,
    // raw 为 snake_case/camelCase 双兼容的运行时数据，需经 unknown 断言为 Server
  } as unknown as Server;
}

export const tauriAdapter: BackendAdapter = {
  isAvailable: () => isTauriAvailable(),

  // ==================== 服务器管理 ====================
  servers: {
    async list(): Promise<Server[]> {
      const rawList = await invokeJson<Array<Record<string, unknown> | null>>(
        "servers_list",
      );
      return (rawList || []).map(normalizeServer);
    },
    async listForSync(): Promise<Server[]> {
      const rawList = await invokeJson<Array<Record<string, unknown> | null>>(
        "servers_list_for_sync",
      );
      return (rawList || []).map(normalizeServer);
    },
    async add(server): Promise<OperationResult> {
      return safeInvoke<OperationResult>("servers_add", {
        server: JSON.stringify(server),
      });
    },
    async update(id, updates): Promise<OperationResult> {
      return safeInvoke<OperationResult>("servers_update", {
        id,
        updates: JSON.stringify(updates),
      });
    },
    async delete(id): Promise<OperationResult> {
      return safeInvoke<OperationResult>("servers_delete", { id });
    },
    async get(id): Promise<Server | null> {
      const json = await safeInvoke<string>("servers_get", { id });
      if (!json) return null;
      return normalizeServer(JSON.parse(json));
    },
    async listTrash(): Promise<Server[]> {
      const rawList = await invokeJson<Array<Record<string, unknown> | null>>(
        "servers_list_trash",
      );
      return (rawList || []).map(normalizeServer);
    },
    async restore(id): Promise<OperationResult> {
      return safeInvoke<OperationResult>("servers_restore", { id });
    },
    async purge(id): Promise<OperationResult> {
      return safeInvoke<OperationResult>("servers_purge", { id });
    },
    async deleteBatch(ids: string[]): Promise<OperationResult> {
      return safeInvoke<OperationResult>("servers_delete_batch", { ids });
    },
    async restoreBatch(ids: string[]): Promise<OperationResult> {
      return safeInvoke<OperationResult>("servers_restore_batch", { ids });
    },
    async purgeBatch(ids: string[]): Promise<OperationResult> {
      return safeInvoke<OperationResult>("servers_purge_batch", { ids });
    },
    async cleanupTrash(retentionDays): Promise<number> {
      return safeInvoke<number>("servers_cleanup_trash", { retentionDays });
    },
    async export(filePath, ids, password): Promise<OperationResult> {
      return safeInvoke<OperationResult>("servers_export", {
        filePath,
        ids,
        password,
      });
    },
    async import(filePath, password): Promise<ImportResult> {
      return safeInvoke<ImportResult>("servers_import", {
        filePath,
        password,
      });
    },
    async parseExternalImport(source, path) {
      return safeInvoke("servers_parse_external_import", { source, path });
    },
    importExternal(candidates, skipDuplicates) {
      return safeInvoke("servers_import_external", { candidates, skipDuplicates });
    },
  },

  // ==================== 服务器分组（树形目录） ====================
  serverGroups: {
    async list(): Promise<ServerGroup[]> {
      const rawList = await invokeJson<RawServerGroup[]>("server_groups_list");
      return (rawList || []).map((g) => ({
        id: g.id,
        name: g.name,
        parentId: g.parent_id ?? g.parentId ?? null,
        createdAt: g.created_at ?? g.createdAt ?? 0,
        updatedAt: g.updated_at ?? g.updatedAt ?? 0,
      }));
    },
    async add(group): Promise<OperationResult> {
      return safeInvoke<OperationResult>("server_groups_add", {
        group: JSON.stringify({
          ...(group.id ? { id: group.id } : {}),
          name: group.name,
          parentId: group.parentId ?? null,
        }),
      });
    },
    async update(id, updates): Promise<OperationResult> {
      return safeInvoke<OperationResult>("server_groups_update", {
        id,
        updates: JSON.stringify({
          ...(updates.name !== undefined ? { name: updates.name } : {}),
          ...(updates.parentId !== undefined ? { parentId: updates.parentId } : {}),
        }),
      });
    },
    async delete(id): Promise<OperationResult> {
      return safeInvoke<OperationResult>("server_groups_delete", { id });
    },
  },

  // ==================== SSH 连接 ====================
  ssh: {
    async connect(serverId): Promise<ConnectResult> {
      // 确保事件监听器已注册，避免后端 emit 的事件在 listen() 完成前丢失
      await ensureSshConnectionListener();
      return safeInvoke<ConnectResult>("ssh_connect", { serverId });
    },
    async disconnect(serverId): Promise<OperationResult> {
      return safeInvoke<OperationResult>("ssh_disconnect", { serverId });
    },
    async execute(serverId, command): Promise<CommandResult> {
      return safeInvoke<CommandResult>("ssh_execute", { serverId, command });
    },
    async isConnected(serverId): Promise<boolean> {
      return safeInvoke<boolean>("ssh_is_connected", { serverId });
    },
    async probeConnections(): Promise<string[]> {
      return safeInvoke<string[]>("ssh_probe_connections");
    },
    async getState(serverId): Promise<SshStateResult> {
      // 将后端返回的字符串 state 反序列化为 enum
      const raw = await safeInvoke<{
        state: string;
        error?: string;
        errorKind?: string;
        generation?: number;
      }>("ssh_get_state", { serverId });
      return {
        state: (raw.state as ConnectionState) ?? ConnectionState.Disconnected,
        error: raw.error,
        errorKind: raw.errorKind as SshStateResult["errorKind"],
        generation: raw.generation ?? 0,
      };
    },
    async getConnectedServers(): Promise<string[]> {
      return safeInvoke<string[]>("ssh_get_connected_servers");
    },
    async testConnection(serverId): Promise<TestConnectionResult> {
      return safeInvoke<TestConnectionResult>("ssh_test_connection", {
        serverId,
      });
    },
    async testConnectWithConfig(config): Promise<TestConnectWithConfigResult> {
      return safeInvoke<TestConnectWithConfigResult>(
        "ssh_test_connect_with_config",
        {
          config,
        },
      );
    },
    async diagnoseEndpoint(host, port, timeoutSecs): Promise<EndpointDiagnosticResult> {
      return safeInvoke<EndpointDiagnosticResult>("ssh_diagnose_endpoint", {
        host,
        port,
        timeoutSecs,
      });
    },
    async resetKnownHost(serverId): Promise<OperationResult> {
      return safeInvoke<OperationResult>("ssh_reset_known_host", { serverId });
    },
    async listKnownHosts(): Promise<KnownHostRecord[]> {
      return safeInvoke<KnownHostRecord[]>("ssh_list_known_hosts");
    },
    async deleteKnownHost(host, port, keyType): Promise<OperationResult> {
      return safeInvoke<OperationResult>("ssh_delete_known_host", { host, port, keyType });
    },
    async clearAllKnownHosts(): Promise<OperationResult> {
      return safeInvoke<OperationResult>("ssh_clear_all_known_hosts");
    },
    async restoreKnownHosts(records: KnownHostRecord[]): Promise<number> {
      return safeInvoke<number>("ssh_restore_known_hosts", { records });
    },
    async checkAllServers(): Promise<Record<string, boolean>> {
      return safeInvoke<Record<string, boolean>>("ssh_check_all_servers");
    },
    async detectOsInfo(serverId): Promise<DetectOsResult> {
      return safeInvoke<DetectOsResult>("ssh_detect_os_info", { serverId });
    },
    async getHomeDirectory(serverId): Promise<string> {
      return safeInvoke<string>("ssh_get_home_directory", { serverId });
    },
    onConnected(callback): () => void {
      sshConnectedCallbacks.add(callback);
      void ensureSshConnectionListener();
      return () => {
        sshConnectedCallbacks.delete(callback);
      };
    },
    onDisconnected(callback): () => void {
      sshDisconnectedCallbacks.add(callback);
      void ensureSshConnectionListener();
      return () => {
        sshDisconnectedCallbacks.delete(callback);
      };
    },
    onOsDetected(callback): () => void {
      serverOsDetectedCallbacks.add(callback);
      void ensureSshConnectionListener();
      return () => {
        serverOsDetectedCallbacks.delete(callback);
      };
    },
    onStateChanged(callback): () => void {
      sshStateChangedCallbacks.add(callback);
      void ensureSshConnectionListener();
      return () => {
        sshStateChangedCallbacks.delete(callback);
      };
    },
    onProbeProgress(callback): () => void {
      // 每次订阅独立注册 listener，探测事件仅在 checkAllServers 期间触发
      // 返回 unsubscribe 函数供调用方在探测结束后清理
      let unlisten: UnlistenFn | undefined;
      let cancelled = false;
      listen<ServerProbeProgress>("server:probe-progress", (event) => {
        callback(event.payload);
      }).then((fn) => {
        // 若订阅已被取消，立即注销避免泄漏
        if (cancelled) fn();
        else unlisten = fn;
      });
      return () => {
        cancelled = true;
        if (unlisten) unlisten();
      };
    },
    // 交互式 Shell
    async createShell(
      serverId,
      cols,
      rows,
      encoding = "utf-8",
    ): Promise<CreateShellResult> {
      return safeInvoke<CreateShellResult>("ssh_create_shell", {
        serverId,
        cols,
        rows,
        encoding,
      });
    },
    async writeToShell(sessionId, data): Promise<void> {
      // 等待后端确认：串口会话会在驱动 write_all + flush 完成后返回，
      // SSH/Telnet 也能把通道关闭等错误传回调用方。
      await safeInvoke<void>("ssh_write_to_shell", { sessionId, data });
    },
    interruptShell(sessionId): Promise<number> {
      // Ctrl+C 必须绕过普通输入队列：刷屏时普通 mpsc 可能已积压，
      // 专用 command 直接投递到后端的无界中断通道。
      return safeInvoke<number>("ssh_interrupt_shell", { sessionId });
    },
    resizeShell(sessionId, cols, rows): void {
      void safeInvoke<void>("ssh_resize_shell", { sessionId, cols, rows });
    },
    async setShellEncoding(sessionId, encoding): Promise<void> {
      await safeInvoke<void>("ssh_set_shell_encoding", { sessionId, encoding });
    },
    pauseShell(sessionId): void {
      void safeInvoke<void>("ssh_pause_shell", { sessionId });
    },
    resumeShell(sessionId): void {
      void safeInvoke<void>("ssh_resume_shell", { sessionId });
    },
    async closeShell(sessionId): Promise<OperationResult> {
      return safeInvoke<OperationResult>("ssh_close_shell", { sessionId });
    },
    async getShellHistory(sessionId): Promise<string> {
      return safeInvoke<string>("ssh_get_shell_history", { sessionId });
    },
    onShellOutput(callback): () => void {
      shellOutputCallbacks.add(callback);
      void ensureShellListener();
      return () => {
        shellOutputCallbacks.delete(callback);
      };
    },
    onShellClosed(callback): () => void {
      shellClosedCallbacks.add(callback);
      void ensureShellListener();
      return () => {
        shellClosedCallbacks.delete(callback);
      };
    },
    onShellError(callback): () => void {
      shellErrorCallbacks.add(callback);
      void ensureShellListener();
      return () => {
        shellErrorCallbacks.delete(callback);
      };
    },
    // ===== Zmodem 透传（P0-3） =====
    async shellZmodemWrite(sessionId, data): Promise<void> {
      // 与 writeToShell 同样的 fire-and-forget 模式：保证协议响应顺序
      await safeInvoke<void>("ssh_shell_zmodem_write", { sessionId, data });
    },
    async shellZmodemEnd(sessionId): Promise<OperationResult> {
      return safeInvoke<OperationResult>("ssh_shell_zmodem_end", { sessionId });
    },
    onShellZmodemDetected(callback): () => void {
      shellZmodemDetectedCallbacks.add(callback);
      void ensureShellListener();
      return () => {
        shellZmodemDetectedCallbacks.delete(callback);
      };
    },
    onShellZmodemData(callback): () => void {
      shellZmodemDataCallbacks.add(callback);
      void ensureShellListener();
      return () => {
        shellZmodemDataCallbacks.delete(callback);
      };
    },
    onShellZmodemEnd(callback): () => void {
      shellZmodemEndCallbacks.add(callback);
      void ensureShellListener();
      return () => {
        shellZmodemEndCallbacks.delete(callback);
      };
    },
    // ===== 批量命令执行（P0-4） =====
    async batchExecute(
      serverIds,
      command,
      timeoutSecs,
    ): Promise<BatchExecuteResult> {
      return safeInvoke<BatchExecuteResult>("ssh_batch_execute", {
        serverIds,
        command,
        timeoutSecs: timeoutSecs ?? null,
      });
    },
    onBatchExecuteProgress(callback): () => void {
      batchProgressCallbacks.add(callback);
      void ensureShellListener();
      return () => {
        batchProgressCallbacks.delete(callback);
      };
    },

    // ==================== SSH 密钥管理（对齐 Termius/MobaXterm/SecureCRT） ====================
    keys: {
      async generate(req: GenerateKeyRequest): Promise<GenerateKeyResult> {
        return safeInvoke<GenerateKeyResult>("ssh_generate_key", { req });
      },
      async testAgent(): Promise<SshAgentStatus> {
        return safeInvoke<SshAgentStatus>("ssh_test_ssh_agent");
      },
      async listAgentIdentities(): Promise<SshAgentIdentity[]> {
        return safeInvoke<SshAgentIdentity[]>("ssh_list_agent_identities");
      },
    },
  },

  // ==================== Telnet 协议（P0-5） ====================
  // 仅暴露 createShell；write/resize/close/getHistory 复用 ssh_* 命令，
  // 后端依据 session_id 前缀（telnet-）自动路由到 Telnet 模块。
  // 事件复用 ssh:shell-output / ssh:shell-closed / ssh:shell-error，前端无感知。
  telnet: {
    async createShell(
      serverId: string,
      host: string,
      port: number,
      cols: number,
      rows: number,
      timeoutSecs?: number,
      encoding = "utf-8",
    ): Promise<CreateShellResult> {
      return safeInvoke<CreateShellResult>("telnet_create_shell", {
        serverId,
        host,
        port,
        cols,
        rows,
        timeoutSecs: timeoutSecs ?? null,
        encoding,
      });
    },
  },

  // ==================== 串口 Serial / COM 协议（Xshell 级功能） ====================
  serial: {
    async listPorts(): Promise<import('@/types').SerialPortInfo[]> {
      return safeInvoke<import('@/types').SerialPortInfo[]>("serial_list_ports");
    },
    async testPort(
      portName: string,
      baudRate?: number,
      dataBits?: number,
      stopBits?: number,
      parity?: string,
      flowControl?: string,
    ): Promise<{ success: boolean; message?: string; error?: string; signals?: import('@/types').SerialSignals }> {
      return safeInvoke("serial_test_port", {
        portName,
        baudRate: baudRate ?? 115200,
        dataBits: dataBits ?? 8,
        stopBits: stopBits ?? 1,
        parity: parity ?? "none",
        flowControl: flowControl ?? "none",
      });
    },
    async createShell(
      serverId: string,
      portName: string,
      baudRate?: number,
      dataBits?: number,
      stopBits?: number,
      parity?: string,
      flowControl?: string,
      dtr?: boolean,
      rts?: boolean,
      encoding = "utf-8",
      deviceVid?: number,
      devicePid?: number,
      deviceSerialNumber?: string,
    ): Promise<CreateShellResult> {
      // 串口读线程会在 IPC 返回前启动；先注册全局事件监听，避免设备刚打开就
      // 断开时丢失首个 output/error/closed 事件。
      await ensureShellListener();
      return safeInvoke<CreateShellResult>("serial_create_shell", {
        serverId,
        portName,
        baudRate: baudRate ?? 115200,
        dataBits: dataBits ?? 8,
        stopBits: stopBits ?? 1,
        parity: parity ?? "none",
        flowControl: flowControl ?? "none",
        dtr: dtr ?? true,
        rts: rts ?? true,
        encoding,
        deviceVid,
        devicePid,
        deviceSerialNumber,
      });
    },
    async setBreak(sessionId: string, durationMs = 250): Promise<OperationResult> {
      try {
        await safeInvoke("serial_set_break", { sessionId, durationMs });
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
    async setDtr(sessionId: string, level: boolean): Promise<OperationResult> {
      try {
        await safeInvoke("serial_set_dtr", { sessionId, level });
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
    async setRts(sessionId: string, level: boolean): Promise<OperationResult> {
      try {
        await safeInvoke("serial_set_rts", { sessionId, level });
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
    async getSignals(sessionId: string): Promise<import('@/types').SerialSignals> {
      return safeInvoke<import('@/types').SerialSignals>("serial_get_signals", { sessionId });
    },
    async getHistoryRaw(sessionId: string): Promise<string> {
      return safeInvoke<string>("serial_get_history_raw", { sessionId });
    },
    async getStats(sessionId: string): Promise<import('@/types').SerialStats> {
      return safeInvoke<import('@/types').SerialStats>("serial_get_stats", { sessionId });
    },
    async encodeText(text: string, encoding: string): Promise<string> {
      return safeInvoke<string>("serial_encode_text", { text, encoding });
    },
    async decodeHex(hex: string, encoding: string): Promise<string> {
      return safeInvoke<string>("serial_decode_hex", { hex, encoding });
    },
    async parseFirmware(filePath: string): Promise<import('./types').FirmwareInfo> {
      return safeInvoke<import('./types').FirmwareInfo>("serial_iap_parse_firmware", { filePath });
    },
    async startIap(config: import('./types').SerialIapConfig): Promise<OperationResult> {
      await ensureSerialIapListener();
      try {
        await safeInvoke<void>("serial_iap_start", { config });
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
    async cancelIap(sessionId: string): Promise<OperationResult> {
      try {
        await safeInvoke<void>("serial_iap_cancel", { sessionId });
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    },
    onIapProgress(callback: (data: import('./types').SerialIapProgress) => void): () => void {
      serialIapProgressCallbacks.add(callback);
      void ensureSerialIapListener();
      return () => {
        serialIapProgressCallbacks.delete(callback);
      };
    },
  },

  // ==================== SSH 密钥库（持久化 + 加密存储） ====================
  sshKeys: {
    async list(): Promise<SshKey[]> {
      return invokeJson<SshKey[]>("ssh_keys_list");
    },
    async listForSync(): Promise<SshKey[]> {
      return invokeJson<SshKey[]>("ssh_keys_list_for_sync");
    },
    async add(input: SshKeyInput): Promise<OperationResult> {
      return safeInvoke<OperationResult>("ssh_keys_add", {
        key: JSON.stringify(input),
      });
    },
    async update(id: string, updates: SshKeyUpdate): Promise<OperationResult> {
      return safeInvoke<OperationResult>("ssh_keys_update", {
        id,
        updates: JSON.stringify(updates),
      });
    },
    async delete(id: string): Promise<OperationResult> {
      return safeInvoke<OperationResult>("ssh_keys_delete", { id });
    },
    async readFileContent(path: string): Promise<string> {
      return safeInvoke<string>("ssh_keys_read_file_content", { path });
    },
  },

  // ==================== 标签目录（独立存储） ====================
  tags: {
    async list(): Promise<string[]> {
      const rows = await safeInvoke<{ name: string }[]>("tags_list");
      return (rows || []).map((r) => r.name);
    },
    async create(name: string): Promise<string> {
      const row = await safeInvoke<{ name: string }>("tags_create", { name });
      return row.name;
    },
    async rename(oldName: string, newName: string): Promise<void> {
      await safeInvoke("tags_rename", { oldName, newName });
    },
    async delete(name: string): Promise<void> {
      await safeInvoke("tags_delete", { name });
    },
    async listAll(): Promise<TagRow[]> {
      return safeInvoke<TagRow[]>("tags_list");
    },
    async restore(tags: TagRow[]): Promise<number> {
      return safeInvoke<number>("tags_restore", { tags });
    },
  },

  // ==================== 系统指标 ====================
  metrics: {
    async collect(serverId): Promise<SystemMetrics> {
      const json = await safeInvoke<string>("metrics_collect", { serverId });
      return JSON.parse(json) as SystemMetrics;
    },
    async refreshCache(serverId): Promise<OperationResult> {
      return safeInvoke<OperationResult>("metrics_refresh_cache", { serverId });
    },
  },

  // ==================== 服务管理 ====================
  services: {
    async list(serverId): Promise<ServiceInfo[]> {
      return invokeJson<ServiceInfo[]>("services_list", { serverId });
    },
    async start(serverId, name): Promise<CommandResult> {
      return safeInvoke<CommandResult>("services_start", {
        serverId,
        serviceName: name,
      });
    },
    async stop(serverId, name): Promise<CommandResult> {
      return safeInvoke<CommandResult>("services_stop", {
        serverId,
        serviceName: name,
      });
    },
    async restart(serverId, name): Promise<CommandResult> {
      return safeInvoke<CommandResult>("services_restart", {
        serverId,
        serviceName: name,
      });
    },
    async status(serverId, name): Promise<CommandResult> {
      return safeInvoke<CommandResult>("services_status", {
        serverId,
        serviceName: name,
      });
    },
    async enable(serverId, name): Promise<CommandResult> {
      return safeInvoke<CommandResult>("services_enable", {
        serverId,
        serviceName: name,
      });
    },
    async disable(serverId, name): Promise<CommandResult> {
      return safeInvoke<CommandResult>("services_disable", {
        serverId,
        serviceName: name,
      });
    },
    async inspect(serverId, name): Promise<ServiceProps> {
      return invokeJson<ServiceProps>("services_inspect", {
        serverId,
        serviceName: name,
      });
    },
    async logs(serverId, name, query): Promise<CommandResult> {
      return safeInvoke<CommandResult>("services_logs", {
        serverId,
        serviceName: name,
        lines: query?.lines ?? null,
        since: query?.since ?? null,
        priority: query?.priority ?? null,
      });
    },
    async capabilities(serverId): Promise<ServiceCapabilities> {
      return invokeJson<ServiceCapabilities>("services_capabilities", { serverId });
    },
    async followStart(serverId, name, lines): Promise<string> {
      const res = await safeInvoke<OperationResult>(
        "services_logs_follow_start",
        { serverId, serviceName: name, lines: lines ?? null },
      );
      if (!res.success) throw new Error(res.error || "启动日志跟随失败");
      return res.id || "";
    },
    async followStop(serverId, name): Promise<OperationResult> {
      return safeInvoke<OperationResult>("services_logs_follow_stop", {
        serverId,
        serviceName: name,
      });
    },
    async dependencies(serverId, name): Promise<ServiceDependencies> {
      return invokeJson<ServiceDependencies>("services_dependencies", {
        serverId,
        serviceName: name,
      });
    },
    async unitFile(serverId, name): Promise<CommandResult> {
      return safeInvoke<CommandResult>("services_unit_file", {
        serverId,
        serviceName: name,
      });
    },
    async process(serverId, name): Promise<CommandResult> {
      return safeInvoke<CommandResult>("services_process", {
        serverId,
        serviceName: name,
      });
    },
    async ports(serverId, name): Promise<CommandResult> {
      return safeInvoke<CommandResult>("services_ports", {
        serverId,
        serviceName: name,
      });
    },
    async mask(serverId, name): Promise<CommandResult> {
      return safeInvoke<CommandResult>("services_mask", {
        serverId,
        serviceName: name,
      });
    },
    async unmask(serverId, name): Promise<CommandResult> {
      return safeInvoke<CommandResult>("services_unmask", {
        serverId,
        serviceName: name,
      });
    },
    async daemonReload(serverId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("services_daemon_reload", { serverId });
    },
    async resources(serverId): Promise<ServiceResourceRawMap> {
      return invokeJson<ServiceResourceRawMap>("services_resources", { serverId });
    },
  },

  // ==================== 进程管理 ====================
  processes: {
    async list(serverId): Promise<ProcessInfo[]> {
      return invokeJson<ProcessInfo[]>("processes_list", { serverId });
    },
    async signal(serverId, pid, signal, startTimeTicks): Promise<CommandResult> {
      return safeInvoke<CommandResult>("processes_signal", {
        serverId,
        pid,
        signal,
        startTimeTicks,
      });
    },
  },

  // ==================== 端口管理 ====================
  ports: {
    async list(serverId): Promise<PortInfo[]> {
      return invokeJson<PortInfo[]>("ports_list", { serverId });
    },
    async killByPid(serverId, pid): Promise<CommandResult> {
      return safeInvoke<CommandResult>("ports_kill_by_pid", { serverId, pid });
    },
  },

  // ==================== 网络诊断 ====================
  network: {
    async dns(serverId, target): Promise<CommandResult> {
      return safeInvoke<CommandResult>("network_dns", { serverId, target });
    },
    async ping(serverId, target): Promise<CommandResult> {
      return safeInvoke<CommandResult>("network_ping", { serverId, target });
    },
    async tcpCheck(serverId, host, port): Promise<CommandResult> {
      return safeInvoke<CommandResult>("network_tcp_check", {
        serverId,
        host,
        port,
      });
    },
    async httpCheck(serverId, url): Promise<CommandResult> {
      return safeInvoke<CommandResult>("network_http_check", { serverId, url });
    },
    async getOverview(serverId) {
      return safeInvoke<NetOverview>("net_overview", { serverId });
    },
    async getInterfaces(serverId) {
      return safeInvoke<InterfaceInfo[]>("net_interfaces", { serverId });
    },
    async getRoutes(serverId) {
      return safeInvoke<RouteView>("net_routes", { serverId });
    },
    async getRouteGet(serverId, target) {
      return safeInvoke<RouteGetResult>("net_route_get", { serverId, target });
    },
    async getDnsConfig(serverId) {
      return safeInvoke<DnsConfigInfo>("net_dns_config", { serverId });
    },
    async getConnections(serverId, query) {
      return safeInvoke<ConnPage>("net_connections", {
        serverId,
        query: query ?? null,
      });
    },
    async getNeighbors(serverId) {
      return safeInvoke<NeighborInfo[]>("net_neighbors", { serverId });
    },
    async getEthtool(serverId, iface) {
      return safeInvoke<EthtoolInfo>("net_ethtool", { serverId, iface });
    },
    async getCapabilities(serverId, refresh) {
      return safeInvoke<HostCapabilities>("net_capabilities", {
        serverId,
        refresh: refresh ?? false,
      });
    },
    async runQuickCheck(serverId, target, port, protocol) {
      return safeInvoke<NetworkRun>("net_run_quick_check", {
        serverId,
        target,
        port: port ?? null,
        protocol: protocol ?? null,
      });
    },
    async runTraceroute(serverId, target, mode) {
      return safeInvoke<string>("net_run_traceroute", {
        serverId,
        target,
        mode: mode ?? null,
      });
    },
    async runPing(serverId, target, count) {
      return safeInvoke<string>("net_run_ping", {
        serverId,
        target,
        count: count ?? null,
      });
    },
    async startCapture(serverId, req) {
      return safeInvoke<CaptureResult>("net_capture_start", {
        serverId,
        req,
      });
    },
    async listRuns(serverId, limit) {
      return safeInvoke<NetworkRunSummary[]>("net_runs_list", {
        serverId,
        limit: limit ?? null,
      });
    },
    async getRun(runId) {
      return safeInvoke<NetworkRun | null>("net_run_get", { runId });
    },
    async deleteRun(runId) {
      return safeInvoke<void>("net_run_delete", { runId });
    },
    async compareRuns(runIdA, runIdB) {
      return safeInvoke<RunDiff>("net_runs_compare", { runIdA, runIdB });
    },
    async exportReport(runId, format) {
      return safeInvoke<ExportResult>("net_report_export", { runId, format });
    },
  },

  // ==================== 日志 ====================
  logs: {
    async read(serverId, path, lines): Promise<CommandResult> {
      return safeInvoke<CommandResult>("logs_read", {
        serverId,
        logPath: path,
        lines,
      });
    },
    tail(serverId, path, callback): TailHandle {
      // H2 修复：移除 tempKey 机制，改为 IPC 返回后注册 callback 并冲刷缓冲事件。
      // listener 已在 sessionId 无对应 callback 时自动缓冲事件到 pendingTailEvents，
      // IPC 返回 realSessionId 后注册 callback 并冲刷缓冲，确保初始行不丢失。
      let realSessionId: string | null = null;
      let isCleanedUp = false;
      void ensureTailListener();

      const promise = (async (): Promise<CommandResult> => {
        // 启动 tail，Rust 端返回 OperationResult（含 sessionId 在 id 字段）
        const result = await safeInvoke<OperationResult>("logs_start_tail", {
          serverId,
          logPath: path,
        });

        // 竞态防御：若在 IPC 返回前调用方已触发 cleanup，立即向后端发送 stop 并退出，避免子进程与回调泄漏
        if (isCleanedUp) {
          if (result.success && result.id) {
            // Stop only the stream created by this call. A later stream for
            // the same server must not be cancelled by a stale cleanup.
            void safeInvoke<OperationResult>("logs_stop_tail", {
              serverId,
              sessionId: result.id,
            }).catch(() => {});
          }
          if (result.id) {
            pendingTailEvents.delete(result.id);
          }
          return result as unknown as CommandResult;
        }

        if (result.success && result.id) {
          realSessionId = result.id;
          // 注册 callback
          tailCallbacks.set(realSessionId, callback);
          // H2: 冲刷在 IPC 调用期间缓冲的初始行事件
          const pending = pendingTailEvents.get(realSessionId);
          if (pending) {
            pendingTailEvents.delete(realSessionId);
            for (const data of pending) {
              callback(data);
            }
          }
        }
        return result as unknown as CommandResult;
      })();

      const cleanup = () => {
        isCleanedUp = true;
        if (realSessionId) {
          tailCallbacks.delete(realSessionId);
          pendingTailEvents.delete(realSessionId);
          // 通知后端停止 tail 进程，防止远端 SSH 通道和 tail 子进程泄漏
          // 用 void + catch 避免阻塞清理流程，失败只记日志
          void safeInvoke<OperationResult>("logs_stop_tail", {
            serverId,
            sessionId: realSessionId,
          }).catch((err) =>
            console.error("Failed to stop tail on cleanup:", err),
          );
        }
      };

      return { promise, cleanup };
    },
    async stopTail(serverId): Promise<OperationResult> {
      // Rust 端按 serverId 索引 tail 会话，不需要 path
      return safeInvoke<OperationResult>("logs_stop_tail", { serverId });
    },
    async search(serverId, path, keyword): Promise<CommandResult> {
      return safeInvoke<CommandResult>("logs_search", {
        serverId,
        logPath: path,
        keyword,
      });
    },
  },

  // ==================== 文件管理 ====================
  files: {
    async list(serverId, path): Promise<FileEntry[]> {
      return invokeJson<FileEntry[]>("files_list", {
        serverId,
        dirPath: path,
      });
    },
    async read(serverId, path): Promise<CommandResult> {
      return safeInvoke<CommandResult>("files_read", { serverId, path });
    },
    async readBinary(serverId, path): Promise<string> {
      // 返回纯 base64 字符串（无 ::base64:: 前缀）
      return safeInvoke<string>("files_read_binary", { serverId, path });
    },
    async write(serverId, path, content): Promise<CommandResult> {
      return safeInvoke<CommandResult>("files_write", {
        serverId,
        path,
        content,
      });
    },
    async mkdir(serverId, path): Promise<CommandResult> {
      return safeInvoke<CommandResult>("files_mkdir", { serverId, path });
    },
    async delete(serverId, path): Promise<CommandResult> {
      return safeInvoke<CommandResult>("files_delete", { serverId, path });
    },
    async rename(serverId, oldPath, newPath): Promise<CommandResult> {
      return safeInvoke<CommandResult>("files_rename", {
        serverId,
        oldPath,
        newPath,
      });
    },
    async getPermissions(serverId, path): Promise<CommandResult> {
      return safeInvoke<CommandResult>("files_get_permissions", {
        serverId,
        path,
      });
    },
    async setPermissions(
      serverId,
      path,
      mode,
      recursive?,
    ): Promise<CommandResult> {
      return safeInvoke<CommandResult>("files_set_permissions", {
        serverId,
        path,
        mode,
        recursive: recursive ?? false,
      });
    },
    async download(
      serverId,
      remotePath,
      localDest,
    ): Promise<FileDownloadResult> {
      return safeInvoke<FileDownloadResult>("files_download", {
        serverId,
        remotePath,
        localDest,
      });
    },
    async downloadArchive(
      serverId,
      remotePath,
      format,
    ): Promise<FileDownloadResult> {
      return safeInvoke<FileDownloadResult>("files_download_archive", {
        serverId,
        remotePath,
        format,
      });
    },
    async extractArchive(serverId, path, conflictAction): Promise<OperationResult> {
      return safeInvoke<OperationResult>("files_extract_archive", { serverId, path, conflictAction: conflictAction ?? null });
    },
    async installExtractionTool(serverId, path): Promise<OperationResult> {
      return safeInvoke<OperationResult>("files_install_extraction_tool", { serverId, path });
    },
    async upload(serverId, remoteDir, uploadType): Promise<FileUploadResult> {
      return safeInvoke<FileUploadResult>("files_upload", {
        serverId,
        remoteDir,
        uploadType,
      });
    },
    async uploadFromPaths(
      serverId,
      remoteDir,
      localPaths,
      targetFileName?,
    ): Promise<FileUploadResult> {
      return safeInvoke<FileUploadResult>("files_upload_from_paths", {
        serverId,
        remoteDir,
        localPaths,
        targetFileName: targetFileName ?? null,
      });
    },
    async getLocalUploadStats(paths): Promise<LocalUploadStats> {
      return safeInvoke<LocalUploadStats>("files_get_local_upload_stats", {
        paths,
      });
    },
    async cancelTransfer(transferId): Promise<boolean> {
      return safeInvoke<boolean>("files_cancel_transfer", { transferId });
    },
    async cancelAllTransfers(): Promise<number> {
      return safeInvoke<number>("files_cancel_all_transfers");
    },
    async resumeUpload(
      serverId,
      localPath,
      remotePath,
      tmpRemotePath,
      offset,
      transferId,
      expectedSourceSize,
    ): Promise<FileUploadResult> {
      return safeInvoke<FileUploadResult>("files_resume_upload", {
        serverId,
        localPath,
        remotePath,
        tmpRemotePath,
        offset,
        transferId,
        // null → Rust Option::None，未传时后端跳过校验保持向后兼容
        expectedSourceSize: expectedSourceSize ?? null,
      });
    },
    async resumeDownload(
      serverId,
      remotePath,
      localPath,
      tmpLocalPath,
      offset,
      transferId,
    ): Promise<FileDownloadResult> {
      return safeInvoke<FileDownloadResult>("files_resume_download", {
        serverId,
        remotePath,
        localPath,
        tmpLocalPath,
        offset,
        transferId,
      });
    },
    async cleanupTmpFile(serverId, tmpPath, isRemote): Promise<boolean> {
      return safeInvoke<boolean>("files_cleanup_tmp_file", {
        serverId,
        tmpPath,
        isRemote,
      });
    },
    async setTransferRateLimit(kbps): Promise<void> {
      await safeInvoke<void>("files_set_rate_limit", { kbps });
    },
    async setExclusionConfig(
      enabled: boolean,
      patterns: string[],
      respectGitignore: boolean,
    ): Promise<void> {
      await safeInvoke<void>("files_set_exclusion_config", {
        enabled,
        patterns,
        respectGitignore,
      });
    },
    async searchFilesRecursive(
      serverId,
      dir,
      pattern,
      maxResults?,
    ): Promise<string[]> {
      return invokeJson<string[]>("files_search_recursive", {
        serverId,
        dir,
        pattern,
        maxResults: maxResults ?? 500,
      });
    },
    onTransferProgress(callback): () => void {
      transferProgressCallbacks.add(callback);
      void ensureTransferListener();
      return () => {
        transferProgressCallbacks.delete(callback);
      };
    },
    async backup(serverId, path): Promise<CommandResult> {
      return safeInvoke<CommandResult>("files_backup", { serverId, path });
    },
    async chown(
      serverId,
      path,
      owner,
      group,
      recursive,
    ): Promise<CommandResult> {
      return safeInvoke<CommandResult>("files_chown", {
        serverId,
        path,
        owner,
        group,
        recursive,
      });
    },
    async createSymlink(serverId, target, linkPath): Promise<CommandResult> {
      return safeInvoke<CommandResult>("files_create_symlink", {
        serverId,
        target,
        linkPath,
      });
    },
    async statInfo(serverId, path): Promise<FileStatInfo> {
      return invokeJson<FileStatInfo>("files_stat_info", { serverId, path });
    },
    async serverToServerTransfer(
      srcServerId,
      srcPath,
      destServerId,
      destPath,
      targetName?,
    ): Promise<CommandResult> {
      return safeInvoke<CommandResult>("files_server_to_server_transfer", {
        srcServerId,
        srcPath,
        destServerId,
        destPath,
        targetName: targetName ?? null,
      });
    },
    // 本地文件系统访问
    async getSystemRoots(): Promise<string[]> {
      return safeInvoke<string[]>("files_get_system_roots");
    },
    async listLocalDirectory(path): Promise<LocalDirectoryResult> {
      const json = await safeInvoke<string>("files_list_local_directory", {
        path,
      });
      return JSON.parse(json) as LocalDirectoryResult;
    },
    async getQuickAccess(): Promise<QuickAccessPath[]> {
      const json = await safeInvoke<string>("files_get_quick_access");
      return JSON.parse(json) as QuickAccessPath[];
    },
    async listDrives(serverId): Promise<string[]> {
      return invokeJson<string[]>("files_list_drives", { serverId });
    },
    async diagnoseSftp(serverId): Promise<SftpDiagnostics> {
      return invokeJson<SftpDiagnostics>("files_diagnose_sftp", { serverId });
    },
  },

  // ==================== Docker ====================
  docker: {
    async ps(serverId): Promise<DockerContainer[]> {
      return invokeJson<DockerContainer[]>("docker_ps", { serverId });
    },
    async images(serverId): Promise<DockerImage[]> {
      return invokeJson<DockerImage[]>("docker_images", { serverId });
    },
    async start(serverId, containerId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_start", {
        serverId,
        containerId,
      });
    },
    async stop(serverId, containerId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_stop", {
        serverId,
        containerId,
      });
    },
    async restart(serverId, containerId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_restart", {
        serverId,
        containerId,
      });
    },
    async logs(serverId, containerId, lines, since): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_logs", {
        serverId,
        containerId,
        lines,
        since: since ?? null,
      });
    },
    async stats(serverId, containerId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_stats", {
        serverId,
        containerId,
      });
    },
    async inspect(serverId, containerId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_inspect", {
        serverId,
        containerId,
      });
    },
    async composePs(serverId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_compose_ps", { serverId });
    },
    // 注册表 ∪ 实时状态合并列表：down 后容器被删、实时 ls 不再返回，
    // 但注册表中已登记的项目仍以 exists=false / status='' 返回，前端据此显示"未运行"。
    // 返回 JSON 字符串（数组），前端自行 JSON.parse。
    async composeList(serverId): Promise<string> {
      return safeInvoke<string>("docker_compose_list", { serverId });
    },
    async rmi(serverId, imageId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_rmi", { serverId, imageId });
    },
    async imagePrune(serverId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_image_prune", { serverId });
    },
    async rm(serverId, containerId, force): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_rm", {
        serverId,
        containerId,
        force,
      });
    },
    async composeUp(serverId, projectDir, configFiles): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_compose_up", {
        serverId,
        projectDir,
        configFiles: configFiles ?? null,
      });
    },
    async composeDown(
      serverId,
      projectDir,
      configFiles,
    ): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_compose_down", {
        serverId,
        projectDir,
        configFiles: configFiles ?? null,
      });
    },
    async composeLogs(
      serverId,
      projectName,
      lines,
      projectDir,
      configFiles,
      service,
    ): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_compose_logs", {
        serverId,
        projectName,
        lines,
        projectDir: projectDir ?? null,
        configFiles: configFiles ?? null,
        service: service ?? null,
      });
    },
    async composeServices(
      serverId,
      projectDir,
      configFiles,
    ): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_compose_services", {
        serverId,
        projectDir: projectDir ?? null,
        configFiles: configFiles ?? null,
      });
    },
    async composeImportScan(serverId, dirs): Promise<unknown[]> {
      return invokeJson<unknown[]>("docker_compose_import_scan", { serverId, dirs });
    },
    async networkLs(serverId): Promise<DockerNetwork[]> {
      return invokeJson<DockerNetwork[]>("docker_network_ls", { serverId });
    },
    async networkRm(serverId, name): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_network_rm", { serverId, name });
    },
    async networkPrune(serverId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_network_prune", { serverId });
    },
    async networkInspect(serverId, networkId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_network_inspect", {
        serverId,
        networkId,
      });
    },
    async networkCreate(serverId, name, driver, subnet, gateway): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_network_create", {
        serverId,
        name,
        driver,
        subnet: subnet ?? null,
        gateway: gateway ?? null,
      });
    },
    async networkConnect(serverId, networkId, containerId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_network_connect", {
        serverId,
        networkId,
        containerId,
      });
    },
    async networkDisconnect(serverId, networkId, containerId, force): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_network_disconnect", {
        serverId,
        networkId,
        containerId,
        force,
      });
    },
    async volumeLs(serverId): Promise<DockerVolume[]> {
      return invokeJson<DockerVolume[]>("docker_volume_ls", { serverId });
    },
    async volumeRm(serverId, name, force): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_volume_rm", {
        serverId,
        name,
        force,
      });
    },
    async volumePrune(serverId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_volume_prune", { serverId });
    },
    async volumeBrowse(serverId, volumeName, subPath): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_volume_browse", {
        serverId,
        volumeName,
        subPath: subPath ?? null,
      });
    },
    async pull(serverId, image): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_pull", { serverId, image });
    },
    async info(serverId): Promise<DockerOverview> {
      return invokeJson<DockerOverview>("docker_info", { serverId });
    },
    async pause(serverId, containerId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_pause", {
        serverId,
        containerId,
      });
    },
    async unpause(serverId, containerId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_unpause", {
        serverId,
        containerId,
      });
    },
    async composeAction(serverId, action, projectDir, configFiles): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_compose_action", {
        serverId,
        action,
        projectDir,
        configFiles: configFiles ?? null,
      });
    },
    async run(serverId, params): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_run", {
        serverId,
        name: params.name,
        image: params.image,
        ports: params.ports ?? null,
        volumes: params.volumes ?? null,
        env: params.env ?? null,
        restart: params.restart ?? null,
        network: params.network ?? null,
      });
    },
    async imageInspect(serverId, imageId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_image_inspect", {
        serverId,
        imageId,
      });
    },
    async imageSave(serverId, imageRef): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_image_save", {
        serverId,
        imageRef,
      });
    },
    async imageLoad(serverId, remotePath): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_image_load", {
        serverId,
        remotePath,
      });
    },
    async imageSaveStream(serverId, imageRefs, localPath, estimatedBytes): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_image_save_stream", {
        serverId,
        imageRefs,
        localPath,
        estimatedBytes,
      });
    },
    async imageLoadStream(serverId, localPath): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_image_load_stream", {
        serverId,
        localPath,
      });
    },
    async imageTransferCancel(serverId): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_image_transfer_cancel", {
        serverId,
      });
    },
    async composeValidate(serverId, projectDir, configFiles): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_compose_validate", {
        serverId,
        projectDir,
        configFiles: configFiles ?? null,
      });
    },
    async composeCreate(serverId, projectDir, yamlB64): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_compose_create", {
        serverId,
        projectDir,
        yamlB64,
      });
    },
    async composeActionStream(
      serverId, action, projectDir, configFiles, requestId,
    ): Promise<null> {
      return safeInvoke<null>("docker_compose_action_stream", {
        serverId,
        action,
        projectDir,
        configFiles: configFiles ?? null,
        requestId,
      });
    },
    async logsStream(
      serverId, containerId, tail, since, requestId,
    ): Promise<null> {
      return safeInvoke<null>("docker_logs_stream", {
        serverId,
        containerId,
        tail,
        since: since ?? null,
        requestId,
      });
    },
    async containerFileList(serverId, containerId, path): Promise<DockerFileEntry[]> {
      return invokeJson<DockerFileEntry[]>("docker_container_file_list", {
        serverId,
        containerId,
        path,
      });
    },
    async cpFromContainer(
      serverId, containerId, srcPath,
    ): Promise<DockerCpResult> {
      return invokeJson<DockerCpResult>("docker_cp_from_container", {
        serverId,
        containerId,
        srcPath,
      });
    },
    async cpToContainer(
      serverId, containerId, hostPath, destDir, deleteSource,
    ): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_cp_to_container", {
        serverId,
        containerId,
        hostPath,
        destDir,
        deleteSource: deleteSource ?? null,
      });
    },
    async containerFileDelete(
      serverId, containerId, path,
    ): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_container_file_delete", {
        serverId,
        containerId,
        path,
      });
    },
    async cpCleanup(serverId, path): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_cp_cleanup", { serverId, path });
    },
    async login(serverId, registry, username, password): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_login", {
        serverId,
        registry: registry ?? null,
        username,
        password,
      });
    },
    async systemDf(serverId): Promise<SystemDfRow[]> {
      return invokeJson<SystemDfRow[]>("docker_system_df", { serverId });
    },
    async systemPrune(serverId, includeImages): Promise<CommandResult> {
      return safeInvoke<CommandResult>("docker_system_prune", {
        serverId,
        includeImages,
      });
    },
    async onComposeOutput(callback: (e: ComposeStreamEvent) => void): Promise<() => void> {
      await ensureDockerOutputListener();
      // 注意：dockerOutputCallbacks 是 Set，必须用 add/delete 而不是 push/splice，
      // 否则运行时抛 `push is not a function`，导致 openDeploy 的 .then() 不执行、
      // dockerComposeActionStream 没发起、面板永远停在"执行中"且无输出
      dockerOutputCallbacks.add(callback);
      return () => {
        dockerOutputCallbacks.delete(callback);
      };
    },
  },

  // ==================== 快照 ====================
  snapshot: {
    async generate(serverId): Promise<Record<string, unknown>> {
      return safeInvoke<Record<string, unknown>>("snapshot_generate", {
        serverId,
      });
    },
  },

  // ==================== 收藏指令 ====================
  favCmds: {
    async list(): Promise<FavoriteCommand[]> {
      return safeInvoke<FavoriteCommand[]>("fav_cmds_list");
    },
    async add(cmd, desc): Promise<OperationResult> {
      return safeInvoke<OperationResult>("fav_cmds_add", { cmd, desc });
    },
    async update(id, cmd, desc): Promise<OperationResult> {
      return safeInvoke<OperationResult>("fav_cmds_update", { id, cmd, desc });
    },
    async delete(id): Promise<OperationResult> {
      return safeInvoke<OperationResult>("fav_cmds_delete", { id });
    },
    async restore(cmds: FavoriteCommand[]): Promise<OperationResult> {
      return safeInvoke<OperationResult>("fav_cmds_restore", { cmds });
    },
  },

  // ==================== 书签 ====================
  bookmarks: {
    async listAll(): Promise<LogBookmark[]> {
      return invokeJson<LogBookmark[]>("bookmarks_list_all");
    },
    async restore(items: LogBookmark[]): Promise<OperationResult> {
      return safeInvoke<OperationResult>("bookmarks_restore", { items });
    },
  },

  // ==================== 终端自定义背景图片/视频 ====================
  backgrounds: {
    async listForSync(): Promise<SyncBackgroundItem[]> {
      return safeInvoke<SyncBackgroundItem[]>("backgrounds_list_for_sync");
    },
    async restore(items: SyncBackgroundItem[]): Promise<number> {
      return safeInvoke<number>("backgrounds_restore", { items });
    },
  },

  // ==================== 窗口管理 ====================
  window: {
    async create(label, title, stateJson, x, y): Promise<void> {
      await safeInvoke<void>("window_create", {
        label,
        title,
        stateJson,
        x,
        y,
      });
    },
    async listAll(): Promise<
      Array<{
        label: string;
        title: string;
        x: number;
        y: number;
        width: number;
        height: number;
      }>
    > {
      return safeInvoke("window_list_all");
    },
    async close(label): Promise<void> {
      await safeInvoke<void>("window_close", { label });
    },
    async startDragging(): Promise<void> {
      await safeInvoke<void>("window_start_dragging");
    },
    async setPosition(label, x, y): Promise<void> {
      await safeInvoke<void>("window_set_position", { label, x, y });
    },
    async getCursorState(): Promise<{
      x: number;
      y: number;
      leftButtonDown: boolean;
    }> {
      return safeInvoke("get_cursor_state");
    },
  },

  // ==================== 审计日志 ====================
  auditLogs: {
    async list(
      logType,
      searchQuery,
      limit = 50,
      offset = 0,
    ): Promise<AuditLog[]> {
      return safeInvoke<AuditLog[]>("audit_logs_list", {
        logType,
        searchQuery,
        limit,
        offset,
      });
    },
    async count(logType, searchQuery): Promise<number> {
      return safeInvoke<number>("audit_logs_count", { logType, searchQuery });
    },
    async clear(): Promise<OperationResult> {
      return safeInvoke<OperationResult>("audit_logs_clear");
    },
    async record(
      logType,
      serverName,
      event,
      status,
      details,
    ): Promise<OperationResult> {
      return safeInvoke<OperationResult>("record_audit_log", {
        logType,
        serverName,
        event,
        status,
        details,
      });
    },
  },

  // ==================== RDP 远程桌面 ====================
  rdp: {
    async launch(config): Promise<OperationResult> {
      const { serverId, rdpPort, width, height, fullscreen, colorDepth } =
        config;
      return safeInvoke<OperationResult>("rdp_launch", {
        serverId,
        rdpPort: rdpPort ?? null,
        width: width ?? null,
        height: height ?? null,
        fullscreen: fullscreen ?? null,
        colorDepth: colorDepth ?? null,
      });
    },
  },

  // ==================== BMC 带外管理（Redfish API） ====================
  bmc: {
    async testConnectionWithConfig(config): Promise<OperationResult> {
      return safeInvoke<OperationResult>("bmc_test_connect_with_config", {
        config,
      });
    },
    async getOverview(serverId): Promise<BmcOverview> {
      return safeInvoke<BmcOverview>("bmc_get_overview", { serverId });
    },
    async powerAction(
      serverId,
      action: BmcPowerAction,
    ): Promise<OperationResult> {
      return safeInvoke<OperationResult>("bmc_power_action", {
        serverId,
        action,
      });
    },
    async getSensors(serverId): Promise<BmcSensorResult> {
      return safeInvoke<BmcSensorResult>("bmc_get_sensors", { serverId });
    },
    async getLogs(serverId): Promise<BmcLogResult> {
      return safeInvoke<BmcLogResult>("bmc_get_logs", { serverId });
    },
    async clearLogs(serverId): Promise<OperationResult> {
      return safeInvoke<OperationResult>("bmc_clear_logs", { serverId });
    },
    async setIdentifyLed(serverId, on): Promise<OperationResult> {
      return safeInvoke<OperationResult>("bmc_set_identify_led", {
        serverId,
        on,
      });
    },
    async setBootSource(serverId, target): Promise<OperationResult> {
      return safeInvoke<OperationResult>("bmc_set_boot_source", {
        serverId,
        target,
      });
    },
  },

  // ==================== 端口转发（P0-2） ====================
  portForward: {
    async add(spec: ForwardSpec): Promise<OperationResult> {
      return safeInvoke<OperationResult>("port_forward_add", { spec });
    },
    async list(serverId?: string): Promise<ForwardInfo[]> {
      return safeInvoke<ForwardInfo[]>("port_forward_list", {
        serverId: serverId ?? null,
      });
    },
    async stop(forwardId: string): Promise<OperationResult> {
      return safeInvoke<OperationResult>("port_forward_stop", { forwardId });
    },
    async restart(forwardId: string): Promise<OperationResult> {
      return safeInvoke<OperationResult>("port_forward_restart", { forwardId });
    },
    async stopAll(serverId: string): Promise<OperationResult> {
      return safeInvoke<OperationResult>("port_forward_stop_all", { serverId });
    },
  },
};
