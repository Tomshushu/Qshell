//! SSH X11 Forwarding (`x11` 通道桥接、MIT-MAGIC-COOKIE-1 欺骗防护与本地 X Server 探测/离线插件包管理)。
//!
//! 当服务器配置开启 `x11_forwarding == true` 时：
//! 1. Shell 通道在 `request_pty` 之后自动发送 `SSH_MSG_CHANNEL_REQUEST "x11-req"`，
//!    并携带每连接随机生成的 128-bit `MIT-MAGIC-COOKIE-1` 认证凭据；
//! 2. 服务端转发 `SSH_MSG_CHANNEL_OPEN "x11"` 时，先校验策略开关与远端提交的 spoofed cookie，
//!    再将字节流双向桥接到本地 X Server（Unix Socket / Windows TCP VcXsrv / macOS XQuartz）。
//! 3. 不修改任何发版流水线：支持自动探测系统已安装的 X Server 或用户在 `$APP_DATA/addons/xserver`
//!    离线导入的 X Server 插件包（.zip / 可执行文件）。

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use rand::RngCore;
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::RwLock;

pub const X11_AUTH_PROTOCOL: &str = "MIT-MAGIC-COOKIE-1";

/// 单个 SSH 连接的 X11 转发运行时上下文
#[derive(Debug, Clone)]
pub struct X11ForwardSession {
    pub auth_protocol: String,
    pub auth_cookie_hex: String,
    pub screen: u32,
    pub display_spec: String,
}

#[derive(Debug, Default)]
pub struct X11ForwardRegistry {
    sessions: RwLock<HashMap<String, X11ForwardSession>>,
}

static X11_REGISTRY: OnceLock<Arc<X11ForwardRegistry>> = OnceLock::new();

impl X11ForwardRegistry {
    pub fn global() -> &'static Arc<Self> {
        X11_REGISTRY.get_or_init(|| Arc::new(Self::default()))
    }

    pub async fn get_or_create(&self, server_id: &str) -> X11ForwardSession {
        {
            let guard = self.sessions.read().await;
            if let Some(existing) = guard.get(server_id) {
                return existing.clone();
            }
        }
        let mut guard = self.sessions.write().await;
        if let Some(existing) = guard.get(server_id) {
            return existing.clone();
        }
        let session = X11ForwardSession {
            auth_protocol: X11_AUTH_PROTOCOL.to_string(),
            auth_cookie_hex: generate_mit_magic_cookie(),
            screen: 0,
            display_spec: default_display_spec(),
        };
        guard.insert(server_id.to_string(), session.clone());
        session
    }

    pub async fn get(&self, server_id: &str) -> Option<X11ForwardSession> {
        self.sessions.read().await.get(server_id).cloned()
    }

    pub async fn remove(&self, server_id: &str) {
        self.sessions.write().await.remove(server_id);
    }
}

/// 生成 128-bit (16 字节) 随机 `MIT-MAGIC-COOKIE-1` 十六进制串（32 个小写 hex 字符）
pub fn generate_mit_magic_cookie() -> String {
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// 策略判定：仅当当前连接明确启用了 `x11_forwarding` 时才接受服务端发来的 `x11` 通道。
pub fn should_accept_x11_channel(x11_enabled: bool) -> bool {
    x11_enabled
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum X11DisplayTarget {
    UnixSocket(PathBuf),
    Tcp { host: String, port: u16 },
}

pub fn default_display_spec() -> String {
    std::env::var("DISPLAY")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "127.0.0.1:0".to_string())
}

/// 解析 `$DISPLAY` 字符串为本地连接目标。
/// 支持 `:0`、`:10.0`、`127.0.0.1:0`、`localhost:1.0`、`[::1]:0` 以及 Unix socket 路径（如 XQuartz）。
pub fn parse_display_spec(spec: &str) -> Result<X11DisplayTarget, String> {
    let trimmed = spec.trim();
    if trimmed.is_empty() {
        #[cfg(unix)]
        {
            let sock = PathBuf::from("/tmp/.X11-unix/X0");
            if sock.exists() {
                return Ok(X11DisplayTarget::UnixSocket(sock));
            }
        }
        return Ok(X11DisplayTarget::Tcp {
            host: "127.0.0.1".to_string(),
            port: 6000,
        });
    }

    // 处理 IPv6 格式 `[host]:display(.screen)`
    if let Some(rest) = trimmed.strip_prefix('[') {
        if let Some((host, after_bracket)) = rest.split_once("]:") {
            let disp_str = after_bracket.split('.').next().unwrap_or("0");
            let disp = disp_str
                .parse::<u16>()
                .map_err(|_| format!("无效 X11 DISPLAY 编号: {}", trimmed))?;
            return Ok(X11DisplayTarget::Tcp {
                host: host.to_string(),
                port: 6000u16.saturating_add(disp),
            });
        }
    }

    // 处理 macOS XQuartz 等 Unix Socket 路径 `/private/tmp/.../org.xquartz:0` 或 `/tmp/.X11-unix/X0`
    if trimmed.starts_with('/') {
        #[cfg(unix)]
        {
            return Ok(X11DisplayTarget::UnixSocket(PathBuf::from(trimmed)));
        }
        #[cfg(not(unix))]
        {
            let disp = trimmed
                .rsplit(':')
                .next()
                .and_then(|s| s.split('.').next())
                .and_then(|s| s.parse::<u16>().ok())
                .unwrap_or(0);
            return Ok(X11DisplayTarget::Tcp {
                host: "127.0.0.1".to_string(),
                port: 6000u16.saturating_add(disp),
            });
        }
    }

    let Some((host_part, disp_screen)) = trimmed.rsplit_once(':') else {
        return Err(format!("无法解析 DISPLAY 格式: {}", trimmed));
    };
    let disp_str = disp_screen.split('.').next().unwrap_or("0");
    let disp = disp_str
        .parse::<u16>()
        .map_err(|_| format!("无效 X11 DISPLAY 编号: {}", trimmed))?;
    let port = 6000u16.saturating_add(disp);

    if host_part.is_empty() || host_part == "unix" {
        #[cfg(unix)]
        {
            let sock = PathBuf::from(format!("/tmp/.X11-unix/X{}", disp));
            if sock.exists() {
                return Ok(X11DisplayTarget::UnixSocket(sock));
            }
        }
        return Ok(X11DisplayTarget::Tcp {
            host: "127.0.0.1".to_string(),
            port,
        });
    }

    Ok(X11DisplayTarget::Tcp {
        host: host_part.to_string(),
        port,
    })
}

/// 尝试读取本地 `~/.Xauthority` 中的 cookie，用于替换 SSH 欺骗 cookie（spoofed cookie）。
fn read_local_xauthority_cookie(display_num: u16) -> Option<(Vec<u8>, Vec<u8>)> {
    let xauth_path = std::env::var_os("XAUTHORITY")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".Xauthority")))?;
    let raw = std::fs::read(&xauth_path).ok()?;
    parse_xauthority_entries(&raw, &display_num.to_string())
}

fn parse_xauthority_entries(raw: &[u8], target_display: &str) -> Option<(Vec<u8>, Vec<u8>)> {
    let mut idx = 0usize;
    let read_u16 = |buf: &[u8], pos: &mut usize| -> Option<u16> {
        if *pos + 2 > buf.len() {
            return None;
        }
        let val = u16::from_be_bytes([buf[*pos], buf[*pos + 1]]);
        *pos += 2;
        Some(val)
    };
    let read_slice = |buf: &[u8], pos: &mut usize| -> Option<Vec<u8>> {
        let len = read_u16(buf, pos)? as usize;
        if *pos + len > buf.len() {
            return None;
        }
        let out = buf[*pos..*pos + len].to_vec();
        *pos += len;
        Some(out)
    };

    while idx < raw.len() {
        let _family = read_u16(raw, &mut idx)?;
        let _addr = read_slice(raw, &mut idx)?;
        let number = read_slice(raw, &mut idx)?;
        let name = read_slice(raw, &mut idx)?;
        let data = read_slice(raw, &mut idx)?;
        let number_str = String::from_utf8_lossy(&number);
        if (number_str == target_display || number_str.is_empty())
            && name == X11_AUTH_PROTOCOL.as_bytes()
        {
            return Some((name, data));
        }
    }
    None
}

fn x11_pad4(len: usize) -> usize {
    (4 - (len % 4)) % 4
}

const MAX_X11_SETUP_BYTES: usize = 64 * 1024;

/// 计算 X11 `ConnectionSetup` 握手首包完整长度（12 字节头 + 认证协议名/凭据及 4 字节对齐填充）
fn x11_setup_body_start(header: &[u8]) -> Result<usize, String> {
    if header.len() < 12 {
        return Err("X11 建连首包长度不足 12 字节".to_string());
    }
    if header[0] != b'B' && header[0] != b'l' {
        return Err(format!("非法 X11 字节序标识: 0x{:02x}", header[0]));
    }
    let read_u16 = |b0: u8, b1: u8| -> usize {
        if header[0] == b'B' {
            u16::from_be_bytes([b0, b1]) as usize
        } else {
            u16::from_le_bytes([b0, b1]) as usize
        }
    };
    let name_len = read_u16(header[6], header[7]);
    let data_len = read_u16(header[8], header[9]);
    let body_start = 12usize
        .saturating_add(name_len)
        .saturating_add(x11_pad4(name_len))
        .saturating_add(data_len)
        .saturating_add(x11_pad4(data_len));
    if body_start > MAX_X11_SETUP_BYTES {
        return Err(format!("X11 握手包头部过长 ({} bytes)", body_start));
    }
    Ok(body_start)
}

/// 循环读取直到收集到完整的 X11 `ConnectionSetup` 握手包（处理 TCP/SSH 分片），再执行 Cookie 校验与改写
async fn read_and_rewrite_x11_setup_packet<R>(
    reader: &mut R,
    expected_cookie_hex: &str,
    local_auth: Option<&(Vec<u8>, Vec<u8>)>,
) -> Result<Vec<u8>, String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    let mut setup_buf: Vec<u8> = Vec::with_capacity(512);
    let mut tmp = [0u8; 4096];

    loop {
        if setup_buf.len() >= 12 {
            let body_start = x11_setup_body_start(&setup_buf)?;
            if setup_buf.len() >= body_start {
                break;
            }
        }
        if setup_buf.len() >= MAX_X11_SETUP_BYTES {
            return Err("X11 握手首包超出最大长度限制".to_string());
        }

        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err("读取 X11 握手包超时".to_string());
        }

        let n = tokio::time::timeout(remaining, reader.read(&mut tmp))
            .await
            .map_err(|_| "读取 X11 握手包超时".to_string())?
            .map_err(|e| format!("读取 X11 握手包失败: {}", e))?;
        if n == 0 {
            return Err("X11 连接在对端发送完整握手包前关闭 (EOF)".to_string());
        }
        setup_buf.extend_from_slice(&tmp[..n]);
    }

    rewrite_x11_setup_packet(&setup_buf, expected_cookie_hex, local_auth)
}

/// 校验并改写 X11 建连首包中的认证 cookie（OpenSSH 标准防欺骗机制）：
/// 1. 解析 X11 ConnectionSetup 请求（大端 `'B'` 或小端 `'l'`）；
/// 2. 校验远端 X 客户端携带的 cookie 是否等于本会话生成的 `expected_cookie_hex`；
/// 3. 将认证段替换为本地真实 `.Xauthority` 凭据（若本地未启用 xauth 则清空认证字段以兼容 `-ac` 模式）。
pub fn rewrite_x11_setup_packet(
    packet: &[u8],
    expected_cookie_hex: &str,
    local_auth: Option<&(Vec<u8>, Vec<u8>)>,
) -> Result<Vec<u8>, String> {
    let body_start = x11_setup_body_start(packet)?;
    let read_u16 = |b0: u8, b1: u8| -> u16 {
        if packet[0] == b'B' {
            u16::from_be_bytes([b0, b1])
        } else {
            u16::from_le_bytes([b0, b1])
        }
    };
    let write_u16 = |val: u16| -> [u8; 2] {
        if packet[0] == b'B' {
            val.to_be_bytes()
        } else {
            val.to_le_bytes()
        }
    };

    let name_len = read_u16(packet[6], packet[7]) as usize;
    let data_len = read_u16(packet[8], packet[9]) as usize;
    let name_start = 12usize;
    let name_end = name_start + name_len;
    let data_start = name_end + x11_pad4(name_len);
    let data_end = data_start + data_len;

    if packet.len() < body_start {
        return Err("X11 建连首包不完整".to_string());
    }

    let proto_name = &packet[name_start..name_end];
    let presented_cookie = &packet[data_start..data_end];
    let expected_bytes =
        hex::decode(expected_cookie_hex).map_err(|e| format!("Cookie 编码错误: {}", e))?;

    if proto_name != X11_AUTH_PROTOCOL.as_bytes() || presented_cookie != expected_bytes.as_slice() {
        return Err("X11 客户端 MIT-MAGIC-COOKIE-1 校验失败，已拒绝通道".to_string());
    }

    let (repl_name, repl_data): (&[u8], &[u8]) = match local_auth {
        Some((n, d)) => (n.as_slice(), d.as_slice()),
        None => (&[], &[]),
    };

    let mut out = Vec::with_capacity(12 + repl_name.len() + 4 + repl_data.len() + 4 + (packet.len() - body_start));
    out.extend_from_slice(&packet[0..6]);
    out.extend_from_slice(&write_u16(repl_name.len() as u16));
    out.extend_from_slice(&write_u16(repl_data.len() as u16));
    out.extend_from_slice(&packet[10..12]);
    out.extend_from_slice(repl_name);
    out.resize(out.len() + x11_pad4(repl_name.len()), 0);
    out.extend_from_slice(repl_data);
    out.resize(out.len() + x11_pad4(repl_data.len()), 0);
    out.extend_from_slice(&packet[body_start..]);
    Ok(out)
}

trait X11ByteStream: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send {}
impl<T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send> X11ByteStream for T {}

async fn open_local_x11_stream(target: &X11DisplayTarget) -> Result<Box<dyn X11ByteStream>, String> {
    match target {
        #[cfg(unix)]
        X11DisplayTarget::UnixSocket(path) => {
            let stream = tokio::net::UnixStream::connect(path)
                .await
                .map_err(|e| format!("连接本地 X11 Unix Socket ({}) 失败: {}", path.display(), e))?;
            Ok(Box::new(stream))
        }
        #[cfg(not(unix))]
        X11DisplayTarget::UnixSocket(path) => Err(format!(
            "当前平台不支持直接连接 Unix X11 Socket ({})",
            path.display()
        )),
        X11DisplayTarget::Tcp { host, port } => {
            let stream = tokio::time::timeout(
                Duration::from_secs(3),
                tokio::net::TcpStream::connect((host.as_str(), *port)),
            )
            .await
            .map_err(|_| format!("连接本地 X Server ({}:{}) 超时", host, port))?
            .map_err(|e| {
                format!(
                    "无法连接本地 X Server ({}:{}): {}。请确认已启动 VcXsrv / Xming / XQuartz / Xorg。",
                    host, port, e
                )
            })?;
            let _ = stream.set_nodelay(true);
            Ok(Box::new(stream))
        }
    }
}

/// 将服务端打开的 `x11` 通道与本地 X Server 双向桥接。
pub async fn bridge_x11_channel(
    channel: russh::Channel<russh::client::Msg>,
    server_id: &str,
    originator_address: &str,
    originator_port: u32,
) -> Result<(), String> {
    let session = X11ForwardRegistry::global().get(server_id).await;
    let display_spec = session
        .as_ref()
        .map(|s| s.display_spec.clone())
        .unwrap_or_else(default_display_spec);
    let target = match parse_display_spec(&display_spec) {
        Ok(t) => t,
        Err(e) => {
            let _ = channel.close().await;
            return Err(format!("解析 DISPLAY ({}) 失败: {}", display_spec, e));
        }
    };

    let mut local_stream = match open_local_x11_stream(&target).await {
        Ok(s) => s,
        Err(e) => {
            let _ = channel.close().await;
            return Err(format!(
                "无法打开本地 X Server 连接 ({} <- {}:{}): {}",
                server_id, originator_address, originator_port, e
            ));
        }
    };

    let mut ssh_stream = channel.into_stream();

    // 若注册了本会话 cookie，循环读取完整的 X11 ConnectionSetup 首包并替换本地 Xauthority cookie
    if let Some(sess) = session {
        let display_num = match &target {
            X11DisplayTarget::Tcp { port, .. } => port.saturating_sub(6000),
            X11DisplayTarget::UnixSocket(p) => p
                .file_name()
                .and_then(|s| s.to_str())
                .and_then(|s| s.strip_prefix('X'))
                .and_then(|s| s.parse::<u16>().ok())
                .unwrap_or(0),
        };
        let local_auth = read_local_xauthority_cookie(display_num);
        match read_and_rewrite_x11_setup_packet(
            &mut ssh_stream,
            &sess.auth_cookie_hex,
            local_auth.as_ref(),
        )
        .await
        {
            Ok(rewritten) => {
                if let Err(e) = local_stream.write_all(&rewritten).await {
                    let _ = ssh_stream.shutdown().await;
                    return Err(format!("写入本地 X11 握手包失败: {}", e));
                }
            }
            Err(e) => {
                let _ = ssh_stream.shutdown().await;
                return Err(format!(
                    "拒绝或无法完成 X11 握手 ({} <- {}:{}): {}",
                    server_id, originator_address, originator_port, e
                ));
            }
        }
    }

    match tokio::io::copy_bidirectional(&mut ssh_stream, &mut local_stream).await {
        Ok((to_local, to_remote)) => {
            tracing::debug!(
                "[X11Forward] {} 转发通道结束: remote->x11={}B, x11->remote={}B",
                server_id,
                to_local,
                to_remote
            );
        }
        Err(e) => {
            tracing::debug!("[X11Forward] {} 转发通道结束: {}", server_id, e);
        }
    }
    Ok(())
}

/// 前端展示的本地 X11 环境与离线插件包探测结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct X11EnvironmentProbe {
    pub available: bool,
    pub reachability_ok: bool,
    pub display: Option<String>,
    pub detected_server: Option<String>,
    pub executable_path: Option<String>,
    pub addon_dir: String,
    pub addon_installed: bool,
    pub message: String,
}

fn find_addon_executable(addon_dir: &Path) -> Option<(String, PathBuf)> {
    if !addon_dir.exists() {
        return None;
    }
    let candidates: &[(&str, &str)] = if cfg!(target_os = "windows") {
        &[
            ("VcXsrv (Addon)", "vcxsrv.exe"),
            ("Xming (Addon)", "Xming.exe"),
            ("Cygwin XWin (Addon)", "XWin.exe"),
        ]
    } else if cfg!(target_os = "macos") {
        &[("XQuartz (Addon)", "Xquartz")]
    } else {
        &[
            ("Xwayland (Addon)", "Xwayland"),
            ("Xorg (Addon)", "Xorg"),
        ]
    };

    for (label, bin_name) in candidates {
        let direct = addon_dir.join(bin_name);
        if direct.is_file() {
            return Some(((*label).to_string(), direct));
        }
        if let Ok(entries) = std::fs::read_dir(addon_dir) {
            for entry in entries.flatten() {
                let sub = entry.path();
                if sub.is_dir() {
                    let nested = sub.join(bin_name);
                    if nested.is_file() {
                        return Some(((*label).to_string(), nested));
                    }
                    let nested_bin = sub.join("bin").join(bin_name);
                    if nested_bin.is_file() {
                        return Some(((*label).to_string(), nested_bin));
                    }
                }
            }
        }
    }
    None
}

fn find_system_x_server() -> Option<(String, String)> {
    #[cfg(target_os = "windows")]
    {
        let system_candidates = [
            ("VcXsrv", r"C:\Program Files\VcXsrv\vcxsrv.exe"),
            ("VcXsrv (x86)", r"C:\Program Files (x86)\VcXsrv\vcxsrv.exe"),
            ("Xming", r"C:\Program Files (x86)\Xming\Xming.exe"),
            ("Xming", r"C:\Program Files\Xming\Xming.exe"),
        ];
        for (name, path) in system_candidates {
            if Path::new(path).is_file() {
                return Some((name.to_string(), path.to_string()));
            }
        }
        if let Ok(path_var) = std::env::var("PATH") {
            for dir in std::env::split_paths(&path_var) {
                for (name, bin) in [("VcXsrv", "vcxsrv.exe"), ("Xming", "Xming.exe")] {
                    let full = dir.join(bin);
                    if full.is_file() {
                        return Some((name.to_string(), full.to_string_lossy().to_string()));
                    }
                }
            }
        }
        None
    }
    #[cfg(target_os = "macos")]
    {
        let candidates = [
            ("XQuartz", "/Applications/Utilities/XQuartz.app"),
            ("XQuartz", "/opt/X11/bin/Xquartz"),
        ];
        for (name, path) in candidates {
            if Path::new(path).exists() {
                return Some((name.to_string(), path.to_string()));
            }
        }
        None
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(path_var) = std::env::var("PATH") {
            for dir in std::env::split_paths(&path_var) {
                for (name, bin) in [("Xwayland", "Xwayland"), ("Xorg", "Xorg"), ("Xvfb", "Xvfb")] {
                    let full = dir.join(bin);
                    if full.is_file() {
                        return Some((name.to_string(), full.to_string_lossy().to_string()));
                    }
                }
            }
        }
        None
    }
}

fn quick_probe_display_reachable(target: &X11DisplayTarget) -> bool {
    match target {
        X11DisplayTarget::Tcp { host, port } => {
            if let Ok(ip) = host.parse::<std::net::IpAddr>() {
                let addr = SocketAddr::new(ip, *port);
                return std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(120)).is_ok();
            }
            false
        }
        #[cfg(unix)]
        X11DisplayTarget::UnixSocket(path) => path.exists(),
        #[cfg(not(unix))]
        X11DisplayTarget::UnixSocket(_) => false,
    }
}

/// 探测本地 X11 运行环境及 `$APP_DATA/addons/xserver` 离线插件包。
pub fn probe_local_x11_environment(app_data_dir: &Path) -> X11EnvironmentProbe {
    let addon_dir = app_data_dir.join("addons").join("xserver");
    let addon_found = find_addon_executable(&addon_dir);
    let system_found = find_system_x_server();
    let display_env = std::env::var("DISPLAY")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let effective_display = display_env.clone().unwrap_or_else(|| "127.0.0.1:0".to_string());
    let reachability_ok = parse_display_spec(&effective_display)
        .map(|t| quick_probe_display_reachable(&t))
        .unwrap_or(false);

    let (detected_server, executable_path) = if let Some((name, path)) = addon_found.as_ref() {
        (Some(name.clone()), Some(path.to_string_lossy().to_string()))
    } else if let Some((name, path)) = system_found.as_ref() {
        (Some(name.clone()), Some(path.clone()))
    } else if reachability_ok {
        (Some("Active X11 Display".to_string()), None)
    } else {
        (None, None)
    };

    let available = reachability_ok || detected_server.is_some();
    let message = if reachability_ok {
        format!(
            "检测到本地 X11 Display ({}) 已就绪，可直接进行图形窗口转发。",
            effective_display
        )
    } else if let Some(ref srv) = detected_server {
        format!(
            "已检测到 {}，但尚未探测到监听端口 (127.0.0.1:6000)；启动 X Server 并勾选 Disable access control 后即可使用。",
            srv
        )
    } else {
        "未检测到本地 X Server（如 Windows VcXsrv / Xming、macOS XQuartz）。可自行安装或导入离线 X Server 插件包到 addons 目录。".to_string()
    };

    X11EnvironmentProbe {
        available,
        reachability_ok,
        display: display_env,
        detected_server,
        executable_path,
        addon_dir: addon_dir.to_string_lossy().to_string(),
        addon_installed: addon_found.is_some(),
        message,
    }
}

/// 离线导入用户本地下载的 X Server 插件包（.zip 或单文件可执行程序）到 `$APP_DATA/addons/xserver`。
pub fn import_x11_addon_archive(
    app_data_dir: &Path,
    archive_path: &str,
) -> Result<X11EnvironmentProbe, String> {
    let trimmed = archive_path.trim();
    if trimmed.is_empty() {
        return Err("请选择有效的 X Server 安装包或可执行文件路径".to_string());
    }
    let src = Path::new(trimmed);
    if !src.exists() {
        return Err(format!("文件不存在: {}", trimmed));
    }

    let addon_dir = app_data_dir.join("addons").join("xserver");
    std::fs::create_dir_all(&addon_dir)
        .map_err(|e| format!("创建 addons 目录失败: {}", e))?;

    let ext = src
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    if ext == "zip" {
        // 使用系统内置 tar (Windows 10+/macOS/Linux 均原生支持 zip 解压) 或 unzip 解压
        let status = std::process::Command::new("tar")
            .arg("-xf")
            .arg(src)
            .arg("-C")
            .arg(&addon_dir)
            .status();
        let extracted = match status {
            Ok(s) if s.success() => true,
            _ => {
                #[cfg(unix)]
                {
                    matches!(
                        std::process::Command::new("unzip")
                            .arg("-q")
                            .arg("-o")
                            .arg(src)
                            .arg("-d")
                            .arg(&addon_dir)
                            .status(),
                        Ok(s) if s.success()
                    )
                }
                #[cfg(not(unix))]
                {
                    false
                }
            }
        };
        if !extracted {
            return Err("解压 .zip 插件包失败，请确认压缩包完整有效".to_string());
        }
    } else if src.is_file() {
        let file_name = src
            .file_name()
            .ok_or_else(|| "无效的文件名".to_string())?;
        let dest = addon_dir.join(file_name);
        std::fs::copy(src, &dest)
            .map_err(|e| format!("复制文件到 addons 目录失败: {}", e))?;
    } else {
        return Err("仅支持导入 .zip 插件包或 X Server 可执行文件".to_string());
    }

    Ok(probe_local_x11_environment(app_data_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_is_32_lowercase_hex_and_unique() {
        let c1 = generate_mit_magic_cookie();
        let c2 = generate_mit_magic_cookie();
        assert_eq!(c1.len(), 32);
        assert_eq!(c2.len(), 32);
        assert!(c1.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_ne!(c1, c2);
    }

    #[test]
    fn parses_x11_display_specifications() {
        assert_eq!(
            parse_display_spec("127.0.0.1:0").unwrap(),
            X11DisplayTarget::Tcp {
                host: "127.0.0.1".to_string(),
                port: 6000
            }
        );
        assert_eq!(
            parse_display_spec("localhost:10.0").unwrap(),
            X11DisplayTarget::Tcp {
                host: "localhost".to_string(),
                port: 6010
            }
        );
        assert_eq!(
            parse_display_spec("[::1]:2.1").unwrap(),
            X11DisplayTarget::Tcp {
                host: "::1".to_string(),
                port: 6002
            }
        );
    }

    #[test]
    fn gates_x11_channel_by_policy() {
        assert!(!should_accept_x11_channel(false));
        assert!(should_accept_x11_channel(true));
    }

    #[test]
    fn validates_and_rewrites_mit_magic_cookie_setup_packet() {
        let cookie_hex = "00112233445566778899aabbccddeeff";
        let cookie_bytes = hex::decode(cookie_hex).unwrap();
        let proto = b"MIT-MAGIC-COOKIE-1";
        let mut pkt = vec![
            b'l', 0, // little-endian
            11, 0, 0, 0, // protocol major 11, minor 0
        ];
        pkt.extend_from_slice(&(proto.len() as u16).to_le_bytes());
        pkt.extend_from_slice(&(cookie_bytes.len() as u16).to_le_bytes());
        pkt.extend_from_slice(&[0, 0]);
        pkt.extend_from_slice(proto);
        pkt.resize(pkt.len() + x11_pad4(proto.len()), 0);
        pkt.extend_from_slice(&cookie_bytes);
        pkt.resize(pkt.len() + x11_pad4(cookie_bytes.len()), 0);
        pkt.extend_from_slice(&[0xaa, 0xbb]);

        // Spoofed wrong cookie must be rejected
        assert!(rewrite_x11_setup_packet(&pkt, "ffffffffffffffffffffffffffffffff", None).is_err());

        // Matching cookie succeeds and replaces with local auth (or empty)
        let rewritten = rewrite_x11_setup_packet(&pkt, cookie_hex, None).unwrap();
        assert_eq!(u16::from_le_bytes([rewritten[6], rewritten[7]]), 0);
        assert_eq!(u16::from_le_bytes([rewritten[8], rewritten[9]]), 0);
        assert_eq!(&rewritten[12..], &[0xaa, 0xbb]);
    }

    #[test]
    fn detects_addon_xserver_in_app_data_directory() {
        let unique = format!("qshell_x11_probe_test_{}", std::process::id());
        let base = std::env::temp_dir().join(unique);
        let xserver_dir = base.join("addons").join("xserver");
        std::fs::create_dir_all(&xserver_dir).unwrap();

        #[cfg(target_os = "windows")]
        let bin_name = "vcxsrv.exe";
        #[cfg(target_os = "macos")]
        let bin_name = "Xquartz";
        #[cfg(all(unix, not(target_os = "macos")))]
        let bin_name = "Xwayland";

        std::fs::write(xserver_dir.join(bin_name), b"stub").unwrap();
        let probe = probe_local_x11_environment(&base);
        assert!(probe.addon_installed);
        assert!(probe.available);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn reads_and_rewrites_fragmented_x11_setup_packet() {
        let cookie_hex = "00112233445566778899aabbccddeeff";
        let cookie_bytes = hex::decode(cookie_hex).unwrap();
        let proto = b"MIT-MAGIC-COOKIE-1";
        let mut pkt = vec![
            b'l', 0, // little-endian
            11, 0, 0, 0, // protocol major 11, minor 0
        ];
        pkt.extend_from_slice(&(proto.len() as u16).to_le_bytes());
        pkt.extend_from_slice(&(cookie_bytes.len() as u16).to_le_bytes());
        pkt.extend_from_slice(&[0, 0]);
        pkt.extend_from_slice(proto);
        pkt.resize(pkt.len() + x11_pad4(proto.len()), 0);
        pkt.extend_from_slice(&cookie_bytes);
        pkt.resize(pkt.len() + x11_pad4(cookie_bytes.len()), 0);
        pkt.extend_from_slice(&[0xde, 0xad]);

        let (mut writer, mut reader) = tokio::io::duplex(64);
        let pkt_clone = pkt.clone();
        tokio::spawn(async move {
            // 故意按 3/5/7 字节切分发送，模拟 SSH 通道分片到达
            for chunk in pkt_clone.chunks(5) {
                writer.write_all(chunk).await.unwrap();
                tokio::task::yield_now().await;
            }
        });

        let local_auth = (b"MIT-MAGIC-COOKIE-1".to_vec(), vec![0xab; 16]);
        let rewritten = read_and_rewrite_x11_setup_packet(&mut reader, cookie_hex, Some(&local_auth))
            .await
            .expect("fragmented X11 setup header must reassemble cleanly");
        assert_eq!(u16::from_le_bytes([rewritten[6], rewritten[7]]), 18);
        assert_eq!(u16::from_le_bytes([rewritten[8], rewritten[9]]), 16);
        assert!(rewritten.ends_with(&[0xde, 0xad]));
    }
}
