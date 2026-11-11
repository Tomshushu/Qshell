// VNC 远程桌面 IPC 命令（100% 独立模块）
//
// 提供：
// - `vnc_start_session`: 启动本地一次性 WebSocket ⇄ VNC TCP 桥接器，供前端内嵌 RFB 画布连接
// - `vnc_stop_session`: 停止指定的本地桥接器
// - `vnc_test_connection`: 新建/编辑连接弹窗中的 VNC 协议握手探测

use serde::Serialize;
use crate::db;
use crate::vnc::{self, VncSessionInfo};

use super::OperationResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VncStartResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<VncSessionInfo>,
}

/// 启动内嵌 VNC 会话桥接器
#[tauri::command]
pub async fn vnc_start_session(
    app: tauri::AppHandle,
    server_id: String,
    vnc_port: Option<u16>,
) -> Result<VncStartResponse, String> {
    let base_id = crate::commands::extract_base_server_id(&server_id).to_string();
    let base_id_for_db = base_id.clone();
    let server_json = tokio::task::spawn_blocking(move || db::servers_get_raw(base_id_for_db))
        .await
        .map_err(|e| format!("Task join error: {}", e))??;

    let server: serde_json::Value = serde_json::from_str(&server_json)
        .map_err(|e| format!("Failed to parse server: {}", e))?;

    let host = server["host"].as_str().unwrap_or("").trim().to_string();
    if host.is_empty() {
        return Ok(VncStartResponse {
            success: false,
            error: Some("服务器主机地址为空".to_string()),
            session: None,
        });
    }

    // 优先使用独立的 vncPassword；若未设置则回退复用主登录密码 password
    let vnc_password_enc = server["vncPassword"]
        .as_str()
        .or_else(|| server["vnc_password"].as_str())
        .unwrap_or("");
    let main_password_enc = server["password"].as_str().unwrap_or("");
    let password = if !vnc_password_enc.is_empty() {
        crate::crypto::decrypt_password(vnc_password_enc, db::master_key())
            .ok()
            .filter(|s| !s.is_empty())
    } else {
        None
    }
    .or_else(|| {
        if !main_password_enc.is_empty() {
            crate::crypto::decrypt_password(main_password_enc, db::master_key())
                .ok()
                .filter(|s| !s.is_empty())
        } else {
            None
        }
    });

    let db_vnc_port = server
        .get("vncPort")
        .and_then(|p| p.as_u64())
        .or_else(|| server.get("vnc_port").and_then(|p| p.as_u64()))
        .filter(|&p| p > 0 && p <= 65535)
        .map(|p| p as u16);

    let db_main_port = server
        .get("port")
        .and_then(|p| p.as_u64())
        .filter(|&p| p > 0 && p <= 65535)
        .map(|p| p as u16);

    let protocol = server["protocol"].as_str().unwrap_or("ssh");
    let final_port = vnc_port
        .filter(|&p| p > 0)
        .or(db_vnc_port)
        .or_else(|| if protocol.eq_ignore_ascii_case("vnc") { db_main_port } else { None })
        .unwrap_or(5900);

    let timeout_secs = server
        .get("connectionTimeout")
        .and_then(|t| t.as_u64())
        .or_else(|| server.get("connection_timeout").and_then(|t| t.as_u64()))
        .unwrap_or(15);

    // VeNCrypt/TLS 默认严格校验证书；仅用户显式允许自签证书时放宽（兼容新旧字段键）
    let allow_invalid_certs = server
        .get("tlsAllowInvalidCerts")
        .and_then(|v| v.as_bool())
        .or_else(|| server.get("bmcAllowInvalidCerts").and_then(|v| v.as_bool()))
        .or_else(|| server.get("bmc_allow_invalid_certs").and_then(|v| v.as_bool()))
        .unwrap_or(false);

    // 智能获取该服务器当前活跃的 SSH 连接（优先按 workspace 作用域 server_id，其次按 base_id）
    // 若命中活跃连接，start_bridge 将无缝启用 SSH Direct-TCPIP 隧道打洞；否则平滑回退为 TCP 直连
    let ssh_conn = crate::ssh::manager::SshManager::global()
        .get_connection(&server_id)
        .or_else(|_| crate::ssh::manager::SshManager::global().get_connection(&base_id))
        .ok();

    match vnc::start_bridge(
        Some(app),
        host,
        final_port,
        password,
        timeout_secs,
        ssh_conn,
        allow_invalid_certs,
    )
    .await
    {
        Ok(session) => Ok(VncStartResponse {
            success: true,
            error: None,
            session: Some(session),
        }),
        Err(err) => Ok(VncStartResponse {
            success: false,
            error: Some(err),
            session: None,
        }),
    }
}

/// 停止内嵌 VNC 会话桥接器
#[tauri::command]
pub async fn vnc_stop_session(session_id: String) -> Result<OperationResult, String> {
    vnc::stop_bridge(&session_id);
    Ok(OperationResult::ok_with_message("VNC 会话已关闭"))
}

/// 测试 VNC 端口连通性与 RFB 协议握手
#[tauri::command]
pub async fn vnc_test_connection(
    host: String,
    port: Option<u16>,
    timeout: Option<u64>,
) -> Result<OperationResult, String> {
    let trimmed_host = host.trim();
    if trimmed_host.is_empty() {
        return Ok(OperationResult::fail("请填写主机地址"));
    }
    let final_port = port.filter(|&p| p > 0).unwrap_or(5900);
    let timeout_secs = timeout.unwrap_or(10);

    match vnc::test_connection(trimmed_host, final_port, timeout_secs).await {
        Ok(msg) => Ok(OperationResult::ok_with_message(msg)),
        Err(err) => Ok(OperationResult::fail(err)),
    }
}

/// 基于后端安全区密码代算 VNC Auth 挑战应答（零明文密码跨 IPC 暴露）
#[tauri::command]
pub async fn vnc_solve_auth_challenge(
    session_id: String,
    challenge: Vec<u8>,
) -> Result<Vec<u8>, String> {
    vnc::solve_auth_challenge(&session_id, &challenge)
}
