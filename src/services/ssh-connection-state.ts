/**
 * SSH 连接状态机定义（前端）
 *
 * 与后端 `src-tauri/src/ssh/state.rs` 完全对应。
 * 前端业务代码应通过此 enum 驱动 UI，而不是依赖 boolean isConnected。
 *
 * 设计目标：
 * 1. 解决"connect → disconnect → connect"循环（避免无意义重连）
 * 2. 区分错误类型决定是否自动重连
 *    - NetworkError / Timeout / ConnectionReset / Unknown → 可重连
 *    - AuthError / PermissionDenied / HostKeyMismatch → 不重连
 * 3. 让前端能区分"连接中"、"已就绪"、"失败"等不同阶段
 */

/** SSH 连接状态机的所有状态（与后端 enum 一一对应） */
export enum ConnectionState {
  /** 未连接（初始态或手动断开后） */
  Disconnected = 'disconnected',
  /** 正在建立 TCP+SSH 握手 */
  Connecting = 'connecting',
  /** 正在认证（密码/公钥） */
  Authenticating = 'authenticating',
  /** 已就绪，可执行 exec/shell/sftp */
  Ready = 'ready',
  /** 正在断开 */
  Disconnecting = 'disconnecting',
  /** 连接失败（保留 last_error，等用户决定是否重连） */
  Failed = 'failed',
}

/** SSH 错误分类（与后端 SshErrorKind 一一对应） */
export enum SshErrorKind {
  /** 网络不可达 / TCP 连接失败 / DNS 解析失败等 → 可重连 */
  NetworkError = 'networkError',
  /** TCP/SSH 握手或 exec 超时 → 可重连 */
  Timeout = 'timeout',
  /** 连接被重置 / 远端主动关闭 → 可重连 */
  ConnectionReset = 'connectionReset',
  /** 认证失败（密码错误、公钥被拒）→ 不重连 */
  AuthError = 'authError',
  /** 权限不足 → 不重连 */
  PermissionDenied = 'permissionDenied',
  /** 主机密钥不匹配（疑似 MITM）→ 不重连 */
  HostKeyMismatch = 'hostKeyMismatch',
  /** 其他未知错误 → 默认可重连（保守策略） */
  Unknown = 'unknown',
}

/** 该错误类型是否应该触发自动重连 */
export function shouldRetry(kind: SshErrorKind | undefined | null): boolean {
  if (!kind) return true // 没有错误分类时默认重连（保守策略）
  switch (kind) {
    case SshErrorKind.NetworkError:
    case SshErrorKind.Timeout:
    case SshErrorKind.ConnectionReset:
    case SshErrorKind.Unknown:
      return true
    case SshErrorKind.AuthError:
    case SshErrorKind.PermissionDenied:
    case SshErrorKind.HostKeyMismatch:
      return false
    default:
      return true
  }
}

/**
 * 后端推送的 ssh:state-changed 事件 payload
 *
 * `generation` 是单调递增的状态版本号（每次新连接 +1）。
 * 前端收到事件后应比较 generation：若 <= 当前已知 generation，则丢弃，
 * 避免事件乱序导致的状态回退（例如旧 Ready 事件晚于新 Disconnecting 事件到达）。
 */
export interface ConnectionStateData {
  serverId: string
  state: ConnectionState
  error?: string
  errorKind?: SshErrorKind
  /** 状态版本号：同 server_id 下单调递增 */
  generation: number
}

/** ssh_get_state 命令的返回值 */
export interface SshStateResult {
  state: ConnectionState
  error?: string
  errorKind?: SshErrorKind
  /** 状态版本号：与 ssh:state-changed 事件中的 generation 一致 */
  generation: number
}

/** 状态机辅助判断：是否允许 exec/shell 等操作 */
export function isOperational(state: ConnectionState): boolean {
  return state === ConnectionState.Ready
}

/** 状态机辅助判断：是否处于终态（不再变化，除非显式 connect/disconnect） */
export function isTerminal(state: ConnectionState): boolean {
  return state === ConnectionState.Disconnected || state === ConnectionState.Failed
}

/** 状态机辅助判断：是否正在连接中（含 Connecting / Authenticating） */
export function isConnecting(state: ConnectionState): boolean {
  return state === ConnectionState.Connecting || state === ConnectionState.Authenticating
}

/** 状态机辅助判断：是否被视为"已连接"（用于兼容旧的 boolean isConnected 逻辑） */
export function isReady(state: ConnectionState): boolean {
  return state === ConnectionState.Ready
}

/** 从可能带命名空间前缀的连接 ID（如 `sftp:<server_id>` 或 `ws:<server_id>:<tab_id>`）中提取原始 server_id */
export function extractBaseServerId(connId?: string | null): string {
  if (!connId) return ''
  if (connId.startsWith('sftp:')) return connId.slice(5)
  if (connId.startsWith('ws:')) {
    const rest = connId.slice(3)
    const idx = rest.indexOf(':')
    return idx === -1 ? rest : rest.slice(0, idx)
  }
  return connId
}
