import type { ReactNode } from 'react'

export type FileIconThemeId = 'precision' | 'yaru' | 'developer' | 'minimal'

export interface FileLike {
  name: string
  path?: string
  isDirectory?: boolean
  isSymlink?: boolean
  size?: number
  modified?: string
  mimeType?: string
}

export interface FileIconTheme {
  id: FileIconThemeId
  nameKey: string
  descKey: string
  /** 设置面板中的文件夹预览图标 */
  renderPreviewFolder: (size?: string) => ReactNode
  /** 设置面板中的普通文件预览图标 */
  renderPreviewFile: (size?: string) => ReactNode
  /** 设置面板中的多图标特色预览列表（默认展示 4~5 个特色代表图标） */
  renderPreviewList?: (size?: string) => ReactNode[]
  /** 核心渲染函数 */
  renderIcon: (file: FileLike, size?: string) => ReactNode
}
