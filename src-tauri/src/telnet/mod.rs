//! Telnet 协议传输层（P0-5）
//!
//! 实现：
//! 1. 纯 TCP 连接（默认端口 23，无加密）
//! 2. RFC 854 IAC（Interpret As Command）序列处理：
//!    - 拒绝大多数选项协商（WONT/DONT），保持客户端简单
//!    - 接受 TERMINAL-TYPE（option 24）并响应 "XTERM-256COLOR"
//!    - 接受 NAWS（option 31）并推送窗口尺寸
//!    - 抑制 GO-AHEAD（option 3）以提升交互流畅度
//! 3. 与 SSH shell 共用 `ssh:shell-output` 事件，前端无需感知协议差异
//!
//! 设计：
//! - 独立的 session map（与 shell.rs 的 SSH sessions 分离）
//! - session_id 前缀 `telnet-`，便于 ssh_write_to_shell 等命令路由判断
//! - 复用 shell.rs 的 ShellCmd 枚举与 cancel/done 信号模式

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex, Notify};
use tokio::time::timeout;

use crate::ssh::shell::ShellOutputData;
use crate::ssh::terminal_encoding::TerminalCodec;

// ============================================================================
// Telnet IAC 常量（RFC 854）
// ============================================================================

/// IAC 起始字节：所有 Telnet 命令以 0xFF 开头
const IAC: u8 = 0xFF;
/// DON'T 请求对端不启用某选项
const DONT: u8 = 0xFE;
/// DO 请求对端启用某选项
const DO: u8 = 0xFD;
/// WON'T 拒绝启用某选项
const WONT: u8 = 0xFC;
/// WILL 同意 / 主动启用某选项
const WILL: u8 = 0xFB;
/// 子协商起始
const SB: u8 = 0xFA;
/// 子协商结束（前接 IAC）
const SE: u8 = 0xF0;

/// 选项：Suppress Go Ahead（抑制 GO-AHEAD，交互终端必备）
const OPT_SUPPRESS_GA: u8 = 3;
/// 选项：Echo（对端回显）
const OPT_ECHO: u8 = 1;
/// 选项：Terminal Type（TERMINAL-TYPE）
const OPT_TERMINAL_TYPE: u8 = 24;
/// 选项：NAWS（Negotiate About Window Size）
const OPT_NAWS: u8 = 31;
/// 选项：Terminal Speed
const OPT_TERMINAL_SPEED: u8 = 32;
/// 选项：Linemode
const OPT_LINEMODE: u8 = 34;

/// 子协商命令：SB TERMINAL-TYPE SEND
const SUBCMD_TERMINAL_TYPE_SEND: u8 = 1;
/// 子协商命令：SB TERMINAL-TYPE IS（响应）
const SUBCMD_TERMINAL_TYPE_IS: u8 = 0;

/// 客户端宣告的终端类型（兼容老交换机对大小写敏感的解析）
const TERMINAL_TYPE: &[u8] = b"XTERM-256COLOR";

// ============================================================================
// Session 管理
// ============================================================================

/// Telnet 会话命令（与 shell.rs 的 ShellCmd 类似，但无 Zmodem 支持）
enum TelnetCmd {
    Write(String),
    SetEncoding(String),
    Resize { cols: u16, rows: u16 },
    Close,
}

/// Telnet 会话句柄
#[derive(Clone)]
struct TelnetSession {
    tx: mpsc::Sender<TelnetCmd>,
    /// 历史输出缓存（环形缓冲区，最大 256KB）
    history: Arc<std::sync::Mutex<Vec<u8>>>,
    window_label: String,
    server_id: String,
    cancel: Arc<AtomicBool>,
    done: Arc<Notify>,
    encoding: Arc<std::sync::Mutex<String>>,
}

const HISTORY_MAX_BYTES: usize = 256 * 1024;

static TELNET_SESSIONS: std::sync::OnceLock<Arc<Mutex<HashMap<String, TelnetSession>>>> =
    std::sync::OnceLock::new();

fn sessions() -> &'static Arc<Mutex<HashMap<String, TelnetSession>>> {
    TELNET_SESSIONS.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

// ============================================================================
// IAC 协商处理
// ============================================================================

/// IAC 解析状态机
enum IacState {
    /// 普通数据流
    Data,
    /// 收到 IAC 字节，等待命令
    Iac,
    /// 收到 WILL/WONT/DO/DONT，等待选项字节
    Negotiate(u8),
    /// 子协商模式：SB OPTION ... IAC SE
    Subnegotiate { option: u8, buf: Vec<u8> },
    /// 子协商中收到 IAC，等待 SE 或其他
    SubnegotiateIac { option: u8, buf: Vec<u8> },
}

/// Telnet IAC 协商器：解析输入流，分离协议字节与终端数据
struct IacParser {
    state: IacState,
    /// 待发回给对端的协商响应字节
    pending_response: Vec<u8>,
}

impl IacParser {
    fn new() -> Self {
        Self {
            state: IacState::Data,
            pending_response: Vec::new(),
        }
    }

    /// 处理输入字节流，返回分离出的终端数据
    fn process(&mut self, input: &[u8]) -> Vec<u8> {
        let mut output = Vec::with_capacity(input.len());

        for &byte in input {
            match &mut self.state {
                IacState::Data => {
                    if byte == IAC {
                        self.state = IacState::Iac;
                    } else {
                        output.push(byte);
                    }
                }
                IacState::Iac => {
                    match byte {
                        IAC => {
                            // IAC IAC = 转义的 0xFF 字节
                            output.push(IAC);
                            self.state = IacState::Data;
                        }
                        WILL => self.state = IacState::Negotiate(WILL),
                        WONT => self.state = IacState::Negotiate(WONT),
                        DO => self.state = IacState::Negotiate(DO),
                        DONT => self.state = IacState::Negotiate(DONT),
                        SB => {
                            self.state = IacState::Subnegotiate {
                                option: 0,
                                buf: Vec::new(),
                            };
                            // 等待下一个字节确定 option
                            // 这里把 state 切换到 Subnegotiate，但 option 还是 0
                            // 下一个字节会被当作 option 处理
                            // 为简化：在 Subnegotiate 分支中第一个字节填入 option
                        }
                        _ => {
                            // 其他命令（如 NOP, GA, BRK）：忽略
                            self.state = IacState::Data;
                        }
                    }
                }
                IacState::Negotiate(cmd) => {
                    let cmd_val = *cmd;
                    self.handle_negotiation(cmd_val, byte);
                    self.state = IacState::Data;
                }
                IacState::Subnegotiate { option, buf } => {
                    if *option == 0 {
                        // 第一个字节是 option
                        *option = byte;
                    } else if byte == IAC {
                        self.state = IacState::SubnegotiateIac {
                            option: *option,
                            buf: std::mem::take(buf),
                        };
                    } else {
                        buf.push(byte);
                    }
                }
                IacState::SubnegotiateIac { option, buf } => {
                    match byte {
                        SE => {
                            // 子协商结束
                            let opt = *option;
                            let data = std::mem::take(buf);
                            self.handle_subnegotiation(opt, &data);
                            self.state = IacState::Data;
                        }
                        IAC => {
                            // IAC IAC 在子协商中也是转义
                            buf.push(IAC);
                            self.state = IacState::Subnegotiate {
                                option: *option,
                                buf: std::mem::take(buf),
                            };
                        }
                        _ => {
                            // 异常：IAC 后跟非 SE/IAC，恢复子协商
                            buf.push(IAC);
                            buf.push(byte);
                            self.state = IacState::Subnegotiate {
                                option: *option,
                                buf: std::mem::take(buf),
                            };
                        }
                    }
                }
            }
        }

        output
    }

    /// 处理 WILL/WONT/DO/DONT 协商
    fn handle_negotiation(&mut self, cmd: u8, option: u8) {
        match cmd {
            WILL => {
                // 对端宣告它能做某选项
                match option {
                    OPT_SUPPRESS_GA | OPT_ECHO => {
                        // 接受：抑制 GO-AHEAD 和对端回显对交互终端有利
                        self.pending_response.push(IAC);
                        self.pending_response.push(DO);
                        self.pending_response.push(option);
                    }
                    _ => {
                        // 拒绝其他选项
                        self.pending_response.push(IAC);
                        self.pending_response.push(DONT);
                        self.pending_response.push(option);
                    }
                }
            }
            DO => {
                // 对端请求我们做某选项
                match option {
                    OPT_SUPPRESS_GA => {
                        self.pending_response.push(IAC);
                        self.pending_response.push(WILL);
                        self.pending_response.push(option);
                    }
                    OPT_TERMINAL_TYPE => {
                        // 同意宣告终端类型
                        self.pending_response.push(IAC);
                        self.pending_response.push(WILL);
                        self.pending_response.push(option);
                    }
                    OPT_NAWS => {
                        // 同意发送窗口尺寸（实际尺寸在 resize 时发送）
                        self.pending_response.push(IAC);
                        self.pending_response.push(WILL);
                        self.pending_response.push(option);
                        // NAWS 子协商稍后由 resize 触发
                    }
                    OPT_TERMINAL_SPEED | OPT_LINEMODE => {
                        // 拒绝：我们不支持
                        self.pending_response.push(IAC);
                        self.pending_response.push(WONT);
                        self.pending_response.push(option);
                    }
                    _ => {
                        // 默认拒绝
                        self.pending_response.push(IAC);
                        self.pending_response.push(WONT);
                        self.pending_response.push(option);
                    }
                }
            }
            WONT | DONT => {
                // 对端拒绝 / 请求我们停止：确认即可（无需响应，但部分实现期待 ACK）
                // 通常静默接受
            }
            _ => {}
        }
    }

    /// 处理子协商
    fn handle_subnegotiation(&mut self, option: u8, data: &[u8]) {
        if option == OPT_TERMINAL_TYPE {
            // 对端发送 SB TERMINAL-TYPE SEND IAC SE，请求我们宣告终端类型
            if !data.is_empty() && data[0] == SUBCMD_TERMINAL_TYPE_SEND {
                // 响应：SB TERMINAL-TYPE IS <type> IAC SE
                let mut resp = vec![IAC, SB, OPT_TERMINAL_TYPE, SUBCMD_TERMINAL_TYPE_IS];
                resp.extend_from_slice(TERMINAL_TYPE);
                resp.push(IAC);
                resp.push(SE);
                self.pending_response.extend(resp);
            }
        }
    }

    /// 取出待发送的协商响应字节
    fn take_response(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.pending_response)
    }
}

/// 构造 NAWS 子协商字节（cols, rows 为 u16）
fn build_naws_subnegotiation(cols: u16, rows: u16) -> Vec<u8> {
    let mut resp = vec![IAC, SB, OPT_NAWS];
    // NAWS 格式：4 字节（cols hi, cols lo, rows hi, rows lo）
    // 0xFF 需要转义为 IAC IAC
    let cols_hi = (cols >> 8) as u8;
    let cols_lo = (cols & 0xFF) as u8;
    let rows_hi = (rows >> 8) as u8;
    let rows_lo = (rows & 0xFF) as u8;
    for b in [cols_hi, cols_lo, rows_hi, rows_lo] {
        resp.push(b);
        if b == IAC {
            resp.push(IAC);
        }
    }
    resp.push(IAC);
    resp.push(SE);
    resp
}

fn encode_user_data(codec: &TerminalCodec, text: &str) -> Result<Vec<u8>, String> {
    let data = codec.encode(text)?;
    let mut escaped = Vec::with_capacity(data.len() + 4);
    for byte in data {
        escaped.push(byte);
        if byte == IAC {
            escaped.push(IAC);
        }
    }
    Ok(escaped)
}

/// 去掉常见 ANSI/CSI 控制序列，避免彩色登录提示影响关键字识别。
fn plain_prompt_text(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\u{1b}' {
            output.push(ch);
            continue;
        }
        if chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if ('@'..='~').contains(&next) {
                    break;
                }
            }
        }
    }
    output
}

fn last_prompt_line(buffer: &str) -> String {
    plain_prompt_text(buffer)
        .split(['\r', '\n'])
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase()
}

fn is_username_prompt(buffer: &str) -> bool {
    let line = last_prompt_line(buffer);
    if line.contains("last login") {
        return false;
    }
    line == "login:"
        || (line.ends_with(" login:") && !line.starts_with("last "))
        || line == "user:"
        || line.ends_with(" user:")
        || line == "username:"
        || line.ends_with(" username:")
        || line == "user name:"
        || line.ends_with(" user name:")
        || line == "用户名:"
        || line == "用户名："
}

fn is_password_prompt(buffer: &str) -> bool {
    let line = last_prompt_line(buffer);
    !line.contains("failed password")
        && (line == "password:"
            || line.ends_with(" password:")
            || line == "密码:"
            || line == "密码：")
}

// ============================================================================
// 公开 API
// ============================================================================

/// 创建 Telnet 会话
///
/// 与 `ssh::shell::shell_create` 行为一致：
/// - 立即建立 TCP 连接（async，等待连接成功后返回 session_id）
/// - 通过 `ssh:shell-output` 事件推送终端输出（前端无感知协议差异）
/// - 返回的 session_id 前缀为 `telnet-`，便于 ssh_write_to_shell 路由
pub async fn telnet_create_shell(
    app: AppHandle,
    window_label: String,
    server_id: String,
    host: String,
    port: u16,
    cols: u32,
    rows: u32,
    timeout_secs: u32,
    encoding: String,
    login_username: Option<String>,
    login_password: Option<String>,
) -> Result<String, String> {
    let session_id = format!("telnet-{}", uuid::Uuid::new_v4());
    let sid = session_id.clone();

    // 1. 建立 TCP 连接（带超时）
    let addr_str = format!("{}:{}", host, port);
    let connect_result = timeout(
        Duration::from_secs(timeout_secs.max(5) as u64),
        TcpStream::connect(addr_str.clone()),
    )
    .await;
    let stream = match connect_result {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => return Err(format!("Telnet connect failed: {}", e)),
        Err(_) => return Err(format!("Telnet connect timed out ({}s)", timeout_secs)),
    };

    // 设置 TCP nodelay，降低交互延迟
    let _ = stream.set_nodelay(true);

    // TCP keepalive：中间 NAT/防火墙可能静默丢弃连接（无 FIN/RST），此时 read 会
    // 永久阻塞，终端变成「显示已连接但无任何输出」的僵尸会话（SSH 侧由 russh
    // keepalive 覆盖，Telnet 必须在 TCP 层自行处理）。开启 keepalive 探测后，
    // 死连接会在探测失败后从 read 返回 Err，走正常清理并通知前端断开。
    // 60s 空闲后开始探测、每 15s 一次，探测失败即判死（Windows 上由 SIO_KEEPALIVES
    // 配置；tokio 的 set_keepalive 只能启用默认参数，Windows 默认 2 小时太久）。
    {
        let ka = socket2::TcpKeepalive::new()
            .with_time(Duration::from_secs(60))
            .with_interval(Duration::from_secs(15));
        // SAFETY: 借用 stream 底层句柄配置 keepalive 后立即通过 into_raw_* 归还
        // 所有权，不会关闭句柄（stream 自身仍持有并负责关闭）
        #[cfg(windows)]
        unsafe {
            use std::os::windows::io::{AsRawSocket, FromRawSocket, IntoRawSocket};
            let raw = stream.as_raw_socket();
            let sock = socket2::Socket::from_raw_socket(raw);
            let _ = sock.set_tcp_keepalive(&ka);
            // into_raw_socket 归还句柄所有权给 stream（不关闭）；返回值必须消费
            let _ = sock.into_raw_socket();
        }
        #[cfg(unix)]
        unsafe {
            use std::os::fd::{AsRawFd, FromRawFd, IntoRawFd};
            let raw = stream.as_raw_fd();
            let sock = socket2::Socket::from_raw_fd(raw);
            let _ = sock.set_tcp_keepalive(&ka);
            let _ = sock.into_raw_fd();
        }
    }

    // 2. 将 stream 拆分为 read / write 半部
    let (read_half, write_half) = stream.into_split();

    // 3. 注册 session
    let (tx, mut rx) = mpsc::channel::<TelnetCmd>(64);
    let history = Arc::new(std::sync::Mutex::new(Vec::new()));
    let cancel = Arc::new(AtomicBool::new(false));
    let done = Arc::new(Notify::new());
    let normalized_encoding = crate::ssh::terminal_encoding::normalize_encoding(&encoding);
    let session_encoding = Arc::new(std::sync::Mutex::new(normalized_encoding.clone()));
    let cancel_for_map = cancel.clone();
    let done_for_map = done.clone();
    sessions().lock().await.insert(sid.clone(), TelnetSession {
        tx,
        history: history.clone(),
        window_label: window_label.clone(),
        server_id,
        cancel: cancel_for_map,
        done: done_for_map,
        encoding: session_encoding.clone(),
    });

    // 4. 启动 reader / writer 任务
    let app_clone = app.clone();
    let history_clone = history.clone();
    let cancel_for_task = cancel.clone();
    let done_for_task = done.clone();
    let mut writer = write_half;
    let mut reader = read_half;

    tokio::spawn(async move {
        let mut buffer = Vec::new();
        let mut terminal_codec = TerminalCodec::new(&normalized_encoding)
            .unwrap_or_else(|_| TerminalCodec::utf8());
        let mut flush_interval = tokio::time::interval(Duration::from_millis(30));
        flush_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut iac_parser = IacParser::new();
        let mut prompt_buffer = String::new();
        let mut username_sent = false;
        let mut password_sent = false;
        // 初始 NAWS：连接建立后立即发送窗口尺寸
        let initial_naws = build_naws_subnegotiation(cols as u16, rows as u16);
        let _ = writer.write_all(&initial_naws).await;

        // 退出原因：用于在 cleanup 阶段区分正常退出 / 异常退出
        let mut exit_err: Option<String> = None;

        'outer: loop {
            if cancel_for_task.load(Ordering::Relaxed) {
                break;
            }
            tokio::select! {
                // 读取 TCP 数据
                read_result = reader.read_buf(&mut buffer) => {
                    match read_result {
                        Ok(0) => break,  // EOF
                        Ok(_) => {
                            // 写入历史缓存（先复制一份，避免借用 buffer 跨越后续 await）
                            let data: Vec<u8> = buffer.clone();
                            {
                                // poison 容错：task 内其他位置 panic 会毒化 mutex，
                                // unwrap() 会级联 panic 跳过会话清理，改为取出内层数据继续
                                let mut hist = history_clone
                                    .lock()
                                    .unwrap_or_else(|e| e.into_inner());
                                hist.extend_from_slice(&data);
                                if hist.len() > HISTORY_MAX_BYTES {
                                    let drain = hist.len() - HISTORY_MAX_BYTES;
                                    hist.drain(0..drain);
                                }
                            }

                            // IAC 解析：分离协议字节与终端数据
                            let terminal_data = iac_parser.process(&data);

                            // 发送协商响应
                            let resp = iac_parser.take_response();
                            if !resp.is_empty() {
                                if let Err(e) = writer.write_all(&resp).await {
                                    #[cfg(debug_assertions)]
                                    eprintln!("[Telnet] {} write resp error: {}", sid, e);
                                    exit_err = Some(format!("write error: {}", e));
                                    break 'outer;
                                }
                            }

                            // 推送终端数据到前端
                            if !terminal_data.is_empty() {
                                let text = terminal_codec.decode(&terminal_data, false);
                                if !text.is_empty() && (!username_sent || !password_sent) {
                                    // 保留原始片段后统一清理 ANSI，避免颜色转义序列恰好被 TCP
                                    // 分包时，逐块清理丢失状态而识别不到登录提示。
                                    prompt_buffer.push_str(&text);
                                    if prompt_buffer.len() > 1024 {
                                        let split = prompt_buffer.len() - 1024;
                                        let split = (split..prompt_buffer.len())
                                            .find(|idx| prompt_buffer.is_char_boundary(*idx))
                                            .unwrap_or(0);
                                        prompt_buffer.drain(..split);
                                    }

                                    if !username_sent && is_username_prompt(&prompt_buffer) {
                                        if let Some(username) = login_username.as_deref() {
                                            if let Ok(data) = encode_user_data(&terminal_codec, &format!("{}\r\n", username)) {
                                                if writer.write_all(&data).await.is_ok() {
                                                    username_sent = true;
                                                    prompt_buffer.clear();
                                                }
                                            }
                                        }
                                    } else if !password_sent && is_password_prompt(&prompt_buffer) {
                                        if let Some(password) = login_password.as_deref() {
                                            if let Ok(data) = encode_user_data(&terminal_codec, &format!("{}\r\n", password)) {
                                                if writer.write_all(&data).await.is_ok() {
                                                    password_sent = true;
                                                    prompt_buffer.clear();
                                                }
                                            }
                                        }
                                    }
                                }
                                let _ = app_clone.emit("ssh:shell-output", ShellOutputData {
                                    session_id: sid.clone(),
                                    data: text,
                                    sequence: None,
                                });
                            }
                            buffer.clear();
                        }
                        Err(e) => {
                            #[cfg(debug_assertions)]
                            eprintln!("[Telnet] {} read error: {}", sid, e);
                            exit_err = Some(format!("read error: {}", e));
                            break;
                        }
                    }
                }
                // 处理命令
                cmd = rx.recv() => match cmd {
                    Some(TelnetCmd::Write(text)) => {
                        let escaped = match encode_user_data(&terminal_codec, &text) {
                            Ok(data) => data,
                            Err(error) => {
                                let _ = app_clone.emit("ssh:shell-error", ShellOutputData {
                                    session_id: sid.clone(), data: error, sequence: None,
                                });
                                continue;
                            }
                        };
                        match timeout(Duration::from_secs(10), writer.write_all(&escaped)).await {
                            Ok(Ok(())) => {}
                            Ok(Err(e)) => {
                                #[cfg(debug_assertions)]
                                eprintln!("[Telnet] {} write error: {}", sid, e);
                                exit_err = Some(format!("write error: {}", e));
                                break;
                            }
                            Err(_) => {
                                #[cfg(debug_assertions)]
                                eprintln!("[Telnet] {} write timeout", sid);
                                exit_err = Some("write timeout".to_string());
                                break;
                            }
                        }
                    }
                    Some(TelnetCmd::SetEncoding(name)) => {
                        match TerminalCodec::new(&name) {
                            Ok(next) => {
                                terminal_codec = next;
                                if let Ok(mut current) = session_encoding.lock() {
                                    *current = terminal_codec.name().to_string();
                                }
                            }
                            Err(error) => {
                                let _ = app_clone.emit("ssh:shell-error", ShellOutputData {
                                    session_id: sid.clone(), data: error, sequence: None,
                                });
                            }
                        }
                    }
                    Some(TelnetCmd::Resize { cols, rows }) => {
                        let naws = build_naws_subnegotiation(cols, rows);
                        let _ = writer.write_all(&naws).await;
                    }
                    Some(TelnetCmd::Close) | None => break,
                },
                // 定时刷新缓冲区（保留以对齐 shell.rs 架构，Telnet 端读取后立即推送）
                _ = flush_interval.tick() => {
                    if cancel_for_task.load(Ordering::Relaxed) {
                        break;
                    }
                }
            }
        }
        // 退出前关闭 writer
        let _ = writer.shutdown().await;

        // 清理 session
        sessions().lock().await.remove(&sid);

        match exit_err {
            Some(e) => {
                eprintln!("[Telnet] Session {} ended: {}", sid, e);
                let _ = app_clone.emit("ssh:shell-output", ShellOutputData {
                    session_id: sid.clone(),
                    data: format!("\r\n[Telnet Error] {}\r\n", e),
                    sequence: None,
                });
                let _ = app_clone.emit("ssh:shell-error", ShellOutputData {
                    session_id: sid.clone(),
                    data: e.clone(),
                    sequence: None,
                });
                // 错误退出同样要发 shell-closed：否则前端靠 error 回调兜底、会话状态
                // 卡在「已连接」，无法走统一的关闭清理/重连流程（正常退出 None 分支已发）
                let _ = app_clone.emit("ssh:shell-closed", ShellOutputData {
                    session_id: sid.clone(),
                    data: String::new(),
                    sequence: None,
                });
            }
            None => {
                let _ = app_clone.emit("ssh:shell-output", ShellOutputData {
                    session_id: sid.clone(),
                    data: "\r\n[Session closed]\r\n".to_string(),
                    sequence: None,
                });
                let _ = app_clone.emit("ssh:shell-closed", ShellOutputData {
                    session_id: sid.clone(),
                    data: String::new(),
                    sequence: None,
                });
            }
        }
        done_for_task.notify_waiters();
    });

    Ok(session_id)
}

/// 通过有界 channel 发送命令（带 10s 超时）。
/// reader 卡死（TCP 半开连接、无 FIN 静默断开）时 `send().await` 会因缓冲满
/// 永久挂起，导致该会话所有输入无响应且无任何报错；超时即报错让上层感知。
async fn telnet_send_cmd(tx: &tokio::sync::mpsc::Sender<TelnetCmd>, cmd: TelnetCmd) -> Result<(), String> {
    match timeout(Duration::from_secs(10), tx.send(cmd)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => Err("Telnet session closed or channel full".to_string()),
        Err(_) => Err(
            "Telnet session not responding (write timeout); the connection may be dead".to_string(),
        ),
    }
}

/// 向 Telnet 会话写入数据
pub async fn telnet_write(session_id: String, data: String) -> Result<(), String> {
    let sess = {
        let map = sessions().lock().await;
        map.get(&session_id).cloned()
    };
    match sess {
        Some(s) => {
            if s.cancel.load(Ordering::Relaxed) {
                return Err("Telnet session cancelled".to_string());
            }
            telnet_send_cmd(&s.tx, TelnetCmd::Write(data)).await
        }
        None => Err(format!(
            "Telnet session not found: {}",
            &session_id[..session_id.len().min(24)]
        )),
    }
}

pub async fn telnet_set_encoding(session_id: String, encoding: String) -> Result<(), String> {
    let sess = { sessions().lock().await.get(&session_id).cloned() };
    match sess {
        Some(s) => telnet_send_cmd(&s.tx, TelnetCmd::SetEncoding(encoding)).await,
        None => Err(format!("Telnet session not found: {}", &session_id[..session_id.len().min(24)])),
    }
}

/// 调整 Telnet 会话的窗口尺寸
pub async fn telnet_resize(session_id: String, cols: u32, rows: u32) -> Result<(), String> {
    let sess = {
        let map = sessions().lock().await;
        map.get(&session_id).cloned()
    };
    if let Some(s) = sess {
        telnet_send_cmd(&s.tx, TelnetCmd::Resize {
            cols: cols as u16,
            rows: rows as u16,
        }).await?;
    }
    Ok(())
}

/// 关闭 Telnet 会话
pub async fn telnet_close(session_id: String) -> Result<(), String> {
    let sess = {
        let map = sessions().lock().await;
        map.get(&session_id).cloned()
    };
    if let Some(s) = sess {
        s.cancel.store(true, Ordering::Relaxed);
        let _ = s.tx.try_send(TelnetCmd::Close);
        let _ = timeout(Duration::from_secs(3), s.done.notified()).await;
    }
    Ok(())
}

/// 获取 Telnet 会话的历史输出
pub async fn telnet_get_history(session_id: String) -> Result<String, String> {
    let sessions = sessions().lock().await;
    match sessions.get(&session_id) {
        Some(s) => {
            let hist = s.history.lock().unwrap_or_else(|e| e.into_inner());
            let encoding = s.encoding.lock().map(|v| v.clone()).unwrap_or_else(|_| "utf-8".to_string());
            let mut codec = TerminalCodec::new(&encoding).unwrap_or_else(|_| TerminalCodec::utf8());
            Ok(codec.decode(&hist, true))
        }
        None => Err(format!(
            "Telnet session not found: {}",
            &session_id[..session_id.len().min(24)]
        )),
    }
}

/// 强制取消 Telnet 会话（连接断开 / 应用退出时调用）
pub async fn telnet_cancel(session_id: &str) {
    let sess = {
        let map = sessions().lock().await;
        map.get(session_id).cloned()
    };
    if let Some(s) = sess {
        s.cancel.store(true, Ordering::Relaxed);
        let _ = s.tx.try_send(TelnetCmd::Close);
        let _ = timeout(Duration::from_secs(2), s.done.notified()).await;
    }
}

/// 关闭指定窗口的所有 Telnet 会话
pub async fn close_telnet_sessions_for_window(window_label: &str) {
    let to_close: Vec<(mpsc::Sender<TelnetCmd>, Arc<AtomicBool>)> = {
        let map = sessions().lock().await;
        map.values()
            .filter(|s| s.window_label == window_label)
            .map(|s| (s.tx.clone(), s.cancel.clone()))
            .collect()
    };
    for (tx, cancel) in to_close {
        cancel.store(true, Ordering::Relaxed);
        let _ = tx.try_send(TelnetCmd::Close);
    }
}

/// 关闭指定服务器的所有 Telnet 会话
pub async fn close_telnet_sessions_for_server(server_id: &str) {
    let to_close: Vec<(mpsc::Sender<TelnetCmd>, Arc<AtomicBool>)> = {
        let map = sessions().lock().await;
        map.values()
            .filter(|s| s.server_id == server_id)
            .map(|s| (s.tx.clone(), s.cancel.clone()))
            .collect()
    };
    for (tx, cancel) in to_close {
        cancel.store(true, Ordering::Relaxed);
        let _ = tx.try_send(TelnetCmd::Close);
    }
}

/// 关闭所有 Telnet 会话（应用退出时调用）
pub async fn close_all_sessions() {
    let to_close: Vec<(mpsc::Sender<TelnetCmd>, Arc<AtomicBool>)> = {
        let map = sessions().lock().await;
        map.values()
            .map(|s| (s.tx.clone(), s.cancel.clone()))
            .collect()
    };
    for (tx, cancel) in to_close {
        cancel.store(true, Ordering::Relaxed);
        let _ = tx.try_send(TelnetCmd::Close);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iac_parser_passes_plain_data() {
        let mut p = IacParser::new();
        let out = p.process(b"hello\r\nworld");
        assert_eq!(out, b"hello\r\nworld");
    }

    #[test]
    fn iac_parser_handles_iac_escape() {
        let mut p = IacParser::new();
        // IAC IAC = 转义的 0xFF
        let out = p.process(&[b'a', IAC, IAC, b'b']);
        assert_eq!(out, &[b'a', IAC, b'b']);
    }

    #[test]
    fn iac_parser_responds_to_do_terminal_type() {
        let mut p = IacParser::new();
        // 对端发送 DO TERMINAL_TYPE
        let _ = p.process(&[IAC, DO, OPT_TERMINAL_TYPE]);
        let resp = p.take_response();
        // 期望响应：IAC WILL TERMINAL_TYPE
        assert_eq!(resp, &[IAC, WILL, OPT_TERMINAL_TYPE]);
    }

    #[test]
    fn iac_parser_refuses_unknown_option() {
        let mut p = IacParser::new();
        // 对端发送 DO 99（未实现选项）
        let _ = p.process(&[IAC, DO, 99]);
        let resp = p.take_response();
        // 期望响应：IAC WONT 99
        assert_eq!(resp, &[IAC, WONT, 99]);
    }

    #[test]
    fn iac_parser_handles_terminal_type_subnegotiation() {
        let mut p = IacParser::new();
        // 对端请求终端类型：SB TERMINAL_TYPE SEND IAC SE
        let _ = p.process(&[IAC, SB, OPT_TERMINAL_TYPE, SUBCMD_TERMINAL_TYPE_SEND, IAC, SE]);
        let resp = p.take_response();
        // 期望响应：SB TERMINAL_TYPE IS XTERM-256COLOR IAC SE
        let expected: Vec<u8> = vec![IAC, SB, OPT_TERMINAL_TYPE, SUBCMD_TERMINAL_TYPE_IS]
            .into_iter()
            .chain(TERMINAL_TYPE.iter().copied())
            .chain(vec![IAC, SE])
            .collect();
        assert_eq!(resp, expected);
    }

    #[test]
    fn naws_subnegotiation_format() {
        let resp = build_naws_subnegotiation(80, 24);
        // SB NAWS 00 50 00 18 IAC SE
        assert_eq!(resp, vec![IAC, SB, OPT_NAWS, 0, 80, 0, 24, IAC, SE]);
    }

    #[test]
    fn naws_subnegotiation_escapes_iac() {
        // cols=255 应转义为 255 255
        let resp = build_naws_subnegotiation(255, 0);
        assert_eq!(resp, vec![IAC, SB, OPT_NAWS, 0, IAC, IAC, 0, 0, IAC, SE]);
    }

    #[test]
    fn login_prompt_detection_ignores_last_login_banner() {
        assert!(is_username_prompt("Router login: "));
        assert!(is_username_prompt("\u{1b}[32mUsername:\u{1b}[0m "));
        assert!(is_username_prompt("用户名："));
        assert!(!is_username_prompt("Last login: Thu Aug 20 14:02:58 2026"));
    }

    #[test]
    fn password_prompt_detection_is_conservative() {
        assert!(is_password_prompt("Password: "));
        assert!(is_password_prompt("密码："));
        assert!(!is_password_prompt("Failed password: invalid credentials"));
    }
}
