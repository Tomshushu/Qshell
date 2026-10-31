import { describe, it, expect, beforeEach } from 'vitest'
import {
  rankScore,
  rankItems,
  invalidateRankingCache,
} from '../ranking'
import { recordCommand, clearHistory } from '../command-history'
import type { HintItem } from '../types'

function makeItem(label: string, over: Partial<HintItem> = {}): HintItem {
  return {
    kind: 'command',
    label,
    desc: label,
    insertText: label,
    score: 100, // base fuzzy score
    ...over,
  }
}

describe('command-intelligence ranking', () => {
  beforeEach(() => {
    localStorage.clear()
    clearHistory()
    invalidateRankingCache()
  })

  describe('rankScore', () => {
    it('adds popularity boost for common top-level commands', () => {
      // 'git' has popularity 60; 'unknowncmd' has 0
      const gitItem = makeItem('git')
      const unknownItem = makeItem('unknowncmd')

      expect(rankScore(gitItem)).toBeGreaterThan(rankScore(unknownItem))
    })

    it('adds history frequency boost', () => {
      const item = makeItem('mycustom')
      const initialScore = rankScore(item)

      // Record commands in history
      recordCommand('mycustom arg1')
      recordCommand('mycustom arg2')
      invalidateRankingCache()

      const boostedScore = rankScore(item)
      expect(boostedScore).toBeGreaterThan(initialScore)
    })

    it('resolves namespaced subcommands popularity and history', () => {
      // 'checkout' under 'git' has popularity 48
      const checkoutItem = makeItem('checkout')
      const scoreWithParent = rankScore(checkoutItem, 'git')
      const scoreWithoutParent = rankScore(checkoutItem)

      expect(scoreWithParent).toBeGreaterThan(scoreWithoutParent)
    })
  })

  describe('rankItems', () => {
    it('ranks items by composite score descending', () => {
      const items = [
        makeItem('custom', { score: 100 }),
        makeItem('git', { score: 100 }), // gets +60 popularity
        makeItem('cat', { score: 100 }), // gets +42 popularity
      ]

      const ranked = rankItems(items)
      expect(ranked[0].label).toBe('git')
      expect(ranked[1].label).toBe('cat')
      expect(ranked[2].label).toBe('custom')
    })

    it('sinks disabled items to the bottom regardless of score', () => {
      const items = [
        makeItem('git', { score: 500, disabled: true }),
        makeItem('custom', { score: 10 }),
      ]

      const ranked = rankItems(items)
      expect(ranked[0].label).toBe('custom')
      expect(ranked[1].label).toBe('git')
    })
  })
})
