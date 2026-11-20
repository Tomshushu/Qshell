//! RemoteFs 统一远程文件系统抽象与协议自动解析引擎 (Slice 2C)
//!
//! 收敛分散在 `commands/files.rs` 各命令入口中的 FTP/FTPS/SFTP/SCP 协议分派逻辑：
//! - 显式支持 `'ftp'` | `'ftps'` | `'scp'` | `'sftp'` | `'auto'`
//! - 对 `'sftp'` / `'auto'`（Linux/macOS 目标）：若首次 SFTP 握手失败（如 OpenSSH 禁用 sftp-server 或精简镜像），
//!   自动降级为 `ScpBackend` 并按 `server_id` 连接生命周期缓存结果，避免每次列表/上传重复超时。

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::RwLock;

use serde::Serialize;

use crate::commands::CommandResult;
use crate::ftp::{self, ResolvedFtpConfig};
use crate::parsers::FileEntry;
use crate::ssh::manager::SshManager;

use super::scp;

/// 远程文件系统能力描述（供前端 StatusBar 与 FilesPanel 渲染真实传输后端徽章与操作可用性）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFsCapabilities {
    /// "sftp" | "scp" | "ftp" | "ftps"
    pub backend: String,
    /// 是否由 SFTP 自动降级而来
    pub fallback_from_sftp: bool,
    pub supports_sftp: bool,
    pub supports_chmod: bool,
    pub supports_symlink: bool,
    pub supports_resume: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChunkResult {
    pub data_base64: String,
    pub offset: u64,
    pub bytes_read: u64,
    pub total_size: u64,
    pub eof: bool,
}

pub const MAX_READ_CHUNK_BYTES: u64 = 4 * 1024 * 1024;
pub const MAX_FILE_WRITE_BYTES: usize = 10 * 1024 * 1024;

fn validate_ftp_path(path: &str) -> Result<String, String> {
    if path.contains('\r') || path.contains('\n') || path.contains('\0') {
        return Err("Invalid FTP path: contains prohibited control characters".to_string());
    }
    let normalized = path.replace('\\', "/");
    let validation = crate::validators::validate_path_for_target(normalized.clone(), false, "linux");
    if !validation.valid {
        return Err(validation.error.unwrap_or_else(|| "Invalid FTP path".to_string()));
    }
    Ok(normalized)
}

fn validate_scp_path(path: &str) -> Result<(), String> {
    let validation = crate::validators::validate_path_for_target(path.to_string(), false, "linux");
    if !validation.valid {
        return Err(validation.error.unwrap_or_else(|| "Invalid SCP path".to_string()));
    }
    Ok(())
}

fn validate_sftp_path(path: &str, target_type: &str) -> Result<String, String> {
    let final_path = if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::validators::posix_to_windows_path(path)
    } else {
        path.to_string()
    };
    let validation = crate::validators::validate_path_for_target(
        final_path.clone(),
        false,
        target_type,
    );
    if !validation.valid {
        return Err(validation.error.unwrap_or_else(|| "Invalid path".to_string()));
    }
    Ok(final_path)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CachedProtocol {
    Sftp,
    Scp,
}

lazy_static::lazy_static! {
    /// 按基础 server_id 缓存协议探测结果（SFTP 可用或已自动降级到 SCP），避免重复分配通道
    static ref SCP_FALLBACK_CACHE: RwLock<HashMap<String, CachedProtocol>> = RwLock::new(HashMap::new());
    /// 瞬时探测失败的冷却时间戳：非「subsystem 缺失」类错误（超时/通道争用等）不降级为 SCP，
    /// 但短时间内也不应每次文件操作都重走 30s 建连探测，否则表现为持续卡死。
    static ref PROBE_FAILURE_COOLDOWN: RwLock<HashMap<String, tokio::time::Instant>> = RwLock::new(HashMap::new());
}

/// 记录每台服务器最近一次打印的传输后端日志签名，避免高频操作刷屏
static LAST_LOGGED_BACKEND: std::sync::LazyLock<std::sync::Mutex<HashMap<String, String>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

fn log_resolved_backend_if_changed(server_id: &str, resolved: &ResolvedRemoteFs) {
    let (sig, detail) = match resolved {
        ResolvedRemoteFs::Ftp { cfg, is_ftps } => {
            let proto = if *is_ftps { "ftps" } else { "ftp" };
            let enc = if cfg.use_gbk { "gbk" } else { "utf-8/auto-gbk" };
            (
                format!("{}:{}:{}:{}", proto, cfg.host, cfg.port, enc),
                format!(
                    "backend={}, host={}:{}, encoding={}",
                    proto, cfg.host, cfg.port, enc
                ),
            )
        }
        ResolvedRemoteFs::Scp {
            fallback_from_sftp, ..
        } => (
            format!("scp:fallback={}", fallback_from_sftp),
            format!(
                "backend=scp, transport=ssh-exec(same-ssh-port), fallback_from_sftp={}",
                fallback_from_sftp
            ),
        ),
        ResolvedRemoteFs::Sftp { target_type, .. } => (
            format!("sftp:{}", target_type),
            format!(
                "backend=sftp, transport=ssh-subsystem(same-ssh-port), target_type={}",
                target_type
            ),
        ),
    };

    let key = canonical_server_key(server_id);
    if let Ok(mut guard) = LAST_LOGGED_BACKEND.lock() {
        if guard.get(&key).map(String::as_str) == Some(sig.as_str()) {
            return;
        }
        guard.insert(key, sig);
    }
    tracing::info!("[RemoteFs] server={} active {}", server_id, detail);
}

/// 瞬时探测失败后的冷却时长：期间直接假定 SFTP，避免重复长超时探测
const PROBE_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(10);

fn canonical_server_key(server_id: &str) -> String {
    crate::commands::extract_base_server_id(server_id).to_string()
}

/// 清除某服务器的协议探测缓存（断连/配置更新时调用）
pub async fn clear_protocol_cache(server_id: &str) {
    let key = canonical_server_key(server_id);
    let mut cache = SCP_FALLBACK_CACHE.write().await;
    cache.remove(&key);
    if key != server_id {
        cache.remove(server_id);
    }
    drop(cache);
    let mut cooldown = PROBE_FAILURE_COOLDOWN.write().await;
    cooldown.remove(&key);
    cooldown.remove(server_id);
    if let Ok(mut logged) = LAST_LOGGED_BACKEND.lock() {
        logged.remove(&key);
        logged.remove(server_id);
    }
}

fn emit_backend_changed(server_id: &str, backend: &str, fallback_from_sftp: bool) {
    if let Some(handle) = crate::ssh::manager::app_handle() {
        use tauri::Emitter;
        let _ = handle.emit(
            "remote-fs-backend-changed",
            serde_json::json!({
                "serverId": server_id,
                "backend": backend,
                "fallbackFromSftp": fallback_from_sftp,
            }),
        );
        let base_id = canonical_server_key(server_id);
        if base_id != server_id {
            let _ = handle.emit(
                "remote-fs-backend-changed",
                serde_json::json!({
                    "serverId": base_id,
                    "backend": backend,
                    "fallbackFromSftp": fallback_from_sftp,
                }),
            );
        }
    }
}

/// 解析服务器配置的显式文件传输协议字符串
async fn read_configured_protocol(server_id: &str) -> (String, String) {
    let server = match crate::commands::ssh::load_server_config(server_id).await {
        Ok(s) => s,
        Err(_) => return ("sftp".to_string(), "linux".to_string()),
    };
    let target_type = server.target_type;
    let proto = server
        .file_transfer_config
        .as_deref()
        .and_then(ftp::parse_file_transfer_config)
        .map(|c| c.protocol.trim().to_ascii_lowercase())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "sftp".to_string());
    (proto, target_type)
}

/// 统一远程文件系统后端枚举（枚举静态分发：`Sftp` / `Ftp` / `Scp`）
pub enum ResolvedRemoteFs {
    Ftp {
        cfg: ResolvedFtpConfig,
        is_ftps: bool,
    },
    Scp {
        server_id: String,
        fallback_from_sftp: bool,
    },
    Sftp {
        server_id: String,
        target_type: String,
    },
}

impl ResolvedRemoteFs {
    pub fn capabilities(&self) -> RemoteFsCapabilities {
        match self {
            Self::Ftp { is_ftps, .. } => RemoteFsCapabilities {
                backend: if *is_ftps { "ftps" } else { "ftp" }.to_string(),
                fallback_from_sftp: false,
                supports_sftp: false,
                supports_chmod: true,
                supports_symlink: false,
                supports_resume: true,
            },
            Self::Scp {
                fallback_from_sftp, ..
            } => RemoteFsCapabilities {
                backend: "scp".to_string(),
                fallback_from_sftp: *fallback_from_sftp,
                supports_sftp: false,
                supports_chmod: true,
                supports_symlink: true,
                supports_resume: false,
            },
            Self::Sftp { .. } => RemoteFsCapabilities {
                backend: "sftp".to_string(),
                fallback_from_sftp: false,
                supports_sftp: true,
                supports_chmod: true,
                supports_symlink: true,
                supports_resume: true,
            },
        }
    }

    pub async fn list_dir(&self, dir_path: &str) -> Result<Vec<FileEntry>, String> {
        match self {
            Self::Ftp { cfg, .. } => {
                let norm = validate_ftp_path(dir_path)?;
                ftp::ftp_list_dir(cfg.clone(), &norm).await
            }
            Self::Scp { server_id, .. } => {
                validate_scp_path(dir_path)?;
                scp::scp_list_dir(server_id, dir_path).await
            }
            Self::Sftp {
                server_id,
                target_type,
            } => {
                if target_type.eq_ignore_ascii_case("windows") {
                    if dir_path == "/" {
                        let drives =
                            crate::targets::windows::files::files_list_drives(server_id.clone())
                                .await?;
                        let mut drive_entries = Vec::with_capacity(drives.len());
                        for drive in drives {
                            let name = drive.trim_end_matches('\\').to_string();
                            drive_entries.push(FileEntry {
                                name: name.clone(),
                                path: format!("/{}/", name),
                                is_directory: true,
                                is_symlink: false,
                                size: 0,
                                modified_time: String::new(),
                                permissions: "---".to_string(),
                                owner: String::new(),
                                group: String::new(),
                                uid: None,
                                gid: None,
                            });
                        }
                        Ok(drive_entries)
                    } else {
                        let win_path =
                            crate::targets::windows::validators::posix_to_windows_path(dir_path);
                        let mut list =
                            crate::targets::windows::files::files_list(server_id.clone(), win_path)
                                .await?;
                        for entry in &mut list {
                            entry.path = crate::targets::windows::validators::windows_to_posix_path(
                                &entry.path,
                            );
                        }
                        Ok(list)
                    }
                } else {
                    crate::targets::linux::files::files_list(server_id.clone(), dir_path.to_string())
                        .await
                }
            }
        }
    }

    pub async fn read_bytes(&self, path: &str, max_bytes: usize) -> Result<Vec<u8>, String> {
        match self {
            Self::Ftp { cfg, .. } => {
                let norm = validate_ftp_path(path)?;
                ftp::ftp_read_bytes(cfg.clone(), &norm, max_bytes).await
            }
            Self::Scp { server_id, .. } => {
                validate_scp_path(path)?;
                scp::scp_read_bytes(server_id, path, max_bytes as u64).await
            }
            Self::Sftp {
                server_id,
                target_type,
            } => {
                let final_path = validate_sftp_path(path, target_type)?;
                crate::ssh::manager::sftp_read_file_bytes_bounded(server_id, &final_path, max_bytes)
                    .await
            }
        }
    }

    pub async fn read_range(
        &self,
        path: &str,
        offset: u64,
        len: u64,
    ) -> Result<FileChunkResult, String> {
        match self {
            Self::Ftp { cfg, .. } => {
                let norm = validate_ftp_path(path)?;
                ftp::ftp_read_range(cfg.clone(), &norm, offset, len).await
            }
            Self::Scp { server_id, .. } => {
                validate_scp_path(path)?;
                scp::scp_read_range(server_id, path, offset, len).await
            }
            Self::Sftp {
                server_id,
                target_type,
            } => {
                let final_path = validate_sftp_path(path, target_type)?;
                crate::ssh::manager::sftp_read_range(server_id, &final_path, offset, len).await
            }
        }
    }

    pub async fn write_bytes_bounded(
        &self,
        path: &str,
        bytes: Vec<u8>,
        max_bytes: usize,
    ) -> Result<CommandResult, String> {
        if bytes.len() > max_bytes {
            return Ok(CommandResult::err(format!(
                "File content too large ({} bytes, max {} bytes). Please use file upload for large files.",
                bytes.len(),
                max_bytes
            )));
        }
        match self {
            Self::Ftp { cfg, .. } => {
                let norm = match validate_ftp_path(path) {
                    Ok(p) => p,
                    Err(e) => return Ok(CommandResult::err(e)),
                };
                match ftp::ftp_write_bytes(cfg.clone(), &norm, &bytes).await {
                    Ok(()) => Ok(CommandResult::ok("File written successfully")),
                    Err(e) => Ok(CommandResult::err(e)),
                }
            }
            Self::Scp { server_id, .. } => {
                if let Err(e) = validate_scp_path(path) {
                    return Ok(CommandResult::err(e));
                }
                match scp::scp_write_bytes(server_id, path, &bytes).await {
                    Ok(()) => Ok(CommandResult::ok("File written successfully")),
                    Err(e) => Ok(CommandResult::err(e)),
                }
            }
            Self::Sftp {
                server_id,
                target_type,
            } => {
                let final_path = match validate_sftp_path(path, target_type) {
                    Ok(p) => p,
                    Err(e) => return Ok(CommandResult::err(e)),
                };
                let sftp_path = if target_type.eq_ignore_ascii_case("windows") {
                    crate::targets::windows::path_resolver::PathResolver::to_sftp(&final_path)
                } else {
                    final_path
                };
                match crate::ssh::manager::sftp_write(server_id.clone(), sftp_path, bytes).await {
                    Ok(()) => Ok(CommandResult::ok("File written successfully")),
                    Err(e) => Ok(CommandResult::err(e)),
                }
            }
        }
    }

    pub async fn write_text_or_base64(&self, path: &str, content: String) -> Result<CommandResult, String> {
        let bytes = decode_content_bytes(content)?;
        self.write_bytes_bounded(path, bytes, MAX_FILE_WRITE_BYTES).await
    }

    pub async fn mkdir(&self, path: &str) -> Result<CommandResult, String> {
        match self {
            Self::Ftp { cfg, .. } => {
                let norm = match validate_ftp_path(path) {
                    Ok(p) => p,
                    Err(e) => return Ok(CommandResult::err(e)),
                };
                Ok(match ftp::ftp_mkdir(cfg.clone(), &norm).await {
                    Ok(()) => CommandResult::ok("Directory created"),
                    Err(e) => CommandResult::err(e),
                })
            }
            Self::Scp { server_id, .. } => {
                if let Err(e) = validate_scp_path(path) {
                    return Ok(CommandResult::err(e));
                }
                scp::scp_mkdir(server_id, path).await
            }
            Self::Sftp {
                server_id,
                target_type,
            } => {
                let res = if target_type.eq_ignore_ascii_case("windows") {
                    let win_path =
                        crate::targets::windows::validators::posix_to_windows_path(path);
                    crate::targets::windows::files::files_mkdir(server_id.clone(), win_path).await
                } else {
                    crate::targets::linux::files::files_mkdir(
                        server_id.clone(),
                        path.to_string(),
                    )
                    .await
                };
                Ok(match res {
                    Ok(msg) => CommandResult::ok(msg),
                    Err(e) => CommandResult::err(e),
                })
            }
        }
    }

    pub async fn delete(&self, path: &str) -> Result<CommandResult, String> {
        match self {
            Self::Ftp { cfg, .. } => {
                let norm = match validate_ftp_path(path) {
                    Ok(p) => p,
                    Err(e) => return Ok(CommandResult::err(e)),
                };
                Ok(match ftp::ftp_delete(cfg.clone(), &norm).await {
                    Ok(()) => CommandResult::ok("Deleted"),
                    Err(e) => CommandResult::err(e),
                })
            }
            Self::Scp { server_id, .. } => {
                if let Err(e) = validate_scp_path(path) {
                    return Ok(CommandResult::err(e));
                }
                scp::scp_delete(server_id, path).await
            }
            Self::Sftp {
                server_id,
                target_type,
            } => {
                let res = if target_type.eq_ignore_ascii_case("windows") {
                    let win_path =
                        crate::targets::windows::validators::posix_to_windows_path(path);
                    crate::targets::windows::files::files_delete(server_id.clone(), win_path).await
                } else {
                    crate::targets::linux::files::files_delete(
                        server_id.clone(),
                        path.to_string(),
                    )
                    .await
                };
                Ok(match res {
                    Ok(msg) => CommandResult::ok(msg),
                    Err(e) => CommandResult::err(e),
                })
            }
        }
    }

    pub async fn rename(&self, old_path: &str, new_path: &str) -> Result<CommandResult, String> {
        match self {
            Self::Ftp { cfg, .. } => {
                let norm_old = match validate_ftp_path(old_path) {
                    Ok(p) => p,
                    Err(e) => return Ok(CommandResult::err(e)),
                };
                let norm_new = match validate_ftp_path(new_path) {
                    Ok(p) => p,
                    Err(e) => return Ok(CommandResult::err(e)),
                };
                Ok(match ftp::ftp_rename(cfg.clone(), &norm_old, &norm_new).await {
                    Ok(()) => CommandResult::ok("Renamed"),
                    Err(e) => CommandResult::err(e),
                })
            }
            Self::Scp { server_id, .. } => {
                if let Err(e) = validate_scp_path(old_path) {
                    return Ok(CommandResult::err(e));
                }
                if let Err(e) = validate_scp_path(new_path) {
                    return Ok(CommandResult::err(e));
                }
                scp::scp_rename(server_id, old_path, new_path).await
            }
            Self::Sftp {
                server_id,
                target_type,
            } => {
                let res = if target_type.eq_ignore_ascii_case("windows") {
                    let win_old =
                        crate::targets::windows::validators::posix_to_windows_path(old_path);
                    let win_new =
                        crate::targets::windows::validators::posix_to_windows_path(new_path);
                    crate::targets::windows::files::files_rename(
                        server_id.clone(),
                        win_old,
                        win_new,
                    )
                    .await
                } else {
                    crate::targets::linux::files::files_rename(
                        server_id.clone(),
                        old_path.to_string(),
                        new_path.to_string(),
                    )
                    .await
                };
                Ok(match res {
                    Ok(msg) => CommandResult::ok(msg),
                    Err(e) => CommandResult::err(e),
                })
            }
        }
    }

    pub async fn set_permissions(
        &self,
        path: &str,
        mode: &str,
        recursive: bool,
    ) -> Result<CommandResult, String> {
        match self {
            Self::Ftp { cfg, .. } => {
                let norm = match validate_ftp_path(path) {
                    Ok(p) => p,
                    Err(e) => return Ok(CommandResult::err(e)),
                };
                Ok(match ftp::ftp_set_permissions(cfg.clone(), &norm, mode).await {
                    Ok(msg) => CommandResult::ok(msg),
                    Err(e) => CommandResult::err(e),
                })
            }
            Self::Scp { server_id, .. } => {
                if let Err(e) = validate_scp_path(path) {
                    return Ok(CommandResult::err(e));
                }
                scp::scp_set_permissions(server_id, path, mode, recursive).await
            }
            Self::Sftp {
                server_id,
                target_type,
            } => {
                let res = if target_type.eq_ignore_ascii_case("windows") {
                    let win_path =
                        crate::targets::windows::validators::posix_to_windows_path(path);
                    crate::targets::windows::files::files_set_permissions(
                        server_id.clone(),
                        win_path,
                        mode.to_string(),
                        recursive,
                    )
                    .await
                } else {
                    crate::targets::linux::files::files_set_permissions(
                        server_id.clone(),
                        path.to_string(),
                        mode.to_string(),
                        recursive,
                    )
                    .await
                };
                Ok(match res {
                    Ok(msg) => CommandResult::ok(msg),
                    Err(e) => CommandResult::err(e),
                })
            }
        }
    }

    pub async fn backup(&self, path: &str) -> Result<CommandResult, String> {
        match self {
            Self::Ftp { cfg, .. } => {
                let norm = match validate_ftp_path(path) {
                    Ok(p) => p,
                    Err(e) => return Ok(CommandResult::err(e)),
                };
                let bytes = match ftp::ftp_read_bytes(cfg.clone(), &norm, 20 * 1024 * 1024).await {
                    Ok(b) => b,
                    Err(e) => return Ok(CommandResult::err(e)),
                };
                let now = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
                let bak_path = format!("{}.bak.{}", norm, now);
                Ok(match ftp::ftp_write_bytes(cfg.clone(), &bak_path, &bytes).await {
                    Ok(()) => CommandResult::ok(bak_path),
                    Err(e) => CommandResult::err(e),
                })
            }
            Self::Scp { server_id, .. } => {
                if let Err(e) = validate_scp_path(path) {
                    return Ok(CommandResult::err(e));
                }
                scp::scp_backup(server_id, path).await
            }
            Self::Sftp {
                server_id,
                target_type,
            } => {
                let res = if target_type.eq_ignore_ascii_case("windows") {
                    let win_path =
                        crate::targets::windows::validators::posix_to_windows_path(path);
                    crate::targets::windows::files::files_backup(server_id.clone(), win_path).await
                } else {
                    crate::targets::linux::files::files_backup(
                        server_id.clone(),
                        path.to_string(),
                    )
                    .await
                };
                Ok(match res {
                    Ok(msg) => CommandResult::ok(msg),
                    Err(e) => CommandResult::err(e),
                })
            }
        }
    }

    pub async fn stat_info(&self, path: &str) -> Result<String, String> {
        match self {
            Self::Ftp { cfg, .. } => {
                let norm = validate_ftp_path(path)?;
                ftp::ftp_stat_info(cfg.clone(), &norm).await
            }
            Self::Scp { server_id, .. } => {
                validate_scp_path(path)?;
                scp::scp_stat_info(server_id, path).await
            }
            Self::Sftp {
                server_id,
                target_type,
            } => {
                if target_type.eq_ignore_ascii_case("windows") {
                    let win_path =
                        crate::targets::windows::validators::posix_to_windows_path(path);
                    crate::targets::windows::files::files_stat_info(server_id.clone(), win_path)
                        .await
                } else {
                    crate::targets::linux::files::files_stat_info(
                        server_id.clone(),
                        path.to_string(),
                    )
                    .await
                }
            }
        }
    }
}

fn decode_content_bytes(content: String) -> Result<Vec<u8>, String> {
    use base64::Engine as _;
    if let Some(b64) = content.strip_prefix("::base64::") {
        base64::engine::general_purpose::STANDARD
            .decode(b64.trim())
            .map_err(|e| format!("Base64 decode failed: {}", e))
    } else {
        Ok(content.into_bytes())
    }
}

fn is_sftp_subsystem_error(err: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    // 排除瞬时超时、连接断开、会话数超限（MaxSessions）等非协议缺失错误
    let is_transient_or_session_limit = lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("maxsessions")
        || lower.contains("connectfailed")
        || lower.contains("resource shortage")
        || lower.contains("administratively")
        || lower.contains("too many")
        || lower.contains("connection lost")
        || lower.contains("connection reset")
        || lower.contains("not connected")
        || lower.contains("broken pipe")
        || lower.contains("disconnected")
        || lower.contains("eof");
    if is_transient_or_session_limit {
        return false;
    }

    lower.contains("subsystem")
        || lower.contains("exit status")
        || lower.contains("sftp-server")
        || lower.contains("not enabled")
        || lower.contains("disabled")
        || lower.contains("unsupported")
        || lower.contains("not supported")
        || lower.contains("channel open failure")
        || lower.contains("request failed")
        || lower.contains("rejected")
}

/// 解析目标服务器当前生效的文件系统后端（支持 FTP/FTPS、显式 SCP、以及 SFTP -> SCP 自动降级缓存）
pub async fn resolve_backend(server_id: &str) -> Result<ResolvedRemoteFs, String> {
    let resolved = resolve_backend_inner(server_id).await?;
    log_resolved_backend_if_changed(server_id, &resolved);
    Ok(resolved)
}

async fn resolve_backend_inner(server_id: &str) -> Result<ResolvedRemoteFs, String> {
    if let Ok(Some(ftp_cfg)) = ftp::resolve_ftp_config_for_server(server_id).await {
        return Ok(ResolvedRemoteFs::Ftp {
            is_ftps: ftp_cfg.is_ftps,
            cfg: ftp_cfg,
        });
    }

    let (proto, target_type) = read_configured_protocol(server_id).await;
    if proto == "scp" {
        return Ok(ResolvedRemoteFs::Scp {
            server_id: server_id.to_string(),
            fallback_from_sftp: false,
        });
    }

    let canonical_key = canonical_server_key(server_id);
    {
        let cache = SCP_FALLBACK_CACHE.read().await;
        match cache.get(&canonical_key).copied() {
            Some(CachedProtocol::Scp) => {
                return Ok(ResolvedRemoteFs::Scp {
                    server_id: server_id.to_string(),
                    fallback_from_sftp: true,
                });
            }
            Some(CachedProtocol::Sftp) => {
                return Ok(ResolvedRemoteFs::Sftp {
                    server_id: server_id.to_string(),
                    target_type,
                });
            }
            None => {}
        }
    }

    // 冷却期内跳过重复探测：上次是非 subsystem 类瞬时失败（超时/通道争用），短期内直接假定 SFTP
    {
        let cooldown = PROBE_FAILURE_COOLDOWN.read().await;
        if let Some(failed_at) = cooldown.get(&canonical_key) {
            if failed_at.elapsed() < PROBE_COOLDOWN {
                return Ok(ResolvedRemoteFs::Sftp {
                    server_id: server_id.to_string(),
                    target_type,
                });
            }
        }
    }

    // 若 SFTP 握手失败且为非 Windows SSH 主机（如精简镜像未装 sftp-server），缓存降级为 SCP
    if !target_type.eq_ignore_ascii_case("windows") {
        if let Ok(conn) = SshManager::global().get_connection(server_id) {
            match conn.create_sftp_session().await {
                Ok(_) => {
                    let mut cache = SCP_FALLBACK_CACHE.write().await;
                    cache.insert(canonical_key.clone(), CachedProtocol::Sftp);
                    drop(cache);
                    PROBE_FAILURE_COOLDOWN.write().await.remove(&canonical_key);
                }
                Err(err) => {
                    let err_str = err.to_string();
                    if !is_sftp_subsystem_error(&err_str) {
                        // 瞬时失败不降级，但记录冷却时间戳，避免后续每次操作重复 30s 探测
                        PROBE_FAILURE_COOLDOWN.write().await.insert(canonical_key.clone(), tokio::time::Instant::now());
                    }
                    if is_sftp_subsystem_error(&err_str) {
                        let mut cache = SCP_FALLBACK_CACHE.write().await;
                        cache.insert(canonical_key, CachedProtocol::Scp);
                        drop(cache);
                        tracing::info!(
                            "[RemoteFs] SFTP unavailable on {} ({}), cached fallback to SCP",
                            server_id,
                            err_str
                        );
                        emit_backend_changed(server_id, "scp", true);
                        return Ok(ResolvedRemoteFs::Scp {
                            server_id: server_id.to_string(),
                            fallback_from_sftp: true,
                        });
                    }
                }
            }
        }
    }

    Ok(ResolvedRemoteFs::Sftp {
        server_id: server_id.to_string(),
        target_type,
    })
}

/// 若已开启/降级 SCP，执行单文件 SCP 下载辅助函数
pub async fn try_scp_download_single<F>(
    server_id: &str,
    remote_path: &str,
    local_path: &str,
    tmp_local_path: &str,
    on_progress: F,
    cancel: Option<&Arc<AtomicBool>>,
) -> Option<Result<(), String>>
where
    F: FnMut(u64, u64),
{
    match resolve_backend(server_id).await {
        Ok(ResolvedRemoteFs::Scp { .. }) => Some(
            scp::scp_download_file(
                server_id,
                remote_path,
                local_path,
                tmp_local_path,
                on_progress,
                cancel,
            )
            .await,
        ),
        _ => None,
    }
}

/// 若已开启/降级 SCP，执行单文件 SCP 上传辅助函数
pub async fn try_scp_upload_single<F>(
    server_id: &str,
    local_path: &str,
    remote_path: &str,
    on_progress: F,
    cancel: Option<&Arc<AtomicBool>>,
) -> Option<Result<(), String>>
where
    F: FnMut(u64, u64),
{
    match resolve_backend(server_id).await {
        Ok(ResolvedRemoteFs::Scp { .. }) => {
            Some(scp::scp_upload_file(server_id, local_path, remote_path, on_progress, cancel).await)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_reflect_protocol_semantics() {
        let scp = ResolvedRemoteFs::Scp {
            server_id: "s1".to_string(),
            fallback_from_sftp: true,
        }
        .capabilities();
        assert_eq!(scp.backend, "scp");
        assert!(scp.fallback_from_sftp);
        assert!(!scp.supports_sftp);
        assert!(!scp.supports_resume);
        assert!(scp.supports_chmod);

        let sftp = ResolvedRemoteFs::Sftp {
            server_id: "s1".to_string(),
            target_type: "linux".to_string(),
        }
        .capabilities();
        assert_eq!(sftp.backend, "sftp");
        assert!(!sftp.fallback_from_sftp);
        assert!(sftp.supports_sftp);
        assert!(sftp.supports_resume);
    }

    #[tokio::test]
    async fn fallback_cache_is_scoped_and_clearable() {
        {
            let mut cache = SCP_FALLBACK_CACHE.write().await;
            cache.insert("srv-cache-test".to_string(), CachedProtocol::Scp);
        }
        // 验证带 sftp:/ws: 前缀的同源 ID 共享基础 server_id 缓存
        let resolved = resolve_backend("sftp:srv-cache-test").await.unwrap();
        assert_eq!(resolved.capabilities().backend, "scp");
        assert!(resolved.capabilities().fallback_from_sftp);

        clear_protocol_cache("ws:srv-cache-test:tab-1").await;
        let cache = SCP_FALLBACK_CACHE.read().await;
        assert!(!cache.contains_key("srv-cache-test"));
        drop(cache);

        {
            let mut cache = SCP_FALLBACK_CACHE.write().await;
            cache.insert("srv-sftp-cached".to_string(), CachedProtocol::Sftp);
        }
        let sftp_resolved = resolve_backend("srv-sftp-cached").await.unwrap();
        assert_eq!(sftp_resolved.capabilities().backend, "sftp");
        assert!(!sftp_resolved.capabilities().fallback_from_sftp);
        clear_protocol_cache("srv-sftp-cached").await;
    }

    #[test]
    fn sftp_subsystem_error_detection_excludes_transient_and_session_limits() {
        assert!(is_sftp_subsystem_error("subsystem request failed on channel 0"));
        assert!(is_sftp_subsystem_error("SSH channel open failure: sftp-server not found"));
        assert!(is_sftp_subsystem_error("remote process exit status 127: unsupported"));

        assert!(!is_sftp_subsystem_error("SFTP session init timed out (30s)"));
        assert!(!is_sftp_subsystem_error("Channel open failed: MaxSessions exceeded"));
        assert!(!is_sftp_subsystem_error("Channel open failed: ConnectFailed"));
        assert!(!is_sftp_subsystem_error("Connection lost while opening SFTP"));
    }
}
