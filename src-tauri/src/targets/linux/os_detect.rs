//! Linux OS 探测命令构造
//!
//! 输出格式约定为三段，以 `---SEP---` 分隔：
//! ```text
//! <release_content，含 ID= / PRETTY_NAME=>
//! ---SEP---
//! <arch>
//! ---SEP---
//! <kernel>
//! ```

/// 返回 Linux OS 探测命令字符串
///
/// 命令：`cat /etc/os-release; uname -m; uname -r`
pub fn os_detect_command() -> String {
    "cat /etc/os-release 2>/dev/null; echo \"---SEP---\"; uname -m 2>/dev/null; echo \"---SEP---\"; uname -r 2>/dev/null".to_string()
}
