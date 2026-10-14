import type { FileEntry } from '@/types'

export interface FilesModuleProps {
  serverId: string
  /** SSH 连接是否已建立；保活模式下用于延迟首次目录加载，避免未连接时发起请求 */
  isConnected?: boolean
  /** 模块当前是否可见；原生拖放是 WebView 全局事件，只允许可见模块处理 */
  isActive?: boolean
  /** 异步获取终端最新工作目录的回调（用于主动探测或刷新） */
  getTerminalCwd?: () => Promise<string | null> | string | null | undefined
  /** 订阅终端 cwd 变化推送：变化时触发一次跟随，返回取消订阅函数 */
  subscribeTerminalCwd?: (listener: () => void) => () => void
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
