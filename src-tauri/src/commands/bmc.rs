// BMC 带外管理 commands（Redfish API）
//
// Redfish 是 DMTF 标准的服务器带外管理 RESTful API，
// Dell iDRAC / HPE iLO / Lenovo XCC / 华为 iBMC / 浪潮 / 超聚变等主流服务器均支持。
//
// 功能：
//   bmc_get_overview     聚合系统信息 + 电源状态 + BMC 管理器信息
//   bmc_power_action     电源操作（开机/强制关机/优雅关机/强制重启/优雅重启/电源循环/NMI）
//   bmc_get_sensors      传感器（温度/风扇/电压/电源）
//   bmc_get_logs         硬件事件日志（SEL）
//   bmc_set_identify_led 机箱定位指示灯开关
//   bmc_get_web_url      返回 BMC Web 管理界面（KVM 控制台）地址
//
// 认证：HTTP Basic（所有 Redfish BMC 通用）
// 证书：默认严格校验；用户可对单台可信 BMC 显式启用自签名证书兼容模式。
//
// 实现说明：
// - 不同厂商 Redfish 字段差异较大，统一用 serde_json::Value 宽松解析，
//   缺失字段返回 None / 空列表而非报错
// - 资源导航：/redfish/v1/Systems → Members[0]（同样方式取 Chassis / Managers）
// - 电源操作优先使用系统资源 Actions 中声明的 target，缺失时回退标准路径

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{validate_server_id, OperationResult};

// ============================================================================
// 数据结构（与前端 types.ts 中 BmcXxx 接口对应，camelCase 序列化）
// ============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcOverview {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    // 服务器系统信息（ComputerSystem）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bios_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_name: Option<String>,
    /// On / Off / PoweringOn / PoweringOff / Unknown
    #[serde(skip_serializing_if = "Option::is_none")]
    pub power_state: Option<String>,
    /// OK / Warning / Critical（系统健康状态）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_memory_gb: Option<f64>,
    /// 机箱定位指示灯：Lit / Off / Blinking / Unknown
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indicator_led: Option<String>,
    /// 下次开机启动项：BiosSetup / Pxe / Cd / Hdd / UefiTarget / None / Unknown
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boot_source_target: Option<String>,
    /// 启动项启用模式：Once / Continuous / Disabled
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boot_source_enabled: Option<String>,
    // BMC 管理器信息（Manager）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bmc_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bmc_firmware: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bmc_ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bmc_mac: Option<String>,
    /// BMC Web 管理界面（KVM 控制台）地址
    #[serde(skip_serializing_if = "Option::is_none")]
    pub web_url: Option<String>,
}

impl BmcOverview {
    fn fail(err: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(err.into()),
            manufacturer: None,
            model: None,
            serial_number: None,
            part_number: None,
            asset_tag: None,
            bios_version: None,
            host_name: None,
            power_state: None,
            health_status: None,
            cpu_model: None,
            cpu_count: None,
            total_memory_gb: None,
            indicator_led: None,
            boot_source_target: None,
            boot_source_enabled: None,
            bmc_model: None,
            bmc_firmware: None,
            bmc_ip: None,
            bmc_mac: None,
            web_url: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcSensor {
    pub name: String,
    pub reading: f64,
    /// °C / RPM / % / W / V / A
    pub unit: String,
    /// ok / warning / critical / absent / unknown
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lower_threshold: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upper_threshold: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_reading: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_reading: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcPsu {
    pub name: String,
    /// ok / warning / critical / absent / unknown
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub part_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub power_watts: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_voltage: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capacity_watts: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcSensorResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub temperatures: Vec<BmcSensor>,
    pub fans: Vec<BmcSensor>,
    pub voltages: Vec<BmcSensor>,
    pub power_supplies: Vec<BmcPsu>,
    /// 当前整机功耗（W），来自 PowerControl[0].PowerConsumedWatts
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_power_watts: Option<f64>,
}

impl BmcSensorResult {
    fn fail(err: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(err.into()),
            temperatures: Vec::new(),
            fans: Vec::new(),
            voltages: Vec::new(),
            power_supplies: Vec::new(),
            total_power_watts: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcSelEntry {
    pub id: String,
    /// ISO 8601 时间字符串
    pub created: String,
    /// Critical / Warning / OK / Info
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcLogResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub entries: Vec<BmcSelEntry>,
}

impl BmcLogResult {
    fn fail(err: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(err.into()),
            entries: Vec::new(),
        }
    }
}

// ============================================================================
// Redfish 客户端辅助
// ============================================================================

/// Redfish 会话上下文：基础 URL + 认证 + 超时
struct RedfishCtx {
    /// 服务器 ID（会话缓存 key）
    server_id: String,
    base_url: String,
    username: String,
    password: String,
    timeout_secs: u64,
    allow_invalid_certs: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BmcTestConfig {
    /// 编辑场景下用于读取未重新输入的原密码。
    pub id: Option<String>,
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub password: Option<String>,
    pub connection_timeout: Option<u32>,
    #[serde(default)]
    pub bmc_allow_invalid_certs: Option<bool>,
}

fn redfish_base_url(host: &str, port: u16) -> String {
    let trimmed = host.trim();
    let formatted_host = if trimmed.contains(':') && !trimmed.starts_with('[') {
        format!("[{}]", trimmed)
    } else {
        trimmed.to_string()
    };
    format!("https://{}:{}", formatted_host, port)
}

/// 加载服务器配置并构造 Redfish 上下文
async fn load_ctx(server_id: &str) -> Result<RedfishCtx, String> {
    let server = crate::commands::ssh::load_server_config(server_id).await?;
    if server.target_type != "bmc" {
        return Err("该服务器不是 BMC 带外管理类型".to_string());
    }
    let port = u16::try_from(server.bmc_port)
        .ok()
        .filter(|value| *value > 0)
        .unwrap_or(443);
    Ok(RedfishCtx {
        server_id: server_id.to_string(),
        base_url: redfish_base_url(&server.host, port),
        username: server.username,
        password: server.password.unwrap_or_default(),
        timeout_secs: server.connection_timeout.max(5) as u64,
        allow_invalid_certs: server.bmc_allow_invalid_certs,
    })
}

/// 构造 reqwest 客户端；严格校验是默认值，自签名兼容必须显式开启。
fn build_client(timeout_secs: u64, allow_invalid_certs: bool) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .connect_timeout(std::time::Duration::from_secs(timeout_secs))
        .danger_accept_invalid_certs(allow_invalid_certs)
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {}", e))
}

// ---------------------------------------------------------------------------
// 连接复用：按超时缓存 client。reqwest Client 内置连接池（同 host 复用 TCP+TLS），
// 旧实现每个请求新建 client = 每请求一次 TLS 握手，老 BMC 握手 1-3s 时轮询性能极差。
// ---------------------------------------------------------------------------
fn client_cache() -> &'static std::sync::Mutex<std::collections::HashMap<(u64, bool), std::sync::Arc<reqwest::Client>>> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<(u64, bool), std::sync::Arc<reqwest::Client>>>> =
        std::sync::OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// 取（或创建）共享 HTTP 客户端：同一 BMC 的所有请求复用连接池
fn get_client(timeout_secs: u64, allow_invalid_certs: bool) -> Result<std::sync::Arc<reqwest::Client>, String> {
    let mut cache = client_cache().lock().unwrap_or_else(|e| e.into_inner());
    let key = (timeout_secs, allow_invalid_certs);
    if let Some(c) = cache.get(&key) {
        return Ok(std::sync::Arc::clone(c));
    }
    let client = std::sync::Arc::new(build_client(timeout_secs, allow_invalid_certs)?);
    cache.insert(key, std::sync::Arc::clone(&client));
    Ok(client)
}

// ---------------------------------------------------------------------------
// Session Token 认证（Redfish 推荐）：
// 用 Basic Auth 换一次性 X-Auth-Token，后续请求只带 token 不带密码，
// 密码每次刷新只在链路出现 1 次（旧实现每次刷新 6+ 次）。
// BMC 不支持 SessionService 时自动回退 Basic；token 失效（401）自动重建一次。
// ---------------------------------------------------------------------------
#[derive(Clone)]
struct BmcSession {
    token: String,
    session_uri: Option<String>,
    created_at: std::time::Instant,
}

/// 会话缓存条目：有效 token 或「该 BMC 不支持 Session」的回退标记
struct SessionCacheEntry {
    session: Option<BmcSession>,
    basic_only_until: Option<std::time::Instant>,
}

fn session_cache() -> &'static std::sync::Mutex<std::collections::HashMap<String, SessionCacheEntry>> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, SessionCacheEntry>>> =
        std::sync::OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// BMC 会话空闲超时一般 30 分钟，提前 10 分钟主动重建，避免频繁 401
const SESSION_MAX_AGE: std::time::Duration = std::time::Duration::from_secs(20 * 60);
/// 「不支持 Session」标记的有效期，到期后重试（BMC 可能升级/重启后支持了）
const BASIC_ONLY_RETRY: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// 获取（或创建）该服务器的 Redfish 会话；不支持/登录失败返回 None（走 Basic）
async fn ensure_session(ctx: &RedfishCtx, force_new: bool) -> Option<BmcSession> {
    // 1. 缓存快速路径（仅持锁做内存读取）
    if !force_new {
        let cache = session_cache().lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = cache.get(&ctx.server_id) {
            if let Some(s) = &entry.session {
                if s.created_at.elapsed() < SESSION_MAX_AGE {
                    return Some(s.clone());
                }
            } else if let Some(until) = entry.basic_only_until {
                if std::time::Instant::now() < until {
                    return None;
                }
            }
        }
    }

    // 2. 登录（网络操作在锁外；登录请求本身必须用 Basic）
    let client = get_client(ctx.timeout_secs, ctx.allow_invalid_certs).ok()?;
    let login = client
        .post(format!("{}/redfish/v1/SessionService/Sessions", ctx.base_url))
        .basic_auth(&ctx.username, Some(&ctx.password))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "UserName": ctx.username, "Password": ctx.password }))
        .send()
        .await
        .ok()?;
    if !login.status().is_success() {
        // 404/405：不支持 SessionService；401：密码错误（后续 Basic 请求会给出标准错误）
        session_cache()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(ctx.server_id.clone(), SessionCacheEntry {
                session: None,
                basic_only_until: Some(std::time::Instant::now() + BASIC_ONLY_RETRY),
            });
        return None;
    }
    let token = login
        .headers()
        .get("X-Auth-Token")?
        .to_str()
        .ok()?
        .to_string();
    let session_uri = login
        .headers()
        .get("Location")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let sess = BmcSession {
        token,
        session_uri,
        created_at: std::time::Instant::now(),
    };
    session_cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(ctx.server_id.clone(), SessionCacheEntry { session: Some(sess.clone()), basic_only_until: None });
    Some(sess)
}

/// 丢弃会话缓存（token 失效/密码变更时）
fn invalidate_session(server_id: &str) {
    session_cache().lock().unwrap_or_else(|e| e.into_inner()).remove(server_id);
}

/// 结束一次性测试会话，避免用户反复点击“测试连接”耗尽 BMC 的会话槽位。
async fn close_test_session(ctx: &RedfishCtx) {
    let session = session_cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&ctx.server_id)
        .and_then(|entry| entry.session);
    let Some(session) = session else {
        return;
    };
    let Some(uri) = session.session_uri else {
        return;
    };
    let url = if uri.starts_with("http://") || uri.starts_with("https://") {
        uri
    } else if uri.starts_with('/') {
        format!("{}{}", ctx.base_url, uri)
    } else {
        format!("{}/{}", ctx.base_url, uri)
    };
    if let Ok(client) = get_client(ctx.timeout_secs, ctx.allow_invalid_certs) {
        let _ = client
            .delete(url)
            .header("X-Auth-Token", session.token)
            .send()
            .await;
    }
}

/// 统一的带认证请求：优先 X-Auth-Token，无会话回退 Basic；
/// token 收到 401 时丢弃缓存、重建一次并重试（登录失败自动落回 Basic）
async fn send_authorized(
    ctx: &RedfishCtx,
    method: reqwest::Method,
    url: &str,
    body: Option<&Value>,
) -> Result<reqwest::Response, String> {
    let client = get_client(ctx.timeout_secs, ctx.allow_invalid_certs)?;
    let build = |sess: Option<&BmcSession>| -> reqwest::RequestBuilder {
        let mut rb = client.request(method.clone(), url);
        if let Some(s) = sess {
            rb = rb.header("X-Auth-Token", &s.token);
        } else {
            rb = rb.basic_auth(&ctx.username, Some(&ctx.password));
        }
        match body {
            Some(b) => rb.header("Content-Type", "application/json").json(b),
            None => rb.header("Accept", "application/json"),
        }
    };

    let session = ensure_session(ctx, false).await;
    let resp = build(session.as_ref())
        .send()
        .await
        .map_err(|e| format!("无法连接 BMC ({}): {}", url, e))?;
    // 非 401 或本来就用 Basic：直接返回
    if resp.status().as_u16() != 401 || session.is_none() {
        return Ok(resp);
    }
    // token 失效：重建一次（重建失败自动 Basic 兜底，密码错误此时暴露）
    invalidate_session(&ctx.server_id);
    let session2 = ensure_session(ctx, true).await;
    let resp2 = build(session2.as_ref())
        .send()
        .await
        .map_err(|e| format!("无法连接 BMC ({}): {}", url, e))?;
    Ok(resp2)
}

/// GET 一个 Redfish 资源，返回解析后的 JSON
async fn redfish_get(ctx: &RedfishCtx, path: &str) -> Result<Value, String> {
    let url = format!("{}{}", ctx.base_url, path);
    let resp = send_authorized(ctx, reqwest::Method::GET, &url, None).await?;
    let status = resp.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 => format!("BMC 认证失败 (401): 请检查用户名/密码 ({})", url),
            404 => format!("BMC 不支持该资源 (404): {}", path),
            _ => format!("BMC 返回错误 ({}): {}", status.as_u16(), url),
        });
    }
    resp.json::<Value>()
        .await
        .map_err(|e| format!("解析 BMC 响应失败: {}", e))
}

/// POST 一个 Redfish Action（带 JSON body）
async fn redfish_post(ctx: &RedfishCtx, path: &str, body: Value) -> Result<(), String> {
    let url = format!("{}{}", ctx.base_url, path);
    let resp = send_authorized(ctx, reqwest::Method::POST, &url, Some(&body)).await?;
    let status = resp.status();
    if !status.is_success() {
        let body_text = resp.text().await.unwrap_or_default();
        return Err(match status.as_u16() {
            401 => "BMC 认证失败 (401): 请检查用户名/密码".to_string(),
            _ => format!("BMC 拒绝操作 ({}): {}", status.as_u16(), body_text),
        });
    }
    Ok(())
}

/// 从集合资源（Systems/Chassis/Managers）中取第一个成员的 @odata.id
async fn first_member_path(ctx: &RedfishCtx, collection_path: &str) -> Result<String, String> {
    let coll = redfish_get(ctx, collection_path).await?;
    coll.get("Members")
        .and_then(|m| m.as_array())
        .and_then(|arr| arr.first())
        .and_then(|m| m.get("@odata.id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| format!("BMC 未返回 {} 成员（可能不支持 Redfish 管理）", collection_path))
}

// ============================================================================
// JSON 宽松解析辅助
// ============================================================================

fn json_str(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn json_f64(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| {
        // 优先解析数字
        if let Some(n) = x.as_f64() {
            return Some(n);
        }
        // 回退：部分老款 BMC/超聚变 iBMC V3 返回字符串形式数值（如 "42.5"）
        x.as_str().and_then(|s| s.trim().parse::<f64>().ok())
    })
}

fn json_i64(v: &Value, key: &str) -> Option<i64> {
    v.get(key).and_then(|x| x.as_i64())
}

/// 归一化健康状态：Redfish Status.Health → ok/warning/critical/unknown
fn health_of(item: &Value) -> String {
    let status = item.get("Status");
    if let Some(state) = status.and_then(|s| s.get("State")).and_then(|x| x.as_str()) {
        if state.eq_ignore_ascii_case("absent") || state.eq_ignore_ascii_case("disabled") {
            return "absent".to_string();
        }
    }
    let health = status
        .and_then(|s| s.get("Health"))
        .and_then(|x| x.as_str())
        .unwrap_or("");
    match health.to_ascii_lowercase().as_str() {
        "ok" => "ok".to_string(),
        "warning" => "warning".to_string(),
        "critical" => "critical".to_string(),
        _ => "unknown".to_string(),
    }
}

/// 机箱/系统指示灯状态（新字段 LocationIndicatorActive / 旧字段 IndicatorLED）
fn indicator_led_of(v: &Value) -> Option<String> {
    if let Some(active) = v.get("LocationIndicatorActive").and_then(|x| x.as_bool()) {
        return Some(if active { "Lit" } else { "Off" }.to_string());
    }
    json_str(v, "IndicatorLED")
}

// ============================================================================
// commands
// ============================================================================

/// 测试未保存或正在编辑的 BMC 配置。
///
/// 这里请求受保护的 Systems 集合，而不是只探测 443 端口或请求可能匿名开放的
/// `/redfish/v1/` 根资源，因此成功结果同时代表 HTTPS、Redfish 和账号认证可用。
#[tauri::command]
pub async fn bmc_test_connect_with_config(
    config: BmcTestConfig,
) -> Result<OperationResult, String> {
    let host = config.host.trim();
    let username = config.username.trim();
    if host.is_empty() {
        return Ok(OperationResult::fail("BMC 主机地址不能为空"));
    }
    if username.is_empty() {
        return Ok(OperationResult::fail("BMC 用户名不能为空"));
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
        return Ok(OperationResult::fail("请输入 BMC 密码后再测试连接"));
    };

    let port = config.port.unwrap_or(443);
    let ctx = RedfishCtx {
        // 测试配置不能复用正式服务器 token，否则编辑了密码后可能被旧缓存误判成功。
        server_id: format!("bmc-test-{}", uuid::Uuid::new_v4()),
        base_url: redfish_base_url(host, port),
        username: username.to_string(),
        password,
        timeout_secs: config.connection_timeout.unwrap_or(15).max(5) as u64,
        allow_invalid_certs: config.bmc_allow_invalid_certs.unwrap_or(false),
    };

    let result = match redfish_get(&ctx, "/redfish/v1/Systems").await {
        Ok(_) => Ok(OperationResult::ok_with_message("Redfish 连接和认证成功")),
        Err(error) => Ok(OperationResult::fail(error)),
    };
    close_test_session(&ctx).await;
    result
}

/// 聚合获取 BMC 概览：系统信息 + 电源状态 + BMC 管理器信息（Tokio 并发加速）
#[tauri::command]
pub async fn bmc_get_overview(server_id: String) -> Result<BmcOverview, String> {
    if let Err(e) = validate_server_id(&server_id) {
        return Ok(BmcOverview::fail(e));
    }
    let ctx = match load_ctx(&server_id).await {
        Ok(c) => c,
        Err(e) => return Ok(BmcOverview::fail(e)),
    };

    // 1. 并发获取 Systems / Managers / Chassis 的集合首个成员路径（3路并发）
    let (sys_p_res, mgr_p_res, cha_p_res) = tokio::join!(
        first_member_path(&ctx, "/redfish/v1/Systems"),
        first_member_path(&ctx, "/redfish/v1/Managers"),
        first_member_path(&ctx, "/redfish/v1/Chassis"),
    );

    let system_path = match sys_p_res {
        Ok(p) => p,
        Err(e) => return Ok(BmcOverview::fail(e)),
    };

    // 2. 并发拉取 System 详情、Manager 详情及其网卡、Chassis 详情
    let sys_fut = redfish_get(&ctx, &system_path);

    let mgr_fut = async {
        if let Ok(manager_path) = mgr_p_res {
            if let Ok(manager) = redfish_get(&ctx, &manager_path).await {
                let model = json_str(&manager, "Model");
                let firmware = json_str(&manager, "FirmwareVersion");
                let mut mac = None;
                let mut ip = None;

                if let Some(nics_ref) = manager.get("EthernetInterfaces").and_then(|x| x.get("@odata.id")).and_then(|x| x.as_str()) {
                    if let Ok(nic_coll) = redfish_get(&ctx, nics_ref).await {
                        if let Some(nic_path) = nic_coll
                            .get("Members")
                            .and_then(|m| m.as_array())
                            .and_then(|arr| arr.first())
                            .and_then(|m| m.get("@odata.id"))
                            .and_then(|x| x.as_str())
                        {
                            if let Ok(nic) = redfish_get(&ctx, nic_path).await {
                                mac = json_str(&nic, "MACAddress");
                                ip = nic
                                    .get("IPv4Addresses")
                                    .and_then(|v| v.as_array())
                                    .and_then(|arr| arr.first())
                                    .and_then(|a| a.get("Address"))
                                    .and_then(|x| x.as_str())
                                    .map(|s| s.to_string())
                                    .filter(|s| !s.is_empty() && s != "0.0.0.0");
                            }
                        }
                    }
                }
                return (model, firmware, ip, mac);
            }
        }
        (None, None, None, None)
    };

    let cha_fut = async {
        if let Ok(chassis_path) = cha_p_res {
            if let Ok(chassis) = redfish_get(&ctx, &chassis_path).await {
                return indicator_led_of(&chassis);
            }
        }
        None
    };

    let (sys_res, (bmc_model, bmc_firmware, bmc_ip, bmc_mac), cha_led) = tokio::join!(sys_fut, mgr_fut, cha_fut);

    let system = match sys_res {
        Ok(v) => v,
        Err(e) => return Ok(BmcOverview::fail(e)),
    };

    let overview = BmcOverview {
        success: true,
        error: None,
        manufacturer: json_str(&system, "Manufacturer"),
        model: json_str(&system, "Model"),
        serial_number: json_str(&system, "SerialNumber"),
        part_number: json_str(&system, "PartNumber"),
        asset_tag: json_str(&system, "AssetTag"),
        bios_version: json_str(&system, "BiosVersion"),
        host_name: json_str(&system, "HostName"),
        power_state: json_str(&system, "PowerState"),
        health_status: system
            .get("Status")
            .and_then(|s| s.get("Health"))
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
        cpu_model: system
            .get("ProcessorSummary")
            .and_then(|p| json_str(p, "Model")),
        cpu_count: system
            .get("ProcessorSummary")
            .and_then(|p| json_i64(p, "Count")),
        total_memory_gb: system
            .get("MemorySummary")
            .and_then(|m| json_f64(m, "TotalSystemMemoryGiB")),
        indicator_led: indicator_led_of(&system).or(cha_led),
        boot_source_target: system
            .get("Boot")
            .and_then(|b| json_str(b, "BootSourceOverrideTarget")),
        boot_source_enabled: system
            .get("Boot")
            .and_then(|b| json_str(b, "BootSourceOverrideEnabled")),
        bmc_model,
        bmc_firmware,
        bmc_ip,
        bmc_mac,
        web_url: Some(ctx.base_url.clone()),
    };

    Ok(overview)
}

/// 电源操作
///
/// action 取值（Redfish ResetType）：
///   on(开机) / forceOff(强制关机) / gracefulShutdown(优雅关机) /
///   forceRestart(强制重启) / gracefulRestart(优雅重启) / powerCycle(电源循环) / nmi(不可屏蔽中断)
#[tauri::command]
pub async fn bmc_power_action(server_id: String, action: String) -> Result<OperationResult, String> {
    use super::OperationResult;

    if let Err(e) = validate_server_id(&server_id) {
        return Ok(OperationResult::fail(e));
    }
    // 白名单校验 ResetType，防止任意值透传到 BMC
    let reset_type = match action.as_str() {
        "on" => "On",
        "forceOff" => "ForceOff",
        "gracefulShutdown" => "GracefulShutdown",
        "forceRestart" => "ForceRestart",
        "gracefulRestart" => "GracefulRestart",
        "powerCycle" => "PowerCycle",
        "nmi" => "Nmi",
        other => {
            return Ok(OperationResult::fail(format!("不支持的电源操作: {}", other)));
        }
    }
    .to_string();

    let ctx = match load_ctx(&server_id).await {
        Ok(c) => c,
        Err(e) => return Ok(OperationResult::fail(e)),
    };
    // 审计日志使用服务器名称（重新读取一次轻量元数据）
    let server_name = crate::commands::ssh::load_server_config(&server_id)
        .await
        .map(|s| s.name)
        .unwrap_or_else(|_| server_id.clone());

    let system_path = match first_member_path(&ctx, "/redfish/v1/Systems").await {
        Ok(p) => p,
        Err(e) => return Ok(OperationResult::fail(e)),
    };
    let system = match redfish_get(&ctx, &system_path).await {
        Ok(v) => v,
        Err(e) => return Ok(OperationResult::fail(e)),
    };

    // 优先使用系统资源声明的 Reset target，缺失时回退标准路径
    let target = system
        .get("Actions")
        .and_then(|a| a.get("#ComputerSystem.Reset"))
        .and_then(|r| r.get("target"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("{}/Actions/ComputerSystem.Reset", system_path));

    // 完整 URL（部分厂商返回绝对地址）：直接 POST；相对路径：走统一辅助函数
    let outcome = if target.starts_with("http") {
        post_absolute(
            &ctx,
            &target,
            serde_json::json!({ "ResetType": reset_type }),
        )
        .await
    } else {
        redfish_post(&ctx, &target, serde_json::json!({ "ResetType": reset_type })).await
    };

    match outcome {
        Ok(()) => {
            let _ = crate::db::add_audit_log(
                "bmc",
                Some(server_name.as_str()),
                &format!("电源操作: {}", reset_type),
                "success",
                Some(&format!("serverId={}", server_id)),
            );
            Ok(OperationResult::ok_with_message(format!("电源操作已下发: {}", reset_type)))
        }
        Err(e) => {
            let _ = crate::db::add_audit_log(
                "bmc",
                Some(server_name.as_str()),
                &format!("电源操作: {}", reset_type),
                "failed",
                Some(&format!("serverId={}, error={}", server_id, e)),
            );
            Ok(OperationResult::fail(e))
        }
    }
}

/// 对绝对 URL 直接 POST（厂商在 Actions.target 返回完整地址时使用）
async fn post_absolute(ctx: &RedfishCtx, url: &str, body: Value) -> Result<(), String> {
    let resp = send_authorized(ctx, reqwest::Method::POST, url, Some(&body)).await?;
    let status = resp.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 => "BMC 认证失败 (401): 请检查用户名/密码".to_string(),
            _ => format!("BMC 拒绝操作 ({}): {}", status.as_u16(), url),
        });
    }
    Ok(())
}

/// 传感器数据：温度 / 风扇 / 电压 / 电源
#[tauri::command]
pub async fn bmc_get_sensors(server_id: String) -> Result<BmcSensorResult, String> {
    if let Err(e) = validate_server_id(&server_id) {
        return Ok(BmcSensorResult::fail(e));
    }
    let ctx = match load_ctx(&server_id).await {
        Ok(c) => c,
        Err(e) => return Ok(BmcSensorResult::fail(e)),
    };

    let chassis_path = match first_member_path(&ctx, "/redfish/v1/Chassis").await {
        Ok(p) => p,
        Err(e) => return Ok(BmcSensorResult::fail(e)),
    };

    let mut result = BmcSensorResult {
        success: true,
        error: None,
        temperatures: Vec::new(),
        fans: Vec::new(),
        voltages: Vec::new(),
        power_supplies: Vec::new(),
        total_power_watts: None,
    };

    // 并发拉取 Thermal（温度 + 风扇）与 Power（电压 + 电源模块）资源
    let thermal_path = format!("{}/Thermal", chassis_path);
    let power_path = format!("{}/Power", chassis_path);
    let thermal_fut = redfish_get(&ctx, &thermal_path);
    let power_fut = redfish_get(&ctx, &power_path);
    let (thermal_res, power_res) = tokio::join!(thermal_fut, power_fut);

    // Thermal 解析
    if let Ok(thermal) = thermal_res {
        // 温度传感器
        if let Some(temps) = thermal.get("Temperatures").and_then(|v| v.as_array()) {
            for t in temps {
                let Some(reading) = json_f64(t, "ReadingCelsius") else { continue };
                if health_of(t) == "absent" {
                    continue;
                }
                let upper = json_f64(t, "UpperThresholdCritical")
                    .or_else(|| json_f64(t, "UpperThresholdFatal"));
                let lower = json_f64(t, "LowerThresholdCritical");
                result.temperatures.push(BmcSensor {
                    name: json_str(t, "Name").unwrap_or_else(|| "Temperature".into()),
                    reading,
                    unit: "°C".into(),
                    status: sensor_status(t, reading, lower, upper),
                    lower_threshold: lower,
                    upper_threshold: upper,
                    min_reading: json_f64(t, "MinReadingRangeTemp"),
                    max_reading: json_f64(t, "MaxReadingRangeTemp"),
                });
            }
        }
        // 风扇
        if let Some(fans) = thermal.get("Fans").and_then(|v| v.as_array()) {
            for f in fans {
                let Some(reading) = json_f64(f, "Reading") else { continue };
                if health_of(f) == "absent" {
                    continue;
                }
                let unit = json_str(f, "ReadingUnits").unwrap_or_else(|| "RPM".into());
                let unit = if unit.eq_ignore_ascii_case("rpm") { "RPM".to_string() } else { "%".to_string() };
                let lower = json_f64(f, "LowerThresholdCritical");
                let upper = json_f64(f, "UpperThresholdCritical");
                result.fans.push(BmcSensor {
                    name: json_str(f, "Name").unwrap_or_else(|| "Fan".into()),
                    reading,
                    unit,
                    status: sensor_status(f, reading, lower, upper),
                    lower_threshold: lower,
                    upper_threshold: upper,
                    min_reading: json_f64(f, "MinReadingRange"),
                    max_reading: json_f64(f, "MaxReadingRange"),
                });
            }
        }
    }

    // Power 解析
    if let Ok(power) = power_res {
        if let Some(volts) = power.get("Voltages").and_then(|v| v.as_array()) {
            for v in volts {
                let Some(reading) = json_f64(v, "ReadingVolts") else { continue };
                if health_of(v) == "absent" {
                    continue;
                }
                let lower = json_f64(v, "LowerThresholdCritical");
                let upper = json_f64(v, "UpperThresholdCritical");
                result.voltages.push(BmcSensor {
                    name: json_str(v, "Name").unwrap_or_else(|| "Voltage".into()),
                    reading,
                    unit: "V".into(),
                    status: sensor_status(v, reading, lower, upper),
                    lower_threshold: lower,
                    upper_threshold: upper,
                    min_reading: json_f64(v, "MinReadingRangeVolts"),
                    max_reading: json_f64(v, "MaxReadingRangeVolts"),
                });
            }
        }
        if let Some(psus) = power.get("PowerSupplies").and_then(|v| v.as_array()) {
            for p in psus {
                let status = health_of(p);
                if status == "absent" {
                    continue;
                }
                result.power_supplies.push(BmcPsu {
                    name: json_str(p, "Name").unwrap_or_else(|| "PSU".into()),
                    status,
                    model: json_str(p, "Model"),
                    serial: json_str(p, "SerialNumber"),
                    part_number: json_str(p, "PartNumber"),
                    power_watts: json_f64(p, "LastPowerOutputWatts"),
                    line_voltage: json_f64(p, "LineInputVoltage"),
                    capacity_watts: json_f64(p, "PowerCapacityWatts"),
                });
            }
        }
        result.total_power_watts = power
            .get("PowerControl")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|pc| json_f64(pc, "PowerConsumedWatts"));
    }

    // 降级：两个资源都为空时提示（老 BMC 或权限受限）
    if result.temperatures.is_empty()
        && result.fans.is_empty()
        && result.voltages.is_empty()
        && result.power_supplies.is_empty()
    {
        result.error = Some("BMC 未返回传感器数据（可能不支持 Thermal/Power 资源或权限受限）".to_string());
    }

    Ok(result)
}

/// 传感器健康状态：优先 Status.Health，缺失时按阈值判断
fn sensor_status(item: &Value, reading: f64, lower: Option<f64>, upper: Option<f64>) -> String {
    let by_health = health_of(item);
    if by_health != "unknown" {
        return by_health;
    }
    if let Some(u) = upper {
        if reading >= u {
            return "critical".to_string();
        }
    }
    if let Some(l) = lower {
        if reading <= l {
            return "critical".to_string();
        }
    }
    "ok".to_string()
}

/// 定位 SEL/事件日志服务资源路径（get_logs 与 clear_logs 共用的导航逻辑）
///
/// 覆盖主流厂商：Dell iDRAC (SEL/EventLog)、HPE iLO (IEL/Active Log)、
/// Lenovo XCC (ActiveLog/StandardLog)、华为 iBMC (SecurityLog/SystemLog)、
/// 浪潮/超聚变 (SEL/EventLog)
async fn find_sel_path(ctx: &RedfishCtx) -> Result<String, String> {
    let manager_path = first_member_path(ctx, "/redfish/v1/Managers").await?;

    // LogServices 集合
    let manager = redfish_get(ctx, &manager_path).await?;
    let Some(log_services_ref) = manager
        .get("LogServices")
        .and_then(|x| x.get("@odata.id"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
    else {
        return Err("BMC 未提供 LogServices 资源".to_string());
    };
    let coll = redfish_get(ctx, &log_services_ref).await?;

    let members: Vec<String> = coll
        .get("Members")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("@odata.id").and_then(|x| x.as_str()).map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    if members.is_empty() {
        return Err("BMC 未提供日志服务成员".to_string());
    }
    Ok(members
        .iter()
        .find(|p| {
            let lp = p.to_ascii_lowercase();
            lp.contains("sel")
                || lp.contains("event")
                || lp.contains("systemevent")
                || lp.contains("activelog")
                || lp.contains("standardlog")
                || lp.contains("securitylog")
                || lp.contains("systemlog")
        })
        .cloned()
        .unwrap_or_else(|| members[0].clone()))
}

/// 硬件事件日志（SEL：System Event Log）
#[tauri::command]
pub async fn bmc_get_logs(server_id: String) -> Result<BmcLogResult, String> {
    if let Err(e) = validate_server_id(&server_id) {
        return Ok(BmcLogResult::fail(e));
    }
    let ctx = match load_ctx(&server_id).await {
        Ok(c) => c,
        Err(e) => return Ok(BmcLogResult::fail(e)),
    };

    let sel_path = match find_sel_path(&ctx).await {
        Ok(p) => p,
        Err(e) => return Ok(BmcLogResult::fail(e)),
    };

    let sel = match redfish_get(&ctx, &sel_path).await {
        Ok(v) => v,
        Err(e) => return Ok(BmcLogResult::fail(e)),
    };

    let entries_ref = sel
        .get("Entries")
        .and_then(|x| x.get("@odata.id"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let Some(entries_ref) = entries_ref else {
        return Ok(BmcLogResult::fail("日志服务未提供 Entries 集合".to_string()));
    };

    let entries = match redfish_get(&ctx, &entries_ref).await {
        Ok(v) => v,
        Err(e) => return Ok(BmcLogResult::fail(e)),
    };

    let mut result: Vec<BmcSelEntry> = Vec::new();
    if let Some(arr) = entries.get("Members").and_then(|v| v.as_array()) {
        for e in arr {
            let severity = e
                .get("Severity")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| {
                    // 部分厂商用 EventSeverity / no Severity 字段
                    e.get("EventSeverity")
                        .and_then(|x| x.as_str())
                        .unwrap_or("Info")
                        .to_string()
                });
            let message = e
                .get("Message")
                .and_then(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| {
                    // 无 Message 时拼接 SensorType + EventId 兜底展示
                    let sensor = e.get("SensorType").and_then(|x| x.as_str()).unwrap_or("");
                    let event_id = e.get("EventId").and_then(|x| x.as_str()).unwrap_or("");
                    format!("{} {}", sensor, event_id).trim().to_string()
                });
            result.push(BmcSelEntry {
                id: e
                    .get("Id")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_default(),
                created: e
                    .get("Created")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_default(),
                severity,
                message,
            });
        }
    }

    // 按时间倒序（最新在前）
    result.sort_by(|a, b| b.created.cmp(&a.created));

    // 空日志是正常状态（无硬件事件），不应视为错误
    if result.is_empty() {
        return Ok(BmcLogResult {
            success: true,
            error: None,
            entries: vec![],
        });
    }

    Ok(BmcLogResult {
        success: true,
        error: None,
        entries: result,
    })
}

/// 清空硬件事件日志（SEL）
#[tauri::command]
pub async fn bmc_clear_logs(server_id: String) -> Result<OperationResult, String> {
    use super::OperationResult;

    if let Err(e) = validate_server_id(&server_id) {
        return Ok(OperationResult::fail(e));
    }
    let ctx = match load_ctx(&server_id).await {
        Ok(c) => c,
        Err(e) => return Ok(OperationResult::fail(e)),
    };
    let server_name = crate::commands::ssh::load_server_config(&server_id)
        .await
        .map(|s| s.name)
        .unwrap_or_else(|_| server_id.clone());

    let sel_path = match find_sel_path(&ctx).await {
        Ok(p) => p,
        Err(e) => return Ok(OperationResult::fail(e)),
    };
    // 优先使用日志服务声明的 ClearLog target（可能是绝对 URL），缺失时回退标准路径
    let target = match redfish_get(&ctx, &sel_path).await {
        Ok(sel) => sel
            .get("Actions")
            .and_then(|a| a.get("#LogService.ClearLog"))
            .and_then(|r| r.get("target"))
            .and_then(|t| t.as_str())
            .map(|s| s.to_string()),
        Err(e) => return Ok(OperationResult::fail(e)),
    };
    let target = target.unwrap_or_else(|| format!("{}/Actions/LogService.ClearLog", sel_path));

    let outcome = if target.starts_with("http") {
        post_absolute(&ctx, &target, serde_json::json!({})).await
    } else {
        redfish_post(&ctx, &target, serde_json::json!({})).await
    };
    match outcome {
        Ok(()) => {
            let _ = crate::db::add_audit_log(
                "bmc",
                Some(server_name.as_str()),
                "清空硬件事件日志",
                "success",
                Some(&format!("serverId={}", server_id)),
            );
            Ok(OperationResult::ok_with_message("硬件事件日志已清空".to_string()))
        }
        Err(e) => {
            let _ = crate::db::add_audit_log(
                "bmc",
                Some(server_name.as_str()),
                "清空硬件事件日志",
                "failed",
                Some(&format!("serverId={}, error={}", server_id, e)),
            );
            Ok(OperationResult::fail(e))
        }
    }
}

/// 机箱定位指示灯开关（Lit / Off）
#[tauri::command]
pub async fn bmc_set_identify_led(server_id: String, on: bool) -> Result<OperationResult, String> {
    use super::OperationResult;

    if let Err(e) = validate_server_id(&server_id) {
        return Ok(OperationResult::fail(e));
    }
    let ctx = match load_ctx(&server_id).await {
        Ok(c) => c,
        Err(e) => return Ok(OperationResult::fail(e)),
    };

    let chassis_path = match first_member_path(&ctx, "/redfish/v1/Chassis").await {
        Ok(p) => p,
        Err(e) => return Ok(OperationResult::fail(e)),
    };
    let chassis = match redfish_get(&ctx, &chassis_path).await {
        Ok(v) => v,
        Err(e) => return Ok(OperationResult::fail(e)),
    };

    // 优先使用资源声明的 target，缺失时回退对 Chassis 资源整体 PATCH
    let led_target = chassis
        .get("Actions")
        .and_then(|a| a.get("#Chassis.Identify"))
        .and_then(|r| r.get("target"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());

    let value = if on { "Lit" } else { "Off" };
    if let Some(target) = led_target {
        let outcome = if target.starts_with("http") {
            post_absolute(
                &ctx,
                &target,
                serde_json::json!({ "IdentifyState": value }),
            )
            .await
        } else {
            redfish_post(&ctx, &target, serde_json::json!({ "IdentifyState": value })).await
        };
        return match outcome {
            Ok(()) => Ok(OperationResult::ok()),
            Err(e) => Ok(OperationResult::fail(e)),
        };
    }

    // 回退：PATCH Chassis 资源（IndicatorLED 老字段 / LocationIndicatorActive 新字段）
    let url = format!("{}/{}", ctx.base_url, chassis_path);
    let body = if chassis.get("LocationIndicatorActive").is_some() {
        serde_json::json!({ "LocationIndicatorActive": on })
    } else {
        serde_json::json!({ "IndicatorLED": value })
    };
    let resp = send_authorized(&ctx, reqwest::Method::PATCH, &url, Some(&body)).await?;
    if !resp.status().is_success() {
        return Ok(OperationResult::fail(format!(
            "BMC 拒绝指示灯操作 ({})",
            resp.status().as_u16()
        )));
    }
    Ok(OperationResult::ok())
}

/// 设置带外一次性开机引导项（Boot Source Override）
///
/// target 可选值：
///   None(取消指定/走默认) / BiosSetup(进入BIOS配置) / Pxe(网络引导) /
///   Cd(光盘/虚拟光驱) / Hdd(本地硬盘) / UefiTarget / Diags
#[tauri::command]
pub async fn bmc_set_boot_source(server_id: String, target: String) -> Result<OperationResult, String> {
    use super::OperationResult;

    if let Err(e) = validate_server_id(&server_id) {
        return Ok(OperationResult::fail(e));
    }

    let (override_target, override_enabled) = match target.as_str() {
        "None" | "none" => ("None", "Disabled"),
        "BiosSetup" | "biosSetup" | "bios" => ("BiosSetup", "Once"),
        "Pxe" | "pxe" => ("Pxe", "Once"),
        "Cd" | "cd" | "dvd" | "virtualMedia" => ("Cd", "Once"),
        "Hdd" | "hdd" | "disk" => ("Hdd", "Once"),
        "UefiTarget" | "uefi" => ("UefiTarget", "Once"),
        "Diags" | "diags" => ("Diags", "Once"),
        other => {
            return Ok(OperationResult::fail(format!("不支持的启动项类型: {}", other)));
        }
    };

    let ctx = match load_ctx(&server_id).await {
        Ok(c) => c,
        Err(e) => return Ok(OperationResult::fail(e)),
    };
    let server_name = crate::commands::ssh::load_server_config(&server_id)
        .await
        .map(|s| s.name)
        .unwrap_or_else(|_| server_id.clone());

    let system_path = match first_member_path(&ctx, "/redfish/v1/Systems").await {
        Ok(p) => p,
        Err(e) => return Ok(OperationResult::fail(e)),
    };

    let url = format!("{}{}", ctx.base_url, system_path);
    let body = serde_json::json!({
        "Boot": {
            "BootSourceOverrideTarget": override_target,
            "BootSourceOverrideEnabled": override_enabled,
        }
    });

    let resp = send_authorized(&ctx, reqwest::Method::PATCH, &url, Some(&body)).await?;
    let status = resp.status();
    if !status.is_success() {
        let body_text = resp.text().await.unwrap_or_default();
        let err_msg = match status.as_u16() {
            401 => "BMC 认证失败 (401): 请检查用户名/密码".to_string(),
            _ => format!("BMC 拒绝设置启动项 ({}): {}", status.as_u16(), body_text),
        };
        let _ = crate::db::add_audit_log(
            "bmc",
            Some(server_name.as_str()),
            &format!("设置启动项: {} ({})", override_target, override_enabled),
            "failed",
            Some(&format!("serverId={}, error={}", server_id, err_msg)),
        );
        return Ok(OperationResult::fail(err_msg));
    }

    let _ = crate::db::add_audit_log(
        "bmc",
        Some(server_name.as_str()),
        &format!("设置启动项: {} ({})", override_target, override_enabled),
        "success",
        Some(&format!("serverId={}", server_id)),
    );

    Ok(OperationResult::ok_with_message(format!(
        "已设置下次开机引导项: {}",
        override_target
    )))
}

// ============================================================================
// 联调测试（需要本地 Redfish 模拟器 tools/bmc-mock/bmc_mock.py，未运行时自动跳过）
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// 本地模拟器地址（python tools/bmc-mock/bmc_mock.py 启动）
    const MOCK_URL: &str = "https://127.0.0.1:8443";

    /// 模拟器是否在线（连接失败视为未启动，跳过测试）
    async fn mock_online(client: &reqwest::Client) -> bool {
        client
            .get(format!("{}/redfish/v1", MOCK_URL))
            .basic_auth("admin", Some("test"))
            .timeout(std::time::Duration::from_secs(2))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    /// 验证生产同款客户端构造（自签名证书信任）+ Basic 认证 + Systems 集合解析
    #[tokio::test]
    async fn redfish_client_works_against_mock() {
        let client = build_client(5, true).expect("client build");
        if !mock_online(&client).await {
            eprintln!("跳过：本地 BMC 模拟器未运行 ({MOCK_URL})");
            return;
        }
        let resp = client
            .get(format!("{}/redfish/v1/Systems", MOCK_URL))
            .basic_auth("admin", Some("test"))
            .send()
            .await
            .expect("request");
        assert!(resp.status().is_success(), "Systems 状态码异常");
        let v: Value = resp.json().await.expect("json");
        let member = v
            .get("Members")
            .and_then(|m| m.as_array())
            .and_then(|a| a.first())
            .and_then(|m| m.get("@odata.id"))
            .and_then(|x| x.as_str())
            .expect("Members[0].@odata.id");
        assert_eq!(member, "/redfish/v1/Systems/1");
    }

    /// 验证未携带凭据时得到明确的 401（错误文案友好化链路）。
    /// 不传 Authorization 比“传空密码”更稳定，兼容不同版本的本地模拟器。
    #[tokio::test]
    async fn redfish_auth_failure_maps_to_401() {
        let client = build_client(5, true).expect("client build");
        if !mock_online(&client).await {
            eprintln!("跳过：本地 BMC 模拟器未运行 ({MOCK_URL})");
            return;
        }
        let resp = client
            .get(format!("{}/redfish/v1/Systems", MOCK_URL))
            .send()
            .await
            .expect("request");
        assert_eq!(resp.status().as_u16(), 401);
    }

    /// 默认严格 TLS 模式必须拒绝模拟器的自签名证书；兼容模式由上面的
    /// 显式 `true` 参数覆盖，避免把“不校验证书”重新变成隐式行为。
    #[tokio::test]
    async fn strict_client_rejects_self_signed_certificate() {
        let client = build_client(5, false).expect("client build");
        let probe = build_client(5, true).expect("probe client");
        if !mock_online(&probe).await {
            eprintln!("跳过：本地 BMC 模拟器未运行 ({MOCK_URL})");
            return;
        }
        let result = client
            .get(format!("{}/redfish/v1", MOCK_URL))
            .send()
            .await;
        assert!(result.is_err(), "strict TLS client unexpectedly accepted self-signed certificate");
    }
}
