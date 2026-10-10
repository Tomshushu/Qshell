//! SSH 密钥统一管理：格式检测、加载、生成、保存
//!
//! 对齐 Termius / MobaXterm / SecureCRT 的密钥能力：
//! - 支持 OpenSSH / PEM (PKCS#1/PKCS#5/PKCS#8) 标准格式（russh-keys 原生）
//! - 支持 PuTTY PPK 格式（通过 ssh-key crate 的 ppk feature）
//! - 应用内生成 Ed25519 / RSA / ECDSA 密钥对
//! - 保存为 OpenSSH 格式（兼容服务器端 authorized_keys）
//!
//! 设计要点：
//! - 不破坏现有 `load_secret_key` 调用路径，提供统一 `load_key_pair` 入口
//! - PPK 解析后转换为 russh::keys::key::KeyPair，复用 authenticate_publickey 流程
//! - 密钥生成直接使用 ssh-key 0.7 的 `PrivateKey::random` API，无需手动构造

use std::path::Path;

use russh::keys::key::KeyPair;

/// 密钥文件格式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyFormat {
    /// OpenSSH 私钥（`-----BEGIN OPENSSH PRIVATE KEY-----`）
    OpenSsh,
    /// PEM PKCS#1 RSA（`-----BEGIN RSA PRIVATE KEY-----`）
    PemRsa,
    /// PEM PKCS#1 EC（`-----BEGIN EC PRIVATE KEY-----`）
    PemEc,
    /// PEM PKCS#8（`-----BEGIN PRIVATE KEY-----` 或加密变体）
    Pkcs8,
    /// PuTTY 私钥（`PuTTY-User-Key-File-:`）
    Ppk,
    /// 未知格式
    Unknown,
}

impl KeyFormat {
    /// 人类可读名称（用于错误提示）
    pub fn display_name(&self) -> &'static str {
        match self {
            KeyFormat::OpenSsh => "OpenSSH",
            KeyFormat::PemRsa => "PEM (PKCS#1 RSA)",
            KeyFormat::PemEc => "PEM (PKCS#1 EC)",
            KeyFormat::Pkcs8 => "PEM (PKCS#8)",
            KeyFormat::Ppk => "PuTTY PPK",
            KeyFormat::Unknown => "未知",
        }
    }
}

/// 通过文件头嗅探密钥格式（不解析内容，仅看首行）
pub fn detect_key_format(content: &str) -> KeyFormat {
    let trimmed = content.trim_start();
    if trimmed.starts_with("PuTTY-User-Key-File-") {
        KeyFormat::Ppk
    } else if trimmed.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----") {
        KeyFormat::OpenSsh
    } else if trimmed.starts_with("-----BEGIN RSA PRIVATE KEY-----") {
        KeyFormat::PemRsa
    } else if trimmed.starts_with("-----BEGIN EC PRIVATE KEY-----") {
        KeyFormat::PemEc
    } else if trimmed.starts_with("-----BEGIN PRIVATE KEY-----")
        || trimmed.starts_with("-----BEGIN ENCRYPTED PRIVATE KEY-----")
    {
        KeyFormat::Pkcs8
    } else {
        KeyFormat::Unknown
    }
}

/// 加载私钥，自动识别格式（PPK / OpenSSH / PEM PKCS#1 / PKCS#8）
///
/// - 标准 OpenSSH/PEM 格式：委托给 `russh_keys::load_secret_key`
/// - PuTTY PPK 格式：通过 `ssh_key::PrivateKey::from_ppk` 解析后转换为 russh KeyPair
///
/// `passphrase` 用于解密加密的私钥（OpenSSH/PEM 加密或 PPK 加密）
pub fn load_key_pair(
    path: &Path,
    passphrase: Option<&str>,
) -> Result<KeyPair, KeyLoadError> {
    let content = std::fs::read_to_string(path).map_err(KeyLoadError::Io)?;

    let format = detect_key_format(&content);
    tracing::debug!(
        "[SSH Key] 加载私钥 {:?} 检测格式: {:?}",
        path,
        format
    );

    let clean_pass = passphrase.filter(|s| !s.is_empty());

    match format {
        KeyFormat::Ppk => load_ppk_key(&content, clean_pass),
        // OpenSSH / PEM / PKCS#8 全部走 russh-keys 原生路径
        KeyFormat::OpenSsh | KeyFormat::PemRsa | KeyFormat::PemEc | KeyFormat::Pkcs8 | KeyFormat::Unknown => {
            match russh::keys::load_secret_key(path, clean_pass) {
                Ok(kp) => Ok(kp),
                Err(e) if clean_pass.is_some() && e.to_string().contains("already decrypted") => {
                    tracing::debug!("[SSH Key] 私钥本身未加密，回退为无密码加载");
                    russh::keys::load_secret_key(path, None).map_err(KeyLoadError::RusshKeys)
                }
                Err(e) => Err(KeyLoadError::RusshKeys(e)),
            }
        }
    }
}

/// 从内容字符串加载私钥（content-based，不依赖文件路径）
///
/// 与 `load_key_pair` 的区别：
/// - `load_key_pair` 接受文件路径，内部 `read_to_string` 后解析
/// - `load_key_pair_from_content` 接受已读取的私钥内容字符串
///
/// 用于阶段 3 content-based 连接：私钥内容加密存储在 `ssh_keys` 表，
/// 连接时解密后直接传入此函数，无需访问原始文件。
///
/// `passphrase` 用于解密加密的私钥（OpenSSH/PEM 加密或 PPK 加密）
pub fn load_key_pair_from_content(
    content: &str,
    passphrase: Option<&str>,
) -> Result<KeyPair, KeyLoadError> {
    let format = detect_key_format(content);
    tracing::debug!(
        "[SSH Key] 从内容加载私钥，检测格式: {:?}",
        format
    );

    let clean_pass = passphrase.filter(|s| !s.is_empty());

    match format {
        KeyFormat::Ppk => load_ppk_key(content, clean_pass),
        // OpenSSH / PEM / PKCS#8 使用 decode_secret_key（接受字符串内容）
        KeyFormat::OpenSsh | KeyFormat::PemRsa | KeyFormat::PemEc | KeyFormat::Pkcs8 | KeyFormat::Unknown => {
            match russh::keys::decode_secret_key(content, clean_pass) {
                Ok(kp) => Ok(kp),
                Err(e) if clean_pass.is_some() && e.to_string().contains("already decrypted") => {
                    tracing::debug!("[SSH Key] 私钥本身未加密，回退为无密码加载");
                    russh::keys::decode_secret_key(content, None).map_err(KeyLoadError::RusshKeys)
                }
                Err(e) => Err(KeyLoadError::RusshKeys(e)),
            }
        }
    }
}

/// 解析 PuTTY PPK 格式私钥并转换为 russh KeyPair
///
/// PPK 格式是 MobaXterm / PuTTYgen 的原生格式，russh-keys 0.45 不支持。
/// 通过 ssh-key crate 的 `ppk` feature 解析，再转换为 russh 内部的 KeyPair。
fn load_ppk_key(content: &str, passphrase: Option<&str>) -> Result<KeyPair, KeyLoadError> {
    use ssh_key::PrivateKey;

    // ssh-key 0.7 的 from_ppk 接受 Option<String>
    let pass = passphrase.map(|s| s.to_string());
    let ppk = PrivateKey::from_ppk(content, pass).map_err(|e| {
        KeyLoadError::PpkParse(format!("PPK 解析失败: {}", e))
    })?;

    // 将 ssh_key::PrivateKey 转换为 russh_keys::key::KeyPair
    // 路径：ssh_key::PrivateKey -> 编码为 OpenSSH 字符串 -> russh_keys::decode_secret_key
    let openssh_encoded = ppk
        .to_openssh(ssh_key::LineEnding::LF)
        .map_err(|e| KeyLoadError::PpkParse(format!("PPK 转 OpenSSH 编码失败: {}", e)))?;

    russh::keys::decode_secret_key(&openssh_encoded, None).map_err(|e| {
        KeyLoadError::PpkConvert(format!("PPK 转换为内部 KeyPair 失败: {}", e))
    })
}

/// 密钥加载错误（携带格式信息，便于 UI 给出清晰提示）
#[derive(Debug, thiserror::Error)]
pub enum KeyLoadError {
    #[error("读取文件失败: {0}")]
    Io(#[from] std::io::Error),
    #[error("密钥解析失败: {0}")]
    RusshKeys(#[from] russh::keys::Error),
    #[error("PPK 格式错误: {0}")]
    PpkParse(String),
    #[error("PPK 转换错误: {0}")]
    PpkConvert(String),
}

impl KeyLoadError {
    /// 返回人类可读的错误说明，包含修复建议（用于 UI 显示）
    pub fn user_friendly_message(&self) -> String {
        match self {
            KeyLoadError::Io(e) => {
                if e.kind() == std::io::ErrorKind::NotFound {
                    "私钥文件不存在，请检查路径".to_string()
                } else if e.kind() == std::io::ErrorKind::PermissionDenied {
                    "无权限读取私钥文件，请检查文件权限".to_string()
                } else {
                    format!("读取私钥文件失败: {}", e)
                }
            }
            KeyLoadError::RusshKeys(e) => {
                let msg = format!("{}", e);
                if msg.contains("encrypted") {
                    "私钥已加密，请提供正确的解密密码 (Passphrase)".to_string()
                } else if msg.contains("Could not read key") {
                    "私钥格式无法识别，请确认文件内容完整且为有效的私钥".to_string()
                } else {
                    format!("私钥解析失败: {}", e)
                }
            }
            KeyLoadError::PpkParse(msg) => {
                if msg.contains("MAC") || msg.contains("decrypt") {
                    format!("PPK 密钥解密失败，请检查密码: {}", msg)
                } else {
                    format!("PPK 格式解析失败: {}。请确认文件由 PuTTYgen 生成且版本为 2 或 3", msg)
                }
            }
            KeyLoadError::PpkConvert(msg) => {
                format!("PPK 密钥转换为内部格式失败: {}。该密钥类型可能暂不支持", msg)
            }
        }
    }
}

// ============================================================================
// 密钥生成（直接使用 ssh-key 0.7 的原生 API）
// ============================================================================

/// 密钥算法（用于生成）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyAlgorithm {
    Ed25519,
    /// RSA，bits 指定位数（通常 2048/3072/4096）
    Rsa { bits: u32 },
    /// ECDSA NIST P-256 曲线
    EcdsaP256,
    /// ECDSA NIST P-384 曲线
    EcdsaP384,
}

impl KeyAlgorithm {
    pub fn display_name(&self) -> &'static str {
        match self {
            KeyAlgorithm::Ed25519 => "Ed25519",
            KeyAlgorithm::Rsa { .. } => "RSA",
            KeyAlgorithm::EcdsaP256 => "ECDSA-P256",
            KeyAlgorithm::EcdsaP384 => "ECDSA-P384",
        }
    }

    /// 转换为 ssh-key 0.7 的 Algorithm 枚举
    ///
    /// 注: ssh-key 0.7 的 `Algorithm::Rsa` 只有 `hash` 字段，没有 `keystrength`。
    /// RSA 位长由 ssh-key 内部固定为 DEFAULT_RSA_KEY_SIZE（3072）。
    /// 如需自定义位数，应使用 russh_keys::KeyPair::generate_rsa。
    fn to_ssh_algorithm(self) -> ssh_key::Algorithm {
        match self {
            KeyAlgorithm::Ed25519 => ssh_key::Algorithm::Ed25519,
            KeyAlgorithm::Rsa { .. } => ssh_key::Algorithm::Rsa { hash: None },
            KeyAlgorithm::EcdsaP256 => ssh_key::Algorithm::Ecdsa {
                curve: ssh_key::EcdsaCurve::NistP256,
            },
            KeyAlgorithm::EcdsaP384 => ssh_key::Algorithm::Ecdsa {
                curve: ssh_key::EcdsaCurve::NistP384,
            },
        }
    }
}

/// 生成密钥对并保存为 OpenSSH 格式文件
///
/// 使用 ssh-key 0.7 的 `PrivateKey::random` API 生成密钥，
/// 然后通过 `to_openssh` 序列化为 OpenSSH 格式私钥文件。
///
/// - `algorithm`: 密钥算法（Ed25519/RSA/ECDSA）
/// - `save_path`: 私钥文件保存路径（覆盖）
/// - `passphrase`: 非空时使用 OpenSSH 原生加密（bcrypt-pbkdf + aes256-ctr）
/// - `comment`: 注释，写入私钥末尾和 .pub 文件
///
/// 同时写入对应的 `.pub` 公钥文件。
/// Unix 平台自动设置私钥文件权限为 0600。
pub fn generate_and_save_key(
    algorithm: KeyAlgorithm,
    save_path: &Path,
    passphrase: Option<&str>,
    comment: &str,
) -> Result<GeneratedKey, String> {
    use ssh_key::PrivateKey;
    // ssh-key 0.7 依赖 rand_core 0.10，OsRng 已被移除，改用 getrandom::SysRng + UnwrapErr
    // UnwrapErr 将 TryCryptoRng (可能失败) 适配为 CryptoRng (panic on error)
    use ssh_key::getrandom::SysRng;
    use ssh_key::rand_core::UnwrapErr;

    // 生成密钥
    let mut rng = UnwrapErr(SysRng);
    let ssh_algo = algorithm.to_ssh_algorithm();
    let mut private_key = PrivateKey::random(&mut rng, ssh_algo)
        .map_err(|e| format!("密钥生成失败: {}", e))?;

    // 设置注释
    if !comment.is_empty() {
        private_key.set_comment(comment);
    }

    // 如有 passphrase，加密私钥
    let final_content = if let Some(pass) = passphrase {
        if !pass.is_empty() {
            // encrypt 接受 TryCryptoRng，SysRng 直接满足
            let mut enc_rng = ssh_key::getrandom::SysRng;
            let encrypted = private_key
                .encrypt(&mut enc_rng, pass)
                .map_err(|e| format!("私钥加密失败: {}", e))?;
            encrypted
                .to_openssh(ssh_key::LineEnding::LF)
                .map_err(|e| format!("加密私钥序列化失败: {}", e))?
                .to_string()
        } else {
            private_key
                .to_openssh(ssh_key::LineEnding::LF)
                .map_err(|e| format!("私钥序列化失败: {}", e))?
                .to_string()
        }
    } else {
        private_key
            .to_openssh(ssh_key::LineEnding::LF)
            .map_err(|e| format!("私钥序列化失败: {}", e))?
            .to_string()
    };

    // 写入私钥文件
    std::fs::write(save_path, final_content.as_bytes())
        .map_err(|e| format!("写入私钥文件失败: {}", e))?;

    // 设置文件权限为 0600（仅 Unix）
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(save_path)
            .map_err(|e| format!("读取文件元数据失败: {}", e))?
            .permissions();
        perms.set_mode(0o600);
        let _ = std::fs::set_permissions(save_path, perms);
    }

    // 生成并写入 .pub 公钥文件
    let pub_path = save_path.with_extension("pub");
    let pub_key = private_key.public_key();
    let pub_key_str = if comment.is_empty() {
        format!("{}\n", pub_key.to_openssh().map_err(|e| format!("公钥序列化失败: {}", e))?)
    } else {
        format!("{} {}\n", pub_key.to_openssh().map_err(|e| format!("公钥序列化失败: {}", e))?, comment)
    };
    std::fs::write(&pub_path, pub_key_str.as_bytes())
        .map_err(|e| format!("写入公钥文件失败: {}", e))?;

    Ok(GeneratedKey {
        private_key_path: save_path.to_string_lossy().to_string(),
        public_key_path: pub_path.to_string_lossy().to_string(),
        public_key: pub_key_str.trim().to_string(),
        algorithm: algorithm.display_name().to_string(),
    })
}

/// 生成密钥的结果
#[derive(Debug, Clone)]
pub struct GeneratedKey {
    /// 私钥文件绝对路径
    pub private_key_path: String,
    /// 公钥文件绝对路径（`*.pub`）
    pub public_key_path: String,
    /// 公钥字符串（`ssh-ed25519 AAAA... comment`，便于直接复制到 authorized_keys）
    pub public_key: String,
    /// 算法显示名（如 `Ed25519` / `RSA`）
    pub algorithm: String,
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_openssh_format() {
        let content = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA...\n-----END OPENSSH PRIVATE KEY-----\n";
        assert_eq!(detect_key_format(content), KeyFormat::OpenSsh);
    }

    #[test]
    fn test_detect_ppk_format() {
        let content = "PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\nComment: test\nPublic-Lines: 2\n";
        assert_eq!(detect_key_format(content), KeyFormat::Ppk);
    }

    #[test]
    fn test_detect_pem_rsa_format() {
        let content = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----\n";
        assert_eq!(detect_key_format(content), KeyFormat::PemRsa);
    }

    #[test]
    fn test_detect_unknown_format() {
        let content = "this is not a key";
        assert_eq!(detect_key_format(content), KeyFormat::Unknown);
    }
}
