// 窗口管理 commands
//
// 用于支持"拖拽 Tab 创建新窗口"和"跨窗口合并"功能。

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Serialize;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// 窗口信息（供前端检测拖拽目标用）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub label: String,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// 全局鼠标状态（位置 + 左键是否按下）
/// 用于跨窗口拖拽合并：当鼠标移到另一个窗口上方时，源窗口收不到 mouseup 事件，
/// 需要通过全局 API 轮询鼠标状态来检测释放时机。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorState {
    pub x: i32,
    pub y: i32,
    pub left_button_down: bool,
}

/// 创建一个新窗口，加载与主窗口相同的前端，并通过 URL 查询参数传递初始状态。
#[tauri::command]
pub async fn window_create(
    app: tauri::AppHandle,
    label: String,
    title: String,
    state_json: String,
    x: Option<i32>,
    y: Option<i32>,
) -> Result<(), String> {
    if app.get_webview_window(&label).is_some() {
        return Err(format!("Window with label '{}' already exists", label));
    }

    let encoded = URL_SAFE_NO_PAD.encode(state_json.as_bytes());
    let url = format!("index.html?windowState={}", encoded);

    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(&title)
        .inner_size(1400.0, 900.0)
        .min_inner_size(1000.0, 700.0)
        .resizable(true);

    // 指定了坐标则在鼠标松开位置创建，否则居中
    if let (Some(x), Some(y)) = (x, y) {
        builder = builder.position(x as f64, y as f64);
    } else {
        builder = builder.center();
    }

    let window = builder
        .build()
        .map_err(|e| format!("Failed to create window: {}", e))?;

    let _ = window.show();
    Ok(())
}

/// 获取所有窗口的信息（标签、位置、大小），供前端拖拽时检测目标窗口。
#[tauri::command]
pub async fn window_list_all(app: tauri::AppHandle) -> Result<Vec<WindowInfo>, String> {
    let mut windows = Vec::new();
    for (label, win) in app.webview_windows() {
        let title = win.title().unwrap_or_default();
        let pos = win.outer_position().unwrap_or(tauri::PhysicalPosition { x: 0, y: 0 });
        let size = win.outer_size().unwrap_or(tauri::PhysicalSize { width: 0, height: 0 });
        windows.push(WindowInfo {
            label,
            title,
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
        });
    }
    Ok(windows)
}

/// 关闭指定窗口
#[tauri::command]
pub async fn window_close(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&label) {
        win.close().map_err(|e| format!("Failed to close window: {}", e))?;
    }
    Ok(())
}

/// 开始原生窗口拖拽（当窗口只有一个标签时，直接拖动窗口本身）
#[tauri::command]
pub async fn window_start_dragging(app: tauri::AppHandle) -> Result<(), String> {
    // 获取当前焦点窗口
    for (_, win) in app.webview_windows() {
        if win.is_focused().unwrap_or(false) {
            win.start_dragging().map_err(|e| format!("Failed to start dragging: {}", e))?;
            return Ok(());
        }
    }
    Err("No focused window found".to_string())
}

/// 将窗口移动到指定屏幕坐标（拖拽创建新窗口时跟随鼠标）
#[tauri::command]
pub async fn window_set_position(
    app: tauri::AppHandle,
    label: String,
    x: i32,
    y: i32,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(&label) {
        win.set_position(tauri::PhysicalPosition { x, y })
            .map_err(|e| format!("Failed to set position: {}", e))?;
    }
    Ok(())
}

/// 获取全局鼠标状态（屏幕坐标 + 左键是否按下）
///
/// 跨窗口拖拽合并的关键命令：当用户将 tab 从窗口 A 拖到窗口 B 上方释放时，
/// 窗口 A 的 webview 收不到 mouseup 事件。前端在拖拽进入"分离区"后，
/// 通过轮询此命令来检测鼠标释放时机和最终位置。
#[tauri::command]
pub async fn get_cursor_state() -> Result<CursorState, String> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::POINT;
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
        use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

        let mut point = POINT { x: 0, y: 0 };
        let pos_ok = unsafe { GetCursorPos(&mut point) } != 0;
        if !pos_ok {
            return Err("Failed to get cursor position".to_string());
        }
        // GetAsyncKeyState 返回 i16，最高位为 1 表示按键当前按下
        let left_down = (unsafe { GetAsyncKeyState(VK_LBUTTON as i32) } as u16) & 0x8000 != 0;
        Ok(CursorState {
            x: point.x,
            y: point.y,
            left_button_down: left_down,
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("get_cursor_state is only supported on Windows".to_string())
    }
}
