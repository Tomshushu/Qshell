// Docker 管理 commands
//
// 对应 Electron 版 ipc.js 中的:
//   docker:ps / docker:images / docker:start / docker:stop / docker:restart
//   docker:logs / docker:stats / docker:inspect / docker:composePs

use regex::Regex;
use std::sync::LazyLock;

use tauri::{AppHandle, Emitter};

use crate::parsers;

use serde_json::json;
use super::{ssh_execute_command, ssh_execute_command_with_timeout, CommandResult};

/// 镜像 ID/引用校验正则：允许字母数字、点、下划线、冒号、斜杠、短横线，长度 1-128
static IMAGE_ID_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9._:/-]{1,128}$").unwrap());

/// Compose 项目名校验正则：允许字母数字、点、下划线、短横线，长度 1-128
static COMPOSE_PROJECT_NAME_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9._-]{1,128}$").unwrap());

/// Subnet 校验正则（CIDR，如 172.20.0.0/16 或 IPv6 段）：用于网络创建参数白名单
static CIDR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([0-9a-fA-F:.]+)/(0|[1-9][0-9]*)$").unwrap());

/// Gateway/单 IP 校验正则：用于网络创建参数白名单
static IP_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-9a-fA-F:.]+$").unwrap());

/// 端口映射行校验正则：`host:container` 或 `host:container/(tcp|udp)`
static PORT_MAPPING_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\d{1,5}:\d{1,5}(?:/(?:tcp|udp))?$").unwrap());

/// 列出所有容器（含已停止）
#[tauri::command]
pub async fn docker_ps(server_id: String) -> Result<String, String> {
    let cmd = "docker ps -a --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.State}}|{{.Ports}}|{{.CreatedAt}}'";
    let res = ssh_execute_command(&server_id, cmd).await;
    // 调试日志：输出原始返回便于排查解析失败问题
    eprintln!(
        "[docker_ps] server_id={}, exit_code={}, stdout_len={}, stderr_len={}",
        server_id, res.exit_code, res.stdout.len(), res.stderr.len()
    );
    if !res.stderr.is_empty() {
        eprintln!("[docker_ps] stderr: {}", res.stderr);
    }
    if res.stdout.is_empty() {
        eprintln!("[docker_ps] stdout 为空");
    } else {
        eprintln!("[docker_ps] stdout 前 300 字符: {}", &res.stdout.chars().take(300).collect::<String>());
    }
    // 执行失败必须透传：docker 未安装（exit 127）/daemon 未运行/SSH 未连接时
    // stdout 为空，若静默解析会返回空列表，前端把错误呈现为"没有容器"。
    // CommandResult::err（未连接等）的 exit_code 为 1，同样在此被捕获。
    if res.exit_code != 0 {
        let msg = res.stderr.trim();
        if msg.is_empty() {
            return Err(format!("docker ps failed (exit {})", res.exit_code));
        }
        return Err(format!("docker ps failed (exit {}): {}", res.exit_code, msg));
    }
    let containers = parsers::parse_docker_ps(&res.stdout);
    eprintln!("[docker_ps] 解析出 {} 个容器", containers.len());
    serde_json::to_string(&containers).map_err(|e| format!("Serialize error: {}", e))
}

/// 列出所有镜像
///
/// 同时执行 `docker inspect` 获取容器引用的实际镜像 SHA256 ID，标记每个镜像是否被容器使用、
/// 是否被运行中容器使用。前端据此区分：运行中/已停止/悬空/未使用 四种状态。
///
/// 为什么不用 `docker ps -a --format '{{.Image}}'`？
/// docker ps 的 Image 列显示的是创建容器时使用的镜像引用（如 `nginx:latest`），
/// 而非镜像 ID。对于用 repo:tag 创建的容器，此列永远不会是镜像 ID，导致无法匹配。
/// docker inspect 的 `.Image` 字段返回的是镜像的完整 SHA256（如 `sha256:abc123...`），
/// 这是唯一可靠的跨场景匹配方式。
///
/// 使用单次 SSH 会话执行复合命令（用 `;` 分隔），避免多次往返延迟。
/// 无容器时 `docker ps -aq` 输出为空，通过 `if [ -n "$containers" ]` 跳过 inspect 避免报错。
#[tauri::command]
pub async fn docker_images(server_id: String) -> Result<String, String> {
    // 复合命令：先列镜像（显式捕获退出码 rc），再 inspect 所有容器获取镜像 SHA256。
    // 用 `;` 串联时整体退出码只反映最后一段（if/fi 恒为 0），docker 不存在/daemon
    // 未运行会被掩盖 —— 因此第一段命令的真实退出码通过 RC=$rc 行带回。
    let cmd = concat!(
        "docker images --format '{{.Repository}}|{{.Tag}}|{{.ID}}|{{.CreatedSince}}|{{.Size}}'; rc=$?;",
        "echo '---SEPARATOR---';",
        "echo \"RC=$rc\";",
        "containers=$(docker ps -aq); if [ -n \"$containers\" ]; then docker inspect $containers --format '{{.State.Status}}|{{.Image}}'; fi"
    );
    let res = ssh_execute_command(&server_id, cmd).await;

    // SSH 层失败（未连接/超时）：stdout 为空，直接透传错误
    if res.exit_code != 0 && res.stdout.trim().is_empty() {
        let msg = res.stderr.trim();
        if msg.is_empty() {
            return Err(format!("docker images failed (exit {})", res.exit_code));
        }
        return Err(format!("docker images failed (exit {}): {}", res.exit_code, msg));
    }

    // 拆分两部分输出：镜像列表 + RC 标记行 + 容器引用
    let mut parts = res.stdout.split("---SEPARATOR---");
    let images_output = parts.next().unwrap_or("");
    let containers_output = parts.next().unwrap_or("");

    // 解析 RC 行（第一段命令的真实退出码），非 0 视为执行失败
    let mut rc_code: Option<i32> = None;
    let mut container_lines = String::new();
    for (i, line) in containers_output.lines().enumerate() {
        if i == 0 && line.starts_with("RC=") {
            rc_code = line[3..].trim().parse::<i32>().ok();
        } else {
            container_lines.push_str(line);
            container_lines.push('\n');
        }
    }
    if let Some(rc) = rc_code {
        if rc != 0 {
            let msg = res.stderr.trim();
            if msg.is_empty() {
                return Err(format!("docker images failed (exit {})", rc));
            }
            return Err(format!("docker images failed (exit {}): {}", rc, msg));
        }
    }
    let containers_output = container_lines.as_str();

    // 解析容器引用：收集所有被引用的镜像 ID，以及被运行中容器引用的镜像 ID
    // docker inspect 的 {{.Image}} 输出格式为 sha256:abc123def456...，取前 12 位匹配
    let mut used_image_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut running_image_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for line in containers_output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let cols: Vec<&str> = line.split('|').collect();
        if cols.len() < 2 {
            continue;
        }
        let state = cols[0];
        let image_sha = cols[1];
        // 去掉 sha256: 前缀，取前 12 位作为短 ID
        let id_part = image_sha.strip_prefix("sha256:").unwrap_or(image_sha);
        let short_id = id_part.get(..12).unwrap_or(id_part).to_string();
        if short_id.len() >= 12 {
            used_image_ids.insert(short_id.clone());
            if state == "running" {
                running_image_ids.insert(short_id);
            }
        }
    }

    let images = parsers::parse_docker_images(images_output, &used_image_ids, &running_image_ids);
    eprintln!(
        "[docker_images] server_id={}, exit_code={}, images_output_len={}, containers_output_len={}, used={}, running={}, parsed={}",
        server_id, res.exit_code, images_output.len(), containers_output.len(),
        used_image_ids.len(), running_image_ids.len(), images.len()
    );
    if !res.stderr.is_empty() {
        eprintln!("[docker_images] stderr: {}", res.stderr);
    }
    if images_output.is_empty() {
        eprintln!("[docker_images] 镜像输出为空");
    } else {
        eprintln!("[docker_images] 镜像输出前 300 字符: {}", &images_output.chars().take(300).collect::<String>());
    }
    serde_json::to_string(&images).map_err(|e| format!("Serialize error: {}", e))
}

/// 启动容器
#[tauri::command]
pub async fn docker_start(
    server_id: String,
    container_id: String,
) -> Result<CommandResult, String> {
    let validation = crate::validators::validate_container_id(container_id.clone());
    if !validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid container ID: {}",
            validation.error.unwrap_or_default()
        )));
    }
    let cmd = format!("docker start {}", container_id);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 停止容器
#[tauri::command]
pub async fn docker_stop(
    server_id: String,
    container_id: String,
) -> Result<CommandResult, String> {
    let validation = crate::validators::validate_container_id(container_id.clone());
    if !validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid container ID: {}",
            validation.error.unwrap_or_default()
        )));
    }
    let cmd = format!("docker stop {}", container_id);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 重启容器
#[tauri::command]
pub async fn docker_restart(
    server_id: String,
    container_id: String,
) -> Result<CommandResult, String> {
    let validation = crate::validators::validate_container_id(container_id.clone());
    if !validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid container ID: {}",
            validation.error.unwrap_or_default()
        )));
    }
    let cmd = format!("docker restart {}", container_id);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 查看容器日志
/// - lines: 初始加载的尾部行数（默认 1000）
/// - since: ISO8601 时间戳，仅获取该时间之后的日志（用于轮询增量）
///   当 since 提供时，忽略 lines 参数
#[tauri::command]
pub async fn docker_logs(
    server_id: String,
    container_id: String,
    lines: Option<i64>,
    since: Option<String>,
) -> Result<CommandResult, String> {
    let container_validation = crate::validators::validate_container_id(container_id.clone());
    if !container_validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid container ID: {}",
            container_validation.error.unwrap_or_default()
        )));
    }

    let cmd = if let Some(s) = &since {
        // 增量轮询模式：获取 since 之后的日志
        // F4 修复：since 是前端传入的 ISO8601 时间字符串，未做校验，必须 escape
        // container_id 虽已 validate，仍按 defense-in-depth 一并 escape
        let escaped_since = crate::validators::escape_shell_arg(s.clone());
        let escaped_cid = crate::validators::escape_shell_arg(container_id.clone());
        format!("docker logs --since {} {} 2>&1", escaped_since, escaped_cid)
    } else {
        // 初始加载模式：获取尾部 N 行
        let n = lines.unwrap_or(1000);
        let lines_validation = crate::validators::validate_pid(n.to_string());
        if !lines_validation.valid {
            return Ok(CommandResult::err(format!(
                "Invalid lines parameter: {}",
                lines_validation.error.unwrap_or_default()
            )));
        }
        format!("docker logs --tail {} {} 2>&1", n, container_id)
    };

    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 查看容器资源占用（JSON 格式，便于前端解析和图表展示）
/// 使用 --format "{{json .}}" 输出结构化数据：
/// {"CPUPerc":"0.12%","MemUsage":"5.2MiB / 4GiB","MemPerc":"0.10%","NetIO":"1.2kB / 3.4kB","BlockIO":"0B / 0B","PIDs":"5"}
/// 注意：不使用 2>&1，让 stderr 正常返回错误信息，避免污染 stdout 的 JSON 输出
#[tauri::command]
pub async fn docker_stats(
    server_id: String,
    container_id: String,
) -> Result<CommandResult, String> {
    let validation = crate::validators::validate_container_id(container_id.clone());
    if !validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid container ID: {}",
            validation.error.unwrap_or_default()
        )));
    }
    let cmd = format!(
        "docker stats --no-stream --format '{{{{json .}}}}' {}",
        container_id
    );
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 查看容器详细信息
/// 注意：不使用 2>&1，让 stderr 正常返回错误信息
#[tauri::command]
pub async fn docker_inspect(
    server_id: String,
    container_id: String,
) -> Result<CommandResult, String> {
    let validation = crate::validators::validate_container_id(container_id.clone());
    if !validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid container ID: {}",
            validation.error.unwrap_or_default()
        )));
    }
    let cmd = format!("docker inspect {}", container_id);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 列出所有 docker compose 项目
///
/// 使用单条复合命令按优先级回退：JSON 格式 → 表格格式，v2 → v1。
/// `||` 链确保前一个失败时尝试下一个，stdout 取第一个成功命令的输出。
/// 退出码不稳定（--format json 旧版不支持会导致非0），前端根据 stdout 是否
/// 有内容决定解析，不依赖 exit_code。
#[tauri::command]
pub async fn docker_compose_ps(server_id: String) -> Result<CommandResult, String> {
    let cmd = "docker compose ls --format json 2>/dev/null \
         || docker-compose ls --format json 2>/dev/null \
         || docker compose ls 2>/dev/null \
         || docker-compose ls 2>/dev/null";
    let res = ssh_execute_command(&server_id, cmd).await;
    // 调试日志
    eprintln!(
        "[docker_compose_ps] server_id={}, exit_code={}, stdout_len={}, stderr_len={}",
        server_id, res.exit_code, res.stdout.len(), res.stderr.len()
    );
    if !res.stderr.is_empty() {
        eprintln!("[docker_compose_ps] stderr: {}", res.stderr);
    }
    if res.stdout.is_empty() {
        eprintln!("[docker_compose_ps] stdout 为空");
    } else {
        eprintln!("[docker_compose_ps] stdout 前 500 字符: {}", &res.stdout.chars().take(500).collect::<String>());
    }
    Ok(res)
}

/// 合并后的 Compose 项目条目（注册表 ∪ 实时状态）
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeProjectEntry {
    pub name: String,
    pub status: String,
    pub config_file: String,
    /// 当前是否真的存在容器（即出现在 `docker compose ls` 中）。
    /// false 表示已登记但已停止/移除（down 之后），UI 应显示"未运行"。
    pub exists: bool,
}

/// 列出 Compose 项目 = 注册表 ∪ `docker compose ls` 实时结果。
///
/// 为什么要合并：`docker compose ls` 通过扫描容器标签聚合项目，down 之后容器被删除，
/// 项目会从结果里彻底消失。Dockge/Portainer 的做法是自建注册表把"项目"与"运行状态"
/// 解耦，这里沿用同一模型：已登记的项目即使没有容器也继续显示（exists=false）。
#[tauri::command]
pub async fn docker_compose_list(server_id: String) -> Result<String, String> {
    let base_server_id = crate::commands::extract_base_server_id(&server_id).to_string();
    let cmd = "docker compose ls --format json 2>/dev/null \
         || docker-compose ls --format json 2>/dev/null \
         || docker compose ls 2>/dev/null \
         || docker-compose ls 2>/dev/null";
    let res = ssh_execute_command(&server_id, cmd).await;

    // 1) 解析实时结果（JSON 数组或表格回退），得到 (name, status, configFile)
    let mut live: Vec<(String, String, String)> = Vec::new();
    if !res.stdout.trim().is_empty() {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(res.stdout.trim()) {
            let arr = match &v {
                serde_json::Value::Array(a) => a.clone(),
                other => vec![other.clone()],
            };
            for item in arr {
                let name = item
                    .get("Name")
                    .or_else(|| item.get("name"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                if name.is_empty() {
                    continue;
                }
                let status = item
                    .get("Status")
                    .or_else(|| item.get("status"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                let config_file = item
                    .get("ConfigFiles")
                    .or_else(|| item.get("configFiles"))
                    .or_else(|| item.get("ConfigFiles"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("")
                    .to_string();
                live.push((name, status, config_file));
            }
        }
    }

    // 2) 实时结果里出现的项目自动登记进注册表（让老项目也能沉淀下来）
    for (name, _, config_file) in &live {
        let dir = compose_dir_of(config_file);
        let _ = crate::db::upsert_compose_project(&base_server_id, name, &dir, config_file);
    }

    // 3) 合并：以 (dir, config_file) 为键去重，实时优先
    let mut merged: Vec<ComposeProjectEntry> = Vec::new();
    let mut seen: std::collections::HashSet<(String, String)> =
        std::collections::HashSet::new();
    // 同一目录即同一 compose 项目（与 docker compose 以目录为项目根一致）。
    // config_file 可能因"默认文件空串 vs ls 返回真实路径"而不同，
    // 仅靠 (dir, config_file) 去重会漏掉这类情况，故额外用 dir 兜底去重。
    let mut seen_dirs: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (name, status, config_file) in &live {
        let dir = compose_dir_of(config_file);
        seen.insert((dir.clone(), config_file.clone()));
        seen_dirs.insert(dir.clone());
        merged.push(ComposeProjectEntry {
            name: name.clone(),
            status: status.clone(),
            config_file: config_file.clone(),
            exists: true,
        });
    }
    // 4) 注册表里有、实时没有的 → 已停止/已移除，仍展示；
    //    但若其配置文件已从磁盘删除，则同步清除注册表记录，避免幽灵"已停止"卡片。
    if let Ok(known) = crate::db::list_compose_projects(&base_server_id) {
        // 4a) 为每个注册项推导待校验的真实文件路径：
        //     - configFile 非空 → 即该文件；
        //     - configFile 为空（默认文件启动）→ 目录下 4 个标准文件名兜底。
        let standard_names = [
            "docker-compose.yml",
            "docker-compose.yaml",
            "compose.yml",
            "compose.yaml",
        ];
        let mut candidates: Vec<(String, String, String, Vec<String>)> = Vec::new();
        for (name, dir, config_file) in &known {
            let files: Vec<String> = if config_file.is_empty() {
                standard_names
                    .iter()
                    .map(|n| format!("{}/{}", dir.trim_end_matches('/'), n))
                    .collect()
            } else {
                vec![config_file.clone()]
            };
            candidates.push((name.clone(), dir.clone(), config_file.clone(), files));
        }
        // 4b) 一次性（单次 SSH 往返）探测这些文件是否仍存在
        let all_files: Vec<String> =
            candidates.iter().flat_map(|(_, _, _, fs)| fs.iter().cloned()).collect();
        let mut existing: std::collections::HashSet<String> = std::collections::HashSet::new();
        if !all_files.is_empty() {
            let mut cmd = String::from("for f in");
            for f in &all_files {
                cmd.push(' ');
                cmd.push_str(&crate::validators::escape_shell_arg(f.clone()));
            }
            // 末尾打印成功标记 CK_DONE：仅当该标记存在才信任探测结果，
            // 避免 SSH 失败（stdout 为空/报错）时误删有效注册记录。
            cmd.push_str("; do [ -f \"$f\" ] && echo \"EXISTS:$f\"; done; echo CK_DONE");
            let res = ssh_execute_command(&server_id, &cmd).await;
            if res.stdout.contains("CK_DONE") {
                for line in res.stdout.lines() {
                    if let Some(p) = line.strip_prefix("EXISTS:") {
                        existing.insert(p.to_string());
                    }
                }
            }
        }
        // 4c) 文件已删除 → forget；仍存在的停止项 → 展示为"已停止"
        for (name, dir, config_file, files) in &candidates {
            // 实时已存在（同 dir 或同 (dir, config_file)）→ 跳过，避免重复卡片
            if seen_dirs.contains(dir) || seen.contains(&(dir.clone(), config_file.clone())) {
                continue;
            }
            let still_exists = files.iter().any(|f| existing.contains(f));
            if !still_exists {
                // 配置文件已从磁盘删除：清除注册表记录，下次不再展示幽灵卡片
                let _ = crate::db::forget_compose_project(&base_server_id, dir, config_file);
                continue;
            }
            let display = if name.is_empty() {
                dir.rsplit('/').next().unwrap_or("").to_string()
            } else {
                name.clone()
            };
            merged.push(ComposeProjectEntry {
                name: display,
                status: String::new(), // 前端据此显示"未运行"
                config_file: config_file.clone(),
                exists: false,
            });
        }
    }
    Ok(serde_json::to_string(&merged).unwrap_or_else(|_| "[]".to_string()))
}

/// 从 compose 文件路径推导项目目录（与前端 deriveComposeDir 同口径）
fn compose_dir_of(config_file: &str) -> String {
    let t = config_file.trim();
    if t.is_empty() {
        return String::new();
    }
    match t.rfind('/') {
        Some(0) => "/".to_string(),
        Some(i) => t[..i].to_string(),
        None => String::new(),
    }
}

/// 忘记（注销）一个已登记的 Compose 项目：仅从注册表移除，不动服务器上的文件/容器
#[tauri::command]
pub async fn docker_compose_forget(
    server_id: String,
    project_dir: String,
    config_file: String,
) -> Result<(), String> {
    let validation = crate::validators::validate_path(project_dir.clone(), false);
    if !validation.valid {
        return Err(format!(
            "Invalid project directory: {}",
            validation.error.unwrap_or_default()
        ));
    }
    let base_server_id = crate::commands::extract_base_server_id(&server_id);
    crate::db::forget_compose_project(base_server_id, &project_dir, &config_file)
}

/// 删除镜像
/// image_id 可以是短 ID/长 ID 或 repository:tag 引用，校验后 escape 再拼命令
#[tauri::command]
pub async fn docker_rmi(server_id: String, image_id: String) -> Result<CommandResult, String> {
    if !IMAGE_ID_RE.is_match(&image_id) {
        return Ok(CommandResult::err(
            "Invalid image ID: must match ^[a-zA-Z0-9._:/-]{1,128}$",
        ));
    }
    let audit_id = image_id.clone();
    let escaped = crate::validators::escape_shell_arg(image_id);
    let cmd = format!("docker rmi {} 2>&1", escaped);
    let res = ssh_execute_command(&server_id, &cmd).await;
    // 审计：镜像删除为破坏性操作，成败均落库
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        "删除镜像",
        if res.exit_code == 0 { "success" } else { "failed" },
        Some(&audit_id),
    );
    Ok(res)
}

/// 清理 dangling 镜像
#[tauri::command]
pub async fn docker_image_prune(server_id: String) -> Result<CommandResult, String> {
    let res = ssh_execute_command(&server_id, "docker image prune -f 2>&1").await;
    // 审计：悬空镜像清理为破坏性操作，成败均落库
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        "清理悬空镜像",
        if res.exit_code == 0 { "success" } else { "failed" },
        None,
    );
    Ok(res)
}

/// 删除容器
/// force=true 时使用 docker rm -f，可删除运行中的容器
#[tauri::command]
pub async fn docker_rm(
    server_id: String,
    container_id: String,
    force: bool,
) -> Result<CommandResult, String> {
    let validation = crate::validators::validate_container_id(container_id.clone());
    if !validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid container ID: {}",
            validation.error.unwrap_or_default()
        )));
    }
    // defense-in-depth：validate 通过后仍 escape
    let audit_id = container_id.clone();
    let escaped = crate::validators::escape_shell_arg(container_id);
    let cmd = if force {
        format!("docker rm -f {} 2>&1", escaped)
    } else {
        format!("docker rm {} 2>&1", escaped)
    };
    let res = ssh_execute_command(&server_id, &cmd).await;
    // 审计：容器删除为破坏性操作，成败均落库（与 BMC 模块的审计标准对齐）
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        if force { "强制删除容器" } else { "删除容器" },
        if res.exit_code == 0 { "success" } else { "failed" },
        Some(&audit_id),
    );
    Ok(res)
}

/// docker compose up -d：在项目目录下启动 compose 服务
///
/// `config_files`：逗号分隔的 compose 文件路径列表（可空）
/// - 非空：用 `-f file1 -f file2 ...` 显式指定多文件，按 Docker 合并规则执行
/// - 空：cd 到 project_dir 后用默认 `docker-compose.yml`/`compose.yaml`
#[tauri::command]
pub async fn docker_compose_up(
    server_id: String,
    project_dir: String,
    config_files: Option<String>,
) -> Result<CommandResult, String> {
    let validation = crate::validators::validate_path(project_dir.clone(), false);
    if !validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid project directory: {}",
            validation.error.unwrap_or_default()
        )));
    }
    // 登记进注册表（导入流程走的是这条非流式命令）。
// 必须在 escape_shell_arg 之前：它会按值移动 project_dir。
    {
        let cfg = config_files.clone().unwrap_or_default();
        let name = project_dir
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or("")
            .to_string();
        let base_server_id = crate::commands::extract_base_server_id(&server_id);
        let _ = crate::db::upsert_compose_project(base_server_id, &name, &project_dir, &cfg);
    }
    let escaped_dir = crate::validators::escape_shell_arg(project_dir);
    // 构建 -f 参数段：每个文件路径单独 escape，防止注入
    let f_args = build_compose_file_args(config_files.as_deref());
    let cmd = format!("cd {} && docker compose {} up -d 2>&1", escaped_dir, f_args);
    // compose up 可能包含镜像拉取/构建，默认 60s 超时必然不够，放宽到 10 分钟。
    // 超时仅表示客户端放弃等待，远端真实状态以刷新后的容器列表为准。
    Ok(ssh_execute_command_with_timeout(&server_id, &cmd, 600).await)
}

/// docker compose down：在项目目录下停止并删除 compose 服务
///
/// `config_files`：逗号分隔的 compose 文件路径列表（可空），语义同 docker_compose_up
#[tauri::command]
pub async fn docker_compose_down(
    server_id: String,
    project_dir: String,
    config_files: Option<String>,
) -> Result<CommandResult, String> {
    let validation = crate::validators::validate_path(project_dir.clone(), false);
    if !validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid project directory: {}",
            validation.error.unwrap_or_default()
        )));
    }
    let audit_dir = project_dir.clone();
    let escaped_dir = crate::validators::escape_shell_arg(project_dir);
    let f_args = build_compose_file_args(config_files.as_deref());
    let cmd = format!("cd {} && docker compose {} down 2>&1", escaped_dir, f_args);
    // down 需要停止全部服务再删除，与 up 同样放宽到 10 分钟
    let res = ssh_execute_command_with_timeout(&server_id, &cmd, 600).await;
    // 审计：down 删除项目全部容器，属破坏性操作，成败均落库
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        "docker compose down",
        if res.exit_code == 0 { "success" } else { "failed" },
        Some(&audit_dir),
    );
    Ok(res)
}

// ============================================================
// 网络与卷管理 + 镜像拉取（P2 功能扩展）
// ============================================================

/// Docker 网络信息
#[derive(serde::Serialize)]
pub struct DockerNetwork {
    pub name: String,
    pub driver: String,
    pub scope: String,
}

/// Docker 卷信息
#[derive(serde::Serialize)]
pub struct DockerVolume {
    pub name: String,
    pub driver: String,
    /// 是否悬空（未被任何容器引用）
    pub dangling: bool,
}

/// 校验网络/卷名称（与 COMPOSE_PROJECT_NAME_RE 同规则：^[a-zA-Z0-9._-]{1,128}$）
fn validate_resource_name(name: &str) -> Result<(), String> {
    if COMPOSE_PROJECT_NAME_RE.is_match(name) {
        Ok(())
    } else {
        Err("Invalid name: must match ^[a-zA-Z0-9._-]{1,128}$".to_string())
    }
}

/// 统一的执行失败错误消息
fn exec_error(context: &str, exit_code: i32, stderr: &str) -> String {
    let msg = stderr.trim();
    if msg.is_empty() {
        format!("{} failed (exit {})", context, exit_code)
    } else {
        format!("{} failed (exit {}): {}", context, exit_code, msg)
    }
}

/// 列出所有 Docker 网络
#[tauri::command]
pub async fn docker_network_ls(server_id: String) -> Result<String, String> {
    let cmd = "docker network ls --format '{{.Name}}|{{.Driver}}|{{.Scope}}'";
    let res = ssh_execute_command(&server_id, cmd).await;
    if res.exit_code != 0 {
        return Err(exec_error(
            "docker network ls",
            res.exit_code,
            &res.stderr,
        ));
    }
    let networks: Vec<DockerNetwork> = res
        .stdout
        .lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split('|').collect();
            if cols.len() < 3 || cols[0].is_empty() {
                return None;
            }
            Some(DockerNetwork {
                name: cols[0].to_string(),
                driver: cols[1].to_string(),
                scope: cols[2].to_string(),
            })
        })
        .collect();
    serde_json::to_string(&networks).map_err(|e| format!("Serialize error: {}", e))
}

/// 删除网络（内置网络 bridge/host/none 由 Docker 自行拒绝，错误原样透传）
#[tauri::command]
pub async fn docker_network_rm(server_id: String, name: String) -> Result<CommandResult, String> {
    if let Err(e) = validate_resource_name(&name) {
        return Ok(CommandResult::err(format!("network name: {}", e)));
    }
    let escaped = crate::validators::escape_shell_arg(name.clone());
    let cmd = format!("docker network rm {} 2>&1", escaped);
    let res = ssh_execute_command(&server_id, &cmd).await;
    // 审计：网络删除为破坏性操作，成败均落库
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        "删除网络",
        if res.exit_code == 0 { "success" } else { "failed" },
        Some(&name),
    );
    Ok(res)
}

/// 清理未使用网络
#[tauri::command]
pub async fn docker_network_prune(server_id: String) -> Result<CommandResult, String> {
    let res = ssh_execute_command(&server_id, "docker network prune -f 2>&1").await;
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        "清理未使用网络",
        if res.exit_code == 0 { "success" } else { "failed" },
        None,
    );
    Ok(res)
}

/// 查看网络详情（docker network inspect）：返回 JSON，含 Driver/IPAM(Subnet/Gateway)/接入容器
#[tauri::command]
pub async fn docker_network_inspect(
    server_id: String,
    network_id: String,
) -> Result<CommandResult, String> {
    if let Err(e) = validate_resource_name(&network_id) {
        return Ok(CommandResult::err(format!("network id: {}", e)));
    }
    let escaped = crate::validators::escape_shell_arg(network_id);
    let cmd = format!("docker network inspect {} 2>&1", escaped);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 创建网络（docker network create）：支持 driver 与可选 subnet/gateway
#[tauri::command]
pub async fn docker_network_create(
    server_id: String,
    name: String,
    driver: String,
    subnet: Option<String>,
    gateway: Option<String>,
) -> Result<CommandResult, String> {
    if name.is_empty() || name.len() > 128 {
        return Ok(CommandResult::err("Invalid network name"));
    }
    let allowed = ["bridge", "host", "none", "overlay", "macvlan", "ipvlan"];
    let driver = driver.trim().to_lowercase();
    if !allowed.contains(&driver.as_str()) {
        return Ok(CommandResult::err("Unsupported network driver"));
    }
    let escaped_name = crate::validators::escape_shell_arg(name.clone());
    let mut cmd = format!("docker network create --driver {} {}", driver, escaped_name);
    if let Some(s) = subnet.as_deref().filter(|s| !s.trim().is_empty()) {
        if !CIDR_RE.is_match(s) {
            return Ok(CommandResult::err("Invalid subnet (expect CIDR, e.g. 172.20.0.0/16)"));
        }
        cmd.push_str(&format!(
            " --subnet {}",
            crate::validators::escape_shell_arg(s.to_string())
        ));
    }
    if let Some(g) = gateway.as_deref().filter(|g| !g.trim().is_empty()) {
        if !IP_RE.is_match(g) {
            return Ok(CommandResult::err("Invalid gateway (expect IP, e.g. 172.20.0.1)"));
        }
        cmd.push_str(&format!(
            " --gateway {}",
            crate::validators::escape_shell_arg(g.to_string())
        ));
    }
    cmd.push_str(" 2>&1");
    let res = ssh_execute_command(&server_id, &cmd).await;
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        "创建网络",
        if res.exit_code == 0 { "success" } else { "failed" },
        Some(&name),
    );
    Ok(res)
}

/// 将容器接入网络（docker network connect）
#[tauri::command]
pub async fn docker_network_connect(
    server_id: String,
    network_id: String,
    container_id: String,
) -> Result<CommandResult, String> {
    if let Err(e) = validate_resource_name(&network_id) {
        return Ok(CommandResult::err(format!("network: {}", e)));
    }
    if let Err(e) = validate_resource_name(&container_id) {
        return Ok(CommandResult::err(format!("container: {}", e)));
    }
    let net = crate::validators::escape_shell_arg(network_id);
    let ctn = crate::validators::escape_shell_arg(container_id);
    let cmd = format!("docker network connect {} {} 2>&1", net, ctn);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 将容器移出网络（docker network disconnect）；force=true 时加 -f 强制
#[tauri::command]
pub async fn docker_network_disconnect(
    server_id: String,
    network_id: String,
    container_id: String,
    force: bool,
) -> Result<CommandResult, String> {
    if let Err(e) = validate_resource_name(&network_id) {
        return Ok(CommandResult::err(format!("network: {}", e)));
    }
    if let Err(e) = validate_resource_name(&container_id) {
        return Ok(CommandResult::err(format!("container: {}", e)));
    }
    let net = crate::validators::escape_shell_arg(network_id);
    let ctn = crate::validators::escape_shell_arg(container_id);
    let cmd = if force {
        format!("docker network disconnect -f {} {} 2>&1", net, ctn)
    } else {
        format!("docker network disconnect {} {} 2>&1", net, ctn)
    };
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 列出所有 Docker 卷
///
/// 复合命令：卷列表 + 悬空卷集合（-qf dangling=true），用于标记未被任何容器引用的卷
#[tauri::command]
pub async fn docker_volume_ls(server_id: String) -> Result<String, String> {
    let cmd = concat!(
        "docker volume ls --format '{{.Name}}|{{.Driver}}';",
        "echo '---SEPARATOR---';",
        "docker volume ls -qf dangling=true"
    );
    let res = ssh_execute_command(&server_id, cmd).await;
    if res.exit_code != 0 && res.stdout.trim().is_empty() {
        return Err(exec_error(
            "docker volume ls",
            res.exit_code,
            &res.stderr,
        ));
    }
    let mut parts = res.stdout.split("---SEPARATOR---");
    let volumes_output = parts.next().unwrap_or("");
    let dangling_output = parts.next().unwrap_or("");
    let dangling: std::collections::HashSet<String> = dangling_output
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    let volumes: Vec<DockerVolume> = volumes_output
        .lines()
        .filter_map(|line| {
            let cols: Vec<&str> = line.split('|').collect();
            if cols.len() < 2 || cols[0].is_empty() {
                return None;
            }
            Some(DockerVolume {
                name: cols[0].to_string(),
                driver: cols[1].to_string(),
                dangling: dangling.contains(cols[0]),
            })
        })
        .collect();
    serde_json::to_string(&volumes).map_err(|e| format!("Serialize error: {}", e))
}

/// 删除卷（被容器引用的卷由 Docker 自行拒绝，错误原样透传）
#[tauri::command]
pub async fn docker_volume_rm(
    server_id: String,
    name: String,
    force: bool,
) -> Result<CommandResult, String> {
    if let Err(e) = validate_resource_name(&name) {
        return Ok(CommandResult::err(format!("volume name: {}", e)));
    }
    let audit_name = name.clone();
    let escaped = crate::validators::escape_shell_arg(name);
    let cmd = if force {
        format!("docker volume rm -f {} 2>&1", escaped)
    } else {
        format!("docker volume rm {} 2>&1", escaped)
    };
    let res = ssh_execute_command(&server_id, &cmd).await;
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        if force { "强制删除卷" } else { "删除卷" },
        if res.exit_code == 0 { "success" } else { "failed" },
        Some(&audit_name),
    );
    Ok(res)
}

/// 清理未使用卷
///
/// 危险操作：`docker volume prune -f` 会删除全部未被容器引用的卷（含命名卷），数据不可恢复，
/// 前端必须经强措辞确认框后调用
#[tauri::command]
pub async fn docker_volume_prune(server_id: String) -> Result<CommandResult, String> {
    let res = ssh_execute_command(&server_id, "docker volume prune -f 2>&1").await;
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        "清理未使用卷",
        if res.exit_code == 0 { "success" } else { "failed" },
        None,
    );
    Ok(res)
}

/// 浏览卷内容：取卷挂载点（docker volume inspect .Mountpoint）后 ls -la（宿主路径）
///
/// 经宿主路径浏览而非临时容器，避免依赖额外镜像；需 SSH 用户具备该路径读权限
/// （通常 root，与 SSH 执行上下文一致）。sub_path 仅允许相对子目录，禁止 `..` 与绝对路径穿越。
#[tauri::command]
pub async fn docker_volume_browse(
    server_id: String,
    volume_name: String,
    sub_path: Option<String>,
) -> Result<CommandResult, String> {
    if let Err(e) = validate_resource_name(&volume_name) {
        return Ok(CommandResult::err(format!("volume: {}", e)));
    }
    let vol = crate::validators::escape_shell_arg(volume_name);
    let mp_cmd = format!("docker volume inspect {} --format '{{{{.Mountpoint}}}}' 2>/dev/null", vol);
    let mp_res = ssh_execute_command(&server_id, &mp_cmd).await;
    let mountpoint = mp_res.stdout.trim();
    if mp_res.exit_code != 0 || mountpoint.is_empty() {
        return Ok(CommandResult::err("无法获取卷挂载点"));
    }
    let sub = sub_path.as_deref().unwrap_or("").trim();
    if sub.contains("..") || sub.starts_with('/') {
        return Ok(CommandResult::err("非法的子路径"));
    }
    let target = if sub.is_empty() {
        mountpoint.to_string()
    } else {
        format!("{}/{}", mountpoint.trim_end_matches('/'), sub)
    };
    let target_escaped = crate::validators::escape_shell_arg(target);
    let cmd = format!("ls -la --time-style=long-iso {} 2>&1", target_escaped);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 拉取镜像
#[tauri::command]
pub async fn docker_pull(server_id: String, image: String) -> Result<CommandResult, String> {
    if !IMAGE_ID_RE.is_match(&image) {
        return Ok(CommandResult::err(
            "Invalid image reference: must match ^[a-zA-Z0-9._:/-]{1,128}$",
        ));
    }
    let escaped = crate::validators::escape_shell_arg(image);
    let cmd = format!("docker pull {} 2>&1", escaped);
    // 拉取耗时取决于镜像大小与网络带宽，放宽到 30 分钟
    Ok(ssh_execute_command_with_timeout(&server_id, &cmd, 1800).await)
}

// ============================================================
// Docker Overview / 容器生命周期补全 / Run Container（重构第一批）
// ============================================================

/// Docker 总览数据（Overview 首页）
/// camelCase：与前端 DockerOverview 接口字段对齐（多单词字段如 containers_running
/// 若不 rename 会序列化为 snake_case，前端读到 undefined）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerOverview {
    pub server_version: String,
    pub os: String,
    pub ostype: String,
    pub containers_total: u64,
    pub containers_running: u64,
    pub containers_paused: u64,
    pub containers_stopped: u64,
    pub images: u64,
    pub volumes: u64,
    pub networks: u64,
}

/// Docker 环境检测：版本、daemon 状态与资源总数
///
/// 复合命令：docker info（Go template 输出结构化字段）+ 卷/网络计数。
/// daemon 未运行/docker 未安装时 exit_code != 0，错误原样透传，
/// 前端 Overview 页展示明确的连接/权限错误与处理建议。
#[tauri::command]
pub async fn docker_info(server_id: String) -> Result<String, String> {
    let cmd = concat!(
        "docker info --format '{{.ServerVersion}}|{{.OperatingSystem}}|{{.OSType}}|{{.Containers}}|{{.ContainersRunning}}|{{.ContainersPaused}}|{{.ContainersStopped}}|{{.Images}}' 2>/dev/null;",
        "echo '---SEPARATOR---';",
        "docker volume ls -q 2>/dev/null | wc -l;",
        "echo '---SEPARATOR---';",
        "docker network ls -q 2>/dev/null | wc -l"
    );
    let res = ssh_execute_command(&server_id, cmd).await;
    if res.exit_code != 0 {
        // docker info 失败时 stderr 被 2>/dev/null 吞掉的分支：用无 2>/dev/null 的
        // 轻量命令重试一次以拿到可操作错误信息（command not found / daemon 未运行）
        let probe = ssh_execute_command(&server_id, "docker info --format '{{.ServerVersion}}'").await;
        let msg = if probe.stderr.trim().is_empty() {
            String::new()
        } else {
            probe.stderr.trim().to_string()
        };
        return Err(exec_error("docker info", res.exit_code, &msg));
    }
    let mut parts = res.stdout.split("---SEPARATOR---");
    let info_line = parts.next().unwrap_or("").trim();
    let volumes = parts.next().unwrap_or("0").trim().parse::<u64>().unwrap_or(0);
    let networks = parts.next().unwrap_or("0").trim().parse::<u64>().unwrap_or(0);

    let cols: Vec<&str> = info_line.split('|').collect();
    if cols.len() < 8 {
        return Err("docker info: unexpected output format".to_string());
    }
    let overview = DockerOverview {
        server_version: cols[0].trim().to_string(),
        os: cols[1].trim().to_string(),
        ostype: cols[2].trim().to_string(),
        containers_total: cols[3].trim().parse().unwrap_or(0),
        containers_running: cols[4].trim().parse().unwrap_or(0),
        containers_paused: cols[5].trim().parse().unwrap_or(0),
        containers_stopped: cols[6].trim().parse().unwrap_or(0),
        images: cols[7].trim().parse().unwrap_or(0),
        volumes,
        networks,
    };
    serde_json::to_string(&overview).map_err(|e| format!("Serialize error: {}", e))
}

/// 暂停容器进程（cgroup 冻结，可 unpause 恢复）
#[tauri::command]
pub async fn docker_pause(server_id: String, container_id: String) -> Result<CommandResult, String> {
    let validation = crate::validators::validate_container_id(container_id.clone());
    if !validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid container ID: {}",
            validation.error.unwrap_or_default()
        )));
    }
    let audit_id = container_id.clone();
    let escaped = crate::validators::escape_shell_arg(container_id);
    let cmd = format!("docker pause {} 2>&1", escaped);
    let res = ssh_execute_command(&server_id, &cmd).await;
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        "暂停容器",
        if res.exit_code == 0 { "success" } else { "failed" },
        Some(&audit_id),
    );
    Ok(res)
}

/// 恢复暂停的容器
#[tauri::command]
pub async fn docker_unpause(server_id: String, container_id: String) -> Result<CommandResult, String> {
    let validation = crate::validators::validate_container_id(container_id.clone());
    if !validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid container ID: {}",
            validation.error.unwrap_or_default()
        )));
    }
    let audit_id = container_id.clone();
    let escaped = crate::validators::escape_shell_arg(container_id);
    let cmd = format!("docker unpause {} 2>&1", escaped);
    let res = ssh_execute_command(&server_id, &cmd).await;
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        "恢复容器",
        if res.exit_code == 0 { "success" } else { "failed" },
        Some(&audit_id),
    );
    Ok(res)
}

/// Compose 完整生命周期：restart / stop / start / pull
///
/// 与 docker_compose_up/down 相同的目录 + -f 参数模型；pull 拉镜像耗时更长，
/// 超时放宽到 30 分钟，其余 10 分钟
#[tauri::command]
pub async fn docker_compose_action(
    server_id: String,
    action: String,
    project_dir: String,
    config_files: Option<String>,
) -> Result<CommandResult, String> {
    // action 白名单：不接受前端任意字符串拼接
    let timeout_secs: u64 = match action.as_str() {
        "restart" | "stop" | "start" | "build" => 1800,
        "pull" => 1800,
        _ => {
            return Ok(CommandResult::err(
                "Invalid action: must be one of restart|stop|start|pull|build",
            ))
        }
    };
    let validation = crate::validators::validate_path(project_dir.clone(), false);
    if !validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid project directory: {}",
            validation.error.unwrap_or_default()
        )));
    }
    let audit_dir = project_dir.clone();
    let escaped_dir = crate::validators::escape_shell_arg(project_dir);
    let f_args = build_compose_file_args(config_files.as_deref());
    let cmd = format!("cd {} && docker compose {} {} 2>&1", escaped_dir, f_args, action);
    let res = ssh_execute_command_with_timeout(&server_id, &cmd, timeout_secs).await;
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        &format!("docker compose {}", action),
        if res.exit_code == 0 { "success" } else { "failed" },
        Some(&audit_dir),
    );
    Ok(res)
}

/// 端口映射行校验：`host:container` 或 `host:container/(tcp|udp)`
fn validate_port_mapping(line: &str) -> Result<(), String> {
    if PORT_MAPPING_RE.is_match(line) {
        Ok(())
    } else {
        Err(format!("Invalid port mapping: {}", line))
    }
}

/// 卷挂载行校验：`src:dst` 或 `src:dst:(ro|rw)`
/// src 为绝对路径（bind mount）或卷名（named volume），dst 必须是容器内绝对路径
fn validate_volume_mapping(line: &str) -> Result<(), String> {
    let parts: Vec<&str> = line.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return Err(format!("Invalid volume mapping: {}", line));
    }
    let (src, dst) = (parts[0], parts[1]);
    let src_ok = if src.starts_with('/') {
        crate::validators::validate_path(src.to_string(), false).valid
    } else {
        COMPOSE_PROJECT_NAME_RE.is_match(src) // named volume
    };
    if !src_ok {
        return Err(format!("Invalid volume source: {}", src));
    }
    let dst_ok = dst.starts_with('/')
        && dst.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '_' | '-'));
    if !dst_ok {
        return Err(format!("Invalid volume destination: {}", dst));
    }
    if parts.len() == 3 && parts[2] != "ro" && parts[2] != "rw" {
        return Err(format!("Invalid volume mode: {}", parts[2]));
    }
    Ok(())
}

/// 环境变量行校验：`KEY=value`，KEY 需符合 shell 标识符规则
fn validate_env_line(line: &str) -> Result<(), String> {
    let (key, _) = line
        .split_once('=')
        .ok_or_else(|| format!("Invalid environment entry: {}", line))?;
    let key_ok = !key.is_empty()
        && key.chars().next().map(|c| c.is_ascii_alphabetic() || c == '_').unwrap_or(false)
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if key_ok {
        Ok(())
    } else {
        Err(format!("Invalid environment key: {}", key))
    }
}

/// 运行新容器（Run Container MVP：名称/镜像/端口/卷/环境变量/重启策略/网络）
///
/// 所有插值点经白名单校验 + escape_shell_arg；基础配置之外的高级参数（command/
/// entrypoint/GPU 等）属 P1 范围，不在本命令暴露
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn docker_run(
    server_id: String,
    name: String,
    image: String,
    ports: Option<String>,
    volumes: Option<String>,
    env: Option<String>,
    restart: Option<String>,
    network: Option<String>,
) -> Result<CommandResult, String> {
    if !COMPOSE_PROJECT_NAME_RE.is_match(&name) {
        return Ok(CommandResult::err(
            "Invalid container name: must match ^[a-zA-Z0-9._-]{1,128}$",
        ));
    }
    if !IMAGE_ID_RE.is_match(&image) {
        return Ok(CommandResult::err(
            "Invalid image reference: must match ^[a-zA-Z0-9._:/-]{1,128}$",
        ));
    }
    let mut parts: Vec<String> = vec!["docker run -d".to_string()];
    parts.push(format!("--name {}", crate::validators::escape_shell_arg(name.clone())));

    // 端口映射：每行一条
    if let Some(p) = ports.as_deref() {
        for line in p.lines().map(str::trim).filter(|l| !l.is_empty()) {
            if let Err(e) = validate_port_mapping(line) {
                return Ok(CommandResult::err(e));
            }
            parts.push(format!("-p {}", crate::validators::escape_shell_arg(line.to_string())));
        }
    }
    // 卷挂载：每行一条
    if let Some(v) = volumes.as_deref() {
        for line in v.lines().map(str::trim).filter(|l| !l.is_empty()) {
            if let Err(e) = validate_volume_mapping(line) {
                return Ok(CommandResult::err(e));
            }
            parts.push(format!("-v {}", crate::validators::escape_shell_arg(line.to_string())));
        }
    }
    // 环境变量：每行一条 KEY=value
    if let Some(e) = env.as_deref() {
        for line in e.lines().map(str::trim).filter(|l| !l.is_empty()) {
            if let Err(e) = validate_env_line(line) {
                return Ok(CommandResult::err(e));
            }
            parts.push(format!("-e {}", crate::validators::escape_shell_arg(line.to_string())));
        }
    }
    // 重启策略白名单（支持 on-failure[:N]）
    if let Some(r) = restart.as_deref() {
        if !r.is_empty() {
            let ok = matches!(r, "no" | "always" | "unless-stopped")
                || r.strip_prefix("on-failure")
                    .map(|rest| rest.is_empty() || (rest.starts_with(':') && rest[1..].chars().all(|c| c.is_ascii_digit())))
                    .unwrap_or(false);
            if !ok {
                return Ok(CommandResult::err(format!("Invalid restart policy: {}", r)));
            }
            parts.push(format!("--restart {}", crate::validators::escape_shell_arg(r.to_string())));
        }
    }
    // 网络
    if let Some(n) = network.as_deref() {
        if !n.trim().is_empty() {
            let n = n.trim();
            if let Err(e) = validate_resource_name(n) {
                return Ok(CommandResult::err(format!("network name: {}", e)));
            }
            parts.push(format!("--network {}", crate::validators::escape_shell_arg(n.to_string())));
        }
    }
    parts.push(crate::validators::escape_shell_arg(image.clone()));
    let cmd = parts.join(" ");

    let res = ssh_execute_command_with_timeout(&server_id, &cmd, 600).await;
    // 审计：创建容器落库（记录名称与镜像）
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        "运行新容器",
        if res.exit_code == 0 { "success" } else { "failed" },
        Some(&format!("{} ({})", name, image)),
    );
    Ok(res)
}

/// 查看镜像详细信息（docker inspect 对镜像同样有效，校验用镜像引用规则）
#[tauri::command]
pub async fn docker_image_inspect(server_id: String, image_id: String) -> Result<CommandResult, String> {
    if !IMAGE_ID_RE.is_match(&image_id) {
        return Ok(CommandResult::err(
            "Invalid image ID: must match ^[a-zA-Z0-9._:/-]{1,128}$",
        ));
    }
    let escaped = crate::validators::escape_shell_arg(image_id);
    let cmd = format!("docker inspect {}", escaped);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 导出镜像为 tar 到远端临时文件（docker save）：离线迁移第一步
///
/// 成功后 stdout 返回远端 tar 路径，前端据此经 SFTP 下载到本地；大镜像导出放宽到 30 分钟超时。
#[tauri::command]
pub async fn docker_image_save(
    server_id: String,
    image_ref: String,
) -> Result<CommandResult, String> {
    // 支持逗号分隔的多个镜像引用，一次导出为单个 tar 包
    let refs: Vec<&str> = image_ref
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if refs.is_empty() {
        return Ok(CommandResult::err(
            "Invalid image reference: must match ^[a-zA-Z0-9._:/-]{1,128}$",
        ));
    }
    for r in &refs {
        if !IMAGE_ID_RE.is_match(r) {
            return Ok(CommandResult::err(
                "Invalid image reference: must match ^[a-zA-Z0-9._:/-]{1,128}$",
            ));
        }
    }
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 远端临时文件名：引用中的非字母数字替换为下划线，并追加时间戳避免重复
    let path = if refs.len() == 1 {
        let safe: String = refs[0]
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { '_' })
            .collect();
        format!("/tmp/ssht-save-{}-{}.tar", safe, secs)
    } else {
        format!("/tmp/ssht-save-multi-{}.tar", secs)
    };
    let path_escaped = crate::validators::escape_shell_arg(path.clone());
    let imgs = refs
        .iter()
        .map(|r| crate::validators::escape_shell_arg(r.to_string()))
        .collect::<Vec<_>>()
        .join(" ");
    let cmd = format!("docker save {} -o {} 2>&1", imgs, path_escaped);
    let res = ssh_execute_command_with_timeout(&server_id, &cmd, 1800).await;
    if res.exit_code == 0 {
        Ok(CommandResult::ok(path))
    } else {
        Ok(res)
    }
}

/// 从远端 tar 导入镜像（docker load -i）：离线迁移第二步
#[tauri::command]
pub async fn docker_image_load(
    server_id: String,
    remote_path: String,
) -> Result<CommandResult, String> {
    let v = crate::validators::validate_path(remote_path.clone(), false);
    if !v.valid {
        return Ok(CommandResult::err(
            v.error.unwrap_or_else(|| "非法路径".to_string()),
        ));
    }
    let p = crate::validators::escape_shell_arg(remote_path);
    let cmd = format!("docker load -i {} 2>&1", p);
    Ok(ssh_execute_command_with_timeout(&server_id, &cmd, 1800).await)
}

/// 镜像 save/load 外层绝对上限兜底（秒）：固定 6h。
///
/// 真正的卡死保护已移至 connection.rs 的 `execute_save_to_file` / `execute_load_from_file`，
/// 采用"空闲超时（idle）"：连续 60s 无任何通道消息即判定数据流卡死，有数据则自动重置。
/// 故此处不再按镜像大小动态估算固定时长——慢速跨公网持续传输不会被误杀，传完即结束。
const TRANSFER_ABSOLUTE_TIMEOUT_SECS: u64 = 6 * 3600;

/// 镜像导出（方案 A，不依赖宿主机磁盘）：远端 `docker save` 的 tar 字节流经 SSH 直接写入
/// **客户端本地文件**，逐块落盘、不整段缓冲，故超大镜像也不会撑爆进程内存。
/// 成功后 stdout 返回本地文件路径。进度通过 `docker-image-save-progress` 事件推送。
#[tauri::command]
pub async fn docker_image_save_stream(
    app: AppHandle,
    server_id: String,
    image_refs: Vec<String>,
    local_path: String,
    estimated_bytes: i64,
) -> Result<CommandResult, String> {
    let refs: Vec<String> = image_refs
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if refs.is_empty() {
        return Ok(CommandResult::err(
            "Invalid image reference: must match ^[a-zA-Z0-9._:/-]{1,128}$",
        ));
    }
    for r in &refs {
        if !IMAGE_ID_RE.is_match(r) {
            return Ok(CommandResult::err(
                "Invalid image reference: must match ^[a-zA-Z0-9._:/-]{1,128}$",
            ));
        }
    }
    let imgs = refs
        .iter()
        .map(|r| crate::validators::escape_shell_arg(r.clone()))
        .collect::<Vec<_>>()
        .join(" ");
    // 注意：docker save 的 tar 走 stdout；不要 2>&1，否则 stderr 会混入 tar。
    // 失败信息通过 exit_code + stderr 单独返回（见 execute_save_to_file）。
    let cmd = format!("docker save {}", imgs);
    // 外层绝对上限兜底（6h）；真正的卡死保护由 connection.rs 的 idle 超时（60s 无数据）负责。
    // 前端传入的预估大小（docker images 列表中的镜像体积）作为进度 total 展示；
    // docker save 实际 tar 体积更大，超出时前端按 100% 封顶，不影响正确性。
    let total_est = estimated_bytes.max(0) as u64;
    let timeout = TRANSFER_ABSOLUTE_TIMEOUT_SECS;
    let sid = server_id.clone();
    let res = crate::ssh::manager::SshManager::global()
        .save_image_to_file(&server_id, &cmd, timeout, &local_path, &|transferred: u64, _total: u64| {
            let _ = app.emit(
                "docker-image-save-progress",
                json!({ "serverId": sid, "transferred": transferred, "total": total_est }),
            );
        })
        .await;
    match res {
        Ok(out) => {
            if out.exit_code == 0 {
                Ok(CommandResult::ok(local_path))
            } else {
                Ok(CommandResult::err(out.stderr))
            }
        }
        Err(e) => Ok(CommandResult::err(format!("{}", e))),
    }
}

/// 镜像导入（方案 A，对称，不依赖宿主机磁盘）：客户端本地 tar 文件经 SSH stdin 直接喂给
/// 远端 `docker load`，逐块上传、不整段缓冲。进度通过 `docker-image-load-progress` 事件推送。
#[tauri::command]
pub async fn docker_image_load_stream(
    app: AppHandle,
    server_id: String,
    local_path: String,
) -> Result<CommandResult, String> {
    if local_path.trim().is_empty() {
        return Ok(CommandResult::err("未选择本地 tar 文件"));
    }
    // 外层绝对上限兜底（6h）；真正的卡死保护由 connection.rs 的 idle 超时（60s 无数据）负责。
    let timeout = TRANSFER_ABSOLUTE_TIMEOUT_SECS;
    let sid = server_id.clone();
    let res = crate::ssh::manager::SshManager::global()
        .load_image_from_file(&server_id, "docker load", timeout, &local_path, &|transferred: u64, total: u64| {
            let _ = app.emit(
                "docker-image-load-progress",
                json!({ "serverId": sid, "transferred": transferred, "total": total }),
            );
        })
        .await;
    match res {
        Ok(out) => {
            if out.exit_code == 0 {
                Ok(CommandResult::ok(format!("{}{}", out.stdout, out.stderr)))
            } else {
                Ok(CommandResult::err(out.stderr))
            }
        }
        Err(e) => Ok(CommandResult::err(format!("{}", e))),
    }
}

/// 取消进行中的镜像导出/导入传输（设置该 server 的 cancel flag，由 connection.rs 循环检测）。
#[tauri::command]
pub async fn docker_image_transfer_cancel(_app: AppHandle, server_id: String) -> Result<CommandResult, String> {
    crate::ssh::manager::SshManager::global().cancel_transfer(&server_id);
    Ok(CommandResult::ok(""))
}

// ============================================================
// Compose 创建/校验/实时部署输出 + Registry 登录 + System DF（对齐 Dockge/Portainer）
// ============================================================

/// Compose 部署输出流事件（docker:compose-output）
#[derive(serde::Serialize, Clone)]
pub struct ComposeStreamEvent {
    #[serde(rename = "requestId")]
    pub request_id: String,
    /// 增量输出片段（UTF-8 完整边界）
    pub chunk: String,
    pub done: bool,
    #[serde(rename = "exitCode")]
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

/// Compose 生命周期操作（流式）：输出实时推送前端部署面板，不再转圈等待
#[tauri::command]
pub async fn docker_compose_action_stream(
    app: AppHandle,
    server_id: String,
    action: String,
    project_dir: String,
    config_files: Option<String>,
    request_id: String,
) -> Result<(), String> {
    let timeout_secs: u64 = match action.as_str() {
        "up" | "restart" | "stop" | "start" | "build" => 1800,
        "pull" | "down" => 1800,
        _ => return Err("Invalid action: must be one of up|down|restart|stop|start|pull|build".to_string()),
    };
    let validation = crate::validators::validate_path(project_dir.clone(), false);
    if !validation.valid {
        return Err(format!(
            "Invalid project directory: {}",
            validation.error.unwrap_or_default()
        ));
    }
    // 校验通过后登记进注册表：即使这次操作失败，项目也已被"认识"，
    // 之后 down 掉也不会从列表消失（Dockge/Portainer 同样把项目与容器状态解耦）
    {
        let cfg = config_files.clone().unwrap_or_default();
        let name = project_dir
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or("")
            .to_string();
        let base_server_id = crate::commands::extract_base_server_id(&server_id);
        let _ = crate::db::upsert_compose_project(base_server_id, &name, &project_dir, &cfg);
    }
    let escaped_dir = crate::validators::escape_shell_arg(project_dir.clone());
    let f_args = build_compose_file_args(config_files.as_deref());
    // up 默认后台拉起（-d）：否则 `docker compose up` 前台跟日志会一直占用会话、永不退出，
    // 前端部署面板收不掉（done 终态永远不触发）。-d 后进程启动即返回 → 正常触发 done →
    // 面板可成功自动关闭；容器日志仍可通过卡片 Logs 按钮实时跟随。
    let action_arg = if action == "up" { "up -d" } else { action.as_str() };
    let cmd = format!("cd {} && docker compose {} {} 2>&1", escaped_dir, f_args, action_arg);

    // 流式执行：每个输出片段实时发射事件；结束时发 done 终态
    let app_for_chunk = app.clone();
    let req_for_chunk = request_id.clone();
    let result = crate::ssh::manager::SshManager::global()
        .execute_streaming(&server_id, &cmd, timeout_secs, move |chunk| {
            let _ = app_for_chunk.emit(
                "docker:compose-output",
                ComposeStreamEvent {
                    request_id: req_for_chunk.clone(),
                    chunk: chunk.to_string(),
                    done: false,
                    exit_code: None,
                    error: None,
                },
            );
        })
        .await;

    let (exit_code, err_msg) = match &result {
        Ok(out) => (Some(out.exit_code), None),
        Err(e) => (None, Some(e.to_string())),
    };
    // 错误信息也作为输出片段推送（面板直接可见），再发 done 终态
    if let Some(msg) = &err_msg {
        let _ = app.emit(
            "docker:compose-output",
            ComposeStreamEvent {
                request_id: request_id.clone(),
                chunk: format!("\n[错误] {}\n", msg),
                done: false,
                exit_code: None,
                error: None,
            },
        );
    }
    let _ = app.emit(
        "docker:compose-output",
        ComposeStreamEvent {
            request_id,
            chunk: String::new(),
            done: true,
            exit_code,
            error: err_msg,
        },
    );

    let ok = matches!(&result, Ok(out) if out.exit_code == 0);
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        &format!("docker compose {} (stream)", action),
        if ok { "success" } else { "failed" },
        Some(&project_dir),
    );
    Ok(())
}

/// 容器日志实时跟随（docker logs -f 流式）：替代前端 3 秒轮询，延迟≈0。
///
/// 复用 ComposeStreamEvent / docker:compose-output 事件通道（前端按 requestId 过滤，
/// requestId 约定 `logs-` 前缀与 compose 流隔离）。
/// 设计为"有界跟随"：单次连接最长 120s，结束时发 done；前端收到 done 后携带
/// `--since <上次最后时间戳>` 自动重连，实现无缝续流且不产生重复行。
/// 模态框关闭后前端不再重连，远端进程最多存活 120s 自然结束。
#[tauri::command]
pub async fn docker_logs_stream(
    app: AppHandle,
    server_id: String,
    container_id: String,
    tail: Option<i64>,
    since: Option<String>,
    request_id: String,
) -> Result<(), String> {
    let validation = crate::validators::validate_container_id(container_id.clone());
    if !validation.valid {
        return Err(format!(
            "Invalid container id: {}",
            validation.error.unwrap_or_default()
        ));
    }
    let tail = tail.unwrap_or(100).clamp(0, 10_000);
    // since 只接受纯数字 unix 秒（前端由 docker logs --timestamps 输出的 RFC3339 转换而来），
    // 严格白名单杜绝命令注入
    let since_clause = match since.as_deref() {
        Some(s) if !s.is_empty() => {
            if !s.chars().all(|c| c.is_ascii_digit()) || s.len() > 10 {
                return Err("Invalid since: must be unix seconds".to_string());
            }
            format!("--since {} ", s)
        }
        _ => String::new(),
    };
    let escaped = crate::validators::escape_shell_arg(container_id);
    // docker logs 输出走 stderr，必须 2>&1 才能被流捕获；--timestamps 供前端续流去重
    let cmd = format!(
        "docker logs --timestamps {} -f --tail {} {} 2>&1",
        since_clause, tail, escaped
    );

    let app_for_chunk = app.clone();
    let req_for_chunk = request_id.clone();
    let result = crate::ssh::manager::SshManager::global()
        .execute_streaming(&server_id, &cmd, 120, move |chunk| {
            let _ = app_for_chunk.emit(
                "docker:compose-output",
                ComposeStreamEvent {
                    request_id: req_for_chunk.clone(),
                    chunk: chunk.to_string(),
                    done: false,
                    exit_code: None,
                    error: None,
                },
            );
        })
        .await;

    let (exit_code, err_msg) = match &result {
        Ok(out) => (Some(out.exit_code), None),
        Err(e) => (None, Some(e.to_string())),
    };
    if let Some(msg) = &err_msg {
        let _ = app.emit(
            "docker:compose-output",
            ComposeStreamEvent {
                request_id: request_id.clone(),
                chunk: format!("\n[错误] {}\n", msg),
                done: false,
                exit_code: None,
                error: None,
            },
        );
    }
    let _ = app.emit(
        "docker:compose-output",
        ComposeStreamEvent {
            request_id,
            chunk: String::new(),
            done: true,
            exit_code,
            error: err_msg,
        },
    );
    Ok(())
}

// ==================== Container Files（docker cp 文件管理） ====================

/// 容器内文件条目（docker exec ls -la 解析结果）
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerFileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: i64,
    pub modified: String,
    pub permissions: String,
}

/// docker cp 准备结果：容器文件下载时先落到远端临时目录，供 SFTP 下载后清理
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerCpResult {
    pub host_path: String,
    pub tmp_dir: String,
}

const DOCKER_CP_TMP_PREFIX: &str = "/tmp/swk-docker-cp";

/// 容器内路径校验：拒绝换行与命令替换/变量展开字符（剩余风险由 escape_shell_arg 兜底）
fn validate_container_path(path: &str) -> Result<(), String> {
    if path.contains('\n')
        || path.contains('\r')
        || path.contains('\0')
        || path.contains('$')
        || path.contains('`')
    {
        return Err("Invalid container path".to_string());
    }
    Ok(())
}

fn docker_cp_tmp_dir(container_id: &str) -> String {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    // 容器 ID 已通过白名单校验（仅字母数字 . _ -），可直接拼接
    let suffix: String = container_id.chars().take(8).collect();
    format!("{}-{}-{}", DOCKER_CP_TMP_PREFIX, stamp, suffix)
}

/// 列出容器内目录内容（docker exec <id> ls -la）
///
/// 不套 `sh -c`：避免与 escape_shell_arg 的单引号嵌套导致命令断裂。
/// 返回 JSON 字符串供前端 invokeJson 解析（与 docker_system_df 同范式）。
#[tauri::command]
pub async fn docker_container_file_list(
    server_id: String,
    container_id: String,
    path: String,
) -> Result<String, String> {
    let v = crate::validators::validate_container_id(container_id.clone());
    if !v.valid {
        return Err(format!(
            "Invalid container id: {}",
            v.error.unwrap_or_default()
        ));
    }
    validate_container_path(&path)?;
    let dir = if path.trim().is_empty() { "/" } else { path.trim() };
    let cmd = format!(
        "docker exec {} ls -la {} 2>&1",
        crate::validators::escape_shell_arg(container_id),
        crate::validators::escape_shell_arg(dir.to_string())
    );
    let res = ssh_execute_command(&server_id, &cmd).await;
    if res.exit_code != 0 && res.stdout.trim().is_empty() {
        let msg = res.stderr.trim();
        if msg.is_empty() {
            return Err(format!("docker exec ls failed (exit {})", res.exit_code));
        }
        return Err(msg.to_string());
    }
    let mut entries = parse_ls_output(&res.stdout);
    // 目录优先，其次按名称排序（与文件管理模块观感一致）
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    serde_json::to_string(&entries).map_err(|e| format!("Serialize error: {}", e))
}

/// 解析 `ls -la` 输出（busybox/GNU 通用格式）
fn parse_ls_output(raw: &str) -> Vec<DockerFileEntry> {
    let mut out = Vec::new();
    for line in raw.lines() {
        let line = line.trim_end();
        if line.is_empty() || line.starts_with("total ") {
            continue;
        }
        // ls 的错误信息（目录不存在/权限不足）直接跳过，返回空列表由上层提示
        if line.contains("No such file or directory") || line.contains("cannot access") {
            continue;
        }
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() < 9 {
            continue;
        }
        let permissions = tokens[0].to_string();
        let is_dir = permissions.starts_with('d');
        let size = tokens[4].parse::<i64>().unwrap_or(0);
        // 日期三字段：月 日 时间（或年份）
        let modified = tokens[5..8].join(" ");
        // 名称从第 9 个 token 起（可能含空格）；符号链接剥离 " -> target"
        let mut name = tokens[8..].join(" ");
        if let Some(idx) = name.find(" -> ") {
            name = name[..idx].to_string();
        }
        if name == "." || name == ".." {
            continue;
        }
        out.push(DockerFileEntry {
            name,
            is_dir,
            size,
            modified,
            permissions,
        });
    }
    out
}

/// 容器文件下载准备：docker cp 到远端临时目录，返回临时路径供 SFTP 下载（下载后由前端清理）
/// 返回 JSON 字符串供前端 invokeJson 解析。
#[tauri::command]
pub async fn docker_cp_from_container(
    server_id: String,
    container_id: String,
    src_path: String,
) -> Result<String, String> {
    let v = crate::validators::validate_container_id(container_id.clone());
    if !v.valid {
        return Err(format!(
            "Invalid container id: {}",
            v.error.unwrap_or_default()
        ));
    }
    validate_container_path(&src_path)?;
    let base = src_path.rsplit('/').next().unwrap_or("").trim().to_string();
    if base.is_empty() {
        return Err("Invalid source path".to_string());
    }
    let tmp_dir = docker_cp_tmp_dir(&container_id);
    // 相邻引号串会拼接：'id':'/src' → id:/src
    let cmd = format!(
        "mkdir -p {} && docker cp {}:{} {}/ 2>&1",
        crate::validators::escape_shell_arg(tmp_dir.clone()),
        crate::validators::escape_shell_arg(container_id),
        crate::validators::escape_shell_arg(src_path),
        crate::validators::escape_shell_arg(tmp_dir.clone()),
    );
    let res = ssh_execute_command(&server_id, &cmd).await;
    if res.exit_code != 0 {
        let msg = res.stdout.trim();
        if !msg.is_empty() {
            return Err(msg.to_string());
        }
        return Err(res.stderr.trim().to_string());
    }
    let result = DockerCpResult {
        host_path: format!("{}/{}", tmp_dir, base),
        tmp_dir,
    };
    serde_json::to_string(&result).map_err(|e| format!("Serialize error: {}", e))
}

/// 复制宿主机文件/目录进容器（docker cp <host> <container>:<dest>）。
///
/// 支持两种上传来源：
/// 1. 本地上传：本地文件先经 SFTP 传到临时目录（/tmp/swk-docker-cp 前缀），
///    复制成功后应删除临时文件 → delete_source = true
/// 2. 宿主机复制：直接复制宿主机上已有的文件/目录，**必须保留源文件**
///    → delete_source = false（默认）
///
/// 安全：路径必须是绝对路径且不含 shell 危险字符（换行/命令替换/变量展开），
/// 其余由 escape_shell_arg 兜底。
#[tauri::command]
pub async fn docker_cp_to_container(
    server_id: String,
    container_id: String,
    host_path: String,
    dest_dir: String,
    delete_source: Option<bool>,
) -> Result<CommandResult, String> {
    let v = crate::validators::validate_container_id(container_id.clone());
    if !v.valid {
        return Ok(CommandResult::err(format!(
            "Invalid container id: {}",
            v.error.unwrap_or_default()
        )));
    }
    // 宿主机路径（任意绝对路径）与临时目录路径都允许；拒绝危险字符防注入
    let hp = host_path.trim();
    if !hp.starts_with('/') {
        return Ok(CommandResult::err(
            "Host path must be an absolute path".to_string(),
        ));
    }
    if hp.contains('\n') || hp.contains('\r') || hp.contains('\0')
        || hp.contains('$') || hp.contains('`')
    {
        return Ok(CommandResult::err("Invalid host path".to_string()));
    }
    validate_container_path(&dest_dir)?;
    let dest = if dest_dir.trim().is_empty() {
        "/".to_string()
    } else {
        dest_dir.trim().to_string()
    };
    // 仅本地上传流程（临时目录）复制后删除源文件；宿主机复制保留源文件
    let should_delete = delete_source.unwrap_or(false) && hp.starts_with(DOCKER_CP_TMP_PREFIX);
    let cmd = if should_delete {
        format!(
            "docker cp {} {}:{} 2>&1 && rm -rf {} 2>/dev/null",
            crate::validators::escape_shell_arg(hp.to_string()),
            crate::validators::escape_shell_arg(container_id),
            crate::validators::escape_shell_arg(dest),
            crate::validators::escape_shell_arg(hp.to_string()),
        )
    } else {
        format!(
            "docker cp {} {}:{} 2>&1",
            crate::validators::escape_shell_arg(hp.to_string()),
            crate::validators::escape_shell_arg(container_id),
            crate::validators::escape_shell_arg(dest),
        )
    };
    let res = ssh_execute_command(&server_id, &cmd).await;
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        "上传文件到容器 (docker cp)",
        if res.exit_code == 0 { "success" } else { "failed" },
        Some(&host_path),
    );
    Ok(res)
}

/// 删除容器内文件/目录（docker exec <id> rm -rf <path>）—— 破坏性操作，落审计日志。
///
/// 安全约束：拒绝删除容器根目录（"/" 与空路径），拒绝 shell 危险字符；
/// 路径由 escape_shell_arg 兜底转义，命令不套 sh -c 避免引号嵌套。
#[tauri::command]
pub async fn docker_container_file_delete(
    server_id: String,
    container_id: String,
    path: String,
) -> Result<CommandResult, String> {
    let v = crate::validators::validate_container_id(container_id.clone());
    if !v.valid {
        return Ok(CommandResult::err(format!(
            "Invalid container id: {}",
            v.error.unwrap_or_default()
        )));
    }
    validate_container_path(&path)?;
    let target = path.trim().trim_end_matches('/');
    // 根目录/空路径不允许删除（防止误删整个容器文件系统）
    if target.is_empty() || target == "/" {
        return Ok(CommandResult::err(
            "Refusing to delete container root".to_string(),
        ));
    }
    let cmd = format!(
        "docker exec {} rm -rf {} 2>&1",
        crate::validators::escape_shell_arg(container_id),
        crate::validators::escape_shell_arg(target.to_string()),
    );
    let res = ssh_execute_command(&server_id, &cmd).await;
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        "删除容器内文件 (docker exec rm -rf)",
        if res.exit_code == 0 { "success" } else { "failed" },
        Some(target),
    );
    Ok(res)
}

/// 清理 docker cp 产生的远端临时目录/文件（仅允许本模块前缀）
#[tauri::command]
pub async fn docker_cp_cleanup(server_id: String, path: String) -> Result<CommandResult, String> {
    if !path.starts_with(DOCKER_CP_TMP_PREFIX) {
        return Ok(CommandResult::err("Invalid path".to_string()));
    }
    Ok(ssh_execute_command(
        &server_id,
        &format!("rm -rf {} 2>&1", crate::validators::escape_shell_arg(path)),
    )
    .await)
}

/// 校验 Compose 配置（docker compose config --quiet）：保存前/手动校验用
#[tauri::command]
pub async fn docker_compose_validate(
    server_id: String,
    project_dir: String,
    config_files: Option<String>,
) -> Result<CommandResult, String> {
    let validation = crate::validators::validate_path(project_dir.clone(), false);
    if !validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid project directory: {}",
            validation.error.unwrap_or_default()
        )));
    }
    let escaped_dir = crate::validators::escape_shell_arg(project_dir);
    let f_args = build_compose_file_args(config_files.as_deref());
    let cmd = format!("cd {} && docker compose {} config --quiet 2>&1", escaped_dir, f_args);
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// 创建 Compose 项目：mkdir + 写入初始 compose.yaml（前端 UTF-8 → base64，此处原子写入，防注入）
#[tauri::command]
pub async fn docker_compose_create(
    server_id: String,
    project_dir: String,
    yaml_b64: String,
) -> Result<CommandResult, String> {
    let validation = crate::validators::validate_path(project_dir.clone(), false);
    if !validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid project directory: {}",
            validation.error.unwrap_or_default()
        )));
    }
    // b64 字符集白名单校验（内容经 base64 编码后对 shell 完全惰性）
    let b64 = yaml_b64.trim().to_string();
    if b64.is_empty() || !b64.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '=')) {
        return Ok(CommandResult::err("Invalid yaml base64 content"));
    }
    let escaped_dir = crate::validators::escape_shell_arg(project_dir.clone());
    let escaped_b64 = crate::validators::escape_shell_arg(b64);
    let cmd = format!(
        "mkdir -p {} && echo {} | base64 -d > {}/docker-compose.yaml 2>&1",
        escaped_dir, escaped_b64, escaped_dir
    );
    let res = ssh_execute_command(&server_id, &cmd).await;
    // 创建成功即登记：新项目还没容器，不登记的话刷新列表会立刻消失
    if res.exit_code == 0 {
        let name = project_dir
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or("")
            .to_string();
        let cfg = format!("{}/docker-compose.yaml", project_dir.trim_end_matches('/'));
        let base_server_id = crate::commands::extract_base_server_id(&server_id);
        let _ = crate::db::upsert_compose_project(base_server_id, &name, &project_dir, &cfg);
    }
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        "创建 Compose 项目",
        if res.exit_code == 0 { "success" } else { "failed" },
        Some(&project_dir),
    );
    Ok(res)
}

/// 登录镜像仓库（私有 Registry pull 的前置条件）
///
/// 密码经 stdin 传输（--password-stdin），不出现在命令行/进程列表；审计日志不记录密码
#[tauri::command]
pub async fn docker_login(
    server_id: String,
    registry: Option<String>,
    username: String,
    password: String,
) -> Result<CommandResult, String> {
    if username.is_empty() || username.len() > 128 {
        return Ok(CommandResult::err("Invalid username"));
    }
    if password.is_empty() || password.len() > 256 || password.contains('\n') || password.contains('\0') {
        return Ok(CommandResult::err("Invalid password"));
    }
    let registry_part = match registry.as_deref() {
        Some(r) if !r.trim().is_empty() => {
            let r = r.trim();
            let ok = r.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '/'));
            if !ok {
                return Ok(CommandResult::err("Invalid registry address"));
            }
            format!("{} ", crate::validators::escape_shell_arg(r.to_string()))
        }
        _ => String::new(),
    };
    let escaped_user = crate::validators::escape_shell_arg(username.clone());
    let escaped_pw = crate::validators::escape_shell_arg(password);
    let cmd = format!(
        "printf '%s' {} | docker login {}--username {} --password-stdin 2>&1",
        escaped_pw, registry_part, escaped_user
    );
    let res = ssh_execute_command(&server_id, &cmd).await;
    // 审计：绝不记录密码（§19 安全要求）
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        "登录镜像仓库",
        if res.exit_code == 0 { "success" } else { "failed" },
        Some(&username),
    );
    Ok(res)
}

/// System DF 单行（磁盘占用分析）
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemDfRow {
    pub df_type: String,
    pub total: String,
    pub active: String,
    pub size: String,
    pub reclaimable: String,
}

/// 磁盘占用分析（docker system df）：镜像/容器/卷/缓存 各占多少、可回收多少
#[tauri::command]
pub async fn docker_system_df(server_id: String) -> Result<String, String> {
    let res = ssh_execute_command(&server_id, "docker system df --format '{{json .}}'").await;
    if res.exit_code != 0 {
        let msg = res.stderr.trim();
        return Err(if msg.is_empty() {
            format!("docker system df failed (exit {})", res.exit_code)
        } else {
            format!("docker system df failed (exit {}): {}", res.exit_code, msg)
        });
    }
    let mut rows: Vec<SystemDfRow> = Vec::new();
    for line in res.stdout.lines() {
        let l = line.trim();
        if !l.starts_with('{') {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(l) else { continue };
        let get = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
        let df_type = get("Type");
        if df_type.is_empty() {
            continue;
        }
        rows.push(SystemDfRow {
            df_type,
            total: get("TotalCount"),
            active: get("Active"),
            size: get("Size"),
            reclaimable: get("Reclaimable"),
        });
    }
    serde_json::to_string(&rows).map_err(|e| format!("Serialize error: {}", e))
}

/// 全局清理（docker system prune）：停止的容器 + 悬空镜像 + 未使用网络 + 构建缓存；
/// include_images=true 时（-a）连带清理全部未被引用的镜像
#[tauri::command]
pub async fn docker_system_prune(
    server_id: String,
    include_images: bool,
) -> Result<CommandResult, String> {
    let cmd = if include_images {
        "docker system prune -af 2>&1"
    } else {
        "docker system prune -f 2>&1"
    };
    let res = ssh_execute_command(&server_id, cmd).await;
    let _ = crate::db::add_audit_log(
        "docker",
        Some(&server_id),
        if include_images { "全局清理（含未使用镜像）" } else { "全局清理" },
        if res.exit_code == 0 { "success" } else { "failed" },
        None,
    );
    Ok(res)
}

/// 从逗号分隔的文件列表构建 `-f file1 -f file2` 参数段
/// - 空或仅空白：返回空字符串（由 docker compose 自动查找默认文件）
/// - 每个路径校验 + escape，防注入；非法路径直接跳过
fn build_compose_file_args(config_files: Option<&str>) -> String {
    let Some(files) = config_files else { return String::new() };
    let trimmed = files.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let mut parts: Vec<String> = Vec::new();
    for f in trimmed.split(',') {
        let f = f.trim();
        if f.is_empty() {
            continue;
        }
        let validation = crate::validators::validate_path(f.to_string(), false);
        if !validation.valid {
            eprintln!("[build_compose_file_args] 跳过非法路径: {}", f);
            continue;
        }
        parts.push(format!("-f {}", crate::validators::escape_shell_arg(f.to_string())));
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!("{} ", parts.join(" "))
    }
}

/// docker compose logs --tail=<lines>
///
/// 注意：`docker compose logs [service...]` 后跟的是 service 名而非 project 名，
/// 误传 project 名会报 "no such service: <name>"。
/// 这里靠 cd 到 project_dir + `-f` 指定配置文件定位项目，不带 service 名，
/// docker compose 会自动识别项目并返回所有服务的日志。
/// `project_name` 参数仅做校验（防注入），不参与命令构造。
#[tauri::command]
pub async fn docker_compose_logs(
    server_id: String,
    project_name: String,
    lines: i64,
    project_dir: Option<String>,
    config_files: Option<String>,
    service: Option<String>,
) -> Result<CommandResult, String> {
    if !COMPOSE_PROJECT_NAME_RE.is_match(&project_name) {
        return Ok(CommandResult::err(
            "Invalid project name: must match ^[a-zA-Z0-9._-]{1,128}$",
        ));
    }
    let lines_validation = crate::validators::validate_pid(lines.to_string());
    if !lines_validation.valid {
        return Ok(CommandResult::err(format!(
            "Invalid lines parameter: {}",
            lines_validation.error.unwrap_or_default()
        )));
    }

    // 构建 cd 前缀和 -f 参数段（与 docker_compose_up/down 一致）
    let cd_prefix = match project_dir.as_deref() {
        Some(dir) if !dir.trim().is_empty() => {
            let validation = crate::validators::validate_path(dir.to_string(), false);
            if !validation.valid {
                return Ok(CommandResult::err(format!(
                    "Invalid project directory: {}",
                    validation.error.unwrap_or_default()
                )));
            }
            format!("cd {} && ", crate::validators::escape_shell_arg(dir.to_string()))
        }
        _ => String::new(),
    };
    let f_args = build_compose_file_args(config_files.as_deref());

    // service 过滤：service 名为 compose service 名（如 web/db），与 COMPOSE_PROJECT_NAME_RE 同规则。
    // 留空则取整个项目的日志。
    let service_arg = match service.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => {
            if !COMPOSE_PROJECT_NAME_RE.is_match(s) {
                return Ok(CommandResult::err(
                    "Invalid service name: must match ^[a-zA-Z0-9._-]{1,128}$".to_string(),
                ));
            }
            format!(" {}", s)
        }
        None => String::new(),
    };

    let cmd = format!(
        "{}docker compose {} logs --tail={}{} 2>&1",
        cd_prefix, f_args, lines, service_arg
    );
    Ok(ssh_execute_command(&server_id, &cmd).await)
}

/// Compose service 列表（项目级容器状态），解析 `docker compose -f <file> ps -a --format json`。
/// 用于 Service 级视图：每个 service 显示容器名 / 状态 / 重启 / 日志。
///
/// 返回 JSON 字符串数组（前端 invokeJson 解析），失败时返回空数组 + stderr 写入日志。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeService {
    pub name: String,
    pub state: String,
    pub status: String,
    pub container_id: String,
}

#[tauri::command]
pub async fn docker_compose_services(
    server_id: String,
    project_dir: Option<String>,
    config_files: Option<String>,
) -> Result<String, String> {
    let cd_prefix = match project_dir.as_deref() {
        Some(dir) if !dir.trim().is_empty() => {
            let validation = crate::validators::validate_path(dir.to_string(), false);
            if !validation.valid {
                return Err(format!(
                    "Invalid project directory: {}",
                    validation.error.unwrap_or_default()
                ));
            }
            format!("cd {} && ", crate::validators::escape_shell_arg(dir.to_string()))
        }
        _ => String::new(),
    };
    let f_args = build_compose_file_args(config_files.as_deref());
    let cmd = format!(
        "{}docker compose {} ps -a --format json 2>&1",
        cd_prefix, f_args
    );
    let res = ssh_execute_command(&server_id, &cmd).await;
    if res.exit_code != 0 {
        // 命令失败（如 up 都还没跑过）返回空数组而不是错误，前端 UI 用空态展示
        return Ok(serde_json::to_string(&Vec::<ComposeService>::new())
            .unwrap_or_else(|_| "[]".to_string()));
    }
    let parsed: Vec<ComposeService> = res
        .stdout
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let v: serde_json::Value = serde_json::from_str(line).ok()?;
            // docker compose ps --format json 字段（不同 docker 版本键名可能略有差异，按容错顺序取值）
            let name = v
                .get("Name")
                .or_else(|| v.get("Service"))
                .or_else(|| v.get("name"))
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() {
                return None;
            }
            let state = v
                .get("State")
                .or_else(|| v.get("state"))
                .and_then(|x| x.as_str())
                .unwrap_or("unknown")
                .to_string();
            let status = v
                .get("Status")
                .or_else(|| v.get("status"))
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let container_id = v
                .get("ID")
                .or_else(|| v.get("Id"))
                .or_else(|| v.get("id"))
                .or_else(|| v.get("ContainerID"))
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            Some(ComposeService { name, state, status, container_id })
        })
        .collect();
    Ok(serde_json::to_string(&parsed).unwrap_or_else(|_| "[]".to_string()))
}

/// 导入扫描：检查目录是否含 compose 文件并校验配置，返回导入预览列表。
///
/// 逻辑（对齐 Dockge "把现有目录注册进来"）：
/// 1. 每个目录探测 4 个标准 compose 文件名（docker-compose.{yml,yaml} / compose.{yml,yaml}）
/// 2. 找到文件后跑 `docker compose -f <file> config --quiet` 校验
/// 3. 项目名从目录名推断（compose 默认行为）
///
/// 实际"导入"= 前端对选中项执行 docker compose up -d（注册进 docker compose ls）。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeImportPreview {
    pub dir: String,
    pub file: String,
    pub project_name: String,
    pub valid: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn docker_compose_import_scan(
    server_id: String,
    dirs: Vec<String>,
) -> Result<String, String> {
    if dirs.is_empty() {
        return Ok("[]".to_string());
    }
    if dirs.len() > 100 {
        return Err("Too many directories (max 100)".to_string());
    }
    let mut previews: Vec<ComposeImportPreview> = Vec::new();
    for dir in dirs {
        let dir = dir.trim().to_string();
        if dir.is_empty() || !dir.starts_with('/') {
            continue;
        }
        if !crate::validators::validate_path(dir.clone(), false).valid {
            continue;
        }
        let project_name = dir.rsplit('/').next().unwrap_or("").to_string();
        // 单条 SSH 调用完成"探测 + 校验"：找到首个存在的 compose 文件即校验
        let escaped_dir = crate::validators::escape_shell_arg(dir.clone());
        let cmd = format!(
            "for f in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do \
             if [ -f {d}/$f ]; then \
             if docker compose -f {d}/$f config --quiet >/dev/null 2>&1; then \
             echo \"$f|OK\"; \
             else \
             echo \"$f|ERR\"; \
             fi; \
             break; \
             fi; \
             done",
            d = escaped_dir,
        );
        let res = ssh_execute_command(&server_id, &cmd).await;
        let out = res.stdout.trim();
        if out.is_empty() {
            previews.push(ComposeImportPreview {
                dir: dir.clone(),
                file: String::new(),
                project_name,
                valid: false,
                error: Some("No compose file found".to_string()),
            });
            continue;
        }
        // 输出格式 `<file>|OK` 或 `<file>|ERR`（校验错误详情被 --quiet 抑制，仅标记不可用）
        let (file, ok) = match out.split_once('|') {
            Some((f, "OK")) => (f.to_string(), true),
            Some((f, _)) => (f.to_string(), false),
            None => (String::new(), false),
        };
        let file_path = if file.is_empty() { String::new() } else { format!("{}/{}", dir, file) };
        previews.push(ComposeImportPreview {
            dir: dir.clone(),
            file: file_path,
            project_name,
            valid: ok,
            error: if ok { None } else { Some("Invalid compose config".to_string()) },
        });
    }
    Ok(serde_json::to_string(&previews).unwrap_or_else(|_| "[]".to_string()))
}
