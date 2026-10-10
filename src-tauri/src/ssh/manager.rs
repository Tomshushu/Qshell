use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, Notify};

use super::connection::{
    test_tcp_connection, AuthMethod, CommandOutput, SshConnection, SshError, SshResult,
};
use super::state::{ConnectionState, ConnectionStateData, SshErrorKind};
use crate::files::remote::is_dangerous_root_path;

/// Global SSH manager singleton
static SSH_MANAGER: std::sync::OnceLock<Arc<SshManager>> = std::sync::OnceLock::new();

/// Global AppHandle for emitting events from SshManager
/// (set once during app setup in lib.rs)
static APP_HANDLE: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// Set the global AppHandle (called once during app setup)
pub fn set_app_handle(handle: AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

/// Emit ssh:disconnected event to the frontend
fn emit_ssh_disconnected(server_id: &str) {
    if let Some(handle) = APP_HANDLE.get() {
        let _ = handle.emit("ssh:disconnected", serde_json::json!({ "serverId": server_id }));
    }
}

/// Emit ssh:state-changed event（前端订阅，用于驱动状态机）
fn emit_state_changed(data: &ConnectionStateData) {
    if let Some(handle) = APP_HANDLE.get() {
        let _ = handle.emit("ssh:state-changed", data);
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// 一个已建立的连接条目：包含 SshConnection、当前状态、心跳取消信号、连接元数据
///
/// 字段丰富化目的（商业版优化）：
/// - `generation`：状态版本号，每次新连接递增；前端据此丢弃过期事件，避免乱序
/// - `connected_at` / `last_active`：UI 可显示"连接时长""最后活跃时间"
/// - `reconnect_count`：历史重连次数（UI 可显示，便于诊断网络稳定性）
/// - `session_ids`：该连接拥有的所有 shell session_id，连接断开时自动清理（避免 zombie shell）
struct ConnectionEntry {
    conn: Arc<SshConnection>,
    state: ConnectionState,
    /// 状态版本号（同一次连接内的所有状态变化共享此值；下次连接 +1）
    generation: u64,
    /// 本次连接成功建立的时间戳（ms since epoch）
    connected_at: u64,
    /// 最后一次 exec / shell 活动时间戳（ms since epoch）
    last_active: u64,
    /// 历史连接次数 - 1（首次连接为 0，之后每次新连接 +1）
    ///
    /// **语义说明**：此值 = `generation - 1`，是 lifetime 级别的计数器，
    /// 包含自动重连和手动断开后重新连接。不区分"本次 session 重连"和"历史总重连"。
    /// 后端无法区分自动/手动重连（重连由前端触发，后端只感知到 connect 调用）。
    /// 若需区分，前端可在 connect 时传 `is_reconnect: bool` 参数。
    reconnect_count: u32,
    /// 心跳任务的取消信号（设置即停止心跳）
    heartbeat_cancel: Arc<std::sync::atomic::AtomicBool>,
    /// 最后一次错误信息（仅在 Failed 状态时有意义）
    last_error: Option<String>,
    last_error_kind: Option<SshErrorKind>,
    /// 该连接拥有的所有 shell session_id
    /// 连接断开时遍历此集合调用 shell_cancel，避免 zombie shell task
    session_ids: std::sync::Mutex<std::collections::HashSet<String>>,
}

/// 正在进行的连接任务（替代旧 30s 时间窗口防并发）
///
/// 设计要点：
/// - 持有 JoinHandle，新的 connect 调用会 await 已有任务而不是拒绝
/// - 通过 Notify 让多个 waiter 共享完成通知
/// - 任务结束时自动从 map 移除（在 manager.connect() 完成后清理）
struct ConnectingTask {
    /// 任务完成通知，所有等待者 listen 此 notify
    notify: Arc<Notify>,
    /// 任务开始时间（用于诊断）
    started_at: u64,
    /// 取消信号（手动 abort 时设置，任务循环感知后退出）
    cancel: Arc<std::sync::atomic::AtomicBool>,
}

/// 原子 check-and-register 的结果：等待已有任务，或已注册新任务
enum WaitAction {
    /// 已有进行中任务，克隆 notify+cancel 在锁外等待
    Wait(Arc<Notify>, Arc<std::sync::atomic::AtomicBool>),
    /// 已成功注册新任务，返回 notify 供 RAII guard 使用
    Proceed(Arc<Notify>),
}

/// RAII guard：确保 connecting 任务在 do_connect* 返回或 panic 时都被清理。
///
/// 防止场景：do_connect_with_auth 内部 panic（如 russh 底层 bug），
/// 若不清理 connecting map，后续所有相同 server_id 的 connect 都会等待
/// 一个永远不会再 notify 的任务，直到 CONNECT_WAIT_TIMEOUT_SECS 超时。
struct ConnectingCleanupGuard<'a> {
    manager: &'a SshManager,
    server_id: String,
    notify: Arc<Notify>,
    /// 是否激活。Drop 时若 active=true，则执行清理。
    /// 正常返回路径可通过 mem::forget 或设置 active=false 来跳过（本实现保留 active，
    /// 让 Drop 总是执行清理 + notify，重复清理/notify 是幂等的）
    active: bool,
}

impl<'a> Drop for ConnectingCleanupGuard<'a> {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        // 同步执行清理（不能在 Drop 中 await，所以用 try_lock + blocking 模式）
        // connecting 是 tokio::sync::Mutex，无法在同步 Drop 中 await。
        // 改用 spawn 一个 task 来异步清理（guard drop 时立即 spawn，不阻塞）
        let manager_ptr = self.manager as *const SshManager;
        let server_id = self.server_id.clone();
        let notify = self.notify.clone();
        // 安全性：manager 是 &'static 生命周期（通过 SshManager::global() 获取的 Arc），
        // 实际调用中 self.manager 来自 &self，与 SshManager 实例同生命周期。
        // 这里用裸指针 + spawn 是为了绕过 Drop 不能 await 的限制。
        // 但裸指针跨 await 不安全，改为不使用指针，直接用全局 SSH_MANAGER。
        let _ = manager_ptr; // 抑制未使用警告
        tokio::spawn(async move {
            if let Some(manager) = SSH_MANAGER.get() {
                manager.connecting.lock().await.remove(&server_id);
            }
            notify.notify_waiters();
        });
    }
}

/// Application heartbeat 间隔（秒）—— 纯 transport 检测，无 channel 开销
///
/// 设计变更（2026-08）：原先分层心跳（transport + 每5分钟 exec true）会创建新 channel，
/// 与分屏 shell 竞争 sshd MaxSessions，导致心跳超时误判连接死亡。
/// 现改为纯 transport 检测 + russh 底层 keepalive（15s 间隔，6 次未响应=90s 判定断开），
/// 完全消除 MaxSessions 竞争，同时保持检测能力。
/// transport 检测能覆盖：TCP 断开、SSH DISCONNECT 消息、keepalive 失败。
const HEARTBEAT_INTERVAL_SECS: u64 = 15;
/// 等待已有连接任务的最大超时（秒）
/// 超时后取消旧任务并自己发起连接，防止旧任务 panic/死锁导致所有后续 connect 卡死
const CONNECT_WAIT_TIMEOUT_SECS: u64 = 30;

/// SSH 连接池管理器
///
/// 设计目标（详见 ssh/state.rs）：
/// 1. 连接状态唯一权威来源（DB 不再存 online/offline）
/// 2. 30s 时间窗口防并发改为 JoinHandle + Notify 等待
/// 3. 应用层心跳（每 60 秒 exec echo），弥补 russh TCP keepalive 的不足
/// 4. 状态机驱动：所有操作前先校验状态
pub struct SshManager {
    /// 已建立连接的池子
    connections: std::sync::Mutex<HashMap<String, ConnectionEntry>>,
    /// 正在连接中的任务（server_id -> task）
    connecting: Mutex<HashMap<String, ConnectingTask>>,
    /// 每个 server_id 的状态版本号（generation），单调递增
    /// 每次 connect（含重连）+1；前端据此丢弃过期事件
    generations: std::sync::Mutex<HashMap<String, u64>>,
    /// 最近一次连接失败的错误信息（server_id -> (error, generation)）
    /// 连接失败时写入，连接成功时清除；等待者据此判断失败而非盲目重试
    last_connect_errors: std::sync::Mutex<HashMap<String, (String, u64)>>,
    /// 进行中的镜像导出/导入的取消信号（server_id -> cancel flag）
    transfer_cancels: std::sync::Mutex<HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>>,
}

impl SshManager {
    fn new() -> Self {
        Self {
            connections: std::sync::Mutex::new(HashMap::new()),
            connecting: Mutex::new(HashMap::new()),
            generations: std::sync::Mutex::new(HashMap::new()),
            last_connect_errors: std::sync::Mutex::new(HashMap::new()),
            transfer_cancels: std::sync::Mutex::new(HashMap::new()),
        }
    }

    /// Lock the connections map, recovering from poison if necessary.
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, ConnectionEntry>> {
        self.connections.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 分配下一个 generation（每次新连接尝试 +1）。
    /// 返回的新 generation 用于本次连接生命周期内所有状态变更事件。
    pub fn next_generation(&self, server_id: &str) -> u64 {
        let mut gens = self.generations.lock().unwrap_or_else(|e| e.into_inner());
        let entry = gens.entry(server_id.to_string()).or_insert(0);
        *entry += 1;
        *entry
    }

    /// 查询当前 server_id 的 generation（未连接过返回 0）
    pub fn get_generation(&self, server_id: &str) -> u64 {
        let gens = self.generations.lock().unwrap_or_else(|e| e.into_inner());
        gens.get(server_id).copied().unwrap_or(0)
    }

    /// 记录连接失败错误（供等待者读取，避免盲目重试）
    pub fn set_last_connect_error(&self, server_id: &str, error: String, generation: u64) {
        let mut errs = self.last_connect_errors.lock().unwrap_or_else(|e| e.into_inner());
        errs.insert(server_id.to_string(), (error, generation));
    }

    /// 清除连接失败错误（连接成功时调用）
    pub fn clear_last_connect_error(&self, server_id: &str) {
        let mut errs = self.last_connect_errors.lock().unwrap_or_else(|e| e.into_inner());
        errs.remove(server_id);
    }

    /// 查询连接失败错误（等待者被 notify 后调用）
    pub fn get_last_connect_error(&self, server_id: &str) -> Option<(String, u64)> {
        let errs = self.last_connect_errors.lock().unwrap_or_else(|e| e.into_inner());
        errs.get(server_id).cloned()
    }

    /// Get the global singleton instance.
    pub fn global() -> &'static Arc<SshManager> {
        SSH_MANAGER.get_or_init(|| Arc::new(SshManager::new()))
    }

    // ========================================================================
    // 连接（含 JoinHandle 防并发）
    // ========================================================================

    /// 检查指定 server_id 是否已有就绪且存活的连接；
    /// 若连接已关闭，自动清理并返回 false，允许发起新连接。
    async fn is_ready_and_alive(&self, server_id: &str) -> bool {
        let candidate = {
            let conns = self.lock();
            conns.get(server_id).and_then(|entry| {
                if entry.state == ConnectionState::Ready {
                    Some((entry.conn.clone(), entry.generation, entry.conn.is_connected()))
                } else {
                    None
                }
            })
        };

        let (conn, generation, handle_connected) = match candidate {
            Some(c) => c,
            None => return false,
        };

        if !handle_connected || !conn.is_connected() {
            eprintln!("[SSH Connect] Connection handle already closed for {}", server_id);
            Self::on_heartbeat_failure(server_id, "connection handle closed", generation).await;
            return false;
        }

        true
    }

    /// 连接服务器：若已有同 server_id 的进行中连接，则等待其结果而不是拒绝。
    ///
    /// 取代旧实现中"30s 时间窗口"防并发方式：避免 panic / 长认证导致的死锁。
    ///
    /// 认证类型 (`auth_type`) 支持：
    /// - `password` / `privateKey`：常规密码 / 私钥文件认证
    /// - `sshAgent` / `ssh_agent` / `agent`：SSH Agent 认证（Pageant/ssh-agent）
    ///   `agent_identity` 可选指定 agent 中的具体身份（OpenSSH 公钥字符串）
    /// - `certificate` / `openssh_cert`：OpenSSH 证书认证
    ///   `private_key_path` 为配对私钥，`certificate_path` 为 *-cert.pub 文件
    pub async fn connect(
        &self,
        server_id: String,
        host: String,
        port: u16,
        username: String,
        auth_type: String,
        password: Option<String>,
        private_key_path: Option<String>,
        private_key_passphrase: Option<String>,
        connection_timeout: u32,
        agent_identity: Option<String>,
        certificate_path: Option<String>,
    ) -> SshResult<()> {
        // 1) 已连接且 Ready → 验证健康度后短路返回 Ok，防止休眠后虚假 Ready
        if self.is_ready_and_alive(&server_id).await {
            return Ok(());
        }

        // 2) 原子地检查并注册连接任务（消除 TOCTOU 竞争）
        // 旧实现先检查 connecting map、释放锁、再重新获取锁插入任务，
        // 两次锁之间的窗口允许另一个 caller 插入任务，导致重复连接。
        // 现在在同一个锁持有期内完成"检查 + 插入"。
        let notify = loop {
            let action = {
                let mut connecting = self.connecting.lock().await;
                if let Some(task) = connecting.get(&server_id) {
                    // 已有进行中任务：克隆 notify+cancel，在锁外等待
                    WaitAction::Wait(task.notify.clone(), task.cancel.clone())
                } else {
                    // 无进行中任务：原子插入新任务
                    let notify = Arc::new(Notify::new());
                    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
                    connecting.insert(server_id.clone(), ConnectingTask {
                        notify: notify.clone(),
                        started_at: now_ms(),
                        cancel: cancel.clone(),
                    });
                    WaitAction::Proceed(notify)
                }
            };
            match action {
                WaitAction::Wait(notify, cancel) => {
                    // 等待已有任务完成，带 30 秒超时
                    // 防止已有任务 panic / 死锁导致所有后续 connect 永远卡死
                    match tokio::time::timeout(
                        Duration::from_secs(CONNECT_WAIT_TIMEOUT_SECS),
                        notify.notified(),
                    ).await {
                        Ok(_) => {
                            // 已有任务完成，再次检查是否 Ready 且健康
                            if self.is_ready_and_alive(&server_id).await {
                                return Ok(());
                            }
                            let conns = self.lock();
                            if let Some(entry) = conns.get(&server_id) {
                                if entry.state == ConnectionState::Failed {
                                    return Err(entry.last_error
                                        .clone()
                                        .map(SshError::ConnectionFailed)
                                        .unwrap_or(SshError::ConnectionFailed("Previous connect failed".into())));
                                }
                            }
                            // 检查连接失败错误（do_connect_with_auth 失败时记录）
                            if let Some((msg, _gen)) = self.get_last_connect_error(&server_id) {
                                return Err(SshError::ConnectionFailed(msg));
                            }
                            // 否则继续循环：尝试注册自己的任务
                            continue;
                        }
                        Err(_) => {
                            // 超时：取消旧任务并自己发起连接
                            eprintln!("[SSH Connect] {} wait timeout after {}s, taking over",
                                server_id, CONNECT_WAIT_TIMEOUT_SECS);
                            cancel.store(true, Ordering::Relaxed);
                            // 移除旧任务
                            self.connecting.lock().await.remove(&server_id);
                            // 继续循环：注册自己的任务
                            continue;
                        }
                    }
                }
                WaitAction::Proceed(notify) => {
                    // 已注册任务，跳出循环执行 do_connect
                    break notify;
                }
            }
        };

        // RAII guard：无论 do_connect 正常返回、Err 还是 panic，都确保清理 connecting 任务
        // 并通知所有等待者。防止 panic 时 connecting map 残留导致后续 connect 卡死。
        let manager_ref = self;
        let server_id_for_guard = server_id.clone();
        let notify_for_guard = notify.clone();
        let _cleanup_guard = ConnectingCleanupGuard {
            manager: manager_ref,
            server_id: server_id_for_guard,
            notify: notify_for_guard,
            active: true,
        };

        self.do_connect(
            &server_id, host, port, username, auth_type,
            password, private_key_path, private_key_passphrase, connection_timeout,
            agent_identity, certificate_path,
        ).await
    }

    /// 实际执行 TCP+SSH+认证，并初始化心跳任务
    async fn do_connect(
        &self,
        server_id: &str,
        host: String,
        port: u16,
        username: String,
        auth_type: String,
        password: Option<String>,
        private_key_path: Option<String>,
        private_key_passphrase: Option<String>,
        connection_timeout: u32,
        agent_identity: Option<String>,
        certificate_path: Option<String>,
    ) -> SshResult<()> {
        let _start = std::time::Instant::now();
        tracing::info!("[SSH Perf] {} do_connect 开始", server_id);

        let auth = match auth_type.as_str() {
            "privateKey" | "private_key" => {
                let path = private_key_path
                    .ok_or_else(|| SshError::AuthFailed("Missing private key path".into()))?;
                AuthMethod::PrivateKey {
                    private_key_path: path,
                    private_key_passphrase,
                }
            }
            "sshAgent" | "ssh_agent" | "agent" => {
                // 解析可选的指定身份（OpenSSH 公钥字符串 "ssh-ed25519 AAAA..."）
                let identity = match agent_identity.as_deref() {
                    Some(s) if !s.trim().is_empty() => {
                        let trimmed = s.trim();
                        // 尝试解析为 OpenSSH 公钥
                        match russh::keys::parse_public_key_base64(
                            trimmed.split_whitespace().nth(1).unwrap_or(trimmed),
                        ) {
                            Ok(pk) => Some(pk),
                            Err(_) => {
                                // 兜底：交给 load_public_key，按完整路径/字符串处理
                                russh::keys::load_public_key(trimmed).ok()
                            }
                        }
                    }
                    _ => None,
                };
                AuthMethod::SshAgent { identity }
            }
            "certificate" | "openssh_cert" | "cert" => {
                let key_path = private_key_path
                    .ok_or_else(|| SshError::AuthFailed("Missing private key path for certificate auth".into()))?;
                let cert_path = certificate_path
                    .ok_or_else(|| SshError::AuthFailed("Missing certificate path".into()))?;
                AuthMethod::Certificate {
                    private_key_path: key_path,
                    certificate_path: cert_path,
                    private_key_passphrase,
                }
            }
            _ => {
                let pass = password
                    .ok_or_else(|| SshError::AuthFailed("Missing password".into()))?;
                AuthMethod::Password { password: pass }
            }
        };

        self.do_connect_with_auth(
            server_id, host, port, username, auth, connection_timeout, None, None,
        ).await
    }

    /// content-based 连接入口（阶段 3）：直接传入构造好的 AuthMethod，
    /// 跳过 auth_type 字符串匹配。用于 ssh_key_id 模式——commands 层已通过
    /// `ssh_keys_get_raw` 解密出私钥/证书内容，构造 PrivateKeyContent / CertificateContent。
    ///
    /// 并发控制与 `connect` 一致：等待已有任务、注册新任务、防并发。
    pub async fn connect_with_auth(
        &self,
        server_id: String,
        host: String,
        port: u16,
        username: String,
        auth: AuthMethod,
        connection_timeout: u32,
    ) -> SshResult<()> {
        // 1) 已连接且 Ready → 验证健康度后短路返回 Ok，防止休眠后虚假 Ready
        if self.is_ready_and_alive(&server_id).await {
            return Ok(());
        }

        // 2) 原子地检查并注册连接任务（消除 TOCTOU 竞争，与 connect 一致）
        let notify = loop {
            let action = {
                let mut connecting = self.connecting.lock().await;
                if let Some(task) = connecting.get(&server_id) {
                    WaitAction::Wait(task.notify.clone(), task.cancel.clone())
                } else {
                    let notify = Arc::new(Notify::new());
                    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
                    connecting.insert(server_id.clone(), ConnectingTask {
                        notify: notify.clone(),
                        started_at: now_ms(),
                        cancel: cancel.clone(),
                    });
                    WaitAction::Proceed(notify)
                }
            };
            match action {
                WaitAction::Wait(notify, cancel) => {
                    match tokio::time::timeout(
                        Duration::from_secs(CONNECT_WAIT_TIMEOUT_SECS),
                        notify.notified(),
                    ).await {
                        Ok(_) => {
                            // 已有任务完成，再次检查是否 Ready 且健康
                            if self.is_ready_and_alive(&server_id).await {
                                return Ok(());
                            }
                            let conns = self.lock();
                            if let Some(entry) = conns.get(&server_id) {
                                if entry.state == ConnectionState::Failed {
                                    return Err(entry.last_error
                                        .clone()
                                        .map(SshError::ConnectionFailed)
                                        .unwrap_or(SshError::ConnectionFailed("Previous connect failed".into())));
                                }
                            }
                            // 检查连接失败错误（do_connect_with_auth 失败时记录）
                            if let Some((msg, _gen)) = self.get_last_connect_error(&server_id) {
                                return Err(SshError::ConnectionFailed(msg));
                            }
                            continue;
                        }
                        Err(_) => {
                            eprintln!("[SSH Connect] {} wait timeout after {}s, taking over",
                                server_id, CONNECT_WAIT_TIMEOUT_SECS);
                            cancel.store(true, Ordering::Relaxed);
                            self.connecting.lock().await.remove(&server_id);
                            continue;
                        }
                    }
                }
                WaitAction::Proceed(notify) => {
                    break notify;
                }
            }
        };

        // RAII guard：无论 do_connect_with_auth 正常返回、Err 还是 panic，都确保清理
        // connecting 任务并通知所有等待者。防止 panic 时 connecting map 残留导致后续 connect 卡死。
        let server_id_for_guard = server_id.clone();
        let notify_for_guard = notify.clone();
        let _cleanup_guard = ConnectingCleanupGuard {
            manager: self,
            server_id: server_id_for_guard,
            notify: notify_for_guard,
            active: true,
        };

        self.do_connect_with_auth(
            &server_id, host, port, username, auth, connection_timeout, None, None,
        ).await
    }

    /// 通过跳板机连接（ProxyJump）：接受已构造好的 AuthMethod + 跳板机配置（向下兼容）
    pub async fn connect_with_jump(
        &self,
        server_id: String,
        host: String,
        port: u16,
        username: String,
        auth: AuthMethod,
        connection_timeout: u32,
        jump: super::connection::JumpConfig<'_>,
    ) -> SshResult<()> {
        let hop = super::connection::ResolvedJumpHop {
            host: jump.host.to_string(),
            port: jump.port,
            username: jump.username.to_string(),
            auth: jump.auth.clone(),
            timeout_secs: jump.timeout_secs,
        };
        self.connect_with_jump_chain(server_id, host, port, username, auth, connection_timeout, vec![hop]).await
    }

    /// 通过多级链式跳板机连接（Chained ProxyJump）：接受已构造好的 AuthMethod + 多级跳板列表
    pub async fn connect_with_jump_chain(
        &self,
        server_id: String,
        host: String,
        port: u16,
        username: String,
        auth: AuthMethod,
        connection_timeout: u32,
        hops: Vec<super::connection::ResolvedJumpHop>,
    ) -> SshResult<()> {
        self.connect_routed(server_id, host, port, username, auth, connection_timeout, Some(hops), None).await
    }

    /// 通过 SOCKS5 / HTTP 代理连接：接受已构造好的 AuthMethod + 代理传输配置
    pub async fn connect_with_proxy(
        &self,
        server_id: String,
        host: String,
        port: u16,
        username: String,
        auth: AuthMethod,
        connection_timeout: u32,
        proxy: super::connection::ProxyTransportConfig,
    ) -> SshResult<()> {
        self.connect_routed(server_id, host, port, username, auth, connection_timeout, None, Some(proxy)).await
    }

    /// 统一路由入口（直连 / 链式跳板机 / SOCKS5·HTTP 代理共用）：防并发等待机制
    async fn connect_routed(
        &self,
        server_id: String,
        host: String,
        port: u16,
        username: String,
        auth: AuthMethod,
        connection_timeout: u32,
        jump_chain: Option<Vec<super::connection::ResolvedJumpHop>>,
        proxy: Option<super::connection::ProxyTransportConfig>,
    ) -> SshResult<()> {
        // 1) 已连接且 Ready → 验证健康度后短路返回 Ok，防止休眠后虚假 Ready
        if self.is_ready_and_alive(&server_id).await {
            return Ok(());
        }

        // 2) 原子地检查并注册连接任务
        let notify = loop {
            let action = {
                let mut connecting = self.connecting.lock().await;
                if let Some(task) = connecting.get(&server_id) {
                    WaitAction::Wait(task.notify.clone(), task.cancel.clone())
                } else {
                    let notify = Arc::new(Notify::new());
                    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
                    connecting.insert(server_id.clone(), ConnectingTask {
                        notify: notify.clone(),
                        started_at: now_ms(),
                        cancel: cancel.clone(),
                    });
                    WaitAction::Proceed(notify)
                }
            };
            match action {
                WaitAction::Wait(notify, cancel) => {
                    match tokio::time::timeout(
                        Duration::from_secs(CONNECT_WAIT_TIMEOUT_SECS),
                        notify.notified(),
                    ).await {
                        Ok(_) => {
                            // 已有任务完成，再次检查是否 Ready 且健康
                            if self.is_ready_and_alive(&server_id).await {
                                return Ok(());
                            }
                            let conns = self.lock();
                            if let Some(entry) = conns.get(&server_id) {
                                if entry.state == ConnectionState::Failed {
                                    return Err(entry.last_error
                                        .clone()
                                        .map(SshError::ConnectionFailed)
                                        .unwrap_or(SshError::ConnectionFailed("Previous connect failed".into())));
                                }
                            }
                            if let Some((msg, _gen)) = self.get_last_connect_error(&server_id) {
                                return Err(SshError::ConnectionFailed(msg));
                            }
                            continue;
                        }
                        Err(_) => {
                            eprintln!("[SSH Connect] {} wait timeout after {}s, taking over",
                                server_id, CONNECT_WAIT_TIMEOUT_SECS);
                            cancel.store(true, Ordering::Relaxed);
                            self.connecting.lock().await.remove(&server_id);
                            continue;
                        }
                    }
                }
                WaitAction::Proceed(notify) => {
                    break notify;
                }
            }
        };

        // RAII guard
        let server_id_for_guard = server_id.clone();
        let notify_for_guard = notify.clone();
        let _cleanup_guard = ConnectingCleanupGuard {
            manager: self,
            server_id: server_id_for_guard,
            notify: notify_for_guard,
            active: true,
        };

        self.do_connect_with_auth(
            &server_id, host, port, username, auth, connection_timeout, jump_chain, proxy,
        ).await
    }

    /// do_connect 的核心实现：接受已构造好的 AuthMethod，负责心跳、状态、entry 管理。
    /// `do_connect`（路径模式）和 `connect_with_auth`（content 模式）共用此方法。
    /// `jump_chain`：Some 时通过多级跳板机连接（Chained ProxyJump），None 时直连
    /// `proxy`：Some 时通过 SOCKS5/HTTP 代理连接（与 jump_chain 互斥）
    async fn do_connect_with_auth(
        &self,
        server_id: &str,
        host: String,
        port: u16,
        username: String,
        auth: AuthMethod,
        connection_timeout: u32,
        jump_chain: Option<Vec<super::connection::ResolvedJumpHop>>,
        proxy: Option<super::connection::ProxyTransportConfig>,
    ) -> SshResult<()> {
        let start = std::time::Instant::now();
        tracing::info!("[SSH Perf] {} do_connect_with_auth 开始", server_id);

        // 心跳取消信号：连接建立后由 manager 持有，断开时设置以停止心跳任务
        let heartbeat_cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));

        // 分配新 generation：本次连接生命周期内所有状态变更事件共享此值
        let generation = self.next_generation(server_id);
        // reconnect_count = generation - 1（首次连接时 generation=1, reconnect_count=0）
        let reconnect_count = generation.saturating_sub(1) as u32;

        // 发射 Connecting 状态事件（连接尚未真正建立，不插入 entry）
        {
            let data = ConnectionStateData {
                server_id: server_id.to_string(),
                state: ConnectionState::Connecting,
                error: None,
                error_kind: None,
                generation,
            };
            emit_state_changed(&data);
        }
        tracing::info!("[SSH Perf] {} Connecting 事件已发射: {:?}",
            server_id, start.elapsed());

        // 真正建立连接：失败时记录错误（供等待者读取），发射 Failed 事件
        let conn_start = start.elapsed();
        let connect_result = match (jump_chain, proxy) {
            (Some(chain), _) => SshConnection::connect_via_jump_chain(
                server_id.to_string(), host.clone(), port, &username, &auth, connection_timeout, chain,
            ).await,
            (None, Some(p)) => SshConnection::connect_via_proxy(
                server_id.to_string(), host.clone(), port, &username, &auth, connection_timeout, p,
            ).await,
            (None, None) => SshConnection::connect(
                server_id.to_string(), host.clone(), port, &username, &auth, connection_timeout,
            ).await,
        };
        let connection = match connect_result {
            Ok(c) => c,
            Err(e) => {
                let kind = SshErrorKind::from(&e);
                // 记录失败错误 + generation，让等待者能检测失败而非盲目重试
                self.set_last_connect_error(server_id, e.to_string(), generation);
                let data = ConnectionStateData {
                    server_id: server_id.to_string(),
                    state: ConnectionState::Failed,
                    error: Some(e.to_string()),
                    error_kind: Some(kind),
                    generation,
                };
                emit_state_changed(&data);
                tracing::info!("[SSH Perf] {} 连接失败: {:?} - {}",
                    server_id, start.elapsed(), e);
                return Err(e);
            }
        };
        tracing::info!("[SSH Perf] {} SshConnection::connect 完成: {:?} (本阶段 {:?})",
            server_id, start.elapsed(), start.elapsed() - conn_start);

        let conn_arc = Arc::new(connection);
        // 启动心跳任务，使用 entry 内的 cancel flag
        let heartbeat_cancel_local = heartbeat_cancel.clone();
        let conn_for_hb = conn_arc.clone();
        let sid_for_hb = server_id.to_string();
        tokio::spawn(async move {
            Self::heartbeat_loop(conn_for_hb, sid_for_hb, heartbeat_cancel_local, generation).await;
        });
        tracing::info!("[SSH Perf] {} 心跳任务已启动: {:?}", server_id, start.elapsed());

        let now = now_ms();
        // 插入 Ready 状态的 entry
        {
            let mut conns = self.lock();
            // 清除之前的连接失败错误（本次连接成功）
            self.clear_last_connect_error(server_id);
            conns.insert(server_id.to_string(), ConnectionEntry {
                conn: conn_arc,
                state: ConnectionState::Ready,
                generation,
                connected_at: now,
                last_active: now,
                reconnect_count,
                heartbeat_cancel,
                last_error: None,
                last_error_kind: None,
                session_ids: std::sync::Mutex::new(std::collections::HashSet::new()),
            });
        }
        // 发射 Ready 状态事件
        let data = ConnectionStateData {
            server_id: server_id.to_string(),
            state: ConnectionState::Ready,
            error: None,
            error_kind: None,
            generation,
        };
        emit_state_changed(&data);
        tracing::info!("[SSH Perf] {} Ready 事件已发射: do_connect 总耗时 {:?}",
            server_id, start.elapsed());

        Ok(())
    }

    /// Application heartbeat：纯 transport 检测，无 channel 开销
    ///
    /// 保活机制（两层）：
    ///
    /// 1. **15 秒 russh KeepAlive** — russh client config 配置，自动发送 SSH keepalive 消息
    /// 2. **15 秒 Transport 检测** — 调用 `is_connected()`，检查 `handle.is_closed()`
    ///
    /// 设计变更（2026-08）：原先还有第 3 层"每5分钟 exec true"用于检测应用层假死，
    /// 但 exec 会创建新 channel，与分屏 shell 竞争 sshd MaxSessions，导致心跳超时
    /// 误判连接死亡。现已移除 exec 层，完全依赖 transport 检测 + russh keepalive。
    ///
    /// transport 检测能覆盖：TCP 断开、SSH DISCONNECT 消息、keepalive 失败（90s 判定）。
    /// 对于"TCP 存活但 SSH 层卡死"的假死场景，russh keepalive 会在 90 秒内判定断开。
    async fn heartbeat_loop(
        conn: Arc<SshConnection>,
        server_id: String,
        cancel: Arc<std::sync::atomic::AtomicBool>,
        generation: u64,
    ) {
        loop {
            // 等待下一心跳周期（每秒检查一次取消信号）
            for _ in 0..HEARTBEAT_INTERVAL_SECS {
                if cancel.load(Ordering::Relaxed) {
                    return;
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            if cancel.load(Ordering::Relaxed) {
                return;
            }

            // Transport 检测：检查 SSH transport 是否已关闭
            // is_connected() 调用 handle.is_closed()，russh 在以下情况返回 true：
            // - 收到 SSH DISCONNECT 消息
            // - TCP 连接断开
            // - keepalive 连续 6 次（90 秒）未收到响应
            if !conn.is_connected() {
                Self::on_heartbeat_failure(&server_id, "transport closed", generation).await;
                return;
            }
        }
    }

    /// 心跳失败：清理连接池，发射 disconnected 事件
    ///
    /// **CAS 保护**：只移除 generation 匹配的 entry，避免旧心跳任务误删新连接。
    /// 场景：generation=5 的心跳发现断线 → 用户重连 generation=6 → 旧心跳执行 remove
    ///       若不比较 generation，会把 generation=6 的新连接误删。
    pub(crate) async fn on_heartbeat_failure(server_id: &str, reason: &str, generation: u64) {
        eprintln!("[SSH Heartbeat] {} declared dead (gen={}): {}", server_id, generation, reason);
        let entry = {
            let mut conns = Self::global().lock();
            // CAS: 只在 entry.generation == generation 时移除
            // 若 generation 不匹配（说明已有更新的连接），不移除，避免误删
            let matches = conns.get(server_id)
                .map(|e| e.generation == generation)
                .unwrap_or(false);
            if matches {
                conns.remove(server_id)
            } else {
                None
            }
        };
        if let Some(entry) = entry {
            entry.heartbeat_cancel.store(true, Ordering::Relaxed);
            // 清理该连接拥有的所有 shell session（避免 zombie shell）
            // 直接从已移除的 entry 中取出 session_ids，避免重新查表拿不到 entry
            Self::close_sessions_from_entry(&entry).await;
            // 异步发送 SSH disconnect（不等待）
            let conn = entry.conn.clone();
            tokio::spawn(async move {
                conn.disconnect().await;
            });
        } else {
            // entry 不匹配（已被新连接替代或已移除），不发射事件
            eprintln!("[SSH Heartbeat] {} entry generation mismatch, skip cleanup", server_id);
            return;
        }
        // 发射状态变更事件
        let data = ConnectionStateData {
            server_id: server_id.to_string(),
            state: ConnectionState::Disconnected,
            error: Some(reason.to_string()),
            error_kind: Some(SshErrorKind::ConnectionReset),
            generation,
        };
        emit_state_changed(&data);
        // 兼容旧前端事件
        emit_ssh_disconnected(server_id);
    }

    /// 断开服务器连接
    pub async fn disconnect(&self, server_id: &str) -> SshResult<()> {
        let entries = {
            let mut conns = self.lock();
            let mut removed = Vec::new();
            if let Some(entry) = conns.remove(server_id) {
                removed.push((server_id.to_string(), entry));
            }
            // 若 server_id 是基础服务器 ID（非 ws: / sftp:），联动关闭属于该服务器的所有工作台和 SFTP 连接
            if !server_id.starts_with("ws:") && !server_id.starts_with("sftp:") {
                let ws_prefix = format!("ws:{}:", server_id);
                let sftp_key = format!("sftp:{}", server_id);
                let child_keys: Vec<String> = conns.keys()
                    .filter(|k| k.starts_with(&ws_prefix) || *k == &sftp_key)
                    .cloned()
                    .collect();
                for k in child_keys {
                    if let Some(entry) = conns.remove(&k) {
                        removed.push((k, entry));
                    }
                }
            }
            removed
        };
        if !entries.is_empty() {
            for (id, entry) in entries {
                let generation = entry.generation;
                // 停止心跳
                entry.heartbeat_cancel.store(true, Ordering::Relaxed);
                // 清理该连接拥有的所有 shell session（避免 zombie shell）
                Self::close_sessions_from_entry(&entry).await;
                // 发射 Disconnecting 状态
                let data = ConnectionStateData {
                    server_id: id.clone(),
                    state: ConnectionState::Disconnecting,
                    error: None,
                    error_kind: None,
                    generation,
                };
                emit_state_changed(&data);
                // 发送 SSH disconnect 消息（带 5 秒超时保护，防止远端无响应时永久挂起）
                let _ = tokio::time::timeout(
                    Duration::from_secs(5),
                    entry.conn.disconnect(),
                ).await;
                // 发射 Disconnected 状态
                let data = ConnectionStateData {
                    server_id: id,
                    state: ConnectionState::Disconnected,
                    error: None,
                    error_kind: None,
                    generation,
                };
                emit_state_changed(&data);
            }
        } else {
            // entry 不存在（例如 Telnet 协议，或已处于断开状态）：
            // 仍发射 Disconnected 状态，确保前端工作台及状态机与实际连接状态保持一致
            let gen = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let data = ConnectionStateData {
                server_id: server_id.to_string(),
                state: ConnectionState::Disconnected,
                error: None,
                error_kind: None,
                generation: gen,
            };
            emit_state_changed(&data);
        }
        Ok(())
    }

    /// Disconnect all (async — sends SSH disconnect messages).
    pub async fn disconnect_all(&self) {
        let entries: Vec<(String, ConnectionEntry)> = {
            let mut guard = self.lock();
            guard.drain().collect()
        };
        for (id, entry) in entries {
            let generation = entry.generation;
            entry.heartbeat_cancel.store(true, Ordering::Relaxed);
            // 清理该连接拥有的所有 shell session（直接从 entry 取，避免重新查表）
            Self::close_sessions_from_entry(&entry).await;
            // 带 3 秒超时（应用退出场景，不宜等待太久）
            let _ = tokio::time::timeout(
                Duration::from_secs(3),
                entry.conn.disconnect(),
            ).await;
            let data = ConnectionStateData {
                server_id: id.clone(),
                state: ConnectionState::Disconnected,
                error: None,
                error_kind: None,
                generation,
            };
            emit_state_changed(&data);
        }
    }

    /// 取消正在进行的连接任务（用于用户手动取消 UI 上的"连接中"状态）
    pub async fn cancel_connecting(&self, server_id: &str) {
        let connecting = self.connecting.lock().await;
        if let Some(task) = connecting.get(server_id) {
            task.cancel.store(true, Ordering::Relaxed);
            task.notify.notify_one();
        }
        if !server_id.starts_with("ws:") && !server_id.starts_with("sftp:") {
            let ws_prefix = format!("ws:{}:", server_id);
            let sftp_key = format!("sftp:{}", server_id);
            for (k, task) in connecting.iter() {
                if k.starts_with(&ws_prefix) || k == &sftp_key {
                    task.cancel.store(true, Ordering::Relaxed);
                    task.notify.notify_one();
                }
            }
        }
    }

    /// 查询当前状态（同步）
    pub fn get_state_sync(&self, server_id: &str) -> ConnectionState {
        let conns = self.lock();
        Self::resolve_entry(&conns, server_id)
            .map(|e| e.state)
            .unwrap_or(ConnectionState::Disconnected)
    }

    /// 查询当前 generation（同步）。即使 entry 已被移除，也能从 generations map 读出最新值
    pub fn get_generation_sync(&self, server_id: &str) -> u64 {
        // 优先从 entry 读取（避免 entry 存在但 generations 已被其他线程更新）
        let from_entry = self.lock().get(server_id).map(|e| e.generation);
        from_entry.unwrap_or_else(|| self.get_generation(server_id))
    }

    /// 查询当前状态（async 版本，供 commands 调用）
    pub async fn get_state(&self, server_id: &str) -> ConnectionState {
        self.get_state_sync(server_id)
    }

    /// 查询最后一次错误信息
    pub fn get_last_error(&self, server_id: &str) -> Option<(String, SshErrorKind)> {
        let conns = self.lock();
        Self::resolve_entry(&conns, server_id).and_then(|e| {
            match (e.last_error.clone(), e.last_error_kind) {
                (Some(msg), Some(kind)) => Some((msg, kind)),
                _ => None,
            }
        })
    }

    // ============================================================
    // Shell 会话归属管理（问题6：连接断开自动清理 shell）
    // ============================================================

    /// 注册 shell session 到指定连接（shell_create 后调用）
    pub fn register_shell_session(&self, server_id: &str, session_id: &str) {
        let conns = self.lock();
        if let Some(entry) = Self::resolve_entry(&conns, server_id) {
            if let Ok(mut ids) = entry.session_ids.lock() {
                ids.insert(session_id.to_string());
            }
        }
    }

    /// 注销 shell session（shell_close 后调用）
    pub fn unregister_shell_session(&self, server_id: &str, session_id: &str) {
        let conns = self.lock();
        if let Some(entry) = Self::resolve_entry(&conns, server_id) {
            if let Ok(mut ids) = entry.session_ids.lock() {
                ids.remove(session_id);
            }
        }
    }

    /// 更新 last_active 时间戳（shell IO 时调用，节流：最快 10 秒一次）
    ///
    /// 避免用户在终端工作 2 小时后 UI 仍显示"最后活跃 2 小时前"。
    /// 节流是为了避免每次 shell output 都 lock connections map。
    pub fn touch_last_active(&self, server_id: &str) {
        let now = now_ms();
        let need_update = {
            let conns = self.lock();
            match conns.get(server_id) {
                Some(entry) => {
                    // 节流：距离上次更新 < 10 秒则跳过
                    now.saturating_sub(entry.last_active) > 10_000
                }
                None => false,
            }
        };
        if need_update {
            let mut conns = self.lock();
            if let Some(entry) = conns.get_mut(server_id) {
                entry.last_active = now;
            }
        }
    }

    /// 清理指定连接的所有 shell session（连接断开时调用）
    /// 从 entry 收集 session_id，然后异步调用 shell_cancel 清理
    pub async fn close_sessions_for_server(server_id: &str) {
        let session_ids: Vec<String> = {
            let conns = Self::global().lock();
            conns.get(server_id).map(|e| {
                e.session_ids.lock()
                    .map(|ids| ids.iter().cloned().collect())
                    .unwrap_or_default()
            }).unwrap_or_default()
        };
        for sid in session_ids {
            super::shell::shell_cancel(&sid).await;
        }
    }

    /// 从已移除的 entry 中直接取出 session_ids 并清理（避免 close_sessions_for_server 重新查表拿不到 entry）
    /// 所有已 remove(entry) 的调用方应使用本函数，而非 close_sessions_for_server
    async fn close_sessions_from_entry(entry: &ConnectionEntry) {
        let session_ids: Vec<String> = entry.session_ids.lock()
            .map(|ids| ids.iter().cloned().collect())
            .unwrap_or_default();
        for sid in session_ids {
            super::shell::shell_cancel(&sid).await;
        }
    }

    /// 检查连接活性并在掉线时立即通知前端与清理连接池
    /// 适用于 SFTP / Shell / PortForward 等子系统操作失败时的快速故障通报（无需死等心跳周期）
    pub(crate) async fn handle_connection_loss(
        server_id: &str,
        connection: &Arc<SshConnection>,
        error_msg: &str,
    ) {
        if !connection.is_connected() {
            let entry = {
                let mut conns = Self::global().lock();
                let actual_key = if conns.get(server_id).map(|e| Arc::ptr_eq(&e.conn, connection)).unwrap_or(false) {
                    Some(server_id.to_string())
                } else {
                    let base_id = crate::commands::extract_base_server_id(server_id);
                    if base_id != server_id && conns.get(base_id).map(|e| Arc::ptr_eq(&e.conn, connection)).unwrap_or(false) {
                        Some(base_id.to_string())
                    } else {
                        None
                    }
                };
                actual_key.and_then(|k| conns.remove(&k))
            };
            if let Some(entry) = entry {
                entry.heartbeat_cancel.store(true, Ordering::Relaxed);
                Self::close_sessions_from_entry(&entry).await;
                let data = ConnectionStateData {
                    server_id: server_id.to_string(),
                    state: ConnectionState::Disconnected,
                    error: Some(error_msg.to_string()),
                    error_kind: Some(SshErrorKind::ConnectionReset),
                    generation: entry.generation,
                };
                emit_state_changed(&data);
                emit_ssh_disconnected(server_id);
            }
        }
    }

    /// 智能连接查找：
    /// 1. 优先精确匹配 server_id
    /// 2. 若查找 `sftp:xxx` 或 `ws:xxx:yyy` 未命中，自动 fallback 到主连接 `xxx`
    /// 3. 若查找主连接 `xxx` 未命中，自动查找当前属于该服务器的任一活跃工作台连接 `ws:xxx:*`
    #[inline]
    fn resolve_entry<'a>(conns: &'a HashMap<String, ConnectionEntry>, server_id: &str) -> Option<&'a ConnectionEntry> {
        conns.get(server_id).or_else(|| {
            let base_id = crate::commands::extract_base_server_id(server_id);
            if base_id != server_id {
                conns.get(base_id)
            } else {
                conns.iter().find_map(|(k, v)| {
                    if let Some(rest) = k.strip_prefix("ws:") {
                        if rest.split(':').next() == Some(server_id) && v.state == ConnectionState::Ready && v.conn.is_connected() {
                            return Some(v);
                        }
                    }
                    None
                })
            }
        })
    }

    /// Check if connected (SYNC — called without await from ipc.js).
    pub fn is_connected_sync(&self, server_id: &str) -> bool {
        let conns = self.lock();
        Self::resolve_entry(&conns, server_id)
            .map(|e| e.state == ConnectionState::Ready && e.conn.is_connected())
            .unwrap_or(false)
    }

    /// Get connected server IDs (SYNC — called without await from ipc.js).
    pub fn get_connected_server_ids_sync(&self) -> Vec<String> {
        let conns = self.lock();
        conns.iter()
            .filter(|(_, e)| e.state == ConnectionState::Ready && e.conn.is_connected())
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// 主动探测当前所有连接的健康状态（用于休眠唤醒、网络恢复时秒级主动探活）
    /// 返回检测到已断开的 server_id 列表
    pub async fn probe_connections(&self) -> Vec<String> {
        let targets: Vec<(String, Arc<SshConnection>, u64)> = {
            let conns = self.lock();
            conns.iter()
                .filter(|(_, e)| e.state == ConnectionState::Ready)
                .map(|(id, e)| (id.clone(), e.conn.clone(), e.generation))
                .collect()
        };

        if targets.is_empty() {
            return Vec::new();
        }

        let mut dead_servers = Vec::new();
        for (server_id, conn, generation) in targets {
            if !conn.is_connected() {
                eprintln!("[SSH Probe] Detected dead connection for {} upon probe: connection handle closed", server_id);
                Self::on_heartbeat_failure(&server_id, "connection handle closed", generation).await;
                dead_servers.push(server_id);
            }
        }
        dead_servers
    }

    /// Execute a command on a connected server (async).
    pub async fn execute(
        &self, server_id: &str, command: &str, timeout_secs: u64,
    ) -> SshResult<CommandOutput> {
        // 危险命令拦截（defense-in-depth）：所有命令无论来自用户输入还是内部文件操作，
        // 都经过 validate_command 检查，拦截 rm -rf /、mkfs、dd of=/dev/、fork bomb、chmod -R / 等。
        // 文件操作命令因路径已 escape_shell_arg 单引号包裹（'/' 而非 /），
        // 不会触发这些基于"裸 / 结尾"的正则，故无误伤。
        let cmd_validation = crate::validators::validate_command(command.to_string());
        if !cmd_validation.valid {
            let err = cmd_validation.error.unwrap_or_default();
            eprintln!(
                "[SSH AUDIT] Blocked command on {}: {} — {}",
                server_id, command, err
            );
            return Err(SshError::ConnectionFailed(format!("Command rejected: {}", err)));
        }
        // 双判断：state == Ready && handle is_connected()
        // 场景：心跳发现断线但还没来得及 remove entry，此时 state 仍是 Ready
        //       但 handle 已 dead，直接 exec 会失败
        let (connection, generation) = {
            let conns = self.lock();
            let entry = Self::resolve_entry(&conns, server_id)
                .ok_or_else(|| SshError::NotConnected(server_id.to_string()))?;
            if entry.state != ConnectionState::Ready {
                return Err(SshError::NotConnected(format!(
                    "Server {} state is {:?}, not Ready", server_id, entry.state
                )));
            }
            if !entry.conn.is_connected() {
                return Err(SshError::NotConnected(format!(
                    "Server {} handle is dead (state=Ready but transport closed)", server_id
                )));
            }
            (entry.conn.clone(), entry.generation)
        };

        let result = connection.execute(command, timeout_secs).await;
        // 瞬态重试：连接刚建立时（Ready 事件刚发射），首次打开 channel 可能被服务端
        // 以 ConnectFailed 拒绝（认证完成与服务器端会话资源就绪之间存在短暂窗口），
        // 或与首连时同时创建的 shell channel 竞争。transport 仍存活时等待片刻重试一次，
        // 消除"首次连接后第一个 docker/监控请求报 Channel open failure"的瞬态错误。
        // 仅对 ChannelOpenFailed 重试：该错误发生在命令开始执行前，重试无重复执行风险；
        // transport 已死则不重试（走下方清理路径）。
        let result = match &result {
            Err(SshError::ChannelOpenFailed(_)) if connection.is_connected() => {
                tokio::time::sleep(Duration::from_millis(400)).await;
                connection.execute(command, timeout_secs).await
            }
            _ => result,
        };
        if result.is_ok() {
            // 成功：更新 last_active 时间戳
            let mut conns = self.lock();
            if let Some(entry) = conns.get_mut(server_id) {
                entry.last_active = now_ms();
            }
        } else {
            // 失败时检查连接是否仍然存活，不存活则清理并通知前端
            if !connection.is_connected() {
                let entry = {
                    let mut conns = self.lock();
                    // 仅当 entry 仍然指向同一个 Arc 时才移除
                    if conns.get(server_id).map(|e| Arc::ptr_eq(&e.conn, &connection)).unwrap_or(false) {
                        conns.remove(server_id)
                    } else {
                        None
                    }
                };
                if let Some(entry) = entry {
                    entry.heartbeat_cancel.store(true, Ordering::Relaxed);
                    // 用 if let 替代 unwrap，避免 panic 风险
                    if let Err(err) = result.as_ref() {
                        let kind = SshErrorKind::from(err);
                        // 清理该连接拥有的所有 shell session（直接从 entry 取，避免重新查表）
                        Self::close_sessions_from_entry(&entry).await;
                        let data = ConnectionStateData {
                            server_id: server_id.to_string(),
                            state: ConnectionState::Disconnected,
                            error: Some(err.to_string()),
                            error_kind: Some(kind),
                            generation,
                        };
                        emit_state_changed(&data);
                        emit_ssh_disconnected(server_id);
                    }
                }
            }
        }
        result
    }

    /// 流式执行命令（与 execute 相同的安全检查），输出逐段回调。
    /// 供 Compose 部署输出面板使用：up/down/pull 过程实时可见（Dockge 式体验）。
    pub async fn execute_streaming(
        &self,
        server_id: &str,
        command: &str,
        timeout_secs: u64,
        on_chunk: impl FnMut(&str),
    ) -> SshResult<CommandOutput> {
        let cmd_validation = crate::validators::validate_command(command.to_string());
        if !cmd_validation.valid {
            let err = cmd_validation.error.unwrap_or_default();
            eprintln!(
                "[SSH AUDIT] Blocked command on {}: {} — {}",
                server_id, command, err
            );
            return Err(SshError::ConnectionFailed(format!("Command rejected: {}", err)));
        }
        // 双判断：state == Ready && handle is_connected()
        let connection = {
            let conns = self.lock();
            let entry = Self::resolve_entry(&conns, server_id)
                .ok_or_else(|| SshError::NotConnected(server_id.to_string()))?;
            if entry.state != ConnectionState::Ready {
                return Err(SshError::NotConnected(format!(
                    "Server {} state is {:?}, not Ready", server_id, entry.state
                )));
            }
            if !entry.conn.is_connected() {
                return Err(SshError::NotConnected(format!(
                    "Server {} handle is dead (state=Ready but transport closed)", server_id
                )));
            }
            entry.conn.clone()
        };
        let result = crate::ssh::connection::ExecManager::new(connection.transport())
            .execute_streaming(command, timeout_secs, on_chunk)
            .await;
        if result.is_ok() {
            let mut conns = self.lock();
            if let Some(entry) = conns.get_mut(server_id) {
                entry.last_active = now_ms();
            }
        }
        result
    }

    /// 镜像导出（方案 A）：远端 `docker save` 的 tar 字节流直接落到**客户端本地文件**，
    /// 不写宿主机磁盘、不在内存整段缓冲（逐块写入）。
    pub async fn save_image_to_file(
        &self,
        server_id: &str,
        command: &str,
        timeout_secs: u64,
        local_path: &str,
        on_progress: &(dyn Fn(u64, u64) + Send + Sync),
    ) -> SshResult<CommandOutput> {
        let cmd_validation = crate::validators::validate_command(command.to_string());
        if !cmd_validation.valid {
            return Err(SshError::ConnectionFailed(format!(
                "Command rejected: {}",
                cmd_validation.error.unwrap_or_default()
            )));
        }
        let connection = {
            let conns = self.lock();
            let entry = Self::resolve_entry(&conns, server_id)
                .ok_or_else(|| SshError::NotConnected(server_id.to_string()))?;
            if entry.state != ConnectionState::Ready {
                return Err(SshError::NotConnected(format!(
                    "Server {} state is {:?}, not Ready",
                    server_id, entry.state
                )));
            }
            if !entry.conn.is_connected() {
                return Err(SshError::NotConnected(format!(
                    "Server {} handle is dead (state=Ready but transport closed)",
                    server_id
                )));
            }
            entry.conn.clone()
        };
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        {
            let mut m = self.transfer_cancels.lock().unwrap_or_else(|e| e.into_inner());
            m.insert(server_id.to_string(), cancel.clone());
        }
        let result = crate::ssh::connection::ExecManager::new(connection.transport())
            .execute_save_to_file(command, timeout_secs, local_path, on_progress, cancel)
            .await;
        {
            let mut m = self.transfer_cancels.lock().unwrap_or_else(|e| e.into_inner());
            m.remove(server_id);
        }
        if result.is_ok() {
            let mut conns = self.lock();
            if let Some(entry) = conns.get_mut(server_id) {
                entry.last_active = now_ms();
            }
        }
        result
    }

    /// 镜像导入（方案 A，对称）：客户端本地 tar 文件经 SSH stdin 喂给远端 `docker load`。
    pub async fn load_image_from_file(
        &self,
        server_id: &str,
        command: &str,
        timeout_secs: u64,
        local_path: &str,
        on_progress: &(dyn Fn(u64, u64) + Send + Sync),
    ) -> SshResult<CommandOutput> {
        let cmd_validation = crate::validators::validate_command(command.to_string());
        if !cmd_validation.valid {
            return Err(SshError::ConnectionFailed(format!(
                "Command rejected: {}",
                cmd_validation.error.unwrap_or_default()
            )));
        }
        let connection = {
            let conns = self.lock();
            let entry = Self::resolve_entry(&conns, server_id)
                .ok_or_else(|| SshError::NotConnected(server_id.to_string()))?;
            if entry.state != ConnectionState::Ready {
                return Err(SshError::NotConnected(format!(
                    "Server {} state is {:?}, not Ready",
                    server_id, entry.state
                )));
            }
            if !entry.conn.is_connected() {
                return Err(SshError::NotConnected(format!(
                    "Server {} handle is dead (state=Ready but transport closed)",
                    server_id
                )));
            }
            entry.conn.clone()
        };
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        {
            let mut m = self.transfer_cancels.lock().unwrap_or_else(|e| e.into_inner());
            m.insert(server_id.to_string(), cancel.clone());
        }
        let result = crate::ssh::connection::ExecManager::new(connection.transport())
            .execute_load_from_file(command, timeout_secs, local_path, on_progress, cancel)
            .await;
        {
            let mut m = self.transfer_cancels.lock().unwrap_or_else(|e| e.into_inner());
            m.remove(server_id);
        }
        if result.is_ok() {
            let mut conns = self.lock();
            if let Some(entry) = conns.get_mut(server_id) {
                entry.last_active = now_ms();
            }
        }
        result
    }

    /// 取消进行中的镜像导出/导入传输（设置对应 server_id 的 cancel flag）。
    pub fn cancel_transfer(&self, server_id: &str) {
        if let Ok(m) = self.transfer_cancels.lock() {
            if let Some(c) = m.get(server_id) {
                c.store(true, std::sync::atomic::Ordering::Relaxed);
            }
        }
    }

    /// 执行 PowerShell 脚本，自动适配远端 DefaultShell。
    ///
    /// 依次尝试两种命令格式，返回第一个成功（exit_code == 0）的结果：
    /// 1. 直接发送 PowerShell 脚本（DefaultShell=PowerShell 时可用）
    /// 2. cmd.exe 包装的 PowerShell 命令（DefaultShell=cmd/bash 时可用）
    ///
    /// 原因：当 Windows OpenSSH DefaultShell 设为 PowerShell 时，
    /// `cmd.exe /c powershell.exe -NoProfile ...` 中的 `-NoProfile` 等参数
    /// 会被外层 PowerShell 的原生命令参数解析拦截，导致 "NoProfile not recognized" 错误。
    /// 直接发送脚本则由 PowerShell 原生执行，无此问题。
    pub async fn execute_powershell(
        &self, server_id: &str, script: &str, timeout_secs: u64,
    ) -> SshResult<CommandOutput> {
        let direct = script.to_string();
        let wrapped = crate::validators::build_powershell_command(script);

        let mut last_err: Option<String> = None;
        for cmd in [&direct, &wrapped] {
            match self.execute(server_id, cmd, timeout_secs).await {
                Ok(out) if out.exit_code == 0 => return Ok(out),
                Ok(out) => {
                    last_err = Some(format!(
                        "PowerShell command failed (exit {}): {}",
                        out.exit_code, out.stderr.trim()
                    ));
                }
                Err(e) => {
                    last_err = Some(format!("PowerShell execution failed: {}", e));
                }
            }
        }
        Err(SshError::ExecutionFailed(
            last_err.unwrap_or_else(|| "All PowerShell execution attempts failed".to_string())
        ))
    }

    /// execute_powershell_with_stdin 已移除（PowerShell stdin 回退方案废弃）。
    /// 原因：cmd.exe 不传播 SSH EOF 导致死锁，详见 targets/windows/transfer.rs。
    ///
    /// Test TCP connectivity (sync, spawns blocking).
    pub async fn test_connection(host: &str, port: u16) -> bool {
        test_tcp_connection(host, port, 5).await
    }

    /// Get a connection reference (for shell/SFTP).
    pub fn get_connection(&self, server_id: &str) -> SshResult<Arc<SshConnection>> {
        let conns = self.lock();
        let entry = Self::resolve_entry(&conns, server_id)
            .ok_or_else(|| SshError::NotConnected(server_id.to_string()))?;
        if entry.state != ConnectionState::Ready {
            return Err(SshError::NotConnected(format!(
                "Server {} state is {:?}, not Ready", server_id, entry.state
            )));
        }
        Ok(entry.conn.clone())
    }

    /// Get a connection reference along with its generation (for shell session tracking & cleanup).
    pub fn get_connection_with_generation(&self, server_id: &str) -> SshResult<(Arc<SshConnection>, u64)> {
        let conns = self.lock();
        let entry = Self::resolve_entry(&conns, server_id)
            .ok_or_else(|| SshError::NotConnected(server_id.to_string()))?;
        if entry.state != ConnectionState::Ready {
            return Err(SshError::NotConnected(format!(
                "Server {} state is {:?}, not Ready", server_id, entry.state
            )));
        }
        Ok((entry.conn.clone(), entry.generation))
    }
}

/// Internal helper: execute a command and return stdout string.
/// Used by files::remote module.
///
/// 退出码判定：
/// - exit_code == 0：成功
/// - exit_code == -1：SSH channel 未收到 ExitStatus 消息（channel 提前关闭）。
///   此时不一定真失败（如 rm/mkdir 等命令在某些 sshd 实现下不发退出码），
///   只要 stderr 为空，视为成功。
/// - 其他非 0：失败，优先返回 stderr，其次 stdout，最后兜底错误信息
pub async fn execute_command(server_id: String, command: String) -> Result<String, String> {
    execute_command_with_timeout(server_id, command, 30).await
}

/// 带超时参数的 execute_command 变体。
/// 默认 30 秒适用于大多数命令；大目录扫描、压缩等耗时操作可传入更大值。
pub async fn execute_command_with_timeout(
    server_id: String,
    command: String,
    timeout_secs: u64,
) -> Result<String, String> {
    let out = SshManager::global()
        .execute(&server_id, &command, timeout_secs)
        .await
        .map_err(|e| e.to_string())?;
    if out.exit_code == 0 {
        return Ok(out.stdout);
    }
    if out.exit_code == -1 {
        // Channel 未发送 ExitStatus（russh 常见现象）
        // 若 stdout 非空且 stderr 仅含非致命警告（如 find 的 "Permission denied"），仍返回 stdout
        // 避免部分子项无权限时整个命令被误判为失败
        if out.stderr.is_empty() {
            return Ok(out.stdout);
        }
        // stderr 非空时检查是否仅含权限警告等非致命错误
        let is_only_warnings = out.stderr.lines().all(|line| {
            let l = line.to_lowercase();
            l.contains("permission denied")
                || l.contains("no such file or directory")
                || l.contains("cannot access")
        });
        if is_only_warnings && !out.stdout.is_empty() {
            return Ok(out.stdout);
        }
        // 否则返回 stderr 作为错误
        return Err(out.stderr);
    }
    let err_msg = if !out.stderr.is_empty() {
        out.stderr
    } else if !out.stdout.is_empty() {
        out.stdout
    } else {
        format!("Command exited with non-zero status {}", out.exit_code)
    };
    Err(err_msg)
}

/// 等待取消信号：当 flag 为 true 时立即完成，否则 pending 直到被 select! 中断
/// 用于在 read/write 循环中实现快速取消（避免最坏 120s 延迟）
pub(crate) async fn sleep_until_cancel(cancel: Option<&Arc<std::sync::atomic::AtomicBool>>) {
    if let Some(flag) = cancel {
        loop {
            if flag.load(std::sync::atomic::Ordering::Relaxed) {
                return;
            }
            // 短暂睡眠避免 busy loop（10ms 检查一次）
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    } else {
        // 无 cancel flag 时永远 pending，由 select! 的其他分支完成
        std::future::pending::<()>().await;
    }
}

/// 原子覆盖 rename：先备份目标 → rename tmp 到目标 → 删除备份
///
/// 替代旧的"删除目标 → 再 rename"模式：旧模式在第二次 rename 失败时会导致目标文件丢失。
/// 三步法保证即使 rename tmp 失败，目标文件仍可从 .bak 恢复。
///
/// 失败场景：
/// 1. 直接 rename 成功（目标不存在或服务器支持 overwrite）→ 删除 tmp，返回 Ok
/// 2. 备份目标失败（无法 rename 目标）→ 回退到旧策略（删除目标再 rename）
/// 3. rename tmp 到目标失败 → 恢复 .bak 到目标，删除 tmp，返回 Err
pub(crate) async fn sftp_atomic_rename_overwrite(
    sftp: &russh_sftp::client::SftpSession,
    tmp_path: &str,
    target_path: &str,
) -> Result<(), String> {
    // 先尝试直接 rename（目标不存在或服务器支持 overwrite 时直接成功）
    if sftp.rename(tmp_path, target_path).await.is_ok() {
        return Ok(());
    }

    // 直接 rename 失败：目标已存在，需要先备份
    let bak_path = format!("{}.sw-bak-{}", target_path, uuid::Uuid::new_v4());

    // 步骤 1：把目标 rename 到 .bak
    if sftp.rename(target_path, &bak_path).await.is_err() {
        // 备份失败：回退到旧策略（删除目标再 rename），保留原行为
        let _ = sftp.remove_file(target_path).await;
        match sftp.rename(tmp_path, target_path).await {
            Ok(_) => return Ok(()),
            Err(e) => {
                let _ = sftp.remove_file(tmp_path).await;
                return Err(format!(
                    "SFTP rename failed (write completed but atomic move failed): {}",
                    e
                ));
            }
        }
    }

    // 步骤 2：rename tmp 到目标
    match sftp.rename(tmp_path, target_path).await {
        Ok(_) => {
            // 步骤 3：删除备份
            let _ = sftp.remove_file(&bak_path).await;
            Ok(())
        }
        Err(e) => {
            // rename tmp 失败：尝试恢复备份到目标，避免数据丢失
            let _ = sftp.rename(&bak_path, target_path).await;
            let _ = sftp.remove_file(tmp_path).await;
            Err(format!(
                "SFTP rename failed (write completed but atomic move failed, backup restored): {}",
                e
            ))
        }
    }
}

/// Write content to a remote file using actual SFTP subsystem.
/// Used by files::remote module for small file writes (editor content etc.).
///
/// 原子写入策略：先写入临时文件 `<path>.sw-write-tmp-<uuid>`，
/// 完成后 rename 覆盖目标。避免写入中途失败导致原文件被 TRUNCATE 截断（数据丢失）。
/// 通过 SFTP 读取远程文件为 base64 字符串
///
/// 与 `files_read`（基于 cat 命令）不同，此函数通过 SFTP 协议读取原始字节，
/// 然后 base64 编码返回，保证二进制文件（图片、PDF 等）的数据完整性。
///
/// 用于前端图片预览等需要读取二进制文件的场景。
/// 返回格式：纯 base64 字符串（不带 `::base64::` 前缀，由调用方处理）
pub async fn sftp_read_file_base64(server_id: &str, path: &str) -> Result<String, String> {
    use base64::Engine;
    use tokio::io::AsyncReadExt;

    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let sftp = conn
        .create_sftp_session()
        .await
        .map_err(|e| format!("SFTP session failed: {}", e))?;

    let mut remote_file = sftp
        .open(path)
        .await
        .map_err(|e| format!("SFTP open failed: {}", e))?;

    // 限制读取大小，防止读取超大文件导致内存爆炸（与前端预览上限对齐，100MB）
    const MAX_READ_SIZE: u64 = 100 * 1024 * 1024;
    let meta = sftp.metadata(path).await.map_err(|e| format!("SFTP stat failed: {}", e))?;
    if meta.len() > MAX_READ_SIZE {
        return Err(format!(
            "File too large to preview ({} bytes, max {} bytes)",
            meta.len(),
            MAX_READ_SIZE
        ));
    }

    let mut buf = Vec::with_capacity(meta.len() as usize);
    remote_file
        .read_to_end(&mut buf)
        .await
        .map_err(|e| format!("SFTP read failed: {}", e))?;

    Ok(base64::engine::general_purpose::STANDARD.encode(&buf))
}

pub async fn sftp_write(server_id: String, path: String, content: Vec<u8>) -> Result<(), String> {
    use russh_sftp::protocol::OpenFlags;
    use tokio::io::AsyncWriteExt;

    // 安全检查：禁止覆盖系统根路径的关键文件（与 delete/rename/chmod 对齐）
    if is_dangerous_root_path(&path) {
        return Err(format!("Refused to write to dangerous root path: {}", path));
    }

    let conn = SshManager::global()
        .get_connection(&server_id)
        .map_err(|e| e.to_string())?;
    let sftp = conn
        .create_sftp_session()
        .await
        .map_err(|e| format!("SFTP session failed: {}", e))?;

    // 临时文件用 uuid 避免并发写同路径时碰撞
    let tmp_path = format!("{}.sw-write-tmp-{}", path, uuid::Uuid::new_v4());
    // 清理可能残留的同名临时文件
    let _ = sftp.remove_file(&tmp_path).await;

    let mut remote_file = sftp
        .open_with_flags(
            &tmp_path,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await
        .map_err(|e| format!("SFTP open failed: {}", e))?;

    let write_result: Result<(), String> = async {
        remote_file
            .write_all(&content)
            .await
            .map_err(|e| format!("SFTP write failed: {}", e))?;
        remote_file
            .flush()
            .await
            .map_err(|e| format!("SFTP flush failed: {}", e))?;
        // sync_all 调用 fsync 扩展，部分 SFTP 服务器（嵌入式 sshd）不支持
        // 失败时仅记录日志，不中断传输（数据已通过 flush 写入）
        if let Err(e) = remote_file.sync_all().await {
            eprintln!("[SFTP] sync_all warning (data already flushed): {}", e);
        }
        remote_file
            .shutdown()
            .await
            .map_err(|e| format!("SFTP close failed: {}", e))?;
        Ok(())
    }
    .await;

    if write_result.is_err() {
        // 写入失败：清理临时文件，目标文件完全不受影响
        let _ = sftp.remove_file(&tmp_path).await;
        if let Err(ref e) = write_result {
            SshManager::handle_connection_loss(&server_id, &conn, e).await;
        }
        return write_result;
    }

    // 原子 rename 覆盖目标（三步法：备份 → rename → 删除备份，避免数据丢失）
    sftp_atomic_rename_overwrite(&sftp, &tmp_path, &path).await?;

    Ok(())
}

/// 进度上报策略辅助结构：
/// - 小文件（<1MB）：每个 chunk 都上报，避免进度条长时间停留 0%
/// - 大文件：取 max(1MB, total/200) 作为阈值，约 0.5% 一报，避免事件洪流
struct ProgressReporter<F: Fn(u64, u64)> {
    total: u64,
    threshold: u64,
    last_reported: u64,
    on_progress: F,
}

impl<F: Fn(u64, u64)> ProgressReporter<F> {
    fn new(total: u64, on_progress: F) -> Self {
        // 小文件阈值 1MB；大文件按 total/200（约 0.5%），但不少于 1MB
        const SMALL_FILE: u64 = 1024 * 1024;
        let threshold = if total < SMALL_FILE {
            0  // 小文件：每 chunk 都报
        } else {
            std::cmp::max(SMALL_FILE, total / 200)
        };
        Self { total, threshold, last_reported: 0, on_progress }
    }
    fn report(&mut self, transferred: u64) {
        if transferred == 0 || transferred < self.last_reported { return; }
        if self.threshold == 0 || transferred - self.last_reported >= self.threshold {
            (self.on_progress)(transferred, self.total);
            self.last_reported = transferred;
        }
    }
    fn final_report(&mut self, transferred: u64) {
        if transferred != self.last_reported {
            (self.on_progress)(transferred, self.total);
            self.last_reported = transferred;
        }
    }
}

/// 应用全局限速：若 RATE_LIMIT_KBPS > 0，按 chunk 字节数计算应 sleep 的时间
/// sleep_ms = (bytes / (kbps * 1024)) * 1000
/// 在 chunk 循环中每块写入后调用，避免传输占满带宽
async fn apply_rate_limit(bytes: u64) {
    let kbps = crate::commands::files::RATE_LIMIT_KBPS.load(Ordering::Relaxed);
    if kbps == 0 || bytes == 0 {
        return;
    }
    // f64 计算避免整数除法截断；u64 毫秒足以覆盖任何合理 sleep 时长
    let sleep_ms = (bytes as f64 / (kbps as f64 * 1024.0)) * 1000.0;
    if sleep_ms >= 1.0 {
        tokio::time::sleep(Duration::from_millis(sleep_ms as u64)).await;
    }
}

/// PowerShell 上传/下载回退已移除。
/// 原因：cmd.exe 不传播 SSH EOF 给 powershell.exe 子进程，导致 stdin 死锁。
/// Windows 传输改为纯 SFTP 实现，见 targets/windows/transfer.rs。
#[allow(dead_code)]
const _REMOVED_POWERSHELL_TRANSFER: () = ();

/// 流式上传本地文件到远程路径（SFTP 子系统，自动获取并复用会话）。
pub async fn sftp_upload_file_stream(
    server_id: &str,
    local_path: &str,
    remote_path: &str,
    on_progress: impl Fn(u64, u64),
    cancel: Option<&std::sync::Arc<std::sync::atomic::AtomicBool>>,
    tmp_remote_path: &str,
    resume_offset: Option<u64>,
    keep_tmp_on_failure: bool,
) -> Result<(), String> {
    use russh_sftp::protocol::OpenFlags;
    use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
    use tokio::time::timeout;
    use std::time::Duration;

    // 安全检查：禁止上传到系统根路径（与 delete/rename/chmod 对齐）
    if is_dangerous_root_path(remote_path) {
        return Err(format!("Refused to upload to dangerous root path: {}", remote_path));
    }

    let metadata = tokio::fs::metadata(local_path)
        .await
        .map_err(|e| format!("Failed to read local file metadata: {}", e))?;
    let total_size = metadata.len();

    let mut local_file = tokio::fs::File::open(local_path)
        .await
        .map_err(|e| format!("Failed to open local file: {}", e))?;

    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let sftp = conn
        .create_sftp_session()
        .await
        .map_err(|e| format!("SFTP session failed: {}", e))?;

    // Windows 路径兼容：SFTP 协议要求正斜杠路径分隔符
    let sftp_tmp_path = tmp_remote_path.replace('\\', "/");
    let sftp_remote_path = remote_path.replace('\\', "/");

    // 续传模式：从 resume_offset 继续，本地文件 seek 跳过已传字节
    // 全新模式：TRUNCATE 临时文件从头写

    let open_flags = if let Some(offset) = resume_offset {
        if offset >= total_size {
            // 已传完，直接 rename（三步法避免数据丢失）
            sftp_atomic_rename_overwrite(&sftp, &sftp_tmp_path, &sftp_remote_path).await?;
            return Ok(());
        }
        local_file
            .seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|e| format!("Local file seek failed: {}", e))?;
        // APPEND 模式：不 TRUNCATE，在文件末尾追加
        OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::APPEND
    } else {
        // 全新传输：OpenFlags::TRUNCATE 会自动清空已存在的文件，无需额外调用 sftp.remove_file
        OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE
    };
    let initial_transferred: u64 = resume_offset.unwrap_or(0);

    let mut remote_file = timeout(
        Duration::from_secs(30),
        sftp.open_with_flags(&sftp_tmp_path, open_flags),
    )
    .await
    .map_err(|_| "SFTP open timed out".to_string())?
    .map_err(|e| format!("SFTP open failed: {}", e))?;

    // TOCTOU 防护：续传模式下，打开 tmp 文件后再次校验大小是否等于 offset
    // 避免 check 与 open 之间 tmp 文件被截断或扩展导致数据损坏
    // metadata 失败时必须中止（不能静默跳过），防止 tmp 文件不完整但 APPEND 继续写入
    if let Some(expected_offset) = resume_offset {
        match sftp.metadata(&sftp_tmp_path).await {
            Ok(meta) => {
                let actual_size = meta.len();
                if actual_size != expected_offset {
                    return Err(format!(
                        "Resume tmp file size mismatch (TOCTOU detected): expected {} bytes, actual {} bytes. Aborting to prevent data corruption.",
                        expected_offset, actual_size
                    ));
                }
            }
            Err(e) => {
                return Err(format!(
                    "Cannot verify tmp file size (metadata failed): {}. Aborting resume to prevent data corruption.",
                    e
                ));
            }
        }
    }

    // 减小 chunk 到 32KB：Windows OpenSSH sftp-server.exe 对大 chunk write 可能返回 SSH_FX_FAILURE
    const CHUNK_SIZE: usize = 32 * 1024;
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut transferred: u64 = initial_transferred;
    let mut reporter = ProgressReporter::new(total_size, on_progress);
    // 续传时立即报告初始进度，让前端显示已传字节数
    if initial_transferred > 0 {
        reporter.report(initial_transferred);
    }

    let write_result: Result<(), String> = async {
        loop {
            // cancel 检查：用 select! 监听取消信号，避免 read/write 期间无法立即取消（最坏 120s 延迟）
            if let Some(flag) = cancel {
                if flag.load(std::sync::atomic::Ordering::Relaxed) {
                    return Err("Transfer canceled by user".to_string());
                }
            }
            let n = tokio::select! {
                biased;
                _ = sleep_until_cancel(cancel) => {
                    return Err("Transfer canceled by user".to_string());
                }
                read_result = timeout(Duration::from_secs(60), local_file.read(&mut buf)) => {
                    read_result
                        .map_err(|_| "Local file read timed out".to_string())?
                        .map_err(|e| format!("Local file read failed: {}", e))?
                }
            };

            if n == 0 {
                break;
            }

            // write 重试：Windows Defender 实时扫描可能短暂锁定文件
            // 对齐防损坏：write_all 由多个 SFTP WRITE 请求循环组成，中途失败时前几段
            // 可能已在服务端落盘。重试前必须用 metadata 查询 tmp 真实大小，算出本
            // chunk 已写入字节数，APPEND 重开后只补写剩余部分——直接重写整个 chunk
            // 会产生 [前缀][部分写入][完整 chunk] 的重复段，静默损坏文件且前端报成功。
            let mut write_ok = false;
            let mut chunk_written: usize = 0; // 本 chunk 中已确认在服务端落盘的字节数
            for attempt in 0..3u32 {
                tokio::select! {
                    biased;
                    _ = sleep_until_cancel(cancel) => {
                        return Err("Transfer canceled by user".to_string());
                    }
                    write_result = timeout(Duration::from_secs(60), remote_file.write_all(&buf[chunk_written..n])) => {
                        match write_result {
                            Ok(Ok(())) => { write_ok = true; break; }
                            Ok(Err(e)) => {
                                if attempt < 2 {
                                    eprintln!("[SFTP] write attempt {} failed (will retry): {}", attempt, e);
                                    tokio::time::sleep(Duration::from_millis(500)).await;
                                    // 正常关闭失效句柄后再打开，避免旧 handle 在服务端残留。
                                    let _ = remote_file.shutdown().await;
                                    // 查询 tmp 真实大小以对齐重试偏移；metadata 失败则无法
                                    // 确定已写入量，中止比盲目重写更安全
                                    let actual_size = match timeout(Duration::from_secs(30), sftp.metadata(&sftp_tmp_path)).await {
                                        Ok(Ok(meta)) => meta.len(),
                                        Ok(Err(e2)) => {
                                            return Err(format!("SFTP metadata failed after write error: {} (original: {})", e2, e));
                                        }
                                        Err(_) => {
                                            return Err(format!("SFTP metadata timed out after write error: {}", e));
                                        }
                                    };
                                    if actual_size < transferred {
                                        return Err(format!(
                                            "SFTP tmp file size went backwards during retry ({} < {}); aborting to prevent corruption",
                                            actual_size, transferred
                                        ));
                                    }
                                    let written = (actual_size - transferred) as usize;
                                    if written >= n {
                                        // 报错但本 chunk 实际已完整落盘：视为成功，避免重复写入
                                        write_ok = true;
                                        break;
                                    }
                                    chunk_written = written;
                                    let reopen_result = timeout(
                                        Duration::from_secs(30),
                                        sftp.open_with_flags(&sftp_tmp_path, OpenFlags::WRITE | OpenFlags::APPEND),
                                    ).await;
                                    match reopen_result {
                                        Ok(Ok(f)) => { remote_file = f; }
                                        Ok(Err(e2)) => {
                                            return Err(format!("SFTP reopen failed after write error: {} (original: {})", e2, e));
                                        }
                                        Err(_) => {
                                            return Err(format!("SFTP reopen timed out after write error: {}", e));
                                        }
                                    }
                                } else {
                                    return Err(format!("SFTP write failed after 3 retries: {}", e));
                                }
                            }
                            Err(_) => {
                                return Err("SFTP write timed out".to_string());
                            }
                        }
                    }
                }
            }
            if !write_ok {
                return Err("SFTP write failed: unknown error".to_string());
            }

            transferred += n as u64;
            reporter.report(transferred);
            apply_rate_limit(n as u64).await;
        }

        reporter.final_report(transferred);

        // 收尾阶段同样响应取消：chunk 全部写入后、flush/rename 最终化之前若已
        // 取消，则不执行最终化（避免 UI 显示「已取消」但目标文件实际已被完整覆盖）
        if let Some(flag) = cancel {
            if flag.load(std::sync::atomic::Ordering::Relaxed) {
                return Err("Transfer canceled by user".to_string());
            }
        }

        // 收尾阶段的 flush/sync 此前是裸 .await：网络恰在此时断开会让任务永久挂起
        // （取消 flag 仅在 chunk 循环内检查，无法中断这些 await）。60s 超时与 chunk
        // 超时对齐，超时即报错让前端记录转 failed，避免永久卡在 transferring。
        match tokio::time::timeout(std::time::Duration::from_secs(60), remote_file.flush()).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(format!("SFTP flush failed: {}", e)),
            Err(_) => return Err("SFTP flush timeout (60s)".to_string()),
        }
        // sync_all 调用 fsync 扩展，部分 SFTP 服务器（嵌入式 sshd）不支持
        // 失败/超时仅记录日志，不中断传输（数据已通过 flush 写入）
        match tokio::time::timeout(std::time::Duration::from_secs(60), remote_file.sync_all()).await {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => eprintln!("[SFTP] sync_all warning (data already flushed): {}", e),
            Err(_) => eprintln!("[SFTP] sync_all timeout (60s, data already flushed)"),
        }
        Ok(())
    }
    .await;

    if write_result.is_err() {
        // keep_tmp_on_failure=true 时保留临时文件供断点续传；否则清理
        if !keep_tmp_on_failure {
            let _ = sftp.remove_file(&sftp_tmp_path).await;
        }
        if let Err(ref e) = write_result {
            SshManager::handle_connection_loss(server_id, &conn, e).await;
        }
        return write_result;
    }

    // 原子 rename 覆盖目标（三步法：备份 → rename → 删除备份，避免数据丢失）
    sftp_atomic_rename_overwrite(&sftp, &sftp_tmp_path, &sftp_remote_path).await?;

    Ok(())
}

/// 流式下载远程文件到本地路径（SFTP 子系统）。
///
/// 原子写入策略：先下载到临时文件 `<local_path>.sw-dl-tmp-<uuid>`，
/// 完成后 rename 覆盖目标。避免下载中途失败导致原本地文件被 File::create 截断（数据丢失）。
pub async fn sftp_download_file_stream(
    server_id: &str,
    remote_path: &str,
    local_path: &str,
    on_progress: impl Fn(u64, u64),
    cancel: Option<&std::sync::Arc<std::sync::atomic::AtomicBool>>,
    tmp_local_path: &str,
    resume_offset: Option<u64>,
    keep_tmp_on_failure: bool,
) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
    use tokio::time::timeout;
    use std::time::Duration;

    // 确保目标目录存在（rename 需要同文件系统，临时文件必须与目标在同一目录）
    if let Some(parent) = std::path::Path::new(local_path).parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }

    // 提前创建空的本地临时文件（全新传输模式），实现秒级生成临时文件
    if resume_offset.is_none() {
        if let Err(e) = tokio::fs::File::create(tmp_local_path).await {
            return Err(format!("Failed to create local temp file immediately: {}", e));
        }
    }

    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let sftp = conn
        .create_sftp_session()
        .await
        .map_err(|e| format!("SFTP session failed: {}", e))?;

    // Windows 路径兼容：SFTP 协议要求正斜杠路径分隔符
    let sftp_remote_path = remote_path.replace('\\', "/");

    let total_size = match sftp.metadata(&sftp_remote_path).await {
        Ok(meta) => meta.size.unwrap_or(0),
        Err(_) => 0,
    };

    let mut remote_file = timeout(Duration::from_secs(30), sftp.open(&sftp_remote_path))
        .await
        .map_err(|_| "SFTP open timed out".to_string())?
        .map_err(|e| format!("SFTP open failed: {}", e))?;

    // 续传模式：从 resume_offset 继续，远程文件 seek 跳过已传字节，本地临时文件 APPEND 追加
    // 全新模式：本地临时文件 TRUNCATE 从头写

    let mut local_file = if let Some(offset) = resume_offset {
        if offset >= total_size && total_size > 0 {
            if offset > total_size {
                // 远程源文件在暂停期间变小：超长 tmp 直接 rename 会产出带陈旧尾部的
                // 损坏文件（旧内容尾部 + 报成功），必须中止
                return Err(format!(
                    "Remote source file shrank since the transfer was paused ({} -> {} bytes). \
                     Please start a fresh transfer.",
                    offset, total_size
                ));
            }
            // 已传完（offset == total_size），直接 rename
            tokio::fs::rename(tmp_local_path, local_path)
                .await
                .map_err(|e| format!("Local rename failed: {}", e))?;
            return Ok(());
        }
        remote_file
            .seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|e| format!("SFTP seek failed: {}", e))?;
        // APPEND 模式打开本地临时文件（不 TRUNCATE）
        let f = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(tmp_local_path)
            .await
            .map_err(|e| format!("Failed to open local temp file for append: {}", e))?;
        // TOCTOU 防护：打开后再校验文件大小是否等于 offset
        // metadata 失败时必须中止（不能静默跳过），防止 tmp 文件不完整但 APPEND 继续写入
        match f.metadata().await {
            Ok(meta) => {
                let actual_size = meta.len();
                if actual_size != offset {
                    return Err(format!(
                        "Resume tmp file size mismatch (TOCTOU detected): expected {} bytes, actual {} bytes. Aborting to prevent data corruption.",
                        offset, actual_size
                    ));
                }
            }
            Err(e) => {
                return Err(format!(
                    "Cannot verify local tmp file size (metadata failed): {}. Aborting resume to prevent data corruption.",
                    e
                ));
            }
        }

        // 内容采样校验：大小一致不足以证明 tmp 与远程源文件对应——远程源文件在暂停
        // 期间被同尺寸修改仍会滑过所有大小检查，续传会产出「前半旧内容 + 后半新内容」
        // 的静默损坏文件。读取远程源与本地 tmp 在 offset 前最后 4KB 的内容比对，
        // 不匹配则中止续传（用户可重新发起全新传输）。
        const TAIL_SAMPLE_MAX: usize = 4096;
        let sample_len = (offset as usize).min(TAIL_SAMPLE_MAX);
        if sample_len > 0 {
            let sample_start = offset - sample_len as u64;
            // 远程源文件尾部采样（remote_file 当前位于 offset，采样后需 seek 回）
            let mut src_tail = vec![0u8; sample_len];
            remote_file
                .seek(std::io::SeekFrom::Start(sample_start))
                .await
                .map_err(|e| format!("SFTP seek failed for tail sample: {}", e))?;
            timeout(Duration::from_secs(30), remote_file.read_exact(&mut src_tail))
                .await
                .map_err(|_| "SFTP read timed out (tail sample)".to_string())?
                .map_err(|e| format!("SFTP read failed for tail sample: {}", e))?;
            remote_file
                .seek(std::io::SeekFrom::Start(offset))
                .await
                .map_err(|e| format!("SFTP seek failed after tail sample: {}", e))?;
            // 本地 tmp 尾部采样：独立只读句柄（f 是 APPEND 写句柄，避免混用读写位置）
            let mut tmp_read = tokio::fs::File::open(tmp_local_path)
                .await
                .map_err(|e| format!("Failed to open local tmp for tail sample: {}", e))?;
            tmp_read
                .seek(std::io::SeekFrom::Start(sample_start))
                .await
                .map_err(|e| format!("Local tmp seek failed for tail sample: {}", e))?;
            let mut tmp_tail = vec![0u8; sample_len];
            tmp_read
                .read_exact(&mut tmp_tail)
                .await
                .map_err(|e| format!("Local tmp read failed for tail sample: {}", e))?;
            if src_tail != tmp_tail {
                return Err(format!(
                    "Resume verification failed: local tmp file content does not match the remote source at offset {} \
                     (remote file may have changed since the transfer was paused). \
                     Please start a fresh transfer.",
                    offset
                ));
            }
        }
        f
    } else {
        // 全新传输：TRUNCATE 创建
        tokio::fs::File::create(tmp_local_path)
            .await
            .map_err(|e| format!("Failed to create local temp file: {}", e))?
    };
    let initial_transferred: u64 = resume_offset.unwrap_or(0);

    const CHUNK_SIZE: usize = 256 * 1024;
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut transferred: u64 = initial_transferred;
    let mut reporter = ProgressReporter::new(total_size, on_progress);
    if initial_transferred > 0 {
        reporter.report(initial_transferred);
    }

    let write_result: Result<(), String> = async {
        loop {
            if let Some(flag) = cancel {
                if flag.load(std::sync::atomic::Ordering::Relaxed) {
                    return Err("Transfer canceled by user".to_string());
                }
            }
            let n = tokio::select! {
                biased;
                _ = sleep_until_cancel(cancel) => {
                    return Err("Transfer canceled by user".to_string());
                }
                read_result = timeout(Duration::from_secs(60), remote_file.read(&mut buf)) => {
                    read_result
                        .map_err(|_| "SFTP read timed out".to_string())?
                        .map_err(|e| format!("SFTP read failed: {}", e))?
                }
            };

            if n == 0 {
                break;
            }

            tokio::select! {
                biased;
                _ = sleep_until_cancel(cancel) => {
                    return Err("Transfer canceled by user".to_string());
                }
                write_result = timeout(Duration::from_secs(60), local_file.write_all(&buf[..n])) => {
                    write_result
                        .map_err(|_| "Local file write timed out".to_string())?
                        .map_err(|e| format!("Local file write failed: {}", e))?;
                }
            }

            transferred += n as u64;
            reporter.report(transferred);
            apply_rate_limit(n as u64).await;
        }

        reporter.final_report(transferred);

        // 收尾阶段同样响应取消：chunk 全部读取后、flush/rename 最终化之前若已
        // 取消，则不执行最终化（避免 UI 显示「已取消」但目标文件实际已被完整覆盖）
        if let Some(flag) = cancel {
            if flag.load(std::sync::atomic::Ordering::Relaxed) {
                return Err("Transfer canceled by user".to_string());
            }
        }

        match tokio::time::timeout(std::time::Duration::from_secs(60), local_file.flush()).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(format!("Local file flush failed: {}", e)),
            Err(_) => return Err("Local file flush timeout (60s)".to_string()),
        }
        match tokio::time::timeout(std::time::Duration::from_secs(60), local_file.sync_all()).await {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => return Err(format!("Local file sync failed: {}", e)),
            Err(_) => return Err("Local file sync timeout (60s)".to_string()),
        }
        Ok(())
    }
    .await;

    if write_result.is_err() {
        // keep_tmp_on_failure=true 时保留临时文件供断点续传；否则清理
        if !keep_tmp_on_failure {
            let _ = tokio::fs::remove_file(tmp_local_path).await;
        }
        if let Err(ref e) = write_result {
            SshManager::handle_connection_loss(server_id, &conn, e).await;
        }
        return write_result;
    }

    // 原子 rename 覆盖目标（tokio::fs::rename 在同文件系统下是原子操作，覆盖目标）
    if let Err(e) = tokio::fs::rename(tmp_local_path, local_path).await {
        let _ = tokio::fs::remove_file(tmp_local_path).await;
        return Err(format!(
            "Local rename failed (download completed but atomic move failed): {}",
            e
        ));
    }

    Ok(())
}

/// 流式上传本地文件到远程路径（使用已有的 SFTP 会话）。
/// `cancel`: 可选的取消标志，在 chunk 循环中检查；为 true 时立即停止并清理临时文件
pub async fn sftp_upload_file_with_session(
    sftp: &russh_sftp::client::SftpSession,
    local_path: &str,
    remote_path: &str,
    on_progress: impl Fn(u64, u64),
    cancel: Option<&std::sync::Arc<std::sync::atomic::AtomicBool>>,
    tmp_remote_path: &str,
    resume_offset: Option<u64>,
    keep_tmp_on_failure: bool,
) -> Result<(), String> {
    // 安全检查：禁止上传到系统根路径（与 delete/rename/chmod 对齐）
    if is_dangerous_root_path(remote_path) {
        return Err(format!("Refused to upload to dangerous root path: {}", remote_path));
    }
    use russh_sftp::protocol::OpenFlags;
    use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
    use tokio::time::timeout;
    use std::time::Duration;

    // Windows 路径兼容：SFTP 协议要求正斜杠路径分隔符
    // Windows OpenSSH sftp-server.exe 对反斜杠路径的 write 操作可能返回 SSH_FX_FAILURE
    // 统一将反斜杠转为正斜杠，如 C:\Users\... → C:/Users/...
    let sftp_tmp_path = tmp_remote_path.replace('\\', "/");
    let sftp_remote_path = remote_path.replace('\\', "/");

    let metadata = tokio::fs::metadata(local_path)
        .await
        .map_err(|e| format!("Failed to read local file metadata: {}", e))?;
    let total_size = metadata.len();

    let mut local_file = tokio::fs::File::open(local_path)
        .await
        .map_err(|e| format!("Failed to open local file: {}", e))?;

    // 续传模式：从 resume_offset 继续，本地文件 seek 跳过已传字节
    // 全新模式：TRUNCATE 临时文件从头写

    let open_flags = if let Some(offset) = resume_offset {
        if offset >= total_size {
            if offset > total_size {
                // 源文件在暂停期间变小：超长 tmp 直接 rename 会产出带陈旧尾部的
                // 损坏文件（旧内容尾部 + 报成功），必须中止
                return Err(format!(
                    "Source file shrank since the transfer was paused ({} -> {} bytes). \
                     Please start a fresh transfer.",
                    offset, total_size
                ));
            }
            // 已传完（offset == total_size），直接 rename（三步法避免数据丢失）
            sftp_atomic_rename_overwrite(sftp, &sftp_tmp_path, &sftp_remote_path).await?;
            return Ok(());
        }
        local_file
            .seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|e| format!("Local file seek failed: {}", e))?;
        OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::APPEND
    } else {
        // 全新传输：OpenFlags::TRUNCATE 会自动清空已存在的文件，无需额外调用 sftp.remove_file
        OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE
    };
    let initial_transferred: u64 = resume_offset.unwrap_or(0);

    let mut remote_file = timeout(
        Duration::from_secs(30),
        sftp.open_with_flags(&sftp_tmp_path, open_flags),
    )
    .await
    .map_err(|_| "SFTP open timed out".to_string())?
    .map_err(|e| format!("SFTP open failed: {}", e))?;

    // TOCTOU 防护：续传模式下，打开 tmp 文件后再次校验大小是否等于 offset
    // 避免 check 与 open 之间 tmp 文件被截断或扩展导致数据损坏
    // metadata 失败时必须中止（不能静默跳过），防止 tmp 文件不完整但 APPEND 继续写入
    if let Some(expected_offset) = resume_offset {
        match sftp.metadata(&sftp_tmp_path).await {
            Ok(meta) => {
                let actual_size = meta.len();
                if actual_size != expected_offset {
                    return Err(format!(
                        "Resume tmp file size mismatch (TOCTOU detected): expected {} bytes, actual {} bytes. Aborting to prevent data corruption.",
                        expected_offset, actual_size
                    ));
                }
            }
            Err(e) => {
                return Err(format!(
                    "Cannot verify tmp file size (metadata failed): {}. Aborting resume to prevent data corruption.",
                    e
                ));
            }
        }

        // 内容采样校验：大小一致不足以证明 tmp 与源文件对应——源文件在暂停期间被
        // 同尺寸修改/替换仍会滑过所有大小检查，续传会产出「前半旧内容 + 后半新内容」
        // 的静默损坏文件。读取源文件与 tmp 在 offset 前最后 4KB 的内容比对，
        // 不匹配则中止续传（用户可重新发起全新传输）。
        const TAIL_SAMPLE_MAX: usize = 4096;
        let sample_len = (expected_offset as usize).min(TAIL_SAMPLE_MAX);
        if sample_len > 0 {
            let sample_start = expected_offset - sample_len as u64;
            // 源文件尾部采样
            let mut src_tail = vec![0u8; sample_len];
            local_file
                .seek(std::io::SeekFrom::Start(sample_start))
                .await
                .map_err(|e| format!("Local file seek failed for tail sample: {}", e))?;
            local_file
                .read_exact(&mut src_tail)
                .await
                .map_err(|e| format!("Local file read failed for tail sample: {}", e))?;
            // 恢复到 offset，供后续 chunk 循环从正确位置续传
            local_file
                .seek(std::io::SeekFrom::Start(expected_offset))
                .await
                .map_err(|e| format!("Local file seek failed after tail sample: {}", e))?;
            // tmp 尾部采样：独立只读句柄（remote_file 是 APPEND 写句柄，混用读写位置不可靠）
            let mut tmp_read = timeout(
                Duration::from_secs(30),
                sftp.open_with_flags(&sftp_tmp_path, OpenFlags::READ),
            )
            .await
            .map_err(|_| "SFTP open timed out (tail sample)".to_string())?
            .map_err(|e| format!("SFTP open failed for tail sample: {}", e))?;
            tmp_read
                .seek(std::io::SeekFrom::Start(sample_start))
                .await
                .map_err(|e| format!("SFTP seek failed for tail sample: {}", e))?;
            let mut tmp_tail = vec![0u8; sample_len];
            timeout(Duration::from_secs(30), tmp_read.read_exact(&mut tmp_tail))
                .await
                .map_err(|_| "SFTP read timed out (tail sample)".to_string())?
                .map_err(|e| format!("SFTP read failed for tail sample: {}", e))?;
            let _ = tmp_read.shutdown().await;
            if src_tail != tmp_tail {
                return Err(format!(
                    "Resume verification failed: tmp file content does not match the source at offset {} \
                     (source file may have changed since the transfer was paused). \
                     Please start a fresh transfer.",
                    expected_offset
                ));
            }
        }
    }

    // 减小 chunk 到 32KB：Windows OpenSSH sftp-server.exe 对大 chunk write 可能返回 SSH_FX_FAILURE
    // 32KB 是 SFTP 协议推荐的 chunk 大小，兼容性最好
    const CHUNK_SIZE: usize = 32 * 1024;
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut transferred: u64 = initial_transferred;
    let mut reporter = ProgressReporter::new(total_size, on_progress);
    if initial_transferred > 0 {
        reporter.report(initial_transferred);
    }

    let write_result: Result<(), String> = async {
        loop {
            if let Some(flag) = cancel {
                if flag.load(std::sync::atomic::Ordering::Relaxed) {
                    return Err("Transfer canceled by user".to_string());
                }
            }
            let n = tokio::select! {
                biased;
                _ = sleep_until_cancel(cancel) => {
                    return Err("Transfer canceled by user".to_string());
                }
                read_result = timeout(Duration::from_secs(60), local_file.read(&mut buf)) => {
                    read_result
                        .map_err(|_| "Local file read timed out".to_string())?
                        .map_err(|e| format!("Local file read failed: {}", e))?
                }
            };
            if n == 0 {
                break;
            }
            // write 重试：Windows Defender 实时扫描可能短暂锁定文件，导致 write 返回 SSH_FX_FAILURE
            // 重试 3 次，每次间隔 500ms，等待 Defender 释放锁
            // 对齐防损坏：write_all 由多个 SFTP WRITE 请求循环组成，中途失败时前几段
            // 可能已在服务端落盘。重试前必须用 metadata 查询 tmp 真实大小，算出本
            // chunk 已写入字节数，APPEND 重开后只补写剩余部分——直接重写整个 chunk
            // 会产生 [前缀][部分写入][完整 chunk] 的重复段，静默损坏文件且前端报成功。
            let mut write_ok = false;
            let mut chunk_written: usize = 0; // 本 chunk 中已确认在服务端落盘的字节数
            for attempt in 0..3u32 {
                tokio::select! {
                    biased;
                    _ = sleep_until_cancel(cancel) => {
                        return Err("Transfer canceled by user".to_string());
                    }
                    write_result = timeout(Duration::from_secs(60), remote_file.write_all(&buf[chunk_written..n])) => {
                        match write_result {
                            Ok(Ok(())) => { write_ok = true; break; }
                            Ok(Err(e)) => {
                                if attempt < 2 {
                                    eprintln!("[SFTP] write attempt {} failed (will retry): {}", attempt, e);
                                    tokio::time::sleep(Duration::from_millis(500)).await;
                                    // 显式关闭失效句柄后再打开，避免旧 handle 在服务端残留。
                                    let _ = remote_file.shutdown().await;
                                    // 查询 tmp 真实大小以对齐重试偏移；metadata 失败则无法
                                    // 确定已写入量，中止比盲目重写更安全
                                    let actual_size = match timeout(Duration::from_secs(30), sftp.metadata(&sftp_tmp_path)).await {
                                        Ok(Ok(meta)) => meta.len(),
                                        Ok(Err(e2)) => {
                                            return Err(format!("SFTP metadata failed after write error: {} (original: {})", e2, e));
                                        }
                                        Err(_) => {
                                            return Err(format!("SFTP metadata timed out after write error: {}", e));
                                        }
                                    };
                                    if actual_size < transferred {
                                        return Err(format!(
                                            "SFTP tmp file size went backwards during retry ({} < {}); aborting to prevent corruption",
                                            actual_size, transferred
                                        ));
                                    }
                                    let written = (actual_size - transferred) as usize;
                                    if written >= n {
                                        // 报错但本 chunk 实际已完整落盘：视为成功，避免重复写入
                                        write_ok = true;
                                        break;
                                    }
                                    chunk_written = written;
                                    let reopen_result = timeout(
                                        Duration::from_secs(30),
                                        sftp.open_with_flags(&sftp_tmp_path, OpenFlags::WRITE | OpenFlags::APPEND),
                                    ).await;
                                    match reopen_result {
                                        Ok(Ok(f)) => { remote_file = f; }
                                        Ok(Err(e2)) => {
                                            return Err(format!("SFTP reopen failed after write error: {} (original: {})", e2, e));
                                        }
                                        Err(_) => {
                                            return Err(format!("SFTP reopen timed out after write error: {}", e));
                                        }
                                    }
                                } else {
                                    return Err(format!("SFTP write failed after 3 retries: {}", e));
                                }
                            }
                            Err(_) => {
                                return Err("SFTP write timed out".to_string());
                            }
                        }
                    }
                }
            }
            if !write_ok {
                return Err("SFTP write failed: unknown error".to_string());
            }
            transferred += n as u64;
            reporter.report(transferred);
            apply_rate_limit(n as u64).await;
        }

        reporter.final_report(transferred);

        // 收尾阶段同样响应取消：chunk 全部写入后、flush/rename 最终化之前若已
        // 取消，则不执行最终化（避免 UI 显示「已取消」但目标文件实际已被完整覆盖）
        if let Some(flag) = cancel {
            if flag.load(std::sync::atomic::Ordering::Relaxed) {
                return Err("Transfer canceled by user".to_string());
            }
        }

        match tokio::time::timeout(std::time::Duration::from_secs(60), remote_file.flush()).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(format!("SFTP flush failed: {}", e)),
            Err(_) => return Err("SFTP flush timeout (60s)".to_string()),
        }
        // sync_all 调用 fsync 扩展，部分 SFTP 服务器（嵌入式 sshd）不支持
        // 失败/超时仅记录日志，不中断传输（数据已通过 flush 写入）
        match tokio::time::timeout(std::time::Duration::from_secs(60), remote_file.sync_all()).await {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => eprintln!("[SFTP] sync_all warning (data already flushed): {}", e),
            Err(_) => eprintln!("[SFTP] sync_all timeout (60s, data already flushed)"),
        }
        // 递归传输会连续打开大量文件，必须等待 CLOSE 确认后再处理下一个文件。
        match tokio::time::timeout(std::time::Duration::from_secs(60), remote_file.shutdown()).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(format!("SFTP close failed: {}", e)),
            Err(_) => return Err("SFTP close timeout (60s)".to_string()),
        }
        Ok(())
    }
    .await;

    if write_result.is_err() {
        let _ = remote_file.shutdown().await;
        if !keep_tmp_on_failure {
            let _ = sftp.remove_file(&sftp_tmp_path).await;
        }
        return write_result;
    }

    // 原子 rename 覆盖目标（三步法：备份 → rename → 删除备份，避免数据丢失）
    sftp_atomic_rename_overwrite(sftp, &sftp_tmp_path, &sftp_remote_path).await?;

    Ok(())
}

/// 流式下载远程文件到本地路径（使用已有的 SFTP 会话）。
/// `cancel`: 可选的取消标志，在 chunk 循环中检查；为 true 时立即停止
pub async fn sftp_download_file_with_session(
    sftp: &russh_sftp::client::SftpSession,
    remote_path: &str,
    local_path: &str,
    on_progress: impl Fn(u64, u64),
    cancel: Option<&std::sync::Arc<std::sync::atomic::AtomicBool>>,
    tmp_local_path: &str,
    resume_offset: Option<u64>,
    keep_tmp_on_failure: bool,
) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
    use tokio::time::timeout;
    use std::time::Duration;

    // 确保目标目录存在（rename 需要同文件系统，临时文件必须与目标在同一目录）
    if let Some(parent) = std::path::Path::new(local_path).parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }

    // 提前创建空的本地临时文件（全新传输模式），实现秒级生成临时文件
    if resume_offset.is_none() {
        if let Err(e) = tokio::fs::File::create(tmp_local_path).await {
            return Err(format!("Failed to create local temp file immediately: {}", e));
        }
    }

    // Windows 路径兼容：SFTP 协议要求正斜杠路径分隔符
    let sftp_remote_path = remote_path.replace('\\', "/");

    let total_size = match sftp.metadata(&sftp_remote_path).await {
        Ok(meta) => meta.size.unwrap_or(0),
        Err(_) => 0,
    };

    let mut remote_file = timeout(Duration::from_secs(30), sftp.open(&sftp_remote_path))
        .await
        .map_err(|_| "SFTP open timed out".to_string())?
        .map_err(|e| format!("SFTP open failed: {}", e))?;


    let mut local_file = if let Some(offset) = resume_offset {
        if offset >= total_size && total_size > 0 {
            tokio::fs::rename(tmp_local_path, local_path)
                .await
                .map_err(|e| format!("Local rename failed: {}", e))?;
            return Ok(());
        }
        remote_file
            .seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|e| format!("SFTP seek failed: {}", e))?;
        tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(tmp_local_path)
            .await
            .map_err(|e| format!("Failed to open local temp file for append: {}", e))?
    } else {
        tokio::fs::File::create(tmp_local_path)
            .await
            .map_err(|e| format!("Failed to create local temp file: {}", e))?
    };
    let initial_transferred: u64 = resume_offset.unwrap_or(0);

    const CHUNK_SIZE: usize = 256 * 1024;
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut transferred: u64 = initial_transferred;
    let mut reporter = ProgressReporter::new(total_size, on_progress);
    if initial_transferred > 0 {
        reporter.report(initial_transferred);
    }

    let write_result: Result<(), String> = async {
        loop {
            if let Some(flag) = cancel {
                if flag.load(std::sync::atomic::Ordering::Relaxed) {
                    return Err("Transfer canceled by user".to_string());
                }
            }
            let n = tokio::select! {
                biased;
                _ = sleep_until_cancel(cancel) => {
                    return Err("Transfer canceled by user".to_string());
                }
                read_result = timeout(Duration::from_secs(60), remote_file.read(&mut buf)) => {
                    read_result
                        .map_err(|_| "SFTP read timed out".to_string())?
                        .map_err(|e| format!("SFTP read failed: {}", e))?
                }
            };
            if n == 0 {
                break;
            }
            tokio::select! {
                biased;
                _ = sleep_until_cancel(cancel) => {
                    return Err("Transfer canceled by user".to_string());
                }
                write_result = timeout(Duration::from_secs(60), local_file.write_all(&buf[..n])) => {
                    write_result
                        .map_err(|_| "Local file write timed out".to_string())?
                        .map_err(|e| format!("Local file write failed: {}", e))?;
                }
            }
            transferred += n as u64;
            reporter.report(transferred);
            apply_rate_limit(n as u64).await;
        }

        reporter.final_report(transferred);

        // 收尾阶段同样响应取消：chunk 全部读取后、flush/rename 最终化之前若已
        // 取消，则不执行最终化（避免 UI 显示「已取消」但目标文件实际已被完整覆盖）
        if let Some(flag) = cancel {
            if flag.load(std::sync::atomic::Ordering::Relaxed) {
                return Err("Transfer canceled by user".to_string());
            }
        }

        match tokio::time::timeout(std::time::Duration::from_secs(60), local_file.flush()).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(format!("Local file flush failed: {}", e)),
            Err(_) => return Err("Local file flush timeout (60s)".to_string()),
        }
        match tokio::time::timeout(std::time::Duration::from_secs(60), local_file.sync_all()).await {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => return Err(format!("Local file sync failed: {}", e)),
            Err(_) => return Err("Local file sync timeout (60s)".to_string()),
        }
        Ok(())
    }
    .await;

    if write_result.is_err() {
        let _ = remote_file.shutdown().await;
        if !keep_tmp_on_failure {
            let _ = tokio::fs::remove_file(tmp_local_path).await;
        }
        return write_result;
    }

    match tokio::time::timeout(std::time::Duration::from_secs(60), remote_file.shutdown()).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(format!("SFTP close failed: {}", e)),
        Err(_) => return Err("SFTP close timeout (60s)".to_string()),
    }

    if let Err(e) = tokio::fs::rename(tmp_local_path, local_path).await {
        let _ = tokio::fs::remove_file(tmp_local_path).await;
        return Err(format!(
            "Local rename failed (download completed but atomic move failed): {}",
            e
        ));
    }

    Ok(())
}

/// Create a remote directory using SFTP.
pub async fn sftp_mkdir(server_id: &str, path: &str) -> Result<(), String> {
    // 安全检查：禁止在系统根路径创建目录（与 delete/rename/chmod 对齐）
    if is_dangerous_root_path(path) {
        return Err(format!("Refused to mkdir at dangerous root path: {}", path));
    }
    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let res = async {
        let sftp = conn
            .create_sftp_session()
            .await
            .map_err(|e| format!("SFTP session failed: {}", e))?;
        sftp.create_dir(path)
            .await
            .map_err(|e| format!("SFTP mkdir failed: {}", e))
    }.await;
    if let Err(ref e) = res {
        SshManager::handle_connection_loss(server_id, &conn, e).await;
    }
    res
}

/// SFTP 目录条目：文件名 + 路径 + 是否目录 + 大小 + 修改时间 + 权限 + owner + group
pub struct SftpDirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub mtime: Option<u32>,
    pub permissions: Option<u32>,
    pub user: Option<String>,
    pub group: Option<String>,
    pub uid: Option<u32>,
    pub gid: Option<u32>,
}

/// 通过 SFTP 列出远程目录内容（跨平台：Linux/Windows 通用）。
///
/// 返回 SftpDirEntry 列表，已过滤 `.` 和 `..`，已排序（目录优先，名称不区分大小写）。
/// 这是对标 WinSCP/FileZilla 的实现方式 —— 使用 SFTP 协议原生的 opendir/readdir，
/// 不依赖远端 shell（cmd/PowerShell/bash），彻底解决 shell 兼容性问题。
pub async fn sftp_read_dir(server_id: &str, path: &str) -> Result<Vec<SftpDirEntry>, String> {
    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let res = async {
        let sftp = conn
            .create_sftp_session()
            .await
            .map_err(|e| format!("SFTP session failed: {}", e))?;
        let mut read_dir = match sftp.read_dir(path).await {
            Ok(dir) => dir,
            Err(e) => {
                // 某些 sshd 在句柄达到上限后会拒绝新的 opendir。清掉缓存的
                // session 并重建一次，避免用户只能断开重连后才能刷新目录。
                let message = e.to_string();
                if message.to_lowercase().contains("handle") || message.to_lowercase().contains("limit") {
                    conn.invalidate_sftp_cache().await;
                    let fresh = conn
                        .create_sftp_session()
                        .await
                        .map_err(|se| format!("SFTP session recovery failed: {} (original: {})", se, message))?;
                    fresh
                        .read_dir(path)
                        .await
                        .map_err(|re| format!("SFTP read_dir failed after session recovery: {}", re))?
                } else {
                    return Err(format!("SFTP read_dir failed: {}", e));
                }
            }
        };
        let mut entries: Vec<SftpDirEntry> = read_dir
            .by_ref()
            .map(|e| SftpDirEntry {
                name: e.file_name(),
                path: e.path(),
                is_dir: e.file_type().is_dir(),
                is_symlink: e.file_type().is_symlink(),
                size: e.metadata().len(),
                mtime: e.metadata().mtime,
                permissions: e.metadata().permissions,
                user: e.metadata().user,
                group: e.metadata().group,
                uid: e.metadata().uid,
                gid: e.metadata().gid,
            })
            .collect();
        // 排序：目录优先，然后按名称不区分大小写排序
        entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });
        Ok(entries)
    }.await;
    if let Err(ref e) = res {
        SshManager::handle_connection_loss(server_id, &conn, e).await;
    }
    res
}

/// 通过 SFTP 删除远程目录（仅空目录）。
pub async fn sftp_remove_dir(server_id: &str, path: &str) -> Result<(), String> {
    if is_dangerous_root_path(path) {
        return Err(format!("Refused to remove dangerous root path: {}", path));
    }
    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let res = async {
        let sftp = conn
            .create_sftp_session()
            .await
            .map_err(|e| format!("SFTP session failed: {}", e))?;
        sftp.remove_dir(path)
            .await
            .map_err(|e| format!("SFTP remove_dir failed: {}", e))
    }.await;
    if let Err(ref e) = res {
        SshManager::handle_connection_loss(server_id, &conn, e).await;
    }
    res
}

/// 通过 SFTP 删除远程文件。
pub async fn sftp_remove_file(server_id: &str, path: &str) -> Result<(), String> {
    if is_dangerous_root_path(path) {
        return Err(format!("Refused to remove dangerous root path: {}", path));
    }
    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let res = async {
        let sftp = conn
            .create_sftp_session()
            .await
            .map_err(|e| format!("SFTP session failed: {}", e))?;
        sftp.remove_file(path)
            .await
            .map_err(|e| format!("SFTP remove_file failed: {}", e))
    }.await;
    if let Err(ref e) = res {
        SshManager::handle_connection_loss(server_id, &conn, e).await;
    }
    res
}

/// 静默删除远程文件（忽略所有错误，用于清理残留临时文件）
pub async fn sftp_remove_file_quiet(server_id: &str, path: &str) -> Result<(), String> {
    let _ = sftp_remove_file(server_id, path).await;
    Ok(())
}

/// 通过 SFP 重命名/移动文件或目录。
pub async fn sftp_rename(server_id: &str, old_path: &str, new_path: &str) -> Result<(), String> {
    if is_dangerous_root_path(old_path) || is_dangerous_root_path(new_path) {
        return Err("Refused to rename to/from dangerous root path".to_string());
    }
    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let res = async {
        let sftp = conn
            .create_sftp_session()
            .await
            .map_err(|e| format!("SFTP session failed: {}", e))?;
        sftp.rename(old_path, new_path)
            .await
            .map_err(|e| format!("SFTP rename failed: {}", e))
    }.await;
    if let Err(ref e) = res {
        SshManager::handle_connection_loss(server_id, &conn, e).await;
    }
    res
}

/// 通过 SFTP 获取文件元数据（stat）。
pub async fn sftp_stat(
    server_id: &str,
    path: &str,
) -> Result<russh_sftp::protocol::FileAttributes, String> {
    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let res = async {
        let sftp = conn
            .create_sftp_session()
            .await
            .map_err(|e| format!("SFTP session failed: {}", e))?;
        sftp.metadata(path)
            .await
            .map_err(|e| format!("SFTP metadata failed: {}", e))
    }.await;
    if let Err(ref e) = res {
        SshManager::handle_connection_loss(server_id, &conn, e).await;
    }
    res
}

/// 通过 SFTP 创建符号链接。
pub async fn sftp_symlink(
    server_id: &str,
    target: &str,
    link_path: &str,
) -> Result<(), String> {
    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let sftp = conn
        .create_sftp_session()
        .await
        .map_err(|e| format!("SFTP session failed: {}", e))?;
    sftp.symlink(target, link_path)
        .await
        .map_err(|e| format!("SFTP symlink failed: {}", e))?;
    Ok(())
}

/// 通过 SFTP 读取符号链接目标（readlink）。
pub async fn sftp_readlink(server_id: &str, path: &str) -> Result<String, String> {
    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let sftp = conn
        .create_sftp_session()
        .await
        .map_err(|e| format!("SFTP session failed: {}", e))?;
    let target = sftp
        .read_link(path)
        .await
        .map_err(|e| format!("SFTP readlink failed: {}", e))?;
    Ok(target)
}

/// 通过 SFTP canonicalize（realpath）获取规范化的绝对路径。
pub async fn sftp_canonicalize(server_id: &str, path: &str) -> Result<String, String> {
    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let sftp = conn
        .create_sftp_session()
        .await
        .map_err(|e| format!("SFTP session failed: {}", e))?;
    sftp.canonicalize(path)
        .await
        .map_err(|e| format!("SFTP canonicalize failed: {}", e))
}

/// 通过 SFTP 读取远程文件全部内容为 Vec<u8>（小文件专用，大文件请用 sftp_download_file_stream）。
pub async fn sftp_read_file_bytes(server_id: &str, path: &str) -> Result<Vec<u8>, String> {
    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let sftp = conn
        .create_sftp_session()
        .await
        .map_err(|e| format!("SFTP session failed: {}", e))?;
    let mut file = sftp
        .open(path)
        .await
        .map_err(|e| format!("SFTP open failed: {}", e))?;
    let mut buf = Vec::new();
    use tokio::io::AsyncReadExt;
    file.read_to_end(&mut buf)
        .await
        .map_err(|e| format!("SFTP read failed: {}", e))?;
    Ok(buf)
}
