// SSH 密钥管理 commands
//
// 对应前端 store 中的 sshKey CRUD 操作：
//   ssh_keys:list / ssh_keys:add / ssh_keys:update / ssh_keys:delete
//
// 数据安全：
// - private_key_content / certificate_content / private_key_passphrase 在 DB 中加密存储
// - list 命令返回时：passphrase 替换为占位符 "•••••"，content 字段不返回（skip_serializing）
// - 前端编辑时若 passphrase 为占位符则视为"不修改"
//
// 阶段 2：表结构 + 加密存储 + CRUD API，但 SSH 连接仍走路径（阶段 3 改为内容）
// 阶段 3：connection.rs / manager.rs 改用 ssh_keys_get_raw 读取解密后的 content 进行连接

use crate::db;
use serde_json::Value;

use super::OperationResult;

/// 列出所有 SSH 密钥
/// 返回 JSON 字符串，前端通过 JSON.parse 得到 SshKey[]
/// - passphrase 字段会被替换为占位符 "•••••"（如有）
/// - private_key_content / certificate_content 不返回（敏感数据）
#[tauri::command]
pub async fn ssh_keys_list() -> Result<String, String> {
    tokio::task::spawn_blocking(db::ssh_keys_list)
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// 新增 SSH 密钥
/// key 参数为前端传来的 JSON 字符串（SshKeyInput）
/// 返回 { success: true, id }
#[tauri::command]
pub async fn ssh_keys_add(key: String) -> Result<OperationResult, String> {
    let result = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let input: db::SshKeyInput = serde_json::from_str(&key)
            .map_err(|e| format!("Invalid ssh key input: {}", e))?;
        db::ssh_keys_add(input)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;
    match result {
        Ok(id) => Ok(OperationResult::ok_with_id(id)),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 更新 SSH 密钥
/// updates 为 JSON 字符串（SshKeyUpdate）
/// 返回 { success: true }
#[tauri::command]
pub async fn ssh_keys_update(id: String, updates: String) -> Result<OperationResult, String> {
    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        let update: db::SshKeyUpdate = serde_json::from_str(&updates)
            .map_err(|e| format!("Invalid ssh key update: {}", e))?;
        db::ssh_keys_update(&id, update)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;
    match result {
        Ok(()) => Ok(OperationResult::ok()),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 删除 SSH 密钥
#[tauri::command]
pub async fn ssh_keys_delete(id: String) -> Result<OperationResult, String> {
    let result = tokio::task::spawn_blocking(move || db::ssh_keys_delete(&id))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    match result {
        Ok(()) => Ok(OperationResult::ok()),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 读取本地文件内容（用于阶段 3：选完私钥/证书文件后读取内容入库）
/// 返回文件内容字符串
#[tauri::command]
pub async fn ssh_keys_read_file_content(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let p = std::path::Path::new(&path);
        let meta = std::fs::metadata(p).map_err(|e| format!("Failed to stat file '{}': {}", path, e))?;
        if !meta.is_file() || meta.len() > 4 * 1024 * 1024 {
            return Err("SSH key file must be a regular file no larger than 4 MiB".to_string());
        }
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_ascii_lowercase();
        let allowed = name.contains("id_") || name.ends_with(".pub") || name.ends_with(".pem") || name.ends_with(".ppk") || name.ends_with(".key");
        if !allowed {
            return Err("File does not look like an SSH key or certificate".to_string());
        }
        std::fs::read_to_string(p)
            .map_err(|e| format!("Failed to read file '{}': {}", path, e))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// 读取本地文件内容为 JSON Value，供前端调用方使用
/// （保留以兼容未来扩展场景，当前未在前端直接使用）
#[allow(dead_code)]
pub(crate) async fn read_file_content_json(path: &str) -> Result<Value, String> {
    let content = ssh_keys_read_file_content(path.to_string()).await?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse JSON: {}", e))
}
