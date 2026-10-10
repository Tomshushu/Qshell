// RDP 远程桌面启动器
//
// 调用系统自带的 RDP 客户端打开远程桌面会话：
// - Windows: mstsc.exe + 临时 .rdp 文件
// - Linux:   xfreerdp（FreeRDP）/ remmina
// - macOS:   open + .rdp 文件（需安装 Microsoft Remote Desktop）
//
// 设计说明：
// 1. 凭据安全：不在 .rdp 文件中写入密码，由系统 RDP 客户端弹窗让用户输入
//    （.rdp 的 password 51:b: 加密格式依赖 Windows CryptProtectData，无法跨平台）
// 2. 临时 .rdp 文件用完即删（延迟 10 秒，确保 mstsc 读取完毕）
// 3. 端口默认 3389，与 server.port（SSH 端口）解耦

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// RDP 启动配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpLaunchConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    /// 域名（可选，Windows 域账号 DOMAIN\user）
    pub domain: Option<String>,
    pub width: u32,
    pub height: u32,
    pub fullscreen: bool,
    /// 颜色深度 16/24/32
    pub color_depth: u32,
}

impl Default for RdpLaunchConfig {
    fn default() -> Self {
        Self {
            host: String::new(),
            port: 3389,
            username: String::new(),
            password: None,
            domain: None,
            width: 1920,
            height: 1080,
            fullscreen: false,
            color_depth: 32,
        }
    }
}

/// 生成 .rdp 文件内容
/// 格式：每行 `key:type:value`，type 为 s(string)/i(integer)
fn build_rdp_file_content(config: &RdpLaunchConfig) -> String {
    let full_address = if config.port == 3389 {
        config.host.clone()
    } else {
        format!("{}:{}", config.host, config.port)
    };

    // username 行：DOMAIN\user 或 user 或空（让 mstsc 弹窗输入）
    let username_line = if !config.username.is_empty() {
        if let Some(ref domain) = config.domain {
            if !domain.is_empty() {
                format!("username:s:{}\\{}\n", domain, config.username)
            } else {
                format!("username:s:{}\n", config.username)
            }
        } else {
            format!("username:s:{}\n", config.username)
        }
    } else {
        String::new()
    };

    // screen mode: 2=全屏, 1=窗口
    let screen_mode = if config.fullscreen { 2 } else { 1 };

    format!(
        "full address:s:{addr}\n\
         {user}\
         screen mode id:i:{sm}\n\
         desktopwidth:i:{w}\n\
         desktopheight:i:{h}\n\
         session bpp:i:{bpp}\n\
         prompt for credentials:i:1\n\
         authentication level:i:0\n\
         redirectclipboard:i:1\n\
         redirectprinters:i:0\n\
         keyboardhook:i:2\n\
         disable themes:i:0\n",
        addr = full_address,
        user = username_line,
        sm = screen_mode,
        w = config.width,
        h = config.height,
        bpp = config.color_depth,
    )
}

/// 写临时 .rdp 文件，返回文件路径
fn write_temp_rdp_file(content: &str) -> Result<PathBuf, String> {
    let temp_dir = std::env::temp_dir();
    // 用纳秒时间戳保证唯一性，避免多次启动冲突
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let file_name = format!("sw-rdp-{}.rdp", nanos);
    let path = temp_dir.join(file_name);
    std::fs::write(&path, content).map_err(|e| format!("Failed to write .rdp file: {}", e))?;
    Ok(path)
}

/// 启动系统 RDP 客户端
pub fn launch(config: &RdpLaunchConfig) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        launch_windows(config)
    }
    #[cfg(target_os = "linux")]
    {
        launch_linux(config)
    }
    #[cfg(target_os = "macos")]
    {
        launch_macos(config)
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = config;
        Err("RDP launch not supported on this platform".to_string())
    }
}

#[cfg(target_os = "windows")]
fn launch_windows(config: &RdpLaunchConfig) -> Result<(), String> {
    use std::process::Command;

    let cred_target_to_clean: Option<String> = None;

    let content = build_rdp_file_content(config);
    let rdp_file = write_temp_rdp_file(&content)?;

    // mstsc.exe 在 System32，PATH 中默认可用
    // spawn 不等待退出，立即可用
    Command::new("mstsc")
        .arg(&rdp_file)
        .spawn()
        .map_err(|e| format!("Failed to launch mstsc: {}", e))?;

    // 延迟 15s 清理临时 .rdp 文件与 Credential Manager 凭据（防止密码留在宿主机凭据库中）
    schedule_cleanup_with_cred(rdp_file, cred_target_to_clean);
    Ok(())
}

/// 延迟删除临时 .rdp 文件与 Credential Manager 中的 RDP 凭据
fn schedule_cleanup_with_cred(path: PathBuf, cred_target: Option<String>) {
    std::thread::spawn(move || {
        // 等待 15 秒，确保 mstsc 客户端已读取配置与凭据
        std::thread::sleep(std::time::Duration::from_secs(15));
        let _ = std::fs::remove_file(path);
        if let Some(target) = cred_target {
            use std::process::Command;
            let _ = Command::new("cmdkey")
                .arg("/delete")
                .arg(&target)
                .status();
        }
    });
}

/// 延迟删除临时 .rdp/.remmina 文件（Linux / macOS 使用）
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn schedule_cleanup(path: PathBuf) {
    std::thread::spawn(move || {
        // 等待 15 秒，确保 RDP 客户端已读取配置
        std::thread::sleep(std::time::Duration::from_secs(15));
        let _ = std::fs::remove_file(path);
    });
}

#[cfg(target_os = "linux")]
fn launch_linux(config: &RdpLaunchConfig) -> Result<(), String> {
    use std::process::Command;

    let full_address = if config.port == 3389 {
        config.host.clone()
    } else {
        format!("{}:{}", config.host, config.port)
    };

    // 优先 xfreerdp（FreeRDP）
    let mut xfreerdp = Command::new("xfreerdp");
    xfreerdp
        .arg(format!("/v:{}", full_address))
        .arg(format!("/w:{}", config.width))
        .arg(format!("/h:{}", config.height))
        .arg(format!("/bpp:{}", config.color_depth));
    if !config.username.is_empty() {
        xfreerdp.arg(format!("/u:{}", config.username));
    }
    if let Some(ref domain) = config.domain {
        if !domain.is_empty() {
            xfreerdp.arg(format!("/d:{}", domain));
        }
    }
    if config.fullscreen {
        xfreerdp.arg("/f");
    }
    match xfreerdp.spawn() {
        Ok(_) => return Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // xfreerdp 不存在，回退到 remmina
        }
        Err(e) => return Err(format!("Failed to launch xfreerdp: {}", e)),
    }

    // 回退：remmina（需生成 .remmina 配置文件）
    let content = format!(
        "[remmina]\n\
         protocol=RDP\n\
         server={addr}\n\
         username={user}\n\
         resolution_width={w}\n\
         resolution_height={h}\n\
         colordepth={bpp}\n",
        addr = full_address,
        user = config.username,
        w = config.width,
        h = config.height,
        bpp = config.color_depth,
    );
    let temp_dir = std::env::temp_dir();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = temp_dir.join(format!("sw-rdp-{}.remmina", nanos));
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write remmina config: {}", e))?;

    match Command::new("remmina").arg(&path).spawn() {
        Ok(_) => {
            schedule_cleanup(path);
            Ok(())
        }
        Err(e) => Err(format!(
            "Neither xfreerdp nor remmina found. Please install FreeRDP or Remmina. (remmina error: {})",
            e
        )),
    }
}

#[cfg(target_os = "macos")]
fn launch_macos(config: &RdpLaunchConfig) -> Result<(), String> {
    use std::process::Command;

    let content = build_rdp_file_content(config);
    let rdp_file = write_temp_rdp_file(&content)?;

    // macOS 需安装 Microsoft Remote Desktop，用 open 打开 .rdp 文件
    Command::new("open")
        .arg(&rdp_file)
        .spawn()
        .map_err(|e| format!("Failed to launch RDP client (install Microsoft Remote Desktop from App Store): {}", e))?;

    schedule_cleanup(rdp_file);
    Ok(())
}
