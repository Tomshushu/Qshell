/**
 * 统一 API 层类型定义
 *
 * 这些类型与具体后端实现无关，
 * 仅描述前后端之间传输的数据结构。
 * 所有 adapter 实现都必须遵循这些类型。
 */

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
  ServiceLogQuery,
  ServiceDependencies,
  ServiceResourceRawMap,
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
  LogBookmark,
} from "@/types";
export type { FileEntry, ServiceResourceRawMap, LogBookmark };

export interface TagRow {
  id: string;
  name: string;
  createdAt: number;
}

export interface SyncBackgroundItem {
  name: string;
  mediaType: "image" | "video";
  dataBase64: string;
}
import type {
  ConnectionState,
  SshErrorKind,
  SshStateResult,
  ConnectionStateData,
} from "@/services/ssh-connection-state";

// ==================== 通用结果类型 ====================

/** 命令执行结果 */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** 通用操作结果 */
export interface OperationResult {
  success: boolean;
  error?: string;
  message?: string;
  /** 新建记录时由后端生成的 id */
  id?: string;
  osType?: string;
  osInfo?: string;
}

/** 服务器导入结果（批量操作） */
export interface ImportResult {
  /** 导入流程是否完成（false 表示密码错误/文件格式错误等致命错误） */
  success: boolean;
  /** 文件中包含的服务器总数 */
  total: number;
  /** 成功导入的服务器数量 */
  imported: number;
  /** 跳过（失败）的服务器数量 */
  skipped: number;
  /** 每条失败记录的错误信息 */
  errors?: string[];
  /** 致命错误信息（success=false 时） */
  error?: string;
  /** 成功导入的服务器新 id 列表 */
  importedIds?: string[];
}

export type ExternalImportSource = "openssh" | "putty_file" | "putty_registry" | "xshell" | "finalshell" | "securecrt";

export interface ExternalImportCandidate {
  sourceId: string;
  source: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: "password" | "privateKey";
  privateKeyPath?: string;
  tags: string[];
  notes?: string;
  connectionTimeout: number;
  targetType: string;
  protocol: string;
  protocols: string[];
  proxyConfig?: string;
  tunnelsConfig?: string;
  serialConfig?: string;
  warnings: string[];
  duplicate: boolean;
}

export interface ExternalImportPreview {
  source: ExternalImportSource;
  candidates: ExternalImportCandidate[];
  warnings: string[];
}

/** SSH 连接结果 */
export interface ConnectResult extends OperationResult {
  message?: string;
}

/** 检测 OS 信息结果 */
export interface DetectOsResult extends OperationResult {
  osType?: string;
  osInfo?: string;
  status?: string;
}

/** Shell 创建结果 */
export interface CreateShellResult extends OperationResult {
  sessionId?: string;
}

/** 测试连接结果 */
export interface TestConnectionResult {
  online: boolean;
}

/** 测试连接（带配置）结果 */
export interface TestConnectWithConfigResult extends OperationResult {
  message?: string;
}

/** 文件下载结果 */
export interface FileDownloadResult extends OperationResult {
  localPath?: string;
}

/** 文件上传结果 */
export interface FileUploadResult extends OperationResult {
  results?: { fileName: string; success: boolean; error?: string }[];
}

/** 文件详细属性信息 */
export interface FileStatInfo {
  type: string;
  size: number;
  mode: string;
  owner: string;
  group: string;
  modifiedTime: string;
  accessTime: string;
  inode: number;
  links: number;
  isSymlink: boolean;
  symlinkTarget?: string;
}

// ==================== 批量命令执行（P0-4） ====================

/** 单台服务器的批量执行结果 */
export interface BatchExecuteItem {
  serverId: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  /** 连接或执行错误（success=false 时填充） */
  error?: string;
}

/** 批量执行聚合结果 */
export interface BatchExecuteResult {
  total: number;
  succeeded: number;
  failed: number;
  items: BatchExecuteItem[];
}

/** 批量执行进度事件 payload（ssh:batch-progress 事件） */
export interface BatchExecuteProgress {
  serverId: string;
  item: BatchExecuteItem;
  total: number;
}

// ==================== 端口转发（P0-2） ====================

/** 转发类型：本地 / 远程 / 动态 SOCKS5 */
export type ForwardKind = "local" | "remote" | "dynamic";

/** 转发状态 */
export type ForwardState =
  "starting" | "active" | "stopping" | "failed" | "stopped";

/** 转发规格（前端 -> 后端） */
export interface ForwardSpec {
  serverId: string;
  kind: ForwardKind;
  /** 本地地址（Local/Dynamic: 监听地址；Remote: 转发目标地址） */
  localHost: string;
  /** 本地端口（Local/Dynamic: 监听端口 0=OS 分配；Remote: 转发目标端口） */
  localPort: number;
  /** 远程地址（Local: direct-tcpip 目标；Remote: 服务端监听绑定地址；Dynamic: 不需要） */
  remoteHost?: string;
  /** 远程端口（Local: direct-tcpip 目标端口；Remote: 服务端监听绑定端口 0=OS 分配；Dynamic: 不需要） */
  remotePort?: number;
  /** 来源标识（如 "tunnel:{隧道名}"）：该转发由哪条隧道自动启动；缺省表示手动添加 */
  source?: string;
}

/** 对外暴露的转发信息 */
export interface ForwardInfo {
  id: string;
  serverId: string;
  kind: ForwardKind;
  localHost: string;
  localPort: number;
  /** 实际绑定端口（与 localPort 可能不同，当 localPort=0 时由 OS 分配） */
  boundPort: number;
  remoteHost?: string;
  remotePort?: number;
  state: ForwardState;
  createdAt: number;
  lastError?: string;
  /** 来源标识（如 "tunnel:{隧道名}"）：该转发由哪条隧道自动启动；缺省表示手动添加 */
  source?: string;
}

// ==================== BMC 带外管理（Redfish） ====================

/** BMC 概览：系统信息 + 电源状态 + BMC 管理器信息 */
export interface BmcOverview {
  success: boolean;
  error?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  partNumber?: string;
  assetTag?: string;
  biosVersion?: string;
  hostName?: string;
  /** On / Off / PoweringOn / PoweringOff / Unknown */
  powerState?: string;
  /** OK / Warning / Critical */
  healthStatus?: string;
  cpuModel?: string;
  cpuCount?: number;
  totalMemoryGb?: number;
  /** Lit / Off / Blinking / Unknown（定位指示灯） */
  indicatorLed?: string;
  /** 下次开机启动引导项：BiosSetup / Pxe / Cd / Hdd / UefiTarget / None / Unknown */
  bootSourceTarget?: string;
  /** 启动项生效模式：Once / Continuous / Disabled */
  bootSourceEnabled?: string;
  bmcModel?: string;
  bmcFirmware?: string;
  bmcIp?: string;
  bmcMac?: string;
  /** BMC Web 管理界面（KVM 控制台）地址 */
  webUrl?: string;
}

/** BMC 一次性开机引导项目标 */
export type BmcBootTarget = 'None' | 'BiosSetup' | 'Pxe' | 'Cd' | 'Hdd' | 'UefiTarget' | 'Diags';

/** BMC 传感器读数 */
export interface BmcSensor {
  name: string;
  reading: number;
  /** °C / RPM / % / W / V / A */
  unit: string;
  /** ok / warning / critical / absent / unknown */
  status: string;
  lowerThreshold?: number;
  upperThreshold?: number;
  minReading?: number;
  maxReading?: number;
}

/** BMC 电源模块（PSU）信息 */
export interface BmcPsu {
  name: string;
  status: string;
  model?: string;
  serial?: string;
  partNumber?: string;
  powerWatts?: number;
  lineVoltage?: number;
  capacityWatts?: number;
}

/** BMC 传感器聚合结果 */
export interface BmcSensorResult {
  success: boolean;
  error?: string;
  temperatures: BmcSensor[];
  fans: BmcSensor[];
  voltages: BmcSensor[];
  powerSupplies: BmcPsu[];
  /** 当前整机功耗（W） */
  totalPowerWatts?: number;
}

/** BMC 硬件事件日志（SEL）条目 */
export interface BmcSelEntry {
  id: string;
  /** ISO 8601 时间字符串 */
  created: string;
  /** Critical / Warning / OK / Info */
  severity: string;
  message: string;
}

/** BMC 事件日志查询结果 */
export interface BmcLogResult {
  success: boolean;
  error?: string;
  entries: BmcSelEntry[];
}

/** BMC 电源操作类型 */
export type BmcPowerAction =
  | "on"
  | "forceOff"
  | "gracefulShutdown"
  | "forceRestart"
  | "gracefulRestart"
  | "powerCycle"
  | "nmi";

// ==================== 业务实体类型 ====================

/** Docker 镜像信息 */
export interface DockerImage {
  repository: string;
  tag: string;
  id: string;
  createdSince: string;
  size: string;
  /** 镜像体积（字节），用于离线导出超时估算 */
  sizeBytes?: number;
  /** 是否被容器引用（任意状态） */
  inUse: boolean;
  /** 是否被运行中的容器引用 */
  usedByRunning: boolean;
  /** 是否悬空镜像（dangling：repository 或 tag 为 <none>） */
  dangling: boolean;
}

/** Docker 网络信息 */
export interface DockerNetwork {
  name: string;
  driver: string;
  scope: string;
}

/** Docker 卷信息 */
export interface DockerVolume {
  name: string;
  driver: string;
  /** 是否悬空（未被任何容器引用） */
  dangling: boolean;
}

/** Docker 总览数据（Overview 首页） */
export interface DockerOverview {
  serverVersion: string;
  os: string;
  ostype: string;
  containersTotal: number;
  containersRunning: number;
  containersPaused: number;
  containersStopped: number;
  images: number;
  volumes: number;
  networks: number;
}

/** Run Container 参数（MVP basic 配置） */
export interface DockerRunParams {
  name: string;
  image: string;
  /** 每行一条端口映射：host:container[/tcp|udp] */
  ports?: string;
  /** 每行一条卷挂载：src:dst[:ro|rw] */
  volumes?: string;
  /** 每行一条环境变量：KEY=value */
  env?: string;
  /** 重启策略：no | always | unless-stopped | on-failure[:N] */
  restart?: string;
  /** 加入的网络名（可选） */
  network?: string;
}

/** Compose 部署输出流事件（docker:compose-output） */
export interface ComposeStreamEvent {
  requestId: string;
  /** 增量输出片段（UTF-8 完整边界） */
  chunk: string;
  done: boolean;
  exitCode?: number | null;
  error?: string | null;
}

/** 容器文件条目（docker exec ls -la 解析） */
export interface DockerFileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
  permissions: string;
}

/** docker cp 准备结果：远端临时路径 + 临时目录（下载后需 cleanup） */
export interface DockerCpResult {
  hostPath: string;
  tmpDir: string;
}

/** System DF 磁盘占用分析行 */
export interface SystemDfRow {
  dfType: string;
  total: string;
  active: string;
  size: string;
  reclaimable: string;
}

/** 传输进度数据 */
export interface TransferProgressData {
  transferId: string;
  type: string;
  current: number;
  total: number;
  fileName: string;
  done?: boolean;
  /** total 字段语义；manifest 表示目录预扫描得到的一个子文件清单项。 */
  totalType?: "bytes" | "count" | "manifest";
  /** 临时文件路径（仅首个进度事件携带，用于断点续传）
   * 上传=远程临时文件路径；下载=本地临时文件路径 */
  tmpPath?: string;
  /** 失败原因（仅 done=false 的失败结束事件携带，前端用于将传输记录置为失败） */
  error?: string;
  /** 阶段标识：
   * - 'packing'/'packed'：归档下载打包阶段
   * - 'tmpLost'：续传时临时文件丢失，已降级为全新传输（前端应重置进度并提示用户）
   */
  phase?: "packing" | "packed" | "downloading" | "tmpLost";
}

export interface LocalUploadStats {
  totalFiles: number;
  totalBytes: number;
  hasDirectories: boolean;
}

/** Shell 输出数据 */
export interface ShellOutputData {
  sessionId: string;
  data: string;
  /** SSH Shell 的单调输出序号；用于 Ctrl+C 丢弃 IPC 队列中的旧日志。 */
  sequence?: number;
  /** 串口会话的原始字节（Base64）；文本终端忽略该字段。 */
  rawData?: string;
}

/** Shell 关闭数据 */
export interface ShellClosedData {
  sessionId: string;
  /**
   * 关闭原因标记。目前后端仅串口模块使用：
   * - "device_disconnected"：串口设备已拔出。设备不在位时重连必然失败，
   *   前端收到该原因时应跳过自动重连，等待用户重新插入设备后手动重连。
   */
  reason?: string;
}

/** Shell 错误数据 */
export interface ShellErrorData {
  sessionId: string;
  error: string;
  /**
   * 错误原因标记（与 ShellClosedData.reason 同义）。
   * "device_disconnected"：串口设备已拔出，自动重连无意义。
   */
  reason?: string;
}

/** SSH 连接事件数据 */
export interface SshEventData {
  serverId: string;
}

/** 服务器探测进度事件数据（server:probe-progress） */
export interface ServerProbeProgress {
  serverId: string;
  online: boolean;
  /** 本轮探测的服务器总数 */
  total: number;
  /** 已完成探测的数量（含本次） */
  done: number;
}

/** 串口 IAP 固件元信息 */
export interface FirmwareInfo {
  fileName: string;
  filePath: string;
  fileType: 'bin' | 'hex' | 'unknown';
  sizeBytes: number;
  formattedSize: string;
  crc32: string;
  sha256: string;
  startAddress?: string;
  isValid: boolean;
  error?: string;
}

/** 已知主机公钥记录（Known Hosts） */
export interface KnownHostRecord {
  host: string;
  port: number;
  keyType: string;
  keyValue: string;
  fingerprint: string;
  createdAt: number;
}


/** 串口 IAP 升级参数配置 */
export interface SerialIapConfig {
  sessionId: string;
  filePath: string;
  protocol: 'ymodem' | 'ymodem-1k' | 'xmodem' | 'xmodem-1k' | 'raw';
  packetSize: number; // 128 | 1024
  timeoutSecs: number; // 默认 60s
  maxRetries: number; // 默认 10
  preCommand?: string;
  preBreakDurationMs?: number;
  preDelayMs?: number;
  rawChunkDelayMs?: number;
  /** 可选发布校验值；填写后启动前必须与固件实际 SHA256 完全一致。 */
  expectedSha256?: string;
  /** 协议传输完成后发送的设备版本/CRC 查询命令，支持 \\r/\\n/\\xNN。 */
  verificationCommand?: string;
  /** 设备响应中必须包含的内容，支持 \\r/\\n/\\xNN。 */
  verificationExpected?: string;
  /** 传输完成后等待设备烧写或重启再验证的时间。 */
  postDelayMs?: number;
}

/** 串口 IAP 实时遥测进度 */
export interface SerialIapProgress {
  sessionId: string;
  phase: 'idle' | 'pre_trigger' | 'handshaking' | 'transferring' | 'finishing' | 'verified' | 'completed' | 'error' | 'cancelled';
  bytesSent: number;
  totalBytes: number;
  currentPacket: number;
  totalPackets: number;
  retries: number;
  speedBps: number;
  elapsedSecs: number;
  estimatedRemainingSecs: number;
  message: string;
  log?: string;
  error?: string;
}

/** 状态变更事件数据（重新导出，方便调用方使用） */
export type {
  ConnectionState,
  SshErrorKind,
  SshStateResult,
  ConnectionStateData,
};

/** 收藏指令 */
export interface FavoriteCommand {
  id: string;
  cmd: string;
  desc: string;
  createdAt: number;
}

/** 本地目录条目（用于文件上传对话框） */
export interface LocalFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: string;
}

/** 本地目录列表结果 */
export interface LocalDirectoryResult {
  success: boolean;
  files: LocalFileEntry[];
  error?: string;
}

/** 快速访问路径 */
export interface QuickAccessPath {
  name: string;
  type: string;
  path: string;
  platform: string;
}

/** SFTP 配置诊断结果 */
export interface SftpDiagnostics {
  server_id: string;
  status: "healthy" | "warning" | "critical" | "skipped";
  issues: SftpDiagnosticIssue[];
  recommendations: SftpDiagnosticRecommendation[];
  message?: string;
}

export interface SftpDiagnosticIssue {
  type: string;
  severity: "critical" | "warning";
  message: string;
}

export interface SftpDiagnosticRecommendation {
  type: string;
  message: string;
}

/** 测试连接配置 */
export interface TestConnectConfig {
  host: string;
  port: number;
  username: string;
  /** 编辑场景下传入以回填原凭据 */
  id?: string;
  authType: "password" | "privateKey" | "sshAgent" | "certificate";
  password?: string;
  privateKeyPath?: string;
  /** 私钥解密密码（passphrase），用于解密受密码保护的私钥文件 */
  privateKeyPassphrase?: string;
  /** SSH Agent 认证：指定身份的 OpenSSH 公钥字符串 */
  agentIdentity?: string;
  /** OpenSSH 证书文件路径（*-cert.pub） */
  certificatePath?: string;
  /** 关联的全局密钥 ID；测试连接与正式连接保持同一 content-based 路线 */
  sshKeyId?: string;
  connectionTimeout?: number;
  /** 连接目标类型，缺省 linux */
  targetType?: string;
  /** 连接协议，缺省 ssh */
  protocol?: string;
  /** FinalShell 模式：内联代理配置（JSON 字符串），测试连接走跳板链路；空表示直连 */
  proxyConfig?: string;
}

/** BMC Redfish 测试连接配置（同时验证 HTTPS、Redfish 与账号认证） */
export interface BmcTestConfig {
  /** 编辑场景下传入，用于沿用未重新输入的已保存密码 */
  id?: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  connectionTimeout?: number;
  /** 仅在用户明确选择时允许自签名/无效 BMC TLS 证书 */
  bmcAllowInvalidCerts?: boolean;
}

export interface EndpointDiagnosticCheck {
  kind: "config" | "dns" | "tcp";
  success: boolean;
  message: string;
  detail?: string;
  durationMs: number;
}

export interface EndpointDiagnosticResult {
  host: string;
  port: number;
  resolvedAddresses: string[];
  checks: EndpointDiagnosticCheck[];
  reachable: boolean;
}

/** 密钥生成请求 */
export interface GenerateKeyRequest {
  /** 算法：ed25519 | rsa | ecdsa-p256 | ecdsa-p384 */
  algorithm: "ed25519" | "rsa" | "ecdsa-p256" | "ecdsa-p384";
  /** RSA 位数的可选覆盖（默认 3072，仅 algorithm=rsa 时生效） */
  rsaBits?: number;
  /** 保存目录（绝对路径） */
  saveDir: string;
  /** 文件名（不含扩展名，如 id_ed25519） */
  fileName: string;
  /** 加密 passphrase（空字符串或不传表示不加密） */
  passphrase?: string;
  /** 注释（写入私钥末尾与 .pub 文件末尾） */
  comment?: string;
}

/** 密钥生成结果 */
export interface GenerateKeyResult {
  success: boolean;
  error?: string;
  /** 私钥文件绝对路径 */
  privateKeyPath?: string;
  /** 公钥文件绝对路径（*.pub） */
  publicKeyPath?: string;
  /** 公钥字符串（ssh-ed25519 AAAA... comment，便于直接复制到 authorized_keys） */
  publicKey?: string;
  /** 算法显示名（如 Ed25519 / RSA） */
  algorithm?: string;
}

/** SSH Agent 中的身份信息 */
export interface SshAgentIdentity {
  /** 算法名，如 "ssh-ed25519" */
  algorithm: string;
  /** 公钥 base64 */
  publicKeyBase64: string;
  /** SHA256 指纹 */
  fingerprint: string;
}

/** SSH Agent 可用性检测结果 */
export interface SshAgentStatus {
  available: boolean;
  platform: "unix" | "windows" | "unknown";
  message?: string;
}

/** Tail 流清理函数 */
export type TailCleanup = () => void;

/** Tail 流启动结果 */
export interface TailHandle {
  promise: Promise<CommandResult>;
  cleanup: TailCleanup;
}

// ==================== 后端适配器接口 ====================

/**
 * 后端适配器抽象接口
 *
 * 这是与平台无关的后端能力契约。当前实现：
 * - TauriAdapter: 通过 Tauri invoke / event 调用 Rust 原生模块
 *
 * 实现方需保证所有方法的行为一致，前端代码只依赖此接口，
 * 切换后端时只需替换 adapter，无需改动业务代码。
 */
export interface BackendAdapter {
  /** 检测当前是否运行在 Tauri 桌面环境中 */
  isAvailable(): boolean;

  // ==================== 服务器管理 ====================
  servers: {
    list: () => Promise<Server[]>;
    listForSync?: () => Promise<Server[]>;
    add: (
      server: Omit<Server, "createdAt" | "updatedAt">,
    ) => Promise<OperationResult>;
    update: (id: string, updates: Partial<Server>) => Promise<OperationResult>;
    delete: (id: string) => Promise<OperationResult>;
    get: (id: string) => Promise<Server | null>;
    /** 回收站：列出待删除服务器 */
    listTrash: () => Promise<Server[]>;
    /** 回收站：恢复指定服务器（原分组已删除则归入根分组） */
    restore: (id: string) => Promise<OperationResult>;
    /** 回收站：永久删除（物理清除）指定服务器 */
    purge: (id: string) => Promise<OperationResult>;
    /** 回收站：清理超过 retentionDays 天的待删除项，返回清理条数 */
    cleanupTrash: (retentionDays: number) => Promise<number>;
    /**
     * 导出服务器列表到加密 JSON 文件
     * @param filePath 用户选择的保存路径
     * @param ids 要导出的服务器 id 列表（空数组 = 导出全部）
     * @param password 导出密码（用于派生 export_key 加密敏感字段）
     */
    export: (
      filePath: string,
      ids: string[],
      password: string,
    ) => Promise<OperationResult>;
    /**
     * 从本产品生成的加密 JSON 文件导入服务器列表
     * @param filePath 用户选择的导入文件路径
     * @param password 导出时使用的密码
     */
    import: (filePath: string, password: string) => Promise<ImportResult>;
    parseExternalImport: (
      source: ExternalImportSource,
      path?: string,
    ) => Promise<ExternalImportPreview>;
    importExternal: (
      candidates: ExternalImportCandidate[],
      skipDuplicates: boolean,
    ) => Promise<ImportResult>;
  };

  // ==================== 服务器分组（树形目录） ====================
  serverGroups: {
    list: () => Promise<ServerGroup[]>;
    /** 新建分组（parentId 为 null 表示根目录），返回新分组 ID */
    add: (group: {
      id?: string;
      name: string;
      parentId?: string | null;
    }) => Promise<OperationResult>;
    /** 更新分组（重命名 / 移动到新父分组，后端含环检测） */
    update: (
      id: string,
      updates: { name?: string; parentId?: string | null },
    ) => Promise<OperationResult>;
    /** 删除分组（含子孙分组；组内服务器移出到根目录） */
    delete: (id: string) => Promise<OperationResult>;
  };

  // ==================== SSH 连接 ====================
  ssh: {
    connect: (serverId: string) => Promise<ConnectResult>;
    disconnect: (serverId: string) => Promise<OperationResult>;
    execute: (serverId: string, command: string) => Promise<CommandResult>;
    isConnected: (serverId: string) => Promise<boolean>;
    probeConnections: () => Promise<string[]>;
    getState: (serverId: string) => Promise<SshStateResult>;
    getConnectedServers: () => Promise<string[]>;
    testConnection: (serverId: string) => Promise<TestConnectionResult>;
    testConnectWithConfig: (
      config: TestConnectConfig,
    ) => Promise<TestConnectWithConfigResult>;
    diagnoseEndpoint: (
      host: string,
      port: number,
      timeoutSecs?: number,
    ) => Promise<EndpointDiagnosticResult>;
    /** 重置指定服务器的已知服务器密钥记录（用于服务器密钥轮换后重新信任） */
    resetKnownHost: (serverId: string) => Promise<OperationResult>;
    /** 列出所有已知主机公钥记录 */
    listKnownHosts: () => Promise<KnownHostRecord[]>;
    /** 删除指定主机的公钥记录 */
    deleteKnownHost: (
      host: string,
      port: number,
      keyType?: string,
    ) => Promise<OperationResult>;
    /** 清空全部已知主机公钥记录 */
    clearAllKnownHosts: () => Promise<OperationResult>;
    /** 批量恢复已知主机公钥记录（用于云同步恢复） */
    restoreKnownHosts?: (records: KnownHostRecord[]) => Promise<number>;
    checkAllServers: () => Promise<Record<string, boolean>>;
    detectOsInfo: (serverId: string) => Promise<DetectOsResult>;
    getHomeDirectory: (serverId: string) => Promise<string>;
    onConnected: (callback: (data: SshEventData) => void) => () => void;
    onDisconnected: (callback: (data: SshEventData) => void) => () => void;
    /** 订阅服务器 OS 探测完成事件（后端完成异步探测后实时推送） */
    onOsDetected: (
      callback: (data: { serverId: string; osType: string; osInfo: string }) => void,
    ) => () => void;
    /** 订阅状态机变更事件（取代旧的 boolean isConnected） */
    onStateChanged: (
      callback: (data: ConnectionStateData) => void,
    ) => () => void;
    /** 订阅服务器探测进度事件（每完成一台探测推送一次） */
    onProbeProgress: (
      callback: (data: ServerProbeProgress) => void,
    ) => () => void;
    // 交互式 Shell
    createShell: (
      serverId: string,
      cols: number,
      rows: number,
    ) => Promise<CreateShellResult>;
    writeToShell: (sessionId: string, data: string) => Promise<void>;
    interruptShell: (sessionId: string) => Promise<number>;
    setShellEncoding: (sessionId: string, encoding: string) => Promise<void>;
    resizeShell: (sessionId: string, cols: number, rows: number) => void;
    /** 暂停 Shell 会话数据读取（前端高水位背压） */
    pauseShell: (sessionId: string) => void;
    /** 恢复 Shell 会话数据读取（前端低水位背压解除） */
    resumeShell: (sessionId: string) => void;
    closeShell: (sessionId: string) => Promise<OperationResult>;
    getShellHistory: (sessionId: string) => Promise<string>;
    onShellOutput: (callback: (data: ShellOutputData) => void) => () => void;
    onShellClosed: (callback: (data: ShellClosedData) => void) => () => void;
    onShellError: (callback: (data: ShellErrorData) => void) => () => void;

    // ===== Zmodem 透传（P0-3） =====
    /**
     * 向 Shell 写入 Zmodem 协议响应字节（base64 编码）
     * 前端 zmodem.js 解析 shell:zmodem-data 后回写给服务器
     */
    shellZmodemWrite: (sessionId: string, data: string) => Promise<void>;
    /** 通知 Zmodem 传输结束，退出 passthrough 模式 */
    shellZmodemEnd: (sessionId: string) => Promise<OperationResult>;
    /** 订阅 Zmodem 检测事件（终端流中检测到 `*\x18B` 起始序列） */
    onShellZmodemDetected: (
      callback: (data: { sessionId: string; data?: string }) => void,
    ) => () => void;
    /** 订阅 Zmodem 数据事件（base64 编码的二进制字节） */
    onShellZmodemData: (
      callback: (data: { sessionId: string; data: string }) => void,
    ) => () => void;
    /** 订阅 Zmodem 传输结束事件（正常完成 / 用户取消 / 会话异常） */
    onShellZmodemEnd: (
      callback: (data: { sessionId: string }) => void,
    ) => () => void;

    // ===== 批量命令执行（P0-4） =====
    /**
     * 批量执行命令
     * @param serverIds 服务器 ID 列表（去重）
     * @param command 命令字符串
     * @param timeoutSecs 单台超时（5-120s，默认 30s）
     */
    batchExecute: (
      serverIds: string[],
      command: string,
      timeoutSecs?: number,
    ) => Promise<BatchExecuteResult>;
    /** 订阅批量执行进度事件（每完成一台推送一次） */
    onBatchExecuteProgress: (
      callback: (data: BatchExecuteProgress) => void,
    ) => () => void;

    // ==================== SSH 密钥管理（对齐 Termius/MobaXterm/SecureCRT） ====================
    keys: {
      /**
       * 在应用内生成 SSH 密钥对并保存为 OpenSSH 格式文件
       * - 支持 Ed25519 / RSA / ECDSA-P256 / ECDSA-P384
       * - 输出 `<saveDir>/<fileName>` 私钥 + `<saveDir>/<fileName>.pub` 公钥
       * - Unix 平台自动设置私钥文件权限为 0600
       */
      generate: (req: GenerateKeyRequest) => Promise<GenerateKeyResult>;
      /** 检测系统 SSH Agent 是否可用（Unix: SSH_AUTH_SOCK / Windows: Pageant 命名管道） */
      testAgent: () => Promise<SshAgentStatus>;
      /** 列出 SSH Agent 中已加载的所有身份（公钥 + 指纹） */
      listAgentIdentities: () => Promise<SshAgentIdentity[]>;
    };
  };

  // ==================== SSH 密钥库（持久化 + 加密存储） ====================
  /**
   * 与 `ssh.keys`（生成 / Agent 查询）区分：
   * - `sshKeys` 负责 SshKey 实体的 CRUD，私钥/证书内容加密入库
   * - 解决旧实现 passphrase 明文存 localStorage 的安全隐患
   * - 阶段 3 后，SSH 连接优先使用 content 字段（路径仅作 fallback）
   */
  sshKeys: {
    /** 列出所有 SSH 密钥（passphrase 返回占位符，content 不返回） */
    list: () => Promise<SshKey[]>;
    /** 列出 SSH 密钥（用于端到端零知识云同步，含解密 content 与 passphrase） */
    listForSync?: () => Promise<SshKey[]>;
    /** 新增 SSH 密钥（content / passphrase 加密入库） */
    add: (input: SshKeyInput) => Promise<OperationResult>;
    /** 更新 SSH 密钥（敏感字段为占位符时跳过更新） */
    update: (id: string, updates: SshKeyUpdate) => Promise<OperationResult>;
    /** 删除 SSH 密钥 */
    delete: (id: string) => Promise<OperationResult>;
    /**
     * 读取本地文件内容（阶段 3：选完私钥/证书文件后读取内容入库）。
     * 与 Tauri `@tauri-apps/plugin-fs` 的 readTextFile 类似，
     * 但统一走后端 invoke 便于未来扩展（如大小限制、格式校验）。
     */
    readFileContent: (path: string) => Promise<string>;
  };

  // ==================== 标签目录（独立存储，不依赖服务器） ====================
  tags: {
    /** 列出全部标签名 */
    list: () => Promise<string[]>;
    /** 新建标签（空标签也允许），返回新标签名 */
    create: (name: string) => Promise<string>;
    /** 重命名标签（级联更新服务器） */
    rename: (oldName: string, newName: string) => Promise<void>;
    /** 删除标签（级联更新服务器） */
    delete: (name: string) => Promise<void>;
    /** 列出完整标签记录（含 id 与创建时间，用于云同步） */
    listAll?: () => Promise<TagRow[]>;
    /** 批量恢复标签目录（用于云同步恢复） */
    restore?: (tags: TagRow[]) => Promise<number>;
  };

  // ==================== 系统指标 ====================
  metrics: {
    collect: (serverId: string) => Promise<SystemMetrics>;
    refreshCache: (serverId: string) => Promise<OperationResult>;
  };

  // ==================== 服务管理 ====================
  services: {
    list: (serverId: string) => Promise<ServiceInfo[]>;
    start: (serverId: string, name: string) => Promise<CommandResult>;
    stop: (serverId: string, name: string) => Promise<CommandResult>;
    restart: (serverId: string, name: string) => Promise<CommandResult>;
    status: (serverId: string, name: string) => Promise<CommandResult>;
    /** 设置开机自启（不等价于立即启动） */
    enable: (serverId: string, name: string) => Promise<CommandResult>;
    /** 取消开机自启（不等价于停止实例） */
    disable: (serverId: string, name: string) => Promise<CommandResult>;
    /** 服务详情：systemctl show 全属性 */
    inspect: (serverId: string, name: string) => Promise<ServiceProps>;
    /** 服务日志：journalctl -u <unit> */
    logs: (
      serverId: string,
      name: string,
      query?: ServiceLogQuery,
    ) => Promise<CommandResult>;
    /** 能力探测：systemd / journalctl / sudo */
    capabilities: (serverId: string) => Promise<ServiceCapabilities>;
    /** 启动日志实时跟随（journalctl -f），返回 sessionId；输出由 service:log:data 事件推送 */
    followStart: (serverId: string, name: string, lines?: number) => Promise<string>;
    /** 停止日志实时跟随 */
    followStop: (serverId: string, name: string) => Promise<OperationResult>;
    /** 依赖关系（P1） */
    dependencies: (serverId: string, name: string) => Promise<ServiceDependencies>;
    /** Unit 文件与 Drop-in（P1） */
    unitFile: (serverId: string, name: string) => Promise<CommandResult>;
    /** 服务进程（P1） */
    process: (serverId: string, name: string) => Promise<CommandResult>;
    /** 服务监听端口（P1） */
    ports: (serverId: string, name: string) => Promise<CommandResult>;
    /** 屏蔽服务（Mask） */
    mask: (serverId: string, name: string) => Promise<CommandResult>;
    /** 解除屏蔽（Unmask） */
    unmask: (serverId: string, name: string) => Promise<CommandResult>;
    /** 重载 systemd 配置 */
    daemonReload: (serverId: string) => Promise<CommandResult>;
    /** 批量采集资源（一次命令取全部服务，CPU 需前端两次采样求差） */
    resources: (serverId: string) => Promise<ServiceResourceRawMap>;
  };

  // ==================== 进程管理 ====================
  processes: {
    list: (serverId: string) => Promise<ProcessInfo[]>;
    /** 向进程发送信号：term = SIGTERM（优雅），kill = SIGKILL（强制）；startTimeTicks 用于 PID 复用竞态校验 */
    signal: (
      serverId: string,
      pid: number,
      signal: "term" | "kill",
      startTimeTicks: number,
    ) => Promise<CommandResult>;
  };

  // ==================== 端口管理 ====================
  ports: {
    list: (serverId: string) => Promise<PortInfo[]>;
    killByPid: (serverId: string, pid: number) => Promise<CommandResult>;
  };

  // ==================== 网络工作台 ====================
  network: {
    dns: (serverId: string, target: string) => Promise<CommandResult>;
    ping: (serverId: string, target: string) => Promise<CommandResult>;
    tcpCheck: (
      serverId: string,
      host: string,
      port: number,
    ) => Promise<CommandResult>;
    httpCheck: (serverId: string, url: string) => Promise<CommandResult>;
    getOverview: (serverId: string) => Promise<NetOverview>;
    getInterfaces: (serverId: string) => Promise<InterfaceInfo[]>;
    getRoutes: (serverId: string) => Promise<RouteView>;
    getRouteGet: (serverId: string, target: string) => Promise<RouteGetResult>;
    getDnsConfig: (serverId: string) => Promise<DnsConfigInfo>;
    getConnections: (serverId: string, query?: ConnQuery) => Promise<ConnPage>;
    getNeighbors: (serverId: string) => Promise<NeighborInfo[]>;
    getEthtool: (serverId: string, iface: string) => Promise<EthtoolInfo>;
    getCapabilities: (serverId: string, refresh?: boolean) => Promise<HostCapabilities>;
    runQuickCheck: (
      serverId: string,
      target: string,
      port?: number,
      protocol?: string,
    ) => Promise<NetworkRun>;
    runTraceroute: (
      serverId: string,
      target: string,
      mode?: string,
    ) => Promise<string>;
    runPing: (
      serverId: string,
      target: string,
      count?: number,
    ) => Promise<string>;
    startCapture: (
      serverId: string,
      req: CaptureReq,
    ) => Promise<CaptureResult>;
    listRuns: (
      serverId: string,
      limit?: number,
    ) => Promise<NetworkRunSummary[]>;
    getRun: (runId: string) => Promise<NetworkRun | null>;
    deleteRun: (runId: string) => Promise<void>;
    compareRuns: (runIdA: string, runIdB: string) => Promise<RunDiff>;
    exportReport: (runId: string, format: string) => Promise<ExportResult>;
  };

  // ==================== 日志 ====================
  logs: {
    read: (
      serverId: string,
      path: string,
      lines: number,
    ) => Promise<CommandResult>;
    tail: (
      serverId: string,
      path: string,
      callback: (data: string) => void,
    ) => TailHandle;
    stopTail: (serverId: string, path: string) => Promise<OperationResult>;
    search: (
      serverId: string,
      path: string,
      keyword: string,
    ) => Promise<CommandResult>;
  };

  // ==================== 文件管理 ====================
  files: {
    list: (serverId: string, path: string) => Promise<FileEntry[]>;
    read: (serverId: string, path: string) => Promise<CommandResult>;
    write: (
      serverId: string,
      path: string,
      content: string,
    ) => Promise<CommandResult>;
    mkdir: (serverId: string, path: string) => Promise<CommandResult>;
    delete: (serverId: string, path: string) => Promise<CommandResult>;
    rename: (
      serverId: string,
      oldPath: string,
      newPath: string,
    ) => Promise<CommandResult>;
    getPermissions: (serverId: string, path: string) => Promise<CommandResult>;
    setPermissions: (
      serverId: string,
      path: string,
      mode: string,
      recursive?: boolean,
    ) => Promise<CommandResult>;
    download: (
      serverId: string,
      remotePath: string,
      localDest?: string,
    ) => Promise<FileDownloadResult>;
    downloadArchive: (
      serverId: string,
      remotePath: string,
      format: string,
    ) => Promise<FileDownloadResult>;
    extractArchive: (serverId: string | null, path: string, conflictAction?: "overwrite" | "keep") => Promise<OperationResult>;
    installExtractionTool: (serverId: string | null, path: string) => Promise<OperationResult>;
    upload: (
      serverId: string,
      remoteDir: string,
      uploadType: "file" | "dir" | "auto",
    ) => Promise<FileUploadResult>;
    uploadFromPaths: (
      serverId: string,
      remoteDir: string,
      localPaths: string[],
      targetFileName?: string,
    ) => Promise<FileUploadResult>;
    getLocalUploadStats: (paths: string[]) => Promise<LocalUploadStats>;
    /**
     * 取消传输任务
     * @param transferId 传输 ID（来自 TransferProgressData.transferId）
     * @returns true 表示找到并已取消；false 表示传输不存在或已结束
     */
    cancelTransfer: (transferId: string) => Promise<boolean>;
    /**
     * 取消所有活跃传输任务并等待其清理完成
     * @returns 取消的任务数量
     */
    cancelAllTransfers: () => Promise<number>;
    /**
     * 断点续传上传：从 offset 字节处继续上传到远程临时文件，完成后 rename 覆盖目标。
     * 失败/取消时仍保留临时文件，可再次续传。
     */
    resumeUpload: (
      serverId: string,
      localPath: string,
      remotePath: string,
      tmpRemotePath: string,
      offset: number,
      transferId: string,
      expectedSourceSize?: number,
    ) => Promise<FileUploadResult>;
    /**
     * 断点续传下载：从 offset 字节处继续下载到本地临时文件，完成后 rename 覆盖目标。
     */
    resumeDownload: (
      serverId: string,
      remotePath: string,
      localPath: string,
      tmpLocalPath: string,
      offset: number,
      transferId: string,
    ) => Promise<FileDownloadResult>;
    /**
     * 清理断点续传残留的临时文件（用户放弃续传时调用）
     * @param isRemote true=远程临时文件（SFTP），false=本地临时文件
     * @returns true 表示已清理或文件不存在
     */
    cleanupTmpFile: (
      serverId: string,
      tmpPath: string,
      isRemote: boolean,
    ) => Promise<boolean>;
    /**
     * 设置全局传输限速（KB/s）
     * @param kbps 0=不限速；>0 限速值
     * 后端用 AtomicU64 存储，所有上传/下载 chunk 循环读取此值并 sleep 节流
     */
    setTransferRateLimit: (kbps: number) => Promise<void>;
    /**
     * 设置 SFTP 传输排除过滤规则
     */
    setExclusionConfig: (
      enabled: boolean,
      patterns: string[],
      respectGitignore: boolean,
    ) => Promise<void>;
    /**
     * 递归搜索远程文件
     * @param serverId 服务器 ID
     * @param dir 搜索起始目录
     * @param pattern 文件名匹配关键词（glob *pattern*）
     * @param maxResults 最大结果数（默认 500）
     * @returns 匹配的文件完整路径数组
     */
    searchFilesRecursive: (
      serverId: string,
      dir: string,
      pattern: string,
      maxResults?: number,
    ) => Promise<string[]>;
    onTransferProgress: (
      callback: (data: TransferProgressData) => void,
    ) => () => void;
    backup: (serverId: string, path: string) => Promise<CommandResult>;
    chown: (
      serverId: string,
      path: string,
      owner: string,
      group: string,
      recursive: boolean,
    ) => Promise<CommandResult>;
    createSymlink: (
      serverId: string,
      target: string,
      linkPath: string,
    ) => Promise<CommandResult>;
    statInfo: (serverId: string, path: string) => Promise<FileStatInfo>;
    /**
     * 服务器到服务器传输（两侧都是远程 SFTP）
     * @param srcServerId 源服务器 ID
     * @param srcPath 源文件/目录的完整路径
     * @param destServerId 目标服务器 ID
     * @param destPath 目标目录路径（文件将被放入此目录）
     * @param targetName 可选，覆盖目标文件名（用于冲突重命名）
     * @returns CommandResult，成功 stdout 为成功提示，失败 stderr 为错误信息
     */
    serverToServerTransfer: (
      srcServerId: string,
      srcPath: string,
      destServerId: string,
      destPath: string,
      targetName?: string,
    ) => Promise<CommandResult>;
    // 本地文件系统访问（用于上传对话框）
    getSystemRoots: () => Promise<string[]>;
    listLocalDirectory: (path: string) => Promise<LocalDirectoryResult>;
    getQuickAccess: () => Promise<QuickAccessPath[]>;
    /**
     * 列出 Windows 服务器上的所有磁盘盘符（仅 Windows 目标有效）
     * @returns 盘符数组，如 ["C:\\","D:\\"]；非 Windows 目标返回空数组
     */
    listDrives: (serverId: string) => Promise<string[]>;
    /**
     * 诊断 Windows 服务端的 SFTP 配置
     * @returns 诊断结果，包含 status/issues/recommendations
     */
    diagnoseSftp: (serverId: string) => Promise<SftpDiagnostics>;
  };

  // ==================== Docker ====================
  docker: {
    ps: (serverId: string) => Promise<DockerContainer[]>;
    images: (serverId: string) => Promise<DockerImage[]>;
    start: (serverId: string, containerId: string) => Promise<CommandResult>;
    stop: (serverId: string, containerId: string) => Promise<CommandResult>;
    restart: (serverId: string, containerId: string) => Promise<CommandResult>;
    /** 获取容器日志。lines=尾部行数(默认1000)，since=ISO8601时间戳(增量轮询) */
    logs: (
      serverId: string,
      containerId: string,
      lines: number,
      since?: string,
    ) => Promise<CommandResult>;
    stats: (serverId: string, containerId: string) => Promise<CommandResult>;
    inspect: (serverId: string, containerId: string) => Promise<CommandResult>;
    composePs: (serverId: string) => Promise<CommandResult>;
    rmi: (serverId: string, imageId: string) => Promise<CommandResult>;
    imagePrune: (serverId: string) => Promise<CommandResult>;
    rm: (
      serverId: string,
      containerId: string,
      force: boolean,
    ) => Promise<CommandResult>;
    composeUp: (
      serverId: string,
      projectDir: string,
      configFiles?: string,
    ) => Promise<CommandResult>;
    composeDown: (
      serverId: string,
      projectDir: string,
      configFiles?: string,
    ) => Promise<CommandResult>;
    composeLogs: (
      serverId: string,
      projectName: string,
      lines: number,
      projectDir?: string,
      configFiles?: string,
      service?: string,
    ) => Promise<CommandResult>;
    /** Compose service 列表（项目级容器状态，docker compose ps -a --format json） */
    composeServices: (
      serverId: string,
      projectDir?: string,
      configFiles?: string,
    ) => Promise<CommandResult>;
    /** 网络管理（P2） */
    networkLs: (serverId: string) => Promise<DockerNetwork[]>;
    networkRm: (serverId: string, name: string) => Promise<CommandResult>;
    networkPrune: (serverId: string) => Promise<CommandResult>;
    networkInspect: (serverId: string, networkId: string) => Promise<CommandResult>;
    networkCreate: (
      serverId: string,
      name: string,
      driver: string,
      subnet?: string | null,
      gateway?: string | null,
    ) => Promise<CommandResult>;
    networkConnect: (serverId: string, networkId: string, containerId: string) => Promise<CommandResult>;
    networkDisconnect: (
      serverId: string,
      networkId: string,
      containerId: string,
      force: boolean,
    ) => Promise<CommandResult>;
    /** 卷管理（P2） */
    volumeLs: (serverId: string) => Promise<DockerVolume[]>;
    volumeRm: (serverId: string, name: string, force: boolean) => Promise<CommandResult>;
    volumePrune: (serverId: string) => Promise<CommandResult>;
    /** 浏览卷内容（宿主挂载点 ls -la） */
    volumeBrowse: (serverId: string, volumeName: string, subPath?: string | null) => Promise<CommandResult>;
    /** 拉取镜像（长操作，后端 30 分钟超时） */
    pull: (serverId: string, image: string) => Promise<CommandResult>;
    /** Overview 总览数据（版本/daemon 状态/资源计数） */
    info: (serverId: string) => Promise<DockerOverview>;
    /** 暂停/恢复容器 */
    pause: (serverId: string, containerId: string) => Promise<CommandResult>;
    unpause: (serverId: string, containerId: string) => Promise<CommandResult>;
    /** Compose 生命周期：restart | stop | start | pull | build */
    composeAction: (
      serverId: string,
      action: "restart" | "stop" | "start" | "pull" | "build",
      projectDir: string,
      configFiles?: string,
    ) => Promise<CommandResult>;
    /** 运行新容器（MVP basic 配置） */
    run: (serverId: string, params: DockerRunParams) => Promise<CommandResult>;
    /** 镜像详细信息 */
    imageInspect: (serverId: string, imageId: string) => Promise<CommandResult>;
    /** 导出镜像为远端 tar（离线迁移） */
    imageSave: (serverId: string, imageRef: string) => Promise<CommandResult>;
    /** 从远端 tar 导入镜像（离线迁移） */
    imageLoad: (serverId: string, remotePath: string) => Promise<CommandResult>;
    /** 导出镜像为本地 tar（方案 A：流式直写客户端文件，不依赖宿主机磁盘） */
    imageSaveStream: (serverId: string, imageRefs: string[], localPath: string, estimatedBytes: number) => Promise<CommandResult>;
    /** 从本地 tar 导入镜像（方案 A：流式经 SSH stdin 喂给 docker load，不依赖宿主机磁盘） */
    imageLoadStream: (serverId: string, localPath: string) => Promise<CommandResult>;
    /** 取消进行中的镜像导出/导入传输（设置该 server 的 cancel flag） */
    imageTransferCancel: (serverId: string) => Promise<CommandResult>;
    /** Compose 配置校验（docker compose config --quiet） */
    composeValidate: (
      serverId: string,
      projectDir: string,
      configFiles?: string,
    ) => Promise<CommandResult>;
    /** 创建 Compose 项目（yamlB64 由前端 UTF-8 → base64 编码） */
    composeCreate: (
      serverId: string,
      projectDir: string,
      yamlB64: string,
    ) => Promise<CommandResult>;
    /** Compose 生命周期（流式）：输出经 docker:compose-output 事件实时推送，命令结束时发 done 终态 */
    composeActionStream: (
      serverId: string,
      action: string,
      projectDir: string,
      configFiles: string | undefined,
      requestId: string,
    ) => Promise<null>;
    /** 导入扫描：检查目录是否含 compose 文件并校验配置 */
    composeImportScan: (
      serverId: string,
      dirs: string[],
    ) => Promise<unknown[]>;
    /** 容器日志实时跟随（docker logs -f 流式）：事件复用 docker:compose-output 通道，
     * requestId 用 `logs-` 前缀与 compose 流隔离；单次连接有界 120s，done 后前端带 since 重连 */
    logsStream: (
      serverId: string,
      containerId: string,
      tail: number,
      since: string | undefined,
      requestId: string,
    ) => Promise<null>;
    /** 列出容器内目录内容（docker exec ls -la） */
    containerFileList: (
      serverId: string,
      containerId: string,
      path: string,
    ) => Promise<DockerFileEntry[]>;
    /** 容器文件下载准备：docker cp 到远端临时目录，返回临时路径供 SFTP 下载 */
    cpFromContainer: (
      serverId: string,
      containerId: string,
      srcPath: string,
    ) => Promise<DockerCpResult>;
    /** 复制宿主机文件/目录进容器（两种来源）：
     *  - 本地上传：源为 /tmp/swk-docker-cp 临时路径，deleteSource=true（复制后删临时文件）
     *  - 宿主机复制：源为宿主机任意绝对路径，deleteSource=false（保留源文件） */
    cpToContainer: (
      serverId: string,
      containerId: string,
      hostPath: string,
      destDir: string,
      deleteSource?: boolean,
    ) => Promise<CommandResult>;
    /** 删除容器内文件/目录（docker exec rm -rf，拒绝根目录） */
    containerFileDelete: (
      serverId: string,
      containerId: string,
      path: string,
    ) => Promise<CommandResult>;
    /** 清理 docker cp 临时目录 */
    cpCleanup: (serverId: string, path: string) => Promise<CommandResult>;
    /** 订阅 Compose 部署输出流，返回取消订阅函数 */
    onComposeOutput: (callback: (e: ComposeStreamEvent) => void) => Promise<() => void>;
    /** 登录镜像仓库（密码走 stdin，不落日志） */
    login: (
      serverId: string,
      registry: string | undefined,
      username: string,
      password: string,
    ) => Promise<CommandResult>;
    /** System DF 磁盘占用分析 */
    systemDf: (serverId: string) => Promise<SystemDfRow[]>;
    /** 全局清理（includeImages 时连带清理全部未使用镜像） */
    systemPrune: (serverId: string, includeImages: boolean) => Promise<CommandResult>;
  };

  // ==================== 快照 ====================
  snapshot: {
    generate: (serverId: string) => Promise<Record<string, unknown>>;
  };

  // ==================== 收藏指令 ====================
  favCmds: {
    list: () => Promise<FavoriteCommand[]>;
    add: (cmd: string, desc: string) => Promise<OperationResult>;
    update: (id: string, cmd: string, desc: string) => Promise<OperationResult>;
    delete: (id: string) => Promise<OperationResult>;
    restore?: (cmds: FavoriteCommand[]) => Promise<OperationResult>;
  };

  // ==================== 书签 ====================
  bookmarks?: {
    listAll: () => Promise<LogBookmark[]>;
    restore: (items: LogBookmark[]) => Promise<OperationResult>;
  };

  // ==================== 终端自定义背景图片/视频 ====================
  backgrounds?: {
    listForSync: () => Promise<SyncBackgroundItem[]>;
    restore: (items: SyncBackgroundItem[]) => Promise<number>;
  };

  // ==================== 窗口管理（仅 Tauri） ====================
  window?: {
    create: (
      label: string,
      title: string,
      stateJson: string,
      x?: number,
      y?: number,
    ) => Promise<void>;
    listAll: () => Promise<
      Array<{
        label: string;
        title: string;
        x: number;
        y: number;
        width: number;
        height: number;
      }>
    >;
    close: (label: string) => Promise<void>;
    startDragging: () => Promise<void>;
    setPosition: (label: string, x: number, y: number) => Promise<void>;
    /** 获取全局鼠标状态（屏幕坐标 + 左键是否按下），用于跨窗口拖拽合并 */
    getCursorState: () => Promise<{
      x: number;
      y: number;
      leftButtonDown: boolean;
    }>;
  };

  // ==================== 审计日志 ====================
  auditLogs: {
    list: (
      logType?: string,
      searchQuery?: string,
      limit?: number,
      offset?: number,
    ) => Promise<AuditLog[]>;
    count: (logType?: string, searchQuery?: string) => Promise<number>;
    clear: () => Promise<OperationResult>;
    record: (
      logType: string,
      serverName: string | undefined,
      event: string,
      status: string,
      details?: string,
    ) => Promise<OperationResult>;
  };

  // ==================== RDP 远程桌面 ====================
  rdp: {
    /**
     * 启动系统 RDP 客户端（Windows: mstsc / Linux: xfreerdp / macOS: Microsoft Remote Desktop）
     * 不依赖 SSH 连接状态，独立启动远程桌面会话。
     * 凭据由系统 RDP 客户端弹窗输入（不在 .rdp 文件中存储密码）。
     */
    launch: (config: {
      serverId: string;
      /** RDP 端口，默认 3389（与 SSH 端口无关） */
      rdpPort?: number;
      width?: number;
      height?: number;
      fullscreen?: boolean;
      /** 颜色深度 16/24/32，默认 32 */
      colorDepth?: number;
    }) => Promise<OperationResult>;
  };

  // ==================== 端口转发（P0-2） ====================
  portForward: {
    /** 添加一条端口转发（Local/Remote/Dynamic），成功返回 forward_id */
    add: (spec: ForwardSpec) => Promise<OperationResult>;
    /** 列出当前所有转发（可按 server_id 过滤） */
    list: (serverId?: string) => Promise<ForwardInfo[]>;
    /** 停止单条转发 */
    stop: (forwardId: string) => Promise<OperationResult>;
    restart: (forwardId: string) => Promise<OperationResult>;
    /** 停止指定服务器的所有转发 */
    stopAll: (serverId: string) => Promise<OperationResult>;
  };

  // ==================== BMC 带外管理（Redfish API） ====================
  bmc: {
    /** 测试未保存/正在编辑的 Redfish 配置，并真实验证账号认证 */
    testConnectionWithConfig: (config: BmcTestConfig) => Promise<OperationResult>;
    /** 聚合获取 BMC 概览：系统信息 + 电源状态 + BMC 管理器信息 */
    getOverview: (serverId: string) => Promise<BmcOverview>;
    /** 电源操作（on/forceOff/gracefulShutdown/forceRestart/gracefulRestart/powerCycle/nmi） */
    powerAction: (
      serverId: string,
      action: BmcPowerAction,
    ) => Promise<OperationResult>;
    /** 传感器数据（温度/风扇/电压/电源） */
    getSensors: (serverId: string) => Promise<BmcSensorResult>;
    /** 硬件事件日志（SEL） */
    getLogs: (serverId: string) => Promise<BmcLogResult>;
    /** 清空硬件事件日志（不可恢复，需用户确认） */
    clearLogs: (serverId: string) => Promise<OperationResult>;
    /** 机箱定位指示灯开关 */
    setIdentifyLed: (serverId: string, on: boolean) => Promise<OperationResult>;
    /** 设置带外一次性开机引导项（BiosSetup/Pxe/Cd/Hdd/None） */
    setBootSource: (serverId: string, target: string) => Promise<OperationResult>;
  };

  // ==================== Telnet 协议（P0-5） ====================
  // 仅暴露 createShell；write/resize/close/getHistory 复用 ssh_* 命令，
  // 后端依据 session_id 前缀（telnet-）自动路由。
  telnet: {
    /**
     * 创建 Telnet Shell 会话（直连 TCP+Telnet，不走 SSH）
     * - 返回 session_id 以 `telnet-` 前缀开头
     * - 后续 write/resize/close 复用 ssh_write_to_shell 等命令
     * - 事件复用 ssh:shell-output / ssh:shell-closed / ssh:shell-error
     */
    createShell: (
      serverId: string,
      host: string,
      port: number,
      cols: number,
      rows: number,
      timeoutSecs?: number,
      encoding?: string,
    ) => Promise<CreateShellResult>;
  };

  // ==================== 串口 Serial / COM 协议（Xshell 级功能） ====================
  serial: {
    /** 枚举系统可用串口及芯片元信息 */
    listPorts: () => Promise<import('@/types').SerialPortInfo[]>;
    /** 测试串口连接与硬件可用性 */
    testPort: (
      portName: string,
      baudRate?: number,
      dataBits?: number,
      stopBits?: number,
      parity?: string,
      flowControl?: string,
    ) => Promise<{ success: boolean; message?: string; error?: string; signals?: import('@/types').SerialSignals }>;
    /** 创建串口 Shell 会话 */
    createShell: (
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
    ) => Promise<CreateShellResult>;
    /** 发送 Break 打断信号 */
    setBreak: (sessionId: string, durationMs?: number) => Promise<OperationResult>;
    /** 控制 DTR 电平 */
    setDtr: (sessionId: string, level: boolean) => Promise<OperationResult>;
    /** 控制 RTS 电平 */
    setRts: (sessionId: string, level: boolean) => Promise<OperationResult>;
    /** 读取 CTS, DSR, RI, CD 信号线状态 */
    getSignals: (sessionId: string) => Promise<import('@/types').SerialSignals>;
    /** 获取串口原始历史字节（Base64） */
    getHistoryRaw: (sessionId: string) => Promise<string>;
    /** 获取累计收发字节数 */
    getStats: (sessionId: string) => Promise<import('@/types').SerialStats>;
    /** 按指定串口编码在文本和 HEX 原始字节之间转换 */
    encodeText: (text: string, encoding: string) => Promise<string>;
    decodeHex: (hex: string, encoding: string) => Promise<string>;
    /** 解析本地固件文件（.bin / .hex），计算 CRC32、SHA256 与 HEX 基地址 */
    parseFirmware: (filePath: string) => Promise<FirmwareInfo>;
    /** 启动串口 IAP 固件升级（YModem / XModem / Raw 模式） */
    startIap: (config: SerialIapConfig) => Promise<OperationResult>;
    /** 中止串口 IAP 固件升级 */
    cancelIap: (sessionId: string) => Promise<OperationResult>;
    /** 监听串口 IAP 固件升级实时进度事件 */
    onIapProgress: (callback: (data: SerialIapProgress) => void) => () => void;
  };
}

/** 审计日志记录 */
export interface AuditLog {
  id: string;
  timestamp: number;
  logType: string;
  serverName?: string;
  event: string;
  status: string;
  details?: string;
}
