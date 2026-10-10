//! SSH 连接状态机与错误分类
//!
//! 设计目标：
//! 1. 统一连接状态来源（仅 SshManager 持有，DB 不再保存 online/offline）
//! 2. 区分错误类型决定是否重连（AuthError / HostKeyMismatch 不重连）
//! 3. 前端通过事件订阅状态变化，避免三处状态不同步

use serde::Serialize;

use super::connection::SshError;

/// SSH 连接状态机的所有可能状态
///
/// 状态迁移路径：
/// ```text
/// Disconnected ──connect()──> Connecting ──TCP OK──> Authenticating ──auth OK──> Ready
///      ▲                            │                       │                    │
///      │                            │                       │                    │
///      │                            ▼                       ▼                    ▼
///      │                        Failed                 Failed            Disconnecting
///      │                            │                                       │
///      │                            ▼                                       ▼
///      └────────────────── (Reconnect only if should_retry)            Disconnected
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionState {
    /// 未连接（初始态或手动断开后）
    Disconnected,
    /// 正在建立 TCP+SSH 握手
    Connecting,
    /// 正在认证（密码/公钥）
    Authenticating,
    /// 已就绪，可执行 exec/shell/sftp
    Ready,
    /// 正在断开
    Disconnecting,
    /// 连接失败（保留 last_error，等用户决定是否重连）
    Failed,
}

impl ConnectionState {
    /// 是否允许 exec/shell 等操作
    pub fn is_operational(self) -> bool {
        matches!(self, Self::Ready)
    }

    /// 是否处于终态（不再变化，除非显式 connect/disconnect）
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Disconnected | Self::Failed)
    }
}

/// SSH 错误分类
///
/// 用于决定是否触发自动重连：
/// - 网络类错误（NetworkError / Timeout / ConnectionReset）→ 可重连
/// - 凭证/配置类错误（AuthError / PermissionDenied / HostKeyMismatch）→ 不可重连
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SshErrorKind {
    /// 网络不可达 / TCP 连接失败 / DNS 解析失败等 → 可重连
    NetworkError,
    /// TCP/SSH 握手或 exec 超时 → 可重连
    Timeout,
    /// 连接被重置 / 远端主动关闭 → 可重连
    ConnectionReset,
    /// 认证失败（密码错误、公钥被拒）→ 不重连
    AuthError,
    /// 权限不足 → 不重连
    PermissionDenied,
    /// 主机密钥不匹配（疑似 MITM）→ 不重连
    HostKeyMismatch,
    /// 其他未知错误 → 默认可重连（保守策略）
    Unknown,
}

impl SshErrorKind {
    /// 该错误类型是否应该触发自动重连
    pub fn should_retry(self) -> bool {
        match self {
            Self::NetworkError
            | Self::Timeout
            | Self::ConnectionReset
            | Self::Unknown => true,
            Self::AuthError | Self::PermissionDenied | Self::HostKeyMismatch => false,
        }
    }
}

impl From<&SshError> for SshErrorKind {
    fn from(err: &SshError) -> Self {
        match err {
            SshError::AuthFailed(_) => Self::AuthError,
            SshError::HostKeyVerificationFailed(msg) => {
                // "has changed" 表示密钥变更（疑似 MITM），其他视为权限不足
                if msg.contains("has changed") || msg.contains("MITM") {
                    Self::HostKeyMismatch
                } else {
                    Self::PermissionDenied
                }
            }
            SshError::ConnectionFailed(msg) => {
                if msg.contains("timed out") {
                    Self::Timeout
                } else {
                    Self::NetworkError
                }
            }
            SshError::ConnectionLost(_) => Self::ConnectionReset,
            SshError::NotConnected(_) => Self::NetworkError,
            SshError::CommandTimeout(_) => Self::Timeout,
            SshError::ExecutionFailed(msg) => {
                if msg.contains("closed") || msg.contains("broken") || msg.contains("reset") {
                    Self::ConnectionReset
                } else {
                    Self::Unknown
                }
            }
            SshError::ChannelOpenFailed(msg) => {
                if msg.contains("closed") || msg.contains("EOF") {
                    Self::ConnectionReset
                } else {
                    Self::Unknown
                }
            }
            _ => Self::Unknown,
        }
    }
}

/// 推送给前端的连接状态变更事件 payload
///
/// `generation` 是单调递增的版本号（每次新连接 / 重连 +1），
/// 前端据此丢弃过期事件，避免事件乱序导致的状态回退
/// （例如旧 Ready 事件晚于新 Disconnecting 事件到达）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStateData {
    pub server_id: String,
    pub state: ConnectionState,
    /// 失败时的错误消息
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// 失败时的错误分类
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<SshErrorKind>,
    /// 状态版本号：同 server_id 下单调递增，前端丢弃 < 当前已知 generation 的事件
    pub generation: u64,
}
