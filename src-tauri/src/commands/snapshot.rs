// 快照生成 commands（路由层）
//
// 对应 Electron 版 ipc.js 中的 snapshot:generate
// 并发采集多个维度的系统信息，返回给前端
//
// 按 target_type 分发：Linux/Windows 各自从对应 targets 模块获取命令集合。

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ssh_execute_command;

/// 快照结果（动态字段，前端按需读取）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotResult {
    pub server_id: String,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics_raw: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub services_raw: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub services_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub processes_raw: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub processes_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ports_raw: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ports_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docker_raw: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docker_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_info_raw: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_info_error: Option<String>,
}

async fn run_cmd(server_id: &str, command: &str) -> Result<String, String> {
    let res = ssh_execute_command(server_id, command).await;
    if res.exit_code != 0 && !res.stderr.is_empty() {
        return Err(res.stderr);
    }
    Ok(res.stdout)
}

/// 加载目标类型，失败回退为 linux
async fn load_target_type(server_id: &str) -> String {
    crate::commands::ssh::load_server_config(server_id)
        .await
        .map(|s| s.target_type)
        .unwrap_or_else(|_| "linux".to_string())
}

/// 生成服务器快照
///
/// 按目标类型从对应 targets 模块获取 5 个采集命令，
/// 并发执行后汇总为快照 JSON。
#[tauri::command]
pub async fn snapshot_generate(server_id: String) -> Result<Value, String> {
    let mut snapshot = serde_json::json!({
        "serverId": server_id,
        "createdAt": chrono::Utc::now().timestamp_millis(),
    });

    let target_type = load_target_type(&server_id).await;
    let cmds = if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::snapshot::build_snapshot_commands()
    } else {
        crate::targets::linux::snapshot::build_snapshot_commands()
    };

    // 并发执行 6 个采集命令
    let (metrics, services, processes, ports, docker, system_info) = tokio::join!(
        run_cmd(&server_id, &cmds.metrics_cmd),
        run_cmd(&server_id, &cmds.services_cmd),
        run_cmd(&server_id, &cmds.processes_cmd),
        run_cmd(&server_id, &cmds.ports_cmd),
        run_cmd(&server_id, &cmds.docker_cmd),
        run_cmd(&server_id, &cmds.system_info_cmd),
    );

    match metrics {
        Ok(v) => { snapshot["metricsRaw"] = Value::String(v); }
        Err(e) => { snapshot["metricsError"] = Value::String(e); }
    }
    match services {
        Ok(v) => { snapshot["servicesRaw"] = Value::String(v); }
        Err(e) => { snapshot["servicesError"] = Value::String(e); }
    }
    match processes {
        Ok(v) => { snapshot["processesRaw"] = Value::String(v); }
        Err(e) => { snapshot["processesError"] = Value::String(e); }
    }
    match ports {
        Ok(v) => { snapshot["portsRaw"] = Value::String(v); }
        Err(e) => { snapshot["portsError"] = Value::String(e); }
    }
    match docker {
        Ok(v) => { snapshot["dockerRaw"] = Value::String(v); }
        Err(e) => { snapshot["dockerError"] = Value::String(e); }
    }
    match system_info {
        Ok(v) => { snapshot["systemInfoRaw"] = Value::String(v); }
        Err(e) => { snapshot["systemInfoError"] = Value::String(e); }
    }

    Ok(snapshot)
}
