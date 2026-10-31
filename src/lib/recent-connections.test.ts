import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  recordConnection,
  getRecentConnections,
  getRecentServerIds,
  removeRecentConnection,
  removeRecentConnections,
} from './recent-connections'

const STORAGE_KEY = 'trae:recent-connections'

describe('recent-connections', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('records a new connection', () => {
    recordConnection('srv-1')
    const list = getRecentConnections()
    expect(list).toHaveLength(1)
    expect(list[0].serverId).toBe('srv-1')
    expect(list[0].at).toBeGreaterThan(0)
  })

  it('ignores invalid or reserved server IDs', () => {
    recordConnection('')
    recordConnection('sftp')
    expect(getRecentConnections()).toHaveLength(0)
  })

  it('moves existing server connection to the top (deduplication)', () => {
    recordConnection('srv-1')
    recordConnection('srv-2')
    expect(getRecentServerIds()).toEqual(['srv-2', 'srv-1'])

    // Re-connect srv-1
    recordConnection('srv-1')
    expect(getRecentServerIds()).toEqual(['srv-1', 'srv-2'])
  })

  it('caps at maximum 15 items', () => {
    for (let i = 1; i <= 20; i++) {
      recordConnection(`srv-${i}`)
    }
    const list = getRecentConnections()
    expect(list).toHaveLength(15)
    // Most recent is srv-20
    expect(list[0].serverId).toBe('srv-20')
    // Oldest preserved is srv-6
    expect(list[14].serverId).toBe('srv-6')
  })

  it('removes a connection by server ID', () => {
    recordConnection('srv-1')
    recordConnection('srv-2')
    removeRecentConnection('srv-1')
    expect(getRecentServerIds()).toEqual(['srv-2'])
  })

  it('batch removes connections', () => {
    recordConnection('s1')
    recordConnection('s2')
    recordConnection('s3')
    removeRecentConnections(['s1', 's3'])
    expect(getRecentServerIds()).toEqual(['s2'])

    // Empty list is a no-op
    removeRecentConnections([])
    expect(getRecentServerIds()).toEqual(['s2'])
  })

  it('recovers gracefully from corrupted localStorage content', () => {
    localStorage.setItem(STORAGE_KEY, 'invalid-json{{{')
    expect(getRecentConnections()).toEqual([])

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: 'an array' }))
    expect(getRecentConnections()).toEqual([])
  })

  it('dispatches recent-connections-changed event on write', () => {
    const handler = vi.fn()
    window.addEventListener('recent-connections-changed', handler)

    recordConnection('srv-x')
    expect(handler).toHaveBeenCalledTimes(1)

    window.removeEventListener('recent-connections-changed', handler)
  })
})
