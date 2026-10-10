//! Linux 端口管理命令构造与执行
//!
//! 对应 commands/ports.rs 的 Linux 分支。

use crate::commands::{ssh_execute_command, CommandResult};
use crate::parsers;

/// 列出所有监听端口
///
/// 命令：`ss -tunlp 2>/dev/null || netstat -tunlp 2>/dev/null`
///
/// 返回 JSON 字符串（PortInfo[]）
pub async fn ports_list(server_id: String) -> Result<String, String> {
    let cmd = "ss -tunlp 2>/dev/null || netstat -tunlp 2>/dev/null".to_string();
    let res = ssh_execute_command(&server_id, &cmd).await;
    let ports = parsers::parse_port_list(&res.stdout);
    serde_json::to_string(&ports).map_err(|e| format!("Serialize error: {}", e))
}

/// 按 PID 结束占用端口的进程
///
/// 命令：`kill <pid>`
pub async fn ports_kill_by_pid(server_id: String, pid: i64) -> Result<CommandResult, String> {
    let cmd = format!("kill {}", pid);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}
