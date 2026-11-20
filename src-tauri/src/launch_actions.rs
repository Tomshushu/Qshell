use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

/// 启动或唤醒时解析出的动作（统一由前端确认并分发执行）。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LaunchAction {
    /// 打开指定服务器会话（匹配 server id 或名称）
    OpenServer { server: String },
    /// 打开本地终端，可选初始工作目录
    OpenLocal { cwd: Option<String> },
    /// 外部触发的文件传输请求（前端必须弹窗让用户确认目标服务器与路径后才能入队）
    TransferFiles {
        paths: Vec<String>,
        target_server: Option<String>,
    },
    /// 外部请求在目标服务器上执行命令（前端必须二次弹窗确认后才允许执行）
    ExecCommand { server: String, command: String },
}

static PENDING_ACTIONS: LazyLock<Mutex<Vec<LaunchAction>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

/// 将冷启动或回调收集到的动作压入待消费队列（单次上限 32 条防滥用）。
pub fn enqueue_pending_actions(actions: impl IntoIterator<Item = LaunchAction>) {
    if let Ok(mut guard) = PENDING_ACTIONS.lock() {
        for action in actions {
            if guard.len() >= 32 {
                break;
            }
            guard.push(action);
        }
    }
}

/// 取出并清空所有待处理的启动动作（前端挂载完成后调用一次）。
pub fn take_pending_actions() -> Vec<LaunchAction> {
    if let Ok(mut guard) = PENDING_ACTIONS.lock() {
        std::mem::take(&mut *guard)
    } else {
        Vec::new()
    }
}

/// 简易 URL percent-decode（兼容 `+` 与 `%XX` UTF-8 字节序列）。
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                if let (Some(h), Some(l)) = (hi, lo) {
                    out.push(((h << 4) | l) as u8);
                    i += 3;
                } else {
                    out.push(b'%');
                    i += 1;
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 解析 `qshell://` URL 为受白名单约束的 `LaunchAction`。
///
/// 支持格式：
/// - `qshell://open-server?server=<id_or_name>` 或 `qshell://open-server/<id_or_name>`
/// - `qshell://new-local?cwd=<path>`
/// - `qshell://transfer?path=<local_path>&server=<optional_server>`（支持多个 `path=` 参数）
/// - `qshell://exec?server=<id_or_name>&cmd=<command>`
pub fn parse_deep_link_url(raw_url: &str) -> Option<LaunchAction> {
    let trimmed = raw_url.trim();
    let rest = trimmed
        .strip_prefix("qshell://")
        .or_else(|| trimmed.strip_prefix("QSHELL://"))?;

    let (path_part, query_part) = match rest.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (rest, None),
    };

    let mut segments = path_part.split('/').filter(|s| !s.is_empty());
    let host_or_cmd = segments.next()?.to_ascii_lowercase();
    let sub_segment = segments.next().map(percent_decode);

    let mut params: Vec<(String, String)> = Vec::new();
    if let Some(q) = query_part {
        for pair in q.split('&') {
            if pair.is_empty() {
                continue;
            }
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            params.push((percent_decode(k).to_ascii_lowercase(), percent_decode(v)));
        }
    }

    let get_param = |name: &str| -> Option<String> {
        params
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.trim().to_string())
            .filter(|v| !v.is_empty())
    };

    match host_or_cmd.as_str() {
        "open-server" | "open" | "bookmark" => {
            let server = get_param("server")
                .or_else(|| get_param("id"))
                .or_else(|| get_param("name"))
                .or(sub_segment)
                .filter(|s| !s.is_empty())?;
            Some(LaunchAction::OpenServer { server })
        }
        "new-local" | "local" => {
            let cwd = get_param("cwd").or_else(|| get_param("dir")).or(sub_segment);
            Some(LaunchAction::OpenLocal { cwd })
        }
        "transfer" | "upload" => {
            let mut paths: Vec<String> = params
                .iter()
                .filter(|(k, _)| k == "path" || k == "file")
                .map(|(_, v)| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .collect();
            if paths.is_empty() {
                if let Some(s) = sub_segment.filter(|v| !v.is_empty()) {
                    paths.push(s);
                }
            }
            if paths.is_empty() {
                return None;
            }
            let target_server = get_param("server").or_else(|| get_param("target"));
            Some(LaunchAction::TransferFiles {
                paths,
                target_server,
            })
        }
        "exec" => {
            let server = get_param("server").or_else(|| get_param("id"))?;
            let command = get_param("cmd").or_else(|| get_param("command"))?;
            Some(LaunchAction::ExecCommand { server, command })
        }
        _ => None,
    }
}

fn resolve_cli_path(raw: &str, base_dir: Option<&str>) -> String {
    // Windows Explorer 在盘符根目录右键传入 `"%V"`（如 `"C:\"`）时，
    // MSVC/Rust 命令行解析会把 `\"` 转义成末尾 `"`，得到 `C:"`；此处自动还原为 `C:\`。
    let normalized = if raw.len() >= 3
        && raw.as_bytes()[0].is_ascii_alphabetic()
        && raw.as_bytes()[1] == b':'
        && raw.ends_with('"')
    {
        format!("{}\\", &raw[..raw.len() - 1])
    } else {
        raw.trim_matches('"').to_string()
    };

    let p = Path::new(&normalized);
    if p.is_absolute() {
        return normalized;
    }
    if let Some(base) = base_dir.filter(|s| !s.trim().is_empty()) {
        let joined: PathBuf = Path::new(base).join(p);
        return joined.to_string_lossy().into_owned();
    }
    normalized
}

/// 解析 CLI 启动参数列表（已自动跳过可执行文件路径 `args[0]`）。
///
/// 支持：
/// - `qshell://...` 协议链接
/// - `--open-server <srv>` / `-bookmark <srv>`
/// - `--new-local [dir]` / `--local [dir]`
/// - `--transfer <path>` / `--upload <path>`（可多次传入；配合 `--target <srv>`）
/// - `--exec <srv> <command>`（仅弹出确认，不静默执行）
/// - 直接传入的本机目录路径（来自资源管理器右键 `%V`）或文件路经（`%1`）
pub fn parse_cli_args(args: &[String], working_dir: Option<&str>) -> Vec<LaunchAction> {
    let mut actions = Vec::new();
    let mut transfer_paths: Vec<String> = Vec::new();
    let mut transfer_target: Option<String> = None;

    let mut i = 1; // skip argv[0]
    while i < args.len() {
        let arg = args[i].trim();
        if arg.is_empty() {
            i += 1;
            continue;
        }

        if arg.starts_with("qshell://") || arg.starts_with("QSHELL://") {
            if let Some(act) = parse_deep_link_url(arg) {
                actions.push(act);
            }
            i += 1;
            continue;
        }

        match arg {
            "--open-server" | "-open-server" | "-bookmark" | "--bookmark" => {
                if let Some(srv) = args.get(i + 1).map(|s| s.trim()).filter(|s| !s.is_empty()) {
                    actions.push(LaunchAction::OpenServer {
                        server: srv.to_string(),
                    });
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--new-local" | "-new-local" | "--local" => {
                let next_is_val = args
                    .get(i + 1)
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty() && !s.starts_with('-'));
                if let Some(dir) = next_is_val {
                    actions.push(LaunchAction::OpenLocal {
                        cwd: Some(resolve_cli_path(dir, working_dir)),
                    });
                    i += 2;
                } else {
                    actions.push(LaunchAction::OpenLocal { cwd: None });
                    i += 1;
                }
            }
            "--transfer" | "-transfer" | "--upload" | "-upload" => {
                if let Some(path) = args.get(i + 1).map(|s| s.trim()).filter(|s| !s.is_empty()) {
                    transfer_paths.push(resolve_cli_path(path, working_dir));
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--target" | "-target" => {
                if let Some(srv) = args.get(i + 1).map(|s| s.trim()).filter(|s| !s.is_empty()) {
                    transfer_target = Some(srv.to_string());
                    i += 2;
                } else {
                    i += 1;
                }
            }
            "--exec" | "-exec" => {
                if let (Some(srv), Some(cmd)) = (
                    args.get(i + 1).map(|s| s.trim()).filter(|s| !s.is_empty()),
                    args.get(i + 2).map(|s| s.trim()).filter(|s| !s.is_empty()),
                ) {
                    actions.push(LaunchAction::ExecCommand {
                        server: srv.to_string(),
                        command: cmd.to_string(),
                    });
                    i += 3;
                } else {
                    i += 1;
                }
            }
            _ if !arg.starts_with('-') => {
                // 资源管理器拖放或右键直接传入的本机路径（忽略未知开关）
                let resolved = resolve_cli_path(arg, working_dir);
                let p = Path::new(&resolved);
                if p.is_dir() {
                    actions.push(LaunchAction::OpenLocal {
                        cwd: Some(resolved),
                    });
                } else if p.is_file() {
                    transfer_paths.push(resolved);
                }
                i += 1;
            }
            _ => {
                i += 1;
            }
        }
    }

    if !transfer_paths.is_empty() {
        actions.push(LaunchAction::TransferFiles {
            paths: transfer_paths,
            target_server: transfer_target,
        });
    }

    actions
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_deep_links_across_supported_verbs() {
        assert_eq!(
            parse_deep_link_url("qshell://open-server?server=prod-web-1"),
            Some(LaunchAction::OpenServer {
                server: "prod-web-1".to_string()
            })
        );
        assert_eq!(
            parse_deep_link_url("qshell://new-local?cwd=D%3A%5CSSHTOOL%5CQshell"),
            Some(LaunchAction::OpenLocal {
                cwd: Some("D:\\SSHTOOL\\Qshell".to_string())
            })
        );
        assert_eq!(
            parse_deep_link_url("qshell://transfer?path=C%3A%5Ctmp%5Ca.zip&server=srv-1"),
            Some(LaunchAction::TransferFiles {
                paths: vec!["C:\\tmp\\a.zip".to_string()],
                target_server: Some("srv-1".to_string())
            })
        );
        assert_eq!(
            parse_deep_link_url("qshell://exec?server=srv-1&cmd=df%20-h"),
            Some(LaunchAction::ExecCommand {
                server: "srv-1".to_string(),
                command: "df -h".to_string()
            })
        );
        assert_eq!(parse_deep_link_url("qshell://unknown?foo=bar"), None);
    }

    #[test]
    fn parses_cli_flags_and_deep_link_args() {
        let args = vec![
            "qshell.exe".to_string(),
            "--open-server".to_string(),
            "my-vps".to_string(),
            "--new-local".to_string(),
            "D:\\Projects".to_string(),
            "--transfer".to_string(),
            "D:\\Projects\\app.tar.gz".to_string(),
            "--target".to_string(),
            "my-vps".to_string(),
        ];
        let parsed = parse_cli_args(&args, None);
        assert_eq!(
            parsed,
            vec![
                LaunchAction::OpenServer {
                    server: "my-vps".to_string()
                },
                LaunchAction::OpenLocal {
                    cwd: Some("D:\\Projects".to_string())
                },
                LaunchAction::TransferFiles {
                    paths: vec!["D:\\Projects\\app.tar.gz".to_string()],
                    target_server: Some("my-vps".to_string())
                }
            ]
        );
    }
}
