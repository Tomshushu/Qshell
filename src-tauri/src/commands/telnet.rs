// Telnet 协议 commands（P0-5）
//
// 仅暴露 `telnet_create_shell`：建立 TCP + Telnet 会话，返回 session_id（前缀 telnet-）。
//
// 其他操作（write/resize/close/getHistory）通过现有的 `ssh_write_to_shell` /
// `ssh_resize_shell` / `ssh_close_shell` / `ssh_get_shell_history` 命令统一路由，
// 后端依据 session_id 前缀（`telnet-`）自动转发到 Telnet 模块。
//
// 事件复用 ssh:shell-output / ssh:shell-closed / ssh:shell-error，
// 前端无需感知协议差异。

use tauri::AppHandle;

/// 创建 Telnet Shell 会话的结果
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTelnetShellResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 创建 Telnet Shell 会话
///
/// 与 ssh_create_shell 行为对齐：
/// - 成功返回 CreateTelnetShellResult { success, sessionId, error }
/// - 失败（连接超时/拒绝）也返回 success=false，不抛异常
#[tauri::command]
pub async fn telnet_create_shell(
    app: AppHandle,
    window: tauri::WebviewWindow,
    server_id: String,
    host: String,
    port: Option<u16>,
    cols: Option<u32>,
    rows: Option<u32>,
    timeout_secs: Option<u32>,
    encoding: Option<String>,
) -> Result<CreateTelnetShellResult, String> {
    // 参数规范化
    let port = port.unwrap_or(23);
    let c = match cols {
        Some(v) if v > 0 => v,
        _ => 80,
    };
    let r = match rows {
        Some(v) if v > 0 => v,
        _ => 24,
    };
    let timeout = timeout_secs.unwrap_or(15);
    let window_label = window.label().to_string();

    if host.trim().is_empty() {
        return Ok(CreateTelnetShellResult {
            success: false,
            session_id: None,
            error: Some("host is required".to_string()),
        });
    }

    // Telnet 本身没有标准化认证报文，设备通常在终端流中输出 login/username/
    // password 提示。正式打开终端时读取已保存并解密的凭据，交给传输层做一次性
    // 提示识别与自动填写；测试连接仍只声明 TCP 端口可达，避免伪称认证成功。
    let (login_username, login_password) = match crate::commands::ssh::load_server_config(&server_id).await {
        Ok(server) => {
            if server.protocol != "telnet" {
                return Ok(CreateTelnetShellResult {
                    success: false,
                    session_id: None,
                    error: Some("当前服务器配置不是 Telnet 协议".to_string()),
                });
            }
            (
                (!server.username.trim().is_empty()).then_some(server.username),
                server.password.filter(|value| !value.is_empty()),
            )
        }
        Err(error) => {
            return Ok(CreateTelnetShellResult {
                success: false,
                session_id: None,
                error: Some(error),
            });
        }
    };

    match crate::telnet::telnet_create_shell(
        app,
        window_label,
        server_id,
        host,
        port,
        c,
        r,
        timeout,
        encoding.unwrap_or_else(|| "utf-8".to_string()),
        login_username,
        login_password,
    )
    .await
    {
        Ok(session_id) => Ok(CreateTelnetShellResult {
            success: true,
            session_id: Some(session_id),
            error: None,
        }),
        Err(e) => Ok(CreateTelnetShellResult {
            success: false,
            session_id: None,
            error: Some(e),
        }),
    }
}
