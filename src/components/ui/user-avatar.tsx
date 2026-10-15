import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'

interface UserAvatarProps {
  url?: string | null
  name?: string | null
  className?: string
  fallbackClassName?: string
}

export function UserAvatar({
  url,
  name,
  className,
  fallbackClassName,
}: UserAvatarProps) {
  const [hasError, setHasError] = useState(false)

  // 当头像 URL 改变时重置错误状态
  useEffect(() => {
    setHasError(false)
  }, [url])

  // 如果有有效 URL 且未发生拉取异常，显示远端用户头像
  if (url && !hasError) {
    return (
      <img
        src={url}
        alt={name || 'User Avatar'}
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        onError={() => setHasError(true)}
        className={cn('object-cover rounded-full select-none', className)}
      />
    )
  }

  // 如果无头像 URL 或拉取失败，显示 Qshell 应用默认图标当作头像
  return (
    <div
      className={cn(
        'rounded-full overflow-hidden flex items-center justify-center select-none bg-slate-950 shrink-0',
        fallbackClassName || className,
      )}
      title={name ? `${name} (Qshell)` : 'Qshell'}
    >
      <img
        src="/favicon.svg"
        alt="Qshell App"
        className="h-full w-full object-cover rounded-full"
      />
    </div>
  )
}
