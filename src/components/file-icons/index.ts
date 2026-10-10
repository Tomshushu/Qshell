import type { ReactNode } from 'react'
import type { FileLike, FileIconThemeId } from './types'
import { getFileIconTheme } from './registry'
import { useAppStore } from '@/store'

export * from './types'
export * from './registry'

/**
 * 带有明确主题 ID 指定的文件图标渲染函数
 */
export function renderThemedFileIcon(
  file: FileLike,
  themeId?: FileIconThemeId | null,
  size = 'h-4 w-4',
): ReactNode {
  const theme = getFileIconTheme(themeId)
  return theme.renderIcon(file, size)
}

/**
 * 默认文件图标渲染函数：自动读取当前 AppStore 中配置的 sftpFileIconTheme 主题
 */
export function renderFileIcon(file: FileLike, size = 'h-4 w-4'): ReactNode {
  let activeThemeId: FileIconThemeId = 'developer'
  try {
    const storeTheme = useAppStore.getState().sftpFileIconTheme
    if (storeTheme) {
      activeThemeId = storeTheme
    }
  } catch {
    // 降级兜底
  }
  return renderThemedFileIcon(file, activeThemeId, size)
}
