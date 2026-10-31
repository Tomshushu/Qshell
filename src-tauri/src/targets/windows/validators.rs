//! Windows 路径校验专用逻辑
//!
//! 复用 [`crate::validators`] 中的通用校验函数，仅提供 Windows 盘符路径校验入口。

use crate::validators::{validate_path_inner, ValidationResult};

/// 校验 Windows 绝对路径
///
/// - 强制要求盘符开头的绝对路径（如 `C:\Users\...` 或 `C:/Users/...`）
/// - 默认拒绝目录穿越（`..` 段），除非 `allow_traversal=true`
/// - 拒绝 null 字节、命令替换、shell 元字符、控制字符
///
/// 复用 `validate_path_inner(path, allow_traversal, true)`（is_windows=true）。
pub fn validate_windows_path(path: &str, allow_traversal: bool) -> ValidationResult {
    validate_path_inner(path, allow_traversal, true)
}

/// 将 POSIX 格式路径转换为 Windows 格式
pub fn posix_to_windows_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed == "/" {
        return "C:\\".to_string();
    }
    
    // 如果是以 / 开头，且第二个字符是盘符 X，第三个字符是冒号 :
    // 形如 /C:/ 或 /C:
    if trimmed.starts_with('/') && trimmed.len() >= 3 {
        let chars: Vec<char> = trimmed.chars().collect();
        if chars[1].is_ascii_alphabetic() && chars[2] == ':' {
            // 切除最前面的 '/'
            let rest = &trimmed[1..];
            let mut win_path = rest.replace('/', "\\");
            if win_path.len() == 2 {
                win_path.push('\\');
            }
            return win_path;
        }
    }
    
    // 其他情况直接替换斜杠
    trimmed.replace('/', "\\")
}

/// 将 Windows 格式路径转换为 POSIX 格式
pub fn windows_to_posix_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    // 确保以 / 开头，并且最前面是盘符的话如 C:/ 则返回 /C:/
    if normalized.starts_with('/') {
        normalized
    } else {
        // 如果是盘符开头如 C:/，转换为 /C:/
        let chars: Vec<char> = normalized.chars().collect();
        if chars.len() >= 2 && chars[0].is_ascii_alphabetic() && chars[1] == ':' {
            format!("/{}", normalized)
        } else {
            normalized
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_posix_to_windows_path() {
        assert_eq!(posix_to_windows_path("/"), "C:\\");
        assert_eq!(posix_to_windows_path("/C:/"), "C:\\");
        assert_eq!(posix_to_windows_path("/C:"), "C:\\");
        assert_eq!(posix_to_windows_path("/C:/Users/Admin"), "C:\\Users\\Admin");
        assert_eq!(posix_to_windows_path("/D:/data/logs"), "D:\\data\\logs");
        assert_eq!(posix_to_windows_path("E:/data/file.txt"), "E:\\data\\file.txt");
    }

    #[test]
    fn test_windows_to_posix_path() {
        assert_eq!(windows_to_posix_path("C:\\Users\\Admin"), "/C:/Users/Admin");
        assert_eq!(windows_to_posix_path("C:/Users/Admin"), "/C:/Users/Admin");
        assert_eq!(windows_to_posix_path("/C:/Users/Admin"), "/C:/Users/Admin");
        assert_eq!(windows_to_posix_path("relative/path"), "relative/path");
    }

    #[test]
    fn test_validate_windows_path() {
        let valid = validate_windows_path("C:\\Users\\Admin\\file.txt", false);
        assert!(valid.valid);
        assert!(valid.error.is_none());

        let forward_valid = validate_windows_path("C:/Users/Admin/file.txt", false);
        assert!(forward_valid.valid);

        let traversal = validate_windows_path("C:\\Users\\..\\Windows", false);
        assert!(!traversal.valid);

        let traversal_allowed = validate_windows_path("C:\\Users\\..\\Windows", true);
        assert!(traversal_allowed.valid);

        let non_windows = validate_windows_path("/etc/passwd", false);
        assert!(!non_windows.valid);

        let injection = validate_windows_path("C:\\Users\\`whoami`", false);
        assert!(!injection.valid);
    }
}
