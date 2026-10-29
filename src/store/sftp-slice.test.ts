import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from './index'
import { getSiblingScopeKey } from './slices/sftp-slice'

/**
 * sftp-slice 路径收藏的纯逻辑测试：
 * 只验证 scope 配对、去重、上限与双向同步，不涉及任何生产代码改动。
 */

function resetStore() {
  localStorage.clear()
  useAppStore.setState({ pathBookmarks: {} })
}

function bookmarks(scopeKey: string): string[] {
  return useAppStore.getState().pathBookmarks[scopeKey] ?? []
}

describe('sftp-slice path bookmarks', () => {
  beforeEach(resetStore)

  describe('getSiblingScopeKey', () => {
    it('pairs sftp and workspace scopes for the same server', () => {
      expect(getSiblingScopeKey('sftp:srv-1')).toBe('workspace:srv-1')
      expect(getSiblingScopeKey('workspace:srv-1')).toBe('sftp:srv-1')
    })

    it('returns null for the local scope (no sibling)', () => {
      expect(getSiblingScopeKey('sftp:local')).toBeNull()
    })

    it('returns null for unknown scopes', () => {
      expect(getSiblingScopeKey('other:x')).toBeNull()
    })
  })

  describe('addPathBookmark', () => {
    it('adds a bookmark and mirrors it to the sibling scope', () => {
      const ok = useAppStore.getState().addPathBookmark('sftp:srv-1', '/var/log')
      expect(ok).toBe(true)
      expect(bookmarks('sftp:srv-1')).toEqual(['/var/log'])
      expect(bookmarks('workspace:srv-1')).toEqual(['/var/log'])
    })

    it('does not mirror for the local scope', () => {
      const ok = useAppStore.getState().addPathBookmark('sftp:local', '/tmp')
      expect(ok).toBe(true)
      expect(bookmarks('sftp:local')).toEqual(['/tmp'])
      expect(bookmarks('workspace:local')).toEqual([])
    })

    it('rejects an empty path', () => {
      expect(useAppStore.getState().addPathBookmark('sftp:srv-1', '')).toBe(false)
    })

    it('rejects duplicates', () => {
      useAppStore.getState().addPathBookmark('sftp:srv-1', '/a')
      expect(useAppStore.getState().addPathBookmark('sftp:srv-1', '/a')).toBe(false)
      expect(bookmarks('sftp:srv-1')).toEqual(['/a'])
    })

    it('unifies with the sibling list before de-duplicating', () => {
      useAppStore.setState({ pathBookmarks: { 'workspace:srv-1': ['/from-workspace'] } })
      const ok = useAppStore.getState().addPathBookmark('sftp:srv-1', '/new')
      expect(ok).toBe(true)
      expect(bookmarks('sftp:srv-1').sort()).toEqual(['/from-workspace', '/new'])
    })

    it('caps the unified list at 50 entries', () => {
      const full = Array.from({ length: 50 }, (_, i) => `/p${i}`)
      useAppStore.setState({ pathBookmarks: { 'sftp:srv-1': full } })
      expect(useAppStore.getState().addPathBookmark('sftp:srv-1', '/overflow')).toBe(false)
      expect(bookmarks('sftp:srv-1')).toHaveLength(50)
    })
  })

  describe('removePathBookmark', () => {
    it('removes the path from both scopes', () => {
      useAppStore.getState().addPathBookmark('sftp:srv-1', '/a')
      useAppStore.getState().addPathBookmark('sftp:srv-1', '/b')
      useAppStore.getState().removePathBookmark('sftp:srv-1', '/a')
      expect(bookmarks('sftp:srv-1')).toEqual(['/b'])
      expect(bookmarks('workspace:srv-1')).toEqual(['/b'])
    })

    it('is a no-op for an empty path', () => {
      useAppStore.setState({ pathBookmarks: { 'sftp:srv-1': ['/a'] } })
      useAppStore.getState().removePathBookmark('sftp:srv-1', '')
      expect(bookmarks('sftp:srv-1')).toEqual(['/a'])
    })
  })

  describe('setPathBookmarks', () => {
    it('replaces the list and mirrors to the sibling', () => {
      useAppStore.getState().setPathBookmarks('sftp:srv-1', ['/x', '/y'])
      expect(bookmarks('sftp:srv-1')).toEqual(['/x', '/y'])
      expect(bookmarks('workspace:srv-1')).toEqual(['/x', '/y'])
    })
  })
})
