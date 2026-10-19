import { describe, it, expect } from 'vitest'
import { sanitizeLogContent } from '../dlp-sanitizer'

describe('DLP Sanitizer Engine', () => {
  it('should redact private keys', () => {
    const raw = `
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0m4p5F32s3w...
-----END RSA PRIVATE KEY-----
    `
    const sanitized = sanitizeLogContent(raw)
    expect(sanitized).not.toContain('MIIEowIBAAKCAQEA0m4p5F32s3w')
    expect(sanitized).toContain('[REDACTED_PRIVATE_KEY]')
  })

  it('should redact password and token key-value pairs', () => {
    const raw = 'Connecting with password=SuperSecret123, github: ghp_1234567890abcdef1234567890abcdef1234'
    const sanitized = sanitizeLogContent(raw)
    expect(sanitized).not.toContain('SuperSecret123')
    expect(sanitized).toContain('[REDACTED_SECRET]')
    expect(sanitized).toContain('[REDACTED_GITHUB_TOKEN]')
  })

  it('should redact authorization headers', () => {
    const raw = 'GET /api HTTP/1.1\nAuthorization: Bearer secret_access_token_value\nHost: example.com'
    const sanitized = sanitizeLogContent(raw)
    expect(sanitized).not.toContain('secret_access_token_value')
    expect(sanitized).toContain('Authorization: Bearer [REDACTED_AUTH_HEADER]')
  })

  it('should optionally redact private IPs', () => {
    const raw = 'Server failed at 192.168.1.100 and 10.0.0.1, public 8.8.8.8'
    const withoutIpMask = sanitizeLogContent(raw, { maskPrivateIps: false })
    expect(withoutIpMask).toContain('192.168.1.100')
    expect(withoutIpMask).toContain('10.0.0.1')
    expect(withoutIpMask).toContain('8.8.8.8')

    const withIpMask = sanitizeLogContent(raw, { maskPrivateIps: true })
    expect(withIpMask).not.toContain('192.168.1.100')
    expect(withIpMask).not.toContain('10.0.0.1')
    expect(withIpMask).toContain('[REDACTED_PRIVATE_IP]')
    expect(withIpMask).toContain('8.8.8.8')
  })

  it('should redact AI API keys for ModelScope, Anthropic, Groq, and Gemini', () => {
    const raw = `
      OpenAI: sk-abcdef1234567890abcdef1234567890
      ModelScope: ms-1234567890abcdef1234567890abcdef
      Anthropic: sk-ant-api03-abcdef1234567890abcdef1234567890abcdef
      Groq: gsk_abcdef1234567890abcdef1234567890abcdef
      Gemini: AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q
    `
    const sanitized = sanitizeLogContent(raw)
    expect(sanitized).not.toContain('sk-abcdef1234567890')
    expect(sanitized).not.toContain('ms-1234567890abcdef')
    expect(sanitized).not.toContain('sk-ant-api03-abcdef')
    expect(sanitized).not.toContain('gsk_abcdef1234567890')
    expect(sanitized).not.toContain('AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q')
    const redactedMatches = sanitized.match(/\[REDACTED_API_KEY\]/g)
    expect(redactedMatches).toHaveLength(5)
  })
})
