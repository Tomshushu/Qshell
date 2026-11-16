//! SCP 协议后端与纯 Shell 文件系统适配器 (`P1-02`)
//!
//! 为禁用了 SFTP 子系统（仅开放 SSH exec + `scp`）的嵌入式/精简镜像或受限堡垒机提供：
//! - 标准 OpenSSH SCP 线协议上传 (`scp -t`) 与下载 (`scp -f`)
//! - 基于 `ssh_execute_command` 的远程目录浏览 (`ls -lA`)、stat、mkdir、rm、mv、chmod、备份
//! - 不依赖 SFTP 子系统即可完成文件面板日常操作

use std::collections::VecDeque;
use std::path::Path as StdPath;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use russh::ChannelMsg;
use tokio::io::AsyncWriteExt;

use crate::commands::{ssh_execute_command, CommandResult};
use crate::parsers::FileEntry;
use crate::ssh::manager::SshManager;
use crate::validators::escape_shell_arg;

const SCP_TIMEOUT_SECS: u64 = 120;
const SCP_CHUNK_SIZE: usize = 32 * 1024;
const MAX_SCP_STDERR_BYTES: usize = 64 * 1024;

/// 封装 SCP channel 读写状态（缓冲网络分片，支持字节级精确解析 `C<mode> <size> <name>` 与 `\x00` ACK）
struct ScpChannelIo {
    channel: russh::Channel<russh::client::Msg>,
    buf: VecDeque<u8>,
    stderr: Vec<u8>,
    eof: bool,
    cancel: Option<Arc<AtomicBool>>,
}

impl ScpChannelIo {
    fn new(channel: russh::Channel<russh::client::Msg>) -> Self {
        Self::new_with_cancel(channel, None)
    }

    fn new_with_cancel(
        channel: russh::Channel<russh::client::Msg>,
        cancel: Option<Arc<AtomicBool>>,
    ) -> Self {
        Self {
            channel,
            buf: VecDeque::with_capacity(64 * 1024),
            stderr: Vec::new(),
            eof: false,
            cancel,
        }
    }

    fn check_cancelled(&self) -> Result<(), String> {
        if self
            .cancel
            .as_ref()
            .is_some_and(|f| f.load(Ordering::Relaxed))
        {
            return Err("Transfer canceled by user".to_string());
        }
        Ok(())
    }

    async fn fill(&mut self) -> Result<bool, String> {
        if self.eof {
            return Ok(false);
        }
        let cancel = self.cancel.clone();
        loop {
            self.check_cancelled()?;
            let msg = tokio::select! {
                biased;
                _ = crate::ssh::manager::sleep_until_cancel(cancel.as_ref()) => {
                    return Err("Transfer canceled by user".to_string());
                }
                res = tokio::time::timeout(
                    Duration::from_secs(SCP_TIMEOUT_SECS),
                    self.channel.wait(),
                ) => {
                    res.map_err(|_| "SCP channel read timed out".to_string())?
                }
            };

            match msg {
                Some(ChannelMsg::Data { data }) => {
                    if !data.is_empty() {
                        self.buf.extend(data.iter().copied());
                        return Ok(true);
                    }
                }
                Some(ChannelMsg::ExtendedData { data, ext: 1 }) => {
                    if self.stderr.len() < MAX_SCP_STDERR_BYTES {
                        let remaining = MAX_SCP_STDERR_BYTES - self.stderr.len();
                        let take = remaining.min(data.len());
                        self.stderr.extend_from_slice(&data[..take]);
                    }
                }
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                    self.eof = true;
                    return Ok(false);
                }
                _ => {}
            }
        }
    }

    async fn read_byte(&mut self) -> Result<u8, String> {
        while self.buf.is_empty() {
            if !self.fill().await? {
                let err_txt = String::from_utf8_lossy(&self.stderr).trim().to_string();
                return Err(if err_txt.is_empty() {
                    "Unexpected EOF waiting for SCP response".to_string()
                } else {
                    format!("SCP remote error: {}", err_txt)
                });
            }
        }
        Ok(self.buf.pop_front().unwrap_or(0))
    }

    async fn read_line_trimmed(&mut self) -> Result<String, String> {
        let mut line = Vec::new();
        loop {
            let b = self.read_byte().await?;
            if b == b'\n' {
                break;
            }
            if line.len() > 8192 {
                return Err("SCP protocol header line too long".to_string());
            }
            line.push(b);
        }
        Ok(String::from_utf8_lossy(&line).trim_end_matches('\r').to_string())
    }

    async fn read_ack(&mut self) -> Result<(), String> {
        let code = self.read_byte().await?;
        match code {
            0 => Ok(()),
            1 | 2 => {
                let msg = self.read_line_trimmed().await.unwrap_or_default();
                Err(if msg.is_empty() {
                    format!("SCP remote rejected operation (code {})", code)
                } else {
                    msg
                })
            }
            other => Err(format!("Unexpected SCP response byte: {}", other)),
        }
    }

    async fn send_ack(&mut self) -> Result<(), String> {
        self.check_cancelled()?;
        let cancel = self.cancel.clone();
        tokio::select! {
            biased;
            _ = crate::ssh::manager::sleep_until_cancel(cancel.as_ref()) => {
                Err("Transfer canceled by user".to_string())
            }
            res = tokio::time::timeout(
                Duration::from_secs(SCP_TIMEOUT_SECS),
                self.channel.data(&[0u8][..]),
            ) => {
                res.map_err(|_| "SCP ACK write timed out".to_string())?
                    .map_err(|e| format!("Failed to write SCP ACK: {}", e))
            }
        }
    }

    async fn write_all(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.check_cancelled()?;
        let cancel = self.cancel.clone();
        tokio::select! {
            biased;
            _ = crate::ssh::manager::sleep_until_cancel(cancel.as_ref()) => {
                Err("Transfer canceled by user".to_string())
            }
            res = tokio::time::timeout(
                Duration::from_secs(SCP_TIMEOUT_SECS),
                self.channel.data(bytes),
            ) => {
                res.map_err(|_| "SCP channel write timed out".to_string())?
                    .map_err(|e| format!("Failed to write SCP stream: {}", e))
            }
        }
    }

    async fn close_gracefully(&mut self) {
        let _ = self.channel.eof().await;
        let _ = self.channel.close().await;
    }
}

const PROGRESS_THROTTLE_MS: u64 = 64;

fn sanitize_scp_header_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '\r' | '\n' | '\0' | '/' => '_',
            _ => c,
        })
        .collect();
    if cleaned.is_empty() {
        "file".to_string()
    } else {
        cleaned
    }
}

fn make_scp_tmp_path(remote_path: &str) -> String {
    let tmp_name = format!(".qshell_tmp_{}", uuid::Uuid::new_v4());
    let trimmed = remote_path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) => format!("/{}", tmp_name),
        Some(idx) => format!("{}/{}", &trimmed[..idx], tmp_name),
        None => tmp_name,
    }
}

async fn cleanup_remote_tmp(server_id: &str, tmp_remote_path: &str) {
    let cmd = format!("rm -f -- {}", escape_shell_arg(tmp_remote_path.to_string()));
    let _ = ssh_execute_command(server_id, &cmd).await;
}

/// 解析 SCP 文件头（例如 `C0644 1024 report.txt`）
pub fn parse_scp_header(line: &str) -> Result<(String, u64, String), String> {
    if !line.starts_with('C') {
        return Err(format!("Unsupported SCP record header: {}", line));
    }
    let rest = &line[1..];
    let mut parts = rest.splitn(3, ' ');
    let mode = parts
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("Invalid SCP header mode: {}", line))?;
    let size_str = parts
        .next()
        .ok_or_else(|| format!("Invalid SCP header size: {}", line))?;
    let name = parts
        .next()
        .ok_or_else(|| format!("Invalid SCP header filename: {}", line))?;
    let size = size_str
        .parse::<u64>()
        .map_err(|_| format!("Invalid SCP file size '{}'", size_str))?;
    Ok((mode.to_string(), size, name.to_string()))
}

struct LsTokenSpan<'a> {
    end: usize,
    text: &'a str,
}

fn tokenize_ls_line(line: &str, max_tokens: usize) -> Vec<LsTokenSpan<'_>> {
    let mut spans = Vec::with_capacity(max_tokens);
    let bytes = line.as_bytes();
    let mut idx = 0usize;
    while spans.len() < max_tokens && idx < bytes.len() {
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
        spans.push(LsTokenSpan {
            end: idx,
            text: &line[start..idx],
        });
    }
    spans
}

struct ParsedLsRow<'a> {
    kind_char: char,
    perms: &'a str,
    links: u64,
    owner: &'a str,
    group: &'a str,
    size: u64,
    modified_time: String,
    name: &'a str,
    symlink_target: Option<&'a str>,
}

fn parse_ls_row(raw_line: &str) -> Option<ParsedLsRow<'_>> {
    let line = raw_line.trim_end_matches(['\r', '\n']);
    if line.trim().is_empty() || line.starts_with("total ") {
        return None;
    }
    let first = line.chars().next()?;
    if !matches!(first, '-' | 'd' | 'l' | 'b' | 'c' | 'p' | 's') {
        return None;
    }

    let spans = tokenize_ls_line(line, 10);
    if spans.len() < 7 {
        return None;
    }

    let perms = spans[0].text;
    let links = spans[1].text.parse::<u64>().unwrap_or(1);
    let owner = spans[2].text;
    let group = spans[3].text;

    // 块设备/字符设备行将 size 替换为 `major, minor`（如 `8, 0`）
    let is_device = matches!(first, 'b' | 'c');
    let has_split_dev_numbers = is_device && spans[4].text.ends_with(',');
    let date_idx = if has_split_dev_numbers { 6 } else { 5 };
    let size = if is_device {
        0
    } else {
        spans[4].text.parse::<u64>().unwrap_or(0)
    };

    if spans.len() <= date_idx + 1 {
        return None;
    }

    let (modified_time, name_offset) = if spans[date_idx].text.contains('-') {
        // GNU `--time-style=long-iso`: `YYYY-MM-DD HH:MM`
        let mtime = format!("{} {}", spans[date_idx].text, spans[date_idx + 1].text);
        (mtime, spans[date_idx + 1].end)
    } else {
        // 经典 POSIX/BSD 格式：`Mon DD HH:MM` 或 `Mon DD YYYY`
        if spans.len() <= date_idx + 2 {
            return None;
        }
        let mtime = format!(
            "{} {} {}",
            spans[date_idx].text,
            spans[date_idx + 1].text,
            spans[date_idx + 2].text
        );
        (mtime, spans[date_idx + 2].end)
    };

    let tail = &line[name_offset..];
    let name_part = tail.strip_prefix(' ').unwrap_or_else(|| tail.trim_start());
    if name_part.is_empty() {
        return None;
    }

    let (clean_name, symlink_target) = if first == 'l' {
        if let Some((n, target)) = name_part.split_once(" -> ") {
            (n.trim_end(), Some(target))
        } else {
            (name_part, None)
        }
    } else {
        (name_part, None)
    };

    Some(ParsedLsRow {
        kind_char: first,
        perms,
        links,
        owner,
        group,
        size,
        modified_time,
        name: clean_name,
        symlink_target,
    })
}

/// 解析 POSIX `ls -lA` 输出为 `Vec<FileEntry>`（兼顾 GNU `--time-style=long-iso` 与 BusyBox/macOS 格式）
pub fn parse_ls_output(dir_path: &str, stdout: &str) -> Vec<FileEntry> {
    let base = dir_path.trim_end_matches('/');
    let mut entries = Vec::new();

    for raw_line in stdout.lines() {
        let Some(row) = parse_ls_row(raw_line) else {
            continue;
        };
        if row.name == "." || row.name == ".." || row.name.is_empty() {
            continue;
        }

        let full_path = if base.is_empty() {
            format!("/{}", row.name)
        } else {
            format!("{}/{}", base, row.name)
        };

        entries.push(FileEntry {
            name: row.name.to_string(),
            path: full_path,
            is_directory: row.kind_char == 'd',
            is_symlink: row.kind_char == 'l',
            size: row.size.min(i64::MAX as u64) as i64,
            modified_time: row.modified_time,
            permissions: row.perms.to_string(),
            owner: row.owner.to_string(),
            group: row.group.to_string(),
            uid: None,
            gid: None,
        });
    }

    entries
}

/// 通过 `scp -t` 上传本地文件到远端指定路径（先写临时兄弟文件 `.qshell_tmp_<uuid>`，再原子 `mv -f`）
pub async fn scp_upload_file<F>(
    server_id: &str,
    local_path: &str,
    remote_path: &str,
    mut on_progress: F,
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<(), String>
where
    F: FnMut(u64, u64),
{
    if crate::files::remote::is_dangerous_root_path(remote_path) {
        return Err(format!("Refused to upload to dangerous root path: {}", remote_path));
    }
    let meta = tokio::fs::metadata(local_path)
        .await
        .map_err(|e| format!("Failed to read local file '{}': {}", local_path, e))?;
    let total_size = meta.len();

    let tmp_remote_path = make_scp_tmp_path(remote_path);
    let tmp_file_name = sanitize_scp_header_name(
        StdPath::new(&tmp_remote_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(".qshell_tmp"),
    );

    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let channel = conn
        .create_shell_channel()
        .await
        .map_err(|e| e.to_string())?;

    let cmd = format!("scp -t -- {}", escape_shell_arg(tmp_remote_path.clone()));
    channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("Failed to execute remote scp -t: {}", e))?;

    let mut io = ScpChannelIo::new_with_cancel(channel, cancel.cloned());
    let upload_res: Result<(), String> = async {
        io.read_ack().await?;

        let header = format!("C0644 {} {}\n", total_size, tmp_file_name);
        io.write_all(header.as_bytes()).await?;
        io.read_ack().await?;

        let mut file = tokio::fs::File::open(local_path)
            .await
            .map_err(|e| format!("Failed to open local file: {}", e))?;
        let mut buf = vec![0u8; SCP_CHUNK_SIZE];
        let mut sent = 0u64;
        let mut last_emit = tokio::time::Instant::now();
        let throttle = Duration::from_millis(PROGRESS_THROTTLE_MS);
        let mut emitted_final = false;

        loop {
            if let Some(flag) = cancel {
                if flag.load(Ordering::Relaxed) {
                    io.close_gracefully().await;
                    return Err("Transfer canceled by user".to_string());
                }
            }
            let n = tokio::select! {
                biased;
                _ = crate::ssh::manager::sleep_until_cancel(cancel) => {
                    io.close_gracefully().await;
                    return Err("Transfer canceled by user".to_string());
                }
                res = tokio::time::timeout(
                    Duration::from_secs(SCP_TIMEOUT_SECS),
                    tokio::io::AsyncReadExt::read(&mut file, &mut buf),
                ) => {
                    res.map_err(|_| "Local file read timed out".to_string())?
                        .map_err(|e| format!("Failed to read local file: {}", e))?
                }
            };
            if n == 0 {
                break;
            }
            crate::ssh::rate_limiter::GLOBAL_RATE_LIMITER
                .acquire(n as u64)
                .await;
            io.write_all(&buf[..n]).await?;
            sent += n as u64;
            if sent == total_size || last_emit.elapsed() >= throttle {
                on_progress(sent, total_size);
                last_emit = tokio::time::Instant::now();
                if sent == total_size {
                    emitted_final = true;
                }
            }
        }

        if !emitted_final {
            on_progress(sent, total_size);
        }

        io.send_ack().await?;
        io.read_ack().await?;
        io.close_gracefully().await;
        Ok(())
    }
    .await;

    if let Err(e) = upload_res {
        io.close_gracefully().await;
        cleanup_remote_tmp(server_id, &tmp_remote_path).await;
        return Err(e);
    }

    let mv_cmd = format!(
        "mv -f -- {} {}",
        escape_shell_arg(tmp_remote_path.clone()),
        escape_shell_arg(remote_path.to_string())
    );
    let mv_res = ssh_execute_command(server_id, &mv_cmd).await;
    if mv_res.exit_code != 0 {
        cleanup_remote_tmp(server_id, &tmp_remote_path).await;
        let detail = mv_res.stderr.trim();
        return Err(if detail.is_empty() {
            format!("Failed to finalize uploaded file '{}'", remote_path)
        } else {
            detail.to_string()
        });
    }
    Ok(())
}

/// 通过 `scp -t` 直接写入内存字节到远端文件（先写临时兄弟文件 `.qshell_tmp_<uuid>`，再原子 `mv -f`）
pub async fn scp_write_bytes(server_id: &str, remote_path: &str, bytes: &[u8]) -> Result<(), String> {
    if crate::files::remote::is_dangerous_root_path(remote_path) {
        return Err(format!("Refused to write to dangerous root path: {}", remote_path));
    }
    let tmp_remote_path = make_scp_tmp_path(remote_path);
    let tmp_file_name = sanitize_scp_header_name(
        StdPath::new(&tmp_remote_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(".qshell_tmp"),
    );

    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let channel = conn
        .create_shell_channel()
        .await
        .map_err(|e| e.to_string())?;

    let cmd = format!("scp -t -- {}", escape_shell_arg(tmp_remote_path.clone()));
    channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("Failed to execute remote scp -t: {}", e))?;

    let mut io = ScpChannelIo::new(channel);
    let write_res: Result<(), String> = async {
        io.read_ack().await?;

        let header = format!("C0644 {} {}\n", bytes.len(), tmp_file_name);
        io.write_all(header.as_bytes()).await?;
        io.read_ack().await?;

        for chunk in bytes.chunks(SCP_CHUNK_SIZE) {
            io.write_all(chunk).await?;
        }
        io.send_ack().await?;
        io.read_ack().await?;
        io.close_gracefully().await;
        Ok(())
    }
    .await;

    if let Err(e) = write_res {
        io.close_gracefully().await;
        cleanup_remote_tmp(server_id, &tmp_remote_path).await;
        return Err(e);
    }

    let mv_cmd = format!(
        "mv -f -- {} {}",
        escape_shell_arg(tmp_remote_path.clone()),
        escape_shell_arg(remote_path.to_string())
    );
    let mv_res = ssh_execute_command(server_id, &mv_cmd).await;
    if mv_res.exit_code != 0 {
        cleanup_remote_tmp(server_id, &tmp_remote_path).await;
        let detail = mv_res.stderr.trim();
        return Err(if detail.is_empty() {
            format!("Failed to finalize written file '{}'", remote_path)
        } else {
            detail.to_string()
        });
    }
    Ok(())
}

/// 通过 `scp -f` 下载远端单文件到本地（经由原子临时文件写入后重命名）
pub async fn scp_download_file<F>(
    server_id: &str,
    remote_path: &str,
    local_path: &str,
    tmp_local_path: &str,
    mut on_progress: F,
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<(), String>
where
    F: FnMut(u64, u64),
{
    if let Some(parent) = StdPath::new(local_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create local directory: {}", e))?;
    }

    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let channel = conn
        .create_shell_channel()
        .await
        .map_err(|e| e.to_string())?;

    let cmd = format!("scp -f -- {}", escape_shell_arg(remote_path.to_string()));
    channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("Failed to execute remote scp -f: {}", e))?;

    let mut io = ScpChannelIo::new_with_cancel(channel, cancel.cloned());
    let transfer_res: Result<(), String> = async {
        io.send_ack().await?;

        let total_size = loop {
            if let Some(flag) = cancel {
                if flag.load(Ordering::Relaxed) {
                    return Err("Transfer canceled by user".to_string());
                }
            }
            let first = io.read_byte().await?;
            match first {
                1 | 2 => {
                    let msg = io.read_line_trimmed().await.unwrap_or_default();
                    return Err(if msg.is_empty() {
                        format!("SCP download error (code {})", first)
                    } else {
                        msg
                    });
                }
                b'T' => {
                    let _ = io.read_line_trimmed().await?;
                    io.send_ack().await?;
                }
                b'C' => {
                    let rest = io.read_line_trimmed().await?;
                    let full_line = format!("C{}", rest);
                    let (_, size, _) = parse_scp_header(&full_line)?;
                    break size;
                }
                other => {
                    return Err(format!("Unexpected SCP download header byte: {}", other));
                }
            }
        };

        io.send_ack().await?;

        let mut tmp_file = tokio::fs::File::create(tmp_local_path)
            .await
            .map_err(|e| format!("Failed to create local temp file: {}", e))?;

        let mut remaining = total_size;
        let mut received = 0u64;
        let mut last_emit = tokio::time::Instant::now();
        let throttle = Duration::from_millis(PROGRESS_THROTTLE_MS);
        let mut emitted_final = false;

        while remaining > 0 {
            if let Some(flag) = cancel {
                if flag.load(Ordering::Relaxed) {
                    return Err("Transfer canceled by user".to_string());
                }
            }
            if io.buf.is_empty() && !io.fill().await? {
                return Err("Unexpected EOF during SCP file transfer".to_string());
            }
            let take = (remaining as usize).min(io.buf.len());
            let chunk: Vec<u8> = io.buf.drain(..take).collect();
            crate::ssh::rate_limiter::GLOBAL_RATE_LIMITER
                .acquire(take as u64)
                .await;
            tokio::select! {
                biased;
                _ = crate::ssh::manager::sleep_until_cancel(cancel) => {
                    return Err("Transfer canceled by user".to_string());
                }
                res = tokio::time::timeout(
                    Duration::from_secs(SCP_TIMEOUT_SECS),
                    tmp_file.write_all(&chunk),
                ) => {
                    res.map_err(|_| "Local file write timed out".to_string())?
                        .map_err(|e| format!("Failed to write local temp file: {}", e))?;
                }
            }
            remaining -= take as u64;
            received += take as u64;
            if received == total_size || last_emit.elapsed() >= throttle {
                on_progress(received, total_size);
                last_emit = tokio::time::Instant::now();
                if received == total_size {
                    emitted_final = true;
                }
            }
        }

        if !emitted_final {
            on_progress(received, total_size);
        }

        tmp_file
            .flush()
            .await
            .map_err(|e| format!("Failed to flush local temp file: {}", e))?;
        drop(tmp_file);

        io.read_ack().await?;
        io.send_ack().await?;
        io.close_gracefully().await;

        tokio::fs::rename(tmp_local_path, local_path)
            .await
            .map_err(|e| format!("Failed to move downloaded file: {}", e))?;
        Ok(())
    }
    .await;

    if let Err(e) = transfer_res {
        io.close_gracefully().await;
        let _ = tokio::fs::remove_file(tmp_local_path).await;
        return Err(e);
    }
    Ok(())
}

/// 通过 `scp -f` 读取远程文件前 `prefix_bytes` 字节（用于大归档魔数校验等场景，不限制总文件大小）
pub async fn scp_read_prefix_bytes(
    server_id: &str,
    remote_path: &str,
    prefix_bytes: usize,
) -> Result<Vec<u8>, String> {
    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let channel = conn
        .create_shell_channel()
        .await
        .map_err(|e| e.to_string())?;

    let cmd = format!("scp -f -- {}", escape_shell_arg(remote_path.to_string()));
    channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("Failed to execute remote scp -f: {}", e))?;

    let mut io = ScpChannelIo::new(channel);
    io.send_ack().await?;

    let total_size = loop {
        let first = io.read_byte().await?;
        match first {
            1 | 2 => {
                let msg = io.read_line_trimmed().await.unwrap_or_default();
                io.close_gracefully().await;
                return Err(if msg.is_empty() {
                    format!("SCP read error (code {})", first)
                } else {
                    msg
                });
            }
            b'T' => {
                let _ = io.read_line_trimmed().await?;
                io.send_ack().await?;
            }
            b'C' => {
                let rest = io.read_line_trimmed().await?;
                let (_, size, _) = parse_scp_header(&format!("C{}", rest))?;
                break size;
            }
            other => {
                io.close_gracefully().await;
                return Err(format!("Unexpected SCP byte: {}", other));
            }
        }
    };

    io.send_ack().await?;
    let target = (total_size as usize).min(prefix_bytes);
    let mut out = Vec::with_capacity(target);
    while out.len() < target {
        if io.buf.is_empty() && !io.fill().await? {
            break;
        }
        let take = (target - out.len()).min(io.buf.len());
        out.extend(io.buf.drain(..take));
    }
    io.close_gracefully().await;
    Ok(out)
}

/// 通过 `scp -f` 读取远程文件字节（带上限保护，用于文本/图片预览）
pub async fn scp_read_bytes(
    server_id: &str,
    remote_path: &str,
    max_bytes: u64,
) -> Result<Vec<u8>, String> {
    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let channel = conn
        .create_shell_channel()
        .await
        .map_err(|e| e.to_string())?;

    let cmd = format!("scp -f -- {}", escape_shell_arg(remote_path.to_string()));
    channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("Failed to execute remote scp -f: {}", e))?;

    let mut io = ScpChannelIo::new(channel);
    let read_res: Result<Vec<u8>, String> = async {
        io.send_ack().await?;

        let total_size = loop {
            let first = io.read_byte().await?;
            match first {
                1 | 2 => {
                    let msg = io.read_line_trimmed().await.unwrap_or_default();
                    return Err(if msg.is_empty() {
                        format!("SCP read error (code {})", first)
                    } else {
                        msg
                    });
                }
                b'T' => {
                    let _ = io.read_line_trimmed().await?;
                    io.send_ack().await?;
                }
                b'C' => {
                    let rest = io.read_line_trimmed().await?;
                    let (_, size, _) = parse_scp_header(&format!("C{}", rest))?;
                    if size > max_bytes {
                        return Err(format!(
                            "File exceeds preview limit ({} bytes > {} max)",
                            size, max_bytes
                        ));
                    }
                    break size;
                }
                other => return Err(format!("Unexpected SCP byte: {}", other)),
            }
        };

        io.send_ack().await?;
        let mut out = Vec::with_capacity(total_size as usize);
        while (out.len() as u64) < total_size {
            if io.buf.is_empty() && !io.fill().await? {
                return Err("Unexpected EOF reading SCP payload".to_string());
            }
            let take = ((total_size as usize) - out.len()).min(io.buf.len());
            out.extend(io.buf.drain(..take));
        }
        io.read_ack().await?;
        io.send_ack().await?;
        Ok(out)
    }
    .await;
    io.close_gracefully().await;
    read_res
}

fn build_scp_read_range_cmd(remote_path: &str, offset: u64, to_read: u64) -> String {
    let escaped = escape_shell_arg(remote_path.to_string());
    let start_1based = offset.saturating_add(1);
    format!("tail -c +{} {} | head -c {}", start_1based, escaped, to_read)
}

fn check_range_read_error(
    out: &[u8],
    stderr: &[u8],
    exit_code: Option<u32>,
) -> Result<(), String> {
    let err_msg = String::from_utf8_lossy(stderr).trim().to_string();
    if exit_code.is_some_and(|c| c != 0) && !err_msg.is_empty() {
        return Err(err_msg);
    }
    if out.is_empty() {
        if !err_msg.is_empty() {
            return Err(err_msg);
        }
        if let Some(code) = exit_code.filter(|&c| c != 0) {
            return Err(format!("Remote range read failed with exit code {}", code));
        }
    }
    Ok(())
}

/// 通过 SSH exec 分块读取远程文件指定字节区间（单次上限 4MB，二进制安全）
pub async fn scp_read_range(
    server_id: &str,
    remote_path: &str,
    offset: u64,
    len: u64,
) -> Result<crate::files::remote_fs::FileChunkResult, String> {
    use base64::Engine as _;

    let (is_dir, total_size) = scp_stat_basic(server_id, remote_path).await?;
    if is_dir {
        return Err("Remote path is a directory".to_string());
    }

    let bounded_len = len.min(crate::files::remote_fs::MAX_READ_CHUNK_BYTES);
    if offset >= total_size || bounded_len == 0 {
        return Ok(crate::files::remote_fs::FileChunkResult {
            data_base64: String::new(),
            offset,
            bytes_read: 0,
            total_size,
            eof: offset >= total_size,
        });
    }

    let to_read = bounded_len.min(total_size - offset);
    let cmd = build_scp_read_range_cmd(remote_path, offset, to_read);

    let conn = SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let mut channel = conn
        .create_shell_channel()
        .await
        .map_err(|e| e.to_string())?;
    channel
        .exec(true, cmd)
        .await
        .map_err(|e| format!("Failed to execute remote range read: {}", e))?;

    let mut out = Vec::with_capacity(to_read as usize);
    let mut stderr = Vec::new();
    let mut exit_code: Option<u32> = None;

    loop {
        let msg = tokio::time::timeout(Duration::from_secs(SCP_TIMEOUT_SECS), channel.wait())
            .await
            .map_err(|_| "SCP range read timed out".to_string())?;

        match msg {
            Some(ChannelMsg::Data { data }) => {
                if out.len() < to_read as usize {
                    let remaining = (to_read as usize) - out.len();
                    let take = data.len().min(remaining);
                    out.extend_from_slice(&data[..take]);
                }
                if out.len() >= to_read as usize {
                    break;
                }
            }
            Some(ChannelMsg::ExtendedData { data, ext: 1 }) => {
                if stderr.len() < MAX_SCP_STDERR_BYTES {
                    let remaining = MAX_SCP_STDERR_BYTES - stderr.len();
                    let take = remaining.min(data.len());
                    stderr.extend_from_slice(&data[..take]);
                }
            }
            Some(ChannelMsg::ExitStatus { exit_status }) => {
                exit_code = Some(exit_status);
            }
            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
            _ => {}
        }
    }
    let _ = channel.close().await;

    check_range_read_error(&out, &stderr, exit_code)?;

    let bytes_read = out.len() as u64;
    let eof = offset.saturating_add(bytes_read) >= total_size || bytes_read < to_read;

    Ok(crate::files::remote_fs::FileChunkResult {
        data_base64: base64::engine::general_purpose::STANDARD.encode(&out),
        offset,
        bytes_read,
        total_size,
        eof,
    })
}

/// 纯 SSH exec 目录列表（不依赖 SFTP 子系统）
/// 末尾追加 `/` 使软链目录参数能正确解析出目标目录内容，同时保留子项自身的符号链接标识
pub async fn scp_list_dir(server_id: &str, dir_path: &str) -> Result<Vec<FileEntry>, String> {
    let trimmed = dir_path.trim_end_matches('/');
    let list_target = if trimmed.is_empty() {
        "/".to_string()
    } else {
        format!("{}/", trimmed)
    };
    let escaped = escape_shell_arg(list_target);
    let cmd = format!(
        "LC_ALL=C ls -lA --time-style=long-iso {0} 2>/dev/null || LC_ALL=C ls -lA {0}",
        escaped
    );
    let res = ssh_execute_command(server_id, &cmd).await;
    if res.exit_code != 0 {
        return Err(if res.stderr.trim().is_empty() {
            format!("Failed to list directory '{}'", dir_path)
        } else {
            res.stderr.trim().to_string()
        });
    }
    Ok(parse_ls_output(dir_path, &res.stdout))
}

pub async fn scp_stat_basic(server_id: &str, path: &str) -> Result<(bool, u64), String> {
    let escaped = escape_shell_arg(path.to_string());
    let cmd = format!(
        "if [ -d {0} ]; then echo 'DIR 0'; elif [ -e {0} ]; then sz=$(stat -L -c '%s' -- {0} 2>/dev/null || stat -L -f '%z' -- {0} 2>/dev/null || wc -c < {0}); echo \"FILE $sz\"; else exit 1; fi",
        escaped
    );
    let res = ssh_execute_command(server_id, &cmd).await;
    if res.exit_code != 0 {
        return Err(format!("Remote path not found: {}", path));
    }
    let trimmed = res.stdout.trim();
    if trimmed.starts_with("DIR") {
        Ok((true, 0))
    } else {
        let size = trimmed
            .strip_prefix("FILE ")
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(0);
        Ok((false, size))
    }
}

fn format_epoch_timestamp(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Ok(ts) = trimmed.parse::<i64>() {
        if let Some(dt) = chrono::DateTime::from_timestamp(ts, 0) {
            let local_dt = chrono::DateTime::<chrono::Local>::from(dt);
            return local_dt.format("%Y-%m-%d %H:%M:%S").to_string();
        }
    }
    trimmed.to_string()
}

fn normalize_stat_file_type(raw: &str) -> String {
    let lower = raw.trim().to_ascii_lowercase();
    if lower.contains("directory") {
        "directory".to_string()
    } else if lower.contains("symbolic link") || lower.contains("symlink") {
        "symbolic link".to_string()
    } else if lower.contains("regular") {
        "regular file".to_string()
    } else if lower.is_empty() {
        "regular file".to_string()
    } else {
        lower
    }
}

fn normalize_octal_mode(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Ok(val) = u32::from_str_radix(trimmed, 8) {
        let masked = val & 0o7777;
        if masked > 0o777 {
            format!("{:o}", masked)
        } else {
            format!("{:03o}", masked)
        }
    } else if trimmed.is_empty() {
        "---".to_string()
    } else {
        trimmed.to_string()
    }
}

fn ls_perms_to_octal(perms: &str) -> String {
    let chars: Vec<char> = perms.chars().collect();
    if chars.len() < 10 {
        return "---".to_string();
    }
    let mut mode: u32 = 0;
    if chars[1] == 'r' { mode |= 0o400; }
    if chars[2] == 'w' { mode |= 0o200; }
    match chars[3] {
        'x' => mode |= 0o100,
        's' => mode |= 0o4100,
        'S' => mode |= 0o4000,
        _ => {}
    }
    if chars[4] == 'r' { mode |= 0o040; }
    if chars[5] == 'w' { mode |= 0o020; }
    match chars[6] {
        'x' => mode |= 0o010,
        's' => mode |= 0o2010,
        'S' => mode |= 0o2000,
        _ => {}
    }
    if chars[7] == 'r' { mode |= 0o004; }
    if chars[8] == 'w' { mode |= 0o002; }
    match chars[9] {
        'x' => mode |= 0o001,
        't' => mode |= 0o1001,
        'T' => mode |= 0o1000,
        _ => {}
    }
    if mode > 0o777 {
        format!("{:o}", mode)
    } else {
        format!("{:03o}", mode)
    }
}

/// 解析 `scp_stat_info` 远程命令输出为符合 `FileStatInfo` 的 JSON 字符串
pub fn parse_scp_stat_output(stdout: &str) -> Result<String, String> {
    let mut stat_line: Option<&str> = None;
    let mut ls_line: Option<&str> = None;
    let mut link_target: Option<String> = None;

    for raw in stdout.lines() {
        let line = raw.trim_end_matches('\r');
        if let Some(rest) = line.strip_prefix("STAT:") {
            stat_line = Some(rest.trim());
        } else if let Some(rest) = line.strip_prefix("LS:") {
            ls_line = Some(rest.trim_end());
        } else if let Some(rest) = line.strip_prefix("LINK:") {
            let trimmed = rest.trim();
            if !trimmed.is_empty() {
                link_target = Some(trimmed.to_string());
            }
        }
    }

    if let Some(sline) = stat_line {
        let parts: Vec<&str> = sline.split('|').collect();
        if parts.len() >= 6 {
            let size = parts[0].trim().parse::<u64>().unwrap_or(0);
            let file_type = normalize_stat_file_type(parts[1]);
            let mode = normalize_octal_mode(parts[2]);
            let owner = parts[3].trim().to_string();
            let group = parts[4].trim().to_string();
            let modified_time = format_epoch_timestamp(parts[5]);
            let access_time = parts
                .get(6)
                .map(|s| format_epoch_timestamp(s))
                .unwrap_or_default();
            let inode = parts
                .get(7)
                .and_then(|s| s.trim().parse::<u64>().ok())
                .unwrap_or(0);
            let links = parts
                .get(8)
                .and_then(|s| s.trim().parse::<u64>().ok())
                .unwrap_or(1);
            let is_symlink = file_type == "symbolic link" || link_target.is_some();
            let symlink_target = if is_symlink { link_target } else { None };

            let json = serde_json::json!({
                "type": file_type,
                "size": size,
                "mode": mode,
                "owner": owner,
                "group": group,
                "modifiedTime": modified_time,
                "accessTime": access_time,
                "inode": inode,
                "links": links,
                "isSymlink": is_symlink,
                "symlinkTarget": symlink_target,
                "backend": "scp"
            });
            return serde_json::to_string(&json).map_err(|e| format!("Serialize error: {}", e));
        }
    }

    if let Some(lline) = ls_line {
        if let Some(row) = parse_ls_row(lline) {
            let file_type = match row.kind_char {
                'd' => "directory",
                'l' => "symbolic link",
                '-' => "regular file",
                'b' => "block special file",
                'c' => "character special file",
                'p' => "fifo",
                's' => "socket",
                _ => "regular file",
            }
            .to_string();
            let is_symlink = row.kind_char == 'l' || link_target.is_some();
            let symlink_target = if is_symlink {
                link_target.or_else(|| row.symlink_target.map(|s| s.to_string()))
            } else {
                None
            };
            let json = serde_json::json!({
                "type": file_type,
                "size": row.size,
                "mode": ls_perms_to_octal(row.perms),
                "owner": row.owner,
                "group": row.group,
                "modifiedTime": row.modified_time,
                "accessTime": "",
                "inode": 0,
                "links": row.links,
                "isSymlink": is_symlink,
                "symlinkTarget": symlink_target,
                "backend": "scp"
            });
            return serde_json::to_string(&json).map_err(|e| format!("Serialize error: {}", e));
        }
    }

    Err("Failed to parse remote file stat output".to_string())
}

pub async fn scp_stat_info(server_id: &str, path: &str) -> Result<String, String> {
    let escaped = escape_shell_arg(path.to_string());
    // 先尝试 GNU stat，再尝试 macOS/BSD stat，最后回退到跨平台 ls -ld；
    // 若为符号链接则附加 readlink 获取目标路径
    let cmd = format!(
        "P={0}; \
         if out=$(stat -c '%s|%F|%a|%U|%G|%Y|%X|%i|%h' -- \"$P\" 2>/dev/null); then \
           printf 'STAT:%s\\n' \"$out\"; \
         elif out=$(stat -f '%z|%HT|%OLp|%Su|%Sg|%m|%a|%i|%l' -- \"$P\" 2>/dev/null); then \
           printf 'STAT:%s\\n' \"$out\"; \
         else \
           ls_out=$(LC_ALL=C ls -ld --time-style=long-iso -- \"$P\" 2>/dev/null || LC_ALL=C ls -ld -- \"$P\") || exit $?; \
           printf 'LS:%s\\n' \"$ls_out\"; \
         fi; \
         if [ -L \"$P\" ]; then \
           printf 'LINK:'; \
           readlink -- \"$P\" 2>/dev/null || true; \
           printf '\\n'; \
         fi",
        escaped
    );
    let res = ssh_execute_command(server_id, &cmd).await;
    if res.exit_code != 0 {
        let err = res.stderr.trim();
        return Err(if err.is_empty() {
            format!("Failed to stat '{}'", path)
        } else {
            err.to_string()
        });
    }
    parse_scp_stat_output(&res.stdout)
}

pub async fn scp_get_permissions(server_id: &str, path: &str) -> Result<String, String> {
    let json_str = scp_stat_info(server_id, path).await?;
    let val: serde_json::Value =
        serde_json::from_str(&json_str).map_err(|e| format!("Failed to parse stat info: {}", e))?;
    let mode = val.get("mode").and_then(|v| v.as_str()).unwrap_or("---");
    let owner = val.get("owner").and_then(|v| v.as_str()).unwrap_or("");
    let group = val.get("group").and_then(|v| v.as_str()).unwrap_or("");
    Ok(format!("{} {} {}", mode, owner, group))
}

pub async fn scp_create_symlink(
    server_id: &str,
    target: &str,
    link_path: &str,
) -> Result<CommandResult, String> {
    if crate::files::remote::is_dangerous_root_path(link_path) {
        return Ok(CommandResult::err("Refusing to create symlink at dangerous root path".to_string()));
    }
    let res = ssh_execute_command(
        server_id,
        &format!(
            "ln -s -- {} {}",
            escape_shell_arg(target.to_string()),
            escape_shell_arg(link_path.to_string())
        ),
    )
    .await;
    Ok(if res.exit_code == 0 {
        CommandResult::ok(String::new())
    } else {
        CommandResult::err(res.stderr.trim().to_string())
    })
}

pub async fn scp_mkdir(server_id: &str, path: &str) -> Result<CommandResult, String> {
    if crate::files::remote::is_dangerous_root_path(path) {
        return Ok(CommandResult::err("Refusing to create directory at dangerous root path".to_string()));
    }
    let res = ssh_execute_command(server_id, &format!("mkdir -p -- {}", escape_shell_arg(path.to_string()))).await;
    Ok(if res.exit_code == 0 {
        CommandResult::ok("Directory created")
    } else {
        CommandResult::err(res.stderr.trim().to_string())
    })
}

pub async fn scp_delete(server_id: &str, path: &str) -> Result<CommandResult, String> {
    if crate::files::remote::is_dangerous_root_path(path) {
        return Ok(CommandResult::err("Refusing to delete dangerous root path".to_string()));
    }
    let res = ssh_execute_command(server_id, &format!("rm -rf -- {}", escape_shell_arg(path.to_string()))).await;
    Ok(if res.exit_code == 0 {
        CommandResult::ok("Deleted")
    } else {
        CommandResult::err(res.stderr.trim().to_string())
    })
}

pub async fn scp_rename(server_id: &str, old_path: &str, new_path: &str) -> Result<CommandResult, String> {
    if crate::files::remote::is_dangerous_root_path(old_path)
        || crate::files::remote::is_dangerous_root_path(new_path)
    {
        return Ok(CommandResult::err("Refusing to rename to/from dangerous root path".to_string()));
    }
    let res = ssh_execute_command(
        server_id,
        &format!(
            "mv -- {} {}",
            escape_shell_arg(old_path.to_string()),
            escape_shell_arg(new_path.to_string())
        ),
    )
    .await;
    Ok(if res.exit_code == 0 {
        CommandResult::ok("Renamed")
    } else {
        CommandResult::err(res.stderr.trim().to_string())
    })
}

pub async fn scp_set_permissions(server_id: &str, path: &str, mode: &str, recursive: bool) -> Result<CommandResult, String> {
    let validation = crate::validators::validate_permission_mode(mode.to_string());
    if !validation.valid {
        return Ok(CommandResult::err(
            validation.error.unwrap_or_else(|| "Invalid permission mode".to_string()),
        ));
    }
    let flag = if recursive { "-R " } else { "" };
    let res = ssh_execute_command(
        server_id,
        &format!("chmod {}-- {} {}", flag, escape_shell_arg(mode.to_string()), escape_shell_arg(path.to_string())),
    )
    .await;
    Ok(if res.exit_code == 0 {
        CommandResult::ok("Permissions updated")
    } else {
        CommandResult::err(res.stderr.trim().to_string())
    })
}

pub async fn scp_backup(server_id: &str, path: &str) -> Result<CommandResult, String> {
    let now = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
    let bak = format!("{}.bak.{}", path, now);
    let res = ssh_execute_command(
        server_id,
        &format!("cp -a -- {} {}", escape_shell_arg(path.to_string()), escape_shell_arg(bak.clone())),
    )
    .await;
    Ok(if res.exit_code == 0 {
        CommandResult::ok(bak)
    } else {
        CommandResult::err(res.stderr.trim().to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_scp_file_header() {
        let (mode, size, name) = parse_scp_header("C0644 4096 hello world.tar.gz").unwrap();
        assert_eq!(mode, "0644");
        assert_eq!(size, 4096);
        assert_eq!(name, "hello world.tar.gz");
        assert!(parse_scp_header("D0755 0 dir").is_err());
    }

    #[test]
    fn sanitizes_header_name_and_builds_sibling_tmp_path() {
        assert_eq!(sanitize_scp_header_name("foo\r\nbar/baz\0.txt"), "foo__bar_baz_.txt");
        let tmp = make_scp_tmp_path("/var/log/app.log");
        assert!(tmp.starts_with("/var/log/.qshell_tmp_"));
        let root_tmp = make_scp_tmp_path("/app.log");
        assert!(root_tmp.starts_with("/.qshell_tmp_"));
    }

    #[test]
    fn parses_posix_and_long_iso_ls_output() {
        let sample = "\
total 24
drwxr-xr-x 2 root root 4096 2026-11-15 10:20 sub dir
-rw-r--r-- 1 app  app   512 2026-11-15 10:21 config.yaml
lrwxrwxrwx 1 root root   11 Nov 15 10:22 current -> sub dir
";
        let entries = parse_ls_output("/opt/app", sample);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].name, "sub dir");
        assert!(entries[0].is_directory);
        assert_eq!(entries[0].path, "/opt/app/sub dir");
        assert_eq!(entries[1].size, 512);
        assert_eq!(entries[2].name, "current");
        assert!(entries[2].is_symlink);
    }

    #[test]
    fn parses_device_rows_and_time_colliding_filenames() {
        let sample = "\
brw-rw---- 1 root disk 8,   0 2026-11-15 10:20 sda
crw-rw-rw- 1 root tty  5,   0 Nov 15 10:20 tty
-rw-r--r-- 1 root root 10:21 2026-11-15 10:21 10:21.log
-rw-r--r-- 1 10:21 root  128 2026-11-15 10:21 report.txt
";
        let entries = parse_ls_output("/dev", sample);
        assert_eq!(entries.len(), 4);
        assert_eq!(entries[0].name, "sda");
        assert_eq!(entries[0].size, 0);
        assert_eq!(entries[0].modified_time, "2026-11-15 10:20");
        assert_eq!(entries[1].name, "tty");
        assert_eq!(entries[1].modified_time, "Nov 15 10:20");
        assert_eq!(entries[2].name, "10:21.log");
        assert_eq!(entries[3].name, "report.txt");
    }

    #[test]
    fn parses_gnu_bsd_and_ls_stat_outputs_to_file_stat_info_schema() {
        let gnu_out = "STAT:4096|directory|755|root|root|1700000000|1700000100|12345|4\n";
        let gnu_val: serde_json::Value =
            serde_json::from_str(&parse_scp_stat_output(gnu_out).unwrap()).unwrap();
        assert_eq!(gnu_val["type"], "directory");
        assert_eq!(gnu_val["size"], 4096);
        assert_eq!(gnu_val["mode"], "755");
        assert_eq!(gnu_val["owner"], "root");
        assert_eq!(gnu_val["group"], "root");
        assert_eq!(gnu_val["inode"], 12345);
        assert_eq!(gnu_val["links"], 4);
        assert_eq!(gnu_val["isSymlink"], false);
        assert!(gnu_val["symlinkTarget"].is_null());
        assert_eq!(gnu_val["backend"], "scp");

        let bsd_out = "STAT:18|Symbolic Link|0777|alice|staff|1700000000|1700000050|99|1\nLINK:/opt/target\n";
        let bsd_val: serde_json::Value =
            serde_json::from_str(&parse_scp_stat_output(bsd_out).unwrap()).unwrap();
        assert_eq!(bsd_val["type"], "symbolic link");
        assert_eq!(bsd_val["size"], 18);
        assert_eq!(bsd_val["mode"], "777");
        assert_eq!(bsd_val["isSymlink"], true);
        assert_eq!(bsd_val["symlinkTarget"], "/opt/target");
        assert_eq!(bsd_val["backend"], "scp");

        let ls_out = "LS:lrwxr-xr-x 1 root wheel 12 Nov 15 10:22 /usr/local/bin/app -> /opt/app\nLINK:/opt/app\n";
        let ls_val: serde_json::Value =
            serde_json::from_str(&parse_scp_stat_output(ls_out).unwrap()).unwrap();
        assert_eq!(ls_val["type"], "symbolic link");
        assert_eq!(ls_val["size"], 12);
        assert_eq!(ls_val["mode"], "755");
        assert_eq!(ls_val["owner"], "root");
        assert_eq!(ls_val["group"], "wheel");
        assert_eq!(ls_val["links"], 1);
        assert_eq!(ls_val["isSymlink"], true);
        assert_eq!(ls_val["symlinkTarget"], "/opt/app");
        assert_eq!(ls_val["backend"], "scp");
    }

    #[test]
    fn read_range_cmd_preserves_stderr_and_surfaces_tail_errors() {
        let cmd = build_scp_read_range_cmd("/var/log/app.log", 128, 4096);
        assert!(!cmd.contains("2>/dev/null"));
        assert!(cmd.starts_with("tail -c +129 "));
        assert!(cmd.ends_with(" | head -c 4096"));

        let err_nonzero = check_range_read_error(
            &[],
            b"tail: cannot open '/var/log/app.log': Permission denied\n",
            Some(1),
        )
        .unwrap_err();
        assert!(err_nonzero.contains("Permission denied"));

        let err_pipe_zero = check_range_read_error(
            &[],
            b"tail: invalid option -- 'c'\n",
            Some(0),
        )
        .unwrap_err();
        assert!(err_pipe_zero.contains("invalid option"));

        let err_empty_stderr = check_range_read_error(&[], b"", Some(2)).unwrap_err();
        assert!(err_empty_stderr.contains("exit code 2"));

        assert!(check_range_read_error(b"hello", b"", Some(0)).is_ok());
        assert!(check_range_read_error(&[], b"", Some(0)).is_ok());
    }
}
