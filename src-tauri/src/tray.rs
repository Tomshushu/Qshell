//! 系统托盘（P2-30）
//!
//! 提供「关闭主窗口时最小化到托盘」、托盘菜单显示/隐藏主窗口与彻底退出。
//! 关闭窗口是否隐藏到托盘由前端设置项通过 [`tray_set_close_to_tray`] 同步，
//! 默认关闭，避免在无托盘支持的桌面环境下窗口"消失"却无法找回。

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

/// 「关闭主窗口时最小化到托盘」开关（默认关闭）
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);

/// 当前是否启用「关闭时最小化到托盘」
pub fn close_to_tray_enabled() -> bool {
    CLOSE_TO_TRAY.load(Ordering::Relaxed)
}

/// 已创建的托盘资源句柄，供前端同步多语言文案
struct TrayHandles {
    tray: TrayIcon<Wry>,
    show: MenuItem<Wry>,
    hide: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

fn show_main_window(app: &AppHandle<Wry>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn hide_main_window(app: &AppHandle<Wry>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
}

/// 创建托盘图标与菜单（应用启动时调用一次）
pub fn init(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "tray_show", "显示主窗口", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "tray_hide", "隐藏到托盘", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray_quit", "彻底退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("Qshell")
        .menu(&menu)
        // 左键点击直接唤回主窗口，右键才展开菜单
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray_show" => show_main_window(app),
            "tray_hide" => hide_main_window(app),
            "tray_quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    let tray = builder.build(app)?;
    app.manage(TrayHandles {
        tray,
        show,
        hide,
        quit,
    });
    Ok(())
}

/// 同步「关闭主窗口时最小化到托盘」开关
pub fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

/// 同步托盘菜单的多语言文案
pub fn update_labels(
    app: &AppHandle<Wry>,
    show: &str,
    hide: &str,
    quit: &str,
    tooltip: &str,
) -> Result<(), String> {
    let Some(handles) = app.try_state::<TrayHandles>() else {
        return Ok(());
    };
    handles.show.set_text(show).map_err(|e| e.to_string())?;
    handles.hide.set_text(hide).map_err(|e| e.to_string())?;
    handles.quit.set_text(quit).map_err(|e| e.to_string())?;
    handles
        .tray
        .set_tooltip(Some(tooltip))
        .map_err(|e| e.to_string())?;
    Ok(())
}
