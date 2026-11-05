// src-tauri/src/commands/mcp_client.rs
//
// Qshell MCP Client 前端 IPC 命令桥接层

use serde_json::Value;
use crate::mcp_client::global_manager;
use crate::mcp_client::types::{
    ActiveMcpTool, McpPluginConfig, McpPluginView, McpPresetTemplate, McpTestConnectionResult,
    McpToolCallResult,
};

#[tauri::command]
pub async fn mcp_client_list_plugins() -> Result<Vec<McpPluginView>, String> {
    let mgr = global_manager()?;
    Ok(mgr.list_plugins().await)
}

#[tauri::command]
pub async fn mcp_client_list_presets() -> Result<Vec<McpPresetTemplate>, String> {
    let mgr = global_manager()?;
    Ok(mgr.list_presets())
}

#[tauri::command]
pub async fn mcp_client_upsert_plugin(config: McpPluginConfig) -> Result<McpPluginView, String> {
    let mgr = global_manager()?;
    mgr.upsert_plugin(config).await
}

#[tauri::command]
pub async fn mcp_client_remove_plugin(plugin_id: String) -> Result<(), String> {
    let mgr = global_manager()?;
    mgr.remove_plugin(&plugin_id).await
}

#[tauri::command]
pub async fn mcp_client_restore_presets() -> Result<Vec<McpPluginView>, String> {
    let mgr = global_manager()?;
    mgr.restore_default_presets().await
}

#[tauri::command]
pub async fn mcp_client_set_enabled(
    plugin_id: String,
    enabled: bool,
) -> Result<McpPluginView, String> {
    let mgr = global_manager()?;
    mgr.set_plugin_enabled(&plugin_id, enabled).await
}

#[tauri::command]
pub async fn mcp_client_set_tool_disabled(
    plugin_id: String,
    tool_name: String,
    disabled: bool,
) -> Result<McpPluginView, String> {
    let mgr = global_manager()?;
    mgr.set_tool_disabled(&plugin_id, &tool_name, disabled).await
}

#[tauri::command]
pub async fn mcp_client_refresh_plugin(plugin_id: String) -> Result<McpPluginView, String> {
    let mgr = global_manager()?;
    mgr.clear_failure_cooldown(&plugin_id).await;
    mgr.start_plugin(&plugin_id).await?;
    let views = mgr.list_plugins().await;
    views
        .into_iter()
        .find(|v| v.id == plugin_id)
        .ok_or_else(|| format!("未找到插件: {}", plugin_id))
}

#[tauri::command]
pub async fn mcp_client_test_connection(
    config: McpPluginConfig,
) -> Result<McpTestConnectionResult, String> {
    let mgr = global_manager()?;
    Ok(mgr.test_connection(config).await)
}

#[tauri::command]
pub async fn mcp_client_list_active_tools() -> Result<Vec<ActiveMcpTool>, String> {
    let mgr = global_manager()?;
    Ok(mgr.list_active_tools().await)
}

#[tauri::command]
pub async fn mcp_client_call_tool(
    plugin_id: String,
    tool_name: String,
    arguments: Value,
) -> Result<McpToolCallResult, String> {
    let mgr = global_manager()?;
    mgr.call_tool(&plugin_id, &tool_name, arguments).await
}
