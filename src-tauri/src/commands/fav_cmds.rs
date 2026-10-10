// 收藏指令 commands
//
// 对应 Electron 版 ipc.js 中的:
//   fav-cmds:list / fav-cmds:add / fav-cmds:update / fav-cmds:delete
//
// 数据存储在 app_data_dir/favorite-commands.json 文件中

use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use super::OperationResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteCommand {
    pub id: String,
    pub cmd: String,
    pub desc: String,
    pub created_at: i64,
}

/// 获取 favorite-commands.json 文件路径
fn fav_cmds_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app_data_dir: {}", e))?;
    std::fs::create_dir_all(&dir).ok();
    Ok(dir.join("favorite-commands.json"))
}

/// 读取所有收藏指令
fn read_fav_cmds(app: &AppHandle) -> Vec<FavoriteCommand> {
    let path = match fav_cmds_path(app) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    if !path.exists() {
        return Vec::new();
    }
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// 写入所有收藏指令
fn write_fav_cmds(app: &AppHandle, cmds: &[FavoriteCommand]) -> Result<(), String> {
    let path = fav_cmds_path(app)?;
    let json = serde_json::to_string_pretty(cmds)
        .map_err(|e| format!("Failed to serialize: {}", e))?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write file: {}", e))
}

/// 列出所有收藏指令
#[tauri::command]
pub async fn fav_cmds_list(app: AppHandle) -> Result<Vec<FavoriteCommand>, String> {
    Ok(read_fav_cmds(&app))
}

/// 新增收藏指令
#[tauri::command]
pub async fn fav_cmds_add(
    app: AppHandle,
    cmd: String,
    desc: String,
) -> Result<OperationResult, String> {
    let mut cmds = read_fav_cmds(&app);
    let id = format!(
        "fav-{}-{}",
        chrono::Utc::now().timestamp_millis(),
        &uuid::Uuid::new_v4().to_string()[..4]
    );
    cmds.push(FavoriteCommand {
        id: id.clone(),
        cmd,
        desc,
        created_at: chrono::Utc::now().timestamp_millis(),
    });
    write_fav_cmds(&app, &cmds)?;
    Ok(OperationResult::ok_with_id(id))
}

/// 更新收藏指令
#[tauri::command]
pub async fn fav_cmds_update(
    app: AppHandle,
    id: String,
    cmd: String,
    desc: String,
) -> Result<OperationResult, String> {
    let mut cmds = read_fav_cmds(&app);
    let idx = cmds.iter().position(|c| c.id == id);
    match idx {
        Some(i) => {
            cmds[i].cmd = cmd;
            cmds[i].desc = desc;
            write_fav_cmds(&app, &cmds)?;
            Ok(OperationResult::ok())
        }
        None => Ok(OperationResult::fail("Not found")),
    }
}

/// 删除收藏指令
#[tauri::command]
pub async fn fav_cmds_delete(app: AppHandle, id: String) -> Result<OperationResult, String> {
    let mut cmds = read_fav_cmds(&app);
    cmds.retain(|c| c.id != id);
    write_fav_cmds(&app, &cmds)?;
    Ok(OperationResult::ok())
}
