//! 通用 HTTPS 设备客户端（Phase 0，决策 4：自签证书能力泛化）
//!
//! 供 BMC Redfish 以及后续 ESXi / vCenter / Proxmox / 内置 WinRM 等所有
//! 「HTTPS 设备」共用：TLS 校验开关、连接池缓存、错误链展开与提示分类。
//!
//! 设计约束：
//! - 严格证书校验仍是默认值，只有用户显式开启时才放宽；
//! - `.danger_accept_invalid_certs` 全项目只在这里出现一次；
//! - client 与具体 host 无关，缓存 key 只需 (超时, 是否放宽证书)。

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// 构造客户端：严格校验是默认值，自签名兼容必须显式开启。
pub fn build_client(timeout_secs: u64, allow_invalid_certs: bool) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .connect_timeout(Duration::from_secs(timeout_secs))
        .danger_accept_invalid_certs(allow_invalid_certs)
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {}", e))
}

fn client_cache() -> &'static Mutex<HashMap<(u64, bool), Arc<reqwest::Client>>> {
    static CACHE: OnceLock<Mutex<HashMap<(u64, bool), Arc<reqwest::Client>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 取（或创建）共享 HTTP 客户端：同一配置的所有设备请求复用连接池。
pub fn client(timeout_secs: u64, allow_invalid_certs: bool) -> Result<Arc<reqwest::Client>, String> {
    let mut cache = client_cache().lock().unwrap_or_else(|e| e.into_inner());
    let key = (timeout_secs, allow_invalid_certs);
    if let Some(existing) = cache.get(&key) {
        return Ok(Arc::clone(existing));
    }
    // timeout_secs 来自每台服务器的配置（用户可控），不能让不同取值无限
    // 累积独立连接池；超过上限时淘汰一个已有条目（HashMap 无序，
    // 不保证是「最早」插入的那一项，但能确保总数有界）。
    const MAX_CACHED_CLIENTS: usize = 16;
    if cache.len() >= MAX_CACHED_CLIENTS {
        if let Some(oldest) = cache.keys().next().copied() {
            cache.remove(&oldest);
        }
    }
    let created = Arc::new(build_client(timeout_secs, allow_invalid_certs)?);
    cache.insert(key, Arc::clone(&created));
    Ok(created)
}

/// reqwest 顶层 Display 只有 "error sending request for url"，不含 source。
/// 展开错误链才能告诉用户「证书不受信任」这类真实原因。
pub fn error_detail(error: &reqwest::Error) -> String {
    let root: &(dyn std::error::Error + 'static) = error;
    let mut chain: Vec<String> = Vec::new();
    let mut current: Option<&(dyn std::error::Error + 'static)> = Some(root);
    while let Some(err) = current {
        chain.push(err.to_string());
        current = std::error::Error::source(err);
    }
    chain.join(" -> ")
}

// 错误提示分类与文案拼接仍由各设备模块维护（BMC 用 redfish_error_hint /
// format_redfish_error）；通用层只提供 error_detail 展开错误链，避免留下未接线的死代码。

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_cache_reuses_connection_pool_per_config() {
        let a = client(7, true).expect("client a");
        let b = client(7, true).expect("client b");
        assert!(Arc::ptr_eq(&a, &b));
        let c = client(7, false).expect("client c");
        assert!(!Arc::ptr_eq(&a, &c));
    }

    #[test]
    fn strict_and_permissive_clients_build_successfully() {
        assert!(build_client(5, false).is_ok());
        assert!(build_client(5, true).is_ok());
    }
}
