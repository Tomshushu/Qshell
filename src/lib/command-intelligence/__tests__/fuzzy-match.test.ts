import { describe, it, expect } from 'vitest'
import { fuzzyScore, sortByScore } from '../fuzzy-match'

describe('fuzzy-match', () => {
  describe('fuzzyScore', () => {
    it('returns 0 for empty query', () => {
      expect(fuzzyScore('', 'docker')).toBe(0)
    })

    it('returns highest score (1000) for exact match', () => {
      expect(fuzzyScore('docker', 'docker')).toBe(1000)
      expect(fuzzyScore('DOCKER', 'docker')).toBe(1000)
    })

    it('scores prefix match higher than fuzzy match', () => {
      const prefixScore = fuzzyScore('doc', 'docker')
      const fuzzy = fuzzyScore('dck', 'docker')
      expect(prefixScore).toBeGreaterThan(fuzzy)
    })

    it('rewards shorter target in prefix match', () => {
      const shorter = fuzzyScore('cat', 'cat')
      const longer = fuzzyScore('cat', 'catch')
      expect(shorter).toBeGreaterThan(longer)
    })

    it('activates substring match only when query length >= 4', () => {
      // 'port' in 'export' (len 4 >= 4)
      const subScore = fuzzyScore('port', 'export')
      expect(subScore).toBeGreaterThan(0)

      // 'doc' in 'lazydocker' (len 3 < 4, not prefix and fuzzy d-o-c succeeds)
      const shortSub = fuzzyScore('doc', 'lazydocker')
      expect(shortSub).toBeGreaterThan(0)
    })

    it('returns -1 when query characters do not appear in order', () => {
      expect(fuzzyScore('dko', 'docker')).toBe(-1)
      expect(fuzzyScore('xyz', 'docker')).toBe(-1)
    })

    it('rewards word boundary matches and consecutive characters', () => {
      // 'gc' in 'git-checkout' (g at index 0, c after hyphen boundary)
      const boundaryScore = fuzzyScore('gc', 'git-checkout')
      // 'gt' in 'git-checkout'
      const nonBoundary = fuzzyScore('gt', 'git-checkout')
      expect(boundaryScore).toBeGreaterThan(nonBoundary)
    })
  })

  describe('sortByScore', () => {
    it('sorts items descending by score and falls back to string compare', () => {
      const items = ['docker-compose', 'docker', 'dock']
      const sorted = sortByScore(items, (item) => fuzzyScore('doc', item))
      expect(sorted[0]).toBe('dock')
      expect(sorted[1]).toBe('docker')
      expect(sorted[2]).toBe('docker-compose')
    })
  })
})
