import { translate } from '@/i18n'

/**
 * 错误信息友好化
 *
 * 后端（Rust/russh/SFTP）与系统调用返回的错误多为英文技术信息，
 * 直接透传给客户观感差。这里按模式把常见错误映射为友好文案：
 * - 命中：返回友好文案 + 原始信息作为技术详情（供排查）
 * - 未命中：原样返回（不包一层通用文案，避免丢失具体信息）
 *
 * 文案只维护 zh-CN 与 en，其他语言经 i18n 英文兜底。
 */

export interface FriendlyError {
  /** 展示给用户的消息（已本地化；未匹配时为原始错误文本） */
  message: string
  /** 原始技术信息；仅在命中映射时提供（message 已被替换时才有值） */
  detail?: string
}

/** 单条错误模式：任一关键词命中即视为该类别（关键词均为小写） */
interface ErrorPattern {
  key: string // i18n key（err_ 前缀）
  patterns: string[]
}

// 顺序即优先级：具体错误在前，宽泛错误在后。
// 例如 "authentication timed out" 必须先被 auth 捕获，而不是落入 timeout。
const ERROR_PATTERNS: ErrorPattern[] = [
  {
    // 认证失败（含 SSH 密码/公钥/agent 认证被拒）
    key: 'err_auth_failed',
    patterns: [
      'authentication failed', 'authentication rejected', 'authentication timed out',
      'auth failed', 'autherror', 'all configured authentication methods failed',
      'password authentication rejected', 'public key authentication rejected',
      '认证失败', '身份验证失败',
    ],
  },
  {
    // DNS 解析失败
    key: 'err_dns_failed',
    patterns: [
      'getaddrinfo', 'enotfound', 'eai_again',
      'name or service not known', 'no such host', 'temporary failure in name resolution',
      '域名解析失败', '无法解析',
    ],
  },
  {
    // 连接被拒绝（端口未开放/服务未运行）
    key: 'err_conn_refused',
    patterns: ['connection refused', 'econnrefused', '连接被拒绝', '拒绝连接'],
  },
  {
    // 网络不可达
    key: 'err_network_unreachable',
    patterns: [
      'network is unreachable', 'hostunreach', 'netunreach', 'network is down',
      'enetworkunreach', 'ehostunreach', '网络不可达',
    ],
  },
  {
    // 超时
    key: 'err_conn_timeout',
    patterns: ['timed out', 'timeout', 'etimedout', '连接超时', '操作超时'],
  },
  {
    // 权限不足（文件系统/系统调用层面；SSH 认证类已在前面的 auth 捕获）
    key: 'err_permission',
    patterns: [
      'permission denied', 'access denied', 'eacces', 'eperm',
      'insufficient permissions', 'not permitted',
      '权限不足', '权限被拒绝', '没有权限',
    ],
  },
  {
    // 目标不存在
    key: 'err_not_found',
    patterns: [
      'no such file', 'no such directory', 'enoent', 'does not exist',
      'not found', 'file not found', 'no longer exists',
      '不存在', '未找到',
    ],
  },
  {
    // 存储空间不足
    key: 'err_no_space',
    patterns: ['no space left', 'enospc', 'insufficient space', '空间不足'],
  },
  {
    // 连接断开
    key: 'err_disconnected',
    patterns: [
      'disconnected', 'connection closed', 'broken pipe', 'econnreset',
      'reset by peer', 'not connected', 'connection lost', 'session closed',
      '连接已断开', '连接断开', '未连接',
    ],
  },
]

/**
 * 把原始错误文本转换为友好信息。
 * 未命中任何模式时返回原文（message = 原文，无 detail）。
 */
export function friendlyError(raw: string): FriendlyError {
  if (!raw) return { message: raw }
  const lower = raw.toLowerCase()
  for (const { key, patterns } of ERROR_PATTERNS) {
    // 中文关键词不受 toLowerCase 影响，统一在同一循环里判断
    if (patterns.some((p) => lower.includes(p))) {
      const message = translate(key)
      // 兜底：翻译缺失时不应把错误吞掉，回退原文
      if (message === key) return { message: raw }
      return { message, detail: raw }
    }
  }
  return { message: raw }
}
