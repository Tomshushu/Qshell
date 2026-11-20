use serde::Serialize;

use crate::launch_actions::{self, LaunchAction};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopIntegrationStatus {
    pub supported: bool,
    pub context_menu_registered: bool,
    pub deep_link_registered: bool,
}

/// 取出冷启动阶段排队等待前端消费的启动动作（Deep Link / CLI 参数）。
#[tauri::command]
pub fn app_take_pending_launch_actions() -> Vec<LaunchAction> {
    launch_actions::take_pending_actions()
}

#[cfg(target_os = "windows")]
fn hkcu_key_exists(subkey: &str) -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("reg.exe")
        .args(["query", &format!("HKCU\\{}", subkey)])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn run_reg(args: &[&str]) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = std::process::Command::new("reg.exe")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to run reg.exe: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("reg.exe exited with status {}", output.status)
        } else {
            stderr
        });
    }
    Ok(())
}

/// 查询当前系统的桌面集成状态（Windows 右键菜单与 `qshell://` Deep Link）。
#[tauri::command]
pub async fn desktop_integration_status() -> Result<DesktopIntegrationStatus, String> {
    #[cfg(target_os = "windows")]
    {
        tokio::task::spawn_blocking(|| DesktopIntegrationStatus {
            supported: true,
            context_menu_registered: hkcu_key_exists(
                "Software\\Classes\\Directory\\Background\\shell\\QshellOpenHere",
            ),
            deep_link_registered: hkcu_key_exists("Software\\Classes\\qshell"),
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(DesktopIntegrationStatus {
            supported: false,
            context_menu_registered: false,
            deep_link_registered: false,
        })
    }
}

/// 启用或移除 Windows 资源管理器右键菜单（同时同步 `qshell://` 协议关联，无需管理员权限）。
#[tauri::command]
pub async fn desktop_integration_set_context_menu(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        tokio::task::spawn_blocking(move || -> Result<(), String> {
            let exe = std::env::current_exe()
                .map_err(|e| format!("Failed to resolve current executable: {}", e))?;
            let exe_str = exe.to_string_lossy().to_string();
            let icon_val = format!("{},0", exe_str);
            let open_bg_cmd = format!("\"{}\" --new-local \"%V\"", exe_str);
            let open_dir_cmd = format!("\"{}\" --new-local \"%1\"", exe_str);
            let upload_file_cmd = format!("\"{}\" --transfer \"%1\"", exe_str);
            let deep_link_cmd = format!("\"{}\" \"%1\"", exe_str);

            if enabled {
                run_reg(&[
                    "add",
                    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\QshellOpenHere",
                    "/ve",
                    "/d",
                    "在此处打开 Qshell 终端",
                    "/f",
                ])?;
                run_reg(&[
                    "add",
                    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\QshellOpenHere",
                    "/v",
                    "Icon",
                    "/d",
                    &icon_val,
                    "/f",
                ])?;
                run_reg(&[
                    "add",
                    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\QshellOpenHere\\command",
                    "/ve",
                    "/d",
                    &open_bg_cmd,
                    "/f",
                ])?;

                run_reg(&[
                    "add",
                    "HKCU\\Software\\Classes\\Directory\\shell\\QshellOpenHere",
                    "/ve",
                    "/d",
                    "使用 Qshell 打开终端",
                    "/f",
                ])?;
                run_reg(&[
                    "add",
                    "HKCU\\Software\\Classes\\Directory\\shell\\QshellOpenHere",
                    "/v",
                    "Icon",
                    "/d",
                    &icon_val,
                    "/f",
                ])?;
                run_reg(&[
                    "add",
                    "HKCU\\Software\\Classes\\Directory\\shell\\QshellOpenHere\\command",
                    "/ve",
                    "/d",
                    &open_dir_cmd,
                    "/f",
                ])?;

                run_reg(&[
                    "add",
                    "HKCU\\Software\\Classes\\*\\shell\\QshellUpload",
                    "/ve",
                    "/d",
                    "使用 Qshell 上传",
                    "/f",
                ])?;
                run_reg(&[
                    "add",
                    "HKCU\\Software\\Classes\\*\\shell\\QshellUpload",
                    "/v",
                    "Icon",
                    "/d",
                    &icon_val,
                    "/f",
                ])?;
                run_reg(&[
                    "add",
                    "HKCU\\Software\\Classes\\*\\shell\\QshellUpload\\command",
                    "/ve",
                    "/d",
                    &upload_file_cmd,
                    "/f",
                ])?;

                // 便携版同时补齐 qshell:// 协议注册
                run_reg(&[
                    "add",
                    "HKCU\\Software\\Classes\\qshell",
                    "/ve",
                    "/d",
                    "URL:Qshell Protocol",
                    "/f",
                ])?;
                run_reg(&[
                    "add",
                    "HKCU\\Software\\Classes\\qshell",
                    "/v",
                    "URL Protocol",
                    "/d",
                    "",
                    "/f",
                ])?;
                run_reg(&[
                    "add",
                    "HKCU\\Software\\Classes\\qshell\\DefaultIcon",
                    "/ve",
                    "/d",
                    &icon_val,
                    "/f",
                ])?;
                run_reg(&[
                    "add",
                    "HKCU\\Software\\Classes\\qshell\\shell\\open\\command",
                    "/ve",
                    "/d",
                    &deep_link_cmd,
                    "/f",
                ])?;
            } else {
                for key in [
                    "HKCU\\Software\\Classes\\Directory\\Background\\shell\\QshellOpenHere",
                    "HKCU\\Software\\Classes\\Directory\\shell\\QshellOpenHere",
                    "HKCU\\Software\\Classes\\*\\shell\\QshellUpload",
                ] {
                    let _ = run_reg(&["delete", key, "/f"]);
                }
            }
            Ok(())
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Err("Explorer context menu integration is only supported on Windows".to_string())
    }
}
