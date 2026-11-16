//! 多轮 `keyboard-interactive` / OTP / 硬件令牌交互式认证协调器（RFC 4256）。
//!
//! 设计要点：
//! - 每次服务端下发 `InfoRequest` 时在全局 `AuthInteractionRegistry` 注册一个 `oneshot` 通道；
//! - 向前端推送 `ssh:auth-interaction-required` 事件，携带经过 ANSI/控制字符净化的 prompt；
//! - `PendingGuard` 确保无论是正常响应、90 秒超时、连接取消还是 Future 被 Drop，都会清理悬垂条目；
//! - 支持空 prompt 轮次（OpenSSH / PAM 常见预通知轮，自动回传空响应数组而不打扰用户）。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tokio::sync::oneshot;

/// 每轮交互提示等待用户响应的默认超时（秒）。
pub const AUTH_INTERACTION_TIMEOUT_SECS: u64 = 90;

/// 单次连接允许的最大 `keyboard-interactive` 往返轮数，防止恶意服务端无限循环。
pub const MAX_AUTH_ROUNDS: usize = 8;

/// 净化文本的最大保留字符数。
const MAX_SANITIZED_LEN: usize = 2048;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthPrompt {
    pub prompt: String,
    pub echo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthInteractionRequest {
    pub request_id: String,
    pub server_id: String,
    pub generation: u64,
    pub title: String,
    pub instructions: String,
    pub prompts: Vec<AuthPrompt>,
    pub timeout_secs: u64,
}

struct PendingAuth {
    server_id: String,
    sender: oneshot::Sender<Option<Vec<String>>>,
}

/// RAII 清理守卫：当等待任务完成 / 提前退出 / 被取消 / 超时时，一律从注册表摘除 `request_id`。
///
/// `remove` 本身幂等：正常响应路径中 `submit()` 已摘除条目，守卫析构时再移除一次无副作用；
/// 超时与通道关闭路径没有 `submit`/`cancel`，完全依赖守卫析构兜底，绝不能跳过。
pub struct PendingGuard<'a> {
    registry: &'a AuthInteractionRegistry,
    request_id: String,
}

impl<'a> PendingGuard<'a> {
    pub fn request_id(&self) -> &str {
        &self.request_id
    }

    /// 消费守卫并立即触发清理；保留此方法名以兼容调用点。
    pub fn disarm(self) {
        drop(self);
    }
}

impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        self.registry.remove(&self.request_id);
    }
}

/// 全局交互式认证请求注册表。
pub struct AuthInteractionRegistry {
    pending: Mutex<HashMap<String, PendingAuth>>,
}

static GLOBAL_REGISTRY: OnceLock<AuthInteractionRegistry> = OnceLock::new();

impl AuthInteractionRegistry {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }

    pub fn global() -> &'static Self {
        GLOBAL_REGISTRY.get_or_init(Self::new)
    }

    /// 注册一轮新的交互式认证等待，返回 RAII 守卫与结果接收端。
    pub fn register(&self, server_id: &str) -> (PendingGuard<'_>, oneshot::Receiver<Option<Vec<String>>>) {
        let request_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        if let Ok(mut map) = self.pending.lock() {
            map.insert(
                request_id.clone(),
                PendingAuth {
                    server_id: server_id.to_string(),
                    sender: tx,
                },
            );
        }
        (
            PendingGuard {
                registry: self,
                request_id,
            },
            rx,
        )
    }

    fn remove(&self, request_id: &str) {
        if let Ok(mut map) = self.pending.lock() {
            map.remove(request_id);
        }
    }

    /// 提交用户在前端输入的响应（`None` 表示用户主动取消），返回是否成功投递。
    pub fn submit(&self, request_id: &str, responses: Option<Vec<String>>) -> bool {
        let entry = self
            .pending
            .lock()
            .ok()
            .and_then(|mut map| map.remove(request_id));
        if let Some(pending) = entry {
            pending.sender.send(responses).is_ok()
        } else {
            false
        }
    }

    /// 取消指定服务器当前所有等待中的交互提示（例如断开连接时调用）。
    pub fn cancel_for_server(&self, server_id: &str) {
        let matched: Vec<PendingAuth> = self
            .pending
            .lock()
            .ok()
            .map(|mut map| {
                let ids: Vec<String> = map
                    .iter()
                    .filter(|(_, v)| v.server_id == server_id)
                    .map(|(k, _)| k.clone())
                    .collect();
                ids.into_iter().filter_map(|id| map.remove(&id)).collect()
            })
            .unwrap_or_default();

        for pending in matched {
            let _ = pending.sender.send(None);
        }
    }
}

/// 依据 RFC 4256 净化服务端发来的 name / instructions / prompt 文本，
/// 剥离 ANSI 转义序列（CSI / OSC / ESC）与危险控制字符，仅保留 `\n` 和 `\t`。
pub fn sanitize_auth_text(input: &str) -> String {
    let mut out = String::with_capacity(input.len().min(MAX_SANITIZED_LEN));
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if out.chars().count() >= MAX_SANITIZED_LEN {
            break;
        }
        if c == '\x1b' {
            match chars.peek().copied() {
                Some('[') => {
                    // CSI 序列：ESC [ ... <0x40..=0x7E>
                    let _ = chars.next();
                    while let Some(n) = chars.next() {
                        if ('\x40'..='\x7e').contains(&n) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    // OSC 序列：ESC ] ... (BEL 或 ESC \)
                    let _ = chars.next();
                    while let Some(n) = chars.next() {
                        if n == '\x07' {
                            break;
                        }
                        if n == '\x1b' && chars.peek() == Some(&'\\') {
                            let _ = chars.next();
                            break;
                        }
                    }
                }
                Some(_) => {
                    // 其他 2 字节 ESC 序列
                    let _ = chars.next();
                }
                None => {}
            }
            continue;
        }
        if c == '\r' {
            if chars.peek() == Some(&'\n') {
                let _ = chars.next();
            }
            out.push('\n');
            continue;
        }
        if c == '\n' || c == '\t' || !c.is_control() {
            out.push(c);
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_auth_text_strips_ansi_and_control_chars() {
        let raw = "\x1b[31mVerification\x1b[0m\x1b]0;spoof-title\x07\x08 code:\r\nLine2\t\x00OK";
        assert_eq!(sanitize_auth_text(raw), "Verification code:\nLine2\tOK");
    }

    #[tokio::test]
    async fn test_registry_submit_delivers_responses() {
        let reg = AuthInteractionRegistry::new();
        let (guard, rx) = reg.register("srv-1");
        let req_id = guard.request_id().to_string();

        assert!(reg.submit(&req_id, Some(vec!["123456".to_string()])));
        guard.disarm();

        // 重复提交应返回 false
        assert!(!reg.submit(&req_id, Some(vec!["654321".to_string()])));

        let received = rx.await.unwrap();
        assert_eq!(received, Some(vec!["123456".to_string()]));
    }

    #[test]
    fn test_registry_drop_guard_cleans_up_pending() {
        let reg = AuthInteractionRegistry::new();
        let req_id = {
            let (guard, _rx) = reg.register("srv-drop");
            guard.request_id().to_string()
        };
        assert!(!reg.submit(&req_id, Some(vec!["x".to_string()])));
    }

    #[tokio::test]
    async fn test_registry_cancel_for_server_unblocks_waiter() {
        let reg = AuthInteractionRegistry::new();
        let (_g1, rx1) = reg.register("srv-a");
        let (g2, rx2) = reg.register("srv-b");

        reg.cancel_for_server("srv-a");
        assert_eq!(rx1.await.unwrap(), None);

        assert!(reg.submit(g2.request_id(), Some(vec!["ok".to_string()])));
        g2.disarm();
        assert_eq!(rx2.await.unwrap(), Some(vec!["ok".to_string()]));
    }
}
