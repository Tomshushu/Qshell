export interface Server {
  id: string
  name: string
  host: string
  port: number
  username: string
  /**
   * 认证方式：
   * - password: 密码认证
   * - privateKey: 私钥文件认证（OpenSSH / PEM / PPK 格式均支持）
   * - sshAgent: SSH Agent 认证（Unix ssh-agent / Windows Pageant）
   * - certificate: OpenSSH 证书认证（私钥 + CA 签名的 *-cert.pub）
   */
  authType: 'password' | 'privateKey' | 'sshAgent' | 'certificate'
  password?: string
  privateKeyPath?: string
  privateKeyPassphrase?: string
  /** SSH Agent 认证：指定 agent 中的具体身份（OpenSSH 公钥字符串 `ssh-ed25519 AAAA...`），缺省使用第一个 */
  agentIdentity?: string
  /** OpenSSH 证书文件路径（*-cert.pub），配合 privateKeyPath 使用 */
  certificatePath?: string
  /**
   * 关联的 SSH 密钥 ID（指向 ssh_keys 表 id）。
   * 阶段 3 content-based 连接：设置后，ssh_connect 优先通过此 id 加载解密后的
   * 私钥/证书内容 + passphrase 进行连接，不再依赖 privateKeyPath 等路径字段。
   * 为空/undefined 时回退到路径模式（兼容旧数据）。
   */
  sshKeyId?: string
  tags: string[]
  notes?: string
  connectionTimeout?: number
  favorite: boolean
  status: 'online' | 'offline' | 'unknown'
  osType?: string
  osInfo?: string
  lastAccessedAt?: number
  /** 连接目标类型（linux/windows/network/unix/bmc/xinchuang），旧数据缺省为 linux */
  targetType?: string
  /** 连接协议（ssh/winrm/telnet/vnc），旧数据缺省为 ssh */
  protocol?: string
  /** 用户启用的协议列表（如 ['ssh','rdp']），旧数据缺省为 ['ssh'] */
  protocols?: string[]
  /** Windows RDP 协议连接端口，默认 3389 */
  rdpPort?: number
  /** BMC Redfish HTTPS 管理端口，默认 443 */
  bmcPort?: number
  /** 是否允许 BMC 使用自签名/无效 TLS 证书，默认关闭 */
  bmcAllowInvalidCerts?: boolean
  /**
   * FinalShell 模式：代理随服务器内联配置。
   * 后端以加密 JSON 字符串存储；前端以 JSON 字符串在数据中传递。
   * `type=none` 或空字符串表示直连。
   */
  proxyConfig?: string | null
  /**
   * FinalShell 模式：隧道（端口转发）随服务器内联配置（JSON 数组字符串）。
   * 连接成功后自动启动。空字符串 / null 表示不启动任何隧道。
   */
  tunnelsConfig?: string | null
  /**
   * Xshell / FinalShell 模式：服务器内联密钥/证书库（JSON 数组字符串）。
   * 每个服务器可独立维护多个密钥或证书，并在连接时选择一个关联使用。
   */
  keysConfig?: string | null
  authKeys?: ServerKeyEntry[]
  /**
   * 串口连接参数（JSON 字符串存储于 Server.serialConfig 或独立字段）。
   */
  serialConfig?: string | null
  /** 所属服务器分组 ID（指向 server_groups 表 id），null/空表示未分组 */
  groupId?: string | null
  /** 回收站删除时间（毫秒时间戳）；为空表示正常，非 NULL 表示待删除 */
  deletedAt?: number | null
  createdAt: number
  updatedAt: number
}

// ============================================================================
// 服务器分组（树形目录）
// ============================================================================

/** 服务器分组节点（parent_id 为 null 表示根目录） */
export interface ServerGroup {
  id: string
  name: string
  parentId: string | null
  createdAt: number
  updatedAt: number
}

// ============================================================================
// 串口 (Serial / COM) 配置（Xshell 级功能）
// ============================================================================

/** 串口设备元信息 */
export interface SerialPortInfo {
  portName: string
  portType: string
  description?: string
  manufacturer?: string
  product?: string
  vid?: number
  pid?: number
  serialNumber?: string
}

/** 串口线路信号状态 (CTS, DSR, RI, CD) */
export interface SerialSignals {
  cts: boolean
  dsr: boolean
  ri: boolean
  cd: boolean
}

export interface SerialStats {
  rxBytes: number
  txBytes: number
}

/** 串口连接配置 */
export interface SerialConfig {
  /** 串口名称，如 "COM1" / "COM3" / "/dev/ttyUSB0" */
  portName: string
  /** 波特率，默认 115200 */
  baudRate: number
  /** 数据位：5 | 6 | 7 | 8，默认 8 */
  dataBits?: 5 | 6 | 7 | 8
  /** 停止位：1 | 2，默认 1 */
  stopBits?: 1 | 2
  /** 奇偶校验：none | odd | even，默认 'none' */
  parity?: 'none' | 'odd' | 'even'
  /** 流控制：none | software (XON/XOFF) | hardware (RTS/CTS)，默认 'none' */
  flowControl?: 'none' | 'software' | 'hardware'
  /** 初始 DTR 电平，默认 true */
  dtr?: boolean
  /** 初始 RTS 电平，默认 true */
  rts?: boolean
  /** USB 设备稳定身份；端口号变化时优先按序列号安全重匹配。 */
  deviceVid?: number
  devicePid?: number
  deviceSerialNumber?: string
  /** 字符集编码，默认 'utf-8'，支持 'gbk' / 'gb2312' / 'ascii' */
  encoding?: string
  /** 行发送延时 (ms)，防止刷长脚本时下位机缓冲区溢出 */
  lineDelayMs?: number
  /** 字符发送延时 (ms) */
  charDelayMs?: number
  /** 换行符模式：'auto' | 'crlf' | 'lf' | 'cr' | 'raw' */
  newlineMode?: 'auto' | 'crlf' | 'lf' | 'cr' | 'raw'
  /** 默认 Break 信号时长 (ms)，默认 250 */
  breakDurationMs?: number
  /** 本地回显默认状态 */
  localEcho?: boolean
}

// ============================================================================
// 内联代理配置（FinalShell 模式：代理随服务器保存，不再依赖独立 proxies 资源）
// ============================================================================

/** 跳板机节点定义：支持引用已保存服务器资产或自定义独立输入 */
export interface JumpHostNode {
  id: string
  /** 模式：reference=引用已有服务器，inline=手动填写 */
  mode: 'reference' | 'inline'
  /** 模式为 reference 时指向目标服务器的 ID */
  targetServerId?: string
  /** 节点名称（展示用） */
  name?: string
  /** 跳板机 host */
  host?: string
  /** 跳板机端口 */
  port?: number
  /** SSH Jump 认证用户名 */
  username?: string
  /** SSH Jump 认证方式 */
  authType?: ProxyAuthType
  /** 密码（明文，保存时随 proxyConfig 一同加密入库） */
  password?: string
  /** 私钥文件路径 */
  privateKeyPath?: string
  /** 私钥 passphrase */
  privateKeyPassphrase?: string
  /** SSH Agent 身份（OpenSSH 公钥字符串） */
  agentIdentity?: string
  /** 证书文件路径（*-cert.pub） */
  certificatePath?: string
  /** 关联的 ssh_keys 表 id（content-based 连接） */
  sshKeyId?: string
  /** 关联密钥的展示名（仅前端编辑态使用，保存时不参与连接） */
  keyName?: string
  /** 连接超时（秒） */
  connectionTimeout?: number
}

/** 内联代理配置（前端编辑态使用，保存时序列化为 JSON 字符串存入 Server.proxyConfig） */
export interface ProxyConfig {
  /** 代理类型：none=直连，ssh_jump=单级跳板(旧兼容)，chain=多级链式跳板，socks5/HTTP 代理 */
  type: 'none' | 'ssh_jump' | 'chain' | 'socks5' | 'http'
  /** 多级链式跳板节点列表（按从左到右/第一跳到最后一跳跳转顺序排列） */
  hops?: JumpHostNode[]
  /** 代理名称（仅展示用） */
  name?: string
  /** 代理服务器地址（单跳兼容或 SOCKS5/HTTP 代理） */
  host?: string
  /** 代理服务器端口 */
  port?: number
  /** SSH Jump 认证用户名 */
  username?: string
  /** SSH Jump 认证方式 */
  authType?: ProxyAuthType
  /** 密码（明文，保存时随 proxyConfig 一同加密入库） */
  password?: string
  /** 私钥文件路径 */
  privateKeyPath?: string
  /** 私钥 passphrase */
  privateKeyPassphrase?: string
  /** SSH Agent 身份（OpenSSH 公钥字符串） */
  agentIdentity?: string
  /** 证书文件路径（*-cert.pub） */
  certificatePath?: string
  /** 关联的 ssh_keys 表 id（content-based 连接） */
  sshKeyId?: string
  /** 引用的私钥条目名称（展示用） */
  keyName?: string
  /** SOCKS5/HTTP 代理认证用户名 */
  proxyUsername?: string
  /** SOCKS5/HTTP 代理认证密码 */
  proxyPassword?: string
  /** 连接超时（秒） */
  connectionTimeout?: number
}

// ============================================================================
// 内联隧道配置（FinalShell 模式：端口转发随服务器保存）
// ============================================================================

/** 内联隧道配置（前端编辑态使用，保存时序列化为 JSON 字符串数组存入 Server.tunnelsConfig） */
export interface TunnelConfig {
  /** 隧道类型：local（-L）| remote（-R）| dynamic（-D，SOCKS 代理） */
  type: TunnelType
  /** 隧道名称（仅展示用） */
  name?: string
  /** 本地监听地址（如 127.0.0.1 / 0.0.0.0） */
  bindAddress: string
  /** 本地监听端口 */
  bindPort: number
  /** 目标主机（local/remote 类型；dynamic 为空） */
  targetHost?: string
  /** 目标端口（local/remote 类型；dynamic 为空） */
  targetPort?: number
}

// ============================================================================
// 代理（Proxy）—— FinalShell 式内联配置（随服务器保存，无独立资源）
// ============================================================================

/** 代理认证方式（仅 SSH Jump 类型使用） */
export type ProxyAuthType = 'password' | 'privateKey' | 'sshAgent' | 'certificate'

// ============================================================================
// 隧道（Tunnel）—— FinalShell 式内联配置（随服务器保存，无独立资源）
// ============================================================================

/** 隧道类型 */
export type TunnelType = 'local' | 'remote' | 'dynamic'

export interface SshKey {
  id: string
  name: string
  /**
   * 密钥类型：'private'（私钥型）| 'certificate'（证书型）。
   * 缺省为 'private'（兼容旧数据/旧前端）。
   */
  keyType?: 'private' | 'certificate'
  /** 私钥文件路径（阶段 2 兼容旧路径模式；阶段 3 后可为空，仅用于显示） */
  privateKeyPath?: string
  /**
   * 私钥解密密码。
   * - 后端返回时为占位符 "•••••"（如有），明文不返回前端
   * - 前端编辑时若为占位符则视为"不修改"
   */
  privateKeyPassphrase?: string
  publicKey?: string
  /**
   * OpenSSH 证书文件路径（*-cert.pub）。
   * 仅 keyType === 'certificate' 时有意义。
   */
  certificatePath?: string
  notes?: string
  createdAt: number
  updatedAt: number
}

/**
 * 新建 SSH 密钥时的输入结构（与后端 SshKeyInput 对应）。
 * 阶段 2：仅传路径，content 留空（后端加密存储空字符串）
 * 阶段 3：选完文件后读取内容并填充 privateKeyContent / certificateContent
 */
export interface SshKeyInput {
  id: string
  name: string
  keyType?: 'private' | 'certificate'
  privateKeyPath?: string
  /** 阶段 3：私钥文件内容（明文，后端加密入库） */
  privateKeyContent?: string
  privateKeyPassphrase?: string
  publicKey?: string
  certificatePath?: string
  /** 阶段 3：证书文件内容（明文，后端加密入库） */
  certificateContent?: string
  notes?: string
}

/**
 * 更新 SSH 密钥时的部分字段（与后端 SshKeyUpdate 对应）。
 * 敏感字段（passphrase / privateKeyContent / certificateContent）：
 * - undefined：不修改
 * - "•••••" 占位符：不修改
 * - 空字符串：清空
 * - 其他：用明文加密入库
 */
export type SshKeyUpdate = Partial<Omit<SshKeyInput, 'id' | 'createdAt' | 'updatedAt'>>

export interface ServerStatus {
  serverId: string
  connected: boolean
  osInfo?: string
  cpuCores?: number
  totalMemory?: number
}

export interface SystemMetrics {
  // CPU 差分指标（百分比 0~100）
  cpuUsage: number           // 总使用率 (usr+sys+iowait+steal)
  cpuUsr: number             // 用户态 + nice
  cpuSys: number             // 系统态 + irq + softirq
  cpuIowait: number          // IO 等待
  cpuSteal: number           // 虚拟化偷取
  cpuIdle: number            // 空闲
  cpuLoad: number[]
  // 内存指标
  memoryUsed: number
  memoryTotal: number
  memPressure: number        // 内存压力 (0~1): 1 - MemAvailable/MemTotal
  memAvailableBytes: number  // 可用内存 (字节)
  // 细分内存（单位 GB）：5 个互斥分类，总和 = memoryTotal
  memBreakdown: {
    used: number           // 应用层占用（AnonPages，匿名页；Shmem 已计入 cache 避免重复）
    systemReserved: number // 内核自身占用 = total - free - buffers - cache - used
    buffers: number        // 块设备缓冲
    cache: number          // 页面缓存 + 可回收 slab + tmpfs（含 SReclaimable/Shmem）
    free: number           // 完全空闲
  }
  // 原始数据 (KB)，供前端自定义展示
  memRawKb: {
    total: number; free: number; buffers: number
    cached: number; available: number; sreclaimable: number; shared: number
  }
  swapUsed: number
  swapTotal: number
  // 磁盘使用
  disks: DiskInfo[]
  // 磁盘 I/O 差分指标
  diskIo: DiskIoInfo[]
  // 网络
  network: NetworkInfo[]
  // TCP 重传率（系统级，0~1，来自 /proc/net/snmp RetransSegs/OutSegs 差分）
  tcpRetransRate: number
  tcpEstablished?: number
  tcpListen?: number
  tcpTimeWait?: number
  // 系统
  uptime: number
  osName: string
  kernelVersion: string
  totalProcesses: number
  zombieProcesses: number
}

export interface DiskInfo {
  filesystem: string
  mountPoint: string
  total: number
  used: number
  available: number
  usePercent: number
  /** 挂载点分类: disk=物理分区, tmpfs=内存文件系统, virtual=虚拟文件系统, hide=容器/快照 */
  category: 'disk' | 'tmpfs' | 'virtual' | 'hide'
}

export interface DiskIoInfo {
  device: string
  readIops: number
  writeIops: number
  readMbps: number          // 读吞吐 MB/s
  writeMbps: number         // 写吞吐 MB/s
  util: number              // 利用率 0~1
  await: number
  iowait: number
  // 保留旧字段兼容
  readKbps: number
  writeKbps: number
}

export interface NetworkInfo {
  interface: string
  rxKbps: number
  txKbps: number
  rxPackets: number
  txPackets: number
  rxErrors: number
  txErrors: number
  rxDrop: number
  txDrop: number
  /** 丢包率（0~1，Δdrop/Δpackets 差分计算） */
  dropRate: number
}

export interface ServiceInfo {
  name: string
  description: string
  active: boolean
  subState: string
  /** 开机自启（真实 UnitFileState=enabled，不再用 active 冒充） */
  enabled: boolean
  cpuUsage?: number
  memoryUsage?: number
  // === 服务模块精细化扩展（P0）===
  /** LoadState: loaded / not-found / masked / error / bad-setting */
  loadState?: string
  /** ActiveState: active / inactive / failed / activating / deactivating / reloading */
  activeState?: string
  /** UnitFileState: enabled / disabled / static / masked / indirect / generated / unknown */
  enabledState?: string
  /** 主进程 PID（0 表示无主进程） */
  mainPid?: number | null
  /** 运行时长（秒） */
  uptimeSeconds?: number | null
  /** Unit 文件路径 */
  fragmentPath?: string | null
  /** 运行用户 */
  user?: string | null
  /** Restart 策略 */
  restartPolicy?: string | null
  /** 失败结果：exit-code / signal / timeout / start-limit-hit */
  result?: string | null
  /** 主进程退出码 */
  execMainStatus?: number | null
  /** 最近重启次数 */
  nRestarts?: number | null
  /** CPU 使用率（按需采集） */
  cpuPercent?: number | null
  /** 内存字节（按需采集） */
  memoryBytes?: number | null
}

/** 服务管理能力探测结果（驱动前端能力降级） */
export interface ServiceCapabilities {
  /** 存在 systemctl */
  systemd: boolean
  /** 存在 journalctl（无则日志 Tab 降级） */
  journal: boolean
  /** systemd 正在运行（非 degraded / 容器内未启动） */
  systemRunning: boolean
  /** sudo 免密可用（否则操作可能失败并提示授权） */
  sudoNoPass: boolean
  /** 存在 SysV service 命令 */
  sysv: boolean
}

/** systemctl show 属性表（Key -> Value） */
export type ServiceProps = Record<string, string>

/** 服务日志查询参数 */
export interface ServiceLogQuery {
  /** 最近 N 行，默认 200 */
  lines?: number
  /** 时间范围，如 '30 min ago' */
  since?: string
  /** 级别：emerg/alert/crit/err/warning/notice/info/debug */
  priority?: string
}

/** 后端返回的原始资源快照（cpuNs 为 CPU 累计纳秒，需两次采样求差算百分比） */
export interface ServiceResourceRaw {
  memoryBytes: number
  tasks: number
  cpuNs: number
}

/** unit -> 原始资源快照 */
export type ServiceResourceRawMap = Record<string, ServiceResourceRaw>

/** 前端计算后的服务资源（列表展示用） */
export interface ServiceResource {
  memoryBytes: number
  tasks: number
  cpuPercent: number
}

/** 依赖单元的运行时状态（用于依赖节点着色） */
export interface ServiceDependencyState {
  activeState: string
  subState: string
  loadState: string
}

/** 服务依赖关系（P1） */
export interface ServiceDependencies {
  requires: string[]
  wants: string[]
  requisite: string[]
  bindsTo: string[]
  partOf: string[]
  conflicts: string[]
  after: string[]
  before: string[]
  requiredBy: string[]
  wantedBy: string[]
  /** unit -> 状态快照（后端一次批量查询返回） */
  states?: Record<string, ServiceDependencyState>
}

export interface ProcessInfo {
  pid: number
  /** 父进程 PID，用于构建进程树 */
  ppid: number
  user: string
  cpu: number
  memory: number
  vsz: number
  rss: number
  stat: string
  /** 调度优先级（nice 值） */
  nice: number
  /** 进程启动时长（秒，来自 ps etimes），与 PID 组成稳定标识 ProcessKey 防止 PID 复用误杀 */
  startTimeTicks: number
  start: string
  /** 进程所属 cgroup 路径，用于跨模块关联（systemd 服务 / Docker 容器）；Windows 为空 */
  cgroup: string
  command: string
}

export interface PortInfo {
  protocol: string
  localAddress: string
  port: number
  state: string
  processName: string
  pid: number
}

export interface DockerContainer {
  id: string
  name: string
  image: string
  status: string
  state: string
  ports: string
  createdAt: string
}

export interface NetworkDiagnosisResult {
  target: string
  checks: DiagnosisCheck[]
}

export interface DiagnosisCheck {
  type: 'dns' | 'ping' | 'tcp' | 'http'
  label: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'timeout'
  output?: string
  summary?: string
  duration?: number
}

export interface LogBookmark {
  id: string
  serverId: string
  path: string
  alias: string
  createdAt?: number
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifiedTime: string
  permissions: string
  owner?: string
  group?: string
  uid?: number
  gid?: number
}

export type WorkspaceModule = 'overview' | 'terminal' | 'services' | 'processes' | 'network' | 'ports' | 'files' | 'docker' | 'rdp' | 'bmc' | 'forward'

export interface NavigationContext {
  searchQuery?: string
  view?: 'overview' | 'containers' | 'images' | 'networks' | 'volumes' | 'compose'
  subTab?: 'listening' | 'forward'
}

export interface WorkspaceTab {
  id: string
  serverId: string
  serverName: string
  module: WorkspaceModule
  title: string
  /** Optional command to execute when a terminal tab first connects (e.g. docker exec) */
  initialCommand?: string
  /** 临时重命名（仅作用于当前会话，不持久化） */
  tempTitle?: string
  /** 锁定状态：锁定后不能被关闭 */
  locked?: boolean
  /** Tab 颜色：当前会话内使用；其来源是 store 中按 serverId 持久化的
   *  tabColors 映射，打开同一服务器工作台时自动套用（详见 store.setTabColor）。 */
  color?: string
  /** 所属分屏分组 ID */
  groupId?: string
  /** 所属分屏 Workspace ID（null 表示独立顶层标签） */
  workspaceId?: string | null
}

/** SFTP 文件管理器视图模式：'list' 列表 | 'large' 大图标 | 'medium' 中图标 | 'small' 小图标 */
export type SftpViewMode = 'list' | 'large' | 'medium' | 'small'

/** 分屏 Workspace 定义 */
export interface WorkspaceDef {
  id: string
  name: string
  layout: SplitLayoutNode
  locked?: boolean
  color?: string
}

// ── 分屏布局（T 字型二叉树分屏） ──────────────────────────────────────────

/** 分屏方向：row = 左右排列，column = 上下排列 */
export type SplitDirection = 'row' | 'column'

/** 拖拽落点区域：四边缘 = 分屏，center = 移入该分组 */
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

/** 布局树叶子节点：一个 tab 分组 */
export interface GroupLeafNode {
  type: 'group'
  groupId: string
}

/**
 * 布局树内部节点：二分分割。
 * 每次分割只把一个窗格拆成两个，分割线交点呈 T 字形（T 字型分屏）。
 */
export interface SplitContainerNode {
  type: 'split'
  id: string
  direction: SplitDirection
  /** 第一个子节点占比 (0-1)。存比例而非像素，容器尺寸变化时按比例自适应分配 */
  ratio: number
  children: [SplitLayoutNode, SplitLayoutNode]
}

export type SplitLayoutNode = GroupLeafNode | SplitContainerNode

/** tab 分组：分屏后每个分组拥有独立的标签栏与组内活跃 tab */
export interface TabGroup {
  id: string
  /** 组内当前显示的标签 */
  activeTabId: string | null
}

/** 拖拽分屏的实时落点（瞬态，不持久化） */
export interface SplitDropTarget {
  groupId: string
  zone: DropZone
}


/**
 * 服务器内联密钥条目（Xshell / FinalShell 模式：每个服务器可独立维护多个私钥或证书）
 */
export interface ServerKeyEntry {
  id: string
  name: string
  keyType: 'private' | 'certificate'
  privateKeyPath?: string
  privateKeyContent?: string
  passphrase?: string
  certificatePath?: string
  certificateContent?: string
  createdAt?: number
}

export * from './network'

