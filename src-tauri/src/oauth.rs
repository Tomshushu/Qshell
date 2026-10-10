use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// 启动本地 OAuth 授权回环监听服务（监听 127.0.0.1:45678）
/// 当外部浏览器完成 GitHub / OAuth 授权时，浏览器页面静默向此端口推送 Token 并唤醒主窗口，
/// 实现与 VS Code / JetBrains / Slack 一致的「浏览器授权后自动打开桌面应用并登录」体验。
pub fn start_oauth_loopback(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let addr = "127.0.0.1:45678";
        let listener = match TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[OAuth Loopback] Failed to bind {}: {}", addr, e);
                return;
            }
        };

        loop {
            let (mut socket, _) = match listener.accept().await {
                Ok(conn) => conn,
                Err(_) => continue,
            };

            let app = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut buf = [0u8; 8192];
                let n = match socket.read(&mut buf).await {
                    Ok(n) if n > 0 => n,
                    _ => return,
                };

                let req = String::from_utf8_lossy(&buf[..n]);

                // 处理 CORS preflight OPTIONS 请求
                if req.starts_with("OPTIONS") {
                    let response = "HTTP/1.1 200 OK\r\n\
                        Access-Control-Allow-Origin: *\r\n\
                        Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n\
                        Access-Control-Allow-Headers: Content-Type\r\n\
                        Content-Length: 0\r\n\
                        \r\n";
                    let _ = socket.write_all(response.as_bytes()).await;
                    return;
                }

                // 处理 POST /auth-token (来自浏览器页面的静默同步或“打开应用”按钮)
                if req.starts_with("POST /auth-token") {
                    let body = req.split("\r\n\r\n").nth(1).unwrap_or("");
                    if !body.is_empty() {
                        let _ = app.emit("oauth-session-payload", body.trim().to_string());
                        // 唤醒并聚焦 Qshell 桌面主窗口到最前面
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                        }
                    }

                    let res_body = r#"{"success":true}"#;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\n\
                        Access-Control-Allow-Origin: *\r\n\
                        Content-Type: application/json\r\n\
                        Content-Length: {}\r\n\
                        \r\n\
                        {}",
                        res_body.len(),
                        res_body
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                    return;
                }

                // 处理 GET /focus (仅唤醒主窗口)
                if req.starts_with("GET /focus") {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.unminimize();
                        let _ = win.set_focus();
                    }

                    let res_body = r#"{"focused":true}"#;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\n\
                        Access-Control-Allow-Origin: *\r\n\
                        Content-Type: application/json\r\n\
                        Content-Length: {}\r\n\
                        \r\n\
                        {}",
                        res_body.len(),
                        res_body
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                    return;
                }

                let not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
                let _ = socket.write_all(not_found.as_bytes()).await;
            });
        }
    });
}
