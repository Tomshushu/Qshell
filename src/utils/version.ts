import { useState, useEffect } from 'react'
import { isTauri } from '@/services/api'

declare const __APP_VERSION__: string | undefined

// 编译期版本号（由 vite 注入 package.json 版本，或回退至常量）
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.6'

/**
 * 动态获取当前客户端运行时的真实版本号
 * 桌面端（Tauri）中优先调用 getVersion() 读取安装包真实的二进制包版本，浏览器环境回退至编译期常量
 */
export async function getAppVersion(): Promise<string> {
  if (isTauri) {
    try {
      const { getVersion } = await import('@tauri-apps/api/app')
      const ver = await getVersion()
      if (ver) return ver
    } catch {
      /* ignore */
    }
  }
  return APP_VERSION
}

/**
 * React Hook: 响应式获取当前客户端运行时的真实版本号
 */
export function useAppVersion(): string {
  const [version, setVersion] = useState<string>(APP_VERSION)

  useEffect(() => {
    let active = true
    void getAppVersion().then((ver) => {
      if (active && ver) {
        setVersion(ver)
      }
    })
    return () => {
      active = false
    }
  }, [])

  return version
}
