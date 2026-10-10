// 应用启动期一次性状态初始化
//
// master_key 由 OS Keychain 持久化保护：
// - Windows: Credential Manager (DPAPI)
// - macOS: Keychain
// - Linux: Secret Service (libsecret / GNOME Keyring / KWallet)
//
// 进程启动时从 keychain 读取 master_key（<1ms），
// 若不存在则生成 32 字节随机数并写入 keychain。
// master_key 仅保留在进程内存中，永不出 keychain。
//
// 不再使用本地文件存储 encryption_key，原因：
// - 文件存储等价于明文（chmod 600 仅阻挡其他用户，不阻挡本用户进程）
// - 数据库 + 文件同时泄露即可解密所有密码（无安全增益）
// - keychain 方案即使数据库泄露，攻击者也无法解密（master_key 在 OS 保护下）

use crate::crypto::MasterKey;
use keyring::Entry;

/// Keychain service 名称（应用标识）
const KEYCHAIN_SERVICE: &str = "qshell";
const LEGACY_KEYCHAIN_SERVICE: &str = "sw-ce-tauri";
/// Keychain user 名称（密钥标识）
const KEYCHAIN_USER: &str = "master-key";

/// 从 OS keychain 获取或创建 master key
///
/// 流程：
/// 1. 【仅 debug 构建】优先从环境变量 `QS_MASTER_KEY` / `SW_CE_MASTER_KEY` 读取（hex 编码，64 字符，用于测试/调试）
/// 2. 从 keychain 读取已存在的 master_key（hex 编码字符串）
/// 3. 若不存在，尝试从遗留的 `sw-ce-tauri` 服务读取并自动迁移至 `qshell`
/// 4. 仍不存在则生成 32 字节随机数，写入 keychain
///
/// 安全说明：
/// - release 构建中环境变量后门被完全禁用，防止父进程注入 master key 绕过 keychain
/// - keychain 不可用（如 Linux 无 secret service）会返回错误，应用应直接退出
pub fn get_or_create_master_key() -> Result<MasterKey, String> {
    // 1. 优先使用环境变量（仅 debug 构建允许，防止 release 被注入 master key）
    #[cfg(debug_assertions)]
    {
        let env_key = std::env::var("QS_MASTER_KEY").or_else(|_| std::env::var("SW_CE_MASTER_KEY"));
        if let Ok(hex_key) = env_key {
            if !hex_key.is_empty() {
                return parse_master_key_hex(&hex_key)
                    .map_err(|e| format!("Invalid master key env var: {}", e));
            }
        }
    }

    // 2. 尝试从 keychain 读取
    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER)
        .map_err(|e| format!("Keychain entry creation failed: {}", e))?;

    match entry.get_password() {
        Ok(stored) => {
            // 已有 master key，解析 hex
            parse_master_key_hex(&stored).map_err(|e| {
                format!(
                    "Stored master key is corrupted ({}). \
                     Delete it from OS keychain (service={}, user={}) and restart app.",
                    e, KEYCHAIN_SERVICE, KEYCHAIN_USER
                )
            })
        }
        Err(keyring::Error::NoEntry) => {
            // 2.1 尝试从旧版 keychain 服务平滑迁移
            if let Ok(legacy_entry) = Entry::new(LEGACY_KEYCHAIN_SERVICE, KEYCHAIN_USER) {
                if let Ok(legacy_stored) = legacy_entry.get_password() {
                    if let Ok(parsed) = parse_master_key_hex(&legacy_stored) {
                        println!(
                            "[Tauri] Migrating master key from legacy service ({}) to ({})",
                            LEGACY_KEYCHAIN_SERVICE, KEYCHAIN_SERVICE
                        );
                        let _ = entry.set_password(&legacy_stored);
                        return Ok(parsed);
                    }
                }
            }

            // 3. 不存在，生成新的 master key 并写入 keychain
            use rand::Rng;
            let mut key: MasterKey = [0u8; 32];
            rand::thread_rng().fill(&mut key);
            let key_hex = hex::encode(key);

            entry
                .set_password(&key_hex)
                .map_err(|e| format!("Failed to write master key to keychain: {}", e))?;

            println!(
                "[Tauri] Generated new master key and saved to OS keychain (service={}, user={})",
                KEYCHAIN_SERVICE, KEYCHAIN_USER
            );
            Ok(key)
        }
        Err(e) => Err(format!("Failed to read master key from keychain: {}", e)),
    }
}

/// 解析 hex 编码的 master key（必须 64 字符 = 32 字节）
fn parse_master_key_hex(hex_str: &str) -> Result<MasterKey, String> {
    let trimmed = hex_str.trim();
    if trimmed.len() != 64 {
        return Err(format!(
            "Master key hex must be 64 chars (32 bytes), got {}",
            trimmed.len()
        ));
    }
    let bytes = hex::decode(trimmed).map_err(|e| format!("Invalid hex: {}", e))?;
    if bytes.len() != 32 {
        return Err(format!("Decoded key must be 32 bytes, got {}", bytes.len()));
    }
    let mut key: MasterKey = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}
