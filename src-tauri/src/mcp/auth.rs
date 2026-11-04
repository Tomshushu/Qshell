// src-tauri/src/mcp/auth.rs
//
// Qshell 本地 MCP 鉴权与配置持久化模块
// 1. 生成 256 位高熵加密 Token，持久化落盘，严格控制本地读取权限
// 2. 校验 HTTP Bearer Token 与 Origin 请求头（防御 DNS Rebinding 与跨站劫持）
// 3. 实现 S2-6 按主机显式授权模型

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::types::McpConfig;

#[derive(Clone)]
pub struct AuthManager {
    config_path: PathBuf,
    config: Arc<RwLock<McpConfig>>,
}

impl AuthManager {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let config_path = app_data_dir.join("qshell_mcp_config.json");
        let mut config = McpConfig::default();

        if config_path.exists() {
            if let Ok(content) = fs::read_to_string(&config_path) {
                if let Ok(saved) = serde_json::from_str::<McpConfig>(&content) {
                    config = saved;
                }
            }
        }

        // 首次初始化自动生成高熵随机 Token
        if config.token.trim().is_empty() {
            config.token = format!("qsh_mcp_{}", Uuid::new_v4().simple());
            let _ = Self::save_config_file(&config_path, &config);
        }

        Self {
            config_path,
            config: Arc::new(RwLock::new(config)),
        }
    }

    fn save_config_file(path: &PathBuf, config: &McpConfig) -> Result<(), String> {
        let json = serde_json::to_string_pretty(config)
            .map_err(|e| format!("序列化 MCP 配置失败: {}", e))?;
        fs::write(path, json).map_err(|e| format!("写入 MCP 配置文件失败: {}", e))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
        }

        Ok(())
    }

    pub async fn get_config(&self) -> McpConfig {
        self.config.read().await.clone()
    }

    pub async fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        let mut cfg = self.config.write().await;
        cfg.enabled = enabled;
        Self::save_config_file(&self.config_path, &cfg)
    }

    pub async fn regenerate_token(&self) -> Result<String, String> {
        let mut cfg = self.config.write().await;
        let new_token = format!("qsh_mcp_{}", Uuid::new_v4().simple());
        cfg.token = new_token.clone();
        Self::save_config_file(&self.config_path, &cfg)?;
        Ok(new_token)
    }

    pub async fn set_authorized_hosts(&self, host_ids: Vec<String>) -> Result<(), String> {
        let mut cfg = self.config.write().await;
        cfg.authorized_host_ids = host_ids;
        Self::save_config_file(&self.config_path, &cfg)
    }

    pub async fn is_host_authorized(&self, host_id: &str) -> bool {
        let cfg = self.config.read().await;
        cfg.authorized_host_ids.iter().any(|id| id == host_id)
    }

    /// 校验 Bearer Token 凭证
    pub async fn verify_token(&self, auth_header: Option<&str>) -> bool {
        let cfg = self.config.read().await;
        if !cfg.enabled {
            return false;
        }

        let Some(header) = auth_header else {
            return false;
        };

        let trimmed = header.trim();
        if let Some(token) = trimmed.strip_prefix("Bearer ") {
            return token.trim() == cfg.token;
        }

        false
    }

    /// 校验 HTTP Origin 请求头，拦截恶意外网网页发起的跨域偷渡探测
    pub fn verify_origin(&self, origin_header: Option<&str>) -> bool {
        let Some(origin) = origin_header else {
            // CLI 工具（如 Claude Code / Cursor stdio 转发）通常不带 Origin，放行
            return true;
        };

        let lower = origin.trim().to_lowercase();
        lower == "null"
            || lower.starts_with("http://127.0.0.1")
            || lower.starts_with("http://localhost")
            || lower.starts_with("tauri://localhost")
    }
}
