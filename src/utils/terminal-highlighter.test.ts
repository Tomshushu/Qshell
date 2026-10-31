import { describe, it, expect } from 'vitest'
import {
  hexToAnsi,
  highlightKeywords,
  type HighlightRule,
} from './terminal-highlighter'

describe('terminal-highlighter', () => {
  describe('hexToAnsi', () => {
    it('converts 6-digit hex color to 24-bit ANSI color code', () => {
      // #ff0000 -> 255, 0, 0
      expect(hexToAnsi('#ff0000')).toBe('\x1b[38;2;255;0;0m')
      // #00ff00 -> 0, 255, 0
      expect(hexToAnsi('00ff00')).toBe('\x1b[38;2;0;255;0m')
    })

    it('converts 3-digit shorthand hex color', () => {
      // #f00 -> 255, 0, 0
      expect(hexToAnsi('#f00')).toBe('\x1b[38;2;255;0;0m')
    })

    it('falls back to black on invalid hex', () => {
      expect(hexToAnsi('')).toBe('\x1b[38;2;0;0;0m')
    })
  })

  describe('highlightKeywords', () => {
    const rules: HighlightRule[] = [
      {
        id: 'r1',
        name: 'Error',
        regex: '\\bERROR\\b',
        color: '#ff0000',
        enabled: true,
      },
      {
        id: 'r2',
        name: 'Warn',
        regex: '\\bWARN\\b',
        color: '#ffff00',
        enabled: false, // disabled
      },
    ]

    it('returns original text if disabled or text is empty', () => {
      expect(highlightKeywords('some ERROR here', false, rules)).toBe('some ERROR here')
      expect(highlightKeywords('', true, rules)).toBe('')
    })

    it('highlights matching keywords with ANSI codes and resets foreground', () => {
      const out = highlightKeywords('An ERROR occurred', true, rules)
      expect(out).toContain('\x1b[38;2;255;0;0mERROR\x1b[39m')
    })

    it('ignores disabled rules', () => {
      const out = highlightKeywords('A WARN message', true, rules)
      expect(out).toBe('A WARN message')
    })

    it('preserves existing ANSI sequences and only highlights plain text parts', () => {
      const original = '\x1b[1mBold ERROR text\x1b[0m'
      const out = highlightKeywords(original, true, rules)
      expect(out).toContain('\x1b[1m')
      expect(out).toContain('\x1b[38;2;255;0;0mERROR\x1b[39m')
      expect(out).toContain('\x1b[0m')
    })

    it('skips large payloads (> 50KB) to prevent UI thread lockup', () => {
      const bigText = 'ERROR '.repeat(11000) // ~66KB
      const out = highlightKeywords(bigText, true, rules)
      // Large payload is returned untouched
      expect(out).toBe(bigText)
    })
  })
})
