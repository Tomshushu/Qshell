//! Linux 系统指标采集
//!
//! 从 commands/metrics.rs 抽取 Linux 专用逻辑：
//! - 采集流程：缓存网卡/磁盘列表 -> 并发执行 SSH 命令 -> 构造 rawOutputs JSON
//! - Windows 的 `collect_windows_metrics` 保留在 commands/metrics.rs

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// 服务器上下文缓存（网卡列表 + 物理磁盘列表）
#[derive(Debug, Clone)]
pub struct ServerContext {
    pub interfaces: Vec<String>,
    pub physical_disks: Vec<String>,
    pub last_refresh_ms: u64,
}

/// 全局服务器上下文缓存
static SERVER_CACHE: std::sync::OnceLock<Mutex<HashMap<String, ServerContext>>> =
    std::sync::OnceLock::new();

fn server_cache() -> &'static Mutex<HashMap<String, ServerContext>> {
    SERVER_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

const MAX_CACHE_SIZE: usize = 100;
const CACHE_TTL_MS: u64 = 5 * 60 * 1000; // 5 分钟

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// 在 SSH 上执行命令并返回 stdout 字符串（失败返回空字符串）
async fn ssh_exec_ok(server_id: &str, command: &str) -> String {
    match crate::ssh::manager::SshManager::global()
        .execute(server_id, command, 30)
        .await
    {
        Ok(out) => out.stdout,
        Err(_) => String::new(),
    }
}

/// 刷新（清空）服务器上下文缓存
pub fn clear_server_cache(server_id: &str) {
    let mut cache = server_cache().lock().unwrap_or_else(|e| e.into_inner());
    cache.remove(server_id);
}

/// 采集 Linux 系统指标
///
/// 返回 JSON 字符串（SystemMetrics）
///
/// 采集流程：
/// 1. 获取或刷新服务器上下文缓存（网卡列表 + 物理磁盘列表，5 分钟 TTL）
/// 2. 构建过滤参数
/// 3. 并发执行 4 个 SSH 命令采集 raw 数据
/// 4. 构造 rawOutputs JSON 传给 metrics::collect_metrics 做差分计算
pub async fn collect_metrics(server_id: String) -> Result<String, String> {
    // 1. 获取或刷新服务器上下文缓存
    // 注意：MutexGuard 不是 Send，不能跨 .await 持有
    let need_refresh = {
        let cache = server_cache().lock().unwrap_or_else(|e| e.into_inner());
        let now = now_ms();
        match cache.get(&server_id) {
            Some(ctx) => now - ctx.last_refresh_ms >= CACHE_TTL_MS,
            None => true,
        }
    };

    let (interfaces, physical_disks) = if need_refresh {
        // 缓存不存在或过期，重新获取
        let new_ctx = fetch_server_context(&server_id).await;
        // 更新缓存（短锁，不跨 await）
        {
            let mut cache = server_cache().lock().unwrap_or_else(|e| e.into_inner());
            if cache.len() >= MAX_CACHE_SIZE {
                if let Some(first_key) = cache.keys().next().cloned() {
                    cache.remove(&first_key);
                }
            }
            cache.insert(server_id.clone(), new_ctx.clone());
        }
        (new_ctx.interfaces, new_ctx.physical_disks)
    } else {
        // 缓存有效，直接读取
        let cache = server_cache().lock().unwrap_or_else(|e| e.into_inner());
        let ctx = cache.get(&server_id).expect("cache entry should exist");
        (ctx.interfaces.clone(), ctx.physical_disks.clone())
    };

    // 2. 构建过滤参数
    let iface_filter = if !interfaces.is_empty() {
        interfaces
            .iter()
            .map(|i| format!("-e '{}:'", i))
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        "-e ':".to_string()
    };
    let disk_filter = if !physical_disks.is_empty() {
        physical_disks
            .iter()
            .map(|d| format!("-e ' {} '", d))
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        "-E 'sd|vd|nvme'".to_string()
    };

    // 3. 并发采集 4 个 raw 数据源
    // 先构造命令字符串，避免在 tokio::join! 中产生临时值
    let disk_cmd = format!("cat /proc/diskstats 2>/dev/null | grep {}", disk_filter);
    let net_cmd = format!("cat /proc/net/dev 2>/dev/null | grep {}", iface_filter);
    let (core, disk_io, net, proc_full) = tokio::join!(
        ssh_exec_ok(
            &server_id,
            "cat /proc/stat | head -1 && cat /proc/loadavg && \
             cat /proc/meminfo && \
             df -Pk && \
             uname -a && cat /etc/os-release 2>/dev/null && uptime && \
             cat /proc/net/snmp | grep '^Tcp:' && \
             echo '::TCP_STATES::' && \
             awk 'NR > 1 {print $4}' /proc/net/tcp /proc/net/tcp6 2>/dev/null"
        ),
        ssh_exec_ok(&server_id, &disk_cmd),
        ssh_exec_ok(&server_id, &net_cmd),
        ssh_exec_ok(
            &server_id,
            "ps -eo state 2>/dev/null | sort | uniq -c | sort -rn && echo '::MOUNTS::' && cat /proc/mounts"
        ),
    );

    // 4. 拆分 proc 输出：进程状态 + /proc/mounts
    let (proc_states, mounts_raw) = {
        let parts: Vec<&str> = proc_full.split("::MOUNTS::").collect();
        (
            parts.first().unwrap_or(&"").to_string(),
            parts.get(1).unwrap_or(&"").to_string(),
        )
    };

    // 5. 构造 rawOutputs JSON
    let raw_outputs = serde_json::json!({
        "core": core,
        "diskIo": disk_io,
        "net": net,
        "proc": proc_states,
        "mounts": mounts_raw,
    })
    .to_string();

    // 6. 调用 metrics 模块做差分计算
    crate::metrics::metrics_collect(server_id, raw_outputs).await
}

/// 获取服务器的网卡列表和物理磁盘列表
async fn fetch_server_context(server_id: &str) -> ServerContext {
    let (iface_out, disk_out) = tokio::join!(
        ssh_exec_ok(server_id, "ls /sys/class/net/ 2>/dev/null | grep -v lo"),
        ssh_exec_ok(
            server_id,
            "for d in /sys/block/*/device; do dev=${d%/device}; basename \"$dev\"; done 2>/dev/null"
        ),
    );
    let interfaces = iface_out
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let physical_disks = disk_out
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    ServerContext {
        interfaces,
        physical_disks,
        last_refresh_ms: now_ms(),
    }
}
