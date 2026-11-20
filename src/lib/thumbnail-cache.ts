import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/services/api'
import { sshService } from '@/services/ssh-service'

export const MAX_THUMBNAIL_CACHE_ENTRIES = 200
export const MAX_REMOTE_THUMBNAIL_BYTES = 2 * 1024 * 1024 // 2 MB
export const MAX_LOCAL_THUMBNAIL_BYTES = 5 * 1024 * 1024 // 5 MB

const IMAGE_EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  svg: 'image/svg+xml',
}

export function getImageExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0 || dot === fileName.length - 1) return null
  const ext = fileName.slice(dot + 1).toLowerCase()
  return ext in IMAGE_EXT_MIME ? ext : null
}

export function isThumbnailImageFile(fileName: string): boolean {
  return getImageExtension(fileName) !== null
}

export function getImageMimeType(fileName: string): string {
  const ext = getImageExtension(fileName)
  return (ext && IMAGE_EXT_MIME[ext]) || 'application/octet-stream'
}

export function getLocalThumbnailUrl(_filePath: string): string | null {
  return null
}

export function loadLocalThumbnailUrl(
  filePath: string,
  fileName: string,
  size?: number,
  modifiedTime?: string,
): Promise<string | null> {
  if (!isTauri || !filePath || !isThumbnailImageFile(fileName)) {
    return Promise.resolve(null)
  }
  if (typeof size === 'number' && size > MAX_LOCAL_THUMBNAIL_BYTES) {
    return Promise.resolve(null)
  }
  const cacheKey = `local:${filePath}:${size ?? 0}:${modifiedTime ?? ''}`
  return thumbnailCache.enqueueLoad(cacheKey, async () => {
    const b64 = await invoke<string>('files_read_local_thumbnail', { path: filePath })
    if (!b64) return null
    const mime = getImageMimeType(fileName)
    return base64ToBlobUrl(b64, mime, MAX_LOCAL_THUMBNAIL_BYTES)
  })
}

interface CacheEntry {
  url: string
  isBlobUrl: boolean
}

interface QueuedTask {
  key: string
  run: () => Promise<string | null>
  resolve: (url: string | null) => void
}

/**
 * 带 LRU 淘汰（上限 200）、自动 revokeObjectURL 防泄漏，以及独立单并发队列的缩略图缓存管理器。
 * 远端读取严格限制为 1 路并发，绝不挤占 SFTP 传输与目录浏览通道。
 */
export class ThumbnailCacheManager {
  private readonly maxEntries: number
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<string | null>>()
  private readonly queue: QueuedTask[] = []
  private activeCount = 0

  constructor(maxEntries = MAX_THUMBNAIL_CACHE_ENTRIES) {
    this.maxEntries = maxEntries
  }

  get size(): number {
    return this.cache.size
  }

  getCached(key: string): string | null {
    const hit = this.cache.get(key)
    if (!hit) return null
    // LRU: move to most-recently-used tail
    this.cache.delete(key)
    this.cache.set(key, hit)
    return hit.url
  }

  set(key: string, url: string, isBlobUrl: boolean): void {
    const existing = this.cache.get(key)
    if (existing) {
      if (existing.isBlobUrl && existing.url !== url) {
        this.revokeUrl(existing.url)
      }
      this.cache.delete(key)
    }
    this.cache.set(key, { url, isBlobUrl })
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey === undefined) break
      const oldest = this.cache.get(oldestKey)
      this.cache.delete(oldestKey)
      if (oldest?.isBlobUrl) {
        this.revokeUrl(oldest.url)
      }
    }
  }

  clear(): void {
    for (const entry of this.cache.values()) {
      if (entry.isBlobUrl) {
        this.revokeUrl(entry.url)
      }
    }
    this.cache.clear()
  }

  /**
   * 通过独立单并发队列获取远端缩略图（自动去重并发请求并写入 LRU 缓存）。
   */
  enqueueLoad(key: string, fetcher: () => Promise<string | null>): Promise<string | null> {
    const cached = this.getCached(key)
    if (cached) return Promise.resolve(cached)

    const existingInflight = this.inflight.get(key)
    if (existingInflight) return existingInflight

    const promise = new Promise<string | null>((resolve) => {
      this.queue.push({ key, run: fetcher, resolve })
      this.pump()
    }).finally(() => {
      this.inflight.delete(key)
    })

    this.inflight.set(key, promise)
    return promise
  }

  private pump(): void {
    if (this.activeCount >= 1) return
    const next = this.queue.shift()
    if (!next) return

    this.activeCount += 1
    next
      .run()
      .then((url) => {
        if (url) {
          this.set(next.key, url, url.startsWith('blob:'))
        }
        next.resolve(url)
      })
      .catch(() => {
        next.resolve(null)
      })
      .finally(() => {
        this.activeCount -= 1
        this.pump()
      })
  }

  private revokeUrl(url: string): void {
    try {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url)
      }
    } catch {
      // ignore revoke errors in non-DOM test envs
    }
  }
}

export const thumbnailCache = new ThumbnailCacheManager()

const BASE64_PREFIX = '::base64::'

function base64ToBlobUrl(b64: string, mimeType: string, maxBytes: number): string | null {
  const binary = atob(b64)
  const len = binary.length
  if (len > maxBytes) {
    return null
  }
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  const blob = new Blob([bytes], { type: mimeType })
  return URL.createObjectURL(blob)
}

export function loadRemoteThumbnailUrl(
  serverId: string,
  filePath: string,
  fileName: string,
  size?: number,
  modifiedTime?: string,
): Promise<string | null> {
  if (!serverId || !filePath || !isThumbnailImageFile(fileName)) {
    return Promise.resolve(null)
  }
  if (typeof size === 'number' && size > MAX_REMOTE_THUMBNAIL_BYTES) {
    return Promise.resolve(null)
  }

  const cacheKey = `remote:${serverId}:${filePath}:${size ?? 0}:${modifiedTime ?? ''}`
  return thumbnailCache.enqueueLoad(cacheKey, async () => {
    const res = await sshService.readFile(serverId, filePath)
    const content = res?.stdout
    if (!content) return null
    const mime = getImageMimeType(fileName)
    if (content.startsWith(BASE64_PREFIX)) {
      return base64ToBlobUrl(
        content.slice(BASE64_PREFIX.length),
        mime,
        MAX_REMOTE_THUMBNAIL_BYTES,
      )
    }
    if (mime === 'image/svg+xml') {
      if (content.length > MAX_REMOTE_THUMBNAIL_BYTES) return null
      const blob = new Blob([content], { type: mime })
      return URL.createObjectURL(blob)
    }
    return null
  })
}
