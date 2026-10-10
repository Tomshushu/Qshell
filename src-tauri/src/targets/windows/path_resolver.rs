//! Windows 路径统一处理器
//!
//! 按 doc/Windows_SFTP_技术方案.md 设计：
//! - 统一内部表示为 `C:/Users/Admin`（正斜杠）
//! - SFTP 协议要求正斜杠
//! - Windows 原生命令要求反斜杠
//! - 前端使用 POSIX 形式 `/C:/Users/Admin`
//!
//! 禁止前端拼接路径，所有路径处理经此模块。

use serde::Serialize;

/// Windows 系统危险路径（禁止删除/递归操作）
const DANGEROUS_PATHS: &[&str] = &[
    "C:\\", "C:/",
    "C:\\Windows", "C:/Windows",
    "C:\\Program Files", "C:/Program Files",
    "C:\\Program Files (x86)", "C:/Program Files (x86)",
    "C:\\Users", "C:/Users",
    "C:\\ProgramData", "C:/ProgramData",
    "C:\\System Volume Information", "C:/System Volume Information",
];

/// 路径校验/转换错误
#[derive(Debug, Clone, Serialize)]
pub struct PathError {
    pub message: String,
}

impl PathError {
    pub fn new(msg: impl Into<String>) -> Self {
        Self { message: msg.into() }
    }
}

/// Windows 路径解析器
///
/// 所有路径在进入 SFTP/PowerShell 层之前必须经过 PathResolver 规范化。
/// 内部统一使用正斜杠 `C:/Users/Admin`，避免反斜杠导致的 SFTP write 失败。
pub struct PathResolver;

impl PathResolver {
    /// 将任意形式的 Windows 路径规范化为内部表示 `C:/Users/Admin`（正斜杠）
    ///
    /// 兼容输入：
    /// - `C:\Users\Admin` → `C:/Users/Admin`
    /// - `C:/Users/Admin` → `C:/Users/Admin`
    /// - `/C:/Users/Admin` → `C:/Users/Admin`
    /// - `/` → `C:/`（根路径默认 C 盘）
    pub fn normalize(path: &str) -> String {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return "C:/".to_string();
        }
        if trimmed == "/" {
            return "C:/".to_string();
        }
        // /C:/Users 形式 → 去掉前导 /
        if trimmed.starts_with('/') && trimmed.len() >= 3 {
            let chars: Vec<char> = trimmed.chars().collect();
            if chars[1].is_ascii_alphabetic() && chars[2] == ':' {
                let result = &trimmed[1..];
                return result.replace('\\', "/");
            }
        }
        // 普通转换：反斜杠 → 正斜杠
        trimmed.replace('\\', "/")
    }

    /// 转为 SFTP 协议路径（正斜杠）
    ///
    /// SFTP 协议规范要求正斜杠分隔符。
    /// Windows OpenSSH sftp-server.exe 对反斜杠路径的 write 操作可能返回 SSH_FX_FAILURE。
    pub fn to_sftp(path: &str) -> String {
        Self::normalize(path)
    }

    /// 转为 Windows 原生路径（反斜杠），用于 icacls 等 Windows 命令
    pub fn to_windows(path: &str) -> String {
        let normalized = Self::normalize(path);
        normalized.replace('/', "\\")
    }

    /// 转为前端 POSIX 形式 `/C:/Users/Admin`
    pub fn to_posix(path: &str) -> String {
        let normalized = Self::normalize(path);
        if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
            format!("/{}", normalized)
        } else {
            normalized
        }
    }

    /// 判断是否为盘符根路径（如 `C:/`、`C:\`）
    pub fn is_root(path: &str) -> bool {
        let normalized = Self::normalize(path);
        normalized.len() == 3 && normalized.ends_with('/')
    }

    /// 判断是否为系统危险路径（禁止删除/递归操作）
    pub fn is_dangerous(path: &str) -> bool {
        let normalized = Self::normalize(path);
        let trimmed = normalized.trim_end_matches('/');
        DANGEROUS_PATHS.iter().any(|p| {
            let p_normalized = p.replace('\\', "/");
            let p_trimmed = p_normalized.trim_end_matches('/');
            p_trimmed.eq_ignore_ascii_case(trimmed)
        })
    }

    /// 校验路径合法性
    pub fn validate(path: &str) -> Result<(), PathError> {
        let normalized = Self::normalize(path);
        if normalized.len() < 3 || normalized.as_bytes()[1] != b':' {
            return Err(PathError::new(format!(
                "Invalid Windows path (expected drive letter): {}",
                path
            )));
        }
        // 检查非法字符（不含路径分隔符）
        for ch in normalized.chars() {
            if ch == '*' || ch == '?' || ch == '"' || ch == '<' || ch == '>' || ch == '|' {
                return Err(PathError::new(format!(
                    "Invalid character '{}' in path: {}",
                    ch, path
                )));
            }
        }
        // 超长路径检查（Windows MAX_PATH 260，长路径 32767）
        if normalized.len() > 260 {
            return Err(PathError::new(format!(
                "Path too long ({} > 260): {}",
                normalized.len(),
                path
            )));
        }
        Ok(())
    }

    /// 获取父目录路径
    pub fn parent(path: &str) -> Option<String> {
        let normalized = Self::normalize(path);
        let trimmed = normalized.trim_end_matches('/');
        if let Some(pos) = trimmed.rfind('/') {
            if pos <= 2 {
                // 盘符根目录 C:/
                return Some(format!("{}/", &trimmed[..=1]));
            }
            return Some(trimmed[..pos].to_string());
        }
        None
    }

    /// 拼接路径
    pub fn join(base: &str, name: &str) -> String {
        let normalized_base = Self::normalize(base);
        let base_trimmed = normalized_base.trim_end_matches('/');
        if base_trimmed.is_empty() {
            return Self::normalize(name);
        }
        format!("{}/{}", base_trimmed, name)
    }

    /// 判断路径是否以 `.uploading` 结尾（临时文件）
    pub fn is_uploading_tmp(path: &str) -> bool {
        let normalized = Self::normalize(path);
        normalized.ends_with(".uploading") || normalized.contains(".sw-upload-tmp-")
    }

    /// 生成上传临时文件路径（满足 validators.rs 格式）
    pub fn uploading_tmp(path: &str) -> String {
        format!("{}.sw-upload-tmp-{}", Self::normalize(path), uuid::Uuid::new_v4())
    }

    /// 生成下载临时文件路径（本地用，满足 validators.rs 格式）
    pub fn downloading_tmp(path: &str) -> String {
        format!("{}.sw-dl-tmp-{}", path, uuid::Uuid::new_v4())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize() {
        assert_eq!(PathResolver::normalize("C:\\Users\\Admin"), "C:/Users/Admin");
        assert_eq!(PathResolver::normalize("C:/Users/Admin"), "C:/Users/Admin");
        assert_eq!(PathResolver::normalize("/C:/Users/Admin"), "C:/Users/Admin");
        assert_eq!(PathResolver::normalize("/"), "C:/");
        assert_eq!(PathResolver::normalize(""), "C:/");
    }

    #[test]
    fn test_to_sftp() {
        assert_eq!(PathResolver::to_sftp("C:\\Users\\Admin"), "C:/Users/Admin");
    }

    #[test]
    fn test_to_windows() {
        assert_eq!(PathResolver::to_windows("C:/Users/Admin"), "C:\\Users\\Admin");
    }

    #[test]
    fn test_to_posix() {
        assert_eq!(PathResolver::to_posix("C:\\Users\\Admin"), "/C:/Users/Admin");
        assert_eq!(PathResolver::to_posix("C:/Users/Admin"), "/C:/Users/Admin");
    }

    #[test]
    fn test_is_root() {
        assert!(PathResolver::is_root("C:\\"));
        assert!(PathResolver::is_root("C:/"));
        assert!(PathResolver::is_root("/C:/"));
        assert!(!PathResolver::is_root("C:/Users"));
    }

    #[test]
    fn test_is_dangerous() {
        assert!(PathResolver::is_dangerous("C:\\Windows"));
        assert!(PathResolver::is_dangerous("C:/Windows"));
        assert!(PathResolver::is_dangerous("C:\\"));
        assert!(!PathResolver::is_dangerous("C:/Users/Admin"));
    }

    #[test]
    fn test_parent() {
        assert_eq!(PathResolver::parent("C:/Users/Admin"), Some("C:/Users".to_string()));
        assert_eq!(PathResolver::parent("C:\\Users\\Admin"), Some("C:/Users".to_string()));
        assert_eq!(PathResolver::parent("C:/Users"), Some("C:/".to_string()));
    }

    #[test]
    fn test_join() {
        assert_eq!(PathResolver::join("C:/Users", "Admin"), "C:/Users/Admin");
        assert_eq!(PathResolver::join("C:/Users/", "Admin"), "C:/Users/Admin");
        assert_eq!(PathResolver::join("C:\\Users", "Admin"), "C:/Users/Admin");
    }

    #[test]
    fn test_uploading_tmp() {
        let tmp = PathResolver::uploading_tmp("C:/Users/Admin/file.txt");
        assert!(tmp.starts_with("C:/Users/Admin/file.txt.sw-upload-tmp-"));
        assert!(PathResolver::is_uploading_tmp(&tmp));
    }
}
