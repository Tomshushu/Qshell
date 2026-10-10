//! Windows 进程管理命令构造与执行
//!
//! 对应 commands/processes.rs 的 Windows 分支。
//! 通过 PowerShell `Get-CimInstance Win32_Process` 输出与 `ps aux` 兼容的格式，
//! 复用 parse_process_list 解析器。

use crate::commands::{ssh_execute_command, CommandResult};
use crate::parsers;

/// 返回内存排名前 100 个进程；Windows 当前 CPU 字段由采集脚本提供兼容值。
///
/// 输出与 `ps aux` 相同的列布局，复用 parse_process_list 解析器：
/// `USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND`
///
/// Windows 不区分 user，固定输出 `N/A`；CPU/MEM 占位为 0.0。
pub async fn processes_list(server_id: String) -> Result<String, String> {
    let script = "$totalMem = (Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize; Write-Output 'USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND'; Get-CimInstance Win32_Process | Sort-Object WorkingSetSize -Descending | Select-Object -First 100 | ForEach-Object { $vsz=[math]::Round($_.VirtualSize/1024,0); $rss=[math]::Round($_.WorkingSetSize/1024,0); $memPct=if ($totalMem -gt 0) { [math]::Round(($_.WorkingSetSize / 1024 / $totalMem) * 100, 1) } else { 0.0 }; $start='Jan01'; if ($_.CreationDate) { try { $start=([Management.ManagementDateTimeConverter]::ToDateTime($_.CreationDate)).ToString('MMMdd') } catch {} }; Write-Output ('N/A ' + $_.ProcessId + ' 0.0 ' + $memPct + ' ' + $vsz + ' ' + $rss + ' ? S ' + $start + ' 0:00 ' + $_.Name) }";
    let cmd = crate::validators::build_powershell_command(script);
    let res = ssh_execute_command(&server_id, &cmd).await;
    let processes = parsers::parse_process_list(&res.stdout);
    serde_json::to_string(&processes).map_err(|e| format!("Serialize error: {}", e))
}

/// 向进程发送信号（TERM / KILL）。
///
/// Windows 没有 POSIX 信号语义：
/// - signal = "term"：Stop-Process -Id <pid>（优雅请求退出）
/// - signal = "kill"：Stop-Process -Id <pid> -Force（强制结束）
///
/// `start_time_ticks` 为 Linux 侧的 PID 复用保护字段，Windows 暂不适用，忽略。
pub async fn processes_signal(
    server_id: String,
    pid: i64,
    signal: String,
    _start_time_ticks: Option<i64>,
) -> Result<CommandResult, String> {
    let force_flag = if signal.eq_ignore_ascii_case("kill") { "-Force" } else { "" };
    let script = format!("Stop-Process -Id {} {}", pid, force_flag);
    let cmd = crate::validators::build_powershell_command(&script);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}
