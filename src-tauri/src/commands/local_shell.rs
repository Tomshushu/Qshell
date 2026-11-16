//! 本地 Shell Tauri IPC 命令（P0-02）
//!
//! 仅暴露 `local_list_profiles` 与 `local_create_shell`：
//! 写入 / 调整尺寸 / 编码切换 / 关闭 / 历史回放等通过统一 `ssh_*_shell` 命令按 `local-` 前缀路由。

use tauri::AppHandle;

use crate::local_shell::LocalShellProfile;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLocalShellResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shell_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shell_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 枚举当前操作系统可用的本地 Shell Profile（PowerShell / cmd / WSL / Git Bash / zsh / bash）
#[tauri::command]
pub async fn local_list_profiles() -> Result<Vec<LocalShellProfile>, String> {
    tokio::task::spawn_blocking(crate::local_shell::detect_profiles)
        .await
        .map_err(|e| format!("枚举本地 Shell 失败: {}", e))
}

/// 创建本地 Shell PTY 会话（支持指定 profileId、工作目录 cwd、编码、TERM 类型）
#[tauri::command]
pub async fn local_create_shell(
    app: AppHandle,
    window: tauri::WebviewWindow,
    server_id: String,
    profile_id: Option<String>,
    cwd: Option<String>,
    cols: Option<u32>,
    rows: Option<u32>,
    encoding: Option<String>,
    term_type: Option<String>,
) -> Result<CreateLocalShellResult, String> {
    let window_label = window.label().to_string();
    let cols = cols.filter(|&c| c > 0).unwrap_or(80);
    let rows = rows.filter(|&r| r > 0).unwrap_or(24);
    let encoding = encoding.unwrap_or_else(|| "utf-8".to_string());

    let result = tokio::task::spawn_blocking(move || {
        crate::local_shell::create_local_shell(
            app,
            window_label,
            server_id,
            profile_id,
            cwd,
            cols,
            rows,
            encoding,
            term_type,
        )
    })
    .await
    .map_err(|e| format!("创建本地 Shell 任务异常: {}", e))?;

    match result {
        Ok((session_id, profile)) => Ok(CreateLocalShellResult {
            success: true,
            session_id: Some(session_id),
            shell_label: Some(profile.label),
            shell_path: Some(profile.shell_path),
            error: None,
        }),
        Err(err) => Ok(CreateLocalShellResult {
            success: false,
            session_id: None,
            shell_label: None,
            shell_path: None,
            error: Some(err),
        }),
    }
}
