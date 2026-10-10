// 端口转发命令（P0-2）
//
// 暴露给前端的 Tauri 命令：
// - port_forward_add: 添加一条转发（Local/Remote/Dynamic）
// - port_forward_list: 列出当前所有转发（可按 server_id 过滤）
// - port_forward_stop: 停止单条转发
// - port_forward_stop_all: 停止指定服务器的所有转发

use crate::commands::OperationResult;
use crate::ssh::port_forward::{
    self, ForwardInfo, ForwardKind, ForwardSpec,
};

/// 添加端口转发
///
/// 前端传入 ForwardSpec（含 serverId / kind / localHost / localPort / remoteHost / remotePort）。
/// 返回 OperationResult.id = forward_id。
#[tauri::command]
pub async fn port_forward_add(spec: ForwardSpec) -> Result<OperationResult, String> {
    if !spec.local_host.eq_ignore_ascii_case("127.0.0.1")
        && !spec.local_host.eq_ignore_ascii_case("localhost")
        && spec.local_host != "::1"
    {
        return Ok(OperationResult::fail(
            "localHost must be loopback (127.0.0.1/::1) to avoid exposing services",
        ));
    }
    // 校验：Dynamic 不需要 remote_*，Local/Remote 都需要
    match spec.kind {
        ForwardKind::Local => {
            if spec.remote_host.as_deref().map(|s| s.is_empty()).unwrap_or(true)
                || spec.remote_port.is_none()
            {
                return Ok(OperationResult::fail(
                    "Local 转发需要 remoteHost 和 remotePort",
                ));
            }
        }
        ForwardKind::Remote => {
            if spec.remote_host.as_deref().map(|s| s.is_empty()).unwrap_or(true)
                || spec.remote_port.is_none()
            {
                return Ok(OperationResult::fail(
                    "Remote 转发需要 remoteHost 和 remotePort（服务端绑定地址）",
                ));
            }
        }
        ForwardKind::Dynamic => {
            // 仅需要 local_*
        }
    }
    if spec.local_host.trim().is_empty() {
        return Ok(OperationResult::fail("localHost 不能为空"));
    }
    if spec.local_host.len() > 253 || spec.local_host.chars().any(|c| c.is_control() || c == ' ')
    {
        return Ok(OperationResult::fail("localHost 无效"));
    }
    if let Some(host) = spec.remote_host.as_deref() {
        if host.trim().is_empty() || host.len() > 253 || host.chars().any(|c| c.is_control() || c == ' ') {
            return Ok(OperationResult::fail("remoteHost 无效"));
        }
    }
    match spec.kind {
        ForwardKind::Local => {
            if spec.remote_port.unwrap_or(0) == 0 {
                return Ok(OperationResult::fail("Local 转发目标端口必须在 1-65535 范围内"));
            }
        }
        ForwardKind::Remote if spec.local_port == 0 => {
            return Ok(OperationResult::fail("Remote 转发本地目标端口必须在 1-65535 范围内"));
        }
        _ => {}
    }

    match port_forward::add_forward(spec).await {
        Ok(id) => Ok(OperationResult::ok_with_id(id)),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 列出端口转发
///
/// server_id 为 None 时列出所有，否则按服务器过滤。
#[tauri::command]
pub async fn port_forward_list(
    server_id: Option<String>,
) -> Result<Vec<ForwardInfo>, String> {
    Ok(port_forward::list_forwards(server_id.as_deref()).await)
}

/// 停止单条转发
#[tauri::command]
pub async fn port_forward_stop(forward_id: String) -> Result<OperationResult, String> {
    match port_forward::stop_forward(&forward_id).await {
        Ok(()) => Ok(OperationResult::ok()),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

#[tauri::command]
pub async fn port_forward_restart(forward_id: String) -> Result<OperationResult, String> {
    match port_forward::restart_forward(&forward_id).await {
        Ok(id) => Ok(OperationResult::ok_with_id(id)),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 停止指定服务器的所有转发
#[tauri::command]
pub async fn port_forward_stop_all(server_id: String) -> Result<OperationResult, String> {
    port_forward::stop_all_for_server(&server_id).await;
    Ok(OperationResult::ok())
}
