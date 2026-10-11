// Tauri commands 层
//
// 这一层是 Rust 后端与前端 JS 之间的桥梁：
// - 接收前端 `invoke('command_name', args)` 调用
// - 调用底层模块（db / ssh / metrics / files / parsers / validators）
// - 返回 serde 可序列化的结果给前端
//
// 设计原则：
// 1. 命令函数签名尽量与 Electron 版 ipc.js handler 一一对应
// 2. 错误统一返回 `Result<T, String>`，Tauri 会把 Err 转为 Promise reject
// 3. 复杂业务逻辑（如 SSH 连接 + 解密密码 + 更新状态）放在这里，保持底层模块纯净
// 4. 数据库路径与加密密钥在启动期存入 db 模块全局，commands 直接调用 db::xxx()，
//    无需通过 tauri::State 注入。

pub mod servers;
pub mod server_groups;
pub mod server_import;
pub mod ssh;
pub mod ssh_keys;
pub mod metrics;
pub mod services;
pub mod processes;
pub mod ports;
pub mod network;
pub mod open;
pub mod logs;
pub mod files;
pub mod docker;
pub mod snapshot;
pub mod fav_cmds;
pub mod bookmarks;
pub mod window;
pub mod rdp;
pub mod bmc;
pub mod port_forward;
pub mod telnet;
pub mod serial;
pub mod tags;
pub mod updater;
pub mod backgrounds;

// ============================================================================
// 公共辅助类型与函数
// ============================================================================

use serde::Serialize;

/// 命令执行结果（与前端 CommandResult 接口对应）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

impl CommandResult {
    pub fn ok(stdout: impl Into<String>) -> Self {
        Self {
            stdout: stdout.into(),
            stderr: String::new(),
            exit_code: 0,
        }
    }

    pub fn err(stderr: impl Into<String>) -> Self {
        Self {
            stdout: String::new(),
            stderr: stderr.into(),
            exit_code: 1,
        }
    }
}

/// 通用操作结果（与前端 OperationResult 接口对应）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os_info: Option<String>,
}

impl OperationResult {
    pub fn ok() -> Self {
        Self {
            success: true,
            error: None,
            message: None,
            id: None,
            os_type: None,
            os_info: None,
        }
    }

    pub fn ok_with_id(id: impl Into<String>) -> Self {
        Self {
            success: true,
            error: None,
            message: None,
            id: Some(id.into()),
            os_type: None,
            os_info: None,
        }
    }

    pub fn ok_with_message(msg: impl Into<String>) -> Self {
        Self {
            success: true,
            error: None,
            message: Some(msg.into()),
            id: None,
            os_type: None,
            os_info: None,
        }
    }

    pub fn fail(err: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(err.into()),
            message: None,
            id: None,
            os_type: None,
            os_info: None,
        }
    }
}

/// 服务器导入结果（与前端 ImportResult 接口对应）
///
/// 由于导入是批量操作，部分成功部分失败也属于"成功完成导入"，
/// success 仅表示导入流程本身是否完成（即非致命错误，如文件不可读/密码错误）。
/// 具体失败原因记录在 errors 数组中。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// 导入流程是否完成（false 表示密码错误/文件格式错误等致命错误）
    pub success: bool,
    /// 文件中包含的服务器总数
    pub total: usize,
    /// 成功导入的服务器数量
    pub imported: usize,
    /// 跳过（失败）的服务器数量
    pub skipped: usize,
    /// 每条失败记录的错误信息
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<String>,
    /// 致命错误信息（success=false 时）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// 成功导入的服务器新 id 列表（前端可用于刷新 store）
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub imported_ids: Vec<String>,
}

impl ImportResult {
    pub fn fail(err: impl Into<String>) -> Self {
        Self {
            success: false,
            total: 0,
            imported: 0,
            skipped: 0,
            errors: Vec::new(),
            error: Some(err.into()),
            imported_ids: Vec::new(),
        }
    }
}

/// 检测 OS 信息结果（与前端 DetectOsResult 接口对应）
///
/// 比 OperationResult 多了 osType / osInfo / status 字段，
/// 前端依赖这些字段更新服务器卡片显示。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectOsResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os_info: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

impl DetectOsResult {
    pub fn ok(os_type: &str, os_info: &str) -> Self {
        Self {
            success: true,
            error: None,
            os_type: Some(os_type.to_string()),
            os_info: Some(os_info.to_string()),
            status: Some("online".to_string()),
        }
    }

    pub fn ok_no_info() -> Self {
        Self {
            success: true,
            error: None,
            os_type: None,
            os_info: None,
            status: Some("online".to_string()),
        }
    }

    pub fn fail(err: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(err.into()),
            os_type: None,
            os_info: None,
            status: None,
        }
    }
}

/// 从可能带命名空间前缀的连接 ID（如 `sftp:<server_id>` 或 `ws:<server_id>:<tab_id>`）中提取原始 server_id
pub fn extract_base_server_id(conn_id: &str) -> &str {
    if let Some(rest) = conn_id.strip_prefix("sftp:") {
        rest
    } else if let Some(rest) = conn_id.strip_prefix("ws:") {
        rest.split(':').next().unwrap_or(rest)
    } else {
        conn_id
    }
}

/// 判断是否属于次级独立连接（如 SFTP 独立会话或多工作台独立会话）
pub fn is_secondary_connection(conn_id: &str) -> bool {
    conn_id.starts_with("sftp:") || conn_id.starts_with("ws:")
}

/// 校验 serverId 格式（与 Electron 版 validateServerId 一致，支持 sftp: 与 ws: 命名空间连接）
pub fn validate_server_id(server_id: &str) -> Result<(), String> {
    if server_id.trim().is_empty() {
        return Err("serverId is required".to_string());
    }
    let check_id = extract_base_server_id(server_id);
    if check_id.is_empty()
        || !check_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return Err("Invalid serverId format".to_string());
    }
    Ok(())
}

/// 在 SSH 执行命令并返回 CommandResult
/// 供 services / processes / ports / network / logs / docker 等模块复用
/// 默认超时 60 秒
pub async fn ssh_execute_command(server_id: &str, command: &str) -> CommandResult {
    ssh_execute_command_with_timeout(server_id, command, 60).await
}

/// 带自定义超时的 ssh_execute_command 变体。
/// 大目录扫描、压缩等耗时操作可传入更大值（如 120 秒）。
pub async fn ssh_execute_command_with_timeout(
    server_id: &str,
    command: &str,
    timeout_secs: u64,
) -> CommandResult {
    match crate::ssh::manager::SshManager::global()
        .execute(server_id, command, timeout_secs)
        .await
    {
        Ok(mut out) => {
            // russh 的 channel 有时不发送 ExitStatus 就关闭（connection.rs 中 exit_code
            // 初始为 -1）：此时若 stderr 为空，命令很可能已正常完成，视为成功。
            // 与 manager.rs 中宽容执行的语义保持一致（exit -1 + stderr 空或仅警告 → 成功），
            // 否则 docker_ps 等按退出码判定的模块会把正常结果误判为失败。
            // stderr 非空时保持失败语义（可能连接中断/命令被杀），交由调用方透传给前端。
            if out.exit_code == -1 && out.stderr.trim().is_empty() {
                out.exit_code = 0;
            }
            CommandResult {
                stdout: out.stdout,
                stderr: out.stderr,
                exit_code: out.exit_code,
            }
        }
        Err(e) => CommandResult::err(format!("{}", e)),
    }
}
