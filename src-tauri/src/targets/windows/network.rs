//! Windows 网络诊断命令构造与执行
//!
//! 对应 commands/network.rs 的 Windows 分支。
//! 使用 Windows 自带的 nslookup / ping / Test-NetConnection。
//! curl 在 Windows 10+ 通用，与 Linux 共用实现（放在 targets/linux/network.rs 中）。

use crate::commands::{ssh_execute_command, CommandResult};

/// DNS 查询
///
/// 命令：`nslookup <target> 2>&1`（Windows 自带）
pub async fn network_dns(server_id: String, target: String) -> Result<CommandResult, String> {
    let cmd = format!("nslookup {} 2>&1", target);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// Ping 测试（4 次，每次 5 秒超时）
///
/// 命令：`ping -n 4 -w 5000 <target> 2>&1`
/// - `-n` 次数（与 Linux 的 `-c` 对应）
/// - `-w` 超时毫秒（与 Linux 的 `-W` 秒 对应）
pub async fn network_ping(server_id: String, target: String) -> Result<CommandResult, String> {
    let cmd = format!("ping -n 4 -w 5000 {} 2>&1", target);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// TCP 端口连通性检查
///
/// 命令：`Test-NetConnection -ComputerName '<host>' -Port <port>`
/// 输出 `Port <port> is open` 或 `Port <port> is closed`
pub async fn network_tcp_check(
    server_id: String,
    host: String,
    port: i64,
) -> Result<CommandResult, String> {
    let script = format!(
        "$r = Test-NetConnection -ComputerName '{}' -Port {} -WarningAction SilentlyContinue; if ($r.TcpTestSucceeded) {{ Write-Output 'Port {} is open' }} else {{ Write-Output 'Port {} is closed' }}",
        host.replace('\'', "''"), port, port, port
    );
    let cmd = crate::validators::build_powershell_command(&script);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}
