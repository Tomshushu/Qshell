//! ESXi / vCenter HTTPS 设备管理（Phase 2-B-2）
//!
//! 复用 `https_device` 的共享客户端、TLS 开关与错误链展开，只依赖 vSphere
//! Automation REST 端点，不引入 vim SOAP SDK：
//! - `GET /api`：vCenter / ESXi 7+ 的 API 元数据端点（Basic Auth）；
//! - `GET /rest/vcenter/host`：6.5+ 的主机列表，作为旧版本回退。
//!
//! 设计约束（与 BMC 样板一致）：
//! - 严格证书校验是默认值，只有用户显式开启时才放宽；
//! - 任何失败都返回可读错误，不猜测成功；
//! - 只读、不缓存 token、不写审计日志。

use serde::{Deserialize, Serialize};

use crate::commands::{validate_server_id, OperationResult};
use crate::https_device;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EsxiTestConfig {
    /// 编辑场景下用于沿用未重新输入的已保存密码。
    pub id: Option<String>,
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub password: Option<String>,
    pub connection_timeout: Option<u32>,
    #[serde(default)]
    pub tls_allow_invalid_certs: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EsxiOverview {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub product_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub web_url: Option<String>,
}

impl EsxiOverview {
    fn fail(err: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(err.into()),
            product_name: None,
            api_version: None,
            host_name: None,
            version: None,
            host_count: None,
            web_url: None,
        }
    }
}

struct EsxiCtx {
    base_url: String,
    username: String,
    password: String,
    timeout_secs: u64,
    allow_invalid_certs: bool,
}

/// 构造基础 URL；IPv6 裸地址补方括号，避免把地址段当成端口分隔符。
fn base_url(host: &str, port: u16) -> String {
    let trimmed = host.trim();
    let formatted = if trimmed.contains(':') && !trimmed.starts_with('[') {
        format!("[{}]", trimmed)
    } else {
        trimmed.to_string()
    };
    format!("https://{}:{}", formatted, port)
}

fn pick_str(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(text) = value.get(key).and_then(|v| v.as_str()) {
            if !text.trim().is_empty() {
                return Some(text.to_string());
            }
        }
    }
    None
}

/// 把不同版本 vSphere 的响应归一化成同一份概览。
/// 2xx 但非 JSON 仍算「连通」，只是没有结构化字段可展示。
fn parse_overview(body: &str, base: &str) -> EsxiOverview {
    let mut out = EsxiOverview {
        success: true,
        error: None,
        product_name: None,
        api_version: None,
        host_name: None,
        version: None,
        host_count: None,
        web_url: Some(base.to_string()),
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return out;
    };
    out.product_name = pick_str(&value, &["productName", "product_name", "name"]);
    out.api_version = pick_str(&value, &["apiVersion", "api_version"]);
    out.version = pick_str(&value, &["version", "fullName"]);
    out.host_name = pick_str(&value, &["hostName", "hostname"]);
    if let Some(items) = value.get("value").and_then(|v| v.as_array()) {
        out.host_count = Some(items.len());
        if out.host_name.is_none() {
            out.host_name = items
                .first()
                .and_then(|item| item.get("name"))
                .and_then(|v| v.as_str())
                .map(str::to_string);
        }
    }
    out
}

async fn fetch(ctx: &EsxiCtx, path: &str) -> Result<String, String> {
    let client = https_device::client(ctx.timeout_secs, ctx.allow_invalid_certs)?;
    let url = format!("{}{}", ctx.base_url, path);
    let response = client
        .get(&url)
        .basic_auth(&ctx.username, Some(&ctx.password))
        .send()
        .await
        .map_err(|error| {
            format!(
                "ESXi 连接失败 ({})：{}",
                url,
                https_device::error_detail(&error)
            )
        })?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => format!(
                "ESXi 认证失败 ({})：请检查用户名 / 密码 ({})",
                status.as_u16(),
                path
            ),
            404 => format!("ESXi 不支持该端点 (404)：{}", path),
            code => format!(
                "ESXi 请求失败 ({})：{}",
                code,
                body.chars().take(200).collect::<String>()
            ),
        });
    }
    if body.trim().is_empty() {
        return Err(format!("ESXi 端点响应为空：{}", path));
    }
    Ok(body)
}

/// 先试 7+ 的 `/api`，再回退 6.5+ 的 `/rest/vcenter/host`。
async fn probe(ctx: &EsxiCtx) -> Result<EsxiOverview, String> {
    match fetch(ctx, "/api").await {
        Ok(body) => Ok(parse_overview(&body, &ctx.base_url)),
        Err(first) => match fetch(ctx, "/rest/vcenter/host").await {
            Ok(body) => Ok(parse_overview(&body, &ctx.base_url)),
            Err(second) => Err(format!("{}；回退端点同样失败：{}", first, second)),
        },
    }
}

/// 测试尚未保存 / 正在编辑的 ESXi 配置，真实发起 HTTPS 请求并验证认证。
#[tauri::command]
pub async fn esxi_test_connect_with_config(
    config: EsxiTestConfig,
) -> Result<OperationResult, String> {
    let host = config.host.trim();
    let username = config.username.trim();
    if host.is_empty() {
        return Ok(OperationResult::fail("ESXi 主机地址不能为空"));
    }
    if username.is_empty() {
        return Ok(OperationResult::fail("ESXi 用户名不能为空"));
    }

    let mut password = config.password.filter(|value| !value.is_empty());
    if password.is_none() {
        if let Some(server_id) = config.id.as_deref().filter(|value| !value.is_empty()) {
            match crate::commands::ssh::load_server_config(server_id).await {
                Ok(server) => password = server.password.filter(|value| !value.is_empty()),
                Err(error) => return Ok(OperationResult::fail(error)),
            }
        }
    }
    let Some(password) = password else {
        return Ok(OperationResult::fail("请输入 ESXi 密码后再测试连接"));
    };

    let ctx = EsxiCtx {
        base_url: base_url(host, config.port.unwrap_or(443)),
        username: username.to_string(),
        password,
        timeout_secs: config.connection_timeout.unwrap_or(15).max(5) as u64,
        allow_invalid_certs: config.tls_allow_invalid_certs.unwrap_or(false),
    };
    Ok(match probe(&ctx).await {
        // 概览面板允许「2xx 但无结构化字段」（兼容老版本 vSphere），
        // 但测试连接必须确认拿到可识别的 vSphere 响应，避免登录页/代理页被误报成功。
        Ok(overview)
            if overview.product_name.is_none()
                && overview.api_version.is_none()
                && overview.host_name.is_none()
                && overview.version.is_none()
                && overview.host_count.is_none() =>
        {
            OperationResult::fail(
                "ESXi 端点返回的不是可识别的 vSphere 响应，请检查主机地址与端口",
            )
        }
        Ok(_) => OperationResult::ok_with_message("ESXi HTTPS 连接和认证成功"),
        Err(error) => OperationResult::fail(error),
    })
}

/// 工作台概览：从已保存的服务器读取凭据，返回归一化后的主机信息。
#[tauri::command]
pub async fn esxi_get_overview(server_id: String) -> Result<EsxiOverview, String> {
    if let Err(error) = validate_server_id(&server_id) {
        return Ok(EsxiOverview::fail(error));
    }
    let server = match crate::commands::ssh::load_server_config(&server_id).await {
        Ok(server) => server,
        Err(error) => return Ok(EsxiOverview::fail(error)),
    };
    if server.target_type != "esxi" {
        return Ok(EsxiOverview::fail("该服务器不是 ESXi / vCenter 类型"));
    }
    let port = u16::try_from(server.port)
        .ok()
        .filter(|value| *value > 0)
        .unwrap_or(443);
    let allow_invalid_certs = server.allow_invalid_tls_certs();
    let ctx = EsxiCtx {
        base_url: base_url(&server.host, port),
        username: server.username,
        password: server.password.unwrap_or_default(),
        timeout_secs: server.connection_timeout.max(5) as u64,
        allow_invalid_certs,
    };
    Ok(match probe(&ctx).await {
        Ok(overview) => overview,
        Err(error) => EsxiOverview::fail(error),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_url_handles_ipv4_ipv6_and_hostnames() {
        assert_eq!(base_url("10.0.0.1", 443), "https://10.0.0.1:443");
        assert_eq!(base_url(" esxi.local ", 9443), "https://esxi.local:9443");
        assert_eq!(base_url("fe80::1", 443), "https://[fe80::1]:443");
        assert_eq!(base_url("[fe80::1]", 443), "https://[fe80::1]:443");
    }

    #[test]
    fn parse_overview_handles_api_metadata_shape() {
        let body = r#"{"apiVersion":"8.0.0.0","productName":"VMware vCenter Server","version":"8.0.2"}"#;
        let overview = parse_overview(body, "https://vc.local:443");
        assert!(overview.success);
        assert_eq!(overview.api_version.as_deref(), Some("8.0.0.0"));
        assert_eq!(overview.product_name.as_deref(), Some("VMware vCenter Server"));
        assert_eq!(overview.version.as_deref(), Some("8.0.2"));
        assert_eq!(overview.web_url.as_deref(), Some("https://vc.local:443"));
        assert!(overview.host_count.is_none());
    }

    #[test]
    fn parse_overview_handles_legacy_host_list_shape() {
        let body = r#"{"value":[{"host":"host-1","name":"esxi-a.local"},{"host":"host-2","name":"esxi-b.local"}]}"#;
        let overview = parse_overview(body, "https://vc.local:443");
        assert!(overview.success);
        assert_eq!(overview.host_count, Some(2));
        assert_eq!(overview.host_name.as_deref(), Some("esxi-a.local"));
    }

    #[test]
    fn non_json_success_still_counts_as_reachable() {
        let overview = parse_overview("<html>ok</html>", "https://esxi.local:443");
        assert!(overview.success);
        assert!(overview.error.is_none());
        assert!(overview.api_version.is_none());
    }

    #[test]
    fn failed_overview_never_exposes_web_url() {
        let overview = EsxiOverview::fail("认证失败");
        assert!(!overview.success);
        assert_eq!(overview.error.as_deref(), Some("认证失败"));
        assert!(overview.web_url.is_none());
    }
}
