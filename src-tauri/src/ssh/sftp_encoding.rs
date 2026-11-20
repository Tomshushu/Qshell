use std::collections::HashMap;
use std::sync::{LazyLock, RwLock};

/// 每台服务器最多缓存的 SFTP 原始路径条目数，防止海量目录扫描导致内存无限增长。
const MAX_RAW_PATH_CACHE_ENTRIES_PER_SERVER: usize = 20_000;

/// SFTP 远端文件名字符集配置。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SftpFilenameEncoding {
    #[default]
    Utf8,
    Gbk,
    Gb18030,
    Auto,
}

impl SftpFilenameEncoding {
    /// 从服务器配置的 `fileTransferConfig.encoding` 字段解析 SFTP 文件名编码。
    pub fn from_config_str(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "gbk" => Self::Gbk,
            "gb18030" => Self::Gb18030,
            "auto" => Self::Auto,
            _ => Self::Utf8,
        }
    }
}

static SFTP_ENCODING_CACHE: LazyLock<RwLock<HashMap<String, SftpFilenameEncoding>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

static SFTP_RAW_PATH_CACHE: LazyLock<RwLock<HashMap<String, HashMap<String, Vec<u8>>>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

/// 清理指定服务器缓存的文件名编码配置与原始路径映射。
/// 应在连接断开或服务器传输配置更新时调用。
pub fn invalidate_server_sftp_caches(server_id: &str) {
    if let Ok(mut enc_cache) = SFTP_ENCODING_CACHE.write() {
        enc_cache.remove(server_id);
    }
    if let Ok(mut path_cache) = SFTP_RAW_PATH_CACHE.write() {
        path_cache.remove(server_id);
    }
}

/// 使指定展示路径及其子路径的原始字节映射失效（用于 rename / remove 后清理陈旧映射）。
pub fn invalidate_cached_path(server_id: &str, display_path: &str) {
    let normalized = normalize_display_path(display_path);
    if normalized.is_empty() {
        return;
    }
    if let Ok(mut cache) = SFTP_RAW_PATH_CACHE.write() {
        if let Some(server_map) = cache.get_mut(server_id) {
            let child_prefix = if normalized.ends_with('/') {
                normalized.clone()
            } else {
                format!("{}/", normalized)
            };
            server_map.retain(|k, _| k != &normalized && !k.starts_with(&child_prefix));
        }
    }
}

/// 将用户或前端传入的路径规范化为 SFTP 展示路径（统一 `/` 分隔符并移除非根目录尾斜杠）。
pub fn normalize_display_path(path: &str) -> String {
    let replaced = path.replace('\\', "/");
    if replaced == "/" || replaced == "." || replaced.is_empty() {
        return replaced;
    }
    let bytes = replaced.as_bytes();
    if bytes.len() == 3 && bytes[1] == b':' && bytes[2] == b'/' {
        return replaced;
    }
    let trimmed = replaced.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else if trimmed.len() == 2 && trimmed.as_bytes()[1] == b':' {
        format!("{}/", trimmed)
    } else {
        trimmed.to_string()
    }
}

/// 拼接 SFTP 展示路径，避免在 `/` 或 `C:/` 后产生双斜杠。
pub fn join_display_path(dir: &str, name: &str) -> String {
    let dir_norm = normalize_display_path(dir);
    if dir_norm.is_empty() || dir_norm == "." {
        return name.to_string();
    }
    if dir_norm.ends_with('/') {
        format!("{}{}", dir_norm, name)
    } else {
        format!("{}/{}", dir_norm, name)
    }
}

/// 拼接 SFTP 原始 wire 字节路径，自动处理根目录与子目录分隔符。
pub fn join_raw_path(dir_raw: &[u8], entry_raw: &[u8]) -> Vec<u8> {
    if dir_raw.is_empty() || dir_raw == b"." {
        return entry_raw.to_vec();
    }
    let mut out = Vec::with_capacity(dir_raw.len() + 1 + entry_raw.len());
    out.extend_from_slice(dir_raw);
    if !dir_raw.ends_with(b"/") {
        out.push(b'/');
    }
    out.extend_from_slice(entry_raw);
    out
}

/// 将服务端返回的 SFTP 原始字节按指定编码解码为 UTF-8 展示字符串。
pub fn decode_sftp_bytes(bytes: &[u8], encoding: SftpFilenameEncoding) -> String {
    match encoding {
        SftpFilenameEncoding::Utf8 => String::from_utf8_lossy(bytes).into_owned(),
        SftpFilenameEncoding::Gbk => encoding_rs::GBK.decode(bytes).0.into_owned(),
        SftpFilenameEncoding::Gb18030 => encoding_rs::GB18030.decode(bytes).0.into_owned(),
        SftpFilenameEncoding::Auto => match std::str::from_utf8(bytes) {
            Ok(s) => s.to_owned(),
            Err(_) => encoding_rs::GB18030.decode(bytes).0.into_owned(),
        },
    }
}

/// 按指定编码将 UTF-8 字符串编码为 SFTP wire 字节。
pub fn encode_str_with_encoding(s: &str, encoding: SftpFilenameEncoding) -> Vec<u8> {
    match encoding {
        SftpFilenameEncoding::Utf8 | SftpFilenameEncoding::Auto => s.as_bytes().to_vec(),
        SftpFilenameEncoding::Gbk => encoding_rs::GBK.encode(s).0.into_owned(),
        SftpFilenameEncoding::Gb18030 => encoding_rs::GB18030.encode(s).0.into_owned(),
    }
}

/// 记录一条「展示路径 -> 原始 wire 字节」映射（仅在包含非 ASCII 或与 UTF-8 字节不同时缓存）。
pub fn record_raw_path(server_id: &str, display_path: &str, raw_bytes: Vec<u8>) {
    let normalized = normalize_display_path(display_path);
    if normalized.is_empty() {
        return;
    }
    if normalized.is_ascii() && raw_bytes == normalized.as_bytes() {
        return;
    }
    if let Ok(mut cache) = SFTP_RAW_PATH_CACHE.write() {
        let server_map = cache.entry(server_id.to_string()).or_default();
        if !server_map.contains_key(&normalized)
            && server_map.len() >= MAX_RAW_PATH_CACHE_ENTRIES_PER_SERVER
        {
            // 达到上限时清理半数陈旧条目，保证长时间全盘遍历的内存上界
            let drop_count = server_map.len() / 2;
            let keys_to_drop: Vec<String> = server_map.keys().take(drop_count).cloned().collect();
            for k in keys_to_drop {
                server_map.remove(&k);
            }
        }
        server_map.insert(normalized, raw_bytes);
    }
}

/// 根据缓存映射及配置的字符集，将前端展示路径编码为 SFTP wire 字节。
///
/// 解析顺序：
/// 1. 精确命中 `SFTP_RAW_PATH_CACHE`（即使在 `auto` 混合编码目录或存在罕见字符时也能无损还原）；
/// 2. 匹配最长已缓存祖先目录的原始字节，再对新增后缀按配置（或 `auto` 下沿用父目录特征）编码；
/// 3. 回退到配置的字符集直接编码。
pub fn lookup_encoded_path(
    server_id: &str,
    path: &str,
    encoding: SftpFilenameEncoding,
) -> Vec<u8> {
    let normalized = normalize_display_path(path);

    if let Ok(cache) = SFTP_RAW_PATH_CACHE.read() {
        if let Some(server_map) = cache.get(server_id) {
            if let Some(exact) = server_map.get(&normalized) {
                return exact.clone();
            }

            let mut scan = normalized.as_str();
            while let Some(slash_idx) = scan.rfind('/') {
                let prefix = if slash_idx == 0 {
                    "/"
                } else if slash_idx == 2 && scan.as_bytes().get(1) == Some(&b':') {
                    &normalized[..3]
                } else {
                    &normalized[..slash_idx]
                };

                if let Some(prefix_raw) = server_map.get(prefix) {
                    let rel_suffix = normalized[prefix.len()..].trim_start_matches('/');
                    let suffix_encoding = match encoding {
                        SftpFilenameEncoding::Auto => {
                            if std::str::from_utf8(prefix_raw).is_err() {
                                SftpFilenameEncoding::Gb18030
                            } else {
                                SftpFilenameEncoding::Utf8
                            }
                        }
                        other => other,
                    };
                    let encoded_suffix = encode_str_with_encoding(rel_suffix, suffix_encoding);
                    return join_raw_path(prefix_raw, &encoded_suffix);
                }

                if slash_idx == 0 || (slash_idx == 2 && scan.as_bytes().get(1) == Some(&b':')) {
                    break;
                }
                scan = &normalized[..slash_idx];
            }
        }
    }

    encode_str_with_encoding(&normalized, encoding)
}

/// 解析服务器配置的 SFTP 文件名字符集（带内存缓存，断线/修改配置时失效）。
pub async fn resolve_sftp_filename_encoding(server_id: &str) -> SftpFilenameEncoding {
    if let Ok(cache) = SFTP_ENCODING_CACHE.read() {
        if let Some(&enc) = cache.get(server_id) {
            return enc;
        }
    }

    let enc = match crate::commands::ssh::load_server_config(server_id).await {
        Ok(server) => server
            .file_transfer_config
            .as_deref()
            .and_then(crate::ftp::parse_file_transfer_config)
            .map(|cfg| SftpFilenameEncoding::from_config_str(&cfg.encoding))
            .unwrap_or_default(),
        Err(_) => SftpFilenameEncoding::default(),
    };

    if let Ok(mut cache) = SFTP_ENCODING_CACHE.write() {
        cache.insert(server_id.to_string(), enc);
    }
    tracing::info!(
        "[SFTP] server={} resolved filename_encoding={:?}",
        server_id,
        enc
    );
    enc
}

/// 异步解析服务器编码并将展示路径转换为 SFTP 线缆原始字节。
pub async fn encode_sftp_path(server_id: &str, path: &str) -> Vec<u8> {
    let encoding = resolve_sftp_filename_encoding(server_id).await;
    lookup_encoded_path(server_id, path, encoding)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_gbk_gb18030_and_auto_mixed_entries() {
        // "中文测试.txt" encoded in GBK
        let gbk_bytes = b"\xd6\xd0\xce\xc4\xb2\xe2\xca\xd4.txt";
        assert_eq!(decode_sftp_bytes(gbk_bytes, SftpFilenameEncoding::Gbk), "中文测试.txt");
        assert_eq!(
            decode_sftp_bytes(gbk_bytes, SftpFilenameEncoding::Gb18030),
            "中文测试.txt"
        );
        assert_eq!(decode_sftp_bytes(gbk_bytes, SftpFilenameEncoding::Auto), "中文测试.txt");
        assert!(decode_sftp_bytes(gbk_bytes, SftpFilenameEncoding::Utf8).contains('\u{FFFD}'));

        let utf8_bytes = "正常目录".as_bytes();
        assert_eq!(decode_sftp_bytes(utf8_bytes, SftpFilenameEncoding::Auto), "正常目录");
    }

    #[test]
    fn lookup_uses_cached_exact_and_parent_prefix_raw_bytes() {
        let srv = "__test_sftp_encoding_prefix__";
        invalidate_server_sftp_caches(srv);

        // Simulate listing a GBK directory "/文档" under "/"
        let gbk_dir_raw = b"/\xce\xc4\xb5\xb5".to_vec();
        record_raw_path(srv, "/文档", gbk_dir_raw.clone());

        assert_eq!(
            lookup_encoded_path(srv, "/文档", SftpFilenameEncoding::Auto),
            gbk_dir_raw
        );

        // Creating a new Chinese file inside the cached GBK parent in Auto mode
        // inherits GB18030 for the new suffix while keeping exact parent wire bytes.
        let nested = lookup_encoded_path(srv, "/文档/新建.txt", SftpFilenameEncoding::Auto);
        let mut expected = gbk_dir_raw.clone();
        expected.push(b'/');
        expected.extend_from_slice(&encoding_rs::GB18030.encode("新建.txt").0);
        assert_eq!(nested, expected);

        invalidate_cached_path(srv, "/文档");
        // After invalidation, Auto falls back to UTF-8 for uncached paths.
        assert_eq!(
            lookup_encoded_path(srv, "/文档", SftpFilenameEncoding::Auto),
            "/文档".as_bytes()
        );
        invalidate_server_sftp_caches(srv);
    }

    #[test]
    fn normalizes_and_joins_posix_and_windows_drive_paths() {
        assert_eq!(normalize_display_path("/"), "/");
        assert_eq!(normalize_display_path("/data/中文/"), "/data/中文");
        assert_eq!(normalize_display_path("C:\\中文\\目录\\"), "C:/中文/目录");
        assert_eq!(normalize_display_path("C:\\"), "C:/");
        assert_eq!(join_display_path("/", "测试"), "/测试");
        assert_eq!(join_display_path("C:/", "测试"), "C:/测试");
        assert_eq!(join_display_path("/a/b/", "c"), "/a/b/c");
    }
}
