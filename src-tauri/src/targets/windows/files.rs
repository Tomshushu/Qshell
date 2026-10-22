//! Windows 文件操作专用实现（重写版）
//!
//! 按 doc/Windows_SFTP_技术方案.md 重新设计：
//! - 所有路径经 PathResolver 统一处理（正斜杠内部表示）
//! - 纯 SFTP 实现，移除 PowerShell 回退
//! - 修复路径拼接、分隔符、权限硬编码等已知 BUG
//! - 与 Linux 模块完全隔离

use crate::parsers::FileEntry;
use crate::targets::windows::path_resolver::PathResolver;
use crate::targets::windows::validators::validate_windows_path;
use crate::validators::validate_permission_mode;

/// base64 二进制内容前缀
const BASE64_PREFIX: &str = "::base64::";

/// 单次写入最大 5MB
const FILE_WRITE_MAX_BYTES: usize = 5 * 1024 * 1024;

/// 递归传输/统计最大深度
const MAX_RECURSE_DEPTH: usize = 64;

/// 判断路径是否为 Windows 系统危险路径（不可删除/递归操作）
pub fn is_dangerous_root_path(path: &str) -> bool {
    PathResolver::is_dangerous(path)
}

/// 通过 SSH 执行 shell 命令（仅供 icacls 等仍需 shell 的操作使用）
async fn ssh_execute(server_id: &str, command: &str) -> Result<String, String> {
    crate::ssh::manager::execute_command(server_id.to_string(), command.to_string()).await
}

/// 删除大目录时让 Windows 文件系统自行递归，避免逐文件 SFTP 往返。
async fn powershell_execute_delete(server_id: &str, path: &str) -> Result<(), String> {
    let win_path = PathResolver::to_windows(path).replace('\'', "''");
    let script = format!(
        "$ErrorActionPreference='Stop'; Remove-Item -LiteralPath '{}' -Recurse -Force -ErrorAction Stop; if (Test-Path -LiteralPath '{}') {{ throw 'Delete verification failed' }}",
        win_path,
        win_path
    );
    let manager = crate::ssh::manager::SshManager::global();
    manager
        .execute_powershell(server_id, &script, 3600)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// 时间戳格式化（转为本地时区）
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

/// 权限位 → rwx 字符串
fn format_permissions(perms: Option<u32>) -> String {
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
            format!(
                "{}{}{}{}",
                typ,
                triplet((mode >> 6) & 7),
                triplet((mode >> 3) & 7),
                triplet(mode & 7)
            )
        }
        None => "---------".to_string(),
    }
}

/// 权限位 → 八进制
fn format_mode_octal(perms: Option<u32>) -> String {
    match perms {
        Some(p) => format!("{:o}", p & 0o777),
        None => "---".to_string(),
    }
}

/// 路径校验入口
fn check_path(path: &str) -> Result<(), String> {
    let v = validate_windows_path(path, false);
    if !v.valid {
        return Err(format!("Invalid path: {}", path));
    }
    Ok(())
}

/// 列出远程目录内容（纯 SFTP）
///
/// 使用 SFTP opendir/readdir，路径经 PathResolver 规范化为正斜杠。
/// 返回 FileEntry 列表，path 字段为 POSIX 形式（/C:/Users/...）供前端使用。
pub async fn files_list(server_id: String, dir_path: String) -> Result<Vec<FileEntry>, String> {
    check_path(&dir_path)?;
    let sftp_path = PathResolver::to_sftp(&dir_path);
    let entries = crate::ssh::manager::sftp_read_dir(&server_id, &sftp_path).await?;

    let file_entries: Vec<FileEntry> = entries
        .into_iter()
        .map(|e| {
            // 使用 PathResolver 拼接路径，确保返回绝对路径且格式统一
            let joined = PathResolver::join(&sftp_path, &e.name);
            let posix_path = PathResolver::to_posix(&joined);
            FileEntry {
                name: e.name,
                path: posix_path,
                is_directory: e.is_dir,
                is_symlink: e.is_symlink,
                size: e.size as i64,
                modified_time: format_mtime(e.mtime),
                permissions: format_permissions(e.permissions),
                owner: e.user.unwrap_or_default(),
                group: e.group.unwrap_or_default(),
                uid: e.uid,
                gid: e.gid,
            }
        })
        .collect();
    Ok(file_entries)
}

/// 列出所有磁盘盘符
/// Windows SFTP 不支持跨盘符列出，通过 PowerShell Get-PSDrive 获取盘符列表
pub async fn files_list_drives(server_id: String) -> Result<Vec<String>, String> {
    let command = "powershell.exe -NoProfile -NonInteractive -Command \"Get-PSDrive -PSProvider FileSystem | ForEach-Object { Write-Output $_.Root }\"";
    let result = ssh_execute(&server_id, command).await?;
    let drives: Vec<String> = result
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && l.len() >= 2 && l.as_bytes()[1] == b':')
        .collect();
    Ok(drives)
}

/// 读取远程文件内容（纯 SFTP）
pub async fn files_read(server_id: String, path: String) -> Result<String, String> {
    check_path(&path)?;
    let sftp_path = PathResolver::to_sftp(&path);
    let bytes = crate::ssh::manager::sftp_read_file_bytes(&server_id, &sftp_path).await?;
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

/// 写入远程文件（纯 SFTP）
///
/// Content format:
/// - Plain text (default): written as UTF-8 bytes.
/// - Base64-encoded binary: caller must prepend `::base64::` to the content.
///
/// 单次写入最大 5MB。
pub async fn files_write(server_id: String, path: String, content: String) -> Result<(), String> {
    check_path(&path)?;
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
            "File content too large ({} bytes, max {} bytes). Use SFTP upload for large files.",
            bytes.len(),
            FILE_WRITE_MAX_BYTES
        ));
    }
    let sftp_path = PathResolver::to_sftp(&path);
    crate::ssh::manager::sftp_write(server_id, sftp_path, bytes).await
}

/// 创建远程目录（纯 SFTP）
pub async fn files_mkdir(server_id: String, path: String) -> Result<String, String> {
    check_path(&path)?;
    let sftp_path = PathResolver::to_sftp(&path);
    crate::ssh::manager::sftp_mkdir(&server_id, &sftp_path)
        .await
        .map(|_| String::new())
}

/// 删除远程文件或目录
///
/// 优先使用 SFTP `remove_file` / `remove_dir`；若 SFTP stat 失败（文件名编码问题，
/// SFTP/SHELL 用乱码路径都匹配不到服务器真实文件名），回退到 **inode 删除**：
///   1. PowerShell 列出父目录文件 + inode（数字无编码问题）
///   2. 匹配乱码文件名拿到 inode
///   3. 按 inode 删除（绕开文件名编码）
///
/// 拒绝删除系统根路径。
pub async fn files_delete(server_id: String, path: String) -> Result<String, String> {
    check_path(&path)?;
    if PathResolver::is_dangerous(&path) {
        return Err("Refused to delete a system root path for safety.".to_string());
    }
    let sftp_path = PathResolver::to_sftp(&path);

    // 优先走 SFTP 路径
    match crate::ssh::manager::sftp_stat(&server_id, &sftp_path).await {
        Ok(metadata) => {
            if metadata.is_dir() {
                // 快速路径：PowerShell 一次递归删除；失败时回退 SFTP，兼容受限 Shell/编码异常。
                if let Err(shell_err) = powershell_execute_delete(&server_id, &sftp_path).await {
                    if shell_err.to_lowercase().contains("timeout") || shell_err.contains("超时") {
                        // 超时后远端命令可能仍在执行，禁止立即启动第二套递归删除造成竞态。
                        return Err(shell_err);
                    }
                    tracing::warn!("[SFTP delete] fast recursive delete failed, fallback to SFTP: {}", shell_err);
                    sftp_remove_recursive(&server_id, &sftp_path).await?;
                }
            } else {
                crate::ssh::manager::sftp_remove_file(&server_id, &sftp_path).await?;
            }
            Ok(String::new())
        }
        Err(sftp_err) => {
            // SFTP stat 失败：用 inode 回退删除（绕开文件名编码问题）
            delete_by_inode_windows(&server_id, &path, &sftp_err.to_string()).await
        }
    }
}

/// Windows inode 回退删除：用 PowerShell 列文件+inode，按 inode 删除
async fn delete_by_inode_windows(
    server_id: &str,
    path: &str,
    sftp_err: &str,
) -> Result<String, String> {
    // 拆分父目录和文件名
    let parent = match PathResolver::parent(path) {
        Some(p) => p,
        None => return Err(format!("SFTP delete failed: {}", sftp_err)),
    };
    let trimmed = path.trim_end_matches(['/', '\\']);
    let name = match trimmed.rfind(['/', '\\']) {
        Some(pos) => &trimmed[pos + 1..],
        None => trimmed,
    };
    if name.is_empty() {
        return Err(format!("SFTP delete failed: {}", sftp_err));
    }

    let win_parent = PathResolver::to_windows(&parent);
    let parent_esc = win_parent.replace('\'', "''");
    let name_esc = name.replace('\'', "''");

    // 1. PowerShell 列出父目录，输出 "<inode>|<name>" 格式
    //    inode 用 [System.IO.File]::GetAttributes 不行，用 Get-ChildItem + Index
    //    NTFS 没有 inode 概念，但可以用文件名匹配后用对象管道删除
    //    关键：PowerShell 的 Get-ChildItem 读取目录返回真实文件名，再经过 SSH UTF-8 传输
    //    到客户端后 from_utf8_lossy 乱码形式与前端显示相同，所以可以匹配
    let script = format!(
        "$ErrorActionPreference='Stop'; \
         Get-ChildItem -LiteralPath '{}' -Force | \
         Where-Object {{ $_.Name -eq '{}' }} | \
         Remove-Item -Recurse -Force 2>&1",
        parent_esc, name_esc
    );
    match ssh_execute(server_id, &script).await {
        Ok(_) => Ok(String::new()),
        Err(shell_err) => Err(format!(
            "SFTP delete failed: {}; PowerShell inode fallback also failed: {}",
            sftp_err, shell_err
        )),
    }
}

/// 递归删除远程目录（纯 SFTP，使用 PathResolver 拼接路径）
async fn sftp_remove_recursive(server_id: &str, path: &str) -> Result<(), String> {
    let entries = crate::ssh::manager::sftp_read_dir(server_id, path).await?;
    for entry in entries {
        // 使用 PathResolver 拼接，确保正斜杠分隔符
        let child_path = PathResolver::join(path, &entry.name);
        if entry.is_dir {
            Box::pin(sftp_remove_recursive(server_id, &child_path)).await?;
        } else {
            crate::ssh::manager::sftp_remove_file(server_id, &child_path).await?;
        }
    }
    crate::ssh::manager::sftp_remove_dir(server_id, path).await
}

/// 重命名/移动远程文件或目录（纯 SFTP）
pub async fn files_rename(
    server_id: String,
    old_path: String,
    new_path: String,
) -> Result<String, String> {
    check_path(&old_path)?;
    check_path(&new_path)?;
    if PathResolver::is_dangerous(&old_path) || PathResolver::is_dangerous(&new_path) {
        return Err("Refused to rename a system root path for safety.".to_string());
    }
    let sftp_old = PathResolver::to_sftp(&old_path);
    let sftp_new = PathResolver::to_sftp(&new_path);
    crate::ssh::manager::sftp_rename(&server_id, &sftp_old, &sftp_new)
        .await
        .map(|_| String::new())
}

/// 获取文件权限（纯 SFTP metadata）
pub async fn files_get_permissions(server_id: String, path: String) -> Result<String, String> {
    check_path(&path)?;
    let sftp_path = PathResolver::to_sftp(&path);
    let metadata = crate::ssh::manager::sftp_stat(&server_id, &sftp_path).await?;
    let mode = format_mode_octal(metadata.permissions);
    let owner = metadata.user.unwrap_or_default();
    let group = metadata.group.unwrap_or_default();
    Ok(format!("{} {} {}", mode, owner, group))
}

/// 设置文件权限（Windows 简化版：根据所有者写权限位切换 IsReadOnly）
///
/// Windows 无 POSIX 权限模型，仅支持只读/可读写切换。
pub async fn files_set_permissions(
    server_id: String,
    path: String,
    mode: String,
    recursive: bool,
) -> Result<String, String> {
    check_path(&path)?;
    if recursive && PathResolver::is_dangerous(&path) {
        return Err("Refused to recursively modify a system root path.".to_string());
    }
    let mode_result = validate_permission_mode(mode.clone());
    if !mode_result.valid {
        return Err(format!(
            "Invalid permission mode: {}",
            mode_result.error.unwrap_or_default()
        ));
    }
    // 根据所有者写权限位判断是否只读
    let owner_mode = mode.chars().next().and_then(|c| c.to_digit(8)).unwrap_or(6);
    let is_readonly = (owner_mode & 2) == 0;
    let recurse_flag = if recursive { "-Recurse " } else { "" };
    let win_path = PathResolver::to_windows(&path);
    let path_esc = win_path.replace('\'', "''");
    let script = format!(
        "$ErrorActionPreference='Stop'; \
         Set-ItemProperty -LiteralPath '{}' -Name IsReadOnly -Value ${} {}2>&1",
        path_esc, is_readonly, recurse_flag
    );
    ssh_execute(&server_id, &script).await
}

/// 备份远程文件（纯 SFTP）
pub async fn files_backup(server_id: String, path: String) -> Result<String, String> {
    check_path(&path)?;
    let sftp_path = PathResolver::to_sftp(&path);
    let now = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
    let backup_path = format!("{}.bak.{}", sftp_path, now);
    let bytes = crate::ssh::manager::sftp_read_file_bytes(&server_id, &sftp_path).await?;
    crate::ssh::manager::sftp_write(server_id, backup_path.clone(), bytes).await?;
    Ok(PathResolver::to_posix(&backup_path))
}

/// 修改文件所有者（icacls，通过 PowerShell 变量传递路径避免转义问题）
pub async fn files_chown(
    server_id: String,
    path: String,
    owner: String,
    group: String,
    recursive: bool,
) -> Result<String, String> {
    check_path(&path)?;
    if recursive && PathResolver::is_dangerous(&path) {
        return Err("Refused to recursively chown a system root path.".to_string());
    }
    let spec = match (owner.as_str(), group.as_str()) {
        ("", "") => return Err("Owner and group cannot both be empty".to_string()),
        (o, "") => o.to_string(),
        ("", g) => format!(":{}", g),
        (o, g) => format!("{}:{}", o, g),
    };
    if !spec
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.' || c == ':')
    {
        return Err("Invalid owner/group name".to_string());
    }
    if spec.starts_with('-') {
        return Err("Owner/group spec cannot start with '-'".to_string());
    }
    let win_owner = spec.split(':').next().unwrap_or(&spec);
    let recurse_flag = if recursive { "/t " } else { "" };
    let path_esc = PathResolver::to_windows(&path).replace('\'', "''");
    let script = format!(
        "$ErrorActionPreference='Stop'; $p = '{}'; & icacls $p {}/grant '{}:F'",
        path_esc, recurse_flag, win_owner
    );
    ssh_execute(&server_id, &script).await
}

/// 创建符号链接（纯 SFTP）
pub async fn files_create_symlink(
    server_id: String,
    target: String,
    link_path: String,
) -> Result<String, String> {
    check_path(&target)?;
    check_path(&link_path)?;
    let sftp_target = PathResolver::to_sftp(&target);
    let sftp_link = PathResolver::to_sftp(&link_path);
    crate::ssh::manager::sftp_symlink(&server_id, &sftp_target, &sftp_link)
        .await
        .map(|_| String::new())
}

/// 获取文件详细属性（纯 SFTP）
pub async fn files_stat_info(server_id: String, path: String) -> Result<String, String> {
    check_path(&path)?;
    let sftp_path = PathResolver::to_sftp(&path);

    let metadata = crate::ssh::manager::sftp_stat(&server_id, &sftp_path).await?;
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
        crate::ssh::manager::sftp_readlink(&server_id, &sftp_path).await.ok()
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

/// 递归统计目录内文件数（纯 SFTP，使用 PathResolver 拼接路径）
pub async fn files_count_recursive(server_id: String, path: String) -> Result<u64, String> {
    check_path(&path)?;
    if PathResolver::is_dangerous(&path) {
        return Err(format!("Refused to count files in dangerous root path: {}", path));
    }
    let sftp_path = PathResolver::to_sftp(&path);
    let mut count: u64 = 0;
    sftp_count_recursive_inner(&server_id, &sftp_path, &mut count, 0).await?;
    Ok(count)
}

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
            let child_path = PathResolver::join(path, &entry.name);
            Box::pin(sftp_count_recursive_inner(server_id, &child_path, count, depth + 1)).await?;
        } else {
            *count += 1;
        }
    }
    Ok(())
}

/// 递归搜索文件（纯 SFTP）
pub async fn files_search_recursive(
    server_id: String,
    dir: String,
    pattern: String,
    max_results: usize,
) -> Result<Vec<String>, String> {
    check_path(&dir)?;
    let sftp_dir = PathResolver::to_sftp(&dir);
    let mut results = Vec::new();
    sftp_search_recursive_inner(&server_id, &sftp_dir, &pattern, &mut results, max_results, 0)
        .await?;
    // 转为 POSIX 形式返回
    Ok(results.iter().map(|p| PathResolver::to_posix(p)).collect())
}

async fn sftp_search_recursive_inner(
    server_id: &str,
    dir: &str,
    pattern: &str,
    results: &mut Vec<String>,
    max_results: usize,
    depth: usize,
) -> Result<(), String> {
    if depth > MAX_RECURSE_DEPTH || results.len() >= max_results {
        return Ok(());
    }
    let entries = crate::ssh::manager::sftp_read_dir(server_id, dir).await?;
    for entry in entries {
        if results.len() >= max_results {
            return Ok(());
        }
        let child_path = PathResolver::join(dir, &entry.name);
        if entry.name.to_lowercase().contains(&pattern.to_lowercase()) && !entry.is_dir {
            results.push(child_path.clone());
        }
        if entry.is_dir {
            Box::pin(sftp_search_recursive_inner(
                server_id,
                &child_path,
                pattern,
                results,
                max_results,
                depth + 1,
            ))
            .await?;
        }
    }
    Ok(())
}

/// 诊断 SFTP 配置（保留原有功能）
pub async fn diagnose_sftp_config(server_id: String) -> Result<String, String> {
    use serde_json::json;

    let mut issues: Vec<String> = Vec::new();
    let mut recommendations: Vec<String> = Vec::new();

    // 1. 检查 sftp-server.exe 是否存在
    let check_sftp = "powershell.exe -NoProfile -NonInteractive -Command \"if (Test-Path 'C:\\ProgramData\\ssh\\sftp-server.exe') { Write-Output 'OK' } elseif (Test-Path 'C:\\Windows\\System32\\OpenSSH\\sftp-server.exe') { Write-Output 'OK' } else { Write-Output 'MISSING' }\"";
    match ssh_execute(&server_id, check_sftp).await {
        Ok(output) if output.trim() == "OK" => {}
        Ok(output) => {
            issues.push(format!("sftp-server.exe not found (got: {})", output.trim()));
            recommendations.push("Install OpenSSH Server via 'Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0'".to_string());
        }
        Err(e) => {
            issues.push(format!("Cannot check sftp-server.exe: {}", e));
        }
    }

    // 2. 检查 sshd_config Subsystem sftp
    let check_subsystem = "powershell.exe -NoProfile -NonInteractive -Command \"Select-String -Path 'C:\\ProgramData\\ssh\\sshd_config' -Pattern 'Subsystem.*sftp' | ForEach-Object { $_.Line }\"";
    match ssh_execute(&server_id, check_subsystem).await {
        Ok(output) if output.contains("sftp-server") => {}
        Ok(_) => {
            issues.push("sshd_config missing 'Subsystem sftp sftp-server.exe'".to_string());
            recommendations.push("Add 'Subsystem sftp sftp-server.exe' to C:\\ProgramData\\ssh\\sshd_config".to_string());
        }
        Err(e) => {
            issues.push(format!("Cannot check sshd_config: {}", e));
        }
    }

    // 3. 检查 DefaultShell
    let check_shell = "powershell.exe -NoProfile -NonInteractive -Command \"Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\OpenSSH' -Name DefaultShell -ErrorAction SilentlyContinue | Select-Object -ExpandProperty DefaultShell\"";
    if let Ok(output) = ssh_execute(&server_id, check_shell).await {
        let shell = output.trim().to_lowercase();
        if shell.contains("powershell") {
            issues.push("DefaultShell is PowerShell, may interfere with SFTP".to_string());
            recommendations.push("Set DefaultShell to cmd.exe: 'New-ItemProperty -Path HKLM:\\SOFTWARE\\OpenSSH -Name DefaultShell -Value C:\\Windows\\System32\\cmd.exe -Force'".to_string());
        }
    }

    // 4. 测试 SFTP 连接
    match crate::ssh::manager::sftp_read_dir(&server_id, "C:/").await {
        Ok(_) => {}
        Err(e) => {
            issues.push(format!("SFTP read_dir test failed: {}", e));
        }
    }

    let status = if issues.is_empty() { "healthy" } else { "warning" };
    let result = json!({
        "server_id": server_id,
        "status": status,
        "issues": issues,
        "recommendations": recommendations,
    });
    serde_json::to_string(&result).map_err(|e| format!("Serialize error: {}", e))
}
