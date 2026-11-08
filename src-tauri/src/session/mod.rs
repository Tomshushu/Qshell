//! 交互式 Shell 会话路由（Phase 0）
//!
//! 所有终端类协议（SSH / Telnet / Serial / 未来的本地 Shell）共用同一组
//! `ssh_*` IPC 命令与 `ssh:shell-*` 事件。这里把「session_id 前缀 → 会话驱动」
//! 的映射集中为唯一真源，避免每个命令各自硬编码 `starts_with` 字符串。
//!
//! 注意：本模块只做「路由判定」，不改变任何协议的实际处理逻辑；
//! 各命令的 match 分支仍与重构前一一对应（含 Telnet/Serial 的历史差异行为）。

/// 会话驱动种类
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionKind {
    /// SSH PTY（默认，无专用前缀）
    Ssh,
    /// Telnet 会话
    Telnet,
    /// 串口会话
    Serial,
}

/// 前缀 → 驱动 的注册项
#[derive(Debug, Clone, Copy)]
pub struct SessionRoute {
    pub prefix: &'static str,
    pub kind: SessionKind,
}

/// 会话驱动注册表。
/// 顺序敏感：与历史实现一致，`serial-` 先于 `telnet-` 匹配；未命中回退 SSH。
/// 新增终端类协议只需在此追加一行，并在各 `ssh_*` 命令的 match 中补一个分支。
pub const SESSION_ROUTES: &[SessionRoute] = &[
    SessionRoute {
        prefix: "serial-",
        kind: SessionKind::Serial,
    },
    SessionRoute {
        prefix: "telnet-",
        kind: SessionKind::Telnet,
    },
];

/// 按 session_id 前缀解析会话驱动；未知前缀一律回退 SSH（兼容历史数据）。
pub fn route(session_id: &str) -> SessionKind {
    SESSION_ROUTES
        .iter()
        .find(|entry| session_id.starts_with(entry.prefix))
        .map(|entry| entry.kind)
        .unwrap_or(SessionKind::Ssh)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_known_prefixes_and_defaults_to_ssh() {
        assert_eq!(route("serial-0d51-4e5b"), SessionKind::Serial);
        assert_eq!(route("telnet-9c11-4f18"), SessionKind::Telnet);
        assert_eq!(route("shell-1a2b"), SessionKind::Ssh);
        assert_eq!(route("tail-1a2b"), SessionKind::Ssh);
        assert_eq!(route(""), SessionKind::Ssh);
        assert_eq!(route("local-unknown-for-now"), SessionKind::Ssh);
    }

    #[test]
    fn route_table_has_unique_non_empty_prefixes() {
        assert_eq!(SESSION_ROUTES.len(), 2);
        for entry in SESSION_ROUTES {
            assert!(!entry.prefix.is_empty());
            assert_eq!(
                SESSION_ROUTES
                    .iter()
                    .filter(|other| other.prefix == entry.prefix)
                    .count(),
                1
            );
        }
    }
}
