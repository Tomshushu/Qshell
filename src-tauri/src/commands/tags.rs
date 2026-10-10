// 标签目录（独立存储，不依赖具体服务器）
//
// 标签是「可用于服务器分类的字典项」，单独建表持久化，
// 因而空标签（尚未挂到任何服务器）也能在筛选下拉与编辑表单中常驻出现。
// 重命名 / 删除会级联到 servers.tags，保证筛选与显示一致。

use rusqlite::params;
use serde::Serialize;
use uuid::Uuid;

/// 标签目录行
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRow {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

/// 解析 servers.tags 列（JSON 字符串）为数组
fn parse_tags_json(tags_json: &str) -> Vec<String> {
    serde_json::from_str(tags_json).unwrap_or_default()
}

/// 列出全部标签（按名称升序）
#[tauri::command]
pub async fn tags_list() -> Result<Vec<TagRow>, String> {
    tokio::task::spawn_blocking(|| {
        let conn = crate::db::get_conn()?;
        let mut stmt = conn
            .prepare("SELECT id, name, created_at FROM tags ORDER BY name ASC")
            .map_err(|e| format!("Failed to prepare tags_list: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TagRow {
                    id: row.get("id")?,
                    name: row.get("name")?,
                    created_at: row.get("created_at")?,
                })
            })
            .map_err(|e| format!("Failed to query tags: {}", e))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| format!("Failed to read tag row: {}", e))?);
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// 新建标签（空标签也允许，仅写入目录）
#[tauri::command]
pub async fn tags_create(name: String) -> Result<TagRow, String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("标签名不能为空".to_string());
    }
    if trimmed.len() > 32 {
        return Err("标签名过长（最多 32 个字符）".to_string());
    }
    tokio::task::spawn_blocking(move || {
        let conn = crate::db::get_conn()?;
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM tags WHERE lower(name) = lower(?1) LIMIT 1",
                params![trimmed],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if exists {
            return Err(format!("标签「{}」已存在", trimmed));
        }
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
            params![id, trimmed, now],
        )
        .map_err(|e| format!("Failed to insert tag: {}", e))?;
        Ok(TagRow {
            id,
            name: trimmed,
            created_at: now,
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// 重命名标签：同步更新目录项与所有服务器上的该标签
#[tauri::command]
pub async fn tags_rename(old_name: String, new_name: String) -> Result<(), String> {
    let old = old_name.trim().to_string();
    let new = new_name.trim().to_string();
    if old.is_empty() || new.is_empty() {
        return Err("标签名不能为空".to_string());
    }
    if new.len() > 32 {
        return Err("标签名过长（最多 32 个字符）".to_string());
    }
    tokio::task::spawn_blocking(move || {
        let conn = crate::db::get_conn()?;
        // 冲突：已存在同名（大小写不敏感）且不是自己
        let conflict: bool = conn
            .query_row(
                "SELECT 1 FROM tags WHERE lower(name) = lower(?1) AND lower(name) <> lower(?2) LIMIT 1",
                params![new, old],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if conflict {
            return Err(format!("标签「{}」已存在", new));
        }
        // 重命名目录项（若存在）
        conn.execute(
            "UPDATE tags SET name = ?1 WHERE lower(name) = lower(?2)",
            params![new, old],
        )
        .map_err(|e| format!("Failed to rename tag catalog: {}", e))?;
        cascade_rename_tag(&conn, &old, &new)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// 删除标签：同步删除目录项与所有服务器上的该标签
#[tauri::command]
pub async fn tags_delete(name: String) -> Result<(), String> {
    let tag = name.trim().to_string();
    if tag.is_empty() {
        return Err("标签名不能为空".to_string());
    }
    tokio::task::spawn_blocking(move || {
        let conn = crate::db::get_conn()?;
        conn.execute(
            "DELETE FROM tags WHERE lower(name) = lower(?1)",
            params![tag],
        )
        .map_err(|e| format!("Failed to delete tag catalog: {}", e))?;
        cascade_delete_tag(&conn, &tag)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

/// 级联：把所有服务器上的 old 标签改为 new（大小写不敏感）
fn cascade_rename_tag(conn: &rusqlite::Connection, old: &str, new: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT id, tags FROM servers")
        .map_err(|e| format!("Failed to prepare cascade rename: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>("id")?, row.get::<_, String>("tags")?))
        })
        .map_err(|e| format!("Failed to query servers for rename: {}", e))?;
    let mut updates: Vec<(String, String)> = Vec::new();
    for r in rows {
        let (id, tags_json) = r.map_err(|e| format!("Failed to read server row: {}", e))?;
        let tags = parse_tags_json(&tags_json);
        if tags.iter().any(|t| t.eq_ignore_ascii_case(old)) {
            let next: Vec<String> = tags
                .into_iter()
                .map(|t| if t.eq_ignore_ascii_case(old) { new.to_string() } else { t })
                .collect();
            updates.push((id, serde_json::to_string(&next).unwrap_or_else(|_| "[]".to_string())));
        }
    }
    for (id, tags_json) in updates {
        conn.execute(
            "UPDATE servers SET tags = ?1 WHERE id = ?2",
            params![tags_json, id],
        )
        .map_err(|e| format!("Failed to update server tags: {}", e))?;
    }
    Ok(())
}

/// 级联：从所有服务器上移除指定标签（大小写不敏感）
fn cascade_delete_tag(conn: &rusqlite::Connection, tag: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT id, tags FROM servers")
        .map_err(|e| format!("Failed to prepare cascade delete: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>("id")?, row.get::<_, String>("tags")?))
        })
        .map_err(|e| format!("Failed to query servers for delete: {}", e))?;
    let mut updates: Vec<(String, String)> = Vec::new();
    for r in rows {
        let (id, tags_json) = r.map_err(|e| format!("Failed to read server row: {}", e))?;
        let tags = parse_tags_json(&tags_json);
        if tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
            let next: Vec<String> = tags
                .into_iter()
                .filter(|t| !t.eq_ignore_ascii_case(tag))
                .collect();
            updates.push((id, serde_json::to_string(&next).unwrap_or_else(|_| "[]".to_string())));
        }
    }
    for (id, tags_json) in updates {
        conn.execute(
            "UPDATE servers SET tags = ?1 WHERE id = ?2",
            params![tags_json, id],
        )
        .map_err(|e| format!("Failed to update server tags: {}", e))?;
    }
    Ok(())
}
