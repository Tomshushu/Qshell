/**
 * 平台检测：从服务器 OS 信息推断 Platform 标签
 *
 * 用于命令智能补全的按平台过滤。
 * 服务器 osType / osInfo 由后端 detectOsInfo 探测得到，
 * 本模块将其映射为 types.ts 中定义的 Platform 枚举。
 */

import type { Platform } from './types'

/**
 * 从 osType / osInfo 字符串推断 Platform 标签。
 *
 * 匹配规则（大小写不敏感，包含关键词即匹配）：
 * - debian / ubuntu / mint / kali / raspbian → debian
 * - rhel / centos / fedora / rocky / almalinux / redhat → redhat
 * - arch / manjaro / endeavouros → arch
 * - alpine → alpine
 * - suse / sles / opensuse → suse
 * - darwin / macos / mac os → macos
 * - freebsd / openbsd / netbsd → bsd
 * - 无法识别 → universal（不过滤，显示全部命令）
 *
 * @param osType 服务器 OS 类型（如 'linux'）
 * @param osInfo 服务器 OS 详细信息（如 'Ubuntu 22.04.3 LTS'）
 */
export function detectPlatform(osType?: string, osInfo?: string): Platform {
  const text = `${osType ?? ''} ${osInfo ?? ''}`.toLowerCase()

  if (/network/.test(text)) return 'network'
  if (/debian|ubuntu|linux\s*mint|kali|raspbian|pop!_os|pop\s*os|uos|deepin/.test(text)) return 'debian'
  if (/rhel|centos|fedora|rocky|almalinux|red\s*hat|amazon\s*linux|oracle\s*linux|amzn|alinux|aliyun|alibaba|tencentos|tlinux|euleros|hce|openeuler|anolis|kylin/.test(text)) return 'redhat'
  if (/arch\s*linux|manjaro|endeavouros|garuda|antergos/.test(text)) return 'arch'
  if (/alpine/.test(text)) return 'alpine'
  if (/suse|sles|opensuse|sles/.test(text)) return 'suse'
  if (/darwin|mac\s*os|macos|osx/.test(text)) return 'macos'
  if (/freebsd|openbsd|netbsd/.test(text)) return 'bsd'

  // osType=linux 但无具体发行版信息 → universal（显示全部）
  return 'universal'
}

/** 平台 → 友好显示名（用于「不兼容」提示文案） */
const PLATFORM_LABEL: Record<Platform, string> = {
  universal: '通用',
  debian: 'Debian/Ubuntu',
  redhat: 'RHEL/CentOS',
  arch: 'Arch',
  alpine: 'Alpine',
  suse: 'SUSE',
  macos: 'macOS',
  bsd: 'BSD',
  network: '网络设备',
}

/**
 * 取平台显示名。
 * 传入当前服务器平台，返回对应的发行版友好名（如 'CentOS'）。
 */
export function platformLabel(platform: Platform): string {
  return PLATFORM_LABEL[platform] ?? platform
}

/**
 * 生成命令在指定平台上不兼容时的提示文案。
 * 例：当前为 redhat，命令仅支持 debian → "Not available on RHEL/CentOS"
 */
export function disabledReasonFor(
  cmdPlatforms: Platform[] | undefined,
  current: Platform,
): string | undefined {
  if (!cmdPlatforms || cmdPlatforms.length === 0) return undefined
  if (current === 'universal') return undefined
  if (cmdPlatforms.includes('universal') || cmdPlatforms.includes(current)) return undefined
  const labels = cmdPlatforms.map((p) => PLATFORM_LABEL[p]).filter(Boolean)
  return `仅在 ${labels.join('/')} 可用`
}
