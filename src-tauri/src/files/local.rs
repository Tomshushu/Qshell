use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct QuickAccessEntry {
    name: String,
    #[serde(rename = "type")]
    entry_type: String,
    path: String,
    platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalFileEntry {
    name: String,
    path: String,
    is_directory: bool,
    size: u64,
    modified: String,
}

/// Get system root directories.
/// On Windows: returns existing drive letters (A:\ through Z:\).
/// On Unix: returns home directory, /, /Users, /home (if they exist).
pub fn get_system_roots() -> Result<Vec<String>, String> {
    let mut roots = Vec::new();

    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Storage::FileSystem::GetLogicalDrives;
        let drives_bitmask = unsafe { GetLogicalDrives() };
        for i in 0u8..26 {
            if (drives_bitmask & (1 << i)) != 0 {
                let drive = format!("{}:\\", (b'A' + i) as char);
                roots.push(drive);
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Unix: return common root directories
        let candidates = if let Some(home) = dirs::home_dir() {
            vec![
                home.to_string_lossy().to_string(),
                "/".to_string(),
                "/Users".to_string(),
                "/home".to_string(),
            ]
        } else {
            vec![
                "/".to_string(),
                "/Users".to_string(),
                "/home".to_string(),
            ]
        };

        for p in candidates {
            if Path::new(&p).exists() {
                roots.push(p);
            }
        }
    }

    Ok(roots)
}

/// Get quick access directories (Desktop, Downloads, Documents, etc.).
/// Returns a JSON array of quick access entries with name, type, path, and platform.
pub fn get_quick_access() -> Result<String, String> {
    let home_dir = match dirs::home_dir() {
        Some(h) => h,
        None => return Ok("[]".to_string()),
    };

    let home_str = home_dir.to_string_lossy().to_string();
    let platform = if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    };

    let mut quick_access: Vec<QuickAccessEntry> = Vec::new();

    let locations: Vec<(&str, &str, String)> = if cfg!(windows) {
        vec![
            ("桌面", "desktop", home_dir.join("Desktop").to_string_lossy().to_string()),
            ("下载", "downloads", home_dir.join("Downloads").to_string_lossy().to_string()),
            ("文档", "documents", home_dir.join("Documents").to_string_lossy().to_string()),
            ("图片", "pictures", home_dir.join("Pictures").to_string_lossy().to_string()),
            ("音乐", "music", home_dir.join("Music").to_string_lossy().to_string()),
            ("视频", "videos", home_dir.join("Videos").to_string_lossy().to_string()),
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            ("桌面", "desktop", home_dir.join("Desktop").to_string_lossy().to_string()),
            ("下载", "downloads", home_dir.join("Downloads").to_string_lossy().to_string()),
            ("文稿", "documents", home_dir.join("Documents").to_string_lossy().to_string()),
            ("图片", "pictures", home_dir.join("Pictures").to_string_lossy().to_string()),
            ("音乐", "music", home_dir.join("Music").to_string_lossy().to_string()),
            ("影片", "videos", home_dir.join("Movies").to_string_lossy().to_string()),
            ("主目录", "home", home_str.clone()),
        ]
    } else {
        vec![
            ("主目录", "home", home_str.clone()),
            ("桌面", "desktop", home_dir.join("Desktop").to_string_lossy().to_string()),
            ("下载", "downloads", home_dir.join("Downloads").to_string_lossy().to_string()),
            ("文档", "documents", home_dir.join("Documents").to_string_lossy().to_string()),
            ("图片", "pictures", home_dir.join("Pictures").to_string_lossy().to_string()),
            ("音乐", "music", home_dir.join("Music").to_string_lossy().to_string()),
            ("视频", "videos", home_dir.join("Videos").to_string_lossy().to_string()),
        ]
    };

    for (name, entry_type, path) in locations {
        if Path::new(&path).exists() {
            quick_access.push(QuickAccessEntry {
                name: name.to_string(),
                entry_type: entry_type.to_string(),
                path,
                platform: platform.to_string(),
            });
        }
    }

    serde_json::to_string(&quick_access)
        .map_err(|e| format!("Failed to serialize quick access: {}", e))
}

/// List contents of a local directory.
/// Returns a JSON object with `success`, `files` array, and optionally `error`.
/// Each file entry has: name, path, isDirectory, size, modified.
/// Sorted: directories first, then by name.
pub fn list_local_directory(path: String) -> Result<String, String> {
    let dir_path = Path::new(&path);

    let read_dir = match fs::read_dir(dir_path) {
        Ok(rd) => rd,
        Err(e) => {
            let result = serde_json::json!({
                "success": false,
                "error": e.to_string(),
                "files": []
            });
            return serde_json::to_string(&result)
                .map_err(|err| format!("Serialization error: {}", err));
        }
    };

    let mut files: Vec<LocalFileEntry> = Vec::new();

    for entry in read_dir {
        match entry {
            Ok(entry) => {
                let file_name = entry.file_name().to_string_lossy().to_string();
                let full_path = entry.path().to_string_lossy().to_string();

                match entry.metadata() {
                    Ok(metadata) => {
                        let modified = metadata
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| {
                                let secs = d.as_secs();
                                let dt = chrono::DateTime::from_timestamp(secs as i64, 0)
                                    .unwrap_or_default();
                                let local_dt = chrono::DateTime::<chrono::Local>::from(dt);
                                local_dt.format("%Y-%m-%d %H:%M:%S").to_string()
                            })
                            .unwrap_or_default();

                        files.push(LocalFileEntry {
                            name: file_name,
                            path: full_path,
                            is_directory: metadata.is_dir(),
                            size: metadata.len(),
                            modified,
                        });
                    }
                    Err(_) => continue,
                }
            }
            Err(_) => continue,
        }
    }

    // Sort: directories first, then by name (case-insensitive)
    files.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            if a.is_directory {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    let result = serde_json::json!({
        "success": true,
        "files": files
    });

    serde_json::to_string(&result)
        .map_err(|e| format!("Serialization error: {}", e))
}
