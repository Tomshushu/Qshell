//! Linux 日志命令构造与执行
//!
//! 对应 commands/logs.rs 的 Linux 分支。
//! 注意：`logs_start_tail` 和 `logs_stop_tail` 是平台无关的（通过 ssh::shell::tail_create/tail_close），
//! 保留在 commands/logs.rs。

use crate::commands::{ssh_execute_command, CommandResult};

/// 读取日志文件末尾 N 行
///
/// 命令：`tail -n <N> <path> 2>&1`
pub async fn logs_read(
    server_id: String,
    log_path: String,
    n: i64,
) -> Result<CommandResult, String> {
    let escaped = crate::validators::escape_shell_arg(log_path);
    let cmd = format!("tail -n {} {} 2>&1", n, escaped);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 在日志文件中搜索关键字
///
/// 命令：`grep -n <keyword> <path> 2>&1 | tail -100`
/// 返回匹配的行（最多 100 行）
pub async fn logs_search(
    server_id: String,
    log_path: String,
    keyword: String,
) -> Result<CommandResult, String> {
    let escaped_path = crate::validators::escape_shell_arg(log_path);
    let escaped_keyword = crate::validators::escape_shell_arg(keyword);
    let cmd = format!("grep -n {} {} 2>&1 | tail -100", escaped_keyword, escaped_path);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}
