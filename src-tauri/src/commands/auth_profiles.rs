// 全局身份凭证（Auth Profiles）commands（P1-11）
//
// 提供跨主机复用的用户名/密码/密钥/Agent 转发凭证管理：
//   auth_profiles_list / auth_profiles_add / auth_profiles_update / auth_profiles_delete

use crate::db;

use super::OperationResult;

/// 列出所有全局身份凭证（敏感密码/Passphrase 替换为占位符 "•••••"）
#[tauri::command]
pub async fn auth_profiles_list() -> Result<String, String> {
    tokio::task::spawn_blocking(db::auth_profiles_list)
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// 列出所有全局身份凭证（含解密后的敏感凭据，仅用于端到端加密云同步）
#[tauri::command]
pub async fn auth_profiles_list_for_sync() -> Result<String, String> {
    tokio::task::spawn_blocking(db::auth_profiles_list_for_sync)
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// 新增全局身份凭证，返回 `{ success: true, id }`
#[tauri::command]
pub async fn auth_profiles_add(profile: String) -> Result<OperationResult, String> {
    let result = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let input: db::AuthProfileInput = serde_json::from_str(&profile)
            .map_err(|e| format!("Invalid auth profile input: {}", e))?;
        db::auth_profiles_add(input)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    match result {
        Ok(id) => Ok(OperationResult::ok_with_id(id)),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 更新全局身份凭证（字段语义同 servers_update，占位符表示不修改），并联动断开引用该凭证的旧会话
#[tauri::command]
pub async fn auth_profiles_update(id: String, updates: String) -> Result<OperationResult, String> {
    let profile_id = id.clone();
    let result = tokio::task::spawn_blocking(move || -> Result<Vec<String>, String> {
        let update: db::AuthProfileUpdate = serde_json::from_str(&updates)
            .map_err(|e| format!("Invalid auth profile update: {}", e))?;
        db::auth_profiles_update(&profile_id, update)?;
        Ok(db::servers_ids_by_auth_profile(&profile_id).unwrap_or_default())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    match result {
        Ok(server_ids) => {
            let mgr = crate::ssh::manager::SshManager::global();
            for sid in server_ids {
                if mgr.has_server_or_child_connection_sync(&sid) {
                    let _ = mgr.disconnect(&sid).await;
                }
            }
            Ok(OperationResult::ok())
        }
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 删除全局身份凭证，并自动将关联服务器的 auth_profile_id 置空，同时联动断开相关会话
#[tauri::command]
pub async fn auth_profiles_delete(id: String) -> Result<OperationResult, String> {
    let result = tokio::task::spawn_blocking(move || -> Result<Vec<String>, String> {
        let affected_servers = db::servers_ids_by_auth_profile(&id).unwrap_or_default();
        db::auth_profiles_delete(&id)?;
        Ok(affected_servers)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    match result {
        Ok(server_ids) => {
            let mgr = crate::ssh::manager::SshManager::global();
            for sid in server_ids {
                if mgr.has_server_or_child_connection_sync(&sid) {
                    let _ = mgr.disconnect(&sid).await;
                }
            }
            Ok(OperationResult::ok())
        }
        Err(e) => Ok(OperationResult::fail(e)),
    }
}
