//! Windows 传输管理器
//!
//! 按 doc/Windows_SFTP_技术方案.md 设计：
//! - 任务队列管理（id/方向/路径/进度/状态/错误）
//! - 重试（默认 3 次，指数退避）
//! - 取消（AtomicBool 标志）
//! - 并发控制（默认 2，Semaphore）
//! - 与目录浏览解耦
//!
//! 所有传输任务统一经 TransferManager 调度，不再散落在 commands 层。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tokio::sync::{Mutex, Semaphore};
use uuid::Uuid;

use super::path_resolver::PathResolver;

/// 传输方向
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TransferDirection {
    Upload,
    Download,
}

/// 传输状态
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TransferStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Canceled,
}

/// 统一错误类型（按文档错误映射表）
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TransferError {
    ConnectionLost { message: String },
    Timeout { message: String },
    PermissionDenied { message: String },
    AlreadyExists { message: String },
    FileNotFound { message: String },
    DiskFull { message: String },
    Unsupported { message: String },
    Canceled,
    Unknown { message: String },
}

impl TransferError {
    /// 从 SFTP 错误字符串推断错误类型
    pub fn from_sftp_message(msg: &str) -> Self {
        let lower = msg.to_lowercase();
        if lower.contains("permission denied") || lower.contains("access denied") {
            Self::PermissionDenied { message: msg.to_string() }
        } else if lower.contains("no such file") || lower.contains("file not found") || lower.contains("does not exist") {
            Self::FileNotFound { message: msg.to_string() }
        } else if lower.contains("already exists") {
            Self::AlreadyExists { message: msg.to_string() }
        } else if lower.contains("no space") || lower.contains("disk full") || lower.contains("quota") {
            Self::DiskFull { message: msg.to_string() }
        } else if lower.contains("timeout") || lower.contains("timed out") {
            Self::Timeout { message: msg.to_string() }
        } else if lower.contains("disconnected") || lower.contains("connection lost") || lower.contains("closed") || lower.contains("broken") {
            Self::ConnectionLost { message: msg.to_string() }
        } else {
            Self::Unknown { message: msg.to_string() }
        }
    }

    /// 从 IO 错误推断
    pub fn from_io(e: &std::io::Error) -> Self {
        match e.kind() {
            std::io::ErrorKind::NotFound => Self::FileNotFound { message: e.to_string() },
            std::io::ErrorKind::PermissionDenied => Self::PermissionDenied { message: e.to_string() },
            std::io::ErrorKind::AlreadyExists => Self::AlreadyExists { message: e.to_string() },
            std::io::ErrorKind::TimedOut => Self::Timeout { message: e.to_string() },
            std::io::ErrorKind::ConnectionRefused
            | std::io::ErrorKind::ConnectionReset
            | std::io::ErrorKind::ConnectionAborted
            | std::io::ErrorKind::BrokenPipe => Self::ConnectionLost { message: e.to_string() },
            std::io::ErrorKind::WriteZero | std::io::ErrorKind::StorageFull => Self::DiskFull { message: e.to_string() },
            _ => Self::Unknown { message: e.to_string() },
        }
    }

    /// 是否可重试
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            Self::ConnectionLost { .. } | Self::Timeout { .. } | Self::Unknown { .. }
        )
    }

    pub fn message(&self) -> String {
        match self {
            Self::Canceled => "Transfer canceled".to_string(),
            Self::ConnectionLost { message } => message.clone(),
            Self::Timeout { message } => message.clone(),
            Self::PermissionDenied { message } => message.clone(),
            Self::AlreadyExists { message } => message.clone(),
            Self::FileNotFound { message } => message.clone(),
            Self::DiskFull { message } => message.clone(),
            Self::Unsupported { message } => message.clone(),
            Self::Unknown { message } => message.clone(),
        }
    }
}

impl std::fmt::Display for TransferError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message())
    }
}

/// 传输任务
#[derive(Debug, Clone, Serialize)]
pub struct TransferTask {
    pub id: String,
    pub direction: TransferDirection,
    pub server_id: String,
    pub local_path: String,
    pub remote_path: String,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub status: TransferStatus,
    pub error: Option<TransferError>,
    pub retry_count: u32,
    pub max_retries: u32,
    pub file_name: String,
}

impl TransferTask {
    fn new_upload(server_id: &str, local_path: &str, remote_path: &str) -> Self {
        let file_name = std::path::Path::new(local_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| local_path.to_string());
        Self {
            id: Uuid::new_v4().to_string(),
            direction: TransferDirection::Upload,
            server_id: server_id.to_string(),
            local_path: local_path.to_string(),
            remote_path: PathResolver::normalize(remote_path),
            total_bytes: 0,
            transferred_bytes: 0,
            status: TransferStatus::Pending,
            error: None,
            retry_count: 0,
            max_retries: 3,
            file_name,
        }
    }

    fn new_download(server_id: &str, remote_path: &str, local_path: &str) -> Self {
        let file_name = PathResolver::normalize(remote_path)
            .rsplit('/')
            .next()
            .unwrap_or(remote_path)
            .to_string();
        Self {
            id: Uuid::new_v4().to_string(),
            direction: TransferDirection::Download,
            server_id: server_id.to_string(),
            local_path: local_path.to_string(),
            remote_path: PathResolver::normalize(remote_path),
            total_bytes: 0,
            transferred_bytes: 0,
            status: TransferStatus::Pending,
            error: None,
            retry_count: 0,
            max_retries: 3,
            file_name,
        }
    }
}

/// 传输管理器
///
/// 单例，管理所有 Windows 传输任务的生命周期。
/// 并发控制默认 2，可通过 set_concurrency 调整。
pub struct TransferManager {
    tasks: Mutex<HashMap<String, TransferTask>>,
    cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
    semaphore: Mutex<Arc<Semaphore>>,
    concurrency: Mutex<usize>,
}

impl TransferManager {
    /// 获取全局单例
    pub fn global() -> &'static TransferManager {
        static INSTANCE: OnceLock<TransferManager> = OnceLock::new();
        INSTANCE.get_or_init(|| TransferManager {
            tasks: Mutex::new(HashMap::new()),
            cancel_flags: Mutex::new(HashMap::new()),
            semaphore: Mutex::new(Arc::new(Semaphore::new(2))),
            concurrency: Mutex::new(2),
        })
    }

    /// 设置并发数
    pub async fn set_concurrency(&self, n: usize) {
        if n == 0 {
            return;
        }
        let mut concurrency = self.concurrency.lock().await;
        *concurrency = n;
        let mut semaphore = self.semaphore.lock().await;
        *semaphore = Arc::new(Semaphore::new(n));
    }

    /// 提交上传任务，返回 task_id
    pub async fn submit_upload(
        &self,
        server_id: &str,
        local_path: &str,
        remote_path: &str,
    ) -> String {
        let task = TransferTask::new_upload(server_id, local_path, remote_path);
        let task_id = task.id.clone();
        let cancel_flag = Arc::new(AtomicBool::new(false));

        self.tasks.lock().await.insert(task_id.clone(), task);
        self.cancel_flags.lock().await.insert(task_id.clone(), cancel_flag.clone());

        tracing::info!(
            "[TransferManager] upload submitted: id={} local={} remote={}",
            task_id, local_path, remote_path
        );

        task_id
    }

    /// 提交下载任务，返回 task_id
    pub async fn submit_download(
        &self,
        server_id: &str,
        remote_path: &str,
        local_path: &str,
    ) -> String {
        let task = TransferTask::new_download(server_id, remote_path, local_path);
        let task_id = task.id.clone();
        let cancel_flag = Arc::new(AtomicBool::new(false));

        self.tasks.lock().await.insert(task_id.clone(), task);
        self.cancel_flags.lock().await.insert(task_id.clone(), cancel_flag.clone());

        tracing::info!(
            "[TransferManager] download submitted: id={} remote={} local={}",
            task_id, remote_path, local_path
        );

        task_id
    }

    /// 获取取消标志
    pub async fn get_cancel_flag(&self, task_id: &str) -> Option<Arc<AtomicBool>> {
        self.cancel_flags.lock().await.get(task_id).cloned()
    }

    /// 获取任务状态
    pub async fn get_task(&self, task_id: &str) -> Option<TransferTask> {
        self.tasks.lock().await.get(task_id).cloned()
    }

    /// 列出所有任务
    pub async fn list_tasks(&self) -> Vec<TransferTask> {
        self.tasks.lock().await.values().cloned().collect()
    }

    /// 更新任务进度
    pub async fn update_progress(&self, task_id: &str, transferred: u64, total: u64) {
        if let Some(task) = self.tasks.lock().await.get_mut(task_id) {
            task.transferred_bytes = transferred;
            if total > 0 {
                task.total_bytes = total;
            }
        }
    }

    /// 标记任务为运行中
    pub async fn mark_running(&self, task_id: &str) {
        if let Some(task) = self.tasks.lock().await.get_mut(task_id) {
            task.status = TransferStatus::Running;
        }
    }

    /// 标记任务完成
    pub async fn mark_completed(&self, task_id: &str) {
        if let Some(task) = self.tasks.lock().await.get_mut(task_id) {
            task.status = TransferStatus::Completed;
            task.transferred_bytes = task.total_bytes;
            tracing::info!(
                "[TransferManager] task completed: id={} file={}",
                task_id, task.file_name
            );
        }
        self.cancel_flags.lock().await.remove(task_id);
        self.prune_finished_if_oversized().await;
    }

    /// 标记任务失败
    pub async fn mark_failed(&self, task_id: &str, error: TransferError) {
        let is_retryable = error.is_retryable();
        if let Some(task) = self.tasks.lock().await.get_mut(task_id) {
            task.error = Some(error.clone());
            if is_retryable && task.retry_count < task.max_retries {
                task.retry_count += 1;
                tracing::warn!(
                    "[TransferManager] task failed (will retry {}/{}): id={} error={}",
                    task.retry_count, task.max_retries, task_id, error
                );
            } else {
                task.status = TransferStatus::Failed;
                tracing::error!(
                    "[TransferManager] task failed (final): id={} error={}",
                    task_id, error
                );
            }
        }
        if !is_retryable {
            self.cancel_flags.lock().await.remove(task_id);
            self.prune_finished_if_oversized().await;
        }
    }

    /// 取消任务
    pub async fn cancel(&self, task_id: &str) -> bool {
        let found = if let Some(flag) = self.cancel_flags.lock().await.get(task_id) {
            flag.store(true, Ordering::Relaxed);
            true
        } else {
            false
        };
        if found {
            if let Some(task) = self.tasks.lock().await.get_mut(task_id) {
                task.status = TransferStatus::Canceled;
            }
            tracing::info!("[TransferManager] task canceled: id={}", task_id);
            self.prune_finished_if_oversized().await;
        }
        found
    }

    /// 清理已完成/失败/取消的任务
    pub async fn clear_finished(&self) {
        let mut tasks = self.tasks.lock().await;
        let mut flags = self.cancel_flags.lock().await;
        tasks.retain(|id, task| {
            let keep = !matches!(
                task.status,
                TransferStatus::Completed | TransferStatus::Failed | TransferStatus::Canceled
            );
            if !keep {
                flags.remove(id);
            }
            keep
        });
    }

    /// Keep terminal task state observable for normal callers, while bounding
    /// the process-global map during long-running sessions.
    async fn prune_finished_if_oversized(&self) {
        const MAX_RETAINED_TASKS: usize = 1024;
        let oversized = self.tasks.lock().await.len() > MAX_RETAINED_TASKS;
        if oversized {
            self.clear_finished().await;
        }
    }

    /// 获取当前重试次数
    pub async fn get_retry_count(&self, task_id: &str) -> u32 {
        self.tasks
            .lock()
            .await
            .get(task_id)
            .map(|t| t.retry_count)
            .unwrap_or(0)
    }

    /// 获取最大重试次数
    pub async fn get_max_retries(&self, task_id: &str) -> u32 {
        self.tasks
            .lock()
            .await
            .get(task_id)
            .map(|t| t.max_retries)
            .unwrap_or(3)
    }

    /// 获取并发许可（等待可用槽位）
    pub async fn acquire_permit(&self) -> tokio::sync::OwnedSemaphorePermit {
        let semaphore = self.semaphore.lock().await.clone();
        semaphore
            .acquire_owned()
            .await
            .expect("semaphore closed unexpectedly")
    }

    /// 计算重试退避时间（指数退避：1s, 2s, 4s）
    pub fn retry_backoff(retry_count: u32) -> Duration {
        Duration::from_millis(1000u64 * 2u64.pow(retry_count))
    }
}
