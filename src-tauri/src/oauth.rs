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
                        if let Some(oauth_win) = app.get_webview_window("qshell-oauth") {
                            let _ = oauth_win.destroy();
                        }
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

                // 处理 GET /callback 或 GET / (浏览器 OAuth 回调导航)
                if req.starts_with("GET /callback") || req.starts_with("GET / ") || req.starts_with("GET /?") {
                    let html = r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Qshell 登录成功</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0c0a09; color: #f2f2f2; text-align: center; }
    .card { background: #1c1917; border: 1px solid #292524; border-radius: 16px; padding: 40px 32px; max-width: 400px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
    .icon { font-size: 44px; margin-bottom: 12px; }
    h2 { margin: 0 0 8px; font-size: 20px; color: #10b981; }
    p { margin: 0; font-size: 13px; color: #a8a29e; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🎉</div>
    <h2>GitHub 授权成功</h2>
    <p id="msg">正在同步登录态并返回 Qshell 客户端...</p>
  </div>
  <script>
    const hash = window.location.hash || window.location.search;
    if (hash) {
      fetch('http://127.0.0.1:45678/auth-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: hash
      }).then(() => {
        document.getElementById('msg').innerText = '登录成功！您可以关闭此页面并返回 Qshell 客户端。';
        setTimeout(() => window.close(), 1500);
      }).catch(() => {
        document.getElementById('msg').innerText = '凭证已就绪，请返回 Qshell 客户端。';
      });
    }
  </script>
</body>
</html>"#;
                    let response = format!(
                        "HTTP/1.1 200 OK\r\n\
                        Access-Control-Allow-Origin: *\r\n\
                        Content-Type: text/html; charset=utf-8\r\n\
                        Content-Length: {}\r\n\
                        \r\n\
                        {}",
                        html.len(),
                        html
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
