use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use russh::keys::key::PublicKey;
use russh::{ChannelMsg};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;
use thiserror::Error;

use std::time::Duration;

/// 镜像 save/load 空闲超时（秒）：连续该秒数无任何通道消息（含数据）即判定卡死。
/// 每次收到消息会自动重置计时，故慢速跨公网持续传输不会误杀，传完即结束。
/// 60s 远大于 docker save/load 正常层间停顿，避免误杀。
const IDLE_TIMEOUT_SECS: u64 = 60;
/// 空闲超时的 Duration 形式。
const IDLE_TIMEOUT: Duration = Duration::from_secs(IDLE_TIMEOUT_SECS);
/// 外层绝对上限兜底（秒）：固定 6h，防极端异常或资源泄漏导致永久挂起。
const TRANSFER_ABSOLUTE_TIMEOUT_SECS: u64 = 6 * 3600;

use super::agent::{AgentConnection, AgentSigner};
use super::keys::{load_key_pair, load_key_pair_from_content};

/// 校验并规范化本地私钥文件路径，防止路径遍历与注入攻击。
///
/// 安全检查：
/// 1. 拒绝 null 字节与控制字符（防止底层 C 函数截断/解析异常）
/// 2. 拒绝命令替换模式（`$(`、反引号）与 shell 元字符（`;|&` 等），防止路径被误用于日志/命令拼接
/// 3. 调用 `canonicalize` 解析 `..`、符号链接，得到真实绝对路径
/// 4. 确认目标为普通文件（拒绝指向设备文件/目录等异常类型）
///
/// 返回规范化后的安全路径；错误信息中不含原始路径，避免泄露（P1-5）。
fn validate_and_canonicalize_key_path(raw_path: &str) -> Result<PathBuf, SshError> {
    if raw_path.is_empty() {
        return Err(SshError::AuthFailed("Private key path is empty".into()));
    }

    // 1. null 字节 / 控制字符
    if raw_path.contains('\0') {
        return Err(SshError::AuthFailed("Invalid private key path: contains null byte".into()));
    }
    if raw_path.chars().any(|c| c.is_control() && c != '\t') {
        return Err(SshError::AuthFailed("Invalid private key path: contains control characters".into()));
    }

    // 2. 命令替换 / shell 元字符（defense-in-depth，防止路径进入日志或命令拼接时被利用）
    if raw_path.contains("$(") || raw_path.contains('`') {
        return Err(SshError::AuthFailed("Invalid private key path: contains command substitution pattern".into()));
    }
    for &bad in &[';', '|', '&', '\n', '\r'] {
        if raw_path.contains(bad) {
            return Err(SshError::AuthFailed("Invalid private key path: contains shell metacharacter".into()));
        }
    }

    // 3. 规范化：解析 `..`、符号链接，防止路径遍历到敏感系统文件
    let canonical = std::fs::canonicalize(raw_path).map_err(|_| {
        SshError::AuthFailed("Private key file not found or path cannot be resolved".into())
    })?;

    // 4. 确认为普通文件（防止指向 /dev/*、命名管道等异常文件类型）
    let metadata = std::fs::metadata(&canonical).map_err(|_| {
        SshError::AuthFailed("Cannot read private key file metadata".into())
    })?;
    if !metadata.is_file() {
        return Err(SshError::AuthFailed("Private key path does not point to a regular file".into()));
    }

    Ok(canonical)
}

#[derive(Debug, Error)]
pub enum SshError {
    #[error("SSH connection failed: {0}")]
    ConnectionFailed(String),
    #[error("SSH authentication failed: {0}")]
    AuthFailed(String),
    #[error("Not connected to server: {0}")]
    NotConnected(String),
    #[error("Connection lost to server: {0}")]
    ConnectionLost(String),
    #[error("Command timed out after {0}s")]
    CommandTimeout(u64),
    #[error("Command execution failed: {0}")]
    ExecutionFailed(String),
    #[error("Channel open failure: {0}")]
    ChannelOpenFailed(String),
    #[error("SFTP session failed: {0}")]
    SftpFailed(String),
    #[error("Shell creation failed: {0}")]
    ShellFailed(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("SSH error: {0}")]
    Ssh(#[from] russh::Error),
    #[error("Host key verification failed: {0}")]
    HostKeyVerificationFailed(String),
    /// 用户主动取消（镜像导出/导入等长时间传输）
    #[error("Command cancelled: {0}")]
    CommandCancelled(String),
    /// russh::SendError 转换：Signer trait 要求 Error: From<SendError>
    #[error("SSH send error")]
    Send(#[from] russh::SendError),
}

pub type SshResult<T> = Result<T, SshError>;

#[derive(Debug, Clone)]
pub struct CommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Bound memory used while collecting output from one-shot remote commands.
/// Commands such as `journalctl` or a noisy diagnostic must not be able to
/// grow a desktop process indefinitely.
const MAX_COMMAND_OUTPUT_BYTES: usize = 8 * 1024 * 1024;

fn append_limited_output(buffer: &mut Vec<u8>, data: &[u8], truncated: &mut bool) {
    if buffer.len() >= MAX_COMMAND_OUTPUT_BYTES {
        *truncated = true;
        return;
    }
    let remaining = MAX_COMMAND_OUTPUT_BYTES - buffer.len();
    let take = remaining.min(data.len());
    buffer.extend_from_slice(&data[..take]);
    if take < data.len() {
        *truncated = true;
    }
}

fn format_output(buffer: Vec<u8>, truncated: bool) -> String {
    let mut output = String::from_utf8_lossy(&buffer).into_owned();
    if truncated {
        output.push_str("\n[output truncated at 8 MiB]");
    }
    output
}

/// Validate the certificate properties that are independent of the server's
/// CA trust configuration. The server still performs the authoritative CA
/// signature and policy checks during SSH authentication.
fn validate_user_certificate_properties(
    is_user_certificate: bool,
    valid_after: u64,
    valid_before: u64,
    principals: &[String],
    username: &str,
) -> Result<(), SshError> {
    if !is_user_certificate {
        return Err(SshError::AuthFailed(
            "OpenSSH 证书类型不是用户证书，不能用于用户登录".into(),
        ));
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| SshError::AuthFailed("无法读取本机系统时间，不能验证证书有效期".into()))?
        .as_secs();
    if now < valid_after || now >= valid_before {
        return Err(SshError::AuthFailed(format!(
            "OpenSSH 证书已不在有效期内（当前时间不在 {} - {} 范围内）",
            valid_after,
            valid_before
        )));
    }

    if !principals.is_empty() && !principals.iter().any(|principal| principal == username) {
        return Err(SshError::AuthFailed(format!(
            "OpenSSH 证书不允许用户 {} 登录（principal 不匹配）",
            username
        )));
    }
    Ok(())
}

/// Authentication method
///
/// 对齐 Termius / MobaXterm / SecureCRT 的认证能力：
/// - `Password`: 密码认证
/// - `PrivateKey`: 私钥文件认证（支持 OpenSSH/PEM/PPK 格式）
/// - `SshAgent`: SSH Agent 认证（Unix ssh-agent / Windows Pageant）
/// - `Certificate`: OpenSSH 证书认证（私钥 + CA 签名的证书）
#[derive(Clone)]
pub enum AuthMethod {
    Password { password: String },
    PrivateKey { private_key_path: String, private_key_passphrase: Option<String> },
    /// SSH Agent 认证：使用系统 agent（Pageant/ssh-agent）中已加载的密钥
    ///
    /// `identity` 为 None 时使用 agent 返回的第一个身份（适合单密钥场景）；
    /// 指定具体公钥时用于多密钥场景选择特定身份。
    SshAgent { identity: Option<PublicKey> },
    /// OpenSSH 证书认证：私钥 + 证书（CA 签名）
    ///
    /// `private_key_path` 是与证书配对的私钥文件路径
    /// `certificate_path` 是 OpenSSH 证书文件路径（`-cert.pub`）
    Certificate {
        private_key_path: String,
        certificate_path: String,
        private_key_passphrase: Option<String>,
    },
    /// content-based 私钥认证（阶段 3）：私钥内容直接来自 `ssh_keys` 表解密结果，
    /// 不依赖文件路径。源文件被删除后仍可连接。
    PrivateKeyContent {
        private_key_content: String,
        private_key_passphrase: Option<String>,
    },
    /// content-based 证书认证（阶段 3）：私钥与证书内容均来自 `ssh_keys` 表。
    CertificateContent {
        private_key_content: String,
        certificate_content: String,
        private_key_passphrase: Option<String>,
    },
}

/// russh client handler that verifies server host keys against SQLite database.
///
/// 字段说明：
/// - `host` / `port`：用于 known_hosts 校验
/// - `server_id`：用于 Remote 端口转发时把入站 channel 路由到对应的消费任务
#[derive(Clone)]
struct ClientHandler {
    host: String,
    port: u16,
    server_id: String,
    banner: Arc<std::sync::Mutex<Option<String>>>,
}

#[async_trait]
impl russh::client::Handler for ClientHandler {
    type Error = SshError;

    /// 接收服务端在认证阶段发送的欢迎词（SSH_MSG_USERAUTH_BANNER，RFC 4252 Section 5.4）
    async fn auth_banner(
        &mut self,
        banner: &str,
        _session: &mut russh::client::Session,
    ) -> Result<(), Self::Error> {
        if let Ok(mut b) = self.banner.lock() {
            match b.as_mut() {
                Some(existing) => existing.push_str(banner),
                None => *b = Some(banner.to_string()),
            }
        }
        Ok(())
    }

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        use russh_keys::PublicKeyBase64;

        let key_type = server_public_key.name();
        let key_value = server_public_key.public_key_base64();

        match crate::db::check_known_host(&self.host, self.port as i32, key_type, &key_value) {
            Ok(crate::db::KnownHostVerifyResult::Match) => Ok(true),
            Ok(crate::db::KnownHostVerifyResult::Mismatch) => {
                Err(SshError::HostKeyVerificationFailed(format!(
                    "Host key for {}:{} has changed or uses a new key type — possible man-in-the-middle attack. \
                     If this is expected (e.g. server key rotation), call 'ssh_reset_known_host' to clear the old fingerprint and retry.",
                    self.host, self.port
                )))
            }
            Ok(crate::db::KnownHostVerifyResult::NotFound) => {
                // Trust on first use (TOFU) - Save to SQLite
                crate::db::save_known_host(&self.host, self.port as i32, key_type, &key_value)
                    .map_err(|e| SshError::HostKeyVerificationFailed(format!("Failed to record host key in DB: {}", e)))?;
                Ok(true)
            }
            Err(e) => {
                Err(SshError::HostKeyVerificationFailed(format!("Database error during host key check: {}", e)))
            }
        }
    }

    /// 服务器推送了一条 Remote 端口转发的入站连接。
    /// 转发给 port_forward 模块的分发器，由它路由到对应的消费任务。
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: russh::Channel<russh::client::Msg>,
        connected_address: &str,
        connected_port: u32,
        originator_address: &str,
        originator_port: u32,
        _session: &mut russh::client::Session,
    ) -> Result<(), Self::Error> {
        let dispatched = crate::ssh::port_forward::dispatch_forwarded_channel(
            &self.server_id,
            connected_address,
            connected_port,
            channel,
        )
        .await;
        if !dispatched {
            eprintln!(
                "[SSH] 未找到转发消费任务：server={}, bind={}:{}, originator={}:{}",
                self.server_id, connected_address, connected_port,
                originator_address, originator_port
            );
        }
        Ok(())
    }
}

// ============================================================================
// Transport：底层 TCP + SSH 握手 + 认证
// ============================================================================
//
// 将原 `SshConnection` 拆分为多个职责清晰的子模块，避免单对象过胖。
// `SshTransport` 仅负责建立并持有底层 `russh::client::Handle`，
// 业务能力通过 `ExecManager` / `FileManager` 等结构基于 transport 提供。
//
// 旧 API（`SshConnection::execute` / `create_shell_channel` / `create_sftp_session`）
// 通过 `SshConnection`（一个组合 facade）继续保留，对外不破坏调用方代码。

/// 底层 SSH 传输层：持有 russh handle，提供 channel 申请。
///
/// `handle` 包在 `tokio::sync::Mutex` 中：russh 的 `tcpip_forward` 要求 `&mut self`，
/// 而连接通过 `Arc<SshConnection>` 共享，必须用内部可变性。
/// 锁的持有时间极短（仅 channel_open / tcpip_forward 等握手消息），不影响并发数据传输。
pub struct SshTransport {
    handle: tokio::sync::Mutex<russh::client::Handle<ClientHandler>>,
    server_id: String,
    host: String,
    port: u16,
    banner: Arc<std::sync::Mutex<Option<String>>>,
}

// ============================================================================
// 跳板机配置（ProxyJump）
// ============================================================================

/// 链式跳板机单跳已解析配置
#[derive(Clone)]
pub struct ResolvedJumpHop {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
    pub timeout_secs: u32,
}

/// 跳板机配置：目标主机如何通过跳板机到达
///
/// 跳板机自己的认证方式与普通 SSH 一致（密码/私钥/Agent/证书）。
pub struct JumpConfig<'a> {
    /// 跳板机 host
    pub host: &'a str,
    /// 跳板机端口
    pub port: u16,
    /// 跳板机用户名
    pub username: &'a str,
    /// 跳板机认证方式
    pub auth: &'a AuthMethod,
    /// 跳板机连接超时（秒）
    pub timeout_secs: u32,
}

/// SOCKS5 / HTTP 代理传输配置（用于 SSH 外连经代理建立 TCP 隧道）。
/// 与 `JumpConfig`（SSH 跳板机）互斥：代理只做 TCP 层隧道，不做 SSH 认证。
pub struct ProxyTransportConfig {
    /// 代理类型：`socks5` | `http`
    pub proxy_type: String,
    /// 代理服务器地址
    pub host: String,
    /// 代理服务器端口
    pub port: u16,
    /// 代理认证用户名（可选）
    pub username: Option<String>,
    /// 代理认证密码（可选）
    pub password: Option<String>,
    /// 代理连接超时（秒）
    pub timeout_secs: u32,
}

/// AsyncRead + AsyncWrite 的合集 trait（russh connect_stream 接受满足这两个 trait 的类型）
/// 因为 Rust 不允许多个非 auto trait 组成 trait object，必须用 supertrait 包装
pub trait AsyncReadWrite: tokio::io::AsyncRead + tokio::io::AsyncWrite + Send {}
impl<T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Send> AsyncReadWrite for T {}

pub struct ChainedJumpStream {
    stream: russh::ChannelStream<russh::client::Msg>,
    _jump_handles: Vec<russh::client::Handle<ClientHandler>>,
}

impl tokio::io::AsyncRead for ChainedJumpStream {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.stream).poll_read(cx, buf)
    }
}

impl tokio::io::AsyncWrite for ChainedJumpStream {
    fn poll_write(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        std::pin::Pin::new(&mut self.stream).poll_write(cx, buf)
    }

    fn poll_flush(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.stream).poll_flush(cx)
    }

    fn poll_shutdown(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}
use std::pin::Pin;

/// 通过多级跳板机链路建立到 (target_host, target_port) 的 TCP 隧道
///
/// 实现步骤：
/// 1. TCP 连接第一级跳板机，完成握手与认证；
/// 2. 依次在第 i 级跳板机通道内 direct_tcpip 打开第 i+1 级跳板机，在其上完成握手与认证；
/// 3. 在最后一级跳板机通道内 direct_tcpip 连接目标 (host, port)；
/// 4. 返回包装了全部中间 Handle 的 ChainedJumpStream，当外层断开时 RAII 自动逆序释放全部跳板连接。
pub async fn connect_via_chained_jump(
    _config: &russh::client::Config,
    target_host: &str,
    target_port: u16,
    deadline: &std::time::Instant,
    hops: &[ResolvedJumpHop],
) -> SshResult<Pin<Box<dyn AsyncReadWrite + Send>>> {
    if hops.is_empty() {
        return Err(SshError::ConnectionFailed("跳板链不能为空".into()));
    }

    let mut jump_handles = Vec::with_capacity(hops.len());

    let jump_config = Arc::new(russh::client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(Duration::from_secs(15)),
        keepalive_max: 4,
        window_size: 4 * 1024 * 1024,
        maximum_packet_size: 65535,
        ..Default::default()
    });

    // 1. 第一跳：本地 TCP 直连到 hops[0]
    let hop0 = &hops[0];
    let hop0_addr = format!("{}:{}", hop0.host, hop0.port);
    let tcp_timeout = deadline.saturating_duration_since(std::time::Instant::now());
    let socket = timeout(tcp_timeout, TcpStream::connect(&hop0_addr))
        .await
        .map_err(|_| SshError::ConnectionFailed(format!("第 1 级跳板机 TCP 连接超时: {}", hop0_addr)))?
        .map_err(|e| SshError::ConnectionFailed(format!("第 1 级跳板机 TCP 连接失败: {}", e)))?;
    socket.set_nodelay(true).ok();

    let handshake_timeout = deadline.saturating_duration_since(std::time::Instant::now());
    let mut handle_0 = timeout(
        handshake_timeout,
        russh::client::connect_stream(
            jump_config.clone(),
            socket,
            ClientHandler {
                host: hop0.host.clone(),
                port: hop0.port,
                server_id: String::new(),
                banner: Arc::new(std::sync::Mutex::new(None)),
            },
        ),
    )
    .await
    .map_err(|_| SshError::ConnectionFailed("第 1 级跳板机 SSH 握手超时".into()))?
    .map_err(|e| SshError::ConnectionFailed(format!("第 1 级跳板机 SSH 握手失败: {}", e)))?;

    let auth_timeout = deadline.saturating_duration_since(std::time::Instant::now());
    let auth_res = timeout(
        auth_timeout,
        SshTransport::authenticate(&mut handle_0, &hop0.username, &hop0.auth),
    )
    .await;
    match auth_res {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err(SshError::AuthFailed("第 1 级跳板机认证超时".into())),
    }
    jump_handles.push(handle_0);

    // 2. 中间跳：在上一跳 channel 内 open_direct_tcpip 穿透并在其上握手
    for (i, hop) in hops.iter().enumerate().skip(1) {
        let channel_timeout = deadline.saturating_duration_since(std::time::Instant::now());
        let prev_handle = jump_handles
            .last_mut()
            .ok_or_else(|| SshError::ConnectionFailed("跳板机句柄列表为空".into()))?;
        let channel = timeout(
            channel_timeout,
            prev_handle.channel_open_direct_tcpip(
                hop.host.clone(),
                hop.port as u32,
                "127.0.0.1".to_string(),
                0,
            ),
        )
        .await
        .map_err(|_| SshError::ConnectionFailed(format!("第 {} 级跳板机通道开启超时 ({}:{})", i + 1, hop.host, hop.port)))?
        .map_err(|e| SshError::ConnectionFailed(format!("第 {} 级跳板机通道开启失败: {}", i + 1, e)))?;

        let stream = channel.into_stream();
        let handshake_timeout = deadline.saturating_duration_since(std::time::Instant::now());
        let mut handle_i = timeout(
            handshake_timeout,
            russh::client::connect_stream(
                jump_config.clone(),
                stream,
                ClientHandler {
                    host: hop.host.clone(),
                    port: hop.port,
                    server_id: String::new(),
                    banner: Arc::new(std::sync::Mutex::new(None)),
                },
            ),
        )
        .await
        .map_err(|_| SshError::ConnectionFailed(format!("第 {} 级跳板机 SSH 握手超时", i + 1)))?
        .map_err(|e| SshError::ConnectionFailed(format!("第 {} 级跳板机 SSH 握手失败: {}", i + 1, e)))?;

        let auth_timeout = deadline.saturating_duration_since(std::time::Instant::now());
        let auth_res = timeout(
            auth_timeout,
            SshTransport::authenticate(&mut handle_i, &hop.username, &hop.auth),
        )
        .await;
        match auth_res {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(e),
            Err(_) => return Err(SshError::AuthFailed(format!("第 {} 级跳板机认证超时", i + 1))),
        }
        jump_handles.push(handle_i);
    }

    // 3. 最后一跳：通过最后一个跳板机的 direct_tcpip 通道连接目标主机
    let last_handle = jump_handles
        .last_mut()
        .ok_or_else(|| SshError::ConnectionFailed("跳板机句柄列表为空".into()))?;
    let channel_timeout = deadline.saturating_duration_since(std::time::Instant::now());
    let target_channel = timeout(
        channel_timeout,
        last_handle.channel_open_direct_tcpip(
            target_host.to_string(),
            target_port as u32,
            "127.0.0.1".to_string(),
            0,
        ),
    )
    .await
    .map_err(|_| SshError::ConnectionFailed(format!("跳板机 → 目标主机 direct_tcpip 超时: {}:{}", target_host, target_port)))?
    .map_err(|e| SshError::ConnectionFailed(format!("跳板机 → 目标主机通道开启失败: {}", e)))?;

    let stream = target_channel.into_stream();

    Ok(Box::pin(ChainedJumpStream {
        stream,
        _jump_handles: jump_handles,
    }))
}

/// 通过单跳跳板机建立到 (target_host, target_port) 的 TCP 隧道（向下兼容 JumpConfig）
async fn connect_via_jump(
    config: &russh::client::Config,
    target_host: &str,
    target_port: u16,
    deadline: &std::time::Instant,
    jump: JumpConfig<'_>,
) -> SshResult<Pin<Box<dyn AsyncReadWrite + Send>>> {
    let hop = ResolvedJumpHop {
        host: jump.host.to_string(),
        port: jump.port,
        username: jump.username.to_string(),
        auth: jump.auth.clone(),
        timeout_secs: jump.timeout_secs,
    };
    connect_via_chained_jump(config, target_host, target_port, deadline, &[hop]).await
}

/// 通过 SOCKS5 / HTTP 代理建立到 (target_host, target_port) 的 TCP 隧道
///
/// 实现步骤：
/// 1. TCP 连接到代理服务器
/// 2. 按代理协议完成握手（SOCKS5 CONNECT / HTTP CONNECT），建立到目标的隧道
/// 3. 返回该 TCP 流（已实现 AsyncRead + AsyncWrite），可喂给 russh 完成 SSH 握手
async fn connect_via_proxy(
    target_host: &str,
    target_port: u16,
    deadline: &std::time::Instant,
    proxy: &ProxyTransportConfig,
) -> SshResult<Pin<Box<dyn AsyncReadWrite + Send>>> {
    // 1. TCP 到代理服务器
    let proxy_addr = format!("{}:{}", proxy.host, proxy.port);
    let tcp_timeout = deadline.saturating_duration_since(std::time::Instant::now());
    let mut socket = timeout(tcp_timeout, TcpStream::connect(&proxy_addr))
        .await
        .map_err(|_| SshError::ConnectionFailed(format!("代理 TCP 连接超时: {}", proxy_addr)))?
        .map_err(|e| SshError::ConnectionFailed(format!("代理 TCP 连接失败: {}", e)))?;
    socket.set_nodelay(true).ok();

    // 2. 按代理类型完成握手
    let handshake_timeout = deadline.saturating_duration_since(std::time::Instant::now());
    let handshake_result = timeout(handshake_timeout, async {
        match proxy.proxy_type.as_str() {
            "socks5" => {
                socks5_connect(&mut socket, target_host, target_port, &proxy.username, &proxy.password).await
            }
            _ => {
                http_connect(&mut socket, target_host, target_port, &proxy.username, &proxy.password).await
            }
        }
    })
    .await;

    match handshake_result {
        Ok(Ok(())) => Ok(Box::pin(socket)),
        Ok(Err(e)) => Err(SshError::ConnectionFailed(format!("代理握手失败: {}", e))),
        Err(_) => Err(SshError::ConnectionFailed("代理握手超时".into())),
    }
}

/// SOCKS5 客户端握手（CONNECT 模式，支持无认证 / 用户名密码认证 RFC 1929）
async fn socks5_connect(
    tcp: &mut TcpStream,
    target_host: &str,
    target_port: u16,
    username: &Option<String>,
    password: &Option<String>,
) -> Result<(), String> {
    // 1. 方法协商
    let need_auth = username.as_ref().map(|u| !u.is_empty()).unwrap_or(false);
    let methods: Vec<u8> = if need_auth { vec![0x02, 0x00] } else { vec![0x00] };
    tcp.write_all(&[0x05, methods.len() as u8])
        .await.map_err(|e| format!("write greeting: {}", e))?;
    tcp.write_all(&methods).await.map_err(|e| format!("write methods: {}", e))?;
    let mut method_reply = [0u8; 2];
    tcp.read_exact(&mut method_reply).await.map_err(|e| format!("read method reply: {}", e))?;
    if method_reply[0] != 0x05 {
        return Err(format!("非法 SOCKS 版本: {}", method_reply[0]));
    }
    match method_reply[1] {
        0x00 => {}
        0x02 => {
            // 用户名/密码认证（RFC 1929）
            let user = username.clone().unwrap_or_default();
            let pass = password.clone().unwrap_or_default();
            if user.len() > 255 || pass.len() > 255 {
                return Err("SOCKS5 用户名/密码长度不能超过 255".to_string());
            }
            let mut auth_req = vec![0x01, user.len() as u8];
            auth_req.extend_from_slice(user.as_bytes());
            auth_req.push(pass.len() as u8);
            auth_req.extend_from_slice(pass.as_bytes());
            tcp.write_all(&auth_req).await.map_err(|e| format!("write auth: {}", e))?;
            let mut auth_reply = [0u8; 2];
            tcp.read_exact(&mut auth_reply).await.map_err(|e| format!("read auth reply: {}", e))?;
            if auth_reply[1] != 0x00 {
                return Err(format!("SOCKS5 认证失败 (status {})", auth_reply[1]));
            }
        }
        m => return Err(format!("代理拒绝支持的认证方法: {}", m)),
    }

    // 2. CONNECT 请求
    let mut req = vec![0x05, 0x01, 0x00];
    if let Ok(ip) = target_host.parse::<std::net::Ipv4Addr>() {
        req.push(0x01);
        req.extend_from_slice(&ip.octets());
    } else if let Ok(ip) = target_host.parse::<std::net::Ipv6Addr>() {
        req.push(0x04);
        req.extend_from_slice(&ip.octets());
    } else {
        let host_bytes = target_host.as_bytes();
        if host_bytes.len() > 255 {
            return Err("目标主机名过长".to_string());
        }
        req.push(0x03);
        req.push(host_bytes.len() as u8);
        req.extend_from_slice(host_bytes);
    }
    req.extend_from_slice(&target_port.to_be_bytes());
    tcp.write_all(&req).await.map_err(|e| format!("write CONNECT: {}", e))?;

    // 3. 读取响应
    let mut header = [0u8; 4];
    tcp.read_exact(&mut header).await.map_err(|e| format!("read reply header: {}", e))?;
    if header[0] != 0x05 {
        return Err(format!("非法 SOCKS 版本（响应）: {}", header[0]));
    }
    if header[1] != 0x00 {
        return Err(format!("SOCKS5 CONNECT 失败 (code {})", header[1]));
    }
    // 跳过 BND.ADDR / BND.PORT
    match header[3] {
        0x01 => {
            let mut b = [0u8; 4];
            tcp.read_exact(&mut b).await.map_err(|e| format!("read bnd v4: {}", e))?;
        }
        0x03 => {
            let mut l = [0u8; 1];
            tcp.read_exact(&mut l).await.map_err(|e| format!("read bnd len: {}", e))?;
            let mut b = vec![0u8; l[0] as usize];
            tcp.read_exact(&mut b).await.map_err(|e| format!("read bnd domain: {}", e))?;
        }
        0x04 => {
            let mut b = [0u8; 16];
            tcp.read_exact(&mut b).await.map_err(|e| format!("read bnd v6: {}", e))?;
        }
        _ => return Err(format!("非法 BND.ATYP: {}", header[3])),
    }
    let mut port_buf = [0u8; 2];
    tcp.read_exact(&mut port_buf).await.map_err(|e| format!("read bnd port: {}", e))?;

    Ok(())
}

/// HTTP CONNECT 代理握手（支持 Basic 认证）
async fn http_connect(
    tcp: &mut TcpStream,
    target_host: &str,
    target_port: u16,
    username: &Option<String>,
    password: &Option<String>,
) -> Result<(), String> {
    let target = format!("{}:{}", target_host, target_port);
    let mut request = format!("CONNECT {} HTTP/1.1\r\nHost: {}\r\n", target, target);
    if let (Some(user), Some(pass)) = (username, password) {
        if !user.is_empty() {
            use base64::engine::Engine;
            let cred = base64::engine::general_purpose::STANDARD
                .encode(format!("{}:{}", user, pass));
            request.push_str(&format!("Proxy-Authorization: Basic {}\r\n", cred));
        }
    }
    request.push_str("Proxy-Connection: keep-alive\r\n\r\n");
    tcp.write_all(request.as_bytes()).await.map_err(|e| format!("write CONNECT request: {}", e))?;

    // 读取响应头（逐字节直到 \r\n\r\n，避免吞掉隧道数据）
    let mut buf: Vec<u8> = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        let n = tcp.read(&mut byte).await.map_err(|e| format!("read response: {}", e))?;
        if n == 0 {
            return Err("HTTP 代理连接被关闭".to_string());
        }
        buf.push(byte[0]);
        if buf.len() >= 4 && &buf[buf.len() - 4..] == b"\r\n\r\n" {
            break;
        }
        if buf.len() > 65536 {
            return Err("HTTP 代理响应头过长".to_string());
        }
    }
    let head = String::from_utf8_lossy(&buf).to_string();
    let status_line = head.lines().next().unwrap_or("");
    if !status_line.contains(" 200 ") {
        return Err(format!("HTTP CONNECT 失败: {}", status_line));
    }
    Ok(())
}

impl SshTransport {
    /// 建立 TCP+SSH 握手并完成认证，返回传输层实例。
    ///
    /// `jump` 为 Some 时通过跳板机建立 TCP 隧道到达目标主机（ProxyJump / Jump Host）
    pub async fn connect(
        server_id: String,
        host: String,
        port: u16,
        username: &str,
        auth: &AuthMethod,
        connection_timeout: u32,
        jump: Option<JumpConfig<'_>>,
        proxy: Option<ProxyTransportConfig>,
    ) -> SshResult<Self> {
        let chain = jump.map(|j| vec![ResolvedJumpHop {
            host: j.host.to_string(),
            port: j.port,
            username: j.username.to_string(),
            auth: j.auth.clone(),
            timeout_secs: j.timeout_secs,
        }]);
        Self::connect_routed(server_id, host, port, username, auth, connection_timeout, chain, proxy).await
    }

    /// 建立 TCP+SSH 握手并完成认证，返回传输层实例（支持多级链式跳板机或代理）。
    pub async fn connect_routed(
        server_id: String,
        host: String,
        port: u16,
        username: &str,
        auth: &AuthMethod,
        connection_timeout: u32,
        jump_chain: Option<Vec<ResolvedJumpHop>>,
        proxy: Option<ProxyTransportConfig>,
    ) -> SshResult<Self> {
        let start = std::time::Instant::now();
        tracing::info!("[SSH Perf] {} 开始连接 {}:{}{}",
            server_id, host, port,
            if jump_chain.is_some() { "（经链式跳板机）" } else if proxy.is_some() { "（经代理）" } else { "" });

        let deadline = std::time::Instant::now() + Duration::from_secs(connection_timeout as u64);

        // SSH config
        let config = russh::client::Config {
            inactivity_timeout: None,
            keepalive_interval: Some(Duration::from_secs(15)),
            keepalive_max: 4,
            window_size: 4 * 1024 * 1024,
            maximum_packet_size: 65535,
            ..Default::default()
        };

        // ---------- 建立 TCP/Tunnel 传输层 ----------
        // 分三种路径：
        // A) 直连：直接 TCP 到 (host, port)
        // B) 经链式跳板机：通过逐级跳板握手并建立到目标的 direct_tcpip
        // C) 经 SOCKS5/HTTP 代理：与代理握手建立 TCP 隧道后，直接把流喂给 SSH 握手
        let (stream, tcp_elapsed) = if let Some(ref chain) = jump_chain {
            let t0 = std::time::Instant::now();
            let stream = connect_via_chained_jump(&config, &host, port, &deadline, chain).await?;
            (stream, t0.elapsed())
        } else if let Some(ref p) = proxy {
            let t0 = std::time::Instant::now();
            let stream = connect_via_proxy(&host, port, &deadline, p).await?;
            (stream, t0.elapsed())
        } else {
            let addr = format!("{}:{}", host, port);
            let tcp_timeout = deadline.saturating_duration_since(std::time::Instant::now());
            let socket = timeout(tcp_timeout, TcpStream::connect(&addr))
                .await
                .map_err(|_| SshError::ConnectionFailed(format!("TCP connect to {} timed out after {}s", addr, connection_timeout)))?
                .map_err(|e| SshError::ConnectionFailed(format!("TCP connect to {} failed: {}", addr, e)))?;
            socket.set_nodelay(true).ok();
            let elapsed = start.elapsed();
            tracing::info!("[SSH Perf] {} TCP connect: {:?} (累计 {:?})",
                server_id, elapsed, elapsed);
            // 用 AsyncRead+AsyncWrite 适配 russh 的 stream 参数
            (Box::pin(socket) as Pin<Box<dyn AsyncReadWrite + Send>>, elapsed)
        };
        let _ = tcp_elapsed;

        // russh 内部完成 SSH 协议协商及握手
        let handshake_timeout = deadline.saturating_duration_since(std::time::Instant::now());
        let banner = Arc::new(std::sync::Mutex::new(None));
        let mut handle = timeout(handshake_timeout, russh::client::connect_stream(
            Arc::new(config),
            stream,
            ClientHandler {
                host: host.clone(),
                port,
                server_id: server_id.clone(),
                banner: banner.clone(),
            },
        ))
        .await
        .map_err(|_| SshError::ConnectionFailed(format!("SSH handshake timed out after {}s", connection_timeout)))?
        .map_err(|e| SshError::ConnectionFailed(format!("SSH connect to {}:{} failed: {}", host, port, e)))?;
        let handshake_elapsed = start.elapsed();
        tracing::info!("[SSH Perf] {} SSH handshake 完成: {:?}",
            server_id, handshake_elapsed);

        // Authenticate（使用剩余时间作为 Auth 超时）
        let auth_start = start.elapsed();
        let auth_timeout = deadline.saturating_duration_since(std::time::Instant::now());
        let auth_res = timeout(auth_timeout, async {
            Self::authenticate(&mut handle, username, auth).await
        })
        .await;

        match auth_res {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(e),
            Err(_) => return Err(SshError::AuthFailed(format!("Authentication timed out after {}s", connection_timeout))),
        }
        let auth_elapsed = start.elapsed();
        tracing::info!("[SSH Perf] {} Auth: {:?} (累计 {:?})",
            server_id,
            auth_elapsed - auth_start,
            auth_elapsed);

        tracing::info!("[SSH Perf] {} Transport ready: 总耗时 {:?}", server_id, start.elapsed());
        Ok(Self { handle: tokio::sync::Mutex::new(handle), server_id, host, port, banner })
    }

    /// 认证逻辑（从 connect 抽出，避免与 jump 分支耦合）
    async fn authenticate(
        handle: &mut russh::client::Handle<ClientHandler>,
        username: &str,
        auth: &AuthMethod,
    ) -> SshResult<()> {
        match auth {
            AuthMethod::Password { password } => {
                let ok = handle
                    .authenticate_password(username, password)
                    .await
                    .map_err(|e| SshError::AuthFailed(format!("Password auth failed: {}", e)))?;
                if !ok {
                    return Err(SshError::AuthFailed("Password authentication rejected".into()));
                }
            }
            AuthMethod::PrivateKey {
                private_key_path,
                private_key_passphrase,
            } => {
                let key_path = validate_and_canonicalize_key_path(private_key_path)?;
                let key_pair = load_key_pair(&key_path, private_key_passphrase.as_deref())
                    .map_err(|e| SshError::AuthFailed(e.user_friendly_message()))?;
                let ok = handle
                    .authenticate_publickey(username, Arc::new(key_pair))
                    .await
                    .map_err(|e| SshError::AuthFailed(format!("Public key auth failed: {}", e)))?;
                if !ok {
                    return Err(SshError::AuthFailed("Public key authentication rejected".into()));
                }
            }
            AuthMethod::SshAgent { identity } => {
                const AGENT_TIMEOUT: Duration = Duration::from_secs(8);
                let mut agent_conn = timeout(AGENT_TIMEOUT, AgentConnection::connect_env())
                    .await
                    .map_err(|_| SshError::AuthFailed("连接 SSH Agent 超时（8 秒）".into()))??;
                let identities = timeout(AGENT_TIMEOUT, agent_conn.request_identities())
                    .await
                    .map_err(|_| SshError::AuthFailed("读取 SSH Agent 身份超时（8 秒）".into()))??;
                if identities.is_empty() {
                    return Err(SshError::AuthFailed(
                        "SSH Agent 中没有已加载的密钥，请先通过 ssh-add / Pageant 添加密钥".into()
                    ));
                }
                let candidates = if let Some(target) = identity {
                    vec![identities.into_iter().find(|pk| {
                        use russh::keys::PublicKeyBase64;
                        pk.public_key_base64() == target.public_key_base64()
                    }).ok_or_else(|| SshError::AuthFailed(
                        "未在 SSH Agent 中找到指定的身份，请检查公钥选择".into()
                    ))?]
                } else {
                    identities
                };
                let mut signer = AgentSigner::new(agent_conn);
                let mut last_error = None;
                let mut authenticated = false;
                for pubkey in candidates {
                    let (next_signer, auth_result) = timeout(
                        AGENT_TIMEOUT,
                        handle.authenticate_future(username, pubkey, signer),
                    )
                    .await
                    .map_err(|_| SshError::AuthFailed("SSH Agent 签名认证超时（8 秒）".into()))?;
                    signer = next_signer;
                    match auth_result {
                        Ok(true) => {
                            authenticated = true;
                            break;
                        }
                        Ok(false) => {}
                        Err(e) => last_error = Some(e.to_string()),
                    }
                }
                drop(signer);
                if !authenticated {
                    return Err(SshError::AuthFailed(last_error
                        .map(|e| format!("SSH Agent 认证失败: {}", e))
                        .unwrap_or_else(|| {
                            "SSH Agent 中的身份均被服务器拒绝，请确认公钥已被服务器授权".into()
                        })));
                }
            }
            AuthMethod::Certificate {
                private_key_path,
                certificate_path,
                private_key_passphrase,
            } => {
                let key_path = validate_and_canonicalize_key_path(private_key_path)?;
                let key_pair = load_key_pair(&key_path, private_key_passphrase.as_deref())
                    .map_err(|e| SshError::AuthFailed(e.user_friendly_message()))?;
                let cert_path = validate_and_canonicalize_key_path(certificate_path)?;
                let certificate = russh::keys::load_openssh_certificate(&cert_path)
                    .map_err(|e| SshError::AuthFailed(format!(
                        "加载 OpenSSH 证书失败: {}。请确认文件为 *-cert.pub 格式", e
                    )))?;
                validate_user_certificate_properties(
                    certificate.cert_type().is_user(),
                    certificate.valid_after(),
                    certificate.valid_before(),
                    certificate.valid_principals(),
                    username,
                )?;
                let ok = handle
                    .authenticate_openssh_cert(username, Arc::new(key_pair), certificate)
                    .await
                    .map_err(|e| SshError::AuthFailed(format!("Certificate auth failed: {}", e)))?;
                if !ok {
                    return Err(SshError::AuthFailed(
                        "证书认证被服务器拒绝，请确认证书未过期且 CA 已被服务器信任".into()
                    ));
                }
            }
            AuthMethod::PrivateKeyContent {
                private_key_content,
                private_key_passphrase,
            } => {
                let key_pair = load_key_pair_from_content(
                    private_key_content,
                    private_key_passphrase.as_deref(),
                )
                .map_err(|e| SshError::AuthFailed(e.user_friendly_message()))?;
                let ok = handle
                    .authenticate_publickey(username, Arc::new(key_pair))
                    .await
                    .map_err(|e| SshError::AuthFailed(format!("Public key auth failed: {}", e)))?;
                if !ok {
                    return Err(SshError::AuthFailed("Public key authentication rejected".into()));
                }
            }
            AuthMethod::CertificateContent {
                private_key_content,
                certificate_content,
                private_key_passphrase,
            } => {
                let key_pair = load_key_pair_from_content(
                    private_key_content,
                    private_key_passphrase.as_deref(),
                )
                .map_err(|e| SshError::AuthFailed(e.user_friendly_message()))?;

                use std::io::Write;
                let tmp_dir = std::env::temp_dir();
                let tmp_file_name = format!(
                    "ssh_cert_{}_{}.tmp",
                    std::process::id(),
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_nanos())
                        .unwrap_or(0)
                );
                let tmp_path = tmp_dir.join(&tmp_file_name);

                #[cfg(unix)]
                let mut f = {
                    use std::os::unix::fs::OpenOptionsExt;
                    std::fs::OpenOptions::new()
                        .create_new(true)
                        .write(true)
                        .mode(0o600)
                        .open(&tmp_path)
                        .map_err(|e| SshError::AuthFailed(format!("创建临时证书文件失败: {}", e)))?
                };
                #[cfg(not(unix))]
                let mut f = std::fs::OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(&tmp_path)
                    .map_err(|e| SshError::AuthFailed(format!("创建临时证书文件失败: {}", e)))?;

                f.write_all(certificate_content.as_bytes())
                    .map_err(|e| SshError::AuthFailed(format!("写入临时证书文件失败: {}", e)))?;
                f.sync_all().ok();
                drop(f);

                let cert_result = russh::keys::load_openssh_certificate(&tmp_path);
                let _ = std::fs::remove_file(&tmp_path);

                let certificate = cert_result.map_err(|e| SshError::AuthFailed(format!(
                    "解析 OpenSSH 证书内容失败: {}。请确认内容为 *-cert.pub 格式", e
                )))?;
                validate_user_certificate_properties(
                    certificate.cert_type().is_user(),
                    certificate.valid_after(),
                    certificate.valid_before(),
                    certificate.valid_principals(),
                    username,
                )?;

                let ok = handle
                    .authenticate_openssh_cert(username, Arc::new(key_pair), certificate)
                    .await
                    .map_err(|e| SshError::AuthFailed(format!("Certificate auth failed: {}", e)))?;
                if !ok {
                    return Err(SshError::AuthFailed(
                        "证书认证被服务器拒绝，请确认证书未过期且 CA 已被服务器信任".into()
                    ));
                }
            }
        }
        Ok(())
    }

    /// 打开一个 session channel（exec/shell/sftp 都基于此）。
    pub async fn open_session_channel(&self) -> SshResult<russh::Channel<russh::client::Msg>> {
        self.handle.lock().await.channel_open_session()
            .await
            .map_err(|e| SshError::ChannelOpenFailed(format!("{}", e)))
    }

    /// 打开一条 direct-tcpip 通道（Local / Dynamic 端口转发使用）。
    ///
    /// 客户端通过 SSH 通道连接到 `host_to_connect:port_to_connect`，
    /// `originator_*` 用于服务端审计/日志（一般填本地 TCP 对端地址）。
    pub async fn open_direct_tcpip(
        &self,
        host_to_connect: String,
        port_to_connect: u32,
        originator_host: String,
        originator_port: u32,
    ) -> SshResult<russh::Channel<russh::client::Msg>> {
        self.handle.lock().await
            .channel_open_direct_tcpip(
                host_to_connect,
                port_to_connect,
                originator_host,
                originator_port,
            )
            .await
            .map_err(|e| SshError::ChannelOpenFailed(format!("direct-tcpip: {}", e)))
    }

    /// 请求服务端监听指定地址端口，开始 Remote 端口转发。
    ///
    /// 返回服务端实际绑定的端口（当 `port=0` 时由 OS 分配）。
    pub async fn tcpip_forward(
        &self,
        bind_address: &str,
        port: u32,
    ) -> SshResult<u32> {
        self.handle.lock().await
            .tcpip_forward(bind_address.to_string(), port)
            .await
            .map_err(|e| SshError::ChannelOpenFailed(format!("tcpip-forward: {}", e)))
    }

    /// 取消服务端的 Remote 端口转发监听。
    pub async fn cancel_remote_forward(
        &self,
        bind_address: &str,
        port: u32,
    ) -> SshResult<()> {
        self.handle.lock().await
            .cancel_tcpip_forward(bind_address.to_string(), port)
            .await
            .map_err(|e| SshError::ChannelOpenFailed(format!("cancel-tcpip-forward: {}", e)))
    }

    /// 是否已关闭（连接已断）
    ///
    /// 用 `try_lock` 避免在 sync 上下文阻塞；若锁被占用（极少发生，仅 tcpip_forward 调用瞬间），
    /// 视为"未关闭"（alive）——保守策略，避免误判触发断线。
    pub fn is_closed(&self) -> bool {
        match self.handle.try_lock() {
            Ok(guard) => guard.is_closed(),
            Err(_) => false,
        }
    }

    /// 是否仍然存活
    pub fn is_alive(&self) -> bool {
        !self.is_closed()
    }

    /// 主动发送 SSH disconnect 消息
    pub async fn disconnect(&self) {
        let _ = self.handle.lock().await
            .disconnect(russh::Disconnect::ByApplication, "", "")
            .await;
    }

    pub fn server_id(&self) -> &str {
        &self.server_id
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// 获取服务端在 SSH 用户认证阶段发送的欢迎词（SSH_MSG_USERAUTH_BANNER）
    pub fn auth_banner(&self) -> Option<String> {
        self.banner.lock().ok().and_then(|b| b.clone())
    }
}

// ============================================================================
// ExecManager：一次性命令执行
// ============================================================================

/// 命令执行器：基于 transport 提供同步 exec 能力。
pub struct ExecManager<'a> {
    transport: &'a SshTransport,
}

impl<'a> ExecManager<'a> {
    pub fn new(transport: &'a SshTransport) -> Self {
        Self { transport }
    }

    /// Execute a command on the remote server (async).
    ///
    /// 整个 `exec + 收集输出` 流程都被包裹在单一 `timeout` 中。
    pub async fn execute(&self, command: &str, timeout_secs: u64) -> SshResult<CommandOutput> {
        timeout(
            Duration::from_secs(timeout_secs),
            async {
                let mut channel = self.transport.open_session_channel().await?;

                channel.exec(true, command)
                    .await
                    .map_err(|e| SshError::ExecutionFailed(format!("{}", e)))?;

                let mut stdout = Vec::new();
                let mut stderr = Vec::new();
                let mut exit_code = -1i32;
                let mut stdout_truncated = false;
                let mut stderr_truncated = false;

                loop {
                    match channel.wait().await {
                        Some(ChannelMsg::Data { data }) => append_limited_output(&mut stdout, &data, &mut stdout_truncated),
                        Some(ChannelMsg::ExtendedData { data, ext: 1 }) => append_limited_output(&mut stderr, &data, &mut stderr_truncated),
                        Some(ChannelMsg::ExitStatus { exit_status }) => exit_code = exit_status as i32,
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => break,
                        None => break,
                        _ => {}
                    }
                }

                Ok(CommandOutput {
                    stdout: format_output(stdout, stdout_truncated),
                    stderr: format_output(stderr, stderr_truncated),
                    exit_code,
                })
            },
        )
        .await
        .map_err(|_| SshError::CommandTimeout(timeout_secs))?
    }

    /// 流式执行命令：每收到一段 stdout 就实时回调一次（Compose 部署输出面板用）。
    ///
    /// 与 execute 的区别：输出不落盘等待，而是边收边推给调用方，实现"部署过程实时可见"。
    /// UTF-8 安全：跨 chunk 截断的多字节字符暂存到尾部缓冲，只在完整边界处回调。
    /// 命令应使用 2>&1 合并 stderr（compose 系命令均如此），本方法只收集 stdout。
    pub async fn execute_streaming(
        &self,
        command: &str,
        timeout_secs: u64,
        mut on_chunk: impl FnMut(&str),
    ) -> SshResult<CommandOutput> {
        timeout(
            Duration::from_secs(timeout_secs),
            async {
                let mut channel = self.transport.open_session_channel().await?;

                channel.exec(true, command)
                    .await
                    .map_err(|e| SshError::ExecutionFailed(format!("{}", e)))?;

                let mut stdout = Vec::new();
                let mut pending: Vec<u8> = Vec::new(); // UTF-8 跨 chunk 残部
                let mut exit_code = -1i32;
                // Eof/Close 后给个 200ms 兜底窗口：部分服务端/代理把 ExitStatus 排在
                // Close 之后甚至丢失，直接 break 会让 exit_code 永远停留在初始的 -1i32，
                // 表现是 docker compose build/down/restart 等成功完成的命令仍被判为失败。
                let mut end_signaled = false;

                loop {
                    let next_msg = if end_signaled {
                        // 兜底：短超时再读一次，捕获迟到的 ExitStatus
                        tokio::time::timeout(Duration::from_millis(200), channel.wait())
                            .await
                            .unwrap_or_default() // 兜底窗口耗尽，正常结束
                    } else {
                        channel.wait().await
                    };

                    match next_msg {
                        Some(ChannelMsg::Data { data }) => {
                            stdout.extend_from_slice(&data);
                            pending.extend_from_slice(&data);
                            // 只回调完整 UTF-8 前缀，残部留待下个 chunk
                            let valid = match std::str::from_utf8(&pending) {
                                Ok(s) => s.len(),
                                Err(e) => e.valid_up_to(),
                            };
                            if valid > 0 {
                                on_chunk(&String::from_utf8_lossy(&pending[..valid]));
                                pending.drain(..valid);
                            }
                        }
                        Some(ChannelMsg::ExitStatus { exit_status }) => {
                            exit_code = exit_status as i32;
                            if end_signaled { break; }
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => {
                            if exit_code != -1 { break; }
                            // 还没拿到 exit status：进入兜底窗口再试一次
                            end_signaled = true;
                        }
                        None => break,
                        _ => {}
                    }
                }
                // 冲刷 UTF-8 残部（截断的尾字符，lossy 容错）
                if !pending.is_empty() {
                    on_chunk(&String::from_utf8_lossy(&pending));
                }

                Ok(CommandOutput {
                    stdout: String::from_utf8_lossy(&stdout).to_string(),
                    stderr: String::new(),
                    exit_code,
                })
            },
        )
        .await
        .map_err(|_| SshError::CommandTimeout(timeout_secs))?
    }

    /// 执行命令并通过 stdin 传输数据（用于 PowerShell 文件上传回退）。
    ///
    /// 整个 `exec + 写 stdin + 收集输出` 流程都被包裹在单一 `timeout` 中。
    /// stdin_data 分块写入（32KB/块），避免大块数据导致 SSH channel 流控阻塞。
    /// 写入完成后发送 EOF，通知服务端 stdin 结束。
    pub async fn execute_with_stdin(
        &self,
        command: &str,
        stdin_data: &[u8],
        timeout_secs: u64,
    ) -> SshResult<CommandOutput> {
        timeout(
            Duration::from_secs(timeout_secs),
            async {
                let mut channel = self.transport.open_session_channel().await?;

                channel.exec(true, command)
                    .await
                    .map_err(|e| SshError::ExecutionFailed(format!("{}", e)))?;

                // 等待远端命令启动，避免 stdin 数据在命令准备好前到达
                // 对 DefaultShell=cmd 启动 powershell.exe 的场景尤为重要：
                // cmd 需要先启动、解析命令行、再启动 powershell.exe 子进程
                // 在此期间 SSH channel 缓冲的 stdin 数据可能被 cmd 拦截或丢失
                tokio::time::sleep(Duration::from_millis(500)).await;

                // 分块写入 stdin 数据，避免大块数据阻塞 SSH channel 流控
                // 32KB 块大小在 SSH channel 窗口范围内，且能让服务端及时处理
                const STDIN_CHUNK: usize = 32 * 1024;
                for chunk in stdin_data.chunks(STDIN_CHUNK) {
                    channel.data(chunk).await
                        .map_err(|e| SshError::ExecutionFailed(format!("Failed to write stdin chunk: {}", e)))?;
                    // 让出控制权，让服务端有机会处理数据并更新窗口
                    tokio::task::yield_now().await;
                }

                // 短暂延迟后发送 eof，确保所有数据被服务端缓冲并交付给子进程
                tokio::time::sleep(Duration::from_millis(200)).await;
                let _ = channel.eof().await;

                let mut stdout = Vec::new();
                let mut stderr = Vec::new();
                let mut exit_code = -1i32;
                let mut stdout_truncated = false;
                let mut stderr_truncated = false;

                loop {
                    match channel.wait().await {
                        Some(ChannelMsg::Data { data }) => append_limited_output(&mut stdout, &data, &mut stdout_truncated),
                        Some(ChannelMsg::ExtendedData { data, ext: 1 }) => append_limited_output(&mut stderr, &data, &mut stderr_truncated),
                        Some(ChannelMsg::ExitStatus { exit_status }) => exit_code = exit_status as i32,
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => break,
                        None => break,
                        _ => {}
                    }
                }

                Ok(CommandOutput {
                    stdout: format_output(stdout, stdout_truncated),
                    stderr: format_output(stderr, stderr_truncated),
                    exit_code,
                })
            },
        )
        .await
        .map_err(|_| SshError::CommandTimeout(timeout_secs))?
    }

    /// 镜像导出（方案 A）：远端 `docker save` 的 tar 字节流直接落盘到**本地文件**（客户端侧），
    /// 不经由宿主机临时文件、不在内存中整段缓冲。逐块把 stdout 写入本地文件，仅把 stderr 收集为错误。
    /// 内存占用恒定（单块 64KB），超大镜像也不会撑爆进程。
    pub async fn execute_save_to_file(
        &self,
        command: &str,
        timeout_secs: u64,
        local_path: &str,
        on_progress: &(dyn Fn(u64, u64) + Send + Sync),
        cancel: Arc<AtomicBool>,
    ) -> SshResult<CommandOutput> {
        // 外层固定绝对上限（兜底，防极端异常/资源泄漏）；真正卡死保护靠循环内的 idle 超时。
        let absolute = timeout_secs.max(TRANSFER_ABSOLUTE_TIMEOUT_SECS);
        timeout(
            Duration::from_secs(absolute),
            async {
                let mut channel = self.transport.open_session_channel().await?;
                channel.exec(true, command).await
                    .map_err(|e| SshError::ExecutionFailed(format!("{}", e)))?;

                let mut file = tokio::fs::File::create(local_path).await
                    .map_err(|e| SshError::ExecutionFailed(format!("无法创建本地文件 {}: {}", local_path, e)))?;

                let mut stderr = Vec::new();
                let mut stderr_truncated = false;
                let mut exit_code = -1i32;
                let mut transferred = 0u64;
                let mut end_signaled = false;

                loop {
                    if cancel.load(Ordering::Relaxed) {
                        // 用户取消：删除不完整的本地文件并返回取消错误
                        let _ = tokio::fs::remove_file(local_path).await;
                        return Err(SshError::CommandCancelled("用户取消了导出".into()));
                    }
                    let next_msg = if end_signaled {
                        tokio::time::timeout(Duration::from_millis(200), channel.wait())
                            .await
                            .unwrap_or_default()
                    } else {
                        // 空闲超时：连续 IDLE_TIMEOUT_SECS 秒无任何通道消息即判定数据流卡死。
                        // 每次收到消息自动重置，慢速持续传输不会被误杀。
                        match tokio::time::timeout(IDLE_TIMEOUT, channel.wait()).await {
                            Ok(opt) => opt,
                            Err(_) => return Err(SshError::CommandTimeout(IDLE_TIMEOUT_SECS)),
                        }
                    };
                    match next_msg {
                        Some(ChannelMsg::Data { data }) => {
                            file.write_all(&data).await
                                .map_err(|e| SshError::ExecutionFailed(format!("写入本地文件失败: {}", e)))?;
                            transferred += data.len() as u64;
                            on_progress(transferred, 0);
                        }
                        Some(ChannelMsg::ExtendedData { data, ext: 1 }) => {
                            append_limited_output(&mut stderr, &data, &mut stderr_truncated);
                        }
                        Some(ChannelMsg::ExitStatus { exit_status }) => {
                            exit_code = exit_status as i32;
                            if end_signaled { break; }
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => {
                            if exit_code != -1 { break; }
                            end_signaled = true;
                        }
                        None => break,
                        _ => {}
                    }
                }
                let _ = file.flush().await;
                let _ = file.sync_all().await;

                if exit_code != 0 {
                    // 导出失败：删除可能不完整的文件，并把 stderr 作为错误返回
                    let _ = tokio::fs::remove_file(local_path).await;
                }
                Ok(CommandOutput {
                    stdout: String::new(),
                    stderr: format_output(stderr, stderr_truncated),
                    exit_code,
                })
            },
        )
        .await
        .map_err(|_| SshError::CommandTimeout(absolute))?
    }

    /// 镜像导入（方案 A，对称）：本地 tar 文件逐块经 SSH 通道 stdin 喂给远端 `docker load`，
    /// 同样不落宿主机磁盘、不整段缓冲。先发数据再发 EOF；远端 stdout/stderr 收集为结果。
    pub async fn execute_load_from_file(
        &self,
        command: &str,
        timeout_secs: u64,
        local_path: &str,
        on_progress: &(dyn Fn(u64, u64) + Send + Sync),
        cancel: Arc<AtomicBool>,
    ) -> SshResult<CommandOutput> {
        // 外层固定绝对上限（兜底，防极端异常/资源泄漏）；真正卡死保护靠循环内的 idle 超时。
        let absolute = timeout_secs.max(TRANSFER_ABSOLUTE_TIMEOUT_SECS);
        timeout(
            Duration::from_secs(absolute),
            async {
                let mut channel = self.transport.open_session_channel().await?;
                channel.exec(true, command).await
                    .map_err(|e| SshError::ExecutionFailed(format!("{}", e)))?;

                // 等待远端命令启动，避免 stdin 在 docker 准备好前到达（与 execute_with_stdin 一致）
                tokio::time::sleep(Duration::from_millis(500)).await;

                let mut file = tokio::fs::File::open(local_path).await
                    .map_err(|e| SshError::ExecutionFailed(format!("无法打开本地文件 {}: {}", local_path, e)))?;
                let total = file.metadata().await.map(|m| m.len()).unwrap_or(0);

                const STDIN_CHUNK: usize = 32 * 1024;
                let mut buf = vec![0u8; STDIN_CHUNK];
                let mut transferred = 0u64;
                loop {
                    if cancel.load(Ordering::Relaxed) {
                        return Err(SshError::CommandCancelled("用户取消了导入".into()));
                    }
                    let n = file.read(&mut buf).await
                        .map_err(|e| SshError::ExecutionFailed(format!("读取本地文件失败: {}", e)))?;
                    if n == 0 { break; }
                    // 空闲超时：远端持续不消费 stdin（窗口满/卡死）超过 IDLE_TIMEOUT_SECS 即判定失败。
                    match tokio::time::timeout(IDLE_TIMEOUT, channel.data(&buf[..n])).await {
                        Ok(res) => res
                            .map_err(|e| SshError::ExecutionFailed(format!("写入 stdin 失败: {}", e)))?,
                        Err(_) => return Err(SshError::CommandTimeout(IDLE_TIMEOUT_SECS)),
                    }
                    transferred += n as u64;
                    on_progress(transferred, total);
                    tokio::task::yield_now().await;
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
                let _ = channel.eof().await;

                let mut stdout = Vec::new();
                let mut stderr = Vec::new();
                let mut stdout_truncated = false;
                let mut stderr_truncated = false;
                let mut exit_code = -1i32;
                let mut end_signaled = false;
                loop {
                    let next_msg = if end_signaled {
                        tokio::time::timeout(Duration::from_millis(200), channel.wait())
                            .await
                            .unwrap_or_default()
                    } else {
                        // 空闲超时：连续 IDLE_TIMEOUT_SECS 秒无响应消息即判定数据流卡死。
                        match tokio::time::timeout(IDLE_TIMEOUT, channel.wait()).await {
                            Ok(opt) => opt,
                            Err(_) => return Err(SshError::CommandTimeout(IDLE_TIMEOUT_SECS)),
                        }
                    };
                    match next_msg {
                        Some(ChannelMsg::Data { data }) => append_limited_output(&mut stdout, &data, &mut stdout_truncated),
                        Some(ChannelMsg::ExtendedData { data, ext: 1 }) => append_limited_output(&mut stderr, &data, &mut stderr_truncated),
                        Some(ChannelMsg::ExitStatus { exit_status }) => {
                            exit_code = exit_status as i32;
                            if end_signaled { break; }
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => {
                            if exit_code != -1 { break; }
                            end_signaled = true;
                        }
                        None => break,
                        _ => {}
                    }
                }
                Ok(CommandOutput {
                    stdout: format_output(stdout, stdout_truncated),
                    stderr: format_output(stderr, stderr_truncated),
                    exit_code,
                })
            },
        )
        .await
        .map_err(|_| SshError::CommandTimeout(absolute))?
    }

    /// 简易探活：执行 `echo ok`，仅用于心跳保活
    pub async fn ping(&self) -> SshResult<()> {
        self.execute("echo ok", 10).await.map(|_| ())
    }
}

// ============================================================================
// FileManager：SFTP 子系统接入
// ============================================================================

/// 文件管理器：基于 transport 提供 SFTP 会话与文件流。
pub struct FileManager<'a> {
    transport: &'a SshTransport,
}

impl<'a> FileManager<'a> {
    pub fn new(transport: &'a SshTransport) -> Self {
        Self { transport }
    }

    /// 创建一个 SFTP 子系统会话
    ///
    /// 带超时保护（20 秒）和一次自动重试。
    /// Windows OpenSSH Server 的 DefaultShell 如果设为 PowerShell/Bash，
    /// 启动 profile 打印的输出可能干扰 SFTP 协议握手导致超时。
    /// 重试一次可以在偶发性超时时提高成功率。
    pub async fn create_sftp_session(&self) -> SshResult<russh_sftp::client::SftpSession> {
        match self.create_sftp_session_inner().await {
            Ok(sftp) => Ok(sftp),
            Err(first_err) => {
                // 首次失败，判断是否为超时类错误
                let err_msg = first_err.to_string();
                let is_timeout = err_msg.contains("Timeout") || err_msg.contains("timeout");
                if !is_timeout {
                    return Err(first_err);
                }
                // 超时后重试一次（偶发性超时可能第二次成功）
                match self.create_sftp_session_inner().await {
                    Ok(sftp) => Ok(sftp),
                    Err(retry_err) => {
                        // 重试也失败，返回带诊断信息的错误
                        let retry_msg = retry_err.to_string();
                        if let Ok(server) = crate::commands::ssh::load_server_config(self.transport.server_id()).await {
                            if server.target_type.eq_ignore_ascii_case("windows") {
                                return Err(SshError::SftpFailed(format!(
                                    "SFTP session init failed after retry: {}. \
                                    This is a common issue when connecting to Windows OpenSSH Server \
                                    with DefaultShell set to PowerShell or Bash, where startup profiles \
                                    print banners/prompts/outputs. Please configure your profile ($PROFILE) \
                                    to exit early on non-interactive/SFTP sessions, or reset DefaultShell to cmd.exe.",
                                    retry_msg
                                )));
                            }
                        }
                        Err(SshError::SftpFailed(format!("SFTP session init failed after retry: {}", retry_msg)))
                    }
                }
            }
        }
    }

    /// SFTP session 创建的内部实现（单次尝试，带 30 秒超时）
    async fn create_sftp_session_inner(&self) -> SshResult<russh_sftp::client::SftpSession> {
        let channel = self.transport.open_session_channel().await?;
        // want_reply=false：不等待服务端确认 subsystem 启动，直接开始 SFTP 握手。
        // Windows OpenSSH 在某些配置下 subsystem 启动慢（如 DefaultShell=PowerShell
        // 的 profile 输出），want_reply=true 会导致等待确认超时。
        channel.request_subsystem(false, "sftp")
            .await
            .map_err(|e| SshError::SftpFailed(format!("Request subsystem failed: {}", e)))?;

        // 开启流水线并发写入（16 深度并发请求）与 30s 请求超时，显著提升高延迟/长距离传输吞吐量
        let sftp_cfg = russh_sftp::client::Config {
            max_packet_len: 256 * 1024,
            max_concurrent_writes: 16,
            request_timeout_secs: 30,
        };

        // 用 timeout 包装 SftpSession::new_with_config，防止无限等待
        // Windows OpenSSH DefaultShell=PowerShell/Bash 时 profile 输出可能导致握手卡住
        let sftp_res = timeout(
            Duration::from_secs(30),
            russh_sftp::client::SftpSession::new_with_config(channel.into_stream(), sftp_cfg),
        )
        .await;

        match sftp_res {
            Ok(Ok(sftp)) => Ok(sftp),
            Ok(Err(e)) => {
                Err(SshError::SftpFailed(format!("SFTP session init failed: {}", e)))
            }
            Err(_) => {
                // tokio timeout
                Err(SshError::SftpFailed("SFTP session init timed out (30s)".to_string()))
            }
        }
    }
}

// ============================================================================
// SshConnection：facade（向后兼容旧 API）
// ============================================================================
//
// 保留旧 API（execute / create_shell_channel / create_sftp_session / is_connected /
// server_id / disconnect / keepalive_send），上层 manager.rs 不需要立即改写。
// 内部委托给 Transport + ExecManager + FileManager。

pub struct SshConnection {
    transport: SshTransport,
    /// Application heartbeat：由 manager 启动的后台任务通过此 flag 取消。
    /// 简单的 atomic flag，不依赖 tokio-util。
    heartbeat_cancel: Arc<AtomicBool>,
    /// SFTP session 缓存：避免每次操作都新建 channel + SftpSession。
    /// 所有 SFTP 方法都是 &self，Arc<SftpSession> 可安全共享。
    /// session 在连接断开时随 SshConnection 一起 drop。
    sftp_cache: tokio::sync::Mutex<Option<std::sync::Arc<russh_sftp::client::SftpSession>>>,
    /// 确保首次打开终端交互式 PTY Shell 优先于后台非交互通道（SFTP / exec），
    /// 防止非交互通道抢先触发 OpenSSH PAM pam_open_session 导致 loginmsg (MOTD) 被提前清除。
    first_shell_ready: Arc<AtomicBool>,
    first_shell_notify: Arc<tokio::sync::Notify>,
}

impl SshConnection {
    /// Connect to a remote SSH server (async).
    pub async fn connect(
        server_id: String,
        host: String,
        port: u16,
        username: &str,
        auth: &AuthMethod,
        connection_timeout: u32,
    ) -> SshResult<Self> {
        let transport = SshTransport::connect(server_id, host, port, username, auth, connection_timeout, None, None).await?;
        Ok(Self {
            transport,
            heartbeat_cancel: Arc::new(AtomicBool::new(false)),
            sftp_cache: tokio::sync::Mutex::new(None),
            first_shell_ready: Arc::new(AtomicBool::new(false)),
            first_shell_notify: Arc::new(tokio::sync::Notify::new()),
        })
    }

    /// Connect via a jump host (async).
    pub async fn connect_via_jump(
        server_id: String,
        host: String,
        port: u16,
        username: &str,
        auth: &AuthMethod,
        connection_timeout: u32,
        jump: JumpConfig<'_>,
    ) -> SshResult<Self> {
        let transport = SshTransport::connect(
            server_id, host, port, username, auth, connection_timeout, Some(jump), None,
        ).await?;
        Ok(Self {
            transport,
            heartbeat_cancel: Arc::new(AtomicBool::new(false)),
            sftp_cache: tokio::sync::Mutex::new(None),
            first_shell_ready: Arc::new(AtomicBool::new(false)),
            first_shell_notify: Arc::new(tokio::sync::Notify::new()),
        })
    }

    /// Connect via a multi-hop chained jump host (async).
    pub async fn connect_via_jump_chain(
        server_id: String,
        host: String,
        port: u16,
        username: &str,
        auth: &AuthMethod,
        connection_timeout: u32,
        hops: Vec<ResolvedJumpHop>,
    ) -> SshResult<Self> {
        let transport = SshTransport::connect_routed(
            server_id, host, port, username, auth, connection_timeout, Some(hops), None,
        ).await?;
        Ok(Self {
            transport,
            heartbeat_cancel: Arc::new(AtomicBool::new(false)),
            sftp_cache: tokio::sync::Mutex::new(None),
            first_shell_ready: Arc::new(AtomicBool::new(false)),
            first_shell_notify: Arc::new(tokio::sync::Notify::new()),
        })
    }

    /// Connect via a SOCKS5 / HTTP proxy (async).
    pub async fn connect_via_proxy(
        server_id: String,
        host: String,
        port: u16,
        username: &str,
        auth: &AuthMethod,
        connection_timeout: u32,
        proxy: ProxyTransportConfig,
    ) -> SshResult<Self> {
        let transport = SshTransport::connect(
            server_id, host, port, username, auth, connection_timeout, None, Some(proxy),
        ).await?;
        Ok(Self {
            transport,
            heartbeat_cancel: Arc::new(AtomicBool::new(false)),
            sftp_cache: tokio::sync::Mutex::new(None),
            first_shell_ready: Arc::new(AtomicBool::new(false)),
            first_shell_notify: Arc::new(tokio::sync::Notify::new()),
        })
    }

    /// 确保终端交互式 PTY Shell 优先建立，避免后台通道（SFTP / exec）抢占首个会话通道导致服务端的 PAM MOTD 欢迎词被提前清空。
    pub async fn wait_for_first_shell(&self, max_wait_ms: u64) {
        if self.first_shell_ready.load(Ordering::SeqCst) {
            return;
        }
        let notified = self.first_shell_notify.notified();
        if self.first_shell_ready.load(Ordering::SeqCst) {
            return;
        }
        let _ = tokio::time::timeout(std::time::Duration::from_millis(max_wait_ms), notified).await;
    }

    /// Execute a command on the remote server (async).
    pub async fn execute(&self, command: &str, timeout_secs: u64) -> SshResult<CommandOutput> {
        self.wait_for_first_shell(1000).await;
        ExecManager::new(&self.transport).execute(command, timeout_secs).await
    }

    /// 执行命令并通过 stdin 传输数据（用于 PowerShell 文件上传回退）。
    pub async fn execute_with_stdin(
        &self,
        command: &str,
        stdin_data: &[u8],
        timeout_secs: u64,
    ) -> SshResult<CommandOutput> {
        self.wait_for_first_shell(1000).await;
        ExecManager::new(&self.transport).execute_with_stdin(command, stdin_data, timeout_secs).await
    }

    /// Create an interactive shell channel (returns the channel for PTY setup).
    pub async fn create_shell_channel(&self) -> SshResult<russh::Channel<russh::client::Msg>> {
        let ch = self.transport.open_session_channel().await?;
        if !self.first_shell_ready.swap(true, Ordering::SeqCst) {
            self.first_shell_notify.notify_waiters();
        }
        Ok(ch)
    }

    /// 打开一条 direct-tcpip 通道（Local / Dynamic 端口转发使用）。
    pub async fn open_direct_tcpip(
        &self,
        host_to_connect: String,
        port_to_connect: u32,
        originator_host: String,
        originator_port: u32,
    ) -> SshResult<russh::Channel<russh::client::Msg>> {
        self.transport
            .open_direct_tcpip(host_to_connect, port_to_connect, originator_host, originator_port)
            .await
    }

    /// 请求服务端监听指定地址端口，开始 Remote 端口转发。
    pub async fn tcpip_forward(&self, bind_address: &str, port: u32) -> SshResult<u32> {
        self.transport.tcpip_forward(bind_address, port).await
    }

    /// 取消服务端的 Remote 端口转发监听。
    pub async fn cancel_remote_forward(
        &self,
        bind_address: &str,
        port: u32,
    ) -> SshResult<()> {
        self.transport.cancel_remote_forward(bind_address, port).await
    }

    /// Create an SFTP session over this SSH connection.
    /// 创建/获取 SFTP 子系统会话（带缓存）。
    ///
    /// 首次调用时创建新 session 并缓存；后续调用直接返回缓存的 `Arc<SftpSession>`。
    /// 所有 SFTP 方法都是 `&self`，`Arc<SftpSession>` 可安全共享。
    /// 避免每次操作都新建 channel + SftpSession（解决 session 竞争导致的超时）。
    pub async fn create_sftp_session(&self) -> SshResult<std::sync::Arc<russh_sftp::client::SftpSession>> {
        self.wait_for_first_shell(1000).await;
        // 先检查缓存
        {
            let cache = self.sftp_cache.lock().await;
            if let Some(ref sftp) = *cache {
                return Ok(std::sync::Arc::clone(sftp));
            }
        }
        // 缓存为空，创建新 session（带超时和重试）
        let sftp = FileManager::new(&self.transport).create_sftp_session().await?;
        let sftp = std::sync::Arc::new(sftp);
        // 放入缓存
        let mut cache = self.sftp_cache.lock().await;
        *cache = Some(std::sync::Arc::clone(&sftp));
        Ok(sftp)
    }

    /// 创建独立的 SFTP 会话（不走缓存，不复用已有 session）。
    ///
    /// 用于文件传输等长时间操作：Windows sftp-server.exe 不支持在同一 SFTP session
    /// 上交错执行 readdir + write，会导致 write 返回 SSH_FX_FAILURE。
    /// 传输使用独立 session 可与目录浏览操作互不干扰。
    /// session 用完自动 drop 时关闭 channel。
    pub async fn create_dedicated_sftp_session(&self) -> SshResult<russh_sftp::client::SftpSession> {
        self.wait_for_first_shell(1000).await;
        FileManager::new(&self.transport).create_sftp_session().await
    }

    /// 清空 SFTP session 缓存，强制下次操作重建 session。
    /// 在 SFTP 操作返回连接错误时调用，让后续操作能自动恢复。
    pub async fn invalidate_sftp_cache(&self) {
        let mut cache = self.sftp_cache.lock().await;
        *cache = None;
    }

    /// Check if this connection is still alive.
    pub fn is_connected(&self) -> bool {
        self.transport.is_alive()
    }

    /// Get the server ID.
    pub fn server_id(&self) -> &str {
        self.transport.server_id()
    }

    /// Disconnect by sending SSH disconnect message.
    pub async fn disconnect(&self) {
        self.transport.disconnect().await;
    }

    /// Send a keepalive / check connection health without opening a channel (avoids MaxSessions competition).
    pub async fn keepalive_send(&self) -> SshResult<()> {
        if !self.is_connected() {
            return Err(SshError::NotConnected(self.server_id().to_string()));
        }
        Ok(())
    }

    /// Application heartbeat：返回一个 CancelToken，配合 manager 启动后台 ping 任务
    pub fn start_heartbeat(&self) -> Arc<AtomicBool> {
        // 复位并返回一个新的取消标记
        self.heartbeat_cancel.store(false, Ordering::Relaxed);
        self.heartbeat_cancel.clone()
    }

    /// 停止心跳任务（设置取消标记）
    pub fn stop_heartbeat(&self) {
        self.heartbeat_cancel.store(true, Ordering::Relaxed);
    }

    /// 心跳任务是否已被请求取消
    pub fn is_heartbeat_cancelled(&self) -> bool {
        self.heartbeat_cancel.load(Ordering::Relaxed)
    }

    /// Transport 引用（供 shell/tail 直接使用）
    pub fn transport(&self) -> &SshTransport {
        &self.transport
    }

    /// 获取服务端在 SSH 用户认证阶段发送的欢迎词（SSH_MSG_USERAUTH_BANNER）
    pub fn auth_banner(&self) -> Option<String> {
        self.transport.auth_banner()
    }
}

/// Determine if a host is on the intranet (private network / local)
#[allow(dead_code)]
pub async fn is_intranet_host(host: &str) -> bool {
    let host_lower = host.to_lowercase();
    if host_lower == "localhost"
        || host_lower.ends_with(".local")
        || host_lower.ends_with(".lan")
        || host_lower.ends_with(".internal")
        || host_lower.ends_with(".home")
    {
        return true;
    }

    // Try parsing as raw IP first
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(ipv4) => ipv4.is_loopback() || ipv4.is_private() || ipv4.is_link_local(),
            std::net::IpAddr::V6(ipv6) => {
                ipv6.is_loopback()
                    || (ipv6.segments()[0] & 0xfe00) == 0xfc00
                    || (ipv6.segments()[0] & 0xffc0) == 0xfe80
            }
        };
    }

    // Try resolving host via DNS
    let addr_str = format!("{}:22", host);
    if let Ok(mut addrs) = tokio::net::lookup_host(&addr_str).await {
        if let Some(socket_addr) = addrs.next() {
            let ip = socket_addr.ip();
            return match ip {
                std::net::IpAddr::V4(ipv4) => ipv4.is_loopback() || ipv4.is_private() || ipv4.is_link_local(),
                std::net::IpAddr::V6(ipv6) => {
                    ipv6.is_loopback()
                        || (ipv6.segments()[0] & 0xfe00) == 0xfc00
                        || (ipv6.segments()[0] & 0xffc0) == 0xfe80
                }
            };
        }
    }

    false
}

/// Test TCP connectivity to a host:port (no SSH) and verify SSH banner.
///
/// 探测策略（降低在线设备被误判为离线的概率）：
/// 1. TCP 连接建立即认为端口可达（首要判据）
/// 2. 尝试读取 SSH banner 作为辅助验证，但不作为硬性判据
///    原因：Windows sshd 启动慢、Defender 扫描、防火墙/代理缓冲 banner、
///    高负载连接队列拥塞等场景下 banner 可能延迟到达，严格校验会导致误判
/// 3. 超时分层：连接超时 + banner 读取超时独立计算，避免叠加截断
pub async fn test_tcp_connection(host: &str, port: u16, timeout_secs: u64) -> bool {
    use tokio::io::AsyncReadExt;
    let addr = format!("{}:{}", host, port);
    let connect_dur = Duration::from_secs(timeout_secs);

    // 第一层：TCP 连接可达性（主要判据）
    // 连接成功即认为端口开放，即使后续 banner 读取失败也不轻易判定离线
    let connect_result = timeout(connect_dur, TcpStream::connect(&addr)).await;
    let mut stream = match connect_result {
        Ok(Ok(s)) => s,
        _ => return false, // 连接超时或被拒绝，判定离线
    };

    // 第二层：尝试读取 SSH banner（辅助验证，失败不影响判定）
    // 给 2 秒读取窗口：覆盖 Windows sshd 启动慢、网络抖动等场景
    // 读取到非 SSH banner（如代理错误页）也不改判，因为 TCP 端口确实可达
    let mut buf = [0u8; 4];
    let _ = tokio::time::timeout(Duration::from_millis(2000), stream.read(&mut buf)).await;
    // 忽略读取结果：TCP 连接已建立即判定在线
    true
}
