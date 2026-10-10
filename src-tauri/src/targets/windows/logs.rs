//! Windows 日志命令构造与执行
//!
//! 对应 commands/logs.rs 的 Windows 分支。
//! 使用 PowerShell 的 `Get-Content -Tail` / `Select-String`。
//! `logs_start_tail` / `logs_stop_tail` 是平台无关的，保留在 commands/logs.rs。

use crate::commands::{ssh_execute_command, CommandResult};

/// 读取日志文件末尾 N 行
///
/// 命令：`Get-Content -Tail <N> -Path <path>`
pub async fn logs_read(
    server_id: String,
    log_path: String,
    n: i64,
) -> Result<CommandResult, String> {
    let escaped = crate::validators::escape_powershell_arg(log_path);
    let script = format!("Get-Content -Tail {} -Path {}", n, escaped);
    let cmd = crate::validators::build_powershell_command(&script);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 在日志文件中搜索关键字
///
/// 命令：`Select-String -Path <path> -Pattern <keyword> | Select-Object -Last 100 | ForEach-Object { LineNumber:Line }`
///
/// Select-String 输出 "行号:内容" 格式，与 Linux 的 `grep -n` 一致。
/// 返回匹配的行（最多 100 行）
pub async fn logs_search(
    server_id: String,
    log_path: String,
    keyword: String,
) -> Result<CommandResult, String> {
    let escaped_path = crate::validators::escape_powershell_arg(log_path);
    let escaped_keyword = crate::validators::escape_powershell_arg(keyword);
    let script = format!(
        "Select-String -Path {} -Pattern {} | Select-Object -Last 100 | ForEach-Object {{ Write-Output ($_.LineNumber.ToString() + ':' + $_.Line) }}",
        escaped_path, escaped_keyword
    );
    let cmd = crate::validators::build_powershell_command(&script);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}
