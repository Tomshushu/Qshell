// 密码加密模块（方案 A：OS Keychain + AES-256-GCM）
//
// 设计要点：
// - master_key（32 字节随机数）由 OS keychain 持久化保护，进程启动时读入内存
// - 数据库中的密码用 master_key + AES-256-GCM 加密
// - 每条密文使用独立的 12 字节随机 nonce（GCM 标准要求）
// - GCM 提供 AEAD（认证加密），同时保证机密性和完整性
// - 无 KDF 开销：单次解密 < 1ms，完全消除 argon2id 的 1.3s 延迟
//
// 密文格式：`v1:<nonce_hex>:<ciphertext_hex>`
// - nonce: 12 字节（24 hex 字符）
// - ciphertext: 包含明文 + 16 字节 GCM 认证 tag

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::Rng;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::Zeroize;

/// AES-256-GCM nonce 长度（标准为 12 字节）
const NONCE_LEN: usize = 12;
/// AES-256 主密钥长度
pub const MASTER_KEY_LEN: usize = 32;
/// 主密钥类型（32 字节随机数）
pub type MasterKey = [u8; MASTER_KEY_LEN];

/// 格式前缀，用于版本识别与未来升级
const V1_PREFIX: &str = "v1";

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("Encryption failed: {0}")]
    EncryptionFailed(String),
    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),
    #[error("Invalid encrypted format: {0}")]
    InvalidFormat(String),
}

/// Encrypt a password using AES-256-GCM with the application master key.
///
/// 输出格式：`v1:<nonce_hex>:<ciphertext_hex>`
/// - 每次加密生成新的随机 nonce（GCM 安全性要求 nonce 不重复）
/// - ciphertext 末尾包含 16 字节 GCM 认证 tag
pub fn encrypt_password(password: &str, master_key: &MasterKey) -> Result<String, CryptoError> {
    if password.is_empty() {
        return Ok(String::new());
    }

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(master_key));
    let nonce_bytes: [u8; NONCE_LEN] = rand::thread_rng().gen();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, password.as_bytes())
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

    Ok(format!(
        "{}:{}:{}",
        V1_PREFIX,
        hex::encode(nonce_bytes),
        hex::encode(&ciphertext)
    ))
}

/// Decrypt a password using AES-256-GCM with the application master key.
///
/// 支持格式：`v1:<nonce_hex>:<ciphertext_hex>`
///
/// GCM 的认证 tag 会在解密时自动校验，若密文被篡改则返回 DecryptionFailed。
pub fn decrypt_password(encrypted: &str, master_key: &MasterKey) -> Result<String, CryptoError> {
    if encrypted.is_empty() {
        return Ok(String::new());
    }

    // 兼容旧数据（argon2id: 前缀）：用户已确认不兼容，直接报错
    if encrypted.starts_with("argon2id:") {
        return Err(CryptoError::InvalidFormat(
            "Legacy argon2id format detected. Please re-add the server (migration not supported).".into(),
        ));
    }

    let data = encrypted
        .strip_prefix(&format!("{}:", V1_PREFIX))
        .ok_or_else(|| CryptoError::InvalidFormat("Encrypted data must start with 'v1:' prefix".into()))?;

    let parts: Vec<&str> = data.split(':').collect();
    if parts.len() != 2 {
        return Err(CryptoError::InvalidFormat(format!(
            "Expected 2 parts (nonce:ciphertext), got {}",
            parts.len()
        )));
    }

    let nonce_bytes = hex::decode(parts[0])
        .map_err(|e| CryptoError::InvalidFormat(format!("Invalid nonce hex: {}", e)))?;
    let ciphertext = hex::decode(parts[1])
        .map_err(|e| CryptoError::InvalidFormat(format!("Invalid ciphertext hex: {}", e)))?;

    if nonce_bytes.len() != NONCE_LEN {
        return Err(CryptoError::InvalidFormat(format!(
            "Nonce must be {} bytes, got {}",
            NONCE_LEN,
            nonce_bytes.len()
        )));
    }

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(master_key));
    let nonce = Nonce::from_slice(&nonce_bytes);
    let mut plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|e| CryptoError::DecryptionFailed(format!("AES-GCM decrypt failed: {}", e)))?;

    let res = match std::str::from_utf8(&plaintext) {
        Ok(s) => Ok(s.to_string()),
        Err(e) => Err(CryptoError::DecryptionFailed(format!("UTF-8 decode failed: {}", e))),
    };
    plaintext.zeroize();
    res
}

// ============================================================================
// 导出包加密（argon2id 派生 + AES-256-GCM）
//
// 用于服务器列表导出/导入场景：
// - 导出：master_key 解密密码为明文 -> 用"导出密码"+argon2id 派生 export_key -> AES-256-GCM 加密
// - 导入：用"导出密码"+argon2id 派生 export_key -> AES-256-GCM 解密 -> master_key 重新加密入库
//
// 与应用内 master_key 加密分离：导出包必须可在不同机器间迁移，
// 密钥不依赖 OS keychain，由用户记忆的导出密码保护。
// ============================================================================

/// 导出加密 KDF 参数（argon2id: m=64MB, t=3, p=1）
///
/// - m_cost 单位为 KiB，65536 KiB = 64 MB（OWASP 推荐最低值）
/// - t_cost=3 是 OWASP 对 m=64MB 场景的推荐迭代次数
/// - p_cost=1 适合单线程派生
const EXPORT_SALT_LEN: usize = 16;
const EXPORT_KEY_LEN: usize = 32;
const EXPORT_M_COST: u32 = 65536;
const EXPORT_T_COST: u32 = 3;
const EXPORT_P_COST: u32 = 1;

/// 导入解密时允许的 argon2id 参数下限。
///
/// 防止参数降级攻击：恶意导出包可在文件中声明极小的 m_cost/t_cost，
/// 使 KDF 变得极其廉价，便于离线暴破。解密前必须校验文件中的参数不低于此下限。
const MIN_EXPORT_M_COST: u32 = 65536;
const MIN_EXPORT_T_COST: u32 = 3;
const MIN_EXPORT_P_COST: u32 = 1;
const MAX_EXPORT_M_COST: u32 = 262144;
const MAX_EXPORT_T_COST: u32 = 10;
const MAX_EXPORT_P_COST: u32 = 4;

/// 导出包加密元数据（与密码学相关的字段，无业务字段）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCryptData {
    /// KDF 算法名（"argon2id"）
    pub algorithm: String,
    /// argon2id salt（hex）
    pub salt: String,
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
    /// AES-256-GCM nonce（hex，12 字节）
    pub nonce: String,
    /// AES-256-GCM 密文（hex，含 16 字节 GCM tag）
    pub payload: String,
}

/// 用导出密码派生 32 字节 AES key
fn derive_export_key(password: &str, salt: &[u8], m_cost: u32, t_cost: u32, p_cost: u32) -> Result<[u8; EXPORT_KEY_LEN], CryptoError> {
    let params = Params::new(m_cost, t_cost, p_cost, Some(EXPORT_KEY_LEN))
        .map_err(|e| CryptoError::EncryptionFailed(format!("Invalid argon2 params: {}", e)))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; EXPORT_KEY_LEN];
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| CryptoError::EncryptionFailed(format!("argon2id derive failed: {}", e)))?;
    Ok(key)
}

/// 用导出密码加密明文 payload（通常为 JSON 字符串）
///
/// 流程：
/// 1. 生成随机 16 字节 salt
/// 2. argon2id 派生 32 字节 export_key
/// 3. AES-256-GCM 加密 plaintext
///
/// 返回的 ExportCryptData 可由调用方包装为完整 envelope 写入文件
pub fn encrypt_export(plaintext: &str, password: &str) -> Result<ExportCryptData, CryptoError> {
    let salt: [u8; EXPORT_SALT_LEN] = rand::thread_rng().gen();
    let mut key = derive_export_key(password, &salt, EXPORT_M_COST, EXPORT_T_COST, EXPORT_P_COST)?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    key.zeroize();
    let nonce_bytes: [u8; NONCE_LEN] = rand::thread_rng().gen();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| CryptoError::EncryptionFailed(format!("AES-GCM encrypt failed: {}", e)))?;

    Ok(ExportCryptData {
        algorithm: "argon2id".to_string(),
        salt: hex::encode(salt),
        m_cost: EXPORT_M_COST,
        t_cost: EXPORT_T_COST,
        p_cost: EXPORT_P_COST,
        nonce: hex::encode(nonce_bytes),
        payload: hex::encode(&ciphertext),
    })
}

/// 用导出密码解密 ExportCryptData，返回明文 JSON 字符串
///
/// 解密失败原因可能是：
/// - 密码错误（GCM 认证 tag 校验失败）
/// - 文件被篡改（GCM 检测到密文修改）
/// - 格式错误（hex 解码失败、参数无效）
pub fn decrypt_export(data: &ExportCryptData, password: &str) -> Result<String, CryptoError> {
    if data.algorithm != "argon2id" {
        return Err(CryptoError::InvalidFormat(format!(
            "Unknown KDF algorithm: {} (expected: argon2id)",
            data.algorithm
        )));
    }

    // 防止参数降级攻击：拒绝低于安全下限的 KDF 参数
    // 恶意导出包可能声明 m_cost=8 等极小值使 KDF 廉价，便于离线暴破
    if data.m_cost < MIN_EXPORT_M_COST
        || data.t_cost < MIN_EXPORT_T_COST
        || data.p_cost < MIN_EXPORT_P_COST
        || data.m_cost > MAX_EXPORT_M_COST
        || data.t_cost > MAX_EXPORT_T_COST
        || data.p_cost > MAX_EXPORT_P_COST
    {
        return Err(CryptoError::InvalidFormat(format!(
            "Insecure KDF parameters in export file (m={}, t={}, p={}). \
             Minimum required: m>={}, t>={}, p>={}. \
             The file may be tampered or created by an outdated version.",
            data.m_cost, data.t_cost, data.p_cost,
            MIN_EXPORT_M_COST, MIN_EXPORT_T_COST, MIN_EXPORT_P_COST
        )));
    }

    let salt = hex::decode(&data.salt)
        .map_err(|e| CryptoError::InvalidFormat(format!("Invalid salt hex: {}", e)))?;
    let mut key = derive_export_key(password, &salt, data.m_cost, data.t_cost, data.p_cost)?;

    let nonce_bytes = hex::decode(&data.nonce)
        .map_err(|e| CryptoError::InvalidFormat(format!("Invalid nonce hex: {}", e)))?;
    if nonce_bytes.len() != NONCE_LEN {
        key.zeroize();
        return Err(CryptoError::InvalidFormat(format!(
            "Nonce must be {} bytes, got {}",
            NONCE_LEN,
            nonce_bytes.len()
        )));
    }
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = hex::decode(&data.payload)
        .map_err(|e| {
            key.zeroize();
            CryptoError::InvalidFormat(format!("Invalid payload hex: {}", e))
        })?;

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    key.zeroize();
    let mut plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|e| CryptoError::DecryptionFailed(format!(
            "AES-GCM decrypt failed (wrong password or tampered): {}",
            e
        )))?;

    let res = match std::str::from_utf8(&plaintext) {
        Ok(s) => Ok(s.to_string()),
        Err(e) => Err(CryptoError::DecryptionFailed(format!("UTF-8 decode failed: {}", e))),
    };
    plaintext.zeroize();
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_key() -> MasterKey {
        // 测试用固定 key（32 字节）
        let mut key = [0u8; MASTER_KEY_LEN];
        for (i, b) in key.iter_mut().enumerate() {
            *b = (i as u8).wrapping_mul(7).wrapping_add(13);
        }
        key
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = test_key();
        let password = "mySecretPassword123!";
        let encrypted = encrypt_password(password, &key).unwrap();
        let decrypted = decrypt_password(&encrypted, &key).unwrap();
        assert_eq!(decrypted, password);
    }

    #[test]
    fn test_encrypted_format() {
        let key = test_key();
        let password = "formatTest123";
        let encrypted = encrypt_password(password, &key).unwrap();
        // 格式: v1:nonce_hex:ciphertext_hex
        assert!(encrypted.starts_with("v1:"));
        let rest = encrypted.strip_prefix("v1:").unwrap();
        let parts: Vec<&str> = rest.split(':').collect();
        assert_eq!(parts.len(), 2);
        // Nonce should be 24 hex chars (12 bytes)
        assert_eq!(parts[0].len(), 24);
        // All parts should be valid hex
        assert!(hex::decode(parts[0]).is_ok());
        assert!(hex::decode(parts[1]).is_ok());
    }

    #[test]
    fn test_random_nonce_each_time() {
        let key = test_key();
        let password = "samePassword";
        let enc1 = encrypt_password(password, &key).unwrap();
        let enc2 = encrypt_password(password, &key).unwrap();
        // 不同的 nonce 应产生不同的 ciphertext
        assert_ne!(enc1, enc2);
        // 但都能解密回原值
        assert_eq!(decrypt_password(&enc1, &key).unwrap(), password);
        assert_eq!(decrypt_password(&enc2, &key).unwrap(), password);
    }

    #[test]
    fn test_special_characters() {
        let key = test_key();
        let passwords = vec![
            "!@#$%^&*()_+-=[]{}|;:,.<>?",
            "tab\there",
            "quote\"here",
            "apostrophe'here",
            "backslash\\here",
            "中文密码测试",
        ];
        for password in passwords {
            let encrypted = encrypt_password(password, &key).unwrap();
            let decrypted = decrypt_password(&encrypted, &key).unwrap();
            assert_eq!(decrypted, password, "Failed for: {}", password);
        }
    }

    #[test]
    fn test_empty_password() {
        let key = test_key();
        let result = encrypt_password("", &key).unwrap();
        assert_eq!(result, "");
        // 解密空字符串也应返回空字符串
        let decrypted = decrypt_password("", &key).unwrap();
        assert_eq!(decrypted, "");
    }

    #[test]
    fn test_malformed_encrypted_data() {
        let key = test_key();
        // 缺少 v1: 前缀
        assert!(decrypt_password("notencrypted", &key).is_err());
        assert!(decrypt_password("nonce:ciphertext", &key).is_err());
        // 前缀存在但格式错误
        assert!(decrypt_password("v1:invalid", &key).is_err());
        assert!(decrypt_password("v1:only:two:three", &key).is_err());
        assert!(decrypt_password("v1::missing", &key).is_err());
        assert!(decrypt_password("v1:missing:", &key).is_err());
        // 旧 argon2id 格式应明确报错
        assert!(decrypt_password("argon2id:deadbeef:cafe:babe", &key).is_err());
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let key = test_key();
        let password = "secret";
        let encrypted = encrypt_password(password, &key).unwrap();
        // 篡改 ciphertext 最后一个字符
        let mut tampered = encrypted.clone();
        let last_char_idx = tampered.len() - 1;
        let last_char = tampered.chars().last().unwrap();
        let replacement = if last_char == '0' { '1' } else { '0' };
        tampered.replace_range(last_char_idx.., &replacement.to_string());
        // GCM 认证 tag 校验失败
        assert!(decrypt_password(&tampered, &key).is_err());
    }

    #[test]
    fn test_wrong_key_fails() {
        let key1 = test_key();
        let mut key2 = test_key();
        key2[0] = key2[0].wrapping_add(1);

        let password = "secret";
        let encrypted = encrypt_password(password, &key1).unwrap();
        // 用错误的 key 解密应失败（GCM 认证）
        assert!(decrypt_password(&encrypted, &key2).is_err());
    }

    // ==================== 导出包加解密测试 ====================

    #[test]
    fn test_export_roundtrip() {
        let payload = r#"[{"name":"server1","host":"192.168.1.1","password":"p@ssw0rd"}]"#;
        let export_password = "export-pass-123";
        let data = encrypt_export(payload, export_password).unwrap();
        let decrypted = decrypt_export(&data, export_password).unwrap();
        assert_eq!(decrypted, payload);
    }

    #[test]
    fn test_export_wrong_password_fails() {
        let payload = r#"{"name":"test"}"#;
        let data = encrypt_export(payload, "correct-pass").unwrap();
        // 错误密码应导致 GCM 认证失败
        assert!(decrypt_export(&data, "wrong-pass").is_err());
    }

    #[test]
    fn test_export_chinese_password() {
        let payload = r#"{"name":"中文服务器","password":"密码"}"#;
        let data = encrypt_export(payload, "中文导出密码").unwrap();
        let decrypted = decrypt_export(&data, "中文导出密码").unwrap();
        assert_eq!(decrypted, payload);
    }

    #[test]
    fn test_export_tampered_payload_fails() {
        let payload = r#"{"name":"test"}"#;
        let mut data = encrypt_export(payload, "pass").unwrap();
        // 篡改 payload 最后一个字符
        let last = data.payload.chars().last().unwrap();
        let replacement = if last == '0' { '1' } else { '0' };
        let mut tampered = data.payload.clone();
        tampered.pop();
        tampered.push(replacement);
        data.payload = tampered;
        assert!(decrypt_export(&data, "pass").is_err());
    }

    #[test]
    fn test_export_unknown_algorithm_fails() {
        let data = ExportCryptData {
            algorithm: "pbkdf2".to_string(),
            salt: hex::encode([0u8; 16]),
            m_cost: 65536,
            t_cost: 3,
            p_cost: 1,
            nonce: hex::encode([0u8; 12]),
            payload: hex::encode([0u8; 16]),
        };
        assert!(decrypt_export(&data, "pass").is_err());
    }
}
