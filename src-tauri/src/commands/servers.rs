// 服务器管理 commands
//
// 对应 Electron 版 ipc.js 中的:
//   servers:list / servers:add / servers:update / servers:delete / servers:get
//
// 服务器导出/导入：
//   servers:export / servers:import
//
// 导出格式设计：
// - 不导出运行时状态字段（status / last_accessed_at / last_disconnected_at /
//   last_error / created_at / updated_at）
// - 不导出 id（导入时由 db::servers_add 生成新 UUID，避免冲突）
// - 密码/passphrase 字段：先用 master_key 解密为明文，再用 export_key 加密
// - 导入时：用 export_key 解密为明文，再用 master_key 加密入库
//
// 文件格式（JSON）：
// {
//   "format": "sw-ce-export",
//   "version": 1,
//   "exportedAt": 1719500000000,
//   "count": 5,
//   "crypto": { algorithm, salt, mCost, tCost, pCost, nonce, payload }
// }
//
// 其中 crypto.payload 是用 export_key 加密的明文 JSON 数组：
// [
//   {
//     "name": "...", "host": "...", "port": 22, "username": "...",
//     "authType": "password", "password": "明文", ...
//   }
// ]

use crate::crypto;
use crate::db;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

use super::{ImportResult, OperationResult};

/// 列出所有服务器（密码会被掩码为 "•••••"）
/// 返回 JSON 字符串，前端通过 JSON.parse 得到 Server[]
#[tauri::command]
pub async fn servers_list() -> Result<String, String> {
    // spawn_blocking 避免 SQLite I/O 阻塞 async runtime
    tokio::task::spawn_blocking(db::servers_list)
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// 新增服务器
/// server 参数为前端传来的 JSON 字符串（ServerInput）
/// 返回 { success: true, id }
#[tauri::command]
pub async fn servers_add(server: String) -> Result<OperationResult, String> {
    let result = tokio::task::spawn_blocking(move || db::servers_add(server))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    match result {
        Ok(id) => Ok(OperationResult::ok_with_id(id)),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 更新服务器配置
/// updates 为 JSON 字符串（ServerUpdate）
#[tauri::command]
pub async fn servers_update(
    id: String,
    updates: String,
) -> Result<OperationResult, String> {
    // 检测是否修改了连接相关字段。
    // 若修改了，需在 DB 更新后断开旧连接，避免后续 detectOsInfo/execute
    // 复用指向旧主机的连接（修复"修改服务器后图标/系统信息不更新"问题）。
    let connection_fields_changed = serde_json::from_str::<serde_json::Value>(&updates)
        .ok()
        .and_then(|v| v.as_object().cloned())
        .map(|obj| {
            obj.contains_key("host")
                || obj.contains_key("port")
                || obj.contains_key("username")
                || obj.contains_key("authType")
                || obj.contains_key("password")
                || obj.contains_key("privateKeyPath")
                || obj.contains_key("privateKeyPassphrase")
                || obj.contains_key("connectionTimeout")
                || obj.contains_key("targetType")
                || obj.contains_key("protocol")
        })
        .unwrap_or(false);

    let id_for_disconnect = id.clone();
    let result = tokio::task::spawn_blocking(move || {
        db::servers_update(id, updates)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;
    match result {
        Ok(()) => {
            // 连接相关字段变更：断开旧连接，确保后续操作使用新配置重连
            if connection_fields_changed
                && crate::ssh::manager::SshManager::global()
                    .is_connected_sync(&id_for_disconnect)
            {
                let _ = crate::ssh::manager::SshManager::global()
                    .disconnect(&id_for_disconnect)
                    .await;
            }
            Ok(OperationResult::ok())
        }
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 删除服务器
/// 同时清理 SSH 连接 and metrics 缓存
#[tauri::command]
pub async fn servers_delete(id: String) -> Result<OperationResult, String> {
    // 1. 删除数据库记录
    let id_for_cache = id.clone();
    let del_result = tokio::task::spawn_blocking(move || db::servers_delete(id))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    if let Err(e) = del_result {
        return Ok(OperationResult::fail(e));
    }

    // 2. 清理 metrics 缓存
    crate::metrics::metrics_refresh_cache(id_for_cache.clone())?;

    // 3. 断开 SSH 连接（如果存在）
    if crate::ssh::manager::SshManager::global().is_connected_sync(&id_for_cache) {
        let _ = crate::ssh::manager::SshManager::global()
            .disconnect(&id_for_cache)
            .await;
    }

    Ok(OperationResult::ok())
}

/// 列出回收站中的服务器（待删除）
#[tauri::command]
pub async fn servers_list_trash() -> Result<String, String> {
    tokio::task::spawn_blocking(db::servers_list_trash)
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// 恢复回收站中的服务器（原分组已删除则归入根分组）
#[tauri::command]
pub async fn servers_restore(id: String) -> Result<OperationResult, String> {
    let result = tokio::task::spawn_blocking(move || db::servers_restore(id))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    match result {
        Ok(()) => Ok(OperationResult::ok()),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 永久删除（物理清除）回收站中的服务器
#[tauri::command]
pub async fn servers_purge(id: String) -> Result<OperationResult, String> {
    let id_for_cache = id.clone();
    let result = tokio::task::spawn_blocking(move || db::servers_purge(id))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    if let Err(e) = result {
        return Ok(OperationResult::fail(e));
    }
    // 清理 metrics 缓存并断开连接
    crate::metrics::metrics_refresh_cache(id_for_cache.clone())?;
    if crate::ssh::manager::SshManager::global().is_connected_sync(&id_for_cache) {
        let _ = crate::ssh::manager::SshManager::global()
            .disconnect(&id_for_cache)
            .await;
    }
    Ok(OperationResult::ok())
}

/// 批量删除服务器（移入回收站）：单条 DB 操作完成，同时清理 metrics 缓存并断开连接。
#[tauri::command]
pub async fn servers_delete_batch(ids: Vec<String>) -> Result<OperationResult, String> {
    let ids_for_db = ids.clone();
    let del_result = tokio::task::spawn_blocking(move || db::servers_delete_batch(ids_for_db))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    if let Err(e) = del_result {
        return Ok(OperationResult::fail(e));
    }
    for id in &ids {
        let _ = crate::metrics::metrics_refresh_cache(id.clone());
        if crate::ssh::manager::SshManager::global().is_connected_sync(id) {
            let _ = crate::ssh::manager::SshManager::global().disconnect(id).await;
        }
    }
    Ok(OperationResult::ok())
}

/// 批量恢复回收站中的服务器（原分组已删除则归入根分组）
#[tauri::command]
pub async fn servers_restore_batch(ids: Vec<String>) -> Result<OperationResult, String> {
    let result = tokio::task::spawn_blocking(move || db::servers_restore_batch(ids))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    match result {
        Ok(()) => Ok(OperationResult::ok()),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 批量永久删除（物理清除）回收站中的服务器
#[tauri::command]
pub async fn servers_purge_batch(ids: Vec<String>) -> Result<OperationResult, String> {
    let ids_for_db = ids.clone();
    let result = tokio::task::spawn_blocking(move || db::servers_purge_batch(ids_for_db))
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    if let Err(e) = result {
        return Ok(OperationResult::fail(e));
    }
    for id in &ids {
        let _ = crate::metrics::metrics_refresh_cache(id.clone());
        if crate::ssh::manager::SshManager::global().is_connected_sync(id) {
            let _ = crate::ssh::manager::SshManager::global().disconnect(id).await;
        }
    }
    Ok(OperationResult::ok())
}

/// 清理超过 retention_days 天的回收站项，返回清理条数
#[tauri::command]
pub async fn servers_cleanup_trash(retention_days: i64) -> Result<u64, String> {
    tokio::task::spawn_blocking(move || db::servers_cleanup_trash(retention_days))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// 获取单个服务器（密码会被掩码）
#[tauri::command]
pub async fn servers_get(id: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || db::servers_get(id))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

// ============================================================================
// 服务器导出/导入
// ============================================================================

/// 导出文件格式标识
const EXPORT_FORMAT: &str = "sw-ce-export";
const EXPORT_VERSION: u32 = 1;

/// 导出文件 envelope（写入文件的顶层结构）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportEnvelope {
    format: String,
    version: u32,
    exported_at: i64,
    count: usize,
    crypto: crypto::ExportCryptData,
}

/// 导出 payload 中的单条服务器记录（明文 JSON）
///
/// 与 db::Server 的区别：
/// - 不含 id / created_at / updated_at / status / last_accessed_at 等运行时字段
/// - password / private_key_passphrase 为明文（已用 master_key 解密）
/// - tags 为数组（而非数据库存储的 JSON 字符串）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportServer {
    name: String,
    host: String,
    port: i32,
    username: String,
    auth_type: String,
    /// 明文密码（如有）
    #[serde(skip_serializing_if = "Option::is_none")]
    password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    private_key_path: Option<String>,
    /// 明文 passphrase（如有）
    #[serde(skip_serializing_if = "Option::is_none")]
    private_key_passphrase: Option<String>,
    /// SSH Agent 指定身份（OpenSSH 公钥字符串，明文 — 公钥本身不敏感）
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_identity: Option<String>,
    /// OpenSSH 证书文件路径
    #[serde(skip_serializing_if = "Option::is_none")]
    certificate_path: Option<String>,
    /// tags 转为字符串数组（与前端 Server.tags 一致）
    tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
    connection_timeout: i32,
    favorite: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    os_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    os_info: Option<String>,
    /// 连接目标类型（linux/windows/...），旧导出文件缺省时回退 linux
    #[serde(default = "default_export_target_type")]
    target_type: String,
    /// 连接协议（ssh/...），旧导出文件缺省时回退 ssh
    #[serde(default = "default_export_protocol")]
    protocol: String,
    /// 用户启用的协议列表
    #[serde(default = "default_export_protocols")]
    protocols: String,
    /// RDP 端口，默认 3389
    #[serde(default = "default_export_rdp_port")]
    rdp_port: i32,
    /// BMC Redfish HTTPS 端口，默认 443
    #[serde(default = "default_export_bmc_port")]
    bmc_port: i32,
    /// 关联的密钥库记录 ID
    #[serde(skip_serializing_if = "Option::is_none")]
    ssh_key_id: Option<String>,
    /// 私钥文件内容（明文）
    #[serde(skip_serializing_if = "Option::is_none")]
    private_key_content: Option<String>,
    /// 证书文件内容（明文）
    #[serde(skip_serializing_if = "Option::is_none")]
    certificate_content: Option<String>,
    /// 内联代理配置（数据库读取时已解密）
    #[serde(skip_serializing_if = "Option::is_none")]
    proxy_config: Option<String>,
    /// 内联隧道配置
    #[serde(skip_serializing_if = "Option::is_none")]
    tunnels_config: Option<String>,
    /// 内联密钥库配置
    #[serde(skip_serializing_if = "Option::is_none")]
    keys_config: Option<String>,
    /// 串口连接配置
    #[serde(skip_serializing_if = "Option::is_none")]
    serial_config: Option<String>,
    /// 所属分组路径（从根到直接父分组的名称链，用于跨机器还原分组结构）
    #[serde(skip_serializing_if = "Option::is_none")]
    group_path: Option<Vec<String>>,
}

fn default_export_target_type() -> String {
    "linux".to_string()
}

fn default_export_protocol() -> String {
    "ssh".to_string()
}

fn default_export_protocols() -> String {
    "[\"ssh\"]".to_string()
}

fn default_export_rdp_port() -> i32 {
    3389
}

fn default_export_bmc_port() -> i32 {
    443
}

/// 解析 db::Server.tags 字段（数据库存储为 JSON 字符串）
fn parse_tags(tags_json: &str) -> Vec<String> {
    serde_json::from_str(tags_json).unwrap_or_default()
}

/// 计算每个分组的名称路径（根 → 该分组），用于导出 group_path
fn build_group_paths(groups: &[db::ServerGroup]) -> std::collections::HashMap<String, Vec<String>> {
    let by_id: std::collections::HashMap<&str, &db::ServerGroup> =
        groups.iter().map(|g| (g.id.as_str(), g)).collect();
    let mut paths = std::collections::HashMap::new();
    for group in groups {
        let mut path = vec![group.name.clone()];
        let mut cur = group.parent_id.as_deref();
        // 沿父链上溯（带环保护，正常数据不会成环）
        let mut depth = 0;
        while let Some(pid) = cur {
            if depth > 64 {
                break;
            }
            depth += 1;
            match by_id.get(pid) {
                Some(parent) => {
                    path.push(parent.name.clone());
                    cur = parent.parent_id.as_deref();
                }
                None => break,
            }
        }
        path.reverse();
        paths.insert(group.id.clone(), path);
    }
    paths
}

/// 将 db::Server 转换为 ExportServer（解密敏感字段）
/// groups_paths: 分组 ID → 名称路径（根 → 该分组）
fn to_export_server(
    server: &db::Server,
    groups_paths: &std::collections::HashMap<String, Vec<String>>,
) -> Result<ExportServer, String> {
    let mk = db::master_key();

    let password = match &server.password {
        Some(encrypted) if !encrypted.is_empty() => {
            Some(crypto::decrypt_password(encrypted, mk).map_err(|e| format!("Failed to decrypt password: {}", e))?)
        }
        _ => None,
    };

    let passphrase = match &server.private_key_passphrase {
        Some(encrypted) if !encrypted.is_empty() => {
            Some(crypto::decrypt_password(encrypted, mk).map_err(|e| format!("Failed to decrypt passphrase: {}", e))?)
        }
        _ => None,
    };

    Ok(ExportServer {
        name: server.name.clone(),
        host: server.host.clone(),
        port: server.port,
        username: server.username.clone(),
        auth_type: server.auth_type.clone(),
        password,
        private_key_path: server.private_key_path.clone(),
        private_key_passphrase: passphrase,
        agent_identity: server.agent_identity.clone(),
        certificate_path: server.certificate_path.clone(),
        tags: parse_tags(&server.tags),
        notes: server.notes.clone(),
        connection_timeout: server.connection_timeout,
        favorite: server.favorite,
        os_type: server.os_type.clone(),
        os_info: server.os_info.clone(),
        target_type: server.target_type.clone(),
        protocol: server.protocol.clone(),
        protocols: server.protocols.clone(),
        rdp_port: server.rdp_port,
        bmc_port: server.bmc_port,
        ssh_key_id: server.ssh_key_id.clone(),
        private_key_content: None,
        certificate_content: None,
        proxy_config: server.proxy_config.clone(),
        tunnels_config: server.tunnels_config.clone(),
        keys_config: server.keys_config.clone(),
        serial_config: server.serial_config.clone(),
        group_path: server.group_id.as_ref().and_then(|gid| groups_paths.get(gid)).cloned(),
    })
}

/// 导出服务器列表到加密 JSON 文件
///
/// - `file_path`: 用户选择的保存路径
/// - `ids`: 要导出的服务器 id 列表（空数组 = 导出全部）
/// - `password`: 导出密码（用户记忆，用于派生 export_key）
///
/// 流程：
/// 1. 从数据库读取原始服务器（含密文密码）
/// 2. 用 master_key 解密密码为明文
/// 3. 序列化为 JSON payload
/// 4. 用 export_key (argon2id 派生) + AES-256-GCM 加密 payload
/// 5. 写入文件
#[tauri::command]
pub async fn servers_export(
    file_path: String,
    ids: Vec<String>,
    password: String,
) -> Result<OperationResult, String> {
    if password.is_empty() {
        return Ok(OperationResult::fail("Export password cannot be empty"));
    }
    if file_path.trim().is_empty() {
        return Ok(OperationResult::fail("File path cannot be empty"));
    }

    // 自有备份只使用一种文件格式：加密 JSON。
    let final_path = ensure_extension(&file_path, "json");
    let final_path_for_closure = final_path.clone();

    let result = tokio::task::spawn_blocking(move || -> Result<(), String> {
        // 1. 读取所有原始服务器
        let raw_json = db::servers_list_raw()?;
        let all_servers: Vec<db::Server> = serde_json::from_str(&raw_json)
            .map_err(|e| format!("Failed to parse server list: {}", e))?;

        // 1.5 读取分组表，构建 分组 ID → 名称路径 映射（导出 group_path 用）
        let groups_json = db::server_groups_list()?;
        let groups: Vec<db::ServerGroup> = serde_json::from_str(&groups_json)
            .map_err(|e| format!("Failed to parse group list: {}", e))?;
        let groups_paths = build_group_paths(&groups);

        // 2. 按 ids 过滤
        let id_set: HashSet<String> = ids.into_iter().collect();
        let selected: Vec<&db::Server> = if id_set.is_empty() {
            all_servers.iter().collect()
        } else {
            all_servers.iter().filter(|s| id_set.contains(&s.id)).collect()
        };

        if selected.is_empty() {
            return Err("No servers available for export".to_string());
        }

        // 3. 转换为 ExportServer（解密密码为明文）
        let export_servers: Vec<ExportServer> = selected
            .iter()
            .map(|s| to_export_server(s, &groups_paths))
            .collect::<Result<_, _>>()?;

        // 4. 序列化明文 payload
        let payload = serde_json::to_string(&export_servers)
            .map_err(|e| format!("Failed to serialize export data: {}", e))?;

        // 5. 加密 payload
        let crypt_data = crypto::encrypt_export(&payload, &password)
            .map_err(|e| format!("Failed to encrypt export data: {}", e))?;

        // 6. 构造 envelope
        let envelope = ExportEnvelope {
            format: EXPORT_FORMAT.to_string(),
            version: EXPORT_VERSION,
            exported_at: Utc::now().timestamp_millis(),
            count: export_servers.len(),
            crypto: crypt_data,
        };

        // 7. 写入文件
        let json = serde_json::to_string_pretty(&envelope)
            .map_err(|e| format!("Failed to serialize export file: {}", e))?;
        std::fs::write(&final_path_for_closure, json)
            .map_err(|e| format!("Failed to write file: {}", e))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    match result {
        Ok(()) => Ok(OperationResult::ok_with_message(format!("Successfully exported to {}", final_path))),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 从本产品导出的加密 JSON 文件导入服务器列表
///
/// - `file_path`: 用户选择的导入文件路径
/// - `password`: 导出时使用的密码
///
/// 流程：
/// 1. 读取并解析文件为 ExportEnvelope
/// 2. 用 export_key (argon2id 派生) + AES-256-GCM 解密 payload
/// 3. 反序列化为 ExportServer 列表
/// 4. 对每条记录调用 db::servers_add（自动用 master_key 加密密码）
/// 5. 返回导入统计
#[tauri::command]
pub async fn servers_import(
    file_path: String,
    password: String,
) -> Result<ImportResult, String> {
    if file_path.trim().is_empty() {
        return Ok(ImportResult::fail("File path cannot be empty"));
    }
    if Path::new(&file_path)
        .extension()
        .and_then(|value| value.to_str())
        .map_or(true, |value| !value.eq_ignore_ascii_case("json"))
    {
        return Ok(ImportResult::fail(
            "Only Qshell .json backup files are supported",
        ));
    }
    if password.is_empty() {
        return Ok(ImportResult::fail("Export password cannot be empty"));
    }

    let result = tokio::task::spawn_blocking(move || -> Result<ImportResult, String> {
        // 1. 读取文件
        let metadata = std::fs::metadata(&file_path)
            .map_err(|e| format!("Failed to stat import file: {}", e))?;
        if !metadata.is_file() || metadata.len() > 16 * 1024 * 1024 {
            return Err("Import file must be a regular file no larger than 16 MiB".to_string());
        }
        let content = std::fs::read_to_string(&file_path)
            .map_err(|e| format!("Failed to read file: {}", e))?;

        // 2. 自有导入只接受本产品生成的加密 JSON envelope。
        let envelope: ExportEnvelope = serde_json::from_str(&content)
            .map_err(|e| format!("Invalid Qshell JSON backup: {}", e))?;
        if envelope.format != EXPORT_FORMAT {
            return Ok(ImportResult::fail(format!(
                "File format error: expected '{}', got '{}'",
                EXPORT_FORMAT, envelope.format
            )));
        }
        if envelope.version != EXPORT_VERSION {
            return Ok(ImportResult::fail(format!(
                "Unsupported version: expected {}, got {}",
                EXPORT_VERSION, envelope.version
            )));
        }

        // 3. 解密 payload。
        let plaintext = crypto::decrypt_export(&envelope.crypto, &password)
            .map_err(|e| format!("Failed to decrypt (incorrect password or corrupted file): {}", e))?;
        let servers: Vec<ExportServer> = serde_json::from_str(&plaintext)
            .map_err(|e| format!("Failed to parse server list: {}", e))?;

        let total = servers.len();
        let mut imported = 0;
        let mut skipped = 0;
        let mut errors = Vec::new();
        let mut imported_ids = Vec::new();

        // 5. 逐条导入（Xshell/FinalShell 模式：密钥直接随服务器存储与内联关联）
        for (idx, server) in servers.into_iter().enumerate() {
            // 如果服务器自带 keys_config 则直接复用；若无但配置了私钥/证书，则自动构建该服务器下的 authKeys
            let keys_config = if let Some(ref kc) = server.keys_config {
                if !kc.trim().is_empty() {
                    Some(kc.clone())
                } else {
                    None
                }
            } else if server.private_key_path.as_ref().map(|p| !p.trim().is_empty()).unwrap_or(false)
                || server.private_key_content.as_ref().map(|c| !c.trim().is_empty()).unwrap_or(false)
            {
                let file_name = server.private_key_path.as_deref()
                    .and_then(|p| Path::new(p).file_name())
                    .and_then(|n| n.to_str())
                    .unwrap_or("默认私钥");
                let key_name = file_name.replace(".pem", "").replace(".key", "");
                let key_type = if server.auth_type == "certificate" || server.certificate_path.is_some() {
                    "certificate"
                } else {
                    "private"
                };
                let keys_arr = serde_json::json!([
                    {
                        "id": format!("key-{}", uuid::Uuid::new_v4()),
                        "name": key_name,
                        "keyType": key_type,
                        "privateKeyPath": server.private_key_path,
                        "privateKeyContent": server.private_key_content,
                        "passphrase": server.private_key_passphrase,
                        "certificatePath": server.certificate_path,
                        "certificateContent": server.certificate_content,
                        "createdAt": Utc::now().timestamp_millis()
                    }
                ]);
                Some(keys_arr.to_string())
            } else {
                None
            };

            // 还原分组结构：按名称路径查找或创建分组（不存在则逐级创建）
            let group_id = match &server.group_path {
                Some(path) if !path.is_empty() => db::server_groups_find_or_create_by_path(path).ok(),
                _ => None,
            };

            // 构造 ServerInput JSON（与 db::servers_add 接受的格式一致）
            let input = serde_json::json!({
                "name": server.name,
                "host": server.host,
                "port": server.port,
                "username": server.username,
                "authType": server.auth_type,
                "password": server.password,
                "privateKeyPath": server.private_key_path,
                "privateKeyPassphrase": server.private_key_passphrase,
                "agentIdentity": server.agent_identity,
                "certificatePath": server.certificate_path,
                // tags 转回 JSON 字符串（数据库存储格式）
                "tags": serde_json::to_string(&server.tags).unwrap_or_else(|_| "[]".to_string()),
                "notes": server.notes,
                "connectionTimeout": server.connection_timeout,
                "favorite": server.favorite,
                "status": "unknown",
                "osType": server.os_type,
                "osInfo": server.os_info,
                "targetType": server.target_type,
                "protocol": server.protocol,
                "protocols": server.protocols,
                "rdpPort": server.rdp_port,
                "bmcPort": server.bmc_port,
                "sshKeyId": server.ssh_key_id,
                "proxyConfig": server.proxy_config,
                "tunnelsConfig": server.tunnels_config,
                "keysConfig": keys_config,
                "serialConfig": server.serial_config,
                "groupId": group_id,
            });
            let input_str = input.to_string();

            match db::servers_add(input_str) {
                Ok(id) => {
                    imported += 1;
                    imported_ids.push(id);
                }
                Err(e) => {
                    skipped += 1;
                    errors.push(format!(
                        "Server {} ({}) failed to import: {}",
                        idx + 1,
                        input["name"].as_str().unwrap_or("<Unknown>"),
                        e
                    ));
                }
            }
        }

        Ok(ImportResult {
            success: true,
            total,
            imported,
            skipped,
            errors,
            error: None,
            imported_ids,
        })
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    // closure 返回 Result<ImportResult, String>：
    // - Ok(ImportResult): 业务结果（可能是 success=true 部分成功，或 success=false 致命错误）
    // - Err(String): closure 内部 ? 操作抛出的系统错误（如文件读取失败）
    match result {
        Ok(r) => Ok(r),
        Err(e) => Ok(ImportResult::fail(e)),
    }
}

/// 确保路径包含指定扩展名（无扩展名或扩展名不同时自动追加）
fn ensure_extension(path: &str, ext: &str) -> String {
    let p = Path::new(path);
    match p.extension().and_then(|e| e.to_str()) {
        Some(existing) if existing.eq_ignore_ascii_case(ext) => path.to_string(),
        _ => p.with_extension(ext).to_string_lossy().into_owned(),
    }
}
