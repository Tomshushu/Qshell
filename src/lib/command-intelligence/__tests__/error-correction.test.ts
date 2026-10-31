import { describe, it, expect } from 'vitest'
import {
  suggestCorrections,
  suggestSubcommandCorrections,
} from '../error-correction'
import type { CommandSpec } from '../types'

describe('error-correction (Did you mean?)', () => {
  describe('suggestCorrections', () => {
    it('returns empty array for inputs shorter than 3 characters', () => {
      expect(suggestCorrections('')).toEqual([])
      expect(suggestCorrections('a')).toEqual([])
      expect(suggestCorrections('ls')).toEqual([])
    })

    it('suggests closest commands for common typos with same initial letter', () => {
      // 'dockr' -> 'docker' (distance 1, starts with d)
      const suggestions = suggestCorrections('dockr')
      expect(suggestions.length).toBeGreaterThan(0)
      expect(suggestions[0].cmd).toBe('docker')
    })

    it('enforces same initial letter to avoid cross-word false positives', () => {
      // Even if 'scp' is close to 'lscpu', initial letter 'l' != 's' blocks it
      const suggestions = suggestCorrections('lscpu')
      const cmds = suggestions.map((s) => s.cmd)
      expect(cmds).not.toContain('scp')
    })

    it('respects the max limit parameter', () => {
      const suggestions = suggestCorrections('systmctl', 1)
      expect(suggestions).toHaveLength(1)
      expect(suggestions[0].cmd).toBe('systemctl')
    })

    it('ignores exact matches (distance 0 is not an error)', () => {
      const suggestions = suggestCorrections('docker')
      const cmds = suggestions.map((s) => s.cmd)
      expect(cmds).not.toContain('docker')
    })
  })

  describe('suggestSubcommandCorrections', () => {
    const gitSpec: CommandSpec = {
      cmd: 'git',
      desc: 'Git version control',
      subcommands: [
        { cmd: 'commit', desc: 'Record changes to repository' },
        { cmd: 'checkout', desc: 'Switch branches or restore files' },
        { cmd: 'clone', desc: 'Clone a repository' },
        { cmd: 'push', desc: 'Update remote refs' },
        { cmd: 'pull', desc: 'Fetch and integrate' },
      ],
    }

    it('returns empty array for input shorter than 3 characters or missing subcommands', () => {
      expect(suggestSubcommandCorrections('co', gitSpec)).toEqual([])
      expect(
        suggestSubcommandCorrections('comit', { cmd: 'simple', desc: 'no sub' }),
      ).toEqual([])
    })

    it('suggests subcommands for typos within the parent command scope', () => {
      // 'comit' -> 'commit'
      const suggestions = suggestSubcommandCorrections('comit', gitSpec)
      expect(suggestions.length).toBeGreaterThan(0)
      expect(suggestions[0].cmd).toBe('commit')
    })

    it('filters out subcommands starting with a different letter', () => {
      // 'chekout' -> 'checkout' (starts with c)
      const suggestions = suggestSubcommandCorrections('chekout', gitSpec)
      expect(suggestions[0].cmd).toBe('checkout')
    })
  })
})
