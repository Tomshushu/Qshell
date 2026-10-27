import { translate } from '@/i18n'

/**
 * 错误信息友好化
 *
 * 后端（Rust/russh/SFTP）与系统调用返回的错误多为英文技术信息，
 * 直接透传给客户观感差。这里按模式把常见错误映射为友好文案：
 * - 命中：返回友好文案 + 原始信息作为技术详情（供排查）
 * - 未命中：深度清洗技术前缀并翻译，绝不在主界面透传生硬技术堆栈错误
 */

export interface FriendlyError {
  /** 展示给用户的友好消息（已本地化且脱敏；绝不暴露生硬的技术堆栈报错） */
  message: string
  /** 原始技术信息；供排查调试展开或复制使用 */
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
      'permission denied (publickey', 'publickey', '认证失败', '身份验证失败',
    ],
  },
  {
    // 主机密钥不匹配（防重装/中间人）
    key: 'err_host_key_mismatch',
    patterns: [
      'host key mismatch', 'fingerprint', 'known_hosts', 'host key verification failed',
      '公钥指纹不匹配', '主机密钥不匹配',
    ],
  },
  {
    // 串口设备占用
    key: 'err_serial_busy',
    patterns: [
      'serial', 'busy', 'access is denied', 'open port failed', '串口被占用',
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
    patterns: [
      'connection refused', 'econnrefused', 'os error 10061', '连接被拒绝', '拒绝连接',
    ],
  },
  {
    // 网络不可达 / 路由无到达
    key: 'err_network_unreachable',
    patterns: [
      'network is unreachable', 'hostunreach', 'netunreach', 'network is down',
      'enetworkunreach', 'ehostunreach', 'no route to host', 'os error 10065', 'os error 10051',
      '网络不可达',
    ],
  },
  {
    // 超时
    key: 'err_conn_timeout',
    patterns: [
      'timed out', 'timeout', 'etimedout', 'os error 10060', '连接超时', '操作超时', 'wait timeout',
    ],
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
    // 连接断开（网络重置、远端关闭或通道丢失）
    key: 'err_disconnected',
    patterns: [
      'disconnected', 'connection closed', 'broken pipe', 'econnreset',
      'reset by peer', 'not connected', 'connection lost', 'session closed',
      'channel closed', 'channel open failure', 'os error 10054',
      '连接已断开', '连接断开', '未连接',
    ],
  },
]

/**
 * 清除多层嵌套的技术性前缀与多余重复词
 * 例如："SSH connection failed: SSH connect to 172.29.1.13:22 failed: SSH error: Disconnected" -> "Disconnected"
 */
export function cleanTechnicalPrefixes(msg: string): string {
  if (!msg) return msg
  let res = msg
  res = res.replace(/SSH connection failed:\s*/gi, '')
  res = res.replace(/SSH connect to [^\s:]+(?::\d+)? failed:\s*/gi, '')
  res = res.replace(/SSH connect to [^:]+ failed:\s*/gi, '')
  res = res.replace(/SSH error:\s*/gi, '')
  res = res.replace(/SFTP [\w_]+ failed:\s*/gi, '')
  res = res.replace(/failed to open session:\s*/gi, '')
  res = res.replace(/failed to connect to [^:]+:\s*/gi, '')
  res = res.replace(/\(os error \d+\)/gi, '')
  res = res.replace(/os error \d+:\s*/gi, '')
  res = res.replace(/([^:]+)(?::\s*\1)+/gi, '$1')
  res = res.replace(/^[:\s-]+|[:\s-]+$/g, '').trim()
  return res || msg
}

/** 常见技术英文片段转换为友好说明 */
function translateCommonFragments(msg: string): string {
  const translations: Array<[RegExp, string]> = [
    [/Permission denied/gi, '权限不足'],
    [/Operation not permitted/gi, '操作不允许'],
    [/Access denied/gi, '访问被拒绝'],
    [/Auth(?:entication)?(?:\s+)?failed/gi, '身份认证失败'],
    [/Connection\s+reset(?:\s+by\s+peer)?/gi, '连接被重置'],
    [/Connection\s+(?:closed|refused)/gi, '连接被拒绝'],
    [/Disconnected/gi, '连接已断开'],
    [/(?:Connection\s+)?[Tt]imed?\s*out/gi, '连接超时'],
    [/Network(?: is)? unreachable/gi, '网络不可达'],
    [/Host key mismatch/gi, '主机公钥不匹配'],
    [/No route to host/gi, '无法路由到主机'],
    [/Broken pipe/gi, '网络通道中断'],
    [/No such file(?:\s+or\s+directory)?/gi, '文件或目录不存在'],
  ]
  let result = msg
  for (const [pattern, replacement] of translations) {
    result = result.replace(pattern, replacement)
  }
  return result
}

/**
 * 把原始错误文本转换为友好信息。
 * 绝不在界面主要文案中直接透传未清洗的生硬技术栈报错。
 */
export function friendlyError(raw: string): FriendlyError {
  if (!raw || typeof raw !== 'string') return { message: '' }
  const lower = raw.toLowerCase()
  for (const { key, patterns } of ERROR_PATTERNS) {
    if (patterns.some((p) => lower.includes(p))) {
      const message = translate(key)
      if (message && message !== key) {
        return { message, detail: raw }
      }
    }
  }

  // 若未直接命中，清洗冗余前缀后尝试翻译
  const cleaned = cleanTechnicalPrefixes(raw)
  const translated = translateCommonFragments(cleaned)

  // 若原文本包含底层技术报错标志，绝不裸露给用户
  if (translated !== raw || /failed|error|connection|os error|refused|disconnect/i.test(raw)) {
    // 依然残留长串未翻译技术英文时，用通用友好连接失败文案兜底
    const isStillTechnicalEnglish = /^[a-zA-Z0-9_\s:.,\(\)\/-]+$/.test(translated) && translated.length > 5
    const finalMsg = isStillTechnicalEnglish
      ? translate('err_generic_conn_failed') || '连接建立失败：未能成功连接至远端主机，请检查网络与服务状态'
      : translated

    return { message: finalMsg, detail: raw }
  }

  return { message: raw }
}
