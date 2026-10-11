use rusqlite::{params, Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::sync::{LazyLock, Mutex, OnceLock};
use uuid::Uuid;
use chrono::Utc;

use crate::crypto;

const PASSWORD_PLACEHOLDER: &str = "\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}"; // "•••••"

/// 顶级分组「主机」的固定 ID；所有未分组服务器及新建分组默认归属它，形成单一树根。
const HOST_GROUP_ID: &str = "host";
/// 顶级分组「主机」的默认名称。
const HOST_GROUP_NAME: &str = "主机";

// ============================================================================
// 自定义反序列化
// ============================================================================

/// tags 字段自定义反序列化。
///
/// 前端发送的 tags 是数组（如 `["tag1","tag2"]`），但数据库存储为 JSON 字符串。
/// Electron 版在 ipc.js 中通过 `JSON.stringify(server.tags || [])` 转换，
/// Tauri 版在反序列化边界统一处理：接受 String 或 Array，均转为 String。
fn deserialize_tags<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match value {
        None => Ok(None),
        Some(serde_json::Value::String(s)) => Ok(Some(s)),
        Some(other) => Ok(Some(other.to_string())),
    }
}

/// serde 默认值：连接目标类型，缺省时回退为 linux（兼容旧数据）。
fn default_target_type() -> String {
    "linux".to_string()
}

/// serde 默认值：连接协议，缺省时回退为 ssh（兼容旧数据）。
fn default_protocol() -> String {
    "ssh".to_string()
}

/// serde 默认值：SSH 认证方式，缺省时回退为 password。
fn default_auth_type() -> Option<String> {
    Some("password".to_string())
}

/// serde 默认值：空 JSON 数组字符串。
fn default_empty_array() -> String {
    "[]".to_string()
}

/// serde 默认值：启用的协议列表，缺省时回退为 ["ssh"]（兼容旧数据）。
fn default_protocols() -> String {
    "[\"ssh\"]".to_string()
}

/// serde 默认值：RDP 端口，缺省时回退为 3389。
fn default_rdp_port() -> i32 {
    3389
}

/// serde 默认值：BMC Redfish HTTPS 端口，缺省时回退为 443。
fn default_bmc_port() -> i32 {
    443
}

/// BMC TLS 校验默认开启；自签名设备必须由用户显式选择允许不受信任证书。
fn default_bmc_allow_invalid_certs() -> bool {
    false
}

// ============================================================================
// Data structures
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i32,
    pub username: String,
    pub auth_type: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    /// SSH Agent 认证：指定 agent 中的具体身份（OpenSSH 公钥字符串 `ssh-ed25519 AAAA...`）。
    /// 为 None 时使用 agent 中的第一个身份。
    #[serde(default)]
    pub agent_identity: Option<String>,
    /// OpenSSH 证书认证：证书文件路径（`*-cert.pub`）。
    /// 配合 `private_key_path`（私钥）+ `private_key_passphrase`（如加密）使用。
    #[serde(default)]
    pub certificate_path: Option<String>,
    /// 关联的 SSH 密钥 ID（指向 `ssh_keys` 表 `id`）。
    /// 阶段 3 content-based 连接：设置后，`ssh_connect` 优先通过此 id 调用
    /// `ssh_keys_get_raw` 加载解密后的私钥/证书内容 + passphrase 进行连接，
    /// 不再依赖 `private_key_path` / `private_key_passphrase` / `certificate_path` 字段。
    /// 为 None 时回退到旧的路径模式（兼容已有数据）。
    #[serde(default)]
    pub ssh_key_id: Option<String>,
    pub tags: String,
    pub notes: Option<String>,
    pub connection_timeout: i32,
    pub favorite: bool,
    pub status: String,
    pub last_accessed_at: Option<i64>,
    pub os_type: Option<String>,
    pub os_info: Option<String>,
    /// 最后一次断开连接的时间（运行时状态由 SshManager 维护，DB 仅记录历史）
    pub last_disconnected_at: Option<i64>,
    /// 最后一次错误信息（如认证失败/网络不可达），便于用户排查
    pub last_error: Option<String>,
    /// 连接目标类型（linux/windows/network/unix/bmc/xinchuang），默认 linux
    #[serde(default = "default_target_type")]
    pub target_type: String,
    /// 连接协议（ssh/winrm/telnet/vnc），默认 ssh
    #[serde(default = "default_protocol")]
    pub protocol: String,
    /// 用户启用的协议列表（JSON 数组字符串，如 `["ssh","rdp"]`），默认 ["ssh"]
    /// 用于工作区按协议显示对应标签页（SSH→终端/SFTP，RDP→远程桌面）
    #[serde(default = "default_protocols")]
    pub protocols: String,
    /// RDP 端口，默认 3389
    #[serde(default = "default_rdp_port")]
    pub rdp_port: i32,
    /// BMC Redfish HTTPS 端口，默认 443
    #[serde(default = "default_bmc_port")]
    pub bmc_port: i32,
    /// 是否允许 BMC 使用自签名/无效 TLS 证书，默认关闭。
    #[serde(default = "default_bmc_allow_invalid_certs")]
    pub bmc_allow_invalid_certs: bool,
    /// 遗留的代理 ID 列表字段。为兼容旧数据库保留，但连接流程不再读取。
    #[serde(default = "default_empty_array")]
    pub proxy_ids: String,
    /// 遗留的默认代理 ID 字段。为兼容旧数据库保留，但连接流程不再读取。
    #[serde(default)]
    pub default_proxy_id: Option<String>,
    /// 遗留的隧道 ID 列表字段。为兼容旧数据库保留，但连接流程不再读取。
    #[serde(default = "default_empty_array")]
    pub tunnel_ids: String,
    /// 内联代理配置（JSON 字符串，加密存储于 DB）。FinalShell 模式：代理随服务器内联配置。
    /// 形如 `{"type":"ssh_jump","host":"...","port":22,...}`，type=none 表示直连。
    /// 为空/缺失时表示直连，不再回退到独立代理资源。
    #[serde(default)]
    pub proxy_config: Option<String>,
    /// 内联隧道（端口转发）配置（JSON 数组字符串，明文存储）。
    /// 形如 `[{"type":"local","bindAddress":"127.0.0.1","bindPort":8080,"targetHost":"localhost","targetPort":80}]`。
    /// 连接成功后自动启动。为空/缺失时不启动隧道。
    #[serde(default)]
    pub tunnels_config: Option<String>,
    #[serde(default)]
    pub keys_config: Option<String>,
    #[serde(default)]
    pub serial_config: Option<String>,
    /// 所属服务器分组 ID（指向 server_groups 表 id），NULL 表示未分组
    #[serde(default)]
    pub group_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    /// 回收站删除时间（毫秒时间戳）；NULL 表示正常，非 NULL 表示待删除
    #[serde(default)]
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: Option<i32>,
    pub username: String,
    pub auth_type: Option<String>,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    #[serde(default)]
    pub agent_identity: Option<String>,
    #[serde(default)]
    pub certificate_path: Option<String>,
    /// 关联的 SSH 密钥 ID（指向 `ssh_keys` 表）。None 时回退路径模式。
    #[serde(default)]
    pub ssh_key_id: Option<String>,
    #[serde(deserialize_with = "deserialize_tags", default)]
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub connection_timeout: Option<i32>,
    pub favorite: Option<bool>,
    pub status: Option<String>,
    pub os_type: Option<String>,
    pub os_info: Option<String>,
    /// 连接目标类型，缺省 linux（None 时由 servers_add 回退）
    pub target_type: Option<String>,
    /// 连接协议，缺省 ssh（None 时由 servers_add 回退）
    pub protocol: Option<String>,
    /// 用户启用的协议列表（JSON 数组字符串），缺省 ["ssh"]
    #[serde(deserialize_with = "deserialize_tags", default)]
    pub protocols: Option<String>,
    pub rdp_port: Option<i32>,
    pub bmc_port: Option<i32>,
    #[serde(default)]
    pub bmc_allow_invalid_certs: Option<bool>,
    /// 关联的代理 ID 列表（JSON 数组字符串）
    #[serde(default)]
    pub proxy_ids: Option<String>,
    /// 默认代理 ID
    #[serde(default)]
    pub default_proxy_id: Option<String>,
    /// 关联的隧道 ID 列表（JSON 数组字符串）
    #[serde(default)]
    pub tunnel_ids: Option<String>,
    /// 内联代理配置（JSON 字符串，加密存储）。None 表示不设置。
    #[serde(default)]
    pub proxy_config: Option<String>,
    /// 内联隧道配置（JSON 数组字符串）。None 表示不设置。
    #[serde(default)]
    pub tunnels_config: Option<String>,
    #[serde(default)]
    pub keys_config: Option<String>,
    #[serde(default)]
    pub serial_config: Option<String>,
    /// 所属分组 ID（None 表示未分组）
    #[serde(default)]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerUpdate {
    pub name: Option<String>,
    pub host: Option<String>,
    pub port: Option<i32>,
    pub username: Option<String>,
    pub auth_type: Option<String>,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    #[serde(default)]
    pub agent_identity: Option<String>,
    #[serde(default)]
    pub certificate_path: Option<String>,
    #[serde(default)]
    pub ssh_key_id: Option<String>,
    #[serde(deserialize_with = "deserialize_tags", default)]
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub connection_timeout: Option<i32>,
    pub favorite: Option<bool>,
    pub status: Option<String>,
    pub os_type: Option<String>,
    pub os_info: Option<String>,
    pub last_accessed_at: Option<i64>,
    pub last_disconnected_at: Option<i64>,
    pub last_error: Option<String>,
    pub target_type: Option<String>,
    pub protocol: Option<String>,
    #[serde(deserialize_with = "deserialize_tags", default)]
    pub protocols: Option<String>,
    pub rdp_port: Option<i32>,
    pub bmc_port: Option<i32>,
    #[serde(default)]
    pub bmc_allow_invalid_certs: Option<bool>,
    /// 关联的代理 ID 列表（JSON 数组字符串；None 表示不修改）
    #[serde(default)]
    pub proxy_ids: Option<String>,
    /// 默认代理 ID（None 表示不修改，空字符串表示清除）
    #[serde(default)]
    pub default_proxy_id: Option<String>,
    /// 关联的隧道 ID 列表（JSON 数组字符串；None 表示不修改）
    #[serde(default)]
    pub tunnel_ids: Option<String>,
    /// 内联代理配置（JSON 字符串；None 表示不修改，空字符串表示清除）
    #[serde(default)]
    pub proxy_config: Option<String>,
    /// 内联隧道配置（JSON 数组字符串；None 表示不修改）
    #[serde(default)]
    pub tunnels_config: Option<String>,
    /// 内联密钥配置（JSON 数组字符串；None 表示不修改）
    #[serde(default)]
    pub keys_config: Option<String>,
    /// 串口配置（JSON 字符串；None 表示不修改）
    #[serde(default)]
    pub serial_config: Option<String>,
    /// 所属分组 ID（None 表示不修改，空字符串表示移出到根目录）
    #[serde(default)]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogBookmark {
    pub id: String,
    pub server_id: String,
    pub path: String,
    pub alias: String,
    pub created_at: i64,
}

// ============================================================================
// Internal helpers
// ============================================================================

/// Global database path (set once during app setup).
static DB_PATH: OnceLock<String> = OnceLock::new();

/// Global master key for password encryption (set once during app setup).
///
/// 改造说明（方案 A）：
/// - 旧实现使用 `String` 类型的 encryption_key + argon2id 派生 AES key（1.3s/次）
/// - 新实现直接持有 32 字节随机 master_key（来自 OS keychain）
/// - 数据库密码用 master_key + AES-256-GCM 加密，单次 <1ms
static MASTER_KEY: OnceLock<crate::crypto::MasterKey> = OnceLock::new();

/// Set the master key global. Called once during app setup.
/// Subsequent calls are no-ops (first-set wins).
pub fn set_master_key(key: crate::crypto::MasterKey) {
    let _ = MASTER_KEY.set(key);
}

/// Get the master key as &'static reference (panics if not initialized).
pub fn master_key() -> &'static crate::crypto::MasterKey {
    MASTER_KEY
        .get()
        .expect("master key not initialized")
}

/// Get the database path as &'static str (panics if not initialized).
fn db_path() -> &'static str {
    DB_PATH
        .get()
        .expect("db path not initialized")
        .as_str()
}

/// Global connection pool: caches a single Connection per db_path.
/// For a desktop app with a single database file, one cached connection is
/// sufficient and avoids the overhead of opening a new connection on every call.
/// Access is serialized via the Mutex, which is the desired behaviour for SQLite.
static DB_CONN: LazyLock<Mutex<Option<(String, Connection)>>> =
    LazyLock::new(|| Mutex::new(None));

/// RAII guard that holds the Mutex lock and derefs to the cached `Connection`.
pub(crate) struct DbGuard<'a> {
    guard: std::sync::MutexGuard<'a, Option<(String, Connection)>>,
}

impl<'a> std::ops::Deref for DbGuard<'a> {
    type Target = Connection;
    fn deref(&self) -> &Connection {
        // SAFETY: `get_conn` guarantees the entry is `Some` before returning.
        &self.guard.as_ref().expect("db connection not initialized").1
    }
}

/// Acquire the cached connection, opening (and caching) a new one on first use.
/// Recovers from a poisoned mutex by reusing the inner data.
pub(crate) fn get_conn() -> Result<DbGuard<'static>, String> {
    let db_path = db_path();
    let mut guard = DB_CONN.lock().unwrap_or_else(|e| e.into_inner());

    let need_reopen = match guard.as_ref() {
        Some((cached_path, _)) => cached_path != db_path,
        None => true,
    };

    if need_reopen {
        let conn = Connection::open(db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;
        // foreign_keys is a per-connection pragma; set it every time we open.
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;
        *guard = Some((db_path.to_string(), conn));
    }

    Ok(DbGuard { guard })
}

fn create_tables(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER DEFAULT 22,
            username TEXT NOT NULL,
            auth_type TEXT DEFAULT 'password',
            password TEXT,
            private_key_path TEXT,
            private_key_passphrase TEXT,
            agent_identity TEXT,
            certificate_path TEXT,
            tags TEXT DEFAULT '[]',
            notes TEXT,
            connection_timeout INTEGER DEFAULT 15,
            favorite INTEGER DEFAULT 0,
            status TEXT DEFAULT 'unknown',
            last_accessed_at INTEGER,
            os_type TEXT,
            os_info TEXT,
            last_disconnected_at INTEGER,
            last_error TEXT,
            target_type TEXT DEFAULT 'linux',
            protocol TEXT DEFAULT 'ssh',
            protocols TEXT DEFAULT '[\"ssh\"]',
            rdp_port INTEGER DEFAULT 3389,
            bmc_port INTEGER DEFAULT 443,
            bmc_allow_invalid_certs INTEGER DEFAULT 0,
            proxy_ids TEXT DEFAULT '[]',
            default_proxy_id TEXT,
            proxy_config TEXT,
            tunnels_config TEXT,
            keys_config TEXT,
            serial_config TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            deleted_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS log_bookmarks (
            id TEXT PRIMARY KEY,
            server_id TEXT NOT NULL,
            path TEXT NOT NULL,
            alias TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS known_hosts (
            host TEXT NOT NULL,
            port INTEGER NOT NULL,
            key_type TEXT NOT NULL,
            key_value TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (host, port, key_type)
        );

        CREATE TABLE IF NOT EXISTS audit_logs (
            id TEXT PRIMARY KEY,
            timestamp INTEGER NOT NULL,
            log_type TEXT NOT NULL,
            server_name TEXT,
            event TEXT NOT NULL,
            status TEXT NOT NULL,
            details TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_audit_logs_type ON audit_logs(log_type);

        CREATE TABLE IF NOT EXISTS ssh_keys (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            key_type TEXT NOT NULL DEFAULT 'private',
            private_key_path TEXT,
            private_key_content TEXT,
            private_key_passphrase TEXT,
            public_key TEXT,
            certificate_path TEXT,
            certificate_content TEXT,
            notes TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS proxies (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            proxy_type TEXT NOT NULL DEFAULT 'ssh_jump',
            host TEXT NOT NULL,
            port INTEGER NOT NULL DEFAULT 22,
            username TEXT,
            auth_type TEXT DEFAULT 'password',
            password TEXT,
            private_key_path TEXT,
            private_key_passphrase TEXT,
            agent_identity TEXT,
            certificate_path TEXT,
            ssh_key_id TEXT,
            proxy_username TEXT,
            proxy_password TEXT,
            notes TEXT,
            connection_timeout INTEGER DEFAULT 30,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tunnels (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            tunnel_type TEXT NOT NULL DEFAULT 'local',
            bind_address TEXT NOT NULL DEFAULT '127.0.0.1',
            local_port INTEGER NOT NULL,
            remote_host TEXT,
            remote_port INTEGER,
            notes TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS server_groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_server_groups_parent ON server_groups(parent_id);

        CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS compose_projects (
            id TEXT PRIMARY KEY,
            server_id TEXT NOT NULL,
            name TEXT NOT NULL,
            project_dir TEXT NOT NULL,
            config_file TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_compose_projects_server ON compose_projects(server_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_compose_projects_unique
            ON compose_projects(server_id, project_dir, config_file);

        CREATE TABLE IF NOT EXISTS network_runs (
            id TEXT PRIMARY KEY,
            server_id TEXT NOT NULL,
            spec_json TEXT NOT NULL,
            spec_fingerprint TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            finished_at INTEGER,
            steps_json TEXT NOT NULL DEFAULT '[]',
            verdict_json TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_net_runs_server_time ON network_runs(server_id, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_net_runs_fp ON network_runs(server_id, spec_fingerprint);
        "
    )?;
    // 兼容旧版本数据库：如果表已存在但缺少新列，则补齐
    migrate_servers_table(conn);
    migrate_ssh_keys_table(conn);
    migrate_proxies_table(conn);
    migrate_server_groups_table(conn);
    ensure_host_group(conn)?;
    // servers.group_id 的索引必须在迁移补列之后再建：
    // 老库 servers 表已存在时 CREATE TABLE IF NOT EXISTS 不会新增列，
    // 先建索引会因列不存在而失败（panic: no such column: group_id）。
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_servers_group_id ON servers(group_id)",
        [],
    )?;
    Ok(())
}

// ==================== Compose 项目注册表 ====================
//
// 背景：`docker compose ls` 靠扫描容器的 com.docker.compose.project 标签聚合项目，
// 执行 down 后容器被删除，项目会从列表里彻底消失（连 `ls --all` 也列不出，
// 因为 --all 只覆盖"容器存在但已停止"，不含"容器已删除"）。
// 行业做法（Dockge/Portainer）是自建项目注册表：把"项目"与"容器状态"解耦——
// 项目是持久的部署单元，容器只是它当前的运行状态。列表 = 注册表 ∪ 实时状态。

/// 登记/更新一个已知 Compose 项目（幂等，按 server_id + dir + config_file 去重）
pub fn upsert_compose_project(
    server_id: &str,
    name: &str,
    project_dir: &str,
    config_file: &str,
) -> Result<(), String> {
    if server_id.is_empty() || project_dir.is_empty() {
        return Ok(());
    }
    let conn = get_conn()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    // 先查是否已存在同 (server_id, project_dir, config_file) 的记录
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM compose_projects
             WHERE server_id = ?1 AND project_dir = ?2 AND config_file = ?3",
            rusqlite::params![server_id, project_dir, config_file],
            |row| row.get(0),
        )
        .ok();
    match existing {
        Some(id) => {
            conn.execute(
                "UPDATE compose_projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![name, now, id],
            )
            .map_err(|e| format!("Failed to update compose project: {}", e))?;
        }
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO compose_projects
                 (id, server_id, name, project_dir, config_file, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![id, server_id, name, project_dir, config_file, now, now],
            )
            .map_err(|e| format!("Failed to insert compose project: {}", e))?;
        }
    }
    Ok(())
}

/// 列出某服务器已登记的 Compose 项目
pub fn list_compose_projects(
    server_id: &str,
) -> Result<Vec<(String, String, String)>, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT name, project_dir, config_file FROM compose_projects
             WHERE server_id = ?1 ORDER BY name",
        )
        .map_err(|e| format!("Failed to prepare list_compose_projects: {}", e))?;
    let rows = stmt
        .query_map([server_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("Failed to query compose projects: {}", e))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("Failed to read compose project row: {}", e))?);
    }
    Ok(out)
}

/// 忘记（注销）一个已登记项目：仅从注册表移除，不触碰服务器上任何文件/容器
pub fn forget_compose_project(
    server_id: &str,
    project_dir: &str,
    config_file: &str,
) -> Result<(), String> {
    let conn = get_conn()?;
    conn.execute(
        "DELETE FROM compose_projects
         WHERE server_id = ?1 AND project_dir = ?2 AND config_file = ?3",
        rusqlite::params![server_id, project_dir, config_file],
    )
    .map_err(|e| format!("Failed to forget compose project: {}", e))?;
    Ok(())
}

/// 老库升级：补齐 servers.group_id 列（服务器分组树）。
/// 不建外键约束，删除分组时由 server_groups_delete 显式清理关联。
fn migrate_server_groups_table(conn: &Connection) {
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN group_id TEXT", []);
}

/// 确保「主机」顶级分组存在，并把老库中未分组服务器 / 其它顶级分组挂到「主机」下，形成单一树根。
fn ensure_host_group(conn: &Connection) -> SqliteResult<()> {
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM server_groups WHERE id = ?1",
            params![HOST_GROUP_ID],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let now = Utc::now().timestamp_millis();
    if exists == 0 {
        conn.execute(
            "INSERT INTO server_groups (id, name, parent_id, created_at, updated_at) VALUES (?1, ?2, NULL, ?3, ?4)",
            params![HOST_GROUP_ID, HOST_GROUP_NAME, now, now],
        )?;
    }
    // 迁移：未分组（NULL/空串/指向已删除分组）的服务器挂到「主机」
    conn.execute(
        "UPDATE servers SET group_id = ?1 WHERE group_id IS NULL OR group_id = '' OR group_id NOT IN (SELECT id FROM server_groups)",
        params![HOST_GROUP_ID],
    )?;
    // 迁移：其它顶级分组挂到「主机」下，形成单一根
    conn.execute(
        "UPDATE server_groups SET parent_id = ?1 WHERE parent_id IS NULL AND id != ?1",
        params![HOST_GROUP_ID],
    )?;
    Ok(())
}

/// 老库升级：补齐 ssh_keys 表的新列。
/// SQLite 的 ALTER TABLE ADD COLUMN 是幂等的失败（重复添加会报错），所以用 try + ignore。
fn migrate_ssh_keys_table(conn: &Connection) {
    let _ = conn.execute("ALTER TABLE ssh_keys ADD COLUMN key_type TEXT DEFAULT 'private'", []);
    let _ = conn.execute("ALTER TABLE ssh_keys ADD COLUMN private_key_content TEXT", []);
    let _ = conn.execute("ALTER TABLE ssh_keys ADD COLUMN certificate_content TEXT", []);
}

/// 老库升级：补齐 proxies 表的新列（仅旧库已建表但缺列时生效）。
fn migrate_proxies_table(conn: &Connection) {
    let _ = conn.execute("ALTER TABLE proxies ADD COLUMN proxy_type TEXT DEFAULT 'ssh_jump'", []);
    let _ = conn.execute("ALTER TABLE proxies ADD COLUMN ssh_key_id TEXT", []);
    let _ = conn.execute("ALTER TABLE proxies ADD COLUMN proxy_username TEXT", []);
    let _ = conn.execute("ALTER TABLE proxies ADD COLUMN proxy_password TEXT", []);
    let _ = conn.execute("ALTER TABLE proxies ADD COLUMN connection_timeout INTEGER DEFAULT 30", []);
}

/// 老库升级：补齐 last_disconnected_at / last_error / target_type / protocol / protocols / rdp_port 列。
/// SQLite 的 ALTER TABLE ADD COLUMN 是幂等的失败（重复添加会报错），所以用 try + ignore。
fn migrate_servers_table(conn: &Connection) {
    // rusqlite 不支持 IF NOT EXISTS for ADD COLUMN，只能 try 并忽略 duplicate column 错误
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN last_disconnected_at INTEGER", []);
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN last_error TEXT", []);
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN target_type TEXT DEFAULT 'linux'", []);
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN protocol TEXT DEFAULT 'ssh'", []);
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN protocols TEXT DEFAULT '[\"ssh\"]'", []);
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN rdp_port INTEGER DEFAULT 3389", []);
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN bmc_port INTEGER DEFAULT 443", []);
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN bmc_allow_invalid_certs INTEGER DEFAULT 0", []);
    // SSH Agent / OpenSSH 证书认证（对齐 Termius/MobaXterm/SecureCRT）
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN agent_identity TEXT", []);
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN certificate_path TEXT", []);
    // 阶段 3：服务器关联 ssh_keys 表的密钥 id（content-based 连接）
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN ssh_key_id TEXT", []);
    // P0-1 重构：跳板机改为独立 proxies 资源。servers 表存储关联的代理 ID 列表（JSON 数组）
    // 与默认使用的代理 ID。旧字段 jump_host_id 保留以兼容老数据读取，但新代码不再写入。
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN proxy_ids TEXT DEFAULT '[]'", []);
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN default_proxy_id TEXT", []);
    // 隧道（端口转发）作为独立资源，服务器可关联多个隧道，连接后自动启动
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN tunnel_ids TEXT DEFAULT '[]'", []);
    // FinalShell 模式：代理/隧道随服务器内联配置（加密/明文 JSON）
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN proxy_config TEXT", []);
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN tunnels_config TEXT", []);
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN keys_config TEXT", []);
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN serial_config TEXT", []);
    // 回收站：软删除时间戳（NULL=正常，非 NULL=待删除）
    let _ = conn.execute("ALTER TABLE servers ADD COLUMN deleted_at INTEGER", []);

    // 协议与目标类型是枚举值，统一小写，避免导入数据使用 SSH/RDP 等大写时
    // 校验通过但运行时精确字符串分支落入错误传输层。
    let _ = conn.execute(
        "UPDATE servers
         SET target_type = lower(trim(COALESCE(target_type, 'linux'))),
             protocol = lower(trim(COALESCE(protocol, 'ssh')))",
        [],
    );

    // BMC 的工作台从一开始就通过 Redfish HTTPS 访问，旧版本却把协议保存为
    // ssh/telnet/vnc，并同时保留了一个无实际用途的通用 port。启动时统一旧数据，
    // 防止编辑回显、测试连接与双击打开分别走不同协议。
    let _ = conn.execute(
        "UPDATE servers
         SET protocol = 'redfish',
             protocols = '[\"redfish\"]',
             auth_type = 'password',
             bmc_port = CASE WHEN bmc_port IS NULL OR bmc_port <= 0 THEN 443 ELSE bmc_port END,
             port = CASE
                 WHEN bmc_port IS NULL OR bmc_port <= 0 THEN 443
                 ELSE bmc_port
             END
         WHERE lower(COALESCE(target_type, '')) = 'bmc'
           AND (
               lower(COALESCE(protocol, '')) <> 'redfish'
               OR COALESCE(protocols, '') <> '[\"redfish\"]'
               OR COALESCE(auth_type, '') <> 'password'
               OR port <> CASE WHEN bmc_port IS NULL OR bmc_port <= 0 THEN 443 ELSE bmc_port END
           )",
        [],
    );

    // 早期版本曾把尚未实现的 WinRM/VNC 写入服务器记录。它们不能继续伪装成
    // 可连接协议；按目标类型迁移到当前可工作的安全默认值，并把 protocols
    // 收敛为单一主协议，确保模块列表与双击行为一致。
    let _ = conn.execute(
        "UPDATE servers
         SET protocol = 'rdp', protocols = '[\"rdp\"]', auth_type = 'password',
             rdp_port = CASE WHEN rdp_port IS NULL OR rdp_port <= 0 THEN 3389 ELSE rdp_port END,
             port = CASE WHEN rdp_port IS NULL OR rdp_port <= 0 THEN 3389 ELSE rdp_port END
         WHERE lower(COALESCE(target_type, '')) = 'windows'
           AND lower(COALESCE(protocol, '')) NOT IN ('ssh', 'rdp')",
        [],
    );
    let _ = conn.execute(
        "UPDATE servers
         SET protocol = 'ssh', protocols = '[\"ssh\"]'
         WHERE lower(COALESCE(target_type, 'linux')) IN ('linux', 'unix', 'xinchuang')
           AND lower(COALESCE(protocol, '')) <> 'ssh'",
        [],
    );
    let _ = conn.execute(
        "UPDATE servers
         SET protocol = 'ssh', protocols = '[\"ssh\"]'
         WHERE lower(COALESCE(target_type, '')) = 'network'
           AND lower(COALESCE(protocol, '')) NOT IN ('ssh', 'telnet')",
        [],
    );
    let _ = conn.execute(
        "UPDATE servers
         SET protocol = 'serial', protocols = '[\"serial\"]', auth_type = 'password'
         WHERE lower(COALESCE(target_type, '')) = 'serial'
           AND lower(COALESCE(protocol, '')) <> 'serial'",
        [],
    );
    let _ = conn.execute(
        "UPDATE servers SET protocols = '[\"' || lower(protocol) || '\"]'
         WHERE lower(COALESCE(protocol, '')) IN ('ssh', 'rdp', 'telnet', 'serial', 'redfish')
           AND COALESCE(protocols, '') <> '[\"' || lower(protocol) || '\"]'",
        [],
    );
}

fn row_to_server(row: &rusqlite::Row<'_>) -> SqliteResult<Server> {
    Ok(Server {
        id: row.get("id")?,
        name: row.get("name")?,
        host: row.get("host")?,
        port: row.get("port")?,
        username: row.get("username")?,
        auth_type: row.get("auth_type")?,
        password: row.get("password")?,
        private_key_path: row.get("private_key_path")?,
        private_key_passphrase: row.get("private_key_passphrase")?,
        agent_identity: row.get("agent_identity")?,
        certificate_path: row.get("certificate_path")?,
        ssh_key_id: row.get("ssh_key_id")?,
        tags: row.get("tags")?,
        notes: row.get("notes")?,
        connection_timeout: row.get("connection_timeout")?,
        favorite: row.get::<_, i32>("favorite")? != 0,
        status: row.get("status")?,
        last_accessed_at: row.get("last_accessed_at")?,
        os_type: row.get("os_type")?,
        os_info: row.get("os_info")?,
        last_disconnected_at: row.get("last_disconnected_at")?,
        last_error: row.get("last_error")?,
        target_type: row.get::<_, Option<String>>("target_type")?
            .unwrap_or_else(|| "linux".to_string()),
        protocol: row.get::<_, Option<String>>("protocol")?
            .unwrap_or_else(|| "ssh".to_string()),
        protocols: row.get::<_, Option<String>>("protocols")?
            .unwrap_or_else(|| "[\"ssh\"]".to_string()),
        rdp_port: row.get::<_, Option<i32>>("rdp_port")?
            .unwrap_or(3389),
        bmc_port: row.get::<_, Option<i32>>("bmc_port")?
            .unwrap_or(443),
        bmc_allow_invalid_certs: row.get::<_, Option<i32>>("bmc_allow_invalid_certs")?
            .unwrap_or(0) != 0,
        proxy_ids: row.get::<_, Option<String>>("proxy_ids")?
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "[]".to_string()),
        default_proxy_id: row.get::<_, Option<String>>("default_proxy_id")?
            .filter(|s| !s.is_empty()),
        tunnel_ids: row.get::<_, Option<String>>("tunnel_ids")?
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "[]".to_string()),
        proxy_config: row.get::<_, Option<String>>("proxy_config")?.and_then(|enc| {
            if enc.is_empty() {
                None
            } else {
                // 解密内联代理配置（其中可能含 password/privateKeyPassphrase 明文）
                crypto::decrypt_password(&enc, master_key()).ok()
            }
        }),
        tunnels_config: row.get::<_, Option<String>>("tunnels_config")?
            .filter(|s| !s.is_empty()),
        keys_config: row.get::<_, Option<String>>("keys_config").ok().flatten()
            .filter(|s| !s.is_empty()),
        serial_config: row.get::<_, Option<String>>("serial_config").ok().flatten()
            .filter(|s| !s.is_empty()),
        group_id: row.get::<_, Option<String>>("group_id").ok().flatten()
            .filter(|s| !s.is_empty()),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        deleted_at: row.get("deleted_at")?,
    })
}

/// Replace password and private_key_passphrase fields with placeholder
fn mask_server_passwords(mut server: Server) -> Server {
    if server.password.is_some() {
        server.password = Some(PASSWORD_PLACEHOLDER.to_string());
    }
    if server.private_key_passphrase.is_some() {
        server.private_key_passphrase = Some(PASSWORD_PLACEHOLDER.to_string());
    }
    server
}

// ============================================================================
// napi-exported functions
// ============================================================================

/// Initialize SQLite database with WAL mode, foreign keys, and create tables.
/// Also stores the db_path in a global for later use by other functions.
///
/// 安全：在 Unix 平台对 DB 文件及 WAL/SHM 侧车文件设置 0600 权限，
/// 限制仅当前用户可读写，作为纵深防御（即使密文列已加密，元数据也不应被同机其他用户读取）。
/// Windows 通过用户级 ACL 由 NTFS 默认保护，无需额外处理。
pub fn init_database(db_path: String) -> Result<(), String> {
    let _ = DB_PATH.set(db_path.clone());
    let conn = get_conn()?;

    // WAL mode is a database-level setting; set once on init.
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("Failed to set WAL mode: {}", e))?;

    create_tables(&conn)
        .map_err(|e| format!("Failed to create tables: {}", e))?;

    // Unix 平台收紧 DB 及其 WAL/SHM 侧车文件权限为 0600
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let db_file = std::path::Path::new(&db_path);
        let set_readonly_owner = |p: &std::path::Path| {
            if let Ok(meta) = std::fs::metadata(p) {
                let mut perms = meta.permissions();
                perms.set_mode(0o600);
                let _ = std::fs::set_permissions(p, perms);
            }
        };
        set_readonly_owner(db_file);
        set_readonly_owner(&db_file.with_extension("db-wal"));
        set_readonly_owner(&db_file.with_extension("db-shm"));
        // 也处理常见的 -wal/-shm 后缀变体
        if let Some(stem) = db_file.file_stem().and_then(|s| s.to_str()) {
            let parent = db_file.parent().unwrap_or(std::path::Path::new("."));
            set_readonly_owner(&parent.join(format!("{}-wal", stem)));
            set_readonly_owner(&parent.join(format!("{}-shm", stem)));
        }
    }

    Ok(())
}

/// List all servers with password placeholder
/// Servers are ordered by favorite DESC, name ASC
pub fn servers_list() -> Result<String, String> {
    let conn = get_conn()?;

    let mut stmt = conn
        .prepare(
            "SELECT * FROM servers WHERE deleted_at IS NULL ORDER BY favorite DESC, name ASC"
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let servers: Vec<Server> = stmt
        .query_map([], row_to_server)
        .map_err(|e| format!("Query failed: {}", e))?
        .filter_map(|r| r.ok())
        .map(mask_server_passwords)
        .collect();

    serde_json::to_string(&servers)
        .map_err(|e| format!("Serialization failed: {}", e))
}

/// List all servers with raw (unmasked) passwords.
/// Used internally for batch operations that need decrypted passwords.
pub fn servers_list_raw() -> Result<String, String> {
    let conn = get_conn()?;

    let mut stmt = conn
        .prepare("SELECT * FROM servers ORDER BY favorite DESC, name ASC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let servers: Vec<Server> = stmt
        .query_map([], row_to_server)
        .map_err(|e| format!("Query failed: {}", e))?
        .filter_map(|r| r.ok())
        .collect(); // No password masking

    serde_json::to_string(&servers)
        .map_err(|e| format!("Serialization failed: {}", e))
}

/// List all active servers with decrypted passwords for zero-knowledge cloud sync.
/// Called exclusively during E2EE packaging where data is immediately encrypted with user's sync master password.
pub fn servers_list_for_sync() -> Result<String, String> {
    let conn = get_conn()?;

    let mut stmt = conn
        .prepare("SELECT * FROM servers WHERE deleted_at IS NULL ORDER BY favorite DESC, name ASC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let mk = master_key();
    let servers: Vec<Server> = stmt
        .query_map([], row_to_server)
        .map_err(|e| format!("Query failed: {}", e))?
        .filter_map(|r| r.ok())
        .map(|mut s| {
            if let Some(ref enc) = s.password {
                if !enc.is_empty() && enc != PASSWORD_PLACEHOLDER {
                    s.password = crypto::decrypt_password(enc, mk).ok();
                }
            }
            if let Some(ref enc) = s.private_key_passphrase {
                if !enc.is_empty() && enc != PASSWORD_PLACEHOLDER {
                    s.private_key_passphrase = crypto::decrypt_password(enc, mk).ok();
                }
            }
            s
        })
        .collect();

    serde_json::to_string(&servers)
        .map_err(|e| format!("Serialization failed: {}", e))
}

/// Add a new server with encrypted password
pub fn servers_add(server: String) -> Result<String, String> {
    let input: ServerInput = serde_json::from_str(&server)
        .map_err(|e| format!("Invalid server input: {}", e))?;

    if input.name.trim().chars().count() > 100 {
        return Err("服务器名称长度不能超过 100 个字符".to_string());
    }
    if input.host.trim().len() > 253 {
        return Err("主机地址长度不能超过 253 个字符".to_string());
    }
    if input.username.trim().chars().count() > 100 {
        return Err("用户名长度不能超过 100 个字符".to_string());
    }
    if let Some(notes) = &input.notes {
        if notes.chars().count() > 2000 {
            return Err("备注长度不能超过 2000 个字符".to_string());
        }
    }

    let conn = get_conn()?;

    let id = input
        .id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now().timestamp_millis();

    // Encrypt password if provided (skip placeholder)
    let encrypted_password = match &input.password {
        Some(p) if !p.is_empty() && p != PASSWORD_PLACEHOLDER => Some(
            crypto::encrypt_password(p, master_key())
                .map_err(|e| format!("Password encryption failed: {}", e))?
        ),
        _ => None,
    };

    // Encrypt private_key_passphrase if provided (skip placeholder)
    let encrypted_passphrase = match &input.private_key_passphrase {
        Some(p) if !p.is_empty() && p != PASSWORD_PLACEHOLDER => Some(
            crypto::encrypt_password(p, master_key())
                .map_err(|e| format!("Passphrase encryption failed: {}", e))?
        ),
        _ => None,
    };

    let mut port = input.port.unwrap_or(22);
    let auth_type = input.auth_type.unwrap_or_else(|| "password".to_string());
    let tags = input.tags.unwrap_or_else(|| "[]".to_string());
    let connection_timeout = input.connection_timeout.unwrap_or(15);
    let favorite_int = if input.favorite.unwrap_or(false) { 1 } else { 0 };
    let status = input.status.unwrap_or_else(|| "unknown".to_string());
    let target_type = input
        .target_type
        .unwrap_or_else(|| "linux".to_string())
        .trim()
        .to_ascii_lowercase();
    let mut protocol = input
        .protocol
        .unwrap_or_else(|| "ssh".to_string())
        .trim()
        .to_ascii_lowercase();
    // 兼容旧版本：BMC 曾借用 ssh/telnet/vnc 作为占位协议，但实际工作台始终走 Redfish。
    if target_type.eq_ignore_ascii_case("bmc") && protocol != "redfish" {
        protocol = "redfish".to_string();
    }
    crate::connection::validate_target_protocol(&target_type, &protocol)?;
    if protocol != "ssh" && auth_type != "password" {
        return Err(format!("协议 {} 仅支持密码认证", protocol));
    }
    // 当前产品每台资产只选择一个主协议；不信任调用方传入的历史 protocols 数组，
    // 否则工作台可能按数组显示了另一个协议的模块。
    let protocols = serde_json::to_string(&vec![protocol.clone()])
        .map_err(|e| format!("Failed to serialize protocol: {}", e))?;
    let rdp_port = input.rdp_port.unwrap_or(3389);
    let bmc_port = if target_type.eq_ignore_ascii_case("bmc") {
        input.bmc_port.unwrap_or(if port == 22 { 443 } else { port })
    } else {
        input.bmc_port.unwrap_or(443)
    };
    let bmc_allow_invalid_certs = input.bmc_allow_invalid_certs.unwrap_or(false);
    if target_type.eq_ignore_ascii_case("bmc") {
        port = bmc_port;
    }
    let proxy_ids = input.proxy_ids
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "[]".to_string());
    let default_proxy_id = input.default_proxy_id.filter(|s| !s.is_empty());
    let tunnel_ids = input.tunnel_ids
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "[]".to_string());
    // 内联代理配置：加密存储（其中可能含 password/privateKeyPassphrase 明文）
    let allow_ssh_routing = target_type.eq_ignore_ascii_case("linux") && protocol == "ssh";
    let proxy_config_enc = match &input.proxy_config {
        _ if !allow_ssh_routing => None,
        Some(s) if !s.trim().is_empty() => Some(
            crypto::encrypt_password(s, master_key())
                .map_err(|e| format!("Proxy config encryption failed: {}", e))?
        ),
        _ => None,
    };
    let tunnels_config = if allow_ssh_routing {
        input.tunnels_config.filter(|s| !s.trim().is_empty())
    } else {
        None
    };
    let keys_config = input.keys_config.filter(|s| !s.trim().is_empty());
    let serial_config = input.serial_config.filter(|s| !s.trim().is_empty());
    let group_id = input
        .group_id
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| HOST_GROUP_ID.to_string());

    conn.execute(
        "INSERT INTO servers (id, name, host, port, username, auth_type, password, private_key_path, private_key_passphrase, agent_identity, certificate_path, ssh_key_id, tags, notes, connection_timeout, favorite, status, last_accessed_at, os_type, os_info, last_disconnected_at, last_error, target_type, protocol, protocols, rdp_port, bmc_port, bmc_allow_invalid_certs, proxy_ids, default_proxy_id, tunnel_ids, proxy_config, tunnels_config, keys_config, serial_config, group_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38)",
        params![
            id,
            input.name,
            input.host,
            port,
            input.username,
            auth_type,
            encrypted_password,
            input.private_key_path,
            encrypted_passphrase,
            input.agent_identity,
            input.certificate_path,
            input.ssh_key_id,
            tags,
            input.notes,
            connection_timeout,
            favorite_int,
            status,
            Option::<i64>::None, // last_accessed_at
            input.os_type,
            input.os_info,
            Option::<i64>::None, // last_disconnected_at
            Option::<String>::None, // last_error
            target_type,
            protocol,
            protocols,
            rdp_port,
            bmc_port,
            if bmc_allow_invalid_certs { 1 } else { 0 },
            proxy_ids,
            default_proxy_id,
            tunnel_ids,
            proxy_config_enc,
            tunnels_config,
            keys_config,
            serial_config,
            group_id,
            now,
            now,
        ],
    )
    .map_err(|e| format!("Failed to insert server: {}", e))?;

    Ok(id)
}

/// Update a server with dynamic fields
/// Skips password if it's the placeholder "•••••"
pub fn servers_update(id: String, updates: String) -> Result<(), String> {
    let mut update: ServerUpdate = serde_json::from_str(&updates)
        .map_err(|e| format!("Invalid update input: {}", e))?;

    if let Some(name) = &update.name {
        if name.trim().chars().count() > 100 {
            return Err("服务器名称长度不能超过 100 个字符".to_string());
        }
    }
    if let Some(host) = &update.host {
        if host.trim().len() > 253 {
            return Err("主机地址长度不能超过 253 个字符".to_string());
        }
    }
    if let Some(username) = &update.username {
        if username.trim().chars().count() > 100 {
            return Err("用户名长度不能超过 100 个字符".to_string());
        }
    }
    if let Some(notes) = &update.notes {
        if notes.chars().count() > 2000 {
            return Err("备注长度不能超过 2000 个字符".to_string());
        }
    }

    update.target_type = update
        .target_type
        .take()
        .map(|value| value.trim().to_ascii_lowercase());
    update.protocol = update
        .protocol
        .take()
        .map(|value| value.trim().to_ascii_lowercase());

    let conn = get_conn()?;

    // 在更新前合并当前值进行协议矩阵校验，避免只更新 protocol/targetType
    // 时绕过校验，或把已有连接错误地保存为“看似支持”的协议。
    let (current_target, current_protocol, current_auth, current_port, current_bmc_port): (String, String, String, i32, i32) = conn
        .query_row(
            "SELECT COALESCE(target_type, 'linux'), COALESCE(protocol, 'ssh'), COALESCE(auth_type, 'password'), COALESCE(port, 22), COALESCE(bmc_port, 443) FROM servers WHERE id = ?1",
            params![id.clone()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .map_err(|e| format!("Server not found: {}", e))?;
    let effective_target_value = update.target_type.clone().unwrap_or(current_target);
    if effective_target_value.eq_ignore_ascii_case("bmc")
        && update.protocol.as_deref().unwrap_or(&current_protocol) != "redfish"
    {
        update.protocol = Some("redfish".to_string());
    }
    let effective_protocol_value = update.protocol.clone().unwrap_or(current_protocol);
    let effective_target = effective_target_value.as_str();
    let effective_protocol = effective_protocol_value.as_str();
    let effective_auth = update.auth_type.as_deref().unwrap_or(&current_auth);
    crate::connection::validate_target_protocol(effective_target, effective_protocol)?;

    if effective_protocol != "ssh" && effective_auth != "password" {
        return Err(format!("协议 {} 仅支持密码认证", effective_protocol));
    }

    update.protocols = Some(
        serde_json::to_string(&vec![effective_protocol_value.clone()])
            .map_err(|e| format!("Failed to serialize protocol: {}", e))?,
    );

    if effective_target.eq_ignore_ascii_case("bmc") {
        update.auth_type = Some("password".to_string());
        let bmc_port = update
            .bmc_port
            .or(update.port)
            .unwrap_or(if current_bmc_port > 0 { current_bmc_port } else if current_port > 0 { current_port } else { 443 });
        update.port = Some(bmc_port);
        update.bmc_port = Some(bmc_port);
    }

    // 跳板、代理和 SSH 隧道只属于 Linux SSH。切换目标类型或协议时主动清除，
    // 避免隐藏配置在后端继续生效。
    if !(effective_target.eq_ignore_ascii_case("linux") && effective_protocol == "ssh") {
        update.proxy_config = Some(String::new());
        update.tunnels_config = Some(String::new());
    }

    let now = Utc::now().timestamp_millis();

    // Build dynamic UPDATE query
    let mut set_clauses: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref name) = update.name {
        set_clauses.push("name = ?".to_string());
        param_values.push(Box::new(name.clone()));
    }
    if let Some(ref host) = update.host {
        set_clauses.push("host = ?".to_string());
        param_values.push(Box::new(host.clone()));
    }
    if let Some(port) = update.port {
        set_clauses.push("port = ?".to_string());
        param_values.push(Box::new(port));
    }
    if let Some(ref username) = update.username {
        set_clauses.push("username = ?".to_string());
        param_values.push(Box::new(username.clone()));
    }
    if let Some(ref auth_type) = update.auth_type {
        set_clauses.push("auth_type = ?".to_string());
        param_values.push(Box::new(auth_type.clone()));
    }
    if let Some(ref password) = update.password {
        // Skip if it's the placeholder
        if password != PASSWORD_PLACEHOLDER {
            let encrypted = crypto::encrypt_password(password, master_key())
                .map_err(|e| format!("Password encryption failed: {}", e))?;
            set_clauses.push("password = ?".to_string());
            param_values.push(Box::new(encrypted));
        }
    }
    if let Some(ref private_key_path) = update.private_key_path {
        set_clauses.push("private_key_path = ?".to_string());
        param_values.push(Box::new(private_key_path.clone()));
    }
    if let Some(ref private_key_passphrase) = update.private_key_passphrase {
        // Skip if it's the placeholder
        if private_key_passphrase != PASSWORD_PLACEHOLDER {
            let encrypted = crypto::encrypt_password(private_key_passphrase, master_key())
                .map_err(|e| format!("Passphrase encryption failed: {}", e))?;
            set_clauses.push("private_key_passphrase = ?".to_string());
            param_values.push(Box::new(encrypted));
        }
    }
    // SSH Agent 指定身份（明文存储，本身已是公钥不敏感）
    if let Some(ref agent_identity) = update.agent_identity {
        let trimmed = agent_identity.trim();
        let value = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
        set_clauses.push("agent_identity = ?".to_string());
        param_values.push(Box::new(value));
    }
    // OpenSSH 证书路径
    if let Some(ref certificate_path) = update.certificate_path {
        let trimmed = certificate_path.trim();
        let value = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
        set_clauses.push("certificate_path = ?".to_string());
        param_values.push(Box::new(value));
    }
    // 关联的 SSH 密钥 ID（空字符串表示解除关联）
    if let Some(ref ssh_key_id) = update.ssh_key_id {
        let trimmed = ssh_key_id.trim();
        let value = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
        set_clauses.push("ssh_key_id = ?".to_string());
        param_values.push(Box::new(value));
    }
    if let Some(ref tags) = update.tags {
        set_clauses.push("tags = ?".to_string());
        param_values.push(Box::new(tags.clone()));
    }
    if let Some(ref notes) = update.notes {
        set_clauses.push("notes = ?".to_string());
        param_values.push(Box::new(notes.clone()));
    }
    if let Some(connection_timeout) = update.connection_timeout {
        set_clauses.push("connection_timeout = ?".to_string());
        param_values.push(Box::new(connection_timeout));
    }
    if let Some(favorite) = update.favorite {
        let favorite_int = if favorite { 1 } else { 0 };
        set_clauses.push("favorite = ?".to_string());
        param_values.push(Box::new(favorite_int));
    }
    if let Some(ref status) = update.status {
        set_clauses.push("status = ?".to_string());
        param_values.push(Box::new(status.clone()));
    }
    if let Some(ref os_type) = update.os_type {
        set_clauses.push("os_type = ?".to_string());
        param_values.push(Box::new(os_type.clone()));
    }
    if let Some(ref os_info) = update.os_info {
        set_clauses.push("os_info = ?".to_string());
        param_values.push(Box::new(os_info.clone()));
    }
    if let Some(last_accessed_at) = update.last_accessed_at {
        set_clauses.push("last_accessed_at = ?".to_string());
        param_values.push(Box::new(last_accessed_at));
    }
    if let Some(last_disconnected_at) = update.last_disconnected_at {
        set_clauses.push("last_disconnected_at = ?".to_string());
        param_values.push(Box::new(last_disconnected_at));
    }
    if let Some(ref last_error) = update.last_error {
        set_clauses.push("last_error = ?".to_string());
        param_values.push(Box::new(last_error.clone()));
    }
    if let Some(ref target_type) = update.target_type {
        set_clauses.push("target_type = ?".to_string());
        param_values.push(Box::new(target_type.clone()));
    }
    if let Some(ref protocol) = update.protocol {
        set_clauses.push("protocol = ?".to_string());
        param_values.push(Box::new(protocol.clone()));
    }
    if let Some(ref protocols) = update.protocols {
        set_clauses.push("protocols = ?".to_string());
        param_values.push(Box::new(protocols.clone()));
    }
    if let Some(rdp_port) = update.rdp_port {
        set_clauses.push("rdp_port = ?".to_string());
        param_values.push(Box::new(rdp_port));
    }
    if let Some(bmc_port) = update.bmc_port {
        set_clauses.push("bmc_port = ?".to_string());
        param_values.push(Box::new(bmc_port));
    }
    if let Some(allow_invalid_certs) = update.bmc_allow_invalid_certs {
        set_clauses.push("bmc_allow_invalid_certs = ?".to_string());
        param_values.push(Box::new(if allow_invalid_certs { 1 } else { 0 }));
    }
    // 关联的代理 ID 列表（JSON 数组字符串）
    if let Some(ref proxy_ids) = update.proxy_ids {
        let value = if proxy_ids.trim().is_empty() {
            "[]".to_string()
        } else {
            proxy_ids.trim().to_string()
        };
        set_clauses.push("proxy_ids = ?".to_string());
        param_values.push(Box::new(value));
    }
    // 默认代理 ID（空字符串表示清除）
    if let Some(ref default_proxy_id) = update.default_proxy_id {
        let trimmed = default_proxy_id.trim();
        let value: Option<String> = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
        set_clauses.push("default_proxy_id = ?".to_string());
        param_values.push(Box::new(value));
    }
    // 关联的隧道 ID 列表（JSON 数组字符串）
    if let Some(ref tunnel_ids) = update.tunnel_ids {
        let value: String = if tunnel_ids.trim().is_empty() {
            "[]".to_string()
        } else {
            tunnel_ids.trim().to_string()
        };
        set_clauses.push("tunnel_ids = ?".to_string());
        param_values.push(Box::new(value));
    }
    // 内联代理配置（JSON 字符串；空字符串表示清除，加密存储）
    if let Some(ref proxy_config) = update.proxy_config {
        let value: Option<String> = if proxy_config.trim().is_empty() {
            None
        } else {
            Some(
                crypto::encrypt_password(proxy_config.trim(), master_key())
                    .map_err(|e| format!("Proxy config encryption failed: {}", e))?,
            )
        };
        set_clauses.push("proxy_config = ?".to_string());
        param_values.push(Box::new(value));
    }
    // 内联隧道配置（JSON 数组字符串；空字符串表示清除）
    if let Some(ref tunnels_config) = update.tunnels_config {
        let value: Option<String> = if tunnels_config.trim().is_empty() {
            None
        } else {
            Some(tunnels_config.trim().to_string())
        };
        set_clauses.push("tunnels_config = ?".to_string());
        param_values.push(Box::new(value));
    }
    // 内联密钥配置（JSON 数组字符串；空字符串表示清除）
    if let Some(ref keys_config) = update.keys_config {
        let value: Option<String> = if keys_config.trim().is_empty() {
            None
        } else {
            Some(keys_config.trim().to_string())
        };
        set_clauses.push("keys_config = ?".to_string());
        param_values.push(Box::new(value));
    }
    // 串口配置（JSON 字符串；空字符串表示清除）
    if let Some(ref serial_config) = update.serial_config {
        let value: Option<String> = if serial_config.trim().is_empty() {
            None
        } else {
            Some(serial_config.trim().to_string())
        };
        set_clauses.push("serial_config = ?".to_string());
        param_values.push(Box::new(value));
    }
    // 所属分组 ID（空字符串表示挂到「主机」根分组）
    if let Some(ref group_id) = update.group_id {
        let trimmed = group_id.trim();
        let value: Option<String> = Some(if trimmed.is_empty() { HOST_GROUP_ID.to_string() } else { trimmed.to_string() });
        set_clauses.push("group_id = ?".to_string());
        param_values.push(Box::new(value));
    }

    // Always update updated_at
    set_clauses.push("updated_at = ?".to_string());
    param_values.push(Box::new(now));

    if set_clauses.is_empty() {
        return Ok(());
    }

    let sql = format!("UPDATE servers SET {} WHERE id = ?", set_clauses.join(", "));
    param_values.push(Box::new(id.clone()));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    conn.execute(&sql, param_refs.as_slice())
        .map_err(|e| format!("Failed to update server: {}", e))?;

    Ok(())
}

/// Delete a server by ID with cascade
pub fn servers_delete(id: String) -> Result<(), String> {
    let conn = get_conn()?;
    let now = Utc::now().timestamp_millis();

    // 软删除：标记为待删除（回收站），30 天后由 cleanup_trash 物理清除
    conn.execute(
        "UPDATE servers SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, id],
    )
    .map_err(|e| format!("Failed to delete server: {}", e))?;

    Ok(())
}

/// 列出回收站中的服务器（deleted_at IS NOT NULL），按删除时间倒序。密码掩码。
pub fn servers_list_trash() -> Result<String, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT * FROM servers WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;
    let servers: Vec<Server> = stmt
        .query_map([], row_to_server)
        .map_err(|e| format!("Query failed: {}", e))?
        .filter_map(|r| r.ok())
        .map(mask_server_passwords)
        .collect();
    serde_json::to_string(&servers)
        .map_err(|e| format!("Serialization failed: {}", e))
}

/// 恢复服务器：清除 deleted_at；若原分组已不存在则归入根分组。
pub fn servers_restore(id: String) -> Result<(), String> {
    let conn = get_conn()?;
    let now = Utc::now().timestamp_millis();
    conn.execute(
        "UPDATE servers
         SET deleted_at = NULL,
             updated_at = ?1,
             group_id = CASE
                 WHEN group_id IS NOT NULL AND group_id IN (SELECT id FROM server_groups)
                 THEN group_id
                 ELSE ?2
             END
         WHERE id = ?3",
        params![now, HOST_GROUP_ID, id],
    )
    .map_err(|e| format!("Failed to restore server: {}", e))?;
    Ok(())
}

/// 永久删除服务器（物理 DELETE）。
pub fn servers_purge(id: String) -> Result<(), String> {
    let conn = get_conn()?;
    conn.execute("DELETE FROM servers WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to purge server: {}", e))?;
    Ok(())
}

/// 批量软删除（移入回收站）：单条 UPDATE ... WHERE id IN (...) 完成全部。
pub fn servers_delete_batch(ids: Vec<String>) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let conn = get_conn()?;
    let now = Utc::now().timestamp_millis();
    let placeholders = std::iter::repeat("?").take(ids.len()).collect::<Vec<&str>>().join(",");
    let sql = format!(
        "UPDATE servers SET deleted_at = ?, updated_at = ? WHERE id IN ({})",
        placeholders
    );
    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(ids.len() + 2);
    params.push(&now);
    params.push(&now);
    for id in &ids {
        params.push(id);
    }
    conn.execute(&sql, params.as_slice())
        .map_err(|e| format!("Failed to batch delete servers: {}", e))?;
    Ok(())
}

/// 批量恢复回收站中的服务器：单条 UPDATE 完成；原分组已删除则归入根分组。
pub fn servers_restore_batch(ids: Vec<String>) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let conn = get_conn()?;
    let now = Utc::now().timestamp_millis();
    let placeholders = std::iter::repeat("?").take(ids.len()).collect::<Vec<&str>>().join(",");
    let sql = format!(
        "UPDATE servers SET deleted_at = NULL, updated_at = ?, \
         group_id = CASE WHEN group_id IS NOT NULL AND group_id IN (SELECT id FROM server_groups) \
                         THEN group_id ELSE ? END \
         WHERE id IN ({})",
        placeholders
    );
    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(ids.len() + 2);
    params.push(&now);
    params.push(&HOST_GROUP_ID);
    for id in &ids {
        params.push(id);
    }
    conn.execute(&sql, params.as_slice())
        .map_err(|e| format!("Failed to batch restore servers: {}", e))?;
    Ok(())
}

/// 批量永久删除（物理清除）回收站中的服务器：单条 DELETE ... WHERE id IN (...) 完成。
pub fn servers_purge_batch(ids: Vec<String>) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let conn = get_conn()?;
    let placeholders = std::iter::repeat("?").take(ids.len()).collect::<Vec<&str>>().join(",");
    let sql = format!("DELETE FROM servers WHERE id IN ({})", placeholders);
    let mut params: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(ids.len());
    for id in &ids {
        params.push(id);
    }
    conn.execute(&sql, params.as_slice())
        .map_err(|e| format!("Failed to batch purge servers: {}", e))?;
    Ok(())
}

/// 清理超过 retention_days 天的回收站项（物理删除），返回清理条数。
pub fn servers_cleanup_trash(retention_days: i64) -> Result<u64, String> {
    let conn = get_conn()?;
    let cutoff = Utc::now().timestamp_millis() - retention_days * 24 * 60 * 60 * 1000;
    let deleted = conn
        .execute(
            "DELETE FROM servers WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
            params![cutoff],
        )
        .map_err(|e| format!("Failed to cleanup trash: {}", e))?;
    Ok(deleted as u64)
}

/// Get a single server by ID with password placeholder
pub fn servers_get(id: String) -> Result<String, String> {
    let conn = get_conn()?;

    let mut stmt = conn
        .prepare("SELECT * FROM servers WHERE id = ?1")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let server = stmt
        .query_row(params![id], row_to_server)
        .map_err(|e| format!("Server not found: {}", e))?;

    let masked = mask_server_passwords(server);

    serde_json::to_string(&masked)
        .map_err(|e| format!("Serialization failed: {}", e))
}

// ============================================================================
// 服务器分组（树形目录）
// ============================================================================

/// 服务器分组（树形目录节点）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerGroup {
    pub id: String,
    pub name: String,
    /// 父分组 ID，NULL 表示根目录
    #[serde(default)]
    pub parent_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 新建分组输入
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerGroupInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
}

/// 更新分组输入
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerGroupUpdate {
    pub name: Option<String>,
    /// 父分组 ID（None 表示不修改；空字符串表示移到根目录）
    #[serde(default)]
    pub parent_id: Option<String>,
}

fn row_to_server_group(row: &rusqlite::Row<'_>) -> SqliteResult<ServerGroup> {
    Ok(ServerGroup {
        id: row.get("id")?,
        name: row.get("name")?,
        parent_id: row.get::<_, Option<String>>("parent_id")?.filter(|s| !s.is_empty()),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// 列出所有分组（按名称排序）
pub fn server_groups_list() -> Result<String, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare("SELECT * FROM server_groups ORDER BY name ASC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;
    let groups: Vec<ServerGroup> = stmt
        .query_map([], row_to_server_group)
        .map_err(|e| format!("Query failed: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
    serde_json::to_string(&groups).map_err(|e| format!("Serialization failed: {}", e))
}

/// 校验 parent_id 存在（空表示根目录）
fn validate_group_parent(conn: &Connection, parent_id: Option<&str>) -> Result<(), String> {
    if let Some(pid) = parent_id {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM server_groups WHERE id = ?1",
                params![pid],
                |row| row.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .map_err(|e| format!("Failed to check parent group: {}", e))?;
        if !exists {
            return Err("Parent group not found".to_string());
        }
    }
    Ok(())
}

/// 新建分组，返回新分组 ID
pub fn server_groups_add(group: String) -> Result<String, String> {
    let input: ServerGroupInput = serde_json::from_str(&group)
        .map_err(|e| format!("Invalid group input: {}", e))?;
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Group name cannot be empty".to_string());
    }

    let conn = get_conn()?;
    let id = input
        .id
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let parent_id = if id == HOST_GROUP_ID {
        None
    } else {
        Some(
            input
                .parent_id
                .as_deref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .unwrap_or_else(|| HOST_GROUP_ID.to_string()),
        )
    };

    if let Some(ref pid) = parent_id {
        validate_group_parent(&conn, Some(pid))?;
    }

    let now = Utc::now().timestamp_millis();
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM server_groups WHERE id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);

    if exists {
        conn.execute(
            "UPDATE server_groups SET name = ?1, parent_id = ?2, updated_at = ?3 WHERE id = ?4",
            params![name, parent_id, now, id],
        )
        .map_err(|e| format!("Failed to update group: {}", e))?;
    } else {
        conn.execute(
            "INSERT INTO server_groups (id, name, parent_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, name, parent_id, now, now],
        )
        .map_err(|e| format!("Failed to insert group: {}", e))?;
    }
    Ok(id)
}

/// 收集分组自身及所有后代分组的 ID（BFS）
fn collect_group_subtree_ids(conn: &Connection, root_id: &str) -> Result<Vec<String>, String> {
    let mut ids = vec![root_id.to_string()];
    let mut queue = std::collections::VecDeque::from([root_id.to_string()]);
    while let Some(cur) = queue.pop_front() {
        let mut stmt = conn
            .prepare("SELECT id FROM server_groups WHERE parent_id = ?1")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;
        let children: Vec<String> = stmt
            .query_map(params![cur], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Query failed: {}", e))?
            .filter_map(|r| r.ok())
            .collect();
        for child in children {
            if !ids.contains(&child) {
                ids.push(child.clone());
                queue.push_back(child);
            }
        }
    }
    Ok(ids)
}

/// 更新分组（重命名 / 移动到新父分组，含环检测）
pub fn server_groups_update(id: String, updates: String) -> Result<(), String> {
    let update: ServerGroupUpdate = serde_json::from_str(&updates)
        .map_err(|e| format!("Invalid group update: {}", e))?;

    let conn = get_conn()?;

    // 目标分组必须存在
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM server_groups WHERE id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .map_err(|e| format!("Failed to check group: {}", e))?;
    if !exists {
        return Err("Group not found".to_string());
    }

    let now = Utc::now().timestamp_millis();
    let mut set_clauses: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref name) = update.name {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("Group name cannot be empty".to_string());
        }
        set_clauses.push("name = ?".to_string());
        param_values.push(Box::new(trimmed.to_string()));
    }

    if let Some(ref parent_raw) = update.parent_id {
        let trimmed = parent_raw.trim();
        let new_parent: Option<String> = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
        // 不能把自己作为父分组
        if let Some(ref pid) = new_parent {
            if pid == &id {
                return Err("Cannot move a group into itself".to_string());
            }
            validate_group_parent(&conn, Some(pid))?;
            // 环检测：新父分组不能是当前分组的后代
            let subtree = collect_group_subtree_ids(&conn, &id)?;
            if subtree.contains(pid) {
                return Err("Cannot move a group into its own descendant".to_string());
            }
        }
        set_clauses.push("parent_id = ?".to_string());
        param_values.push(Box::new(new_parent));
    }

    if set_clauses.is_empty() {
        return Ok(());
    }
    set_clauses.push("updated_at = ?".to_string());
    param_values.push(Box::new(now));

    let sql = format!("UPDATE server_groups SET {} WHERE id = ?", set_clauses.join(", "));
    param_values.push(Box::new(id.clone()));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, param_refs.as_slice())
        .map_err(|e| format!("Failed to update group: {}", e))?;
    Ok(())
}

/// 删除分组（含全部子孙分组；组内服务器不删除，移出到根目录）
pub fn server_groups_delete(id: String) -> Result<(), String> {
    if id == HOST_GROUP_ID {
        return Err("不能删除主机分组".to_string());
    }
    let conn = get_conn()?;

    // 收集子树所有分组 ID
    let subtree = collect_group_subtree_ids(&conn, &id)?;

    // 组内服务器移到「主机」分组（不删除服务器本身）
    for gid in &subtree {
        conn.execute(
            "UPDATE servers SET group_id = ?2 WHERE group_id = ?1",
            params![gid, HOST_GROUP_ID],
        )
        .map_err(|e| format!("Failed to detach servers from group: {}", e))?;
    }

    // 删除子树分组（先叶子后根，避免临时父子悬挂）
    let placeholders = subtree.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("DELETE FROM server_groups WHERE id IN ({})", placeholders);
    let params_iter: Vec<&dyn rusqlite::types::ToSql> =
        subtree.iter().map(|g| g as &dyn rusqlite::types::ToSql).collect();
    conn.execute(&sql, params_iter.as_slice())
        .map_err(|e| format!("Failed to delete group: {}", e))?;
    Ok(())
}

/// 按名称路径查找或逐级创建分组，返回最终分组 ID（用于导入时还原分组结构）
pub fn server_groups_find_or_create_by_path(path: &[String]) -> Result<String, String> {
    let conn = get_conn()?;
    let mut current_parent: Option<String> = None;

    for segment in path {
        let name = segment.trim();
        if name.is_empty() {
            continue;
        }
        // 在当前父分组下查找同名子分组
        let existing: Option<String> = match &current_parent {
            Some(pid) => conn
                .query_row(
                    "SELECT id FROM server_groups WHERE name = ?1 AND parent_id = ?2",
                    params![name, pid],
                    |row| row.get::<_, String>(0),
                )
                .ok(),
            None => conn
                .query_row(
                    "SELECT id FROM server_groups WHERE name = ?1 AND parent_id IS NULL",
                    params![name],
                    |row| row.get::<_, String>(0),
                )
                .ok(),
        };

        current_parent = Some(match existing {
            Some(id) => id,
            None => {
                let id = Uuid::new_v4().to_string();
                let now = Utc::now().timestamp_millis();
                conn.execute(
                    "INSERT INTO server_groups (id, name, parent_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![id, name, current_parent, now, now],
                )
                .map_err(|e| format!("Failed to insert group: {}", e))?;
                id
            }
        });
    }

    current_parent.ok_or_else(|| "Empty group path".to_string())
}

/// Get a single server by ID with raw (unmasked) passwords.
/// Used internally for SSH connection where passwords need to be decrypted.
pub fn servers_get_raw(id: String) -> Result<String, String> {
    let conn = get_conn()?;

    let mut stmt = conn
        .prepare("SELECT * FROM servers WHERE id = ?1")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let server = stmt
        .query_row(params![id], row_to_server)
        .map_err(|e| format!("Server not found: {}", e))?;

    // Return WITHOUT masking passwords
    serde_json::to_string(&server)
        .map_err(|e| format!("Serialization failed: {}", e))
}

pub fn bookmarks_list(server_id: String) -> Result<String, String> {
    let conn = get_conn()?;

    let mut stmt = conn
        .prepare("SELECT * FROM log_bookmarks WHERE server_id = ?1 ORDER BY created_at DESC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let bookmarks: Vec<LogBookmark> = stmt
        .query_map(params![server_id], |row| {
            Ok(LogBookmark {
                id: row.get("id")?,
                server_id: row.get("server_id")?,
                path: row.get("path")?,
                alias: row.get("alias")?,
                created_at: row.get("created_at")?,
            })
        })
        .map_err(|e| format!("Query failed: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    serde_json::to_string(&bookmarks)
        .map_err(|e| format!("Serialization failed: {}", e))
}

/// Add a log bookmark
pub fn bookmarks_add(server_id: String, path: String, alias: String) -> Result<String, String> {
    let conn = get_conn()?;

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO log_bookmarks (id, server_id, path, alias, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, server_id, path, alias, now],
    )
    .map_err(|e| format!("Failed to insert bookmark: {}", e))?;

    Ok(id)
}

/// Delete a log bookmark by ID
pub fn bookmarks_delete(id: String) -> Result<(), String> {
    let conn = get_conn()?;

    conn.execute("DELETE FROM log_bookmarks WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete bookmark: {}", e))?;

    Ok(())
}

/// 列出全部书签（用于云端同步备份）
pub fn bookmarks_list_all() -> Result<String, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare("SELECT * FROM log_bookmarks ORDER BY created_at DESC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let bookmarks: Vec<LogBookmark> = stmt
        .query_map([], |row| {
            Ok(LogBookmark {
                id: row.get("id")?,
                server_id: row.get("server_id")?,
                path: row.get("path")?,
                alias: row.get("alias")?,
                created_at: row.get("created_at")?,
            })
        })
        .map_err(|e| format!("Query failed: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

    serde_json::to_string(&bookmarks)
        .map_err(|e| format!("Serialization failed: {}", e))
}

/// 批量还原书签
pub fn bookmarks_restore(items: Vec<LogBookmark>) -> Result<usize, String> {
    let conn = get_conn()?;
    let mut count = 0;
    for b in items {
        if b.id.trim().is_empty() || b.server_id.trim().is_empty() {
            continue;
        }
        conn.execute(
            "INSERT OR REPLACE INTO log_bookmarks (id, server_id, path, alias, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![b.id, b.server_id, b.path, b.alias, b.created_at],
        ).map_err(|e| format!("Failed to restore bookmark: {}", e))?;
        count += 1;
    }
    Ok(count)
}

#[derive(Debug, PartialEq, Eq)]
pub enum KnownHostVerifyResult {
    Match,
    Mismatch,
    NotFound,
}

/// Check if a host key matches the one recorded in the SQLite database.
///
/// 安全语义（修复多 key_type MITM 漏洞）：
/// - `Match`：存在相同 (host, port, key_type) 且 key_value 一致 → 接受
/// - `Mismatch`：存在相同 (host, port, key_type) 但 key_value 不同（密钥被替换），
///   或者 (host, port) 有记录但没有任何相同 key_type 的行（攻击者用新算法绕过 TOFU）→ 拒绝
/// - `NotFound`：(host, port) 完全无记录 → TOFU 首次信任
pub fn check_known_host(
    host: &str,
    port: i32,
    key_type: &str,
    key_value: &str,
) -> Result<KnownHostVerifyResult, String> {
    let conn = get_conn()?;

    let mut stmt = conn
        .prepare("SELECT key_type, key_value FROM known_hosts WHERE host = ?1 AND port = ?2")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let mut rows = stmt
        .query(params![host, port])
        .map_err(|e| format!("Query failed: {}", e))?;

    let mut matched = false;
    let mut has_any_row = false;

    while let Some(row) = rows.next().map_err(|e| format!("Error reading row: {}", e))? {
        has_any_row = true;
        let stored_type: String = row.get(0).map_err(|e| format!("Error getting key_type: {}", e))?;
        let stored_value: String = row.get(1).map_err(|e| format!("Error getting key_value: {}", e))?;

        if stored_type == key_type {
            if stored_value == key_value {
                matched = true;
            } else {
                // 相同 key_type 但 key_value 不同 → 密钥被替换，可能 MITM
                return Ok(KnownHostVerifyResult::Mismatch);
            }
        }
        // 不同 key_type 的行暂时跳过，循环结束后统一判断
    }

    if matched {
        Ok(KnownHostVerifyResult::Match)
    } else if has_any_row {
        // (host, port) 有历史记录，但没有任何匹配 key_type 的行。
        // 旧实现返回 NotFound 触发 TOFU 自动信任，攻击者可换新算法绕过校验。
        // 现改为 Mismatch，用户需调用 reset_known_host 后重试。
        Ok(KnownHostVerifyResult::Mismatch)
    } else {
        Ok(KnownHostVerifyResult::NotFound)
    }
}

/// Record a server host key in the SQLite database.
pub fn save_known_host(
    host: &str,
    port: i32,
    key_type: &str,
    key_value: &str,
) -> Result<(), String> {
    let conn = get_conn()?;
    let now = Utc::now().timestamp_millis();

    conn.execute(
        "INSERT OR REPLACE INTO known_hosts (host, port, key_type, key_value, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![host, port, key_type, key_value, now],
    )
    .map_err(|e| format!("Failed to insert known host: {}", e))?;

    Ok(())
}

/// 清除指定 (host, port) 的所有已知主机密钥记录。
///
/// 用于服务器密钥轮换/重装后重置指纹，使下次连接重新走 TOFU 流程。
/// 若不存在记录则静默成功（幂等）。
pub fn reset_known_host(host: &str, port: i32) -> Result<usize, String> {
    let conn = get_conn()?;
    let affected = conn
        .execute(
            "DELETE FROM known_hosts WHERE host = ?1 AND port = ?2",
            params![host, port],
        )
        .map_err(|e| format!("Failed to reset known host: {}", e))?;
    Ok(affected)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownHostRecord {
    pub host: String,
    pub port: i32,
    pub key_type: String,
    pub key_value: String,
    pub fingerprint: String,
    pub created_at: i64,
}

/// 计算 Base64 编码的 SSH 公钥的 SHA256 指纹
pub fn compute_ssh_fingerprint(key_value_base64: &str) -> String {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    if let Ok(blob) = base64::engine::general_purpose::STANDARD.decode(key_value_base64.trim()) {
        let hash = Sha256::digest(&blob);
        let b64 = base64::engine::general_purpose::STANDARD.encode(hash);
        format!("SHA256:{}", b64)
    } else {
        String::new()
    }
}

/// 列出所有已知主机
pub fn list_known_hosts() -> Result<Vec<KnownHostRecord>, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare("SELECT host, port, key_type, key_value, created_at FROM known_hosts ORDER BY created_at DESC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let rows = stmt
        .query_map([], |row| {
            let key_value: String = row.get(3)?;
            let fingerprint = compute_ssh_fingerprint(&key_value);
            Ok(KnownHostRecord {
                host: row.get(0)?,
                port: row.get(1)?,
                key_type: row.get(2)?,
                key_value,
                fingerprint,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("Query failed: {}", e))?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("Failed to read known host row: {}", e))?);
    }
    Ok(out)
}

/// 删除指定 (host, port, optional key_type) 的主机指纹记录
pub fn delete_known_host(host: &str, port: i32, key_type: Option<&str>) -> Result<usize, String> {
    let conn = get_conn()?;
    let affected = if let Some(kt) = key_type {
        conn.execute(
            "DELETE FROM known_hosts WHERE host = ?1 AND port = ?2 AND key_type = ?3",
            params![host, port, kt],
        )
    } else {
        conn.execute(
            "DELETE FROM known_hosts WHERE host = ?1 AND port = ?2",
            params![host, port],
        )
    }
    .map_err(|e| format!("Failed to delete known host: {}", e))?;
    Ok(affected)
}

/// 清空全部已记录的主机指纹
pub fn clear_all_known_hosts() -> Result<usize, String> {
    let conn = get_conn()?;
    let affected = conn
        .execute("DELETE FROM known_hosts", [])
        .map_err(|e| format!("Failed to clear known hosts: {}", e))?;
    Ok(affected)
}

/// 批量导入/恢复已知主机指纹（用于云同步恢复）
pub fn restore_known_hosts(records: Vec<KnownHostRecord>) -> Result<usize, String> {
    let conn = get_conn()?;
    let mut count = 0;
    for rec in records {
        conn.execute(
            "INSERT OR REPLACE INTO known_hosts (host, port, key_type, key_value, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![rec.host, rec.port, rec.key_type, rec.key_value, rec.created_at],
        )
        .map_err(|e| format!("Failed to restore known host: {}", e))?;
        count += 1;
    }
    Ok(count)
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditLog {
    pub id: String,
    pub timestamp: i64,
    pub log_type: String,
    pub server_name: Option<String>,
    pub event: String,
    pub status: String,
    pub details: Option<String>,
}

pub fn add_audit_log(
    log_type: &str,
    server_name: Option<&str>,
    event: &str,
    status: &str,
    details: Option<&str>,
) -> Result<(), String> {
    let conn = get_conn()?;
    let id = Uuid::new_v4().to_string();
    let timestamp = Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO audit_logs (id, timestamp, log_type, server_name, event, status, details) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, timestamp, log_type, server_name, event, status, details],
    )
    .map_err(|e| format!("Failed to insert audit log: {}", e))?;

    // 为了防止日志无限增长影响查询性能，我们限制只保留最新的 2000 条日志
    let _ = conn.execute(
        "DELETE FROM audit_logs WHERE id NOT IN (
            SELECT id FROM audit_logs ORDER BY timestamp DESC LIMIT 2000
        )",
        [],
    );

    Ok(())
}

pub fn list_audit_logs(
    log_type: Option<String>,
    search_query: Option<String>,
    limit: i64,
    offset: i64,
) -> Result<Vec<AuditLog>, String> {
    let conn = get_conn()?;
    let log_type_str = log_type.unwrap_or_default();
    let search_str = search_query.unwrap_or_default();
    let has_type = !log_type_str.is_empty();
    let has_search = !search_str.is_empty();

    let mut sql = "SELECT id, timestamp, log_type, server_name, event, status, details FROM audit_logs WHERE 1=1".to_string();
    if has_type {
        sql.push_str(" AND log_type = :log_type");
    }
    if has_search {
        sql.push_str(" AND (event LIKE :search OR server_name LIKE :search OR details LIKE :search)");
    }
    sql.push_str(" ORDER BY timestamp DESC LIMIT :limit OFFSET :offset");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let like_str = format!("%{}%", search_str);
    let mut params_list = vec![
        (":limit", &limit as &dyn rusqlite::ToSql),
        (":offset", &offset as &dyn rusqlite::ToSql),
    ];
    if has_type {
        params_list.push((":log_type", &log_type_str as &dyn rusqlite::ToSql));
    }
    if has_search {
        params_list.push((":search", &like_str as &dyn rusqlite::ToSql));
    }

    let rows = stmt.query_map(&params_list[..], |row| {
        Ok(AuditLog {
            id: row.get(0)?,
            timestamp: row.get(1)?,
            log_type: row.get(2)?,
            server_name: row.get(3)?,
            event: row.get(4)?,
            status: row.get(5)?,
            details: row.get(6)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut logs = Vec::new();
    for log in rows.flatten() {
        logs.push(log);
    }

    Ok(logs)
}

pub fn count_audit_logs(
    log_type: Option<String>,
    search_query: Option<String>,
) -> Result<i64, String> {
    let conn = get_conn()?;
    let log_type_str = log_type.unwrap_or_default();
    let search_str = search_query.unwrap_or_default();
    let has_type = !log_type_str.is_empty();
    let has_search = !search_str.is_empty();

    let mut sql = "SELECT COUNT(*) FROM audit_logs WHERE 1=1".to_string();
    if has_type {
        sql.push_str(" AND log_type = :log_type");
    }
    if has_search {
        sql.push_str(" AND (event LIKE :search OR server_name LIKE :search OR details LIKE :search)");
    }

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let like_str = format!("%{}%", search_str);
    let mut params_list = Vec::new();
    if has_type {
        params_list.push((":log_type", &log_type_str as &dyn rusqlite::ToSql));
    }
    if has_search {
        params_list.push((":search", &like_str as &dyn rusqlite::ToSql));
    }

    let count: i64 = stmt.query_row(&params_list[..], |row| row.get(0)).map_err(|e| e.to_string())?;
    Ok(count)
}

pub fn clear_audit_logs() -> Result<(), String> {
    let conn = get_conn()?;
    conn.execute("DELETE FROM audit_logs", [])
        .map_err(|e| format!("Failed to clear audit logs: {}", e))?;
    Ok(())
}

#[allow(dead_code)]
pub fn servers_get_name_sync(id: String) -> Result<String, String> {
    let raw = servers_get_raw(id)?;
    let val: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(val["name"].as_str().unwrap_or("Unknown").to_string())
}

// ============================================================================
// SSH Keys (ssh_keys 表)
// ============================================================================

/// serde 默认值：密钥类型，缺省时回退为 private（兼容旧数据/旧前端）。
fn default_key_type() -> String {
    "private".to_string()
}

/// 返回给前端的 SshKey 结构。
/// - `private_key_content` / `certificate_content` 通过 `skip_serializing` 不返回前端
///   （前端无需查看密钥内容，只显示路径或文件名）。
/// - `private_key_passphrase` 返回占位符 `•••••`（如有），由 `mask_ssh_key_secrets` 处理。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    pub id: String,
    pub name: String,
    /// 密钥类型：'private'（私钥型）| 'certificate'（证书型）
    #[serde(default = "default_key_type")]
    pub key_type: String,
    pub private_key_path: Option<String>,
    /// 私钥内容（加密存储；不返回前端）
    #[serde(skip_serializing)]
    pub private_key_content: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub public_key: Option<String>,
    pub certificate_path: Option<String>,
    /// 证书内容（加密存储；不返回前端）
    #[serde(skip_serializing)]
    pub certificate_content: Option<String>,
    pub notes: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 前端传入的新建 SshKey 输入。
/// `private_key_content` / `certificate_content` / `private_key_passphrase` 为明文，
/// 由 `ssh_keys_add` 加密后入库。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyInput {
    pub id: String,
    pub name: String,
    #[serde(default = "default_key_type")]
    pub key_type: String,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub private_key_content: Option<String>,
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
    #[serde(default)]
    pub public_key: Option<String>,
    #[serde(default)]
    pub certificate_path: Option<String>,
    #[serde(default)]
    pub certificate_content: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// 前端传入的更新 SshKey 输入（部分字段）。
/// - `private_key_passphrase` / `private_key_content` / `certificate_content`
///   如为 `PASSWORD_PLACEHOLDER` 则跳过更新（表示"不修改"）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyUpdate {
    pub name: Option<String>,
    pub key_type: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub private_key_content: Option<String>,
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
    #[serde(default)]
    pub public_key: Option<String>,
    #[serde(default)]
    pub certificate_path: Option<String>,
    #[serde(default)]
    pub certificate_content: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// 内部使用：从 DB 读取的完整行（含加密的 content 字段）。
/// SSH 连接时由 `ssh_keys_get_raw` 解密后返回。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyRaw {
    pub id: String,
    pub name: String,
    pub key_type: String,
    pub private_key_path: Option<String>,
    pub private_key_content: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub public_key: Option<String>,
    pub certificate_path: Option<String>,
    pub certificate_content: Option<String>,
    pub notes: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

// ============================================================================
// 代理（Proxy）—— 遗留的独立资源数据结构。
// 新连接流程仅使用 Server.proxy_config 内联配置；这些 CRUD 保留用于旧数据库兼容。
// ============================================================================

/// 返回给前端的 Proxy 结构。
/// - `password` / `private_key_passphrase` 返回占位符 `•••••`（如有），由 `mask_proxy_secrets` 处理。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Proxy {
    pub id: String,
    pub name: String,
    /// 代理类型：'ssh_jump'（SSH 跳板机，默认）| 'socks5'（预留）| 'http'（预留）
    #[serde(default = "default_proxy_type")]
    pub proxy_type: String,
    /// 代理服务器地址
    pub host: String,
    /// 代理服务器端口
    pub port: i32,
    /// SSH Jump 认证：用户名（仅 proxy_type=ssh_jump 时使用）
    #[serde(default)]
    pub username: Option<String>,
    /// SSH Jump 认证方式：password / privateKey / sshAgent / certificate
    #[serde(default = "default_auth_type")]
    pub auth_type: Option<String>,
    /// SSH Jump 认证：密码（加密存储；返回前端时替换为占位符）
    #[serde(default)]
    pub password: Option<String>,
    /// SSH Jump 认证：私钥路径
    #[serde(default)]
    pub private_key_path: Option<String>,
    /// SSH Jump 认证：私钥 passphrase（加密存储；返回前端时替换为占位符）
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
    /// SSH Jump 认证：SSH Agent 身份（OpenSSH 公钥字符串）
    #[serde(default)]
    pub agent_identity: Option<String>,
    /// SSH Jump 认证：证书文件路径
    #[serde(default)]
    pub certificate_path: Option<String>,
    /// SSH Jump 认证：关联的 ssh_keys 表 id（content-based 连接）
    #[serde(default)]
    pub ssh_key_id: Option<String>,
    /// SOCKS5/HTTP 代理认证：用户名（仅 proxy_type=socks5/http 时使用）
    #[serde(default)]
    pub proxy_username: Option<String>,
    /// SOCKS5/HTTP 代理认证：密码（加密存储；返回前端时替换为占位符）
    #[serde(default)]
    pub proxy_password: Option<String>,
    /// 备注
    #[serde(default)]
    pub notes: Option<String>,
    /// 连接超时（秒）
    #[serde(default = "default_proxy_timeout")]
    pub connection_timeout: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 前端传入的新建 Proxy 输入。
/// `password` / `private_key_passphrase` / `proxy_password` 为明文，由 `proxies_add` 加密后入库。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyInput {
    pub id: String,
    pub name: String,
    #[serde(default = "default_proxy_type")]
    pub proxy_type: String,
    pub host: String,
    pub port: Option<i32>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default = "default_auth_type")]
    pub auth_type: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
    #[serde(default)]
    pub agent_identity: Option<String>,
    #[serde(default)]
    pub certificate_path: Option<String>,
    #[serde(default)]
    pub ssh_key_id: Option<String>,
    #[serde(default)]
    pub proxy_username: Option<String>,
    #[serde(default)]
    pub proxy_password: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub connection_timeout: Option<i32>,
}

/// 前端传入的更新 Proxy 输入（部分字段）。
/// - `password` / `private_key_passphrase` / `proxy_password`
///   如为 `PASSWORD_PLACEHOLDER` 则跳过更新（表示"不修改"）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyUpdate {
    pub name: Option<String>,
    pub proxy_type: Option<String>,
    pub host: Option<String>,
    pub port: Option<i32>,
    pub username: Option<String>,
    pub auth_type: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub private_key_passphrase: Option<String>,
    #[serde(default)]
    pub agent_identity: Option<String>,
    #[serde(default)]
    pub certificate_path: Option<String>,
    #[serde(default)]
    pub ssh_key_id: Option<String>,
    pub proxy_username: Option<String>,
    #[serde(default)]
    pub proxy_password: Option<String>,
    pub notes: Option<String>,
    pub connection_timeout: Option<i32>,
}

/// 内部使用：从 DB 读取的完整行（含加密字段）。
/// SSH 连接时由 `proxies_get_raw` 解密后返回，供构造 JumpConfig 使用。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRaw {
    pub id: String,
    pub name: String,
    pub proxy_type: String,
    pub host: String,
    pub port: i32,
    pub username: Option<String>,
    pub auth_type: Option<String>,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub private_key_passphrase: Option<String>,
    pub agent_identity: Option<String>,
    pub certificate_path: Option<String>,
    pub ssh_key_id: Option<String>,
    pub proxy_username: Option<String>,
    pub proxy_password: Option<String>,
    pub notes: Option<String>,
    pub connection_timeout: i32,
    pub created_at: i64,
    pub updated_at: i64,
}

fn default_proxy_type() -> String {
    "ssh_jump".to_string()
}

fn default_proxy_timeout() -> i32 {
    30
}

fn row_to_ssh_key(row: &rusqlite::Row<'_>) -> SqliteResult<SshKey> {
    Ok(SshKey {
        id: row.get("id")?,
        name: row.get("name")?,
        key_type: row.get::<_, Option<String>>("key_type")?
            .unwrap_or_else(|| "private".to_string()),
        private_key_path: row.get("private_key_path")?,
        private_key_content: row.get("private_key_content")?,
        private_key_passphrase: row.get("private_key_passphrase")?,
        public_key: row.get("public_key")?,
        certificate_path: row.get("certificate_path")?,
        certificate_content: row.get("certificate_content")?,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// 用 `•••••` 占位符替换 passphrase，避免明文返回前端。
fn mask_ssh_key_secrets(mut key: SshKey) -> SshKey {
    if key.private_key_passphrase.is_some() {
        key.private_key_passphrase = Some(PASSWORD_PLACEHOLDER.to_string());
    }
    key
}

/// 列出所有 SSH 密钥（passphrase 占位符替换，content 不返回）。
pub fn ssh_keys_list() -> Result<String, String> {
    let conn = get_conn()?;

    let mut stmt = conn
        .prepare("SELECT * FROM ssh_keys ORDER BY name ASC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let keys: Vec<SshKey> = stmt
        .query_map([], row_to_ssh_key)
        .map_err(|e| format!("Query failed: {}", e))?
        .filter_map(|r| r.ok())
        .map(mask_ssh_key_secrets)
        .collect();

    serde_json::to_string(&keys)
        .map_err(|e| format!("Serialization failed: {}", e))
}

/// List all SSH keys with decrypted content and passphrase for zero-knowledge cloud sync.
pub fn ssh_keys_list_for_sync() -> Result<String, String> {
    let conn = get_conn()?;

    let mut stmt = conn
        .prepare("SELECT * FROM ssh_keys ORDER BY name ASC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let mk = master_key();
    let keys: Vec<SshKeyInput> = stmt
        .query_map([], row_to_ssh_key)
        .map_err(|e| format!("Query failed: {}", e))?
        .filter_map(|r| r.ok())
        .map(|k| {
            let decrypt = |field: &Option<String>| -> Option<String> {
                match field {
                    Some(s) if !s.is_empty() && s != PASSWORD_PLACEHOLDER => {
                        crypto::decrypt_password(s, mk).ok()
                    }
                    _ => None,
                }
            };
            SshKeyInput {
                id: k.id,
                name: k.name,
                key_type: k.key_type,
                private_key_path: k.private_key_path,
                private_key_content: decrypt(&k.private_key_content),
                private_key_passphrase: decrypt(&k.private_key_passphrase),
                public_key: k.public_key,
                certificate_path: k.certificate_path,
                certificate_content: decrypt(&k.certificate_content),
                notes: k.notes,
            }
        })
        .collect();

    serde_json::to_string(&keys)
        .map_err(|e| format!("Serialization failed: {}", e))
}

/// 获取单个 SSH 密钥的完整内容（解密后），仅供 SSH 连接内部使用。
/// 不返回前端。
pub fn ssh_keys_get_raw(id: &str) -> Result<SshKeyRaw, String> {
    let conn = get_conn()?;

    let mut stmt = conn
        .prepare("SELECT * FROM ssh_keys WHERE id = ?1")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let key = stmt
        .query_row(params![id], row_to_ssh_key)
        .map_err(|e| format!("SSH key not found: {}", e))?;

    // 解密 content 与 passphrase
    let mk = master_key();
    let decrypt = |field: &Option<String>| -> Result<Option<String>, String> {
        match field {
            Some(s) if !s.is_empty() => {
                crypto::decrypt_password(s, mk).map(Some).map_err(|e| e.to_string())
            }
            _ => Ok(None),
        }
    };

    let raw = SshKeyRaw {
        id: key.id,
        name: key.name,
        key_type: key.key_type,
        private_key_path: key.private_key_path,
        private_key_content: decrypt(&key.private_key_content)?,
        private_key_passphrase: decrypt(&key.private_key_passphrase)?,
        public_key: key.public_key,
        certificate_path: key.certificate_path,
        certificate_content: decrypt(&key.certificate_content)?,
        notes: key.notes,
        created_at: key.created_at,
        updated_at: key.updated_at,
    };

    Ok(raw)
}

/// 新增 SSH 密钥。content / passphrase 加密后入库。
pub fn ssh_keys_add(input: SshKeyInput) -> Result<String, String> {
    let conn = get_conn()?;
    let now = Utc::now().timestamp_millis();

    let encrypt = |plain: &Option<String>| -> Result<Option<String>, String> {
        match plain {
            Some(s) if !s.is_empty() => crypto::encrypt_password(s, master_key())
                .map(Some)
                .map_err(|e| e.to_string()),
            _ => Ok(None),
        }
    };

    let encrypted_passphrase = encrypt(&input.private_key_passphrase)?;
    let encrypted_priv_content = encrypt(&input.private_key_content)?;
    let encrypted_cert_content = encrypt(&input.certificate_content)?;

    let key_type = if input.key_type.is_empty() {
        "private".to_string()
    } else {
        input.key_type
    };

    conn.execute(
        "INSERT INTO ssh_keys (id, name, key_type, private_key_path, private_key_content, private_key_passphrase, public_key, certificate_path, certificate_content, notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            input.id,
            input.name,
            key_type,
            input.private_key_path,
            encrypted_priv_content,
            encrypted_passphrase,
            input.public_key,
            input.certificate_path,
            encrypted_cert_content,
            input.notes,
            now,
            now,
        ],
    )
    .map_err(|e| format!("Failed to insert ssh key: {}", e))?;

    Ok(input.id)
}

/// 更新 SSH 密钥（部分字段）。
/// - `private_key_passphrase` / `private_key_content` / `certificate_content`
///   为 `PASSWORD_PLACEHOLDER` 时跳过（表示"不修改"）。
/// - 这些字段的空字符串视为"清空"。
pub fn ssh_keys_update(id: &str, update: SshKeyUpdate) -> Result<(), String> {
    let conn = get_conn()?;
    let now = Utc::now().timestamp_millis();

    let mk = master_key();
    let mut set_clauses: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref name) = update.name {
        set_clauses.push("name = ?".to_string());
        param_values.push(Box::new(name.clone()));
    }
    if let Some(ref key_type) = update.key_type {
        set_clauses.push("key_type = ?".to_string());
        param_values.push(Box::new(key_type.clone()));
    }
    if let Some(ref private_key_path) = update.private_key_path {
        let trimmed = private_key_path.trim();
        let value: Option<String> = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
        set_clauses.push("private_key_path = ?".to_string());
        param_values.push(Box::new(value));
    }
    if let Some(ref public_key) = update.public_key {
        let trimmed = public_key.trim();
        let value: Option<String> = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
        set_clauses.push("public_key = ?".to_string());
        param_values.push(Box::new(value));
    }
    if let Some(ref certificate_path) = update.certificate_path {
        let trimmed = certificate_path.trim();
        let value: Option<String> = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
        set_clauses.push("certificate_path = ?".to_string());
        param_values.push(Box::new(value));
    }
    if let Some(ref notes) = update.notes {
        let trimmed = notes.trim();
        let value: Option<String> = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
        set_clauses.push("notes = ?".to_string());
        param_values.push(Box::new(value));
    }

    // 加密字段：passphrase / private_key_content / certificate_content
    // PASSWORD_PLACEHOLDER 表示"不修改"，空字符串表示"清空"
    let encrypt_or_skip = |field: &Option<String>, mk: &crate::crypto::MasterKey|
        -> Result<Option<Option<String>>, String> {
        match field {
            None => Ok(None), // 未提供该字段
            Some(s) if s == PASSWORD_PLACEHOLDER => Ok(None), // 不修改
            Some(s) if s.is_empty() => Ok(Some(None)), // 清空
            Some(s) => crypto::encrypt_password(s, mk)
                .map(|c| Some(Some(c)))
                .map_err(|e| e.to_string()),
        }
    };

    if let Some(v) = encrypt_or_skip(&update.private_key_passphrase, mk)? {
        set_clauses.push("private_key_passphrase = ?".to_string());
        param_values.push(Box::new(v));
    }
    if let Some(v) = encrypt_or_skip(&update.private_key_content, mk)? {
        set_clauses.push("private_key_content = ?".to_string());
        param_values.push(Box::new(v));
    }
    if let Some(v) = encrypt_or_skip(&update.certificate_content, mk)? {
        set_clauses.push("certificate_content = ?".to_string());
        param_values.push(Box::new(v));
    }

    // Always update updated_at
    set_clauses.push("updated_at = ?".to_string());
    param_values.push(Box::new(now));

    if set_clauses.is_empty() {
        return Ok(());
    }

    let sql = format!("UPDATE ssh_keys SET {} WHERE id = ?", set_clauses.join(", "));
    param_values.push(Box::new(id.to_string()));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    conn.execute(&sql, param_refs.as_slice())
        .map_err(|e| format!("Failed to update ssh key: {}", e))?;

    Ok(())
}

/// 删除 SSH 密钥。
pub fn ssh_keys_delete(id: &str) -> Result<(), String> {
    let conn = get_conn()?;
    conn.execute("DELETE FROM ssh_keys WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete ssh key: {}", e))?;
    Ok(())
}

// ============================================================================
// 代理（Proxy）CRUD —— P0-1 重构
// ============================================================================

fn row_to_proxy(row: &rusqlite::Row<'_>) -> SqliteResult<Proxy> {
    Ok(Proxy {
        id: row.get("id")?,
        name: row.get("name")?,
        proxy_type: row.get::<_, Option<String>>("proxy_type")?
            .unwrap_or_else(|| "ssh_jump".to_string()),
        host: row.get("host")?,
        port: row.get::<_, Option<i32>>("port")?.unwrap_or(22),
        username: row.get("username")?,
        auth_type: row.get::<_, Option<String>>("auth_type")?
            .filter(|s| !s.is_empty()),
        password: row.get("password")?,
        private_key_path: row.get("private_key_path")?,
        private_key_passphrase: row.get("private_key_passphrase")?,
        agent_identity: row.get("agent_identity")?,
        certificate_path: row.get("certificate_path")?,
        ssh_key_id: row.get("ssh_key_id")?,
        proxy_username: row.get("proxy_username")?,
        proxy_password: row.get("proxy_password")?,
        notes: row.get("notes")?,
        connection_timeout: row.get::<_, Option<i32>>("connection_timeout")?
            .unwrap_or(30),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// 用 `•••••` 占位符替换 password / private_key_passphrase / proxy_password，
/// 避免明文返回前端。
fn mask_proxy_secrets(mut p: Proxy) -> Proxy {
    if p.password.is_some() {
        p.password = Some(PASSWORD_PLACEHOLDER.to_string());
    }
    if p.private_key_passphrase.is_some() {
        p.private_key_passphrase = Some(PASSWORD_PLACEHOLDER.to_string());
    }
    if p.proxy_password.is_some() {
        p.proxy_password = Some(PASSWORD_PLACEHOLDER.to_string());
    }
    p
}

/// 列出所有代理（敏感字段替换为占位符）。
pub fn proxies_list() -> Result<String, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare("SELECT * FROM proxies ORDER BY name ASC")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;
    let items: Vec<Proxy> = stmt
        .query_map([], row_to_proxy)
        .map_err(|e| format!("Query failed: {}", e))?
        .filter_map(|r| r.ok())
        .map(mask_proxy_secrets)
        .collect();
    serde_json::to_string(&items)
        .map_err(|e| format!("Serialization failed: {}", e))
}

/// 获取单个代理的完整内容（解密后），仅供 SSH 连接内部使用，不返回前端。
pub fn proxies_get_raw(id: &str) -> Result<ProxyRaw, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare("SELECT * FROM proxies WHERE id = ?1")
        .map_err(|e| format!("Failed to prepare query: {}", e))?;
    let p = stmt
        .query_row(params![id], row_to_proxy)
        .map_err(|e| format!("Proxy not found: {}", e))?;

    let mk = master_key();
    let decrypt = |field: &Option<String>| -> Result<Option<String>, String> {
        match field {
            Some(s) if !s.is_empty() => {
                crypto::decrypt_password(s, mk).map(Some).map_err(|e| e.to_string())
            }
            _ => Ok(None),
        }
    };

    Ok(ProxyRaw {
        id: p.id,
        name: p.name,
        proxy_type: p.proxy_type,
        host: p.host,
        port: p.port,
        username: p.username,
        auth_type: p.auth_type,
        password: decrypt(&p.password)?,
        private_key_path: p.private_key_path,
        private_key_passphrase: decrypt(&p.private_key_passphrase)?,
        agent_identity: p.agent_identity,
        certificate_path: p.certificate_path,
        ssh_key_id: p.ssh_key_id,
        proxy_username: p.proxy_username,
        proxy_password: decrypt(&p.proxy_password)?,
        notes: p.notes,
        connection_timeout: p.connection_timeout,
        created_at: p.created_at,
        updated_at: p.updated_at,
    })
}

/// 新增代理。password / private_key_passphrase / proxy_password 加密后入库。
pub fn proxies_add(input: ProxyInput) -> Result<String, String> {
    let conn = get_conn()?;
    let now = Utc::now().timestamp_millis();

    let encrypt = |plain: &Option<String>| -> Result<Option<String>, String> {
        match plain {
            Some(s) if !s.is_empty() => crypto::encrypt_password(s, master_key())
                .map(Some)
                .map_err(|e| e.to_string()),
            _ => Ok(None),
        }
    };
    let encrypted_password = encrypt(&input.password)?;
    let encrypted_passphrase = encrypt(&input.private_key_passphrase)?;
    let encrypted_proxy_password = encrypt(&input.proxy_password)?;

    let proxy_type = if input.proxy_type.is_empty() {
        "ssh_jump".to_string()
    } else {
        input.proxy_type
    };
    let port = input.port.unwrap_or(22);
    let connection_timeout = input.connection_timeout.unwrap_or(30);

    conn.execute(
        "INSERT INTO proxies (id, name, proxy_type, host, port, username, auth_type, password, private_key_path, private_key_passphrase, agent_identity, certificate_path, ssh_key_id, proxy_username, proxy_password, notes, connection_timeout, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
        params![
            input.id,
            input.name,
            proxy_type,
            input.host,
            port,
            input.username,
            input.auth_type.unwrap_or_else(|| "password".to_string()),
            encrypted_password,
            input.private_key_path,
            encrypted_passphrase,
            input.agent_identity,
            input.certificate_path,
            input.ssh_key_id,
            input.proxy_username,
            encrypted_proxy_password,
            input.notes,
            connection_timeout,
            now,
            now,
        ],
    )
    .map_err(|e| format!("Failed to insert proxy: {}", e))?;

    Ok(input.id)
}

/// 更新代理（部分字段）。
/// password / private_key_passphrase / proxy_password
/// 为 `PASSWORD_PLACEHOLDER` 时跳过（表示"不修改"）。
pub fn proxies_update(id: &str, update: ProxyUpdate) -> Result<(), String> {
    let conn = get_conn()?;
    let now = Utc::now().timestamp_millis();
    let mk = master_key();

    let mut set_clauses: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref name) = update.name {
        set_clauses.push("name = ?".to_string());
        param_values.push(Box::new(name.clone()));
    }
    if let Some(ref proxy_type) = update.proxy_type {
        set_clauses.push("proxy_type = ?".to_string());
        param_values.push(Box::new(proxy_type.clone()));
    }
    if let Some(ref host) = update.host {
        set_clauses.push("host = ?".to_string());
        param_values.push(Box::new(host.clone()));
    }
    if let Some(port) = update.port {
        set_clauses.push("port = ?".to_string());
        param_values.push(Box::new(port));
    }
    if let Some(ref username) = update.username {
        let trimmed = username.trim();
        let value: Option<String> = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
        set_clauses.push("username = ?".to_string());
        param_values.push(Box::new(value));
    }
    if let Some(ref auth_type) = update.auth_type {
        set_clauses.push("auth_type = ?".to_string());
        param_values.push(Box::new(auth_type.clone()));
    }
    if let Some(ref private_key_path) = update.private_key_path {
        let trimmed = private_key_path.trim();
        let value: Option<String> = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
        set_clauses.push("private_key_path = ?".to_string());
        param_values.push(Box::new(value));
    }
    if let Some(ref agent_identity) = update.agent_identity {
        let trimmed = agent_identity.trim();
        let value: Option<String> = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
        set_clauses.push("agent_identity = ?".to_string());
        param_values.push(Box::new(value));
    }
    if let Some(ref certificate_path) = update.certificate_path {
        let trimmed = certificate_path.trim();
        let value: Option<String> = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
        set_clauses.push("certificate_path = ?".to_string());
        param_values.push(Box::new(value));
    }
    if let Some(ref ssh_key_id) = update.ssh_key_id {
        let trimmed = ssh_key_id.trim();
        let value: Option<String> = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
        set_clauses.push("ssh_key_id = ?".to_string());
        param_values.push(Box::new(value));
    }
    if let Some(ref proxy_username) = update.proxy_username {
        let trimmed = proxy_username.trim();
        let value: Option<String> = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
        set_clauses.push("proxy_username = ?".to_string());
        param_values.push(Box::new(value));
    }
    if let Some(ref notes) = update.notes {
        let trimmed = notes.trim();
        let value: Option<String> = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
        set_clauses.push("notes = ?".to_string());
        param_values.push(Box::new(value));
    }
    if let Some(connection_timeout) = update.connection_timeout {
        set_clauses.push("connection_timeout = ?".to_string());
        param_values.push(Box::new(connection_timeout));
    }

    // 加密字段：password / private_key_passphrase / proxy_password
    // PASSWORD_PLACEHOLDER 表示"不修改"，空字符串表示"清空"
    let encrypt_or_skip = |field: &Option<String>, mk: &crate::crypto::MasterKey|
        -> Result<Option<Option<String>>, String> {
        match field {
            None => Ok(None),
            Some(s) if s == PASSWORD_PLACEHOLDER => Ok(None),
            Some(s) if s.is_empty() => Ok(Some(None)),
            Some(s) => crypto::encrypt_password(s, mk)
                .map(|c| Some(Some(c)))
                .map_err(|e| e.to_string()),
        }
    };

    if let Some(v) = encrypt_or_skip(&update.password, mk)? {
        set_clauses.push("password = ?".to_string());
        param_values.push(Box::new(v));
    }
    if let Some(v) = encrypt_or_skip(&update.private_key_passphrase, mk)? {
        set_clauses.push("private_key_passphrase = ?".to_string());
        param_values.push(Box::new(v));
    }
    if let Some(v) = encrypt_or_skip(&update.proxy_password, mk)? {
        set_clauses.push("proxy_password = ?".to_string());
        param_values.push(Box::new(v));
    }

    set_clauses.push("updated_at = ?".to_string());
    param_values.push(Box::new(now));

    if set_clauses.is_empty() {
        return Ok(());
    }

    let sql = format!("UPDATE proxies SET {} WHERE id = ?", set_clauses.join(", "));
    param_values.push(Box::new(id.to_string()));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, param_refs.as_slice())
        .map_err(|e| format!("Failed to update proxy: {}", e))?;
    Ok(())
}

/// 删除代理。
pub fn proxies_delete(id: &str) -> Result<(), String> {
    let conn = get_conn()?;
    conn.execute("DELETE FROM proxies WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete proxy: {}", e))?;
    Ok(())
}

// ============== 隧道（Tunnel）遗留资源 CRUD ==============
// 新连接流程仅使用 Server.tunnels_config 内联配置；这些结构保留用于旧数据库兼容。

fn default_tunnel_type() -> String {
    "local".to_string()
}

fn default_bind_address() -> String {
    "127.0.0.1".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tunnel {
    pub id: String,
    pub name: String,
    /// 隧道类型：'local'（本地端口转发 -L）| 'remote'（远程端口转发 -R）| 'dynamic'（动态 SOCKS -D）
    #[serde(default = "default_tunnel_type")]
    pub tunnel_type: String,
    /// 本地监听地址（如 '127.0.0.1' 或 '0.0.0.0'）
    #[serde(default = "default_bind_address")]
    pub bind_address: String,
    /// 本地监听端口
    pub local_port: i32,
    /// 远程目标主机（dynamic 类型为空）
    #[serde(default)]
    pub remote_host: Option<String>,
    /// 远程目标端口（dynamic 类型为空）
    #[serde(default)]
    pub remote_port: Option<i32>,
    /// 备注
    #[serde(default)]
    pub notes: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunnelInput {
    pub id: String,
    pub name: String,
    #[serde(default = "default_tunnel_type")]
    pub tunnel_type: String,
    #[serde(default = "default_bind_address")]
    pub bind_address: String,
    pub local_port: i32,
    #[serde(default)]
    pub remote_host: Option<String>,
    #[serde(default)]
    pub remote_port: Option<i32>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TunnelUpdate {
    pub name: Option<String>,
    pub tunnel_type: Option<String>,
    pub bind_address: Option<String>,
    pub local_port: Option<i32>,
    pub remote_host: Option<String>,
    pub remote_port: Option<i32>,
    pub notes: Option<String>,
}

fn row_to_tunnel(row: &rusqlite::Row<'_>) -> SqliteResult<Tunnel> {
    Ok(Tunnel {
        id: row.get("id")?,
        name: row.get("name")?,
        tunnel_type: row.get::<_, Option<String>>("tunnel_type")?
            .unwrap_or_else(|| "local".to_string()),
        bind_address: row.get::<_, Option<String>>("bind_address")?
            .unwrap_or_else(|| "127.0.0.1".to_string()),
        local_port: row.get("local_port")?,
        remote_host: row.get("remote_host")?,
        remote_port: row.get("remote_port")?,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// 列出所有隧道（JSON 字符串）
pub fn tunnels_list() -> Result<String, String> {
    let conn = get_conn()?;
    let mut stmt = conn
        .prepare("SELECT * FROM tunnels ORDER BY created_at DESC")
        .map_err(|e| format!("Failed to prepare tunnels list: {}", e))?;
    let tunnels: Result<Vec<Tunnel>, _> = stmt
        .query_map([], row_to_tunnel)
        .map_err(|e| format!("Failed to query tunnels: {}", e))?
        .collect();
    let tunnels = tunnels.map_err(|e| format!("Failed to collect tunnels: {}", e))?;
    serde_json::to_string(&tunnels).map_err(|e| format!("Failed to serialize tunnels: {}", e))
}

/// 获取隧道原始数据（未脱敏，仅后端使用）
pub fn tunnels_get_raw(id: &str) -> Result<Tunnel, String> {
    let conn = get_conn()?;
    conn.query_row("SELECT * FROM tunnels WHERE id = ?1", params![id], row_to_tunnel)
        .map_err(|e| format!("Failed to get tunnel {}: {}", id, e))
}

/// 新增隧道
pub fn tunnels_add(input: TunnelInput) -> Result<String, String> {
    let conn = get_conn()?;
    let now = Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO tunnels (id, name, tunnel_type, bind_address, local_port, remote_host, remote_port, notes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            input.id,
            input.name,
            input.tunnel_type,
            input.bind_address,
            input.local_port,
            input.remote_host,
            input.remote_port,
            input.notes,
            now,
            now,
        ],
    )
    .map_err(|e| format!("Failed to insert tunnel: {}", e))?;
    Ok(input.id)
}

/// 更新隧道
pub fn tunnels_update(id: &str, update: TunnelUpdate) -> Result<(), String> {
    let conn = get_conn()?;
    let now = Utc::now().timestamp_millis();
    let mut set_clauses: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(v) = update.name {
        set_clauses.push("name = ?".to_string());
        param_values.push(Box::new(v));
    }
    if let Some(v) = update.tunnel_type {
        set_clauses.push("tunnel_type = ?".to_string());
        param_values.push(Box::new(v));
    }
    if let Some(v) = update.bind_address {
        set_clauses.push("bind_address = ?".to_string());
        param_values.push(Box::new(v));
    }
    if let Some(v) = update.local_port {
        set_clauses.push("local_port = ?".to_string());
        param_values.push(Box::new(v));
    }
    if let Some(v) = update.remote_host {
        set_clauses.push("remote_host = ?".to_string());
        param_values.push(Box::new(v));
    }
    if let Some(v) = update.remote_port {
        set_clauses.push("remote_port = ?".to_string());
        param_values.push(Box::new(v));
    }
    if let Some(v) = update.notes {
        set_clauses.push("notes = ?".to_string());
        param_values.push(Box::new(v));
    }
    set_clauses.push("updated_at = ?".to_string());
    param_values.push(Box::new(now));

    if set_clauses.is_empty() {
        return Ok(());
    }

    let sql = format!("UPDATE tunnels SET {} WHERE id = ?", set_clauses.join(", "));
    param_values.push(Box::new(id.to_string()));

    let params_ref: Vec<&dyn rusqlite::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_ref.as_slice())
        .map_err(|e| format!("Failed to update tunnel: {}", e))?;
    Ok(())
}

/// 删除隧道
pub fn tunnels_delete(id: &str) -> Result<(), String> {
    let conn = get_conn()?;
    conn.execute("DELETE FROM tunnels WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete tunnel: {}", e))?;
    Ok(())
}

/// 批量获取隧道（用于连接时加载关联的隧道列表）
pub fn tunnels_get_by_ids(ids: &[String]) -> Result<Vec<Tunnel>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let conn = get_conn()?;
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("SELECT * FROM tunnels WHERE id IN ({})", placeholders);
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("Failed to prepare tunnels: {}", e))?;
    let params_ref: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    let tunnels: Result<Vec<Tunnel>, _> = stmt
        .query_map(params_ref.as_slice(), row_to_tunnel)
        .map_err(|e| format!("Failed to query tunnels: {}", e))?
        .collect();
    tunnels.map_err(|e| format!("Failed to collect tunnels: {}", e))
}

