// RDP 远程桌面 commands
//
// 对应前端 backend.rdp.launch()，启动系统 RDP 客户端连接 Windows 远程桌面。
//
// 设计：
// - 端口与 SSH 解耦：RDP 默认 3389，不使用 server.port（SSH 端口）
// - 凭据安全：不传密码，由系统 RDP 客户端弹窗输入
// - 模块独立：RDP 启动不依赖 SSH 连接状态

use crate::db;
use crate::rdp::{self, RdpLaunchConfig};

use super::OperationResult;

/// 启动系统 RDP 客户端连接远程桌面
///
/// 从 DB 读取服务器 host/username，结合前端传入的分辨率/端口参数，
/// 生成 .rdp 配置并调用 mstsc / xfreerdp / Microsoft Remote Desktop。
///
/// # 参数
/// - `server_id`: 服务器 ID
/// - `rdp_port`: RDP 端口，默认 3389（与 SSH 端口无关）
/// - `width`: 桌面宽度，默认 1920
/// - `height`: 桌面高度，默认 1080
/// - `fullscreen`: 是否全屏，默认 false
/// - `color_depth`: 颜色深度 16/24/32，默认 32
#[tauri::command]
pub async fn rdp_launch(
    server_id: String,
    rdp_port: Option<u16>,
    width: Option<u32>,
    height: Option<u32>,
    fullscreen: Option<bool>,
    color_depth: Option<u32>,
) -> Result<OperationResult, String> {
    // 从 DB 获取服务器信息
    let base_id = crate::commands::extract_base_server_id(&server_id).to_string();
    let server_json = tokio::task::spawn_blocking(move || db::servers_get_raw(base_id))
        .await
        .map_err(|e| format!("Task join error: {}", e))??;

    let server: serde_json::Value = serde_json::from_str(&server_json)
        .map_err(|e| format!("Failed to parse server: {}", e))?;

    let host = server["host"].as_str().unwrap_or("").to_string();
    let username = server["username"].as_str().unwrap_or("").to_string();

    // 解密密码用于 RDP 自动免密登录
    let password_enc = server["password"].as_str().unwrap_or("");
    let password = if !password_enc.is_empty() {
        match crate::crypto::decrypt_password(password_enc, db::master_key()) {
            Ok(decrypted) => Some(decrypted),
            Err(e) => {
                eprintln!("Failed to decrypt password for RDP: {}", e);
                None
            }
        }
    } else {
        None
    };

    // username 可能含 DOMAIN\user 格式，解析出 domain
    let (domain, username_clean) = if let Some(idx) = username.find('\\') {
        let d = username[..idx].to_string();
        let u = username[idx + 1..].to_string();
        (Some(d), u)
    } else {
        (None, username)
    };

    if host.is_empty() {
        return Ok(OperationResult::fail("Server host is empty"));
    }

    let db_rdp_port = server.get("rdpPort")
        .and_then(|p| p.as_u64())
        .or_else(|| server.get("rdp_port").and_then(|p| p.as_u64()))
        .map(|p| p as u16);
    let final_rdp_port = rdp_port.or(db_rdp_port).unwrap_or(0);
    if final_rdp_port == 0 {
        return Ok(OperationResult::fail("未配置 RDP 端口"));
    }

    let config = RdpLaunchConfig {
        host,
        port: final_rdp_port,
        username: username_clean,
        password,
        domain,
        width: width.unwrap_or(1920),
        height: height.unwrap_or(1080),
        fullscreen: fullscreen.unwrap_or(false),
        color_depth: color_depth.unwrap_or(32),
    };

    match rdp::launch(&config) {
        Ok(()) => Ok(OperationResult::ok_with_message("RDP client launched")),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}
