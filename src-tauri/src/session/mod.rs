//! 交互式 Shell 会话路由（Phase 0）
//!
//! 所有终端类协议（SSH / Telnet / Serial / 未来的本地 Shell）共用同一组
//! `ssh_*` IPC 命令与 `ssh:shell-*` 事件。这里把「session_id 前缀 → 会话驱动」
//! 的映射集中为唯一真源，避免每个命令各自硬编码 `starts_with` 字符串。
//!
//! 注意：本模块只做「路由判定」，不改变任何协议的实际处理逻辑；
//! 各命令的 match 分支仍与重构前一一对应（含 Telnet/Serial 的历史差异行为）。

use tauri::{AppHandle, Emitter};

/// 默认终端类型（xterm-256color）
pub const DEFAULT_TERM_TYPE: &str = "xterm-256color";

/// 终端实时流量遥测事件（每 500ms 仅在数值变化时触发，不污染输出流）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTrafficData {
    pub session_id: String,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

/// 发送终端会话流量快照（节流由调用方按 500ms 间隔控制）
pub fn emit_session_traffic(app: &AppHandle, session_id: &str, rx_bytes: u64, tx_bytes: u64) {
    let _ = app.emit(
        "session:traffic",
        SessionTrafficData {
            session_id: session_id.to_string(),
            rx_bytes,
            tx_bytes,
        },
    );
}

/// 规范化终端类型（TERM）参数：仅允许 1~64 位安全 ASCII 字符，非法输入回退默认值
pub fn normalize_term_type(term_type: Option<&str>) -> String {
    let trimmed = term_type.unwrap_or("").trim();
    if !trimmed.is_empty()
        && trimmed.len() <= 64
        && trimmed
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'+'))
    {
        trimmed.to_string()
    } else {
        DEFAULT_TERM_TYPE.to_string()
    }
}

/// 会话驱动种类
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionKind {
    /// SSH PTY（默认，无专用前缀）
    Ssh,
    /// Telnet 会话
    Telnet,
    /// 串口会话
    Serial,
    /// 本地 Shell 会话（session_id 以 `local-` 开头）
    Local,
}

/// 前缀 → 驱动 的注册项
#[derive(Debug, Clone, Copy)]
pub struct SessionRoute {
    pub prefix: &'static str,
    pub kind: SessionKind,
}

/// 会话驱动注册表。
/// 顺序敏感：与历史实现一致，`local-` / `serial-` / `telnet-` 依次匹配；未命中回退 SSH。
/// 新增终端类协议只需在此追加一行，并在各 `ssh_*` 命令的 match 中补一个分支。
pub const SESSION_ROUTES: &[SessionRoute] = &[
    SessionRoute {
        prefix: "local-",
        kind: SessionKind::Local,
    },
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
        assert_eq!(route("local-0d51-4e5b"), SessionKind::Local);
        assert_eq!(route("serial-0d51-4e5b"), SessionKind::Serial);
        assert_eq!(route("telnet-9c11-4f18"), SessionKind::Telnet);
        assert_eq!(route("shell-1a2b"), SessionKind::Ssh);
        assert_eq!(route("tail-1a2b"), SessionKind::Ssh);
        assert_eq!(route(""), SessionKind::Ssh);
    }

    #[test]
    fn normalize_term_type_accepts_valid_and_falls_back_safely() {
        assert_eq!(normalize_term_type(None), DEFAULT_TERM_TYPE);
        assert_eq!(normalize_term_type(Some("   ")), DEFAULT_TERM_TYPE);
        assert_eq!(normalize_term_type(Some(" vt100 ")), "vt100");
        assert_eq!(normalize_term_type(Some("VT220")), "VT220");
        assert_eq!(normalize_term_type(Some("xterm-256color")), "xterm-256color");
        assert_eq!(normalize_term_type(Some("vt100;rm -rf /")), DEFAULT_TERM_TYPE);
    }

    #[test]
    fn route_table_has_unique_non_empty_prefixes() {
        assert_eq!(SESSION_ROUTES.len(), 3);
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
