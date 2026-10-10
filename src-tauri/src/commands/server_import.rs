//! External session importers for OpenSSH, PuTTY and Xshell.
//!
//! Parsing and preview are deliberately separated from persistence. No
//! credential decryption is attempted; encrypted/missing passwords are
//! surfaced as warnings and users can provide them on first connection.

use crate::db;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use super::ImportResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalImportCandidate {
    pub source_id: String,
    pub source: String,
    pub name: String,
    pub host: String,
    pub port: i32,
    pub username: String,
    pub auth_type: String,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default = "default_timeout")]
    pub connection_timeout: i32,
    #[serde(default = "default_target_type")]
    pub target_type: String,
    #[serde(default = "default_protocol")]
    pub protocol: String,
    #[serde(default)]
    pub protocols: Vec<String>,
    #[serde(default)]
    pub proxy_config: Option<String>,
    #[serde(default)]
    pub tunnels_config: Option<String>,
    #[serde(default)]
    pub serial_config: Option<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub duplicate: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalImportPreview {
    pub source: String,
    pub candidates: Vec<ExternalImportCandidate>,
    pub warnings: Vec<String>,
}

fn default_timeout() -> i32 { 30 }
fn default_target_type() -> String { "linux".to_string() }
fn default_protocol() -> String { "ssh".to_string() }

fn normalize_protocol(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "ssh" | "ssh2" | "ssh1" => "ssh".to_string(),
        "telnet" => "telnet".to_string(),
        "serial" => "serial".to_string(),
        other if !other.is_empty() => other.to_string(),
        _ => "ssh".to_string(),
    }
}

fn default_port(protocol: &str) -> i32 {
    match protocol {
        "telnet" => 23,
        "serial" => 115200,
        _ => 22,
    }
}

/// 外部会话导入的唯一性规则：只按服务器地址去重。
///
/// 同一个 IP/主机地址即使端口、协议或用户名不同，也视为同一台服务器，
/// 避免从多个客户端重复导入相同资产。
fn candidate_key(host: &str) -> String {
    let normalized = host.trim().trim_matches(['[', ']']);
    normalized
        .parse::<std::net::IpAddr>()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| normalized.to_ascii_lowercase())
}

fn mark_duplicates(candidates: &mut [ExternalImportCandidate]) -> Result<(), String> {
    let raw = db::servers_list_raw()?;
    let existing: Vec<db::Server> = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to inspect existing servers: {e}"))?;
    let mut keys: HashSet<String> = existing
        .iter()
        .map(|s| candidate_key(&s.host))
        .collect();
    for candidate in candidates {
        let key = candidate_key(&candidate.host);
        candidate.duplicate = !keys.insert(key);
    }
    Ok(())
}

fn read_text_file(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|e| format!("Failed to stat {}: {e}", path.display()))?;
    if !metadata.is_file() || metadata.len() > 32 * 1024 * 1024 {
        return Err(format!("Import source must be a regular file no larger than 32 MiB: {}", path.display()));
    }
    let bytes = fs::read(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16(&units).map_err(|e| format!("Invalid UTF-16 file {}: {e}", path.display()));
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16(&units).map_err(|e| format!("Invalid UTF-16 file {}: {e}", path.display()));
    }
    Ok(String::from_utf8_lossy(bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes)).into_owned())
}

fn expand_home(value: &str) -> String {
    let value = value.trim().trim_matches('"');
    if let Some(rest) = value.strip_prefix("~/").or_else(|| value.strip_prefix("~\\")) {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest).to_string_lossy().into_owned();
        }
    }
    value.to_string()
}

#[derive(Default, Clone)]
struct SshHostBlock {
    aliases: Vec<String>,
    values: HashMap<String, Vec<String>>,
    source_file: PathBuf,
}

fn parse_ssh_line(line: &str) -> Option<(String, String)> {
    let clean = line.split('#').next()?.trim();
    if clean.is_empty() { return None; }
    let (key, value) = if let Some((k, v)) = clean.split_once('=') {
        (k.trim(), v.trim())
    } else {
        let mut parts = clean.splitn(2, char::is_whitespace);
        (parts.next()?, parts.next().unwrap_or("").trim())
    };
    if value.is_empty() { return None; }
    Some((key.to_ascii_lowercase(), value.to_string()))
}

fn parse_forward(value: &str, kind: &str, index: usize) -> Option<serde_json::Value> {
    let parts: Vec<&str> = value.split_whitespace().collect();
    if kind == "dynamic" {
        let listen = parts.first()?;
        let (bind_address, bind_port) = split_host_port(listen, "127.0.0.1")?;
        return Some(json!({
            "type": "dynamic", "name": format!("Imported dynamic {index}"),
            "bindAddress": bind_address, "bindPort": bind_port
        }));
    }
    if parts.len() < 2 { return None; }
    let (bind_address, bind_port) = split_host_port(parts[0], "127.0.0.1")?;
    let (target_host, target_port) = split_host_port(parts[1], "localhost")?;
    Some(json!({
        "type": kind, "name": format!("Imported {kind} {index}"),
        "bindAddress": bind_address, "bindPort": bind_port,
        "targetHost": target_host, "targetPort": target_port
    }))
}

fn split_host_port(value: &str, default_host: &str) -> Option<(String, i32)> {
    if let Ok(port) = value.parse::<i32>() {
        return Some((default_host.to_string(), port));
    }
    let (host, port) = value.rsplit_once(':')?;
    Some((host.trim_matches(['[', ']']).to_string(), port.parse().ok()?))
}

fn parse_proxy_jump(value: &str, aliases: &HashMap<String, SshHostBlock>) -> Option<String> {
    let first = value.split(',').next()?.trim();
    if first.eq_ignore_ascii_case("none") { return None; }
    let (user_part, host_part) = first.split_once('@').map_or((None, first), |(u, h)| (Some(u), h));
    let (mut host, mut port) = host_part.rsplit_once(':')
        .and_then(|(h, p)| p.parse::<i32>().ok().map(|port| (h.to_string(), port)))
        .unwrap_or_else(|| (host_part.to_string(), 22));
    let mut username = user_part.unwrap_or("").to_string();
    let mut private_key_path: Option<String> = None;
    if let Some(block) = aliases.get(&host.to_ascii_lowercase()) {
        if let Some(v) = block.values.get("hostname").and_then(|v| v.first()) { host = v.clone(); }
        if let Some(v) = block.values.get("port").and_then(|v| v.first()).and_then(|v| v.parse().ok()) { port = v; }
        if username.is_empty() {
            username = block.values.get("user").and_then(|v| v.first()).cloned().unwrap_or_default();
        }
        private_key_path = block.values.get("identityfile").and_then(|v| v.first()).map(|v| expand_home(v));
    }
    Some(json!({
        "type": "ssh_jump", "name": "Imported ProxyJump", "host": host,
        "port": port, "username": username,
        "authType": if private_key_path.is_some() { "privateKey" } else { "password" },
        "privateKeyPath": private_key_path, "connectionTimeout": 30
    }).to_string())
}

fn parse_openssh(path: &Path) -> Result<(Vec<ExternalImportCandidate>, Vec<String>), String> {
    let content = read_text_file(path)?;
    let mut blocks: Vec<SshHostBlock> = Vec::new();
    let mut current: Option<SshHostBlock> = None;
    let mut global = HashMap::<String, Vec<String>>::new();
    let mut warnings = Vec::new();
    for line in content.lines() {
        let Some((key, value)) = parse_ssh_line(line) else { continue };
        if key == "include" {
            warnings.push("Include directives are not expanded in this version; import included files separately.".to_string());
            continue;
        }
        if key == "match" {
            if let Some(block) = current.take() { blocks.push(block); }
            warnings.push("Match blocks were skipped because they are conditional.".to_string());
            continue;
        }
        if key == "host" {
            if let Some(block) = current.take() { blocks.push(block); }
            current = Some(SshHostBlock {
                aliases: value.split_whitespace().map(str::to_string).collect(),
                values: HashMap::new(),
                source_file: path.to_path_buf(),
            });
            continue;
        }
        if let Some(block) = current.as_mut() {
            block.values.entry(key).or_default().push(value);
        } else {
            global.entry(key).or_default().push(value);
        }
    }
    if let Some(block) = current { blocks.push(block); }

    let mut alias_map = HashMap::new();
    for block in &blocks {
        for alias in &block.aliases {
            if !alias.contains(['*', '!', '?']) {
                alias_map.insert(alias.to_ascii_lowercase(), block.clone());
            }
        }
    }

    let mut result = Vec::new();
    for block in blocks {
        for alias in block.aliases.iter().filter(|a| !a.contains(['*', '!', '?'])) {
            let get = |key: &str| {
                block.values.get(key).and_then(|v| v.first())
                    .or_else(|| global.get(key).and_then(|v| v.first()))
                    .cloned()
            };
            let host = get("hostname").unwrap_or_else(|| alias.clone());
            let port = get("port").and_then(|v| v.parse().ok()).unwrap_or(22);
            let username = get("user").unwrap_or_default();
            let private_key_path = get("identityfile").map(|v| expand_home(&v));
            let mut candidate_warnings = Vec::new();
            if username.is_empty() { candidate_warnings.push("Username was not specified.".to_string()); }
            if private_key_path.is_none() { candidate_warnings.push("Password is not stored in OpenSSH config and must be provided on first connection.".to_string()); }
            let mut tunnels = Vec::new();
            for (key, kind) in [("localforward", "local"), ("remoteforward", "remote"), ("dynamicforward", "dynamic")] {
                if let Some(values) = block.values.get(key) {
                    for (idx, value) in values.iter().enumerate() {
                        if let Some(tunnel) = parse_forward(value, kind, idx + 1) { tunnels.push(tunnel); }
                        else { candidate_warnings.push(format!("Could not parse {key}: {value}")); }
                    }
                }
            }
            let proxy_config = get("proxyjump").and_then(|v| parse_proxy_jump(&v, &alias_map));
            result.push(ExternalImportCandidate {
                source_id: format!("{}#{}", block.source_file.display(), alias),
                source: "openssh".to_string(), name: alias.clone(), host, port, username,
                auth_type: if private_key_path.is_some() { "privateKey" } else { "password" }.to_string(),
                private_key_path, tags: vec!["OpenSSH".to_string()],
                notes: Some(format!("Imported from {}", block.source_file.display())),
                connection_timeout: 30, target_type: "linux".to_string(), protocol: "ssh".to_string(),
                protocols: vec!["ssh".to_string()], proxy_config,
                tunnels_config: if tunnels.is_empty() { None } else { Some(serde_json::Value::Array(tunnels).to_string()) },
                serial_config: None, warnings: candidate_warnings, duplicate: false,
            });
        }
    }
    if result.is_empty() { return Err("No concrete Host entries were found in the OpenSSH config".to_string()); }
    Ok((result, warnings))
}

fn unescape_reg_string(value: &str) -> String {
    value.replace("\\\"", "\"").replace("\\\\", "\\")
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                out.push(v); i += 3; continue;
            }
        }
        out.push(bytes[i]); i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn parse_reg_value(line: &str) -> Option<(String, String)> {
    let (name, raw) = line.split_once('=')?;
    let name = name.trim().trim_matches('"').to_string();
    let raw = raw.trim();
    let value = if let Some(v) = raw.strip_prefix("dword:") {
        i64::from_str_radix(v, 16).ok()?.to_string()
    } else if raw.starts_with('"') && raw.ends_with('"') {
        unescape_reg_string(&raw[1..raw.len() - 1])
    } else { return None; };
    Some((name, value))
}

fn parse_putty_reg(path: &Path) -> Result<(Vec<ExternalImportCandidate>, Vec<String>), String> {
    let content = read_text_file(path)?;
    let prefix = "\\software\\simontatham\\putty\\sessions\\";
    let mut sessions: Vec<(String, HashMap<String, String>)> = Vec::new();
    let mut current: Option<(String, HashMap<String, String>)> = None;
    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            if let Some(session) = current.take() { sessions.push(session); }
            let lower = line.to_ascii_lowercase();
            if let Some(pos) = lower.find(prefix) {
                let encoded = &line[pos + prefix.len()..line.len() - 1];
                current = Some((percent_decode(encoded), HashMap::new()));
            }
        } else if let Some((_, values)) = current.as_mut() {
            if let Some((key, value)) = parse_reg_value(line) { values.insert(key, value); }
        }
    }
    if let Some(session) = current { sessions.push(session); }

    let mut candidates = Vec::new();
    for (name, values) in sessions {
        if name.eq_ignore_ascii_case("Default%20Settings") || name.eq_ignore_ascii_case("Default Settings") { continue; }
        let protocol = normalize_protocol(values.get("Protocol").map(String::as_str).unwrap_or("ssh"));
        if !matches!(protocol.as_str(), "ssh" | "telnet") { continue; }
        let host = values.get("HostName").cloned().unwrap_or_default();
        if host.trim().is_empty() { continue; }
        let port = values.get("PortNumber").and_then(|v| v.parse().ok()).unwrap_or_else(|| default_port(&protocol));
        let username = values.get("UserName").cloned().unwrap_or_default();
        let key_path = values.get("PublicKeyFile").filter(|v| !v.trim().is_empty()).cloned();
        let mut warnings = Vec::new();
        if username.is_empty() { warnings.push("Username was not specified.".to_string()); }
        warnings.push("PuTTY does not normally store login passwords; provide it on first connection if required.".to_string());
        let proxy_method = values.get("ProxyMethod").map(String::as_str).unwrap_or("0");
        let proxy_type = match proxy_method { "2" => Some("socks5"), "3" => Some("http"), _ => None };
        if !matches!(proxy_method, "0" | "2" | "3") {
            warnings.push("PuTTY SOCKS4, Telnet and local-command proxies are not supported and were skipped.".to_string());
        }
        let proxy_config = proxy_type.and_then(|proxy_type| values.get("ProxyHost").filter(|v| !v.is_empty()).map(|host| json!({
            "type": proxy_type, "name": "Imported PuTTY proxy", "host": host,
            "port": values.get("ProxyPort").and_then(|v| v.parse::<i32>().ok()).unwrap_or(8080),
            "proxyUsername": values.get("ProxyUsername").cloned().unwrap_or_default(), "proxyPassword": ""
        }).to_string()));
        let mut tunnels = Vec::new();
        if let Some(raw) = values.get("PortForwardings") {
            for (index, entry) in raw.split(',').map(str::trim).filter(|v| !v.is_empty()).enumerate() {
                let Some(prefix) = entry.chars().next() else { continue };
                let body = &entry[prefix.len_utf8()..];
                let kind = match prefix.to_ascii_uppercase() { 'L' => "local", 'R' => "remote", 'D' => "dynamic", _ => continue };
                let parsed = if kind == "dynamic" {
                    parse_forward(body.split('=').next().unwrap_or(body), kind, index + 1)
                } else if let Some((listen, target)) = body.split_once('=') {
                    parse_forward(&format!("{listen} {target}"), kind, index + 1)
                } else { None };
                if let Some(tunnel) = parsed { tunnels.push(tunnel); }
                else { warnings.push(format!("Could not parse PuTTY port forwarding: {entry}")); }
            }
        }
        candidates.push(ExternalImportCandidate {
            source_id: format!("{}#{}", path.display(), name), source: "putty".to_string(),
            name, host, port, username,
            auth_type: if key_path.is_some() { "privateKey" } else { "password" }.to_string(),
            private_key_path: key_path, tags: vec!["PuTTY".to_string()],
            notes: Some(format!("Imported from {}", path.display())), connection_timeout: 30,
            target_type: "linux".to_string(), protocol: protocol.clone(), protocols: vec![protocol],
            proxy_config,
            tunnels_config: if tunnels.is_empty() { None } else { Some(serde_json::Value::Array(tunnels).to_string()) },
            serial_config: None, warnings, duplicate: false,
        });
    }
    if candidates.is_empty() { return Err("No PuTTY sessions were found in the selected registry export".to_string()); }
    Ok((candidates, Vec::new()))
}

#[cfg(target_os = "windows")]
fn export_putty_registry() -> Result<PathBuf, String> {
    use std::process::Command;

    let path = std::env::temp_dir().join(format!("sw-putty-{}.reg", uuid::Uuid::new_v4()));
    let status = Command::new("reg.exe")
        .args(["export", r"HKCU\Software\SimonTatham\PuTTY\Sessions", &path.to_string_lossy(), "/y"])
        .status()
        .map_err(|e| format!("Failed to start reg.exe: {e}"))?;
    if !status.success() { return Err("PuTTY sessions were not found in the current Windows user registry".to_string()); }
    Ok(path)
}

#[cfg(not(target_os = "windows"))]
fn export_putty_registry() -> Result<PathBuf, String> {
    Err("Direct PuTTY registry import is only available on Windows; select an exported .reg file instead.".to_string())
}

fn parse_ini(content: &str) -> HashMap<String, String> {
    let mut section = String::new();
    let mut values = HashMap::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with([';', '#']) { continue; }
        if line.starts_with('[') && line.ends_with(']') {
            section = line[1..line.len() - 1].trim().to_ascii_lowercase();
        } else if let Some((key, value)) = line.split_once('=') {
            values.insert(format!("{}.{}", section, key.trim().to_ascii_lowercase()), value.trim().trim_matches('"').to_string());
        }
    }
    values
}

fn ini_find(values: &HashMap<String, String>, keys: &[&str]) -> Option<String> {
    for key in keys {
        let key = key.to_ascii_lowercase();
        if let Some(v) = values.get(&key).filter(|v| !v.trim().is_empty()) { return Some(v.clone()); }
        if let Some((_, v)) = values.iter().find(|(k, v)| k.ends_with(&format!(".{key}")) && !v.trim().is_empty()) { return Some(v.clone()); }
    }
    None
}

fn collect_xsh_files(path: &Path, output: &mut Vec<PathBuf>, depth: usize) -> Result<(), String> {
    if depth > 12 { return Ok(()); }
    if path.is_file() {
        if path.extension().and_then(|v| v.to_str()).is_some_and(|v| v.eq_ignore_ascii_case("xsh")) { output.push(path.to_path_buf()); }
        return Ok(());
    }
    for entry in fs::read_dir(path).map_err(|e| format!("Failed to read directory {}: {e}", path.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if p.is_dir() { collect_xsh_files(&p, output, depth + 1)?; }
        else if p.extension().and_then(|v| v.to_str()).is_some_and(|v| v.eq_ignore_ascii_case("xsh")) { output.push(p); }
        if output.len() >= 5000 { return Err("The Xshell directory contains more than 5000 sessions".to_string()); }
    }
    Ok(())
}

fn parse_xshell(path: &Path) -> Result<(Vec<ExternalImportCandidate>, Vec<String>), String> {
    let mut files = Vec::new();
    collect_xsh_files(path, &mut files, 0)?;
    if files.is_empty() { return Err("No .xsh session files were found".to_string()); }
    let root = if path.is_dir() { path } else { path.parent().unwrap_or(Path::new("")) };
    let mut candidates = Vec::new();
    let mut global_warnings = Vec::new();
    for file in files {
        let content = match read_text_file(&file) {
            Ok(v) => v,
            Err(e) => { global_warnings.push(e); continue; }
        };
        let values = parse_ini(&content);
        let protocol = normalize_protocol(&ini_find(&values, &["connection.protocol", "protocol"]).unwrap_or_else(|| "ssh".to_string()));
        if !matches!(protocol.as_str(), "ssh" | "telnet" | "serial") {
            global_warnings.push(format!("Skipped unsupported Xshell protocol in {}", file.display()));
            continue;
        }
        let name = file.file_stem().and_then(|v| v.to_str()).unwrap_or("Xshell Session").to_string();
        let mut tags = vec!["Xshell".to_string()];
        if let Ok(relative) = file.parent().unwrap_or(root).strip_prefix(root) {
            for part in relative.components() {
                let value = part.as_os_str().to_string_lossy().to_string();
                if !value.is_empty() { tags.push(value); }
            }
        }
        let mut warnings = Vec::new();
        let encrypted_password = ini_find(&values, &["connection:authentication.password", "password"]);
        if encrypted_password.is_some() { warnings.push("Xshell stored password was intentionally not decrypted; enter it on first connection.".to_string()); }
        let username = ini_find(&values, &["connection:authentication.username", "username", "user_name"]).unwrap_or_default();
        if username.is_empty() && protocol != "serial" { warnings.push("Username was not specified.".to_string()); }
        let key_path = ini_find(&values, &["connection:ssh:authentication.publickey", "privatekey", "userkey", "keypath"]).map(|v| expand_home(&v));
        let (host, port, target_type, serial_config) = if protocol == "serial" {
            let port_name = ini_find(&values, &["connection:serial.port", "portname", "comport"]).unwrap_or_else(|| "COM1".to_string());
            let baud = ini_find(&values, &["connection:serial.baudrate", "baudrate"]).and_then(|v| v.parse::<i32>().ok()).unwrap_or(115200);
            let config = json!({
                "portName": port_name, "baudRate": baud,
                "dataBits": ini_find(&values, &["databits"]).and_then(|v| v.parse::<i32>().ok()).unwrap_or(8),
                "stopBits": ini_find(&values, &["stopbits"]).and_then(|v| v.parse::<i32>().ok()).unwrap_or(1),
                "parity": ini_find(&values, &["parity"]).unwrap_or_else(|| "none".to_string()).to_ascii_lowercase(),
                "flowControl": "none"
            }).to_string();
            (port_name, baud, "serial".to_string(), Some(config))
        } else {
            let host = ini_find(&values, &["connection.host", "host", "hostname"]).unwrap_or_default();
            let port = ini_find(&values, &["connection.port", "port"]).and_then(|v| v.parse::<i32>().ok()).unwrap_or_else(|| default_port(&protocol));
            (host, port, if protocol == "telnet" { "network".to_string() } else { "linux".to_string() }, None)
        };
        if host.trim().is_empty() { global_warnings.push(format!("Skipped Xshell session without a host: {}", file.display())); continue; }
        candidates.push(ExternalImportCandidate {
            source_id: file.to_string_lossy().into_owned(), source: "xshell".to_string(), name, host, port,
            username, auth_type: if key_path.is_some() { "privateKey" } else { "password" }.to_string(),
            private_key_path: key_path, tags, notes: Some(format!("Imported from {}", file.display())),
            connection_timeout: 30, target_type, protocol: protocol.clone(), protocols: vec![protocol],
            proxy_config: None, tunnels_config: None, serial_config, warnings, duplicate: false,
        });
    }
    if candidates.is_empty() { return Err("No supported Xshell sessions could be parsed".to_string()); }
    Ok((candidates, global_warnings))
}

fn collect_json_files(path: &Path, output: &mut Vec<PathBuf>, depth: usize) -> Result<(), String> {
    if depth > 12 { return Ok(()); }
    if path.is_file() {
        output.push(path.to_path_buf());
        return Ok(());
    }
    for entry in fs::read_dir(path).map_err(|e| format!("Failed to read directory {}: {e}", path.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if p.is_dir() {
            collect_json_files(&p, output, depth + 1)?;
        } else if p.extension().and_then(|v| v.to_str()).is_some_and(|v| v.eq_ignore_ascii_case("json")) {
            output.push(p);
        }
        if output.len() >= 5000 {
            return Err("The FinalShell directory contains more than 5000 JSON files".to_string());
        }
    }
    Ok(())
}

fn parse_finalshell_item(
    val: &serde_json::Value,
    source_name: &str,
    source_path: &Path,
) -> Option<ExternalImportCandidate> {
    let obj = val.as_object()?;
    let host = obj.get("host")
        .or_else(|| obj.get("ip"))
        .or_else(|| obj.get("hostname"))
        .or_else(|| obj.get("ip_address"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;

    let name = obj.get("name")
        .or_else(|| obj.get("alias"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| source_name.to_string());

    let port = obj.get("port")
        .and_then(|v| {
            if let Some(n) = v.as_i64() {
                Some(n as i32)
            } else if let Some(s) = v.as_str() {
                s.parse::<i32>().ok()
            } else {
                None
            }
        })
        .unwrap_or(22);

    let username = obj.get("user_name")
        .or_else(|| obj.get("username"))
        .or_else(|| obj.get("user"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "root".to_string());

    let raw_key = obj.get("key_path")
        .or_else(|| obj.get("private_key_path"))
        .or_else(|| obj.get("private_key"))
        .or_else(|| obj.get("identity_file"))
        .and_then(|v| v.as_str())
        .map(expand_home)
        .filter(|s| !s.trim().is_empty());

    let auth_type = if raw_key.is_some() {
        "privateKey".to_string()
    } else {
        "password".to_string()
    };

    let notes = obj.get("notes")
        .or_else(|| obj.get("comment"))
        .or_else(|| obj.get("desc"))
        .or_else(|| obj.get("description"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| Some(format!("Imported from FinalShell ({})", source_path.display())));

    let protocol_str = obj.get("protocol")
        .or_else(|| obj.get("protocol_type"))
        .and_then(|v| v.as_str())
        .unwrap_or("ssh");
    let protocol = normalize_protocol(protocol_str);

    let mut warnings = Vec::new();
    if obj.contains_key("password") {
        warnings.push("FinalShell stored password was intentionally not decrypted; enter it on first connection.".to_string());
    }

    Some(ExternalImportCandidate {
        source_id: format!("{}:{}", source_path.to_string_lossy(), name),
        source: "finalshell".to_string(),
        name,
        host,
        port,
        username,
        auth_type,
        private_key_path: raw_key,
        tags: vec!["FinalShell".to_string()],
        notes,
        connection_timeout: default_timeout(),
        target_type: default_target_type(),
        protocol: protocol.clone(),
        protocols: vec![protocol],
        proxy_config: None,
        tunnels_config: None,
        serial_config: None,
        warnings,
        duplicate: false,
    })
}

fn parse_finalshell(path: &Path) -> Result<(Vec<ExternalImportCandidate>, Vec<String>), String> {
    let mut files = Vec::new();
    collect_json_files(path, &mut files, 0)?;
    if files.is_empty() {
        return Err("No JSON session files were found".to_string());
    }
    let mut candidates = Vec::new();
    let mut global_warnings = Vec::new();

    for file in files {
        let content = match read_text_file(&file) {
            Ok(v) => v,
            Err(e) => { global_warnings.push(e); continue; }
        };
        let file_stem = file.file_stem().and_then(|v| v.to_str()).unwrap_or("session");
        let val: serde_json::Value = match serde_json::from_str(&content) {
            Ok(v) => v,
            Err(e) => {
                global_warnings.push(format!("Failed to parse JSON in {}: {e}", file.display()));
                continue;
            }
        };

        if let Some(arr) = val.as_array() {
            for item in arr {
                if let Some(c) = parse_finalshell_item(item, file_stem, &file) {
                    candidates.push(c);
                }
            }
        } else if let Some(obj) = val.as_object() {
            if let Some(arr) = obj.get("conn").or_else(|| obj.get("sessions")).or_else(|| obj.get("items")).and_then(|v| v.as_array()) {
                for item in arr {
                    if let Some(c) = parse_finalshell_item(item, file_stem, &file) {
                        candidates.push(c);
                    }
                }
            } else if let Some(c) = parse_finalshell_item(&val, file_stem, &file) {
                candidates.push(c);
            }
        }
    }

    if candidates.is_empty() {
        return Err("No supported FinalShell sessions could be parsed".to_string());
    }
    Ok((candidates, global_warnings))
}

fn collect_ini_files(path: &Path, output: &mut Vec<PathBuf>, depth: usize) -> Result<(), String> {
    if depth > 12 { return Ok(()); }
    if path.is_file() {
        output.push(path.to_path_buf());
        return Ok(());
    }
    for entry in fs::read_dir(path).map_err(|e| format!("Failed to read directory {}: {e}", path.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let p = entry.path();
        if p.is_dir() {
            collect_ini_files(&p, output, depth + 1)?;
        } else if p.extension().and_then(|v| v.to_str()).is_some_and(|v| v.eq_ignore_ascii_case("ini")) {
            output.push(p);
        }
        if output.len() >= 5000 {
            return Err("The SecureCRT directory contains more than 5000 sessions".to_string());
        }
    }
    Ok(())
}

fn parse_securecrt_line(line: &str) -> Option<(String, String)> {
    let clean = line.trim();
    if clean.is_empty() || clean.starts_with('#') || clean.starts_with(';') {
        return None;
    }
    let (key_part, val_part) = clean.split_once('=')?;
    let key = key_part.trim();
    let clean_key = if let Some(stripped) = key.strip_prefix("S:\"")
        .or_else(|| key.strip_prefix("D:\""))
        .or_else(|| key.strip_prefix("Z:\""))
    {
        stripped.trim_end_matches('"')
    } else {
        key.trim_matches('"')
    };
    let clean_val = val_part.trim().trim_matches('"');
    Some((clean_key.to_string(), clean_val.to_string()))
}

fn parse_securecrt_port(val: &str) -> i32 {
    let val = val.trim().trim_matches('"');
    if val.len() == 8 && val.chars().all(|c| c.is_ascii_hexdigit()) {
        if let Ok(p) = i32::from_str_radix(val, 16) {
            if (1..=65535).contains(&p) {
                return p;
            }
        }
    }
    if let Ok(p) = val.parse::<i32>() {
        if (1..=65535).contains(&p) {
            return p;
        }
    }
    22
}

fn parse_securecrt(path: &Path) -> Result<(Vec<ExternalImportCandidate>, Vec<String>), String> {
    let mut files = Vec::new();
    collect_ini_files(path, &mut files, 0)?;
    if files.is_empty() {
        return Err("No SecureCRT .ini session files were found".to_string());
    }
    let root = if path.is_dir() { path } else { path.parent().unwrap_or(Path::new("")) };
    let mut candidates = Vec::new();
    let mut global_warnings = Vec::new();

    for file in files {
        let file_name = file.file_name().and_then(|v| v.to_str()).unwrap_or("");
        if file_name.eq_ignore_ascii_case("__FolderData__.ini") || file_name.eq_ignore_ascii_case("Default.ini") {
            continue;
        }

        let content = match read_text_file(&file) {
            Ok(v) => v,
            Err(e) => { global_warnings.push(e); continue; }
        };

        let mut values: HashMap<String, String> = HashMap::new();
        for line in content.lines() {
            if let Some((k, v)) = parse_securecrt_line(line) {
                values.insert(k.to_ascii_lowercase(), v);
            }
        }

        let host = match values.get("hostname").filter(|s| !s.trim().is_empty()) {
            Some(h) => h.trim().to_string(),
            None => continue,
        };

        let file_stem = file.file_stem().and_then(|v| v.to_str()).unwrap_or(&host).to_string();
        let name = values.get("session name")
            .filter(|s| !s.trim().is_empty())
            .cloned()
            .unwrap_or(file_stem);

        let port = values.get("[ssh2] port")
            .or_else(|| values.get("port"))
            .map(|s| parse_securecrt_port(s))
            .unwrap_or(22);

        let username = values.get("username")
            .filter(|s| !s.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| "root".to_string());

        let raw_key = values.get("identity filename v2")
            .or_else(|| values.get("identity filename"))
            .map(|s| expand_home(s))
            .filter(|s| !s.trim().is_empty());

        let auth_type = if raw_key.is_some() {
            "privateKey".to_string()
        } else {
            "password".to_string()
        };

        let protocol_raw = values.get("protocol name").map(|s| s.as_str()).unwrap_or("ssh2");
        let protocol = normalize_protocol(protocol_raw);

        let mut tags = vec!["SecureCRT".to_string()];
        if let Ok(rel) = file.strip_prefix(root) {
            for comp in rel.parent().into_iter().flat_map(|p| p.components()) {
                let tag = comp.as_os_str().to_string_lossy().trim().to_string();
                if !tag.is_empty() && !tags.contains(&tag) {
                    tags.push(tag);
                }
            }
        }

        let notes = values.get("comment").cloned().or_else(|| Some(format!("Imported from {}", file.display())));

        let mut warnings = Vec::new();
        if values.contains_key("password") {
            warnings.push("SecureCRT stored password was intentionally not decrypted; enter it on first connection.".to_string());
        }

        candidates.push(ExternalImportCandidate {
            source_id: file.to_string_lossy().into_owned(),
            source: "securecrt".to_string(),
            name,
            host,
            port,
            username,
            auth_type,
            private_key_path: raw_key,
            tags,
            notes,
            connection_timeout: default_timeout(),
            target_type: default_target_type(),
            protocol: protocol.clone(),
            protocols: vec![protocol],
            proxy_config: None,
            tunnels_config: None,
            serial_config: None,
            warnings,
            duplicate: false,
        });
    }

    if candidates.is_empty() {
        return Err("No supported SecureCRT sessions could be parsed".to_string());
    }
    Ok((candidates, global_warnings))
}

#[tauri::command]
pub async fn servers_parse_external_import(
    source: String,
    path: Option<String>,
) -> Result<ExternalImportPreview, String> {
    tokio::task::spawn_blocking(move || {
        let (mut candidates, warnings) = match source.as_str() {
            "openssh" => parse_openssh(Path::new(path.as_deref().ok_or("OpenSSH config path is required")?))?,
            "putty_file" => parse_putty_reg(Path::new(path.as_deref().ok_or("PuTTY .reg path is required")?))?,
            "putty_registry" => {
                let temp = export_putty_registry()?;
                let parsed = parse_putty_reg(&temp);
                let _ = fs::remove_file(&temp);
                parsed?
            }
            "xshell" => parse_xshell(Path::new(path.as_deref().ok_or("Xshell session path is required")?))?,
            "finalshell" => parse_finalshell(Path::new(path.as_deref().ok_or("FinalShell session path is required")?))?,
            "securecrt" => parse_securecrt(Path::new(path.as_deref().ok_or("SecureCRT session path is required")?))?,
            _ => return Err(format!("Unsupported external import source: {source}")),
        };
        mark_duplicates(&mut candidates)?;
        Ok(ExternalImportPreview { source, candidates, warnings })
    }).await.map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
pub async fn servers_import_external(
    candidates: Vec<ExternalImportCandidate>,
    skip_duplicates: bool,
) -> Result<ImportResult, String> {
    tokio::task::spawn_blocking(move || {
        let total = candidates.len();
        let mut imported = 0;
        let mut skipped = 0;
        let mut errors = Vec::new();
        let mut imported_ids = Vec::new();
        let raw = db::servers_list_raw()?;
        let existing: Vec<db::Server> = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let mut keys: HashSet<String> = existing.iter().map(|s| candidate_key(&s.host)).collect();
        for candidate in candidates {
            if candidate.host.trim().is_empty() || !(1..=12_000_000).contains(&candidate.port) {
                skipped += 1;
                errors.push(format!("{}: invalid host or port", candidate.name));
                continue;
            }
            let key = candidate_key(&candidate.host);
            if skip_duplicates && !keys.insert(key) {
                skipped += 1;
                errors.push(format!("{}: duplicate session skipped", candidate.name));
                continue;
            }
            let safe_name: String = candidate.name.chars().take(100).collect();
            let safe_username: String = candidate.username.chars().take(100).collect();
            let input = json!({
                "name": safe_name, "host": candidate.host, "port": candidate.port,
                "username": safe_username, "authType": candidate.auth_type,
                "password": null, "privateKeyPath": candidate.private_key_path,
                "tags": serde_json::to_string(&candidate.tags).unwrap_or_else(|_| "[]".to_string()),
                "notes": candidate.notes, "connectionTimeout": candidate.connection_timeout,
                "favorite": false, "status": "unknown", "targetType": candidate.target_type,
                "protocol": candidate.protocol, "protocols": serde_json::to_string(&candidate.protocols).unwrap_or_else(|_| "[\"ssh\"]".to_string()),
                "rdpPort": 3389, "bmcPort": 443, "proxyConfig": candidate.proxy_config,
                "tunnelsConfig": candidate.tunnels_config, "serialConfig": candidate.serial_config
            });
            match db::servers_add(input.to_string()) {
                Ok(id) => { imported += 1; imported_ids.push(id); }
                Err(e) => { skipped += 1; errors.push(format!("{}: {e}", candidate.name)); }
            }
        }
        Ok(ImportResult { success: true, total, imported, skipped, errors, error: None, imported_ids })
    }).await.map_err(|e| format!("Task join error: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_file(name: &str, content: &[u8]) -> PathBuf {
        let path = std::env::temp_dir().join(format!("sw-import-test-{}-{name}", uuid::Uuid::new_v4()));
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(content).unwrap();
        path
    }

    #[test]
    fn parses_openssh_hosts_keys_jump_and_tunnels() {
        let path = temp_file("config", br#"
Host jump
  HostName 10.0.0.1
  User ops
Host prod
  HostName 10.0.0.8
  User root
  Port 2202
  IdentityFile ~/.ssh/id_ed25519
  ProxyJump jump
  LocalForward 127.0.0.1:8080 localhost:80
"#);
        let (items, _) = parse_openssh(&path).unwrap();
        fs::remove_file(path).ok();
        let prod = items.iter().find(|v| v.name == "prod").unwrap();
        assert_eq!(prod.host, "10.0.0.8");
        assert_eq!(prod.port, 2202);
        assert_eq!(prod.auth_type, "privateKey");
        assert!(prod.proxy_config.as_deref().unwrap().contains("10.0.0.1"));
        assert!(prod.tunnels_config.as_deref().unwrap().contains("8080"));
    }

    #[test]
    fn parses_putty_registry_export() {
        let content = r#"Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\SimonTatham\PuTTY\Sessions\prod%20server]
"HostName"="192.168.1.20"
"PortNumber"=dword:00000016
"Protocol"="ssh"
"UserName"="root"
"PublicKeyFile"="C:\\Keys\\id.ppk"
"ProxyMethod"=dword:00000002
"ProxyHost"="127.0.0.1"
"ProxyPort"=dword:00000438
"PortForwardings"="L8080=localhost:80,D1080="
"#;
        let utf16: Vec<u8> = std::iter::once(0xFEFFu16).chain(content.encode_utf16()).flat_map(u16::to_le_bytes).collect();
        let path = temp_file("putty.reg", &utf16);
        let (items, _) = parse_putty_reg(&path).unwrap();
        fs::remove_file(path).ok();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "prod server");
        assert_eq!(items[0].private_key_path.as_deref(), Some(r"C:\Keys\id.ppk"));
        assert!(items[0].proxy_config.as_deref().unwrap().contains("socks5"));
        assert!(items[0].tunnels_config.as_deref().unwrap().contains("8080"));
    }

    #[test]
    fn parses_xshell_session_without_decrypting_password() {
        let path = temp_file("demo.xsh", br#"
[CONNECTION]
Host=example.com
Port=22
Protocol=SSH
[CONNECTION:AUTHENTICATION]
UserName=ubuntu
Password=encrypted-value
"#);
        let (items, _) = parse_xshell(&path).unwrap();
        fs::remove_file(path).ok();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].host, "example.com");
        assert!(items[0].warnings.iter().any(|v| v.contains("not decrypted")));
    }

    #[test]
    fn duplicate_key_uses_host_only() {
        assert_eq!(candidate_key(" 192.168.1.10 "), candidate_key("192.168.1.10"));
        assert_eq!(candidate_key("SERVER.EXAMPLE.COM"), candidate_key("server.example.com"));
        assert_eq!(candidate_key("[2001:0db8:0:0:0:0:0:1]"), candidate_key("2001:db8::1"));
    }

    #[test]
    fn parses_finalshell_sessions_from_json() {
        let content = br#"[
            {
                "name": "fs-server-1",
                "host": "10.0.1.20",
                "port": 2222,
                "user_name": "admin",
                "key_path": "~/.ssh/id_rsa",
                "password": "encrypted"
            }
        ]"#;
        let path = temp_file("conn.json", content);
        let (items, _) = parse_finalshell(&path).unwrap();
        fs::remove_file(path).ok();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].name, "fs-server-1");
        assert_eq!(items[0].host, "10.0.1.20");
        assert_eq!(items[0].port, 2222);
        assert_eq!(items[0].username, "admin");
        assert_eq!(items[0].auth_type, "privateKey");
        assert!(items[0].warnings.iter().any(|w| w.contains("not decrypted")));
    }

    #[test]
    fn parses_securecrt_ini_session() {
        let content = br#"
S:"Hostname"=192.168.10.88
D:"[SSH2] Port"=00000016
S:"Username"=deploy
S:"Protocol Name"=SSH2
S:"Identity Filename V2"=C:\keys\id_ed25519
S:"Password"=02:xxxx
"#;
        let path = temp_file("server.ini", content);
        let (items, _) = parse_securecrt(&path).unwrap();
        fs::remove_file(path).ok();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].host, "192.168.10.88");
        assert_eq!(items[0].port, 22);
        assert_eq!(items[0].username, "deploy");
        assert_eq!(items[0].auth_type, "privateKey");
        assert_eq!(items[0].private_key_path.as_deref(), Some(r"C:\keys\id_ed25519"));
        assert!(items[0].warnings.iter().any(|w| w.contains("not decrypted")));
    }
}
