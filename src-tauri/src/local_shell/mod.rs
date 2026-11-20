//! 本地 Shell 伪终端模块（Windows ConPTY / macOS & Linux PTY）
//!
//! 对标 Xshell "Local Shell" 一等协议：
//! 1. 自动探测宿主系统可用 Shell Profile（PowerShell / cmd / WSL / Git Bash / zsh / bash 等）；
//! 2. 通过 `portable-pty` 分配跨平台 PTY 并派发子进程；
//! 3. 与 SSH / Telnet / Serial 共享 `ssh:shell-output`、`ssh:shell-closed`、`ssh:shell-error` 及 `session:traffic` 事件总线；
//! 4. 支持 512KB Ring Buffer 历史回放（跨窗口拖拽恢复）、动态编码（UTF-8 / GBK）及退出清理。

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
#[cfg(target_os = "windows")]
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use lazy_static::lazy_static;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tracing::{info, warn};
use uuid::Uuid;

use crate::session::{emit_session_traffic, normalize_term_type};
use crate::ssh::shell::ShellOutputData;
use crate::ssh::terminal_encoding::TerminalCodec;

const HISTORY_CAPACITY: usize = 512 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalShellProfile {
    pub id: String,
    pub label: String,
    pub shell_path: String,
    pub args: Vec<String>,
    pub is_default: bool,
    pub platform: String,
}

struct LocalShellSession {
    window_label: String,
    server_id: String,
    history: Arc<Mutex<VecDeque<u8>>>,
    encoding: Arc<Mutex<String>>,
    writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    child: Arc<Mutex<Option<Box<dyn Child + Send + Sync>>>>,
    reader_thread: Arc<Mutex<Option<std::thread::JoinHandle<()>>>>,
    is_closed: Arc<AtomicBool>,
    rx_bytes: Arc<AtomicU64>,
    tx_bytes: Arc<AtomicU64>,
}

lazy_static! {
    static ref LOCAL_SESSIONS: Arc<Mutex<HashMap<String, Arc<LocalShellSession>>>> =
        Arc::new(Mutex::new(HashMap::new()));
}

fn find_in_path(binary: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(binary);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn push_unique_profile(
    profiles: &mut Vec<LocalShellProfile>,
    id: &str,
    label: &str,
    shell_path: PathBuf,
    args: Vec<String>,
    platform: &str,
) {
    let path_str = shell_path.to_string_lossy().to_string();
    if profiles
        .iter()
        .any(|p| p.id == id || p.shell_path.eq_ignore_ascii_case(&path_str))
    {
        return;
    }
    profiles.push(LocalShellProfile {
        id: id.to_string(),
        label: label.to_string(),
        shell_path: path_str,
        args,
        is_default: false,
        platform: platform.to_string(),
    });
}

/// 枚举当前主机上可用的本地 Shell Profile
pub fn detect_profiles() -> Vec<LocalShellProfile> {
    let mut profiles = Vec::new();

    #[cfg(target_os = "windows")]
    {
        let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        let sys32 = Path::new(&sys_root).join("System32");

        // PowerShell 7+ (pwsh)
        if let Some(p) = find_in_path("pwsh.exe").or_else(|| {
            let candidate = PathBuf::from(r"C:\Program Files\PowerShell\7\pwsh.exe");
            candidate.is_file().then_some(candidate)
        }) {
            push_unique_profile(
                &mut profiles,
                "pwsh",
                "PowerShell 7",
                p,
                vec!["-NoLogo".to_string()],
                "windows",
            );
        }

        // Windows PowerShell
        let win_ps = sys32
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        if win_ps.is_file() {
            push_unique_profile(
                &mut profiles,
                "powershell",
                "Windows PowerShell",
                win_ps,
                vec!["-NoLogo".to_string()],
                "windows",
            );
        } else if let Some(p) = find_in_path("powershell.exe") {
            push_unique_profile(
                &mut profiles,
                "powershell",
                "Windows PowerShell",
                p,
                vec!["-NoLogo".to_string()],
                "windows",
            );
        }

        // Command Prompt (cmd.exe)
        let cmd_path = std::env::var_os("ComSpec")
            .map(PathBuf::from)
            .filter(|p| p.is_file())
            .unwrap_or_else(|| sys32.join("cmd.exe"));
        if cmd_path.is_file() || find_in_path("cmd.exe").is_some() {
            let resolved = if cmd_path.is_file() {
                cmd_path
            } else {
                find_in_path("cmd.exe").unwrap()
            };
            push_unique_profile(
                &mut profiles,
                "cmd",
                "Command Prompt (cmd)",
                resolved,
                Vec::new(),
                "windows",
            );
        }

        // Git Bash
        for candidate_str in [
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
        ] {
            let candidate = PathBuf::from(candidate_str);
            if candidate.is_file() {
                push_unique_profile(
                    &mut profiles,
                    "git-bash",
                    "Git Bash",
                    candidate,
                    vec!["--login".to_string(), "-i".to_string()],
                    "windows",
                );
                break;
            }
        }

        // WSL
        let wsl_path = sys32.join("wsl.exe");
        if wsl_path.is_file() {
            push_unique_profile(
                &mut profiles,
                "wsl",
                "WSL",
                wsl_path,
                Vec::new(),
                "windows",
            );
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let platform = if cfg!(target_os = "macos") {
            "macos"
        } else {
            "linux"
        };

        if let Ok(env_shell) = std::env::var("SHELL") {
            let p = PathBuf::from(env_shell.trim());
            if p.is_file() {
                let name = p
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("shell")
                    .to_string();
                let id = name.to_ascii_lowercase();
                push_unique_profile(
                    &mut profiles,
                    &id,
                    &format!("Default ({})", name),
                    p,
                    vec!["-l".to_string()],
                    platform,
                );
            }
        }

        for (id, label, path_str) in [
            ("zsh", "Zsh", "/bin/zsh"),
            ("bash", "Bash", "/bin/bash"),
            ("fish", "Fish", "/usr/bin/fish"),
            ("fish-brew", "Fish (Homebrew)", "/opt/homebrew/bin/fish"),
            ("sh", "POSIX sh", "/bin/sh"),
        ] {
            let p = PathBuf::from(path_str);
            if p.is_file() {
                push_unique_profile(
                    &mut profiles,
                    id,
                    label,
                    p,
                    if id == "sh" {
                        Vec::new()
                    } else {
                        vec!["-l".to_string()]
                    },
                    platform,
                );
            }
        }
    }

    if let Some(first) = profiles.first_mut() {
        first.is_default = true;
    }

    profiles
}

pub fn resolve_profile<'a>(
    profiles: &'a [LocalShellProfile],
    profile_id: Option<&str>,
) -> Option<&'a LocalShellProfile> {
    if let Some(requested) = profile_id.map(str::trim).filter(|s| !s.is_empty()) {
        if let Some(found) = profiles.iter().find(|p| {
            p.id.eq_ignore_ascii_case(requested) || p.shell_path.eq_ignore_ascii_case(requested)
        }) {
            return Some(found);
        }
    }
    profiles.iter().find(|p| p.is_default).or_else(|| profiles.first())
}

fn append_history(history: &Arc<Mutex<VecDeque<u8>>>, chunk: &[u8]) {
    if chunk.is_empty() {
        return;
    }
    let mut buf = history.lock().unwrap_or_else(|e| e.into_inner());
    if chunk.len() >= HISTORY_CAPACITY {
        buf.clear();
        let start = chunk.len() - HISTORY_CAPACITY;
        buf.extend(&chunk[start..]);
        return;
    }
    let overflow = (buf.len() + chunk.len()).saturating_sub(HISTORY_CAPACITY);
    for _ in 0..overflow {
        buf.pop_front();
    }
    buf.extend(chunk);
}

fn close_session_internal(session_id: &str, app: Option<&AppHandle>) -> Result<(), String> {
    let sess = {
        let mut map = LOCAL_SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(session_id)
    };
    let Some(sess) = sess else {
        return Ok(());
    };

    let already_closed = sess.is_closed.swap(true, Ordering::SeqCst);

    // 1. 终止子进程并释放 PTY 句柄（解除 reader 阻塞）
    if let Some(mut child) = sess.child.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let _ = sess.writer.lock().unwrap_or_else(|e| e.into_inner()).take();
    let _ = sess.master.lock().unwrap_or_else(|e| e.into_inner()).take();

    // 释放 PTY 句柄后，读取线程会因 read 返回 EOF/Err 而退出；join 回收线程资源。
    // 若当前即读取线程自身（线程结束时的自清理调用），跳过 join 避免自 join 死锁。
    if let Some(handle) = sess
        .reader_thread
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
    {
        if handle.thread().id() != std::thread::current().id() {
            let _ = handle.join();
        }
    }

    if !already_closed {
        // 主动调用 ssh_close_shell / 窗口关闭时调用方不传 AppHandle，
        // 旧实现因此永远不发 ssh:shell-closed，前端终端会停留在「已连接」状态。
        // 事件发射与调用方解耦：优先用传入的句柄，否则回退到全局 AppHandle。
        let emitter = app
            .cloned()
            .or_else(|| crate::ssh::manager::app_handle().cloned());
        if let Some(app_handle) = emitter {
            let _ = app_handle.emit(
                "ssh:shell-closed",
                ShellOutputData {
                    session_id: session_id.to_string(),
                    data: String::new(),
                    sequence: None,
                },
            );
        }
    }
    Ok(())
}

/// 创建本地 Shell PTY 会话并返回 `(session_id, resolved_profile)`
pub fn create_local_shell(
    app: AppHandle,
    window_label: String,
    server_id: String,
    profile_id: Option<String>,
    cwd: Option<String>,
    cols: u32,
    rows: u32,
    encoding: String,
    term_type: Option<String>,
) -> Result<(String, LocalShellProfile), String> {
    let profiles = detect_profiles();
    let profile = resolve_profile(&profiles, profile_id.as_deref())
        .cloned()
        .ok_or_else(|| "未检测到可用的本地 Shell 程序".to_string())?;

    let cols_u16 = cols.clamp(1, u16::MAX as u32) as u16;
    let rows_u16 = rows.clamp(1, u16::MAX as u32) as u16;
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows_u16,
            cols: cols_u16,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("打开本地 PTY 失败: {}", e))?;

    let mut cmd = CommandBuilder::new(&profile.shell_path);
    for arg in &profile.args {
        cmd.arg(arg);
    }

    let normalized_term = normalize_term_type(term_type.as_deref());
    cmd.env("TERM", &normalized_term);
    cmd.env("COLORTERM", "truecolor");

    let target_cwd = cwd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(dirs::home_dir);
    if let Some(dir) = target_cwd {
        cmd.cwd(dir);
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("启动本地 Shell '{}' 失败: {}", profile.label, e))?;
    drop(pair.slave);

    let mut reader = match pair.master.try_clone_reader() {
        Ok(r) => r,
        Err(e) => {
            // 读取句柄获取失败时，已 spawn 的子进程需立即终止，避免遗留孤儿进程
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("获取本地 PTY 读取句柄失败: {}", e));
        }
    };
    let writer = match pair.master.take_writer() {
        Ok(w) => w,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("获取本地 PTY 写入句柄失败: {}", e));
        }
    };

    let session_id = format!("local-{}", Uuid::new_v4());
    let initial_encoding = TerminalCodec::new(&encoding)
        .map(|c| c.name().to_string())
        .unwrap_or_else(|_| "utf-8".to_string());

    let session = Arc::new(LocalShellSession {
        window_label,
        server_id,
        history: Arc::new(Mutex::new(VecDeque::with_capacity(4096))),
        encoding: Arc::new(Mutex::new(initial_encoding.clone())),
        writer: Arc::new(Mutex::new(Some(writer))),
        master: Arc::new(Mutex::new(Some(pair.master))),
        child: Arc::new(Mutex::new(Some(child))),
        reader_thread: Arc::new(Mutex::new(None)),
        is_closed: Arc::new(AtomicBool::new(false)),
        rx_bytes: Arc::new(AtomicU64::new(0)),
        tx_bytes: Arc::new(AtomicU64::new(0)),
    });

    {
        let mut map = LOCAL_SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
        map.insert(session_id.clone(), session.clone());
    }

    info!(
        "[LocalShell] Started session {} ({}, {})",
        session_id, profile.label, profile.shell_path
    );

    // 后台 500ms 流量统计上报任务
    {
        let sid = session_id.clone();
        let app_clone = app.clone();
        let sess_clone = session.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(500));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut last_rx = 0u64;
            let mut last_tx = 0u64;
            loop {
                interval.tick().await;
                if sess_clone.is_closed.load(Ordering::Relaxed) {
                    break;
                }
                let rx = sess_clone.rx_bytes.load(Ordering::Relaxed);
                let tx = sess_clone.tx_bytes.load(Ordering::Relaxed);
                if rx != last_rx || tx != last_tx {
                    last_rx = rx;
                    last_tx = tx;
                    emit_session_traffic(&app_clone, &sid, rx, tx);
                }
            }
        });
    }

    // 专用 OS 阻塞读取线程
    {
        let sid = session_id.clone();
        let app_clone = app.clone();
        let sess_clone = session.clone();
        let session_for_handle = session.clone();
        match std::thread::Builder::new()
            .name(format!("local-pty-{}", &sid[..sid.len().min(14)]))
            .spawn(move || {
                let mut codec = TerminalCodec::new(&initial_encoding)
                    .unwrap_or_else(|_| TerminalCodec::utf8());
                let mut current_encoding = codec.name().to_string();
                let mut seq = 0u64;
                let mut buf = [0u8; 8192];

                loop {
                    if sess_clone.is_closed.load(Ordering::Relaxed) {
                        break;
                    }
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            let bytes = &buf[..n];
                            sess_clone.rx_bytes.fetch_add(n as u64, Ordering::Relaxed);
                            append_history(&sess_clone.history, bytes);

                            let target_enc = sess_clone
                                .encoding
                                .lock()
                                .map(|s| s.clone())
                                .unwrap_or_else(|_| "utf-8".to_string());
                            if target_enc != current_encoding {
                                let flushed = codec.decode(&[], true);
                                if !flushed.is_empty() {
                                    seq = seq.saturating_add(1);
                                    let _ = app_clone.emit(
                                        "ssh:shell-output",
                                        ShellOutputData {
                                            session_id: sid.clone(),
                                            data: flushed,
                                            sequence: Some(seq),
                                        },
                                    );
                                }
                                codec = TerminalCodec::new(&target_enc)
                                    .unwrap_or_else(|_| TerminalCodec::utf8());
                                current_encoding = codec.name().to_string();
                            }

                            let text = codec.decode(bytes, false);
                            if !text.is_empty() {
                                seq = seq.saturating_add(1);
                                let _ = app_clone.emit(
                                    "ssh:shell-output",
                                    ShellOutputData {
                                        session_id: sid.clone(),
                                        data: text,
                                        sequence: Some(seq),
                                    },
                                );
                            }
                        }
                        Err(e) => {
                            if !sess_clone.is_closed.load(Ordering::Relaxed) {
                                warn!("[LocalShell] Read ended on {}: {}", sid, e);
                            }
                            break;
                        }
                    }
                }

                let tail = codec.decode(&[], true);
                if !tail.is_empty() {
                    seq = seq.saturating_add(1);
                    let _ = app_clone.emit(
                        "ssh:shell-output",
                        ShellOutputData {
                            session_id: sid.clone(),
                            data: tail,
                            sequence: Some(seq),
                        },
                    );
                }

                let _ = close_session_internal(&sid, Some(&app_clone));
            })
        {
            Ok(handle) => {
                *session_for_handle
                    .reader_thread
                    .lock()
                    .unwrap_or_else(|e| e.into_inner()) = Some(handle);
            }
            Err(e) => {
                let _ = close_session_internal(&session_id, None);
                return Err(format!("启动本地 Shell 读取线程失败: {}", e));
            }
        }
    }

    Ok((session_id, profile))
}

pub fn local_write(session_id: &str, data: &str) -> Result<(), String> {
    let sess = {
        let map = LOCAL_SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
        map.get(session_id).cloned()
    }
    .ok_or_else(|| format!("Local shell session not found: {}", session_id))?;

    if sess.is_closed.load(Ordering::Relaxed) {
        return Err("Local shell session is closed".to_string());
    }

    let encoding = sess
        .encoding
        .lock()
        .map(|s| s.clone())
        .unwrap_or_else(|_| "utf-8".to_string());
    let codec = TerminalCodec::new(&encoding).unwrap_or_else(|_| TerminalCodec::utf8());
    let bytes = codec.encode(data)?;

    let mut writer_guard = sess.writer.lock().unwrap_or_else(|e| e.into_inner());
    let writer = writer_guard
        .as_mut()
        .ok_or_else(|| "Local shell writer unavailable".to_string())?;
    writer
        .write_all(&bytes)
        .and_then(|_| writer.flush())
        .map_err(|e| format!("写入本地 Shell 失败: {}", e))?;

    sess.tx_bytes
        .fetch_add(bytes.len() as u64, Ordering::Relaxed);
    Ok(())
}

pub fn local_resize(session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
    let sess = {
        let map = LOCAL_SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
        map.get(session_id).cloned()
    };
    let Some(sess) = sess else {
        return Ok(());
    };
    let master_guard = sess.master.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(master) = master_guard.as_ref() {
        master
            .resize(PtySize {
                rows: rows.clamp(1, u16::MAX as u32) as u16,
                cols: cols.clamp(1, u16::MAX as u32) as u16,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("调整本地 PTY 尺寸失败: {}", e))?;
    }
    Ok(())
}

pub fn local_set_encoding(session_id: &str, encoding: &str) -> Result<(), String> {
    let codec = TerminalCodec::new(encoding)?;
    let sess = {
        let map = LOCAL_SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
        map.get(session_id).cloned()
    }
    .ok_or_else(|| format!("Local shell session not found: {}", session_id))?;

    if let Ok(mut guard) = sess.encoding.lock() {
        *guard = codec.name().to_string();
    }
    Ok(())
}

pub fn local_close(session_id: &str) -> Result<(), String> {
    close_session_internal(session_id, None)
}

pub fn local_get_history(session_id: &str) -> Result<String, String> {
    let sess = {
        let map = LOCAL_SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
        map.get(session_id).cloned()
    }
    .ok_or_else(|| format!("Local shell session not found: {}", session_id))?;

    let bytes: Vec<u8> = {
        let guard = sess.history.lock().unwrap_or_else(|e| e.into_inner());
        guard.iter().copied().collect()
    };
    let encoding = sess
        .encoding
        .lock()
        .map(|s| s.clone())
        .unwrap_or_else(|_| "utf-8".to_string());
    let mut codec = TerminalCodec::new(&encoding).unwrap_or_else(|_| TerminalCodec::utf8());
    Ok(codec.decode(&bytes, true))
}

pub fn close_sessions_for_window(window_label: &str) {
    let ids: Vec<String> = {
        let map = LOCAL_SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
        map.iter()
            .filter(|(_, s)| s.window_label == window_label)
            .map(|(id, _)| id.clone())
            .collect()
    };
    for id in ids {
        let _ = close_session_internal(&id, None);
    }
}

pub fn close_all_sessions() {
    let ids: Vec<String> = {
        let map = LOCAL_SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
        map.keys().cloned().collect()
    };
    for id in ids {
        let _ = close_session_internal(&id, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_profiles_finds_at_least_one_shell_and_marks_default() {
        let profiles = detect_profiles();
        assert!(!profiles.is_empty(), "应至少探测到一个可用的本地 Shell");
        assert_eq!(
            profiles.iter().filter(|p| p.is_default).count(),
            1,
            "应当恰好有一个默认本地 Shell Profile"
        );
    }

    #[test]
    fn resolve_profile_matches_requested_or_falls_back_to_default() {
        let profiles = vec![
            LocalShellProfile {
                id: "pwsh".into(),
                label: "PowerShell 7".into(),
                shell_path: "C:\\pwsh.exe".into(),
                args: vec![],
                is_default: true,
                platform: "windows".into(),
            },
            LocalShellProfile {
                id: "cmd".into(),
                label: "cmd".into(),
                shell_path: "C:\\cmd.exe".into(),
                args: vec![],
                is_default: false,
                platform: "windows".into(),
            },
        ];

        assert_eq!(resolve_profile(&profiles, Some("CMD")).unwrap().id, "cmd");
        assert_eq!(resolve_profile(&profiles, Some("missing")).unwrap().id, "pwsh");
        assert_eq!(resolve_profile(&profiles, None).unwrap().id, "pwsh");
    }

    #[test]
    fn append_history_caps_at_ring_capacity() {
        let history = Arc::new(Mutex::new(VecDeque::new()));
        let big = vec![b'x'; HISTORY_CAPACITY + 128];
        append_history(&history, &big);
        assert_eq!(history.lock().unwrap().len(), HISTORY_CAPACITY);
    }

    #[test]
    fn openpty_spawns_shell_and_reads_output() {
        let profiles = detect_profiles();
        let profile = resolve_profile(&profiles, None).expect("default profile");
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");

        #[cfg(target_os = "windows")]
        let mut cmd = {
            let mut c = CommandBuilder::new("cmd.exe");
            c.arg("/C");
            c.arg("echo");
            c.arg("qshell_pty_ok");
            c
        };
        #[cfg(not(target_os = "windows"))]
        let mut cmd = {
            let mut c = CommandBuilder::new("/bin/sh");
            c.arg("-c");
            c.arg("echo qshell_pty_ok");
            c
        };
        cmd.env("TERM", "xterm-256color");
        if let Some(dir) = dirs::home_dir() {
            cmd.cwd(dir);
        }
        let mut child = pair.slave.spawn_command(cmd).expect("spawn_command");
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().expect("try_clone_reader");
        let mut writer = pair.master.take_writer().expect("take_writer");
        let (tx, rx) = std::sync::mpsc::channel();
        let (dsr_tx, dsr_rx) = std::sync::mpsc::channel();
        let dsr_handle = std::thread::spawn(move || {
            if dsr_rx.recv().is_ok() {
                let _ = writer.write_all(b"\x1b[1;1R");
                let _ = writer.flush();
            }
            writer
        });
        std::thread::spawn(move || {
            let mut out = Vec::new();
            let mut buf = [0u8; 1024];
            let mut answered_dsr = false;
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        out.extend_from_slice(&buf[..n]);
                        // Windows ConPTY 启动后会发送 ESC[6n 查询光标位置，需尽快应答否则可能延迟冲刷输出
                        if !answered_dsr && out.windows(4).any(|w| w == b"\x1b[6n") {
                            answered_dsr = true;
                            let _ = dsr_tx.send(());
                        }
                        if String::from_utf8_lossy(&out).contains("qshell_pty_ok") {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            drop(dsr_tx);
            let _ = tx.send(out);
        });
        let out = rx
            .recv_timeout(std::time::Duration::from_secs(15))
            .expect("timed out reading ConPTY output");
        let _ = child.wait();
        if let Ok(writer) = dsr_handle.join() {
            drop(writer);
        }
        drop(pair.master);
        let text = String::from_utf8_lossy(&out);
        assert!(
            text.contains("qshell_pty_ok"),
            "unexpected output for {}: {:?}",
            profile.id,
            text
        );
    }
}
