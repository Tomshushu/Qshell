// 服务器分组（树形目录）commands
//
// 对应前端 backend.serverGroups.list / add / update / delete
// 数据层实现见 db::server_groups_*

use crate::db;
use super::OperationResult;

/// 列出所有分组，返回 JSON 字符串（ServerGroup[]）
#[tauri::command]
pub async fn server_groups_list() -> Result<String, String> {
    tokio::task::spawn_blocking(db::server_groups_list)
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// 新建分组
/// group 参数为前端传来的 JSON 字符串（ServerGroupInput: { name, parentId? }）
/// 返回 { success: true, id }
#[tauri::command]
pub async fn server_groups_add(group: String) -> Result<OperationResult, String> {
    let result = tokio::task::spawn_blocking(move || db::server_groups_add(group))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    match result {
        Ok(id) => Ok(OperationResult::ok_with_id(id)),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 更新分组（重命名 / 移动到新父分组，含环检测）
/// updates 为 JSON 字符串（ServerGroupUpdate: { name?, parentId? }）
#[tauri::command]
pub async fn server_groups_update(
    id: String,
    updates: String,
) -> Result<OperationResult, String> {
    let result = tokio::task::spawn_blocking(move || db::server_groups_update(id, updates))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    match result {
        Ok(()) => Ok(OperationResult::ok()),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 删除分组（含子孙分组；组内服务器移出到根目录，不删除服务器）
#[tauri::command]
pub async fn server_groups_delete(id: String) -> Result<OperationResult, String> {
    let result = tokio::task::spawn_blocking(move || db::server_groups_delete(id))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    match result {
        Ok(()) => Ok(OperationResult::ok()),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}
