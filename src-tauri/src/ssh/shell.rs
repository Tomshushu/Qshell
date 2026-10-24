use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use russh::ChannelMsg;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};

use super::manager::SshManager;
use super::terminal_encoding::TerminalCodec;
use super::zmodem;

/// Shell output data emitted to the frontend via the `ssh:shell-output` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellOutputData {
    pub session_id: String,
    pub data: String,
    /// 单调递增的输出序号。前端 Ctrl+C 取得中断时的序号后，
    /// 可以丢弃已经排在 WebView IPC 队列里的旧日志，避免旧输出继续
    /// 占用 xterm 解析时间。Telnet 等其他后端不提供此字段。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequence: Option<u64>,
}

/// Tail data emitted to the frontend via the `logs:tail:data` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailData {
    pub session_id: String,
    pub data: String,
}

/// Zmodem 数据事件 payload（base64 编码的二进制字节）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellZmodemData {
    pub session_id: String,
    /// base64 编码的二进制字节（避免 Tauri IPC 把原始二进制当 UTF-8 解析出错）
    pub data: String,
}

/// Zmodem 检测事件 payload
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellZmodemDetected {
    pub session_id: String,
    /// 检测到的首段协议数据。与 detected 事件一起发送，避免跨事件乱序
    /// 导致前端在 Sentry 创建前丢失 ZRQINIT/ZRINIT 首帧。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
}

/// Commands sent to the shell reader task.
enum ShellCmd {
    Write(String),
    SetEncoding(String),
    Resize { cols: u32, rows: u32 },
    Close,
    /// 暂停从 SSH channel 读取数据（高水位背压流控）
    Pause,
    /// 恢复从 SSH channel 读取数据（低水位背压解除）
    Resume,
    /// Zmodem 响应字节（前端 zmodem.js 解析后回写给服务器）
    ZmodemWrite(Vec<u8>),
    /// 前端通知 Zmodem 传输结束，退出 passthrough 模式
    ZmodemEnd,
}

/// A shell session handle — the mpsc sender communicates with the reader task.
///
/// `cancel` 用于在外部强制终止会话（窗口关闭、连接断开等场景），
/// 避免 zombie task 持有 channel 长期挂起。
#[derive(Clone)]
struct ShellSession {
    tx: mpsc::Sender<ShellCmd>,
    /// Ctrl+C 专用的无界快速通道。交互输入队列可能因刷屏而暂时拥塞，
    /// 中断信号不能跟普通输入排队，否则会把 SIGINT 延迟到输出停止之后。
    interrupt_tx: mpsc::UnboundedSender<()>,
    /// 历史输出缓存（环形缓冲区，最大 256KB），用于跨窗口迁移时恢复终端内容
    history: Arc<std::sync::Mutex<VecDeque<u8>>>,
    window_label: String,
    /// 取消信号：设置后 reader task 退出 select! 循环
    cancel: Arc<AtomicBool>,
    /// 完成信号：reader task 退出时 notify，让 shell_close/shell_cancel 等待真正关闭
    done: Arc<tokio::sync::Notify>,
    encoding: Arc<std::sync::Mutex<String>>,
    /// 已经交给前端事件通道的输出序号。
    output_sequence: Arc<std::sync::atomic::AtomicU64>,
}

/// 历史缓存最大字节数。
///
/// 用于跨窗口迁移 / 断线重连时恢复终端 scrollback。旧值 256KB 只能回放约
/// 1000~2000 行，明显小于前端 xterm 的 scrollback 默认 5000 行（范围 1000~128000），
/// 导致迁移/重连后历史恢复不完整。参考市面成熟产品（Windows Terminal 默认 9001 行、
/// iTerm2 无上限、VS Code 1000 行），并覆盖本项目前端默认 5000 行（含 ANSI 后约
/// 1~2MB），放宽到 2MB。每 session 一份内存，10 个会话约 20MB，可接受。
const HISTORY_MAX_BYTES: usize = 2 * 1024 * 1024;
// xterm.js 的 WriteBuffer 会把单个数据块交给 InputHandler 同步解析。
// 单块过大时（尤其是带大量 ANSI/换行的 docker 日志），WebView 主线程会被
// 一个解析任务长期占用，键盘事件也无法及时抢占。把 IPC 输出切成 64 KiB
// 小块，让 xterm 在块与块之间回到事件循环，同时仍保持较低的事件数量。
const SHELL_OUTPUT_CHUNK_BYTES: usize = 64 * 1024;
// Zmodem 合批阈值：协议字节累积到 64KB 时合批 flush，配合 4ms 定时 flush，
// 避免 rz/sz 高速传输时每个 SSH 数据包都 base64 + emit 一次 IPC 事件造成事件洪流。
const ZMODEM_FLUSH_BYTES: usize = 64 * 1024;
// Ctrl+C 后在途旧日志排空的兜底丢弃上限不再用固定常量，改为动态 = 2 × 终端窗口大小
// （覆盖 rekey pending 上限）。窗口可在设置面板调整（256KB~16MB，见 connection.rs 的
// terminal_window_size_bytes），兜底必须随之变化，否则窗口调大后兜底不足、在途数据
// 没丢完就被强制停止丢弃，旧问题（中断后又刷）会回归。见 ch.wait 分支里的动态计算。
// 中断丢弃状态的「静默超时」（毫秒）：中断后若连续这么久没有新数据到达（且未处于
// 背压暂停），说明远端进程已停、在途旧日志已读完，立即停止丢弃恢复正常渲染。
// 避免小命令中断后因未扫描到 ^C/Prompt 标记而永久停留在丢弃状态（界面卡住）。
const SIGINT_DRAIN_IDLE_MS: u64 = 300;

/// 扫描字节流中的中断响应标志（^C、\x03、Readline Bracketed Paste off、OSC Title 等）
fn find_interrupt_marker(bytes: &[u8]) -> Option<usize> {
    if bytes.is_empty() {
        return None;
    }
    let mut candidates: Vec<usize> = Vec::new();

    // 1. \x03 (ETX 字节)
    if let Some(pos) = bytes.iter().position(|&b| b == 0x03) {
        candidates.push(pos);
    }
    // 2. "^C" 字符串 (Linux TTY ECHOCTL 回显)
    if let Some(pos) = bytes.windows(2).position(|w| w == b"^C") {
        candidates.push(pos);
    }
    // 3. \x1b[?2004l (Readline bracketed paste mode off 序列，Bash/Zsh 中断重绘常用)
    if let Some(pos) = bytes.windows(8).position(|w| w == b"\x1b[?2004l") {
        candidates.push(pos);
    }
    // 4. \x1b]0; 或 \x1b]2; (OSC window title，Prompt 启动时通常重置终端标题)
    if let Some(pos) = bytes.windows(4).position(|w| w == b"\x1b]0;" || w == b"\x1b]2;") {
        candidates.push(pos);
    }

    candidates.into_iter().min()
}

/// 以 UTF-8 字符边界切分并发射 Shell 输出。
///
/// ANSI 转义序列允许跨 write 边界继续解析，因此这里不需要尝试按控制序列
/// 对齐；只要不切断 UTF-8 字节序列，xterm.js 会在下一块中继续解析未完成的
/// ESC/OSC/CSI 序列。
fn emit_shell_output(
    app: &AppHandle,
    session_id: &str,
    text: &str,
    output_sequence: &std::sync::atomic::AtomicU64,
) {
    if text.is_empty() {
        return;
    }

    let mut start = 0;
    while start < text.len() {
        let mut end = (start + SHELL_OUTPUT_CHUNK_BYTES).min(text.len());
        while end > start && !text.is_char_boundary(end) {
            end -= 1;
        }
        // 理论上不会发生（单个 UTF-8 字符最多 4 字节），但保留兜底保证
        // 即使常量以后调整也不会出现死循环。
        if end == start {
            end = text[start..]
                .char_indices()
                .nth(1)
                .map(|(offset, _)| start + offset)
                .unwrap_or(text.len());
        }

        let sequence = output_sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = app.emit("ssh:shell-output", ShellOutputData {
            session_id: session_id.to_string(),
            data: text[start..end].to_string(),
            sequence: Some(sequence),
        });
        start = end;
    }
}

/// 合批冲刷 Zmodem 待发协议字节。rz/sz 高速传输时若每个 SSH 数据包都单独
/// base64 + emit，会在 WebView IPC 队列中制造大量小事件；这里按 4ms 定时或
/// 64KB 阈值合并成一次 `ssh:shell-zmodem-data` 事件，降低事件数量与 IPC 开销。
fn flush_zmodem_pending(app: &AppHandle, session_id: &str, pending: &mut Vec<u8>) {
    if pending.is_empty() {
        return;
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(pending.as_slice());
    pending.clear();
    let _ = app.emit("ssh:shell-zmodem-data", ShellZmodemData {
        session_id: session_id.to_string(),
        data: b64,
    });
}

/// Global shell sessions map (session_id -> sender).
static SHELL_SESSIONS: std::sync::OnceLock<Arc<Mutex<HashMap<String, ShellSession>>>> =
    std::sync::OnceLock::new();

fn sessions() -> &'static Arc<Mutex<HashMap<String, ShellSession>>> {
    SHELL_SESSIONS.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

/// Create an interactive shell session (PTY) with xterm-256color terminal.
/// 智能解析类似 /etc/issue.net 的转义序列宏（如 \S, \r, \m, \s, \n）。
///
/// Linux 控制台 (agetty) 本地登录会自动展开这些宏为发行版名、内核和架构，
/// 但 OpenSSH 通过 `Banner /etc/issue.net` 发送欢迎语时按协议原样直传，
/// 导致远程客户端直接显示原始未解析字符串 "\S Kernel \r on an \m"。
/// 此处在回填 history 与透传给前端前进行智能回填展开。
fn expand_issue_banner(banner: &str, os_type: Option<&str>, os_info: Option<&str>) -> String {
    if !banner.contains("\\S") && !banner.contains("\\s") && !banner.contains("\\r") && !banner.contains("\\m") {
        return banner.to_string();
    }
    let parts: Vec<&str> = os_info.unwrap_or("").split('|').map(|s| s.trim()).collect();
    let pretty_name = parts.first().copied().filter(|s| !s.is_empty())
        .or(os_type.filter(|s| !s.is_empty()))
        .unwrap_or("Linux");
    let arch = parts.get(1).copied().filter(|s| !s.is_empty()).unwrap_or("x86_64");
    let kernel = parts.get(2).copied().filter(|s| !s.is_empty()).unwrap_or("");

    banner
        .replace("\\S", pretty_name)
        .replace("\\s", "Linux")
        .replace("\\r", kernel)
        .replace("\\m", arch)
}

/// Output is pushed to the frontend via the `ssh:shell-output` event.
///
/// This function is ASYNC — it waits for the SSH channel + PTY to be fully
/// established before returning the sessionId. This avoids the race condition
/// where the frontend tries to write before the session is ready.
pub async fn shell_create(
    app: AppHandle,
    window_label: String,
    server_id: String,
    cols: u32,
    rows: u32,
    encoding: String,
) -> Result<(String, Option<String>), String> {
    let session_id = format!("shell-{}", uuid::Uuid::new_v4());

    let (conn, _generation) = SshManager::global()
        .get_connection_with_generation(&server_id)
        .map_err(|e| format!("Shell: not connected: {}", e))?;

    let banner = if let Some(raw_banner) = conn.auth_banner() {
        let server_cfg = crate::commands::ssh::load_server_config(&server_id).await.ok();
        let os_type = server_cfg.as_ref().map(|s| s.target_type.as_str());
        let os_info = server_cfg.as_ref().and_then(|s| s.os_info.as_deref());
        Some(expand_issue_banner(&raw_banner, os_type, os_info))
    } else {
        None
    };
    let sid = session_id.clone();

    // Channel + PTY setup (must complete BEFORE registering session)
    let mut ch = match conn.create_shell_channel().await {
        Ok(ch) => ch,
        Err(e) => {
            let err_str = e.to_string();
            let is_session_limit = err_str.contains("administratively prohibited")
                || err_str.contains("ChannelOpenFailed")
                || err_str.contains("open failed");
            let err_msg = if is_session_limit {
                format!("open channel: {}（可能已达到服务器最大并发会话数 MaxSessions 限制）", err_str)
            } else {
                format!("open channel: {}", err_str)
            };
            eprintln!("[SSH Shell] create_shell_channel failed for {}: {}", server_id, err_msg);
            if !conn.is_connected() {
                SshManager::handle_connection_loss(&server_id, &conn, &err_msg).await;
            }
            return Err(err_msg);
        }
    };
    if let Err(e) = ch.request_pty(true, "xterm-256color", cols, rows, 0, 0, &[]).await {
        let err_msg = format!("PTY: {}", e);
        eprintln!("[SSH Shell] request_pty failed for {}: {}", server_id, err_msg);
        if !conn.is_connected() {
            SshManager::handle_connection_loss(&server_id, &conn, &err_msg).await;
        }
        return Err(err_msg);
    }
    if let Err(e) = ch.request_shell(true).await {
        let err_msg = format!("shell: {}", e);
        eprintln!("[SSH Shell] request_shell failed for {}: {}", server_id, err_msg);
        if !conn.is_connected() {
            SshManager::handle_connection_loss(&server_id, &conn, &err_msg).await;
        }
        return Err(err_msg);
    }

    // NOW register the session — it's ready to accept writes
    let (tx, mut rx) = mpsc::channel::<ShellCmd>(64);
    let (interrupt_tx, mut interrupt_rx) = mpsc::unbounded_channel::<()>();
    let history = Arc::new(std::sync::Mutex::new(VecDeque::new()));
    // 若连接在认证阶段收到服务端发送的欢迎词（SSH_MSG_USERAUTH_BANNER），预填入 history，
    // 确保跨窗口拖拽迁移或拉取初始历史时完整保留欢迎语
    if let Some(ref b) = banner {
        let normalized = b.replace("\r\n", "\n").replace('\n', "\r\n");
        let formatted = if !normalized.ends_with("\r\n") {
            format!("{}\r\n", normalized)
        } else {
            normalized
        };
        if let Ok(mut hist) = history.lock() {
            hist.extend(formatted.as_bytes().iter().copied());
        }
    }
    let cancel = Arc::new(AtomicBool::new(false));
    let done = Arc::new(tokio::sync::Notify::new());
    let normalized_encoding = super::terminal_encoding::normalize_encoding(&encoding);
    let session_encoding = Arc::new(std::sync::Mutex::new(normalized_encoding.clone()));
    let output_sequence = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let cancel_for_map = cancel.clone();
    let done_for_map = done.clone();
    sessions().lock().await.insert(sid.clone(), ShellSession {
        tx,
        interrupt_tx: interrupt_tx.clone(),
        history: history.clone(),
        window_label,
        cancel: cancel_for_map,
        done: done_for_map,
        encoding: session_encoding.clone(),
        output_sequence: output_sequence.clone(),
    });
    // 同时注册到 ConnectionEntry，连接断开时自动清理
    SshManager::global().register_shell_session(&server_id, &sid);

    // Spawn the reader/writer loop
    let app_clone = app.clone();
    let history_clone = history.clone();
    let cancel_for_task = cancel.clone();
    let done_for_task = done.clone();
    let server_id_for_task = server_id.clone();
    let output_sequence_for_task = output_sequence.clone();
    tokio::spawn(async move {
        let mut buffer = Vec::new();
        let mut terminal_codec = TerminalCodec::new(&normalized_encoding)
            .unwrap_or_else(|_| TerminalCodec::utf8());
        // 4ms 定时冲刷：旧值 16ms 会让中低频日志（如 docker logs -f，每秒几百行）
        // 被合并成「每 16ms 蹦一批」，对比 Xshell/MobaXterm 的逐包直渲显得一顿一顿。
        // 缩短到 4ms 后中低频日志接近逐行流动；高频日志仍由 64KB 阈值立即冲刷，不受影响。
        let mut flush_interval = tokio::time::interval(std::time::Duration::from_millis(4));
        flush_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut paused = false;
        let mut pause_deadline: Option<tokio::time::Instant> = None;
        // 高频日志期间不要每个 SSH 数据包都锁全局连接表；活跃时间只需秒级精度。
        let mut last_active_touch = tokio::time::Instant::now();

        // Zmodem passthrough 状态：true 时所有 shell 输出以 base64 emit 到 shell:zmodem-data
        // 由 zmodem.rs::find_zmodem_start 检测到 `*\x18B` 时进入；由 ShellCmd::ZmodemEnd 退出
        let mut zmodem_mode = false;
        // Zmodem 残留缓存：跨数据块扫描起始序列用（避免序列被切到两块之间漏检）
        let mut zmodem_tail: Vec<u8> = Vec::new();
        // Zmodem 合批缓冲：待发协议字节先累积，4ms 定时或 64KB 阈值时合批 emit，
        // 避免高速传输时每个 SSH 数据包触发一次 IPC 事件造成事件洪流。
        let mut zmodem_pending: Vec<u8> = Vec::new();
        // 记录最近一次触发 SIGINT 的时间戳。中断后 1.5 秒内严禁重新进入 Pause 挂起状态，
        // 保证远端进程被杀后的 exit 状态和 prompt 提示符能够以零延迟直通前端。
        let mut last_sigint_at: Option<tokio::time::Instant> = None;
        // 中断后在途旧日志排空：进入该状态后，Rust 端直接丢弃在途旧数据，直到检测到
        // ^C / Prompt 标记；Some(n) 表示已丢弃 n 字节（用于「2×窗口」字节兜底）。
        let mut sigint_drain_bytes: Option<usize> = None;
        let mut sigint_drain_tail: Vec<u8> = Vec::new();
        // 最近一次收到 SSH 数据的时刻：用于判断「中断后数据是否已静默」（见 SIGINT_DRAIN_IDLE_MS）。
        let mut last_data_at: Option<tokio::time::Instant> = None;
        // 任务本地重放队列：在 Resize 合并或 Ctrl+C 排空 rx 时暂存未消费的非目标命令，
        // 严格保持 FIFO 顺序（避免通过 tx.try_send 回塞到队尾导致并发 Write 乱序或自持 Sender 泄漏）。
        let mut replay_queue: VecDeque<ShellCmd> = VecDeque::new();

        let res: Result<(), String> = async {
            loop {
                // 外部取消信号优先：直接退出
                if cancel_for_task.load(Ordering::Relaxed) {
                    break;
                }
                tokio::select! {
                    biased;

                    // Ctrl+C 使用独立的无界通道，始终优先于普通输入和暂停状态。
                    // 这样高频日志导致普通 mpsc 队列拥塞时，中断仍能立即写入 PTY。
                    interrupt = interrupt_rx.recv() => {
                        if interrupt.is_none() {
                            break;
                        }
                        // 一次按键可能同时经过 xterm custom handler 和 window 捕获兜底，
                        // 合并同一轮积压请求，避免重复写入 ^C。
                        while interrupt_rx.try_recv().is_ok() {}
                        last_sigint_at = Some(tokio::time::Instant::now());
                        paused = false;
                        pause_deadline = None;
                        buffer.clear();
                        // 启动在途旧日志排空丢弃（字节数兜底，动态 = 2×终端窗口大小）
                        sigint_drain_bytes = Some(0);
                        sigint_drain_tail.clear();
                        last_data_at = Some(tokio::time::Instant::now());

                        // 核心：清空在中断发出前因并发已经排在队列里的旧 Pause 指令，
                        // 彻底杜绝“刚中断又被旧 Pause 再次挂起 3 秒”的致命假死死锁。
                        let mut last_resize: Option<(u32, u32)> = None;
                        let mut should_close = false;
                        let mut kept_cmds: VecDeque<ShellCmd> = VecDeque::new();
                        for cmd in replay_queue.drain(..).chain(std::iter::from_fn(|| rx.try_recv().ok())) {
                            match cmd {
                                ShellCmd::Pause | ShellCmd::Resume | ShellCmd::Write(_) => {}
                                ShellCmd::SetEncoding(_) | ShellCmd::ZmodemWrite(_) | ShellCmd::ZmodemEnd => {
                                    kept_cmds.push_back(cmd);
                                }
                                ShellCmd::Resize { cols, rows } => {
                                    last_resize = Some((cols, rows));
                                }
                                ShellCmd::Close => {
                                    should_close = true;
                                }
                            }
                        }
                        replay_queue = kept_cmds;
                        if should_close {
                            return Ok(());
                        }
                        if let Some((cols, rows)) = last_resize {
                            let _ = tokio::time::timeout(
                                Duration::from_secs(5),
                                ch.window_change(cols, rows, 0, 0),
                            ).await;
                        }

                        // 交互式 PTY 的标准做法是写入 VINTR（^C）字节。
                        // SSH signal request 在不同服务端上支持不一致，而且会额外
                        // 引入一次网络往返；PTY 已建立时不再串行等待它。
                        if tokio::time::timeout(
                            Duration::from_millis(150),
                            ch.data(&[0x03u8][..]),
                        ).await.is_err() {
                            #[cfg(debug_assertions)]
                            eprintln!("[Shell] {} SIGINT write timeout", sid);
                        }
                    },

                    cmd = async {
                        if let Some(c) = replay_queue.pop_front() {
                            Some(c)
                        } else {
                            rx.recv().await
                        }
                    } => match cmd {
                        Some(ShellCmd::Pause) => {
                            // 中断后 1.5 秒冷却保护窗口内严禁暂停 SSH 读取，确保 prompt 及退出状态零延迟直通
                            let in_sigint_cooldown = last_sigint_at
                                .map_or(false, |t| t.elapsed() < Duration::from_millis(1500));
                            if !in_sigint_cooldown {
                                paused = true;
                                // 看门狗：若前端异常未触发恢复，最多暂停 3 秒自动唤醒，保证会话永不挂死
                                pause_deadline = Some(tokio::time::Instant::now() + std::time::Duration::from_secs(3));
                            }
                        }
                        Some(ShellCmd::Resume) => {
                            paused = false;
                            pause_deadline = None;
                        }
                        Some(ShellCmd::Write(text)) => {
                            let is_sigint = text.contains('\x03') || text.contains('\x1c');
                            if is_sigint {
                                // 收到终端中断信号 (Ctrl+C / Ctrl+\)，立即解除暂停状态，清空本地未刷出的积压
                                last_sigint_at = Some(tokio::time::Instant::now());
                                paused = false;
                                pause_deadline = None;
                                buffer.clear();
                                sigint_drain_bytes = Some(0);
                                sigint_drain_tail.clear();
                                last_data_at = Some(tokio::time::Instant::now());
                            }
                            // 注意：普通输入（如回车）不在这里取消丢弃状态。丢弃只由
                            // 「扫描到 ^C / Prompt 标记」或「2×窗口 字节兜底」停止。
                            // 否则拉取海量日志时，用户 Ctrl+C 后按回车会把 SSH 通道里还没读完的
                            // 在途旧日志又放出来渲染，出现「回车后又刷屏、再 Ctrl+C 也停不下来」。
                            let data = match terminal_codec.encode(&text) {
                                Ok(data) => data,
                                Err(error) => {
                                    let _ = app_clone.emit("ssh:shell-error", ShellOutputData {
                                        session_id: sid.clone(),
                                        data: error,
                                        sequence: None,
                                    });
                                    continue;
                                }
                            };
                            // Write user input to the remote shell. 同时监听专用 SIGINT 通道：
                            // 即使某次普通输入因 SSH 窗口满而阻塞，Ctrl+C 也不会被它卡住。
                            let interrupted = tokio::select! {
                                biased;
                                signal = interrupt_rx.recv() => {
                                    if signal.is_none() {
                                        break;
                                    }
                                    last_sigint_at = Some(tokio::time::Instant::now());
                                    paused = false;
                                    pause_deadline = None;
                                    buffer.clear();
                                    let _ = tokio::time::timeout(
                                        Duration::from_millis(150),
                                        ch.data(&[0x03u8][..]),
                                    ).await;
                                    true
                                }
                                result = tokio::time::timeout(
                                    Duration::from_secs(10),
                                    ch.data(&data[..]),
                                ) => {
                                    match result {
                                        Ok(Ok(())) => {}
                                        Ok(Err(_e)) => {
                                            #[cfg(debug_assertions)]
                                            eprintln!("[Shell] {} write error: {}", sid, _e);
                                            break;
                                        }
                                        Err(_) => {
                                            #[cfg(debug_assertions)]
                                            eprintln!("[Shell] {} write timeout (10s), connection may be half-open", sid);
                                            break;
                                        }
                                    }
                                    false
                                }
                            };
                            if interrupted {
                                continue;
                            }
                        }
                        Some(ShellCmd::SetEncoding(name)) => {
                            match TerminalCodec::new(&name) {
                                Ok(next) => {
                                    terminal_codec = next;
                                    if let Ok(mut current) = session_encoding.lock() {
                                        *current = terminal_codec.name().to_string();
                                    }
                                }
                                Err(error) => {
                                    let _ = app_clone.emit("ssh:shell-error", ShellOutputData {
                                        session_id: sid.clone(),
                                        data: error,
                                        sequence: None,
                                    });
                                }
                            }
                        }
                        Some(ShellCmd::ZmodemWrite(data)) => {
                            // Zmodem 协议字节直接写入 channel（与 Write 同样的 channel.data 调用，
                            // 但语义独立：Write 是终端输入，ZmodemWrite 是 zmodem.js 响应）
                            match tokio::time::timeout(
                                Duration::from_secs(10),
                                ch.data(&data[..]),
                            ).await {
                                Ok(Ok(())) => {}
                                Ok(Err(_e)) => {
                                    #[cfg(debug_assertions)]
                                    eprintln!("[Shell] {} zmodem write error: {}", sid, _e);
                                    break;
                                }
                                Err(_) => {
                                    #[cfg(debug_assertions)]
                                    eprintln!("[Shell] {} zmodem write timeout (10s)", sid);
                                    break;
                                }
                            }
                        }
                        Some(ShellCmd::ZmodemEnd) => {
                            // 前端通知 Zmodem 传输结束：先冲刷残余协议字节，再退出 passthrough
                            flush_zmodem_pending(&app_clone, &sid, &mut zmodem_pending);
                            zmodem_mode = false;
                            zmodem_tail.clear();
                            let _ = app_clone.emit("ssh:shell-zmodem-end", ShellZmodemDetected {
                                session_id: sid.clone(),
                                data: None,
                            });
                        }
                        Some(ShellCmd::Resize { cols, rows }) => {
                            // 合并积压的 Resize：拖动窗口会产生高频 window_change 请求，
                            // 逐条执行既造成 SSH 请求洪流又会挤占用户输入，这里只取最新一条。
                            // 把非 Resize 命令按原始顺序保留在本地 replay_queue 中，保证输入不丢失且不乱序。
                            let mut last_cols = cols;
                            let mut last_rows = rows;
                            let mut kept: VecDeque<ShellCmd> = VecDeque::new();
                            for item in replay_queue.drain(..).chain(std::iter::from_fn(|| rx.try_recv().ok())) {
                                match item {
                                    ShellCmd::Resize { cols: c, rows: r } => {
                                        last_cols = c;
                                        last_rows = r;
                                    }
                                    other => kept.push_back(other),
                                }
                            }
                            replay_queue = kept;
                            let _ = tokio::time::timeout(
                                Duration::from_secs(5),
                                ch.window_change(last_cols, last_rows, 0, 0),
                            ).await;
                        }
                        Some(ShellCmd::Close) | None => break,
                    },
                    msg = ch.wait(), if !paused => match msg {
                        Some(ChannelMsg::Data { data } | ChannelMsg::ExtendedData { data, .. }) => {
                            // 记录数据到达时刻，供中断丢弃状态的静默超时判断使用
                            last_data_at = Some(tokio::time::Instant::now());
                            if !zmodem_mode {
                                if let Some(mut drained) = sigint_drain_bytes {
                                    sigint_drain_tail.extend_from_slice(&data);
                                    if let Some(pos) = find_interrupt_marker(&sigint_drain_tail) {
                                        // 检测到 ^C / Prompt 标记：停止丢弃，保留标记之后的字节
                                        sigint_drain_bytes = None;
                                        let keep_bytes = sigint_drain_tail[pos..].to_vec();
                                        sigint_drain_tail.clear();

                                        if !keep_bytes.is_empty() {
                                            let mut hist = history_clone
                                                .lock()
                                                .unwrap_or_else(|e| e.into_inner());
                                            hist.extend(keep_bytes.iter().copied());
                                            if hist.len() > HISTORY_MAX_BYTES {
                                                let drain = hist.len() - HISTORY_MAX_BYTES;
                                                hist.drain(..drain);
                                            }
                                            drop(hist);

                                            buffer.extend_from_slice(&keep_bytes);
                                            let text = terminal_codec.decode(&buffer, false);
                                            emit_shell_output(&app_clone, &sid, &text, &output_sequence_for_task);
                                            buffer.clear();
                                        }
                                        continue;
                                    }

                                    // 未检测到标记：丢弃在途旧日志，累计丢弃字节数
                                    drained += data.len();
                                    if sigint_drain_tail.len() > 8 {
                                        let drain = sigint_drain_tail.len() - 8;
                                        sigint_drain_tail.drain(..drain);
                                    }
                                    // 兜底上限动态 = 2 × 终端窗口大小（覆盖 rekey pending）
                                    let drain_max =
                                        (crate::ssh::connection::terminal_window_size_bytes() as usize) * 2;
                                    if drained >= drain_max {
                                        // 兜底：丢弃超 2×窗口仍未检测到标记（远端未回显 prompt），
                                        // 强制停止丢弃，让后续数据正常渲染，避免无限丢弃吞掉正常输出。
                                        sigint_drain_bytes = None;
                                        sigint_drain_tail.clear();
                                    } else {
                                        sigint_drain_bytes = Some(drained);
                                    }
                                    continue;
                                }
                            }

                            // 写入历史缓存（环形缓冲区，超过上限时丢弃最旧的数据）
                            // 注意：Zmodem passthrough 模式下不写入 history（避免二进制
                            // 协议字节污染跨窗口迁移时的终端内容）
                            if !zmodem_mode {
                                // unwrap_or_else(into_inner)：reader task 中其他代码 panic 会毒化
                                // mutex，此处若跟着 unwrap() 会级联 panic 跳过整个 task 的清理逻辑
                                // （session 注销、channel close 全部丢失），改为取出内层数据继续运行
                                let mut hist = history_clone
                                    .lock()
                                    .unwrap_or_else(|e| e.into_inner());
                                hist.extend(data.iter().copied());
                                if hist.len() > HISTORY_MAX_BYTES {
                                    let drain = hist.len() - HISTORY_MAX_BYTES;
                                    hist.drain(..drain);
                                }
                            }

                            if zmodem_mode {
                                // Zmodem passthrough：累积到缓冲，4ms 或 64KB 阈值时合批 emit，
                                // 避免每个 SSH 数据包都 base64 + emit 造成 IPC 事件洪流。
                                zmodem_pending.extend_from_slice(&data);
                                if zmodem_pending.len() >= ZMODEM_FLUSH_BYTES {
                                    flush_zmodem_pending(&app_clone, &sid, &mut zmodem_pending);
                                }
                            } else {
                                // 扫描 Zmodem 起始序列
                                // 拼接 tail + data 形成完整扫描缓冲区
                                zmodem_tail.extend_from_slice(&data);
                                if let Some(pos) = zmodem::find_zmodem_start(&zmodem_tail) {
                                    // pos 之前的字节作为普通终端输出
                                    let pre = &zmodem_tail[..pos];
                                    if !pre.is_empty() {
                                        buffer.extend_from_slice(pre);
                                    }
                                    // 立即冲刷残余 terminal 文本（如果有）
                                    if !buffer.is_empty() {
                                        let text = terminal_codec.decode(&buffer, false);
                                        emit_shell_output(&app_clone, &sid, &text, &output_sequence_for_task);
                                        buffer.clear();
                                    }
                                    // 必须先通知前端创建 Sentry，再发送第一段握手数据。
                                    // 否则前端尚未注册该 session，首帧会被丢弃，导致 rz 永远
                                    // 停在 waiting to receive，拖拽上传也会错误回退到 SFTP。
                                    zmodem_mode = true;
                                    // pos 之后（含 `*\x18B` 前缀）作为 Zmodem 数据
                                    let zmodem_bytes = zmodem_tail[pos..].to_vec();
                                    let b64 = base64::engine::general_purpose::STANDARD.encode(&zmodem_bytes);
                                    let _ = app_clone.emit("ssh:shell-zmodem-detected", ShellZmodemDetected {
                                        session_id: sid.clone(),
                                        data: Some(b64),
                                    });
                                    zmodem_tail.clear();
                                } else {
                                    // 未发现 Zmodem 起始序列：把 tail 放行到待发送缓冲区。
                                    // 跨块检测保留尾部可能成为起始前缀 `*\x18B` 真前缀的字节
                                    // （末 1 字节为 '*' 保留 1；末 2 字节为 `*\x18` 保留 2），
                                    // 其余字节全部立即放行——否则空闲时尾部字符会被扣住，
                                    // 导致提示符末尾与输入回显的开头字符不显示。
                                    // 保留 2 字节的场景：起始序列被 TCP 分包切在 `\x18` 与
                                    // 'B' 之间（本块结尾 `*\x18`、下块开头 'B'），若只按
                                    // 「末字节是否 '*'」判断，`*` 与 `\x18` 会被当普通输出
                                    // 放行，前缀破坏，zmodem 永不触发。
                                    let keep = zmodem::zmodem_prefix_keep_len(&zmodem_tail);
                                    let take = zmodem_tail.len() - keep;
                                    if take > 0 {
                                        buffer.extend_from_slice(&zmodem_tail[..take]);
                                        zmodem_tail.drain(..take);
                                    }
                                    // 批量合并网络包，但不要形成过大的 xterm 单块；
                                    // emit_shell_output 会继续按 64 KiB 切分，保证键盘事件
                                    // 能在日志洪峰期间及时回到 WebView 事件循环。
                                    if buffer.len() >= SHELL_OUTPUT_CHUNK_BYTES {
                                        let text = terminal_codec.decode(&buffer, false);
                                        emit_shell_output(&app_clone, &sid, &text, &output_sequence_for_task);
                                        buffer.clear();
                                    }
                                }
                            }

                        }
                        Some(ChannelMsg::Eof | ChannelMsg::Close) | None => break,
                        _ => {}
                    },
                    // 每 4ms 定时刷新数据到前端，兼顾低延迟交互与吞吐性能
                    _ = flush_interval.tick() => {
                        if paused {
                            if let Some(deadline) = pause_deadline {
                                if tokio::time::Instant::now() >= deadline {
                                    paused = false;
                                    pause_deadline = None;
                                }
                            }
                        }
                        // 中断丢弃状态静默超时：连续 SIGINT_DRAIN_IDLE_MS 没有新数据到达，
                        // 说明远端进程已停、在途旧日志已读完，停止丢弃恢复渲染，避免永久卡住。
                        // 注意排除 paused（背压暂停读取）：暂停期间不读数据不代表远端进程已停，
                        // 若据此提前结束丢弃，恢复读取后剩余的旧日志会重新刷出来。
                        if !paused && sigint_drain_bytes.is_some() {
                            let idle = last_data_at.map_or(true, |t| {
                                t.elapsed() >= Duration::from_millis(SIGINT_DRAIN_IDLE_MS)
                            });
                            if idle {
                                sigint_drain_bytes = None;
                                sigint_drain_tail.clear();
                            }
                        }
                        if !zmodem_mode && !buffer.is_empty() {
                            let text = terminal_codec.decode(&buffer, false);
                            emit_shell_output(&app_clone, &sid, &text, &output_sequence_for_task);
                            buffer.clear();
                        }
                        // 4ms 定时冲刷 Zmodem 合批缓冲，保证低延迟下协议字节不滞留
                        if zmodem_mode && !zmodem_pending.is_empty() {
                            flush_zmodem_pending(&app_clone, &sid, &mut zmodem_pending);
                        }
                        if last_active_touch.elapsed() >= Duration::from_secs(10) {
                            SshManager::global().touch_last_active(&server_id_for_task);
                            last_active_touch = tokio::time::Instant::now();
                        }
                        // 周期性检查取消
                        if cancel_for_task.load(Ordering::Relaxed) {
                            break;
                        }
                    }
                }
            }
            // 退出前冲刷残余数据
            if !buffer.is_empty() {
                let text = terminal_codec.decode(&buffer, true);
                emit_shell_output(&app_clone, &sid, &text, &output_sequence_for_task);
            }
            // 退出前冲刷残余 Zmodem 协议字节（避免最后一段丢失）
            flush_zmodem_pending(&app_clone, &sid, &mut zmodem_pending);
            // 若 Zmodem 传输中会话异常退出，通知前端关闭 zmodem UI
            if zmodem_mode {
                let _ = app_clone.emit("ssh:shell-zmodem-end", ShellZmodemDetected {
                    session_id: sid.clone(),
                    data: None,
                });
            }
            // ch.close() 等待远端响应，半开连接下可能长期挂起；加 5s 超时避免僵尸 task / channel 泄漏
            let _ = tokio::time::timeout(std::time::Duration::from_secs(5), ch.close()).await;
            Ok(())
        }.await;

        // Clean up session from map
        sessions().lock().await.remove(&sid);
        // 同时从 ConnectionEntry 注销（连接已断开时不做任何事，安全）
        SshManager::global().unregister_shell_session(&server_id_for_task, &sid);

        if let Err(e) = res {
            eprintln!("[Shell] Session {} ended: {}", sid, e);
            // 先在终端输出错误提示（作为可见反馈），再用独立事件通知前端关闭
            let _ = app_clone.emit("ssh:shell-output", ShellOutputData {
                session_id: sid.clone(),
                data: format!("\r\n[Shell Error] {}\r\n", e),
                sequence: None,
            });
            // 独立事件：前端据此触发 onShellError 回调，不再通过文本匹配判断
            // （避免用户 echo "[Shell Error]" 被误判为断连）
            let _ = app_clone.emit("ssh:shell-error", ShellOutputData {
                session_id: sid.clone(),
                data: e.clone(),
                sequence: None,
            });
        } else {
            let _ = app_clone.emit("ssh:shell-output", ShellOutputData {
                session_id: sid.clone(),
                data: "\r\n[Session closed]\r\n".to_string(),
                sequence: None,
            });
            // 独立事件：前端据此触发 onShellClosed 回调，不再通过文本匹配判断
            let _ = app_clone.emit("ssh:shell-closed", ShellOutputData {
                session_id: sid.clone(),
                data: String::new(),
                sequence: None,
            });
        }
        // 通知等待者：reader task 已完全退出（包括 channel 关闭和事件发射）
        done_for_task.notify_waiters();
    });

    Ok((session_id, banner))
}

/// 通过有界 channel 发送命令。reader 卡死（如 SSH 半开连接、网络静默断开）时
/// `send().await` 会因缓冲满而永久挂起，导致该会话所有输入无响应且无任何报错。
/// 这里加 10s 超时：超时视为会话已无响应，返回错误让上层感知。
async fn send_shell_cmd(tx: &mpsc::Sender<ShellCmd>, cmd: ShellCmd) -> Result<(), String> {
    match tokio::time::timeout(Duration::from_secs(10), tx.send(cmd)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => Err("Shell session closed or channel full".to_string()),
        Err(_) => Err(
            "Shell session not responding (write timeout); the connection may be dead".to_string(),
        ),
    }
}

/// Write data to an interactive shell session.
/// Accepts UTF-8 string from JS (xterm sends strings via IPC), converts to bytes internally.
/// Returns error if the session doesn't exist or is closed.
pub async fn shell_write(
    _server_id: String,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sess = {
        let map = sessions().lock().await;
        map.get(&session_id).cloned()
    };

    match sess {
        Some(s) => {
            if s.cancel.load(Ordering::Relaxed) {
                return Err("Shell session cancelled".to_string());
            }
            send_shell_cmd(&s.tx, ShellCmd::Write(data)).await
        }
        None => Err(format!(
            "Shell session not found: {}",
            &session_id[..session_id.len().min(24)]
        ))
    }
}

/// 发送 Ctrl+C/SIGINT 到远端 PTY。该路径绕过普通输入队列，保证刷屏时仍可即时中断。
pub async fn shell_interrupt(session_id: String) -> Result<u64, String> {
    let sess = {
        let map = sessions().lock().await;
        map.get(&session_id).cloned()
    };
    match sess {
        Some(s) => {
            s.interrupt_tx
                .send(())
                .map_err(|_| "Shell session closed".to_string())?;
            // 该序号表示 Ctrl+C 投递时已经发往前端的最后一个输出块。
            // 前端据此过滤 WebView IPC 队列中尚未执行的旧事件。
            Ok(s.output_sequence.load(Ordering::Acquire))
        }
        None => Err(format!(
            "Shell session not found: {}",
            &session_id[..session_id.len().min(24)]
        )),
    }
}

pub async fn shell_set_encoding(session_id: String, encoding: String) -> Result<(), String> {
    let sess = {
        let map = sessions().lock().await;
        map.get(&session_id).cloned()
    };
    match sess {
        Some(s) => send_shell_cmd(&s.tx, ShellCmd::SetEncoding(encoding)).await,
        None => Err(format!("Shell session not found: {}", &session_id[..session_id.len().min(24)])),
    }
}

/// Write Zmodem protocol bytes back to the server (frontend -> backend).
///
/// 前端 zmodem.js 解析 shell:zmodem-data 后，需要向服务器回写协议响应（ZRINIT/ZACK/ZRPOS 等）。
/// 这些字节不应进入终端显示，直接写入 SSH channel。
/// data 参数为 base64 编码的二进制字节。
pub async fn shell_zmodem_write(
    _server_id: String,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sess = {
        let map = sessions().lock().await;
        map.get(&session_id).cloned()
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| format!("Invalid base64: {}", e))?;

    match sess {
        Some(s) => {
            if s.cancel.load(Ordering::Relaxed) {
                return Err("Shell session cancelled".to_string());
            }
            send_shell_cmd(&s.tx, ShellCmd::ZmodemWrite(bytes)).await
        }
        None => Err(format!(
            "Shell session not found: {}",
            &session_id[..session_id.len().min(24)]
        ))
    }
}

/// 通知 Zmodem 传输结束，退出 passthrough 模式。
///
/// 前端 zmodem.js 检测到传输完成或用户主动取消时调用。
pub async fn shell_zmodem_end(
    _server_id: String,
    session_id: String,
) -> Result<(), String> {
    let sess = {
        let map = sessions().lock().await;
        map.get(&session_id).cloned()
    };
    match sess {
        Some(s) => {
            send_shell_cmd(&s.tx, ShellCmd::ZmodemEnd).await
        }
        None => Err(format!(
            "Shell session not found: {}",
            &session_id[..session_id.len().min(24)]
        ))
    }
}

/// Resize a shell session's PTY.
pub async fn shell_resize(
    _server_id: String,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    // 先 clone session 释放锁再 send，避免持锁 await 导致全局阻塞
    // （若 reader task 卡在 ch.data().await 且 channel 满，持锁 send 会锁死
    // 整个 sessions map，所有其他 shell 的 write/resize/close 都被阻塞）
    let sess = {
        let map = sessions().lock().await;
        map.get(&session_id).cloned()
    };
    if let Some(s) = sess {
        send_shell_cmd(&s.tx, ShellCmd::Resize { cols, rows }).await?;
    }
    Ok(())
}

/// 暂停 Shell 会话的数据读取（前端高水位背压）
pub async fn shell_pause(
    _server_id: String,
    session_id: String,
) -> Result<(), String> {
    let sess = {
        let map = sessions().lock().await;
        map.get(&session_id).cloned()
    };
    if let Some(s) = sess {
        let _ = send_shell_cmd(&s.tx, ShellCmd::Pause).await;
    }
    Ok(())
}

/// 恢复 Shell 会话的数据读取（前端低水位背压解除）
pub async fn shell_resume(
    _server_id: String,
    session_id: String,
) -> Result<(), String> {
    let sess = {
        let map = sessions().lock().await;
        map.get(&session_id).cloned()
    };
    if let Some(s) = sess {
        let _ = send_shell_cmd(&s.tx, ShellCmd::Resume).await;
    }
    Ok(())
}

/// Close a shell session.
/// 等待 reader task 真正退出（最多 3 秒），确保 SSH channel 已关闭、
/// 事件已发射完毕，避免 close 后仍有残余输出或 channel 泄漏。
pub async fn shell_close(
    _server_id: String,
    session_id: String,
) -> Result<(), String> {
    // 先 clone session 释放锁再操作，避免持锁 await 导致全局阻塞
    let sess = {
        let map = sessions().lock().await;
        map.get(&session_id).cloned()
    };
    if let Some(s) = sess {
        // 设置取消信号（让 select! 循环也能立即退出）
        s.cancel.store(true, Ordering::Relaxed);
        // send 用 try_send 避免卡住：reader 已退出时 channel 关闭，
        // try_send 失败说明 session 已关闭，无需等待
        let _ = s.tx.try_send(ShellCmd::Close);
        // 等待 reader task 真正退出（最多 3 秒）：
        // - ch.close().await 完成（SSH channel 关闭）
        // - shell-closed/shell-error 事件已发射
        // - sessions map 已清理
        // 超时后不阻塞调用方（reader 可能卡在 ch.data 的 10s 超时中）
        let _ = tokio::time::timeout(
            Duration::from_secs(3),
            s.done.notified(),
        ).await;
    }
    Ok(())
}

/// Get the cached output history for a shell session.
/// Used when migrating a terminal across windows to restore the scrollback buffer.
pub async fn shell_get_history(session_id: String) -> Result<String, String> {
    // 先 clone session 释放全局 sessions 锁，再锁 history 解码：解码虽快，
    // 但持锁期间会阻塞其他 shell 的 write/resize/close（与 shell_resize 等保持一致）
    let sess = {
        let sessions = sessions().lock().await;
        sessions.get(&session_id).cloned()
    };
    match sess {
        Some(s) => {
            // poison 容错：reader task panic 会毒化 mutex，迁移窗口恢复历史不应跟着失败
            let hist = s.history.lock().unwrap_or_else(|e| e.into_inner());
            let encoding = s.encoding.lock().map(|v| v.clone()).unwrap_or_else(|_| "utf-8".to_string());
            let mut codec = TerminalCodec::new(&encoding).unwrap_or_else(|_| TerminalCodec::utf8());
            let (slice1, slice2) = hist.as_slices();
            let mut text = codec.decode(slice1, false);
            text.push_str(&codec.decode(slice2, true));
            Ok(text)
        }
        None => Err(format!(
            "Shell session not found: {}",
            &session_id[..session_id.len().min(24)]
        )),
    }
}

/// 强制取消一个会话（不通过 ShellCmd::Close 通道，直接设置 cancel flag）
/// 用于：连接断开、应用退出等需要立即终止所有 zombie task 的场景
/// 等待 reader task 退出（最多 2 秒），确保 SSH channel 已释放
pub async fn shell_cancel(session_id: &str) {
    let sess = {
        let map = sessions().lock().await;
        map.get(session_id).cloned()
    };
    if let Some(s) = sess {
        s.cancel.store(true, Ordering::Relaxed);
        // Cancellation must never wait behind a saturated input queue. The
        // atomic flag is checked by the reader loop; Close is only a best
        // effort wake-up for a task currently waiting in select!.
        let _ = s.tx.try_send(ShellCmd::Close);
        // 等待 reader task 退出（最多 2 秒，比 shell_close 短以适应批量清理场景）
        let _ = tokio::time::timeout(
            Duration::from_secs(2),
            s.done.notified(),
        ).await;
    }
}

// ============================================================
// Log tail streaming (tail -f)
// ============================================================

/// Commands sent to a tail reader task.
enum TailCmd {
    Close,
}

/// A tail session handle.
#[derive(Clone)]
struct TailSession {
    tx: mpsc::Sender<TailCmd>,
    window_label: String,
    /// 取消信号
    cancel: Arc<AtomicBool>,
}

/// Global tail sessions map (session_id -> sender).
static TAIL_SESSIONS: std::sync::OnceLock<Arc<Mutex<HashMap<String, TailSession>>>> =
    std::sync::OnceLock::new();

fn tail_sessions() -> &'static Arc<Mutex<HashMap<String, TailSession>>> {
    TAIL_SESSIONS.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

/// 通用流式骨架：在远端执行一条持续输出的命令，并把 stdout/stderr 以事件推送。
///
/// `tail -f` 与 `journalctl -f` 共用此实现，仅命令与事件名不同：
/// 建立 shell channel → exec 命令 → reader task 持续读取 → 以 `event_name`
/// 事件推送（payload 为 TailData）→ 收到 Close / cancel 时关闭 channel 并清理 session。
async fn spawn_follow_stream(
    app: AppHandle,
    window_label: String,
    server_id: String,
    command: String,
    session_id: String,
    event_name: &'static str,
) -> Result<(), String> {
    let (conn, _generation) = SshManager::global()
        .get_connection_with_generation(&server_id)
        .map_err(|e| format!("Stream: not connected: {}", e))?;

    let mut ch = match conn.create_shell_channel().await {
        Ok(ch) => ch,
        Err(e) => {
            let err_msg = format!("open channel: {}", e);
            eprintln!("[SSH Stream] create_shell_channel failed for {}: {}", server_id, err_msg);
            if !conn.is_connected() {
                SshManager::handle_connection_loss(&server_id, &conn, &err_msg).await;
            }
            return Err(err_msg);
        }
    };

    if let Err(e) = ch.exec(true, command.as_str()).await {
        let err_msg = format!("exec command: {}", e);
        eprintln!("[SSH Stream] exec failed for {}: {}", server_id, err_msg);
        if !conn.is_connected() {
            SshManager::handle_connection_loss(&server_id, &conn, &err_msg).await;
        }
        return Err(err_msg);
    }

    // Register the session
    let (tx, mut rx) = mpsc::channel::<TailCmd>(16);
    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_for_map = cancel.clone();
    let sid = session_id.clone();
    tail_sessions().lock().await.insert(
        sid.clone(),
        TailSession {
            tx,
            window_label,
            cancel: cancel_for_map,
        },
    );

    // Spawn the reader loop
    let app_clone = app.clone();
    let cancel_for_task = cancel.clone();
    tokio::spawn(async move {
        let res: Result<(), String> = async {
            loop {
                if cancel_for_task.load(Ordering::Relaxed) {
                    break;
                }
                tokio::select! {
                    msg = ch.wait() => match msg {
                        Some(ChannelMsg::Data { data }) => {
                            let text = String::from_utf8_lossy(&data).to_string();
                            let _ = app_clone.emit(event_name, TailData {
                                session_id: sid.clone(),
                                data: text,
                            });
                        }
                        Some(ChannelMsg::ExtendedData { data, .. }) => {
                            let text = String::from_utf8_lossy(&data).to_string();
                            let _ = app_clone.emit(event_name, TailData {
                                session_id: sid.clone(),
                                data: text,
                            });
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                        _ => {}
                    },
                    cmd = rx.recv() => match cmd {
                        Some(TailCmd::Close) | None => break,
                    },
                    _ = tokio::time::sleep(Duration::from_millis(500)) => {
                        if cancel_for_task.load(Ordering::Relaxed) {
                            break;
                        }
                    }
                }
            }
            let _ = tokio::time::timeout(std::time::Duration::from_secs(5), ch.close()).await;
            Ok(())
        }
        .await;

        // Clean up session from map
        tail_sessions().lock().await.remove(&sid);

        if let Err(e) = res {
            eprintln!("[Stream] Session {} ended: {}", sid, e);
            let _ = app_clone.emit(event_name, TailData {
                session_id: sid.clone(),
                data: format!("\n[Stream Error] {}\n", e),
            });
        } else {
            let _ = app_clone.emit(event_name, TailData {
                session_id: sid.clone(),
                data: "\n[Stream stopped]\n".to_string(),
            });
        }
    });

    Ok(())
}

fn build_tail_command(initial_lines: i32, log_path: String) -> String {
    // Keep the amount of initial output bounded so a malformed or accidental
    // huge value cannot monopolize the SSH channel before follow mode starts.
    let n = if initial_lines > 0 {
        initial_lines.min(10_000)
    } else {
        50
    };
    // The command runs through the remote user's shell. Always quote the path
    // after validation; spaces and shell metacharacters are valid file-name
    // characters and must never become command syntax.
    let escaped_path = crate::validators::escape_shell_arg(log_path);
    format!("tail -n {} -f {}", n, escaped_path)
}

/// Start a `tail -f` stream on a remote log file.
///
/// New log lines are pushed to the frontend via the `logs:tail:data` event
/// in real time. Returns a `sessionId` that can be passed to `tail_close` to
/// stop the stream. The initial last N lines (controlled by `initial_lines`)
/// are also delivered via the event before the follow phase begins.
pub async fn tail_create(
    app: AppHandle,
    window_label: String,
    server_id: String,
    log_path: String,
    initial_lines: i32,
) -> Result<String, String> {
    // Validate the path before executing
    let path_validation = crate::validators::validate_path(log_path.clone(), false);
    if !path_validation.valid {
        return Err(format!(
            "Invalid log path: {}",
            path_validation.error.unwrap_or_default()
        ));
    }

    let session_id = format!("tail-{}", uuid::Uuid::new_v4());

    // Build the tail command: show initial lines then follow
    let command = build_tail_command(initial_lines, log_path);

    tail_create_with_command(app, window_label, server_id, command, session_id).await
}

/// Start a follow stream with a caller-provided remote command.
/// Platform-specific log implementations use this to avoid assuming a POSIX
/// `tail` binary on Windows hosts.
pub async fn tail_create_with_command(
    app: AppHandle,
    window_label: String,
    server_id: String,
    command: String,
    session_id: String,
) -> Result<String, String> {
    spawn_follow_stream(
        app,
        window_label,
        server_id,
        command,
        session_id.clone(),
        "logs:tail:data",
    )
    .await?;
    Ok(session_id)
}

/// Stop a `tail -f` stream.
pub async fn tail_close(
    _server_id: String,
    session_id: String,
) -> Result<(), String> {
    let sess = {
        let map = tail_sessions().lock().await;
        map.get(&session_id).cloned()
    };
    if let Some(s) = sess {
        s.cancel.store(true, Ordering::Relaxed);
        let _ = s.tx.try_send(TailCmd::Close);
    }
    Ok(())
}

/// 服务日志实时跟随：`journalctl -f -u <unit>`
///
/// 输出通过 `service:log:data` 事件推送（payload：{ sessionId, data }）。
/// 初始 `initial_lines` 行会先随事件送达，然后进入跟随阶段。
/// 返回的 sessionId 交给 `service_log_follow_close` 停止；窗口关闭时
/// `close_sessions_for_window` 也会一并清理（与 tail 共用 session map）。
pub async fn service_log_follow_create(
    app: AppHandle,
    window_label: String,
    server_id: String,
    unit: String,
    initial_lines: i32,
) -> Result<String, String> {
    // 服务名严格校验，拒绝 shell 元字符
    let validation = crate::validators::validate_service_name(unit.clone());
    if !validation.valid {
        return Err(format!(
            "Invalid service name: {}",
            validation.error.unwrap_or_default()
        ));
    }

    let session_id = format!("svclog-{}", uuid::Uuid::new_v4());
    let n = if initial_lines > 0 {
        initial_lines.min(10_000)
    } else {
        100
    };
    let command = format!(
        "journalctl -f -u '{}' -n {} --no-pager -o short-iso",
        unit, n
    );

    spawn_follow_stream(
        app,
        window_label,
        server_id,
        command,
        session_id.clone(),
        "service:log:data",
    )
    .await?;
    Ok(session_id)
}

/// 停止服务日志实时跟随
pub async fn service_log_follow_close(
    server_id: String,
    session_id: String,
) -> Result<(), String> {
    tail_close(server_id, session_id).await
}

/// Close all shell and tail sessions belonging to a specific window
///
/// 通过取消信号立即终止任务，避免 zombie task 持有 SSH channel
pub async fn close_sessions_for_window(window_label: &str) {
    // 收集 shell 会话并设置取消信号
    let shells_to_close: Vec<(String, mpsc::Sender<ShellCmd>, Arc<AtomicBool>)> = {
        let map = sessions().lock().await;
        map.values()
            .filter(|s| s.window_label == window_label)
            .map(|s| (s.window_label.clone(), s.tx.clone(), s.cancel.clone()))
            .collect()
    };
    for (_, tx, cancel) in shells_to_close {
        cancel.store(true, Ordering::Relaxed);
        let _ = tx.try_send(ShellCmd::Close);
    }

    // 收集 tail 会话并设置取消信号
    let tails_to_close: Vec<(mpsc::Sender<TailCmd>, Arc<AtomicBool>)> = {
        let map = tail_sessions().lock().await;
        map.values()
            .filter(|t| t.window_label == window_label)
            .map(|t| (t.tx.clone(), t.cancel.clone()))
            .collect()
    };
    for (tx, cancel) in tails_to_close {
        cancel.store(true, Ordering::Relaxed);
        let _ = tx.try_send(TailCmd::Close);
    }
}

#[cfg(test)]
mod tests {
    use super::build_tail_command;

    #[test]
    fn tail_command_quotes_paths_with_spaces() {
        assert_eq!(
            build_tail_command(50, "/var/log/app output.log".to_string()),
            "tail -n 50 -f '/var/log/app output.log'",
        );
    }

    #[test]
    fn tail_command_does_not_allow_shell_syntax_in_path() {
        let command = build_tail_command(20, "/tmp/app' -f /etc/passwd #".to_string());
        assert_eq!(
            command,
            "tail -n 20 -f '/tmp/app'\\'' -f /etc/passwd #'",
        );
    }

    #[test]
    fn tail_command_caps_initial_lines() {
        assert!(build_tail_command(i32::MAX, "/var/log/app.log".to_string()).starts_with("tail -n 10000 -f "));
        assert!(build_tail_command(0, "/var/log/app.log".to_string()).starts_with("tail -n 50 -f "));
    }
}
