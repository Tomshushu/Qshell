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
use serde::Deserialize;

use super::OperationResult;

/// 前端传入 / DB 持久化的 RDP 高级启动与重定向配置
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpAdvancedOptions {
    pub rdp_port: Option<u16>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fullscreen: Option<bool>,
    pub color_depth: Option<u32>,
    pub use_multimon: Option<bool>,
    pub redirect_clipboard: Option<bool>,
    pub redirect_drives: Option<bool>,
    pub redirect_printers: Option<bool>,
    pub smart_sizing: Option<bool>,
    pub enable_credssp: Option<bool>,
    pub audio_mode: Option<u8>,
}

/// 启动系统 RDP 客户端连接远程桌面
///
/// 从 DB 读取服务器 host/username 及持久化的 rdpConfig，结合前端传入的分辨率/端口/高级重定向参数，
/// 生成 .rdp 配置并调用 mstsc / xfreerdp / Microsoft Remote Desktop。
#[tauri::command]
pub async fn rdp_launch(
    server_id: String,
    rdp_port: Option<u16>,
    width: Option<u32>,
    height: Option<u32>,
    fullscreen: Option<bool>,
    color_depth: Option<u32>,
    options: Option<RdpAdvancedOptions>,
) -> Result<OperationResult, String> {
    // 从 DB 获取服务器信息
    let base_id = crate::commands::extract_base_server_id(&server_id).to_string();
    let server_json = tokio::task::spawn_blocking(move || db::servers_get_raw(base_id))
        .await
        .map_err(|e| format!("Task join error: {}", e))??;

    let server: serde_json::Value = serde_json::from_str(&server_json)
        .map_err(|e| format!("Failed to parse server: {}", e))?;

    let host = server["host"].as_str().unwrap_or("").to_string();
    let mut username = server["username"].as_str().unwrap_or("").to_string();

    // 解密密码用于 RDP 自动免密登录
    let password_enc = server["password"].as_str().unwrap_or("");
    let mut password = if !password_enc.is_empty() {
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

    if let Some(pid) = server
        .get("authProfileId")
        .and_then(|v| v.as_str())
        .or_else(|| server.get("auth_profile_id").and_then(|v| v.as_str()))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
    {
        if let Ok(Ok(profile)) =
            tokio::task::spawn_blocking(move || db::auth_profiles_get_raw(&pid)).await
        {
            if !profile.username.trim().is_empty() {
                username = profile.username;
            }
            if profile
                .password
                .as_deref()
                .map(|s| !s.is_empty())
                .unwrap_or(false)
            {
                password = profile.password;
            }
        }
    }

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

    let saved_opts: RdpAdvancedOptions = server
        .get("rdpConfig")
        .or_else(|| server.get("rdp_config"))
        .and_then(|v| v.as_str())
        .and_then(|raw| serde_json::from_str::<RdpAdvancedOptions>(raw).ok())
        .unwrap_or_default();
    let req_opts = options.unwrap_or_default();

    let db_rdp_port = server.get("rdpPort")
        .and_then(|p| p.as_u64())
        .or_else(|| server.get("rdp_port").and_then(|p| p.as_u64()))
        .map(|p| p as u16);
    let final_rdp_port = rdp_port
        .or(req_opts.rdp_port)
        .or(saved_opts.rdp_port)
        .or(db_rdp_port)
        .unwrap_or(0);
    if final_rdp_port == 0 {
        return Ok(OperationResult::fail("未配置 RDP 端口"));
    }

    let defaults = RdpLaunchConfig::default();
    let config = RdpLaunchConfig {
        host,
        port: final_rdp_port,
        username: username_clean,
        password,
        domain,
        width: width.or(req_opts.width).or(saved_opts.width).unwrap_or(defaults.width),
        height: height.or(req_opts.height).or(saved_opts.height).unwrap_or(defaults.height),
        fullscreen: fullscreen
            .or(req_opts.fullscreen)
            .or(saved_opts.fullscreen)
            .unwrap_or(defaults.fullscreen),
        color_depth: color_depth
            .or(req_opts.color_depth)
            .or(saved_opts.color_depth)
            .unwrap_or(defaults.color_depth),
        use_multimon: req_opts
            .use_multimon
            .or(saved_opts.use_multimon)
            .unwrap_or(defaults.use_multimon),
        redirect_clipboard: req_opts
            .redirect_clipboard
            .or(saved_opts.redirect_clipboard)
            .unwrap_or(defaults.redirect_clipboard),
        redirect_drives: req_opts
            .redirect_drives
            .or(saved_opts.redirect_drives)
            .unwrap_or(defaults.redirect_drives),
        redirect_printers: req_opts
            .redirect_printers
            .or(saved_opts.redirect_printers)
            .unwrap_or(defaults.redirect_printers),
        smart_sizing: req_opts
            .smart_sizing
            .or(saved_opts.smart_sizing)
            .unwrap_or(defaults.smart_sizing),
        enable_credssp: req_opts
            .enable_credssp
            .or(saved_opts.enable_credssp)
            .unwrap_or(defaults.enable_credssp),
        audio_mode: req_opts
            .audio_mode
            .or(saved_opts.audio_mode)
            .unwrap_or(defaults.audio_mode),
    };

    match rdp::launch(&config) {
        Ok(()) => Ok(OperationResult::ok_with_message("RDP client launched")),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}
