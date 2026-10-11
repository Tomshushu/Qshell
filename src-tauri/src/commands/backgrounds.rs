// 终端自定义背景图片与视频文件云端同步 commands

use std::fs;
use std::path::PathBuf;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncBackgroundItem {
    pub name: String,
    pub media_type: String, // "image" or "video"
    pub data_base64: String,
}

const MAX_SINGLE_MEDIA_BYTES: u64 = 15 * 1024 * 1024; // 单个文件上限 15MB
const MAX_TOTAL_MEDIA_BYTES: usize = 50 * 1024 * 1024; // 累计媒体上限 50MB

fn get_backgrounds_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {}", e))?
        .join("backgrounds");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create backgrounds dir: {}", e))?;
    }
    Ok(dir)
}

/// 列出所有自定义终端背景图片和视频并编码为 Base64（供端到端零知识云同步）
#[tauri::command]
pub async fn backgrounds_list_for_sync(app: AppHandle) -> Result<Vec<SyncBackgroundItem>, String> {
    tokio::task::spawn_blocking(move || {
        let dir = get_backgrounds_dir(&app)?;
        let mut items = Vec::new();
        let mut total_bytes = 0usize;

        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => return Ok(items),
        };

        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.len() > MAX_SINGLE_MEDIA_BYTES {
                continue;
            }
            if total_bytes + (meta.len() as usize) > MAX_TOTAL_MEDIA_BYTES {
                break;
            }

            let file_name = match path.file_name().and_then(|n| n.to_str()) {
                Some(name) => name.to_string(),
                None => continue,
            };

            let lower = file_name.to_lowercase();
            let is_video = [".mp4", ".webm", ".ogv", ".mov"].iter().any(|ext| lower.ends_with(ext));
            let is_image = [
                ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg",
                ".avif", ".ico", ".tif", ".tiff", ".heic", ".heif",
            ].iter().any(|ext| lower.ends_with(ext));

            if !is_video && !is_image {
                continue;
            }

            let data = match fs::read(&path) {
                Ok(d) => d,
                Err(_) => continue,
            };
            total_bytes += data.len();

            let b64 = BASE64.encode(&data);
            items.push(SyncBackgroundItem {
                name: file_name,
                media_type: if is_video { "video".to_string() } else { "image".to_string() },
                data_base64: b64,
            });
        }

        Ok(items)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// 批量还原背景图片与视频文件至本地 appDataDir/backgrounds/
#[tauri::command]
pub async fn backgrounds_restore(
    app: AppHandle,
    items: Vec<SyncBackgroundItem>,
) -> Result<usize, String> {
    tokio::task::spawn_blocking(move || {
        let dir = get_backgrounds_dir(&app)?;
        let mut restored = 0usize;

        for item in items {
            let file_name = PathBuf::from(&item.name)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if file_name.is_empty() || file_name.starts_with('.') {
                continue;
            }

            // 安全防御：严格限制仅允许图片与视频后缀，防止任意文件写入 (CWE-434)
            let lower = file_name.to_lowercase();
            let is_video = [".mp4", ".webm", ".ogv", ".mov"].iter().any(|ext| lower.ends_with(ext));
            let is_image = [
                ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg",
                ".avif", ".ico", ".tif", ".tiff", ".heic", ".heif",
            ].iter().any(|ext| lower.ends_with(ext));

            if !is_video && !is_image {
                continue;
            }

            let target_path = dir.join(&file_name);
            if let Ok(bytes) = BASE64.decode(item.data_base64.trim()) {
                // 单文件大小不超过上限
                if bytes.len() > MAX_SINGLE_MEDIA_BYTES as usize {
                    continue;
                }
                if fs::write(&target_path, bytes).is_ok() {
                    restored += 1;
                }
            }
        }

        Ok(restored)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}
