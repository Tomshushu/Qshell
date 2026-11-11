//! FTP / FTPS 异步文件传输引擎
//!
//! 为未开启 SSH 或显式配置了 FTP / FTPS 文件传输的服务器提供完整的文件浏览、
//! 读写、目录递归上传/下载、断点续传、限速与连接测试能力。
//!
//! 支持特性：
//! - 明文 FTP（默认端口 21）
//! - 显式 FTPS（Explicit TLS，`AUTH TLS` + `PBSZ 0` + `PROT P`，默认端口 21）
//! - 隐式 FTPS（Implicit TLS，握手即 TLS，默认端口 990）
//! - 被动模式（`EPSV` / `PASV`，含 NAT 私有地址智能修正）与主动模式（`PORT`）
//! - 文件名编码转换（`UTF-8` 与 `GBK` 中文兼容）
//! - 目录列表解析（RFC 3659 `MLSD`、Unix `ls -l`、Windows IIS/DOS 列表格式）

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;

use chrono::{Datelike, Local, NaiveDateTime, TimeZone};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeekExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::client::TlsStream;
use tokio_rustls::TlsConnector;

use crate::parsers::FileEntry;

/// 服务器文件传输配置（反序列化自 `servers.file_transfer_config` JSON）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTransferConfig {
    /// 'sftp' | 'ftp' | 'ftps'
    #[serde(default = "default_ft_protocol")]
    pub protocol: String,
    /// FTP/FTPS 端口（默认 21，隐式 FTPS 默认 990）
    pub port: Option<u16>,
    /// 'explicit' | 'implicit'
    #[serde(default = "default_tls_mode")]
    pub tls_mode: String,
    /// 是否复用当前服务器的主用户名和密码（默认 true）
    #[serde(default = "default_true")]
    pub use_server_credentials: bool,
    /// 是否匿名登录 (anonymous)
    #[serde(default)]
    pub anonymous: bool,
    /// 独立 FTP 用户名
    #[serde(default)]
    pub username: String,
    /// 独立 FTP 密码
    #[serde(default)]
    pub password: String,
    /// 'passive' | 'active'
    #[serde(default = "default_transfer_mode")]
    pub transfer_mode: String,
    /// 'utf-8' | 'gbk'
    #[serde(default = "default_encoding")]
    pub encoding: String,
    /// FTPS 是否允许自签名/无效 TLS 证书（默认 true）
    #[serde(default = "default_true")]
    pub allow_invalid_certs: bool,
}

fn default_ft_protocol() -> String {
    "sftp".to_string()
}
fn default_tls_mode() -> String {
    "explicit".to_string()
}
fn default_true() -> bool {
    true
}
fn default_transfer_mode() -> String {
    "passive".to_string()
}
fn default_encoding() -> String {
    "utf-8".to_string()
}

/// 合并服务器基础信息后的完整 FTP/FTPS 连接参数
#[derive(Debug, Clone)]
pub struct ResolvedFtpConfig {
    pub host: String,
    pub port: u16,
    pub is_ftps: bool,
    pub implicit_tls: bool,
    pub username: String,
    pub password: String,
    pub passive_mode: bool,
    pub use_gbk: bool,
    pub allow_invalid_certs: bool,
    pub timeout_secs: u64,
}

/// 检查指定服务器是否启用了 FTP 或 FTPS 文件传输。
/// 若为 SFTP（默认）则返回 `Ok(None)`，调用方继续走原有 SFTP 链路。
pub async fn resolve_ftp_config_for_server(
    server_id: &str,
) -> Result<Option<ResolvedFtpConfig>, String> {
    let server = crate::commands::ssh::load_server_config(server_id).await?;
    let Some(ref raw_cfg) = server.file_transfer_config else {
        return Ok(None);
    };
    if raw_cfg.trim().is_empty() {
        return Ok(None);
    }
    let cfg: FileTransferConfig = match serde_json::from_str(raw_cfg) {
        Ok(c) => c,
        Err(_) => {
            // 全仓 18 处调用方都用 `if let Ok(Some(..))` / `.ok().flatten()` 取值，
            // 返回 Err 会被静默吞掉并回退 SFTP，等于没有修复且改变了函数契约。
            // 在不改动这 18 处业务分派、保持既有功能逻辑的前提下，只记录可诊断日志。
            // 刻意不把 serde 错误详情写进日志/返回值，避免配置里的凭据片段外泄。
            tracing::warn!(
                "[FTP] server {} 的 file_transfer_config 无法解析，已按 SFTP 处理；请重新保存该服务器的传输设置",
                server_id
            );
            return Ok(None);
        }
    };
    let proto = cfg.protocol.trim().to_ascii_lowercase();
    if proto != "ftp" && proto != "ftps" {
        return Ok(None);
    }

    let is_ftps = proto == "ftps";
    let implicit_tls = is_ftps && cfg.tls_mode.trim().eq_ignore_ascii_case("implicit");
    let default_port = if implicit_tls { 990 } else { 21 };
    let port = cfg.port.filter(|&p| p > 0).unwrap_or(default_port);

    let (username, password) = if cfg.anonymous {
        ("anonymous".to_string(), "anonymous@qshell.local".to_string())
    } else if cfg.use_server_credentials {
        (
            server.username.clone(),
            server.password.clone().unwrap_or_default(),
        )
    } else {
        let u = if cfg.username.trim().is_empty() {
            server.username.clone()
        } else {
            cfg.username.trim().to_string()
        };
        let p = if cfg.password.is_empty() {
            server.password.clone().unwrap_or_default()
        } else {
            cfg.password.clone()
        };
        (u, p)
    };

    Ok(Some(ResolvedFtpConfig {
        host: server.host.trim().to_string(),
        port,
        is_ftps,
        implicit_tls,
        username,
        password,
        passive_mode: !cfg.transfer_mode.trim().eq_ignore_ascii_case("active"),
        use_gbk: cfg.encoding.trim().eq_ignore_ascii_case("gbk"),
        allow_invalid_certs: cfg.allow_invalid_certs,
        timeout_secs: (server.connection_timeout.max(5) as u64).min(120),
    }))
}

/// 解析 JSON 字符串为 FileTransferConfig
pub fn parse_file_transfer_config(raw: &str) -> Option<FileTransferConfig> {
    if raw.trim().is_empty() {
        return None;
    }
    serde_json::from_str(raw).ok()
}

/// 判断服务器是否配置了 FTP / FTPS（轻量快速判断）
pub async fn is_ftp_backed_server(server_id: &str) -> bool {
    matches!(resolve_ftp_config_for_server(server_id).await, Ok(Some(_)))
}

// ============================================================================
// TLS 证书校验器（支持自签名证书放行）
// ============================================================================

#[derive(Debug)]
struct NoCertificateVerification;

impl ServerCertVerifier for NoCertificateVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::ECDSA_NISTP521_SHA512,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::ED25519,
        ]
    }
}

fn build_tls_connector(allow_invalid_certs: bool) -> Result<TlsConnector, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = if allow_invalid_certs {
        ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|e| format!("TLS protocol config error: {}", e))?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(NoCertificateVerification))
            .with_no_client_auth()
    } else {
        let mut root_store = RootCertStore::empty();
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|e| format!("TLS protocol config error: {}", e))?
            .with_root_certificates(root_store)
            .with_no_client_auth()
    };
    Ok(TlsConnector::from(Arc::new(config)))
}

fn parse_server_name(host: &str) -> Result<ServerName<'static>, String> {
    ServerName::try_from(host.to_string()).map_err(|e| format!("Invalid TLS host '{}': {}", host, e))
}

// ============================================================================
// 统一流封装（支持明文 TCP 与 TLS 加密流无缝切换）
// ============================================================================

enum FtpStream {
    Plain(TcpStream),
    Tls(Box<TlsStream<TcpStream>>),
}

impl AsyncRead for FtpStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match &mut *self {
            FtpStream::Plain(s) => Pin::new(s).poll_read(cx, buf),
            FtpStream::Tls(s) => Pin::new(s.as_mut()).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for FtpStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        match &mut *self {
            FtpStream::Plain(s) => Pin::new(s).poll_write(cx, buf),
            FtpStream::Tls(s) => Pin::new(s.as_mut()).poll_write(cx, buf),
        }
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match &mut *self {
            FtpStream::Plain(s) => Pin::new(s).poll_flush(cx),
            FtpStream::Tls(s) => Pin::new(s.as_mut()).poll_flush(cx),
        }
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match &mut *self {
            FtpStream::Plain(s) => Pin::new(s).poll_shutdown(cx),
            FtpStream::Tls(s) => Pin::new(s.as_mut()).poll_shutdown(cx),
        }
    }
}

// ============================================================================
// FTP 会话控制核心
// ============================================================================

pub struct FtpSession {
    cfg: ResolvedFtpConfig,
    control: Option<FtpStream>,
    peer_ip: Option<IpAddr>,
    tls_connector: Option<TlsConnector>,
    data_tls_enabled: bool,
}

impl FtpSession {
    pub async fn connect_and_login(cfg: ResolvedFtpConfig) -> Result<Self, String> {
        let timeout = Duration::from_secs(cfg.timeout_secs.max(5));
        let addr_str = format!("{}:{}", cfg.host, cfg.port);
        let tcp = tokio::time::timeout(timeout, TcpStream::connect(&addr_str))
            .await
            .map_err(|_| format!("连接 FTP 服务器 {}:{} 超时", cfg.host, cfg.port))?
            .map_err(|e| format!("无法连接到 FTP 服务器 {}:{}: {}", cfg.host, cfg.port, e))?;
        let _ = tcp.set_nodelay(true);
        let peer_ip = tcp.peer_addr().ok().map(|a| a.ip());

        let tls_connector = if cfg.is_ftps {
            Some(build_tls_connector(cfg.allow_invalid_certs)?)
        } else {
            None
        };

        let control = if cfg.is_ftps && cfg.implicit_tls {
            let connector = tls_connector.as_ref().unwrap();
            let sname = parse_server_name(&cfg.host)?;
            let tls_stream = tokio::time::timeout(timeout, connector.connect(sname, tcp))
                .await
                .map_err(|_| "隐式 FTPS TLS 握手超时".to_string())?
                .map_err(|e| format!("隐式 FTPS TLS 握手失败: {}", e))?;
            FtpStream::Tls(Box::new(tls_stream))
        } else {
            FtpStream::Plain(tcp)
        };

        let mut session = Self {
            cfg,
            control: Some(control),
            peer_ip,
            tls_connector,
            data_tls_enabled: false,
        };

        // 读取 220 欢迎横幅
        let (code, msg) = session.read_response().await?;
        if code != 220 {
            return Err(format!("FTP 服务拒绝连接 ({}): {}", code, msg.trim()));
        }

        // Explicit FTPS：发送 AUTH TLS 升级控制通道
        if session.cfg.is_ftps && !session.cfg.implicit_tls {
            session.send_cmd("AUTH TLS").await?;
            let (auth_code, auth_msg) = session.read_response().await?;
            if auth_code != 234 {
                return Err(format!(
                    "FTP 服务端不支持显式 TLS (AUTH TLS 返回 {}: {})",
                    auth_code,
                    auth_msg.trim()
                ));
            }
            let plain = match session.control.take() {
                Some(FtpStream::Plain(tcp)) => tcp,
                _ => return Err("升级控制流状态异常".to_string()),
            };
            let connector = session.tls_connector.as_ref().unwrap();
            let sname = parse_server_name(&session.cfg.host)?;
            let tls_stream = tokio::time::timeout(timeout, connector.connect(sname, plain))
                .await
                .map_err(|_| "显式 FTPS TLS 握手超时".to_string())?
                .map_err(|e| format!("显式 FTPS TLS 握手失败: {}", e))?;
            session.control = Some(FtpStream::Tls(Box::new(tls_stream)));
        }

        // 登录 USER / PASS
        session
            .send_cmd(&format!("USER {}", session.cfg.username))
            .await?;
        let (u_code, u_msg) = session.read_response().await?;
        if u_code == 331 || u_code == 332 {
            session
                .send_cmd(&format!("PASS {}", session.cfg.password))
                .await?;
            let (p_code, p_msg) = session.read_response().await?;
            if p_code != 230 && p_code != 202 {
                return Err(format!("FTP 认证失败 ({}): {}", p_code, p_msg.trim()));
            }
        } else if u_code != 230 && u_code != 202 {
            return Err(format!("FTP 用户名被拒绝 ({}): {}", u_code, u_msg.trim()));
        }

        // FTPS 开启数据通道加密：PBSZ 0 + PROT P
        if session.cfg.is_ftps {
            session.send_cmd("PBSZ 0").await?;
            let _ = session.read_response().await?;
            session.send_cmd("PROT P").await?;
            let (prot_code, _) = session.read_response().await?;
            if prot_code == 200 {
                session.data_tls_enabled = true;
            }
        }

        // UTF-8 模式协商与二进制传输模式 TYPE I
        if !session.cfg.use_gbk {
            session.send_cmd("OPTS UTF8 ON").await?;
            let _ = session.read_response().await;
        }
        session.send_cmd("TYPE I").await?;
        let _ = session.read_response().await?;

        Ok(session)
    }

    fn encode_str(&self, s: &str) -> Vec<u8> {
        if self.cfg.use_gbk {
            let (cow, _, _) = encoding_rs::GBK.encode(s);
            cow.into_owned()
        } else {
            s.as_bytes().to_vec()
        }
    }

    fn decode_bytes(&self, bytes: &[u8]) -> String {
        if self.cfg.use_gbk {
            let (cow, _, _) = encoding_rs::GBK.decode(bytes);
            cow.into_owned()
        } else {
            match std::str::from_utf8(bytes) {
                Ok(s) => s.to_string(),
                Err(_) => {
                    // 自动回退 GBK 解码，避免中文 Windows FTP 服务器乱码
                    let (cow, _, _) = encoding_rs::GBK.decode(bytes);
                    cow.into_owned()
                }
            }
        }
    }

    async fn send_cmd(&mut self, cmd: &str) -> Result<(), String> {
        let mut payload = self.encode_str(cmd);
        payload.extend_from_slice(b"\r\n");
        let timeout = Duration::from_secs(self.cfg.timeout_secs.max(5));
        let stream = self
            .control
            .as_mut()
            .ok_or_else(|| "FTP 控制通道已关闭".to_string())?;
        tokio::time::timeout(timeout, stream.write_all(&payload))
            .await
            .map_err(|_| "发送 FTP 指令超时".to_string())?
            .map_err(|e| format!("发送 FTP 指令失败: {}", e))?;
        tokio::time::timeout(timeout, stream.flush())
            .await
            .map_err(|_| "刷新 FTP 指令超时".to_string())?
            .map_err(|e| format!("刷新 FTP 指令失败: {}", e))
    }

    async fn read_line_raw(&mut self) -> Result<Vec<u8>, String> {
        let timeout = Duration::from_secs(self.cfg.timeout_secs.max(10));
        let stream = self
            .control
            .as_mut()
            .ok_or_else(|| "FTP 控制通道已关闭".to_string())?;
        let mut line = Vec::with_capacity(128);
        let mut byte = [0u8; 1];
        loop {
            let n = tokio::time::timeout(timeout, stream.read(&mut byte))
                .await
                .map_err(|_| "等待 FTP 响应超时".to_string())?
                .map_err(|e| format!("读取 FTP 响应失败: {}", e))?;
            if n == 0 {
                if line.is_empty() {
                    return Err("FTP 连接已被服务端断开 (EOF)".to_string());
                }
                break;
            }
            line.push(byte[0]);
            if byte[0] == b'\n' || line.len() > 16384 {
                break;
            }
        }
        Ok(line)
    }

    async fn read_response(&mut self) -> Result<(u16, String), String> {
        let mut full_msg = String::new();
        let mut expected_code: Option<u16> = None;
        // 多行响应的累积总量必须有上限（单行上限只约束单行），
        // 否则持续输出非终止格式的服务端会让缓冲无界增长。
        const MAX_RESPONSE_BYTES: usize = 1024 * 1024;

        loop {
            let raw = self.read_line_raw().await?;
            let line = self.decode_bytes(&raw);
            if full_msg.len() + line.len() > MAX_RESPONSE_BYTES {
                return Err("FTP 响应超过安全上限，已中止读取".to_string());
            }
            full_msg.push_str(&line);

            let bytes = line.as_bytes();
            if bytes.len() >= 4
                && bytes[0].is_ascii_digit()
                && bytes[1].is_ascii_digit()
                && bytes[2].is_ascii_digit()
            {
                let code: u16 = std::str::from_utf8(&bytes[0..3])
                    .unwrap_or("0")
                    .parse()
                    .unwrap_or(0);
                let sep = bytes[3];
                if expected_code.is_none() {
                    if sep == b' ' {
                        return Ok((code, full_msg));
                    } else if sep == b'-' {
                        expected_code = Some(code);
                    }
                } else if Some(code) == expected_code && sep == b' ' {
                    return Ok((code, full_msg));
                }
            }
        }
    }

    /// 打开一个数据通道并执行触发指令（如 `LIST`、`RETR`、`STOR`、`APPE`）
    async fn open_data_stream(&mut self, cmd: &str) -> Result<FtpStream, String> {
        let timeout = Duration::from_secs(self.cfg.timeout_secs.max(10));
        if self.cfg.passive_mode {
            // 优先尝试 EPSV（兼容 IPv4/IPv6），失败则回退 PASV
            let data_addr = match self.negotiate_epsv().await {
                Ok(addr) => addr,
                Err(_) => self.negotiate_pasv().await?,
            };
            let tcp = tokio::time::timeout(timeout, TcpStream::connect(data_addr))
                .await
                .map_err(|_| format!("连接 FTP 数据端口 {} 超时", data_addr))?
                .map_err(|e| format!("连接 FTP 数据端口 {} 失败: {}", data_addr, e))?;
            let _ = tcp.set_nodelay(true);

            self.send_cmd(cmd).await?;
            let (code, msg) = self.read_response().await?;
            if code != 150 && code != 125 {
                return Err(format!("FTP 数据通道指令被拒绝 ({}): {}", code, msg.trim()));
            }

            if self.data_tls_enabled {
                let connector = self
                    .tls_connector
                    .as_ref()
                    .ok_or_else(|| "FTPS 缺少 TLS 连接器".to_string())?;
                let sname = parse_server_name(&self.cfg.host)?;
                let tls_stream = tokio::time::timeout(timeout, connector.connect(sname, tcp))
                    .await
                    .map_err(|_| "FTPS 数据通道 TLS 握手超时".to_string())?
                    .map_err(|e| format!("FTPS 数据通道 TLS 握手失败: {}", e))?;
                Ok(FtpStream::Tls(Box::new(tls_stream)))
            } else {
                Ok(FtpStream::Plain(tcp))
            }
        } else {
            // 主动模式 PORT
            let local_ip = match self
                .control
                .as_ref()
                .and_then(|s| match s {
                    FtpStream::Plain(t) => t.local_addr().ok(),
                    FtpStream::Tls(t) => t.get_ref().0.local_addr().ok(),
                })
                .map(|a| a.ip())
            {
                Some(IpAddr::V4(ip)) => ip,
                _ => Ipv4Addr::new(127, 0, 0, 1),
            };
            let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(local_ip), 0))
                .await
                .map_err(|e| format!("主动模式绑定本地端口失败: {}", e))?;
            let bound = listener
                .local_addr()
                .map_err(|e| format!("获取本地端口失败: {}", e))?;
            let octets = local_ip.octets();
            let p1 = bound.port() / 256;
            let p2 = bound.port() % 256;
            let port_cmd = format!(
                "PORT {},{},{},{},{},{}",
                octets[0], octets[1], octets[2], octets[3], p1, p2
            );
            self.send_cmd(&port_cmd).await?;
            let (p_code, p_msg) = self.read_response().await?;
            if p_code != 200 {
                return Err(format!("FTP PORT 主动模式失败 ({}): {}", p_code, p_msg.trim()));
            }

            self.send_cmd(cmd).await?;
            let (code, msg) = self.read_response().await?;
            if code != 150 && code != 125 {
                return Err(format!("FTP 数据通道指令被拒绝 ({}): {}", code, msg.trim()));
            }

            let (tcp, _) = tokio::time::timeout(timeout, listener.accept())
                .await
                .map_err(|_| "等待 FTP 服务端主动连接超时".to_string())?
                .map_err(|e| format!("接受 FTP 服务端连接失败: {}", e))?;
            let _ = tcp.set_nodelay(true);

            if self.data_tls_enabled {
                let connector = self
                    .tls_connector
                    .as_ref()
                    .ok_or_else(|| "FTPS 缺少 TLS 连接器".to_string())?;
                let sname = parse_server_name(&self.cfg.host)?;
                let tls_stream = tokio::time::timeout(timeout, connector.connect(sname, tcp))
                    .await
                    .map_err(|_| "FTPS 数据通道 TLS 握手超时".to_string())?
                    .map_err(|e| format!("FTPS 数据通道 TLS 握手失败: {}", e))?;
                Ok(FtpStream::Tls(Box::new(tls_stream)))
            } else {
                Ok(FtpStream::Plain(tcp))
            }
        }
    }

    async fn negotiate_epsv(&mut self) -> Result<SocketAddr, String> {
        self.send_cmd("EPSV").await?;
        let (code, msg) = self.read_response().await?;
        if code != 229 {
            return Err(format!("EPSV unsupported ({})", code));
        }
        // 解析 (|||port|)
        let start = msg.find("(|").ok_or_else(|| "Invalid EPSV response".to_string())?;
        let end = msg[start..].find("|)").ok_or_else(|| "Invalid EPSV response".to_string())?;
        let inner = &msg[start + 1..start + end + 1];
        let parts: Vec<&str> = inner.split('|').collect();
        if parts.len() < 4 {
            return Err("Malformed EPSV port".to_string());
        }
        let port: u16 = parts[3]
            .trim()
            .parse()
            .map_err(|_| "Invalid EPSV port number".to_string())?;
        let ip = self
            .peer_ip
            .unwrap_or(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)));
        Ok(SocketAddr::new(ip, port))
    }

    async fn negotiate_pasv(&mut self) -> Result<SocketAddr, String> {
        self.send_cmd("PASV").await?;
        let (code, msg) = self.read_response().await?;
        if code != 227 {
            return Err(format!("PASV 失败 ({}): {}", code, msg.trim()));
        }
        // 解析 (h1,h2,h3,h4,p1,p2)
        let open = msg
            .find('(')
            .ok_or_else(|| format!("无法解析 PASV 响应: {}", msg.trim()))?;
        let close = msg[open..]
            .find(')')
            .ok_or_else(|| format!("无法解析 PASV 响应: {}", msg.trim()))?;
        let nums: Vec<u16> = msg[open + 1..open + close]
            .split(',')
            .filter_map(|s| s.trim().parse::<u16>().ok())
            .collect();
        if nums.len() != 6 {
            return Err(format!("PASV 地址格式无效: {}", msg.trim()));
        }
        let pasv_ip = Ipv4Addr::new(
            nums[0] as u8,
            nums[1] as u8,
            nums[2] as u8,
            nums[3] as u8,
        );
        let port = nums[4] * 256 + nums[5];

        // 智能 NAT 私有地址覆盖（对齐 FileZilla / WinSCP 行为）：
        // 云服务器位于 VPC/NAT 之后时，默认往往会返回其内网私有 IP（如 10.x.x.x、172.16-31.x.x、192.168.x.x）。
        // 如果客户端是通过公网 IP 连接的，服务端私有 IP 客户端根本不可达，因此一律回退使用控制通道的连接对端 IP。
        let final_ip = if pasv_ip.is_unspecified()
            || pasv_ip.is_private()
            || (pasv_ip.is_loopback()
                && self.peer_ip.is_some_and(|p| !p.is_loopback()))
        {
            self.peer_ip.unwrap_or(IpAddr::V4(pasv_ip))
        } else {
            IpAddr::V4(pasv_ip)
        };
        Ok(SocketAddr::new(final_ip, port))
    }

    async fn finish_data_transfer(&mut self, mut data_stream: FtpStream) -> Result<(), String> {
        let _ = data_stream.shutdown().await;
        drop(data_stream);
        let (code, msg) = self.read_response().await?;
        if code == 226 || code == 250 {
            Ok(())
        } else {
            Err(format!("FTP 数据传输未正常完成 ({}): {}", code, msg.trim()))
        }
    }

    pub async fn pwd(&mut self) -> Result<String, String> {
        self.send_cmd("PWD").await?;
        let (code, msg) = self.read_response().await?;
        if code != 257 {
            return Err(format!("PWD 失败 ({}): {}", code, msg.trim()));
        }
        if let Some(first_quote) = msg.find('"') {
            if let Some(second_quote) = msg[first_quote + 1..].find('"') {
                return Ok(msg[first_quote + 1..first_quote + 1 + second_quote].to_string());
            }
        }
        Ok("/".to_string())
    }

    pub async fn quit(&mut self) {
        let _ = self.send_cmd("QUIT").await;
    }
}

// ============================================================================
// 目录列表解析（MLSD / Unix ls -l / Windows IIS DOS）
// ============================================================================

fn normalize_ftp_path(dir: &str, name: &str) -> String {
    let base = dir.replace('\\', "/").trim_end_matches('/').to_string();
    if base.is_empty() || base == "/" {
        format!("/{}", name.trim_start_matches('/'))
    } else if base.starts_with('/') {
        format!("{}/{}", base, name.trim_start_matches('/'))
    } else {
        format!("/{}/{}", base, name.trim_start_matches('/'))
    }
}

fn parse_mlsd_line(dir: &str, line: &str) -> Option<FileEntry> {
    let line = line.trim_end_matches(['\r', '\n']);
    let space_idx = line.find(' ')?;
    let facts_str = &line[..space_idx];
    let name = line[space_idx + 1..].trim();
    if name.is_empty() || name == "." || name == ".." {
        return None;
    }

    let mut is_dir = false;
    let mut is_symlink = false;
    let mut size: i64 = 0;
    let mut modified_time = String::new();
    let mut permissions = "---------".to_string();

    for fact in facts_str.split(';') {
        if let Some((k, v)) = fact.split_once('=') {
            match k.to_ascii_lowercase().as_str() {
                "type" => {
                    let vl = v.to_ascii_lowercase();
                    if vl == "dir" {
                        is_dir = true;
                    } else if vl == "cdir" || vl == "pdir" {
                        return None;
                    } else if vl.contains("os.unix=symlink") || vl == "symlink" {
                        is_symlink = true;
                    }
                }
                "size" | "sizd" => {
                    size = v.parse::<i64>().unwrap_or(0);
                }
                "modify" => {
                    if v.len() >= 14 {
                        if let Ok(naive) = NaiveDateTime::parse_from_str(&v[..14], "%Y%m%d%H%M%S") {
                            let local_dt = Local.from_utc_datetime(&naive);
                            modified_time = local_dt.format("%Y-%m-%d %H:%M:%S").to_string();
                        }
                    }
                }
                "unix.mode" => {
                    if let Ok(mode_num) = u32::from_str_radix(v.trim_start_matches('0'), 8) {
                        permissions = format_unix_mode(mode_num, is_dir, is_symlink);
                    }
                }
                _ => {}
            }
        }
    }

    if permissions == "---------" {
        permissions = if is_dir {
            "drwxr-xr-x".to_string()
        } else {
            "-rw-r--r--".to_string()
        };
    }

    Some(FileEntry {
        name: name.to_string(),
        path: normalize_ftp_path(dir, name),
        is_directory: is_dir,
        is_symlink,
        size,
        modified_time,
        permissions,
        owner: String::new(),
        group: String::new(),
        uid: None,
        gid: None,
    })
}

fn format_unix_mode(mode: u32, is_dir: bool, is_symlink: bool) -> String {
    let typ = if is_symlink {
        'l'
    } else if is_dir {
        'd'
    } else {
        '-'
    };
    let triplet = |n: u32| -> String {
        let mut s = String::with_capacity(3);
        s.push(if n & 4 != 0 { 'r' } else { '-' });
        s.push(if n & 2 != 0 { 'w' } else { '-' });
        s.push(if n & 1 != 0 { 'x' } else { '-' });
        s
    };
    format!(
        "{}{}{}{}",
        typ,
        triplet((mode >> 6) & 7),
        triplet((mode >> 3) & 7),
        triplet(mode & 7)
    )
}

fn parse_list_line(dir: &str, line: &str) -> Option<FileEntry> {
    let line = line.trim_end_matches(['\r', '\n']).trim_start();
    if line.is_empty() || line.starts_with("total ") {
        return None;
    }

    // 1. Windows IIS / DOS 风格: "08-11-26  02:30PM       <DIR>           FolderName"
    if line.as_bytes()[0].is_ascii_digit() {
        let mut parts = line.split_whitespace();
        let date_part = parts.next()?;
        let time_part = parts.next()?;
        let dir_or_size = parts.next()?;
        // 定位第 3 个字段之后的文件名起始位置
        let after_first = line.find(date_part)? + date_part.len();
        let after_second = after_first + line[after_first..].find(time_part)? + time_part.len();
        let after_third =
            after_second + line[after_second..].find(dir_or_size)? + dir_or_size.len();
        let name = line[after_third..].trim();
        if name.is_empty() || name == "." || name == ".." {
            return None;
        }
        let is_dir = dir_or_size.eq_ignore_ascii_case("<DIR>");
        let size = if is_dir {
            0
        } else {
            dir_or_size.parse::<i64>().unwrap_or(0)
        };
        return Some(FileEntry {
            name: name.to_string(),
            path: normalize_ftp_path(dir, name),
            is_directory: is_dir,
            is_symlink: false,
            size,
            modified_time: format!("{} {}", date_part, time_part),
            permissions: if is_dir {
                "drwxr-xr-x".to_string()
            } else {
                "-rw-r--r--".to_string()
            },
            owner: String::new(),
            group: String::new(),
            uid: None,
            gid: None,
        });
    }

    // 2. Unix ls -l 风格: "drwxr-xr-x 2 root root 4096 Nov 08 14:20 filename"
    let mut tokens = Vec::with_capacity(9);
    let mut idx = 0;
    let bytes = line.as_bytes();
    while tokens.len() < 8 && idx < bytes.len() {
        while idx < bytes.len() && bytes[idx].is_ascii_whitespace() {
            idx += 1;
        }
        if idx >= bytes.len() {
            break;
        }
        let start = idx;
        while idx < bytes.len() && !bytes[idx].is_ascii_whitespace() {
            idx += 1;
        }
        tokens.push(&line[start..idx]);
    }
    while idx < bytes.len() && bytes[idx].is_ascii_whitespace() {
        idx += 1;
    }
    if tokens.len() < 8 || idx >= bytes.len() {
        return None;
    }

    let perms = tokens[0];
    let owner = tokens[2].to_string();
    let group = tokens[3].to_string();
    let size = tokens[4].parse::<i64>().unwrap_or(0);
    let month_str = tokens[5];
    let day_str = tokens[6];
    let time_or_year = tokens[7];
    let raw_name = &line[idx..];

    let is_dir = perms.starts_with('d');
    let is_symlink = perms.starts_with('l');
    let name = if is_symlink {
        raw_name
            .split(" -> ")
            .next()
            .unwrap_or(raw_name)
            .trim()
            .to_string()
    } else {
        raw_name.to_string()
    };

    if name.is_empty() || name == "." || name == ".." {
        return None;
    }

    let modified_time = format_ls_date(month_str, day_str, time_or_year);
    Some(FileEntry {
        name: name.clone(),
        path: normalize_ftp_path(dir, &name),
        is_directory: is_dir,
        is_symlink,
        size,
        modified_time,
        permissions: perms.chars().take(10).collect(),
        owner,
        group,
        uid: None,
        gid: None,
    })
}

fn format_ls_date(month: &str, day: &str, time_or_year: &str) -> String {
    let m = match month.to_ascii_lowercase().as_str() {
        "jan" => 1,
        "feb" => 2,
        "mar" => 3,
        "apr" => 4,
        "may" => 5,
        "jun" => 6,
        "jul" => 7,
        "aug" => 8,
        "sep" => 9,
        "oct" => 10,
        "nov" => 11,
        "dec" => 12,
        _ => return format!("{} {} {}", month, day, time_or_year),
    };
    let d: u32 = day.parse().unwrap_or(1);
    let current_year = Local::now().year();
    if time_or_year.contains(':') {
        format!("{:04}-{:02}-{:02} {}:00", current_year, m, d, time_or_year)
    } else {
        let y: i32 = time_or_year.parse().unwrap_or(current_year);
        format!("{:04}-{:02}-{:02} 00:00:00", y, m, d)
    }
}

// ============================================================================
// 高层文件操作 API（与 SFTP 行为对齐）
// ============================================================================

/// 测试 FTP / FTPS 连接与登录认证
pub async fn ftp_test_connection(cfg: ResolvedFtpConfig) -> Result<String, String> {
    let proto_label = if cfg.is_ftps {
        if cfg.implicit_tls {
            "FTPS (隐式 TLS)"
        } else {
            "FTPS (显式 TLS)"
        }
    } else {
        "FTP"
    };
    let mut session = FtpSession::connect_and_login(cfg).await?;
    let pwd = session.pwd().await.unwrap_or_else(|_| "/".to_string());
    session.quit().await;
    Ok(format!("{} 连接与登录成功（当前目录: {}）", proto_label, pwd))
}

/// 列出远程目录内容
pub async fn ftp_list_dir(cfg: ResolvedFtpConfig, dir_path: &str) -> Result<Vec<FileEntry>, String> {
    let mut session = FtpSession::connect_and_login(cfg).await?;
    let target_dir = if dir_path.trim().is_empty() {
        "/"
    } else {
        dir_path.trim()
    };

    // 先 CWD 进入目标目录，避免部分 FTP 服务端不支持带空格路径参数的 LIST
    session.send_cmd(&format!("CWD {}", target_dir)).await?;
    let (cwd_code, cwd_msg) = session.read_response().await?;
    if cwd_code != 250 && cwd_code != 200 {
        session.quit().await;
        return Err(format!("无法进入目录 '{}' ({}): {}", target_dir, cwd_code, cwd_msg.trim()));
    }

    // 优先尝试标准化的 MLSD，若不支持（500/502）则回退 LIST -la / LIST
    let mut entries = Vec::new();
    let mlsd_res = session.open_data_stream("MLSD").await;
    match mlsd_res {
        Ok(mut stream) => {
            let mut buf = Vec::new();
            // 目录列表数据量完全由远端决定，必须限长，避免超大目录撑爆内存
            const MAX_DIR_LISTING_BYTES: u64 = 64 * 1024 * 1024;
            let _ = (&mut stream)
                .take(MAX_DIR_LISTING_BYTES)
                .read_to_end(&mut buf)
                .await;
            let _ = session.finish_data_transfer(stream).await;
            let text = session.decode_bytes(&buf);
            for line in text.lines() {
                if let Some(entry) = parse_mlsd_line(target_dir, line) {
                    entries.push(entry);
                }
            }
        }
        Err(_) => {
            let mut stream = match session.open_data_stream("LIST -la").await {
                Ok(s) => s,
                Err(_) => session.open_data_stream("LIST").await?,
            };
            let mut buf = Vec::new();
            // 目录列表数据量完全由远端决定，必须限长，避免超大目录撑爆内存
            const MAX_DIR_LISTING_BYTES: u64 = 64 * 1024 * 1024;
            let _ = (&mut stream)
                .take(MAX_DIR_LISTING_BYTES)
                .read_to_end(&mut buf)
                .await;
            let _ = session.finish_data_transfer(stream).await;
            let text = session.decode_bytes(&buf);
            for line in text.lines() {
                if let Some(entry) = parse_list_line(target_dir, line) {
                    entries.push(entry);
                }
            }
        }
    }

    session.quit().await;
    Ok(entries)
}

/// 读取远程文件原始字节（最大 10MB）
pub async fn ftp_read_bytes(
    cfg: ResolvedFtpConfig,
    remote_path: &str,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    let mut session = FtpSession::connect_and_login(cfg).await?;
    let mut stream = session
        .open_data_stream(&format!("RETR {}", remote_path))
        .await?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 32768];
    loop {
        let n = stream
            .read(&mut chunk)
            .await
            .map_err(|e| format!("FTP 读取文件失败: {}", e))?;
        if n == 0 {
            break;
        }
        if buf.len() + n > max_bytes {
            return Err(format!("文件超过在线读取上限 ({} 字节)", max_bytes));
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    session.finish_data_transfer(stream).await?;
    session.quit().await;
    Ok(buf)
}

/// 写入远程文件原始字节
pub async fn ftp_write_bytes(
    cfg: ResolvedFtpConfig,
    remote_path: &str,
    content: &[u8],
) -> Result<(), String> {
    let mut session = FtpSession::connect_and_login(cfg).await?;
    let mut stream = session
        .open_data_stream(&format!("STOR {}", remote_path))
        .await?;
    stream
        .write_all(content)
        .await
        .map_err(|e| format!("FTP 写入文件失败: {}", e))?;
    stream
        .flush()
        .await
        .map_err(|e| format!("FTP 刷新文件失败: {}", e))?;
    session.finish_data_transfer(stream).await?;
    session.quit().await;
    Ok(())
}

/// 创建远程目录
pub async fn ftp_mkdir(cfg: ResolvedFtpConfig, remote_path: &str) -> Result<(), String> {
    let mut session = FtpSession::connect_and_login(cfg).await?;
    session.send_cmd(&format!("MKD {}", remote_path)).await?;
    let (code, msg) = session.read_response().await?;
    session.quit().await;
    if code == 257 || code == 250 || code == 200 {
        Ok(())
    } else {
        Err(format!("创建目录失败 ({}): {}", code, msg.trim()))
    }
}

/// 删除远程文件或目录（支持非空目录递归删除）
pub async fn ftp_delete(cfg: ResolvedFtpConfig, remote_path: &str) -> Result<(), String> {
    if crate::files::remote::is_dangerous_root_path(remote_path) {
        return Err("拒绝删除系统根路径".to_string());
    }
    let mut session = FtpSession::connect_and_login(cfg.clone()).await?;
    // 先尝试按文件删除 DELE
    session.send_cmd(&format!("DELE {}", remote_path)).await?;
    let (code, _) = session.read_response().await?;
    if code == 250 || code == 200 {
        session.quit().await;
        return Ok(());
    }
    session.quit().await;

    // 若非普通文件，递归删除目录
    ftp_delete_dir_recursive(&cfg, remote_path, 0).await
}

async fn ftp_delete_dir_recursive(
    cfg: &ResolvedFtpConfig,
    dir_path: &str,
    depth: usize,
) -> Result<(), String> {
    if depth > 64 {
        return Err("目录递归深度超过上限".to_string());
    }
    if let Ok(entries) = ftp_list_dir(cfg.clone(), dir_path).await {
        for entry in entries {
            if entry.is_directory {
                Box::pin(ftp_delete_dir_recursive(cfg, &entry.path, depth + 1)).await?;
            } else {
                let mut s = FtpSession::connect_and_login(cfg.clone()).await?;
                s.send_cmd(&format!("DELE {}", entry.path)).await?;
                let _ = s.read_response().await;
                s.quit().await;
            }
        }
    }
    let mut session = FtpSession::connect_and_login(cfg.clone()).await?;
    session.send_cmd(&format!("RMD {}", dir_path)).await?;
    let (code, msg) = session.read_response().await?;
    session.quit().await;
    if code == 250 || code == 200 {
        Ok(())
    } else {
        Err(format!("删除失败 ({}): {}", code, msg.trim()))
    }
}

/// 重命名远程文件或目录（RNFR + RNTO）
pub async fn ftp_rename(
    cfg: ResolvedFtpConfig,
    old_path: &str,
    new_path: &str,
) -> Result<(), String> {
    let mut session = FtpSession::connect_and_login(cfg).await?;
    session.send_cmd(&format!("RNFR {}", old_path)).await?;
    let (c1, m1) = session.read_response().await?;
    if c1 != 350 {
        session.quit().await;
        return Err(format!("重命名源路径失败 ({}): {}", c1, m1.trim()));
    }
    session.send_cmd(&format!("RNTO {}", new_path)).await?;
    let (c2, m2) = session.read_response().await?;
    session.quit().await;
    if c2 == 250 || c2 == 200 {
        Ok(())
    } else {
        Err(format!("重命名目标路径失败 ({}): {}", c2, m2.trim()))
    }
}

/// 修改远程文件权限（SITE CHMOD）
pub async fn ftp_set_permissions(
    cfg: ResolvedFtpConfig,
    remote_path: &str,
    mode: &str,
) -> Result<String, String> {
    let mut session = FtpSession::connect_and_login(cfg).await?;
    session
        .send_cmd(&format!("SITE CHMOD {} {}", mode, remote_path))
        .await?;
    let (code, msg) = session.read_response().await?;
    session.quit().await;
    if code == 200 || code == 250 {
        Ok(msg)
    } else {
        Err(format!("FTP 服务端不支持修改权限 ({}): {}", code, msg.trim()))
    }
}

/// 查询远程文件大小与是否为目录
pub async fn ftp_stat_basic(
    cfg: &ResolvedFtpConfig,
    remote_path: &str,
) -> Result<(bool, u64), String> {
    let mut session = FtpSession::connect_and_login(cfg.clone()).await?;
    // 先尝试 CWD 判断是否为目录
    session.send_cmd(&format!("CWD {}", remote_path)).await?;
    let (cwd_code, _) = session.read_response().await?;
    if cwd_code == 250 || cwd_code == 200 {
        session.quit().await;
        return Ok((true, 0));
    }
    // 普通文件：通过 SIZE 获取字节数
    session.send_cmd(&format!("SIZE {}", remote_path)).await?;
    let (sz_code, sz_msg) = session.read_response().await?;
    session.quit().await;
    if sz_code == 213 {
        let size = sz_msg
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        Ok((false, size))
    } else {
        Ok((false, 0))
    }
}

/// 获取远程文件详细属性 JSON
pub async fn ftp_stat_info(cfg: ResolvedFtpConfig, remote_path: &str) -> Result<String, String> {
    let (is_dir, size) = ftp_stat_basic(&cfg, remote_path).await?;
    let result = serde_json::json!({
        "type": if is_dir { "directory" } else { "regular file" },
        "size": size,
        "mode": if is_dir { "755" } else { "644" },
        "owner": "",
        "group": "",
        "modifiedTime": "",
        "accessTime": "",
        "inode": 0,
        "links": 1,
        "isSymlink": false,
        "symlinkTarget": serde_json::Value::Null,
    });
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// 下载单个文件（支持 REST 断点续传、限速与取消标志）
pub async fn ftp_download_file(
    cfg: &ResolvedFtpConfig,
    remote_path: &str,
    local_path: &str,
    tmp_local_path: &str,
    resume_offset: Option<u64>,
    on_progress: impl Fn(u64, u64),
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<(), String> {
    let (_, total_size) = ftp_stat_basic(cfg, remote_path).await.unwrap_or((false, 0));
    let mut session = FtpSession::connect_and_login(cfg.clone()).await?;

    let offset = resume_offset.unwrap_or(0);
    if offset > 0 {
        session.send_cmd(&format!("REST {}", offset)).await?;
        let (r_code, _) = session.read_response().await?;
        if r_code != 350 {
            return Err("FTP 服务端不支持断点续传 (REST)".to_string());
        }
    }

    let mut data_stream = session
        .open_data_stream(&format!("RETR {}", remote_path))
        .await?;

    let mut local_file = if offset > 0 {
        let mut f = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .open(tmp_local_path)
            .await
            .map_err(|e| format!("打开本地临时文件失败: {}", e))?;
        f.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|e| format!("定位本地临时文件失败: {}", e))?;
        f
    } else {
        if let Some(parent) = std::path::Path::new(tmp_local_path).parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        tokio::fs::File::create(tmp_local_path)
            .await
            .map_err(|e| format!("创建本地临时文件失败: {}", e))?
    };

    let mut transferred = offset;
    on_progress(transferred, total_size);
    let mut buf = vec![0u8; 64 * 1024];
    let mut last_emit = std::time::Instant::now();

    loop {
        if let Some(flag) = cancel {
            if flag.load(Ordering::Relaxed) {
                session.quit().await;
                return Err("Transfer canceled by user".to_string());
            }
        }
        let n = data_stream
            .read(&mut buf)
            .await
            .map_err(|e| format!("FTP 读取数据失败: {}", e))?;
        if n == 0 {
            break;
        }
        crate::ssh::rate_limiter::GLOBAL_RATE_LIMITER
            .acquire(n as u64)
            .await;
        local_file
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("写入本地文件失败: {}", e))?;
        transferred += n as u64;
        if last_emit.elapsed() >= Duration::from_millis(180) || transferred == total_size {
            on_progress(transferred, total_size.max(transferred));
            last_emit = std::time::Instant::now();
        }
    }

    local_file
        .flush()
        .await
        .map_err(|e| format!("刷新本地文件失败: {}", e))?;
    drop(local_file);

    let _ = session.finish_data_transfer(data_stream).await;
    session.quit().await;

    if tokio::fs::metadata(local_path).await.is_ok() {
        let _ = tokio::fs::remove_file(local_path).await;
    }
    tokio::fs::rename(tmp_local_path, local_path)
        .await
        .map_err(|e| format!("重命名本地目标文件失败: {}", e))?;

    on_progress(transferred, total_size.max(transferred));
    Ok(())
}

/// 上传单个文件（支持 APPE 临时文件续传、限速与取消标志）
pub async fn ftp_upload_file(
    cfg: &ResolvedFtpConfig,
    local_path: &str,
    remote_path: &str,
    tmp_remote_path: &str,
    resume_offset: Option<u64>,
    on_progress: impl Fn(u64, u64),
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<(), String> {
    let meta = tokio::fs::metadata(local_path)
        .await
        .map_err(|e| format!("无法读取本地文件 '{}': {}", local_path, e))?;
    let total_size = meta.len();

    let mut local_file = tokio::fs::File::open(local_path)
        .await
        .map_err(|e| format!("无法打开本地文件 '{}': {}", local_path, e))?;

    let offset = resume_offset.unwrap_or(0).min(total_size);
    if offset > 0 {
        local_file
            .seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|e| format!("定位本地文件失败: {}", e))?;
    }

    let mut session = FtpSession::connect_and_login(cfg.clone()).await?;
    let cmd = if offset > 0 {
        format!("APPE {}", tmp_remote_path)
    } else {
        format!("STOR {}", tmp_remote_path)
    };
    let mut data_stream = session.open_data_stream(&cmd).await?;

    let mut transferred = offset;
    on_progress(transferred, total_size);
    let mut buf = vec![0u8; 64 * 1024];
    let mut last_emit = std::time::Instant::now();

    loop {
        if let Some(flag) = cancel {
            if flag.load(Ordering::Relaxed) {
                session.quit().await;
                return Err("Transfer canceled by user".to_string());
            }
        }
        let n = local_file
            .read(&mut buf)
            .await
            .map_err(|e| format!("读取本地文件失败: {}", e))?;
        if n == 0 {
            break;
        }
        crate::ssh::rate_limiter::GLOBAL_RATE_LIMITER
            .acquire(n as u64)
            .await;
        data_stream
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("FTP 发送数据失败: {}", e))?;
        transferred += n as u64;
        if last_emit.elapsed() >= Duration::from_millis(180) || transferred == total_size {
            on_progress(transferred, total_size);
            last_emit = std::time::Instant::now();
        }
    }

    data_stream
        .flush()
        .await
        .map_err(|e| format!("FTP 刷新数据流失败: {}", e))?;
    session.finish_data_transfer(data_stream).await?;

    if tmp_remote_path != remote_path {
        // 先尝试重命名；若目标已存在导致 RNTO 失败，先 DELE 目标再重命名
        session.send_cmd(&format!("RNFR {}", tmp_remote_path)).await?;
        let (c1, m1) = session.read_response().await?;
        if c1 == 350 {
            session.send_cmd(&format!("RNTO {}", remote_path)).await?;
            let (c2, _) = session.read_response().await?;
            if c2 != 250 && c2 != 200 {
                let _ = session.send_cmd(&format!("DELE {}", remote_path)).await;
                let _ = session.read_response().await;
                session.send_cmd(&format!("RNFR {}", tmp_remote_path)).await?;
                let _ = session.read_response().await;
                session.send_cmd(&format!("RNTO {}", remote_path)).await?;
                let (c3, m3) = session.read_response().await?;
                if c3 != 250 && c3 != 200 {
                    session.quit().await;
                    return Err(format!("FTP 重命名临时文件失败 ({}): {}", c3, m3.trim()));
                }
            }
        } else {
            session.quit().await;
            return Err(format!("FTP 定位临时文件失败 ({}): {}", c1, m1.trim()));
        }
    }

    session.quit().await;
    on_progress(total_size, total_size);
    Ok(())
}

/// 递归下载远程目录
pub async fn ftp_download_dir_recursive(
    cfg: &ResolvedFtpConfig,
    remote_dir: &str,
    local_dir: &str,
    on_file_done: &Arc<dyn Fn(u64, u64, &str) + Send + Sync>,
    completed: &Arc< std::sync::atomic::AtomicU64>,
    cancel: Option<&Arc<AtomicBool>>,
    depth: usize,
) -> Result<(), String> {
    if depth > 64 {
        return Err("目录递归深度超过上限".to_string());
    }
    tokio::fs::create_dir_all(local_dir)
        .await
        .map_err(|e| format!("创建本地目录失败: {}", e))?;
    let entries = ftp_list_dir(cfg.clone(), remote_dir).await?;
    for entry in entries {
        if let Some(flag) = cancel {
            if flag.load(Ordering::Relaxed) {
                return Err("Transfer canceled by user".to_string());
            }
        }
        let target_local = std::path::Path::new(local_dir)
            .join(&entry.name)
            .to_string_lossy()
            .to_string();
        if entry.is_directory {
            Box::pin(ftp_download_dir_recursive(
                cfg,
                &entry.path,
                &target_local,
                on_file_done,
                completed,
                cancel,
                depth + 1,
            ))
            .await?;
        } else {
            let tmp_local = format!("{}.sw-dl-tmp-{}", target_local, uuid::Uuid::new_v4());
            ftp_download_file(
                cfg,
                &entry.path,
                &target_local,
                &tmp_local,
                None,
                |_, _| {},
                cancel,
            )
            .await?;
            let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
            on_file_done(done, done, &entry.name);
        }
    }
    Ok(())
}

/// 递归上传本地目录
pub async fn ftp_upload_dir_recursive(
    cfg: &ResolvedFtpConfig,
    local_dir: &str,
    remote_dir: &str,
    on_file_done: &Arc<dyn Fn(u64, u64, &str) + Send + Sync>,
    completed: &Arc<std::sync::atomic::AtomicU64>,
    total_files: u64,
    cancel: Option<&Arc<AtomicBool>>,
    depth: usize,
) -> Result<(), String> {
    if depth > 64 {
        return Err("目录递归深度超过上限".to_string());
    }
    let _ = ftp_mkdir(cfg.clone(), remote_dir).await;
    let mut rd = tokio::fs::read_dir(local_dir)
        .await
        .map_err(|e| format!("读取本地目录失败: {}", e))?;
    while let Some(entry) = rd
        .next_entry()
        .await
        .map_err(|e| format!("遍历本地目录失败: {}", e))?
    {
        if let Some(flag) = cancel {
            if flag.load(Ordering::Relaxed) {
                return Err("Transfer canceled by user".to_string());
            }
        }
        let fname = entry.file_name().to_string_lossy().to_string();
        if crate::validators::is_ignored(&fname) {
            continue;
        }
        let ftype = entry
            .file_type()
            .await
            .map_err(|e| format!("读取文件类型失败: {}", e))?;
        if ftype.is_symlink() {
            continue;
        }
        let child_local = entry.path().to_string_lossy().to_string();
        let child_remote = normalize_ftp_path(remote_dir, &fname);
        if ftype.is_dir() {
            Box::pin(ftp_upload_dir_recursive(
                cfg,
                &child_local,
                &child_remote,
                on_file_done,
                completed,
                total_files,
                cancel,
                depth + 1,
            ))
            .await?;
        } else {
            ftp_upload_file(cfg, &child_local, &child_remote, &child_remote, None, |_, _| {}, cancel).await?;
            let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
            on_file_done(done, total_files.max(done), &fname);
        }
    }
    Ok(())
}
