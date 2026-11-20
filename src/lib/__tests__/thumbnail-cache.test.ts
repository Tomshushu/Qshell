import { describe, expect, it, vi } from 'vitest'
import {
  ThumbnailCacheManager,
  getImageMimeType,
  isThumbnailImageFile,
} from '../thumbnail-cache'

describe('thumbnail-cache (P2-16)', () => {
  it('detects supported image extensions and mime types', () => {
    expect(isThumbnailImageFile('photo.PNG')).toBe(true)
    expect(isThumbnailImageFile('avatar.webp')).toBe(true)
    expect(isThumbnailImageFile('icon.svg')).toBe(true)
    expect(isThumbnailImageFile('archive.tar.gz')).toBe(false)
    expect(isThumbnailImageFile('README')).toBe(false)
    expect(getImageMimeType('banner.jpg')).toBe('image/jpeg')
    expect(getImageMimeType('diagram.svg')).toBe('image/svg+xml')
  })

  it('evicts least-recently-used entries and revokes blob URLs', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const mgr = new ThumbnailCacheManager(2)

    mgr.set('k1', 'blob:one', true)
    mgr.set('k2', 'blob:two', true)
    // Touch k1 so k2 becomes the oldest
    expect(mgr.getCached('k1')).toBe('blob:one')

    mgr.set('k3', 'blob:three', true)
    expect(mgr.size).toBe(2)
    expect(mgr.getCached('k2')).toBeNull()
    expect(mgr.getCached('k1')).toBe('blob:one')
    expect(mgr.getCached('k3')).toBe('blob:three')
    expect(revokeSpy).toHaveBeenCalledWith('blob:two')

    mgr.clear()
    expect(mgr.size).toBe(0)
    expect(revokeSpy).toHaveBeenCalledWith('blob:one')
    expect(revokeSpy).toHaveBeenCalledWith('blob:three')
    revokeSpy.mockRestore()
  })

  it('limits remote thumbnail fetches to 1 concurrent task and deduplicates inflight keys', async () => {
    const mgr = new ThumbnailCacheManager(10)
    let active = 0
    let maxActive = 0
    const resolvers: Array<() => void> = []

    const makeFetcher = (result: string) => async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise<void>((resolve) => {
        resolvers.push(resolve)
      })
      active -= 1
      return result
    }

    const p1a = mgr.enqueueLoad('a', makeFetcher('blob:a'))
    const p1b = mgr.enqueueLoad('a', makeFetcher('blob:a-dup'))
    const p2 = mgr.enqueueLoad('b', makeFetcher('blob:b'))

    expect(active).toBe(1)
    expect(resolvers.length).toBe(1)

    resolvers.shift()?.()
    const [r1a, r1b] = await Promise.all([p1a, p1b])
    expect(r1a).toBe('blob:a')
    expect(r1b).toBe('blob:a')

    // Second queued task now runs
    await vi.waitFor(() => expect(resolvers.length).toBe(1))
    resolvers.shift()?.()
    expect(await p2).toBe('blob:b')
    expect(maxActive).toBe(1)
  })
})
