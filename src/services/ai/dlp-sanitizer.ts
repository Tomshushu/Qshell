/**
 * src/services/ai/dlp-sanitizer.ts
 *
 * Qshell 本地端侧数据防泄漏 (DLP) 与隐私脱敏清洗引擎
 * 采用高性能本地正则过滤，零网络开销，确保机密凭据、密码与私钥绝不发送至外部大模型
 */

export interface DlpSanitizeOptions {
  maskPrivateIps?: boolean
}

/**
 * 脱敏清洗主入口
 */
export function sanitizeLogContent(
  text: string,
  options: DlpSanitizeOptions = {},
): string {
  if (!text || typeof text !== 'string') return ''

  let result = text

  // 1. SSH / PGP 私钥块脱敏
  result = result.replace(
    /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----/gi,
    '[REDACTED_PRIVATE_KEY]',
  )

  // 2. JWT 格式 Token 脱敏
  result = result.replace(
    /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
    '[REDACTED_JWT_TOKEN]',
  )

  // 3. 常见云厂商与开放平台 Token 模式
  // GitHub Personal Access Token (ghp_, gho_, ghu_, ghs_, ghr_)
  result = result.replace(
    /\b(gh[pousr]_[A-Za-z0-9_]{36,255})\b/g,
    '[REDACTED_GITHUB_TOKEN]',
  )
  // AWS Access Key ID
  result = result.replace(/\b(AKIA[0-9A-Z]{16})\b/g, '[REDACTED_AWS_KEY]')
  // 阿里云 AccessKey
  result = result.replace(/\b(LTAI[0-9A-Za-z]{16,24})\b/g, '[REDACTED_ALIYUN_KEY]')
  // 常用 AI API Keys (sk-...)
  result = result.replace(/\b(sk-[a-zA-Z0-9]{20,64})\b/g, '[REDACTED_API_KEY]')

  // 4. 键值对形式的密码与凭据脱敏 (形如 password=xxx, pwd: "xxx", secret: xxx, token: xxx)
  result = result.replace(
    /(["']?(?:password|passwd|pwd|secret|token|api_?key|auth_?key|access_?token)["']?\s*[:=]\s*["']?)([^"' \t\r\n]{3,})(["']?)/gi,
    '$1[REDACTED_SECRET]$3',
  )

  // 5. HTTP Authorization Header 凭据脱敏
  result = result.replace(
    /(Authorization:\s*(?:Bearer|Basic)\s+)[^\r\n]+/gi,
    '$1[REDACTED_AUTH_HEADER]',
  )

  // 6. 可选：内网私有 IP 脱敏混淆 (10.x.x.x, 192.168.x.x, 172.16-31.x.x)
  if (options.maskPrivateIps) {
    result = result.replace(
      /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})\b/g,
      '[REDACTED_PRIVATE_IP]',
    )
  }

  return result
}
