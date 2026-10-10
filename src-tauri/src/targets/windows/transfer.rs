//! Windows 文件传输实现（上传/下载）
//!
//! 按 doc/Windows_SFTP_技术方案.md 设计：
//! - Upload: stat → mkdir → temp `.uploading` → chunked (512KB~1MB) → flush → rename
//! - Download: temp file → chunked read → fsync → rename
//! - 使用 PathResolver 统一路径（正斜杠）
//! - 纯 SFTP 传输，无 PowerShell 回退
//! - 进度通过回调上报，取消通过 AtomicBool 标志，与 commands 层兼容

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use russh_sftp::protocol::OpenFlags;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::timeout;

use super::path_resolver::PathResolver;
use super::transfer_manager::{TransferDirection, TransferError, TransferManager};

/// 上传 chunk 大小：32KB
/// Windows OpenSSH sftp-server.exe 对大 chunk write 可能返回 SSH_FX_FAILURE
/// 32KB 是 SFTP 协议推荐的 chunk 大小，兼容性最好（与 manager.rs 旧实现一致）
const UPLOAD_CHUNK_SIZE: usize = 32 * 1024;

/// 下载 chunk 大小：256KB
/// 下载是 read 操作，不受 sftp-server write 限制，可用较大 chunk
const DOWNLOAD_CHUNK_SIZE: usize = 256 * 1024;

/// SFTP 操作超时
const SFTP_TIMEOUT: u64 = 60;

/// write 失败重试次数（Defender 锁定等瞬时错误）
const WRITE_RETRIES: u32 = 3;

/// 重试间隔
const RETRY_DELAY: Duration = Duration::from_millis(500);

/// 进度事件最小间隔：100ms
/// 避免每个 chunk 都发事件导致前端速率计算波动；同时保证 UI 更新足够流畅
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

/// 上传单个文件（核心实现）
///
/// 流程：
/// 1. stat 本地文件
/// 2. 创建远程父目录（如不存在）
/// 3. 打开远程临时文件 `.uploading`
/// 4. 分块写入（512KB）
/// 5. flush
/// 6. rename 为正式文件
///
/// `on_progress`: 进度回调 (transferred, total)
/// `cancel`: 可选的取消标志，传输过程中检查
pub async fn upload_file(
    server_id: &str,
    local_path: &str,
    remote_path: &str,
    on_progress: impl Fn(u64, u64),
    cancel: Option<&AtomicBool>,
) -> Result<(), TransferError> {
    let sftp_remote = PathResolver::to_sftp(remote_path);
    let tmp_remote = PathResolver::uploading_tmp(&sftp_remote);

    tracing::info!(
        "[Windows Upload] start: local={} remote={} tmp={}",
        local_path, sftp_remote, tmp_remote
    );

    // 1. stat 本地文件
    let metadata = tokio::fs::metadata(local_path)
        .await
        .map_err(|e| TransferError::from_io(&e))?;
    let total_size = metadata.len();
    on_progress(0, total_size);

    let mut local_file = tokio::fs::File::open(local_path)
        .await
        .map_err(|e| TransferError::from_io(&e))?;

    // 2. 创建远程父目录
    if let Some(parent) = PathResolver::parent(&sftp_remote) {
        if !PathResolver::is_root(&parent) {
            // 尝试创建父目录，超时 60s（失败时忽略，可能已存在）
            let _ = timeout(
                Duration::from_secs(SFTP_TIMEOUT),
                crate::ssh::manager::sftp_mkdir(server_id, &parent),
            )
            .await;
        }
    }

    // 3. 获取独立 SFTP session（不复用缓存）
    // Windows sftp-server.exe 不支持同一 session 上交错 readdir + write，
    // 传输用独立 session 可与同时进行的目录浏览操作互不干扰
    let conn = crate::ssh::manager::SshManager::global()
        .get_connection(server_id)
        .map_err(|e| TransferError::Unknown {
            message: e.to_string(),
        })?;
    let sftp = conn
        .create_dedicated_sftp_session()
        .await
        .map_err(|e| TransferError::ConnectionLost {
            message: e.to_string(),
        })?;

    // 4. 打开远程临时文件（覆盖模式）
    let mut remote_file = timeout(
        Duration::from_secs(SFTP_TIMEOUT),
        sftp.open_with_flags(
            &tmp_remote,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        ),
    )
    .await
    .map_err(|_| TransferError::Timeout {
        message: "SFTP open timed out".to_string(),
    })?
    .map_err(|e| TransferError::from_sftp_message(&e.to_string()))?;

    // 5. 分块写入
    // 准备阶段（创建目录/获取session/打开文件）可能耗时数秒
    // 在此重置进度时间基线，避免准备时间被计入第一次速率计算
    let mut progress_clock = Instant::now();
    on_progress(0, total_size);

    let mut buf = vec![0u8; UPLOAD_CHUNK_SIZE];
    let mut transferred: u64 = 0;

    loop {
        // 检查取消
        if let Some(flag) = cancel {
            if flag.load(Ordering::Relaxed) {
                let _ = sftp.remove_file(&tmp_remote).await;
                return Err(TransferError::Canceled);
            }
        }

        let n = timeout(Duration::from_secs(SFTP_TIMEOUT), local_file.read(&mut buf))
            .await
            .map_err(|_| TransferError::Timeout {
                message: "Local file read timed out".to_string(),
            })?
            .map_err(|e| TransferError::from_io(&e))?;

        if n == 0 {
            break;
        }

        // 写入重试
        let mut write_ok = false;
        for attempt in 0..WRITE_RETRIES {
            if let Some(flag) = cancel {
                if flag.load(Ordering::Relaxed) {
                    let _ = sftp.remove_file(&tmp_remote).await;
                    return Err(TransferError::Canceled);
                }
            }
            match timeout(
                Duration::from_secs(SFTP_TIMEOUT),
                remote_file.write_all(&buf[..n]),
            )
            .await
            {
                Ok(Ok(())) => {
                    write_ok = true;
                    break;
                }
                Ok(Err(e)) => {
                    let err = TransferError::from_sftp_message(&e.to_string());
                    if attempt < WRITE_RETRIES - 1 && err.is_retryable() {
                        tracing::warn!(
                            "[Windows Upload] write attempt {} failed (will retry): {}",
                            attempt,
                            e
                        );
                        tokio::time::sleep(RETRY_DELAY).await;
                        // 重新打开文件（APPEND 模式续写）
                        drop(remote_file);
                        remote_file = timeout(
                            Duration::from_secs(SFTP_TIMEOUT),
                            sftp.open_with_flags(
                                &tmp_remote,
                                OpenFlags::WRITE | OpenFlags::APPEND,
                            ),
                        )
                        .await
                        .map_err(|_| TransferError::Timeout {
                            message: "SFTP reopen timed out".to_string(),
                        })?
                        .map_err(|e| TransferError::from_sftp_message(&e.to_string()))?;
                    } else {
                        return Err(err);
                    }
                }
                Err(_) => {
                    return Err(TransferError::Timeout {
                        message: "SFTP write timed out".to_string(),
                    });
                }
            }
        }
        if !write_ok {
            return Err(TransferError::Unknown {
                message: "SFTP write failed after retries".to_string(),
            });
        }

        transferred += n as u64;
        // 时间节流：每 100ms 最多发一次进度事件，避免高频事件导致前端速率波动
        let now = Instant::now();
        if now.duration_since(progress_clock) >= PROGRESS_INTERVAL {
            on_progress(transferred, total_size);
            progress_clock = now;
        }
    }

    // 6. 发送最终进度（确保前端看到 100%）
    on_progress(transferred, total_size);

    // 7. flush (带 60s 超时)
    timeout(Duration::from_secs(SFTP_TIMEOUT), remote_file.flush())
        .await
        .map_err(|_| TransferError::Timeout {
            message: "SFTP flush timed out".to_string(),
        })?
        .map_err(|e| TransferError::from_sftp_message(&e.to_string()))?;
    // sync_all 失败仅警告（部分 SFTP 服务器不支持 fsync 扩展）
    if let Ok(Err(e)) = timeout(Duration::from_secs(10), remote_file.sync_all()).await {
        tracing::warn!("[Windows Upload] sync_all warning: {}", e);
    }
    drop(remote_file);

    // 8. rename 为正式文件（复用三步原子备份重命名，避免删除目标后重命名失败导致原文件永久丢失）
    timeout(
        Duration::from_secs(SFTP_TIMEOUT),
        crate::ssh::manager::sftp_atomic_rename_overwrite(&sftp, &tmp_remote, &sftp_remote),
    )
    .await
    .map_err(|_| TransferError::Timeout {
        message: "SFTP rename timed out".to_string(),
    })?
    .map_err(|e| TransferError::from_sftp_message(&e))?;

    tracing::info!(
        "[Windows Upload] completed: bytes={} avg_speed={:.2}KB/s",
        transferred,
        transferred as f64 / 1024.0
    );

    Ok(())
}

/// 下载单个文件（核心实现）
///
/// 流程：
/// 1. 创建本地临时文件 `.downloading`
/// 2. 分块读取远程文件
/// 3. fsync
/// 4. rename
pub async fn download_file(
    server_id: &str,
    remote_path: &str,
    local_path: &str,
    on_progress: impl Fn(u64, u64),
    cancel: Option<&AtomicBool>,
) -> Result<(), TransferError> {
    let sftp_remote = PathResolver::to_sftp(remote_path);
    let tmp_local = PathResolver::downloading_tmp(local_path);

    tracing::info!(
        "[Windows Download] start: remote={} local={} tmp={}",
        sftp_remote, local_path, tmp_local
    );

    // 确保本地目录存在
    if let Some(parent) = std::path::Path::new(local_path).parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }

    // 获取独立 SFTP session（不复用缓存，与上传同理）
    let conn = crate::ssh::manager::SshManager::global()
        .get_connection(server_id)
        .map_err(|e| TransferError::Unknown {
            message: e.to_string(),
        })?;
    let sftp = conn
        .create_dedicated_sftp_session()
        .await
        .map_err(|e| TransferError::ConnectionLost {
            message: e.to_string(),
        })?;

    // 获取远程文件大小（带 60s 超时）
    let total_size = match timeout(Duration::from_secs(SFTP_TIMEOUT), sftp.metadata(&sftp_remote)).await {
        Ok(Ok(meta)) => meta.size.unwrap_or(0),
        Ok(Err(e)) => {
            return Err(TransferError::from_sftp_message(&e.to_string()));
        }
        Err(_) => {
            return Err(TransferError::Timeout {
                message: "SFTP metadata timed out".to_string(),
            });
        }
    };
    on_progress(0, total_size);

    // 打开远程文件
    let mut remote_file = timeout(
        Duration::from_secs(SFTP_TIMEOUT),
        sftp.open(&sftp_remote),
    )
    .await
    .map_err(|_| TransferError::Timeout {
        message: "SFTP open timed out".to_string(),
    })?
    .map_err(|e| TransferError::from_sftp_message(&e.to_string()))?;

    // 创建本地临时文件
    let mut local_file = tokio::fs::File::create(&tmp_local)
        .await
        .map_err(|e| TransferError::from_io(&e))?;

    // 分块读取
    // 准备阶段（获取session/打开远程文件/创建本地文件）可能耗时数秒
    // 在此重置进度时间基线，避免准备时间被计入第一次速率计算
    let mut progress_clock = Instant::now();
    on_progress(0, total_size);

    let mut buf = vec![0u8; DOWNLOAD_CHUNK_SIZE];
    let mut transferred: u64 = 0;

    loop {
        if let Some(flag) = cancel {
            if flag.load(Ordering::Relaxed) {
                drop(local_file);
                let _ = tokio::fs::remove_file(&tmp_local).await;
                return Err(TransferError::Canceled);
            }
        }

        let n = timeout(
            Duration::from_secs(SFTP_TIMEOUT),
            remote_file.read(&mut buf),
        )
        .await
        .map_err(|_| TransferError::Timeout {
            message: "SFTP read timed out".to_string(),
        })?
        .map_err(|e| TransferError::from_sftp_message(&e.to_string()))?;

        if n == 0 {
            break;
        }

        local_file
            .write_all(&buf[..n])
            .await
            .map_err(|e| TransferError::from_io(&e))?;

        transferred += n as u64;
        // 时间节流：每 100ms 最多发一次进度事件
        let now = Instant::now();
        if now.duration_since(progress_clock) >= PROGRESS_INTERVAL {
            on_progress(transferred, total_size);
            progress_clock = now;
        }
    }

    // 发送最终进度（确保前端看到 100%）
    on_progress(transferred, total_size);

    // fsync
    local_file
        .flush()
        .await
        .map_err(|e| TransferError::from_io(&e))?;
    local_file
        .sync_all()
        .await
        .map_err(|e| TransferError::from_io(&e))?;
    drop(local_file);
    drop(remote_file);

    // rename 为正式文件
    tokio::fs::rename(&tmp_local, local_path)
        .await
        .map_err(|e| TransferError::from_io(&e))?;

    tracing::info!(
        "[Windows Download] completed: bytes={}",
        transferred
    );

    Ok(())
}

/// 带重试的传输执行器（使用 TransferManager 管理任务生命周期）
///
/// 通过 TransferManager 提交任务，执行传输，失败时按 max_retries 重试。
/// `on_progress` 和 `cancel` 由调用方提供，与 commands 层兼容。
pub async fn execute_with_retry(
    server_id: &str,
    local_path: &str,
    remote_path: &str,
    direction: TransferDirection,
    on_progress: impl Fn(u64, u64),
    cancel: Option<&AtomicBool>,
) -> Result<(), TransferError> {
    let manager = TransferManager::global();

    // 提交任务到 TransferManager（获取 task_id 用于跟踪）
    let task_id = match direction {
        TransferDirection::Upload => {
            manager
                .submit_upload(server_id, local_path, remote_path)
                .await
        }
        TransferDirection::Download => {
            manager
                .submit_download(server_id, remote_path, local_path)
                .await
        }
    };

    let max_retries = manager.get_max_retries(&task_id).await;

    loop {
        manager.mark_running(&task_id).await;

        let result = match direction {
            TransferDirection::Upload => {
                upload_file(server_id, local_path, remote_path, &on_progress, cancel).await
            }
            TransferDirection::Download => {
                download_file(server_id, remote_path, local_path, &on_progress, cancel).await
            }
        };

        match result {
            Ok(()) => {
                manager.mark_completed(&task_id).await;
                return Ok(());
            }
            Err(e) => {
                let retry_count = manager.get_retry_count(&task_id).await;
                if e.is_retryable() && retry_count < max_retries {
                    let backoff = TransferManager::retry_backoff(retry_count);
                    tracing::warn!(
                        "[Windows Transfer] retrying {}/{} after {:?}: {}",
                        retry_count,
                        max_retries,
                        backoff,
                        e
                    );
                    manager.mark_failed(&task_id, e).await;
                    tokio::time::sleep(backoff).await;
                    continue;
                }
                manager.mark_failed(&task_id, e.clone()).await;
                return Err(e);
            }
        }
    }
}
