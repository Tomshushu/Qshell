//! Linux 路径校验专用逻辑
//!
//! 复用 [`crate::validators`] 中的通用校验函数（如 `escape_shell_arg`、
//! `validate_service_name`、`validate_pid` 等），仅提供 Linux POSIX 路径校验入口。

use crate::validators::{validate_path_inner, ValidationResult};

/// 校验 Linux POSIX 绝对路径
///
/// - 强制要求以 `/` 开头的绝对路径
/// - 默认拒绝目录穿越（`..` 段），除非 `allow_traversal=true`
/// - 拒绝 null 字节、命令替换、shell 元字符、控制字符
///
/// 复用 `validate_path_inner(path, allow_traversal, false)`（is_windows=false）。
pub fn validate_linux_path(path: &str, allow_traversal: bool) -> ValidationResult {
    validate_path_inner(path, allow_traversal, false)
}
