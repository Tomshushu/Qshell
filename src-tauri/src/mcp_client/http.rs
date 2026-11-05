// src-tauri/src/mcp_client/http.rs
//
// Qshell MCP Client - Streamable HTTP / SSE 远程传输驱动
// 支持连接远程或容器内暴露的 HTTP JSON-RPC MCP 服务端，自动管理 Mcp-Session-Id 与自定义请求头。

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::Mutex;

use super::stdio::parse_tools_list;
use super::types::McpToolInfo;

pub struct HttpMcpSession {
    client: reqwest::Client,
    endpoint_url: String,
    custom_headers: HashMap<String, String>,
    session_id: Mutex<Option<String>>,
    next_id: AtomicU64,
    /// 最近一次请求是否失败（远端重启 / Session-Id 过期），用于触发会话重建
    failed: AtomicBool,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub tools: Vec<McpToolInfo>,
}

impl HttpMcpSession {
    pub async fn connect(
        url: &str,
        headers: &HashMap<String, String>,
    ) -> Result<Self, String> {
        let trimmed_url = url.trim();
        if trimmed_url.is_empty() {
            return Err("未配置远程端点 URL".to_string());
        }
        if !trimmed_url.starts_with("http://") && !trimmed_url.starts_with("https://") {
            return Err("远程 URL 必须以 http:// 或 https:// 开头".to_string());
        }

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| format!("初始化 HTTP 客户端失败: {}", e))?;

        let mut session = Self {
            client,
            endpoint_url: trimmed_url.to_string(),
            custom_headers: headers.clone(),
            session_id: Mutex::new(None),
            next_id: AtomicU64::new(1),
            failed: AtomicBool::new(false),
            server_name: None,
            server_version: None,
            tools: Vec::new(),
        };

        // 1. initialize 握手
        let init_res = session
            .send_request(
                "initialize",
                json!({
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "Qshell-AIOps-Client",
                        "version": "1.0.20"
                    }
                }),
            )
            .await?;

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

        // 2. notifications/initialized
        let _ = session
            .send_notification("notifications/initialized", json!({}))
            .await;

        // 3. tools/list
        let tools_res = session.send_request("tools/list", json!({})).await?;
        session.tools = parse_tools_list(&tools_res);

        Ok(session)
    }

    pub async fn refresh_tools(&self) -> Result<Vec<McpToolInfo>, String> {
        let res = self.send_request("tools/list", json!({})).await?;
        Ok(parse_tools_list(&res))
    }

    pub async fn call_tool(
        &self,
        tool_name: &str,
        arguments: Value,
    ) -> Result<(bool, String), String> {
        let res = self
            .send_request(
                "tools/call",
                json!({
                    "name": tool_name,
                    "arguments": arguments
                }),
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

    async fn build_headers(&self) -> HeaderMap {
        let mut map = HeaderMap::new();
        map.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        map.insert(
            ACCEPT,
            HeaderValue::from_static("application/json, text/event-stream"),
        );

        if let Some(sid) = self.session_id.lock().await.as_ref() {
            if let Ok(val) = HeaderValue::from_str(sid) {
                map.insert("Mcp-Session-Id", val);
            }
        }

        for (k, v) in &self.custom_headers {
            if v.trim().is_empty() {
                continue;
            }
            if let (Ok(name), Ok(val)) = (
                HeaderName::from_bytes(k.trim().as_bytes()),
                HeaderValue::from_str(v.trim()),
            ) {
                map.insert(name, val);
            }
        }
        map
    }

    async fn send_notification(&self, method: &str, params: Value) -> Result<(), String> {
        let payload = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });
        let headers = self.build_headers().await;
        let _ = self
            .client
            .post(&self.endpoint_url)
            .headers(headers)
            .json(&payload)
            .send()
            .await;
        Ok(())
    }

    /// 最近一次请求失败即视为会话不健康，由管理器重建连接
    pub fn is_alive(&self) -> bool {
        !self.failed.load(Ordering::SeqCst)
    }

    async fn send_request(&self, method: &str, params: Value) -> Result<Value, String> {
        let result = self.send_request_inner(method, params).await;
        self.failed.store(result.is_err(), Ordering::SeqCst);
        result
    }

    async fn send_request_inner(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let payload = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });
        let headers = self.build_headers().await;

        let resp = self
            .client
            .post(&self.endpoint_url)
            .headers(headers)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("HTTP 请求 `{}` 失败: {}", method, e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_text = resp.text().await.unwrap_or_default();
            return Err(format!("远程 MCP 端点返回 HTTP {}: {}", status, err_text));
        }

        // 记录 Mcp-Session-Id
        if let Some(sid) = resp
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
        {
            *self.session_id.lock().await = Some(sid.to_string());
        }

        let body_text = resp
            .text()
            .await
            .map_err(|e| format!("读取响应体失败: {}", e))?;

        let msg = parse_json_or_sse(&body_text)?;
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
}

/// 兼容纯 JSON 响应与 `text/event-stream` (SSE `data: {...}`) 响应
pub fn parse_json_or_sse(raw: &str) -> Result<Value, String> {
    let trimmed = raw.trim();
    if trimmed.starts_with('{') {
        return serde_json::from_str::<Value>(trimmed)
            .map_err(|e| format!("解析 JSON 响应失败: {}", e));
    }

    for line in trimmed.lines().rev() {
        let l = line.trim();
        if let Some(data_str) = l.strip_prefix("data:") {
            let json_candidate = data_str.trim();
            if json_candidate.starts_with('{') {
                if let Ok(val) = serde_json::from_str::<Value>(json_candidate) {
                    if val.get("result").is_some() || val.get("error").is_some() {
                        return Ok(val);
                    }
                }
            }
        }
    }

    Err("未能从响应中解析出有效的 JSON-RPC 消息".to_string())
}
