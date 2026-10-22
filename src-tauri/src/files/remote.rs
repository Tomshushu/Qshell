use crate::validators::{validate_path_for_target, validate_permission_mode};
use crate::parsers::FileEntry;

/// Prefix that marks content as base64-encoded binary data.
/// Callers must prepend this before the base64 payload.
const BASE64_PREFIX: &str = "::base64::";

/// System root paths that must never be deleted with `rm -rf`.
const DANGEROUS_PATHS: &[&str] = &[
    "", "/", "/etc", "/usr", "/var", "/home", "/boot",
    "/bin", "/sbin", "/lib", "/lib64", "/opt", "/root",
    "/proc", "/sys", "/dev", "/run", "/mnt", "/media",
];

/// Windows 系统根路径（盘符根目录），禁止删除。
const DANGEROUS_WINDOWS_PATHS: &[&str] = &[
    "c:\\", "c:/", "d:\\", "d:/", "e:\\", "e:/",
    "c:\\windows", "c:/windows", "c:\\program files", "c:/program files",
    "c:\\program files (x86)", "c:/program files (x86)",
    "c:\\users", "c:/users",
];

/// Returns true if the path is a system root that must not be deleted or archived.
/// 适用于 delete / download_archive 等不可逆或高风险操作的前置校验。
///
/// 同时识别 Linux 与 Windows 系统根路径：
/// - Linux: `/`, `/etc`, `/usr`, ...
/// - Windows: `C:\`, `C:\Windows`, `C:\Users`, ...
pub fn is_dangerous_root_path(path: &str) -> bool {
    let normalized = path.trim_end_matches('/').trim_end_matches('\\');
    if DANGEROUS_PATHS.contains(&normalized) {
        return true;
    }
    let lower = normalized.to_lowercase();
    if DANGEROUS_WINDOWS_PATHS.contains(&lower.as_str()) {
        return true;
    }
    false
}

/// Execute a command on a remote server via SSH.
/// 仅供少数仍需 shell 命令的操作使用（chmod/chown/backup/count_recursive）。
async fn ssh_execute(server_id: &str, command: &str) -> Result<String, String> {
    crate::ssh::manager::execute_command(server_id.to_string(), command.to_string()).await
}

/// Write content to a remote file via SFTP.
async fn sftp_write(server_id: &str, path: &str, content: &[u8]) -> Result<(), String> {
    crate::ssh::manager::sftp_write(server_id.to_string(), path.to_string(), content.to_vec()).await
}

/// 读取服务器配置获取 target_type（决定按 Linux 还是 Windows 路径规则校验）。
async fn load_target_type(server_id: &str) -> String {
    match crate::commands::ssh::load_server_config(server_id).await {
        Ok(server) => server.target_type,
        Err(_) => "linux".to_string(),
    }
}

/// 将 Unix 时间戳（秒）转为本地时区的 `YYYY-MM-DD HH:MM:SS` 格式字符串。
fn format_mtime(mtime: Option<u32>) -> String {
    match mtime {
        Some(t) => {
            let dt = chrono::DateTime::from_timestamp(t as i64, 0)
                .unwrap_or_default();
            let local_dt = chrono::DateTime::<chrono::Local>::from(dt);
            local_dt.format("%Y-%m-%d %H:%M:%S").to_string()
        }
        None => String::new(),
    }
}

/// 将 SFTP permissions 位转为类似 `rwxr-xr-x` 的字符串（仅 Linux 有意义，Windows 返回 `---`）。
fn format_permissions(perms: Option<u32>, is_windows: bool) -> String {
    if is_windows {
        return "---".to_string();
    }
    match perms {
        Some(p) => {
            let mode = p & 0o7777;
            let typ = if (p & 0o170000) == 0o040000 { 'd' }
                else if (p & 0o170000) == 0o120000 { 'l' }
                else { '-' };
            let triplet = |n: u32| -> String {
                let mut s = String::with_capacity(3);
                s.push(if n & 4 != 0 { 'r' } else { '-' });
                s.push(if n & 2 != 0 { 'w' } else { '-' });
                s.push(if n & 1 != 0 { 'x' } else { '-' });
                s
            };
            format!("{}{}{}{}",
                typ,
                triplet((mode >> 6) & 7),
                triplet((mode >> 3) & 7),
                triplet(mode & 7),
            )
        }
        None => "---------".to_string(),
    }
}

/// 将 permissions 位转为八进制字符串（如 `755`）。
fn format_mode_octal(perms: Option<u32>) -> String {
    match perms {
        Some(p) => format!("{:o}", p & 0o777),
        None => "---".to_string(),
    }
}

/// List files in a remote directory.
///
/// 使用 SFTP 协议原生的 opendir/readdir（对标 WinSCP/FileZilla），
/// 跨平台统一：Linux/Windows 均适用，不依赖远端 shell 类型。
///
/// 直接构造 FileEntry 列表并返回 JSON，不再经过 shell 结构化文本 + parser 路径。
///
/// ## 已知限制（M4，暂不强修）
/// 文件名取自 `sftp_read_dir` 返回的 `russh_sftp::client::fs::DirEntry::file_name()`，
/// 该方法在 `russh-sftp 2.1` 中已把底层字节按 UTF-8 解码为 `String`，**不暴露原始字节**。
/// 因此当远端使用 GBK/GB18030 等非 UTF-8 文件名编码（部分旧版 OpenSSH / Windows 环境）时，
/// 列表中的文件名会出现乱码，且因丢失原始字节而**无法无损还原**。
///
/// 完整修复需绕过低层协议：自行解析 SSH_FXP_READDIR 响应字节 + 连接级「文件名字符集」
/// 配置（默认 UTF-8，可选 GBK/GB18030）+ 前端 UI，属较大改造，当前按产品决策暂不强修。
/// 影响范围仅限「列表展示与基于列表文件名的后续操作」，上传/下载路径由前端传入正确字符串不受影响。
pub async fn files_list(server_id: String, dir_path: String) -> Result<Vec<FileEntry>, String> {
    let target_type = load_target_type(&server_id).await;
    files_list_with_target(server_id, dir_path, &target_type).await
}

/// `files_list` 的显式目标类型版本（目录递归传输内部使用）。
/// 调用方一次性查询 target_type 后透传，避免每个子目录重复触发
/// `load_server_config`（DB 查询 + 主密钥解密 + 多条 info 日志）。
pub async fn files_list_with_target(
    server_id: String,
    dir_path: String,
    target_type: &str,
) -> Result<Vec<FileEntry>, String> {
    validate_path_for_target(dir_path.clone(), false, target_type)
        .valid
        .then_some(())
        .ok_or_else(|| format!("Invalid path: {}", dir_path))?;
    let is_windows = target_type.eq_ignore_ascii_case("windows");

    let entries = crate::ssh::manager::sftp_read_dir(&server_id, &dir_path).await?;

    // 内部路径统一使用 POSIX 形态（Windows 也返回 `/C:/Users/...`）：
    // 浏览链路由 targets/*/files.rs 做同一归一，传输链路必须与之一致，
    // 否则续传 tmp 前缀比对、忽略规则、去重都会因字符串形态不同而失效。
    let mut base = dir_path.replace('\\', "/").trim_end_matches('/').to_string();
    if is_windows && !base.is_empty() && !base.starts_with('/') {
        base = format!("/{}", base);
    }

    let file_entries: Vec<FileEntry> = entries
        .into_iter()
        .map(|e| {
            // path 字段：父目录 + '/' + 文件名（统一 POSIX）
            let path = if base.is_empty() {
                e.name.clone()
            } else {
                format!("{}/{}", base, e.name)
            };
            FileEntry {
                name: e.name,
                path,
                is_directory: e.is_dir,
                is_symlink: e.is_symlink,
                size: e.size as i64,
                modified_time: format_mtime(e.mtime),
                permissions: format_permissions(e.permissions, is_windows),
                owner: match e.user {
                    Some(u) if !u.is_empty() => u,
                    _ if e.uid == Some(0) => "root".to_string(),
                    _ => String::new(),
                },
                group: match e.group {
                    Some(g) if !g.is_empty() => g,
                    _ if e.gid == Some(0) => "root".to_string(),
                    _ => String::new(),
                },
                uid: e.uid,
                gid: e.gid,
            }
        })
        .collect();
    Ok(file_entries)
}

/// 列出 Windows 服务器上的所有本地磁盘盘符。
///
/// 仅在 Windows 目标上调用。返回形如 `["C:\\", "D:\\"]` 的盘符列表。
/// Windows OpenSSH 的 sftp-server 通常只暴露一个虚拟根（如 `/` 或用户 home），
/// 无法通过 SFTP 协议枚举盘符。这里仍用 shell 命令 `Get-CimInstance Win32_LogicalDisk` 获取，
/// 通过 cmd /c 中转兼容 Git Bash 默认 shell。
pub async fn files_list_drives(server_id: String) -> Result<Vec<String>, String> {
    let target_type = load_target_type(&server_id).await;
    if !target_type.eq_ignore_ascii_case("windows") {
        return Ok(Vec::new());
    }
    // 使用 cmd /c 中转调用 PowerShell（兼容 Git Bash 默认 shell）
    // Base64 编码避免 shell 元字符解析问题
    let script = "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { Write-Output $_.DeviceId }";
    let command = crate::validators::build_powershell_command(script);
    let out = crate::ssh::manager::SshManager::global()
        .execute(&server_id, &command, 15)
        .await
        .map_err(|e| e.to_string())?;
    let drives: Vec<String> = out
        .stdout
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .map(|line| {
            let letter = line.chars().next().unwrap_or('C').to_ascii_uppercase();
            format!("{}:\\", letter)
        })
        .collect();
    if drives.is_empty() {
        Ok(vec!["C:\\".to_string()])
    } else {
        Ok(drives)
    }
}

/// Read a remote file's content.
///
/// 使用 SFTP 协议读取（跨平台），不再区分 Linux/Windows shell 命令。
pub async fn files_read(server_id: String, path: String) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    validate_path_for_target(path.clone(), false, &target_type)
        .valid
        .then_some(())
        .ok_or_else(|| format!("Invalid path: {}", path))?;
    let bytes = crate::ssh::manager::sftp_read_file_bytes(&server_id, &path).await?;
    // 尝试 UTF-8 解码；失败则返回 base64（由调用方通过 ::base64:: 前缀判断）
    match String::from_utf8(bytes.clone()) {
        Ok(s) => Ok(s),
        Err(_) => {
            use base64::Engine;
            Ok(format!(
                "{}{}",
                BASE64_PREFIX,
                base64::engine::general_purpose::STANDARD.encode(&bytes)
            ))
        }
    }
}

/// Write content to a remote file.
///
/// Content format:
/// - Plain text (default): written as UTF-8 bytes.
/// - Base64-encoded binary: caller must prepend `::base64::` to the content.
///   The prefix is stripped and the remainder is base64-decoded before writing.
///
/// 大小限制：单次写入最大 5MB（解码后字节数）。超出请使用 SFTP 上传功能
/// （files_upload_from_paths），避免内存爆炸和 UI 卡顿。
///
/// 写入通过 SFTP 协议，跨平台（Linux/Windows 均可用）。
const FILE_WRITE_MAX_BYTES: usize = 5 * 1024 * 1024;
pub async fn files_write(server_id: String, path: String, content: String) -> Result<(), String> {
    let target_type = load_target_type(&server_id).await;
    validate_path_for_target(path.clone(), false, &target_type)
        .valid
        .then_some(())
        .ok_or_else(|| format!("Invalid path: {}", path))?;
    let bytes = if let Some(b64) = content.strip_prefix(BASE64_PREFIX) {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("Invalid base64 content: {}", e))?
    } else {
        content.into_bytes()
    };
    if bytes.len() > FILE_WRITE_MAX_BYTES {
        return Err(format!(
            "File content too large ({} bytes, max {} bytes). Please use the SFTP upload feature for large files.",
            bytes.len(),
            FILE_WRITE_MAX_BYTES
        ));
    }
    sftp_write(&server_id, &path, &bytes).await
}

/// Create a directory on the remote server.
///
/// 使用 SFTP `create_dir`（跨平台）。
/// 注意：SFTP `create_dir` 不会自动创建父目录（不像 `mkdir -p`），
/// 如果父目录不存在会返回错误。前端调用前应确保父目录存在。
pub async fn files_mkdir(server_id: String, path: String) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    validate_path_for_target(path.clone(), false, &target_type)
        .valid
        .then_some(())
        .ok_or_else(|| format!("Invalid path: {}", path))?;
    crate::ssh::manager::sftp_mkdir(&server_id, &path)
        .await
        .map(|_| String::new())
}

/// Delete a file or directory on the remote server.
///
/// 使用 SFP `remove_file` / `remove_dir`（跨平台）。
/// 拒绝删除系统根路径（Linux/Windows 均校验）。
///
/// 注意：SFTP `remove_dir` 只能删除空目录。非空目录需要递归删除，
/// 这里实现递归删除逻辑（先列子项，逐个删除）。
pub async fn files_delete(server_id: String, path: String) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    validate_path_for_target(path.clone(), false, &target_type)
        .valid
        .then_some(())
        .ok_or_else(|| format!("Invalid path: {}", path))?;
    if is_dangerous_root_path(&path) {
        return Err(
            "Refused to delete a system root path for safety. \
             Use a more specific path.".to_string()
        );
    }
    // 先获取文件信息判断是文件还是目录
    let metadata = crate::ssh::manager::sftp_stat(&server_id, &path).await?;
    if metadata.is_dir() {
        // 目录：递归删除
        sftp_remove_recursive(&server_id, &path).await?;
    } else {
        // 文件或符号链接：直接删除
        crate::ssh::manager::sftp_remove_file(&server_id, &path).await?;
    }
    Ok(String::new())
}

/// 递归删除远程目录及其所有内容（SFTP 实现）。
async fn sftp_remove_recursive(server_id: &str, path: &str) -> Result<(), String> {
    let entries = crate::ssh::manager::sftp_read_dir(server_id, path).await?;
    for entry in entries {
        let child_path = if path.ends_with('/') || path.ends_with('\\') {
            format!("{}{}", path, entry.name)
        } else {
            // SFTP 路径统一用 '/'（协议规范）
            format!("{}/{}", path, entry.name)
        };
        if entry.is_dir {
            Box::pin(sftp_remove_recursive(server_id, &child_path)).await?;
        } else {
            crate::ssh::manager::sftp_remove_file(server_id, &child_path).await?;
        }
    }
    crate::ssh::manager::sftp_remove_dir(server_id, path).await
}

/// Rename/move a file or directory on the remote server.
///
/// 使用 SFTP `rename`（跨平台）。
/// 拒绝重命名系统根路径（两端都校验）。
pub async fn files_rename(server_id: String, old_path: String, new_path: String) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    validate_path_for_target(old_path.clone(), false, &target_type)
        .valid
        .then_some(())
        .ok_or_else(|| format!("Invalid path: {}", old_path))?;
    validate_path_for_target(new_path.clone(), false, &target_type)
        .valid
        .then_some(())
        .ok_or_else(|| format!("Invalid path: {}", new_path))?;
    if is_dangerous_root_path(&old_path) || is_dangerous_root_path(&new_path) {
        return Err(
            "Refused to rename a system root path for safety. \
             Use a more specific path.".to_string()
        );
    }
    crate::ssh::manager::sftp_rename(&server_id, &old_path, &new_path)
        .await
        .map(|_| String::new())
}

/// Get file permissions on the remote server.
///
/// 使用 SFTP `metadata`（跨平台）获取权限信息。
/// - Linux: 返回八进制权限模式（如 `755`）+ owner + group
/// - Windows: 返回占位值（Windows 无 POSIX 权限模型）
pub async fn files_get_permissions(server_id: String, path: String) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    validate_path_for_target(path.clone(), false, &target_type)
        .valid
        .then_some(())
        .ok_or_else(|| format!("Invalid path: {}", path))?;
    let is_windows = target_type.eq_ignore_ascii_case("windows");
    let metadata = crate::ssh::manager::sftp_stat(&server_id, &path).await?;
    let mode = if is_windows {
        // Windows: 通过 ReadOnly 属性映射为 444/644
        // SFTP metadata 在 Windows 上 permissions 字段可能为空，默认 644
        "644".to_string()
    } else {
        format_mode_octal(metadata.permissions)
    };
    let owner = metadata.user.unwrap_or_default();
    let group = metadata.group.unwrap_or_default();
    Ok(format!("{} {} {}", mode, owner, group))
}

/// Set file permissions on the remote server.
///
/// Linux 使用 `chmod`（shell 命令），Windows 通过 `Set-ItemProperty` 切换 ReadOnly。
/// 递归 chmod 系统根路径拒绝（Linux/Windows 均校验）。
///
/// 注意：SFTP `setstat` 在多数服务器上对权限设置支持不稳定（尤其是 Windows sftp-server），
/// 故仍保留 shell 命令实现以确保可靠性。
pub async fn files_set_permissions(server_id: String, path: String, mode: String, recursive: bool) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    validate_path_for_target(path.clone(), false, &target_type)
        .valid
        .then_some(())
        .ok_or_else(|| format!("Invalid path: {}", path))?;
    if recursive && is_dangerous_root_path(&path) {
        return Err(
            "Refused to recursively chmod a system root path for safety. \
             Use a more specific path or non-recursive mode.".to_string()
        );
    }
    let mode_result = validate_permission_mode(mode.clone());
    if !mode_result.valid {
        return Err(format!(
            "Invalid permission mode: {}", mode_result.error.unwrap_or_default()
        ));
    }
    let command = if target_type.eq_ignore_ascii_case("windows") {
        // Windows: 444/400/440 → ReadOnly=true，其他 → ReadOnly=false
        let is_readonly = mode == "444" || mode == "400" || mode == "440";
        let recurse_flag = if recursive { "-Recurse " } else { "" };
        let script = format!(
            "Set-ItemProperty -Path '{}' {}-Name IsReadOnly -Value ${}",
            path.replace('\'', "''"),
            recurse_flag,
            is_readonly
        );
        crate::validators::build_powershell_command(&script)
    } else {
        let flag = if recursive { "-R" } else { "" };
        format!("chmod {} {} '{}' 2>&1", flag, mode, path.replace('\'', "'\\''"))
    };
    ssh_execute(&server_id, &command).await
}

/// Create a backup of a file on the remote server.
///
/// 使用 SFTP 读取原文件 + 写入备份文件（跨平台）。
/// 备份文件名格式：`<原路径>.bak.<YYYYMMDDHHMMSS>`
pub async fn files_backup(server_id: String, path: String) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    validate_path_for_target(path.clone(), false, &target_type)
        .valid
        .then_some(())
        .ok_or_else(|| format!("Invalid path: {}", path))?;
    // 生成备份路径
    let now = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
    let backup_path = format!("{}.bak.{}", path, now);
    // 读取原文件内容
    let bytes = crate::ssh::manager::sftp_read_file_bytes(&server_id, &path).await?;
    // 写入备份文件
    crate::ssh::manager::sftp_write(server_id.to_string(), backup_path.clone(), bytes).await?;
    Ok(backup_path)
}

/// Change owner and/or group of a file or directory.
///
/// Linux 使用 `chown`（shell 命令），Windows 通过 `icacls` 设置 ACL（仅支持 owner）。
/// 递归 chown 系统根路径拒绝（Linux/Windows 均校验）。
///
/// 注意：SFTP `setstat` 对 owner/group 设置支持不稳定，故保留 shell 命令实现。
pub async fn files_chown(
    server_id: String,
    path: String,
    owner: String,
    group: String,
    recursive: bool,
) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    validate_path_for_target(path.clone(), false, &target_type)
        .valid
        .then_some(())
        .ok_or_else(|| format!("Invalid path: {}", path))?;
    if recursive && is_dangerous_root_path(&path) {
        return Err(
            "Refused to recursively chown a system root path for safety. \
             Use a more specific path or non-recursive mode.".to_string()
        );
    }
    let spec = match (owner.as_str(), group.as_str()) {
        ("", "") => return Err("Owner and group cannot both be empty".to_string()),
        (o, "") => o.to_string(),
        ("", g) => format!(":{}", g),
        (o, g) => format!("{}:{}", o, g),
    };
    if !spec.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.' || c == ':') {
        return Err("Invalid owner/group name".to_string());
    }
    if spec.starts_with('-') {
        return Err("Owner/group spec cannot start with '-'".to_string());
    }
    let command = if target_type.eq_ignore_ascii_case("windows") {
        let win_owner = spec.split(':').next().unwrap_or(&spec);
        let recurse_flag = if recursive { "/t " } else { "" };
        format!(
            "icacls '{}' {}/grant {}:F 2>&1",
            path.replace('\'', "''"),
            recurse_flag,
            win_owner
        )
    } else {
        let r = if recursive { "-R " } else { "" };
        // chown 的 spec 已校验仅含安全字符，直接使用
        format!("chown {}-- {} '{}' 2>&1", r, spec, path.replace('\'', "'\\''"))
    };
    ssh_execute(&server_id, &command).await
}

/// Create a symbolic link.
///
/// 使用 SFTP `symlink`（跨平台）。
/// 注意：Windows 创建符号链接需要管理员权限或开发者模式。
pub async fn files_create_symlink(
    server_id: String,
    target: String,
    link_path: String,
) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    validate_path_for_target(target.clone(), false, &target_type)
        .valid
        .then_some(())
        .ok_or_else(|| format!("Invalid path: {}", target))?;
    validate_path_for_target(link_path.clone(), false, &target_type)
        .valid
        .then_some(())
        .ok_or_else(|| format!("Invalid path: {}", link_path))?;
    crate::ssh::manager::sftp_symlink(&server_id, &target, &link_path)
        .await
        .map(|_| String::new())
}

/// Get detailed file stat information.
///
/// 使用 SFTP `metadata` + `read_link`（跨平台）。
/// 返回 JSON 字符串：type, size, mode, owner, group, modifiedTime, accessTime, inode, links, isSymlink, symlinkTarget。
pub async fn files_stat_info(server_id: String, path: String) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    validate_path_for_target(path.clone(), false, &target_type)
        .valid
        .then_some(())
        .ok_or_else(|| format!("Invalid path: {}", path))?;

    let metadata = crate::ssh::manager::sftp_stat(&server_id, &path).await?;
    let is_symlink = metadata.is_symlink();
    let is_dir = metadata.is_dir();
    let size = metadata.len();
    let modified_time = format_mtime(metadata.mtime);
    let access_time = format_mtime(metadata.atime);
    let mode = format_mode_octal(metadata.permissions);
    let owner = metadata.user.unwrap_or_default();
    let group = metadata.group.unwrap_or_default();

    let file_type = if is_symlink {
        "symbolic link".to_string()
    } else if is_dir {
        "directory".to_string()
    } else {
        "regular file".to_string()
    };

    let symlink_target = if is_symlink {
        crate::ssh::manager::sftp_readlink(&server_id, &path).await.ok()
    } else {
        None
    };

    let result = serde_json::json!({
        "type": file_type,
        "size": size,
        "mode": mode,
        "owner": owner,
        "group": group,
        "modifiedTime": modified_time,
        "accessTime": access_time,
        "inode": 0,
        "links": 1,
        "isSymlink": is_symlink,
        "symlinkTarget": symlink_target,
    });

    serde_json::to_string(&result).map_err(|e| format!("Serialize error: {}", e))
}

/// Count files in a remote directory (recursive).
///
/// 使用 SFTP 递归列举统计文件数（跨平台）。
/// 注：权限不足的子目录会被跳过；递归深度限制 64 层防止栈溢出。
const MAX_RECURSE_DEPTH: usize = 64;
pub async fn files_count_recursive(server_id: String, path: String) -> Result<u64, String> {
    let target_type = load_target_type(&server_id).await;
    validate_path_for_target(path.clone(), false, &target_type)
        .valid
        .then_some(())
        .ok_or_else(|| format!("Invalid path: {}", path))?;
    if is_dangerous_root_path(&path) {
        return Err(format!("Refused to count files in dangerous root path: {}", path));
    }
    let mut count: u64 = 0;
    sftp_count_recursive_inner(&server_id, &path, &mut count, 0).await?;
    Ok(count)
}

/// 远程目录传输清单项。目录正式传输前一次性递归生成，供前端展示子文件记录。
#[derive(Debug, Clone)]
pub struct TransferManifestItem {
    pub path: String,
    pub size: u64,
}

/// 递归获取远程目录中的全部普通文件及大小。
pub async fn files_transfer_manifest(server_id: String, path: String) -> Result<Vec<TransferManifestItem>, String> {
    let target_type = load_target_type(&server_id).await;
    validate_path_for_target(path.clone(), false, &target_type)
        .valid
        .then_some(())
        .ok_or_else(|| format!("Invalid path: {}", path))?;
    if is_dangerous_root_path(&path) {
        return Err(format!("Refused to scan dangerous root path: {}", path));
    }
    let mut items = Vec::new();
    sftp_manifest_recursive_inner(&server_id, &path, &mut items, 0).await?;
    Ok(items)
}

async fn sftp_manifest_recursive_inner(server_id: &str, path: &str, items: &mut Vec<TransferManifestItem>, depth: usize) -> Result<(), String> {
    if depth >= MAX_RECURSE_DEPTH {
        return Err(format!("Max recursion depth exceeded at: {}", path));
    }
    let entries = crate::ssh::manager::sftp_read_dir(server_id, path).await?;
    for entry in entries {
        if entry.is_dir {
            let child_path = if path.ends_with('/') || path.ends_with('\\') {
                format!("{}{}", path, entry.name)
            } else {
                format!("{}/{}", path, entry.name)
            };
            Box::pin(sftp_manifest_recursive_inner(server_id, &child_path, items, depth + 1)).await?;
        } else if !entry.is_symlink {
            items.push(TransferManifestItem { path: entry.path, size: entry.size });
        }
    }
    Ok(())
}

/// 递归统计文件数（SFTP 实现，带深度限制）。
async fn sftp_count_recursive_inner(
    server_id: &str,
    path: &str,
    count: &mut u64,
    depth: usize,
) -> Result<(), String> {
    if depth >= MAX_RECURSE_DEPTH {
        return Err(format!("Max recursion depth exceeded at: {}", path));
    }
    let entries = crate::ssh::manager::sftp_read_dir(server_id, path).await?;
    for entry in entries {
        if entry.is_dir {
            let child_path = if path.ends_with('/') || path.ends_with('\\') {
                format!("{}{}", path, entry.name)
            } else {
                format!("{}/{}", path, entry.name)
            };
            Box::pin(sftp_count_recursive_inner(server_id, &child_path, count, depth + 1)).await?;
        } else {
            *count += 1;
        }
    }
    Ok(())
}
