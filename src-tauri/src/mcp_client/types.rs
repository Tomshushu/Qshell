// src-tauri/src/mcp_client/types.rs
//
// Qshell 原生 MCP Client 数据模型与协议契约
// 供 Qshell 内置 AI 运维助手动态挂载第三方 MCP 插件（Kubernetes / Prometheus / Redis / PostgreSQL 等）

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// MCP 插件配置（持久化于 app_data_dir/mcp_plugins.json，敏感凭据经 AES-256-GCM 加密）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPluginConfig {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default = "default_icon")]
    pub icon: String,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default)]
    pub enabled: bool,
    /// 传输方式："stdio" | "http"
    #[serde(default = "default_transport")]
    pub transport: String,
    /// stdio 模式启动命令（如 "npx", "uvx", "node", "python"）
    #[serde(default)]
    pub command: Option<String>,
    /// stdio 模式启动参数
    #[serde(default)]
    pub args: Vec<String>,
    /// http / sse 模式远程端点 URL
    #[serde(default)]
    pub url: Option<String>,
    /// 环境变量（落盘时使用 AES-256-GCM 密文 v1:nonce:cipher，加载进内存后按需解密）
    #[serde(default)]
    pub env: HashMap<String, String>,
    /// 自定义 HTTP 请求头（落盘时使用 AES-256-GCM 密文）
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// 被用户手动禁用的工具名称列表（工具级白名单/黑名单控制）
    #[serde(default)]
    pub disabled_tools: Vec<String>,
    /// 最近一次握手发现的工具清单缓存
    #[serde(default)]
    pub discovered_tools: Vec<McpToolInfo>,
    /// 是否源自内置精选预设模板
    #[serde(default)]
    pub is_preset: bool,
    #[serde(default)]
    pub preset_id: Option<String>,
    #[serde(default)]
    pub last_connected_at: Option<i64>,
    #[serde(default)]
    pub last_error: Option<String>,
}

fn default_icon() -> String {
    "custom".to_string()
}

fn default_category() -> String {
    "custom".to_string()
}

fn default_transport() -> String {
    "stdio".to_string()
}

/// 单个 MCP 工具的元信息与 Schema
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolInfo {
    pub name: String,
    pub description: String,
    #[serde(default = "default_input_schema")]
    pub input_schema: Value,
    /// 是否为只读安全工具（由 annotations.readOnlyHint 或名称启发式推断；缺字段按「可能写」处理）
    #[serde(default = "default_false")]
    pub is_read_only: bool,
}

fn default_input_schema() -> Value {
    serde_json::json!({
        "type": "object",
        "properties": {}
    })
}

fn default_false() -> bool {
    false
}

/// 供前端展示的插件完整状态视图
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPluginView {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub category: String,
    pub enabled: bool,
    pub connected: bool,
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub url: Option<String>,
    /// 返回给前端的环境变量（仅键名 + 占位符，真实凭据不出 Rust 侧）
    pub env: HashMap<String, String>,
    pub headers: HashMap<String, String>,
    pub disabled_tools: Vec<String>,
    pub discovered_tools: Vec<McpToolInfo>,
    pub is_preset: bool,
    pub preset_id: Option<String>,
    pub last_connected_at: Option<i64>,
    pub last_error: Option<String>,
}

/// 供 ReAct 循环动态注入的已激活外部工具项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveMcpTool {
    pub plugin_id: String,
    pub plugin_name: String,
    pub plugin_icon: String,
    /// 归一化后的全局唯一函数名：`mcp__<sanitized_plugin_id>__<tool_name>`
    pub qualified_name: String,
    pub tool_name: String,
    pub description: String,
    pub input_schema: Value,
    pub is_read_only: bool,
    /// 插件传输方式（由后端权威下发，前端据此判定是否允许走 SSH-Native 直连分支）
    pub transport: String,
}

/// 第三方 MCP 工具调用返回结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolCallResult {
    pub plugin_id: String,
    pub plugin_name: String,
    pub tool_name: String,
    pub is_error: bool,
    pub text: String,
    pub duration_ms: u64,
}

/// 连通性测试结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpTestConnectionResult {
    pub success: bool,
    pub server_name: Option<String>,
    pub server_version: Option<String>,
    pub tools: Vec<McpToolInfo>,
    pub latency_ms: u64,
    pub error: Option<String>,
}

/// 内置精选运维插件模板定义
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPresetTemplate {
    pub preset_id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub category: String,
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub url: Option<String>,
    pub env_fields: Vec<McpPresetEnvField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPresetEnvField {
    pub key: String,
    pub label: String,
    pub placeholder: String,
    pub description: String,
    pub required: bool,
    pub secret: bool,
}

/// 根据工具名称与 MCP annotations 推断是否为只读工具
pub fn infer_tool_read_only(tool_name: &str, raw_tool: &Value) -> bool {
    if let Some(ro) = raw_tool
        .get("annotations")
        .and_then(|a| a.get("readOnlyHint"))
        .and_then(|v| v.as_bool())
    {
        return ro;
    }

    let lower = tool_name.to_lowercase();

    // 1. 明确的只读动词前缀优先判定为安全
    let read_prefixes = [
        "get_", "list_", "read_", "show_", "describe_", "inspect_", "fetch_", "query_",
        "check_", "status_", "ping_", "search_", "find_", "count_", "view_", "scan_",
        "head_", "tail_", "stat_", "health_",
    ];
    for prefix in &read_prefixes {
        if lower.starts_with(prefix) {
            return true;
        }
    }

    // 2. 明确的写操作前缀判定为危险
    let write_prefixes = [
        "create_", "delete_", "remove_", "update_", "patch_", "set_", "put_", "post_",
        "drop_", "kill_", "restart_", "stop_", "start_", "scale_", "apply_", "exec_",
        "write_", "insert_", "alter_", "truncate_", "flush_", "del_", "rename_",
    ];
    for prefix in &write_prefixes {
        if lower.starts_with(prefix) || lower.contains(&format!("_{}", prefix.trim_end_matches('_'))) {
            return false;
        }
    }

    // 3. 无法判定时按「可能包含状态变更」处理，避免把未知第三方工具当作只读直接放行
    false
}

/// 将任意插件 ID 清洗为仅包含字母、数字与下划线的安全标识符
pub fn sanitize_identifier(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            out.push(if ch == '-' { '_' } else { ch });
        }
    }
    if out.is_empty() {
        "plugin".to_string()
    } else {
        out
    }
}

/// 组装全局唯一工具函数名（严格符合 OpenAI/Claude/Qwen `^[a-zA-Z0-9_-]{1,64}$` 限制）
/// 超长名称不能直接截断，否则不同插件/工具会生成同名函数并静默互相覆盖；
/// 使用稳定的 FNV-1a 摘要作后缀，保证跨重启一致且碰撞概率极低。
pub fn build_qualified_tool_name(plugin_id: &str, tool_name: &str) -> String {
    let p = sanitize_identifier(plugin_id);
    let t = sanitize_identifier(tool_name);
    let combined = format!("mcp__{}__{}", p, t);
    if combined.len() <= 64 {
        return combined;
    }

    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in combined.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    let suffix = format!("{:08x}", hash);
    let keep = 64 - suffix.len() - 1;
    // combined 只含 ASCII，按字节切分不会破坏 UTF-8 边界
    format!("{}_{}", &combined[..keep], suffix)
}
