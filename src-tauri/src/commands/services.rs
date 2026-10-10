// 服务管理 commands（路由层）
//
// 对应 Electron 版 ipc.js 中的:
//   services:list / services:start / services:stop / services:restart / services:status
//
// 按 target_type 分发：Linux 调用 targets::linux::services，
// Windows 调用 targets::windows::services。

use crate::validators::validate_service_name;

use super::{CommandResult, OperationResult};

/// 加载目标类型，失败回退为 linux
async fn load_target_type(server_id: &str) -> String {
    crate::commands::ssh::load_server_config(server_id)
        .await
        .map(|s| s.target_type)
        .unwrap_or_else(|_| "linux".to_string())
}

/// 校验服务名，无效则返回 Err 包装为 CommandResult::err
fn check_service_name(service_name: &str) -> Result<(), CommandResult> {
    let validation = validate_service_name(service_name.to_string());
    if !validation.valid {
        return Err(CommandResult::err(format!(
            "Invalid input: {}",
            validation.error.unwrap_or_default()
        )));
    }
    Ok(())
}

/// 列出所有服务
/// 返回 JSON 字符串（ServiceInfo[]）
#[tauri::command]
pub async fn services_list(server_id: String) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_list(server_id).await
    } else {
        crate::targets::linux::services::services_list(server_id).await
    }
}

/// 启动服务
#[tauri::command]
pub async fn services_start(
    server_id: String,
    service_name: String,
) -> Result<CommandResult, String> {
    if let Err(r) = check_service_name(&service_name) {
        return Ok(r);
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_start(server_id, service_name).await
    } else {
        crate::targets::linux::services::services_start(server_id, service_name).await
    }
}

/// 停止服务
#[tauri::command]
pub async fn services_stop(
    server_id: String,
    service_name: String,
) -> Result<CommandResult, String> {
    if let Err(r) = check_service_name(&service_name) {
        return Ok(r);
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_stop(server_id, service_name).await
    } else {
        crate::targets::linux::services::services_stop(server_id, service_name).await
    }
}

/// 重启服务
#[tauri::command]
pub async fn services_restart(
    server_id: String,
    service_name: String,
) -> Result<CommandResult, String> {
    if let Err(r) = check_service_name(&service_name) {
        return Ok(r);
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_restart(server_id, service_name).await
    } else {
        crate::targets::linux::services::services_restart(server_id, service_name).await
    }
}

/// 查询服务状态
#[tauri::command]
pub async fn services_status(
    server_id: String,
    service_name: String,
) -> Result<CommandResult, String> {
    if let Err(r) = check_service_name(&service_name) {
        return Ok(r);
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_status(server_id, service_name).await
    } else {
        crate::targets::linux::services::services_status(server_id, service_name).await
    }
}

/// 设置开机自启（Enable）
///
/// 语义：仅修改开机启动策略，不等价于立即启动服务。
#[tauri::command]
pub async fn services_enable(
    server_id: String,
    service_name: String,
) -> Result<CommandResult, String> {
    if let Err(r) = check_service_name(&service_name) {
        return Ok(r);
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_enable(server_id, service_name).await
    } else {
        crate::targets::linux::services::services_enable(server_id, service_name).await
    }
}

/// 取消开机自启（Disable）
///
/// 语义：仅修改开机启动策略，不等价于停止当前运行实例。
#[tauri::command]
pub async fn services_disable(
    server_id: String,
    service_name: String,
) -> Result<CommandResult, String> {
    if let Err(r) = check_service_name(&service_name) {
        return Ok(r);
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_disable(server_id, service_name).await
    } else {
        crate::targets::linux::services::services_disable(server_id, service_name).await
    }
}

/// 查询服务详情（`systemctl show <unit>` 全属性）
///
/// 返回 JSON 字符串（Key -> Value 属性表）；服务名非法时返回空对象 `{}`。
#[tauri::command]
pub async fn services_inspect(
    server_id: String,
    service_name: String,
) -> Result<String, String> {
    if check_service_name(&service_name).is_err() {
        return Ok("{}".to_string());
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_inspect(server_id, service_name).await
    } else {
        crate::targets::linux::services::services_inspect(server_id, service_name).await
    }
}

/// 查询服务日志（`journalctl -u <unit>`）
///
/// 参数：
/// - `lines`：最近 N 行（默认 200）
/// - `since`：时间范围（如 `30 min ago`）
/// - `priority`：日志级别（err / warning / info ...）
#[tauri::command]
pub async fn services_logs(
    server_id: String,
    service_name: String,
    lines: Option<i32>,
    since: Option<String>,
    priority: Option<String>,
) -> Result<CommandResult, String> {
    if let Err(r) = check_service_name(&service_name) {
        return Ok(r);
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_logs(
            server_id, service_name, lines, since, priority,
        )
        .await
    } else {
        crate::targets::linux::services::services_logs(
            server_id, service_name, lines, since, priority,
        )
        .await
    }
}

/// 能力探测：systemd / journalctl / sudo 可用性
///
/// 返回 JSON 字符串，供前端做能力降级（无 journal 时隐藏/降级日志 Tab）。
#[tauri::command]
pub async fn services_capabilities(server_id: String) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_capabilities(server_id).await
    } else {
        crate::targets::linux::services::services_capabilities(server_id).await
    }
}

/// 服务日志实时跟随会话注册表：`server_id::unit` -> session_id
///
/// 与 logs.rs 的 tail 注册表同构：同一服务重复开启时先关闭旧会话，
/// 避免多个 `journalctl -f` 同时占用 SSH channel。
static ACTIVE_SERVICE_LOG_SESSIONS: std::sync::OnceLock<
    std::sync::Arc<tokio::sync::Mutex<std::collections::HashMap<String, String>>>,
> = std::sync::OnceLock::new();

fn service_log_sessions(
) -> &'static std::sync::Arc<tokio::sync::Mutex<std::collections::HashMap<String, String>>> {
    ACTIVE_SERVICE_LOG_SESSIONS
        .get_or_init(|| std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new())))
}

/// 启动服务日志实时跟随（journalctl -f -u <unit>）
///
/// 输出通过 Tauri 事件 `service:log:data` 推送（{ sessionId, data }）。
/// 返回 OperationResult，成功时 `id` 为 sessionId。
#[tauri::command]
pub async fn services_logs_follow_start(
    app: tauri::AppHandle,
    window: tauri::Window,
    server_id: String,
    service_name: String,
    lines: Option<i32>,
) -> Result<OperationResult, String> {
    if check_service_name(&service_name).is_err() {
        return Ok(OperationResult::fail("服务名不合法".to_string()));
    }
    let key = format!("{}::{}", server_id, service_name);

    // 停止同一服务已有的跟随会话（先取出再关闭，避免持锁 await 死锁）
    let old = {
        let mut m = service_log_sessions().lock().await;
        m.remove(&key)
    };
    if let Some(sid) = old {
        let _ = crate::ssh::shell::service_log_follow_close(server_id.clone(), sid).await;
    }

    let window_label = window.label().to_string();
    match crate::ssh::shell::service_log_follow_create(
        app,
        window_label,
        server_id.clone(),
        service_name,
        lines.unwrap_or(100),
    )
    .await
    {
        Ok(sid) => {
            let mut m = service_log_sessions().lock().await;
            m.insert(key, sid.clone());
            Ok(OperationResult::ok_with_id(sid))
        }
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 停止服务日志实时跟随
#[tauri::command]
pub async fn services_logs_follow_stop(
    server_id: String,
    service_name: String,
) -> Result<OperationResult, String> {
    let key = format!("{}::{}", server_id, service_name);
    let sid = {
        let mut m = service_log_sessions().lock().await;
        m.remove(&key)
    };
    if let Some(sid) = sid {
        let _ = crate::ssh::shell::service_log_follow_close(server_id, sid).await;
    }
    Ok(OperationResult::ok())
}

/// 服务依赖关系（P1）：Requires / Wants / After / Before / Conflicts 及反向
#[tauri::command]
pub async fn services_dependencies(
    server_id: String,
    service_name: String,
) -> Result<String, String> {
    if check_service_name(&service_name).is_err() {
        return Ok("{}".to_string());
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_dependencies(server_id, service_name).await
    } else {
        crate::targets::linux::services::services_dependencies(server_id, service_name).await
    }
}

/// Unit 文件与 Drop-in 内容（P1）：`systemctl cat <unit>`
#[tauri::command]
pub async fn services_unit_file(
    server_id: String,
    service_name: String,
) -> Result<CommandResult, String> {
    if let Err(r) = check_service_name(&service_name) {
        return Ok(r);
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_unit_file(server_id, service_name).await
    } else {
        crate::targets::linux::services::services_unit_file(server_id, service_name).await
    }
}

/// 服务进程信息（P1）：主进程与子进程
#[tauri::command]
pub async fn services_process(
    server_id: String,
    service_name: String,
) -> Result<CommandResult, String> {
    if let Err(r) = check_service_name(&service_name) {
        return Ok(r);
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_process(server_id, service_name).await
    } else {
        crate::targets::linux::services::services_process(server_id, service_name).await
    }
}

/// 服务监听端口（P1）：按 MainPID 关联 ss 输出
#[tauri::command]
pub async fn services_ports(
    server_id: String,
    service_name: String,
) -> Result<CommandResult, String> {
    if let Err(r) = check_service_name(&service_name) {
        return Ok(r);
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_ports(server_id, service_name).await
    } else {
        crate::targets::linux::services::services_ports(server_id, service_name).await
    }
}

/// 屏蔽服务（Mask）：禁止任何方式激活，必须二次确认
#[tauri::command]
pub async fn services_mask(
    server_id: String,
    service_name: String,
) -> Result<CommandResult, String> {
    if let Err(r) = check_service_name(&service_name) {
        return Ok(r);
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_mask(server_id, service_name).await
    } else {
        crate::targets::linux::services::services_mask(server_id, service_name).await
    }
}

/// 解除屏蔽（Unmask）
#[tauri::command]
pub async fn services_unmask(
    server_id: String,
    service_name: String,
) -> Result<CommandResult, String> {
    if let Err(r) = check_service_name(&service_name) {
        return Ok(r);
    }
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_unmask(server_id, service_name).await
    } else {
        crate::targets::linux::services::services_unmask(server_id, service_name).await
    }
}

/// 重新加载 systemd 配置（Unit / Drop-in 修改后）
#[tauri::command]
pub async fn services_daemon_reload(server_id: String) -> Result<CommandResult, String> {
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_daemon_reload(server_id).await
    } else {
        crate::targets::linux::services::services_daemon_reload(server_id).await
    }
}

/// 批量采集服务资源（内存 / Tasks / CPU 累计时间）
///
/// 列表页资源列按需加载：一次命令取全部服务，CPU 百分比由前端两次采样求差。
#[tauri::command]
pub async fn services_resources(server_id: String) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::services::services_resources(server_id).await
    } else {
        crate::targets::linux::services::services_resources(server_id).await
    }
}
