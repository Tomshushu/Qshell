//! Linux 网络诊断命令构造与执行
//!
//! 对应 commands/network.rs 的 Linux 分支。

use crate::commands::{ssh_execute_command, CommandResult};
use crate::validators::escape_shell_arg;

/// DNS 查询
///
/// 命令：`nslookup <target> 2>&1 || dig <target> +short 2>&1`
pub async fn network_dns(server_id: String, target: String) -> Result<CommandResult, String> {
    let target = escape_shell_arg(target);
    let cmd = format!("nslookup {0} 2>&1 || dig {0} +short 2>&1", target);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// Ping 测试（4 次，每次 5 秒超时）
///
/// 命令：`ping -c 4 -W 5 <target> 2>&1`
pub async fn network_ping(server_id: String, target: String) -> Result<CommandResult, String> {
    let target = escape_shell_arg(target);
    let cmd = format!("ping -c 4 -W 5 {} 2>&1", target);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// TCP 端口连通性检查
///
/// 命令：`nc -zv -w 5 <host> <port> 2>&1 || (echo >/dev/tcp/<host>/<port>) 2>&1 && echo "Port <port> is open" || echo "Port <port> is closed"`
pub async fn network_tcp_check(
    server_id: String,
    host: String,
    port: i64,
) -> Result<CommandResult, String> {
    let host = escape_shell_arg(host);
    let cmd = format!(
        "nc -zv -w 5 {} {} 2>&1 || (echo >/dev/tcp/{}/{}) 2>&1 && echo \"Port {} is open\" || echo \"Port {} is closed\"",
        host, port, host, port, port, port
    );
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// HTTP 可达性检查
///
/// 命令：`curl -I -s -m 10 -L <url> 2>&1`
///
/// curl 在 Linux/Windows 均可用，此处放入 Linux 模块以保持结构一致。
pub async fn network_http_check(server_id: String, url: String) -> Result<CommandResult, String> {
    let url = escape_shell_arg(url);
    let cmd = format!("curl -I -s -m 10 -L {} 2>&1", url);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}
