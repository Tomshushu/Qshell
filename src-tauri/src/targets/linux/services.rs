//! Linux 服务管理命令构造与执行
//!
//! 服务模块精细化打磨（P0）：
//!   - 列表：`list-units`（运行态）+ `list-unit-files`（真实开机自启）合并，
//!     一次刷新仅 2 条命令，且修正此前「用 active 冒充 enabled」的错误语义。
//!   - Enable / Disable：修改开机自启策略，与 Start / Stop（运行实例）语义分离。
//!   - Inspect：`systemctl show <unit>` 全属性，供详情页 Overview / Resources 使用。
//!   - Logs：`journalctl -u <unit>` 历史日志（实时跟随 -f 后续接入流式通道）。
//!   - Capabilities：探测 systemd / journalctl / sudo，驱动前端能力降级。
//!
//! 命令构造约定：
//!   - 服务名由 commands 层 `validate_service_name` 严格校验（拒绝 shell 元字符）；
//!   - 此处再用单引号包裹，做二次防护。

use crate::commands::{ssh_execute_command, CommandResult};
use crate::parsers;
use serde_json::json;

/// 列出所有服务（运行态 + 真实开机自启状态）
///
/// 返回 JSON 字符串（ServiceInfo[]）
pub async fn services_list(server_id: String) -> Result<String, String> {
    // 1) 运行态：含 inactive / failed / activating 等全部 unit
    let units_res = ssh_execute_command(
        &server_id,
        "systemctl list-units --type=service --all --no-pager --no-legend",
    )
    .await;
    let mut services = parsers::parse_service_list(&units_res.stdout);

    // 2) 开机自启真实状态：enabled / disabled / static / masked / indirect / generated
    //    失败时降级为空表（enabled 保持 false、enabledState 为 unknown），
    //    不退回用 active 冒充，避免向 UI 提供错误数据。
    let files_res = ssh_execute_command(
        &server_id,
        "systemctl list-unit-files --type=service --no-pager --no-legend",
    )
    .await;
    let states = parsers::parse_unit_file_states(&files_res.stdout);

    for s in services.iter_mut() {
        let state = states.get(&s.name).cloned().unwrap_or_default();
        s.enabled_state = if state.is_empty() {
            "unknown".to_string()
        } else {
            state.clone()
        };
        // 仅显式 enabled 视为开启自启；static / indirect / generated 由 systemd
        // 隐式拉起，不算用户显式启用，故不计为 enabled。
        s.enabled = state == "enabled";
        // masked unit 无法被激活，同步到 loadState 供 UI 识别
        if state == "masked" {
            s.load_state = "masked".to_string();
        }
    }

    serde_json::to_string(&services).map_err(|e| format!("Serialize error: {}", e))
}

/// 启动服务（仅启动实例，不改变开机自启）
pub async fn services_start(server_id: String, service_name: String) -> Result<CommandResult, String> {
    let cmd = format!("sudo systemctl start '{}'", service_name);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 停止服务（仅停止实例，不改变开机自启）
pub async fn services_stop(server_id: String, service_name: String) -> Result<CommandResult, String> {
    let cmd = format!("sudo systemctl stop '{}'", service_name);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 重启服务
pub async fn services_restart(server_id: String, service_name: String) -> Result<CommandResult, String> {
    let cmd = format!("sudo systemctl restart '{}'", service_name);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 设置开机自启（不等价于立即启动）
pub async fn services_enable(server_id: String, service_name: String) -> Result<CommandResult, String> {
    let cmd = format!("sudo systemctl enable '{}'", service_name);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 取消开机自启（不等价于停止当前运行的实例）
pub async fn services_disable(server_id: String, service_name: String) -> Result<CommandResult, String> {
    let cmd = format!("sudo systemctl disable '{}'", service_name);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 查询服务状态（人类可读文本，用于展示原始 status）
pub async fn services_status(server_id: String, service_name: String) -> Result<CommandResult, String> {
    let cmd = format!("systemctl status '{}' --no-pager", service_name);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 服务详情：`systemctl show <unit>` 全属性
///
/// 返回 JSON 字符串（Key -> Value 属性表），包含：
///   MainPID / ExecMainStartTimestamp / FragmentPath / User / Restart /
///   Result / ExecMainStatus / ExecMainCode / NRestarts /
///   MemoryCurrent / TasksCurrent / MemoryLimit / CPUUsageNSec 等。
pub async fn services_inspect(server_id: String, service_name: String) -> Result<String, String> {
    let cmd = format!("systemctl show '{}' --no-pager", service_name);
    let res = ssh_execute_command(&server_id, &cmd).await;
    let props = parsers::parse_systemd_props(&res.stdout);
    serde_json::to_string(&props).map_err(|e| format!("Serialize error: {}", e))
}

/// 服务日志：journalctl -u <unit>
///
/// - `lines`：最近 N 行（默认 200，范围 1~10000）
/// - `since`：时间范围（如 `30 min ago`、`2026-09-08 10:00:00`）
/// - `priority`：日志级别（emerg/alert/crit/err/warning/notice/info/debug）
///
/// 使用 `-o short-iso` 输出 ISO 时间便于前端解析与高亮。
pub async fn services_logs(
    server_id: String,
    service_name: String,
    lines: Option<i32>,
    since: Option<String>,
    priority: Option<String>,
) -> Result<CommandResult, String> {
    let n = lines.unwrap_or(200).clamp(1, 10000);
    let mut cmd = format!(
        "journalctl -u '{}' --no-pager -o short-iso -n {}",
        service_name, n
    );

    // priority 仅允许纯字母，防止注入
    if let Some(p) = priority {
        let p = p.trim();
        if !p.is_empty() && p.chars().all(|c| c.is_ascii_alphabetic()) {
            cmd.push_str(&format!(" -p {}", p));
        }
    }

    // since 用单引号包裹，内部单引号按 shell 规则转义
    if let Some(s) = since {
        let s = s.trim();
        if !s.is_empty() {
            let safe = s.replace('\'', "'\\''");
            cmd.push_str(&format!(" --since '{}'", safe));
        }
    }

    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 能力探测：判断远端可用的服务管理能力，供前端做能力降级
///
/// 返回 JSON：
/// ```json
/// { "systemd": true, "journal": true, "systemRunning": true,
///   "sudoNoPass": true, "sysv": false }
/// ```
pub async fn services_capabilities(server_id: String) -> Result<String, String> {
    let cmd = concat!(
        "sh -c '",
        "command -v systemctl >/dev/null 2>&1 && echo systemd=1 || echo systemd=0;",
        "command -v journalctl >/dev/null 2>&1 && echo journal=1 || echo journal=0;",
        "systemctl is-system-running >/dev/null 2>&1 && echo running=1 || echo running=0;",
        "sudo -n true 2>/dev/null && echo sudo=1 || echo sudo=0;",
        "command -v service >/dev/null 2>&1 && echo sysv=1 || echo sysv=0",
        "'"
    );
    let res = ssh_execute_command(&server_id, cmd).await;
    let props = parsers::parse_systemd_props(&res.stdout);
    let flag = |k: &str| props.get(k).map(|v| v == "1").unwrap_or(false);

    let caps = json!({
        "systemd": flag("systemd"),
        "journal": flag("journal"),
        "systemRunning": flag("running"),
        "sudoNoPass": flag("sudo"),
        "sysv": flag("sysv"),
    });
    Ok(caps.to_string())
}

/// 服务依赖关系（P1）
///
/// 读取 Requires / Wants / Requisite / BindsTo / PartOf / Conflicts / After / Before
/// 及反向关系 RequiredBy / WantedBy。返回 JSON：
/// `{ "requires": [...], "wants": [...], ... }`
///
/// 每个条目为 unit 名（如 `network.target`），状态由前端用服务列表匹配着色。
pub async fn services_dependencies(
    server_id: String,
    service_name: String,
) -> Result<String, String> {
    let cmd = format!(
        "systemctl show '{}' --no-pager --property=Requires,Wants,Requisite,BindsTo,PartOf,Conflicts,After,Before,RequiredBy,WantedBy",
        service_name
    );
    let res = ssh_execute_command(&server_id, &cmd).await;
    let props = parsers::parse_systemd_props(&res.stdout);
    let list = |k: &str| -> Vec<String> {
        props
            .get(k)
            .map(|v| v.split_whitespace().map(|s| s.to_string()).collect())
            .unwrap_or_default()
    };
    let requires = list("Requires");
    let wants = list("Wants");
    let requisite = list("Requisite");
    let binds_to = list("BindsTo");
    let part_of = list("PartOf");
    let conflicts = list("Conflicts");
    let after = list("After");
    let before = list("Before");
    let required_by = list("RequiredBy");
    let wanted_by = list("WantedBy");

    // 批量取所有依赖 unit 的当前状态（一次命令），供前端按状态着色
    let mut all: Vec<String> = Vec::new();
    for group in [
        &requires, &wants, &requisite, &binds_to, &part_of,
        &conflicts, &after, &before, &required_by, &wanted_by,
    ] {
        all.extend(group.iter().cloned());
    }
    all.sort();
    all.dedup();

    let mut states = serde_json::Map::new();
    if !all.is_empty() {
        let quoted: Vec<String> = all.iter().map(|n| format!("'{}'", n)).collect();
        let state_cmd = format!(
            "systemctl show --no-pager --property=Id,ActiveState,SubState,LoadState {}",
            quoted.join(" ")
        );
        let state_res = ssh_execute_command(&server_id, &state_cmd).await;
        for block in parsers::parse_systemd_prop_blocks(&state_res.stdout) {
            let id = block.get("Id").cloned().unwrap_or_default();
            if id.is_empty() {
                continue;
            }
            states.insert(
                id,
                json!({
                    "activeState": block.get("ActiveState").cloned().unwrap_or_default(),
                    "subState": block.get("SubState").cloned().unwrap_or_default(),
                    "loadState": block.get("LoadState").cloned().unwrap_or_default(),
                }),
            );
        }
    }

    let deps = json!({
        "requires": requires,
        "wants": wants,
        "requisite": requisite,
        "bindsTo": binds_to,
        "partOf": part_of,
        "conflicts": conflicts,
        "after": after,
        "before": before,
        "requiredBy": required_by,
        "wantedBy": wanted_by,
        "states": states,
    });
    Ok(deps.to_string())
}

/// Unit 文件与 Drop-in 内容（P1）
///
/// `systemctl cat` 会依次输出 vendor unit 与 `/etc/systemd/system/<unit>.d/*.conf`
/// 覆盖片段，并标注文件路径，便于定位配置来源。
pub async fn services_unit_file(
    server_id: String,
    service_name: String,
) -> Result<CommandResult, String> {
    let cmd = format!("systemctl cat '{}' --no-pager", service_name);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 服务进程信息（P1）
///
/// 先取 MainPID，再输出主进程与子进程（ps）。无主进程时返回明确错误。
pub async fn services_process(
    server_id: String,
    service_name: String,
) -> Result<CommandResult, String> {
    let pid_res = ssh_execute_command(
        &server_id,
        &format!("systemctl show -p MainPID --value '{}'", service_name),
    )
    .await;
    let pid = pid_res.stdout.trim().to_string();
    if pid.is_empty() || pid == "0" || !pid.chars().all(|c| c.is_ascii_digit()) {
        return Ok(CommandResult::err(
            "服务当前没有主进程（未运行或为 oneshot 类型）".to_string(),
        ));
    }
    let cmd = format!(
        "echo '== MAIN =='; ps -o pid,ppid,user,stat,etime,pcpu,pmem,args -p {} --no-headers 2>/dev/null; echo '== CHILDREN =='; ps -o pid,ppid,user,stat,etime,args --ppid {} --no-headers 2>/dev/null",
        pid, pid
    );
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 服务监听端口（P1）
///
/// 通过 MainPID 关联 `ss -tulpn` 输出，得到该服务实际监听的端口。
pub async fn services_ports(
    server_id: String,
    service_name: String,
) -> Result<CommandResult, String> {
    let pid_res = ssh_execute_command(
        &server_id,
        &format!("systemctl show -p MainPID --value '{}'", service_name),
    )
    .await;
    let pid = pid_res.stdout.trim().to_string();
    if pid.is_empty() || pid == "0" || !pid.chars().all(|c| c.is_ascii_digit()) {
        return Ok(CommandResult::err(
            "服务当前没有主进程，无法关联监听端口".to_string(),
        ));
    }
    // grep 无匹配时 exit 1，用 `|| true` 避免被误判为命令失败
    let cmd = format!(
        "ss -tulpnH 2>/dev/null | grep -E 'pid={},' || true",
        pid
    );
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 屏蔽服务（Mask）：比 Disable 更强，禁止任何方式激活
pub async fn services_mask(server_id: String, service_name: String) -> Result<CommandResult, String> {
    let cmd = format!("sudo systemctl mask '{}'", service_name);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 解除屏蔽（Unmask）
pub async fn services_unmask(server_id: String, service_name: String) -> Result<CommandResult, String> {
    let cmd = format!("sudo systemctl unmask '{}'", service_name);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 重新加载 systemd 配置（修改 Unit / Drop-in 后需要）
pub async fn services_daemon_reload(server_id: String) -> Result<CommandResult, String> {
    Ok(ssh_execute_command(&server_id, "sudo systemctl daemon-reload").await)
}

/// 批量采集服务资源（内存 / Tasks / CPU 累计时间）
///
/// 用一次 `systemctl show` 取全部服务的 cgroup 数据，避免为每个服务单独
/// 执行 SSH 命令（文档明确避免"每个服务一个 SSH exec"）。
/// 返回 JSON：`{ "<unit>": { "memoryBytes": n, "tasks": n, "cpuNs": n } }`
///
/// CPU 百分比需要两次采样求差，由前端按需发起两次调用。
pub async fn services_resources(server_id: String) -> Result<String, String> {
    let cmd = "systemctl show --type=service --all --no-pager --property=Id,MemoryCurrent,TasksCurrent,CPUUsageNSec";
    let res = ssh_execute_command(&server_id, cmd).await;

    let mut map = serde_json::Map::new();
    for block in parsers::parse_systemd_prop_blocks(&res.stdout) {
        let id = block.get("Id").cloned().unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        map.insert(
            id,
            json!({
                "memoryBytes": block.get("MemoryCurrent").and_then(|v| v.parse::<i64>().ok()).unwrap_or(0),
                "tasks": block.get("TasksCurrent").and_then(|v| v.parse::<i64>().ok()).unwrap_or(0),
                "cpuNs": block.get("CPUUsageNSec").and_then(|v| v.parse::<i64>().ok()).unwrap_or(0),
            }),
        );
    }

    Ok(serde_json::Value::Object(map).to_string())
}
