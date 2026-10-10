import type { FileEntry } from '@/types'

export interface FilesModuleProps {
  serverId: string
  /** SSH 连接是否已建立；保活模式下用于延迟首次目录加载，避免未连接时发起请求 */
  isConnected?: boolean
  /** 模块当前是否可见；原生拖放是 WebView 全局事件，只允许可见模块处理 */
  isActive?: boolean
}

export interface TreeNode {
  path: string
  name: string
  children: TreeNode[]
  loaded: boolean
  loading: boolean
}

export type SortField = 'name' | 'size' | 'modifiedTime'
export type SortDirection = 'asc' | 'desc'

export interface ContextMenuState {
  x: number
  y: number
  file: FileEntry | null
}
