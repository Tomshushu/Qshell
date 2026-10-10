//! Windows home 目录获取
//!
//! 从 commands/ssh.rs 的 `ssh_get_home_directory` 抽取 Windows 分支。
//!
//! 流程：
//! 1. 优先使用 SFTP canonicalize(".") 获取规范化的 home 目录绝对路径
//!    - Windows SFTP 可能返回 POSIX 路径（如 `/` 或 `/C:/Users`），需校验后回退
//! 2. 失败或返回 POSIX 路径时回退到 shell 命令 `cmd.exe /c echo %USERPROFILE%`
//! 3. 所有 shell 命令失败，返回 `C:\` 兜底

/// 获取远程 Windows 用户的 home 目录路径
///
/// 优先使用 SFTP 协议原生的 realpath(".") 获取规范化的 home 目录绝对路径。
/// Windows SFTP canonicalize 可能返回 POSIX 路径（如 `/` 或 `/C:/Users`），
/// 此时不直接返回，继续走 shell 命令回退。
pub async fn get_home_directory(server_id: &str) -> Result<String, String> {
    // 1. SFTP canonicalize
    let sftp_home = async {
        let conn = crate::ssh::manager::SshManager::global()
            .get_connection(server_id)
            .map_err(|e| format!("get connection failed: {}", e))?;
        let sftp = conn.create_sftp_session().await
            .map_err(|e| format!("SFTP session failed: {}", e))?;
        sftp.canonicalize(".").await
            .map_err(|e| format!("realpath failed: {}", e))
    }.await;

    if let Ok(home) = sftp_home {
        let home = home.trim().to_string();
        if !home.is_empty() {
            // Windows 校验：SFTP canonicalize 可能返回 POSIX 路径（如 "/" 或 "/C:/Users"）
            // 此时不能用，需要回退到 shell 命令获取真正的 Windows 路径
            let looks_windows = home.contains(':') || home.starts_with("\\\\");
            if looks_windows {
                return Ok(home);
            }
            // POSIX 路径，继续走 shell 回退
        }
    }

    // 2. 回退：通过 shell 命令获取（SFTP 不可用 / 返回 POSIX 路径 / 服务端不支持 realpath）
    // Windows：依次尝试多种命令（不同默认 shell 需要不同语法）
    let candidates: &[&str] = &[
        "cmd.exe /c echo %USERPROFILE%",
        "cmd /c echo %USERPROFILE%",
        "/c/Windows/System32/cmd.exe /c echo %USERPROFILE%",
    ];
    for cmd in candidates {
        if let Ok(out) = crate::ssh::manager::SshManager::global()
            .execute(server_id, cmd, 10)
            .await
        {
            let home = out.stdout.trim().to_string();
            if !home.is_empty()
                && !home.contains('%')
                && (home.contains(':') || home.starts_with("\\\\"))
            {
                return Ok(home);
            }
        }
    }

    // 3. 所有 shell 命令都失败，返回 C:\ 作为最终兜底（Windows 总有 C 盘）
    Ok("C:\\".to_string())
}
