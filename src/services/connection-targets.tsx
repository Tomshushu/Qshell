/**
 * 连接协议与连接目标类型注册表（前端抽象层）
 *
 * 与后端 `src-tauri/src/connection/mod.rs` 的 `TargetType` / `ConnectionProtocol` 对应。
 *
 * 设计目标：
 * 1. 按“连接方式与能力类型”抽象连接目标（Linux、Windows、网络设备、带外管理、串口通信）。
 * 2. `linux` 是标准 SSH / Linux 目标的默认分类；`unix`（AIX / HP-UX / Solaris）与
 *    `xinchuang`（UOS / 麒麟 + 龙芯 / ARM）保留独立分类便于识别与筛选，
 *    但复用同一套 Linux SSH 命令实现（后端 TARGET_SPECS 均为 SSH_HOST_CAPS）。
 * 3. 每个目标类型声明自己的默认端口 / 用户名 / 认证方式 / 可用工作区模块，
 *    对话框与模块标签页据此动态渲染。
 */

import {
  Terminal,
  Router,
  Cpu,
  Cable,
  Server,
  Boxes,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { WorkspaceModule } from '@/types'
import { WindowsIcon } from '@/components/ui/windows-icon'

// ============================================================================
// 类型定义
// ============================================================================

/** 连接目标类型（与后端 TargetType 枚举的 lowercase 字符串对应） */
export type ConnectionTargetType =
  | 'linux'
  | 'windows'
  | 'network'
  | 'bmc'
  | 'serial'
  | 'unix'
  | 'xinchuang'
  | 'esxi'
  | 'kubernetes'

/** 连接协议（与后端 ConnectionProtocol 枚举的 lowercase 字符串对应） */
export type ConnectionProtocol = 'ssh' | 'rdp' | 'winrm' | 'telnet' | 'vnc' | 'serial' | 'redfish' | 'https' | 'k8s'

/** 认证方式（SSH 支持密码、私钥、证书与 Agent；其他协议由各自客户端处理） */
export type AuthMethod = 'password' | 'privateKey' | 'sshAgent' | 'certificate'

/**
 * 能力位，与后端 `src-tauri/src/connection/mod.rs` 的 `CapabilityFlags` 一一对应。
 * 两侧均有镜像矩阵单测，新增设备类型必须同步两处。
 */
export interface TargetCapabilities {
  /** 可走 SSH 连接池（SFTP / 代理 / known_hosts 的基础） */
  sshBacked: boolean
  /** 内嵌 xterm 终端会话 */
  terminal: boolean
  /** 系统指标采集与 HUD */
  metrics: boolean
  /** 文件 / SFTP 模块 */
  files: boolean
  /** AI 只读探针 */
  probe: boolean
  /** 允许覆盖 TLS 证书校验（HTTPS 设备，决策 4 的泛化基础） */
  tlsCertOverride: boolean
  /** 需要 host / 端口（本地终端为 false） */
  requiresHost: boolean
}

/** 工作台连接形态，用于替换各组件中散落的 isXxxServer 布尔 */
export type ConnectionKind = 'ssh' | 'telnet' | 'serial' | 'redfish' | 'external' | 'https' | 'k8s'

/** 目标类型规格 —— 描述该类型的目标在 UI 与行为上的差异 */
export interface TargetTypeSpec {
  /** 唯一标识，与后端枚举字符串一致 */
  id: ConnectionTargetType
  /** i18n 标签键（在 locales 中定义） */
  labelKey: string
  /** 列表/选择器中展示的图标（lucide-react 图标或自定义 SVG 组件） */
  icon: ComponentType<{ className?: string }>
  /** 图标是否自带彩色（true 时容器不加 text-primary 着色，用中性背景） */
  iconColored?: boolean
  /** 默认端口 */
  defaultPort: number
  /** 默认用户名 */
  defaultUsername: string
  /** 默认认证方式 */
  defaultAuthType: AuthMethod
  /** 该类型支持的工作区模块（未列出的模块在标签页中隐藏） */
  availableModules: WorkspaceModule[]
  /** 该类型支持的连接协议（控制协议下拉选项） */
  supportedProtocols: ConnectionProtocol[]
  /**
   * 是否已正式支持（false 表示仅 UI 预留，连接/命令实现待后续补齐）。
   * 置为 true 前必须确认后端 `TARGET_SPECS` 已有同 id 的完整规格与能力位，
   * 否则保存时会被宽松解析静默退化成 Linux + SSH。
   */
  enabled: boolean
}

/** 协议规格 */
export interface ProtocolSpec {
  id: ConnectionProtocol
  labelKey: string
  /** 默认端口 */
  defaultPort: number
  /** 该协议决定的连接形态 */
  kind: ConnectionKind
  /** 该协议对目标能力位的覆盖（例如 RDP 关闭终端/指标/文件） */
  capabilityOverrides?: Partial<TargetCapabilities>
}

// ============================================================================
// 注册表
// ============================================================================

/** Linux 全部模块（含统信 UOS、银河麒麟等 Linux 发行版） */
const LINUX_MODULES: WorkspaceModule[] = [
  'overview', 'terminal', 'files', 'docker',
  'services', 'processes', 'network', 'ports',
]

/** Windows 通过 OpenSSH 连接时复用标准运维工作区；RDP 仍显示独立桌面模块。 */
const WINDOWS_MODULES: WorkspaceModule[] = [
  'terminal', 'overview', 'files', 'services', 'processes', 'network', 'ports', 'rdp',
]

/**
 * 连接目标类型注册表（按连接方式与能力抽象分类）
 *
 * `unix` / `xinchuang` 于 Phase 2-A 正式启用：后端已把它们当完整 SSH 目标
 * （`TARGET_SPECS` 的能力位与 linux 一致），命令 / OS 探测 / 路径分派都走 Linux 实现；
 * 单列只为让用户按设备族识别与筛选，不代表另有一套传输层。
 */
export const CONNECTION_TARGETS: TargetTypeSpec[] = [
  {
    id: 'linux',
    labelKey: 'ct_linux',
    icon: Terminal,
    defaultPort: 22,
    defaultUsername: 'root',
    defaultAuthType: 'password',
    availableModules: LINUX_MODULES,
    supportedProtocols: ['ssh'],
    enabled: true,
  },
  {
    id: 'unix',
    labelKey: 'ct_unix',
    icon: Terminal,
    defaultPort: 22,
    defaultUsername: 'root',
    defaultAuthType: 'password',
    availableModules: LINUX_MODULES,
    supportedProtocols: ['ssh'],
    enabled: false,
  },
  {
    id: 'xinchuang',
    labelKey: 'ct_xinchuang',
    icon: Terminal,
    defaultPort: 22,
    defaultUsername: 'root',
    defaultAuthType: 'password',
    availableModules: LINUX_MODULES,
    supportedProtocols: ['ssh'],
    enabled: false,
  },
  {
    id: 'windows',
    labelKey: 'ct_windows',
    icon: WindowsIcon,
    iconColored: true,
    defaultPort: 3389,
    defaultUsername: 'Administrator',
    defaultAuthType: 'password',
    availableModules: WINDOWS_MODULES,
    supportedProtocols: ['rdp', 'ssh'],
    enabled: true,
  },
  {
    id: 'network',
    labelKey: 'ct_network',
    icon: Router,
    defaultPort: 22,
    defaultUsername: 'admin',
    defaultAuthType: 'password',
    availableModules: ['terminal'],
    supportedProtocols: ['ssh', 'telnet'],
    enabled: true,
  },
  {
    id: 'bmc',
    labelKey: 'ct_bmc',
    icon: Cpu,
    defaultPort: 443,
    defaultUsername: 'admin',
    defaultAuthType: 'password',
    availableModules: ['bmc'],
    supportedProtocols: ['redfish'],
    enabled: true,
  },
  {
    id: 'serial',
    labelKey: 'ct_serial',
    icon: Cable,
    defaultPort: 115200,
    defaultUsername: '',
    defaultAuthType: 'password',
    availableModules: ['terminal'],
    supportedProtocols: ['serial'],
    enabled: true,
  },
  {
    id: 'esxi',
    labelKey: 'ct_esxi',
    icon: Server,
    defaultPort: 443,
    defaultUsername: 'root',
    defaultAuthType: 'password',
    // Phase 2-B-4：复用「设备管理」工作台容器（module key = bmc），
    // workspace.tsx 按 targetType 分派渲染 EsxiModule / BmcModule。
    availableModules: ['bmc'],
    supportedProtocols: ['https'],
    enabled: false,
  },
  {
    id: 'kubernetes',
    labelKey: 'ct_kubernetes',
    icon: Boxes,
    defaultPort: 6443,
    defaultUsername: '',
    defaultAuthType: 'password',
    // Phase 2-C：复用「设备管理」容器，workspace.tsx 按 targetType 分派渲染。
    availableModules: ['bmc'],
    supportedProtocols: ['k8s'],
    enabled: false,
  },
]

const SSH_HOST_CAPS: TargetCapabilities = {
  sshBacked: true, terminal: true, metrics: true, files: true,
  probe: true, tlsCertOverride: false, requiresHost: true,
}
const NETWORK_CAPS: TargetCapabilities = {
  sshBacked: true, terminal: true, metrics: false, files: false,
  probe: false, tlsCertOverride: false, requiresHost: true,
}
const REDFISH_CAPS: TargetCapabilities = {
  sshBacked: false, terminal: false, metrics: false, files: false,
  probe: false, tlsCertOverride: true, requiresHost: true,
}
const SERIAL_CAPS: TargetCapabilities = {
  sshBacked: false, terminal: true, metrics: false, files: false,
  probe: false, tlsCertOverride: false, requiresHost: false,
}
/** 通用 HTTPS 设备（ESXi / vCenter / Proxmox），与后端 HTTPS_DEVICE_CAPS 镜像 */
const HTTPS_DEVICE_CAPS: TargetCapabilities = {
  sshBacked: false, terminal: false, metrics: false, files: false,
  probe: false, tlsCertOverride: true, requiresHost: true,
}
/** Kubernetes API Server，与后端 K8S_CAPS 镜像 */
const K8S_CAPS: TargetCapabilities = {
  sshBacked: false, terminal: false, metrics: false, files: false,
  probe: false, tlsCertOverride: true, requiresHost: true,
}

/** 前端能力表：与后端 `TARGET_SPECS.capabilities` 镜像，由镜像矩阵单测校验 */
export const TARGET_CAPABILITIES: Record<ConnectionTargetType, TargetCapabilities> = {
  linux: SSH_HOST_CAPS,
  windows: SSH_HOST_CAPS,
  network: NETWORK_CAPS,
  unix: SSH_HOST_CAPS,
  bmc: REDFISH_CAPS,
  serial: SERIAL_CAPS,
  xinchuang: SSH_HOST_CAPS,
  esxi: HTTPS_DEVICE_CAPS,
  kubernetes: K8S_CAPS,
}

const EXTERNAL_OVERRIDES: Partial<TargetCapabilities> = {
  sshBacked: false, terminal: false, metrics: false, files: false, probe: false,
}
const SERIAL_OVERRIDES: Partial<TargetCapabilities> = {
  sshBacked: false, terminal: true, metrics: false, files: false,
  probe: false, tlsCertOverride: false, requiresHost: false,
}
const TELNET_OVERRIDES: Partial<TargetCapabilities> = {
  metrics: false, files: false, probe: false,
}
const REDFISH_OVERRIDES: Partial<TargetCapabilities> = {
  sshBacked: false, terminal: false, metrics: false, files: false,
  probe: false, tlsCertOverride: true,
}

/** 连接协议注册表 */
export const CONNECTION_PROTOCOLS: ProtocolSpec[] = [
  { id: 'ssh', labelKey: 'cp_ssh', defaultPort: 22, kind: 'ssh' },
  { id: 'serial', labelKey: 'cp_serial', defaultPort: 115200, kind: 'serial', capabilityOverrides: SERIAL_OVERRIDES },
  { id: 'rdp', labelKey: 'cp_rdp', defaultPort: 3389, kind: 'external', capabilityOverrides: EXTERNAL_OVERRIDES },
  { id: 'winrm', labelKey: 'cp_winrm', defaultPort: 5985, kind: 'external', capabilityOverrides: EXTERNAL_OVERRIDES },
  { id: 'telnet', labelKey: 'cp_telnet', defaultPort: 23, kind: 'telnet', capabilityOverrides: TELNET_OVERRIDES },
  { id: 'vnc', labelKey: 'cp_vnc', defaultPort: 5900, kind: 'external', capabilityOverrides: EXTERNAL_OVERRIDES },
  { id: 'redfish', labelKey: 'cp_redfish', defaultPort: 443, kind: 'redfish', capabilityOverrides: REDFISH_OVERRIDES },
  { id: 'https', labelKey: 'cp_https', defaultPort: 443, kind: 'https' },
  { id: 'k8s', labelKey: 'cp_k8s', defaultPort: 6443, kind: 'k8s' },
]

// ============================================================================
// 查询辅助函数
// ============================================================================

/** 按 id 获取目标类型规格，未找到回退为 linux */
export function getTargetTypeSpec(id?: string | null): TargetTypeSpec {
  if (id) {
    const found = CONNECTION_TARGETS.find((t) => t.id === id)
    if (found) return found
  }
  return CONNECTION_TARGETS[0] // linux
}

/**
 * 复用「设备管理」工作台容器（module key = bmc）的目标类型。
 * Phase 2-C：新增设备族时只需在此登记 + 提供对应模块组件，
 * 不必再逐个修改 workspace / status-bar / 探针 / 双击分派。
 */
export const DEVICE_MANAGED_TARGETS: readonly ConnectionTargetType[] = [
  'bmc', 'esxi', 'kubernetes',
]

export function isDeviceManagedTarget(targetType?: string | null): boolean {
  return DEVICE_MANAGED_TARGETS.includes(getTargetTypeSpec(targetType).id as ConnectionTargetType)
}

/** 设备管理容器在不同目标类型下的模块标签键 */
export function deviceModuleLabelKey(targetType?: string | null): string {
  switch (getTargetTypeSpec(targetType).id) {
    case 'esxi': return 'module_esxi'
    case 'kubernetes': return 'module_k8s'
    default: return 'module_bmc'
  }
}

/**
 * 设备管理容器在状态栏的文案键。
 * BMC 与未知 / 脏数据一律沿用历史键，保证既有资产与旧数据零行为变化。
 */
export function deviceStatusKeys(targetType?: string | null): {
  readyKey: string
  modeKey: string
} {
  switch (getTargetTypeSpec(targetType).id) {
    case 'esxi': return { readyKey: 'status_esxi_ready', modeKey: 'status_esxi_mode' }
    case 'kubernetes': return { readyKey: 'status_k8s_ready', modeKey: 'status_k8s_mode' }
    default: return { readyKey: 'status_bmc_ready', modeKey: 'status_bmc_mode' }
  }
}

/** 按 id 获取协议规格，未找到回退为 ssh */
export function getProtocolSpec(id?: string | null): ProtocolSpec {
  if (id) {
    const found = CONNECTION_PROTOCOLS.find((p) => p.id === id)
    if (found) return found
  }
  return CONNECTION_PROTOCOLS[0] // ssh
}

/**
 * 获取已启用的目标类型 —— 新建对话框选择器与仪表盘设备类型筛选的唯一入口。
 * 新增设备类型只需在 `CONNECTION_TARGETS` 置 `enabled: true`，两处 UI 自动跟随。
 */
export function getEnabledTargetTypes(): TargetTypeSpec[] {
  return CONNECTION_TARGETS.filter((t) => t.enabled)
}

/** 判断指定目标类型是否支持某工作区模块 */
export function isModuleAvailable(targetType: string | null | undefined, module: WorkspaceModule): boolean {
  return getTargetTypeSpec(targetType).availableModules.includes(module)
}

/**
 * 解析有效协议：旧数据的 protocol 缺省一律按 ssh 处理（与 src/types/index.ts 的契约一致）。
 * 只有「注册表里不含 ssh 形态」的目标（串口 / BMC / HTTPS 设备）才保留自身主协议，
 * 否则 Windows 会在 protocol 缺省时被误判成 rdp / external，平白丢掉 SSH 系模块。
 * Phase 2-B-1 起由 supportedProtocols 判定而非枚举具体 id，新增设备类型无需再改这里。
 */
function effectiveProtocol(
  targetType?: string | null,
  protocol?: string | null,
): ConnectionProtocol {
  if (protocol) return protocol as ConnectionProtocol
  const spec = getTargetTypeSpec(targetType)
  if (!spec.supportedProtocols.includes('ssh')) {
    return spec.supportedProtocols[0] as ConnectionProtocol
  }
  return 'ssh'
}

/** 取得目标在指定协议下的最终能力位（目标能力表 + 协议覆盖） */
export function getTargetCapabilities(
  targetType?: string | null,
  protocol?: string | null,
): TargetCapabilities {
  const spec = getTargetTypeSpec(targetType)
  const protoId = effectiveProtocol(targetType, protocol)
  return {
    ...TARGET_CAPABILITIES[spec.id],
    ...getProtocolSpec(protoId).capabilityOverrides,
  }
}

/** 取得连接形态，供各组件替换散落的 isXxxServer 硬编码判断 */
export function getConnectionKind(
  targetType?: string | null,
  protocol?: string | null,
): ConnectionKind {
  return getProtocolSpec(effectiveProtocol(targetType, protocol)).kind
}

/** 能力位查询快捷方式 */
export function hasCapability(
  targetType: string | null | undefined,
  protocol: string | null | undefined,
  key: keyof TargetCapabilities,
): boolean {
  return getTargetCapabilities(targetType, protocol)[key]
}

/** 兼容既有组件布尔命名的派生结果（Phase 0：把散落判断集中到一处） */
export interface ServerConnectionFlags {
  connectionKind: ConnectionKind
  isBmcServer: boolean
  /** 复用「设备管理」工作台容器，且不建立 SSH 连接（BMC / ESXi / K8s） */
  isDeviceManagedServer: boolean
  isWindowsServer: boolean
  isSerialServer: boolean
  isRdpServer: boolean
  isTelnetServer: boolean
  isNetworkServer: boolean
  supportsMetrics: boolean
  supportsFiles: boolean
  supportsProbe: boolean
  supportsProxy: boolean
  supportsTlsCertOverride: boolean
  requiresHost: boolean
}

/**
 * 一次性派生组件所需的全部类型布尔。
 * 现有组件只需把原先逐处书写的 `targetType === '...'` 定义替换为解构此结果，
 * 使用点保持不变，因此是语义等价的零风险替换。
 */
export function getServerConnectionFlags(
  targetType?: string | null,
  protocol?: string | null,
  osType?: string | null,
): ServerConnectionFlags {
  const spec = getTargetTypeSpec(targetType)
  const connectionKind = getConnectionKind(targetType, protocol)
  const caps = getTargetCapabilities(targetType, protocol)
  return {
    connectionKind,
    isBmcServer: spec.id === 'bmc',
    isDeviceManagedServer: isDeviceManagedTarget(targetType),
    isWindowsServer: spec.id === 'windows',
    // osType 兜底来自标签条的历史行为：部分旧资产靠 osType 标记串口
    isSerialServer:
      spec.id === 'serial' || connectionKind === 'serial' || osType === 'serial',
    // 精确等价于重构前的 protocol === 'rdp'（含早期脏数据 targetType === 'rdp'）。
    // 刻意不用 connectionKind === 'external'：那会把 winrm / vnc 一并判成 RDP，
    // 扩大排除范围并改变 connId / 模块可见性。
    isRdpServer: protocol === 'rdp' || targetType === 'rdp',
    // 精确等价于 protocol === 'telnet'：不夹带其他形态，供终端三路分派使用
    isTelnetServer: connectionKind === 'telnet',
    isNetworkServer: spec.id === 'network',
    supportsMetrics: caps.metrics,
    supportsFiles: caps.files,
    supportsProbe: caps.probe,
    supportsProxy: caps.sshBacked,
    supportsTlsCertOverride: caps.tlsCertOverride,
    requiresHost: caps.requiresHost,
  }
}

/**
 * Phase 1：多协议列表的统一解析入口。
 *
 * 历史上 `protocols` 有三种形态：适配层已规范化的 `string[]`、旧数据里的 JSON
 * 字符串、以及缺省 / 空数组；模块可见性与表单回填各自实现过一遍解析。这里收敛为
 * 唯一真源，并与后端 `normalize_protocols` 的「至少包含主协议」语义对齐。
 *
 * - 只保留非空字符串，trim + 小写 + 去重；
 * - 解析失败 / 非数组 / 空结果时回退为 `[protocol || 'ssh']`，可用 `allowEmpty` 关闭；
 * - 正常单协议资产（如 `['ssh']`）输出完全不变。
 */
export interface ServerProtocolSource {
  protocols?: unknown
  protocol?: unknown
}

export function getServerProtocols(
  source?: ServerProtocolSource | null,
  options?: { allowEmpty?: boolean },
): string[] {
  const raw = source?.protocols
  let list: unknown[] = []
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) list = parsed
    } catch {
      // 非法 JSON 视为「无协议数据」，走下方主协议回退
    }
  } else if (Array.isArray(raw)) {
    list = raw
  }

  const result: string[] = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const name = item.trim().toLowerCase()
    if (name && !result.includes(name)) result.push(name)
  }

  if (result.length === 0 && !options?.allowEmpty) {
    const rawProtocol = source?.protocol
    const primary = typeof rawProtocol === 'string' && rawProtocol.trim()
      ? rawProtocol.trim().toLowerCase()
      : 'ssh'
    return [primary]
  }
  return result
}

/**
 * Phase 1-B：双击 / 打开服务器时应走的动作。
 *
 * 重构前 `dashboard.tsx`（批量打开、双击）、`tab-strip.tsx`、
 * `use-server-card-actions.ts` 四处各自复制了同一套「按端口」规则：Windows 有
 * SSH 端口走终端、否则有 RDP 端口走系统客户端、都没有则提示；BMC 走带外管理；
 * 其余走终端。这里收敛为唯一真源，并让 `protocols` 声明参与判断：
 *
 * - `protocols` 缺省或为空时完全沿用旧的按端口规则（旧数据零行为变化）；
 * - `protocols` 明确声明时，只有被声明的协议才可用（例如只声明 rdp 的 Windows
 *   资产即使残留 SSH 端口也不会误开终端）；
 * - 多协议资产仍保持「SSH 优先」的历史优先级。
 */
export type ServerOpenAction = 'terminal' | 'bmc' | 'rdp' | 'no-port'

export interface ServerOpenInput extends ServerProtocolSource {
  targetType?: string | null
  protocol?: string | null
  port?: number | null
  rdpPort?: number | null
}

export function resolveServerOpenAction(server: ServerOpenInput): ServerOpenAction {
  const flags = getServerConnectionFlags(server.targetType, server.protocol)
  if (flags.isWindowsServer) {
    const declared = getServerProtocols(server, { allowEmpty: true })
    const hasSshPort = Boolean(server.port && server.port > 0)
    const hasRdpPort = Boolean(server.rdpPort && server.rdpPort > 0)
    const hasSsh = hasSshPort && (declared.length === 0 || declared.includes('ssh'))
    const hasRdp = hasRdpPort && (declared.length === 0 || declared.includes('rdp'))
    if (hasSsh) return 'terminal'
    if (hasRdp) return 'rdp'
    return 'no-port'
  }
  // Phase 2-C：设备管理目标统一走「设备管理」工作台容器（BMC / ESXi / K8s），
  // 都不建立 SSH 连接；保留 'bmc' 动作值以复用既有四处打开分派。
  if (flags.isDeviceManagedServer) return 'bmc'
  return 'terminal'
}

/**
 * Phase 1-C：模块栏可见性规则的唯一真源。
 *
 * 历史规则散在 `module-tabs.tsx` 的 filter 里：先按 targetType 过滤；纯 RDP
 * 工作台只挂载 rdp 模块；其余按 protocols 决定 rdp / terminal / files / forward。
 *
 * 唯一行为变化：设备显式声明了多个协议时，不再被「纯 RDP」一刀切隐藏 SSH 系
 * 模块，用户可在同一工作台内切换到 SSH 终端 / 文件 / 远程桌面。单协议资产与
 * `protocols` 缺省的旧资产逐模块等价（测试里有新旧规则矩阵断言）。
 */
export interface ModuleVisibilityInput extends ServerProtocolSource {
  targetType?: string | null
  protocol?: string | null
}

export function isModuleVisibleForServer(
  module: WorkspaceModule,
  server: ModuleVisibilityInput,
): boolean {
  if (!isModuleAvailable(server.targetType, module)) return false
  const flags = getServerConnectionFlags(server.targetType, server.protocol)
  const protocols = getServerProtocols(server)
  // 旧数据 protocols 缺省 / 单元素时保持「纯 RDP 只显示 rdp」的历史行为
  const declared = getServerProtocols(server, { allowEmpty: true })
  if (flags.isRdpServer && declared.length <= 1) return module === 'rdp'
  if (module === 'rdp') return protocols.includes('rdp')
  if (module === 'terminal') {
    return protocols.includes('ssh')
      || protocols.includes('telnet')
      || protocols.includes('serial')
      || flags.isSerialServer
      || flags.isNetworkServer
  }
  if (module === 'files' || module === 'forward') return protocols.includes('ssh')
  return true
}

/**
 * Phase 1-D：按表单当前填写的端口 / 主协议推断启用的协议列表。
 * 保存逻辑与「已启用协议」展示共用同一份规则，避免 UI 显示与实际写入 DB 的
 * `protocols` 不一致。规则与重构前 `server-form-dialog.tsx` 的推断逐项等价：
 * Windows 按 SSH / RDP 端口是否填写决定，其余目标恒为当前主协议。
 */
export interface ProtocolInferenceInput {
  targetType?: string | null
  protocol?: string | null
  sshPort?: string | number | null
  rdpPort?: string | number | null
}

export function inferServerProtocols(input: ProtocolInferenceInput): string[] {
  if (input.targetType === 'windows') {
    const list: string[] = []
    if (String(input.sshPort ?? '').trim()) list.push('ssh')
    if (String(input.rdpPort ?? '').trim()) list.push('rdp')
    // 两个端口都为空时保存会被校验拦下，这里仅给展示一个稳定值
    return list.length > 0 ? list : ['rdp']
  }
  return [input.protocol || 'ssh']
}
