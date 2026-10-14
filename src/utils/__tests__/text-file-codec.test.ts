import { describe, it, expect } from 'vitest'
import * as iconv from 'iconv-lite'
import {
  decodeReadResult,
  decodeTextFile,
  decodeTextWithEncoding,
  encodeTextFile,
  normalizeEol,
  detectEol,
  BASE64_PREFIX,
  bytesToBase64,
} from '../text-file-codec'

describe('text-file-codec', () => {
  describe('decodeTextFile', () => {
    it('decodes plain UTF-8 as utf-8', () => {
      const bytes = new TextEncoder().encode('hello 世界\n第二行')
      const r = decodeTextFile(bytes)
      expect(r.encoding).toBe('utf-8')
      expect(r.text).toBe('hello 世界\n第二行')
      expect(r.eol).toBe('\n')
    })

    it('detects UTF-8 BOM and strips it', () => {
      const body = new TextEncoder().encode('hello')
      const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...body])
      const r = decodeTextFile(bytes)
      expect(r.encoding).toBe('utf-8')
      expect(r.hasBom).toBe(true)
      expect(r.text).toBe('hello')
    })

    it('decodes GBK bytes (falls back to GB18030)', () => {
      const gbkBytes = iconv.encode('你好，世界', 'gbk')
      const r = decodeTextFile(new Uint8Array(gbkBytes))
      expect(r.encoding).toBe('gb18030')
      expect(r.text).toBe('你好，世界')
    })

    it('detects CRLF dominant EOL', () => {
      const bytes = new TextEncoder().encode('a\r\nb\r\nc')
      const r = decodeTextFile(bytes)
      expect(r.eol).toBe('\r\n')
    })

    it('detects CR-only EOL', () => {
      const bytes = new TextEncoder().encode('a\rb\rc')
      const r = decodeTextFile(bytes)
      expect(r.eol).toBe('\r')
    })

    it('returns null EOL for single line', () => {
      const r = decodeTextFile(new TextEncoder().encode('no newlines'))
      expect(r.eol).toBeNull()
    })
  })

  describe('decodeReadResult', () => {
    it('passes through plain UTF-8 stdout', () => {
      const r = decodeReadResult('plain text\nline2')
      expect(r.encoding).toBe('utf-8')
      expect(r.text).toBe('plain text\nline2')
    })

    it('decodes ::base64:: prefixed (non-UTF-8) content', () => {
      const gbk = new Uint8Array(iconv.encode('配置', 'gbk'))
      const r = decodeReadResult(`${BASE64_PREFIX}${bytesToBase64(gbk)}`)
      expect(r.encoding).toBe('gb18030')
      expect(r.text).toBe('配置')
    })

    it('strips UTF-8 BOM char in text path and marks hasBom', () => {
      const r = decodeReadResult('\uFEFFhello\nworld')
      expect(r.hasBom).toBe(true)
      expect(r.text).toBe('hello\nworld')
      expect(r.encoding).toBe('utf-8')
    })
  })

  describe('BOM preservation', () => {
    it('decodeTextWithEncoding detects and strips BOM', () => {
      const body = new TextEncoder().encode('内容')
      const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...body])
      const r = decodeTextWithEncoding(bytes, 'utf-8')
      expect(r.hasBom).toBe(true)
      expect(r.text).toBe('内容')
    })

    it('round-trips UTF-8 with BOM', () => {
      const bytes = encodeTextFile('数据', 'utf-8', true)
      expect(bytes[0]).toBe(0xef)
      const r = decodeTextFile(bytes)
      expect(r.hasBom).toBe(true)
      expect(r.text).toBe('数据')
    })

    it('round-trips UTF-16LE with BOM', () => {
      const bytes = encodeTextFile('中文', 'utf-16le', true)
      expect(bytes[0]).toBe(0xff)
      expect(bytes[1]).toBe(0xfe)
      const r = decodeTextFile(bytes)
      expect(r.hasBom).toBe(true)
      expect(r.encoding).toBe('utf-16le')
      expect(r.text).toBe('中文')
    })

    it('does not add BOM for encodings without BOM convention', () => {
      const bytes = encodeTextFile('你好', 'gb18030', true)
      const r = decodeTextFile(bytes)
      expect(r.hasBom).toBe(false)
      expect(r.text).toBe('你好')
    })

    it('keeps no BOM when addBom is false', () => {
      const bytes = encodeTextFile('abc', 'utf-8')
      expect(bytes[0]).toBe(0x61)
    })
  })

  describe('encodeTextFile round-trip', () => {
    it('round-trips UTF-8', () => {
      const bytes = encodeTextFile('你好', 'utf-8')
      expect(decodeTextFile(bytes).text).toBe('你好')
    })

    it('round-trips GBK', () => {
      const bytes = encodeTextFile('你好', 'gb18030')
      expect(decodeTextFile(bytes).text).toBe('你好')
      expect(decodeTextFile(bytes).encoding).toBe('gb18030')
    })
  })

  describe('normalizeEol', () => {
    it('unifies to LF', () => {
      expect(normalizeEol('a\r\nb\rc\nd', '\n')).toBe('a\nb\nc\nd')
    })

    it('unifies to CRLF', () => {
      expect(normalizeEol('a\r\nb\rc\nd', '\r\n')).toBe('a\r\nb\r\nc\r\nd')
    })

    it('leaves text unchanged when eol is null', () => {
      expect(normalizeEol('a\r\nb', null)).toBe('a\r\nb')
    })
  })

  describe('detectEol', () => {
    it('counts dominant', () => {
      expect(detectEol('a\r\nb\r\nc\nd')).toBe('\r\n')
      expect(detectEol('a\nb\nc')).toBe('\n')
      expect(detectEol('')).toBeNull()
    })
  })
})
