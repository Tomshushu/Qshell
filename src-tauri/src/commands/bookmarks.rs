// 书签管理 commands
//
// 对应 Electron 版 ipc.js 中的:
//   bookmarks:list / bookmarks:add / bookmarks:delete

use crate::db;

use super::OperationResult;

/// 列出指定服务器的所有书签
#[tauri::command]
pub async fn bookmarks_list(server_id: String) -> Result<String, String> {
    let base_id = crate::commands::extract_base_server_id(&server_id).to_string();
    tokio::task::spawn_blocking(move || db::bookmarks_list(base_id))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// 新增书签
#[tauri::command]
pub async fn bookmarks_add(
    server_id: String,
    path: String,
    alias: String,
) -> Result<OperationResult, String> {
    let base_id = crate::commands::extract_base_server_id(&server_id).to_string();
    let result = tokio::task::spawn_blocking(move || {
        db::bookmarks_add(base_id, path, alias)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;
    match result {
        Ok(id) => Ok(OperationResult::ok_with_id(id)),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 删除书签
#[tauri::command]
pub async fn bookmarks_delete(id: String) -> Result<OperationResult, String> {
    let result = tokio::task::spawn_blocking(move || db::bookmarks_delete(id))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    match result {
        Ok(()) => Ok(OperationResult::ok()),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 列出全部书签（用于云端同步备份）
#[tauri::command]
pub async fn bookmarks_list_all() -> Result<String, String> {
    tokio::task::spawn_blocking(db::bookmarks_list_all)
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// 批量还原书签（用于云端同步恢复）
#[tauri::command]
pub async fn bookmarks_restore(items: Vec<db::LogBookmark>) -> Result<OperationResult, String> {
    let result = tokio::task::spawn_blocking(move || db::bookmarks_restore(items))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    match result {
        Ok(count) => Ok(OperationResult::ok_with_message(format!("已恢复 {} 条书签", count))),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}
