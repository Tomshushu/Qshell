/**
 * 连接协议与连接目标类型注册表（前端抽象层）
 *
 * 与后端 `src-tauri/src/connection/mod.rs` 的 `TargetType` / `ConnectionProtocol` 对应。
 *
 * 设计目标：
 * 1. 按“连接方式与能力类型”抽象连接目标（Linux、Windows、网络设备、带外管理、串口通信）。
 * 2. Linux、统信 UOS、银河麒麟均属于标准的 SSH 交互与 Linux 内核范畴，
 *    统一收合在 `linux` 分类下（信创即 UOS / 麒麟等 Linux 发行版，不单列）。
 * 3. 每个目标类型声明自己的默认端口 / 用户名 / 认证方式 / 可用工作区模块，
 *    对话框与模块标签页据此动态渲染。
 */

import {
  Terminal,
  Router,
  Cpu,
  Cable,
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

/** 连接协议（与后端 ConnectionProtocol 枚举的 lowercase 字符串对应） */
export type ConnectionProtocol = 'ssh' | 'rdp' | 'winrm' | 'telnet' | 'vnc' | 'serial' | 'redfish'

/** 认证方式（SSH 支持密码、私钥、证书与 Agent；其他协议由各自客户端处理） */
export type AuthMethod = 'password' | 'privateKey' | 'sshAgent' | 'certificate'

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
  /** 是否已正式支持（false 表示仅 UI 预留，连接/命令实现待后续补齐） */
  enabled: boolean
}

/** 协议规格 */
export interface ProtocolSpec {
  id: ConnectionProtocol
  labelKey: string
  /** 默认端口 */
  defaultPort: number
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
 * Linux、统信 UOS、银河麒麟及 Unix 小机均属于标准的 SSH 交互与 Linux 内核范畴，
 * 统一收合在 `linux` 分类下。
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
]

/** 连接协议注册表 */
export const CONNECTION_PROTOCOLS: ProtocolSpec[] = [
  { id: 'ssh', labelKey: 'cp_ssh', defaultPort: 22 },
  { id: 'serial', labelKey: 'cp_serial', defaultPort: 115200 },
  { id: 'rdp', labelKey: 'cp_rdp', defaultPort: 3389 },
  { id: 'winrm', labelKey: 'cp_winrm', defaultPort: 5985 },
  { id: 'telnet', labelKey: 'cp_telnet', defaultPort: 23 },
  { id: 'vnc', labelKey: 'cp_vnc', defaultPort: 5900 },
  { id: 'redfish', labelKey: 'cp_redfish', defaultPort: 443 },
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

/** 按 id 获取协议规格，未找到回退为 ssh */
export function getProtocolSpec(id?: string | null): ProtocolSpec {
  if (id) {
    const found = CONNECTION_PROTOCOLS.find((p) => p.id === id)
    if (found) return found
  }
  return CONNECTION_PROTOCOLS[0] // ssh
}

/** 获取已启用的目标类型（供对话框选择器渲染） */
export function getEnabledTargetTypes(): TargetTypeSpec[] {
  return CONNECTION_TARGETS.filter((t) => t.enabled)
}

/** 判断指定目标类型是否支持某工作区模块 */
export function isModuleAvailable(targetType: string | null | undefined, module: WorkspaceModule): boolean {
  return getTargetTypeSpec(targetType).availableModules.includes(module)
}
