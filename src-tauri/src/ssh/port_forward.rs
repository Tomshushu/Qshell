// SSH 端口转发（P0-2）
//
// 三种模式：
// - Local       (`-L local_host:local_port:remote_host:remote_port`)：
//     客户端监听 local_host:local_port，每条新连接开一条 SSH direct-tcpip 通道到 remote。
// - Remote      (`-R remote_bind_host:remote_bind_port:local_host:local_port`)：
//     请求 SSH 服务端监听 remote_bind_host:remote_bind_port，新连接以 ForwardedTcpIp 通道到达；
//     客户端再 connect 到本地 local_host:local_port 并双向 pipe。
//     字段约定：spec.remote_host/remote_port = 服务端监听地址；spec.local_host/local_port = 本地目标。
// - Dynamic     (`-D local_host:local_port`)：
//     客户端监听 SOCKS5，按目标 host:port 动态开 SSH direct-tcpip 通道。
//
// 设计要点：
// 1. 全局转发注册表（OnceLock + Mutex<HashMap>）：forward_id -> ForwardEntry
// 2. 远程转发的入站通道分发：REMOTE_FORWARD_RX 全局注册表，
//    key=(server_id, bind_host, bind_port)，ClientHandler.server_channel_open_forwarded_tcpip 查表分发。
// 3. 每条 forward 独立 tokio 任务，通过 AtomicBool 取消。
// 4. 连接断开时由 manager 调 stop_all_for_server 自动清理。

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use russh::ChannelMsg;
use russh::client::Msg;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, mpsc, Semaphore};
use tokio::task::JoinHandle;

use super::manager::SshManager;

/// 单条端口转发规则允许的最大并发活跃连接/通道数，防止突发流量打崩远端 sshd MaxSessions/MaxStartups
const MAX_CONCURRENT_FORWARD_CHANNELS: usize = 64;

// ============================================================================
// 数据类型
// ============================================================================

/// 转发类型
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ForwardKind {
    /// 本地端口转发（-L）
    Local,
    /// 远程端口转发（-R）
    Remote,
    /// 动态 SOCKS5 端口转发（-D）
    Dynamic,
}

/// 转发规格（前端 -> 后端）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardSpec {
    pub server_id: String,
    pub kind: ForwardKind,
    /// 本地地址
    /// - Local/Dynamic: 监听地址
    /// - Remote: 转发目标地址（本地服务监听处）
    pub local_host: String,
    /// 本地端口
    /// - Local/Dynamic: 监听端口（0 表示 OS 自动分配）
    /// - Remote: 转发目标端口（本地服务端口）
    pub local_port: u16,
    /// 远程地址
    /// - Local: SSH direct-tcpip 目标
    /// - Remote: 服务端监听绑定地址
    /// - Dynamic: None
    pub remote_host: Option<String>,
    /// 远程端口
    /// - Local: SSH direct-tcpip 目标端口
    /// - Remote: 服务端监听绑定端口（0 表示 OS 自动分配）
    /// - Dynamic: None
    pub remote_port: Option<u16>,
    /// 来源标识（如 "tunnel:{隧道名}"），标记该转发由哪条隧道自动启动；
    /// 手动添加的转发为 None。仅用于 UI 展示，不影响转发逻辑。
    #[serde(default)]
    pub source: Option<String>,
}

/// 转发状态
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ForwardState {
    Starting,
    Active,
    Stopping,
    Failed,
    Stopped,
}

/// 已注册的转发条目（内部）
struct ForwardEntry {
    spec: ForwardSpec,
    state: ForwardState,
    /// 实际绑定端口（Local/Dynamic 时本地监听端口；Remote 时服务端返回的绑定端口）
    bound_port: u16,
    /// 任务取消信号
    cancel: Arc<AtomicBool>,
    /// 监听任务句柄
    task: Option<JoinHandle<()>>,
    /// Remote 转发的服务端监听 (bind_address, bind_port)，用于 cancel_tcpip_forward
    remote_bind: Option<(String, u32)>,
    created_at: u64,
    last_error: Option<String>,
}

/// 对外暴露的转发信息
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardInfo {
    pub id: String,
    pub server_id: String,
    pub kind: ForwardKind,
    pub local_host: String,
    pub local_port: u16,
    /// 实际绑定的端口（与 local_port 可能不同，当 local_port=0 时由 OS 分配）
    pub bound_port: u16,
    pub remote_host: Option<String>,
    pub remote_port: Option<u16>,
    pub state: ForwardState,
    pub created_at: u64,
    pub last_error: Option<String>,
    /// 来源标识（如 "tunnel:{隧道名}"）：该转发由哪条隧道自动启动；
    /// None 表示手动添加的临时转发。
    pub source: Option<String>,
}

impl From<&ForwardEntry> for ForwardInfo {
    fn from(e: &ForwardEntry) -> Self {
        Self {
            id: String::new(), // 由调用方填充
            server_id: e.spec.server_id.clone(),
            kind: e.spec.kind,
            local_host: e.spec.local_host.clone(),
            local_port: e.spec.local_port,
            bound_port: e.bound_port,
            remote_host: e.spec.remote_host.clone(),
            remote_port: e.spec.remote_port,
            state: e.state,
            created_at: e.created_at,
            last_error: e.last_error.clone(),
            source: e.spec.source.clone(),
        }
    }
}

// ============================================================================
// 全局状态
// ============================================================================

/// 全局转发注册表：forward_id -> ForwardEntry
static FORWARDS: std::sync::OnceLock<Arc<Mutex<HashMap<String, ForwardEntry>>>> =
    std::sync::OnceLock::new();

fn forwards() -> &'static Arc<Mutex<HashMap<String, ForwardEntry>>> {
    FORWARDS.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

/// 远程转发的入站通道分发注册表
/// key: (server_id, bind_address, bind_port)
/// value: mpsc::Sender，用于把 server 推过来的 Channel 发给消费任务
static REMOTE_FORWARD_RX: std::sync::OnceLock<
    Mutex<HashMap<(String, String, u32), mpsc::Sender<russh::Channel<Msg>>>>,
> = std::sync::OnceLock::new();

fn remote_forward_rx(
) -> &'static Mutex<HashMap<(String, String, u32), mpsc::Sender<russh::Channel<Msg>>>> {
    REMOTE_FORWARD_RX.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ============================================================================
// 远程转发入站通道分发（供 ClientHandler 调用）
// ============================================================================

/// 由 ClientHandler 的 server_channel_open_forwarded_tcpip 回调调用。
/// 查找注册表，把 server 推过来的 Channel 发给对应的 Remote 转发消费任务。
///
/// 返回：
/// - Ok(true): 已成功分发给消费任务
/// - Ok(false): 注册表中无匹配条目（可能转发已被停止），调用方应丢弃 channel
pub async fn dispatch_forwarded_channel(
    server_id: &str,
    connected_address: &str,
    connected_port: u32,
    channel: russh::Channel<Msg>,
) -> bool {
    let key = (
        server_id.to_string(),
        connected_address.to_string(),
        connected_port,
    );
    let sender = {
        let map = remote_forward_rx().lock().await;
        map.get(&key).cloned()
    };
    if let Some(tx) = sender {
        // 用 try_send 避免阻塞回调；若通道满则直接丢弃（连接被关闭）
        tx.try_send(channel).is_ok()
    } else {
        false
    }
}

// ============================================================================
// 公共 API
// ============================================================================

/// 添加端口转发。返回 forward_id。
pub async fn add_forward(spec: ForwardSpec) -> Result<String, String> {
    // 校验 SSH 已连接
    let conn = SshManager::global()
        .get_connection(&spec.server_id)
        .map_err(|e| format!("无法建立转发：{}", e))?;

    let forward_id = format!("fwd-{}", uuid::Uuid::new_v4());

    match spec.kind {
        ForwardKind::Local => start_local_forward(forward_id.clone(), spec, conn).await?,
        ForwardKind::Remote => start_remote_forward(forward_id.clone(), spec, conn).await?,
        ForwardKind::Dynamic => start_dynamic_forward(forward_id.clone(), spec, conn).await?,
    }
    Ok(forward_id)
}

/// 列出所有转发（可按 server_id 过滤）
pub async fn list_forwards(server_id: Option<&str>) -> Vec<ForwardInfo> {
    let map = forwards().lock().await;
    map.iter()
        .filter(|(_, e)| {
            server_id.map_or(true, |sid| {
                if e.spec.server_id == sid {
                    return true;
                }
                let base_sid = crate::commands::extract_base_server_id(sid);
                let base_entry = crate::commands::extract_base_server_id(&e.spec.server_id);
                base_sid == base_entry
            })
        })
        .map(|(id, e)| {
            let mut info: ForwardInfo = e.into();
            info.id = id.clone();
            info
        })
        .collect()
}

/// 停止单条转发
pub async fn stop_forward(id: &str) -> Result<(), String> {
    let entry = {
        let mut map = forwards().lock().await;
        map.remove(id)
    };
    let mut entry = match entry {
        Some(e) => e,
        None => return Err(format!("转发 {} 不存在", id)),
    };

    // 1. 设置取消信号
    entry.cancel.store(true, Ordering::Relaxed);
    // 2. 远程转发：取消服务端监听 + 移除注册表项
    if let Some((addr, port)) = &entry.remote_bind {
        let conn = SshManager::global().get_connection(&entry.spec.server_id).ok();
        if let Some(conn) = conn {
            let addr_c = addr.clone();
            let port_c = *port;
            let _ = conn.cancel_remote_forward(&addr_c, port_c).await;
        }
        let key = (
            entry.spec.server_id.clone(),
            addr.clone(),
            *port,
        );
        remote_forward_rx().lock().await.remove(&key);
    }
    // 3. 等待任务结束
    if let Some(handle) = entry.task.take() {
        let _ = tokio::time::timeout(Duration::from_secs(1), handle).await;
    }
    Ok(())
}

/// Stop and recreate one forwarding rule using its original specification.
pub async fn restart_forward(id: &str) -> Result<String, String> {
    let spec = {
        let map = forwards().lock().await;
        map.get(id)
            .map(|entry| entry.spec.clone())
            .ok_or_else(|| format!("转发 {} 不存在", id))?
    };
    stop_forward(id).await?;
    add_forward(spec).await
}

/// 停止指定服务器的所有转发（连接断开时调用）
pub async fn stop_all_for_server(server_id: &str) {
    let base_id = crate::commands::extract_base_server_id(server_id);
    let ids: Vec<String> = {
        let map = forwards().lock().await;
        map.iter()
            .filter(|(_, e)| {
                e.spec.server_id == server_id
                    || crate::commands::extract_base_server_id(&e.spec.server_id) == base_id
            })
            .map(|(id, _)| id.clone())
            .collect()
    };
    for id in ids {
        let _ = stop_forward(&id).await;
    }
}

// ============================================================================
// Local Forward 实现
// ============================================================================

async fn start_local_forward(
    forward_id: String,
    spec: ForwardSpec,
    conn: Arc<super::connection::SshConnection>,
) -> Result<(), String> {
    let remote_host = spec
        .remote_host
        .clone()
        .ok_or_else(|| "Local 转发需要 remote_host".to_string())?;
    let remote_port = spec
        .remote_port
        .ok_or_else(|| "Local 转发需要 remote_port".to_string())?;

    let bind_addr = format!("{}:{}", spec.local_host, spec.local_port);
    let listener = TcpListener::bind(&bind_addr)
        .await
        .map_err(|e| format!("无法监听 {}: {}", bind_addr, e))?;
    let bound_port = listener
        .local_addr()
        .map_err(|e| format!("无法获取监听地址: {}", e))?
        .port();

    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_for_task = cancel.clone();
    let conn_for_task = conn.clone();
    let remote_host_t = remote_host.clone();
    let remote_port_t = remote_port;
    let sid_for_task = spec.server_id.clone();
    let fid_for_task = forward_id.clone();
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_FORWARD_CHANNELS));
    let semaphore_for_task = semaphore.clone();

    let task = tokio::spawn(async move {
        loop {
            if cancel_for_task.load(Ordering::Relaxed) {
                break;
            }
            // accept（带取消检查）
            let accept_res = tokio::select! {
                r = listener.accept() => r,
                _ = tokio::time::sleep(Duration::from_millis(500)) => {
                    continue;
                }
            };
            let (tcp, peer_addr) = match accept_res {
                Ok(v) => v,
                Err(e) => {
                    eprintln!(
                        "[PortForward] {} local accept 失败 ({}): {}",
                        fid_for_task, sid_for_task, e
                    );
                    // 短暂休眠避免 accept 错误时忙等
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    continue;
                }
            };

            let permit = match semaphore_for_task.clone().try_acquire_owned() {
                Ok(p) => p,
                Err(_) => {
                    eprintln!(
                        "[PortForward] {} local forward 达到并发连接上限 ({}), 拒绝新连接",
                        fid_for_task, MAX_CONCURRENT_FORWARD_CHANNELS
                    );
                    drop(tcp);
                    continue;
                }
            };

            // 开启 SSH direct-tcpip 通道
            let conn_c = conn_for_task.clone();
            let rh = remote_host_t.clone();
            let rp = remote_port_t;
            let cancel_c = cancel_for_task.clone();
            let fid = fid_for_task.clone();
            tokio::spawn(async move {
                let _permit = permit;
                let originator_host = peer_addr.ip().to_string();
                let originator_port = peer_addr.port() as u32;
                let channel = match conn_c
                    .open_direct_tcpip(rh, rp as u32, originator_host, originator_port)
                    .await
                {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!(
                            "[PortForward] {} open_direct_tcpip 失败: {}",
                            fid, e
                        );
                        return;
                    }
                };
                pipe_tcp_with_channel(tcp, channel, cancel_c).await;
            });
        }
    });

    let mut map = forwards().lock().await;
    map.insert(
        forward_id,
        ForwardEntry {
            spec,
            state: ForwardState::Active,
            bound_port,
            cancel,
            task: Some(task),
            remote_bind: None,
            created_at: now_ms(),
            last_error: None,
        },
    );
    Ok(())
}

// ============================================================================
// Remote Forward 实现
// ============================================================================

async fn start_remote_forward(
    forward_id: String,
    spec: ForwardSpec,
    conn: Arc<super::connection::SshConnection>,
) -> Result<(), String> {
    let bind_address = spec
        .remote_host
        .clone()
        .ok_or_else(|| "Remote 转发需要 remote_host（服务端绑定地址）".to_string())?;
    let bind_port_req = spec
        .remote_port
        .ok_or_else(|| "Remote 转发需要 remote_port（服务端绑定端口）".to_string())?;

    // 在 server 端注册 tcpip_forward
    let bound_port = conn
        .tcpip_forward(&bind_address, bind_port_req as u32)
        .await
        .map_err(|e| format!("服务端拒绝 tcpip_forward: {}", e))?;
    let bind_port = bound_port as u32;

    // 注册入站通道分发器
    let (tx, mut rx) = mpsc::channel::<russh::Channel<Msg>>(16);
    {
        let key = (spec.server_id.clone(), bind_address.clone(), bind_port);
        remote_forward_rx().lock().await.insert(key, tx);
    }

    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_for_task = cancel.clone();
    let conn_for_task = conn.clone();
    let local_host = spec.local_host.clone();
    let local_port = spec.local_port;
    let sid = spec.server_id.clone();
    let fid = forward_id.clone();
    // 保留一份用于 ForwardEntry.remote_bind（不能 move 进 task）
    let bind_address_for_entry = bind_address.clone();
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_FORWARD_CHANNELS));
    let semaphore_for_task = semaphore.clone();

    let task = tokio::spawn(async move {
        loop {
            if cancel_for_task.load(Ordering::Relaxed) {
                break;
            }
            // 从分发器接收 server 推过来的 channel
            let channel = tokio::select! {
                c = rx.recv() => match c {
                    Some(c) => c,
                    None => break, // 分发器被关闭（转发已停止）
                },
                _ = tokio::time::sleep(Duration::from_millis(500)) => {
                    continue;
                }
            };

            let permit = match semaphore_for_task.clone().try_acquire_owned() {
                Ok(p) => p,
                Err(_) => {
                    eprintln!(
                        "[PortForward] {} remote forward 达到并发通道上限 ({}), 丢弃新入站通道",
                        fid, MAX_CONCURRENT_FORWARD_CHANNELS
                    );
                    drop(channel);
                    continue;
                }
            };

            // 连接到本地服务
            let lh = local_host.clone();
            let lp = local_port;
            let cancel_c = cancel_for_task.clone();
            let conn_c = conn_for_task.clone();
            let fid_t = fid.clone();
            let sid_t = sid.clone();
            tokio::spawn(async move {
                let _permit = permit;
                let tcp = match tokio::time::timeout(
                    Duration::from_secs(5),
                    TcpStream::connect(&format!("{}:{}", lh, lp)),
                )
                .await
                {
                    Ok(Ok(s)) => s,
                    Ok(Err(e)) => {
                        eprintln!(
                            "[PortForward] {} connect local {}:{} 失败 ({}): {}",
                            fid_t, lh, lp, sid_t, e
                        );
                        // 通道关闭，server 端会清理
                        return;
                    }
                    Err(_) => {
                        eprintln!(
                            "[PortForward] {} connect local {}:{} 超时 ({})",
                            fid_t, lh, lp, sid_t
                        );
                        return;
                    }
                };

                // 发送 incoming connection 通知给 server：不需要再调用任何方法，
                // channel 已就绪，开始双向 pipe
                pipe_tcp_with_channel(tcp, channel, cancel_c).await;
                let _ = conn_c;
            });
        }
    });

    let mut map = forwards().lock().await;
    map.insert(
        forward_id,
        ForwardEntry {
            spec,
            state: ForwardState::Active,
            bound_port: bound_port as u16,
            cancel,
            task: Some(task),
            remote_bind: Some((bind_address_for_entry, bind_port)),
            created_at: now_ms(),
            last_error: None,
        },
    );
    Ok(())
}

// ============================================================================
// Dynamic SOCKS5 Forward 实现
// ============================================================================

async fn start_dynamic_forward(
    forward_id: String,
    spec: ForwardSpec,
    conn: Arc<super::connection::SshConnection>,
) -> Result<(), String> {
    let bind_addr = format!("{}:{}", spec.local_host, spec.local_port);
    let listener = TcpListener::bind(&bind_addr)
        .await
        .map_err(|e| format!("无法监听 {}: {}", bind_addr, e))?;
    let bound_port = listener
        .local_addr()
        .map_err(|e| format!("无法获取监听地址: {}", e))?
        .port();

    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_for_task = cancel.clone();
    let conn_for_task = conn.clone();
    let sid = spec.server_id.clone();
    let fid = forward_id.clone();
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_FORWARD_CHANNELS));
    let semaphore_for_task = semaphore.clone();

    let task = tokio::spawn(async move {
        loop {
            if cancel_for_task.load(Ordering::Relaxed) {
                break;
            }
            let accept_res = tokio::select! {
                r = listener.accept() => r,
                _ = tokio::time::sleep(Duration::from_millis(500)) => {
                    continue;
                }
            };
            let (mut tcp, peer_addr) = match accept_res {
                Ok(v) => v,
                Err(e) => {
                    eprintln!(
                        "[PortForward] {} dynamic accept 失败 ({}): {}",
                        fid, sid, e
                    );
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    continue;
                }
            };

            let permit = match semaphore_for_task.clone().try_acquire_owned() {
                Ok(p) => p,
                Err(_) => {
                    eprintln!(
                        "[PortForward] {} dynamic forward 达到并发连接上限 ({}), 拒绝新连接",
                        fid, MAX_CONCURRENT_FORWARD_CHANNELS
                    );
                    drop(tcp);
                    continue;
                }
            };

            let conn_c = conn_for_task.clone();
            let cancel_c = cancel_for_task.clone();
            let fid_t = fid.clone();
            tokio::spawn(async move {
                let _permit = permit;
                // SOCKS5 握手
                let target = match socks5_handshake(&mut tcp, &peer_addr).await {
                    Ok(t) => t,
                    Err(e) => {
                        eprintln!("[PortForward] {} SOCKS5 握手失败: {}", fid_t, e);
                        return;
                    }
                };

                // 开启 SSH direct-tcpip 通道
                let originator_host = peer_addr.ip().to_string();
                let originator_port = peer_addr.port() as u32;
                let channel = match conn_c
                    .open_direct_tcpip(
                        target.host.clone(),
                        target.port as u32,
                        originator_host,
                        originator_port,
                    )
                    .await
                {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!(
                            "[PortForward] {} open_direct_tcpip 失败 ({}:{}): {}",
                            fid_t, target.host, target.port, e
                        );
                        // 通知 SOCKS5 客户端连接失败
                        let _ = tcp.write_all(&[0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
                        return;
                    }
                };

                pipe_tcp_with_channel(tcp, channel, cancel_c).await;
            });
        }
    });

    let mut map = forwards().lock().await;
    map.insert(
        forward_id,
        ForwardEntry {
            spec,
            state: ForwardState::Active,
            bound_port,
            cancel,
            task: Some(task),
            remote_bind: None,
            created_at: now_ms(),
            last_error: None,
        },
    );
    Ok(())
}

// ============================================================================
// SOCKS5 握手
// ============================================================================

struct SocksTarget {
    host: String,
    port: u16,
}

/// 解析 SOCKS5 握手，返回目标 host:port
///
/// 协议：
/// 1. 客户端发送：VER(1) NMETHODS(1) METHODS(NMETHODS)
/// 2. 服务端回复：VER(1) METHOD(1)（0x00 表示无需认证）
/// 3. 客户端发送请求：VER(1) CMD(1) RSV(1) ATYP(1) DST.ADDR(var) DST.PORT(2)
///    - CMD=0x01 CONNECT，其他不支持
///    - ATYP: 0x01=IPv4, 0x03=domain, 0x04=IPv6
/// 4. 服务端回复：VER(1) REP(1) RSV(1) ATYP(1) BND.ADDR(var) BND.PORT(2)
async fn socks5_handshake(tcp: &mut TcpStream, peer: &std::net::SocketAddr) -> Result<SocksTarget, String> {
    // 1. 方法协商
    let mut buf = [0u8; 2];
    tcp.read_exact(&mut buf).await.map_err(|e| format!("read VER/NMETHODS: {}", e))?;
    if buf[0] != 0x05 {
        return Err(format!("invalid SOCKS version: {}", buf[0]));
    }
    let nmethods = buf[1] as usize;
    let mut methods = vec![0u8; nmethods];
    tcp.read_exact(&mut methods).await.map_err(|e| format!("read METHODS: {}", e))?;
    // 仅支持无认证（0x00）
    if !methods.contains(&0x00) {
        // 拒绝
        let _ = tcp.write_all(&[0x05, 0xFF]).await;
        return Err("客户端仅支持需认证的方法".to_string());
    }
    tcp.write_all(&[0x05, 0x00]).await.map_err(|e| format!("write METHOD reply: {}", e))?;

    // 2. 请求
    let mut header = [0u8; 4];
    tcp.read_exact(&mut header).await.map_err(|e| format!("read REQ header: {}", e))?;
    if header[0] != 0x05 {
        return Err(format!("invalid SOCKS version in request: {}", header[0]));
    }
    if header[1] != 0x01 {
        // 仅支持 CONNECT
        let _ = tcp.write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
        return Err(format!("不支持的 CMD: {}", header[1]));
    }
    let atyp = header[3];
    let host = match atyp {
        0x01 => {
            // IPv4
            let mut ip = [0u8; 4];
            tcp.read_exact(&mut ip).await.map_err(|e| format!("read IPv4: {}", e))?;
            std::net::Ipv4Addr::from(ip).to_string()
        }
        0x03 => {
            // Domain
            let mut len_buf = [0u8; 1];
            tcp.read_exact(&mut len_buf).await.map_err(|e| format!("read domain len: {}", e))?;
            let len = len_buf[0] as usize;
            let mut domain = vec![0u8; len];
            tcp.read_exact(&mut domain).await.map_err(|e| format!("read domain: {}", e))?;
            String::from_utf8(domain).map_err(|e| format!("invalid domain UTF-8: {}", e))?
        }
        0x04 => {
            // IPv6
            let mut ip = [0u8; 16];
            tcp.read_exact(&mut ip).await.map_err(|e| format!("read IPv6: {}", e))?;
            std::net::Ipv6Addr::from(ip).to_string()
        }
        _ => {
            let _ = tcp.write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
            return Err(format!("不支持的 ATYP: {}", atyp));
        }
    };
    let mut port_buf = [0u8; 2];
    tcp.read_exact(&mut port_buf).await.map_err(|e| format!("read port: {}", e))?;
    let port = u16::from_be_bytes(port_buf);

    // 3. 回复成功
    // BND.ADDR 使用 peer 的地址（仅做形式回复）
    let (bnd_atyp, bnd_addr): (u8, Vec<u8>) = match peer.ip() {
        std::net::IpAddr::V4(v4) => (0x01, v4.octets().to_vec()),
        std::net::IpAddr::V6(v6) => (0x04, v6.octets().to_vec()),
    };
    let bnd_port = peer.port().to_be_bytes();
    let mut reply = vec![0x05, 0x00, 0x00, bnd_atyp];
    reply.extend_from_slice(&bnd_addr);
    reply.extend_from_slice(&bnd_port);
    tcp.write_all(&reply).await.map_err(|e| format!("write reply: {}", e))?;

    Ok(SocksTarget { host, port })
}

// ============================================================================
// 双向 pipe
// ============================================================================

/// 在 TCP 流和 SSH Channel 之间双向转发数据，直到任一方关闭或取消信号置位。
async fn pipe_tcp_with_channel(
    mut tcp: TcpStream,
    mut channel: russh::Channel<Msg>,
    cancel: Arc<AtomicBool>,
) {
    loop {
        if cancel.load(Ordering::Relaxed) {
            break;
        }

        // 读 TCP 数据，写 SSH channel
        let mut buf = [0u8; 32 * 1024];
        tokio::select! {
            r = tcp.read(&mut buf) => {
                match r {
                    Ok(0) => break, // TCP closed
                    Ok(n) => {
                        if channel.data(&buf[..n]).await.is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        if tcp.write_all(&data).await.is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(100)) => {
                // 周期性检查取消信号
            }
        }
    }
    // 优雅关闭
    let _ = channel.eof().await;
    let _ = tcp.shutdown().await;
}
