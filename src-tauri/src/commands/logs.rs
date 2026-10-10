// 日志 commands（路由层）
//
// 对应 Electron 版 ipc.js 中的:
//   logs:read / logs:startTail / logs:stopTail / logs:search
//
// tail 流通过 Tauri event `logs:tail:data` 推送到前端
//
// 按 target_type 分发：logs_read / logs_search 调用对应平台模块。
// logs_start_tail / logs_stop_tail 是平台无关的（通过 ssh::shell::tail_create/tail_close）。

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use tauri::AppHandle;

use super::{CommandResult, OperationResult};

/// 每个服务器同时只允许一个 tail 会话（与 Electron 版一致）
/// server_id -> session_id
static ACTIVE_TAIL_SESSIONS: std::sync::OnceLock<Arc<Mutex<HashMap<String, String>>>> =
    std::sync::OnceLock::new();
static TAIL_CONTROL_LOCK: std::sync::OnceLock<Arc<Mutex<()>>> = std::sync::OnceLock::new();

fn tail_sessions() -> &'static Arc<Mutex<HashMap<String, String>>> {
    ACTIVE_TAIL_SESSIONS.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

fn tail_control_lock() -> &'static Arc<Mutex<()>> {
    TAIL_CONTROL_LOCK.get_or_init(|| Arc::new(Mutex::new(())))
}

/// 加载目标类型，失败回退为 linux
async fn load_target_type(server_id: &str) -> String {
    crate::commands::ssh::load_server_config(server_id)
        .await
        .map(|s| s.target_type)
        .unwrap_or_else(|_| "linux".to_string())
}

/// 读取日志文件末尾 N 行
#[tauri::command]
pub async fn logs_read(
    server_id: String,
    log_path: String,
    lines: Option<i64>,
) -> Result<CommandResult, String> {
    let target_type = load_target_type(&server_id).await;
    let path_validation =
        crate::validators::validate_path_for_target(log_path.clone(), false, &target_type);
    if !path_validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid path: {}",
            path_validation.error.unwrap_or_default()
        )));
    }
    let n = lines.unwrap_or(100);
    let lines_validation = crate::validators::validate_pid(n.to_string());
    if !lines_validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid lines parameter: {}",
            lines_validation.error.unwrap_or_default()
        )));
    }
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::logs::logs_read(server_id, log_path, n).await
    } else {
        crate::targets::linux::logs::logs_read(server_id, log_path, n).await
    }
}

/// 启动 `tail -f` 实时日志流
///
/// 返回 { success: true, sessionId }
/// 日志数据通过 `logs:tail:data` 事件推送到前端
/// 同一服务器只允许一个 tail 会话，新会话会自动停止旧会话
#[tauri::command]
pub async fn logs_start_tail(
    app: AppHandle,
    window: tauri::WebviewWindow,
    server_id: String,
    log_path: String,
) -> Result<OperationResult, String> {
    let target_type = load_target_type(&server_id).await;
    let path_validation =
        crate::validators::validate_path_for_target(log_path.clone(), false, &target_type);
    if !path_validation.valid {
        return Ok(OperationResult::fail(format!(
            "Invalid path: {}",
            path_validation.error.unwrap_or_default()
        )));
    }

    // Serialize stop/start so concurrent requests cannot leak a stream or
    // overwrite the registry with an older session.
    let _control = tail_control_lock().lock().await;

    // 停止该服务器已有的 tail 会话
    // Remove the old session while holding the registry lock, then close it
    // after releasing the lock. `tail_close` can itself touch the tail
    // registry, so awaiting it while locked can deadlock this command.
    let old_session_id = {
        let mut sessions = tail_sessions().lock().await;
        sessions.remove(&server_id)
    };
    if let Some(old_sid) = old_session_id {
        let _ = crate::ssh::shell::tail_close(server_id.clone(), old_sid).await;
    }

    // 启动新的 tail 会话（初始 50 行 + follow）。Windows 使用
    // PowerShell Get-Content -Wait，因为 POSIX tail 通常不可用。
    let window_label = window.label().to_string();
    let result = if target_type.eq_ignore_ascii_case("windows") {
        let session_id = format!("tail-{}", uuid::Uuid::new_v4());
        let escaped = crate::validators::escape_powershell_arg(log_path);
        let command = crate::validators::build_powershell_command(&format!(
            "Get-Content -Path {} -Tail 50 -Wait",
            escaped
        ));
        crate::ssh::shell::tail_create_with_command(
            app,
            window_label,
            server_id.clone(),
            command,
            session_id,
        )
        .await
    } else {
        crate::ssh::shell::tail_create(app, window_label, server_id.clone(), log_path, 50).await
    };
    match result {
        Ok(session_id) => {
            let mut sessions = tail_sessions().lock().await;
            sessions.insert(server_id, session_id.clone());
            Ok(OperationResult::ok_with_id(session_id))
        }
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 停止 `tail -f` 实时日志流
#[tauri::command]
pub async fn logs_stop_tail(
    server_id: String,
    session_id: Option<String>,
) -> Result<OperationResult, String> {
    let _control = tail_control_lock().lock().await;
    let session_id = {
        let mut sessions = tail_sessions().lock().await;
        match session_id {
            Some(expected) if sessions.get(&server_id) == Some(&expected) => sessions.remove(&server_id),
            Some(_) => None,
            None => sessions.remove(&server_id),
        }
    };
    if let Some(sid) = session_id {
        let _ = crate::ssh::shell::tail_close(server_id, sid).await;
    }
    Ok(OperationResult::ok())
}

/// 在日志文件中搜索关键字
/// 返回匹配的行（最多 100 行）
#[tauri::command]
pub async fn logs_search(
    server_id: String,
    log_path: String,
    keyword: String,
) -> Result<CommandResult, String> {
    let target_type = load_target_type(&server_id).await;
    let path_validation =
        crate::validators::validate_path_for_target(log_path.clone(), false, &target_type);
    if !path_validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid path: {}",
            path_validation.error.unwrap_or_default()
        )));
    }
    let keyword_validation = crate::validators::validate_keyword(keyword.clone());
    if !keyword_validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid keyword: {}",
            keyword_validation.error.unwrap_or_default()
        )));
    }
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::logs::logs_search(server_id, log_path, keyword).await
    } else {
        crate::targets::linux::logs::logs_search(server_id, log_path, keyword).await
    }
}

/// 获取审计/系统日志列表
#[tauri::command]
pub async fn audit_logs_list(
    log_type: Option<String>,
    search_query: Option<String>,
    limit: i64,
    offset: i64,
) -> Result<Vec<crate::db::AuditLog>, String> {
    crate::db::list_audit_logs(log_type, search_query, limit, offset)
}

/// 清空所有审计/系统日志
#[tauri::command]
pub async fn audit_logs_clear() -> Result<OperationResult, String> {
    match crate::db::clear_audit_logs() {
        Ok(_) => Ok(OperationResult::ok()),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 记录审计/系统日志
#[tauri::command]
pub async fn record_audit_log(
    log_type: String,
    server_name: Option<String>,
    event: String,
    status: String,
    details: Option<String>,
) -> Result<OperationResult, String> {
    let s_name = server_name.as_deref();
    let d_info = details.as_deref();
    match crate::db::add_audit_log(&log_type, s_name, &event, &status, d_info) {
        Ok(_) => Ok(OperationResult::ok()),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 获取审计/系统日志总条数
#[tauri::command]
pub async fn audit_logs_count(
    log_type: Option<String>,
    search_query: Option<String>,
) -> Result<i64, String> {
    crate::db::count_audit_logs(log_type, search_query)
}
