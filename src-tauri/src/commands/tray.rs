use tauri::{AppHandle, Wry};

/// 同步「关闭主窗口时最小化到托盘」开关（由前端设置项调用）
#[tauri::command]
pub fn tray_set_close_to_tray(enabled: bool) {
    crate::tray::set_close_to_tray(enabled);
}

/// 同步托盘菜单的多语言文案（由前端在启动与切换语言时调用）
#[tauri::command]
pub fn tray_update_labels(
    app: AppHandle<Wry>,
    show: String,
    hide: String,
    quit: String,
    tooltip: String,
) -> Result<(), String> {
    crate::tray::update_labels(&app, &show, &hide, &quit, &tooltip)
}
