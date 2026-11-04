/**
 * packages/qshell-policy/src/dlp.ts
 *
 * Qshell 本地端侧数据防泄漏 (DLP) 与隐私脱敏清洗引擎
 * 采用高性能纯本地正则过滤，零网络开销，确保机密凭据、密码与私钥绝不发送至外部大模型或外部 MCP 客户端
 */

import type { DlpSanitizeOptions } from './types'

export interface DlpSanitizeResult {
  text: string
  hitTypes: string[]
}

/**
 * 脱敏清洗主入口 (返回脱敏文本及命中的敏感类型)
 */
export function sanitize(
  text: string,
  options: DlpSanitizeOptions = {},
): DlpSanitizeResult {
  if (!text || typeof text !== 'string') {
    return { text: '', hitTypes: [] }
  }

  let result = text
  const hitTypes: string[] = []

  // 1. SSH / PGP 私钥块脱敏
  if (/-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----/i.test(result)) {
    hitTypes.push('PRIVATE_KEY')
    result = result.replace(
      /-----BEGIN[ A-Z0-9_-]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]*PRIVATE KEY-----/gi,
      '[REDACTED_PRIVATE_KEY]',
    )
  }

  // 2. JWT 格式 Token 脱敏
  if (/eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/.test(result)) {
    hitTypes.push('JWT')
    result = result.replace(
      /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
      '[REDACTED_JWT_TOKEN]',
    )
  }

  // 3. 常见云厂商与开放平台 Token 模式
  // GitHub Personal Access Token (ghp_, gho_, ghu_, ghs_, ghr_)
  if (/\b(gh[pousr]_[A-Za-z0-9_]{36,255})\b/.test(result)) {
    hitTypes.push('GITHUB_TOKEN')
    result = result.replace(
      /\b(gh[pousr]_[A-Za-z0-9_]{36,255})\b/g,
      '[REDACTED_GITHUB_TOKEN]',
    )
  }

  // AWS Access Key ID
  if (/\b(AKIA[0-9A-Z]{16})\b/.test(result)) {
    hitTypes.push('AWS_KEY')
    result = result.replace(/\b(AKIA[0-9A-Z]{16})\b/g, '[REDACTED_AWS_KEY]')
  }

  // 阿里云 AccessKey
  if (/\b(LTAI[0-9A-Za-z]{16,24})\b/.test(result)) {
    hitTypes.push('ALIYUN_KEY')
    result = result.replace(/\b(LTAI[0-9A-Za-z]{16,24})\b/g, '[REDACTED_ALIYUN_KEY]')
  }

  // 常用 AI API Keys (OpenAI, Anthropic, ModelScope, Groq, Gemini)
  if (/\b(sk-(?:ant-)?[a-zA-Z0-9_-]{20,96}|ms-[a-zA-Z0-9_-]{20,64}|gsk_[a-zA-Z0-9]{20,64}|AIzaSy[a-zA-Z0-9_-]{33})\b/.test(result)) {
    hitTypes.push('API_KEY')
    result = result.replace(
      /\b(sk-(?:ant-)?[a-zA-Z0-9_-]{20,96}|ms-[a-zA-Z0-9_-]{20,64}|gsk_[a-zA-Z0-9]{20,64}|AIzaSy[a-zA-Z0-9_-]{33})\b/g,
      '[REDACTED_API_KEY]',
    )
  }

  // 4. 键值对形式的密码与凭据脱敏 (形如 password=xxx, pwd: "xxx", secret: xxx, token: xxx)
  if (/(["']?(?:password|passwd|pwd|secret|token|api_?key|auth_?key|access_?token)["']?\s*[:=]\s*["']?)([^"' \t\r\n]{3,})(["']?)/i.test(result)) {
    hitTypes.push('CREDENTIAL_PAIR')
    result = result.replace(
      /(["']?(?:password|passwd|pwd|secret|token|api_?key|auth_?key|access_?token)["']?\s*[:=]\s*["']?)([^"' \t\r\n]{3,})(["']?)/gi,
      '$1[REDACTED_SECRET]$3',
    )
  }

  // 5. HTTP Authorization Header 凭据脱敏
  if (/(Authorization:\s*(?:Bearer|Basic)\s+)[^\r\n]+/i.test(result)) {
    hitTypes.push('AUTH_HEADER')
    result = result.replace(
      /(Authorization:\s*(?:Bearer|Basic)\s+)[^\r\n]+/gi,
      '$1[REDACTED_AUTH_HEADER]',
    )
  }

  // 6. 可选：内网私有 IP 脱敏混淆 (10.x.x.x, 192.168.x.x, 172.16-31.x.x)
  if (options.maskPrivateIps) {
    if (/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})\b/.test(result)) {
      hitTypes.push('PRIVATE_IP')
      result = result.replace(
        /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})\b/g,
        '[REDACTED_PRIVATE_IP]',
      )
    }
  }

  return { text: result, hitTypes }
}

/**
 * 兼容旧版签名的脱敏函数 (直接返回字符串)
 */
export function sanitizeLogContent(
  text: string,
  options: DlpSanitizeOptions = {},
): string {
  return sanitize(text, options).text
}
