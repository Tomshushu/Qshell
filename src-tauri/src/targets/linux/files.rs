//! Linux 文件操作专用实现
//!
//! 从 files/remote.rs 抽取的 Linux 专用逻辑：
//! - SFTP 操作本身是平台无关的（通过 ssh::manager 调用）
//! - 路径校验、权限命令（chmod/chown）是 Linux 专属的
//!
//! 与 Windows 模块完全隔离。

use crate::parsers::FileEntry;
use crate::targets::linux::validators::validate_linux_path;
use crate::validators::validate_permission_mode;

/// Prefix that marks content as base64-encoded binary data.
/// Callers must prepend this before the base64 payload.
const BASE64_PREFIX: &str = "::base64::";

/// Linux 系统根路径，禁止删除。
const DANGEROUS_PATHS: &[&str] = &[
    "", "/", "/etc", "/usr", "/var", "/home", "/boot",
    "/bin", "/sbin", "/lib", "/lib64", "/opt", "/root",
    "/proc", "/sys", "/dev", "/run", "/mnt", "/media",
];

/// 单次写入最大 5MB（解码后字节数）。
const FILE_WRITE_MAX_BYTES: usize = 5 * 1024 * 1024;

/// 递归传输/统计最大深度，防止 symlink 循环导致栈溢出
const MAX_RECURSE_DEPTH: usize = 64;

/// 判断路径是否为 Linux 系统根路径（不可删除/递归操作）。
pub fn is_dangerous_root_path(path: &str) -> bool {
    let normalized = path.trim_end_matches('/');
    DANGEROUS_PATHS.contains(&normalized)
}

/// 通过 SSH 在远端执行 shell 命令（仅供 chmod/chown 等仍需 shell 的操作使用）。
async fn ssh_execute(server_id: &str, command: &str) -> Result<String, String> {
    crate::ssh::manager::execute_command(server_id.to_string(), command.to_string()).await
}

/// 删除大目录时让远端文件系统自行递归，避免逐文件 SFTP 往返。
async fn ssh_execute_delete(server_id: &str, path: &str) -> Result<(), String> {
    let escaped = crate::validators::escape_shell_arg(path.to_string());
    let command = format!(
        "rm -rf -- {0} && if [ -e {0} ] || [ -L {0} ]; then echo 'delete verification failed' >&2; exit 1; fi",
        escaped
    );
    crate::ssh::manager::execute_command_with_timeout(server_id.to_string(), command, 3600)
        .await
        .map(|_| ())
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

/// 将 SFTP permissions 位转为类似 `rwxr-xr-x` 的字符串。
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

/// 校验 Linux 路径合法性（统一入口）。
fn check_path(path: &str) -> Result<(), String> {
    let v = validate_linux_path(path, false);
    if !v.valid {
        return Err(format!("Invalid path: {}", path));
    }
    Ok(())
}

/// 列出远程目录内容
///
/// 使用 SFTP 协议原生的 opendir/readdir，路径分隔符为 `/`。
/// 返回 FileEntry 列表。
pub async fn files_list(server_id: String, dir_path: String) -> Result<Vec<FileEntry>, String> {
    check_path(&dir_path)?;
    let entries = crate::ssh::manager::sftp_read_dir(&server_id, &dir_path).await?;

    // Linux 路径分隔符为 '/'
    let sep = '/';
    let base = dir_path.trim_end_matches('/');

    let file_entries: Vec<FileEntry> = entries
        .into_iter()
        .map(|e| {
            // 根目录（base 为空）时 path = "/name"，避免返回相对路径
            let path = if base.is_empty() {
                format!("/{}", e.name)
            } else {
                format!("{}{}{}", base, sep, e.name)
            };
            FileEntry {
                name: e.name,
                path,
                is_directory: e.is_dir,
                size: e.size as i64,
                modified_time: format_mtime(e.mtime),
                permissions: format_permissions(e.permissions),
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

/// 读取远程文件内容
///
/// 使用 SFTP 协议读取。返回字符串：UTF-8 可解码时返回原文，
/// 否则返回 `::base64::<payload>` 前缀的 base64 字符串。
pub async fn files_read(server_id: String, path: String) -> Result<String, String> {
    check_path(&path)?;
    let bytes = crate::ssh::manager::sftp_read_file_bytes(&server_id, &path).await?;
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

/// 写入远程文件
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
            "File content too large ({} bytes, max {} bytes). Please use the SFTP upload feature for large files.",
            bytes.len(),
            FILE_WRITE_MAX_BYTES
        ));
    }
    crate::ssh::manager::sftp_write(server_id, path, bytes).await
}

/// 创建远程目录
///
/// 使用 SFTP `create_dir`（不会自动创建父目录）。
pub async fn files_mkdir(server_id: String, path: String) -> Result<String, String> {
    check_path(&path)?;
    crate::ssh::manager::sftp_mkdir(&server_id, &path)
        .await
        .map(|_| String::new())
}

/// 删除远程文件或目录
///
/// 优先使用 SFTP `remove_file` / `remove_dir`；若 SFTP stat 失败（常见于服务器 locale
/// 非 UTF-8 导致中文文件名经 from_utf8_lossy 变成乱码，前端把乱码路径传回后端，
/// SFTP/SHELL 用乱码路径都匹配不到服务器上的真实文件名），回退到 **inode 删除**：
///   1. shell `ls -i <父目录>` 获取 inode（数字无编码问题）
///   2. 在输出中匹配乱码文件名（shell 和 SFTP readdir 输出的乱码形式相同）
///   3. `find <父目录> -maxdepth 1 -inum <inode> -exec rm -rf {} +` 按 inode 删除
///
/// 拒绝删除系统根路径。
pub async fn files_delete(server_id: String, path: String) -> Result<String, String> {
    check_path(&path)?;
    if is_dangerous_root_path(&path) {
        return Err(
            "Refused to delete a system root path for safety. \
             Use a more specific path.".to_string()
        );
    }

    // 优先走 SFTP 路径
    match crate::ssh::manager::sftp_stat(&server_id, &path).await {
        Ok(metadata) => {
            if metadata.is_dir() {
                // 快速路径：一次远端命令完成递归删除；失败时回退 SFTP，兼容受限 Shell/编码异常。
                if let Err(shell_err) = ssh_execute_delete(&server_id, &path).await {
                    if shell_err.to_lowercase().contains("timeout") || shell_err.contains("超时") {
                        // 超时后远端命令可能仍在执行，禁止立即启动第二套递归删除造成竞态。
                        return Err(shell_err);
                    }
                    tracing::warn!("[SFTP delete] fast recursive delete failed, fallback to SFTP: {}", shell_err);
                    sftp_remove_recursive(&server_id, &path).await?;
                }
            } else {
                crate::ssh::manager::sftp_remove_file(&server_id, &path).await?;
            }
            Ok(String::new())
        }
        Err(sftp_err) => {
            // SFTP stat 失败：用 inode 回退删除（绕开文件名编码问题）
            delete_by_inode_linux(&server_id, &path, &sftp_err.to_string()).await
        }
    }
}

/// Linux inode 回退删除：用 `ls -i` 找 inode，`find -inum` 删除
async fn delete_by_inode_linux(
    server_id: &str,
    path: &str,
    sftp_err: &str,
) -> Result<String, String> {
    // 拆分父目录和文件名
    let trimmed = path.trim_end_matches('/');
    let (parent, name) = match trimmed.rfind('/') {
        Some(pos) => {
            let p = if pos == 0 { "/" } else { &trimmed[..pos] };
            (p, &trimmed[pos + 1..])
        }
        None => return Err(format!("SFTP delete failed: {}", sftp_err)),
    };
    if name.is_empty() || parent.is_empty() {
        return Err(format!("SFTP delete failed: {}", sftp_err));
    }

    // 1. ls -i 列出父目录，获取 inode
    let escaped_parent = crate::validators::escape_shell_arg(parent.to_string());
    let ls_cmd = format!("ls -i1 -- {}", escaped_parent);
    let ls_output = ssh_execute(server_id, &ls_cmd).await
        .map_err(|e| format!("SFTP delete failed: {}; ls -i fallback failed: {}", sftp_err, e))?;

    // 2. 在输出中匹配文件名（每行格式："<inode> <filename>"）
    //    shell 和 SFTP readdir 输出的乱码形式相同（都经过 SSH UTF-8 传输 + from_utf8_lossy）
    let target_inode = ls_output
        .lines()
        .find_map(|line| {
            let line = line.trim();
            let parts: Vec<&str> = line.splitn(2, ' ').collect();
            if parts.len() != 2 {
                return None;
            }
            let inode_str = parts[0].trim();
            let fname = parts[1].trim();
            // 文件名匹配（乱码形式相同）
            if fname == name {
                inode_str.parse::<u64>().ok()
            } else {
                None
            }
        });

    let inode = match target_inode {
        Some(i) => i,
        None => return Err(format!(
            "SFTP delete failed: {}; inode fallback cannot find matching file in {}",
            sftp_err, parent
        )),
    };

    // 3. find -inum 删除（按 inode 完全绕开文件名编码）
    let find_cmd = format!(
        "find {} -maxdepth 1 -inum {} -exec rm -rf -- {{}} +",
        escaped_parent, inode
    );
    match ssh_execute(server_id, &find_cmd).await {
        Ok(_) => Ok(String::new()),
        Err(shell_err) => Err(format!(
            "SFTP delete failed: {}; find -inum fallback also failed: {}",
            sftp_err, shell_err
        )),
    }
}

/// 递归删除远程目录及其所有内容（SFTP 实现）。
async fn sftp_remove_recursive(server_id: &str, path: &str) -> Result<(), String> {
    let entries = crate::ssh::manager::sftp_read_dir(server_id, path).await?;
    for entry in entries {
        let child_path = if path.ends_with('/') {
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

/// 重命名/移动远程文件或目录
///
/// 使用 SFTP `rename`。拒绝重命名系统根路径。
pub async fn files_rename(
    server_id: String,
    old_path: String,
    new_path: String,
) -> Result<String, String> {
    check_path(&old_path)?;
    check_path(&new_path)?;
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

/// 获取远程文件权限
///
/// 使用 SFTP `metadata`，返回八进制权限模式（如 `755`）+ owner + group。
pub async fn files_get_permissions(server_id: String, path: String) -> Result<String, String> {
    check_path(&path)?;
    let metadata = crate::ssh::manager::sftp_stat(&server_id, &path).await?;
    let mode = format_mode_octal(metadata.permissions);
    let owner = metadata.user.unwrap_or_default();
    let group = metadata.group.unwrap_or_default();
    Ok(format!("{} {} {}", mode, owner, group))
}

/// 设置远程文件权限
///
/// Linux 使用 `chmod`（shell 命令）。
/// 递归 chmod 系统根路径拒绝。
pub async fn files_set_permissions(
    server_id: String,
    path: String,
    mode: String,
    recursive: bool,
) -> Result<String, String> {
    check_path(&path)?;
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
    let flag = if recursive { "-R" } else { "" };
    let command = format!("chmod {} {} '{}' 2>&1", flag, mode, path.replace('\'', "'\\''"));
    ssh_execute(&server_id, &command).await
}

/// 备份远程文件（创建 .bak 副本）
///
/// 使用 SFTP 读取原文件 + 写入备份文件。
/// 备份文件名格式：`<原路径>.bak.<YYYYMMDDHHMMSS>`
pub async fn files_backup(server_id: String, path: String) -> Result<String, String> {
    check_path(&path)?;
    let now = chrono::Local::now().format("%Y%m%d%H%M%S").to_string();
    let backup_path = format!("{}.bak.{}", path, now);
    let bytes = crate::ssh::manager::sftp_read_file_bytes(&server_id, &path).await?;
    crate::ssh::manager::sftp_write(server_id, backup_path.clone(), bytes).await?;
    Ok(backup_path)
}

/// 修改文件属主/属组
///
/// Linux 使用 `chown`（shell 命令）。
/// 递归 chown 系统根路径拒绝。
pub async fn files_chown(
    server_id: String,
    path: String,
    owner: String,
    group: String,
    recursive: bool,
) -> Result<String, String> {
    check_path(&path)?;
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
    let r = if recursive { "-R " } else { "" };
    // chown 的 spec 已校验仅含安全字符，直接使用
    let command = format!("chown {}-- {} '{}' 2>&1", r, spec, path.replace('\'', "'\\''"));
    ssh_execute(&server_id, &command).await
}

/// 创建符号链接
///
/// 使用 SFTP `symlink`。
pub async fn files_create_symlink(
    server_id: String,
    target: String,
    link_path: String,
) -> Result<String, String> {
    check_path(&target)?;
    check_path(&link_path)?;
    crate::ssh::manager::sftp_symlink(&server_id, &target, &link_path)
        .await
        .map(|_| String::new())
}

/// 获取文件详细属性信息
///
/// 使用 SFTP `metadata` + `read_link`。
/// 返回 JSON 字符串：type, size, mode, owner, group, modifiedTime, accessTime, inode, links, isSymlink, symlinkTarget。
pub async fn files_stat_info(server_id: String, path: String) -> Result<String, String> {
    check_path(&path)?;

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

/// 递归统计目录内文件数
///
/// 使用 SFTP 递归列举统计文件数。
/// 注：权限不足的子目录会被跳过；递归深度限制 64 层防止栈溢出。
pub async fn files_count_recursive(server_id: String, path: String) -> Result<u64, String> {
    check_path(&path)?;
    if is_dangerous_root_path(&path) {
        return Err(format!("Refused to count files in dangerous root path: {}", path));
    }
    let mut count: u64 = 0;
    sftp_count_recursive_inner(&server_id, &path, &mut count, 0).await?;
    Ok(count)
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
            let child_path = if path.ends_with('/') {
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
