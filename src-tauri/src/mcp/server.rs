// src-tauri/src/mcp/server.rs
//
// Qshell 主进程内 127.0.0.1 本地 MCP HTTP 服务端 (Streamable HTTP / JSON-RPC 2.0)
// 1. 严格绑定 127.0.0.1，校验 Bearer Token 与 Origin，提供 /health 探活
// 2. 完整实现 tools/list, tools/call, resources/list, resources/read, prompts/list, prompts/get
// 3. 严格通过 guard 零信任判定、并发租约、出向 DLP 脱敏与 8KB 截断

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use serde_json::{json, Value};

use super::auth::AuthManager;
use super::guard::{evaluate_command, sanitize_dlp, truncate_output, validate_sftp_path};
use super::lease::LeaseManager;
use super::types::{JsonRpcRequest, JsonRpcResponse};
use crate::ssh::manager::SshManager;

pub struct McpServer {
    auth: AuthManager,
    leases: LeaseManager,
    shutdown_tx: broadcast::Sender<()>,
}

impl McpServer {
    pub fn new(auth: AuthManager, leases: LeaseManager) -> Self {
        let (shutdown_tx, _) = broadcast::channel(1);
        Self {
            auth,
            leases,
            shutdown_tx,
        }
    }

    pub fn start(&self) {
        let auth = self.auth.clone();
        let leases = self.leases.clone();
        let mut shutdown_rx = self.shutdown_tx.subscribe();

        tauri::async_runtime::spawn(async move {
            let config = auth.get_config().await;
            if !config.enabled {
                tracing::info!("[MCP Server] 本地 MCP 服务当前已禁用，跳过启动");
                return;
            }

            let addr = format!("127.0.0.1:{}", config.port);
            let listener = match TcpListener::bind(&addr).await {
                Ok(l) => {
                    tracing::info!("[MCP Server] 正在监听: http://{}", addr);
                    l
                }
                Err(e) => {
                    tracing::error!("[MCP Server] 绑定端口失败 {}: {}", addr, e);
                    return;
                }
            };

            loop {
                tokio::select! {
                    _ = shutdown_rx.recv() => {
                        tracing::info!("[MCP Server] 收到停止指令，关闭服务");
                        break;
                    }
                    accepted = listener.accept() => {
                        let (socket, _) = match accepted {
                            Ok(res) => res,
                            Err(_) => continue,
                        };

                        let auth_clone = auth.clone();
                        let leases_clone = leases.clone();
                        tauri::async_runtime::spawn(async move {
                            Self::handle_connection(socket, auth_clone, leases_clone).await;
                        });
                    }
                }
            }
        });
    }

    pub fn stop(&self) {
        let _ = self.shutdown_tx.send(());
    }

    async fn handle_connection(
        mut socket: tokio::net::TcpStream,
        auth: AuthManager,
        leases: LeaseManager,
    ) {
        let mut buf = vec![0u8; 65536];
        let n = match socket.read(&mut buf).await {
            Ok(n) if n > 0 => n,
            _ => return,
        };

        let raw = String::from_utf8_lossy(&buf[..n]);
        let mut lines = raw.lines();
        let request_line = lines.next().unwrap_or("");
        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or("");
        let path = parts.next().unwrap_or("");

        // 解析常用请求头
        let mut auth_header: Option<String> = None;
        let mut origin_header: Option<String> = None;

        for line in lines {
            if line.is_empty() {
                break;
            }
            let lower = line.to_lowercase();
            if lower.starts_with("authorization:") {
                auth_header = Some(line["authorization:".len()..].trim().to_string());
            } else if lower.starts_with("origin:") {
                origin_header = Some(line["origin:".len()..].trim().to_string());
            }
        }

        // 1. 处理 OPTIONS 跨域预检
        if method == "OPTIONS" {
            let res = "HTTP/1.1 200 OK\r\n\
                Access-Control-Allow-Origin: *\r\n\
                Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
                Access-Control-Allow-Headers: Authorization, Content-Type, Mcp-Session-Id\r\n\
                Content-Length: 0\r\n\
                \r\n";
            let _ = socket.write_all(res.as_bytes()).await;
            return;
        }

        // 2. 校验 Origin (防 DNS Rebinding / 恶意网页跨域探测)
        if !auth.verify_origin(origin_header.as_deref()) {
            let res_body = r#"{"error":"Forbidden: Invalid Origin"}"#;
            let res = format!(
                "HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                res_body.len(),
                res_body
            );
            let _ = socket.write_all(res.as_bytes()).await;
            return;
        }

        // 3. 处理 /health 探活
        if path == "/health" && method == "GET" {
            let res_body = r#"{"status":"ok","version":"1.0.20","service":"qshell-mcp"}"#;
            let res = format!(
                "HTTP/1.1 200 OK\r\n\
                Access-Control-Allow-Origin: *\r\n\
                Content-Type: application/json\r\n\
                Content-Length: {}\r\n\
                \r\n\
                {}",
                res_body.len(),
                res_body
            );
            let _ = socket.write_all(res.as_bytes()).await;
            return;
        }

        // 4. 校验 Token
        if !auth.verify_token(auth_header.as_deref()).await {
            let res_body = r#"{"jsonrpc":"2.0","error":{"code":-32001,"message":"Unauthorized: 无效或缺失 Bearer Token"}}"#;
            let res = format!(
                "HTTP/1.1 401 Unauthorized\r\n\
                Access-Control-Allow-Origin: *\r\n\
                Content-Type: application/json\r\n\
                Content-Length: {}\r\n\
                \r\n\
                {}",
                res_body.len(),
                res_body
            );
            let _ = socket.write_all(res.as_bytes()).await;
            return;
        }

        // 5. 处理 /mcp 主路由 (POST JSON-RPC)
        if (path == "/mcp" || path == "/") && method == "POST" {
            let body = raw.split("\r\n\r\n").nth(1).unwrap_or("").trim();
            if body.is_empty() {
                let res_body = r#"{"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error: 空请求体"}}"#;
                let res = format!("HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", res_body.len(), res_body);
                let _ = socket.write_all(res.as_bytes()).await;
                return;
            }

            let rpc_req: JsonRpcRequest = match serde_json::from_str(body) {
                Ok(r) => r,
                Err(e) => {
                    let err_resp = JsonRpcResponse::error(None, -32700, format!("Invalid JSON: {}", e), None);
                    let res_body = serde_json::to_string(&err_resp).unwrap_or_default();
                    let res = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}", res_body.len(), res_body);
                    let _ = socket.write_all(res.as_bytes()).await;
                    return;
                }
            };

            let rpc_res = Self::dispatch_mcp_request(rpc_req, &auth, &leases).await;
            let res_body = serde_json::to_string(&rpc_res).unwrap_or_default();
            let res = format!(
                "HTTP/1.1 200 OK\r\n\
                Access-Control-Allow-Origin: *\r\n\
                Content-Type: application/json\r\n\
                Content-Length: {}\r\n\
                \r\n\
                {}",
                res_body.len(),
                res_body
            );
            let _ = socket.write_all(res.as_bytes()).await;
            return;
        }

        // 其他路由返回 404
        let not_found = r#"{"error":"Not Found"}"#;
        let res = format!("HTTP/1.1 404 Not Found\r\nContent-Length: {}\r\n\r\n{}", not_found.len(), not_found);
        let _ = socket.write_all(res.as_bytes()).await;
    }

    /// 分发并执行 MCP JSON-RPC 请求
    async fn dispatch_mcp_request(
        req: JsonRpcRequest,
        auth: &AuthManager,
        leases: &LeaseManager,
    ) -> JsonRpcResponse {
        let id = req.id;
        match req.method.as_str() {
            // 协议握手
            "initialize" => {
                let result = json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": { "listChanged": false },
                        "resources": { "subscribe": false, "listChanged": false },
                        "prompts": { "listChanged": false }
                    },
                    "serverInfo": {
                        "name": "qshell-mcp",
                        "version": "1.0.20"
                    }
                });
                JsonRpcResponse::success(id, result)
            }
            "notifications/initialized" => {
                JsonRpcResponse::success(id, json!({}))
            }

            // ==================== Tools ====================
            "tools/list" => {
                let tools = json!({
                    "tools": [
                        {
                            "name": "probe_server",
                            "description": "秒级只读探测纳管主机全景指标：内存、CPU、磁盘挂载、运行容器、监听端口。不修改任何状态。",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "hostId": { "type": "string", "description": "纳管主机 ID，可从 qshell://hosts 获取" },
                                    "metric": {
                                        "type": "string",
                                        "enum": ["memory", "cpu", "disk", "container", "network", "process", "all"],
                                        "description": "探测维度：memory(内存), cpu(负载), disk(磁盘挂载), container(运行容器), network(端口监听), process(进程列表), all(全景综合指标)"
                                    }
                                },
                                "required": ["hostId"],
                                "additionalProperties": false
                            },
                            "annotations": {
                                "readOnlyHint": true,
                                "idempotentHint": true,
                                "openWorldHint": false
                            }
                        },
                        {
                            "name": "execute_readonly_command",
                            "description": "在指定纳管主机执行单条只读排障命令。所有命令经 Qshell 零信任网关逐段审查；写、删、kill、重启、子 Shell、后台脱钩一律拒绝。返回经端侧 DLP 脱敏并截断至 8KB 的结果。",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "hostId": { "type": "string", "description": "纳管主机 ID，可从 qshell://hosts 获取" },
                                    "command": { "type": "string", "description": "拟执行的单条只读排障命令，如 systemctl status nginx、ss -tulpn、journalctl -u app -n 50 --no-pager 等" },
                                    "explanation": { "type": "string", "description": "排障目的说明" }
                                },
                                "required": ["hostId", "command"],
                                "additionalProperties": false
                            },
                            "annotations": {
                                "readOnlyHint": true,
                                "idempotentHint": true,
                                "openWorldHint": false
                            }
                        },
                        {
                            "name": "sftp_read_file",
                            "description": "通过既有 SFTP 通道只读抓取远程配置文件，避免 Shell 转义与编码问题。仅允许白名单路径，返回脱敏并截断至 8KB 的文本。",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "hostId": { "type": "string", "description": "纳管主机 ID，可从 qshell://hosts 获取" },
                                    "remotePath": { "type": "string", "description": "绝对 POSIX 路径，如 /etc/nginx/nginx.conf、/var/log/syslog 等" },
                                    "maxLines": { "type": "integer", "default": 150, "maximum": 500, "description": "最大读取行数，默认 150 行，上限 500 行" }
                                },
                                "required": ["hostId", "remotePath"],
                                "additionalProperties": false
                            },
                            "annotations": {
                                "readOnlyHint": true,
                                "idempotentHint": true,
                                "openWorldHint": false
                            }
                        }
                    ]
                });
                JsonRpcResponse::success(id, tools)
            }

            "tools/call" => {
                let params = req.params.unwrap_or_default();
                let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));

                let host_id = args.get("hostId")
                    .or_else(|| args.get("targetServer"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim();

                if host_id.is_empty() {
                    let err_payload = json!({
                        "content": [{
                            "type": "text",
                            "text": "{\n  \"isError\": true,\n  \"verdict\": \"unknown-host\",\n  \"hint\": \"请在参数中指定明确的 hostId，可从资源 qshell://hosts 读取已纳管主机清单。\"\n}"
                        }],
                        "isError": true
                    });
                    return JsonRpcResponse::success(id, err_payload);
                }

                // S2-6: 主机显式授权检查
                if !auth.is_host_authorized(host_id).await {
                    let err_payload = json!({
                        "content": [{
                            "type": "text",
                            "text": format!("{{\n  \"isError\": true,\n  \"verdict\": \"unknown-host\",\n  \"hostId\": \"{}\",\n  \"hint\": \"目标主机未在 Qshell 设置中授权开放给外部 MCP 客户端。请在 Qshell 设置 -> MCP 服务中将该主机勾选加入授权列表。\"\n}}", host_id)
                        }],
                        "isError": true
                    });
                    return JsonRpcResponse::success(id, err_payload);
                }

                // S2-7: 并发会话租约检查
                let client_id = "mcp_client";
                let lease_id = match leases.acquire(host_id, client_id, 60).await {
                    Ok(lid) => lid,
                    Err(lease_err) => {
                        let err_payload = json!({
                            "content": [{
                                "type": "text",
                                "text": format!("{{\n  \"isError\": true,\n  \"verdict\": \"lease-conflict\",\n  \"message\": \"{}\"\n}}", lease_err)
                            }],
                            "isError": true
                        });
                        return JsonRpcResponse::success(id, err_payload);
                    }
                };

                // 执行具体工具调用
                let call_result = match tool_name {
                    "probe_server" => {
                        let metric = args.get("metric").and_then(|v| v.as_str()).unwrap_or("all");
                        Self::execute_probe_tool(host_id, metric).await
                    }
                    "execute_readonly_command" => {
                        let command = args.get("command").and_then(|v| v.as_str()).unwrap_or("");
                        Self::execute_command_tool(host_id, command).await
                    }
                    "sftp_read_file" => {
                        let remote_path = args.get("remotePath").and_then(|v| v.as_str()).unwrap_or("");
                        let max_lines = args.get("maxLines").and_then(|v| v.as_u64()).unwrap_or(150) as usize;
                        Self::execute_sftp_tool(host_id, remote_path, max_lines).await
                    }
                    _ => {
                        json!({
                            "content": [{
                                "type": "text",
                                "text": format!("未知工具名称: {}", tool_name)
                            }],
                            "isError": true
                        })
                    }
                };

                // 执行完毕释放租约
                leases.release(host_id, &lease_id).await;

                JsonRpcResponse::success(id, call_result)
            }

            // ==================== Resources ====================
            "resources/list" => {
                let resources = json!({
                    "resources": [
                        {
                            "uri": "qshell://hosts",
                            "name": "纳管主机资产与授权清单",
                            "description": "Qshell 纳管的主机资产信息（不包含任何密码或私钥凭据），含连接状态、操作系统类型与已授权策略分级",
                            "mimeType": "application/json"
                        },
                        {
                            "uri": "qshell://session/context",
                            "name": "当前活动会话上下文",
                            "description": "当前选中的主机、操作系统、活跃标签页与终端环境信息",
                            "mimeType": "application/json"
                        }
                    ]
                });
                JsonRpcResponse::success(id, resources)
            }

            "resources/read" => {
                let params = req.params.unwrap_or_default();
                let uri = params.get("uri").and_then(|v| v.as_str()).unwrap_or("");

                match uri {
                    "qshell://hosts" => {
                        let servers_json = crate::db::servers_list().unwrap_or_else(|_| "[]".to_string());
                        let servers: Vec<Value> = serde_json::from_str(&servers_json).unwrap_or_default();
                        let mut hosts_summary = Vec::new();

                        for s in servers {
                            if let Some(id_val) = s.get("id").and_then(|v| v.as_str()) {
                                let is_connected = SshManager::global().is_connected_sync(id_val);
                                let is_authorized = auth.is_host_authorized(id_val).await;
                                hosts_summary.push(json!({
                                    "hostId": id_val,
                                    "name": s.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                                    "host": s.get("host").and_then(|v| v.as_str()).unwrap_or(""),
                                    "port": s.get("port").and_then(|v| v.as_u64()).unwrap_or(22),
                                    "targetType": s.get("target_type").and_then(|v| v.as_str()).unwrap_or("linux"),
                                    "connected": is_connected,
                                    "authorized": is_authorized,
                                    "policyLevel": if is_authorized { "read-only" } else { "none" }
                                }));
                            }
                        }

                        let payload_str = serde_json::to_string_pretty(&hosts_summary).unwrap_or_default();
                        JsonRpcResponse::success(id, json!({
                            "contents": [{
                                "uri": "qshell://hosts",
                                "mimeType": "application/json",
                                "text": payload_str
                            }]
                        }))
                    }
                    "qshell://session/context" => {
                        let status = json!({
                            "app": "Qshell",
                            "version": "1.0.20",
                            "mcpMode": "server-streamable-http",
                            "guardPolicy": "read-only-zero-trust",
                            "dlpOutbound": "enabled",
                            "maxOutputBytes": 8192
                        });
                        JsonRpcResponse::success(id, json!({
                            "contents": [{
                                "uri": "qshell://session/context",
                                "mimeType": "application/json",
                                "text": serde_json::to_string_pretty(&status).unwrap_or_default()
                            }]
                        }))
                    }
                    _ => {
                        JsonRpcResponse::error(id, -32602, format!("未找到指定的 Resource URI: {}", uri), None)
                    }
                }
            }

            // ==================== Prompts ====================
            "prompts/list" => {
                let prompts = json!({
                    "prompts": [
                        {
                            "name": "playbook-502",
                            "description": "Nginx/后端 502 Bad Gateway 故障自愈排查 Playbook（服务存活 → 去噪配置 → 错误日志 → 端口侦听 → 根因推导）"
                        },
                        {
                            "name": "playbook-oom",
                            "description": "进程崩溃与内核 OOM Killer 强杀排查 Playbook（ExitCode 核验 → 异常日志堆栈 → dmesg 内核内存判定）"
                        },
                        {
                            "name": "playbook-resource",
                            "description": "CPU 100% / 内存打满 / 磁盘耗尽自愈排查 Playbook（Top 5 进程消耗 → 限制深度磁盘扫描）"
                        },
                        {
                            "name": "playbook-port-conflict",
                            "description": "端口冲突与连通性受阻排查 Playbook（ss/lsof 占用侦测 → 本地防火墙规则切片）"
                        },
                        {
                            "name": "report-format",
                            "description": "Qshell 标准证据链驱动排障终局输出格式规范（🔴 故障根因 / 🔍 排查证据链 / 🛠️ 精准修复方案）"
                        }
                    ]
                });
                JsonRpcResponse::success(id, prompts)
            }

            "prompts/get" => {
                let params = req.params.unwrap_or_default();
                let prompt_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let prompt_content = match prompt_name {
                    "playbook-502" => {
                        "【Playbook A: Nginx/后端 502 Bad Gateway 故障排障指南】\n\
                        1. 步骤 1：调用 execute_readonly_command 检查后端服务存活 (systemctl is-active app / docker ps --filter name=app)\n\
                        2. 步骤 2：调用 sftp_read_file 或 grep 去噪读取 Nginx 代理配置 (去除注释与空行)\n\
                        3. 步骤 3：截取最近 40 行错误日志 (tail -n 40 /var/log/nginx/error.log)\n\
                        4. 步骤 4：检查后端目标端口是否真正在监听 (ss -tulpn | grep :<port>)\n\
                        5. 步骤 5：遵循 report-format 格式输出【故障根因】、【排查证据链】与【精准修复方案】。"
                    }
                    "playbook-oom" => {
                        "【Playbook B: 应用程序崩溃 / 异常退出 / OOM Killer 排障指南】\n\
                        1. 步骤 1：执行 systemctl status 或 docker ps -a 捕捉退出码 (137=OOM强杀, 1=配置报错, 127=命令未找到)\n\
                        2. 步骤 2：执行 journalctl -u app -n 50 --no-pager 提取报错日志堆栈\n\
                        3. 步骤 3：执行 dmesg -T | grep -iE 'oom[-_]killer|out of memory|killed process' | tail -n 20 验证内核内存强杀事实\n\
                        4. 步骤 4：按 report-format 给出外科手术式内存修复方案。"
                    }
                    "playbook-resource" => {
                        "【Playbook C: 资源耗尽与系统雪崩排障指南】\n\
                        1. 步骤 1：调用 probe_server(metric='all') 提取综合运行水位与 Top 5 资源消耗进程\n\
                        2. 步骤 2：磁盘满排查严禁全盘裸跑，必须使用带深度限制的安全指令：du -h --max-depth=1 /var/log | sort -hr | head -n 10\n\
                        3. 步骤 3：列出核心大文件证据并给出安全清理建议。"
                    }
                    "playbook-port-conflict" => {
                        "【Playbook D: 端口冲突与网络连通性受阻排障指南】\n\
                        1. 步骤 1：查看端口实际绑定情况：ss -tulpn | grep :<port>\n\
                        2. 步骤 2：检查本地防火墙与拦截规则：iptables -L -n --line-numbers | head -n 30 或 ufw status\n\
                        3. 步骤 3：分析是否存在多进程争抢端口或监听在 127.0.0.1 导致外网无法连通。"
                    }
                    "report-format" => {
                        "【Qshell 证据链驱动终局输出格式规范】\n\
                        🔴 **【故障根因】**：正文第 1 行一针见血，直截了当点明事故根本原因（哪一行配置写错、哪个端口未监听、哪个依赖缺失、或内核 OOM 强杀）；\n\
                        🔍 **【排查证据链】**：列出在工具调用中真实捕获的客观证据（附带真实命令与关键日志行切片，拒绝脑补）；\n\
                        🛠️ **【精准修复方案】**：给出最小化、外科手术式（Surgical）的修复命令代码块（```bash），若需写操作（如重启服务、修改配置）明确标识变更性质与风险。"
                    }
                    _ => {
                        return JsonRpcResponse::error(id, -32602, format!("未找到指定的 Prompt 名称: {}", prompt_name), None);
                    }
                };

                JsonRpcResponse::success(id, json!({
                    "description": format!("Qshell 运维排障预设指令: {}", prompt_name),
                    "messages": [{
                        "role": "user",
                        "content": {
                            "type": "text",
                            "text": prompt_content
                        }
                    }]
                }))
            }

            _ => {
                JsonRpcResponse::error(id, -32601, format!("Method not found: {}", req.method), None)
            }
        }
    }

    /// 执行 probe_server 探针工具
    async fn execute_probe_tool(host_id: &str, metric: &str) -> Value {
        let probe_cmd = match metric {
            "memory" => "free -m && ps -eo pid,ppid,cmd,%mem --sort=-%mem | head -n 10",
            "cpu" => "uptime && ps -eo pid,ppid,cmd,%cpu --sort=-%cpu | head -n 10",
            "disk" => "df -h -P",
            "container" => "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || crictl ps 2>/dev/null || echo 'No container engine found'",
            "network" => "ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null",
            "process" => "ps -ef | head -n 30",
            _ => "echo '=== SYSTEM & CPU ===' && uptime && echo '=== MEMORY ===' && free -m && echo '=== DISK ===' && df -h -P",
        };

        match SshManager::global().execute(host_id, probe_cmd, 10).await {
            Ok(res) => {
                let raw_output = if !res.stdout.is_empty() {
                    res.stdout
                } else if !res.stderr.is_empty() {
                    res.stderr
                } else {
                    "（执行完成，输出为空）".to_string()
                };

                // 出向 DLP 脱敏与 8KB 截断
                let (truncated, was_trunc) = truncate_output(&raw_output);
                let sanitized = sanitize_dlp(&truncated);

                json!({
                    "content": [{
                        "type": "text",
                        "text": sanitized
                    }],
                    "truncated": was_trunc,
                    "isError": false
                })
            }
            Err(e) => {
                json!({
                    "content": [{
                        "type": "text",
                        "text": format!("执行探针失败: {}", e)
                    }],
                    "isError": true
                })
            }
        }
    }

    /// 执行 execute_readonly_command 排障命令
    async fn execute_command_tool(host_id: &str, command: &str) -> Value {
        // 1. 零信任命令安全评估
        let guard_decision = evaluate_command(command);
        if !guard_decision.allowed {
            let err_payload = json!({
                "isError": true,
                "verdict": "destructive",
                "segment": guard_decision.segment,
                "hint": guard_decision.hint,
                "message": format!("[安全网关拦截] {}", guard_decision.reason)
            });
            return json!({
                "content": [{
                    "type": "text",
                    "text": serde_json::to_string_pretty(&err_payload).unwrap_or_default()
                }],
                "isError": true
            });
        }

        // 2. 包装只读截断命令，防止超大回显
        let safe_cmd = if !command.contains("| head") && !command.contains("| tail") {
            format!("{} | head -n 150", command.trim())
        } else {
            command.trim().to_string()
        };

        // 3. 执行
        match SshManager::global().execute(host_id, &safe_cmd, 10).await {
            Ok(res) => {
                let raw_output = if !res.stdout.is_empty() {
                    res.stdout
                } else if !res.stderr.is_empty() {
                    res.stderr
                } else {
                    "（执行完成，输出为空）".to_string()
                };

                let (truncated, was_trunc) = truncate_output(&raw_output);
                let sanitized = sanitize_dlp(&truncated);

                json!({
                    "content": [{
                        "type": "text",
                        "text": sanitized
                    }],
                    "exitCode": res.exit_code,
                    "truncated": was_trunc,
                    "isError": res.exit_code != 0
                })
            }
            Err(e) => {
                json!({
                    "content": [{
                        "type": "text",
                        "text": format!("执行异常: {}", e)
                    }],
                    "isError": true
                })
            }
        }
    }

    /// 执行 sftp_read_file 配置文件抓取工具
    async fn execute_sftp_tool(host_id: &str, remote_path: &str, max_lines: usize) -> Value {
        // 1. 路径白名单与敏感凭据硬拦截审查
        let normalized_path = match validate_sftp_path(remote_path) {
            Ok(p) => p,
            Err(err) => {
                let err_payload = json!({
                    "isError": true,
                    "verdict": "io-blocked",
                    "segment": remote_path,
                    "message": format!("[安全网关拦截] {}", err),
                    "hint": "请提供白名单内绝对 POSIX 路径（如 /etc/nginx/nginx.conf、/var/log/syslog 等），且严禁包含 .. 或敏感凭据"
                });
                return json!({
                    "content": [{
                        "type": "text",
                        "text": serde_json::to_string_pretty(&err_payload).unwrap_or_default()
                    }],
                    "isError": true
                });
            }
        };

        // 2. 优先通过 SFTP 读取
        let sftp_res = crate::commands::files::files_read(host_id.to_string(), normalized_path.clone()).await;

        let file_content = match sftp_res {
            Ok(cmd_res) if cmd_res.exit_code == 0 => cmd_res.stdout,
            _ => {
                // 3. 降级路径：目标机未开 SFTP subsystem 时，fallback 到经 Guard 审查的只读 head / cat
                let safe_cat = format!("head -n {} \"{}\"", max_lines.min(500), normalized_path);
                match SshManager::global().execute(host_id, &safe_cat, 10).await {
                    Ok(cat_res) if cat_res.exit_code == 0 => cat_res.stdout,
                    Ok(cat_res) => {
                        return json!({
                            "content": [{
                                "type": "text",
                                "text": format!("远程文件读取失败: {}", if !cat_res.stderr.is_empty() { cat_res.stderr } else { "文件不存在或无读取权限".to_string() })
                            }],
                            "isError": true
                        });
                    }
                    Err(e) => {
                        return json!({
                            "content": [{
                                "type": "text",
                                "text": format!("降级读取异常: {}", e)
                            }],
                            "isError": true
                        });
                    }
                }
            }
        };

        // 4. 二进制识别
        if file_content.starts_with("::base64::") || file_content.as_bytes().iter().take(1024).any(|&b| b == 0) {
            let notice = format!("检测到目标文件「{}」为二进制数据或特殊编码文件，SFTP 只读取证工具仅支持文本格式的配置文件与日志读取。", normalized_path);
            return json!({
                "content": [{
                    "type": "text",
                    "text": notice
                }],
                "isError": true
            });
        }

        // 5. 行数限制截断
        let lines: Vec<&str> = file_content.lines().collect();
        let clipped = if lines.len() > max_lines {
            let mut s = lines[..max_lines.min(lines.len())].join("\n");
            s.push_str(&format!("\n\n--- [已截断：文件共 {} 行，已按安全配额仅读取前 {} 行] ---", lines.len(), max_lines));
            s
        } else {
            file_content
        };

        // 6. 出向 DLP 脱敏与 8KB 截断
        let (truncated, was_trunc) = truncate_output(&clipped);
        let sanitized = sanitize_dlp(&truncated);

        json!({
            "content": [{
                "type": "text",
                "text": sanitized
            }],
            "truncated": was_trunc,
            "isError": false
        })
    }
}
