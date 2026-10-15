/**
 * SSH 服务层（业务统一入口）
 *
 * 所有业务组件通过 `sshService` 访问后端 SSH/服务器/文件/Docker 等能力。
 * 内部委托给 `@/services/api` 的 Tauri adapter，
 * 并提供三项附加价值：
 *   1. 连接去重（connectingPromises）—— 避免并发 connect 撞上后端防并发窗口
 *   2. 会话注册管理（tabSessions）—— 广播输入同步时查询其他 tab 的会话
 *   3. 非桌面环境下的优雅降级
 *
 * 本地文件系统操作（listLocalDirectory / getSystemRoots 等）不属于 SSH 域，
 * 业务代码应直接使用 `backend.files.*`。
 */

import type {
  Server,
  SystemMetrics,
  ServiceInfo,
  ServiceCapabilities,
  ServiceProps,
  ServiceLogQuery,
  ServiceDependencies,
  ProcessInfo,
  PortInfo,
  DockerContainer,
  SerialPortInfo,
  SerialSignals,
  SerialStats,
  NetOverview,
  InterfaceInfo,
  RouteView,
  RouteGetResult,
  DnsConfigInfo,
  ConnPage,
  ConnQuery,
  NeighborInfo,
  EthtoolInfo,
  HostCapabilities,
  NetworkRun,
  NetworkRunSummary,
  RunDiff,
  CaptureReq,
  CaptureResult,
  ExportResult,
} from "@/types";
import { backend, isDesktopAvailable } from "@/services/api";
import type {
  CommandResult,
  OperationResult,
  ConnectResult,
  DetectOsResult,
  CreateShellResult,
  TestConnectionResult,
  TestConnectWithConfigResult,
  FileDownloadResult,
  FileUploadResult,
  FileStatInfo,
  FileEntry,
  ServiceResourceRawMap,
  DockerImage,
  DockerNetwork,
  DockerVolume,
  DockerOverview,
  DockerRunParams,
  DockerFileEntry,
  DockerCpResult,
  ComposeStreamEvent,
  SystemDfRow,
  TransferProgressData,
  ShellOutputData,
  ShellClosedData,
  ShellErrorData,
  ServerProbeProgress,
  TestConnectConfig,
  SshStateResult,
  ConnectionStateData,
  ImportResult,
  GenerateKeyRequest,
  GenerateKeyResult,
  SshAgentIdentity,
  SshAgentStatus,
  SshKey,
  SshKeyInput,
  SshKeyUpdate,
} from "@/services/api";
import {
  ConnectionState,
  SshErrorKind,
  shouldRetry,
  isOperational,
  isTerminal,
  isConnecting as isStateConnecting,
  isReady as isStateReady,
} from "@/services/ssh-connection-state";

export interface ActiveTransferRecord {
  transferId: string;
  serverId: string;
  fileName: string;
  type: 'upload' | 'download' | 's2s';
  tmpPath?: string;
  isUpload: boolean;
}

const activeTransfers = new Map<string, ActiveTransferRecord>();
let isExiting = false;

// 重新导出状态机辅助函数，方便业务层直接从 sshService 引用
export {
  ConnectionState,
  SshErrorKind,
  shouldRetry,
  isOperational,
  isTerminal,
  isStateConnecting,
  isStateReady,
};

/** 非桌面环境下的统一错误提示 */
const NOT_AVAILABLE = "Please run this app in a desktop environment";

// ==================== 连接去重 ====================
// 同一 serverId 的并发 connect 共享同一个 Promise，避免 workspace / terminal
// 同时触发 connect 撞上后端 30s 防并发窗口而被判为"连接失败"。
// 连接完成（成功或失败）后立即清理，后续调用会发起新请求（后端会通过
// is_connected 短路返回 Ok）。
//
// 【关键约束】必须配合 30s 超时保护 —— 若 invoke('ssh_connect') 因后端
// 死锁/IPC 阻塞而永不 resolve，无限期保留的 inflight Promise 会让后续所有
// 相同 serverId 的 connect 直接命中 inflight 而不再真正调用后端，UI 会
// 永远卡在"连接中"动画且无任何后端日志。超时后自动清理，让下一次重试能
// 真正发起 IPC。
const CONNECT_TIMEOUT_MS = 30_000;
const connectingPromises = new Map<string, Promise<ConnectResult>>();

const TRANSFER_CANCEL_TIMEOUT_MS = 10_000;

/** Bound shutdown IPC so an unavailable backend cannot block application exit forever. */
async function withTransferCancelTimeout<T>(promise: Promise<T>, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${operation} timed out`)), TRANSFER_CANCEL_TIMEOUT_MS);
  });
  // The invoke promise may settle after the timeout; attach a rejection handler
  // so it never becomes an unhandled rejection during shutdown.
  promise.catch(() => {});
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * C3.3 修复：前端维护的存活 shell session 集合。
 * createShell 成功时 add，closeShell 时 delete。
 * broadcastToShells 写入前检查 isSessionAlive，避免向已关闭 session 发送无效写入。
 * 注意：这是优化手段，writeToShell 对不存在的 session 会静默失败，不影响正确性。
 */
const aliveSessions = new Set<string>();

/** 带超时保护的 connect Promise 包装 */
function connectWithTimeout(serverId: string): Promise<ConnectResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          "Connection timeout (no response in 30s, backend may be blocked or network unreachable)",
        ),
      );
    }, CONNECT_TIMEOUT_MS);
  });
  const backendP = backend!.ssh.connect(serverId);
  // Promise.race settle 后，若 backendP 最终 reject 会产生 unhandledrejection。
  // 附加一个空的 catch handler 吞掉后续 rejection，防止全局错误。
  backendP.catch(() => {});
  return Promise.race([backendP, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// ==================== 会话注册管理 ====================
/** tabId → sessionIds 映射，供会话迁移和清理使用。 */
const tabSessions = new Map<string, Set<string>>();

/** tabId → 当前可见/活动终端的 sessionId。广播只允许写入这个会话。 */
const tabActiveSessions = new Map<string, string>();

function notifyDataMutated(_source: string) {
  // 仅在应用启动时按需比对同步，日常操作不触发自动同步
}

export const sshService = {
  /**
   * 检查是否在可用的 Tauri 桌面环境中
   */
  isAvailable(): boolean {
    return isDesktopAvailable;
  },

  // ==================== 服务器管理 ====================
  async listServers(): Promise<Server[]> {
    if (!backend) return [];
    return backend.servers.list();
  },

  async listServersForSync(): Promise<Server[]> {
    if (!backend) return [];
    if (backend.servers.listForSync) {
      return backend.servers.listForSync();
    }
    return backend.servers.list();
  },

  async addServer(
    server: Omit<Server, "createdAt" | "updatedAt">,
  ): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.servers.add(server);
    if (res.success) notifyDataMutated('addServer');
    return res;
  },

  async updateServer(
    id: string,
    updates: Partial<Server>,
  ): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.servers.update(id, updates);
    if (res.success) notifyDataMutated('updateServer');
    return res;
  },

  async deleteServer(id: string): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.servers.delete(id);
    if (res.success) notifyDataMutated('deleteServer');
    return res;
  },

  // ==================== 回收站 ====================
  async listTrashServers(): Promise<Server[]> {
    if (!backend) return [];
    return backend.servers.listTrash();
  },

  async restoreServer(id: string): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.servers.restore(id);
    if (res.success) notifyDataMutated('restoreServer');
    return res;
  },

  async purgeServer(id: string): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.servers.purge(id);
    if (res.success) notifyDataMutated('purgeServer');
    return res;
  },

  async deleteServersBatch(ids: string[]): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.servers.deleteBatch(ids);
    if (res.success) notifyDataMutated('deleteServersBatch');
    return res;
  },

  async restoreServersBatch(ids: string[]): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.servers.restoreBatch(ids);
    if (res.success) notifyDataMutated('restoreServersBatch');
    return res;
  },

  async purgeServersBatch(ids: string[]): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.servers.purgeBatch(ids);
    if (res.success) notifyDataMutated('purgeServersBatch');
    return res;
  },

  async cleanupTrash(retentionDays: number): Promise<number> {
    if (!backend) return 0;
    const count = await backend.servers.cleanupTrash(retentionDays);
    if (count > 0) notifyDataMutated('cleanupTrash');
    return count;
  },

  async getServer(id: string): Promise<Server | null> {
    if (!backend) return null;
    return backend.servers.get(id);
  },

  /**
   * 导出服务器列表到加密 JSON 文件
   *
   * @param filePath 用户选择的保存路径（一般通过 dialog.save() 获取）
   * @param ids 要导出的服务器 id 列表。传空数组 = 导出全部
   * @param password 导出密码，用于派生 export_key 加密敏感字段
   * @returns OperationResult.success=true 表示写入成功
   */
  async exportServers(
    filePath: string,
    ids: string[],
    password: string,
  ): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.servers.export(filePath, ids, password);
  },

  /**
   * 从本产品生成的加密 JSON 文件导入服务器列表
   *
   * @param filePath 用户选择的导入文件路径（一般通过 dialog.open() 获取）
   * @param password 导出时使用的密码
   * @returns ImportResult 包含 total / imported / skipped / errors 统计
   */
  async importServers(
    filePath: string,
    password: string,
  ): Promise<ImportResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.servers.import(filePath, password);
    if (res.imported > 0) notifyDataMutated('importServers');
    return res;
  },

  async parseExternalImport(
    source: import("./api/types").ExternalImportSource,
    path?: string,
  ): Promise<import("./api/types").ExternalImportPreview> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.servers.parseExternalImport(source, path);
  },

  async importExternalServers(
    candidates: import("./api/types").ExternalImportCandidate[],
    skipDuplicates = true,
  ): Promise<ImportResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.servers.importExternal(candidates, skipDuplicates);
    if (res.imported > 0) notifyDataMutated('importExternalServers');
    return res;
  },

  // ==================== 服务器分组（树形目录） ====================
  async listGroups(): Promise<import("@/types").ServerGroup[]> {
    if (!backend) return [];
    return backend.serverGroups.list();
  },

  async addGroup(
    name: string,
    parentId?: string | null,
    id?: string,
  ): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.serverGroups.add({ id, name, parentId: parentId ?? null });
    if (res.success) notifyDataMutated('addGroup');
    return res;
  },

  async updateGroup(
    id: string,
    updates: { name?: string; parentId?: string | null },
  ): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.serverGroups.update(id, updates);
    if (res.success) notifyDataMutated('updateGroup');
    return res;
  },

  async deleteGroup(id: string): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.serverGroups.delete(id);
    if (res.success) notifyDataMutated('deleteGroup');
    return res;
  },

  // ==================== SSH 密钥库 ====================
  async listKeys(): Promise<SshKey[]> {
    if (!backend) return [];
    return backend.sshKeys.list();
  },

  async listKeysForSync(): Promise<SshKey[]> {
    if (!backend) return [];
    if (backend.sshKeys.listForSync) {
      return backend.sshKeys.listForSync();
    }
    return backend.sshKeys.list();
  },

  async addKey(input: SshKeyInput): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.sshKeys.add(input);
    if (res.success) notifyDataMutated('addKey');
    return res;
  },

  async updateKey(id: string, updates: SshKeyUpdate): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.sshKeys.update(id, updates);
    if (res.success) notifyDataMutated('updateKey');
    return res;
  },

  async deleteKey(id: string): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.sshKeys.delete(id);
    if (res.success) notifyDataMutated('deleteKey');
    return res;
  },

  // ==================== 标签目录（独立存储） ====================
  async listTags(): Promise<string[]> {
    if (!backend) return [];
    return backend.tags.list();
  },

  async createTag(name: string): Promise<string> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.tags.create(name);
    notifyDataMutated('createTag');
    return res;
  },

  async renameTag(oldName: string, newName: string): Promise<void> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    await backend.tags.rename(oldName, newName);
    notifyDataMutated('renameTag');
  },

  async deleteTag(name: string): Promise<void> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    await backend.tags.delete(name);
    notifyDataMutated('deleteTag');
  },

  async listTagsAll(): Promise<import("./api/types").TagRow[]> {
    if (!backend?.tags.listAll) return [];
    return backend.tags.listAll();
  },

  async restoreTags(tags: import("./api/types").TagRow[]): Promise<number> {
    if (!backend?.tags.restore) return 0;
    return backend.tags.restore(tags);
  },

  /** 移动服务器（批量）到指定分组。groupId 为 null 表示移出到根目录 */
  async moveServersToGroup(
    serverIds: string[],
    groupId: string | null,
  ): Promise<{ success: number; failed: string[] }> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    let success = 0;
    const failed: string[] = [];
    await Promise.all(
      serverIds.map(async (id) => {
        try {
          const result = await backend!.servers.update(id, {
            groupId: groupId ?? "",
          });
          if (result.success) success++;
          else failed.push(result.error || id);
        } catch {
          failed.push(id);
        }
      }),
    );
    return { success, failed };
  },

  // ==================== SSH 连接 ====================
  async connect(serverId: string): Promise<ConnectResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const inflight = connectingPromises.get(serverId);
    if (inflight) return inflight;
    const p = connectWithTimeout(serverId).finally(() => {
      // C1.1 修复：仅当 map 中仍是本 Promise 时才删除，
      // 避免 connect→disconnect→connect 时序下旧 Promise 的 finally 误删新 Promise
      if (connectingPromises.get(serverId) === p) {
        connectingPromises.delete(serverId);
      }
    });
    connectingPromises.set(serverId, p);
    return p;
  },

  async disconnect(serverId: string): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    // 清理 inflight connect Promise：防止用户在 connecting 中点击断开后，
    // inflight connect resolve 又把状态置为 Ready（与用户意图冲突）。
    // 注意：Promise.race 中的后端 IPC 无法取消，但删除 inflight 引用后，
    // 即使后端最终成功，workspace.tsx 的 handleConnect 也不会再被 .then 触发
    // （因为 disconnect 路径不 await connect）。
    connectingPromises.delete(serverId);
    return backend.ssh.disconnect(serverId);
  },

  async isConnected(serverId: string): Promise<boolean> {
    if (!backend) return false;
    return backend.ssh.isConnected(serverId);
  },

  /**
   * 主动探测所有连接（用于系统休眠唤醒、网络恢复时秒级主动探活）
   */
  async probeConnections(): Promise<string[]> {
    if (!backend) return [];
    return backend.ssh.probeConnections();
  },

  /**
   * 拉取服务器当前状态机状态（连接失败时附带 error/errorKind）。
   * 业务层应用此方法取代 boolean isConnected 进行状态判断。
   */
  async getState(serverId: string): Promise<SshStateResult> {
    if (!backend) {
      return { state: ConnectionState.Disconnected, generation: 0 };
    }
    return backend.ssh.getState(serverId);
  },

  /**
   * 订阅后端推送的 ssh:state-changed 事件。
   * 返回 unsubscribe 函数。
   */
  onStateChanged(callback: (data: ConnectionStateData) => void): () => void {
    if (!backend) return () => {};
    return backend.ssh.onStateChanged(callback);
  },

  /**
   * 订阅服务器探测进度事件（server:probe-progress）。
   * 每完成一台探测推送一次，调用方可在 checkAllServers 期间实时更新状态。
   * 返回 unsubscribe 函数。
   */
  onProbeProgress(callback: (data: ServerProbeProgress) => void): () => void {
    if (!backend) return () => {};
    return backend.ssh.onProbeProgress(callback);
  },

  async getConnectedServers(): Promise<string[]> {
    if (!backend) return [];
    return backend.ssh.getConnectedServers();
  },

  async testConnection(serverId: string): Promise<TestConnectionResult> {
    if (!backend) return { online: false };
    return backend.ssh.testConnection(serverId);
  },

  async testConnectWithConfig(
    config: TestConnectConfig,
  ): Promise<TestConnectWithConfigResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.ssh.testConnectWithConfig(config);
  },

  async testBmcConnectionWithConfig(config: {
    id?: string;
    host: string;
    port?: number;
    username: string;
    password?: string;
    connectionTimeout?: number;
    bmcAllowInvalidCerts?: boolean;
  }): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.bmc.testConnectionWithConfig(config);
  },

  async diagnoseEndpoint(host: string, port: number, timeoutSecs = 6) {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.ssh.diagnoseEndpoint(host, port, timeoutSecs);
  },

  /** 重置指定服务器的已知服务器密钥记录（用于服务器密钥轮换/重装后重新信任） */
  async resetKnownHost(
    serverId: string,
  ): Promise<import("./api/types").OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.ssh.resetKnownHost(serverId);
    if (res.success) notifyDataMutated('knownHosts');
    return res;
  },

  /** 列出所有已知主机公钥指纹记录 */
  async listKnownHosts(): Promise<import("./api/types").KnownHostRecord[]> {
    if (!backend) return [];
    return backend.ssh.listKnownHosts();
  },

  /** 删除指定主机的公钥指纹记录 */
  async deleteKnownHost(
    host: string,
    port: number,
    keyType?: string,
  ): Promise<import("./api/types").OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.ssh.deleteKnownHost(host, port, keyType);
    if (res.success) notifyDataMutated('knownHosts');
    return res;
  },

  /** 清空全部已记录的已知主机公钥 */
  async clearAllKnownHosts(): Promise<import("./api/types").OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.ssh.clearAllKnownHosts();
    if (res.success) notifyDataMutated('knownHosts');
    return res;
  },

  /** 批量恢复已知主机公钥指纹记录 */
  async restoreKnownHosts(records: import("./api/types").KnownHostRecord[]): Promise<number> {
    if (!backend?.ssh.restoreKnownHosts) return 0;
    return backend.ssh.restoreKnownHosts(records);
  },

  async checkAllServers(): Promise<Record<string, boolean>> {
    if (!backend) return {};
    return backend.ssh.checkAllServers();
  },

  async detectOsInfo(serverId: string): Promise<DetectOsResult> {
    if (!backend) return { success: false };
    return backend.ssh.detectOsInfo(serverId);
  },

  onOsDetected(
    callback: (data: { serverId: string; osType: string; osInfo: string }) => void,
  ): () => void {
    return backend?.ssh.onOsDetected?.(callback) ?? (() => {});
  },

  async getHomeDirectory(serverId: string): Promise<string> {
    if (!backend) return "/";
    return backend.ssh.getHomeDirectory(serverId);
  },

  async execute(serverId: string, command: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.ssh.execute(serverId, command);
  },

  // ==================== SSH Shell (交互式终端) ====================
  async createShell(
    serverId: string,
    cols: number,
    rows: number,
    encoding = "utf-8",
  ): Promise<CreateShellResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const result = await backend.ssh.createShell(
      serverId,
      cols,
      rows,
      encoding,
    );
    if (result.sessionId) aliveSessions.add(result.sessionId);
    return result;
  },

  // ==================== Telnet Shell（P0-5：网络设备 Telnet 协议） ====================
  // 与 SSH createShell 对齐：成功后同样注册到 aliveSessions，
  // 后续 closeShell 等操作复用同一套 API（后端按 session_id 前缀路由）。
  async createTelnetShell(
    serverId: string,
    host: string,
    port: number,
    cols: number,
    rows: number,
    timeoutSecs?: number,
    encoding = "utf-8",
  ): Promise<CreateShellResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const result = await backend.telnet.createShell(
      serverId,
      host,
      port,
      cols,
      rows,
      timeoutSecs,
      encoding,
    );
    if (result.sessionId) aliveSessions.add(result.sessionId);
    return result;
  },

  async writeToShell(sessionId: string, data: string): Promise<void> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    await backend.ssh.writeToShell(sessionId, data);
  },

  /** 通过独立快速通道向远端 PTY 发送 Ctrl+C，绕过普通输入队列。 */
  interruptShell(sessionId: string): Promise<number> {
    if (!backend) return Promise.resolve(0);
    return backend.ssh.interruptShell(sessionId);
  },

  /** 暂停/恢复高频日志读取，用于前端高水位背压。 */
  pauseShell(sessionId: string): void {
    if (!backend) return;
    backend.ssh.pauseShell(sessionId);
  },

  resumeShell(sessionId: string): void {
    if (!backend) return;
    backend.ssh.resumeShell(sessionId);
  },

  async setShellEncoding(sessionId: string, encoding: string): Promise<void> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    await backend.ssh.setShellEncoding(sessionId, encoding);
  },

  resizeShell(sessionId: string, cols: number, rows: number): void {
    if (!backend) return;
    backend.ssh.resizeShell(sessionId, cols, rows);
  },

  async closeShell(sessionId: string): Promise<OperationResult> {
    aliveSessions.delete(sessionId);
    if (!backend) return { success: true };
    return backend.ssh.closeShell(sessionId);
  },

  /** C3.3 修复：检查 session 是否仍存活（createShell 后、closeShell 前） */
  isSessionAlive(sessionId: string): boolean {
    return aliveSessions.has(sessionId);
  },

  onShellOutput(callback: (data: ShellOutputData) => void): () => void {
    if (!backend) return () => {};
    return backend.ssh.onShellOutput(callback);
  },

  onShellClosed(callback: (data: ShellClosedData) => void): () => void {
    if (!backend) return () => {};
    return backend.ssh.onShellClosed((data) => {
      aliveSessions.delete(data.sessionId);
      callback(data);
    });
  },

  onShellError(callback: (data: ShellErrorData) => void): () => void {
    if (!backend) return () => {};
    return backend.ssh.onShellError(callback);
  },

  // ==================== 会话迁移管理（拖拽分离/合并时保留终端内容） ====================
  /** 注册 tab 与 shell session 的关联 */
  registerTabSession(tabId: string, sessionId: string) {
    let set = tabSessions.get(tabId);
    if (!set) {
      set = new Set();
      tabSessions.set(tabId, set);
    }

    set.add(sessionId);
  },

  /** 取消注册 */
  unregisterTabSession(tabId: string, sessionId: string) {
    const set = tabSessions.get(tabId);
    if (set) {
      set.delete(sessionId);
      if (set.size === 0) {
        tabSessions.delete(tabId);
      }
    }
    if (tabActiveSessions.get(tabId) === sessionId) {
      tabActiveSessions.delete(tabId);
    }
  },

  onShellZmodemDetected(
    callback: (data: { sessionId: string; data?: string }) => void,
  ): () => void {
    return backend?.ssh.onShellZmodemDetected(callback) ?? (() => {});
  },
  onShellZmodemData(
    callback: (data: { sessionId: string; data: string }) => void,
  ): () => void {
    return backend?.ssh.onShellZmodemData(callback) ?? (() => {});
  },
  onShellZmodemEnd(
    callback: (data: { sessionId: string }) => void,
  ): () => void {
    return backend?.ssh.onShellZmodemEnd(callback) ?? (() => {});
  },
  shellZmodemWrite(sessionId: string, data: string): Promise<void> {
    return backend?.ssh.shellZmodemWrite(sessionId, data) ?? Promise.resolve();
  },
  shellZmodemEnd(sessionId: string): Promise<OperationResult> {
    return (
      backend?.ssh.shellZmodemEnd(sessionId) ??
      Promise.resolve({ success: true })
    );
  },

  /** 获取 tab 关联的所有 sessionIds */
  getTabSessionIds(tabId: string): string[] {
    return Array.from(tabSessions.get(tabId) ?? []);
  },

  /** 更新工作台当前活动终端。undefined 表示当前没有可广播的活动会话。 */
  setTabActiveSession(tabId: string, sessionId?: string) {
    if (sessionId && aliveSessions.has(sessionId)) {
      tabActiveSessions.set(tabId, sessionId);
    } else {
      tabActiveSessions.delete(tabId);
    }
  },

  /** 获取工作台当前活动终端会话，不返回隐藏终端。 */
  getTabActiveSessionId(tabId: string): string | undefined {
    const sessionId = tabActiveSessions.get(tabId);
    return sessionId && aliveSessions.has(sessionId) ? sessionId : undefined;
  },

  /** 清空 tab 的 session 注册 */
  clearTabSessions(tabId: string) {
    tabSessions.delete(tabId);
    tabActiveSessions.delete(tabId);
  },

  /** 获取 Shell 历史输出（恢复终端内容） */
  async getShellHistory(sessionId: string): Promise<string> {
    if (!backend) return "";
    return backend.ssh.getShellHistory(sessionId);
  },

  // ==================== 系统指标 ====================
  async collectMetrics(serverId: string): Promise<SystemMetrics> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.metrics.collect(serverId);
  },

  async refreshMetricsCache(serverId: string): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.metrics.refreshCache(serverId);
  },

  // ==================== 服务管理 ====================
  async listServices(serverId: string): Promise<ServiceInfo[]> {
    if (!backend) return [];
    const result = await backend.services.list(serverId);
    return Array.isArray(result) ? result : [];
  },

  async startService(serverId: string, name: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.services.start(serverId, name);
  },

  async stopService(serverId: string, name: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.services.stop(serverId, name);
  },

  async restartService(serverId: string, name: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.services.restart(serverId, name);
  },

  async serviceStatus(serverId: string, name: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.services.status(serverId, name);
  },

  /** 设置开机自启（不等价于立即启动） */
  async serviceEnable(serverId: string, name: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.services.enable(serverId, name);
  },

  /** 取消开机自启（不等价于停止实例） */
  async serviceDisable(serverId: string, name: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.services.disable(serverId, name);
  },

  /** 服务详情（systemctl show 属性表） */
  async serviceInspect(serverId: string, name: string): Promise<ServiceProps> {
    if (!backend) return {};
    return backend.services.inspect(serverId, name);
  },

  /** 服务日志（journalctl -u <unit>） */
  async serviceLogs(serverId: string, name: string, query?: ServiceLogQuery): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.services.logs(serverId, name, query);
  },

  /** 服务能力探测（systemd / journalctl / sudo） */
  async serviceCapabilities(serverId: string): Promise<ServiceCapabilities> {
    if (!backend) {
      return { systemd: false, journal: false, systemRunning: false, sudoNoPass: false, sysv: false };
    }
    return backend.services.capabilities(serverId);
  },

  /** 启动服务日志实时跟随（journalctl -f），返回 sessionId */
  async serviceLogFollowStart(serverId: string, name: string, lines?: number): Promise<string> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.services.followStart(serverId, name, lines);
  },

  /** 停止服务日志实时跟随 */
  async serviceLogFollowStop(serverId: string, name: string): Promise<void> {
    if (!backend) return;
    await backend.services.followStop(serverId, name);
  },

  /** 服务依赖关系（P1） */
  async serviceDependencies(serverId: string, name: string): Promise<ServiceDependencies> {
    if (!backend) {
      return { requires: [], wants: [], requisite: [], bindsTo: [], partOf: [], conflicts: [], after: [], before: [], requiredBy: [], wantedBy: [] };
    }
    return backend.services.dependencies(serverId, name);
  },

  /** Unit 文件与 Drop-in 内容（P1） */
  async serviceUnitFile(serverId: string, name: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.services.unitFile(serverId, name);
  },

  /** 服务进程信息（P1） */
  async serviceProcess(serverId: string, name: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.services.process(serverId, name);
  },

  /** 服务监听端口（P1） */
  async servicePorts(serverId: string, name: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.services.ports(serverId, name);
  },

  /** 屏蔽服务（Mask） */
  async serviceMask(serverId: string, name: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.services.mask(serverId, name);
  },

  /** 解除屏蔽（Unmask） */
  async serviceUnmask(serverId: string, name: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.services.unmask(serverId, name);
  },

  /** 重载 systemd 配置 */
  async serviceDaemonReload(serverId: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.services.daemonReload(serverId);
  },

  /** 批量采集服务资源（内存 / Tasks / CPU 累计纳秒） */
  async serviceResources(serverId: string): Promise<ServiceResourceRawMap> {
    if (!backend) return {};
    return backend.services.resources(serverId);
  },

  // ==================== 进程管理 ====================
  async listProcesses(serverId: string): Promise<ProcessInfo[]> {
    if (!backend) return [];
    const result = await backend.processes.list(serverId);
    return Array.isArray(result) ? result : [];
  },

  async signalProcess(
    serverId: string,
    pid: number,
    signal: "term" | "kill",
    startTimeTicks: number,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.processes.signal(serverId, pid, signal, startTimeTicks);
  },

  // ==================== 端口管理 ====================
  async listPorts(serverId: string): Promise<PortInfo[]> {
    if (!backend) return [];
    const result = await backend.ports.list(serverId);
    return Array.isArray(result) ? result : [];
  },

  async killPortByPid(serverId: string, pid: number): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.ports.killByPid(serverId, pid);
  },

  // ==================== 网络诊断 ====================
  async dnsLookup(serverId: string, target: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.dns(serverId, target);
  },

  async ping(serverId: string, target: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.ping(serverId, target);
  },

  async tcpCheck(
    serverId: string,
    host: string,
    port: number,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.tcpCheck(serverId, host, port);
  },

  async httpCheck(serverId: string, url: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.httpCheck(serverId, url);
  },

  async getNetworkOverview(serverId: string): Promise<NetOverview> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.getOverview(serverId);
  },

  async getNetworkInterfaces(serverId: string): Promise<InterfaceInfo[]> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.getInterfaces(serverId);
  },

  async getNetworkRoutes(serverId: string): Promise<RouteView> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.getRoutes(serverId);
  },

  async getNetworkRouteGet(serverId: string, target: string): Promise<RouteGetResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.getRouteGet(serverId, target);
  },

  async getNetworkDnsConfig(serverId: string): Promise<DnsConfigInfo> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.getDnsConfig(serverId);
  },

  async getNetworkConnections(serverId: string, query?: ConnQuery): Promise<ConnPage> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.getConnections(serverId, query);
  },

  async getNetworkNeighbors(serverId: string): Promise<NeighborInfo[]> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.getNeighbors(serverId);
  },

  async getNetworkEthtool(serverId: string, iface: string): Promise<EthtoolInfo> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.getEthtool(serverId, iface);
  },

  async getNetworkCapabilities(serverId: string, refresh?: boolean): Promise<HostCapabilities> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.getCapabilities(serverId, refresh);
  },

  async runQuickCheck(
    serverId: string,
    target: string,
    port?: number,
    protocol?: string,
  ): Promise<NetworkRun> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.runQuickCheck(serverId, target, port, protocol);
  },

  async runTraceroute(
    serverId: string,
    target: string,
    mode?: string,
  ): Promise<string> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.runTraceroute(serverId, target, mode);
  },

  async runPing(
    serverId: string,
    target: string,
    count?: number,
  ): Promise<string> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.runPing(serverId, target, count);
  },

  async startNetworkCapture(
    serverId: string,
    req: CaptureReq,
  ): Promise<CaptureResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.startCapture(serverId, req);
  },

  async listNetworkRuns(serverId: string, limit?: number): Promise<NetworkRunSummary[]> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.listRuns(serverId, limit);
  },

  async getNetworkRun(runId: string): Promise<NetworkRun | null> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.getRun(runId);
  },

  async deleteNetworkRun(runId: string): Promise<void> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.deleteRun(runId);
  },

  async compareNetworkRuns(runIdA: string, runIdB: string): Promise<RunDiff> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.compareRuns(runIdA, runIdB);
  },

  async exportNetworkReport(runId: string, format: string): Promise<ExportResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.network.exportReport(runId, format);
  },

  // ==================== 日志 ====================
  async readLog(
    serverId: string,
    path: string,
    lines: number = 100,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.logs.read(serverId, path, lines);
  },

  async searchLog(
    serverId: string,
    path: string,
    keyword: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.logs.search(serverId, path, keyword);
  },

  /** Start a real-time tail -f stream. Returns a cleanup function to remove the listener. */
  startTail(
    serverId: string,
    path: string,
    callback: (data: string) => void,
  ): () => void {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const { cleanup } = backend.logs.tail(serverId, path, callback);
    return cleanup;
  },

  /** Stop a tail -f stream. */
  async stopTail(serverId: string, path: string): Promise<void> {
    if (!backend) return;
    await backend.logs.stopTail(serverId, path);
  },

  // ==================== 文件管理 ====================
  async listFiles(serverId: string, path: string): Promise<FileEntry[]> {
    if (!backend) return [];
    const result = await backend.files.list(serverId, path);
    if (Array.isArray(result)) return result;
    const errMsg =
      (result as CommandResult)?.stderr || "Failed to load file list";
    throw new Error(errMsg);
  },

  async readFile(serverId: string, path: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.read(serverId, path);
  },

  // 读取远程二进制文件为 base64 字符串（用于图片预览等二进制场景）
  async readBinaryFile(serverId: string, path: string): Promise<string> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.readBinary(serverId, path);
  },

  async writeFile(
    serverId: string,
    path: string,
    content: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.write(serverId, path, content);
  },

  async mkdir(serverId: string, path: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.mkdir(serverId, path);
  },

  async deleteFile(serverId: string, path: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.delete(serverId, path);
  },

  async renameFile(
    serverId: string,
    oldPath: string,
    newPath: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.rename(serverId, oldPath, newPath);
  },

  async getPermissions(serverId: string, path: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.getPermissions(serverId, path);
  },

  async setPermissions(
    serverId: string,
    path: string,
    mode: string,
    recursive?: boolean,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.setPermissions(serverId, path, mode, recursive);
  },

  async backupFile(serverId: string, path: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.backup(serverId, path);
  },

  async chownFile(
    serverId: string,
    path: string,
    owner: string,
    group: string,
    recursive: boolean,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.chown(serverId, path, owner, group, recursive);
  },

  async createSymlink(
    serverId: string,
    target: string,
    linkPath: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.createSymlink(serverId, target, linkPath);
  },

  async statInfo(serverId: string, path: string): Promise<FileStatInfo> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.statInfo(serverId, path);
  },

  async downloadFile(
    serverId: string,
    remotePath: string,
    localDest?: string,
  ): Promise<FileDownloadResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.download(serverId, remotePath, localDest);
  },

  async downloadArchive(
    serverId: string,
    remotePath: string,
    format: string = "tar.gz",
  ): Promise<FileDownloadResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.downloadArchive(serverId, remotePath, format);
  },

  async extractArchive(serverId: string | null, path: string, conflictAction?: "overwrite" | "keep") {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.extractArchive(serverId, path, conflictAction);
  },

  async installExtractionTool(serverId: string | null, path: string) {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.installExtractionTool(serverId, path);
  },

  async uploadFiles(
    serverId: string,
    remoteDir: string,
    uploadType: "file" | "dir" | "auto" = "file",
  ): Promise<FileUploadResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.upload(serverId, remoteDir, uploadType);
  },

  async uploadFromPaths(
    serverId: string,
    remoteDir: string,
    localPaths: string[],
    targetFileName?: string,
  ): Promise<FileUploadResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.uploadFromPaths(
      serverId,
      remoteDir,
      localPaths,
      targetFileName,
    );
  },

  async getLocalUploadStats(paths: string[]) {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.getLocalUploadStats(paths);
  },

  /**
   * 服务器到服务器传输（两侧都是远程 SFTP，后端直接走 SFTP 对拷，不落本地磁盘）
   */
  async serverToServerTransfer(
    srcServerId: string,
    srcPath: string,
    destServerId: string,
    destPath: string,
    targetName?: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.serverToServerTransfer(
      srcServerId,
      srcPath,
      destServerId,
      destPath,
      targetName,
    );
  },

  /** 注册全局活跃传输任务（供应用关闭拦截及退出统一清理使用） */
  registerActiveTransfer(record: ActiveTransferRecord): void {
    activeTransfers.set(record.transferId, { ...record });
  },

  /** 更新活跃传输任务信息（如收到 tmpPath 时补充路径） */
  updateActiveTransfer(
    transferId: string,
    partial: Partial<ActiveTransferRecord>,
  ): void {
    const existing = activeTransfers.get(transferId);
    if (existing) {
      Object.assign(existing, partial);
    }
  },

  /** 注销活跃传输任务（传输结束：完成/失败/取消） */
  unregisterActiveTransfer(transferId: string): void {
    activeTransfers.delete(transferId);
  },

  /** 是否有活跃传输正在进行中 */
  hasActiveTransfers(): boolean {
    return activeTransfers.size > 0;
  },

  /** 获取当前所有活跃传输列表 */
  getActiveTransfers(): ActiveTransferRecord[] {
    return Array.from(activeTransfers.values());
  },

  /**
   * 是否正处于退出清理状态
   */
  isExiting(): boolean {
    return isExiting;
  },

  /**
   * 设置应用退出状态
   */
  setExiting(val: boolean): void {
    isExiting = val;
  },

  /**
   * 取消所有活跃传输任务并清理临时文件（应用退出确认时调用）
   * - 优先调用后端 cancelAllTransfers 原子取消所有任务，各任务在自身已有 SFTP 会话中执行自清理
   * - 对于已暂停/非活跃的遗留临时文件，按 serverId 分组且每台服务器限制并发数 <= 2 进行兜底清理，避免耗尽 MaxSessions
   */
  async cancelAndCleanupAllTransfers(): Promise<void> {
    isExiting = true;
    const records = Array.from(activeTransfers.values());
    activeTransfers.clear();

    // 1. 优先调用后端原子全局取消命令（广播取消所有任务，并在 Rust 端等待现有会话完成临时文件删除）
    try {
      if (backend?.files?.cancelAllTransfers) {
        await withTransferCancelTimeout(
          backend.files.cancelAllTransfers(),
          'Cancel all transfers',
        );
      } else if (backend) {
        const filesApi = backend.files;
        await withTransferCancelTimeout(
          Promise.allSettled(records.map(r => filesApi.cancelTransfer(r.transferId))).then(() => undefined),
          'Cancel all transfers',
        );
      }
    } catch (err) {
      console.error('[sshService] cancelAllTransfers failed, fallback to per-transfer cancel:', err);
      if (backend) {
        const filesApi = backend.files;
        await withTransferCancelTimeout(
          Promise.allSettled(records.map(r => filesApi.cancelTransfer(r.transferId))).then(() => undefined),
          'Cancel all transfers fallback',
        ).catch(fallbackErr => {
          console.error('[sshService] cancel fallback timed out:', fallbackErr);
        });
      }
    }

    // 2. 对于已处于暂停或非活跃状态、且存在 tmpPath 的遗留文件进行受控兜底清理
    // 按 serverId 分组，每台服务器最多 2 个并发清理，杜绝冲击 SSH MaxSessions 限制
    const pausedWithTmp = records.filter(r => !!r.tmpPath && !!r.serverId);
    if (pausedWithTmp.length > 0 && backend?.files?.cleanupTmpFile) {
      const cleanupTmpFile = backend.files.cleanupTmpFile;
      const byServer = new Map<string, ActiveTransferRecord[]>();
      for (const rec of pausedWithTmp) {
        const list = byServer.get(rec.serverId) || [];
        list.push(rec);
        byServer.set(rec.serverId, list);
      }

      await Promise.allSettled(
        Array.from(byServer.entries()).map(async ([sid, items]) => {
          const limit = 2;
          let idx = 0;
          const worker = async () => {
            while (idx < items.length) {
              const item = items[idx++];
              if (!item?.tmpPath) continue;
              try {
                await cleanupTmpFile(sid, item.tmpPath, item.isUpload);
              } catch (e) {
                console.warn('[sshService] cleanup tmp file failed:', item.tmpPath, e);
              }
            }
          };
          await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
        }),
      );
    }
  },

  /**
   * 取消传输任务
   * @param transferId 传输 ID（来自 TransferProgressData.transferId）
   * @returns true 表示找到并已取消；false 表示传输不存在或已结束
   */
  async cancelTransfer(transferId: string): Promise<boolean> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    activeTransfers.delete(transferId);
    return withTransferCancelTimeout(
      backend.files.cancelTransfer(transferId),
      `Cancel transfer ${transferId}`,
    );
  },

  /**
   * 断点续传上传：从 offset 字节处继续上传
   * @param transferId 复用原传输记录的 ID（前端保持同一记录）
   */
  async resumeUpload(
    serverId: string,
    localPath: string,
    remotePath: string,
    tmpRemotePath: string,
    offset: number,
    transferId: string,
    expectedSourceSize?: number,
  ): Promise<FileUploadResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.resumeUpload(
      serverId,
      localPath,
      remotePath,
      tmpRemotePath,
      offset,
      transferId,
      expectedSourceSize,
    );
  },

  /**
   * 断点续传下载：从 offset 字节处继续下载
   */
  async resumeDownload(
    serverId: string,
    remotePath: string,
    localPath: string,
    tmpLocalPath: string,
    offset: number,
    transferId: string,
  ): Promise<FileDownloadResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.resumeDownload(
      serverId,
      remotePath,
      localPath,
      tmpLocalPath,
      offset,
      transferId,
    );
  },

  /**
   * 清理断点续传残留的临时文件
   * @param isRemote true=远程临时文件，false=本地临时文件
   */
  async cleanupTmpFile(
    serverId: string,
    tmpPath: string,
    isRemote: boolean,
  ): Promise<boolean> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.cleanupTmpFile(serverId, tmpPath, isRemote);
  },

  /**
   * 设置全局传输限速（KB/s）
   * @param kbps 0=不限速；>0 限速值。设置后立即对所有正在/后续进行的传输生效。
   */
  async setTransferRateLimit(kbps: number): Promise<void> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.setTransferRateLimit(kbps);
  },

  /**
   * 设置 SFTP 传输排除与忽略规则
   */
  async setExclusionConfig(
    enabled: boolean,
    patterns: string[],
    respectGitignore: boolean,
  ): Promise<void> {
    if (!backend) return;
    return backend.files.setExclusionConfig(enabled, patterns, respectGitignore);
  },

  /**
   * 递归搜索远程文件
   * @param dir 搜索起始目录
   * @param pattern 文件名匹配关键词（glob *pattern*）
   * @param maxResults 最大结果数（默认 500）
   * @returns 匹配的文件完整路径数组
   */
  async searchFilesRecursive(
    serverId: string,
    dir: string,
    pattern: string,
    maxResults?: number,
  ): Promise<string[]> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.files.searchFilesRecursive(
      serverId,
      dir,
      pattern,
      maxResults,
    );
  },

  onTransferProgress(
    callback: (data: TransferProgressData) => void,
  ): (() => void) | null {
    if (!backend) return null;
    return backend.files.onTransferProgress((data) => {
      // 自动维护全局活跃传输表：当收到 tmpPath 时更新，完成或失败时移除
      if (data.done === true || data.done === false) {
        activeTransfers.delete(data.transferId);
      } else if (data.tmpPath && activeTransfers.has(data.transferId)) {
        const existing = activeTransfers.get(data.transferId);
        if (existing && !existing.tmpPath) {
          existing.tmpPath = data.tmpPath;
        }
      }
      callback(data);
    });
  },

  // ==================== Docker ====================
  async dockerPs(serverId: string): Promise<DockerContainer[]> {
    if (!backend) return [];
    const result = await backend.docker.ps(serverId);
    return Array.isArray(result) ? result : [];
  },

  async dockerImages(serverId: string): Promise<DockerImage[]> {
    if (!backend) return [];
    const result = await backend.docker.images(serverId);
    return Array.isArray(result) ? result : [];
  },

  async dockerStart(
    serverId: string,
    containerId: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.start(serverId, containerId);
  },

  async dockerStop(
    serverId: string,
    containerId: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.stop(serverId, containerId);
  },

  async dockerRestart(
    serverId: string,
    containerId: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.restart(serverId, containerId);
  },

  async dockerLogs(
    serverId: string,
    containerId: string,
    lines: number = 1000,
    since?: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.logs(serverId, containerId, lines, since);
  },

  async dockerStats(
    serverId: string,
    containerId: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.stats(serverId, containerId);
  },

  async dockerInspect(
    serverId: string,
    containerId: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.inspect(serverId, containerId);
  },

  async dockerComposePs(serverId: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.composePs(serverId);
  },

  // 注册表 ∪ 实时合并列表：返回 JSON 字符串（ComposeProjectEntry 数组）。
  // 已停止/移除的注册项目以 exists=false / status='' 返回，前端显示"未运行"。
  async dockerComposeList(serverId: string): Promise<string> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.composeList(serverId);
  },

  async dockerRmi(serverId: string, imageId: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.rmi(serverId, imageId);
  },

  async dockerImagePrune(serverId: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.imagePrune(serverId);
  },

  async dockerRm(
    serverId: string,
    containerId: string,
    force: boolean,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.rm(serverId, containerId, force);
  },

  async dockerComposeUp(
    serverId: string,
    projectDir: string,
    configFiles?: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.composeUp(serverId, projectDir, configFiles);
  },

  async dockerComposeDown(
    serverId: string,
    projectDir: string,
    configFiles?: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.composeDown(serverId, projectDir, configFiles);
  },

  async dockerComposeLogs(
    serverId: string,
    projectName: string,
    lines: number,
    projectDir?: string,
    configFiles?: string,
    service?: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.composeLogs(
      serverId,
      projectName,
      lines,
      projectDir,
      configFiles,
      service,
    );
  },

  async dockerComposeServices(
    serverId: string,
    projectDir?: string,
    configFiles?: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.composeServices(serverId, projectDir, configFiles);
  },

  async dockerNetworkLs(serverId: string): Promise<DockerNetwork[]> {
    if (!backend) return [];
    return backend.docker.networkLs(serverId);
  },

  async dockerNetworkRm(serverId: string, name: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.networkRm(serverId, name);
  },

  async dockerNetworkPrune(serverId: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.networkPrune(serverId);
  },

  async dockerNetworkInspect(serverId: string, networkId: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.networkInspect(serverId, networkId);
  },

  async dockerNetworkCreate(
    serverId: string,
    name: string,
    driver: string,
    subnet?: string | null,
    gateway?: string | null,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.networkCreate(serverId, name, driver, subnet ?? null, gateway ?? null);
  },

  async dockerNetworkConnect(serverId: string, networkId: string, containerId: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.networkConnect(serverId, networkId, containerId);
  },

  async dockerNetworkDisconnect(serverId: string, networkId: string, containerId: string, force: boolean): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.networkDisconnect(serverId, networkId, containerId, force);
  },

  async dockerVolumeLs(serverId: string): Promise<DockerVolume[]> {
    if (!backend) return [];
    return backend.docker.volumeLs(serverId);
  },

  async dockerVolumeRm(
    serverId: string,
    name: string,
    force: boolean,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.volumeRm(serverId, name, force);
  },

  async dockerVolumePrune(serverId: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.volumePrune(serverId);
  },

  async dockerVolumeBrowse(serverId: string, volumeName: string, subPath?: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.volumeBrowse(serverId, volumeName, subPath ?? null);
  },

  async dockerPull(serverId: string, image: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.pull(serverId, image);
  },

  async dockerInfo(serverId: string): Promise<DockerOverview> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.info(serverId);
  },

  async dockerPause(serverId: string, containerId: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.pause(serverId, containerId);
  },

  async dockerUnpause(serverId: string, containerId: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.unpause(serverId, containerId);
  },

  async dockerComposeAction(
    serverId: string,
    action: "restart" | "stop" | "start" | "pull" | "build",
    projectDir: string,
    configFiles?: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.composeAction(serverId, action, projectDir, configFiles);
  },

  async dockerRun(serverId: string, params: DockerRunParams): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.run(serverId, params);
  },

  async dockerImageInspect(serverId: string, imageId: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.imageInspect(serverId, imageId);
  },

  async dockerImageSave(serverId: string, imageRef: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.imageSave(serverId, imageRef);
  },

  async dockerImageLoad(serverId: string, remotePath: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.imageLoad(serverId, remotePath);
  },

  async dockerImageSaveStream(serverId: string, imageRefs: string[], localPath: string, estimatedBytes: number): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.imageSaveStream(serverId, imageRefs, localPath, estimatedBytes);
  },

  async dockerImageLoadStream(serverId: string, localPath: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.imageLoadStream(serverId, localPath);
  },

  async dockerImageTransferCancel(serverId: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.imageTransferCancel(serverId);
  },

  async dockerComposeValidate(
    serverId: string,
    projectDir: string,
    configFiles?: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.composeValidate(serverId, projectDir, configFiles);
  },

  async dockerComposeCreate(
    serverId: string,
    projectDir: string,
    yamlB64: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.composeCreate(serverId, projectDir, yamlB64);
  },

  async dockerComposeActionStream(
    serverId: string,
    action: string,
    projectDir: string,
    configFiles: string | undefined,
    requestId: string,
  ): Promise<null> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.composeActionStream(serverId, action, projectDir, configFiles, requestId);
  },

  /** 导入扫描：检查目录是否含 compose 文件并校验配置（返回 ComposeImportPreview[] JSON） */
  async dockerComposeImportScan(serverId: string, dirs: string[]): Promise<unknown[]> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.composeImportScan(serverId, dirs);
  },

  onComposeOutput(callback: (e: ComposeStreamEvent) => void): Promise<() => void> {
    if (!backend) return Promise.resolve(() => {});
    return backend.docker.onComposeOutput(callback);
  },

  /** 列出容器内目录内容（docker exec ls -la） */
  async dockerContainerFileList(
    serverId: string,
    containerId: string,
    path: string,
  ): Promise<DockerFileEntry[]> {
    if (!backend) return [];
    return backend.docker.containerFileList(serverId, containerId, path);
  },

  /** 容器文件下载准备：docker cp 到远端临时目录 → 返回临时路径供 downloadFile 下载 */
  async dockerCpFromContainer(
    serverId: string,
    containerId: string,
    srcPath: string,
  ): Promise<DockerCpResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.cpFromContainer(serverId, containerId, srcPath);
  },

  /**
   * 复制宿主机文件/目录进容器（docker cp）。
   * - 本地上传流程：hostPath 为 /tmp/swk-docker-cp 临时路径，deleteSource=true（复制后删临时文件）
   * - 宿主机复制流程：hostPath 为宿主机任意绝对路径，deleteSource=false（保留源文件）
   */
  async dockerCpToContainer(
    serverId: string,
    containerId: string,
    hostPath: string,
    destDir: string,
    deleteSource = false,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.cpToContainer(serverId, containerId, hostPath, destDir, deleteSource);
  },

  /** 删除容器内文件/目录（docker exec rm -rf，后端拒绝根目录删除） */
  async dockerContainerFileDelete(
    serverId: string,
    containerId: string,
    path: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.containerFileDelete(serverId, containerId, path);
  },

  /** 清理 docker cp 临时目录 */
  async dockerCpCleanup(serverId: string, path: string): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.cpCleanup(serverId, path);
  },

  /** 容器日志实时跟随（fire-and-forget）：输出经 onComposeOutput 事件到达，
   * requestId 用 `logs-` 前缀区分；单次连接有界，done 后由调用方决定是否续流 */
  async dockerLogsStream(
    serverId: string,
    containerId: string,
    tail: number,
    since?: string,
    requestId: string = `logs-${Date.now()}`,
  ): Promise<null> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.logsStream(serverId, containerId, tail, since, requestId);
  },

  async dockerLogin(
    serverId: string,
    registry: string | undefined,
    username: string,
    password: string,
  ): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.login(serverId, registry, username, password);
  },

  async dockerSystemDf(serverId: string): Promise<SystemDfRow[]> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.systemDf(serverId);
  },

  async dockerSystemPrune(serverId: string, includeImages: boolean): Promise<CommandResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.docker.systemPrune(serverId, includeImages);
  },

  // ==================== 快照 ====================
  async generateSnapshot(serverId: string): Promise<Record<string, unknown>> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.snapshot.generate(serverId);
  },

  // ==================== 收藏指令 ====================
  async listFavCmds(): Promise<
    { id: string; cmd: string; desc: string; createdAt: number }[]
  > {
    if (!backend) return [];
    return backend.favCmds.list();
  },
  async addFavCmd(cmd: string, desc: string): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.favCmds.add(cmd, desc);
    if (res.success) notifyDataMutated('addFavCmd');
    return res;
  },
  async updateFavCmd(
    id: string,
    cmd: string,
    desc: string,
  ): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.favCmds.update(id, cmd, desc);
    if (res.success) notifyDataMutated('updateFavCmd');
    return res;
  },
  async deleteFavCmd(id: string): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const res = await backend.favCmds.delete(id);
    if (res.success) notifyDataMutated('deleteFavCmd');
    return res;
  },

  async restoreFavCmds(cmds: import("./api/types").FavoriteCommand[]): Promise<OperationResult> {
    if (!backend?.favCmds.restore) return { success: false, error: NOT_AVAILABLE };
    return backend.favCmds.restore(cmds);
  },

  async listBookmarksAll(): Promise<import("@/types").LogBookmark[]> {
    if (!backend?.bookmarks?.listAll) return [];
    return backend.bookmarks.listAll();
  },

  async restoreBookmarks(items: import("@/types").LogBookmark[]): Promise<OperationResult> {
    if (!backend?.bookmarks?.restore) return { success: false, error: NOT_AVAILABLE };
    return backend.bookmarks.restore(items);
  },

  async listBackgroundsForSync(): Promise<import("./api/types").SyncBackgroundItem[]> {
    if (!backend?.backgrounds?.listForSync) return [];
    return backend.backgrounds.listForSync();
  },

  async restoreBackgrounds(items: import("./api/types").SyncBackgroundItem[]): Promise<number> {
    if (!backend?.backgrounds?.restore) return 0;
    return backend.backgrounds.restore(items);
  },

  // ==================== SSH 密钥管理（对齐 Termius/MobaXterm/SecureCRT） ====================
  /**
   * 在应用内生成 SSH 密钥对并保存为 OpenSSH 格式文件
   *
   * 支持 Ed25519 / RSA / ECDSA-P256 / ECDSA-P384 算法，
   * 输出 OpenSSH 格式私钥 + .pub 公钥文件。
   */
  async generateKey(req: GenerateKeyRequest): Promise<GenerateKeyResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.ssh.keys.generate(req);
  },

  /**
   * 检测系统 SSH Agent 是否可用
   * - Unix: 检查 SSH_AUTH_SOCK 环境变量
   * - Windows: 检查 \\.\pipe\pageant 命名管道（Pageant / MobaXterm Agent）
   */
  async testSshAgent(): Promise<SshAgentStatus> {
    if (!backend) return { available: false, platform: "unknown" };
    return backend.ssh.keys.testAgent();
  },

  /**
   * 列出 SSH Agent 中已加载的所有身份
   * 返回 IdentityInfo[]，每项包含算法名、公钥 base64、SHA256 指纹。
   */
  async listAgentIdentities(): Promise<SshAgentIdentity[]> {
    if (!backend) return [];
    return backend.ssh.keys.listAgentIdentities();
  },

  // ==================== 串口 Serial / COM 协议（Xshell 级功能） ====================
  /** 枚举系统中所有可用的物理与 USB 虚拟串口 */
  async listSerialPorts(): Promise<SerialPortInfo[]> {
    if (!backend) return [];
    return backend.serial.listPorts();
  },

  /** 测试串口连接硬件可用性与电气信号 */
  async testSerialPort(
    portName: string,
    baudRate?: number,
    dataBits?: number,
    stopBits?: number,
    parity?: string,
    flowControl?: string,
  ) {
    if (!backend) return { success: false, error: NOT_AVAILABLE };
    return backend.serial.testPort(portName, baudRate, dataBits, stopBits, parity, flowControl);
  },

  /** 创建串口 Shell 终端会话 */
  async createSerialShell(
    serverId: string,
    portName: string,
    baudRate?: number,
    dataBits?: number,
    stopBits?: number,
    parity?: string,
    flowControl?: string,
    dtr?: boolean,
    rts?: boolean,
    encoding?: string,
    deviceVid?: number,
    devicePid?: number,
    deviceSerialNumber?: string,
  ): Promise<CreateShellResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    const result = await backend.serial.createShell(
      serverId,
      portName,
      baudRate,
      dataBits,
      stopBits,
      parity,
      flowControl,
      dtr,
      rts,
      encoding,
      deviceVid,
      devicePid,
      deviceSerialNumber,
    );
    if (result.sessionId) aliveSessions.add(result.sessionId);
    return result;
  },

  /** 发送 Break 打断信号 */
  async setSerialBreak(sessionId: string, durationMs?: number): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.serial.setBreak(sessionId, durationMs);
  },

  /** 控制 DTR 电平 */
  async setSerialDtr(sessionId: string, level: boolean): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.serial.setDtr(sessionId, level);
  },

  /** 控制 RTS 电平 */
  async setSerialRts(sessionId: string, level: boolean): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.serial.setRts(sessionId, level);
  },

  /** 读取 CTS, DSR, RI, CD 信号线状态 */
  async getSerialSignals(sessionId: string): Promise<SerialSignals> {
    if (!backend) return { cts: false, dsr: false, ri: false, cd: false };
    return backend.serial.getSignals(sessionId);
  },

  /** 获取串口原始历史字节（Base64） */
  async getSerialHistoryRaw(sessionId: string): Promise<string> {
    if (!backend) return "";
    return backend.serial.getHistoryRaw(sessionId);
  },

  async getSerialStats(sessionId: string): Promise<SerialStats> {
    if (!backend) return { rxBytes: 0, txBytes: 0 };
    return backend.serial.getStats(sessionId);
  },

  async encodeSerialText(text: string, encoding: string): Promise<string> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.serial.encodeText(text, encoding);
  },

  async decodeSerialHex(hex: string, encoding: string): Promise<string> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.serial.decodeHex(hex, encoding);
  },

  /** 向串口发送 HEX 16进制字符串 (如 "AA 55 01 02") */
  async writeSerialHex(sessionId: string, hexString: string): Promise<OperationResult> {
    const trimmed = hexString.trim();
    if (!/^(?:[0-9a-fA-F]{2})(?:[\s,;:-]+[0-9a-fA-F]{2})*$/.test(trimmed)) {
      return { success: false, error: 'HEX 格式无效，请按 AA 55 01 02 的格式输入完整字节' };
    }
    const cleanHex = trimmed.replace(/[\s,;:-]+/g, '');
    if (cleanHex.length === 0) {
      return { success: false, error: 'HEX 字符串为空' };
    }
    if (cleanHex.length % 2 !== 0) {
      return { success: false, error: 'HEX 字符串必须为偶数个十六进制字符' };
    }
    const bytes: number[] = [];
    for (let i = 0; i < cleanHex.length; i += 2) {
      bytes.push(parseInt(cleanHex.substring(i, i + 2), 16));
    }
    try {
      return await this.writeSerialRaw(sessionId, bytes);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  /** 向串口发送原始字节数组 */
  async writeSerialRaw(sessionId: string, bytes: number[]): Promise<OperationResult> {
    try {
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
      }
      await this.shellZmodemWrite(sessionId, btoa(binary));
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  // ==================== 串口 IAP 固件升级 ====================

  /** 解析本地固件（.bin 或 .hex），获取大小、CRC32、SHA256、HEX 基地址 */
  async parseFirmware(filePath: string): Promise<import('./api/types').FirmwareInfo> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.serial.parseFirmware(filePath);
  },

  /** 启动串口 IAP 固件升级 */
  async startSerialIap(config: import('./api/types').SerialIapConfig): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.serial.startIap(config);
  },

  /** 中止当前串口 IAP 固件升级 */
  async cancelSerialIap(sessionId: string): Promise<OperationResult> {
    if (!backend) throw new Error(NOT_AVAILABLE);
    return backend.serial.cancelIap(sessionId);
  },

  /** 监听串口 IAP 固件升级进度 */
  onSerialIapProgress(
    callback: (data: import('./api/types').SerialIapProgress) => void,
  ): () => void {
    return backend?.serial.onIapProgress?.(callback) ?? (() => {});
  },
};

export default sshService;
