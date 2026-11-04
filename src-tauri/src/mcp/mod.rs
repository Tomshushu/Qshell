// src-tauri/src/mcp/mod.rs
//
// Qshell MCP 模块入口与 Tauri Command 绑定
// 支持动态状态查询、Token 重置、按主机显式授权与服务开关

pub mod auth;
pub mod guard;
pub mod lease;
pub mod server;
pub mod types;

use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

use auth::AuthManager;
use lease::LeaseManager;
use server::McpServer;
use types::McpStatus;

static MCP_AUTH: OnceLock<AuthManager> = OnceLock::new();
static MCP_LEASES: OnceLock<LeaseManager> = OnceLock::new();
static MCP_SERVER: OnceLock<McpServer> = OnceLock::new();

/// 初始化 MCP 模块并按配置自启 127.0.0.1 本地端点
pub fn init_mcp(app: &AppHandle) {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."));

    let auth = AuthManager::new(app_data_dir);
    let leases = LeaseManager::new();
    let server = McpServer::new(auth.clone(), leases.clone());

    server.start();

    let _ = MCP_AUTH.set(auth);
    let _ = MCP_LEASES.set(leases);
    let _ = MCP_SERVER.set(server);
}

fn get_auth() -> Result<&'static AuthManager, String> {
    MCP_AUTH.get().ok_or_else(|| "MCP Auth 模块未初始化".to_string())
}

fn get_leases() -> Result<&'static LeaseManager, String> {
    MCP_LEASES.get().ok_or_else(|| "MCP Leases 模块未初始化".to_string())
}

fn get_server() -> Result<&'static McpServer, String> {
    MCP_SERVER.get().ok_or_else(|| "MCP Server 模块未初始化".to_string())
}

/// 查询 MCP 服务当前运行状态
#[tauri::command]
pub async fn mcp_get_status() -> Result<McpStatus, String> {
    let auth = get_auth()?;
    let leases = get_leases()?;
    let config = auth.get_config().await;

    let servers_json = crate::db::servers_list().unwrap_or_else(|_| "[]".to_string());
    let servers: Vec<serde_json::Value> = serde_json::from_str(&servers_json).unwrap_or_default();
    let host_count = servers.len();
    let active_leases = leases.active_count().await;
    let authorized_host_count = config.authorized_host_ids.len();

    Ok(McpStatus {
        enabled: config.enabled,
        port: config.port,
        token: config.token.clone(),
        host_count,
        active_leases,
        endpoint_url: format!("http://127.0.0.1:{}/mcp", config.port),
        authorized_host_count,
        authorized_host_ids: config.authorized_host_ids,
    })
}

/// 设置 MCP 服务开关
#[tauri::command]
pub async fn mcp_set_enabled(enabled: bool) -> Result<McpStatus, String> {
    let auth = get_auth()?;
    let server = get_server()?;

    auth.set_enabled(enabled).await?;
    if enabled {
        server.start();
    } else {
        server.stop();
    }

    mcp_get_status().await
}

/// 重新生成 MCP 访问 Token
#[tauri::command]
pub async fn mcp_regenerate_token() -> Result<String, String> {
    let auth = get_auth()?;
    auth.regenerate_token().await
}

/// 获取已授权开放给 MCP 的主机 ID 清单
#[tauri::command]
pub async fn mcp_get_authorized_hosts() -> Result<Vec<String>, String> {
    let auth = get_auth()?;
    let config = auth.get_config().await;
    Ok(config.authorized_host_ids)
}

/// 更新已授权开放给 MCP 的主机 ID 清单
#[tauri::command]
pub async fn mcp_set_authorized_hosts(host_ids: Vec<String>) -> Result<(), String> {
    let auth = get_auth()?;
    auth.set_authorized_hosts(host_ids).await
}
