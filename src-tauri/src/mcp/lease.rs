// src-tauri/src/mcp/lease.rs
//
// S2-7 多 Agent 并发租约管理器 (Session Lease Manager)
// 防止多客户端/多 Agent 在同一远程会话中交织执行产生竞态与状态错乱

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct LeaseInfo {
    pub lease_id: String,
    pub host_id: String,
    pub client_id: String,
    pub acquired_at: Instant,
    pub expires_at: Instant,
}

#[derive(Debug, Clone)]
pub struct LeaseManager {
    leases: Arc<Mutex<HashMap<String, LeaseInfo>>>, // host_id -> LeaseInfo
}

impl LeaseManager {
    pub fn new() -> Self {
        Self {
            leases: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 尝试获取目标主机的独占执行租约
    /// 如果已被其他客户端持有且未过期，返回 LEASE_CONFLICT 错误
    pub async fn acquire(
        &self,
        host_id: &str,
        client_id: &str,
        ttl_secs: u64,
    ) -> Result<String, String> {
        let mut map = self.leases.lock().await;
        let now = Instant::now();

        // 清理已过期租约
        map.retain(|_, v| v.expires_at > now);

        if let Some(existing) = map.get(host_id) {
            if existing.client_id != client_id {
                let remaining = existing.expires_at.saturating_duration_since(now).as_secs();
                return Err(format!(
                    "LEASE_CONFLICT: 目标主机当前正由外部客户端「{}」持有会话租约，请等待 {} 秒或切换至其他主机操作。",
                    existing.client_id, remaining
                ));
            }
            // 同一客户端刷新续期
            let lease_id = existing.lease_id.clone();
            let acquired_at = existing.acquired_at;
            map.insert(
                host_id.to_string(),
                LeaseInfo {
                    lease_id: lease_id.clone(),
                    host_id: host_id.to_string(),
                    client_id: client_id.to_string(),
                    acquired_at,
                    expires_at: now + Duration::from_secs(ttl_secs),
                },
            );
            return Ok(lease_id);
        }

        // 新建租约
        let new_id = format!("lease_{}_{}", host_id, Uuid::new_v4().simple());
        map.insert(
            host_id.to_string(),
            LeaseInfo {
                lease_id: new_id.clone(),
                host_id: host_id.to_string(),
                client_id: client_id.to_string(),
                acquired_at: now,
                expires_at: now + Duration::from_secs(ttl_secs),
            },
        );

        Ok(new_id)
    }

    /// 释放会话租约
    pub async fn release(&self, host_id: &str, lease_id: &str) {
        let mut map = self.leases.lock().await;
        if let Some(existing) = map.get(host_id) {
            if existing.lease_id == lease_id {
                map.remove(host_id);
            }
        }
    }

    /// 获取当前活跃的租约数量
    pub async fn active_count(&self) -> usize {
        let mut map = self.leases.lock().await;
        let now = Instant::now();
        map.retain(|_, v| v.expires_at > now);
        map.len()
    }
}
