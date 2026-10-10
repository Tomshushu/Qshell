// 进程管理 commands（路由层）
//
// 对应 Electron 版 ipc.js 中的:
//   processes:list / processes:kill
//
// 按 target_type 分发：Linux 调用 targets::linux::processes，
// Windows 调用 targets::windows::processes。

use crate::validators::validate_pid;

use super::CommandResult;

/// 加载目标类型，失败回退为 linux
async fn load_target_type(server_id: &str) -> String {
    crate::commands::ssh::load_server_config(server_id)
        .await
        .map(|s| s.target_type)
        .unwrap_or_else(|_| "linux".to_string())
}

/// 列出占用 CPU 最高的前 100 个进程
/// 返回 JSON 字符串（ProcessInfo[]）
#[tauri::command]
pub async fn processes_list(server_id: String) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::processes::processes_list(server_id).await
    } else {
        crate::targets::linux::processes::processes_list(server_id).await
    }
}

/// 向进程发送信号（TERM / KILL）
/// - Linux：term → SIGTERM（kill），kill → SIGKILL（kill -9），并支持 start_time_ticks 竞态校验
/// - Windows：term → Stop-Process，kill → Stop-Process -Force
#[tauri::command]
pub async fn processes_signal(
    server_id: String,
    pid: i64,
    signal: String,
    start_time_ticks: Option<i64>,
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
        crate::targets::windows::processes::processes_signal(server_id, pid, signal, start_time_ticks).await
    } else {
        crate::targets::linux::processes::processes_signal(server_id, pid, signal, start_time_ticks).await
    }
}
