// src-tauri/src/mcp_client/mod.rs
//
// Qshell 原生 MCP Client 核心引擎与免配置服务器专项排障插件管理器
// 1. 开箱默认启用 5 大免配置服务器排障插件（Docker / Java & JVM / Kubernetes / Nginx & Web / Linux 内核与网络）
// 2. 内置 ssh_native 传输模式直接复用 Qshell 已有服务器 SSH 连接与账号密码，无需本地安装 npx/uvx，无需二次配置凭据
// 3. 同时兼容标准 Stdio / Streamable HTTP 协议以支持高级自定义扩展

pub mod http;
pub mod presets;
pub mod stdio;
pub mod types;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, RwLock};

use self::http::HttpMcpSession;
use self::presets::{build_default_seeded_plugins, get_builtin_presets, get_builtin_tools_for_preset};
use self::stdio::StdioMcpSession;
use self::types::{
    build_qualified_tool_name, ActiveMcpTool, McpPluginConfig, McpPluginView, McpPresetTemplate,
    McpTestConnectionResult, McpToolCallResult, McpToolInfo,
};

enum ActiveSession {
    SshNative(Vec<McpToolInfo>),
    Stdio(StdioMcpSession),
    Http(HttpMcpSession),
}

impl ActiveSession {
    fn tools(&self) -> &[McpToolInfo] {
        match self {
            ActiveSession::SshNative(tools) => tools,
            ActiveSession::Stdio(s) => &s.tools,
            ActiveSession::Http(h) => &h.tools,
        }
    }

    async fn is_alive(&self) -> bool {
        match self {
            ActiveSession::SshNative(_) => true,
            ActiveSession::Stdio(s) => s.is_alive().await,
            ActiveSession::Http(h) => h.is_alive(),
        }
    }

    async fn call_tool(
        &self,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<(bool, String), String> {
        match self {
            ActiveSession::SshNative(_) => Ok((
                false,
                format!(
                    "SSH_NATIVE_DELEGATE:{}:{}",
                    tool_name,
                    serde_json::to_string(&arguments).unwrap_or_default()
                ),
            )),
            ActiveSession::Stdio(s) => s.call_tool(tool_name, arguments).await,
            ActiveSession::Http(h) => h.call_tool(tool_name, arguments).await,
        }
    }

    async fn shutdown(&self) {
        if let ActiveSession::Stdio(s) = self {
            s.shutdown().await;
        }
    }
}

/// 外部插件连接失败后的熔断冷却期（避免异常插件在每次 AI 对话时重复阻塞）
const RECONNECT_COOLDOWN: Duration = Duration::from_secs(30);
/// list_active_tools 热路径上对单个外部插件自愈重连的最大等待时间。
/// 必须大于 stdio 的 INITIALIZE_TIMEOUT(60s) 与 HANDSHAKE_TIMEOUT(25s)，
/// 否则刚拉起的插件会被自愈超时丢弃并进入冷却，永久无法恢复。
const AUTO_HEAL_TIMEOUT: Duration = Duration::from_secs(70);
/// 整个工具列表刷新（含所有自愈重连）的总预算，防止多个故障插件串行叠加
const LIST_TOOLS_TOTAL_TIMEOUT: Duration = Duration::from_secs(75);
/// call_tool 路径上的重连超时：同样必须覆盖 stdio 的 60s 初始化，
/// 否则刚拉起的插件会被再次丢弃并反复 spawn 子进程。
const CALL_TOOL_RECONNECT_TIMEOUT: Duration = Duration::from_secs(70);
static SAVE_SEQ: AtomicU64 = AtomicU64::new(1);

pub struct McpClientManager {
    config_path: PathBuf,
    plugins: RwLock<Vec<McpPluginConfig>>,
    sessions: Mutex<HashMap<String, Arc<ActiveSession>>>,
    /// 按插件 ID 串行化启停操作，防止并发请求同时拉起重复子进程
    connect_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    /// 记录外部插件最近一次启动失败时间，用于熔断冷却短路
    last_failed_at: Mutex<HashMap<String, Instant>>,
}

static GLOBAL_MCP_CLIENT: OnceLock<Arc<McpClientManager>> = OnceLock::new();

/// 在 Tauri setup 阶段初始化全局 MCP Client 管理器
pub fn init_mcp_client(app_data_dir: PathBuf) {
    let config_path = app_data_dir.join("mcp_plugins.json");
    let loaded_plugins = load_or_seed_plugins(&config_path);
    let mgr = Arc::new(McpClientManager {
        config_path,
        plugins: RwLock::new(loaded_plugins),
        sessions: Mutex::new(HashMap::new()),
        connect_locks: Mutex::new(HashMap::new()),
        last_failed_at: Mutex::new(HashMap::new()),
    });
    let _ = GLOBAL_MCP_CLIENT.set(mgr.clone());

    // 后台异步自动连接已启用 (enabled=true) 的插件
    tauri::async_runtime::spawn(async move {
        mgr.auto_connect_enabled_plugins().await;
    });
}

pub fn global_manager() -> Result<&'static Arc<McpClientManager>, String> {
    GLOBAL_MCP_CLIENT
        .get()
        .ok_or_else(|| "MCP Client 尚未初始化".to_string())
}

/// 从磁盘加载插件配置；自动将旧版需要手动配凭据的内置插件升级为 5 大免配置 ssh_native 服务器排障插件
fn load_or_seed_plugins(path: &PathBuf) -> Vec<McpPluginConfig> {
    let seeded_defaults = build_default_seeded_plugins();

    if path.exists() {
        let raw = match std::fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(e) => {
                tracing::error!("[MCP Client] 读取 mcp_plugins.json 失败: {}，保留原文件不覆盖", e);
                return Vec::new();
            }
        };

        match serde_json::from_str::<Vec<McpPluginConfig>>(&raw) {
            Ok(mut list) => {
                let mut credential_failures = 0usize;
                for p in &mut list {
                    credential_failures += decrypt_map(&mut p.env);
                    credential_failures += decrypt_map(&mut p.headers);
                }
                if credential_failures > 0 {
                    tracing::warn!(
                        "[MCP Client] {} 个插件凭据解密失败（主密钥可能已变更），已清空这些值，请重新填写",
                        credential_failures
                    );
                }

                // 检查是否存在旧版非 ssh_native 的内置插件，若存在则平滑升级到免配置版本
                let has_legacy_builtin = list
                    .iter()
                    .any(|p| p.id.starts_with("builtin-") && p.transport != "ssh_native");

                let valid_builtin_ids: Vec<&str> =
                    seeded_defaults.iter().map(|d| d.id.as_str()).collect();

                let has_removed_builtin = list.iter().any(|p| {
                    p.id.starts_with("builtin-") && !valid_builtin_ids.contains(&p.id.as_str())
                });

                if has_legacy_builtin || has_removed_builtin {
                    // 只重置 builtin-*，保留全部用户插件（含基于预设模板创建、isPreset=true 的插件）
                    let custom_plugins: Vec<McpPluginConfig> = list
                        .into_iter()
                        .filter(|p| !p.id.starts_with("builtin-"))
                        .collect();
                    let mut merged = seeded_defaults;
                    merged.extend(custom_plugins);
                    if let Err(e) = save_plugins_to_disk(path, &merged) {
                        tracing::warn!("[MCP Client] 迁移插件配置落盘失败: {}", e);
                    }
                    return merged;
                }

                // 内置工具清单按内容比对刷新，避免「工具改名但数量不变」时永远沿用旧 schema
                let mut updated = false;
                for p in &mut list {
                    if p.transport == "ssh_native" {
                        if let Some(ref pid) = p.preset_id {
                            let latest_tools = get_builtin_tools_for_preset(pid);
                            if p.discovered_tools != latest_tools {
                                p.discovered_tools = latest_tools;
                                updated = true;
                            }
                        }
                    }
                }
                if updated {
                    if let Err(e) = save_plugins_to_disk(path, &list) {
                        tracing::warn!("[MCP Client] 刷新内置工具清单落盘失败: {}", e);
                    }
                }

                // 空列表是用户主动删空插件的合法状态，绝不重新播种
                return list;
            }
            Err(e) => {
                // 配置损坏时先备份再重建，避免静默覆盖用户数据
                tracing::error!("[MCP Client] 解析 mcp_plugins.json 失败: {}", e);
                let backup = path.with_extension(format!(
                    "json.corrupt-{}",
                    chrono::Utc::now().timestamp_millis()
                ));
                match std::fs::copy(path, &backup) {
                    Ok(_) => tracing::warn!("[MCP Client] 已备份损坏配置至 {:?}", backup),
                    Err(copy_err) => {
                        tracing::error!(
                            "[MCP Client] 备份损坏配置失败: {}，保留原文件不覆盖",
                            copy_err
                        );
                        return Vec::new();
                    }
                }
            }
        }
    }

    if let Err(e) = save_plugins_to_disk(path, &seeded_defaults) {
        tracing::warn!("[MCP Client] 首次写入默认插件配置失败: {}", e);
    }
    seeded_defaults
}

/// 前端回显用的密钥占位符：真实凭据始终只保留在 Rust 侧内存中
pub const SECRET_PLACEHOLDER: &str = "__QSHELL_SECRET_UNCHANGED__";

/// 生成供前端展示/编辑的脱敏凭据表（仅暴露键名，值统一替换为占位符）
fn mask_secret_map(src: &HashMap<String, String>) -> HashMap<String, String> {
    src.iter()
        .map(|(k, v)| {
            (
                k.clone(),
                if v.is_empty() {
                    String::new()
                } else {
                    SECRET_PLACEHOLDER.to_string()
                },
            )
        })
        .collect()
}

/// 还原前端回传的占位符：未修改的条目取回已保存的真实值，无原值的条目直接丢弃
fn resolve_secret_placeholders(
    incoming: &mut HashMap<String, String>,
    existing: Option<&HashMap<String, String>>,
) {
    let empty = HashMap::new();
    let saved = existing.unwrap_or(&empty);
    incoming.retain(|key, val| {
        if val != SECRET_PLACEHOLDER {
            return true;
        }
        match saved.get(key) {
            Some(real) => {
                *val = real.clone();
                true
            }
            None => false,
        }
    });
}

/// 将插件配置持久化到磁盘（对 env 与 headers 执行 AES-256-GCM 加密）
fn save_plugins_to_disk(path: &PathBuf, plugins: &[McpPluginConfig]) -> Result<(), String> {
    let mut cloned = plugins.to_vec();
    for p in &mut cloned {
        encrypt_map(&mut p.env)?;
        encrypt_map(&mut p.headers)?;
    }
    let json = serde_json::to_string_pretty(&cloned).map_err(|e| e.to_string())?;

    // 同目录临时文件 + 原子替换（附带进程 ID 与自增序号，避免并发落盘竞争同名临时文件）
    let seq = SAVE_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = path.with_extension(format!("json.tmp-{}-{}", std::process::id(), seq));
    std::fs::write(&tmp, json).map_err(|e| format!("写入临时插件配置失败: {}", e))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("替换 mcp_plugins.json 失败: {}", e)
    })?;
    Ok(())
}

fn encrypt_map(map: &mut HashMap<String, String>) -> Result<(), String> {
    let mk = crate::db::master_key();
    for val in map.values_mut() {
        if !val.is_empty() && !val.starts_with("v1:") {
            // 加密失败必须中止落盘，绝不能把明文凭据写进配置文件
            let enc = crate::crypto::encrypt_password(val.as_str(), mk)
                .map_err(|e| format!("加密插件凭据失败: {}", e))?;
            *val = enc;
        }
    }
    Ok(())
}

/// 返回解密失败的条目数；失败值直接清空，避免密文被当成凭据使用
fn decrypt_map(map: &mut HashMap<String, String>) -> usize {
    let mk = crate::db::master_key();
    let mut failed = 0usize;
    for val in map.values_mut() {
        if val.starts_with("v1:") {
            match crate::crypto::decrypt_password(val.as_str(), mk) {
                Ok(dec) => *val = dec,
                Err(_) => {
                    val.clear();
                    failed += 1;
                }
            }
        }
    }
    failed
}

impl McpClientManager {
    /// 启动时后台静默就绪已启用的插件
    pub async fn auto_connect_enabled_plugins(&self) {
        let enabled_ids: Vec<String> = {
            let list = self.plugins.read().await;
            list.iter()
                .filter(|p| p.enabled)
                .map(|p| p.id.clone())
                .collect()
        };

        for id in enabled_ids {
            if let Err(e) = self.start_plugin(&id).await {
                tracing::warn!("[MCP Client] 自动连接插件 {} 失败: {}", id, e);
            }
        }
    }

    /// 获取全部插件状态视图
    pub async fn list_plugins(&self) -> Vec<McpPluginView> {
        let list = self.plugins.read().await;
        let sessions = self.sessions.lock().await;
        let mut views = Vec::with_capacity(list.len());

        for p in list.iter() {
            let connected = if p.transport == "ssh_native" {
                p.enabled
            } else if let Some(sess) = sessions.get(&p.id) {
                sess.is_alive().await
            } else {
                false
            };

            views.push(McpPluginView {
                id: p.id.clone(),
                name: p.name.clone(),
                description: p.description.clone(),
                icon: p.icon.clone(),
                category: p.category.clone(),
                enabled: p.enabled,
                connected,
                transport: p.transport.clone(),
                command: p.command.clone(),
                args: p.args.clone(),
                url: p.url.clone(),
                env: mask_secret_map(&p.env),
                headers: mask_secret_map(&p.headers),
                disabled_tools: p.disabled_tools.clone(),
                discovered_tools: p.discovered_tools.clone(),
                is_preset: p.is_preset,
                preset_id: p.preset_id.clone(),
                last_connected_at: p.last_connected_at,
                last_error: p.last_error.clone(),
            });
        }
        views
    }

    /// 获取官方精选插件预设模板
    pub fn list_presets(&self) -> Vec<McpPresetTemplate> {
        get_builtin_presets()
    }

    /// 新增或更新插件配置
    pub async fn upsert_plugin(&self, mut config: McpPluginConfig) -> Result<McpPluginView, String> {
        config.id = config.id.trim().to_string();
        if config.id.is_empty() {
            config.id = format!("mcp-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
        }
        config.transport = config.transport.trim().to_lowercase();

        let existing_transport = {
            let list = self.plugins.read().await;
            list.iter()
                .find(|p| p.id == config.id)
                .map(|p| p.transport.clone())
        };

        // ssh_native 是内置插件专用传输，禁止通过 IPC 伪造内置插件或注入任意启动命令
        if config.id.starts_with("builtin-") && existing_transport.is_none() {
            return Err("builtin- 为内置插件保留的 ID 前缀，请使用其他 ID".to_string());
        }
        if config.transport == "ssh_native" && existing_transport.as_deref() != Some("ssh_native") {
            return Err(
                "ssh_native 为内置免配置插件专用传输方式，自定义插件请使用 stdio / http / sse"
                    .to_string(),
            );
        }
        if existing_transport.as_deref() == Some("ssh_native") && config.transport != "ssh_native" {
            return Err("内置 SSH 诊断插件不允许改成外部传输方式".to_string());
        }

        match config.transport.as_str() {
            "stdio" => {
                if config.command.as_deref().unwrap_or("").trim().is_empty() {
                    return Err("stdio 插件必须配置启动命令 (Command)".to_string());
                }
            }
            "http" | "sse" => {
                let url = config.url.as_deref().unwrap_or("").trim();
                if !url.starts_with("http://") && !url.starts_with("https://") {
                    return Err("HTTP / SSE 插件必须配置以 http:// 或 https:// 开头的端点 URL".to_string());
                }
            }
            "ssh_native" => {}
            other => return Err(format!("不支持的插件传输方式: {}", other)),
        }

        let should_connect = config.enabled;
        let plugin_id = config.id.clone();

        {
            let mut list = self.plugins.write().await;
            if let Some(existing) = list.iter_mut().find(|p| p.id == plugin_id) {
                resolve_secret_placeholders(&mut config.env, Some(&existing.env));
                resolve_secret_placeholders(&mut config.headers, Some(&existing.headers));
                if config.discovered_tools.is_empty() && !existing.discovered_tools.is_empty() {
                    config.discovered_tools = existing.discovered_tools.clone();
                }
                *existing = config;
            } else {
                resolve_secret_placeholders(&mut config.env, None);
                resolve_secret_placeholders(&mut config.headers, None);
                list.push(config);
            }
            save_plugins_to_disk(&self.config_path, &list)?;
        }

        self.stop_plugin(&plugin_id).await;

        if should_connect {
            if let Err(err) = self.start_plugin(&plugin_id).await {
                let mut list = self.plugins.write().await;
                if let Some(p) = list.iter_mut().find(|p| p.id == plugin_id) {
                    p.enabled = false;
                    p.last_error = Some(err);
                    let _ = save_plugins_to_disk(&self.config_path, &list);
                }
            }
        }

        self.get_plugin_view(&plugin_id).await
    }

    /// 删除插件（内置预置插件不可删除，只能通过开关禁用或「恢复默认全开」重置）
    pub async fn remove_plugin(&self, plugin_id: &str) -> Result<(), String> {
        if plugin_id.starts_with("builtin-") {
            return Err("内置预置插件不可删除，可使用开关禁用或通过「恢复默认全开」重置".to_string());
        }
        self.stop_plugin(plugin_id).await;
        self.last_failed_at.lock().await.remove(plugin_id);
        self.connect_locks.lock().await.remove(plugin_id);
        let mut list = self.plugins.write().await;
        list.retain(|p| p.id != plugin_id);
        save_plugins_to_disk(&self.config_path, &list)
    }

    /// 恢复默认预置插件（补齐被误删的内置插件，并完整还原其配置与会话状态）
    pub async fn restore_default_presets(&self) -> Result<Vec<McpPluginView>, String> {
        let restored_ids: Vec<String> = {
            let mut list = self.plugins.write().await;
            let defaults = build_default_seeded_plugins();
            let mut ids = Vec::with_capacity(defaults.len());
            for def in defaults {
                ids.push(def.id.clone());
                if let Some(existing) = list.iter_mut().find(|p| p.id == def.id) {
                    // 完整还原，避免残留被改过的 transport / command / url / lastError
                    *existing = def;
                } else {
                    list.push(def);
                }
            }
            save_plugins_to_disk(&self.config_path, &list)?;
            ids
        };

        // 重建会话，保证返回的 connected 状态与真实会话一致
        for id in restored_ids {
            self.stop_plugin(&id).await;
            if let Err(err) = self.start_plugin(&id).await {
                tracing::warn!("[MCP Client] 恢复插件 {} 会话失败: {}", id, err);
            }
        }
        Ok(self.list_plugins().await)
    }

    /// 切换插件启用/禁用状态
    pub async fn set_plugin_enabled(
        &self,
        plugin_id: &str,
        enabled: bool,
    ) -> Result<McpPluginView, String> {
        {
            let mut list = self.plugins.write().await;
            let plugin = list
                .iter_mut()
                .find(|p| p.id == plugin_id)
                .ok_or_else(|| format!("未找到插件: {}", plugin_id))?;
            plugin.enabled = enabled;
            if !enabled {
                plugin.last_error = None;
            }
            save_plugins_to_disk(&self.config_path, &list)?;
        }

        if enabled {
            if let Err(err) = self.start_plugin(plugin_id).await {
                let mut list = self.plugins.write().await;
                if let Some(p) = list.iter_mut().find(|p| p.id == plugin_id) {
                    p.enabled = false;
                    p.last_error = Some(err.clone());
                    let _ = save_plugins_to_disk(&self.config_path, &list);
                }
                return Err(err);
            }
        } else {
            self.stop_plugin(plugin_id).await;
        }

        self.get_plugin_view(plugin_id).await
    }

    /// 切换单个工具的启用/禁用状态
    pub async fn set_tool_disabled(
        &self,
        plugin_id: &str,
        tool_name: &str,
        disabled: bool,
    ) -> Result<McpPluginView, String> {
        {
            let mut list = self.plugins.write().await;
            let plugin = list
                .iter_mut()
                .find(|p| p.id == plugin_id)
                .ok_or_else(|| format!("未找到插件: {}", plugin_id))?;
            if !plugin.discovered_tools.iter().any(|t| t.name == tool_name) {
                return Err(format!(
                    "工具 `{}` 不在插件「{}」已发现的工具清单中",
                    tool_name, plugin.name
                ));
            }
            if disabled {
                if !plugin.disabled_tools.iter().any(|t| t == tool_name) {
                    plugin.disabled_tools.push(tool_name.to_string());
                }
            } else {
                plugin.disabled_tools.retain(|t| t != tool_name);
            }
            save_plugins_to_disk(&self.config_path, &list)?;
        }
        self.get_plugin_view(plugin_id).await
    }

    /// 获取指定插件的串行连接互斥锁，防止并发请求同时拉起重复子进程
    async fn plugin_connect_lock(&self, plugin_id: &str) -> Arc<Mutex<()>> {
        let mut locks = self.connect_locks.lock().await;
        locks
            .entry(plugin_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    /// 清除指定插件的失败冷却记录（用户显式操作时允许立即重连）
    pub async fn clear_failure_cooldown(&self, plugin_id: &str) {
        self.last_failed_at.lock().await.remove(plugin_id);
    }

    /// 启动并连接指定插件，发现其工具清单
    pub async fn start_plugin(&self, plugin_id: &str) -> Result<Vec<McpToolInfo>, String> {
        let lock = self.plugin_connect_lock(plugin_id).await;
        let _guard = lock.lock().await;

        let cfg = {
            let list = self.plugins.read().await;
            list.iter()
                .find(|p| p.id == plugin_id)
                .cloned()
                .ok_or_else(|| format!("未找到插件: {}", plugin_id))?
        };

        self.stop_plugin(plugin_id).await;

        let session_res = Self::establish_session(&cfg).await;
        match session_res {
            Ok(session) => {
                let tools = session.tools().to_vec();
                let now = chrono::Utc::now().timestamp_millis();

                {
                    let mut sessions = self.sessions.lock().await;
                    sessions.insert(plugin_id.to_string(), Arc::new(session));
                }
                self.last_failed_at.lock().await.remove(plugin_id);

                {
                    let mut list = self.plugins.write().await;
                    if let Some(p) = list.iter_mut().find(|p| p.id == plugin_id) {
                        p.discovered_tools = tools.clone();
                        p.last_connected_at = Some(now);
                        p.last_error = None;
                        let _ = save_plugins_to_disk(&self.config_path, &list);
                    }
                }

                Ok(tools)
            }
            Err(err) => {
                self.last_failed_at
                    .lock()
                    .await
                    .insert(plugin_id.to_string(), Instant::now());
                let mut list = self.plugins.write().await;
                if let Some(p) = list.iter_mut().find(|p| p.id == plugin_id) {
                    p.last_error = Some(err.clone());
                    let _ = save_plugins_to_disk(&self.config_path, &list);
                }
                Err(err)
            }
        }
    }

    /// 停止指定插件并清理子进程
    pub async fn stop_plugin(&self, plugin_id: &str) {
        let removed = {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(plugin_id)
        };
        if let Some(sess) = removed {
            sess.shutdown().await;
        }
    }

    /// 测试插件连接与工具发现
    pub async fn test_connection(&self, mut cfg: McpPluginConfig) -> McpTestConnectionResult {
        let start = Instant::now();
        {
            let list = self.plugins.read().await;
            if let Some(existing) = list.iter().find(|p| p.id == cfg.id) {
                resolve_secret_placeholders(&mut cfg.env, Some(&existing.env));
                resolve_secret_placeholders(&mut cfg.headers, Some(&existing.headers));
            } else {
                resolve_secret_placeholders(&mut cfg.env, None);
                resolve_secret_placeholders(&mut cfg.headers, None);
            }
        }
        match Self::establish_session(&cfg).await {
            Ok(session) => {
                let latency_ms = start.elapsed().as_millis() as u64;
                let (server_name, server_version, tools) = match &session {
                    ActiveSession::SshNative(tools) => (
                        Some("Qshell SSH-Native Diagnostic Engine".to_string()),
                        Some("2.0.0".to_string()),
                        tools.clone(),
                    ),
                    ActiveSession::Stdio(s) => (
                        s.server_name.clone(),
                        s.server_version.clone(),
                        s.tools.clone(),
                    ),
                    ActiveSession::Http(h) => (
                        h.server_name.clone(),
                        h.server_version.clone(),
                        h.tools.clone(),
                    ),
                };
                session.shutdown().await;
                McpTestConnectionResult {
                    success: true,
                    server_name,
                    server_version,
                    tools,
                    latency_ms,
                    error: None,
                }
            }
            Err(err) => McpTestConnectionResult {
                success: false,
                server_name: None,
                server_version: None,
                tools: Vec::new(),
                latency_ms: start.elapsed().as_millis() as u64,
                error: Some(err),
            },
        }
    }

    /// 获取当前所有已启用插件的可用工具汇总（供 AI ReAct 循环动态注入）
    pub async fn list_active_tools(&self) -> Vec<ActiveMcpTool> {
        let enabled: Vec<(String, String)> = {
            let list = self.plugins.read().await;
            list.iter()
                .filter(|p| p.enabled)
                .map(|p| (p.id.clone(), p.transport.clone()))
                .collect()
        };

        // 外部 Stdio / HTTP 插件必须持有存活会话；会话缺失或进程已退出时重建一次，
        // 避免仅凭磁盘缓存把已失效插件的工具注入给模型。
        // 冷却期内的故障插件直接短路跳过；单插件自愈上限 AUTO_HEAL_TIMEOUT (70s)，
        // 整个列表再加 LIST_TOOLS_TOTAL_TIMEOUT (75s) 总预算，避免 N 个故障插件
        // 串行叠加把每次 AI 对话阻塞 N×70s。
        let _ = tokio::time::timeout(LIST_TOOLS_TOTAL_TIMEOUT, async {
            for (id, transport) in &enabled {
                if transport == "ssh_native" {
                    continue;
                }
                let alive = {
                    let sessions = self.sessions.lock().await;
                    match sessions.get(id) {
                        Some(sess) => sess.is_alive().await,
                        None => false,
                    }
                };
                if !alive {
                    let in_cooldown = {
                        let failed_map = self.last_failed_at.lock().await;
                        failed_map
                            .get(id)
                            .map(|t| t.elapsed() < RECONNECT_COOLDOWN)
                            .unwrap_or(false)
                    };
                    if in_cooldown {
                        continue;
                    }
                    match tokio::time::timeout(AUTO_HEAL_TIMEOUT, self.start_plugin(id)).await {
                        Ok(Ok(_)) => {}
                        Ok(Err(err)) => {
                            tracing::warn!("[MCP Client] 刷新插件 {} 会话失败: {}", id, err);
                        }
                        Err(_) => {
                            self.last_failed_at
                                .lock()
                                .await
                                .insert(id.clone(), Instant::now());
                            tracing::warn!(
                                "[MCP Client] 刷新插件 {} 会话超时 ({}s)，已进入冷却保护",
                                id,
                                AUTO_HEAL_TIMEOUT.as_secs()
                            );
                        }
                    }
                }
            }
        })
        .await;

        let list = self.plugins.read().await;
        let sessions = self.sessions.lock().await;
        let mut active_tools = Vec::new();

        for p in list.iter() {
            if !p.enabled {
                continue;
            }
            let session_ready = if p.transport == "ssh_native" {
                true
            } else {
                match sessions.get(&p.id) {
                    Some(sess) => sess.is_alive().await,
                    None => false,
                }
            };
            if !session_ready {
                continue;
            }
            for tool in &p.discovered_tools {
                if p.disabled_tools.iter().any(|d| d == &tool.name) {
                    continue;
                }
                active_tools.push(ActiveMcpTool {
                    plugin_id: p.id.clone(),
                    plugin_name: p.name.clone(),
                    plugin_icon: p.icon.clone(),
                    qualified_name: build_qualified_tool_name(&p.id, &tool.name),
                    tool_name: tool.name.clone(),
                    description: format!("[{} 插件] {}", p.name, tool.description),
                    input_schema: tool.input_schema.clone(),
                    is_read_only: tool.is_read_only,
                    transport: p.transport.clone(),
                });
            }
        }
        active_tools
    }

    /// 调用指定插件的指定工具
    pub async fn call_tool(
        &self,
        plugin_id: &str,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<McpToolCallResult, String> {
        let plugin_name = {
            let list = self.plugins.read().await;
            let p = list
                .iter()
                .find(|p| p.id == plugin_id)
                .ok_or_else(|| format!("未找到 MCP 插件: {}", plugin_id))?;
            if !p.enabled {
                return Err(format!("MCP 插件「{}」当前未启用", p.name));
            }
            if p.disabled_tools.iter().any(|t| t == tool_name) {
                return Err(format!("工具 `{}` 已被用户禁用", tool_name));
            }
            // ssh_native 没有真实 MCP 会话，其 call_tool 只会返回占位文本；
            // 内置工具必须由前端 SSH 诊断引擎执行，避免把占位字符串当作工具结果喂给模型。
            if p.transport == "ssh_native" {
                return Err(format!(
                    "插件「{}」为内置 SSH 诊断插件，不支持通用 MCP 工具调用",
                    p.name
                ));
            }
            if !p.discovered_tools.iter().any(|t| t.name == tool_name) {
                return Err(format!("工具 `{}` 不在插件「{}」已发现的工具清单中", tool_name, p.name));
            }
            p.name.clone()
        };

        let start = Instant::now();

        let mut session = {
            let sessions = self.sessions.lock().await;
            sessions.get(plugin_id).cloned()
        };

        if let Some(ref s) = session {
            if !s.is_alive().await {
                session = None;
            }
        }

        if session.is_none() {
            // 冷却期内不重复拉起子进程，避免故障插件每次工具调用都 spawn 一次
            let in_cooldown = {
                let failed_map = self.last_failed_at.lock().await;
                failed_map
                    .get(plugin_id)
                    .map(|t| t.elapsed() < RECONNECT_COOLDOWN)
                    .unwrap_or(false)
            };
            if in_cooldown {
                return Err(format!("插件「{}」处于重连冷却期，请稍后重试", plugin_name));
            }
            // 超时必须覆盖 stdio 初始化（60s），否则刚拉起的插件会被再次丢弃
            tokio::time::timeout(CALL_TOOL_RECONNECT_TIMEOUT, self.start_plugin(plugin_id))
                .await
                .map_err(|_| {
                    format!("插件「{}」重连超时，已跳过本次工具调用", plugin_name)
                })??;
            let sessions = self.sessions.lock().await;
            session = sessions.get(plugin_id).cloned();
        }

        let active_session =
            session.ok_or_else(|| format!("插件「{}」会话未能建立", plugin_name))?;

        // 远程端点重启 / Session-Id 过期会让旧会话调用失败，重建会话后自动重试一次，
        // 避免插件一旦断线就永久失效直到重启应用。
        let call_result = active_session.call_tool(tool_name, arguments.clone()).await;
        let (is_error, text) = match call_result {
            Ok(res) => res,
            Err(first_err) => {
                // 先写冷却：若重连也失败/超时，后续调用会被冷却短路，
                // 不会每次都重新 spawn 子进程。
                self.last_failed_at
                    .lock()
                    .await
                    .insert(plugin_id.to_string(), Instant::now());
                self.stop_plugin(plugin_id).await;
                tokio::time::timeout(CALL_TOOL_RECONNECT_TIMEOUT, self.start_plugin(plugin_id))
                    .await
                    .map_err(|_| {
                        format!("插件「{}」重连超时: {}", plugin_name, first_err)
                    })??;
                // 重连成功后立即解除冷却，避免误挡后续正常调用
                self.last_failed_at.lock().await.remove(plugin_id);
                let fresh_session = {
                    let sessions = self.sessions.lock().await;
                    sessions.get(plugin_id).cloned()
                }
                .ok_or_else(|| {
                    format!("插件「{}」重连后仍无可用会话: {}", plugin_name, first_err)
                })?;
                fresh_session.call_tool(tool_name, arguments).await?
            }
        };
        let duration_ms = start.elapsed().as_millis() as u64;

        Ok(McpToolCallResult {
            plugin_id: plugin_id.to_string(),
            plugin_name,
            tool_name: tool_name.to_string(),
            is_error,
            text,
            duration_ms,
        })
    }

    async fn get_plugin_view(&self, plugin_id: &str) -> Result<McpPluginView, String> {
        let views = self.list_plugins().await;
        views
            .into_iter()
            .find(|v| v.id == plugin_id)
            .ok_or_else(|| format!("未找到插件: {}", plugin_id))
    }

    async fn establish_session(cfg: &McpPluginConfig) -> Result<ActiveSession, String> {
        let transport = cfg.transport.trim().to_lowercase();
        if transport == "ssh_native" {
            let preset_id = cfg
                .preset_id
                .as_deref()
                .unwrap_or_else(|| cfg.id.trim_start_matches("builtin-"));
            // 内置工具清单始终以代码中的最新定义为准，不使用可能过期的磁盘缓存
            let tools = get_builtin_tools_for_preset(preset_id);
            Ok(ActiveSession::SshNative(tools))
        } else if transport == "http" || transport == "sse" {
            let url = cfg.url.as_deref().unwrap_or("");
            let session = HttpMcpSession::connect(url, &cfg.headers).await?;
            Ok(ActiveSession::Http(session))
        } else {
            let cmd = cfg.command.as_deref().unwrap_or("");
            let session = StdioMcpSession::connect(cmd, &cfg.args, &cfg.env).await?;
            Ok(ActiveSession::Stdio(session))
        }
    }

    /// 应用退出时优雅关闭所有 Stdio 子进程
    pub async fn shutdown_all(&self) {
        let drained: Vec<Arc<ActiveSession>> = {
            let mut sessions = self.sessions.lock().await;
            sessions.drain().map(|(_, s)| s).collect()
        };
        for s in drained {
            s.shutdown().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn builds_valid_qualified_tool_name() {
        let q = build_qualified_tool_name("builtin-kubernetes", "inspect_unhealthy_pods");
        assert_eq!(q, "mcp__builtin_kubernetes__inspect_unhealthy_pods");
        assert!(q.len() <= 64);
    }

    #[test]
    fn long_qualified_tool_names_stay_unique_and_stable() {
        let a = build_qualified_tool_name(
            "very-long-plugin-id-aaaa",
            "inspect_a_very_long_metric_name_aaaa",
        );
        let b = build_qualified_tool_name(
            "very-long-plugin-id-aaaa",
            "inspect_a_very_long_metric_name_bbbb",
        );
        assert!(a.len() <= 64);
        assert!(b.len() <= 64);
        assert_ne!(a, b);
        assert_eq!(
            a,
            build_qualified_tool_name(
                "very-long-plugin-id-aaaa",
                "inspect_a_very_long_metric_name_aaaa"
            )
        );
    }

    #[test]
    fn infers_readonly_from_name_and_annotations() {
        use super::types::infer_tool_read_only;
        assert!(infer_tool_read_only("get_pod_logs", &json!({})));
        assert!(infer_tool_read_only("list_tables", &json!({})));
        assert!(!infer_tool_read_only("delete_pod", &json!({})));
        assert!(!infer_tool_read_only("restart_deployment", &json!({})));
        assert!(infer_tool_read_only(
            "delete_pod",
            &json!({ "annotations": { "readOnlyHint": true } })
        ));
        // 无法判定的第三方工具默认按「可能写」处理，需用户显式授权
        assert!(!infer_tool_read_only("run_shell", &json!({})));
        assert!(infer_tool_read_only("inspect_pods", &json!({})));
    }

    #[test]
    fn secret_placeholders_never_leak_real_credentials() {
        let mut saved = HashMap::new();
        saved.insert("TOKEN".to_string(), "real-secret".to_string());
        let masked = mask_secret_map(&saved);
        assert_eq!(masked.get("TOKEN").unwrap(), SECRET_PLACEHOLDER);
        assert_ne!(masked.get("TOKEN").unwrap(), "real-secret");

        let mut incoming = masked.clone();
        incoming.insert("NEW_KEY".to_string(), "new-value".to_string());
        resolve_secret_placeholders(&mut incoming, Some(&saved));
        assert_eq!(incoming.get("TOKEN").unwrap(), "real-secret");
        assert_eq!(incoming.get("NEW_KEY").unwrap(), "new-value");

        // 新建插件里出现占位符但没有原值时必须丢弃，不能把占位文本当凭据落盘
        let mut fresh = masked;
        resolve_secret_placeholders(&mut fresh, None);
        assert!(fresh.is_empty());
    }

    #[test]
    fn interpolates_env_variables_in_args() {
        use super::stdio::interpolate_env_vars;
        let mut env = HashMap::new();
        env.insert(
            "API_URL".to_string(),
            "http://localhost:8080".to_string(),
        );
        assert_eq!(
            interpolate_env_vars("${API_URL}", &env),
            "http://localhost:8080"
        );
    }

    #[test]
    fn parses_json_and_sse_rpc_responses() {
        use super::http::parse_json_or_sse;
        let plain = r#"{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}"#;
        assert!(parse_json_or_sse(plain).is_ok());

        let sse = "event: message\r\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\r\n\r\n";
        let parsed = parse_json_or_sse(sse).unwrap();
        assert_eq!(parsed["result"]["ok"], json!(true));
    }

    #[test]
    fn presets_contain_five_zero_config_ssh_native_plugins() {
        let presets = get_builtin_presets();
        assert_eq!(presets.len(), 5);
        let seeded = build_default_seeded_plugins();
        assert_eq!(seeded.len(), 5);
        for plugin in &seeded {
            assert!(plugin.enabled);
            assert_eq!(plugin.transport, "ssh_native");
            assert_eq!(plugin.discovered_tools.len(), 3);
        }
        assert!(seeded.iter().any(|p| p.id == "builtin-docker"));
        assert!(seeded.iter().any(|p| p.id == "builtin-java"));
        assert!(seeded.iter().any(|p| p.id == "builtin-kubernetes"));
        assert!(seeded.iter().any(|p| p.id == "builtin-nginx_web"));
        assert!(seeded.iter().any(|p| p.id == "builtin-linux_kernel"));
    }
}
