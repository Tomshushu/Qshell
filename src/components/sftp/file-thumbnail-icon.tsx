import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import {
  MAX_LOCAL_THUMBNAIL_BYTES,
  MAX_REMOTE_THUMBNAIL_BYTES,
  isThumbnailImageFile,
  loadLocalThumbnailUrl,
  loadRemoteThumbnailUrl,
  thumbnailCache,
} from '@/lib/thumbnail-cache'

export interface FileThumbnailIconProps {
  name: string
  path: string
  isDirectory?: boolean
  size?: number
  modifiedTime?: string
  /** 'local' 使用 Tauri asset:// 直出；对象则通过低并发 SFTP 缩略图队列按需加载 */
  source: 'local' | { serverId: string }
  /** 尺寸类名（与原 renderFileIcon 保持一致，如 'h-6 w-6' / 'h-12 w-12'） */
  sizeClass: string
  /** 非图片、禁用缩略图、加载中或加载失败时的回退图标 */
  fallback: ReactNode
}

/**
 * 文件列表 / 图标视图图片缩略图组件（P2-16）。
 * 仅对可视区内的图片文件按需加载，避免大目录滚动时触发无效 I/O。
 */
export const FileThumbnailIcon = memo(function FileThumbnailIcon({
  name,
  path,
  isDirectory,
  size,
  modifiedTime,
  source,
  sizeClass,
  fallback,
}: FileThumbnailIconProps) {
  const isLocal = source === 'local'
  const enabled = useAppStore((s) =>
    isLocal ? s.sftpThumbnailsLocal : s.sftpThumbnailsRemote,
  )

  const maxBytes = isLocal ? MAX_LOCAL_THUMBNAIL_BYTES : MAX_REMOTE_THUMBNAIL_BYTES
  const eligible =
    enabled &&
    !isDirectory &&
    Boolean(path) &&
    isThumbnailImageFile(name) &&
    (typeof size !== 'number' || size <= maxBytes)

  const serverId = isLocal ? '' : source.serverId
  const cacheKey = isLocal
    ? `local:${path}:${size ?? 0}:${modifiedTime ?? ''}`
    : `remote:${serverId}:${path}:${size ?? 0}:${modifiedTime ?? ''}`

  const [visible, setVisible] = useState(false)
  const [url, setUrl] = useState<string | null>(() => {
    if (!eligible) return null
    return thumbnailCache.getCached(cacheKey)
  })
  const [failed, setFailed] = useState(false)
  const hostRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    setFailed(false)
    if (!eligible) {
      setUrl(null)
      return
    }
    setUrl(thumbnailCache.getCached(cacheKey))
  }, [eligible, cacheKey])

  useEffect(() => {
    if (!eligible || url || failed) return
    const node = hostRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '80px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [eligible, url, failed])

  useEffect(() => {
    if (!eligible || !visible || url || failed) return
    if (!isLocal && !serverId) return
    let cancelled = false
    const loader = isLocal
      ? loadLocalThumbnailUrl(path, name, size, modifiedTime)
      : loadRemoteThumbnailUrl(serverId, path, name, size, modifiedTime)
    void loader.then((loaded) => {
      if (cancelled) return
      if (loaded) setUrl(loaded)
      else setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [eligible, isLocal, visible, url, failed, serverId, path, name, size, modifiedTime])

  if (!eligible || failed) {
    return <>{fallback}</>
  }

  if (!url) {
    return (
      <span ref={hostRef} className="inline-flex items-center justify-center shrink-0">
        {fallback}
      </span>
    )
  }

  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className={cn(
        sizeClass,
        'object-cover rounded-sm shrink-0 border border-border/40 bg-muted/30',
      )}
    />
  )
})
