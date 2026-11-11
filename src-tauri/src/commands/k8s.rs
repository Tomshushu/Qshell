//! Kubernetes 集群 HTTPS 管理（Phase 2-C）
//!
//! 最小可用形态：**API Server URL + Bearer Token + TLS 开关**。
//! 暂不解析 kubeconfig 文件（client certificate / context / cluster CA 等），
//! 已登记在 `docs/DEVICE_TYPE_EXTENSION_RISKS.md`。
//!
//! 复用 `https_device` 的共享客户端与错误链展开；只读、不缓存 token、不写审计日志。
//! Token 沿用服务器记录里已加密的 `password` 通道，避免新增明文列。

use serde::{Deserialize, Serialize};

use crate::commands::{validate_server_id, OperationResult};
use crate::https_device;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct K8sTestConfig {
    /// 编辑场景下用于沿用未重新输入的已保存 Token。
    pub id: Option<String>,
    pub host: String,
    pub port: Option<u16>,
    /// Bearer Token；前端可用 `token` 或 `password` 两种键名传入。
    #[serde(alias = "token")]
    pub password: Option<String>,
    pub connection_timeout: Option<u32>,
    #[serde(default)]
    pub tls_allow_invalid_certs: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct K8sOverview {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ready_node_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub namespace_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_url: Option<String>,
}

impl K8sOverview {
    fn fail(err: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(err.into()),
            git_version: None,
            platform: None,
            node_count: None,
            ready_node_count: None,
            namespace_count: None,
            api_url: None,
        }
    }
}

struct K8sCtx {
    base_url: String,
    token: String,
    timeout_secs: u64,
    allow_invalid_certs: bool,
}

fn base_url(host: &str, port: u16) -> String {
    let trimmed = host.trim().trim_end_matches('/');
    let formatted = if trimmed.contains(':') && !trimmed.starts_with('[') {
        format!("[{}]", trimmed)
    } else {
        trimmed.to_string()
    };
    format!("https://{}:{}", formatted, port)
}

async fn fetch(ctx: &K8sCtx, path: &str) -> Result<String, String> {
    let client = https_device::client(ctx.timeout_secs, ctx.allow_invalid_certs)?;
    let url = format!("{}{}", ctx.base_url, path);
    let response = client
        .get(&url)
        .bearer_auth(&ctx.token)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| {
            format!(
                "K8s API 连接失败 ({})：{}",
                url,
                https_device::error_detail(&error)
            )
        })?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => format!(
                "K8s 认证 / 鉴权失败 ({})：请检查 Bearer Token 与 RBAC 权限 ({})",
                status.as_u16(),
                path
            ),
            404 => format!("K8s API 端点不存在 (404)：{}", path),
            code => format!(
                "K8s 请求失败 ({})：{}",
                code,
                body.chars().take(200).collect::<String>()
            ),
        });
    }
    Ok(body)
}

/// 校验响应确为 K8s `/version` JSON，避免反向代理欢迎页 / 登录页被判为连通。
fn k8s_version_from(body: &str) -> Option<String> {
    let value = serde_json::from_str::<serde_json::Value>(body).ok()?;
    value
        .get("gitVersion")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

fn parse_version(body: &str, out: &mut K8sOverview) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return;
    };
    out.git_version = value
        .get("gitVersion")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    out.platform = value
        .get("platform")
        .and_then(|v| v.as_str())
        .map(str::to_string);
}

/// 从 NodeList 的 items[].status.conditions 统计 Ready 节点。
fn parse_nodes(body: &str, out: &mut K8sOverview) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return;
    };
    let Some(items) = value.get("items").and_then(|v| v.as_array()) else {
        return;
    };
    out.node_count = Some(items.len());
    let ready = items
        .iter()
        .filter(|item| {
            item.get("status")
                .and_then(|s| s.get("conditions"))
                .and_then(|c| c.as_array())
                .is_some_and(|conditions| {
                    conditions.iter().any(|condition| {
                        condition.get("type").and_then(|v| v.as_str()) == Some("Ready")
                            && condition.get("status").and_then(|v| v.as_str()) == Some("True")
                    })
                })
        })
        .count();
    out.ready_node_count = Some(ready);
}

fn parse_namespaces(body: &str, out: &mut K8sOverview) {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return;
    };
    if let Some(items) = value.get("items").and_then(|v| v.as_array()) {
        out.namespace_count = Some(items.len());
    }
}

/// 测试未保存 / 正在编辑的集群配置，真实调用 `/version` 验证 Token。
#[tauri::command]
pub async fn k8s_test_connect_with_config(
    config: K8sTestConfig,
) -> Result<OperationResult, String> {
    let host = config.host.trim();
    if host.is_empty() {
        return Ok(OperationResult::fail("K8s API Server 地址不能为空"));
    }
    let mut token = config.password.filter(|value| !value.is_empty());
    if token.is_none() {
        if let Some(server_id) = config.id.as_deref().filter(|value| !value.is_empty()) {
            match crate::commands::ssh::load_server_config(server_id).await {
                Ok(server) => token = server.password.filter(|value| !value.is_empty()),
                Err(error) => return Ok(OperationResult::fail(error)),
            }
        }
    }
    let Some(token) = token else {
        return Ok(OperationResult::fail("请输入 Bearer Token 后再测试连接"));
    };

    let ctx = K8sCtx {
        base_url: base_url(host, config.port.unwrap_or(6443)),
        token,
        timeout_secs: config.connection_timeout.unwrap_or(15).max(5) as u64,
        allow_invalid_certs: config.tls_allow_invalid_certs.unwrap_or(false),
    };
    Ok(match fetch(&ctx, "/version").await {
        Ok(body) => match k8s_version_from(&body) {
            Some(version) => {
                OperationResult::ok_with_message(format!("K8s API 连接成功（{}）", version))
            }
            None => OperationResult::fail(
                "K8s API 响应不是有效的 /version JSON，请检查端点是否为 K8s API Server",
            ),
        },
        Err(error) => OperationResult::fail(error),
    })
}

/// 工作台概览：版本 + 节点 / Ready 节点 + 命名空间数。
/// 辅助端点失败只让对应字段留空，不影响主端点成功结论。
#[tauri::command]
pub async fn k8s_get_overview(server_id: String) -> Result<K8sOverview, String> {
    if let Err(error) = validate_server_id(&server_id) {
        return Ok(K8sOverview::fail(error));
    }
    let server = match crate::commands::ssh::load_server_config(&server_id).await {
        Ok(server) => server,
        Err(error) => return Ok(K8sOverview::fail(error)),
    };
    if server.target_type != "kubernetes" {
        return Ok(K8sOverview::fail("该服务器不是 Kubernetes 集群类型"));
    }
    let port = u16::try_from(server.port)
        .ok()
        .filter(|value| *value > 0)
        .unwrap_or(6443);
    let allow_invalid_certs = server.allow_invalid_tls_certs();
    let base = base_url(&server.host, port);
    let ctx = K8sCtx {
        base_url: base.clone(),
        token: server.password.unwrap_or_default(),
        timeout_secs: server.connection_timeout.max(5) as u64,
        allow_invalid_certs,
    };

    let version_body = match fetch(&ctx, "/version").await {
        Ok(body) => body,
        Err(error) => return Ok(K8sOverview::fail(error)),
    };
    let version = match k8s_version_from(&version_body) {
        Some(v) => v,
        None => {
            return Ok(K8sOverview::fail(
                "K8s API 响应不是有效的 /version JSON，请检查端点是否为 K8s API Server",
            ))
        }
    };
    let mut overview = K8sOverview {
        success: true,
        error: None,
        git_version: None,
        platform: None,
        node_count: None,
        ready_node_count: None,
        namespace_count: None,
        api_url: Some(base),
    };
    parse_version(&version_body, &mut overview);
    overview.git_version = Some(version);
    if let Ok(body) = fetch(&ctx, "/api/v1/nodes").await {
        parse_nodes(&body, &mut overview);
    }
    if let Ok(body) = fetch(&ctx, "/api/v1/namespaces").await {
        parse_namespaces(&body, &mut overview);
    }
    Ok(overview)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_url_handles_ipv4_ipv6_and_trailing_slash() {
        assert_eq!(base_url("10.0.0.1", 6443), "https://10.0.0.1:6443");
        assert_eq!(base_url(" k8s.local/ ", 6443), "https://k8s.local:6443");
        assert_eq!(base_url("fd00::1", 6443), "https://[fd00::1]:6443");
    }

    fn blank(base: &str) -> K8sOverview {
        K8sOverview {
            success: true,
            error: None,
            git_version: None,
            platform: None,
            node_count: None,
            ready_node_count: None,
            namespace_count: None,
            api_url: Some(base.to_string()),
        }
    }

    #[test]
    fn parses_version_payload() {
        let mut out = blank("https://k8s.local:6443");
        parse_version(r#"{"gitVersion":"v1.28.2","platform":"linux/amd64"}"#, &mut out);
        assert_eq!(out.git_version.as_deref(), Some("v1.28.2"));
        assert_eq!(out.platform.as_deref(), Some("linux/amd64"));
    }

    #[test]
    fn counts_ready_nodes_from_conditions() {
        let body = r#"{"items":[
            {"status":{"conditions":[{"type":"Ready","status":"True"}]}},
            {"status":{"conditions":[{"type":"Ready","status":"False"}]}},
            {"status":{"conditions":[]}}
        ]}"#;
        let mut out = blank("https://k8s.local:6443");
        parse_nodes(body, &mut out);
        assert_eq!(out.node_count, Some(3));
        assert_eq!(out.ready_node_count, Some(1));
    }

    #[test]
    fn non_json_payload_leaves_fields_empty() {
        let mut out = blank("https://k8s.local:6443");
        parse_version("<html/>", &mut out);
        parse_nodes("<html/>", &mut out);
        assert!(out.success);
        assert!(out.git_version.is_none());
        assert!(out.node_count.is_none());
    }

    #[test]
    fn failed_overview_never_exposes_api_url() {
        let out = K8sOverview::fail("Token 无效");
        assert!(!out.success);
        assert_eq!(out.error.as_deref(), Some("Token 无效"));
        assert!(out.api_url.is_none());
    }
}
