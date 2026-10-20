// 文件管理 commands
//
// 对应 Electron 版 ipc.js 中的:
//   files:list / files:read / files:write / files:mkdir / files:delete
//   files:rename / files:getPermissions / files:setPermissions / files:backup
//   files:download / files:downloadArchive / files:upload / files:uploadFromPaths
//   files:getSystemRoots / files:listLocalDirectory / files:getQuickAccess
//
// 上传/下载进度通过 `transfer:progress` 事件推送到前端

use std::path::Path as StdPath;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::files;

use super::{ssh_execute_command, CommandResult, OperationResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArchiveKind {
    Zip,
    Tar,
    TarGz,
    TarBz2,
    TarXz,
    Gz,
    Bz2,
    Xz,
    SevenZip,
    Rar,
}

fn detect_archive_kind(path: &str) -> Option<ArchiveKind> {
    let name = path.rsplit(['/', '\\']).next()?.to_ascii_lowercase();
    let kind = if name.ends_with(".tar.gz") || name.ends_with(".tgz") { ArchiveKind::TarGz }
    else if name.ends_with(".tar.bz2") || name.ends_with(".tbz2") { ArchiveKind::TarBz2 }
    else if name.ends_with(".tar.xz") || name.ends_with(".txz") { ArchiveKind::TarXz }
    else if name.ends_with(".tar") { ArchiveKind::Tar }
    else if name.ends_with(".zip") { ArchiveKind::Zip }
    else if name.ends_with(".gz") { ArchiveKind::Gz }
    else if name.ends_with(".bz2") { ArchiveKind::Bz2 }
    else if name.ends_with(".xz") { ArchiveKind::Xz }
    else if name.ends_with(".7z") { ArchiveKind::SevenZip }
    else if name.ends_with(".rar") { ArchiveKind::Rar }
    else { return None };
    Some(kind)
}

fn archive_output_dir(path: &str, kind: ArchiveKind) -> String {
    let mut name = path.rsplit(['/', '\\']).next().unwrap_or("archive").to_string();
    let suffixes: &[&str] = match kind {
        ArchiveKind::TarGz => &[".tar.gz", ".tgz"],
        ArchiveKind::TarBz2 => &[".tar.bz2", ".tbz2"],
        ArchiveKind::TarXz => &[".tar.xz", ".txz"],
        ArchiveKind::Tar => &[".tar"],
        ArchiveKind::Zip => &[".zip"],
        ArchiveKind::Gz => &[".gz"],
        ArchiveKind::Bz2 => &[".bz2"],
        ArchiveKind::Xz => &[".xz"],
        ArchiveKind::SevenZip => &[".7z"],
        ArchiveKind::Rar => &[".rar"],
    };
    for suffix in suffixes {
        if name.ends_with(suffix) { name.truncate(name.len() - suffix.len()); break; }
    }
    // 纯后缀文件名（如 ".7z"）等退化场景：截断后为空或相对路径片段时，
    // 若直接拼接会得到父目录本身，导致解压内容直接落进压缩包所在目录
    if name.is_empty() || name == "." || name == ".." {
        name = "archive_extracted".to_string();
    }
    // 不能使用宿主系统的 std::path::Path 拼接远程路径：Windows 客户端处理
    // Linux 路径时会生成 `/home/user\\name`，导致远程命令在错误目录执行。
    // 直接保留输入路径最后一个分隔符的风格，兼容 POSIX、Windows 和 SFTP 路径。
    match path.rfind(['/', '\\']) {
        Some(0) => format!("{}{}", &path[..1], name),
        Some(index) => format!("{}{}{}", &path[..index], &path[index..=index], name),
        None => name,
    }
}

#[allow(dead_code)]
fn path_parent_preserving_separator(path: &str) -> String {
    match path.rfind(['/', '\\']) {
        Some(0) => path[..1].to_string(),
        Some(index) => path[..index].to_string(),
        None => ".".to_string(),
    }
}

fn archive_is_container(kind: ArchiveKind) -> bool {
    matches!(kind, ArchiveKind::Zip | ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 | ArchiveKind::TarXz | ArchiveKind::SevenZip | ArchiveKind::Rar)
}

fn archive_magic_matches(kind: ArchiveKind, bytes: &[u8]) -> bool {
    match kind {
        ArchiveKind::Zip => bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") || bytes.starts_with(b"PK\x07\x08"),
        ArchiveKind::Gz | ArchiveKind::TarGz => bytes.starts_with(&[0x1f, 0x8b]),
        ArchiveKind::Bz2 | ArchiveKind::TarBz2 => bytes.starts_with(b"BZh"),
        ArchiveKind::Xz | ArchiveKind::TarXz => bytes.starts_with(&[0xfd, b'7', b'z', b'X', b'Z', 0x00]),
        ArchiveKind::SevenZip => bytes.starts_with(&[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
        ArchiveKind::Rar => bytes.starts_with(b"Rar!\x1a\x07"),
        ArchiveKind::Tar => bytes.get(257..262) == Some(b"ustar"),
    }
}

fn archive_entries_are_safe(entries: &str) -> bool {
    entries.lines().filter(|line| !line.trim().is_empty()).all(|line| {
        let normalized = line.trim().replace('\\', "/");
        !(normalized.starts_with('/')
            || normalized.len() >= 2 && normalized.as_bytes()[1] == b':'
            || normalized.split('/').any(|part| part == ".."))
    })
}

fn validate_archive_path(path: &str) -> Result<(ArchiveKind, String), String> {
    let kind = detect_archive_kind(path).ok_or_else(||
        "Unsupported archive format. Supported: zip, tar, tar.gz/tgz, tar.bz2/tbz2, tar.xz/txz, gz, bz2, xz, 7z, rar".to_string())?;
    if path.trim().is_empty() || path.contains('\0') { return Err("Invalid archive path".to_string()); }
    Ok((kind, archive_output_dir(path, kind)))
}

fn extraction_tool_label(kind: ArchiveKind) -> &'static str {
    match kind {
        ArchiveKind::Zip => "unzip",
        ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 | ArchiveKind::TarXz => "tar",
        ArchiveKind::SevenZip | ArchiveKind::Rar => "7z",
        ArchiveKind::Gz => "gzip",
        ArchiveKind::Bz2 => "bzip2",
        ArchiveKind::Xz => "xz",
    }
}

fn extraction_tool_missing(tool: &str) -> OperationResult {
    OperationResult {
        success: false,
        error: Some("EXTRACT_TOOL_MISSING".to_string()),
        message: Some(tool.to_string()),
        id: None, os_type: None, os_info: None,
    }
}

fn linux_extraction_tool_probe(kind: ArchiveKind) -> &'static str {
    match kind {
        ArchiveKind::Zip => "if command -v unzip >/dev/null 2>&1 || command -v bsdtar >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then echo __SW_TOOL_OK__; else echo __SW_TOOL_MISSING__; fi",
        ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 | ArchiveKind::TarXz => "if command -v tar >/dev/null 2>&1 || command -v bsdtar >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then echo __SW_TOOL_OK__; else echo __SW_TOOL_MISSING__; fi",
        ArchiveKind::SevenZip => "if command -v 7z >/dev/null 2>&1 || command -v 7zz >/dev/null 2>&1 || command -v bsdtar >/dev/null 2>&1; then echo __SW_TOOL_OK__; else echo __SW_TOOL_MISSING__; fi",
        ArchiveKind::Rar => "if command -v unrar >/dev/null 2>&1 || command -v 7z >/dev/null 2>&1 || command -v 7zz >/dev/null 2>&1 || command -v bsdtar >/dev/null 2>&1; then echo __SW_TOOL_OK__; else echo __SW_TOOL_MISSING__; fi",
        ArchiveKind::Gz => "if command -v gzip >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then echo __SW_TOOL_OK__; else echo __SW_TOOL_MISSING__; fi",
        ArchiveKind::Bz2 => "if command -v bzip2 >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then echo __SW_TOOL_OK__; else echo __SW_TOOL_MISSING__; fi",
        ArchiveKind::Xz => "if command -v xz >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then echo __SW_TOOL_OK__; else echo __SW_TOOL_MISSING__; fi",
    }
}

fn linux_extraction_install_script(kind: ArchiveKind) -> String {
    let (apt, rpm, apk, pacman, zypper) = match kind {
        ArchiveKind::Zip => ("unzip", "unzip", "unzip", "unzip", "unzip"),
        ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 | ArchiveKind::TarXz => ("tar", "tar", "tar", "tar", "tar"),
        // RAR 解码器在 Debian 系是独立的 non-free 包 p7zip-rar；RPM 系的 p7zip-plugins 已含
        ArchiveKind::SevenZip => ("p7zip-full", "p7zip p7zip-plugins", "p7zip", "p7zip", "p7zip"),
        ArchiveKind::Rar => ("p7zip-full p7zip-rar", "p7zip p7zip-plugins", "p7zip", "p7zip", "p7zip"),
        ArchiveKind::Gz => ("gzip", "gzip", "gzip", "gzip", "gzip"),
        ArchiveKind::Bz2 => ("bzip2", "bzip2", "bzip2", "bzip2", "bzip2"),
        ArchiveKind::Xz => ("xz-utils", "xz", "xz", "xz", "xz"),
    };
    // macOS 上没有 apt/dnf 等包管理器，7z/rar 依赖 Homebrew 安装 p7zip（zip/tar/gzip 系统自带）
    let brew_pkg = match kind { ArchiveKind::SevenZip | ArchiveKind::Rar => "p7zip", _ => "" };
    format!("if [ -n '{brew_pkg}' ] && command -v brew >/dev/null 2>&1; then brew install {brew_pkg} && echo __SW_INSTALL_OK__ && exit 0 || exit $?; fi; run_root() {{ if [ \"$(id -u)\" -eq 0 ]; then \"$@\"; elif command -v sudo >/dev/null 2>&1; then sudo -n \"$@\"; else echo 'Administrator privileges are required to install extraction tools' >&2; return 126; fi; }}; if command -v apt-get >/dev/null 2>&1; then run_root apt-get install -y {apt}; elif command -v dnf >/dev/null 2>&1; then run_root dnf install -y {rpm}; elif command -v yum >/dev/null 2>&1; then run_root yum install -y {rpm}; elif command -v apk >/dev/null 2>&1; then run_root apk add {apk}; elif command -v pacman >/dev/null 2>&1; then run_root pacman -S --noconfirm {pacman}; elif command -v zypper >/dev/null 2>&1; then run_root zypper --non-interactive install {zypper}; else echo 'No supported package manager was found' >&2; exit 127; fi; install_status=$?; if [ \"$install_status\" -eq 0 ]; then echo __SW_INSTALL_OK__; else exit \"$install_status\"; fi")
}

/// Windows 下定位 7z.exe：winget/官方安装器默认不会把 7-Zip 写入 PATH，
/// 且本进程的 PATH 是启动时的旧值——因此除 PATH 外还需探测常见安装目录。
/// 返回可直接执行的完整路径，找不到时回退 `where.exe` 查 PATH。
#[cfg(target_os = "windows")]
fn local_windows_7z_path() -> Option<String> {
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    if let Some(root) = std::env::var_os("ProgramFiles") {
        candidates.push(StdPath::new(&root).join("7-Zip").join("7z.exe"));
    }
    if let Some(root) = std::env::var_os("ProgramFiles(x86)") {
        candidates.push(StdPath::new(&root).join("7-Zip").join("7z.exe"));
    }
    if let Some(root) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(StdPath::new(&root).join("Programs").join("7-Zip").join("7z.exe"));
    }
    for candidate in candidates {
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    let output = std::process::Command::new("where.exe").arg("7z").output().ok()?;
    if !output.status.success() { return None; }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
}

/// 解压真进度事件载荷
#[derive(Serialize, Clone)]
struct ExtractProgress {
    path: String,
    percent: f64,
}

/// 本地 Windows 7z/rar 解压：逐行读取 7z 输出统计已提取文件数，通过事件推送真实进度。
/// 行首 "- " 是 7z 的逐文件提取输出；读取完 stdout 后再收集 stderr 作为失败详情。
#[cfg(target_os = "windows")]
fn run_local_extract_with_progress(
    app: &AppHandle,
    command: &mut std::process::Command,
    archive_path: &str,
    total: usize,
) -> Result<std::process::Output, String> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| format!("Failed to start extraction tool: {}", e))?;
    let mut stdout = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let mut extracted: usize = 0;
    if let Some(handle) = stdout.as_mut() {
        let mut reader = BufReader::new(handle);
        let mut line: Vec<u8> = Vec::new();
        loop {
            line.clear();
            if reader.read_until(b'\n', &mut line).unwrap_or(0) == 0 { break; }
            if line.starts_with(b"- ") {
                extracted += 1;
                if total > 0 && (extracted % 5 == 0 || extracted == total) {
                    let percent = 8.0 + 80.0 * (extracted as f64 / total as f64);
                    let _ = app.emit("extract://progress", ExtractProgress { path: archive_path.to_string(), percent });
                }
            }
        }
    }
    let status = child.wait().map_err(|e| format!("Extraction process failed: {}", e))?;
    let mut stderr = Vec::new();
    if let Some(mut pipe) = stderr_pipe {
        use std::io::Read;
        let _ = pipe.read_to_end(&mut stderr);
    }
    Ok(std::process::Output { status, stdout: Vec::new(), stderr })
}

fn local_extraction_tool_available(kind: ArchiveKind) -> bool {
    #[cfg(target_os = "windows")]
    {
        if matches!(kind, ArchiveKind::Zip | ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 | ArchiveKind::TarXz) { return true; }
        local_windows_7z_path().is_some()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let probe = match kind {
            ArchiveKind::Zip => "command -v unzip >/dev/null 2>&1",
            ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 | ArchiveKind::TarXz => "command -v tar >/dev/null 2>&1",
            ArchiveKind::SevenZip => "command -v 7z >/dev/null 2>&1",
            ArchiveKind::Rar => "if command -v unrar >/dev/null 2>&1 || command -v 7z >/dev/null 2>&1; then exit 0; else exit 127; fi",
            ArchiveKind::Gz => "command -v gzip >/dev/null 2>&1",
            ArchiveKind::Bz2 => "command -v bzip2 >/dev/null 2>&1",
            ArchiveKind::Xz => "command -v xz >/dev/null 2>&1",
        };
        std::process::Command::new("sh").args(["-c", probe]).status().map(|status| status.success()).unwrap_or(false)
    }
}

fn local_extract_command(kind: ArchiveKind, archive: &str, dest: &str) -> std::process::Command {
    #[cfg(target_os = "windows")]
    {
        match kind {
            ArchiveKind::Zip | ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 | ArchiveKind::TarXz => {
                let mut c = std::process::Command::new("powershell.exe");
                c.args(["-NoProfile", "-NonInteractive", "-Command"]);
                let a = archive.replace('\'', "''");
                let d = dest.replace('\'', "''");
                let script = if kind == ArchiveKind::Zip {
                    format!("New-Item -ItemType Directory -Force -LiteralPath '{}' | Out-Null; Expand-Archive -LiteralPath '{}' -DestinationPath '{}' -Force", d, a, d)
                } else {
                    format!("New-Item -ItemType Directory -Force -LiteralPath '{}' | Out-Null; tar -xf '{}' -C '{}'", d, a, d)
                };
                c.arg(script);
                c
            }
            // 7z/rar/gz/bz2/xz 统一交给定位到的 7z.exe：直接 argv 传参，
            // 中文/空格路径无需引号转义；rar 不再依赖单独的 unrar（7-Zip 自带 RAR 解码）。
            // 输出目录一律等于 dest：gz/bz2/xz 由调用方传入临时目录（Windows 上固定输出名的
            // tmp 方案），若按父目录推导会把内容解到临时目录之外，导致移动步骤找不到文件
            _ => {
                let mut c = match local_windows_7z_path() {
                    Some(tool) => std::process::Command::new(tool),
                    // 兜底：理论上不可达（调用前已探测工具可用）
                    None => std::process::Command::new("7z"),
                };
                c.args(["x", "-y", "-sccUTF-8", &format!("-o{}", dest), archive]);
                c
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut c = std::process::Command::new("sh");
        let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
        let script = match kind {
            ArchiveKind::Zip => format!("mkdir -p {} && unzip -o {} -d {}", q(dest), q(archive), q(dest)),
            ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 | ArchiveKind::TarXz => format!("mkdir -p {} && tar -xf {} -C {}", q(dest), q(archive), q(dest)),
            ArchiveKind::SevenZip => format!("mkdir -p {} && 7z x -y -o{} {}", q(dest), q(dest), q(archive)),
            ArchiveKind::Rar => format!("mkdir -p {} && if command -v unrar >/dev/null 2>&1; then unrar x -o+ {} {}; elif command -v 7z >/dev/null 2>&1; then 7z x -y -o{} {}; else echo 'RAR extraction requires unrar or 7z' >&2; exit 127; fi", q(dest), q(archive), q(dest), q(dest), q(archive)),
            ArchiveKind::Gz => format!("gzip -dc {} > {}", q(archive), q(dest)),
            ArchiveKind::Bz2 => format!("bzip2 -dc {} > {}", q(archive), q(dest)),
            ArchiveKind::Xz => format!("xz -dc {} > {}", q(archive), q(dest)),
        };
        c.args(["-c", &script]);
        c
    }
}

fn list_local_archive(kind: ArchiveKind, archive: &str) -> Result<Option<String>, String> {
    if !archive_is_container(kind) { return Ok(None); }
    #[cfg(target_os = "windows")]
    let output = {
        let escaped = archive.replace('\'', "''");
        let script = match kind {
            ArchiveKind::Zip => format!("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$a='{}';Add-Type -AssemblyName System.IO.Compression.FileSystem;$z=[IO.Compression.ZipFile]::OpenRead($a);try{{$z.Entries|ForEach-Object{{$_.FullName}}}}finally{{$z.Dispose()}}", escaped),
            ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 | ArchiveKind::TarXz => format!("tar -tf '{}'", escaped),
            ArchiveKind::SevenZip | ArchiveKind::Rar => {
                // 直接用定位到的 7z.exe 列表：不经 PowerShell，避免脚本转义与 PATH 陈旧问题
                let Some(tool) = local_windows_7z_path() else {
                    return Err("7-Zip is required for this archive format".to_string());
                };
                let output = std::process::Command::new(tool).args(["l", "-slt", "-sccUTF-8", archive]).output();
                // 提前返回：与下方统一走 from_utf8_lossy 解析
                let output = output.map_err(|e| format!("Required extraction tool is unavailable: {}", e))?;
                if !output.status.success() {
                    return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
                }
                return Ok(Some(
                    String::from_utf8_lossy(&output.stdout)
                        .lines()
                        .filter_map(|line| line.strip_prefix("Path = "))
                        .skip(1)
                        .collect::<Vec<_>>()
                        .join("\n"),
                ));
            }
            _ => String::new(),
        };
        std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
    };
    #[cfg(not(target_os = "windows"))]
    let output = {
        let mut command = match kind {
            ArchiveKind::Zip => { let mut c = std::process::Command::new("unzip"); c.args(["-Z1", archive]); c }
            ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 | ArchiveKind::TarXz => { let mut c = std::process::Command::new("tar"); c.args(["-tf", archive]); c }
            ArchiveKind::SevenZip => { let mut c = std::process::Command::new("7z"); c.args(["l", "-slt", archive]); c }
            ArchiveKind::Rar => {
                // unrar 优先；缺失时回退 7z（输出为 "Path = x" 行，需解析为纯条目列表）
                let script = format!(
                    "if command -v unrar >/dev/null 2>&1; then unrar lb '{a}'; elif command -v 7z >/dev/null 2>&1; then 7z l -slt '{a}' | sed -n 's/^Path = //p' | tail -n +2; else exit 127; fi",
                    a = archive.replace('\'', "'\\''"),
                );
                let mut c = std::process::Command::new("sh");
                c.args(["-c", &script]);
                c
            }
            // 未来新增归档类型若遗漏此处，返回错误而不是 panic
            // （unreachable!() 在生产二进制里直接崩溃整个应用）
            _ => return Err("Unsupported archive kind for entry listing".to_string()),
        };
        command.output()
    };
    let output = output.map_err(|e| format!("Required extraction tool is unavailable: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let entries = String::from_utf8_lossy(&output.stdout).to_string();
    #[cfg(not(target_os = "windows"))]
    let entries = if kind == ArchiveKind::SevenZip {
        entries.lines()
            .filter_map(|line| line.strip_prefix("Path = "))
            .skip(1)
            .collect::<Vec<_>>()
            .join("\n")
    } else { entries };
    Ok(Some(entries))
}

/// 加载目标类型，失败回退为 linux
async fn load_target_type(server_id: &str) -> String {
    crate::commands::ssh::load_server_config(server_id)
        .await
        .map(|s| s.target_type)
        .unwrap_or_else(|_| "linux".to_string())
}

// ============================================================
// 传输取消注册表
// ============================================================

/// 递归传输最大深度，防止 symlink 循环导致栈溢出
/// 64 层足以覆盖正常使用场景（POSIX PATH_MAX 通常 4096，每层至少 1 字符 + /）
const MAX_RECURSION_DEPTH: u32 = 64;

// 全局限速（KB/s）：0 表示不限速
// 由前端 files_set_rate_limit 命令设置，sftp_upload_*/sftp_download_* 的 chunk 循环读取此值
// 用 AtomicU64 + Relaxed ordering：限速不需要强一致性，各 chunk 读取最新值即可
pub(crate) static RATE_LIMIT_KBPS: AtomicU64 = AtomicU64::new(0);

// 全局注册表：transfer_id -> cancel flag
// 传输开始时 register，SFTP 函数在 chunk 循环中检查 flag，用户点取消时 cancel_transfer 设 flag
// 传输结束（成功/失败/取消）时 unregister，避免内存泄漏
static TRANSFER_CANCEL_REGISTRY: std::sync::OnceLock<Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>> = std::sync::OnceLock::new();

fn cancel_registry() -> &'static Mutex<std::collections::HashMap<String, Arc<AtomicBool>>> {
    TRANSFER_CANCEL_REGISTRY.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

/// 注册一个传输任务，返回其 cancel flag
/// SFTP 函数持有 flag 引用，在 chunk 循环中检查；用户调用 cancel_transfer 时 flag 被置 true
fn register_transfer(transfer_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    // 使用 unwrap_or_else(into_inner) 避免 mutex poison 时整个 SFTP 模块瘫痪
    cancel_registry().lock().unwrap_or_else(|e| e.into_inner()).insert(transfer_id.to_string(), flag.clone());
    flag
}

/// 注销传输任务（传输结束：成功/失败/取消）
fn unregister_transfer(transfer_id: &str) {
    cancel_registry().lock().unwrap_or_else(|e| e.into_inner()).remove(transfer_id);
}

/// RAII safety net for every command that registers a cancel flag. Preflight
/// failures can return before the normal completion path; the guard prevents
/// those branches from leaving a registry entry behind forever.
struct TransferRegistrationGuard {
    transfer_id: String,
}

impl TransferRegistrationGuard {
    fn new(transfer_id: &str) -> Self {
        Self { transfer_id: transfer_id.to_string() }
    }
}

impl Drop for TransferRegistrationGuard {
    fn drop(&mut self) {
        unregister_transfer(&self.transfer_id);
    }
}

/// 取消指定传输任务。返回 true 表示找到并已取消，false 表示传输不存在或已结束
fn cancel_transfer(transfer_id: &str) -> bool {
    if let Some(flag) = cancel_registry().lock().unwrap_or_else(|e| e.into_inner()).get(transfer_id) {
        flag.store(true, Ordering::Relaxed);
        true
    } else {
        false
    }
}

/// 取消所有活跃传输任务。返回取消的任务数量
fn cancel_all_transfers() -> usize {
    let registry = cancel_registry().lock().unwrap_or_else(|e| e.into_inner());
    let mut count = 0;
    for flag in registry.values() {
        flag.store(true, Ordering::Relaxed);
        count += 1;
    }
    count
}

/// 取消传输任务（前端调用）
#[tauri::command]
pub async fn files_cancel_transfer(transfer_id: String) -> Result<bool, String> {
    let found = cancel_transfer(&transfer_id);
    if !found {
        return Ok(false);
    }
    // Do not report cancellation before the worker has left its SFTP I/O. The
    // frontend cleans the temporary file immediately after this command; a
    // short bounded wait prevents that cleanup from racing an in-flight write.
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_millis(1500);
    while tokio::time::Instant::now() < deadline {
        let still_registered = cancel_registry()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(&transfer_id);
        if !still_registered {
            break;
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
    }
    Ok(true)
}

/// 取消所有活跃传输任务并等待其在自身会话中完成临时文件清理与注销（前端在应用退出确认时调用）
/// 最多等待 1500ms 兜底，避免任何极端阻塞
#[tauri::command]
pub async fn files_cancel_all_transfers() -> Result<usize, String> {
    let count = cancel_all_transfers();
    if count == 0 {
        return Ok(0);
    }
    // 等待所有活跃传输任务响应取消信号、关闭句柄、删除会话内临时文件并注销自身
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_millis(1500);
    while tokio::time::Instant::now() < deadline {
        let remaining = cancel_registry().lock().unwrap_or_else(|e| e.into_inner()).len();
        if remaining == 0 {
            break;
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
    }
    Ok(count)
}

/// 设置全局传输限速（KB/s）
/// kbps=0 表示不限速；前端 store 持久化此值，应用启动时调用一次同步到后端
#[tauri::command]
pub async fn files_set_rate_limit(kbps: u64) -> Result<(), String> {
    RATE_LIMIT_KBPS.store(kbps, Ordering::Relaxed);
    Ok(())
}

/// 设置 SFTP 传输排除过滤规则（包含预设、自定义模式以及是否遵循本地 .gitignore）
#[tauri::command]
pub async fn files_set_exclusion_config(
    enabled: bool,
    patterns: Vec<String>,
    respect_gitignore: bool,
) -> Result<(), String> {
    crate::validators::update_exclusion_config(crate::validators::ExclusionConfig {
        enabled,
        patterns,
        respect_gitignore,
    });
    Ok(())
}

/// 递归搜索远程文件
/// Linux 执行 `find <dir> -name '*<pattern>*' -type f`，Windows 执行 `Get-ChildItem -Recurse`。
/// 返回匹配的文件路径列表（JSON 字符串），限制结果数量为 `max_results`。
#[tauri::command]
pub async fn files_search_recursive(
    server_id: String,
    dir: String,
    pattern: String,
    max_results: i64,
) -> Result<String, String> {
    // 按目标类型校验路径
    let target_type = crate::commands::ssh::load_server_config(&server_id)
        .await
        .map(|s| s.target_type)
        .unwrap_or_else(|_| "linux".to_string());
    let final_dir = if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::validators::posix_to_windows_path(&dir)
    } else {
        dir.clone()
    };
    let path_validation = crate::validators::validate_path_for_target(final_dir.clone(), false, &target_type);
    if !path_validation.valid {
        return Err(path_validation.error.unwrap_or_default());
    }
    let trimmed_pattern = pattern.trim();
    if trimmed_pattern.is_empty() {
        return Ok(serde_json::to_string(&Vec::<String>::new()).unwrap_or_else(|_| "[]".to_string()));
    }
    let max = if max_results <= 0 {
        500
    } else if max_results > 1000 {
        1000
    } else {
        max_results
    };

    let results = if target_type.eq_ignore_ascii_case("windows") {
        let mut list = crate::targets::windows::files::files_search_recursive(
            server_id, final_dir, trimmed_pattern.to_string(), max as usize,
        )
        .await?;
        for path in &mut list {
            *path = crate::targets::windows::validators::windows_to_posix_path(path);
        }
        list
    } else {
        // Linux: find + -name glob
        let escaped_dir = crate::validators::escape_shell_arg(dir);
        let escaped_pattern = crate::validators::escape_shell_arg(format!("*{}*", trimmed_pattern));
        let cmd = format!(
            "find {} -name {} -type f 2>/dev/null | head -n {}",
            escaped_dir, escaped_pattern, max
        );
        let res = ssh_execute_command(&server_id, &cmd).await;
        if res.exit_code != 0 && !res.stdout.is_empty()
            && res.stdout.trim().is_empty() && !res.stderr.trim().is_empty() {
                return Err(format!("Search failed: {}", res.stderr));
            }
        res.stdout
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect()
    };

    serde_json::to_string(&results).map_err(|e| format!("Serialize error: {}", e))
}

// ============================================================
// 远程文件操作
// ============================================================

async fn to_target_path(server_id: &str, path: &str) -> String {
    let target_type = load_target_type(server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::validators::posix_to_windows_path(path)
    } else {
        path.to_string()
    }
}

/// 列出远程目录内容
/// 返回 JSON 字符串（FileEntry[]）
#[tauri::command]
pub async fn files_list(server_id: String, dir_path: String) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    let entries = if target_type.eq_ignore_ascii_case("windows") {
        if dir_path == "/" {
            // 返回所有磁盘盘符，作为虚拟根下的子文件夹
            let drives = crate::targets::windows::files::files_list_drives(server_id.clone()).await?;
            let mut drive_entries = Vec::new();
            for drive in drives {
                let name = drive.trim_end_matches('\\').to_string(); // "C:"
                drive_entries.push(crate::parsers::FileEntry {
                    name: name.clone(),
                    path: format!("/{}/", name), // "/C:/"
                    is_directory: true,
                    size: 0,
                    modified_time: String::new(),
                    permissions: "---".to_string(),
                    owner: String::new(),
                    group: String::new(),
                    uid: None,
                    gid: None,
                });
            }
            drive_entries
        } else {
            let win_path = crate::targets::windows::validators::posix_to_windows_path(&dir_path);
            let mut list = crate::targets::windows::files::files_list(server_id, win_path).await?;
            for entry in &mut list {
                entry.path = crate::targets::windows::validators::windows_to_posix_path(&entry.path);
            }
            list
        }
    } else {
        crate::targets::linux::files::files_list(server_id, dir_path).await?
    };
    serde_json::to_string(&entries).map_err(|e| format!("Serialize error: {}", e))
}

/// 列出 Windows 服务器上的所有磁盘盘符
/// 返回 JSON 字符串（string[]），如 ["C:\\","D:\\"]
/// Linux 无盘符概念，直接返回空数组
#[tauri::command]
pub async fn files_list_drives(server_id: String) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    if !target_type.eq_ignore_ascii_case("windows") {
        return Ok(serde_json::to_string(&Vec::<String>::new())
            .unwrap_or_else(|_| "[]".to_string()));
    }
    let drives = crate::targets::windows::files::files_list_drives(server_id).await?;
    serde_json::to_string(&drives).map_err(|e| format!("Serialize error: {}", e))
}

/// 诊断 Windows 服务端的 SFTP 配置
/// 返回 JSON 字符串，包含 status/issues/recommendations
#[tauri::command]
pub async fn files_diagnose_sftp(server_id: String) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    if !target_type.eq_ignore_ascii_case("windows") {
        return Ok(serde_json::json!({
            "server_id": server_id,
            "status": "skipped",
            "issues": [],
            "recommendations": [],
            "message": "SFTP diagnostics only available for Windows servers"
        }).to_string());
    }
    crate::targets::windows::files::diagnose_sftp_config(server_id).await
}

/// 读取远程文件内容
#[tauri::command]
pub async fn files_read(server_id: String, path: String) -> Result<CommandResult, String> {
    let target_type = load_target_type(&server_id).await;
    let content_result = if target_type.eq_ignore_ascii_case("windows") {
        let win_path = crate::targets::windows::validators::posix_to_windows_path(&path);
        crate::targets::windows::files::files_read(server_id, win_path).await
    } else {
        crate::targets::linux::files::files_read(server_id, path).await
    };
    match content_result {
        Ok(content) => Ok(CommandResult {
            stdout: content,
            stderr: String::new(),
            exit_code: 0,
        }),
        Err(e) => Ok(CommandResult::err(e)),
    }
}

/// 读取远程二进制文件为 base64 字符串
///
/// 用于图片预览等需要读取二进制文件的场景。
/// 与 `files_read`（基于 cat）不同，此函数通过 SFTP 协议读取原始字节，
/// 保证二进制文件（图片、PDF 等）的数据完整性。
/// 限制：10MB（防止内存爆炸）
///
/// 路径校验按目标类型分发：Windows 允许盘符路径，其余沿用 POSIX。
#[tauri::command]
pub async fn files_read_binary(server_id: String, path: String) -> Result<String, String> {
    // 按目标类型校验路径
    let target_type = crate::commands::ssh::load_server_config(&server_id)
        .await
        .map(|s| s.target_type)
        .unwrap_or_else(|_| "linux".to_string());
    let final_path = if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::validators::posix_to_windows_path(&path)
    } else {
        path.clone()
    };
    let path_validation = crate::validators::validate_path_for_target(final_path.clone(), false, &target_type);
    if !path_validation.valid {
        return Err(path_validation.error.unwrap_or_default());
    }
    crate::ssh::manager::sftp_read_file_base64(&server_id, &final_path).await
}

/// 写入远程文件
/// content 支持 ::base64:: 前缀（二进制安全）
#[tauri::command]
pub async fn files_write(
    server_id: String,
    path: String,
    content: String,
) -> Result<CommandResult, String> {
    let target_type = load_target_type(&server_id).await;
    let result = if target_type.eq_ignore_ascii_case("windows") {
        let win_path = crate::targets::windows::validators::posix_to_windows_path(&path);
        crate::targets::windows::files::files_write(server_id, win_path, content).await
    } else {
        crate::targets::linux::files::files_write(server_id, path, content).await
    };
    match result {
        Ok(()) => Ok(CommandResult::ok("File written successfully")),
        Err(e) => Ok(CommandResult::err(e)),
    }
}

/// 创建远程目录
#[tauri::command]
pub async fn files_mkdir(server_id: String, path: String) -> Result<CommandResult, String> {
    let target_type = load_target_type(&server_id).await;
    let result = if target_type.eq_ignore_ascii_case("windows") {
        let win_path = crate::targets::windows::validators::posix_to_windows_path(&path);
        crate::targets::windows::files::files_mkdir(server_id, win_path).await
    } else {
        crate::targets::linux::files::files_mkdir(server_id, path).await
    };
    match result {
        Ok(msg) => Ok(CommandResult::ok(msg)),
        Err(e) => Ok(CommandResult::err(e)),
    }
}

/// 删除远程文件或目录
#[tauri::command]
pub async fn files_delete(server_id: String, path: String) -> Result<CommandResult, String> {
    let target_type = load_target_type(&server_id).await;
    let result = if target_type.eq_ignore_ascii_case("windows") {
        let win_path = crate::targets::windows::validators::posix_to_windows_path(&path);
        crate::targets::windows::files::files_delete(server_id, win_path).await
    } else {
        crate::targets::linux::files::files_delete(server_id, path).await
    };
    match result {
        Ok(msg) => Ok(CommandResult::ok(msg)),
        Err(e) => Ok(CommandResult::err(e)),
    }
}

/// 重命名/移动远程文件
#[tauri::command]
pub async fn files_rename(
    server_id: String,
    old_path: String,
    new_path: String,
) -> Result<CommandResult, String> {
    let target_type = load_target_type(&server_id).await;
    let result = if target_type.eq_ignore_ascii_case("windows") {
        let win_old = crate::targets::windows::validators::posix_to_windows_path(&old_path);
        let win_new = crate::targets::windows::validators::posix_to_windows_path(&new_path);
        crate::targets::windows::files::files_rename(server_id, win_old, win_new).await
    } else {
        crate::targets::linux::files::files_rename(server_id, old_path, new_path).await
    };
    match result {
        Ok(msg) => Ok(CommandResult::ok(msg)),
        Err(e) => Ok(CommandResult::err(e)),
    }
}

/// 获取远程文件权限
#[tauri::command]
pub async fn files_get_permissions(
    server_id: String,
    path: String,
) -> Result<CommandResult, String> {
    let target_type = load_target_type(&server_id).await;
    let result = if target_type.eq_ignore_ascii_case("windows") {
        let win_path = crate::targets::windows::validators::posix_to_windows_path(&path);
        crate::targets::windows::files::files_get_permissions(server_id, win_path).await
    } else {
        crate::targets::linux::files::files_get_permissions(server_id, path).await
    };
    match result {
        Ok(msg) => Ok(CommandResult::ok(msg)),
        Err(e) => Ok(CommandResult::err(e)),
    }
}

/// 设置远程文件权限
#[tauri::command]
pub async fn files_set_permissions(
    server_id: String,
    path: String,
    mode: String,
    recursive: Option<bool>,
) -> Result<CommandResult, String> {
    let recursive = recursive.unwrap_or(false);
    let target_type = load_target_type(&server_id).await;
    let result = if target_type.eq_ignore_ascii_case("windows") {
        let win_path = crate::targets::windows::validators::posix_to_windows_path(&path);
        crate::targets::windows::files::files_set_permissions(server_id, win_path, mode, recursive).await
    } else {
        crate::targets::linux::files::files_set_permissions(server_id, path, mode, recursive).await
    };
    match result {
        Ok(msg) => Ok(CommandResult::ok(msg)),
        Err(e) => Ok(CommandResult::err(e)),
    }
}

/// 备份远程文件（创建 .bak 副本）
#[tauri::command]
pub async fn files_backup(server_id: String, path: String) -> Result<CommandResult, String> {
    let target_type = load_target_type(&server_id).await;
    let result = if target_type.eq_ignore_ascii_case("windows") {
        let win_path = crate::targets::windows::validators::posix_to_windows_path(&path);
        crate::targets::windows::files::files_backup(server_id, win_path).await
    } else {
        crate::targets::linux::files::files_backup(server_id, path).await
    };
    match result {
        Ok(msg) => Ok(CommandResult::ok(msg)),
        Err(e) => Ok(CommandResult::err(e)),
    }
}

/// 修改文件属主/属组 (chown)
#[tauri::command]
pub async fn files_chown(
    server_id: String,
    path: String,
    owner: String,
    group: String,
    recursive: bool,
) -> Result<CommandResult, String> {
    let target_type = load_target_type(&server_id).await;
    let result = if target_type.eq_ignore_ascii_case("windows") {
        let win_path = crate::targets::windows::validators::posix_to_windows_path(&path);
        crate::targets::windows::files::files_chown(server_id, win_path, owner, group, recursive).await
    } else {
        crate::targets::linux::files::files_chown(server_id, path, owner, group, recursive).await
    };
    match result {
        Ok(msg) => Ok(CommandResult::ok(msg)),
        Err(e) => Ok(CommandResult::err(e)),
    }
}

/// 创建符号链接 (ln -s)
#[tauri::command]
pub async fn files_create_symlink(
    server_id: String,
    target: String,
    link_path: String,
) -> Result<CommandResult, String> {
    let target_type = load_target_type(&server_id).await;
    let result = if target_type.eq_ignore_ascii_case("windows") {
        let win_target = crate::targets::windows::validators::posix_to_windows_path(&target);
        let win_link = crate::targets::windows::validators::posix_to_windows_path(&link_path);
        crate::targets::windows::files::files_create_symlink(server_id, win_target, win_link).await
    } else {
        crate::targets::linux::files::files_create_symlink(server_id, target, link_path).await
    };
    match result {
        Ok(msg) => Ok(CommandResult::ok(msg)),
        Err(e) => Ok(CommandResult::err(e)),
    }
}

/// 获取文件详细属性信息 (stat)
/// 返回 JSON 字符串
#[tauri::command]
pub async fn files_stat_info(server_id: String, path: String) -> Result<String, String> {
    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        let win_path = crate::targets::windows::validators::posix_to_windows_path(&path);
        crate::targets::windows::files::files_stat_info(server_id, win_path).await
    } else {
        crate::targets::linux::files::files_stat_info(server_id, path).await
    }
}

// ============================================================
// 本地文件系统
// ============================================================

/// 获取系统根目录（用于本地文件选择器）
#[tauri::command]
pub async fn files_get_system_roots() -> Result<Vec<String>, String> {
    files::local::get_system_roots()
}

/// 获取快捷访问目录（桌面、下载、文档等）
#[tauri::command]
pub async fn files_get_quick_access() -> Result<String, String> {
    files::local::get_quick_access()
}

/// 列出本地目录内容
#[tauri::command]
pub async fn files_list_local_directory(path: String) -> Result<String, String> {
    files::local::list_local_directory(path)
}

/// 校验并解压本地或远程压缩文件。server_id=None 表示左侧本地文件。
/// 容器归档解压到同级同名目录；单文件压缩（gz/bz2/xz）解压为同级去后缀文件。
#[tauri::command]
pub async fn files_extract_archive(app: AppHandle, server_id: Option<String>, path: String, conflict_action: Option<String>) -> Result<OperationResult, String> {
    let (kind, base_destination) = match validate_archive_path(&path) {
        Ok(value) => value,
        Err(error) => return Ok(OperationResult::fail(error)),
    };

    if let Some(server_id) = server_id {
        let target_type = load_target_type(&server_id).await;
        let validation = crate::validators::validate_path_for_target(path.clone(), false, &target_type);
        if !validation.valid {
            return Ok(OperationResult::fail(validation.error.unwrap_or_else(|| "Invalid archive path".to_string())));
        }

        // 读取文件头，确保扩展名与实际格式一致。
        let conn = crate::ssh::manager::SshManager::global().get_connection(&server_id).map_err(|e| e.to_string())?;
        let sftp = conn.create_sftp_session().await.map_err(|e| format!("SFTP session failed: {}", e))?;
        let mut file = sftp.open(&path.replace('\\', "/")).await.map_err(|e| format!("Cannot open archive: {}", e))?;
        let mut header = vec![0u8; 512];
        let read = file.read(&mut header).await.map_err(|e| format!("Cannot read archive header: {}", e))?;
        let _ = file.shutdown().await;
        header.truncate(read);
        if !archive_magic_matches(kind, &header) {
            return Ok(OperationResult::fail("Archive extension does not match the actual file format"));
        }

        let mut destination = base_destination.clone();
        let exists = |candidate: &str| {
            let session = sftp.clone();
            let normalized = candidate.replace('\\', "/");
            async move { session.metadata(&normalized).await.is_ok() }
        };
        if exists(&destination).await {
            match conflict_action.as_deref() {
                None => return Ok(OperationResult {
                    success: false,
                    error: Some("EXTRACT_TARGET_EXISTS".to_string()),
                    message: Some(destination),
                    id: None, os_type: None, os_info: None,
                }),
                Some("keep") => {
                    let backup_base = format!("{}_bak", base_destination);
                    destination = backup_base.clone();
                    let mut index = 2u32;
                    while exists(&destination).await {
                        destination = format!("{}_{}", backup_base, index);
                        index += 1;
                    }
                }
                // 覆盖=解压到现有目录并覆盖同名文件，不删除目录中归档未包含的文件。
                Some("overwrite") => {}
                _ => return Ok(OperationResult::fail("Invalid extraction conflict action")),
            }
        }

        let is_windows = target_type.eq_ignore_ascii_case("windows");
        // 远程 Windows 上定位 7z：优先 PATH，其次官方默认安装目录（7-Zip 安装器默认不写 PATH）。
        // 定位结果存入 $tool，供后续列表/解压脚本复用（& $tool ...）。
        let win_7z_locator = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$tool=$null;$cmd=Get-Command 7z -ErrorAction SilentlyContinue;if($cmd){$tool=$cmd.Source}else{$cand=Join-Path $env:ProgramFiles '7-Zip\\7z.exe';if(Test-Path $cand){$tool=$cand}};if(-not $tool){throw '7-Zip is required for this archive format'}";
        if is_windows && matches!(kind, ArchiveKind::SevenZip | ArchiveKind::Rar | ArchiveKind::Gz | ArchiveKind::Bz2 | ArchiveKind::Xz) {
            let probe = format!("{};if($tool){{Write-Output '__SW_TOOL_OK__'}}else{{Write-Output '__SW_TOOL_MISSING__'}}", win_7z_locator);
            let checked = ssh_execute_command(&server_id, &crate::validators::build_powershell_command(&probe)).await;
            if !checked.stdout.contains("__SW_TOOL_OK__") {
                // 远程 Windows 上 7z/rar/gz/bz2/xz 全部依赖 7-Zip，提示与实际安装内容保持一致
                return Ok(extraction_tool_missing("7z"));
            }
        } else if !is_windows {
            let checked = ssh_execute_command(&server_id, linux_extraction_tool_probe(kind)).await;
            if !checked.stdout.contains("__SW_TOOL_OK__") {
                return Ok(extraction_tool_missing(extraction_tool_label(kind)));
            }
        }
        if is_windows && archive_is_container(kind) {
            let archive = path.replace('\'', "''");
            let list_script = match kind {
                ArchiveKind::Zip => format!("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$a='{}';Add-Type -AssemblyName System.IO.Compression.FileSystem;$z=[IO.Compression.ZipFile]::OpenRead($a);try{{$z.Entries|ForEach-Object{{$_.FullName}}}}finally{{$z.Dispose()}}", archive),
                ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 | ArchiveKind::TarXz => format!("tar -tf '{}'", archive),
                ArchiveKind::SevenZip | ArchiveKind::Rar => format!("{};& $tool l -slt -sccUTF-8 '{}'|Where-Object{{$_ -like 'Path = *'}}|Select-Object -Skip 1|ForEach-Object{{$_.Substring(7)}}", win_7z_locator, archive),
                _ => String::new(),
            };
            let marked_list_script = format!("{};Write-Output '__SW_LIST_OK__'", list_script);
            let listed = ssh_execute_command(&server_id, &crate::validators::build_powershell_command(&marked_list_script)).await;
            if !listed.stdout.contains("__SW_LIST_OK__") {
                return Ok(OperationResult::fail(if listed.stderr.trim().is_empty() { listed.stdout } else { listed.stderr }));
            }
            let entries = listed.stdout.replace("__SW_LIST_OK__", "");
            if !archive_entries_are_safe(&entries) {
                return Ok(OperationResult::fail("Unsafe path found in archive; extraction was blocked"));
            }
        }
        let result = if is_windows {
            let psq = |value: &str| value.replace('\'', "''");
            let archive = psq(&path);
            let dest = psq(&destination);
            let script_body = match kind {
                ArchiveKind::Zip => format!("$a='{}';$d='{}';New-Item -ItemType Directory -Force -LiteralPath $d|Out-Null;Expand-Archive -LiteralPath $a -DestinationPath $d -Force", archive, dest),
                ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 | ArchiveKind::TarXz => format!("$a='{}';$d='{}';New-Item -ItemType Directory -Force -LiteralPath $d|Out-Null;tar -xf $a -C $d", archive, dest),
                ArchiveKind::SevenZip | ArchiveKind::Rar => format!("{};$a='{}';$d='{}';New-Item -ItemType Directory -Force -LiteralPath $d|Out-Null;& $tool x -y -sccUTF-8 \"-o$d\" $a", win_7z_locator, archive, dest),
                // gz/bz2/xz：7z 会按 gzip 头内原始文件名（FNAME）输出，与预期目标名可能不符；
                // 先解到同级临时目录，再把唯一文件移动到目标路径，保证输出路径确定
                ArchiveKind::Gz | ArchiveKind::Bz2 | ArchiveKind::Xz => format!(
                    "{};$a='{}';$dest='{}';$p=Split-Path -Parent $dest;$tmp=Join-Path $p ('.__sw_tmp_'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Force -LiteralPath $tmp|Out-Null;& $tool x -y -sccUTF-8 \"-o$tmp\" $a|Out-Null;$f=@(Get-ChildItem -LiteralPath $tmp -File);if($f.Count -ne 1){{Remove-Item -LiteralPath $tmp -Force -Recurse -ErrorAction SilentlyContinue;throw 'Unexpected archive content; exactly one output file expected'}};Move-Item -LiteralPath $f[0].FullName -Destination $dest -Force;Remove-Item -LiteralPath $tmp -Force -Recurse",
                    win_7z_locator, archive, dest
                ),
            };
            let script = format!("{};Write-Output '__SW_EXTRACT_OK__'", script_body);
            ssh_execute_command(&server_id, &crate::validators::build_powershell_command(&script)).await
        } else {
            let archive = crate::validators::escape_shell_arg(path.clone());
            let dest = crate::validators::escape_shell_arg(destination.clone());
            // 优先使用系统工具；精简 Linux 镜像经常没有 unzip/tar，但通常仍带有
            // Python 标准库，因此提供 Python 兜底，避免直接报“工具不可用”。
            let list_cmd = match kind {
                ArchiveKind::Zip => format!("if command -v unzip >/dev/null 2>&1; then unzip -Z1 {}; elif command -v bsdtar >/dev/null 2>&1; then bsdtar -tf {}; elif command -v python3 >/dev/null 2>&1; then python3 -c \"import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print('\\n'.join(i.filename for i in z.infolist()))\" {}; else echo 'ZIP extraction requires unzip, bsdtar, or python3' >&2; exit 127; fi", archive, archive, archive),
                ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 | ArchiveKind::TarXz => format!("if command -v tar >/dev/null 2>&1; then tar -tf {}; elif command -v bsdtar >/dev/null 2>&1; then bsdtar -tf {}; elif command -v python3 >/dev/null 2>&1; then python3 -c \"import tarfile,sys; t=tarfile.open(sys.argv[1]); print('\\n'.join(i.name for i in t.getmembers()))\" {}; else echo 'TAR extraction requires tar, bsdtar, or python3' >&2; exit 127; fi", archive, archive, archive),
                ArchiveKind::SevenZip => format!("if command -v 7z >/dev/null 2>&1; then 7z l -slt {} | sed -n 's/^Path = //p' | tail -n +2; elif command -v 7zz >/dev/null 2>&1; then 7zz l -slt {} | sed -n 's/^Path = //p' | tail -n +2; elif command -v bsdtar >/dev/null 2>&1; then bsdtar -tf {}; else echo '7z extraction requires 7z, 7zz, or bsdtar' >&2; exit 127; fi", archive, archive, archive),
                ArchiveKind::Rar => format!("if command -v unrar >/dev/null 2>&1; then unrar lb {}; elif command -v 7z >/dev/null 2>&1; then 7z l -slt {} | sed -n 's/^Path = //p' | tail -n +2; elif command -v 7zz >/dev/null 2>&1; then 7zz l -slt {} | sed -n 's/^Path = //p' | tail -n +2; elif command -v bsdtar >/dev/null 2>&1; then bsdtar -tf {}; else echo 'RAR extraction requires unrar, 7z, 7zz, or bsdtar' >&2; exit 127; fi", archive, archive, archive, archive),
                ArchiveKind::Gz | ArchiveKind::Bz2 | ArchiveKind::Xz => String::new(),
            };
            if !list_cmd.is_empty() {
                let marked_list_cmd = format!("({}) && printf '\\n__SW_LIST_OK__\\n'", list_cmd);
                let listed = ssh_execute_command(&server_id, &marked_list_cmd).await;
                if !listed.stdout.contains("__SW_LIST_OK__") {
                    let detail = if !listed.stderr.trim().is_empty() {
                        listed.stderr
                    } else if !listed.stdout.trim().is_empty() {
                        listed.stdout
                    } else {
                        format!("Archive validation failed (exit code {})", listed.exit_code)
                    };
                    return Ok(OperationResult::fail(detail));
                }
                let entries = listed.stdout.replace("__SW_LIST_OK__", "");
                if !archive_entries_are_safe(&entries) {
                    return Ok(OperationResult::fail("Unsafe path found in archive; extraction was blocked"));
                }
            }
            let extract_body = match kind {
                ArchiveKind::Zip => format!("mkdir -p {} && if command -v unzip >/dev/null 2>&1; then unzip -o {} -d {}; elif command -v bsdtar >/dev/null 2>&1; then bsdtar -xf {} -C {}; elif command -v python3 >/dev/null 2>&1; then python3 -c \"import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])\" {} {}; else echo 'ZIP extraction requires unzip, bsdtar, or python3' >&2; exit 127; fi", dest, archive, dest, archive, dest, archive, dest),
                ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 | ArchiveKind::TarXz => format!("mkdir -p {} && if command -v tar >/dev/null 2>&1; then tar -xf {} -C {}; elif command -v bsdtar >/dev/null 2>&1; then bsdtar -xf {} -C {}; elif command -v python3 >/dev/null 2>&1; then python3 -c \"import sys,tarfile; tarfile.open(sys.argv[1]).extractall(sys.argv[2])\" {} {}; else echo 'TAR extraction requires tar, bsdtar, or python3' >&2; exit 127; fi", dest, archive, dest, archive, dest, archive, dest),
                ArchiveKind::SevenZip => format!("mkdir -p {} && if command -v 7z >/dev/null 2>&1; then 7z x -y -o{} {}; elif command -v 7zz >/dev/null 2>&1; then 7zz x -y -o{} {}; elif command -v bsdtar >/dev/null 2>&1; then bsdtar -xf {} -C {}; else echo '7z extraction requires 7z, 7zz, or bsdtar' >&2; exit 127; fi", dest, dest, archive, dest, archive, archive, dest),
                ArchiveKind::Rar => format!("mkdir -p {} && if command -v unrar >/dev/null 2>&1; then unrar x -o+ {} {}; elif command -v 7z >/dev/null 2>&1; then 7z x -y -o{} {}; elif command -v 7zz >/dev/null 2>&1; then 7zz x -y -o{} {}; elif command -v bsdtar >/dev/null 2>&1; then bsdtar -xf {} -C {}; else echo 'RAR extraction requires unrar, 7z, 7zz, or bsdtar' >&2; exit 127; fi", dest, archive, dest, dest, archive, dest, archive, archive, dest),
                ArchiveKind::Gz => format!("if command -v gzip >/dev/null 2>&1; then gzip -dc {} > {}; elif command -v python3 >/dev/null 2>&1; then python3 -c \"import gzip,shutil,sys; shutil.copyfileobj(gzip.open(sys.argv[1],'rb'),open(sys.argv[2],'wb'))\" {} {}; else echo 'GZip extraction requires gzip or python3' >&2; exit 127; fi", archive, dest, archive, dest),
                ArchiveKind::Bz2 => format!("if command -v bzip2 >/dev/null 2>&1; then bzip2 -dc {} > {}; elif command -v python3 >/dev/null 2>&1; then python3 -c \"import bz2,shutil,sys; shutil.copyfileobj(bz2.open(sys.argv[1],'rb'),open(sys.argv[2],'wb'))\" {} {}; else echo 'BZip2 extraction requires bzip2 or python3' >&2; exit 127; fi", archive, dest, archive, dest),
                ArchiveKind::Xz => format!("if command -v xz >/dev/null 2>&1; then xz -dc {} > {}; elif command -v python3 >/dev/null 2>&1; then python3 -c \"import lzma,shutil,sys; shutil.copyfileobj(lzma.open(sys.argv[1],'rb'),open(sys.argv[2],'wb'))\" {} {}; else echo 'XZ extraction requires xz or python3' >&2; exit 127; fi", archive, dest, archive, dest),
            };
            let extract_cmd = format!("({}) && printf '\\n__SW_EXTRACT_OK__\\n'", extract_body);
            ssh_execute_command(&server_id, &extract_cmd).await
        };
        if result.exit_code == 0 || result.stdout.contains("__SW_EXTRACT_OK__") {
            Ok(OperationResult::ok_with_message(format!("Extracted to {}", destination)))
        } else {
            let detail = if !result.stderr.trim().is_empty() {
                result.stderr
            } else if !result.stdout.trim().is_empty() {
                result.stdout
            } else {
                format!("Extraction failed (exit code {})", result.exit_code)
            };
            Ok(OperationResult::fail(detail))
        }
    } else {
        // 探测涉及启动子进程（where.exe / 文件检查），放入阻塞线程池避免卡住 async worker
        let tool_ready = tokio::task::spawn_blocking(move || local_extraction_tool_available(kind))
            .await
            .unwrap_or(false);
        if !tool_ready {
            // 本地 Windows 上 7z/rar/gz/bz2/xz 全部依赖 7-Zip，提示与实际安装内容保持一致
            let label = if cfg!(target_os = "windows")
                && !matches!(kind, ArchiveKind::Zip | ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 | ArchiveKind::TarXz)
            { "7z" } else { extraction_tool_label(kind) };
            return Ok(extraction_tool_missing(label));
        }
        let mut destination = base_destination.clone();
        if StdPath::new(&destination).exists() {
            match conflict_action.as_deref() {
                None => return Ok(OperationResult {
                    success: false,
                    error: Some("EXTRACT_TARGET_EXISTS".to_string()),
                    message: Some(destination),
                    id: None, os_type: None, os_info: None,
                }),
                Some("keep") => {
                    let backup_base = format!("{}_bak", base_destination);
                    destination = backup_base.clone();
                    let mut index = 2u32;
                    while StdPath::new(&destination).exists() {
                        destination = format!("{}_{}", backup_base, index);
                        index += 1;
                    }
                }
                // 覆盖=合并到现有目录并覆盖同名文件，不删除无冲突内容。
                Some("overwrite") => {}
                _ => return Ok(OperationResult::fail("Invalid extraction conflict action")),
            }
        }
        // 非 Windows 平台无本地逐文件真进度，app 仅在 Windows 分支使用
        #[allow(unused_variables)]
        let app_for_task = app.clone();
        let path_for_task = path.clone();
        let destination_for_task = destination.clone();
        let conflict_action_for_task = conflict_action.clone();
        let output = tokio::task::spawn_blocking(move || {
            let mut file = std::fs::File::open(&path_for_task).map_err(|e| format!("Cannot open archive: {}", e))?;
            use std::io::Read;
            let mut header = vec![0u8; 512];
            let read = file.read(&mut header).map_err(|e| format!("Cannot read archive header: {}", e))?;
            header.truncate(read);
            if !archive_magic_matches(kind, &header) {
                return Err("Archive extension does not match the actual file format".to_string());
            }
            let entries_opt = list_local_archive(kind, &path_for_task)?;
            // 列表条目数作为真进度分母（gz/bz2/xz 无列表，total=0 表示无真进度，仅 Windows 进度上报使用）
            #[cfg(target_os = "windows")]
            let total = entries_opt
                .as_ref()
                .map(|entries| entries.lines().filter(|line| !line.trim().is_empty()).count())
                .unwrap_or(0);
            if let Some(entries) = &entries_opt {
                if !archive_entries_are_safe(entries) {
                    return Err("Unsafe path found in archive; extraction was blocked".to_string());
                }
            }
            // 「覆盖」= 干净覆盖：先清空既有目标（目录或单文件），避免旧文件混入解压结果
            if conflict_action_for_task.as_deref() == Some("overwrite") {
                let target = StdPath::new(&destination_for_task);
                if archive_is_container(kind) {
                    if target.is_dir() {
                        std::fs::remove_dir_all(target).map_err(|e| format!("Cannot clean existing directory: {}", e))?;
                    }
                } else if target.is_file() {
                    std::fs::remove_file(target).map_err(|e| format!("Cannot remove existing file: {}", e))?;
                }
            }
            let is_container = archive_is_container(kind);
            if is_container { std::fs::create_dir_all(&destination_for_task).map_err(|e| format!("Cannot create extraction directory: {}", e))?; }

            // 本地 Windows 上 7z/rar 解压逐文件上报真实进度（extract://progress 事件）
            #[cfg(target_os = "windows")]
            if is_container && matches!(kind, ArchiveKind::SevenZip | ArchiveKind::Rar) {
                let mut command = local_extract_command(kind, &path_for_task, &destination_for_task);
                return run_local_extract_with_progress(&app_for_task, &mut command, &path_for_task, total);
            }

            // gz/bz2/xz：7z 会按 gzip 头内原始文件名（FNAME）输出，与预期目标名可能不符；
            // 先解到同级临时目录，再把唯一文件移动到目标路径，保证输出路径确定
            #[cfg(target_os = "windows")]
            if !is_container {
                let parent = StdPath::new(&destination_for_task).parent().unwrap_or_else(|| StdPath::new(".")).to_path_buf();
                let tmp_dir = parent.join(format!(".__sw_ext_tmp_{}", std::process::id()));
                std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("Cannot create temp directory: {}", e))?;
                let result = (|| -> Result<std::process::Output, String> {
                    let mut command = local_extract_command(kind, &path_for_task, tmp_dir.to_string_lossy().as_ref());
                    let out = command.output().map_err(|e| format!("Failed to start extraction tool: {}", e))?;
                    if !out.status.success() { return Ok(out); }
                    let mut files: Vec<std::path::PathBuf> = Vec::new();
                    for entry in std::fs::read_dir(&tmp_dir).map_err(|e| format!("Cannot inspect temp directory: {}", e))?.flatten() {
                        let entry_path = entry.path();
                        if entry_path.is_file() { files.push(entry_path); }
                    }
                    if files.len() != 1 {
                        return Err("Unexpected archive content; exactly one output file expected".to_string());
                    }
                    if std::fs::rename(&files[0], &destination_for_task).is_err() {
                        std::fs::copy(&files[0], &destination_for_task).map_err(|e| format!("Cannot move extracted file: {}", e))?;
                        let _ = std::fs::remove_file(&files[0]);
                    }
                    Ok(out)
                })();
                let _ = std::fs::remove_dir_all(&tmp_dir);
                return result;
            }

            local_extract_command(kind, &path_for_task, &destination_for_task).output().map_err(|e| format!("Failed to start extraction tool: {}", e))
        }).await.map_err(|e| format!("Extraction task failed: {}", e))?;
        match output {
            Ok(output) if output.status.success() => Ok(OperationResult::ok_with_message(format!("Extracted to {}", destination))),
            Ok(output) => Ok(OperationResult::fail(String::from_utf8_lossy(&output.stderr).trim().to_string())),
            Err(error) => Ok(OperationResult::fail(error)),
        }
    }
}

/// 用户确认后，为本机或远程服务器安装当前压缩格式所需的解压工具。
/// 软件包名称与命令均由后端白名单生成，不接受前端传入任意安装命令。
#[tauri::command]
pub async fn files_install_extraction_tool(server_id: Option<String>, path: String) -> Result<OperationResult, String> {
    let (kind, _) = match validate_archive_path(&path) {
        Ok(value) => value,
        Err(error) => return Ok(OperationResult::fail(error)),
    };
    let windows_script = "$winget=Get-Command winget -ErrorAction SilentlyContinue;$choco=Get-Command choco -ErrorAction SilentlyContinue;if($winget){winget install --id 7zip.7zip -e --accept-package-agreements --accept-source-agreements --silent}elseIf($choco){choco install 7zip -y}else{Write-Error 'Install 7-Zip with winget or Chocolatey, then retry';exit 127};if($LASTEXITCODE -eq 0){Write-Output '__SW_INSTALL_OK__'}else{exit $LASTEXITCODE}";
    let is_local_install = server_id.is_none();
    let mut installed_on_windows_target = false;
    let result = if let Some(server_id) = server_id {
        let target_type = load_target_type(&server_id).await;
        if target_type.eq_ignore_ascii_case("windows") {
            installed_on_windows_target = true;
            ssh_execute_command(&server_id, &crate::validators::build_powershell_command(windows_script)).await
        } else {
            ssh_execute_command(&server_id, &linux_extraction_install_script(kind)).await
        }
    } else {
        let script = if cfg!(target_os = "windows") { windows_script.to_string() } else { linux_extraction_install_script(kind) };
        let output = tokio::task::spawn_blocking(move || {
            if cfg!(target_os = "windows") {
                std::process::Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", &script]).output()
            } else {
                std::process::Command::new("sh").args(["-c", &script]).output()
            }
        }).await.map_err(|error| format!("Tool installation task failed: {}", error))?
          .map_err(|error| format!("Failed to start package manager: {}", error))?;
        CommandResult {
            stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
            exit_code: output.status.code().unwrap_or(-1),
        }
    };
    if result.stdout.contains("__SW_INSTALL_OK__") {
        // 本地 Windows 与远程 Windows 上 7z/rar/gz/bz2/xz 都安装 7-Zip，提示与实际一致
        let label = if ((is_local_install && cfg!(target_os = "windows")) || installed_on_windows_target)
            && !matches!(kind, ArchiveKind::Zip | ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 | ArchiveKind::TarXz)
        { "7z" } else { extraction_tool_label(kind) };
        Ok(OperationResult::ok_with_message(format!("Installed {}", label)))
    } else {
        let detail = if !result.stderr.trim().is_empty() { result.stderr } else if !result.stdout.trim().is_empty() { result.stdout } else { format!("Tool installation failed (exit code {})", result.exit_code) };
        Ok(OperationResult::fail(detail))
    }
}

#[cfg(test)]
mod local_upload_stats_tests {
    use super::{archive_output_dir, calculate_local_upload_stats, ArchiveKind};

    #[test]
    fn linux_archive_destination_uses_posix_separator() {
        assert_eq!(archive_output_dir("/home/ubuntu/app.tar.gz", ArchiveKind::TarGz), "/home/ubuntu/app");
        assert_eq!(archive_output_dir("/app.zip", ArchiveKind::Zip), "/app");
        assert_eq!(archive_output_dir(r"C:\Users\demo\app.zip", ArchiveKind::Zip), r"C:\Users\demo\app");
    }

    #[test]
    fn counts_multiple_files_and_nested_directory_bytes() {
        let root = std::env::temp_dir().join(format!("sw-upload-stats-{}", uuid::Uuid::new_v4()));
        let nested = root.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(root.join("a.bin"), vec![1u8; 13]).unwrap();
        std::fs::write(nested.join("b.bin"), vec![2u8; 29]).unwrap();
        let paths = vec![root.to_string_lossy().to_string()];
        let stats = calculate_local_upload_stats(&paths);
        assert_eq!(stats.total_files, 2);
        assert_eq!(stats.total_bytes, 42);
        assert!(stats.has_directories);
        std::fs::remove_dir_all(&root).unwrap();
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalUploadStats {
    pub total_files: u64,
    pub total_bytes: u64,
    pub has_directories: bool,
}

fn calculate_local_upload_stats(paths: &[String]) -> LocalUploadStats {
    fn scan(path: &StdPath, stats: &mut LocalUploadStats, extra_rules: &[String]) {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if crate::validators::is_ignored_with_extra(name, extra_rules) { return; }
        let metadata = match std::fs::symlink_metadata(path) {
            Ok(value) => value,
            Err(_) => return,
        };
        if metadata.file_type().is_symlink() { return; }
        if metadata.is_file() {
            stats.total_files = stats.total_files.saturating_add(1);
            stats.total_bytes = stats.total_bytes.saturating_add(metadata.len());
        } else if metadata.is_dir() {
            stats.has_directories = true;
            let dir_rules = crate::validators::parse_gitignore_in_dir(path);
            let mut current_rules = extra_rules.to_vec();
            if !dir_rules.is_empty() {
                current_rules.extend(dir_rules);
            }
            if let Ok(entries) = std::fs::read_dir(path) {
                for entry in entries.flatten() { scan(&entry.path(), stats, &current_rules); }
            }
        }
    }

    let mut stats = LocalUploadStats { total_files: 0, total_bytes: 0, has_directories: false };
    for path in paths { scan(StdPath::new(path), &mut stats, &[]); }
    stats
}

/// 递归统计拖拽上传内容。由 Rust 读取本地路径，避免 WebView 文件 API
/// 在 Windows 原生拖放路径上读取失败；目录中任意数量的文件都计入总量。
#[tauri::command]
pub async fn files_get_local_upload_stats(paths: Vec<String>) -> Result<LocalUploadStats, String> {
    tokio::task::spawn_blocking(move || calculate_local_upload_stats(&paths))
        .await
        .map_err(|e| format!("Local upload scan failed: {}", e))
}

// ============================================================
// 文件传输（上传/下载）
// ============================================================

/// 传输进度数据（与前端 TransferProgressData 对应）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub transfer_id: String,
    pub r#type: String,
    pub current: u64,
    pub total: u64,
    pub file_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    /// total 字段的语义类型："bytes"（字节级进度）或 "count"（文件计数进度，目录递归传输时使用）
    /// 前端据此决定进度展示格式，避免对 total 大小做启发式猜测
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_type: Option<String>,
    /// 临时文件路径（仅首个进度事件携带，前端用于断点续传）
    /// 上传：远程临时文件路径；下载：本地临时文件路径
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tmp_path: Option<String>,
    /// 失败原因（仅 done=false 的失败结束事件携带，前端用于将传输记录置为失败并显示原因）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 下载结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDownloadResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
}

/// 上传结果
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileUploadResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub results: Vec<UploadFileResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadFileResult {
    pub file_name: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 发送传输进度事件到前端
fn send_progress(app: &AppHandle, progress: TransferProgress) {
    let _ = app.emit("transfer:progress", &progress);
}

/// 获取本地指定路径所在磁盘的可用空间（字节）
/// 跨平台实现：Windows 用 GetDiskFreeSpaceExW，Unix 用 df 命令
/// 失败时返回 Err，调用方可选择跳过预检
fn get_local_available_space(path: &str) -> Result<u64, String> {
    // 取目标路径的父目录（文件场景）或目录本身，确保路径存在可查询
    let check_path = match StdPath::new(path).parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
        _ => std::path::PathBuf::from(path),
    };
    let check_str = check_path.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let wide: Vec<u16> = std::ffi::OsStr::new(&check_str)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut free_bytes: u64 = 0;
        let mut total_bytes: u64 = 0;
        let mut total_free_bytes: u64 = 0;
        let ok = unsafe {
            GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut free_bytes as *mut u64 as *mut _,
                &mut total_bytes as *mut u64 as *mut _,
                &mut total_free_bytes as *mut u64 as *mut _,
            )
        };
        if ok != 0 {
            Ok(free_bytes)
        } else {
            Err(format!("GetDiskFreeSpaceExW failed for {}", check_str))
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // POSIX df -kP <path> 输出 1K-blocks，跨平台兼容（GNU/BSD/BusyBox/macOS 均支持）
        // 第二行字段：Filesystem 1024-blocks Used Available Capacity Mounted-on
        // Available（字节）= fields[3] * 1024
        let output = std::process::Command::new("df")
            .arg("-kP")
            .arg(&check_str)
            .output()
            .map_err(|e| format!("df command failed: {}", e))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = stdout.lines().collect();
        if lines.len() >= 2 {
            let fields: Vec<&str> = lines[1].split_whitespace().collect();
            if fields.len() >= 4 {
                if let Ok(free_kb) = fields[3].parse::<u64>() {
                    return Ok(free_kb * 1024);
                }
            }
        }
        Err("Could not parse df output".to_string())
    }
}

/// 查询远程文件/目录的总大小（字节）
/// 单文件：stat -c %s；目录：du -sb（可能较慢，有 10s 超时）
/// 失败返回 None（调用方跳过预检）
async fn get_remote_size(server_id: &str, remote_path: &str, is_dir: bool) -> Option<u64> {
    let target_type = load_target_type(server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        if is_dir {
            None
        } else {
            let meta = crate::ssh::manager::sftp_stat(server_id, remote_path).await.ok()?;
            Some(meta.len())
        }
    } else {
        let escaped = crate::validators::escape_shell_arg(remote_path.to_string());
        let cmd = if is_dir {
            // du -sb 输出: <bytes>\t<path>
            format!("du -sb {} 2>/dev/null | head -1", escaped)
        } else {
            format!("stat -c %s {} 2>/dev/null", escaped)
        };
        let out = crate::ssh::manager::SshManager::global()
            .execute(server_id, &cmd, 10)
            .await
            .ok()?;
        let stdout = out.stdout.trim();
        if is_dir {
            // du 输出格式：<bytes>\t<path>，取第一个字段
            stdout.split('\t').next()?.trim().parse::<u64>().ok()
        } else {
            stdout.parse::<u64>().ok()
        }
    }
}

/// 下载远程文件或目录
///
/// - 文件：弹出保存对话框，单文件下载
/// - 目录：弹出选择目录对话框，递归下载
#[tauri::command]
pub async fn files_download(
    app: AppHandle,
    server_id: String,
    remote_path: String,
    local_dest: Option<String>,
) -> Result<FileDownloadResult, String> {
    use tauri_plugin_dialog::DialogExt;

    let target_type = load_target_type(&server_id).await;

    // 校验路径（按目标类型分发，Windows 允许盘符路径 /C:/... 或 C:\...）
    let path_validation = crate::validators::validate_path_for_target(remote_path.clone(), false, &target_type);
    if !path_validation.valid {
        return Ok(FileDownloadResult {
            success: false,
            error: Some(format!(
                "Invalid path: {}",
                path_validation.error.unwrap_or_default()
            )),
            local_path: None,
        });
    }

    let target_remote_path = if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::validators::posix_to_windows_path(&remote_path)
    } else {
        remote_path.clone()
    };

    let transfer_id = format!("dl-{}", uuid::Uuid::new_v4());
    // 文件名提取：兼容 / 和 \ 分隔符（Windows 路径可能用 \）
    let file_name = remote_path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("file")
        .to_string();

    // 判断远程路径是文件还是目录
    // 优先用 SFTP stat（跨平台）；失败时回退 shell 命令（Linux 用 test -d，Windows 无可靠回退）
    let is_remote_dir = match crate::ssh::manager::sftp_stat(&server_id, &target_remote_path).await {
        Ok(meta) => meta.is_dir(),
        Err(_) => {
            if target_type.eq_ignore_ascii_case("windows") {
                // Windows 下 test -d 不可用（PowerShell/cmd 无此命令），回退为 false（按文件处理）
                false
            } else {
                let escaped_path = crate::validators::escape_shell_arg(target_remote_path.clone());
                let stat_cmd = format!("test -d {} && echo \"dir\" || echo \"file\"", escaped_path);
                let stat_res = ssh_execute_command(&server_id, &stat_cmd).await;
                stat_res.stdout.trim() == "dir"
            }
        }
    };

    // 弹出对话框选择保存位置
    let local_path = if let Some(dest) = local_dest {
        let path_buf = std::path::Path::new(&dest);
        if is_remote_dir {
            // 如果 dest 已经是完整目标目录路径（即 basename 与 remote 目录名一致，或为副本名如 name(1)），
            // 直接作为目标目录；若 dest 是父目录（如 files.tsx 批量下载传入的已存在目标目录），
            // 则将其拼接 file_name
            let dest_name = path_buf.file_name().and_then(|n| n.to_str()).unwrap_or("");
            let is_same_or_dup = dest_name == file_name 
                || (dest_name.starts_with(&file_name) && dest_name.ends_with(')'));
            if is_same_or_dup || !path_buf.is_dir() {
                dest
            } else {
                path_buf.join(&file_name).to_string_lossy().to_string()
            }
        } else if path_buf.is_dir() {
            path_buf.join(&file_name).to_string_lossy().to_string()
        } else {
            dest
        }
    } else if is_remote_dir {
        // 目录：选择目标文件夹
        let folder = app
            .dialog()
            .file()
            .set_title("Download to Folder")
            .blocking_pick_folder();
        match folder {
            Some(p) => std::path::Path::new(&p.to_string()).join(&file_name).to_string_lossy().to_string(),
            None => {
                return Ok(FileDownloadResult {
                    success: false,
                    error: Some("User canceled".to_string()),
                    local_path: None,
                })
            }
        }
    } else {
        // 文件：选择保存位置
        let file = app
            .dialog()
            .file()
            .set_title("Save File")
            .set_file_name(&file_name)
            .blocking_save_file();
        match file {
            Some(p) => p.to_string(),
            None => {
                return Ok(FileDownloadResult {
                    success: false,
                    error: Some("User canceled".to_string()),
                    local_path: None,
                })
            }
        }
    };

    // 磁盘空间预检：查询远程文件大小，与本地可用空间对比
    // 失败（查询不到大小或磁盘空间）时跳过预检，不阻塞下载（失败由后续传输过程捕获）
    if let Some(remote_size) = get_remote_size(&server_id, &target_remote_path, is_remote_dir).await {
        match get_local_available_space(&local_path) {
            Ok(available) => {
                // 5% 安全余量：文件系统元数据、簇对齐等开销
                let needed = remote_size + remote_size / 20;
                if needed > available {
                    return Ok(FileDownloadResult {
                        success: false,
                        error: Some(format!(
                            "Insufficient disk space: required ~{} bytes ({} with 5% margin), available {} bytes",
                            remote_size, needed, available
                        )),
                        local_path: None,
                    });
                }
            }
            Err(e) => {
                // 磁盘空间查询失败：记录但不阻塞下载
                eprintln!("[Disk Space] Pre-check skipped: {}", e);
            }
        }
    }

    let send = |current: u64, total: u64, name: &str, total_type: &str, done: Option<bool>| {
        send_progress(
            &app,
            TransferProgress {
                transfer_id: transfer_id.clone(),
                r#type: "download".to_string(),
                current,
                total,
                file_name: name.to_string(),
                done,
                phase: None,
                total_type: Some(total_type.to_string()),
                tmp_path: None,
                error: None,
            },
        );
    };

    // 注册传输任务，获取 cancel flag（用户可调用 files_cancel_transfer 取消）
    let cancel_flag = register_transfer(&transfer_id);
    let _transfer_guard = TransferRegistrationGuard::new(&transfer_id);
    let cancel_ref: Option<&Arc<AtomicBool>> = Some(&cancel_flag);

    // 执行下载
    let result = if is_remote_dir {
        // 文件夹下载：先发送一个携带顶层文件夹名的初始事件，让前端能绑定源/目标路径
        // 后续子文件进度事件的 file_name 是子文件名，但此时记录已存在，不会再查 pendingPathsRef
        send_progress(
            &app,
            TransferProgress {
                transfer_id: transfer_id.clone(),
                r#type: "download".to_string(),
                current: 0,
                total: 0,
                file_name: file_name.clone(),
                done: None,
                phase: None,
                total_type: Some("count".to_string()),
                tmp_path: None,
                error: None,
            },
        );
        // 递归下载目录：total 为文件计数（不支持断点续传）
        let local_base = local_path.clone();
        download_dir_recursive(&app, &server_id, &target_remote_path, &local_base, &send, cancel_ref).await
    } else {
        // 单文件下载：生成临时文件路径，发送携带 tmp_path 的初始事件（前端用于断点续传）
        // 统一使用 .sw-dl-tmp-{uuid} 命名，满足 validators.rs 格式校验并支持断点续传
        let tmp_local_path = format!("{}.sw-dl-tmp-{}", local_path, uuid::Uuid::new_v4());
        send_progress(
            &app,
            TransferProgress {
                transfer_id: transfer_id.clone(),
                r#type: "download".to_string(),
                current: 0,
                total: 0,
                file_name: file_name.clone(),
                done: None,
                phase: None,
                total_type: Some("bytes".to_string()),
                tmp_path: Some(tmp_local_path.clone()),
                error: None,
            },
        );
        download_single_file(&server_id, &target_remote_path, &local_path, &tmp_local_path, &send, cancel_ref).await
    };

    // 无论成功/失败/取消都注销，避免内存泄漏和过期取消
    unregister_transfer(&transfer_id);

    match result {
        Ok(()) => {
            // current/total 设为 0 表示不更新进度值，只标记完成
            send(0, 0, &file_name, "bytes", Some(true));
            Ok(FileDownloadResult {
                success: true,
                error: None,
                local_path: Some(local_path),
            })
        }
        Err(e) => {
            // 失败也必须发送 done=false 终态事件：前端传输记录只有收到该事件才会置为 failed，
            // 否则记录永久卡在 transferring（spinner 永转、无法清空列表、定时器空转），
            // 只有断开连接才能解锁。error 一并携带，前端用于展示失败原因。
            send_progress(
                &app,
                TransferProgress {
                    transfer_id: transfer_id.clone(),
                    r#type: "download".to_string(),
                    current: 0,
                    total: 0,
                    file_name: file_name.clone(),
                    done: Some(false),
                    phase: None,
                    total_type: Some("bytes".to_string()),
                    tmp_path: None,
                    error: Some(e.clone()),
                },
            );
            Ok(FileDownloadResult {
                success: false,
                error: Some(e),
                local_path: None,
            })
        }
    }
}

// ── 传输自动重连基础设施 ─────────────────────────────────────────────────────
// OpenSSH 服务端默认在 1GiB 流量处发起 rekey（RekeyLimit 默认 1G），russh 0.45
// 客户端在传输中途收到服务端 KEXINIT 时会话会崩溃（客户端侧 rekey 已通过
// limits 禁用，但无法阻止服务端发起）。表现为大文件传输在 ~1023MB 处必然断开。
// 此处实现应用层「自动重连 + 断点续传重试」，让 rekey 断点对用户无感。

/// 连续零推进重试上限：重试后数据偏移毫无推进（连上即断 / 服务端拒绝）达
/// 到上限即放弃并返回原始错误。只要有推进就不消耗预算，任意大的文件都能
/// 跨过多次 1GiB rekey 断点。
const TRANSFER_RETRY_ZERO_PROGRESS_MAX: u32 = 4;
/// 重试退避基数（ms）：800ms × 2^n，封顶 5s
const TRANSFER_RETRY_BACKOFF_BASE_MS: u64 = 800;

/// 判定传输错误是否不可重试（用户主动取消 / 本地文件系统 / 数据校验类）。
/// 其余错误（连接断开、rekey 崩溃、SFTP 通道错误、远端超时等）一律允许自动
/// 重连重试——断点续传的 TOCTOU 校验 + 尾部采样比对保证重试不会损坏数据。
fn is_non_retryable_transfer_error(e: &str) -> bool {
    let e = e.trim();
    e.contains("canceled by user")
        || e.contains("User canceled")
        // 本地文件系统错误（重试必然同样失败）
        || e.starts_with("Local file")
        || e.starts_with("Local rename")
        || e.starts_with("Local tmp")
        || e.starts_with("Failed to create local")
        || e.starts_with("Failed to open local")
        || e.starts_with("Failed to read local")
        || e.contains("local directory")
        // 续传数据校验失败（数据已不一致，重试同样失败，需全新传输）
        || e.contains("TOCTOU")
        || e.contains("Resume verification failed")
        || e.contains("shrank")
        || e.contains("Insufficient disk space")
        // 路径/参数/安全校验
        || e.contains("Invalid path")
        || e.contains("Invalid temporary")
        || e.contains("Refused to")
        || e.contains("Max recursion depth")
        // 协议违规（服务端行为异常，重试无意义）
        || e.contains("more data than requested")
}

/// 重试退避时长：800ms → 1.6s → 3.2s → 5s（封顶）
fn transfer_retry_backoff(retry_no: u32) -> std::time::Duration {
    let shift = retry_no.min(3);
    let ms = TRANSFER_RETRY_BACKOFF_BASE_MS
        .saturating_mul(1u64 << shift)
        .min(5000);
    std::time::Duration::from_millis(ms)
}

/// 重试前等待（退避），等待前后均响应取消标志。
async fn transfer_retry_wait(cancel: Option<&Arc<AtomicBool>>, retry_no: u32) -> Result<(), String> {
    if let Some(f) = cancel {
        if f.load(Ordering::Relaxed) {
            return Err("Transfer canceled by user".to_string());
        }
    }
    tokio::time::sleep(transfer_retry_backoff(retry_no)).await;
    if let Some(f) = cancel {
        if f.load(Ordering::Relaxed) {
            return Err("Transfer canceled by user".to_string());
        }
    }
    Ok(())
}

/// 重连进度预算：跟踪断点偏移，只有连续多次「零推进」才放弃重试。
struct TransferRetryBudget {
    zero_progress: u32,
    last_offset: u64,
}

impl TransferRetryBudget {
    /// `initial_offset`：首次尝试的起始偏移（续传场景非 0）
    fn new(initial_offset: u64) -> Self {
        Self { zero_progress: 0, last_offset: initial_offset }
    }

    /// 断连后记录当前数据偏移（tmp 文件实际大小）。
    /// 返回 false 表示连续零推进超限，应放弃重试。
    fn register_offset(&mut self, current: u64) -> bool {
        if current > self.last_offset {
            self.zero_progress = 0;
            self.last_offset = current;
            true
        } else {
            self.zero_progress += 1;
            self.zero_progress < TRANSFER_RETRY_ZERO_PROGRESS_MAX
        }
    }
}

/// 确保传输用连接可用：连接仍健康则直接复用；已断开则清理池内死连接（触发
/// 状态广播与心跳停止）并按 DB 配置自动重连（支持 sftp:/ws: 前缀连接 ID）。
async fn ensure_transfer_connection(server_id: &str, err_msg: &str) -> Result<(), String> {
    let manager = crate::ssh::manager::SshManager::global();
    if let Ok(conn) = manager.get_connection(server_id) {
        if conn.is_connected() {
            return Ok(());
        }
        crate::ssh::manager::SshManager::handle_connection_loss(server_id, &conn, err_msg).await;
    }
    let server = crate::commands::ssh::load_server_config(server_id).await?;
    crate::commands::ssh::connect_server_entry(&server, server_id).await
}

/// SFTP 下载 + 断连自动重连重试驱动（各下载入口共用）。
///
/// - `shared_sftp`：目录流的共享会话（首轮复用；断连后随旧连接失效，重试
///   一律由 `sftp_download_file_stream` 新建独立会话）
/// - `initial_resume`：续传场景的起始偏移（全新传输传 None）
/// - 断连（含服务端 1GiB rekey 崩溃）时自动重连并从本地 tmp 实际大小续传
///   （引擎 FIFO 顺序落盘保证 tmp 大小 == 已确认写入字节数）
/// - 重试期间始终保留 tmp；`keep_tmp_on_final_failure` 决定最终失败/取消时
///   是否保留（单文件流传 true 供前端展示续传入口；目录/归档流传 false）
async fn download_file_with_auto_retry(
    server_id: &str,
    remote_path: &str,
    local_path: &str,
    tmp_local_path: &str,
    shared_sftp: Option<&russh_sftp::client::SftpSession>,
    on_progress: impl Fn(u64, u64),
    cancel: Option<&Arc<AtomicBool>>,
    initial_resume: Option<u64>,
    keep_tmp_on_final_failure: bool,
) -> Result<(), String> {
    let mut budget = TransferRetryBudget::new(initial_resume.unwrap_or(0));
    let mut retry_no: u32 = 0;
    let mut resume_offset = initial_resume;
    let mut use_shared = shared_sftp.is_some();
    loop {
        let attempt = if let (Some(sftp), true) = (shared_sftp, use_shared) {
            crate::ssh::manager::sftp_download_file_with_session(
                sftp,
                remote_path,
                local_path,
                &on_progress,
                cancel,
                tmp_local_path,
                resume_offset,
                true,
            )
            .await
        } else {
            crate::ssh::manager::sftp_download_file_stream(
                server_id,
                remote_path,
                local_path,
                &on_progress,
                cancel,
                tmp_local_path,
                resume_offset,
                true,
            )
            .await
        };
        use_shared = false;
        match attempt {
            Ok(()) => return Ok(()),
            Err(e) => {
                if is_non_retryable_transfer_error(&e) {
                    if !keep_tmp_on_final_failure {
                        let _ = tokio::fs::remove_file(tmp_local_path).await;
                    }
                    return Err(e);
                }
                let tmp_size = tokio::fs::metadata(tmp_local_path)
                    .await
                    .map(|m| m.len())
                    .unwrap_or(0);
                if !budget.register_offset(tmp_size) {
                    if !keep_tmp_on_final_failure {
                        let _ = tokio::fs::remove_file(tmp_local_path).await;
                    }
                    return Err(e);
                }
                resume_offset = if tmp_size > 0 { Some(tmp_size) } else { None };
                eprintln!(
                    "[Transfer] download interrupted at {} bytes ({}), auto-reconnect & resume",
                    tmp_size, e
                );
                if let Err(re) = ensure_transfer_connection(server_id, &e).await {
                    if !keep_tmp_on_final_failure {
                        let _ = tokio::fs::remove_file(tmp_local_path).await;
                    }
                    return Err(format!("{} (auto-reconnect failed: {})", e, re));
                }
                if let Err(ce) = transfer_retry_wait(cancel, retry_no).await {
                    if !keep_tmp_on_final_failure {
                        let _ = tokio::fs::remove_file(tmp_local_path).await;
                    }
                    return Err(ce);
                }
                retry_no += 1;
            }
        }
    }
}

/// SFTP 上传 + 断连自动重连重试驱动（各上传入口共用）。
///
/// - `shared_sftp`：perform_upload / files_resume_upload 的共享会话（首轮复用；
///   断连后随旧连接失效，重试一律新建专用会话）
/// - `initial_resume`：续传场景的起始偏移（全新传输传 None）
/// - 断连（含服务端 1GiB rekey 崩溃）时自动重连，新建专用会话并从远端 tmp
///   实际大小续传（查不到 = tmp 不存在 → 全新传输）
/// - 重试期间始终保留远端 tmp；`keep_tmp_on_final_failure` 决定最终失败/取消
///   时是否保留（单文件流传 true；目录流传 false，尽力清理）
async fn upload_file_with_auto_retry(
    server_id: &str,
    local_path: &str,
    remote_path: &str,
    tmp_remote_path: &str,
    shared_sftp: Option<&russh_sftp::client::SftpSession>,
    on_progress: impl Fn(u64, u64),
    cancel: Option<&Arc<AtomicBool>>,
    initial_resume: Option<u64>,
    keep_tmp_on_final_failure: bool,
) -> Result<(), String> {
    let sftp_tmp_posix = tmp_remote_path.replace('\\', "/");
    let mut budget = TransferRetryBudget::new(initial_resume.unwrap_or(0));
    let mut retry_no: u32 = 0;
    let mut resume_offset = initial_resume;
    let mut use_shared = shared_sftp.is_some();
    // 最近一次的专用会话：最终失败清理远端 tmp 时优先复用（可能仍存活）
    let mut last_session: Option<russh_sftp::client::SftpSession> = None;
    let cleanup_remote_tmp = async |session: Option<&russh_sftp::client::SftpSession>| {
        if let Some(s) = session {
            let _ = s.remove_file(&sftp_tmp_posix).await;
        }
    };
    loop {
        let attempt = if let (Some(sftp), true) = (shared_sftp, use_shared) {
            crate::ssh::manager::sftp_upload_file_with_session(
                sftp,
                local_path,
                remote_path,
                &on_progress,
                cancel,
                tmp_remote_path,
                resume_offset,
                true,
            )
            .await
        } else {
            let conn = match crate::ssh::manager::SshManager::global().get_connection(server_id) {
                Ok(c) => c,
                Err(e) => {
                    if !keep_tmp_on_final_failure {
                        cleanup_remote_tmp(last_session.as_ref().or(shared_sftp)).await;
                    }
                    return Err(e.to_string());
                }
            };
            let session = match conn.create_dedicated_sftp_session().await {
                Ok(s) => s,
                Err(e) => {
                    if !keep_tmp_on_final_failure {
                        cleanup_remote_tmp(last_session.as_ref().or(shared_sftp)).await;
                    }
                    return Err(format!("SFTP session failed: {}", e));
                }
            };
            let tmp_size = session
                .metadata(&sftp_tmp_posix)
                .await
                .ok()
                .map(|m| m.len())
                .unwrap_or(0);
            // 零推进预算在重试轮开始时判定（远端 tmp 大小此刻才可查）
            if !budget.register_offset(tmp_size) {
                if !keep_tmp_on_final_failure {
                    cleanup_remote_tmp(Some(&session)).await;
                }
                return Err("SFTP upload failed after repeated retries".to_string());
            }
            resume_offset = if tmp_size > 0 { Some(tmp_size) } else { None };
            eprintln!(
                "[Transfer] upload retry from {} bytes (server tmp)",
                tmp_size
            );
            let res = crate::ssh::manager::sftp_upload_file_with_session(
                &session,
                local_path,
                remote_path,
                &on_progress,
                cancel,
                tmp_remote_path,
                resume_offset,
                true,
            )
            .await;
            last_session = Some(session);
            res
        };
        use_shared = false;
        match attempt {
            Ok(()) => return Ok(()),
            Err(e) => {
                if is_non_retryable_transfer_error(&e) {
                    if !keep_tmp_on_final_failure {
                        cleanup_remote_tmp(last_session.as_ref().or(shared_sftp)).await;
                    }
                    return Err(e);
                }
                if let Err(re) = ensure_transfer_connection(server_id, &e).await {
                    if !keep_tmp_on_final_failure {
                        cleanup_remote_tmp(last_session.as_ref().or(shared_sftp)).await;
                    }
                    return Err(format!("{} (auto-reconnect failed: {})", e, re));
                }
                if let Err(ce) = transfer_retry_wait(cancel, retry_no).await {
                    if !keep_tmp_on_final_failure {
                        cleanup_remote_tmp(last_session.as_ref().or(shared_sftp)).await;
                    }
                    return Err(ce);
                }
                retry_no += 1;
            }
        }
    }
}

/// 下载单个文件
/// Windows: 使用新 transfer 模块（512KB 分块，PathResolver 路径统一，.downloading 临时文件）
/// Linux: 使用 SFTP 子系统流式传输（32KB 分块，.sw-dl-tmp-{uuid} 临时文件）
/// `cancel`: 可选的取消标志，传输过程中检查
async fn download_single_file(
    server_id: &str,
    remote_path: &str,
    local_path: &str,
    tmp_local_path: &str,
    send: &impl Fn(u64, u64, &str, &str, Option<bool>),
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<(), String> {
    // 确保本地目录存在
    let local_dir = StdPath::new(local_path)
        .parent()
        .ok_or_else(|| "Invalid local path".to_string())?;
    // tokio 异步版本：同步 std::fs 在 Tauri 异步命令线程上会阻塞运行时
    tokio::fs::create_dir_all(local_dir)
        .await
        .map_err(|e| format!("Failed to create local directory: {}", e))?;

    let file_name = remote_path.rsplit(['/', '\\']).next().unwrap_or("file");
    // 统一使用 manager.rs 成熟的 SFTP 流式传输（具备超时、取消、TOCTOU 续传校验和 Windows 路径兼容）
    // keep_tmp_on_failure=true：失败/暂停保留临时文件供断点续传
    // （download_single_file 传入的 tmp_local_path 会通过初始进度事件发给
    // 前端，前端据此展示续传入口）；取消时由前端显式清理。
    // 断连（含服务端 1GiB rekey 崩溃）时自动重连并从本地 tmp 实际大小续传
    let sftp_result = download_file_with_auto_retry(
        server_id,
        remote_path,
        local_path,
        tmp_local_path,
        None,
        |transferred, total| {
            send(transferred, total, file_name, "bytes", None);
        },
        cancel,
        None,
        true,
    )
    .await;

    sftp_result?;
    Ok(())
}

/// 递归下载远程目录
/// `cancel`: 可选的取消标志，每个文件传输前检查；用户点取消时立即返回错误
async fn download_dir_recursive(
    app: &AppHandle,
    server_id: &str,
    remote_path: &str,
    target_local_dir: &str,
    send: &impl Fn(u64, u64, &str, &str, Option<bool>),
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<(), String> {
    // 先递归获取完整清单；manifest 事件只用于前端明细，不改变传输过程。
    let manifest_result = crate::files::remote::files_transfer_manifest(
        server_id.to_string(),
        remote_path.to_string(),
    )
    .await;
    let (manifest, total_files) = match manifest_result {
        Ok(items) => {
            let total = items.len() as u64;
            (items, total)
        }
        Err(_) => {
            // 清单失败时保留旧的计数回退，不能让实际传输退化成无进度。
            let total = crate::files::remote::files_count_recursive(server_id.to_string(), remote_path.to_string()).await.unwrap_or(0);
            (Vec::new(), total)
        }
    };
    for item in &manifest {
        send(0, item.size, &item.path, "manifest", None);
    }
    let completed = Arc::new(AtomicU64::new(0));

    let local_dir = StdPath::new(target_local_dir);
    tokio::fs::create_dir_all(&local_dir)
        .await
        .map_err(|e| format!("Failed to create local directory: {}", e))?;

    // 创建一次独立的 SFTP 会话，复用给整个目录下载（隔离目录浏览缓存，避免会话竞争与冲突）
    let conn = crate::ssh::manager::SshManager::global()
        .get_connection(server_id)
        .map_err(|e| e.to_string())?;
    let sftp = conn
        .create_dedicated_sftp_session()
        .await
        .map_err(|e| format!("SFTP session failed: {}", e))?;

    // 获取远程目录列表（使用 SFTP，跨平台）
    let entries = crate::files::remote::files_list(server_id.to_string(), remote_path.to_string()).await?;

    for entry in &entries {
        // 每个文件开始前检查取消标志
        if let Some(flag) = cancel {
            if flag.load(Ordering::Relaxed) {
                return Err("Transfer canceled by user".to_string());
            }
        }
        // 跳过忽略项（.、.. 永远跳过，以及按用户配置过滤）
        if entry.name == "." || entry.name == ".." || crate::validators::is_ignored(&entry.name) {
            continue;
        }
        // symlink 检测：用 SFTP stat 检测是否为 symlink，是则跳过（跨平台）
        // 防止 symlink 指向 / 或敏感目录导致递归下载意料外内容
        // 注意：test -L 是 bash 内建，在 Windows PowerShell/cmd 默认 shell 下不可用
        let is_symlink = match crate::ssh::manager::sftp_stat(server_id, &entry.path).await {
            Ok(meta) => meta.is_symlink(),
            Err(_) => false, // stat 失败时不跳过，尝试正常下载
        };
        if is_symlink {
            continue;
        }
        if entry.is_directory {
            // 递归下载子目录
            Box::pin(download_dir_recursive_inner(
                app,
                server_id,
                &entry.path,
                local_dir.to_str().unwrap_or(""),
                send,
                &completed,
                total_files,
                &sftp,
                cancel,
                2, // 外层 download_dir_recursive 已是第 1 层，子目录从第 2 层开始
            ))
            .await?;
        } else {
            // 目录下载：不发送字节级进度，只发送文件计数进度
            let local_file = local_dir.join(&entry.name);
            let local_file_str = local_file.to_str().unwrap_or("");
            // 确保本地目录存在（用 tokio::fs 避免阻塞异步运行时）
            if let Some(parent) = local_file.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            // 断连（含 1GiB rekey 崩溃）自动重连并续传；目录流最终失败时清理 tmp
            let dl_tmp_path = format!("{}.sw-dl-tmp-{}", local_file_str, uuid::Uuid::new_v4());
            download_file_with_auto_retry(
                server_id,
                &entry.path,
                local_file_str,
                &dl_tmp_path,
                Some(&sftp),
                |_, _| {}, // no-op：目录下载时不报告单文件字节进度
                cancel,
                None,
                false,
            )
            .await?;

            // 更新文件计数进度（total_type="count"）
            let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
            if total_files > 0 {
                send(done, total_files, &entry.path, "count", None);
            }
        }
    }

    Ok(())
}

/// 递归下载内部函数（带进度计数器）
/// `depth`: 当前递归深度，从 1 开始；超过 MAX_RECURSION_DEPTH 时拒绝继续（防 symlink 循环栈溢出）
async fn download_dir_recursive_inner(
    app: &AppHandle,
    server_id: &str,
    remote_path: &str,
    local_base: &str,
    send: &impl Fn(u64, u64, &str, &str, Option<bool>),
    completed: &Arc<AtomicU64>,
    total_files: u64,
    sftp: &russh_sftp::client::SftpSession,
    cancel: Option<&Arc<AtomicBool>>,
    depth: u32,
) -> Result<(), String> {
    if depth > MAX_RECURSION_DEPTH {
        return Err(format!(
            "Max recursion depth ({}) exceeded at '{}': possible symlink loop",
            MAX_RECURSION_DEPTH, remote_path
        ));
    }

    let dir_name = remote_path.rsplit(['/', '\\']).next().unwrap_or("root");
    let local_dir = StdPath::new(local_base).join(dir_name);
    tokio::fs::create_dir_all(&local_dir)
        .await
        .map_err(|e| format!("Failed to create local directory: {}", e))?;

    let entries = crate::files::remote::files_list(server_id.to_string(), remote_path.to_string()).await?;

    for entry in &entries {
        // 每个文件开始前检查取消标志
        if let Some(flag) = cancel {
            if flag.load(Ordering::Relaxed) {
                return Err("Transfer canceled by user".to_string());
            }
        }
        if entry.is_directory {
            Box::pin(download_dir_recursive_inner(
                app,
                server_id,
                &entry.path,
                local_dir.to_str().unwrap_or(""),
                send,
                completed,
                total_files,
                sftp,
                cancel,
                depth + 1,
            ))
            .await?;
        } else {
            // 目录下载：不发送字节级进度，只发送文件计数进度
            let local_file = local_dir.join(&entry.name);
            let local_file_str = local_file.to_str().unwrap_or("");
            if let Some(parent) = local_file.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            // 断连（含 1GiB rekey 崩溃）自动重连并续传；目录流最终失败时清理 tmp
            let dl_tmp_path = format!("{}.sw-dl-tmp-{}", local_file_str, uuid::Uuid::new_v4());
            download_file_with_auto_retry(
                server_id,
                &entry.path,
                local_file_str,
                &dl_tmp_path,
                Some(sftp),
                |_, _| {}, // no-op
                cancel,
                None,
                false,
            )
            .await?;

            let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
            if total_files > 0 {
                send(done, total_files, &entry.path, "count", None);
            }
        }
    }

    Ok(())
}

/// 下载远程目录为压缩包
///
/// 在远程服务器上打包，然后 base64 传输到本地
#[tauri::command]
pub async fn files_download_archive(
    app: AppHandle,
    server_id: String,
    remote_path: String,
    format: Option<String>,
) -> Result<FileDownloadResult, String> {
    use tauri_plugin_dialog::DialogExt;

    let target_type = load_target_type(&server_id).await;
    if target_type.eq_ignore_ascii_case("windows") {
        return Ok(FileDownloadResult {
            success: false,
            error: Some("Archived download is not supported on Windows servers".to_string()),
            local_path: None,
        });
    }

    // 校验路径（按目标类型分发；Windows 已在上方提前返回错误）
    let path_validation = crate::validators::validate_path_for_target(remote_path.clone(), false, &target_type);
    if !path_validation.valid {
        return Ok(FileDownloadResult {
            success: false,
            error: Some(format!(
                "Invalid path: {}",
                path_validation.error.unwrap_or_default()
            )),
            local_path: None,
        });
    }

    // 安全检查：拒绝打包系统根路径（/、/etc、/usr 等），防止打包整个文件系统
    if crate::files::remote::is_dangerous_root_path(&remote_path) {
        return Ok(FileDownloadResult {
            success: false,
            error: Some(
                "Refused to archive a system root path for safety. \
                 Use a more specific path.".to_string()
            ),
            local_path: None,
        });
    }

    // 校验格式
    let fmt = format.unwrap_or_else(|| "tar.gz".to_string());
    let valid_formats = ["tar.gz", "tar.bz2", "tar.xz", "zip", "tar"];
    if !valid_formats.contains(&fmt.as_str()) {
        return Ok(FileDownloadResult {
            success: false,
            error: Some("Invalid archive format".to_string()),
            local_path: None,
        });
    }

    let dir_name = remote_path
        .rsplit(['/', '\\']).find(|s| !s.is_empty())
        .unwrap_or("archive")
        .to_string();
    let ext_map = [
        ("tar.gz", ".tar.gz"),
        ("tar.bz2", ".tar.bz2"),
        ("tar.xz", ".tar.xz"),
        ("zip", ".zip"),
        ("tar", ".tar"),
    ];
    let ext = ext_map
        .iter()
        .find(|(k, _)| *k == fmt)
        .map(|(_, v)| *v)
        .unwrap_or(".tar.gz");
    let archive_name = format!("{}{}", dir_name, ext);
    // 使用 UUID 命名避免并发归档冲突（毫秒时间戳在同一毫秒内会碰撞）
    let tmp_archive = format!("/tmp/sw-archive-{}{}", uuid::Uuid::new_v4(), ext);
    let transfer_id = format!("dl-archive-{}", uuid::Uuid::new_v4());

    let send = |current: u64, total: u64, name: &str, phase: &str, done: Option<bool>| {
        send_progress(
            &app,
            TransferProgress {
                transfer_id: transfer_id.clone(),
                r#type: "download".to_string(),
                current,
                total,
                file_name: name.to_string(),
                done,
                phase: Some(phase.to_string()),
                // 压缩包下载阶段 total 为字节数；packing 阶段 total=0，total_type 无意义
                total_type: Some("bytes".to_string()),
                tmp_path: None,
                error: None,
            },
        );
    };

    // 转义路径（复用统一 escape_shell_arg，自带外层单引号）
    let escaped_remote_path = crate::validators::escape_shell_arg(remote_path.clone());
    let escaped_tmp = crate::validators::escape_shell_arg(tmp_archive.clone());
    let escaped_dir = crate::validators::escape_shell_arg(dir_name.clone());

    // 打包命令（escape_shell_arg 已带外层单引号，无需再加）
    let pack_cmd = match fmt.as_str() {
        "tar.gz" => format!(
            "cd {}/.. && tar czf {} {} 2>&1",
            escaped_remote_path, escaped_tmp, escaped_dir
        ),
        "tar.bz2" => format!(
            "cd {}/.. && tar cjf {} {} 2>&1",
            escaped_remote_path, escaped_tmp, escaped_dir
        ),
        "tar.xz" => format!(
            "cd {}/.. && tar cJf {} {} 2>&1",
            escaped_remote_path, escaped_tmp, escaped_dir
        ),
        "zip" => format!("cd {} && zip -r {} . 2>&1", escaped_remote_path, escaped_tmp),
        "tar" => format!(
            "cd {}/.. && tar cf {} {} 2>&1",
            escaped_remote_path, escaped_tmp, escaped_dir
        ),
        _ => {
            return Ok(FileDownloadResult {
                success: false,
                error: Some(format!("Invalid archive format: {}", fmt)),
                local_path: None,
            });
        }
    };

    send(0, 0, &dir_name, "packing", None);

    // 执行打包
    let pack_res = ssh_execute_command(&server_id, &pack_cmd).await;

    // 检查权限拒绝：按行匹配 stderr 行首模式，避免文件名含 "Permission denied" 子串时误计数
    let output = format!("{}{}", pack_res.stderr, pack_res.stdout);
    let perm_denied_count = output
        .lines()
        .filter(|line| {
            let l = line.trim_start();
            // tar/cpio 等工具的权限拒绝错误通常以 "tar: " 或路径开头，后跟 ": Permission denied" / ": Cannot open"
            l.contains(": Permission denied") || l.contains(": Cannot open: ")
        })
        .count();
    if perm_denied_count > 0 {
        let _ = ssh_execute_command(&server_id, &format!("rm -f {}", escaped_tmp)).await;
        return Ok(FileDownloadResult {
            success: false,
            error: Some(format!(
                "{} file(s) have no access permission. Packaging canceled. Please use sudo or choose a directory with permissions.",
                perm_denied_count
            )),
            local_path: None,
        });
    }

    // 检查打包是否成功
    let check_cmd = format!("test -f {} && echo \"exists\" || echo \"missing\"", escaped_tmp);
    let check_res = ssh_execute_command(&server_id, &check_cmd).await;
    if check_res.stdout.trim() != "exists" {
        return Ok(FileDownloadResult {
            success: false,
            error: Some(format!("Packaging failed: {}", pack_res.stderr)),
            local_path: None,
        });
    }

    // 检查压缩包大小（限制 10GB）；解析失败时返回错误而非降级为 0，避免跳过限制
    let size_cmd = format!("stat -c '%s' {} 2>/dev/null", escaped_tmp);
    let size_res = ssh_execute_command(&server_id, &size_cmd).await;
    let archive_size: u64 = match size_res.stdout.trim().parse() {
        Ok(value) => value,
        Err(e) => {
            // 清理临时文件后返回错误
            let _ = ssh_execute_command(&server_id, &format!("rm -f {}", escaped_tmp)).await;
            return Err(format!(
                "Failed to parse archive size: {} (output: {:?})",
                e, size_res.stdout
            ));
        }
    };
    const MAX_ARCHIVE_SIZE: u64 = 10 * 1024 * 1024 * 1024;
    if archive_size > MAX_ARCHIVE_SIZE {
        let _ = ssh_execute_command(&server_id, &format!("rm -f {}", escaped_tmp)).await;
        return Ok(FileDownloadResult {
            success: false,
            error: Some(format!(
                "Compressed archive too large ({}MB), exceeding 10GB limit",
                archive_size / 1024 / 1024
            )),
            local_path: None,
        });
    }

    send(1, 1, &dir_name, "packed", None);

    // 弹出保存对话框
    let file_path = app
        .dialog()
        .file()
        .set_title("Save Archive")
        .set_file_name(&archive_name)
        .blocking_save_file();
    let local_path = match file_path {
        Some(p) => p.to_string(),
        None => {
            let _ = ssh_execute_command(&server_id, &format!("rm -f {}", escaped_tmp)).await;
            return Ok(FileDownloadResult {
                success: false,
                error: Some("User canceled".to_string()),
                local_path: None,
            });
        }
    };

    // 磁盘空间预检：与 files_download 对齐，5% 安全余量；查询失败时跳过检查
    if let Ok(free) = get_local_available_space(&local_path) {
        const SAFETY_MARGIN: f64 = 1.05;
        let required = (archive_size as f64 * SAFETY_MARGIN) as u64;
        if free < required {
            let _ = ssh_execute_command(&server_id, &format!("rm -f {}", escaped_tmp)).await;
            return Ok(FileDownloadResult {
                success: false,
                error: Some(format!(
                    "Insufficient local disk space: required {} bytes (with 5% safety margin), available {} bytes",
                    required, free
                )),
                local_path: None,
            });
        }
    }

    // 下载压缩包（使用 SFTP 子系统流式传输，32KB 分块，内存友好）
    send(0, 0, &archive_name, "downloading", None);
    // 注册传输任务，获取 cancel flag（用户可调用 files_cancel_transfer 取消下载阶段）
    let cancel_flag = register_transfer(&transfer_id);
    let _transfer_guard = TransferRegistrationGuard::new(&transfer_id);
    // 归档下载最终失败/取消时清理本地 tmp（不支持对外断点续传，但内部断连可自愈）
    let dl_tmp_local = format!("{}.sw-dl-tmp-{}", local_path, uuid::Uuid::new_v4());
    let write_result = download_file_with_auto_retry(
        &server_id,
        &tmp_archive,
        &local_path,
        &dl_tmp_local,
        None,
        |transferred, total| {
            send(transferred, total, &archive_name, "downloading", None);
        },
        Some(&cancel_flag),
        None,
        false,
    )
    .await;
    // 注销传输任务（无论成功/失败/取消）
    unregister_transfer(&transfer_id);

    // 清理远程临时文件
    let _ = ssh_execute_command(&server_id, &format!("rm -f {}", escaped_tmp)).await;

    match write_result {
        Ok(()) => {
            // current/total 设为 0 表示不更新进度值，只标记完成
            send(0, 0, &archive_name, "downloading", Some(true));
            Ok(FileDownloadResult {
                success: true,
                error: None,
                local_path: Some(local_path),
            })
        }
        Err(e) => Ok(FileDownloadResult {
            success: false,
            error: Some(e),
            local_path: None,
        }),
    }
}

/// 上传文件（弹出文件选择对话框）
#[tauri::command]
pub async fn files_upload(
    app: AppHandle,
    server_id: String,
    remote_dir: String,
    upload_type: String,
) -> Result<FileUploadResult, String> {
    use tauri_plugin_dialog::DialogExt;

    let target_type = load_target_type(&server_id).await;
    // 校验路径（按目标类型分发）
    let path_validation = crate::validators::validate_path_for_target(remote_dir.clone(), false, &target_type);
    if !path_validation.valid {
        return Ok(FileUploadResult {
            success: false,
            error: Some(format!(
                "Invalid path: {}",
                path_validation.error.unwrap_or_default()
            )),
            results: Vec::new(),
        });
    }

    // 根据类型弹出文件选择对话框
    let file_paths: Vec<String> = match upload_type.as_str() {
        "file" => {
            let files = app
                .dialog()
                .file()
                .set_title("Select Upload Files")
                .blocking_pick_files();
            match files {
                Some(paths) => paths.into_iter().map(|p| p.to_string()).collect(),
                None => Vec::new(),
            }
        }
        "dir" | "directory" => {
            let folders = app
                .dialog()
                .file()
                .set_title("Select Upload Folder")
                .blocking_pick_folders();
            match folders {
                Some(paths) => paths.into_iter().map(|p| p.to_string()).collect(),
                None => Vec::new(),
            }
        }
        _ => {
            // auto: 先文件后文件夹
            let files = app
                .dialog()
                .file()
                .set_title("Select Upload Files (Press ESC to cancel and select folder)")
                .blocking_pick_files();
            match files {
                Some(paths) if !paths.is_empty() => {
                    paths.into_iter().map(|p| p.to_string()).collect()
                }
                _ => {
                    let folders = app
                        .dialog()
                        .file()
                        .set_title("Select Upload Folder")
                        .blocking_pick_folders();
                    match folders {
                        Some(paths) => paths.into_iter().map(|p| p.to_string()).collect(),
                        None => Vec::new(),
                    }
                }
            }
        }
    };

    if file_paths.is_empty() {
        return Ok(FileUploadResult {
            success: false,
            error: Some("User canceled".to_string()),
            results: Vec::new(),
        });
    }

    // target_type 已在函数开头加载（用于路径校验），此处复用
    let is_windows = target_type.eq_ignore_ascii_case("windows");

    // 执行上传
    let transfer_id = format!("ul-{}", uuid::Uuid::new_v4());
    let app_clone = app.clone();
    let transfer_id_clone = transfer_id.clone();
    let send: Arc<dyn Fn(u64, u64, &str, &str) + Send + Sync + 'static> = Arc::new(move |current: u64, total: u64, name: &str, total_type: &str| {
        send_progress(
            &app_clone,
            TransferProgress {
                transfer_id: transfer_id_clone.clone(),
                r#type: "upload".to_string(),
                current,
                total,
                file_name: name.to_string(),
                done: None,
                phase: None,
                total_type: Some(total_type.to_string()),
                tmp_path: None,
                error: None,
            },
        );
    });

    // 注册传输任务，获取 cancel flag（用户可调用 files_cancel_transfer 取消）
    let cancel_flag = register_transfer(&transfer_id);
    let _transfer_guard = TransferRegistrationGuard::new(&transfer_id);
    let cancel_ref: Option<&Arc<AtomicBool>> = Some(&cancel_flag);

    // 单文件上传：预生成 tmp_path 并发送携带 tmp_path 的初始事件（前端用于断点续传）
    // 多文件/目录上传：不支持断点续传，传 None
    let is_single = file_paths.len() == 1
        && std::fs::metadata(&file_paths[0]).map(|m| !m.is_dir()).unwrap_or(false);

    let target_remote_dir = if is_windows {
        crate::targets::windows::validators::posix_to_windows_path(&remote_dir)
    } else {
        remote_dir.clone()
    };

    let tmp_path_override: Option<String> = if is_single {
        let base_name = StdPath::new(&file_paths[0])
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
            .to_string();
        let remote_path = if is_windows {
            if target_remote_dir.ends_with('\\') {
                format!("{}{}", target_remote_dir, base_name)
            } else {
                format!("{}\\{}", target_remote_dir, base_name)
            }
        } else {
            if remote_dir == "/" {
                format!("/{}", base_name)
            } else {
                format!("{}/{}", remote_dir, base_name)
            }
        };
        let tmp = if is_windows {
            // Windows: 使用新 transfer 模块的 .uploading 命名（正斜杠）
            let sftp_path = crate::targets::windows::path_resolver::PathResolver::to_sftp(&remote_path);
            crate::targets::windows::path_resolver::PathResolver::uploading_tmp(&sftp_path)
        } else {
            format!("{}.sw-upload-tmp-{}", remote_path, uuid::Uuid::new_v4())
        };
        send_progress(
            &app,
            TransferProgress {
                transfer_id: transfer_id.clone(),
                r#type: "upload".to_string(),
                current: 0,
                total: 0,
                file_name: base_name,
                done: None,
                phase: None,
                total_type: Some("bytes".to_string()),
                tmp_path: Some(tmp.clone()),
                error: None,
            },
        );
        Some(tmp)
    } else {
        None
    };

    let results = perform_upload(&server_id, &file_paths, &target_remote_dir, None, send.clone(), cancel_ref, tmp_path_override.as_deref()).await;

    // 无论成功/失败/取消都注销，避免内存泄漏和过期取消
    unregister_transfer(&transfer_id);

    // success: 至少一个文件成功即为 true（前端会刷新列表并检查个别失败）
    let any_success = results.iter().any(|r| r.success);
    let first_failure = results.iter().find(|r| !r.success).and_then(|r| r.error.clone());
    let error = if !any_success {
        Some(first_failure.unwrap_or_else(|| "All files failed to upload".to_string()))
    } else if results.iter().any(|r| !r.success) {
        Some(first_failure.map(|e| format!("Some files failed to upload: {}", e))
            .unwrap_or_else(|| "Some files failed to upload".to_string()))
    } else {
        None
    };

    // 发送结束事件：done 携带真实成败；失败时带上原因，前端据此将传输记录置为失败
    // （避免无权限等失败时记录仍显示「完成」）
    send_progress(
        &app,
        TransferProgress {
            transfer_id,
            r#type: "upload".to_string(),
            current: 0,
            total: 0,
            file_name: String::new(),
            done: Some(any_success),
            phase: None,
            total_type: None,
            tmp_path: None,
            error: if any_success { None } else { error.clone() },
        },
    );

    Ok(FileUploadResult {
        success: any_success,
        error,
        results,
    })
}

/// 从指定本地路径上传（用于自定义文件选择器）
#[tauri::command]
pub async fn files_upload_from_paths(
    app: AppHandle,
    server_id: String,
    remote_dir: String,
    local_paths: Vec<String>,
    target_file_name: Option<String>,
) -> Result<FileUploadResult, String> {
    let target_type = load_target_type(&server_id).await;
    let is_windows = target_type.eq_ignore_ascii_case("windows");

    // 校验路径（按目标类型分发，Windows 允许盘符路径）
    let path_validation = crate::validators::validate_path_for_target(remote_dir.clone(), false, &target_type);
    if !path_validation.valid {
        return Ok(FileUploadResult {
            success: false,
            error: Some(format!(
                "Invalid path: {}",
                path_validation.error.unwrap_or_default()
            )),
            results: Vec::new(),
        });
    }

    // target_file_name 仅在单文件上传时生效（duplicate 冲突处理：上传到副本名）
    // 多文件场景忽略此参数，沿用本地 basename
    let override_name: Option<String> = if local_paths.len() == 1 {
        target_file_name.filter(|s| !s.trim().is_empty())
    } else {
        None
    };
    // 校验 override_name：拒绝路径分隔符和危险字符（defense-in-depth）
    // Windows 额外拒绝 \ : * ? " < > | 等非法文件名字符
    if let Some(ref name) = override_name {
        let name_validation = if is_windows {
            crate::validators::validate_path_for_target(
                format!("C:\\{}", name),
                false,
                &target_type,
            )
        } else {
            crate::validators::validate_path(format!("/{}", name), false)
        };
        if !name_validation.valid {
            return Ok(FileUploadResult {
                success: false,
                error: Some(format!(
                    "Invalid target file name: {}",
                    name_validation.error.unwrap_or_default()
                )),
                results: Vec::new(),
            });
        }
        // Windows 额外检查非法字符（validate_path_for_target 不覆盖文件名专属字符）
        if is_windows {
            const WIN_ILLEGAL: &[char] = &[':', '*', '?', '"', '<', '>', '|'];
            if name.chars().any(|c| WIN_ILLEGAL.contains(&c)) {
                return Ok(FileUploadResult {
                    success: false,
                    error: Some("Invalid target file name: contains Windows illegal character".to_string()),
                    results: Vec::new(),
                });
            }
        }
    }

    let transfer_id = format!("ul-{}", uuid::Uuid::new_v4());
    let app_clone = app.clone();
    let transfer_id_clone = transfer_id.clone();
    let send: Arc<dyn Fn(u64, u64, &str, &str) + Send + Sync + 'static> = Arc::new(move |current: u64, total: u64, name: &str, total_type: &str| {
        send_progress(
            &app_clone,
            TransferProgress {
                transfer_id: transfer_id_clone.clone(),
                r#type: "upload".to_string(),
                current,
                total,
                file_name: name.to_string(),
                done: None,
                phase: None,
                total_type: Some(total_type.to_string()),
                tmp_path: None,
                error: None,
            },
        );
    });

    // 注册传输任务，获取 cancel flag（用户可调用 files_cancel_transfer 取消）
    let cancel_flag = register_transfer(&transfer_id);
    let _transfer_guard = TransferRegistrationGuard::new(&transfer_id);
    let cancel_ref: Option<&Arc<AtomicBool>> = Some(&cancel_flag);

    // 单文件上传：预生成 tmp_path 并发送携带 tmp_path 的初始事件（前端用于断点续传）
    // 多文件/目录上传：不支持断点续传，传 None
    let is_single = local_paths.len() == 1
        && std::fs::metadata(&local_paths[0]).map(|m| !m.is_dir()).unwrap_or(false);

    let target_remote_dir = if is_windows {
        crate::targets::windows::validators::posix_to_windows_path(&remote_dir)
    } else {
        remote_dir.clone()
    };

    let tmp_path_override: Option<String> = if is_single {
        let base_name = override_name
            .clone()
            .unwrap_or_else(|| {
                StdPath::new(&local_paths[0])
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("file")
                    .to_string()
            });
        let remote_path = if is_windows {
            let clean_dir = target_remote_dir.trim_end_matches(['/', '\\']);
            if clean_dir.is_empty() {
                format!("C:\\{}", base_name)
            } else {
                format!("{}\\{}", clean_dir, base_name)
            }
        } else {
            let clean_dir = remote_dir.trim_end_matches('/');
            if clean_dir.is_empty() {
                format!("/{}", base_name)
            } else {
                format!("{}/{}", clean_dir, base_name)
            }
        };
        let tmp = format!("{}.sw-upload-tmp-{}", remote_path.replace('\\', "/"), uuid::Uuid::new_v4());
        send_progress(
            &app,
            TransferProgress {
                transfer_id: transfer_id.clone(),
                r#type: "upload".to_string(),
                current: 0,
                total: 0,
                file_name: base_name,
                done: None,
                phase: None,
                total_type: Some("bytes".to_string()),
                tmp_path: Some(tmp.clone()),
                error: None,
            },
        );
        Some(tmp)
    } else {
        None
    };

    // 写权限预检：在目标目录尝试创建一个 0 字节临时文件并立即删除。
    // 无写入权限或目录不存在时立即返回明确错误，避免静默上传到错误位置（如用户目录）。
    {
        let conn = match crate::ssh::manager::SshManager::global().get_connection(&server_id) {
            Ok(c) => c,
            Err(e) => {
                send_progress(&app, TransferProgress {
                    transfer_id: transfer_id.clone(),
                    r#type: "upload".to_string(),
                    current: 0,
                    total: 0,
                    file_name: String::new(),
                    done: Some(false),
                    phase: None,
                    total_type: None,
                    tmp_path: None,
                    error: Some(format!("Connection not found: {}", e)),
                });
                return Ok(FileUploadResult { success: false, error: Some(e.to_string()), results: Vec::new() });
            }
        };
        let probe_sftp = match conn.create_sftp_session().await {
            Ok(s) => s,
            Err(e) => {
                send_progress(&app, TransferProgress {
                    transfer_id: transfer_id.clone(),
                    r#type: "upload".to_string(),
                    current: 0,
                    total: 0,
                    file_name: String::new(),
                    done: Some(false),
                    phase: None,
                    total_type: None,
                    tmp_path: None,
                    error: Some(format!("SFTP session failed: {}", e)),
                });
                return Ok(FileUploadResult { success: false, error: Some(format!("SFTP session failed: {}", e)), results: Vec::new() });
            }
        };
        // 目标目录不存在：metadata 失败
        if probe_sftp.metadata(&target_remote_dir).await.is_err() {
            let msg = format!("Target directory does not exist: '{}'", target_remote_dir);
            send_progress(&app, TransferProgress {
                transfer_id: transfer_id.clone(),
                r#type: "upload".to_string(),
                current: 0,
                total: 0,
                file_name: String::new(),
                done: Some(false),
                phase: None,
                total_type: None,
                tmp_path: None,
                error: Some(msg.clone()),
            });
            return Ok(FileUploadResult { success: false, error: Some(msg), results: Vec::new() });
        }
        // 写权限探测：创建临时文件再删除
        let probe_name = format!(".sw-perm-probe-{}.tmp", uuid::Uuid::new_v4());
        let probe_path = if target_remote_dir == "/" {
            format!("/{}", probe_name)
        } else {
            format!("{}/{}", target_remote_dir, probe_name)
        };
        match probe_sftp.create(&probe_path).await {
            Ok(_h) => { let _ = probe_sftp.remove_file(&probe_path).await; }
            Err(e) => {
                let msg = format!("No write permission to '{}': {}", target_remote_dir, e);
                send_progress(&app, TransferProgress {
                    transfer_id: transfer_id.clone(),
                    r#type: "upload".to_string(),
                    current: 0,
                    total: 0,
                    file_name: String::new(),
                    done: Some(false),
                    phase: None,
                    total_type: None,
                    tmp_path: None,
                    error: Some(msg.clone()),
                });
                return Ok(FileUploadResult { success: false, error: Some(msg), results: Vec::new() });
            }
        }
    }

    let results = perform_upload(&server_id, &local_paths, &target_remote_dir, override_name.as_deref(), send.clone(), cancel_ref, tmp_path_override.as_deref()).await;

    // 无论成功/失败/取消都注销，避免内存泄漏和过期取消
    unregister_transfer(&transfer_id);

    // success: 至少一个文件成功即为 true（前端会刷新列表并检查个别失败）
    let any_success = results.iter().any(|r| r.success);
    let first_failure = results.iter().find(|r| !r.success).and_then(|r| r.error.clone());
    let error = if !any_success {
        Some(first_failure.unwrap_or_else(|| "All files failed to upload".to_string()))
    } else if results.iter().any(|r| !r.success) {
        Some(first_failure.map(|e| format!("Some files failed to upload: {}", e))
            .unwrap_or_else(|| "Some files failed to upload".to_string()))
    } else {
        None
    };

    // 发送结束事件：done 携带真实成败；失败时带上原因，前端据此将传输记录置为失败
    // （避免无权限等失败时记录仍显示「完成」）
    send_progress(
        &app,
        TransferProgress {
            transfer_id,
            r#type: "upload".to_string(),
            current: 0,
            total: 0,
            file_name: String::new(),
            done: Some(any_success),
            phase: None,
            total_type: None,
            tmp_path: None,
            error: error.clone(),
        },
    );

    Ok(FileUploadResult {
        success: any_success,
        error,
        results,
    })
}

/// 执行上传逻辑（遍历本地路径，逐个上传文件或目录）
/// 创建一次 SFTP 会话复用给所有文件上传，避免逐文件创建会话的性能开销
/// `override_name`: 单文件上传时覆盖远程文件名（duplicate 冲突处理用），多文件忽略
/// `cancel`: 可选的取消标志，每个文件传输前检查；用户点取消时立即返回错误
async fn perform_upload(
    server_id: &str,
    local_paths: &[String],
    remote_dir: &str,
    override_name: Option<&str>,
    send: Arc<dyn Fn(u64, u64, &str, &str) + Send + Sync + 'static>,
    cancel: Option<&Arc<AtomicBool>>,
    tmp_path_override: Option<&str>,
) -> Vec<UploadFileResult> {
    // 判断是否为单文件上传（跳过递归统计文件数，减少文件IO/线程调度开销，使临时文件更快捷地生成）
    let is_single_file = local_paths.len() == 1
        && std::fs::metadata(&local_paths[0])
            .map(|m| !m.is_dir())
            .unwrap_or(false);

    // 统计总文件数，用于进度显示
    // 用 spawn_blocking 避免同步递归阻塞 Tauri async 命令线程（深目录如 node_modules 可能阻塞数百毫秒）
    let total_files: u64 = if is_single_file {
        1
    } else {
        let paths_owned: Vec<String> = local_paths.iter().map(|s| s.to_string()).collect();
        tokio::task::spawn_blocking(move || {
            let mut count: u64 = 0;
            for path in &paths_owned {
                count += count_local_files(path);
            }
            count
        })
        .await
        .unwrap_or(0)
    };
    let completed = Arc::new(AtomicU64::new(0));

    // 发送初始进度事件
    // 单文件上传：不发送文件计数初始事件，由 upload_single_file 发送字节级进度
    // 目录上传/多文件：发送文件计数初始事件（total_type="count"）

    if !is_single_file {
        if local_paths.len() == 1 {
            let top_name = StdPath::new(&local_paths[0])
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file");
            send(0, total_files, top_name, "count");
        } else {
            send(0, total_files, &format!("{} file(s)", local_paths.len()), "count");
        }
    }

    // 创建一次 SFTP 会话，复用给整个上传批次（单文件 & 目录递归共享）
    let sftp = match crate::ssh::manager::SshManager::global()
        .get_connection(server_id)
    {
        // 长时间传输使用独立 session，与目录浏览缓存隔离。
        // 即使传输 session 发生句柄错误，也不会拖垮远程目录刷新。
        Ok(conn) => match conn.create_dedicated_sftp_session().await {
            Ok(s) => Arc::new(s),
            Err(e) => {
                // SFTP 会话创建失败：所有文件都标记为失败
                return local_paths
                    .iter()
                    .map(|p| {
                        let name = StdPath::new(p)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("file")
                            .to_string();
                        UploadFileResult {
                            file_name: name,
                            success: false,
                            error: Some(format!("SFTP session failed: {}", e)),
                        }
                    })
                    .collect();
            }
        },
        Err(e) => {
            return local_paths
                .iter()
                .map(|p| {
                    let name = StdPath::new(p)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("file")
                        .to_string();
                    UploadFileResult {
                        file_name: name,
                        success: false,
                        error: Some(e.to_string()),
                    }
                })
                .collect();
        }
    };

    let target_type = load_target_type(server_id).await;
    let is_windows = target_type.eq_ignore_ascii_case("windows");
    let target_remote_dir = if is_windows {
        crate::targets::windows::validators::posix_to_windows_path(remote_dir)
    } else {
        remote_dir.to_string()
    };

    let mut join_set = tokio::task::JoinSet::new();

    for local_path in local_paths {
        let server_id = server_id.to_string();
        let local_path = local_path.clone();
        // 目录内部会在每个子文件完成后自行更新 completed；只有顶层普通文件
        // 需要在 upload_path 成功返回后补记一次，避免多文件上传一直显示 0/N。
        let is_top_level_file = std::fs::metadata(&local_path)
            .map(|metadata| !metadata.is_dir())
            .unwrap_or(false);
        let remote_dir = remote_dir.to_string();
        let target_remote_dir = target_remote_dir.clone();
        let override_name = override_name.map(|s| s.to_string());
        let send_clone = send.clone();
        let completed_clone = completed.clone();
        let sftp_clone = sftp.clone();
        let cancel_clone = cancel.cloned();
        let tmp_path_override = tmp_path_override.map(|s| s.to_string());

        join_set.spawn(async move {
            // 每个文件开始前检查取消标志
            if let Some(ref flag) = cancel_clone {
                if flag.load(Ordering::Relaxed) {
                    let file_name = StdPath::new(&local_path)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("file")
                        .to_string();
                    let base_name = override_name
                        .unwrap_or(file_name);
                    return UploadFileResult {
                        file_name: base_name,
                        success: false,
                        error: Some("Transfer canceled by user".to_string()),
                    };
                }
            }

            let local_base = StdPath::new(&local_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file")
                .to_string();
            let base_name = override_name
                .clone()
                .unwrap_or(local_base);
            let remote_path = if is_windows {
                let clean_dir = target_remote_dir.trim_end_matches(['/', '\\']);
                if clean_dir.is_empty() {
                    format!("C:\\{}", base_name)
                } else {
                    format!("{}\\{}", clean_dir, base_name)
                }
            } else {
                let clean_dir = remote_dir.trim_end_matches('/');
                if clean_dir.is_empty() {
                    format!("/{}", base_name)
                } else {
                    format!("{}/{}", clean_dir, base_name)
                }
            };

            match upload_path(
                &server_id,
                &local_path,
                &remote_path,
                &*send_clone,
                &completed_clone,
                total_files,
                Some(&sftp_clone),
                cancel_clone.as_ref(),
                tmp_path_override.as_deref(),
            ).await {
                Ok(()) => {
                    if !is_single_file && is_top_level_file && total_files > 0 {
                        let done = completed_clone.fetch_add(1, Ordering::SeqCst) + 1;
                        send_clone(done, total_files, &remote_path, "count");
                    }
                    UploadFileResult {
                        file_name: base_name,
                        success: true,
                        error: None,
                    }
                },
                Err(e) => UploadFileResult {
                    file_name: base_name,
                    success: false,
                    error: Some(e),
                },
            }
        });
    }

    let mut results = Vec::new();
    while let Some(res) = join_set.join_next().await {
        match res {
            Ok(upload_res) => results.push(upload_res),
            Err(e) => {
                results.push(UploadFileResult {
                    file_name: "unknown".to_string(),
                    success: false,
                    error: Some(format!("Concurrent task failed: {}", e)),
                });
            }
        }
    }

    results
}

/// 递归统计本地路径下的文件数
/// 符号链接计为 0（与上传环节跳过 symlink 的行为一致），防止 symlink 环导致无限递归：
/// 本函数在 spawn_blocking 中调用且 panic="abort"，栈溢出会直接崩溃整个应用。
fn count_local_files(path: &str) -> u64 {
    count_local_files_inner(path, 0, &[])
}

fn count_local_files_inner(path: &str, depth: u32, extra_rules: &[String]) -> u64 {
    if depth > MAX_RECURSION_DEPTH {
        return 0;
    }
    let file_name = StdPath::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if crate::validators::is_ignored_with_extra(file_name, extra_rules) {
        return 0;
    }
    // symlink_metadata 不跟随符号链接：跟随版 metadata 会对指向目录的链接返回 is_dir=true，
    // 进而递归进入链接目标 —— 环形链接（如 ln -s . loop）即无限递归
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => return 1,
    };
    if metadata.file_type().is_symlink() {
        return 0;
    }
    if !metadata.is_dir() {
        return 1;
    }

    let local_dir = std::path::Path::new(path);
    let dir_rules = crate::validators::parse_gitignore_in_dir(local_dir);
    let mut current_rules = extra_rules.to_vec();
    if !dir_rules.is_empty() {
        current_rules.extend(dir_rules);
    }

    let mut count: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            let p_str = p.to_string_lossy().to_string();
            count += count_local_files_inner(&p_str, depth + 1, &current_rules);
        }
    }
    count.max(1)
}

/// 上传单个文件或目录
/// sftp 参数为 perform_upload 创建的共享会话；为 None 时回退到独立会话（向后兼容）
async fn upload_path(
    server_id: &str,
    local_path: &str,
    remote_path: &str,
    send: &(dyn Fn(u64, u64, &str, &str) + Send + Sync),
    completed: &Arc<AtomicU64>,
    total_files: u64,
    sftp: Option<&russh_sftp::client::SftpSession>,
    cancel: Option<&Arc<AtomicBool>>,
    tmp_path_override: Option<&str>,
) -> Result<(), String> {
    let metadata = std::fs::metadata(local_path)
        .map_err(|e| format!("Failed to read local file: {}", e))?;

    if metadata.is_dir() {
        // 仅在顶层 upload_path 调用处发送一次清单；递归子目录走 inner，不重复发送。
        let mut manifest = Vec::new();
        collect_local_transfer_manifest(local_path, remote_path, &mut manifest, 1, &[])?;
        for (path, size) in &manifest {
            send(0, *size, path, "manifest");
        }
        upload_dir_recursive(server_id, local_path, remote_path, send, completed, total_files, sftp, cancel).await
    } else {
        // 单文件上传：tmp_path_override 来自 commands 层（支持断点续传）或 None（目录递归）
        upload_single_file(server_id, local_path, remote_path, send, sftp, cancel, tmp_path_override).await
    }
}

/// 上传单个文件
/// Windows: 使用新 transfer 模块（512KB 分块，PathResolver 路径统一，.uploading 临时文件）
/// Linux: 使用 SFTP 子系统流式传输（256KB 分块，.sw-upload-tmp-{uuid} 临时文件）
/// sftp 参数为 None 时回退到 sftp_upload_file_stream（创建独立会话）
/// tmp_path_override: 外部预生成的临时文件路径（用于断点续传时由 commands 层发送初始事件）
///                   None 时内部生成（目录递归场景，不支持续传）
async fn upload_single_file(
    server_id: &str,
    local_path: &str,
    remote_path: &str,
    send: &(dyn Fn(u64, u64, &str, &str) + Send + Sync),
    sftp: Option<&russh_sftp::client::SftpSession>,
    cancel: Option<&Arc<AtomicBool>>,
    tmp_path_override: Option<&str>,
) -> Result<(), String> {
    let file_name = StdPath::new(local_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");

    // 统一使用 manager.rs 成熟的 SFTP 流式传输（具备超时、取消、TOCTOU 续传校验、三步原子备份 rename 与 Windows 路径兼容）
    // 临时文件路径：外部传入（单文件，支持续传）或内部生成（目录递归，不支持续传）
    let owned_tmp = format!("{}.sw-upload-tmp-{}", remote_path.replace('\\', "/"), uuid::Uuid::new_v4());
    let tmp_remote_path = tmp_path_override.unwrap_or(&owned_tmp);
    // keep_tmp_on_failure=true：失败/暂停时保留临时文件供断点续传。
    // 用户主动取消时由前端 cancelTransfer 显式调用 files_cleanup_tmp_file 清理，
    // 「暂停」复用取消通道但前端不清理，正是断点续传的前提（否则暂停=从头重传）。
    //
    // 断连（含服务端 1GiB rekey 崩溃）时自动重连，新建专用会话并从远端 tmp
    // 实际大小续传；首轮复用外部共享会话（目录上传场景）
    let sftp_result = upload_file_with_auto_retry(
        server_id,
        local_path,
        remote_path,
        tmp_remote_path,
        sftp,
        |transferred, total| {
            send(transferred, total, file_name, "bytes");
        },
        cancel,
        None,
        true,
    )
    .await;

    sftp_result?;
    Ok(())
}

/// 递归上传本地目录
/// sftp 参数为 perform_upload 创建的共享会话；为 None 时创建独立会话
async fn upload_dir_recursive(
    server_id: &str,
    local_path: &str,
    remote_path: &str,
    send: &(dyn Fn(u64, u64, &str, &str) + Send + Sync),
    completed: &Arc<AtomicU64>,
    total_files: u64,
    sftp: Option<&russh_sftp::client::SftpSession>,
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<(), String> {
    // 若调用方未传入共享会话，则创建一次会话复用给整个目录上传
    let owned_sftp;
    let sftp_ref: &russh_sftp::client::SftpSession = if let Some(s) = sftp {
        s
    } else {
        let conn = crate::ssh::manager::SshManager::global()
            .get_connection(server_id)
            .map_err(|e| e.to_string())?;
        owned_sftp = conn
            .create_dedicated_sftp_session()
            .await
            .map_err(|e| format!("SFTP session failed: {}", e))?;
        &owned_sftp
    };

    upload_dir_recursive_inner(
        server_id,
        local_path,
        remote_path,
        send,
        completed,
        total_files,
        sftp_ref,
        cancel,
        1, // 顶层目录从第 1 层开始
        &[],
    )
    .await
}

/// 递归上传内部函数（带 SFTP 会话复用）
/// `depth`: 当前递归深度，从 1 开始；超过 MAX_RECURSION_DEPTH 时拒绝继续（防 symlink 循环栈溢出）
async fn upload_dir_recursive_inner(
    server_id: &str,
    local_path: &str,
    remote_path: &str,
    send: &(dyn Fn(u64, u64, &str, &str) + Send + Sync),
    completed: &Arc<AtomicU64>,
    total_files: u64,
    sftp: &russh_sftp::client::SftpSession,
    cancel: Option<&Arc<AtomicBool>>,
    depth: u32,
    extra_rules: &[String],
) -> Result<(), String> {
    if depth > MAX_RECURSION_DEPTH {
        return Err(format!(
            "Max recursion depth ({}) exceeded at '{}': possible symlink loop",
            MAX_RECURSION_DEPTH, remote_path
        ));
    }

    // 使用当前复用的 SFTP 会话创建远程目录。
    // 不能调用 files_mkdir：该命令每次都会新建 SFTP session，递归目录较深时
    // 很容易耗尽服务端 channel/handle 限额，随后连目录刷新也会失败。
    let remote_dir_path = remote_path.replace('\\', "/");
    if let Err(e) = sftp.create_dir(&remote_dir_path).await {
        // 目录可能已由并发任务或上一次重试创建；仅在确认它确实存在且为目录时忽略错误。
        match sftp.metadata(&remote_dir_path).await {
            Ok(meta) if meta.is_dir() => {}
            _ => return Err(format!("SFTP mkdir failed: {}", e)),
        }
    }

    let local_dir = std::path::Path::new(local_path);
    let dir_rules = crate::validators::parse_gitignore_in_dir(local_dir);
    let mut current_rules = extra_rules.to_vec();
    if !dir_rules.is_empty() {
        current_rules.extend(dir_rules);
    }

    let entries = std::fs::read_dir(local_path)
        .map_err(|e| format!("Failed to read local directory: {}", e))?;

    for entry in entries {
        // 每个文件开始前检查取消标志
        if let Some(flag) = cancel {
            if flag.load(Ordering::Relaxed) {
                return Err("Transfer canceled by user".to_string());
            }
        }
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let item_name = entry.file_name().to_string_lossy().to_string();
        if crate::validators::is_ignored_with_extra(&item_name, &current_rules) {
            continue;
        }
        let item_local_path = entry.path().to_string_lossy().to_string();
        let is_windows_path = remote_path.contains('\\')
            || (remote_path.len() >= 2 && remote_path.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false) && remote_path.chars().nth(1) == Some(':'));
        let item_remote_path = if is_windows_path {
            if remote_path.ends_with('\\') {
                format!("{}{}", remote_path, item_name)
            } else {
                format!("{}\\{}", remote_path, item_name)
            }
        } else {
            if remote_path == "/" {
                format!("/{}", item_name)
            } else {
                format!("{}/{}", remote_path, item_name)
            }
        };

        let metadata = entry.metadata().map_err(|e| format!("Failed to read metadata: {}", e))?;
        // symlink 检测：跳过 symlink（不跟随），防止 symlink 指向 / 或敏感目录导致递归上传意料外内容
        // entry.file_type() 返回 Result<FileType, io::Error>，不跟随 symlink
        let file_type = entry.file_type().map_err(|e| format!("Failed to read file type: {}", e))?;
        if file_type.is_symlink() {
            // 跳过 symlink，避免递归上传 symlink 指向的目录树（可能指向 / 或其他敏感目录）
            continue;
        }
        if metadata.is_dir() {
            Box::pin(upload_dir_recursive_inner(
                server_id,
                &item_local_path,
                &item_remote_path,
                send,
                completed,
                total_files,
                sftp,
                cancel,
                depth + 1,
                &current_rules,
            ))
            .await?;
        } else {
            // 目录上传同时发送字节级进度和文件计数进度：前端可将所有
            // 子文件字节累加成整个目录的精确进度，并显示已完成文件数。
            // sftp_upload_file_with_session 内部已用"临时文件 + rename"原子写入策略：
            // 失败时仅清理自己的临时文件，目标文件若已存在则完全不受影响。
            // 断连（含 1GiB rekey 崩溃）自动重连并续传；目录流最终失败时清理 tmp
            let ul_tmp_path = format!("{}.sw-upload-tmp-{}", item_remote_path, uuid::Uuid::new_v4());
            upload_file_with_auto_retry(
                server_id,
                &item_local_path,
                &item_remote_path,
                &ul_tmp_path,
                Some(sftp),
                |transferred, total| {
                    send(transferred, total, &item_remote_path, "bytes");
                },
                cancel,
                None,
                false,
            )
            .await?;

            // 更新文件计数进度（total_type="count"）
            let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
            if total_files > 0 {
                send(done, total_files, &item_remote_path, "count");
            }
        }
    }

    Ok(())
}

// ============================================================
// 断点续传（仅单文件，目录递归不支持）
// ============================================================

/// 续传上传：从 `offset` 字节处继续上传本地文件到远程临时文件，完成后 rename 覆盖目标。
///
/// - `transfer_id`：复用原传输记录的 ID（前端保持同一记录，仅状态切换为 transferring）
/// - `tmp_remote_path`：上次传输使用的远程临时文件路径（由初始进度事件携带）
/// - `offset`：上次已传输字节数（前端从最后进度事件 current 字段记录）
///
/// 失败/取消时仍保留临时文件（keep_tmp_on_failure=true），允许再次续传。
/// 前端可调用 files_cleanup_tmp_file 清理残留临时文件。
#[tauri::command]
pub async fn files_resume_upload(
    app: AppHandle,
    server_id: String,
    local_path: String,
    remote_path: String,
    tmp_remote_path: String,
    offset: u64,
    transfer_id: String,
    expected_source_size: Option<u64>,
) -> Result<FileUploadResult, String> {
    let target_type = load_target_type(&server_id).await;
    // Windows 目标路径归一：前端记录的 targetPath 是 POSIX 形式（/C:/...），
    // 而首次上传实际使用盘符形式（C:\...，SFTP 层再统一为 C:/...）。续传若直接
    // 把 POSIX 形式传给 SFTP 层，会与 tmp 文件（盘符形式）的目录前缀不一致。
    // 此处统一转换为盘符形式，与首次上传对齐（posix_to_windows_path 对两种输入均幂等）。
    let remote_path = if target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::validators::posix_to_windows_path(&remote_path)
    } else {
        remote_path
    };
    // 路径校验（defense-in-depth，按目标类型分发）
    let path_validation = crate::validators::validate_path_for_target(remote_path.clone(), false, &target_type);
    if !path_validation.valid {
        return Ok(FileUploadResult {
            success: false,
            error: Some(format!(
                "Invalid remote path: {}",
                path_validation.error.unwrap_or_default()
            )),
            results: Vec::new(),
        });
    }

    // 安全校验：tmp_remote_path 必须以 remote_path + ".sw-upload-tmp-" 开头
    // 防止攻击者构造 tmp_remote_path="/home/victim/.ssh/id_rsa" 触发任意文件 rename（窃取/丢失）
    let tmp_validation = crate::validators::validate_tmp_path(&tmp_remote_path, Some(&remote_path));
    if !tmp_validation.valid {
        return Ok(FileUploadResult {
            success: false,
            error: Some(format!(
                "Invalid temporary remote path: {}",
                tmp_validation.error.unwrap_or_default()
            )),
            results: Vec::new(),
        });
    }
    if crate::files::remote::is_dangerous_root_path(&tmp_remote_path) {
        return Ok(FileUploadResult {
            success: false,
            error: Some(format!("Refused to resume upload to dangerous root path: {}", tmp_remote_path)),
            results: Vec::new(),
        });
    }

    // 源文件一致性校验（H4）：续传从 offset 处 APPEND，若本地源文件在暂停期间被修改
    // （大小变化即足以判定），续传会产出"前半段旧内容 + 后半段新内容"的静默损坏文件。
    // 指纹由前端以传输发起时记录的 total 传入；未传（旧客户端）则跳过，保持兼容。
    if let Some(expected) = expected_source_size {
        match tokio::fs::metadata(&local_path).await {
            Ok(meta) => {
                if meta.len() != expected {
                    return Ok(FileUploadResult {
                        success: false,
                        error: Some(format!(
                            "Source file has changed since transfer started (size {} -> {}); \
                             resume aborted to prevent corruption. Please start a fresh transfer.",
                            expected,
                            meta.len()
                        )),
                        results: Vec::new(),
                    });
                }
            }
            Err(e) => {
                return Ok(FileUploadResult {
                    success: false,
                    error: Some(format!("Cannot stat source file to verify integrity: {}", e)),
                    results: Vec::new(),
                });
            }
        }
    }

    let file_name = StdPath::new(&local_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    let send = |current: u64, total: u64, name: &str, total_type: &str| {
        send_progress(
            &app,
            TransferProgress {
                transfer_id: transfer_id.clone(),
                r#type: "upload".to_string(),
                current,
                total,
                file_name: name.to_string(),
                done: None,
                phase: None,
                total_type: Some(total_type.to_string()),
                tmp_path: None, // 续传不再重复发送 tmp_path
                error: None,
            },
        );
    };

    // 注册取消标志（前端可调用 files_cancel_transfer 取消）
    let cancel_flag = register_transfer(&transfer_id);
    let _transfer_guard = TransferRegistrationGuard::new(&transfer_id);
    let cancel_ref: Option<&Arc<AtomicBool>> = Some(&cancel_flag);

    // 获取 SFTP 会话
    let conn = match crate::ssh::manager::SshManager::global().get_connection(&server_id) {
        Ok(c) => c,
        Err(e) => {
            unregister_transfer(&transfer_id);
            return Ok(FileUploadResult {
                success: false,
                error: Some(e.to_string()),
                results: Vec::new(),
            });
        }
    };
    let sftp = match conn.create_dedicated_sftp_session().await {
        Ok(s) => s,
        Err(e) => {
            unregister_transfer(&transfer_id);
            return Ok(FileUploadResult {
                success: false,
                error: Some(format!("SFTP session failed: {}", e)),
                results: Vec::new(),
            });
        }
    };

    // 临时文件可用性检测 + 自动降级策略
    // - 存在且大小 == offset → 真续传（APPEND 模式）
    // - 不存在或大小不匹配 → 自动降级为全新传输（重新生成 tmpPath，offset 视为 0）
    //   场景：用户删除了临时文件、服务器重启清理 /tmp、上次传输异常导致文件不完整
    //   用户体验：进度条重置为 0，前端通过 phase=tmpLost 提示"临时文件已丢失，从头开始传输"
    let effective_tmp_path: String;
    let effective_offset: Option<u64>;
    let need_reset_progress: bool;

    match sftp.metadata(&tmp_remote_path).await {
        Ok(meta) => {
            let actual_size = meta.size.unwrap_or(0);
            // 使用 >= 而非 ==：暂停场景下后端实际写入可能略大于前端 lastOffset
            // （cancel flag 在 chunk 之间检查，最后一个 chunk 写入后进度事件可能未送达前端）
            // 使用 actual_size 作为 offset，从临时文件实际末尾续传，避免重复写入
            if actual_size >= offset && actual_size > 0 {
                // 临时文件大小匹配 → 真续传
                effective_tmp_path = tmp_remote_path.clone();
                effective_offset = Some(actual_size);
                need_reset_progress = false;
            } else if actual_size > 0 {
                // 临时文件存在但比 offset 小（异常情况）→ 降级为全新传输
                let _ = sftp.remove_file(&tmp_remote_path).await;
                effective_tmp_path = format!("{}.sw-upload-tmp-{}", remote_path, uuid::Uuid::new_v4());
                effective_offset = None;
                need_reset_progress = true;
            } else {
                // 临时文件大小为 0 → 全新传输
                let _ = sftp.remove_file(&tmp_remote_path).await;
                effective_tmp_path = format!("{}.sw-upload-tmp-{}", remote_path, uuid::Uuid::new_v4());
                effective_offset = None;
                need_reset_progress = true;
            }
        }
        Err(_) => {
            // 临时文件不存在 → 降级为全新传输
            effective_tmp_path = format!("{}.sw-upload-tmp-{}", remote_path, uuid::Uuid::new_v4());
            effective_offset = None;
            need_reset_progress = true;
        }
    }

    // 降级场景：发送携带新 tmpPath 和 phase=tmpLost 的初始事件
    // 前端据此：1) 更新 tmpPath（用于下次续传）2) 重置 current=0 3) 显示 toast 提示用户
    if need_reset_progress {
        send_progress(
            &app,
            TransferProgress {
                transfer_id: transfer_id.clone(),
                r#type: "upload".to_string(),
                current: 0,
                total: 0,
                file_name: file_name.clone(),
                done: None,
                phase: Some("tmpLost".to_string()),
                total_type: Some("bytes".to_string()),
                tmp_path: Some(effective_tmp_path.clone()),
                error: None,
            },
        );
    }

    // 执行传输：续传传入 Some(offset)，全新传输传入 None
    // keep_tmp_on_failure=true：与函数文档注释对齐——失败/暂停保留临时文件允许
    // 再次续传；取消时由前端显式调用 files_cleanup_tmp_file 清理
    // 断连（含 1GiB rekey 崩溃）时自动重连，新建专用会话并从远端 tmp 实际大小续传
    let result = upload_file_with_auto_retry(
        &server_id,
        &local_path,
        &remote_path,
        &effective_tmp_path,
        Some(&sftp),
        |transferred, total| {
            send(transferred, total, &file_name, "bytes");
        },
        cancel_ref,
        effective_offset,
        true,
    )
    .await;

    unregister_transfer(&transfer_id);

    // 发送完成事件：done 携带真实成败；失败时带上原因，前端据此将传输记录置为失败
    let dl_ok = result.is_ok();
    let dl_err = if dl_ok { None } else { result.as_ref().err().map(|e| e.to_string()) };
    send_progress(
        &app,
        TransferProgress {
            transfer_id,
            r#type: "upload".to_string(),
            current: 0,
            total: 0,
            file_name: String::new(),
            done: Some(dl_ok),
            phase: None,
            total_type: None,
            tmp_path: None,
            error: dl_err.clone(),
        },
    );

    match result {
        Ok(()) => Ok(FileUploadResult {
            success: true,
            error: None,
            results: vec![UploadFileResult {
                file_name,
                success: true,
                error: None,
            }],
        }),
        Err(e) => Ok(FileUploadResult {
            success: false,
            error: Some(e),
            results: Vec::new(),
        }),
    }
}

/// 续传下载：从 `offset` 字节处继续下载远程文件到本地临时文件，完成后 rename 覆盖目标。
///
/// - `transfer_id`：复用原传输记录的 ID
/// - `tmp_local_path`：上次传输使用的本地临时文件路径
/// - `offset`：上次已传输字节数
#[tauri::command]
pub async fn files_resume_download(
    app: AppHandle,
    server_id: String,
    remote_path: String,
    local_path: String,
    tmp_local_path: String,
    offset: u64,
    transfer_id: String,
) -> Result<FileDownloadResult, String> {
    let target_type = load_target_type(&server_id).await;
    // 路径校验（按目标类型分发）
    let path_validation = crate::validators::validate_path_for_target(remote_path.clone(), false, &target_type);
    if !path_validation.valid {
        return Ok(FileDownloadResult {
            success: false,
            error: Some(format!(
                "Invalid remote path: {}",
                path_validation.error.unwrap_or_default()
            )),
            local_path: None,
        });
    }

    // 安全校验：tmp_local_path 必须以 local_path + ".sw-dl-tmp-" 开头
    // 防止攻击者构造 tmp_local_path="C:\Important\File" 触发任意本地文件删除/损坏
    let tmp_validation = crate::validators::validate_tmp_path(&tmp_local_path, Some(&local_path));
    if !tmp_validation.valid {
        return Ok(FileDownloadResult {
            success: false,
            error: Some(format!(
                "Invalid temporary local path: {}",
                tmp_validation.error.unwrap_or_default()
            )),
            local_path: None,
        });
    }

    let file_name = remote_path.rsplit(['/', '\\']).next().unwrap_or("file").to_string();

    let send = |current: u64, total: u64, name: &str, total_type: &str| {
        send_progress(
            &app,
            TransferProgress {
                transfer_id: transfer_id.clone(),
                r#type: "download".to_string(),
                current,
                total,
                file_name: name.to_string(),
                done: None,
                phase: None,
                total_type: Some(total_type.to_string()),
                tmp_path: None,
                error: None,
            },
        );
    };

    let cancel_flag = register_transfer(&transfer_id);
    let _transfer_guard = TransferRegistrationGuard::new(&transfer_id);
    let cancel_ref: Option<&Arc<AtomicBool>> = Some(&cancel_flag);

    // 临时文件可用性检测 + 自动降级策略（与 files_resume_upload 对称）
    // - 存在且大小 == offset → 真续传（APPEND 模式）
    // - 不存在或大小不匹配 → 自动降级为全新传输（重新生成 tmpPath，offset 视为 0）
    let effective_tmp_path: String;
    let effective_offset: Option<u64>;
    let need_reset_progress: bool;

    match tokio::fs::metadata(&tmp_local_path).await {
        Ok(meta) => {
            let actual_size = meta.len();
            // 使用 >= 而非 ==：暂停场景下后端实际写入可能略大于前端 lastOffset
            // 使用 actual_size 作为 offset，从临时文件实际末尾续传，避免重复写入
            if actual_size >= offset && actual_size > 0 {
                // 临时文件大小匹配 → 真续传
                effective_tmp_path = tmp_local_path.clone();
                effective_offset = Some(actual_size);
                need_reset_progress = false;
            } else if actual_size > 0 {
                // 临时文件存在但比 offset 小（异常情况）→ 降级为全新传输
                let _ = tokio::fs::remove_file(&tmp_local_path).await;
                effective_tmp_path = format!("{}.sw-dl-tmp-{}", local_path, uuid::Uuid::new_v4());
                effective_offset = None;
                need_reset_progress = true;
            } else {
                // 临时文件大小为 0 → 全新传输
                let _ = tokio::fs::remove_file(&tmp_local_path).await;
                effective_tmp_path = format!("{}.sw-dl-tmp-{}", local_path, uuid::Uuid::new_v4());
                effective_offset = None;
                need_reset_progress = true;
            }
        }
        Err(_) => {
            // 临时文件不存在 → 降级为全新传输
            effective_tmp_path = format!("{}.sw-dl-tmp-{}", local_path, uuid::Uuid::new_v4());
            effective_offset = None;
            need_reset_progress = true;
        }
    }

    // 降级场景：发送携带新 tmpPath 和 phase=tmpLost 的初始事件
    // 前端据此：1) 更新 tmpPath（用于下次续传）2) 重置 current=0 3) 显示 toast 提示用户
    if need_reset_progress {
        send_progress(
            &app,
            TransferProgress {
                transfer_id: transfer_id.clone(),
                r#type: "download".to_string(),
                current: 0,
                total: 0,
                file_name: file_name.clone(),
                done: None,
                phase: Some("tmpLost".to_string()),
                total_type: Some("bytes".to_string()),
                tmp_path: Some(effective_tmp_path.clone()),
                error: None,
            },
        );
    }

    // 执行传输：续传传入 Some(offset)，全新传输传入 None
    // keep_tmp_on_failure=true：失败/暂停保留临时文件供断点续传；
    // 取消时由前端显式调用 files_cleanup_tmp_file 清理
    // 断连（含 1GiB rekey 崩溃）时自动重连并从本地 tmp 实际大小续传
    let result = download_file_with_auto_retry(
        &server_id,
        &remote_path,
        &local_path,
        &effective_tmp_path,
        None,
        |transferred, total| {
            send(transferred, total, &file_name, "bytes");
        },
        cancel_ref,
        effective_offset,
        true,
    )
    .await;

    unregister_transfer(&transfer_id);

    // 发送终态事件：done 必须真实反映传输结果（与 files_resume_upload 的 done: Some(dl_ok) 对齐）。
    // 此前硬编码 done=true：续传失败时前端会先把记录标记为"已完成"（假成功，目标文件从未生成），
    // 且事件先于 invoke 返回值到达，前端的失败兜底因记录已定型 completed 而被跳过。
    let (done_ok, fail_msg) = match &result {
        Ok(()) => (true, None),
        Err(e) => (false, Some(e.clone())),
    };
    send_progress(
        &app,
        TransferProgress {
            transfer_id,
            r#type: "download".to_string(),
            current: 0,
            total: 0,
            file_name: file_name.clone(),
            done: Some(done_ok),
            phase: None,
            total_type: Some("bytes".to_string()),
            tmp_path: None,
            error: fail_msg,
        },
    );

    match result {
        Ok(()) => Ok(FileDownloadResult {
            success: true,
            error: None,
            local_path: Some(local_path),
        }),
        Err(e) => Ok(FileDownloadResult {
            success: false,
            error: Some(e),
            local_path: None,
        }),
    }
}

/// 清理断点续传残留的临时文件（用户放弃续传时调用）。
///
/// - `is_remote=true`：清理远程临时文件（通过 SFTP remove_file）
/// - `is_remote=false`：清理本地临时文件（通过 tokio::fs::remove_file）
///
/// 文件不存在视为成功（已清理或已 rename）。
#[tauri::command]
pub async fn files_cleanup_tmp_file(
    server_id: String,
    tmp_path: String,
    is_remote: bool,
) -> Result<bool, String> {
    // 安全校验：tmp_path 必须匹配 .sw-(upload|dl)-tmp-<uuid> 模式
    // 防止恶意前端传入任意路径（如 /etc/passwd）删除任意文件
    let tmp_validation = crate::validators::validate_tmp_path(&tmp_path, None);
    if !tmp_validation.valid {
        return Err(tmp_validation.error.unwrap_or_default());
    }
    // 远程路径额外检查 dangerous root path
    if is_remote && crate::files::remote::is_dangerous_root_path(&tmp_path) {
        return Err(format!("Refused to clean up dangerous root path: {}", tmp_path));
    }

    if is_remote {
        let conn = crate::ssh::manager::SshManager::global()
            .get_connection(&server_id)
            .map_err(|e| e.to_string())?;
        let sftp = conn
            .create_sftp_session()
            .await
            .map_err(|e| format!("SFTP session failed: {}", e))?;
        match sftp.remove_file(&tmp_path).await {
            Ok(_) => Ok(true),
            Err(e) => {
                // 文件不存在视为已清理（可能已被 rename 或上次清理过）
                // 优先用 SFTP 状态码判断（StatusCode::NoSuchFile = 2），不依赖错误消息语言
                use russh_sftp::client::error::Error as SftpError;
                use russh_sftp::protocol::StatusCode;
                match &e {
                    SftpError::Status(status) if status.status_code == StatusCode::NoSuchFile => Ok(true),
                    _ => {
                        // 兜底：状态码不可用时回退到字符串匹配（向后兼容）
                        let msg = e.to_string().to_lowercase();
                        if msg.contains("no such file") || msg.contains("does not exist") || msg.contains("not found") {
                            Ok(true)
                        } else {
                            Err(format!("Failed to remove remote tmp file: {}", e))
                        }
                    }
                }
            }
        }
    } else {
        match tokio::fs::remove_file(&tmp_path).await {
            Ok(_) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(true),
            Err(e) => Err(format!("Failed to remove local tmp file: {}", e)),
        }
    }
}

/// `tmp_dest_path`：由调用方生成并在断连重试间复用（支持断点续传）
/// `resume_offset`：Some(n) → 以 APPEND 模式从目标 tmp 的 n 字节处续传
/// `keep_tmp_on_failure`：失败时是否保留目标 tmp（重试驱动传 true；目录流
///   传 false 维持「失败即清理」的原行为）
async fn server_to_server_single_file(
    src_sftp: &russh_sftp::client::SftpSession,
    dest_sftp: &russh_sftp::client::SftpSession,
    src_path: &str,
    dest_path: &str,
    total_bytes: u64,
    send_progress: impl Fn(u64, u64, Option<&str>),
    cancel: Option<&Arc<AtomicBool>>,
    tmp_dest_path: &str,
    resume_offset: Option<u64>,
    keep_tmp_on_failure: bool,
) -> Result<(), String> {
    use russh_sftp::protocol::OpenFlags;
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    let sftp_src_path = src_path.replace('\\', "/");
    let sftp_dest_path = dest_path.replace('\\', "/");
    let tmp_dest_path = tmp_dest_path.replace('\\', "/");
    let mut src_file = src_sftp.open(&sftp_src_path).await
        .map_err(|e| format!("Failed to open source file: {}", e))?;

    // 续传模式：APPEND 打开目标 tmp；全新模式：CREATE+TRUNCATE
    let (dest_file, initial_written) = if let Some(offset) = resume_offset {
        // 源端防回退校验：源文件在断连期间变小则中止（防「旧前缀+新内容」静默损坏）
        if total_bytes > 0 && offset > total_bytes {
            return Err(format!(
                "Source file shrank since the transfer was interrupted ({} > {} bytes). \
                 Please start a fresh transfer.",
                offset, total_bytes
            ));
        }
        let f = dest_sftp
            .open_with_flags(&tmp_dest_path, OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::APPEND)
            .await
            .map_err(|e| format!("Failed to open destination temp file for resume: {}", e))?;

        // TOCTOU 防护：打开后校验目标 tmp 实际大小是否等于 offset
        let actual_size = dest_sftp
            .metadata(&tmp_dest_path)
            .await
            .map_err(|e| format!("Cannot verify dest tmp size (TOCTOU): {}", e))?
            .len();
        if actual_size != offset {
            return Err(format!(
                "Resume tmp file size mismatch (TOCTOU detected): expected {} bytes, actual {} bytes. \
                 Aborting to prevent data corruption.",
                offset, actual_size
            ));
        }

        // 内容采样校验：源文件与目标 tmp 在 offset 前最后 4KB 比对，
        // 防源文件在断连期间被同尺寸修改导致静默损坏
        const TAIL_SAMPLE_MAX: usize = 4096;
        let sample_len = (offset as usize).min(TAIL_SAMPLE_MAX);
        if sample_len > 0 {
            let sample_start = offset - sample_len as u64;
            let mut src_tail = vec![0u8; sample_len];
            src_file
                .seek(std::io::SeekFrom::Start(sample_start))
                .await
                .map_err(|e| format!("Source seek failed for tail sample: {}", e))?;
            tokio::time::timeout(std::time::Duration::from_secs(30), src_file.read_exact(&mut src_tail))
                .await
                .map_err(|_| "Source read timed out (tail sample)".to_string())?
                .map_err(|e| format!("Source read failed for tail sample: {}", e))?;
            src_file
                .seek(std::io::SeekFrom::Start(offset))
                .await
                .map_err(|e| format!("Source seek failed after tail sample: {}", e))?;

            let mut tmp_read = dest_sftp
                .open_with_flags(&tmp_dest_path, OpenFlags::READ)
                .await
                .map_err(|e| format!("Failed to open dest tmp for tail sample: {}", e))?;
            tmp_read
                .seek(std::io::SeekFrom::Start(sample_start))
                .await
                .map_err(|e| format!("Dest tmp seek failed for tail sample: {}", e))?;
            let mut tmp_tail = vec![0u8; sample_len];
            tokio::time::timeout(std::time::Duration::from_secs(30), tmp_read.read_exact(&mut tmp_tail))
                .await
                .map_err(|_| "Dest tmp read timed out (tail sample)".to_string())?
                .map_err(|e| format!("Dest tmp read failed for tail sample: {}", e))?;
            let _ = tmp_read.shutdown().await;
            if src_tail != tmp_tail {
                return Err(format!(
                    "Resume verification failed: dest tmp content does not match the source at offset {} \
                     (source file may have changed since the transfer was interrupted). \
                     Please start a fresh transfer.",
                    offset
                ));
            }
        }
        (f, offset)
    } else {
        let f = dest_sftp.create(&tmp_dest_path).await
            .map_err(|e| format!("Failed to create destination temp file: {}", e))?;
        (f, 0)
    };
    let mut dest_file = dest_file;

    send_progress(initial_written, total_bytes, Some(&tmp_dest_path));

    // ── SFTP 中继流水线参数（与下载引擎对齐）──────────────────────────────
    // 旧实现读侧为 256KB 停-等：吞吐被 RTT_src 钳制（≈ 256KB ÷ RTT_src）。
    // 改为 64 在途读请求（单请求 64KB，按 limits@openssh.com 协商值钳制），
    // 读侧管道 4MB 覆盖带宽时延积；写侧由补丁库 poll_write 维持 64 深度
    // 在途写流水线（单请求按 max_write_len 协商拆分），双腿并发后
    // 吞吐 ≈ min(源→本机, 本机→目标) 两条链路带宽，不再受单请求 RTT 限制
    const MAX_INFLIGHT: usize = 64;
    const TARGET_CHUNK_SIZE: usize = 64 * 1024;
    let chunk_size = TARGET_CHUNK_SIZE.min(src_file.max_read_len().max(1)) as u64;
    // s2s 直传的 read/write 60s 超时与普通上传/下载对齐，结合 sleep_until_cancel 毫秒级响应取消
    let stall_timeout = std::time::Duration::from_secs(60);

    // 在途读请求槽位：offset 用于短读补齐定位，len 用于检测短读
    struct InflightReadSlot {
        offset: u64,
        len: u32,
        read: russh_sftp::client::fs::InflightRead,
    }
    let mut inflight: std::collections::VecDeque<InflightReadSlot> =
        std::collections::VecDeque::with_capacity(MAX_INFLIGHT);
    let mut next_request_offset: u64 = initial_written;
    let mut written: u64 = initial_written;

    let copy_result: Result<(), String> = async {
        loop {
            if let Some(flag) = cancel {
                if flag.load(Ordering::Relaxed) {
                    return Err("Transfer canceled by user".to_string());
                }
            }

            // 1. 填充读侧流水线：read_at_nowait 同步直投（零 Task、微秒级），
            //    一次压满 64 个读请求，用 4MB 在途窗口覆盖源服务器往返时延
            while inflight.len() < MAX_INFLIGHT {
                let req_len = if total_bytes > 0 {
                    if next_request_offset >= total_bytes {
                        break;
                    }
                    chunk_size.min(total_bytes - next_request_offset)
                } else {
                    chunk_size
                };
                let pending = src_file
                    .read_at_nowait(next_request_offset, req_len as u32)
                    .map_err(|e| format!("Read request failed: {}", e))?;
                inflight.push_back(InflightReadSlot {
                    offset: next_request_offset,
                    len: req_len as u32,
                    read: pending,
                });
                next_request_offset += req_len;
            }
            if inflight.is_empty() {
                break;
            }

            // 2. FIFO 严格保序：只等队首读请求；到达后交写侧流水线异步吸收，
            //    目标临时文件偏移严格连续递增，原子 rename 前的完整性可靠
            let head = inflight.pop_front().unwrap();
            let chunk_res = tokio::select! {
                biased;
                _ = crate::ssh::manager::sleep_until_cancel(cancel) => {
                    return Err("Transfer canceled by user".to_string());
                }
                r = tokio::time::timeout(stall_timeout, head.read.wait()) => {
                    r.map_err(|_| "Read timeout (60s, source server may be stalled)".to_string())?
                        .map_err(|e| format!("Read error: {}", e))?
                }
            };

            match chunk_res {
                // EOF：以 StatusCode::Eof / 空载荷为准（SFTP 规范：短读不是 EOF）
                None => break,
                Some(bytes) => {
                    let n = bytes.len();
                    if n > head.len as usize {
                        return Err(
                            "Source server returned more data than requested".to_string()
                        );
                    }
                    tokio::select! {
                        biased;
                        _ = crate::ssh::manager::sleep_until_cancel(cancel) => {
                            return Err("Transfer canceled by user".to_string());
                        }
                        write_res = tokio::time::timeout(stall_timeout, dest_file.write_all(&bytes)) => {
                            write_res
                                .map_err(|_| "Write timeout (60s, destination server may be stalled)".to_string())?
                                .map_err(|e| format!("Write error: {}", e))?;
                        }
                    }
                    written += n as u64;
                    send_progress(written, total_bytes, Some(&tmp_dest_path));
                    crate::ssh::manager::apply_rate_limit(n as u64).await;

                    // 短读补齐：SFTP v3 允许服务端返回少于请求长度的数据（且不是
                    // EOF）。补发缺口区段并插回队首，已发出的大偏移请求继续排队，
                    // 中继落盘偏移保持严格连续，杜绝跳段产生文件空洞
                    if n < head.len as usize {
                        let gap_offset = head.offset + n as u64;
                        let gap_len = head.len - n as u32;
                        let known_eof = total_bytes > 0 && gap_offset >= total_bytes;
                        if !known_eof {
                            let pending = src_file
                                .read_at_nowait(gap_offset, gap_len)
                                .map_err(|e| format!("Read request failed: {}", e))?;
                            inflight.push_front(InflightReadSlot {
                                offset: gap_offset,
                                len: gap_len,
                                read: pending,
                            });
                        }
                    }
                }
            }

            // 主动让出 CPU，确保底层 russh channel 和 TCP 读写 runner 得以高频处理网络报文
            tokio::task::yield_now().await;
        }
        Ok(())
    }.await;

    // 优雅收尾：等待写缓冲区全部刷盘并关闭句柄
    let _ = tokio::time::timeout(std::time::Duration::from_secs(60), dest_file.flush()).await;
    let _ = tokio::time::timeout(std::time::Duration::from_secs(60), dest_file.shutdown()).await;
    let _ = tokio::time::timeout(std::time::Duration::from_secs(30), src_file.shutdown()).await;

    drop(dest_file);
    drop(src_file);

    if let Err(e) = copy_result {
        if !keep_tmp_on_failure {
            let _ = dest_sftp.remove_file(&tmp_dest_path).await;
        }
        return Err(e);
    }

    // 原子覆盖：迁移到三步备份法 sftp_atomic_rename_overwrite（备份目标→rename tmp→失败回滚）。
    let rename_result = crate::ssh::manager::sftp_atomic_rename_overwrite(dest_sftp, &tmp_dest_path, &sftp_dest_path).await;
    if rename_result.is_err() {
        let _ = dest_sftp.remove_file(&tmp_dest_path).await;
    }
    rename_result
}

async fn server_to_server_dir_recursive(
    server_id_src: &str,
    server_id_dest: &str,
    src_sftp: &russh_sftp::client::SftpSession,
    dest_sftp: &russh_sftp::client::SftpSession,
    src_path: &str,
    dest_path: &str,
    send: &(dyn Fn(u64, u64, &str, &str) + Send + Sync),
    completed: &Arc<AtomicU64>,
    total_files: u64,
    cancel: Option<&Arc<AtomicBool>>,
    depth: u32,
) -> Result<(), String> {
    if depth > MAX_RECURSION_DEPTH {
        return Err(format!("Max recursion depth exceeded at {}", src_path));
    }
    
    // 使用已复用的 dest_sftp 会话创建目录，避免反复新建 SFTP channel；若目录已存在则安全跳过
    let remote_dest_dir = dest_path.replace('\\', "/");
    if let Err(e) = dest_sftp.create_dir(&remote_dest_dir).await {
        match dest_sftp.metadata(&remote_dest_dir).await {
            Ok(meta) if meta.is_dir() => {}
            _ => return Err(format!("SFTP mkdir failed on dest: {}", e)),
        }
    }
    
    let entries = crate::files::remote::files_list(server_id_src.to_string(), src_path.to_string()).await?;
    
    for entry in entries {
        if let Some(flag) = cancel {
            if flag.load(Ordering::Relaxed) {
                return Err("Transfer canceled by user".to_string());
            }
        }
        if entry.name == "." || entry.name == ".." || crate::validators::is_ignored(&entry.name) {
            continue;
        }

        // symlink 检测：跳过软链接，防止无限循环递归（跨平台）
        let is_symlink = match crate::ssh::manager::sftp_stat(server_id_src, &entry.path).await {
            Ok(meta) => meta.is_symlink(),
            Err(_) => false,
        };
        if is_symlink {
            continue;
        }
        
        let item_dest_path = if remote_dest_dir == "/" {
            format!("/{}", entry.name)
        } else {
            format!("{}/{}", remote_dest_dir, entry.name)
        };
        
        if entry.is_directory {
            Box::pin(server_to_server_dir_recursive(
                server_id_src,
                server_id_dest,
                src_sftp,
                dest_sftp,
                &entry.path,
                &item_dest_path,
                send,
                completed,
                total_files,
                cancel,
                depth + 1,
            )).await?;
        } else {
            let meta = src_sftp.metadata(&entry.path).await
                .map_err(|e| format!("Failed to read metadata: {}", e))?;
            let size = meta.size.unwrap_or(0);

            // 目录流不支持断点续传：每文件独立 tmp，失败即清理（维持原行为）
            let item_tmp_path = format!(
                "{}.sw-upload-tmp-{}",
                item_dest_path.replace('\\', "/"),
                uuid::Uuid::new_v4()
            );
            server_to_server_single_file(
                src_sftp,
                dest_sftp,
                &entry.path,
                &item_dest_path,
                size,
                |_, _, _| {},
                cancel,
                &item_tmp_path,
                None,
                false,
            ).await?;
            
            let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
            send(done, total_files, &entry.path, "count");
        }
    }
    
    Ok(())
}

#[tauri::command]
pub async fn files_server_to_server_transfer(
    app: AppHandle,
    src_server_id: String,
    src_path: String,
    dest_server_id: String,
    dest_path: String,
    target_name: Option<String>,
) -> Result<CommandResult, String> {
    let src_target_type = load_target_type(&src_server_id).await;
    let dest_target_type = load_target_type(&dest_server_id).await;
    let src_validation = crate::validators::validate_path_for_target(src_path.clone(), false, &src_target_type);
    if !src_validation.valid {
        return Ok(CommandResult::err(format!("Invalid source path: {}", src_validation.error.unwrap_or_default())));
    }
    let dest_validation = crate::validators::validate_path_for_target(dest_path.clone(), false, &dest_target_type);
    if !dest_validation.valid {
        return Ok(CommandResult::err(format!("Invalid dest path: {}", dest_validation.error.unwrap_or_default())));
    }

    let transfer_id = format!("s2s-{}", uuid::Uuid::new_v4());
    // 文件名提取：兼容 / 和 \ 分隔符（Windows 路径可能用 \）
    let file_name = src_path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("file")
        .to_string();
    let final_dest_name = target_name.unwrap_or(file_name.clone());
    let final_dest_path = if dest_path == "/" {
        format!("/{}", final_dest_name)
    } else {
        format!("{}/{}", dest_path, final_dest_name)
    };

    // 判断源是否为目录：优先用 SFTP stat（跨平台），失败时回退 shell 命令
    // 注意：test -d 是 bash 内建，在 Windows PowerShell/cmd 默认 shell 下不可用
    let src_remote_path = if src_target_type.eq_ignore_ascii_case("windows") {
        crate::targets::windows::validators::posix_to_windows_path(&src_path)
    } else {
        src_path.clone()
    };
    let is_dir = match crate::ssh::manager::sftp_stat(&src_server_id, &src_remote_path).await {
        Ok(meta) => meta.is_dir(),
        Err(_) => {
            // SFTP stat 失败时回退到 shell 判断（Linux 用 test -d，Windows 无可靠回退）
            if src_target_type.eq_ignore_ascii_case("windows") {
                false
            } else {
                let escaped = crate::validators::escape_shell_arg(src_path.clone());
                let check_cmd = format!("test -d {} && echo \"dir\" || echo \"file\"", escaped);
                let check_out = crate::ssh::manager::execute_command(src_server_id.clone(), check_cmd).await;
                check_out.map(|o| o.trim() == "dir").unwrap_or(false)
            }
        }
    };
    
    let send_progress_closure = |current: u64, total: u64, name: &str, total_type: &str, done: Option<bool>, tmp_path: Option<&str>| {
        send_progress(
            &app,
            TransferProgress {
                transfer_id: transfer_id.clone(),
                r#type: "s2s".to_string(),
                current,
                total,
                file_name: name.to_string(),
                done,
                phase: None,
                total_type: Some(total_type.to_string()),
                tmp_path: tmp_path.map(|s| s.to_string()),
                error: None,
            },
        );
    };
    
    let cancel_flag = register_transfer(&transfer_id);
    let _transfer_guard = TransferRegistrationGuard::new(&transfer_id);
    let cancel_ref = Some(&cancel_flag);
    
    let src_conn = crate::ssh::manager::SshManager::global().get_connection(&src_server_id).map_err(|e| e.to_string())?;
    let dest_conn = crate::ssh::manager::SshManager::global().get_connection(&dest_server_id).map_err(|e| e.to_string())?;
    // 使用独立 SFTP 会话（与 perform_upload 一致）：create_sftp_session 返回缓存的
    // 共享会话，长时间传输与用户同时浏览目录的 readdir 交错复用同一 session，
    // Windows sftp-server 不支持这种交错，会互相干扰甚至句柄报错
    let src_sftp = src_conn.create_dedicated_sftp_session().await.map_err(|e| e.to_string())?;
    let dest_sftp = dest_conn.create_dedicated_sftp_session().await.map_err(|e| e.to_string())?;
    
    let result = if is_dir {
        // 文件夹传输：先发送一个携带顶层文件夹名的初始事件，让前端能绑定源/目标路径
        // 后续子文件进度事件的 file_name 是子文件名，但此时记录已存在，不会再查 pendingPathsRef
        send_progress_closure(0, 0, &file_name, "count", None, None);
        let manifest_result = crate::files::remote::files_transfer_manifest(src_server_id.clone(), src_path.clone()).await;
        let (manifest, total_files) = match manifest_result {
            Ok(items) => {
                let total = items.len() as u64;
                (items, total)
            }
            Err(_) => {
                let total = crate::files::remote::files_count_recursive(src_server_id.clone(), src_path.clone()).await.unwrap_or(0);
                (Vec::new(), total)
            }
        };
        for item in &manifest {
            send_progress_closure(0, item.size, &item.path, "manifest", None, None);
        }
        let completed = Arc::new(AtomicU64::new(0));

        let send_closure = |done: u64, total: u64, name: &str, total_type: &str| {
            send_progress_closure(done, total, name, total_type, None, None);
        };
        
        server_to_server_dir_recursive(
            &src_server_id,
            &dest_server_id,
            &src_sftp,
            &dest_sftp,
            &src_path,
            &final_dest_path,
            &send_closure,
            &completed,
            total_files,
            cancel_ref,
            1,
        ).await
    } else {
        // 单文件传输：断连自动重连重试（双腿 1GiB rekey 均可能断）
        // tmp 路径只生成一次，重试间复用；续传偏移取目标 tmp 实际大小
        let meta = src_sftp.metadata(&src_path).await.map_err(|e| e.to_string())?;
        let mut size = meta.size.unwrap_or(0);

        send_progress_closure(0, size, &file_name, "bytes", None, None);

        let tmp_dest_path = format!(
            "{}.sw-upload-tmp-{}",
            final_dest_path.replace('\\', "/"),
            uuid::Uuid::new_v4()
        );
        let mut src_sftp = src_sftp;
        let mut dest_sftp = dest_sftp;
        let mut budget = TransferRetryBudget::new(0);
        let mut retry_no: u32 = 0;
        let mut resume_offset: Option<u64> = None;
        // 循环携带状态：读取点均在首次赋值之后，初始值仅为类型占位
        #[allow(unused_assignments)]
        let mut last_error = String::from("SFTP transfer failed");
        loop {
            let attempt = server_to_server_single_file(
                &src_sftp,
                &dest_sftp,
                &src_path,
                &final_dest_path,
                size,
                |current, total, tmp| {
                    send_progress_closure(current, total, &file_name, "bytes", None, tmp);
                },
                cancel_ref,
                &tmp_dest_path,
                resume_offset,
                true,
            )
            .await;
            match attempt {
                Ok(()) => break Ok(()),
                Err(e) => {
                    if is_non_retryable_transfer_error(&e) {
                        let _ = dest_sftp.remove_file(&tmp_dest_path).await;
                        break Err(e);
                    }
                    last_error = e.clone();
                    eprintln!(
                        "[Transfer] s2s interrupted ({}), auto-reconnect both legs & resume",
                        e
                    );
                    // 重连双腿（健康的一条会被 ensure_transfer_connection 短路复用）
                    if let Err(re) = ensure_transfer_connection(&src_server_id, &e).await {
                        let _ = dest_sftp.remove_file(&tmp_dest_path).await;
                        break Err(format!("{} (auto-reconnect source failed: {})", e, re));
                    }
                    if let Err(re) = ensure_transfer_connection(&dest_server_id, &e).await {
                        let _ = dest_sftp.remove_file(&tmp_dest_path).await;
                        break Err(format!("{} (auto-reconnect destination failed: {})", e, re));
                    }
                    if let Err(ce) = transfer_retry_wait(cancel_ref, retry_no).await {
                        let _ = dest_sftp.remove_file(&tmp_dest_path).await;
                        break Err(ce);
                    }
                    retry_no += 1;
                    // 新建双腿专用会话 + 查询目标 tmp 实际大小作为续传偏移
                    let sessions = async {
                        let s_conn = crate::ssh::manager::SshManager::global()
                            .get_connection(&src_server_id)
                            .map_err(|e| e.to_string())?;
                        let d_conn = crate::ssh::manager::SshManager::global()
                            .get_connection(&dest_server_id)
                            .map_err(|e| e.to_string())?;
                        let s = s_conn
                            .create_dedicated_sftp_session()
                            .await
                            .map_err(|e| e.to_string())?;
                        let d = d_conn
                            .create_dedicated_sftp_session()
                            .await
                            .map_err(|e| e.to_string())?;
                        Ok::<_, String>((s, d))
                    };
                    match sessions.await {
                        Ok((s, d)) => {
                            // 重取源文件大小（防断连期间源文件变化）+ 目标 tmp 实际大小
                            size = s
                                .metadata(&src_path)
                                .await
                                .ok()
                                .and_then(|m| m.size)
                                .unwrap_or(size);
                            let tmp_size = d
                                .metadata(&tmp_dest_path)
                                .await
                                .ok()
                                .map(|m| m.len())
                                .unwrap_or(0);
                            if !budget.register_offset(tmp_size) {
                                let _ = d.remove_file(&tmp_dest_path).await;
                                break Err(last_error);
                            }
                            resume_offset = if tmp_size > 0 { Some(tmp_size) } else { None };
                            src_sftp = s;
                            dest_sftp = d;
                        }
                        Err(se) => {
                            // 会话重建失败：消耗一次零推进预算后重走重连流程
                            if !budget.register_offset(0) {
                                break Err(format!(
                                    "{} (recreate SFTP sessions failed: {})",
                                    last_error, se
                                ));
                            }
                        }
                    }
                }
            }
        }
    };
    
    unregister_transfer(&transfer_id);
    
    match result {
        Ok(()) => {
            send_progress_closure(0, 0, &file_name, "bytes", Some(true), None);
            Ok(CommandResult::ok("Server to Server transfer completed successfully"))
        }
        Err(e) => {
            // 失败：发送 done:false 事件并带上原因，前端据此将传输记录置为失败
            send_progress(
                &app,
                TransferProgress {
                    transfer_id: transfer_id.clone(),
                    r#type: "s2s".to_string(),
                    current: 0,
                    total: 0,
                    file_name: String::new(),
                    done: Some(false),
                    phase: None,
                    total_type: None,
                    tmp_path: None,
                    error: Some(e.clone()),
                },
            );
            Ok(CommandResult::err(e))
        }
    }
}

fn collect_local_transfer_manifest(
    local_path: &str,
    remote_path: &str,
    items: &mut Vec<(String, u64)>,
    depth: u32,
    extra_rules: &[String],
) -> Result<(), String> {
    if depth > MAX_RECURSION_DEPTH {
        return Err(format!("Max recursion depth exceeded at '{}'", local_path));
    }
    let local_dir = std::path::Path::new(local_path);
    let dir_rules = crate::validators::parse_gitignore_in_dir(local_dir);
    let mut current_rules = extra_rules.to_vec();
    if !dir_rules.is_empty() {
        current_rules.extend(dir_rules);
    }
    let entries = std::fs::read_dir(local_path)
        .map_err(|e| format!("Failed to scan local directory: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to scan local entry: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if crate::validators::is_ignored_with_extra(&name, &current_rules) {
            continue;
        }
        let file_type = entry.file_type().map_err(|e| format!("Failed to read file type: {}", e))?;
        if file_type.is_symlink() {
            continue;
        }
        let remote_child = if remote_path.ends_with('/') || remote_path.ends_with('\\') {
            format!("{}{}", remote_path, name)
        } else if remote_path == "/" {
            format!("/{}", name)
        } else {
            let separator = if remote_path.contains('\\') { '\\' } else { '/' };
            format!("{}{}{}", remote_path, separator, name)
        };
        if file_type.is_dir() {
            collect_local_transfer_manifest(&entry.path().to_string_lossy(), &remote_child, items, depth + 1, &current_rules)?;
        } else {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            items.push((remote_child, size));
        }
    }
    Ok(())
}
