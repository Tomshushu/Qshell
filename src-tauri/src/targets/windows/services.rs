//! Windows 服务管理命令构造与执行
//!
//! 对应 commands/services.rs 的 Windows 分支，使用 PowerShell 的 `Get-Service` / `Start-Service` 等。

use crate::commands::{ssh_execute_command, CommandResult};
use crate::parsers;

/// 列出所有服务
///
/// PowerShell `Get-Service` 输出 pipe 分隔格式：
/// `Name|Status|StartType|DisplayName`
///
/// 直接构造 ServiceInfo 列表（不走 parser）。
/// 返回 JSON 字符串（ServiceInfo[]）
pub async fn services_list(server_id: String) -> Result<String, String> {
    let script = "Get-Service | ForEach-Object { Write-Output ($_.Name + '|' + $_.Status + '|' + $_.StartType + '|' + $_.DisplayName) }";
    let cmd = crate::validators::build_powershell_command(script);
    let res = ssh_execute_command(&server_id, &cmd).await;
    let services: Vec<parsers::ServiceInfo> = res
        .stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(4, '|').collect();
            if parts.len() < 3 {
                return None;
            }
            let status = parts[1].to_string();
            let start_type = parts[2].to_string();
            Some(parsers::ServiceInfo {
                name: parts[0].to_string(),
                active: status == "Running",
                sub_state: status.clone(),
                enabled: start_type == "Automatic",
                description: parts.get(3).unwrap_or(&"").to_string(),
                // Windows 无 LoadState 概念，映射为 loaded
                load_state: "loaded".to_string(),
                active_state: if status == "Running" {
                    "active".to_string()
                } else {
                    "inactive".to_string()
                },
                // StartType -> enabled / disabled / manual
                enabled_state: match start_type.as_str() {
                    "Automatic" => "enabled".to_string(),
                    "Disabled" => "disabled".to_string(),
                    "Manual" => "manual".to_string(),
                    other => other.to_lowercase(),
                },
                ..Default::default()
            })
        })
        .collect();
    serde_json::to_string(&services).map_err(|e| format!("Serialize error: {}", e))
}

/// 启动服务
///
/// 命令：`Start-Service -Name '<name>'`
pub async fn services_start(server_id: String, service_name: String) -> Result<CommandResult, String> {
    let script = format!(
        "Start-Service -Name '{}'; Write-Output 'OK'",
        service_name.replace('\'', "''")
    );
    let cmd = crate::validators::build_powershell_command(&script);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 停止服务
///
/// 命令：`Stop-Service -Name '<name>' -Force`
pub async fn services_stop(server_id: String, service_name: String) -> Result<CommandResult, String> {
    let script = format!(
        "Stop-Service -Name '{}' -Force; Write-Output 'OK'",
        service_name.replace('\'', "''")
    );
    let cmd = crate::validators::build_powershell_command(&script);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 重启服务
///
/// 命令：`Restart-Service -Name '<name>'`
pub async fn services_restart(server_id: String, service_name: String) -> Result<CommandResult, String> {
    let script = format!(
        "Restart-Service -Name '{}'; Write-Output 'OK'",
        service_name.replace('\'', "''")
    );
    let cmd = crate::validators::build_powershell_command(&script);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 查询服务状态
///
/// 命令：`Get-Service -Name '<name>' | Format-List Name,Status,StartType,DisplayName`
pub async fn services_status(server_id: String, service_name: String) -> Result<CommandResult, String> {
    let script = format!(
        "Get-Service -Name '{}' | Format-List Name,Status,StartType,DisplayName",
        service_name.replace('\'', "''")
    );
    let cmd = crate::validators::build_powershell_command(&script);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 设置开机自启（StartType=Automatic）
pub async fn services_enable(server_id: String, service_name: String) -> Result<CommandResult, String> {
    let script = format!(
        "Set-Service -Name '{}' -StartupType Automatic; Write-Output 'OK'",
        service_name.replace('\'', "''")
    );
    let cmd = crate::validators::build_powershell_command(&script);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 取消开机自启（StartType=Disabled）
pub async fn services_disable(server_id: String, service_name: String) -> Result<CommandResult, String> {
    let script = format!(
        "Set-Service -Name '{}' -StartupType Disabled; Write-Output 'OK'",
        service_name.replace('\'', "''")
    );
    let cmd = crate::validators::build_powershell_command(&script);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 服务详情：Windows 侧以 Name/Status/StartType/DisplayName 组成属性表
///
/// 返回 JSON 字符串（Key -> Value）
pub async fn services_inspect(server_id: String, service_name: String) -> Result<String, String> {
    let script = format!(
        "Get-Service -Name '{}' | ForEach-Object {{ Write-Output ($_.Name + '|' + $_.Status + '|' + $_.StartType + '|' + $_.DisplayName) }}",
        service_name.replace('\'', "''")
    );
    let cmd = crate::validators::build_powershell_command(&script);
    let res = ssh_execute_command(&server_id, &cmd).await;
    let parts: Vec<&str> = res.stdout.lines().next().unwrap_or("").splitn(4, '|').collect();
    let props = serde_json::json!({
        "Name": parts.first().copied().unwrap_or(""),
        "Status": parts.get(1).copied().unwrap_or(""),
        "StartType": parts.get(2).copied().unwrap_or(""),
        "DisplayName": parts.get(3).copied().unwrap_or(""),
    });
    Ok(props.to_string())
}

/// 服务日志：Windows 无 journal，明确返回不支持（前端据此降级提示）
pub async fn services_logs(
    _server_id: String,
    _service_name: String,
    _lines: Option<i32>,
    _since: Option<String>,
    _priority: Option<String>,
) -> Result<CommandResult, String> {
    Ok(CommandResult::err(
        "Windows 暂不支持 journal 日志，请使用事件查看器（Event Viewer）查看服务日志".to_string(),
    ))
}

/// 能力探测：Windows 侧固定为无 systemd / 无 journal
pub async fn services_capabilities(_server_id: String) -> Result<String, String> {
    Ok(serde_json::json!({
        "systemd": false,
        "journal": false,
        "systemRunning": true,
        "sudoNoPass": true,
        "sysv": false,
    })
    .to_string())
}

/// 依赖关系：Windows 服务无 systemd 依赖关系，返回空结构
pub async fn services_dependencies(
    _server_id: String,
    _service_name: String,
) -> Result<String, String> {
    Ok(serde_json::json!({}).to_string())
}

/// Unit 文件：Windows 没有 systemd Unit 文件
pub async fn services_unit_file(
    _server_id: String,
    _service_name: String,
) -> Result<CommandResult, String> {
    Ok(CommandResult::err(
        "Windows 服务没有 systemd Unit 文件".to_string(),
    ))
}

/// 进程信息：通过 Win32_Service 取 ProcessId 再查进程
pub async fn services_process(
    server_id: String,
    service_name: String,
) -> Result<CommandResult, String> {
    let script = format!(
        "$p = Get-CimInstance -ClassName Win32_Service -Filter \"Name = '{0}'\" | Select-Object -ExpandProperty ProcessId; if ($p -gt 0) {{ Get-Process -Id $p | Format-List Id,ProcessName,StartTime,WorkingSet64 }} else {{ Write-Output '服务未运行' }}",
        service_name.replace('\'', "''")
    );
    let cmd = crate::validators::build_powershell_command(&script);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 监听端口：Windows 暂不支持按服务关联
pub async fn services_ports(
    _server_id: String,
    _service_name: String,
) -> Result<CommandResult, String> {
    Ok(CommandResult::err(
        "Windows 暂不支持按服务关联监听端口".to_string(),
    ))
}

/// Mask：Windows 无对应能力
pub async fn services_mask(
    _server_id: String,
    _service_name: String,
) -> Result<CommandResult, String> {
    Ok(CommandResult::err("Windows 不支持 Mask 操作".to_string()))
}

/// Unmask：Windows 无对应能力
pub async fn services_unmask(
    _server_id: String,
    _service_name: String,
) -> Result<CommandResult, String> {
    Ok(CommandResult::err("Windows 不支持 Unmask 操作".to_string()))
}

/// daemon-reload：Windows 无需重载 systemd
pub async fn services_daemon_reload(_server_id: String) -> Result<CommandResult, String> {
    Ok(CommandResult::err(
        "Windows 不需要 daemon-reload".to_string(),
    ))
}

/// 批量资源采集：Windows 侧不支持 cgroup 指标，返回空对象
pub async fn services_resources(_server_id: String) -> Result<String, String> {
    Ok(serde_json::json!({}).to_string())
}
