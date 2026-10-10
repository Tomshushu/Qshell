//! Linux 进程管理命令构造与执行
//!
//! 对应 commands/processes.rs 的 Linux 分支。

use crate::commands::{ssh_execute_command, CommandResult};
use crate::parsers;

/// 返回 CPU 和内存两个维度的前 100 个进程并集，供前端按指标排序。
///
/// 命令：`ps -eo pid,ppid,user:32,%cpu,%mem,vsz,rss,stat,nice,etimes,args,cgroup`
/// 额外携带 ppid / nice / etimes / cgroup：
/// - ppid → 进程树
/// - etimes → ProcessKey（PID 复用保护）
/// - cgroup → 推导 systemd 服务名 / Docker 容器，支撑跨模块关联
///
/// 返回 JSON 字符串（ProcessInfo[]）
pub async fn processes_list(server_id: String) -> Result<String, String> {
    let cmd = "(ps -eo pid,ppid,user:32,%cpu,%mem,vsz,rss,stat,nice,etimes,args,cgroup --sort=-%cpu | head -101; ps -eo pid,ppid,user:32,%cpu,%mem,vsz,rss,stat,nice,etimes,args,cgroup --sort=-%mem | head -101)".to_string();
    let res = ssh_execute_command(&server_id, &cmd).await;
    let processes = parsers::parse_process_list_linux(&res.stdout);
    serde_json::to_string(&processes).map_err(|e| format!("Serialize error: {}", e))
}

/// 向进程发送信号（TERM / KILL）。
///
/// - signal = "term"：发送 SIGTERM（kill，优雅终止）
/// - signal = "kill"：发送 SIGKILL（kill -9，强制终止）
///
/// 竞态保护：若前端携带 `start_time_ticks`，先通过 `ps -o etimes= -p <pid>` 回读当前进程
/// 的启动时长；与前端记录不一致即认为 PID 已被复用，拒绝操作并提示刷新。
pub async fn processes_signal(
    server_id: String,
    pid: i64,
    signal: String,
    start_time_ticks: Option<i64>,
) -> Result<CommandResult, String> {
    if let Some(expected) = start_time_ticks {
        if expected > 0 {
            let check_cmd = format!("ps -o etimes= -p {}", pid);
            let res = ssh_execute_command(&server_id, &check_cmd).await;
            let current = res.stdout.trim().parse::<i64>().unwrap_or(-1);
            if current != expected {
                return Ok(CommandResult::err(
                    "进程已变化（PID 可能已被系统复用），请刷新列表后重试".to_string(),
                ));
            }
        }
    }
    let sig = if signal.eq_ignore_ascii_case("kill") { "-9" } else { "" };
    let cmd = format!("kill {} {}", sig, pid);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}
