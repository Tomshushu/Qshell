// src-tauri/src/mcp_client/stdio.rs
//
// Qshell MCP Client - Stdio 子进程传输驱动
// 负责拉起本地 MCP Server 子进程 (npx / uvx / node / python / binary)，
// 通过 stdin/stdout 交换 JSON-RPC 2.0 消息，管理握手、工具发现、工具调用与安全销毁。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

use super::types::{infer_tool_read_only, McpToolInfo};

/// initialize 握手：需覆盖首次 npx / uvx 下载依赖的耗时
const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(60);
/// tools/list 工具发现的超时，保持较短以免故障插件拖慢 AI 对话
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(25);
const CALL_TIMEOUT: Duration = Duration::from_secs(30);

pub struct StdioMcpSession {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    stderr_lines: Arc<Mutex<Vec<String>>>,
    next_id: AtomicU64,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub tools: Vec<McpToolInfo>,
}

impl StdioMcpSession {
    /// 启动子进程并完成 MCP initialize 握手与 tools/list 发现
    pub async fn connect(
        raw_cmd: &str,
        raw_args: &[String],
        env_vars: &HashMap<String, String>,
    ) -> Result<Self, String> {
        let cmd_trimmed = raw_cmd.trim();
        if cmd_trimmed.is_empty() {
            return Err("未配置启动命令 (Command)".to_string());
        }

        // 1. 解析并插值参数中的 ${ENV_KEY} 占位符
        let mut interpolated_args = Vec::new();
        for arg in raw_args {
            let resolved = interpolate_env_vars(arg, env_vars);
            // 若原参数纯粹是占位符且对应环境变量未填，跳过空参数
            if arg.starts_with("${") && arg.ends_with('}') && resolved.trim().is_empty() {
                continue;
            }
            interpolated_args.push(resolved);
        }

        // 2. 启动子进程（Windows 自动兼容 .cmd 批处理脚本与无黑框模式）
        let mut child = spawn_cross_platform(cmd_trimmed, &interpolated_args, env_vars)?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "无法获取子进程 stdin 管道".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "无法获取子进程 stdout 管道".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "无法获取子进程 stderr 管道".to_string())?;

        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let stderr_lines: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

        // 3. 后台读取 stdout JSON-RPC 帧
        let pending_clone = pending.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() || !trimmed.starts_with('{') {
                    continue;
                }
                if let Ok(msg) = serde_json::from_str::<Value>(trimmed) {
                    // JSON-RPC 允许 id 为数字或字符串；本地请求始终使用自增数字 id
                    let id = msg.get("id").and_then(|v| match v {
                        Value::Number(n) => n.as_u64(),
                        Value::String(s) => s.parse::<u64>().ok(),
                        _ => None,
                    });
                    if let Some(id) = id {
                        let mut map = pending_clone.lock().await;
                        if let Some(tx) = map.remove(&id) {
                            let _ = tx.send(msg);
                        }
                    }
                }
            }
            // stdout 关闭时唤醒所有等待中的请求
            let mut map = pending_clone.lock().await;
            map.clear();
        });

        // 4. 后台收集 stderr 最近 20 行用于排障诊断
        let stderr_clone = stderr_lines.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    let mut buf = stderr_clone.lock().await;
                    if buf.len() >= 20 {
                        buf.remove(0);
                    }
                    buf.push(trimmed.to_string());
                }
            }
        });

        let mut session = Self {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending,
            stderr_lines,
            next_id: AtomicU64::new(1),
            server_name: None,
            server_version: None,
            tools: Vec::new(),
        };

        // 5. 发送 initialize 握手
        let init_res = session
            .send_request(
                "initialize",
                json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "Qshell-AIOps-Client",
                        "version": "1.0.20"
                    }
                }),
                INITIALIZE_TIMEOUT,
            )
            .await
            .map_err(|e| {
                let _ = session.kill_sync();
                e
            })?;

        if let Some(info) = init_res.get("serverInfo") {
            session.server_name = info
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            session.server_version = info
                .get("version")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }

        // 6. 发送 notifications/initialized 通知
        let _ = session
            .send_notification("notifications/initialized", json!({}))
            .await;

        // 7. 发现工具列表 tools/list
        let tools_res = session
            .send_request("tools/list", json!({}), HANDSHAKE_TIMEOUT)
            .await
            .map_err(|e| {
                let _ = session.kill_sync();
                e
            })?;

        session.tools = parse_tools_list(&tools_res);

        Ok(session)
    }

    /// 刷新工具列表
    pub async fn refresh_tools(&self) -> Result<Vec<McpToolInfo>, String> {
        let res = self
            .send_request("tools/list", json!({}), CALL_TIMEOUT)
            .await?;
        Ok(parse_tools_list(&res))
    }

    /// 调用指定 MCP 工具
    pub async fn call_tool(&self, tool_name: &str, arguments: Value) -> Result<(bool, String), String> {
        let res = self
            .send_request(
                "tools/call",
                json!({
                    "name": tool_name,
                    "arguments": arguments
                }),
                CALL_TIMEOUT,
            )
            .await?;

        let is_error = res
            .get("isError")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let mut parts = Vec::new();
        if let Some(content_arr) = res.get("content").and_then(|v| v.as_array()) {
            for item in content_arr {
                if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                    parts.push(text.to_string());
                } else if let Some(res_obj) = item.get("resource") {
                    if let Some(text) = res_obj.get("text").and_then(|v| v.as_str()) {
                        parts.push(text.to_string());
                    }
                }
            }
        }

        let combined = if parts.is_empty() {
            serde_json::to_string_pretty(&res).unwrap_or_default()
        } else {
            parts.join("\n")
        };

        Ok((is_error, combined))
    }

    /// 检查子进程是否仍然存活
    pub async fn is_alive(&self) -> bool {
        let mut child = self.child.lock().await;
        match child.try_wait() {
            Ok(None) => true,
            _ => false,
        }
    }

    /// 优雅终止子进程（Windows 下连同子进程树一并清理，防止 cmd.exe / npx 残留孤儿 node 进程）
    pub async fn shutdown(&self) {
        let mut child = self.child.lock().await;
        #[cfg(windows)]
        if let Some(pid) = child.id() {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(CREATE_NO_WINDOW)
                .status()
                .await;
        }
        let _ = child.kill().await;
    }

    fn kill_sync(&mut self) -> Result<(), String> {
        if let Ok(mut child) = self.child.try_lock() {
            #[cfg(windows)]
            if let Some(pid) = child.id() {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                // 必须等待 taskkill 完成：否则孙进程可能残留并持有 stdout 写端，
                // 使 reader 任务永久挂起。
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()
                    .and_then(|mut c| c.wait());
            }
            let _ = child.start_kill();
        }
        Ok(())
    }

    async fn send_notification(&self, method: &str, params: Value) -> Result<(), String> {
        let frame = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });
        let mut line = serde_json::to_string(&frame).map_err(|e| e.to_string())?;
        line.push('\n');
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("写入通知失败: {}", e))?;
        stdin.flush().await.map_err(|e| format!("刷新管道失败: {}", e))
    }

    async fn send_request(
        &self,
        method: &str,
        params: Value,
        timeout_dur: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.pending.lock().await;
            map.insert(id, tx);
        }

        let frame = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        let mut line = serde_json::to_string(&frame).map_err(|e| e.to_string())?;
        line.push('\n');

        {
            let mut stdin = self.stdin.lock().await;
            if let Err(e) = stdin.write_all(line.as_bytes()).await {
                self.pending.lock().await.remove(&id);
                let stderr_tail = self.format_stderr().await;
                return Err(format!("向插件发送请求 `{}` 失败: {}{}", method, e, stderr_tail));
            }
            let _ = stdin.flush().await;
        }

        match tokio::time::timeout(timeout_dur, rx).await {
            Ok(Ok(msg)) => {
                if let Some(err) = msg.get("error") {
                    let err_msg = err
                        .get("message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("未知 RPC 错误");
                    let code = err.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
                    return Err(format!("MCP 错误 ({}): {}", code, err_msg));
                }
                Ok(msg.get("result").cloned().unwrap_or(json!({})))
            }
            Ok(Err(_)) => {
                let stderr_tail = self.format_stderr().await;
                Err(format!(
                    "插件进程在响应 `{}` 前已退出{}",
                    method, stderr_tail
                ))
            }
            Err(_) => {
                self.pending.lock().await.remove(&id);
                let stderr_tail = self.format_stderr().await;
                let hint = if method == "initialize" {
                    "\n可能原因：\n  1. 首次运行 npx / uvx 需要下载依赖，耗时较长；\n  2. 本机 kubectl、kubeconfig 等前置条件缺失；\n  3. 启动命令未把 stdin/stdout 交给 MCP Server。\n建议：先在终端手动执行一次启动命令预热依赖，并确认它能正常启动。"
                } else {
                    "\n请确认插件进程仍在运行，必要时使用「刷新」重新握手。"
                };
                let no_log = if stderr_tail.is_empty() {
                    "\n插件进程未输出任何日志（stderr 为空）。"
                } else {
                    ""
                };
                Err(format!(
                    "等待插件响应 `{}` 超时 ({}s){}{}{}",
                    method,
                    timeout_dur.as_secs(),
                    no_log,
                    hint,
                    stderr_tail
                ))
            }
        }
    }

    async fn format_stderr(&self) -> String {
        let lines = self.stderr_lines.lock().await;
        if lines.is_empty() {
            String::new()
        } else {
            let tail: Vec<&str> = lines.iter().rev().take(6).rev().map(|s| s.as_str()).collect();
            format!(" [Stderr: {}]", tail.join(" | "))
        }
    }
}

/// 解析 tools/list 返回的工具清单
pub fn parse_tools_list(result: &Value) -> Vec<McpToolInfo> {
    let mut list = Vec::new();
    if let Some(arr) = result.get("tools").and_then(|v| v.as_array()) {
        for item in arr {
            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if name.is_empty() {
                continue;
            }
            let description = item
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let input_schema = item.get("inputSchema").cloned().unwrap_or_else(|| {
                json!({
                    "type": "object",
                    "properties": {}
                })
            });
            let is_read_only = infer_tool_read_only(&name, item);
            list.push(McpToolInfo {
                name,
                description,
                input_schema,
                is_read_only,
            });
        }
    }
    list
}

/// 将字符串中的 `${VAR_NAME}` 替换为 `env_vars` 中的实际值
pub fn interpolate_env_vars(input: &str, env_vars: &HashMap<String, String>) -> String {
    let mut result = input.to_string();
    for (k, v) in env_vars {
        let pattern = format!("${{{}}}", k);
        if result.contains(&pattern) {
            result = result.replace(&pattern, v);
        }
    }
    result
}

/// 跨平台启动子进程（Windows 下自动隐藏控制台黑框并兼容 npx.cmd / uvx.exe）
fn spawn_cross_platform(
    cmd: &str,
    args: &[String],
    env_vars: &HashMap<String, String>,
) -> Result<Child, String> {
    let filtered_env: HashMap<&String, &String> =
        env_vars.iter().filter(|(_, v)| !v.trim().is_empty()).collect();

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let is_script_wrapper = matches!(
            cmd.to_lowercase().as_str(),
            "npx" | "npm" | "pnpm" | "yarn" | "uvx" | "bunx"
        );

        if is_script_wrapper {
            let cmd_with_ext = format!("{}.cmd", cmd);
            let mut command = Command::new(&cmd_with_ext);
            command
                .args(args)
                .envs(&filtered_env)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .creation_flags(CREATE_NO_WINDOW);
            if let Ok(child) = command.spawn() {
                return Ok(child);
            }
        }

        // 尝试直接拉起可执行文件
        let mut direct_cmd = Command::new(cmd);
        direct_cmd
            .args(args)
            .envs(&filtered_env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .creation_flags(CREATE_NO_WINDOW);

        match direct_cmd.spawn() {
            Ok(child) => Ok(child),
            Err(_) => {
                // 回退通过 cmd.exe /C 启动
                let mut fallback = Command::new("cmd.exe");
                fallback
                    .arg("/C")
                    .arg(cmd)
                    .args(args)
                    .envs(&filtered_env)
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .kill_on_drop(true)
                    .creation_flags(CREATE_NO_WINDOW);
                fallback.spawn().map_err(|e| {
                    format!(
                        "无法拉起命令 `{}`: {}（请确认本机已安装 Node.js/npx 或对应运行环境）",
                        cmd, e
                    )
                })
            }
        }
    }

    #[cfg(not(windows))]
    {
        let mut command = Command::new(cmd);
        command
            .args(args)
            .envs(&filtered_env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        command.spawn().map_err(|e| {
            format!(
                "无法拉起命令 `{}`: {}（请确认本机已安装 Node.js/npx 或对应运行环境）",
                cmd, e
            )
        })
    }
}
