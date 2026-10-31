import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordCommand,
  suggestHistory,
  clearHistory,
  getHistory,
  formatUseCount,
  HISTORY_RESCALE_THRESHOLD,
} from '../command-history'

describe('command-history', () => {
  beforeEach(() => {
    localStorage.clear()
    clearHistory()
  })

  describe('recordCommand', () => {
    it('records valid commands and sets useCount to 1', () => {
      recordCommand('ls -la')
      const history = getHistory()
      expect(history).toHaveLength(1)
      expect(history[0].cmd).toBe('ls -la')
      expect(history[0].useCount).toBe(1)
    })

    it('ignores empty strings and commands starting with a space (bash ignorespace)', () => {
      recordCommand('')
      recordCommand('   ')
      recordCommand(' echo secret')
      expect(getHistory()).toHaveLength(0)
    })

    it('increments useCount and updates server/cwd distributions on repetition', () => {
      recordCommand('docker ps', { serverId: 's1', cwd: '/app' })
      recordCommand('docker ps', { serverId: 's1', cwd: '/app' })
      recordCommand('docker ps', { serverId: 's2', cwd: '/var' })

      const history = getHistory()
      expect(history).toHaveLength(1)
      expect(history[0].useCount).toBe(3)
      expect(history[0].serverCounts).toEqual({ s1: 2, s2: 1 })
      expect(history[0].cwdCounts).toEqual({ '/app': 2, '/var': 1 })
    })

    it('triggers proportional rescaling when threshold is reached', () => {
      // Simulate existing entry with high count
      const initialEntry = {
        cmd: 'frequent',
        usedAt: Date.now(),
        useCount: HISTORY_RESCALE_THRESHOLD - 1,
        serverCounts: { s1: HISTORY_RESCALE_THRESHOLD - 1 },
      }
      localStorage.setItem('trae:command-history', JSON.stringify([initialEntry]))

      // Record once more to hit threshold
      recordCommand('frequent', { serverId: 's1' })

      const history = getHistory()
      // Should be rescaled by factor 0.5 (1000 * 0.5 = 500)
      expect(history[0].useCount).toBe(500)
      expect(history[0].serverCounts?.['s1']).toBe(500)
    })
  })

  describe('suggestHistory', () => {
    it('returns empty array when query is empty or history is empty', () => {
      expect(suggestHistory('')).toEqual([])
      expect(suggestHistory('git')).toEqual([])
    })

    it('matches by prefix', () => {
      recordCommand('git commit -m "feat: init"')
      recordCommand('git status')
      recordCommand('docker ps')

      const hints = suggestHistory('git c')
      expect(hints.length).toBeGreaterThan(0)
      expect(hints[0].insertText).toBe('git commit -m "feat: init"')
    })

    it('matches by multi-token prefix', () => {
      recordCommand('git checkout main')
      const hints = suggestHistory('g ch')
      expect(hints.length).toBeGreaterThan(0)
      expect(hints[0].insertText).toBe('git checkout main')
    })

    it('matches by acronym (3 to 5 chars)', () => {
      recordCommand('docker compose up -d')
      const hints = suggestHistory('dcu')
      expect(hints.length).toBeGreaterThan(0)
      expect(hints[0].insertText).toBe('docker compose up -d')
    })

    it('enforces server isolation: does not leak other server commands', () => {
      recordCommand('docker exec -it mysql-prod bash', { serverId: 'prod-server' })
      recordCommand('npm run dev', { serverId: 'dev-server' })

      // Querying on dev-server should NOT return prod-server commands
      const devHints = suggestHistory('docker', 5, { serverId: 'dev-server' })
      expect(devHints.map((h) => h.insertText)).not.toContain('docker exec -it mysql-prod bash')

      // Querying on prod-server returns it with badge
      const prodHints = suggestHistory('docker', 5, { serverId: 'prod-server' })
      expect(prodHints.map((h) => h.insertText)).toContain('docker exec -it mysql-prod bash')
      expect(prodHints[0].badge).toBe('同主机')
    })

    it('rewards current directory matching with "当前目录" badge', () => {
      recordCommand('make build', { cwd: '/workspace/project-a' })

      const hints = suggestHistory('make', 5, { cwd: '/workspace/project-a' })
      expect(hints[0].badge).toBe('当前目录')
    })
  })

  describe('formatUseCount', () => {
    it('formats counts under 1000 as numbers and caps over 999 as 999+', () => {
      expect(formatUseCount(1)).toBe('1')
      expect(formatUseCount(50)).toBe('50')
      expect(formatUseCount(999)).toBe('999')
      expect(formatUseCount(1000)).toBe('999+')
      expect(formatUseCount(5000)).toBe('999+')
    })
  })
})
