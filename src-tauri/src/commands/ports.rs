// 端口管理 commands（路由层）
//
// 对应 Electron 版 ipc.js 中的:
//   ports:list / ports:killByPid
//
// 按 target_type 分发：Linux 调用 targets::linux::ports，
// Windows 调用 targets::windows::ports。

use crate::validators::validate_pid;

use super::CommandResult;

/// 加载目标类型，失败回退为 linux
async fn load_target_type(server_id: &str) -> String {
    crate::commands::ssh::load_server_config(server_id)
        .await
        .map(|s| s.target_type)
        .unwrap_or_else(|_| "linux".to_string())
}

/// 列出所有监听端口
/// 返回 JSON 字符串（PortInfo[]）
#[tauri::command]
pub async fn ports_list(server_id: String) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::ports::ports_list(server_id).await
    } else {
        crate::targets::linux::ports::ports_list(server_id).await
    }
}

/// 按 PID 结束占用端口的进程
#[tauri::command]
pub async fn ports_kill_by_pid(
    server_id: String,
    pid: i64,
) -> Result<CommandResult, String> {
    let validation = validate_pid(pid.to_string());
    if !validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid PID: {}",
            validation.error.unwrap_or_default()
        )));
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::ports::ports_kill_by_pid(server_id, pid).await
    } else {
        crate::targets::linux::ports::ports_kill_by_pid(server_id, pid).await
    }
}
