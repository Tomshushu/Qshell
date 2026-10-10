// 系统指标采集 commands（路由层）
//
// 对应 Electron 版 ipc.js 中的:
//   metrics:collect / metrics:refreshCache
//
// 按 target_type 分发：
// - Linux/Unix/信创：调用 targets::linux::metrics（读取 /proc/* 等）
// - Windows：调用 targets::windows::metrics（PowerShell + WMI）

use super::OperationResult;

/// 采集系统指标
///
/// 返回 JSON 字符串（SystemMetrics）
#[tauri::command]
pub async fn metrics_collect(
    server_id: String,
) -> Result<String, String> {
    // 按目标类型分发
    let target_type = crate::commands::ssh::load_server_config(&server_id)
        .await
        .map(|s| s.target_type)
        .unwrap_or_else(|_| "linux".to_string());
    if target_type.eq_ignore_ascii_case("windows") {
        return crate::targets::windows::metrics::collect_metrics(server_id).await;
    }

    // === Linux/Unix/信创 ===
    crate::targets::linux::metrics::collect_metrics(server_id).await
}

/// 刷新（清空）服务器上下文缓存和 metrics 差分缓存
#[tauri::command]
pub async fn metrics_refresh_cache(server_id: String) -> Result<OperationResult, String> {
    // 按目标类型分发，清空对应平台的缓存
    let target_type = crate::commands::ssh::load_server_config(&server_id)
        .await
        .map(|s| s.target_type)
        .unwrap_or_else(|_| "linux".to_string());
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::metrics::clear_server_cache(&server_id);
    } else {
        crate::targets::linux::metrics::clear_server_cache(&server_id);
    }
    crate::metrics::metrics_refresh_cache(server_id)?;
    Ok(OperationResult::ok())
}
