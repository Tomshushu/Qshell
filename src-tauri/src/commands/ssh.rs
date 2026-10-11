// SSH 连接管理 commands
//
// 重构要点：
// 1. 状态权威来源已转移到 SshManager（连接池），不再依赖 DB status 字段
// 2. 30s 防并发已迁移到 SshManager.connect()（基于 JoinHandle + Notify 等待）
// 3. 新增 ssh_get_state 暴露状态机给前端
// 4. DB 仅保留 last_accessed_at / last_error / os_type / os_info 等持久化数据

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

use crate::crypto;
use crate::db;
use crate::ssh::connection::test_tcp_connection;
use crate::ssh::manager::SshManager;
use crate::ssh::state::{ConnectionState, SshErrorKind};

use super::{
    extract_base_server_id, is_secondary_connection, validate_server_id, CommandResult,
    DetectOsResult, OperationResult,
};

/// 从数据库读取服务器配置（含解密后的密码）
pub async fn load_server_config(server_id: &str) -> Result<db::Server, String> {
    let check_id = extract_base_server_id(server_id);
    let id = check_id.to_string();
    let t0 = std::time::Instant::now();
    let raw_json = tokio::task::spawn_blocking(move || db::servers_get_raw(id))
        .await
        .map_err(|e| format!("Task join error: {}", e))??;
    tracing::info!("[SSH Perf] {} load_server_config DB 查询: {:?}", server_id, t0.elapsed());
    let mut server: db::Server = serde_json::from_str(&raw_json)
        .map_err(|e| format!("Failed to parse server: {}", e))?;
    tracing::info!("[SSH Perf] {} load_server_config JSON 解析: {:?}", server_id, t0.elapsed());

    // 解密密码
    if let Some(ref enc) = server.password {
        if !enc.is_empty() {
            let dec_start = std::time::Instant::now();
            let decrypted = crypto::decrypt_password(enc, db::master_key())
                .map_err(|e| format!("Password decryption failed: {}", e))?;
            server.password = Some(decrypted);
            tracing::info!("[SSH Perf] {} load_server_config 密码解密: {:?}", server_id, dec_start.elapsed());
        }
    }
    // 解密 passphrase
    if let Some(ref enc) = server.private_key_passphrase {
        if !enc.is_empty() {
            let dec_start = std::time::Instant::now();
            let decrypted = crypto::decrypt_password(enc, db::master_key())
                .map_err(|e| format!("Passphrase decryption failed: {}", e))?;
            server.private_key_passphrase = Some(decrypted);
            tracing::info!("[SSH Perf] {} load_server_config passphrase 解密: {:?}", server_id, dec_start.elapsed());
        }
    }
    tracing::info!("[SSH Perf] {} load_server_config 总耗时: {:?}", server_id, t0.elapsed());
    Ok(server)
}

/// 从 ssh_keys 表加载解密后的密钥原始数据（含明文 passphrase / content）
///
/// 用于 content-based 连接：server.ssh_key_id 关联的密钥记录被解密后，
/// 构造 AuthMethod::PrivateKeyContent / CertificateContent 进行连接。
async fn load_key_raw_for_connect(key_id: &str) -> Result<db::SshKeyRaw, String> {
    let id = key_id.to_string();
    tokio::task::spawn_blocking(move || db::ssh_keys_get_raw(&id))
        .await
        .map_err(|e| format!("Task join error: {}", e))?
}

/// 根据认证方式 + 解密后的密钥原始数据，构造 content-based AuthMethod
///
/// - `privateKey` → `PrivateKeyContent`（必须含私钥内容）
/// - `certificate` → `CertificateContent`（必须含私钥 + 证书内容）
/// - 其他认证方式（password/sshAgent）不应走此路径，返回错误
#[allow(clippy::result_large_err)]
fn build_auth_method_from_key(
    auth_type: &str,
    key: &db::SshKeyRaw,
) -> Result<crate::ssh::connection::AuthMethod, OperationResult> {
    use crate::ssh::connection::AuthMethod;

    let passphrase = key.private_key_passphrase
        .as_ref()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());

    let private_key_content = key.private_key_content
        .as_ref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| OperationResult::fail(format!(
            "密钥 {} 未存储私钥内容，无法走 content-based 连接。请在密钥管理中重新选择私钥文件以读取内容",
            key.name
        )))?
        .clone();

    match auth_type {
        "privateKey" | "private_key" => {
            Ok(AuthMethod::PrivateKeyContent {
                private_key_content,
                private_key_passphrase: passphrase,
            })
        }
        "certificate" | "openssh_cert" | "cert" => {
            let certificate_content = key.certificate_content
                .as_ref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| OperationResult::fail(format!(
                    "密钥 {} 未存储证书内容，无法走证书 content-based 连接。请在密钥管理中重新选择证书文件以读取内容",
                    key.name
                )))?
                .clone();
            Ok(AuthMethod::CertificateContent {
                private_key_content,
                certificate_content,
                private_key_passphrase: passphrase,
            })
        }
        _ => Err(OperationResult::fail(format!(
            "认证方式 {} 不支持 content-based 连接，仅支持 privateKey / certificate",
            auth_type
        ))),
    }
}

/// 当前时间戳（毫秒）
fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// 构造服务器认证方法：content-based 优先（ssh_key_id），否则路径模式
/// 跳板机和目标主机共用此逻辑，避免重复代码
async fn build_auth_method_for_server(
    server: &db::Server,
) -> Result<crate::ssh::connection::AuthMethod, OperationResult> {
    use crate::ssh::connection::AuthMethod;

    // content-based 优先
    if let Some(ref key_id) = server.ssh_key_id {
        if !key_id.is_empty() {
            match load_key_raw_for_connect(key_id).await {
                Ok(key_raw) => {
                    return build_auth_method_from_key(&server.auth_type, &key_raw);
                }
                Err(e) => {
                    tracing::warn!(
                        "[SSH] server {} 关联的 ssh_key {} 加载失败，回退到路径模式: {}",
                        server.id, key_id, e
                    );
                }
            }
        }
    }

    // 路径模式
    match server.auth_type.as_str() {
        "password" => Ok(AuthMethod::Password {
            password: server.password.clone().unwrap_or_default(),
        }),
        "privateKey" | "private_key" => Ok(AuthMethod::PrivateKey {
            private_key_path: server.private_key_path.clone().unwrap_or_default(),
            private_key_passphrase: server.private_key_passphrase.as_ref().filter(|s| !s.is_empty()).cloned(),
        }),
        "sshAgent" | "ssh_agent" => {
            // 解析 agent_identity（OpenSSH 公钥字符串 → PublicKey）
            let identity = if let Some(ref id) = server.agent_identity {
                if id.is_empty() { None } else {
                    russh::keys::parse_public_key_base64(
                        id.split_whitespace().nth(1).unwrap_or(id),
                    )
                        .map(Some)
                        .unwrap_or(None)
                }
            } else { None };
            Ok(AuthMethod::SshAgent { identity })
        }
        "certificate" | "openssh_cert" | "cert" => Ok(AuthMethod::Certificate {
            private_key_path: server.private_key_path.clone().unwrap_or_default(),
            certificate_path: server.certificate_path.clone().unwrap_or_default(),
            private_key_passphrase: server.private_key_passphrase.as_ref().filter(|s| !s.is_empty()).cloned(),
        }),
        _ => Ok(AuthMethod::Password {
            password: server.password.clone().unwrap_or_default(),
        }),
    }
}

/// 为 ProxyRaw 构造 AuthMethod（与 build_auth_method_for_server 同构，但面向代理资源）
/// - content-based 优先（若代理关联了 ssh_key_id）
/// - 否则走路径模式（password/privateKey/sshAgent/certificate）
async fn build_auth_method_for_proxy(
    proxy: &db::ProxyRaw,
) -> Result<crate::ssh::connection::AuthMethod, OperationResult> {
    use crate::ssh::connection::AuthMethod;

    // content-based 优先
    if let Some(ref key_id) = proxy.ssh_key_id {
        if !key_id.is_empty() {
            match load_key_raw_for_connect(key_id).await {
                Ok(key_raw) => {
                    let auth_type = proxy.auth_type.as_deref().unwrap_or("password");
                    return build_auth_method_from_key(auth_type, &key_raw);
                }
                Err(e) => {
                    tracing::warn!(
                        "[SSH] proxy {} 关联的 ssh_key {} 加载失败，回退到路径模式: {}",
                        proxy.id, key_id, e
                    );
                }
            }
        }
    }

    // 路径模式
    let auth_type = proxy.auth_type.as_deref().unwrap_or("password");
    match auth_type {
        "password" => Ok(AuthMethod::Password {
            password: proxy.password.clone().unwrap_or_default(),
        }),
        "privateKey" | "private_key" => Ok(AuthMethod::PrivateKey {
            private_key_path: proxy.private_key_path.clone().unwrap_or_default(),
            private_key_passphrase: proxy.private_key_passphrase.clone(),
        }),
        "sshAgent" | "ssh_agent" => {
            let identity = if let Some(ref id) = proxy.agent_identity {
                if id.is_empty() { None } else {
                    russh::keys::parse_public_key_base64(
                        id.split_whitespace().nth(1).unwrap_or(id),
                    )
                        .map(Some)
                        .unwrap_or(None)
                }
            } else { None };
            Ok(AuthMethod::SshAgent { identity })
        }
        "certificate" | "openssh_cert" | "cert" => Ok(AuthMethod::Certificate {
            private_key_path: proxy.private_key_path.clone().unwrap_or_default(),
            certificate_path: proxy.certificate_path.clone().unwrap_or_default(),
            private_key_passphrase: proxy.private_key_passphrase.clone(),
        }),
        _ => Ok(AuthMethod::Password {
            password: proxy.password.clone().unwrap_or_default(),
        }),
    }
}

/// 测试连接场景下从 config 解析出的字段构造路径模式 AuthMethod
/// （content-based 优先逻辑在调用方处理，此处仅处理路径模式回退）
fn build_test_auth_from_fields(
    auth_type: &str,
    password: &Option<String>,
    private_key_path: &Option<String>,
    private_key_passphrase: &Option<String>,
    agent_identity: &Option<String>,
    certificate_path: &Option<String>,
) -> crate::ssh::connection::AuthMethod {
    use crate::ssh::connection::AuthMethod;
    let clean_pass = private_key_passphrase.as_ref().filter(|s| !s.is_empty()).cloned();
    match auth_type {
        "privateKey" | "private_key" => AuthMethod::PrivateKey {
            private_key_path: private_key_path.clone().unwrap_or_default(),
            private_key_passphrase: clean_pass.clone(),
        },
        "sshAgent" | "ssh_agent" => {
            let identity = if let Some(ref id) = agent_identity {
                if id.is_empty() { None } else {
                    russh::keys::parse_public_key_base64(
                        id.split_whitespace().nth(1).unwrap_or(id),
                    ).map(Some).unwrap_or(None)
                }
            } else { None };
            AuthMethod::SshAgent { identity }
        }
        "certificate" | "openssh_cert" | "cert" => AuthMethod::Certificate {
            private_key_path: private_key_path.clone().unwrap_or_default(),
            certificate_path: certificate_path.clone().unwrap_or_default(),
            private_key_passphrase: clean_pass,
        },
        _ => AuthMethod::Password {
            password: password.clone().unwrap_or_default(),
        },
    }
}

/// 转发规格（来自服务器内联 tunnels_config 的单项解析结果）。
struct InlineTunnelSpec {
    name: String,
    kind: crate::ssh::port_forward::ForwardKind,
    bind_address: String,
    bind_port: u16,
    target_host: String,
    target_port: u16,
}

/// 已解析的内联代理路由：链式跳板机或 TCP 代理
pub enum ResolvedProxyRouting {
    Chain(Vec<crate::ssh::connection::ResolvedJumpHop>),
    Proxy(crate::ssh::connection::ProxyTransportConfig),
}

/// 解析内联代理配置（JSON），支持直连（None）、SOCKS5/HTTP 代理、旧版单跳（ssh_jump）以及多级链式跳板（chain）。
/// 当跳板节点为 reference 模式时，异步从 SQLite 读取对应服务器并解密其凭据。
pub async fn resolve_inline_proxy_routing(
    json: &str,
) -> Result<Option<ResolvedProxyRouting>, String> {
    let v: serde_json::Value = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };

    let ptype = v.get("type").and_then(|x| x.as_str()).unwrap_or("none");
    if ptype == "none" {
        return Ok(None);
    }

    match ptype {
        "socks5" | "http" => {
            if let Some(proxy_raw) = parse_inline_proxy_config(json) {
                let transport = inline_proxy_transport(&proxy_raw);
                Ok(Some(ResolvedProxyRouting::Proxy(transport)))
            } else {
                Ok(None)
            }
        }
        "ssh_jump" => {
            // 向下兼容历史已保存的单级跳板配置
            if let Some(proxy_raw) = parse_inline_proxy_config(json) {
                let proxy_auth = build_auth_method_for_proxy(&proxy_raw)
                    .await
                    .map_err(|op| op.error.unwrap_or_else(|| "跳板机认证配置错误".to_string()))?;
                let hop = crate::ssh::connection::ResolvedJumpHop {
                    host: proxy_raw.host,
                    port: proxy_raw.port as u16,
                    username: proxy_raw.username.unwrap_or_default(),
                    auth: proxy_auth,
                    timeout_secs: proxy_raw.connection_timeout as u32,
                };
                Ok(Some(ResolvedProxyRouting::Chain(vec![hop])))
            } else {
                Ok(None)
            }
        }
        "chain" => {
            let hops_arr = match v.get("hops").and_then(|x| x.as_array()) {
                Some(arr) if !arr.is_empty() => arr,
                _ => return Ok(None),
            };

            let mut resolved_hops = Vec::with_capacity(hops_arr.len());
            let mut visited_server_ids = std::collections::HashSet::new();

            for (idx, hop_val) in hops_arr.iter().enumerate() {
                let mode = hop_val.get("mode").and_then(|x| x.as_str()).unwrap_or("inline");
                if mode == "reference" {
                    let target_id = hop_val.get("targetServerId").and_then(|x| x.as_str()).unwrap_or("").trim();
                    if target_id.is_empty() {
                        return Err(format!("第 {} 级跳板机未选择引用的服务器", idx + 1));
                    }
                    if visited_server_ids.contains(target_id) {
                        return Err(format!("跳板链路中检测到循环依赖 (服务器 ID: {})", target_id));
                    }
                    visited_server_ids.insert(target_id.to_string());

                    let tid = target_id.to_string();
                    let raw_json = tokio::task::spawn_blocking(move || db::servers_get_raw(tid))
                        .await
                        .map_err(|e| format!("加载跳板机配置任务失败: {}", e))?
                        .map_err(|e| format!("第 {} 级跳板机引用的服务器不存在或已被删除: {}", idx + 1, e))?;

                    let ref_server: db::Server = serde_json::from_str(&raw_json)
                        .map_err(|e| format!("解析第 {} 级跳板机配置失败: {}", idx + 1, e))?;

                    let auth = build_auth_method_for_server(&ref_server).await
                        .map_err(|op| op.error.unwrap_or_else(|| format!("第 {} 级跳板机认证配置错误", idx + 1)))?;

                    resolved_hops.push(crate::ssh::connection::ResolvedJumpHop {
                        host: ref_server.host,
                        port: ref_server.port as u16,
                        username: ref_server.username,
                        auth,
                        timeout_secs: ref_server.connection_timeout as u32,
                    });
                } else {
                    let s = |k: &str| -> Option<String> { hop_val.get(k).and_then(|x| x.as_str()).map(|x| x.to_string()) };
                    let host = s("host").unwrap_or_default().trim().to_string();
                    if host.is_empty() {
                        return Err(format!("第 {} 级跳板机的主机地址不能为空", idx + 1));
                    }
                    let port = hop_val.get("port").and_then(|x| x.as_i64()).unwrap_or(22) as u16;
                    let username = s("username").unwrap_or_default();
                    let connection_timeout = hop_val.get("connectionTimeout").and_then(|x| x.as_i64()).unwrap_or(30) as i32;

                    let proxy_raw = db::ProxyRaw {
                        id: format!("inline-hop-{}", idx),
                        name: s("name").unwrap_or_else(|| format!("hop-{}", idx + 1)),
                        proxy_type: "ssh_jump".to_string(),
                        host: host.clone(),
                        port: port as i32,
                        username: Some(username.clone()),
                        auth_type: Some(s("authType").unwrap_or_else(|| "password".to_string())),
                        password: s("password"),
                        private_key_path: s("privateKeyPath"),
                        private_key_passphrase: s("privateKeyPassphrase"),
                        agent_identity: s("agentIdentity"),
                        certificate_path: s("certificatePath"),
                        ssh_key_id: s("sshKeyId"),
                        proxy_username: None,
                        proxy_password: None,
                        notes: None,
                        connection_timeout,
                        created_at: 0,
                        updated_at: 0,
                    };

                    let auth = build_auth_method_for_proxy(&proxy_raw).await
                        .map_err(|op| op.error.unwrap_or_else(|| format!("第 {} 级跳板机认证配置错误", idx + 1)))?;

                    resolved_hops.push(crate::ssh::connection::ResolvedJumpHop {
                        host,
                        port,
                        username,
                        auth,
                        timeout_secs: connection_timeout as u32,
                    });
                }
            }

            if resolved_hops.is_empty() {
                Ok(None)
            } else {
                Ok(Some(ResolvedProxyRouting::Chain(resolved_hops)))
            }
        }
        _ => Err(format!("暂不支持的代理类型: {}", ptype)),
    }
}

/// 将服务器内联 proxy_config（JSON）解析为 `db::ProxyRaw`，供 `build_auth_method_for_proxy` 复用。
/// `type=none` 或解析失败返回 `None`（表示直连）。
fn parse_inline_proxy_config(json: &str) -> Option<db::ProxyRaw> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let ptype = v.get("type").and_then(|x| x.as_str()).unwrap_or("none");
    if ptype == "none" {
        return None;
    }
    let s = |k: &str| -> Option<String> { v.get(k).and_then(|x| x.as_str()).map(|x| x.to_string()) };
    let ptype_owned = ptype.to_string();
    Some(db::ProxyRaw {
        id: "inline".to_string(),
        name: s("name").unwrap_or_else(|| "inline-proxy".to_string()),
        proxy_type: ptype_owned,
        host: s("host").unwrap_or_default(),
        port: v.get("port").and_then(|x| x.as_i64()).unwrap_or(0) as i32,
        username: s("username"),
        auth_type: Some(s("authType").unwrap_or_else(|| "password".to_string())),
        password: s("password"),
        private_key_path: s("privateKeyPath"),
        private_key_passphrase: s("privateKeyPassphrase"),
        agent_identity: s("agentIdentity"),
        certificate_path: s("certificatePath"),
        ssh_key_id: s("sshKeyId"),
        proxy_username: s("proxyUsername"),
        proxy_password: s("proxyPassword"),
        notes: None,
        connection_timeout: v
            .get("connectionTimeout")
            .and_then(|x| x.as_i64())
            .unwrap_or(30) as i32,
        created_at: 0,
        updated_at: 0,
    })
}

/// 将服务器内联 tunnels_config（JSON 数组）解析为转发规格列表。
/// 单项：`{"type":"local"|"remote"|"dynamic","bindAddress":"127.0.0.1","bindPort":8080,
///        "targetHost":"localhost","targetPort":80}`（dynamic 仅需要 bindAddress/bindPort）。
fn parse_inline_tunnels(json: &str) -> Result<Vec<InlineTunnelSpec>, String> {
    let arr: Vec<serde_json::Value> = serde_json::from_str(json)
        .map_err(|e| format!("tunnels_config 不是合法 JSON 数组: {}", e))?;
    let mut out = Vec::with_capacity(arr.len());
    for item in arr.iter() {
        let ttype = item.get("type").and_then(|x| x.as_str()).unwrap_or("local");
        let kind = match ttype {
            "remote" => crate::ssh::port_forward::ForwardKind::Remote,
            "dynamic" => crate::ssh::port_forward::ForwardKind::Dynamic,
            _ => crate::ssh::port_forward::ForwardKind::Local,
        };
        let s = |k: &str| -> String {
            item.get(k)
                .and_then(|x| x.as_str())
                .unwrap_or_default()
                .to_string()
        };
        let i = |k: &str| -> Result<u16, String> {
            let value = item
                .get(k)
                .and_then(|x| x.as_u64())
                .ok_or_else(|| format!("tunnels_config 字段 {} 必须是端口数字", k))?;
            u16::try_from(value).map_err(|_| format!("tunnels_config 字段 {} 超出端口范围", k))
        };
        let bind_address = s("bindAddress");
        out.push(InlineTunnelSpec {
            name: {
                let n = s("name");
                if n.is_empty() { "inline-tunnel".to_string() } else { n }
            },
            kind,
            bind_address: if bind_address.is_empty() {
                "127.0.0.1".to_string()
            } else {
                bind_address
            },
            bind_port: i("bindPort")?,
            target_host: s("targetHost"),
            target_port: if matches!(kind, crate::ssh::port_forward::ForwardKind::Dynamic) {
                0
            } else {
                i("targetPort")?
            },
        });
    }
    Ok(out)
}
/// 将内联代理配置（ProxyRaw）转换为 SOCKS5/HTTP 代理传输配置（仅 socks5/http 使用）。
fn inline_proxy_transport(proxy: &db::ProxyRaw) -> crate::ssh::connection::ProxyTransportConfig {
    crate::ssh::connection::ProxyTransportConfig {
        proxy_type: proxy.proxy_type.clone(),
        host: proxy.host.clone(),
        port: proxy.port as u16,
        username: proxy.proxy_username.clone(),
        password: proxy.proxy_password.clone(),
        timeout_secs: proxy.connection_timeout as u32,
    }
}

/// 直连模式：未配置跳板机时的连接分发（content-based 优先，否则路径模式）
async fn build_direct_connect(
    server: &db::Server,
    server_id: &str,
    port: u16,
    timeout: u32,
    auth_type: &str,
) -> Result<(), crate::ssh::connection::SshError> {
    if let Some(ref key_id) = server.ssh_key_id {
        if !key_id.is_empty() {
            match load_key_raw_for_connect(key_id).await {
                Ok(key_raw) => {
                    match build_auth_method_from_key(auth_type, &key_raw) {
                        Ok(auth) => {
                            return SshManager::global()
                                .connect_with_auth(
                                    server_id.to_string(),
                                    server.host.clone(),
                                    port,
                                    server.username.clone(),
                                    auth,
                                    timeout,
                                )
                                .await;
                        }
                        Err(op_fail) => {
                            tracing::warn!(
                                "[SSH] server {} 构造 content-based AuthMethod 失败，回退到路径模式: {:?}",
                                server_id, op_fail.error
                            );
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        "[SSH] server {} 关联的 ssh_key {} 加载失败，回退到路径模式: {}",
                        server_id, key_id, e
                    );
                }
            }
        }
    }
    // 路径模式
    SshManager::global()
        .connect(
            server_id.to_string(),
            server.host.clone(),
            port,
            server.username.clone(),
            auth_type.to_string(),
            server.password.clone(),
            server.private_key_path.clone(),
            server.private_key_passphrase.as_ref().filter(|s| !s.is_empty()).cloned(),
            timeout,
            server.agent_identity.clone(),
            server.certificate_path.clone(),
        )
        .await
}

/// 后台更新 DB（仅持久化数据，不依赖 status 作为状态来源）
fn db_update_async(id: String, json: String) {
    tokio::task::spawn_blocking(move || {
        let _ = db::servers_update(id, json);
    });
}

/// 状态查询结果（推送给前端）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshStateResult {
    pub state: ConnectionState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<SshErrorKind>,
    /// 状态版本号：前端据此丢弃过期事件（与 ssh:state-changed 事件中的 generation 一致）
    pub generation: u64,
}

/// 通用服务器连接逻辑（支持链式跳板机、SOCKS5/HTTP 代理、content-based 私钥及路径直连）
pub async fn connect_server_entry(server: &db::Server, conn_id: &str) -> Result<(), String> {
    if server.port <= 0 {
        return Err("未配置 SSH 端口".to_string());
    }
    let server_id = conn_id.to_string();
    let port = server.port as u16;
    let timeout = server.connection_timeout as u32;
    let auth_type = server.auth_type.clone();

    let routing = if let Some(proxy_json) = server
        .proxy_config
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        resolve_inline_proxy_routing(proxy_json).await?
    } else {
        None
    };

    match routing {
        Some(ResolvedProxyRouting::Chain(hops)) => {
            let target_auth = build_auth_method_for_server(server).await
                .map_err(|op| op.error.unwrap_or_else(|| "目标主机认证配置错误".to_string()))?;
            SshManager::global()
                .connect_with_jump_chain(
                    server_id,
                    server.host.clone(),
                    port,
                    server.username.clone(),
                    target_auth,
                    timeout,
                    hops,
                )
                .await
                .map_err(|e| e.to_string())
        }
        Some(ResolvedProxyRouting::Proxy(proxy_cfg)) => {
            let target_auth = build_auth_method_for_server(server).await
                .map_err(|op| op.error.unwrap_or_else(|| "目标主机认证配置错误".to_string()))?;
            SshManager::global()
                .connect_with_proxy(
                    server_id,
                    server.host.clone(),
                    port,
                    server.username.clone(),
                    target_auth,
                    timeout,
                    proxy_cfg,
                )
                .await
                .map_err(|e| e.to_string())
        }
        None => {
            build_direct_connect(server, &server_id, port, timeout, &auth_type)
                .await
                .map_err(|e| e.to_string())
        }
    }
}

/// 连接到服务器
///
/// 流程：
/// 1. 校验 serverId
/// 2. 从 DB 读取配置 + 解密密码
/// 3. 调用 SshManager::connect（内部已有 JoinHandle 等待防并发）
/// 4. 仅持久化 last_accessed_at 到 DB（不再写 status=online/offline）
/// 5. 异步获取 OS 信息并更新
/// 6. 通过 `ssh:connected` 事件通知前端（兼容旧前端）
///
/// 状态变更通过 `ssh:state-changed` 事件由 SshManager 推送
#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    server_id: String,
) -> Result<OperationResult, String> {
    // 1. 校验 serverId
    if let Err(e) = validate_server_id(&server_id) {
        return Ok(OperationResult::fail(e));
    }

    let perf_start = std::time::Instant::now();

    // 2. 读取配置 + 解密密码
    let server = match load_server_config(&server_id).await {
        Ok(s) => s,
        Err(e) => return Ok(OperationResult::fail(e)),
    };
    tracing::info!("[SSH Perf] {} DB 读取配置: {:?}", server_id, perf_start.elapsed());

    let port = server.port as u16;
    let timeout = server.connection_timeout as u32;
    let protocol = server.protocol.as_str();

    if server.port <= 0 {
        let err_msg = "未配置 SSH 端口".to_string();
        let _ = app.emit("ssh:state-changed", serde_json::json!({
            "serverId": server_id.clone(),
            "state": "failed",
            "error": err_msg.clone(),
            "errorKind": "unsupported",
            "generation": now_ms() as u64,
        }));
        return Ok(OperationResult::fail(err_msg));
    }
    if let Err(e) = crate::connection::validate_target_protocol(&server.target_type, protocol) {
        let _ = app.emit("ssh:state-changed", serde_json::json!({
            "serverId": server_id.clone(),
            "state": "failed",
            "error": e.clone(),
            "errorKind": "unsupported",
            "generation": now_ms() as u64,
        }));
        return Ok(OperationResult::fail(e));
    }
    if protocol == "rdp" {
        return Ok(OperationResult::fail("RDP 会话请从远程桌面模块启动"));
    }
    if protocol == "serial" {
        return Ok(OperationResult::fail("串口会话请从串口模块启动"));
    }
    if protocol == "redfish" {
        return Ok(OperationResult::fail("BMC Redfish 会话请从带外管理模块启动"));
    }
    if protocol == "telnet" {
        let addr = format!("{}:{}", server.host, port);
        match tokio::time::timeout(
            tokio::time::Duration::from_secs(timeout.max(5) as u64),
            tokio::net::TcpStream::connect(&addr),
        )
        .await
        {
            Ok(Ok(_stream)) => {
                eprintln!("[Telnet] connect success: server_id={}", server_id);
                let update_json = serde_json::json!({
                    "lastAccessedAt": now_ms(),
                })
                .to_string();
                db_update_async(server_id.clone(), update_json);

                let _ = app.emit("ssh:connected", serde_json::json!({ "serverId": server_id }));
                let _ = app.emit("ssh:state-changed", serde_json::json!({
                    "serverId": server_id,
                    "state": "ready",
                    "generation": now_ms() as u64,
                }));
                return Ok(OperationResult::ok_with_message(
                    "Telnet 端口可达；账号凭据将在打开终端时由登录提示验证",
                ));
            }
            Ok(Err(e)) => {
                let err_msg = format!("Telnet connect to {} failed: {}", addr, e);
                let _ = app.emit("ssh:state-changed", serde_json::json!({
                    "serverId": server_id,
                    "state": "failed",
                    "error": err_msg.clone(),
                    "errorKind": "networkError",
                    "generation": now_ms() as u64,
                }));
                return Ok(OperationResult::fail(err_msg));
            }
            Err(_) => {
                let err_msg = format!("Telnet connect to {} timed out after {}s", addr, timeout);
                let _ = app.emit("ssh:state-changed", serde_json::json!({
                    "serverId": server_id,
                    "state": "failed",
                    "error": err_msg.clone(),
                    "errorKind": "timeout",
                    "generation": now_ms() as u64,
                }));
                return Ok(OperationResult::fail(err_msg));
            }
        }
    }

    let auth_type = server.auth_type.clone();

    // 3. 连接（SshManager 内部已有防并发等待机制）
    // 阶段 3：若 server 关联了 ssh_key_id，走 content-based 连接（私钥/证书内容已加密存储在 ssh_keys 表）
    // 否则回退到路径模式（兼容旧数据）
    eprintln!("[SSH] connect: server_id={}, host={}, port={}, auth_type={}", server_id, server.host, port, auth_type);
    let mgr_start = perf_start.elapsed();

    let result = connect_server_entry(&server, &server_id).await;
    tracing::info!("[SSH Perf] {} SshManager::connect 完成: {:?} (本阶段 {:?})",
        server_id, perf_start.elapsed(), perf_start.elapsed() - mgr_start);

    match result {
        Ok(()) => {
            eprintln!("[SSH] connect success: server_id={}", server_id);

            // 4. 仅主连接更新 last_accessed_at 与自启隧道/OS探测
            if !is_secondary_connection(&server_id) {
                let update_json = serde_json::json!({
                    "lastAccessedAt": now_ms(),
                })
                .to_string();
                db_update_async(server_id.clone(), update_json);
                tracing::info!("[SSH Perf] {} DB 更新 last_accessed_at: {:?}",
                    server_id, perf_start.elapsed());

                // 连接成功后自动启动服务器内联隧道（端口转发）。
                let inline_tunnels_json = server.tunnels_config.clone().filter(|s| !s.trim().is_empty());
                let sid_for_tunnel = server_id.clone();
                tokio::spawn(async move {
                    // 延迟 800ms 确保连接稳定后再启动隧道
                    tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                    if !SshManager::global().is_connected_sync(&sid_for_tunnel) {
                        return;
                    }
                    let mut specs: Vec<(String, crate::ssh::port_forward::ForwardSpec)> = Vec::new();
                    if let Some(cfg) = inline_tunnels_json.as_ref() {
                        if let Ok(list) = parse_inline_tunnels(cfg) {
                            for t in list {
                                let is_dynamic =
                                    matches!(t.kind, crate::ssh::port_forward::ForwardKind::Dynamic);
                                let spec = crate::ssh::port_forward::ForwardSpec {
                                    server_id: sid_for_tunnel.clone(),
                                    kind: t.kind,
                                    local_host: t.bind_address,
                                    local_port: t.bind_port,
                                    remote_host: if is_dynamic {
                                        None
                                    } else {
                                        Some(t.target_host)
                                    },
                                    remote_port: if is_dynamic {
                                        None
                                    } else {
                                        Some(t.target_port)
                                    },
                                    source: Some(format!("tunnel:{}", t.name)),
                                };
                                specs.push((t.name.clone(), spec));
                            }
                        }
                    }
                    for (tname, spec) in specs {
                        let sid = spec.server_id.clone();
                        let local_port = spec.local_port;
                        tokio::spawn(async move {
                            match crate::ssh::port_forward::add_forward(spec).await {
                                Ok(fid) => tracing::info!(
                                    "[SSH] 隧道自动启动: server={} tunnel={} forward={} local_port={}",
                                    sid, tname, fid, local_port
                                ),
                                Err(e) => tracing::warn!(
                                    "[SSH] 隧道自动启动失败: server={} tunnel={} local_port={}: {}",
                                    sid, tname, local_port, e
                                ),
                            }
                        });
                    }
                });

                // 5. 仅当未探测过 OS 信息且非网络/BMC 设备时，延迟 500ms 后后台补充探测
                // （延迟 500ms 可确保前端开终端的 PTY Shell 已经顺利创建，彻底消除通道竞争）
                let target_type = crate::connection::TargetType::from_str_lossy(&server.target_type);
                let os_type_empty = server.os_type.as_deref().unwrap_or("").is_empty();
                if target_type != crate::connection::TargetType::Network
                    && target_type != crate::connection::TargetType::Bmc
                    && os_type_empty
            {
                let sid = server_id.clone();
                let app_for_os = app.clone();
                let os_perf_start = std::time::Instant::now();
                let os_cmd = target_type.os_detect_command().to_string();
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    if !SshManager::global().is_connected_sync(&sid) {
                        return;
                    }
                    if let Ok(os_res) = SshManager::global().execute(&sid, &os_cmd, 15).await {
                        tracing::info!("[SSH Perf] {} OS detect 命令完成: {:?}",
                            sid, os_perf_start.elapsed());
                        let parts: Vec<&str> = os_res.stdout.split("---SEP---").collect();
                        let release_content = parts.first().unwrap_or(&"").trim();
                        let arch = parts.get(1).unwrap_or(&"").trim();
                        let kernel = parts.get(2).unwrap_or(&"").trim();

                        let mut os_id = String::new();
                        let mut pretty_name = String::new();
                        for line in release_content.lines() {
                            if let Some(rest) = line.strip_prefix("ID=") {
                                os_id = rest.trim_matches('"').trim().to_lowercase();
                            }
                            if let Some(rest) = line.strip_prefix("PRETTY_NAME=") {
                                pretty_name = rest.trim_matches('"').trim().to_string();
                            }
                        }
                        if os_id.is_empty() && release_content.contains("darwin") {
                            os_id = "darwin".to_string();
                        }
                        if os_id.is_empty() && release_content.contains("windows") {
                            os_id = "windows".to_string();
                        }

                        if !os_id.is_empty() {
                            let components: Vec<&str> = [pretty_name.as_str(), arch, kernel]
                                .iter()
                                .filter(|s| !s.is_empty())
                                .copied()
                                .collect();
                            let os_info = components.join(" | ");
                            let update_json = serde_json::json!({
                                "osType": os_id,
                                "osInfo": os_info,
                            })
                            .to_string();
                            db_update_async(sid.clone(), update_json);

                            let _ = app_for_os.emit("server:os-detected", serde_json::json!({
                                "serverId": sid,
                                "osType": os_id,
                                "osInfo": os_info,
                            }));
                        }
                    }
                });
            }
            }

            // 6. 兼容旧前端的 ssh:connected 事件（新前端可改为监听 ssh:state-changed）
            let _ = app.emit("ssh:connected", serde_json::json!({ "serverId": server_id }));

            tracing::info!("[SSH Perf] {} ssh_connect 总耗时: {:?}（OS detect 异步进行中）",
                server_id, perf_start.elapsed());
            Ok(OperationResult::ok_with_message("Connection successful"))
        }
        Err(e) => {
            eprintln!("[SSH] connect FAILED: {}", e);
            tracing::info!("[SSH Perf] {} ssh_connect 失败: {:?}", server_id, perf_start.elapsed());
            
            // Record connection failed log
            let server_name = server.name.clone();
            let host_info = format!("{}:{}", server.host, port);
            let user_info = server.username.clone();
            let err_msg = e.to_string();
            let _ = tokio::task::spawn_blocking(move || {
                let _ = crate::db::add_audit_log(
                    "backend",
                    Some(&server_name),
                    "SSH connection error/crash",
                    "failed",
                    Some(&format!("User: {}, Host: {}, Error: {}", user_info, host_info, err_msg)),
                );
            }).await;

            // 仅持久化最后错误信息（不写 status=offline，状态由 SshManager 维护）
            let update_json = serde_json::json!({
                "lastError": format!("{}", e),
            })
            .to_string();
            db_update_async(server_id.clone(), update_json);

            Ok(OperationResult::fail(e.to_string()))
        }
    }
}

/// 断开服务器连接
#[tauri::command]
pub async fn ssh_disconnect(
    app: AppHandle,
    server_id: String,
) -> Result<OperationResult, String> {
    // 若存在活跃 Telnet 会话，先行关闭
    crate::telnet::close_telnet_sessions_for_server(&server_id).await;

    match SshManager::global().disconnect(&server_id).await {
        Ok(()) => {
            if !is_secondary_connection(&server_id) {
                let update_json = serde_json::json!({
                    "lastDisconnectedAt": now_ms(),
                })
                .to_string();
                db_update_async(server_id.clone(), update_json);
                // 清理 metrics 缓存
                let _ = crate::metrics::metrics_refresh_cache(server_id.clone());
            }
            // 兼容旧前端事件
            let _ = app.emit("ssh:disconnected", serde_json::json!({ "serverId": server_id }));
            Ok(OperationResult::ok())
        }
        Err(e) => Ok(OperationResult::fail(format!("{}", e))),
    }
}

/// 在服务器上执行命令
/// 含命令审计和危险命令拦截
#[tauri::command]
pub async fn ssh_execute(
    server_id: String,
    command: String,
) -> Result<CommandResult, String> {
    if let Err(e) = validate_server_id(&server_id) {
        return Ok(CommandResult::err(e));
    }
    if command.is_empty() {
        return Ok(CommandResult::err("Command is required"));
    }
    // 危险命令拦截
    let cmd_validation = crate::validators::validate_command(command.clone());
    if !cmd_validation.valid {
        let err = cmd_validation.error.unwrap_or_default();
        eprintln!(
            "[SSH AUDIT] Blocked command on {}: {} — {}",
            server_id, command, err
        );
        return Ok(CommandResult::err(format!("Command rejected: {}", err)));
    }
    // 审计日志
    let preview: String = command.chars().take(200).collect();
    println!("[SSH AUDIT] execute on {}: {}", server_id, preview);

    match SshManager::global().execute(&server_id, &command, 60).await {
        Ok(out) => Ok(CommandResult {
            stdout: out.stdout,
            stderr: out.stderr,
            exit_code: out.exit_code,
        }),
        Err(e) => Ok(CommandResult::err(format!("{}", e))),
    }
}

// ============================================================
// 批量命令执行（P0-4）
// ============================================================

/// 单台服务器的批量执行结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchExecuteItem {
    pub server_id: String,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    /// 连接或执行错误（success=false 时填充）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 批量执行聚合结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchExecuteResult {
    pub total: usize,
    pub succeeded: usize,
    pub failed: usize,
    pub items: Vec<BatchExecuteItem>,
}

/// 批量执行命令
///
/// 对选中的服务器并发执行同一命令：
/// - 已连接服务器直接 exec；未连接服务器先按 DB 配置自动连接再 exec
/// - 并发上限 10（Semaphore），避免数千台服务器同时连接压垮 fd
/// - 单台超时默认 30s（前端可通过 timeoutSecs 覆盖，上限 120s）
/// - 危险命令拦截与单机 ssh_execute 一致
/// - 服务器 ID 列表去重，避免重复执行
#[tauri::command]
pub async fn ssh_batch_execute(
    app: AppHandle,
    server_ids: Vec<String>,
    command: String,
    timeout_secs: Option<u32>,
) -> Result<BatchExecuteResult, String> {
    if command.is_empty() {
        return Ok(BatchExecuteResult {
            total: 0,
            succeeded: 0,
            failed: 0,
            items: Vec::new(),
        });
    }

    // 危险命令拦截：批量场景更严格，直接拒绝整个批次
    let cmd_validation = crate::validators::validate_command(command.clone());
    if !cmd_validation.valid {
        let err = cmd_validation.error.unwrap_or_default();
        eprintln!("[SSH AUDIT] Blocked batch command: {} — {}", command, err);
        return Err(format!("Command rejected: {}", err));
    }

    // server_ids 去重（保留首次出现的顺序，避免重复执行）
    let mut seen = std::collections::HashSet::new();
    let unique_ids: Vec<String> = server_ids
        .into_iter()
        .filter(|id| {
            // 同时校验 ID 格式，非法 ID 直接丢弃
            if validate_server_id(id).is_err() {
                return false;
            }
            seen.insert(id.clone())
        })
        .collect();

    if unique_ids.is_empty() {
        return Ok(BatchExecuteResult {
            total: 0,
            succeeded: 0,
            failed: 0,
            items: Vec::new(),
        });
    }

    // 单台超时：默认 30s，上限 120s
    let per_server_timeout = timeout_secs
        .map(|t| t.clamp(5, 120) as u64)
        .unwrap_or(30);

    // 审计日志：记录批量执行入口
    let batch_total = unique_ids.len();
    let preview: String = command.chars().take(200).collect();
    println!("[SSH AUDIT] batch execute on {} servers: {}", batch_total, preview);

    let semaphore = Arc::new(Semaphore::new(10));
    let results: Arc<tokio::sync::Mutex<Vec<BatchExecuteItem>>> =
        Arc::new(tokio::sync::Mutex::new(Vec::with_capacity(batch_total)));
    let mut join_set = tokio::task::JoinSet::new();

    for sid in unique_ids {
        let sem = semaphore.clone();
        let cmd = command.clone();
        let results = results.clone();
        let app_for_task = app.clone();
        join_set.spawn(async move {
            // 等待并发许可
            let _permit = sem.acquire().await.expect("semaphore closed unexpectedly");
            let item = execute_batch_item(&sid, &cmd, per_server_timeout).await;
            // 增量推送：每完成一台立即 emit，前端可实时更新表格
            let _ = app_for_task.emit(
                "ssh:batch-progress",
                serde_json::json!({
                    "serverId": sid,
                    "item": &item,
                    "total": batch_total,
                }),
            );
            results.lock().await.push(item);
        });
    }

    while join_set.join_next().await.is_some() {}

    let mut items = results.lock().await.clone();
    // 按原始顺序排序（与输入顺序一致，便于前端对齐展示）
    // 注：由于并发执行，push 顺序不定，这里按输入顺序重排
    // 用 server_id 作为 key 重建有序列表
    let mut by_id: std::collections::HashMap<String, BatchExecuteItem> =
        std::collections::HashMap::new();
    for it in items.drain(..) {
        by_id.insert(it.server_id.clone(), it);
    }
    let ordered: Vec<BatchExecuteItem> = seen.iter()
        .filter_map(|id| by_id.remove(id))
        .collect();

    let succeeded = ordered.iter().filter(|i| i.success).count();
    let failed = ordered.len() - succeeded;
    Ok(BatchExecuteResult {
        total: ordered.len(),
        succeeded,
        failed,
        items: ordered,
    })
}

/// 批量执行单台服务器的内部逻辑：自动连接 + 执行命令
async fn execute_batch_item(
    server_id: &str,
    command: &str,
    timeout_secs: u64,
) -> BatchExecuteItem {
    // 已连接则跳过连接步骤；未连接则尝试自动连接
    if !SshManager::global().is_connected_sync(server_id) {
        // 加载配置并连接（与 ssh_connect 命令一致）
        let server = match load_server_config(server_id).await {
            Ok(s) => s,
            Err(e) => return BatchExecuteItem {
                server_id: server_id.to_string(),
                success: false,
                stdout: String::new(),
                stderr: String::new(),
                exit_code: -1,
                error: Some(format!("加载服务器配置失败: {}", e)),
            },
        };
        let port = server.port as u16;
        let timeout = server.connection_timeout as u32;
        let auth_type = server.auth_type.clone();
        // 走与 ssh_connect 一致的分发：内联代理（链式跳板 / 代理） / 直连 / content-based
        let routing = match server.proxy_config.as_deref().filter(|s| !s.trim().is_empty()) {
            Some(cfg) => match resolve_inline_proxy_routing(cfg).await {
                Ok(r) => r,
                Err(e) => {
                    return BatchExecuteItem {
                        server_id: server_id.to_string(),
                        success: false,
                        stdout: String::new(),
                        stderr: String::new(),
                        exit_code: -1,
                        error: Some(e),
                    };
                }
            },
            None => None,
        };

        let connect_result = match routing {
            Some(ResolvedProxyRouting::Chain(hops)) => {
                let target_auth = match build_auth_method_for_server(&server).await {
                    Ok(a) => a,
                    Err(op_fail) => {
                        return BatchExecuteItem {
                            server_id: server_id.to_string(),
                            success: false,
                            stdout: String::new(),
                            stderr: String::new(),
                            exit_code: -1,
                            error: op_fail.error,
                        };
                    }
                };
                SshManager::global()
                    .connect_with_jump_chain(
                        server_id.to_string(),
                        server.host.clone(),
                        port,
                        server.username.clone(),
                        target_auth,
                        timeout,
                        hops,
                    )
                    .await
            }
            Some(ResolvedProxyRouting::Proxy(proxy_cfg)) => {
                let target_auth = match build_auth_method_for_server(&server).await {
                    Ok(a) => a,
                    Err(op_fail) => {
                        return BatchExecuteItem {
                            server_id: server_id.to_string(),
                            success: false,
                            stdout: String::new(),
                            stderr: String::new(),
                            exit_code: -1,
                            error: op_fail.error,
                        };
                    }
                };
                SshManager::global()
                    .connect_with_proxy(
                        server_id.to_string(),
                        server.host.clone(),
                        port,
                        server.username.clone(),
                        target_auth,
                        timeout,
                        proxy_cfg,
                    )
                    .await
            }
            None => {
                build_direct_connect(&server, server_id, port, timeout, &auth_type).await
            }
        };
        if let Err(e) = connect_result {
            return BatchExecuteItem {
                server_id: server_id.to_string(),
                success: false,
                stdout: String::new(),
                stderr: String::new(),
                exit_code: -1,
                error: Some(format!("连接失败: {}", e)),
            };
        }
    }

    // 执行命令
    match SshManager::global().execute(server_id, command, timeout_secs).await {
        Ok(out) => BatchExecuteItem {
            server_id: server_id.to_string(),
            success: out.exit_code == 0,
            stdout: out.stdout,
            stderr: out.stderr,
            exit_code: out.exit_code,
            error: None,
        },
        Err(e) => BatchExecuteItem {
            server_id: server_id.to_string(),
            success: false,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: -1,
            error: Some(format!("{}", e)),
        },
    }
}

/// 检查是否已连接
#[tauri::command]
pub async fn ssh_is_connected(server_id: String) -> Result<bool, String> {
    Ok(SshManager::global().is_connected_sync(&server_id))
}

/// 主动探测所有连接（用于系统休眠唤醒、网络恢复事件秒级感知）
#[tauri::command]
pub async fn ssh_probe_connections() -> Result<Vec<String>, String> {
    Ok(SshManager::global().probe_connections().await)
}

/// 查询服务器的连接状态（状态机）
///
/// 取代旧的 boolean isConnected，前端通过此接口或 `ssh:state-changed` 事件
/// 获取完整状态机信息，用于驱动 UI（连接中 / 已就绪 / 失败等）
#[tauri::command]
pub async fn ssh_get_state(server_id: String) -> Result<SshStateResult, String> {
    let state = SshManager::global().get_state_sync(&server_id);
    let generation = SshManager::global().get_generation_sync(&server_id);
    let (error, error_kind) = SshManager::global()
        .get_last_error(&server_id)
        .map(|(msg, kind)| (Some(msg), Some(kind)))
        .unwrap_or((None, None));
    Ok(SshStateResult { state, error, error_kind, generation })
}

/// 获取所有已连接的服务器 ID 列表
#[tauri::command]
pub async fn ssh_get_connected_servers() -> Result<Vec<String>, String> {
    Ok(SshManager::global().get_connected_server_ids_sync())
}

/// 测试 TCP 连通性（不建立 SSH 连接）
///
/// 注意：此接口仅做 TCP 探活，不再更新 DB status 字段。
/// 状态权威来源是 SshManager 连接池。
#[tauri::command]
pub async fn ssh_test_connection(
    server_id: String,
) -> Result<serde_json::Value, String> {
    let id = extract_base_server_id(&server_id).to_string();
    let json = match tokio::task::spawn_blocking(move || db::servers_get(id))
        .await
    {
        Ok(Ok(json)) => json,
        _ => return Ok(serde_json::json!({ "online": false })),
    };
    let server: db::Server = match serde_json::from_str(&json) {
        Ok(s) => s,
        Err(_) => return Ok(serde_json::json!({ "online": false })),
    };

    if crate::connection::validate_target_protocol(&server.target_type, &server.protocol).is_err() {
        return Ok(serde_json::json!({ "online": false, "unsupported": true }));
    }

    if server.protocol.eq_ignore_ascii_case("serial") {
        return Ok(serde_json::json!({ "online": false, "unsupported": true }));
    }
    let port = if server.protocol.eq_ignore_ascii_case("rdp") || (server.target_type == "windows" && server.port <= 0 && server.rdp_port > 0) {
        server.rdp_port.max(1) as u16
    } else if server.port > 0 {
        server.port as u16
    } else {
        return Ok(serde_json::json!({ "online": false }));
    };
    let online = SshManager::test_connection(&server.host, port).await;

    Ok(serde_json::json!({ "online": online }))
}

/// 重置指定服务器的已知主机密钥记录。
///
/// 用于服务器密钥轮换/重装后清除旧指纹，使下次连接重新走 TOFU 流程。
/// 接受 server_id，内部查询 host/port 后调用 db::reset_known_host。
#[tauri::command]
pub async fn ssh_reset_known_host(server_id: String) -> Result<OperationResult, String> {
    let id = extract_base_server_id(&server_id).to_string();
    let json = match tokio::task::spawn_blocking(move || db::servers_get(id))
        .await
    {
        Ok(Ok(json)) => json,
        Ok(Err(e)) => return Ok(OperationResult::fail(format!("Failed to load server: {}", e))),
        Err(e) => return Ok(OperationResult::fail(format!("DB task failed: {}", e))),
    };
    let server: db::Server = match serde_json::from_str(&json) {
        Ok(s) => s,
        Err(e) => return Ok(OperationResult::fail(format!("Failed to parse server: {}", e))),
    };

    let host = server.host.clone();
    let port = server.port;
    let affected = match tokio::task::spawn_blocking(move || db::reset_known_host(&host, port))
        .await
    {
        Ok(Ok(n)) => n,
        Ok(Err(e)) => return Ok(OperationResult::fail(format!("Failed to reset known host: {}", e))),
        Err(e) => return Ok(OperationResult::fail(format!("DB task failed: {}", e))),
    };

    Ok(OperationResult::ok_with_message(format!("已清除 {} 条主机密钥记录", affected)))
}

/// 列出所有记录在库的已知主机密钥
#[tauri::command]
pub async fn ssh_list_known_hosts() -> Result<Vec<db::KnownHostRecord>, String> {
    tokio::task::spawn_blocking(db::list_known_hosts)
        .await
        .map_err(|e| format!("Task spawn failed: {}", e))?
}

/// 删除指定主机端口的密钥记录
#[tauri::command]
pub async fn ssh_delete_known_host(
    host: String,
    port: i32,
    key_type: Option<String>,
) -> Result<OperationResult, String> {
    let affected = tokio::task::spawn_blocking(move || {
        db::delete_known_host(&host, port, key_type.as_deref())
    })
    .await
    .map_err(|e| format!("Task spawn failed: {}", e))??;

    Ok(OperationResult::ok_with_message(format!(
        "已成功移除 {} 条已知主机记录",
        affected
    )))
}

/// 清空所有记录的已知主机密钥
#[tauri::command]
pub async fn ssh_clear_all_known_hosts() -> Result<OperationResult, String> {
    let affected = tokio::task::spawn_blocking(db::clear_all_known_hosts)
        .await
        .map_err(|e| format!("Task spawn failed: {}", e))??;

    Ok(OperationResult::ok_with_message(format!(
        "已成功清空 {} 条已知主机记录",
        affected
    )))
}

/// 批量恢复已知主机记录（用于云同步恢复）
#[tauri::command]
pub async fn ssh_restore_known_hosts(records: Vec<db::KnownHostRecord>) -> Result<usize, String> {
    tokio::task::spawn_blocking(move || db::restore_known_hosts(records))
        .await
        .map_err(|e| format!("Task spawn failed: {}", e))?
}


/// 测试连接配置（不保存到数据库）
/// 用于"新建服务器"对话框的连接测试
#[tauri::command]
pub async fn ssh_test_connect_with_config(
    config: serde_json::Value,
) -> Result<OperationResult, String> {
    let host = config
        .get("host")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if host.is_empty() {
        return Ok(OperationResult::fail("Host is required"));
    }

    let port = config
        .get("port")
        .and_then(|v| v.as_i64())
        .map(|p| p as u16)
        .unwrap_or_else(|| {
            let protocol = config
                .get("protocol")
                .and_then(|v| v.as_str())
                .unwrap_or("ssh");
            crate::connection::ConnectionProtocol::from_str_lossy(protocol).default_port() as u16
        });

    let protocol = config
        .get("protocol")
        .and_then(|v| v.as_str())
        .unwrap_or("ssh");

    let target_type = config
        .get("targetType")
        .and_then(|v| v.as_str())
        .unwrap_or("linux");
    if let Err(e) = crate::connection::validate_target_protocol(target_type, protocol) {
        return Ok(OperationResult::fail(e));
    }
    let requested_auth = config
        .get("authType")
        .and_then(|v| v.as_str())
        .unwrap_or("password");
    if protocol != "ssh" && requested_auth != "password" {
        return Ok(OperationResult::fail(format!("协议 {} 仅支持密码认证", protocol)));
    }

    let timeout = config
        .get("connectionTimeout")
        .and_then(|v| v.as_i64())
        .unwrap_or(15) as u32;

    if protocol == "telnet" {
        let addr = format!("{}:{}", host, port);
        return match tokio::time::timeout(
            tokio::time::Duration::from_secs(timeout as u64),
            tokio::net::TcpStream::connect(&addr),
        )
        .await
        {
            Ok(Ok(_stream)) => Ok(OperationResult::ok_with_message(
                "Telnet 端口可达；账号凭据将在打开终端时由登录提示验证",
            )),
            Ok(Err(e)) => Ok(OperationResult::fail(format!("Telnet connect to {} failed: {}", addr, e))),
            Err(_) => Ok(OperationResult::fail(format!("Telnet connect to {} timed out after {}s", addr, timeout))),
        };
    }

    // RDP 的“测试连接”只做端口探测，不伪装成 SSH 认证测试。
    if protocol == "rdp" {
        let addr = format!("{}:{}", host, port);
        return match tokio::time::timeout(
            tokio::time::Duration::from_secs(timeout.max(1) as u64),
            tokio::net::TcpStream::connect(&addr),
        )
        .await
        {
            Ok(Ok(_)) => Ok(OperationResult::ok_with_message("RDP 端口可达")),
            Ok(Err(e)) => Ok(OperationResult::fail(format!("RDP 端口不可达: {}", e))),
            Err(_) => Ok(OperationResult::fail(format!("RDP 端口连接超时（{} 秒）", timeout))),
        };
    }

    if protocol == "redfish" {
        return Ok(OperationResult::fail(
            "Redfish 测试必须使用 BMC 认证测试接口",
        ));
    }

    let username = config
        .get("username")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let auth_type = config
        .get("authType")
        .and_then(|v| v.as_str())
        .unwrap_or("password")
        .to_string();
    let mut password = config
        .get("password")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let mut private_key_path = config
        .get("privateKeyPath")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let mut private_key_passphrase = config
        .get("privateKeyPassphrase")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let mut agent_identity = config
        .get("agentIdentity")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let mut certificate_path = config
        .get("certificatePath")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let ssh_key_id = config
        .get("sshKeyId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());

    // FinalShell 模式：测试连接支持内联 proxyConfig（JSON 字符串）
    let proxy_config_json = config
        .get("proxyConfig")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.trim().is_empty());

    // 如果提供了 id（表示是在编辑已有服务器），且新凭据留空，则从数据库中读取并解密原凭据进行测试
    let server_id = config
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if let Some(id) = server_id {
        if let Ok(Ok(json_str)) = tokio::task::spawn_blocking(move || db::servers_get_raw(id)).await {
                if let Ok(original_server) = serde_json::from_str::<db::Server>(&json_str) {
                    if auth_type == "password" && password.as_deref().unwrap_or("").is_empty() {
                        if let Some(ref enc) = original_server.password {
                            if !enc.is_empty() {
                                if let Ok(dec) = crypto::decrypt_password(enc, db::master_key()) {
                                    password = Some(dec);
                                }
                            }
                        }
                    }
                    if auth_type == "privateKey" && private_key_path.as_deref().unwrap_or("").is_empty() {
                        // 注意：使用 clone 而非 move，避免后续 certificate 分支再次访问字段时 borrow-after-move
                        private_key_path = original_server.private_key_path.clone();
                        if private_key_passphrase.as_deref().unwrap_or("").is_empty() {
                            if let Some(ref enc) = original_server.private_key_passphrase {
                                if !enc.is_empty() {
                                    if let Ok(dec) = crypto::decrypt_password(enc, db::master_key()) {
                                        private_key_passphrase = Some(dec);
                                    }
                                }
                            }
                        }
                    }
                    // sshAgent / certificate 认证：编辑场景下从原配置回填缺失字段
                    if (auth_type == "sshAgent" || auth_type == "ssh_agent" || auth_type == "agent")
                        && agent_identity.as_deref().unwrap_or("").is_empty()
                    {
                        if let Some(ref orig_id) = original_server.agent_identity {
                            if !orig_id.is_empty() {
                                agent_identity = Some(orig_id.clone());
                            }
                        }
                    }
                    if auth_type == "certificate" || auth_type == "openssh_cert" || auth_type == "cert" {
                        if private_key_path.as_deref().unwrap_or("").is_empty() {
                            // 注意：此处使用 clone() 而非 move，避免编译器跨分支借用检查失败
                            // （privateKey 分支也会用到 original_server.private_key_path）
                            private_key_path = original_server.private_key_path.clone();
                            if private_key_passphrase.as_deref().unwrap_or("").is_empty() {
                                if let Some(ref enc) = original_server.private_key_passphrase {
                                    if !enc.is_empty() {
                                        if let Ok(dec) = crypto::decrypt_password(enc, db::master_key()) {
                                            private_key_passphrase = Some(dec);
                                        }
                                    }
                                }
                            }
                        }
                        if certificate_path.as_deref().unwrap_or("").is_empty() {
                            certificate_path = original_server.certificate_path.clone();
                        }
                    }
                }
        }
    }

    let temp_id = format!("test-{}", now_ms() as u64);

    // FinalShell 模式：若提供了内联 proxyConfig，解析并走 connect_with_jump_chain / connect_with_proxy
    let routing = if let Some(ref cfg) = proxy_config_json {
        match resolve_inline_proxy_routing(cfg).await {
            Ok(r) => r,
            Err(e) => return Ok(OperationResult::fail(format!("跳板机/代理配置解析失败: {}", e))),
        }
    } else {
        None
    };

    if let Some(routing) = routing {
        // 构造目标 AuthMethod：content-based 优先（sshKeyId），否则路径模式
        let target_auth = if let Some(ref key_id) = ssh_key_id {
            match load_key_raw_for_connect(key_id).await {
                Ok(key_raw) => match build_auth_method_from_key(&auth_type, &key_raw) {
                    Ok(a) => a,
                    Err(_) => build_test_auth_from_fields(
                        &auth_type, &password, &private_key_path,
                        &private_key_passphrase, &agent_identity, &certificate_path,
                    ),
                },
                Err(_) => build_test_auth_from_fields(
                    &auth_type, &password, &private_key_path,
                    &private_key_passphrase, &agent_identity, &certificate_path,
                ),
            }
        } else {
            build_test_auth_from_fields(
                &auth_type, &password, &private_key_path,
                &private_key_passphrase, &agent_identity, &certificate_path,
            )
        };

        let result = match routing {
            ResolvedProxyRouting::Chain(hops) => {
                SshManager::global()
                    .connect_with_jump_chain(
                        temp_id.clone(),
                        host.to_string(),
                        port,
                        username,
                        target_auth,
                        timeout,
                        hops,
                    )
                    .await
            }
            ResolvedProxyRouting::Proxy(proxy_cfg) => {
                SshManager::global()
                    .connect_with_proxy(
                        temp_id.clone(),
                        host.to_string(),
                        port,
                        username,
                        target_auth,
                        timeout,
                        proxy_cfg,
                    )
                    .await
            }
        };

        return match result {
            Ok(()) => {
                let _ = SshManager::global().disconnect(&temp_id).await;
                Ok(OperationResult::ok_with_message("Connection successful (via proxy)"))
            }
            Err(e) => Ok(OperationResult::fail(format!("{}", e))),
        };
    }

    // 阶段 3：若提供了 sshKeyId，走 content-based 测试连接（与 ssh_connect 行为一致）
    // 否则回退到路径模式（兼容旧数据 / 新建未关联密钥场景）
    let result = if let Some(ref key_id) = ssh_key_id {
        match load_key_raw_for_connect(key_id).await {
            Ok(key_raw) => match build_auth_method_from_key(&auth_type, &key_raw) {
                Ok(auth) => {
                    SshManager::global()
                        .connect_with_auth(
                            temp_id.clone(),
                            host.to_string(),
                            port,
                            username,
                            auth,
                            timeout,
                        )
                        .await
                }
                Err(op_fail) => {
                    tracing::warn!(
                        "[SSH Test] sshKeyId={} 构造 content-based AuthMethod 失败，回退到路径模式: {:?}",
                        key_id, op_fail.error
                    );
                    SshManager::global()
                        .connect(
                            temp_id.clone(),
                            host.to_string(),
                            port,
                            username,
                            auth_type,
                            password,
                            private_key_path,
                            private_key_passphrase,
                            timeout,
                            agent_identity,
                            certificate_path,
                        )
                        .await
                }
            },
            Err(e) => {
                tracing::warn!(
                    "[SSH Test] sshKeyId={} 加载失败，回退到路径模式: {}",
                    key_id, e
                );
                SshManager::global()
                    .connect(
                        temp_id.clone(),
                        host.to_string(),
                        port,
                        username,
                        auth_type,
                        password,
                        private_key_path,
                        private_key_passphrase,
                        timeout,
                        agent_identity,
                        certificate_path,
                    )
                    .await
            }
        }
    } else {
        SshManager::global()
            .connect(
                temp_id.clone(),
                host.to_string(),
                port,
                username,
                auth_type,
                password,
                private_key_path,
                private_key_passphrase,
                timeout,
                agent_identity,
                certificate_path,
            )
            .await
    };

    match result {
        Ok(()) => {
            let target_type_str = config.get("targetType").and_then(|v| v.as_str()).unwrap_or("linux");
            let target = crate::connection::TargetType::from_str_lossy(target_type_str);
            let mut detected_os_type = None;
            let mut detected_os_info = None;
            if target != crate::connection::TargetType::Network && target != crate::connection::TargetType::Bmc {
                let os_cmd = target.os_detect_command().to_string();
                if let Ok(os_res) = SshManager::global().execute(&temp_id, &os_cmd, 5).await {
                    let parts: Vec<&str> = os_res.stdout.split("---SEP---").collect();
                    let release_content = parts.first().unwrap_or(&"").trim();
                    let arch = parts.get(1).unwrap_or(&"").trim();
                    let kernel = parts.get(2).unwrap_or(&"").trim();

                    let mut os_id = String::new();
                    let mut pretty_name = String::new();
                    for line in release_content.lines() {
                        if let Some(rest) = line.strip_prefix("ID=") {
                            os_id = rest.trim_matches('"').trim().to_lowercase();
                        }
                        if let Some(rest) = line.strip_prefix("PRETTY_NAME=") {
                            pretty_name = rest.trim_matches('"').trim().to_string();
                        }
                    }
                    if os_id.is_empty() || os_id == "linux" {
                        let lower = release_content.to_lowercase();
                        if lower.contains("alibaba") || lower.contains("alinux") || lower.contains("aliyun") {
                            os_id = "alinux".to_string();
                        } else if lower.contains("tencentos") || lower.contains("tlinux") {
                            os_id = "tencentos".to_string();
                        } else if lower.contains("euleros") || lower.contains("huawei") || lower.contains("hce") {
                            os_id = "euleros".to_string();
                        } else if lower.contains("openeuler") {
                            os_id = "openeuler".to_string();
                        } else if lower.contains("amzn") || lower.contains("amazon") {
                            os_id = "amzn".to_string();
                        } else if lower.contains("anolis") {
                            os_id = "anolis".to_string();
                        } else if lower.contains("kylin") {
                            os_id = "kylin".to_string();
                        } else if lower.contains("uos") || lower.contains("deepin") {
                            os_id = "uos".to_string();
                        } else if lower.contains("darwin") {
                            os_id = "darwin".to_string();
                        } else if lower.contains("windows") {
                            os_id = "windows".to_string();
                        }
                    }

                    if !os_id.is_empty() {
                        let components: Vec<&str> = [pretty_name.as_str(), arch, kernel]
                            .iter()
                            .filter(|s| !s.is_empty())
                            .copied()
                            .collect();
                        detected_os_info = Some(components.join(" | "));
                        detected_os_type = Some(os_id);
                    }
                }
            }

            // 测试成功后立即断开
            let _ = SshManager::global().disconnect(&temp_id).await;
            let mut op = OperationResult::ok_with_message("Connection successful");
            op.os_type = detected_os_type;
            op.os_info = detected_os_info;
            Ok(op)
        }
        Err(e) => Ok(OperationResult::fail(format!("{}", e))),
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointDiagnosticCheck {
    pub kind: String,
    pub success: bool,
    pub message: String,
    pub detail: Option<String>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointDiagnosticResult {
    pub host: String,
    pub port: u16,
    pub resolved_addresses: Vec<String>,
    pub checks: Vec<EndpointDiagnosticCheck>,
    pub reachable: bool,
}

/// 从本机诊断 SSH 第一跳端点。这里只进行配置、DNS 和 TCP 探测，
/// 不读取凭据、不修改 known_hosts，也不会占用正式 SSH 连接槽。
#[tauri::command]
pub async fn ssh_diagnose_endpoint(
    host: String,
    port: u16,
    timeout_secs: Option<u64>,
) -> Result<EndpointDiagnosticResult, String> {
    let host = host.trim().to_string();
    if host.is_empty() {
        return Err("Host is required".to_string());
    }
    if port == 0 {
        return Err("Port must be between 1 and 65535".to_string());
    }

    let timeout = std::time::Duration::from_secs(timeout_secs.unwrap_or(6).clamp(2, 15));
    let mut checks = Vec::new();
    checks.push(EndpointDiagnosticCheck {
        kind: "config".to_string(),
        success: true,
        message: format!("Endpoint {}:{} is valid", host, port),
        detail: None,
        duration_ms: 0,
    });

    let dns_started = std::time::Instant::now();
    let addresses = match tokio::time::timeout(
        timeout,
        tokio::net::lookup_host((host.as_str(), port)),
    )
    .await
    {
        Ok(Ok(values)) => {
            let mut values: Vec<std::net::SocketAddr> = values.collect();
            values.sort_unstable();
            values.dedup();
            if values.is_empty() {
                checks.push(EndpointDiagnosticCheck {
                    kind: "dns".to_string(),
                    success: false,
                    message: "DNS returned no addresses".to_string(),
                    detail: None,
                    duration_ms: dns_started.elapsed().as_millis() as u64,
                });
                return Ok(EndpointDiagnosticResult {
                    host: host.clone(),
                    port,
                    resolved_addresses: vec![],
                    checks,
                    reachable: false,
                });
            }
            checks.push(EndpointDiagnosticCheck {
                kind: "dns".to_string(),
                success: true,
                message: format!("Resolved {} address(es)", values.len()),
                detail: Some(
                    values
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                        .join(", "),
                ),
                duration_ms: dns_started.elapsed().as_millis() as u64,
            });
            values
        }
        Ok(Err(error)) => {
            checks.push(EndpointDiagnosticCheck {
                kind: "dns".to_string(),
                success: false,
                message: "DNS resolution failed".to_string(),
                detail: Some(error.to_string()),
                duration_ms: dns_started.elapsed().as_millis() as u64,
            });
            return Ok(EndpointDiagnosticResult {
                host: host.clone(),
                port,
                resolved_addresses: vec![],
                checks,
                reachable: false,
            });
        }
        Err(_) => {
            checks.push(EndpointDiagnosticCheck {
                kind: "dns".to_string(),
                success: false,
                message: "DNS resolution timed out".to_string(),
                detail: None,
                duration_ms: dns_started.elapsed().as_millis() as u64,
            });
            return Ok(EndpointDiagnosticResult {
                host: host.clone(),
                port,
                resolved_addresses: vec![],
                checks,
                reachable: false,
            });
        }
    };

    let tcp_started = std::time::Instant::now();
    let mut last_error = None;
    let mut reachable_address = None;
    for address in &addresses {
        match tokio::time::timeout(timeout, tokio::net::TcpStream::connect(address)).await {
            Ok(Ok(stream)) => {
                reachable_address = Some(*address);
                drop(stream);
                break;
            }
            Ok(Err(error)) => last_error = Some(error.to_string()),
            Err(_) => last_error = Some("TCP connection timed out".to_string()),
        }
    }
    let reachable = reachable_address.is_some();
    checks.push(EndpointDiagnosticCheck {
        kind: "tcp".to_string(),
        success: reachable,
        message: if let Some(address) = reachable_address {
            format!("TCP connection to {} succeeded", address)
        } else {
            format!("TCP connection to {}:{} failed", host, port)
        },
        detail: if reachable { None } else { last_error },
        duration_ms: tcp_started.elapsed().as_millis() as u64,
    });

    Ok(EndpointDiagnosticResult {
        host,
        port,
        resolved_addresses: addresses.iter().map(ToString::to_string).collect(),
        checks,
        reachable,
    })
}

/// 批量检查所有服务器的连接状态
///
/// 返回 { serverId: bool } 映射
///
/// 仅做 TCP 端口可达性检测（参考 Termius/FinalShell/MobaXterm 共识）：
/// - 不解密密码、不进行 SSH 握手、不认证
/// - 已连接的服务器直接短路返回 true（避免不必要的 TCP 探测）
/// - 未连接的仅做 TCP connect 测试（2 秒超时）
/// - 使用 Semaphore(50) 限制并发，避免数千台服务器同时探测压垮文件描述符
///
/// 启动时调用此接口不会阻塞用户后续的 SSH 登录：
/// - TCP 探测与 SshManager::connect() 完全解耦，连接池不参与探测
/// - 用户点击任意服务器即可立即发起真正的 SSH 连接，与探测任务并行
///
/// 注意：此接口不再更新 DB status 字段，状态由 SshManager 维护
#[tauri::command]
pub async fn ssh_check_all_servers(app: AppHandle) -> Result<serde_json::Value, String> {
    // 读取所有服务器（仅需要 id/host/port 字段，密码字段不参与探测故不解密）
    let raw_json = tokio::task::spawn_blocking(db::servers_list_raw)
        .await
        .map_err(|e| format!("Task join error: {}", e))??;
    let servers: Vec<db::Server> = serde_json::from_str(&raw_json)
        .map_err(|e| format!("Failed to parse servers: {}", e))?;

    let total = servers.len();
    // 并发 TCP 探测，Semaphore 限制最大并发 50（避免数千台服务器同时探测压垮文件描述符）
    let semaphore = Arc::new(Semaphore::new(50));
    // 用 Arc<Mutex<HashMap>> 收集结果，供事件推送和最终返回共用
    let results: Arc<tokio::sync::Mutex<std::collections::HashMap<String, bool>>> =
        Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    let done_counter = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let mut join_set = tokio::task::JoinSet::new();

    for server in servers {
        let server_id = server.id.clone();
        let protocol_supported = crate::connection::validate_target_protocol(
            &server.target_type,
            &server.protocol,
        )
        .is_ok();
        let port = if server.protocol.eq_ignore_ascii_case("rdp") || (server.target_type == "windows" && server.port <= 0 && server.rdp_port > 0) {
            server.rdp_port.max(1) as u16
        } else if server.port > 0 {
            server.port as u16
        } else {
            0
        };
        let host = server.host.clone();
        let is_serial = server.protocol.eq_ignore_ascii_case("serial");
        let sem = semaphore.clone();
        let app = app.clone();
        let results = results.clone();
        let done_counter = done_counter.clone();

        join_set.spawn(async move {
            // 等待并发许可（极端情况下排队，不会拒绝）
            let _permit = sem.acquire().await.expect("semaphore closed unexpectedly");
            // 已连接直接短路返回 true（避免对在线服务器重复探测）
            let online = if !protocol_supported || is_serial || port == 0 {
                false
            } else if SshManager::global().is_connected_sync(&server_id) {
                true
            } else {
                // 仅 TCP 端口可达性检测（2 秒超时）
                test_tcp_connection(&host, port, 2).await
            };

            // 增量推送：每完成一个探测立即 emit 事件，前端实时更新单台状态和统计
            let done = done_counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            results.lock().await.insert(server_id.clone(), online);
            let _ = app.emit(
                "server:probe-progress",
                serde_json::json!({
                    "serverId": server_id,
                    "online": online,
                    "total": total,
                    "done": done,
                }),
            );

            (server_id, online)
        });
    }

    while join_set.join_next().await.is_some() {}

    let results = results.lock().await;
    serde_json::to_value(&*results).map_err(|e| format!("Serialize error: {}", e))
}

/// 检测服务器的 OS 信息
///
/// 如果未连接则先连接，然后执行 `cat /etc/os-release; uname -m; uname -r`
/// 更新数据库的 osType / osInfo 字段
#[tauri::command]
pub async fn ssh_detect_os_info(
    server_id: String,
) -> Result<DetectOsResult, String> {
    // 始终读取配置：既为获取 target_type（选择 OS 探测命令），也为未连接时建立连接
    let server = load_server_config(&server_id).await?;
    // 按连接目标类型选择 OS 探测命令（linux 与原实现一致，windows 走 PowerShell）
    let os_cmd = crate::connection::TargetType::from_str_lossy(&server.target_type)
        .os_detect_command()
        .to_string();

    // 如果未连接，先连接（支持代理与内容密钥）
    if !SshManager::global().is_connected_sync(&server_id) {
        match connect_server_entry(&server, &server_id).await {
            Ok(()) => {
                // 仅更新 last_accessed_at（不再写 status=online）
                let update_json = serde_json::json!({
                    "lastAccessedAt": now_ms(),
                })
                .to_string();
                db_update_async(server_id.clone(), update_json);
            }
            Err(e) => {
                // 仅持久化错误信息
                let update_json = serde_json::json!({
                    "lastError": format!("{}", e),
                })
                .to_string();
                db_update_async(server_id.clone(), update_json);
                return Ok(DetectOsResult::fail(e.to_string()));
            }
        }
    }

    let target_type = crate::connection::TargetType::from_str_lossy(&server.target_type);
    if target_type == crate::connection::TargetType::Network || target_type == crate::connection::TargetType::Bmc {
        let update_json = serde_json::json!({
            "osType": "network",
            "osInfo": "Network Device",
            "arch": "",
            "kernel": "",
        })
        .to_string();
        db_update_async(server_id.clone(), update_json);
        return Ok(DetectOsResult::ok("network", "Network Device"));
    }

    // 获取 OS 信息
    match SshManager::global().execute(&server_id, &os_cmd, 15).await {
        Ok(os_res) => {
            let parts: Vec<&str> = os_res.stdout.split("---SEP---").collect();
            let release_content = parts.first().unwrap_or(&"").trim();
            let arch = parts.get(1).unwrap_or(&"").trim();
            let kernel = parts.get(2).unwrap_or(&"").trim();

            let mut os_id = String::new();
            let mut pretty_name = String::new();
            for line in release_content.lines() {
                if let Some(rest) = line.strip_prefix("ID=") {
                    os_id = rest.trim_matches('"').trim().to_lowercase();
                }
                if let Some(rest) = line.strip_prefix("PRETTY_NAME=") {
                    pretty_name = rest.trim_matches('"').trim().to_string();
                }
            }
            if os_id.is_empty() || os_id == "linux" {
                let lower = release_content.to_lowercase();
                if lower.contains("alibaba") || lower.contains("alinux") || lower.contains("aliyun") {
                    os_id = "alinux".to_string();
                } else if lower.contains("tencentos") || lower.contains("tlinux") {
                    os_id = "tencentos".to_string();
                } else if lower.contains("euleros") || lower.contains("huawei") || lower.contains("hce") {
                    os_id = "euleros".to_string();
                } else if lower.contains("openeuler") {
                    os_id = "openeuler".to_string();
                } else if lower.contains("amzn") || lower.contains("amazon") {
                    os_id = "amzn".to_string();
                } else if lower.contains("anolis") {
                    os_id = "anolis".to_string();
                } else if lower.contains("kylin") {
                    os_id = "kylin".to_string();
                } else if lower.contains("uos") || lower.contains("deepin") {
                    os_id = "uos".to_string();
                } else if lower.contains("darwin") {
                    os_id = "darwin".to_string();
                } else if lower.contains("windows") {
                    os_id = "windows".to_string();
                }
            }

            if !os_id.is_empty() {
                let components: Vec<&str> = [pretty_name.as_str(), arch, kernel]
                    .iter()
                    .filter(|s| !s.is_empty())
                    .copied()
                    .collect();
                let os_info = components.join(" | ");

                // 更新数据库 osType / osInfo
                let id = server_id.clone();
                let update_json = serde_json::json!({
                    "osType": os_id,
                    "osInfo": os_info,
                })
                .to_string();
                db_update_async(id, update_json);

                return Ok(DetectOsResult::ok(&os_id, &os_info));
            }
            Ok(DetectOsResult::ok_no_info())
        }
        Err(e) => {
            // OS 探测失败：记录日志并持久化错误到 DB，避免前端只看到 success=false 却无诊断信息
            eprintln!("[SSH] {} OS detect failed: {}", server_id, e);
            let update_json = serde_json::json!({
                "lastError": format!("OS detect: {}", e),
            })
            .to_string();
            db_update_async(server_id.clone(), update_json);
            Ok(DetectOsResult::fail(format!("{}", e)))
        }
    }
}

// ============================================================
// 交互式 Shell
// ============================================================

/// 获取远程用户的 home 目录路径
///
/// 按目标类型分发：
/// - Linux：调用 targets::linux::home_dir（SFTP canonicalize + echo $HOME 回退）
/// - Windows：调用 targets::windows::home_dir（SFTP canonicalize + cmd.exe echo %USERPROFILE% 回退）
#[tauri::command]
pub async fn ssh_get_home_directory(server_id: String) -> Result<String, String> {
    let target_type = load_server_config(&server_id)
        .await
        .map(|s| s.target_type)
        .unwrap_or_else(|_| "linux".to_string());
    if target_type.eq_ignore_ascii_case("windows") {
        let home = crate::targets::windows::home_dir::get_home_directory(&server_id).await?;
        return Ok(crate::targets::windows::validators::windows_to_posix_path(&home));
    }
    crate::targets::linux::home_dir::get_home_directory(&server_id).await
}

/// Shell 创建结果（与前端 CreateShellResult 对应）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateShellResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

/// 创建交互式 Shell（PTY）
#[tauri::command]
pub async fn ssh_create_shell(
    app: AppHandle,
    window: tauri::WebviewWindow,
    server_id: String,
    cols: Option<u32>,
    rows: Option<u32>,
    encoding: Option<String>,
) -> Result<CreateShellResult, String> {
    let c = match cols {
        Some(val) if val > 0 => val,
        _ => 80,
    };
    let r = match rows {
        Some(val) if val > 0 => val,
        _ => 24,
    };
    let window_label = window.label().to_string();
    match crate::ssh::shell::shell_create(app, window_label, server_id, c, r, encoding.unwrap_or_else(|| "utf-8".to_string())).await {
        Ok(session_id) => Ok(CreateShellResult {
            success: true,
            error: None,
            session_id: Some(session_id),
        }),
        Err(e) => Ok(CreateShellResult {
            success: false,
            error: Some(e),
            session_id: None,
        }),
    }
}

/// 向 Shell 写入数据（fire-and-forget，保证输入顺序）
///
/// 路由：session_id 以 `telnet-` 开头时转发到 Telnet 模块；以 `serial-` 开头时转发到串口模块；否则走 SSH shell。
#[tauri::command]
pub async fn ssh_write_to_shell(session_id: String, data: String) -> Result<(), String> {
    if session_id.starts_with("serial-") {
        return crate::serial::write_to_serial(&session_id, &data).await;
    }
    if session_id.starts_with("telnet-") {
        return crate::telnet::telnet_write(session_id, data).await;
    }
    crate::ssh::shell::shell_write(String::new(), session_id, data).await
}

/// 通过独立快速通道向交互式 SSH PTY 发送 Ctrl+C。
#[tauri::command]
pub async fn ssh_interrupt_shell(session_id: String) -> Result<u64, String> {
    if session_id.starts_with("serial-") {
        crate::serial::write_to_serial(&session_id, "\x03").await?;
        return Ok(0);
    }
    if session_id.starts_with("telnet-") {
        crate::telnet::telnet_write(session_id, "\x03".to_string()).await?;
        return Ok(0);
    }
    crate::ssh::shell::shell_interrupt(session_id).await
}

#[tauri::command]
pub async fn ssh_set_shell_encoding(session_id: String, encoding: String) -> Result<(), String> {
    if session_id.starts_with("telnet-") {
        return crate::telnet::telnet_set_encoding(session_id, encoding).await;
    }
    crate::ssh::shell::shell_set_encoding(session_id, encoding).await
}

/// 调整 Shell PTY 大小（fire-and-forget）
///
/// 路由：session_id 以 `telnet-` 开头时转发到 Telnet 模块（NAWS），串口无需 resize，否则走 SSH PTY resize。
#[tauri::command]
pub async fn ssh_resize_shell(
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    if session_id.starts_with("serial-") {
        return Ok(());
    }
    if session_id.starts_with("telnet-") {
        return crate::telnet::telnet_resize(session_id, cols, rows).await;
    }
    crate::ssh::shell::shell_resize(String::new(), session_id, cols, rows).await
}

/// 暂停 Shell 会话读取（前端高水位背压）
#[tauri::command]
pub async fn ssh_pause_shell(session_id: String) -> Result<(), String> {
    if session_id.starts_with("serial-") || session_id.starts_with("telnet-") {
        return Ok(());
    }
    crate::ssh::shell::shell_pause(String::new(), session_id).await
}

/// 恢复 Shell 会话读取（前端低水位背压解除）
#[tauri::command]
pub async fn ssh_resume_shell(session_id: String) -> Result<(), String> {
    if session_id.starts_with("serial-") || session_id.starts_with("telnet-") {
        return Ok(());
    }
    crate::ssh::shell::shell_resume(String::new(), session_id).await
}

/// 向 Shell 写入 Zmodem 协议响应字节
///
/// 前端 zmodem.js 解析 shell:zmodem-data 后调用此命令把响应字节
/// （ZRINIT/ZACK/ZRPOS/ZDATA 等）回写给服务器。data 参数为 base64 编码。
#[tauri::command]
pub async fn ssh_shell_zmodem_write(
    session_id: String,
    data: String,
) -> Result<(), String> {
    if session_id.starts_with("serial-") {
        let bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            data.as_bytes(),
        )
        .map_err(|e| format!("Base64 解码失败: {}", e))?;
        return crate::serial::write_raw_to_serial(&session_id, &bytes).await;
    }
    crate::ssh::shell::shell_zmodem_write(String::new(), session_id, data).await
}

/// 通知 Zmodem 传输结束，退出 passthrough 模式
///
/// 前端 zmodem.js 检测到传输完成（ZEOF）或用户主动取消时调用。
#[tauri::command]
pub async fn ssh_shell_zmodem_end(session_id: String) -> Result<OperationResult, String> {
    if session_id.starts_with("serial-") {
        return Ok(OperationResult::ok());
    }
    match crate::ssh::shell::shell_zmodem_end(String::new(), session_id).await {
        Ok(()) => Ok(OperationResult::ok()),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 关闭 Shell 会话
///
/// 路由：session_id 以 `telnet-` / `serial-` 开头时转发到对应模块。
#[tauri::command]
pub async fn ssh_close_shell(session_id: String) -> Result<OperationResult, String> {
    if session_id.starts_with("serial-") {
        return match crate::serial::close_serial_shell(&session_id) {
            Ok(()) => Ok(OperationResult::ok()),
            Err(e) => Ok(OperationResult::fail(e)),
        };
    }
    if session_id.starts_with("telnet-") {
        return match crate::telnet::telnet_close(session_id).await {
            Ok(()) => Ok(OperationResult::ok()),
            Err(e) => Ok(OperationResult::fail(e)),
        };
    }
    match crate::ssh::shell::shell_close(String::new(), session_id).await {
        Ok(()) => Ok(OperationResult::ok()),
        Err(e) => Ok(OperationResult::fail(e)),
    }
}

/// 获取 Shell 会话的历史输出（用于跨窗口迁移时恢复终端内容）
///
/// 路由：session_id 以 `telnet-` / `serial-` 开头时转发到对应模块。
#[tauri::command]
pub async fn ssh_get_shell_history(session_id: String) -> Result<String, String> {
    if session_id.starts_with("serial-") {
        return crate::serial::get_serial_history(&session_id);
    }
    if session_id.starts_with("telnet-") {
        return crate::telnet::telnet_get_history(session_id).await;
    }
    crate::ssh::shell::shell_get_history(session_id).await
}

// ============================================================
// SSH 密钥生成 / SSH Agent 状态查询（对齐 Termius/MobaXterm/SecureCRT）
// ============================================================

/// 密钥生成请求参数
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateKeyRequest {
    /// 算法：`ed25519` | `rsa` | `ecdsa-p256` | `ecdsa-p384`
    ///
    /// 兼容大小写与连字符变体：`ED25519` / `RSA-4096` / `ecdsa_p256` 等
    pub algorithm: String,
    /// RSA 位数的可选覆盖（默认 3072，仅 algorithm=rsa 时生效）
    pub rsa_bits: Option<u32>,
    /// 保存目录（绝对路径，建议用户通过对话框选择）
    pub save_dir: String,
    /// 文件名（不含扩展名，如 `id_ed25519`）
    pub file_name: String,
    /// 加密 passphrase（空字符串或 None 表示不加密）
    pub passphrase: Option<String>,
    /// 注释（写入私钥末尾与 .pub 文件末尾，便于辨识归属）
    pub comment: Option<String>,
}

/// 密钥生成结果
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateKeyResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// 私钥文件绝对路径
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key_path: Option<String>,
    /// 公钥文件绝对路径（`*.pub`）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_key_path: Option<String>,
    /// 公钥字符串（`ssh-ed25519 AAAA... comment`，便于直接复制到 authorized_keys）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_key: Option<String>,
    /// 算法显示名（如 `Ed25519` / `RSA 3072`）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub algorithm: Option<String>,
}

/// 在应用内生成 SSH 密钥对并保存为 OpenSSH 格式文件
///
/// 算法支持：
/// - `ed25519`：现代推荐，速度快、密钥短
/// - `rsa`：兼容性最佳，默认 3072 位（ssh-key 0.7 内部固定）
/// - `ecdsa-p256` / `ecdsa-p384`：性能与兼容性的折中
///
/// 输出：
/// - `<save_dir>/<file_name>`：OpenSSH 格式私钥（如有 passphrase 则加密）
/// - `<save_dir>/<file_name>.pub`：OpenSSH 格式公钥
///
/// Unix 平台自动设置私钥文件权限为 0600。
#[tauri::command]
pub async fn ssh_generate_key(req: GenerateKeyRequest) -> Result<GenerateKeyResult, String> {
    use crate::ssh::keys::{generate_and_save_key, KeyAlgorithm};

    // 解析算法（兼容大小写与常见分隔符）
    let algo_normalized = req.algorithm.to_lowercase().replace(['-', '_'], "");
    let algorithm = match algo_normalized.as_str() {
        "ed25519" => KeyAlgorithm::Ed25519,
        "rsa" => KeyAlgorithm::Rsa {
            bits: req.rsa_bits.unwrap_or(3072),
        },
        "ecdsap256" | "ecdsa256" | "ecdsa" => KeyAlgorithm::EcdsaP256,
        "ecdsap384" | "ecdsa384" => KeyAlgorithm::EcdsaP384,
        other => {
            return Ok(GenerateKeyResult {
                success: false,
                error: Some(format!(
                    "不支持的密钥算法: {}。请使用 ed25519 / rsa / ecdsa-p256 / ecdsa-p384",
                    other
                )),
                private_key_path: None,
                public_key_path: None,
                public_key: None,
                algorithm: None,
            });
        }
    };

    // 路径安全检查：防止 path traversal 与命令注入
    let save_dir = std::path::Path::new(&req.save_dir);
    let file_name = req.file_name.trim();
    if file_name.is_empty() {
        return Ok(GenerateKeyResult {
            success: false,
            error: Some("文件名不能为空".into()),
            private_key_path: None,
            public_key_path: None,
            public_key: None,
            algorithm: None,
        });
    }
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains('\0') {
        return Ok(GenerateKeyResult {
            success: false,
            error: Some("文件名不能包含路径分隔符或 null 字节".into()),
            private_key_path: None,
            public_key_path: None,
            public_key: None,
            algorithm: None,
        });
    }
    // 私钥保存路径
    let key_path = save_dir.join(file_name);

    // 处理 passphrase：空字符串视为不加密
    let passphrase_opt = req
        .passphrase
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    let comment = req.comment.as_deref().map(|s| s.trim()).unwrap_or("");
    let key_path_clone = key_path.clone();
    let pass_clone = passphrase_opt.map(|s| s.to_string());
    let comment_clone = comment.to_string();

    // 生成并保存（在阻塞线程中执行，避免阻塞 async runtime）
    let result = tokio::task::spawn_blocking(move || {
        generate_and_save_key(
            algorithm,
            &key_path_clone,
            pass_clone.as_deref(),
            &comment_clone,
        )
    })
    .await;

    match result {
        Ok(Ok(key)) => Ok(GenerateKeyResult {
            success: true,
            error: None,
            private_key_path: Some(key.private_key_path),
            public_key_path: Some(key.public_key_path),
            public_key: Some(key.public_key),
            algorithm: Some(key.algorithm),
        }),
        Ok(Err(e)) => Ok(GenerateKeyResult {
            success: false,
            error: Some(e),
            private_key_path: None,
            public_key_path: None,
            public_key: None,
            algorithm: None,
        }),
        Err(e) => Ok(GenerateKeyResult {
            success: false,
            error: Some(format!("生成任务执行失败: {}", e)),
            private_key_path: None,
            public_key_path: None,
            public_key: None,
            algorithm: None,
        }),
    }
}

/// 检测系统 SSH Agent 是否可用
///
/// - Unix：检查 `SSH_AUTH_SOCK` 环境变量指向的 Unix domain socket
/// - Windows：检查系统 OpenSSH Agent，并兼容 Pageant / MobaXterm 命名管道
///
/// 返回 `{ available: bool, platform: "unix" | "windows", message?: string }`
#[tauri::command]
pub async fn ssh_test_ssh_agent() -> Result<serde_json::Value, String> {
    let available = crate::ssh::agent::AgentConnection::is_available().await;
    let platform = if cfg!(unix) {
        "unix"
    } else if cfg!(windows) {
        "windows"
    } else {
        "unknown"
    };

    let message = if available {
        match platform {
            "unix" => Some("SSH Agent 已就绪（ssh-agent + ssh-add）".to_string()),
            "windows" => Some("Windows OpenSSH Agent / Pageant 已就绪".to_string()),
            _ => None,
        }
    } else {
        match platform {
            "unix" => Some(
                "未检测到 SSH Agent。请确认 ssh-agent 已启动并通过 ssh-add 加载密钥".to_string(),
            ),
            "windows" => Some(
                "未检测到 Windows OpenSSH Agent 或 Pageant。请启动系统 ssh-agent、Pageant 或 MobaXterm Agent".to_string(),
            ),
            _ => Some("当前平台不支持 SSH Agent".to_string()),
        }
    };

    Ok(serde_json::json!({
        "available": available,
        "platform": platform,
        "message": message,
    }))
}

/// 列出 SSH Agent 中已加载的所有身份（公钥）
///
/// 用于服务器配置界面让用户从 agent 中选择具体的身份进行认证。
/// 返回 `IdentityInfo[]`，每项包含算法名、公钥 base64、SHA256 指纹。
#[tauri::command]
pub async fn ssh_list_agent_identities() -> Result<Vec<crate::ssh::agent::IdentityInfo>, String> {
    crate::ssh::agent::AgentConnection::list_identities_info()
        .await
        .map_err(|e| format!("{}", e))
}
