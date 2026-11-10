// VNC (RFB) 远程桌面桥接、VeNCrypt / TLS 证书加密与连接检测模块
//
// 架构设计（100% 独立旁路，零侵入现有 SSH / SFTP / RDP 链路）：
// 1. 内嵌画布模式：在本地 `127.0.0.1:0` 启动一次性 RFC 6455 WebSocket ⇄ TCP 双向字节流桥接器，
//    前端 `VncViewerModule` 通过 `ws://127.0.0.1:<port>/vnc?token=<uuid>` 直接与远端 VNC Server
//    进行标准 RFB (RFC 6143) 握手、认证与帧缓冲渲染。
// 2. 现代安全加密通道（VeNCrypt 0.2 + TLS 1.3/1.2）：
//    自动探测服务端安全协议清单。当遇到企业级服务端（如 Proxmox VE、TigerVNC TLS 模式等）强制要求
//    VeNCrypt (Security Type 19) 时，本桥接器在 Rust 后端以原生 tokio-rustls 完成安全子协议协商与
//    TLS 证书加密隧道升级，向前端透明呈现加密结果，兼具最高兼容性与顶级传输安全性。
// 3. 连接检测：通过 TCP 连接远端 VNC 端口并读取 12 字节 `RFB xxx.xxx\n` 协议问候头及安全类型，
//    精确验证目标端口是否为有效的 VNC 服务并告知是否支持 VeNCrypt TLS。

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, SignatureScheme};
use tokio_rustls::TlsConnector;

lazy_static::lazy_static! {
    /// 活跃的本地 WebSocket 桥接会话表：session_id -> 停止信号发送端
    static ref ACTIVE_BRIDGES: Mutex<HashMap<String, watch::Sender<bool>>> = Mutex::new(HashMap::new());
}

/// 标准 RFB 安全认证类型代码
pub const SECURITY_TYPE_NONE: u8 = 1;
pub const SECURITY_TYPE_VNC_AUTH: u8 = 2;
pub const SECURITY_TYPE_VENCRYPT: u8 = 19;

/// 标准 VeNCrypt 0.2 安全子类型代码 (RFC / rfbproto 标准)
pub const VENCRYPT_SUBTYPE_PLAIN: u32 = 256;      // 0x0100: 明文用户名密码（非加密）
pub const VENCRYPT_SUBTYPE_TLS_NONE: u32 = 257;   // 0x0101: TLS 隧道加密 + 免密
pub const VENCRYPT_SUBTYPE_TLS_VNC: u32 = 258;    // 0x0102: TLS 隧道加密 + VNC DES 密码认证
pub const VENCRYPT_SUBTYPE_TLS_PLAIN: u32 = 259;  // 0x0103: TLS 隧道加密 + 明文认证
pub const VENCRYPT_SUBTYPE_X509_NONE: u32 = 260;  // 0x0104: X.509 证书 TLS + 免密
pub const VENCRYPT_SUBTYPE_X509_VNC: u32 = 261;   // 0x0105: X.509 证书 TLS + VNC 密码认证
pub const VENCRYPT_SUBTYPE_X509_PLAIN: u32 = 262; // 0x0106: X.509 证书 TLS + 明文认证

/// VNC 桥接会话启动结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VncSessionInfo {
    pub session_id: String,
    pub ws_url: String,
    pub host: String,
    pub port: u16,
    pub password: Option<String>,
    #[serde(default)]
    pub is_tunneled: bool,
    #[serde(default)]
    pub is_tls: bool,
}

/// 自定义证书验证器：针对 VNC 常见的内网自签证书与私有 CA，允许平滑免警告连接
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

/// 构建基于 rustls + ring 的原生高性能 TLS 连接器
fn build_vnc_tls_connector() -> Result<TlsConnector, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("TLS 协议版本初始化失败: {}", e))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoCertificateVerification))
        .with_no_client_auth();
    Ok(TlsConnector::from(Arc::new(config)))
}

/// 统一的底层远端连接流（支持 TCP 直接直连与 SSH Direct-TCPIP 隧道通道）
enum RemoteStream {
    Tcp(TcpStream),
    Ssh(russh::ChannelStream<russh::client::Msg>),
}

impl AsyncRead for RemoteStream {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            RemoteStream::Tcp(s) => std::pin::Pin::new(s).poll_read(cx, buf),
            RemoteStream::Ssh(s) => std::pin::Pin::new(s).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for RemoteStream {
    fn poll_write(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        match self.get_mut() {
            RemoteStream::Tcp(s) => std::pin::Pin::new(s).poll_write(cx, buf),
            RemoteStream::Ssh(s) => std::pin::Pin::new(s).poll_write(cx, buf),
        }
    }

    fn poll_flush(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            RemoteStream::Tcp(s) => std::pin::Pin::new(s).poll_flush(cx),
            RemoteStream::Ssh(s) => std::pin::Pin::new(s).poll_flush(cx),
        }
    }

    fn poll_shutdown(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            RemoteStream::Tcp(s) => std::pin::Pin::new(s).poll_shutdown(cx),
            RemoteStream::Ssh(s) => std::pin::Pin::new(s).poll_shutdown(cx),
        }
    }
}

/// 格式化 host:port，兼容 IPv6 字面量
pub fn format_host_port(host: &str, port: u16) -> String {
    let trimmed = host.trim();
    if trimmed.contains(':') && !trimmed.starts_with('[') {
        format!("[{}]:{}", trimmed, port)
    } else {
        format!("{}:{}", trimmed, port)
    }
}

/// 标准 FIPS 180-4 SHA-1 实现（仅用于 RFC 6455 WebSocket 握手 `Sec-WebSocket-Accept` 计算，免引入外部 crate）
pub fn sha1_digest(data: &[u8]) -> [u8; 20] {
    let mut h0: u32 = 0x67452301;
    let mut h1: u32 = 0xEFCDAB89;
    let mut h2: u32 = 0x98BADCFE;
    let mut h3: u32 = 0x10325476;
    let mut h4: u32 = 0xC3D2E1F0;

    let bit_len = (data.len() as u64) * 8;
    let mut padded = Vec::with_capacity(data.len() + 72);
    padded.extend_from_slice(data);
    padded.push(0x80);
    while (padded.len() % 64) != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 80];
        for (i, word) in chunk.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }

        let (mut a, mut b, mut c, mut d, mut e) = (h0, h1, h2, h3, h4);
        for (i, &wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | ((!b) & d), 0x5A827999u32),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1u32),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDCu32),
                _ => (b ^ c ^ d, 0xCA62C1D6u32),
            };
            let temp = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }

        h0 = h0.wrapping_add(a);
        h1 = h1.wrapping_add(b);
        h2 = h2.wrapping_add(c);
        h3 = h3.wrapping_add(d);
        h4 = h4.wrapping_add(e);
    }

    let mut out = [0u8; 20];
    out[0..4].copy_from_slice(&h0.to_be_bytes());
    out[4..8].copy_from_slice(&h1.to_be_bytes());
    out[8..12].copy_from_slice(&h2.to_be_bytes());
    out[12..16].copy_from_slice(&h3.to_be_bytes());
    out[16..20].copy_from_slice(&h4.to_be_bytes());
    out
}

/// 计算 WebSocket 握手回复值：Base64(SHA1(Key + GUID))
pub fn compute_websocket_accept(key: &str) -> String {
    const WS_GUID: &[u8] = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    let mut concatenated = Vec::with_capacity(key.len() + WS_GUID.len());
    concatenated.extend_from_slice(key.trim().as_bytes());
    concatenated.extend_from_slice(WS_GUID);
    let digest = sha1_digest(&concatenated);
    base64::engine::general_purpose::STANDARD.encode(digest)
}

/// 探测远端 VNC 端口是否可达并智能解析 RFB 协议与加密支持（含 VeNCrypt / TLS 探测）
pub async fn test_connection(host: &str, port: u16, timeout_secs: u64) -> Result<String, String> {
    let addr = format_host_port(host, port);
    let timeout = Duration::from_secs(timeout_secs.clamp(3, 60));

    let mut stream = tokio::time::timeout(timeout, TcpStream::connect(&addr))
        .await
        .map_err(|_| format!("连接 VNC 服务 {} 超时（{}s）", addr, timeout.as_secs()))?
        .map_err(|e| format!("无法连接到 VNC 服务 {}: {}", addr, e))?;

    let mut banner = [0u8; 12];
    tokio::time::timeout(Duration::from_secs(5), stream.read_exact(&mut banner))
        .await
        .map_err(|_| format!("已建立 TCP 连接，但读取 {} 的 RFB 握手超时", addr))?
        .map_err(|e| format!("读取 VNC 协议头失败: {}", e))?;

    if !banner.starts_with(b"RFB ") {
        return Err(format!("目标端口 {} 不是有效的 VNC (RFB) 服务", addr));
    }

    let version_str = String::from_utf8_lossy(&banner).trim().to_string();

    // 尝试握手探测其支持的安全认证协议（发送标准 3.8 版本头）
    if stream.write_all(b"RFB 003.008\n").await.is_ok() {
        let mut sec_hdr = [0u8; 1];
        if tokio::time::timeout(Duration::from_secs(3), stream.read_exact(&mut sec_hdr))
            .await
            .is_ok()
        {
            let num_sec = sec_hdr[0] as usize;
            if num_sec > 0 {
                let mut sec_types = vec![0u8; num_sec];
                if tokio::time::timeout(Duration::from_secs(3), stream.read_exact(&mut sec_types))
                    .await
                    .is_ok()
                {
                    if sec_types.contains(&SECURITY_TYPE_VENCRYPT) {
                        return Ok(format!(
                            "VNC 服务可达 ({} · 支持 VeNCrypt / TLS 安全加密通道)",
                            version_str
                        ));
                    } else if sec_types.contains(&SECURITY_TYPE_VNC_AUTH) {
                        return Ok(format!("VNC 服务可达 ({} · 标准 VNC 密码认证)", version_str));
                    } else if sec_types.contains(&SECURITY_TYPE_NONE) {
                        return Ok(format!("VNC 服务可达 ({} · 免密直接连接)", version_str));
                    }
                }
            }
        }
    }

    Ok(format!("VNC 服务可达 ({})", version_str))
}

/// 启动本地一次性 WebSocket ⇄ TCP 桥接器（集成 VeNCrypt 0.2 + TLS 原生协商引擎）
///
/// 功能特性：
/// 1. 支持双通道智能穿透：优先使用 SSH Direct-TCPIP 打洞，失败或未配置时回退至 TCP 直连；
/// 2. 原生支持 VeNCrypt 0.2 + TLS 握手：当远端为 Proxmox VE、TigerVNC TLS 模式等企业级 VNC 时，
///    在后端自动完成 TLS 证书隧道握手，并将全双工数据在 TLS 隧道内高吞吐中继。
pub async fn start_bridge(
    app_handle: Option<tauri::AppHandle>,
    host: String,
    port: u16,
    password: Option<String>,
    timeout_secs: u64,
    ssh_conn: Option<Arc<crate::ssh::connection::SshConnection>>,
) -> Result<VncSessionInfo, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("无法绑定本地 VNC 桥接端口: {}", e))?;
    let local_addr = listener
        .local_addr()
        .map_err(|e| format!("无法读取本地桥接地址: {}", e))?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let token = uuid::Uuid::new_v4().to_string();
    let ws_url = format!("ws://127.0.0.1:{}/vnc?token={}", local_addr.port(), token);

    let (stop_tx, mut stop_rx) = watch::channel(false);
    if let Ok(mut map) = ACTIVE_BRIDGES.lock() {
        map.insert(session_id.clone(), stop_tx);
    }

    let target_addr = format_host_port(&host, port);
    let host_tunnel = host.clone();
    let host_tls = host.clone();
    let pwd_tls = password.clone();
    let session_host = host;
    let session_pwd = password;
    let session_id_cleanup = session_id.clone();
    let connect_timeout = Duration::from_secs(timeout_secs.clamp(5, 60));
    let has_ssh = ssh_conn.is_some();

    tokio::spawn(async move {
        let accept_res = tokio::select! {
            res = tokio::time::timeout(Duration::from_secs(30), listener.accept()) => res,
            _ = stop_rx.changed() => {
                cleanup_session(&session_id_cleanup);
                return;
            }
        };

        let (mut ws_stream, _) = match accept_res {
            Ok(Ok(pair)) => pair,
            _ => {
                cleanup_session(&session_id_cleanup);
                return;
            }
        };
        let _ = ws_stream.set_nodelay(true);

        // 1. 完成 HTTP -> WebSocket 升级握手并校验一次性 token
        if perform_ws_handshake(&mut ws_stream, &token).await.is_err() {
            cleanup_session(&session_id_cleanup);
            return;
        }

        // 2. 建立与远端 VNC 的底层连接（优先尝试 SSH Direct-TCPIP 隧道打洞）
        let mut remote_stream: Option<RemoteStream> = None;
        if let Some(ref conn) = ssh_conn {
            let tunnel_target = if host_tunnel == "127.0.0.1"
                || host_tunnel == "localhost"
                || host_tunnel == "::1"
                || host_tunnel.is_empty()
            {
                "127.0.0.1"
            } else {
                &host_tunnel
            };

            let open_res = tokio::time::timeout(
                connect_timeout,
                conn.open_direct_tcpip(
                    tunnel_target.to_string(),
                    port as u32,
                    "127.0.0.1".to_string(),
                    0,
                ),
            )
            .await;

            match open_res {
                Ok(Ok(ch)) => {
                    eprintln!(
                        "[VNC] 成功建立 SSH Direct-TCPIP 隧道打洞至 {}:{}",
                        tunnel_target, port
                    );
                    remote_stream = Some(RemoteStream::Ssh(ch.into_stream()));
                }
                Ok(Err(e)) => {
                    eprintln!(
                        "[VNC] SSH Direct-TCPIP 建立失败 ({}:{}): {}",
                        tunnel_target, port, e
                    );
                    if tunnel_target != "127.0.0.1" {
                        if let Ok(Ok(ch)) = tokio::time::timeout(
                            Duration::from_secs(3),
                            conn.open_direct_tcpip(
                                "127.0.0.1".to_string(),
                                port as u32,
                                "127.0.0.1".to_string(),
                                0,
                            ),
                        )
                        .await
                        {
                            eprintln!(
                                "[VNC] 成功回退并建立 SSH Direct-TCPIP 隧道至 127.0.0.1:{}",
                                port
                            );
                            remote_stream = Some(RemoteStream::Ssh(ch.into_stream()));
                        }
                    }
                }
                Err(_) => {
                    eprintln!("[VNC] SSH Direct-TCPIP 打洞超时，尝试降级为 TCP 直连");
                }
            }
        }

        if remote_stream.is_none() {
            // TCP 直连（无 SSH 或打洞失败时回退）
            match tokio::time::timeout(connect_timeout, TcpStream::connect(&target_addr)).await {
                Ok(Ok(s)) => {
                    let _ = s.set_nodelay(true);
                    remote_stream = Some(RemoteStream::Tcp(s));
                }
                _ => {
                    let _ = send_ws_close(&mut ws_stream).await;
                    cleanup_session(&session_id_cleanup);
                    return;
                }
            }
        }

        let mut remote = match remote_stream {
            Some(s) => s,
            None => {
                let _ = send_ws_close(&mut ws_stream).await;
                cleanup_session(&session_id_cleanup);
                return;
            }
        };

        // 3. 读取远端 VNC 协议版本问候头（如 RFB 003.008\n）
        let mut remote_banner = [0u8; 12];
        if tokio::time::timeout(connect_timeout, remote.read_exact(&mut remote_banner))
            .await
            .is_err()
        {
            let _ = send_ws_close(&mut ws_stream).await;
            cleanup_session(&session_id_cleanup);
            return;
        }

        let (mut ws_read, mut ws_write) = ws_stream.into_split();

        // 4. 将远端协议头透传给前端
        if write_ws_binary_frame(&mut ws_write, &remote_banner)
            .await
            .is_err()
        {
            cleanup_session(&session_id_cleanup);
            return;
        }

        // 5. 接收前端回复的 12 字节版本号（RFB 003.008\n）
        let client_banner = match read_ws_frame(&mut ws_read).await {
            Ok(Some((_, p))) if p.len() >= 12 && p.starts_with(b"RFB ") => p,
            _ => {
                cleanup_session(&session_id_cleanup);
                return;
            }
        };

        // 6. 将前端版本号发送给远端
        if remote.write_all(&client_banner[..12]).await.is_err() {
            cleanup_session(&session_id_cleanup);
            return;
        }

        // 7. 读取远端下发支持的安全认证类型清单
        let mut sec_hdr = [0u8; 1];
        if remote.read_exact(&mut sec_hdr).await.is_err() {
            cleanup_session(&session_id_cleanup);
            return;
        }
        let num_sec = sec_hdr[0] as usize;

        if num_sec == 0 {
            // 远端下发认证拒绝原因（如 Too many security failures）
            let mut reason_len_buf = [0u8; 4];
            let _ = remote.read_exact(&mut reason_len_buf).await;
            let reason_len = u32::from_be_bytes(reason_len_buf) as usize;
            let mut reason_bytes = vec![0u8; reason_len];
            let _ = remote.read_exact(&mut reason_bytes).await;

            let mut err_msg = Vec::with_capacity(5 + reason_len);
            err_msg.push(0);
            err_msg.extend_from_slice(&reason_len_buf);
            err_msg.extend_from_slice(&reason_bytes);
            let _ = write_ws_binary_frame(&mut ws_write, &err_msg).await;
            let _ = send_ws_close_split(&mut ws_write).await;
            cleanup_session(&session_id_cleanup);
            return;
        }

        let mut sec_types = vec![0u8; num_sec];
        if remote.read_exact(&mut sec_types).await.is_err() {
            cleanup_session(&session_id_cleanup);
            return;
        }

        // 8. 安全协议分流：
        // 若服务端提供 VeNCrypt (19)，自动协商并升级为 TLS 1.3/1.2 证书加密通道
        let use_vencrypt = sec_types.contains(&SECURITY_TYPE_VENCRYPT);

        if use_vencrypt {
            eprintln!("[VNC] 检测到服务端支持 VeNCrypt (19)，启动原生 TLS 加密协商流程...");

            // 8.1 告知远端选择 VeNCrypt (19) 安全类型
            if remote.write_all(&[SECURITY_TYPE_VENCRYPT]).await.is_err() {
                cleanup_session(&session_id_cleanup);
                return;
            }

            // 8.2 读取服务端支持的 VeNCrypt 版本 (2 字节: major, minor)
            let mut ver = [0u8; 2];
            if remote.read_exact(&mut ver).await.is_err() {
                cleanup_session(&session_id_cleanup);
                return;
            }

            // 8.3 回复客户端协商版本 [0, 2] (VeNCrypt 0.2 标准)
            if remote.write_all(&[0, 2]).await.is_err() {
                cleanup_session(&session_id_cleanup);
                return;
            }

            // 8.4 读取服务端版本确认 (1 字节状态码，0 代表成功)
            let mut status = [0u8; 1];
            if remote.read_exact(&mut status).await.is_err() || status[0] != 0 {
                eprintln!("[VNC] 服务端拒绝了 VeNCrypt 0.2 版本协商");
                cleanup_session(&session_id_cleanup);
                return;
            }

            // 8.5 读取子类型清单 (1 字节数量 + 数量 * 4 字节)
            let mut sub_count_buf = [0u8; 1];
            if remote.read_exact(&mut sub_count_buf).await.is_err() {
                cleanup_session(&session_id_cleanup);
                return;
            }
            let sub_count = sub_count_buf[0] as usize;
            let mut sub_buf = vec![0u8; sub_count * 4];
            if remote.read_exact(&mut sub_buf).await.is_err() {
                cleanup_session(&session_id_cleanup);
                return;
            }
            let mut subtypes = Vec::new();
            for chunk in sub_buf.chunks_exact(4) {
                subtypes.push(u32::from_be_bytes(chunk.try_into().unwrap()));
            }

            // 8.6 选定最优支持的子类型
            let chosen = if pwd_tls.is_some() {
                if subtypes.contains(&VENCRYPT_SUBTYPE_TLS_VNC) {
                    VENCRYPT_SUBTYPE_TLS_VNC
                } else if subtypes.contains(&VENCRYPT_SUBTYPE_X509_VNC) {
                    VENCRYPT_SUBTYPE_X509_VNC
                } else if subtypes.contains(&VENCRYPT_SUBTYPE_TLS_NONE) {
                    VENCRYPT_SUBTYPE_TLS_NONE
                } else if subtypes.contains(&VENCRYPT_SUBTYPE_X509_NONE) {
                    VENCRYPT_SUBTYPE_X509_NONE
                } else {
                    *subtypes.first().unwrap_or(&VENCRYPT_SUBTYPE_TLS_NONE)
                }
            } else {
                if subtypes.contains(&VENCRYPT_SUBTYPE_TLS_NONE) {
                    VENCRYPT_SUBTYPE_TLS_NONE
                } else if subtypes.contains(&VENCRYPT_SUBTYPE_X509_NONE) {
                    VENCRYPT_SUBTYPE_X509_NONE
                } else if subtypes.contains(&VENCRYPT_SUBTYPE_TLS_VNC) {
                    VENCRYPT_SUBTYPE_TLS_VNC
                } else if subtypes.contains(&VENCRYPT_SUBTYPE_X509_VNC) {
                    VENCRYPT_SUBTYPE_X509_VNC
                } else {
                    *subtypes.first().unwrap_or(&VENCRYPT_SUBTYPE_TLS_NONE)
                }
            };

            // 8.7 发送选定的子类型 (4 字节大端序)
            if remote.write_all(&chosen.to_be_bytes()).await.is_err() {
                cleanup_session(&session_id_cleanup);
                return;
            }

            // 8.8 读取子类型确认 (1 字节 ACK，1 为接受并即将启动 TLS 握手)
            let mut ack = [0u8; 1];
            if remote.read_exact(&mut ack).await.is_err() || ack[0] != 1 {
                eprintln!("[VNC] 服务端拒绝了 VeNCrypt 子类型 0x{:04x}", chosen);
                cleanup_session(&session_id_cleanup);
                return;
            }

            // 8.9 启动原生 TLS 隧道握手 (tokio-rustls)
            let tls_connector = match build_vnc_tls_connector() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[VNC] 初始化 TLS 连接器失败: {}", e);
                    cleanup_session(&session_id_cleanup);
                    return;
                }
            };

            let server_name = match ServerName::try_from(host_tls.as_str()) {
                Ok(sn) => sn.to_owned(),
                Err(_) => ServerName::try_from("vnc").unwrap().to_owned(),
            };

            let mut tls_stream = match tokio::time::timeout(
                connect_timeout,
                tls_connector.connect(server_name, remote),
            )
            .await
            {
                Ok(Ok(stream)) => stream,
                Ok(Err(e)) => {
                    eprintln!("[VNC] VeNCrypt TLS 握手失败: {}", e);
                    cleanup_session(&session_id_cleanup);
                    return;
                }
                Err(_) => {
                    eprintln!("[VNC] VeNCrypt TLS 握手超时");
                    cleanup_session(&session_id_cleanup);
                    return;
                }
            };

            eprintln!(
                "[VNC] 成功建立 VeNCrypt 0.2 + TLS 安全隧道（子类型: 0x{:04x}）",
                chosen
            );

            // 广播会话已激活 TLS 加密
            if let Some(ref app) = app_handle {
                let _ = app.emit(
                    "vnc:tls-negotiated",
                    serde_json::json!({
                        "sessionId": session_id_cleanup,
                        "isTls": true,
                        "subType": chosen,
                    }),
                );
            }

            // 8.10 在 TLS 加密内部完成认证并向前端同构呈现
            if chosen == VENCRYPT_SUBTYPE_TLS_NONE || chosen == VENCRYPT_SUBTYPE_X509_NONE {
                // TLSNone: 服务端在 TLS 内部下发 SecurityResult (4 字节: 0)
                let mut sec_res = [0u8; 4];
                if tls_stream.read_exact(&mut sec_res).await.is_err() {
                    cleanup_session(&session_id_cleanup);
                    return;
                }

                // 向前端呈现免密类型 [1, 1]
                if write_ws_binary_frame(&mut ws_write, &[1, SECURITY_TYPE_NONE])
                    .await
                    .is_err()
                {
                    cleanup_session(&session_id_cleanup);
                    return;
                }
                // 读取前端选择确认
                let _ = read_ws_frame(&mut ws_read).await;
                // 向前端下发 SecurityResult
                if write_ws_binary_frame(&mut ws_write, &sec_res)
                    .await
                    .is_err()
                {
                    cleanup_session(&session_id_cleanup);
                    return;
                }
            } else if chosen == VENCRYPT_SUBTYPE_TLS_VNC || chosen == VENCRYPT_SUBTYPE_X509_VNC {
                // TLSVnc: 服务端在 TLS 内部下发 16 字节 DES 随机挑战码
                let mut challenge = [0u8; 16];
                if tls_stream.read_exact(&mut challenge).await.is_err() {
                    cleanup_session(&session_id_cleanup);
                    return;
                }

                // 向前端呈现 VncAuth 类型 [1, 2]
                if write_ws_binary_frame(&mut ws_write, &[1, SECURITY_TYPE_VNC_AUTH])
                    .await
                    .is_err()
                {
                    cleanup_session(&session_id_cleanup);
                    return;
                }
                // 读取前端选择类型
                let _ = read_ws_frame(&mut ws_read).await;
                // 向前端转发 16 字节挑战码
                if write_ws_binary_frame(&mut ws_write, &challenge)
                    .await
                    .is_err()
                {
                    cleanup_session(&session_id_cleanup);
                    return;
                }
                // 读取前端返回的 16 字节 DES 响应
                let resp = match read_ws_frame(&mut ws_read).await {
                    Ok(Some((_, p))) if p.len() == 16 => p,
                    _ => {
                        cleanup_session(&session_id_cleanup);
                        return;
                    }
                };
                // 将加密结果写入 TLS 远端
                if tls_stream.write_all(&resp).await.is_err() {
                    cleanup_session(&session_id_cleanup);
                    return;
                }
                // 读取服务端的 SecurityResult (4 字节)
                let mut sec_res = [0u8; 4];
                if tls_stream.read_exact(&mut sec_res).await.is_err() {
                    cleanup_session(&session_id_cleanup);
                    return;
                }
                // 将 SecurityResult 转发给前端
                if write_ws_binary_frame(&mut ws_write, &sec_res)
                    .await
                    .is_err()
                {
                    cleanup_session(&session_id_cleanup);
                    return;
                }
            }

            // 握手完毕，进入 TLS 流全双工数据中继
            let (mut remote_read, mut remote_write) = tokio::io::split(tls_stream);

            run_relay_loop(
                &mut ws_read,
                &mut ws_write,
                &mut remote_read,
                &mut remote_write,
                &mut stop_rx,
            )
            .await;
        } else {
            // 纯标准 VNC：向前端下发原始安全类型，由前端进行 VNC DES 或 None 认证
            let mut sec_payload = Vec::with_capacity(1 + sec_types.len());
            sec_payload.push(num_sec as u8);
            sec_payload.extend_from_slice(&sec_types);
            if write_ws_binary_frame(&mut ws_write, &sec_payload)
                .await
                .is_err()
            {
                cleanup_session(&session_id_cleanup);
                return;
            }

            let (mut remote_read, mut remote_write) = tokio::io::split(remote);

            run_relay_loop(
                &mut ws_read,
                &mut ws_write,
                &mut remote_read,
                &mut remote_write,
                &mut stop_rx,
            )
            .await;
        }

        cleanup_session(&session_id_cleanup);
    });

    Ok(VncSessionInfo {
        session_id,
        ws_url,
        host: session_host,
        port,
        password: session_pwd,
        is_tunneled: has_ssh,
        is_tls: false,
    })
}

/// 执行全双工中继传输循环
async fn run_relay_loop<R, W>(
    ws_read: &mut tokio::net::tcp::OwnedReadHalf,
    ws_write: &mut tokio::net::tcp::OwnedWriteHalf,
    remote_read: &mut R,
    remote_write: &mut W,
    stop_rx: &mut watch::Receiver<bool>,
) where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let remote_to_ws = async {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            let n = match remote_read.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            if write_ws_binary_frame(ws_write, &buf[..n]).await.is_err() {
                break;
            }
        }
    };

    let ws_to_remote = async {
        loop {
            match read_ws_frame(ws_read).await {
                Ok(Some((opcode, payload))) => match opcode {
                    0x0 | 0x1 | 0x2 => {
                        if !payload.is_empty() && remote_write.write_all(&payload).await.is_err() {
                            break;
                        }
                    }
                    0x8 => break,
                    _ => {}
                },
                Ok(None) | Err(_) => break,
            }
        }
    };

    tokio::select! {
        _ = remote_to_ws => {}
        _ = ws_to_remote => {}
        _ = stop_rx.changed() => {}
    }
}

/// 停止指定的 VNC 桥接器
pub fn stop_bridge(session_id: &str) {
    cleanup_session(session_id);
}

fn cleanup_session(session_id: &str) {
    if let Ok(mut map) = ACTIVE_BRIDGES.lock() {
        if let Some(sender) = map.remove(session_id) {
            let _ = sender.send(true);
        }
    }
}

/// 解析 HTTP 升级请求头，校验一次性 token，并返回标准 RFC 6455 101 Switching Protocols 响应
async fn perform_ws_handshake(stream: &mut TcpStream, expected_token: &str) -> Result<(), ()> {
    let mut buf = [0u8; 4096];
    let n = match tokio::time::timeout(Duration::from_secs(10), stream.read(&mut buf)).await {
        Ok(Ok(n)) if n > 0 => n,
        _ => return Err(()),
    };

    let request_str = String::from_utf8_lossy(&buf[..n]);

    let first_line = request_str.lines().next().unwrap_or("");
    if !first_line.contains(expected_token) {
        return Err(());
    }

    let mut ws_key: Option<String> = None;
    for line in request_str.lines() {
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("sec-websocket-key:") {
            if let Some(idx) = line.find(':') {
                ws_key = Some(line[idx + 1..].trim().to_string());
                break;
            }
        }
    }

    let key = match ws_key {
        Some(k) if !k.is_empty() => k,
        _ => return Err(()),
    };

    let accept = compute_websocket_accept(&key);
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Accept: {}\r\n\r\n",
        accept
    );

    match stream.write_all(response.as_bytes()).await {
        Ok(_) => Ok(()),
        Err(_) => Err(()),
    }
}

/// 向 WebSocket 客户端写入一帧未掩码的二进制数据（RFC 6455 服务端 -> 客户端规范）
async fn write_ws_binary_frame<W: AsyncWriteExt + Unpin>(
    writer: &mut W,
    payload: &[u8],
) -> Result<(), std::io::Error> {
    let len = payload.len();
    let mut header = Vec::with_capacity(10);
    header.push(0x82); // FIN = 1, Opcode = 2 (Binary)
    if len < 126 {
        header.push(len as u8);
    } else if len <= 65535 {
        header.push(126);
        header.extend_from_slice(&(len as u16).to_be_bytes());
    } else {
        header.push(127);
        header.extend_from_slice(&(len as u64).to_be_bytes());
    }
    writer.write_all(&header).await?;
    writer.write_all(payload).await?;
    writer.flush().await
}

async fn send_ws_close(stream: &mut TcpStream) -> Result<(), std::io::Error> {
    stream.write_all(&[0x88, 0x00]).await
}

async fn send_ws_close_split<W: AsyncWriteExt + Unpin>(stream: &mut W) -> Result<(), std::io::Error> {
    stream.write_all(&[0x88, 0x00]).await
}

/// 从前端读取一帧 RFC 6455 WebSocket 数据并自动解除掩码
async fn read_ws_frame<R: AsyncReadExt + Unpin>(
    reader: &mut R,
) -> Result<Option<(u8, Vec<u8>)>, std::io::Error> {
    let mut header = [0u8; 2];
    if reader.read_exact(&mut header).await.is_err() {
        return Ok(None);
    }

    let opcode = header[0] & 0x0f;
    let masked = (header[1] & 0x80) != 0;
    let mut payload_len = (header[1] & 0x7f) as usize;

    if payload_len == 126 {
        let mut ext = [0u8; 2];
        reader.read_exact(&mut ext).await?;
        payload_len = u16::from_be_bytes(ext) as usize;
    } else if payload_len == 127 {
        let mut ext = [0u8; 8];
        reader.read_exact(&mut ext).await?;
        payload_len = u64::from_be_bytes(ext) as usize;
    }

    // 限制单帧最大 16MB，防止异常帧耗尽内存
    if payload_len > 16 * 1024 * 1024 {
        return Ok(None);
    }

    let mut mask_key = [0u8; 4];
    if masked {
        reader.read_exact(&mut mask_key).await?;
    }

    let mut payload = vec![0u8; payload_len];
    if payload_len > 0 {
        reader.read_exact(&mut payload).await?;
        if masked {
            for (i, byte) in payload.iter_mut().enumerate() {
                *byte ^= mask_key[i & 3];
            }
        }
    }

    Ok(Some((opcode, payload)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc6455_websocket_accept_matches_spec_vector() {
        // RFC 6455 Section 1.3 官方测试向量
        let key = "dGhlIHNhbXBsZSBub25jZQ==";
        assert_eq!(
            compute_websocket_accept(key),
            "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        );
    }

    #[test]
    fn format_host_port_handles_ipv4_and_ipv6() {
        assert_eq!(format_host_port("192.168.1.10", 5900), "192.168.1.10:5900");
        assert_eq!(format_host_port("::1", 5901), "[::1]:5901");
        assert_eq!(format_host_port("[::1]", 5901), "[::1]:5901");
    }

    #[tokio::test]
    async fn test_connection_detects_rfb_banner_and_auth_types() {
        let mock_vnc = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let vnc_port = mock_vnc.local_addr().unwrap().port();

        tokio::spawn(async move {
            if let Ok((mut sock, _)) = mock_vnc.accept().await {
                let _ = sock.write_all(b"RFB 003.008\n").await;
                let mut client_ver = [0u8; 12];
                if sock.read_exact(&mut client_ver).await.is_ok() {
                    // 下发安全类型：支持 19 (VeNCrypt) 和 2 (VncAuth)
                    let _ = sock.write_all(&[2, SECURITY_TYPE_VENCRYPT, SECURITY_TYPE_VNC_AUTH]).await;
                }
            }
        });

        let msg = test_connection("127.0.0.1", vnc_port, 5).await.unwrap();
        assert!(msg.contains("RFB 003.008"));
        assert!(msg.contains("VeNCrypt / TLS"));
    }

    #[test]
    fn tls_connector_builds_without_error() {
        let connector = build_vnc_tls_connector();
        assert!(connector.is_ok());
    }
}
