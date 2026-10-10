//! Windows 端口管理命令构造与执行
//!
//! 对应 commands/ports.rs 的 Windows 分支。
//! 通过 PowerShell `Get-NetTCPConnection -State Listen` 输出与 `ss -tunlp` 兼容的格式，
//! 复用 parse_port_list 解析器。

use crate::commands::{ssh_execute_command, CommandResult};
use crate::parsers;

/// 列出所有监听端口
///
/// 输出与 `ss -tunlp` 相同的列布局，复用 parse_port_list 解析器：
/// `Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process`
pub async fn ports_list(server_id: String) -> Result<String, String> {
    let script = "Write-Output 'Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process'; Get-NetTCPConnection -State Listen | ForEach-Object { $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; $pname = if ($proc) { $proc.ProcessName } else { '' }; Write-Output ('tcp LISTEN 0 0 ' + $_.LocalAddress + ':' + $_.LocalPort + ' 0.0.0.0:* users:((' + $pname + ',pid=' + $_.OwningProcess + ',fd=0))') }";
    let cmd = crate::validators::build_powershell_command(script);
    let res = ssh_execute_command(&server_id, &cmd).await;
    let ports = parsers::parse_port_list(&res.stdout);
    serde_json::to_string(&ports).map_err(|e| format!("Serialize error: {}", e))
}

/// 按 PID 结束占用端口的进程
///
/// 命令：`Stop-Process -Id <pid> -Force`
pub async fn ports_kill_by_pid(server_id: String, pid: i64) -> Result<CommandResult, String> {
    let script = format!("Stop-Process -Id {} -Force", pid);
    let cmd = crate::validators::build_powershell_command(&script);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}
