//! 用系统默认程序打开本地文件/文件夹。
//!
//! 前端日志功能需要"在系统文件管理器中打开日志目录 / 用默认程序打开日志文件"，
//! 但 tauri-plugin-shell 的 `open` 命令默认 scope 仅放行 http(s)://、mailto:、tel:，
//! 本地路径会被拦截（报错 "failed regex validation ..."）。
//! 因此这里直接用各平台的系统打开器执行，绕过该 URL scope 限制。

use std::process::Command;

/// 用系统默认关联程序打开指定路径（文件或文件夹）。
///
/// - Windows: `cmd /C start "" "<path>"`
/// - macOS:   `open "<path>"`
/// - Linux:   `xdg-open "<path>"`
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let raw = path.trim();
    if raw.is_empty() {
        return Err("打开失败：路径为空".to_string());
    }

    // 防御性处理：若传入的是 file:// 形式的 URL，还原为普通路径。
    let path = if let Some(stripped) = raw.strip_prefix("file://") {
        if cfg!(windows) {
            // Windows 形如 file:///C:/a/b -> 去掉前缀与首斜杠后转成反斜杠
            stripped.trim_start_matches('/').replace('/', "\\")
        } else {
            // Linux/macOS 形如 file:///home/a/b -> 直接保留 /home/a/b
            stripped.to_string()
        }
    } else {
        raw.to_string()
    };

    let status = match std::env::consts::OS {
        "windows" => Command::new("cmd").args(["/C", "start", "", &path]).spawn(),
        "macos" => Command::new("open").arg(&path).spawn(),
        _ => Command::new("xdg-open").arg(&path).spawn(),
    };

    status
        .map(|_| ())
        .map_err(|e| format!("无法打开路径：{}（{}）", path, e))
}
