/**
 * 最近连接记录（localStorage）
 *
 * - 记录来源：每次通过 openTab 打开服务器工作台 / RDP 远程桌面启动时调用 recordConnection
 * - 存储格式：最近连接数组 [{ serverId, at }]，按时间倒序（最新在前）
 * - 上限 28 条（去重：同一服务器再次出现时移到队首），超出丢弃最老
 * - 跨会话持久（localStorage），通过自定义事件通知组件刷新
 */

const STORAGE_KEY = 'trae:recent-connections'
const MAX_RECENT = 15
const EVENT = 'recent-connections-changed'

export interface RecentConnection {
  serverId: string
  at: number
}

function read(): RecentConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is RecentConnection =>
        r && typeof r.serverId === 'string' && typeof r.at === 'number',
    )
  } catch {
    return []
  }
}

function write(list: RecentConnection[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    // 通知监听组件（侧边栏计数 / 主区过滤）实时刷新
    window.dispatchEvent(new Event(EVENT))
  } catch {
    // 配额满：忽略，历史记录不阻断主流程
  }
}

/** 记录一次连接（去重并置顶，最多保留最近 MAX_RECENT 条） */
export function recordConnection(serverId: string): void {
  if (!serverId || serverId === 'sftp') return
  const list = read().filter((r) => r.serverId !== serverId)
  list.unshift({ serverId, at: Date.now() })
  if (list.length > MAX_RECENT) list.length = MAX_RECENT
  write(list)
}

/** 读取最近连接列表（按时间倒序，最多 MAX_RECENT 条） */
export function getRecentConnections(): RecentConnection[] {
  return read().slice(0, MAX_RECENT)
}

/** 读取最近连接的 serverId 有序数组（用于过滤 / 计数） */
export function getRecentServerIds(): string[] {
  return getRecentConnections().map((r) => r.serverId)
}

/** 删除服务器时清理其最近连接记录 */
export function removeRecentConnection(serverId: string): void {
  const current = read()
  const next = current.filter((r) => r.serverId !== serverId)
  if (next.length !== current.length) write(next)
}

/** 批量清理最近连接记录：只做一次 localStorage 读/写与一次事件通知 */
export function removeRecentConnections(serverIds: string[]): void {
  if (serverIds.length === 0) return
  const idSet = new Set(serverIds)
  const current = read()
  const next = current.filter((r) => !idSet.has(r.serverId))
  if (next.length !== current.length) write(next)
}
