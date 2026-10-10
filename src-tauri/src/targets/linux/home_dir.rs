//! Linux home 目录获取
//!
//! 从 commands/ssh.rs 的 `ssh_get_home_directory` 抽取 Linux 分支。
//!
//! 流程：
//! 1. 优先使用 SFTP canonicalize(".") 获取规范化的 home 目录绝对路径
//! 2. 失败则回退到 shell 命令 `echo $HOME`
//! 3. 再失败回退到 `pwd`

/// 获取远程用户的 home 目录路径（Linux/Unix）
///
/// 优先使用 SFTP 协议原生的 realpath(".") 获取规范化的 home 目录绝对路径，
/// 该方案与 WinSCP/FileZilla 一致，不依赖远端 shell 类型。
/// 服务端 sftp-server 进程自己知道工作目录，返回的是规范路径。
pub async fn get_home_directory(server_id: &str) -> Result<String, String> {
    // SFTP canonicalize
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
            return Ok(home);
        }
    }

    // 回退：echo $HOME
    let result = crate::ssh::manager::SshManager::global()
        .execute(server_id, "echo $HOME", 10)
        .await
        .map_err(|e| e.to_string())?;
    let home = result.stdout.trim().to_string();
    if home.is_empty() {
        let result2 = crate::ssh::manager::SshManager::global()
            .execute(server_id, "pwd", 10)
            .await
            .map_err(|e| e.to_string())?;
        Ok(result2.stdout.trim().to_string())
    } else {
        Ok(home)
    }
}
