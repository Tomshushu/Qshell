/**
 * packages/qshell-policy/src/sftp.ts
 *
 * S1-5 SFTP 只读取证路径审查与安全网关
 *
 * 核心安全约束（零信任白名单机制）：
 * 1. 绝对 POSIX 路径审查：严禁相对路径、严禁包含 '..' 目录穿越；
 * 2. 严格路径白名单：仅放行系统配置目录、服务目录与运行日志目录；
 * 3. 敏感凭据硬拦截（黑名单一票否决）：
 *    - 严厉阻断 ~/.ssh/**、id_rsa、authorized_keys 等 SSH 凭据
 *    - 严厉阻断 /etc/shadow、/etc/gshadow、/etc/sudoers 等特权敏感表
 *    - 严厉阻断 /proc/**、/sys/**、/dev/** 内核虚拟文件系统
 *    - 严厉阻断 .env* 环境变量明文配置
 *    - 严厉阻断 /var/run/secrets/** (K8s SA Token)
 *    - 严厉阻断 *.key、*.priv、/etc/ssl/private/** 私钥明文
 * 4. 二进制文件识别与行数防爆截断（默认 150 行，上限 500 行，经 8KB 出向 DLP 出口）
 */

export interface SftpPathValidationResult {
  valid: boolean
  normalizedPath?: string
  reason?: string
}

/**
 * 默认放行的安全配置与日志目录前缀白名单
 */
export const DEFAULT_ALLOWED_SFTP_PREFIXES: readonly string[] = [
  '/etc/',
  '/var/log/',
  '/var/www/',
  '/opt/',
  '/usr/local/',
  '/app/',
  '/apps/',
  '/srv/',
  '/home/',
  '/root/',
  '/data/',
  '/mnt/',
]

/**
 * 绝对不可触碰的敏感文件/凭证特征（一票否决，优先级最高）
 */
const FORBIDDEN_SFTP_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  {
    regex: /(?:^|[/\\])\.ssh(?:[/\\]|$)/i,
    reason: '禁止访问任何 SSH 密钥凭证目录或文件 (~/.ssh/*)',
  },
  {
    regex: /(?:id_[a-zA-Z0-9_-]+|authorized_keys|known_hosts)/i,
    reason: '禁止读取 SSH 密钥与主机凭证文件',
  },
  {
    regex: /(?:^|[/\\])etc[/\\](?:shadow|gshadow|master\.passwd|sudoers(?:\.d)?|security[/\\]opasswd)\b/i,
    reason: '禁止读取系统特权账号与密码哈希文件 (/etc/shadow 等)',
  },
  {
    regex: /(?:^|[/\\])(?:proc|sys|dev)(?:[/\\]|$)/i,
    reason: '禁止读取内核虚拟文件系统与设备文件 (/proc, /sys, /dev)',
  },
  {
    regex: /(?:^|[/\\])\.env(?:[.\-_a-zA-Z0-9]*)?$/i,
    reason: '禁止读取环境变量明文配置文件 (.env)',
  },
  {
    regex: /(?:^|[/\\])var[/\\]run[/\\]secrets(?:[/\\]|$)/i,
    reason: '禁止读取 Kubernetes 集群 Service Account 鉴权令牌',
  },
  {
    regex: /(?:^|[/\\])\.(?:git-credentials|netrc|dockercfg)\b/i,
    reason: '禁止读取代码仓库或 Docker 注册表明文认证凭证',
  },
  {
    regex: /(?:\.key|\.pem|\.priv)$/i,
    reason: '禁止直接读取私钥文件 (*.key, *.pem, *.priv)',
  },
  {
    regex: /(?:^|[/\\])(?:etc[/\\]ssl|etc[/\\]pki)[/\\]private(?:[/\\]|$)/i,
    reason: '禁止直接读取系统 SSL/TLS 证书私钥明文内容',
  },
  {
    regex: /(?:^|[/\\])\.(?:bash_history|zsh_history|sh_history|history)$/i,
    reason: '禁止读取终端命令历史记录文件',
  },
]

/**
 * 校验 SFTP 只读抓取的远程文件路径安全合规性
 */
export function validateSftpReadPath(
  remotePath: string,
  allowedPrefixes: readonly string[] = DEFAULT_ALLOWED_SFTP_PREFIXES,
): SftpPathValidationResult {
  if (!remotePath || typeof remotePath !== 'string') {
    return { valid: false, reason: '未提供目标文件路径。' }
  }

  const trimmed = remotePath.trim()
  if (!trimmed) {
    return { valid: false, reason: '文件路径不能为空。' }
  }

  // 1. 规范化路径分隔符为 POSIX 标准斜杠
  const normalized = trimmed.replace(/\\+/g, '/').replace(/\/+/g, '/')

  // 2. 拒绝相对路径：必须以 '/' 开头或 Windows 盘符开头 (如 C:/)
  const isPosixAbsolute = normalized.startsWith('/')
  const isWindowsAbsolute = /^[a-zA-Z]:\//.test(normalized)

  if (!isPosixAbsolute && !isWindowsAbsolute) {
    return {
      valid: false,
      reason: `必须提供绝对 POSIX 路径（例如 /etc/nginx/nginx.conf），拒绝相对路径「${remotePath}」。`,
    }
  }

  // 3. 严厉阻断路径穿越 (Directory Traversal)
  const segments = normalized.split('/')
  if (segments.some((seg) => seg === '..')) {
    return {
      valid: false,
      reason: `检测到非法路径穿越符 '..'，禁止越界访问父级目录「${remotePath}」。`,
    }
  }

  // 4. 敏感凭证黑名单硬拦截（优先级最高，一票否决）
  for (const { regex, reason } of FORBIDDEN_SFTP_PATTERNS) {
    if (regex.test(normalized)) {
      return {
        valid: false,
        reason: `[安全策略硬拦截] ${reason}`,
      }
    }
  }

  // 5. 白名单目录许可校验 (POSIX 模式)
  if (isPosixAbsolute) {
    const isWhitelisted = allowedPrefixes.some((prefix) => normalized.startsWith(prefix))
    if (!isWhitelisted) {
      return {
        valid: false,
        reason: `[白名单拦截] 目标路径「${normalized}」不在只读许可目录白名单中（允许目录范围：${allowedPrefixes.join(', ')}）。`,
      }
    }
  }

  return {
    valid: true,
    normalizedPath: normalized,
  }
}

/**
 * 校验读取的文件内容是否为二进制数据
 */
export function isBinaryContent(content: string): boolean {
  if (!content) return false
  if (content.startsWith('::base64::')) return true
  // 采样前 1024 字符检查 NULL 字符或高比率不可打印控制字符
  const sample = content.slice(0, 1024)
  if (sample.includes('\0')) return true

  let nonPrintableCount = 0
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i)
    // 允许常见空白符：\t (9), \n (10), \r (13)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      nonPrintableCount++
    }
  }

  return nonPrintableCount / sample.length > 0.1
}

/**
 * 限制最大文本行数并进行防爆安全修剪
 */
export function clipFileLines(
  text: string,
  maxLines = 150,
): { clippedText: string; isClipped: boolean; totalLines: number } {
  const effectiveMax = Math.min(Math.max(1, maxLines), 500)
  const lines = text.split(/\r?\n/)
  const totalLines = lines.length

  if (totalLines <= effectiveMax) {
    return { clippedText: text, isClipped: false, totalLines }
  }

  const clipped = lines.slice(0, effectiveMax).join('\n')
  const notice = `\n\n--- [已截断：文件共 ${totalLines} 行，已按安全配额仅读取前 ${effectiveMax} 行。如需下钻可指定关键字排查] ---`

  return {
    clippedText: clipped + notice,
    isClipped: true,
    totalLines,
  }
}
