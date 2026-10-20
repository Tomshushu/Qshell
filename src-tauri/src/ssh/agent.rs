//! SSH Agent 客户端：跨平台（Unix ssh-agent + Windows Pageant）
//!
//! 对齐 Termius / MobaXterm / SecureCRT 的 Agent 认证能力：
//! - Unix: 通过 `SSH_AUTH_SOCK` 环境变量连接 Unix domain socket
//! - Windows: 优先连接系统 OpenSSH Agent 管道，兼容 Pageant/MobaXterm 管道
//!
//! 协议参考: https://datatracker.ietf.org/doc/html/draft-miller-ssh-agent
//!
//! 设计要点：
//! - 不使用 russh-keys 0.45 的 AgentClient（其在 Windows 上返回 AgentFailure）
//! - Unix 路径复用 russh-keys 的 AgentClient（已实现完整协议）
//! - Windows 路径自实现 Pageant named pipe 客户端
//! - 通过 `authenticate_future` + 自定义 Signer 集成到 russh 认证流程

use russh::keys::PublicKey;

use super::connection::SshError;

/// SSH Agent 连接（跨平台）
///
/// 内部使用 Option 包装 agent client，因为 russh-keys 的 `sign_request`
/// 是 by-ownership 的（消耗 self 并返回 self），需要 take/put 模式。
pub enum AgentConnection {
    #[cfg(unix)]
    Unix(Option<russh::keys::agent::client::AgentClient<tokio::net::UnixStream>>),
    #[cfg(windows)]
    Windows(WindowsPageantClient),
}

impl AgentConnection {
    /// 通过环境变量/默认路径连接到系统 SSH agent
    ///
    /// - Unix: 读取 `SSH_AUTH_SOCK` 环境变量
    /// - Windows: 依次尝试 OpenSSH Agent 与 Pageant 兼容管道
    pub async fn connect_env() -> Result<Self, SshError> {
        #[cfg(unix)]
        {
            Self::connect_unix_env().await
        }
        #[cfg(windows)]
        {
            Self::connect_windows_pageant().await
        }
        #[cfg(not(any(unix, windows)))]
        {
            Err(SshError::AuthFailed("SSH Agent: 当前平台不支持".into()))
        }
    }

    /// 检测 agent 是否可用（不抛错，返回 bool）
    pub async fn is_available() -> bool {
        Self::connect_env().await.is_ok()
    }

    /// 列出 agent 中已注册的所有公钥
    pub async fn request_identities(&mut self) -> Result<Vec<PublicKey>, SshError> {
        match self {
            #[cfg(unix)]
            AgentConnection::Unix(opt) => {
                let client = opt.as_mut().ok_or_else(|| {
                    SshError::AuthFailed("Agent connection already consumed".into())
                })?;
                // russh 0.64 返回 Vec<AgentIdentity>，映射为公钥列表
                client.request_identities().await.map_err(|e| {
                    SshError::AuthFailed(format!("Agent request_identities 失败: {}", e))
                }).map(|identities| {
                    identities.into_iter().map(|id| id.public_key().into_owned()).collect()
                })
            }
            #[cfg(windows)]
            AgentConnection::Windows(c) => c.request_identities().await,
        }
    }

    /// 请求 agent 用指定公钥签名数据
    ///
    /// 返回 SSH 协议格式的签名 blob（已包含签名算法名前缀）
    pub async fn sign_request(
        &mut self,
        public: &PublicKey,
        data: Vec<u8>,
    ) -> Result<Vec<u8>, SshError> {
        match self {
            #[cfg(unix)]
            AgentConnection::Unix(opt) => {
                // russh 0.64 的 sign_request 是 &mut self，无需 take/put 模式
                let client = opt.as_mut().ok_or_else(|| {
                    SshError::AuthFailed("Agent connection already consumed".into())
                })?;
                let identity = russh::keys::agent::AgentIdentity::from(public.clone());
                client.sign_request(&identity, None, data).await
                    .map_err(|e| SshError::AuthFailed(format!("Agent sign_request 失败: {}", e)))
            }
            #[cfg(windows)]
            AgentConnection::Windows(c) => c.sign_request(public, data).await,
        }
    }
}

#[cfg(unix)]
impl AgentConnection {
    async fn connect_unix_env() -> Result<Self, SshError> {
        use russh::keys::agent::client::AgentClient;

        let sock = std::env::var("SSH_AUTH_SOCK").map_err(|_| {
            SshError::AuthFailed(
                "SSH Agent 未运行：未设置 SSH_AUTH_SOCK 环境变量。\
                 请启动 ssh-agent 并通过 ssh-add 添加密钥"
                    .into(),
            )
        })?;

        let client = AgentClient::connect_uds(&sock)
            .await
            .map_err(|e| SshError::AuthFailed(format!("连接 SSH Agent ({}) 失败: {}", sock, e)))?;

        Ok(AgentConnection::Unix(Some(client)))
    }
}

#[cfg(windows)]
impl AgentConnection {
    async fn connect_windows_pageant() -> Result<Self, SshError> {
        let client = WindowsPageantClient::connect().await?;
        Ok(AgentConnection::Windows(client))
    }
}

// ============================================================================
// Windows Pageant 客户端（命名管道实现）
// ============================================================================

#[cfg(windows)]
pub struct WindowsPageantClient {
    pipe: tokio::net::windows::named_pipe::NamedPipeClient,
}

#[cfg(windows)]
impl WindowsPageantClient {
    /// 优先连接 Windows OpenSSH Agent，失败后尝试 Pageant/MobaXterm 兼容管道。
    async fn connect() -> Result<Self, SshError> {
        let mut last_error = None;
        for pipe_name in [r"\\.\pipe\openssh-ssh-agent", r"\\.\pipe\pageant"] {
            match tokio::net::windows::named_pipe::ClientOptions::new().open(pipe_name) {
                Ok(pipe) => return Ok(Self { pipe }),
                Err(e) => last_error = Some(e),
            }
        }
        Err(SshError::AuthFailed(format!(
            "未检测到 Windows OpenSSH Agent 或 Pageant 兼容管道: {}",
            last_error
                .map(|e| e.to_string())
                .unwrap_or_else(|| "unknown error".to_string())
        )))
    }

    /// 发送请求并读取响应（ssh-agent 协议：4 字节长度 + payload）
    async fn request(&mut self, payload: &[u8]) -> Result<Vec<u8>, SshError> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        // 写入：4 字节大端长度 + payload
        let len = payload.len() as u32;
        self.pipe.write_all(&len.to_be_bytes()).await.map_err(|e| {
            SshError::AuthFailed(format!("Pageant 写入失败: {}", e))
        })?;
        self.pipe.write_all(payload).await.map_err(|e| {
            SshError::AuthFailed(format!("Pageant 写入失败: {}", e))
        })?;
        self.pipe.flush().await.map_err(|e| {
            SshError::AuthFailed(format!("Pageant flush 失败: {}", e))
        })?;

        // 读取响应：4 字节长度 + payload
        let mut len_buf = [0u8; 4];
        self.pipe.read_exact(&mut len_buf).await.map_err(|e| {
            SshError::AuthFailed(format!("Pageant 读取长度失败: {}", e))
        })?;
        let resp_len = u32::from_be_bytes(len_buf) as usize;

        // 限制最大响应大小（防止异常响应导致内存爆炸）
        const MAX_RESPONSE_SIZE: usize = 256 * 1024;
        if resp_len > MAX_RESPONSE_SIZE {
            return Err(SshError::AuthFailed(format!(
                "Pageant 响应过大 ({} bytes)，可能协议异常",
                resp_len
            )));
        }

        let mut resp = vec![0u8; resp_len];
        self.pipe.read_exact(&mut resp).await.map_err(|e| {
            SshError::AuthFailed(format!("Pageant 读取响应失败: {}", e))
        })?;

        Ok(resp)
    }

    /// 列出 agent 中的公钥
    async fn request_identities(&mut self) -> Result<Vec<PublicKey>, SshError> {
        // SSH_AGENTC_REQUEST_IDENTITIES = 11
        let resp = self.request(&[11]).await?;

        if resp.is_empty() || resp[0] != 12 {
            return Err(SshError::AuthFailed(
                "Pageant 返回非预期响应（REQUEST_IDENTITIES 失败）".into(),
            ));
        }

        // 解析 SSH_AGENT_IDENTITIES_ANSWER = 12
        // 格式: byte(12) + uint32(num_keys) + [string(pubkey_blob) + string(comment)]*
        let mut pos = 1;
        if resp.len() < pos + 4 {
            return Err(SshError::AuthFailed("Pageant 响应截断".into()));
        }
        let num_keys = u32::from_be_bytes([
            resp[pos],
            resp[pos + 1],
            resp[pos + 2],
            resp[pos + 3],
        ]) as usize;
        pos += 4;

        let mut keys = Vec::with_capacity(num_keys);
        for _ in 0..num_keys {
            // 读取 key blob
            if resp.len() < pos + 4 {
                break;
            }
            let blob_len = u32::from_be_bytes([
                resp[pos],
                resp[pos + 1],
                resp[pos + 2],
                resp[pos + 3],
            ]) as usize;
            pos += 4;
            if resp.len() < pos + blob_len {
                break;
            }
            let blob = &resp[pos..pos + blob_len];
            pos += blob_len;

            // 读取 comment（跳过）
            if resp.len() < pos + 4 {
                break;
            }
            let comment_len = u32::from_be_bytes([
                resp[pos],
                resp[pos + 1],
                resp[pos + 2],
                resp[pos + 3],
            ]) as usize;
            pos += 4;
            if resp.len() < pos + comment_len {
                break;
            }
            pos += comment_len;

            // 解析公钥 blob
            match russh::keys::key::parse_public_key(blob) {
                Ok(pk) => keys.push(pk),
                Err(e) => {
                    tracing::warn!("[SSH Agent] 跳过无法解析的公钥: {}", e);
                }
            }
        }

        Ok(keys)
    }

    /// 请求签名
    async fn sign_request(
        &mut self,
        public: &PublicKey,
        data: Vec<u8>,
    ) -> Result<Vec<u8>, SshError> {
        use russh::keys::PublicKeyBase64;

        // 构造 SSH_AGENTC_SIGN_REQUEST = 13
        // 格式: byte(13) + string(pubkey_blob) + string(data) + uint32(flags)
        let pubkey_blob = public.public_key_bytes();

        let mut payload = Vec::new();
        payload.push(13); // SSH_AGENTC_SIGN_REQUEST

        // string(pubkey_blob)
        let blob_len = pubkey_blob.len() as u32;
        payload.extend_from_slice(&blob_len.to_be_bytes());
        payload.extend_from_slice(&pubkey_blob);

        // string(data)
        let data_len = data.len() as u32;
        payload.extend_from_slice(&data_len.to_be_bytes());
        payload.extend_from_slice(&data);

        // uint32(flags): SSH_AGENT_RSA_SHA2_512 = 0x04 (现代 RSA 推荐)
        // 对于 Ed25519/ECDSA，flags 会被忽略
        let flags: u32 = if matches!(public.algorithm(), russh::keys::Algorithm::Rsa { .. }) {
            0x04 // SSH_AGENT_RSA_SHA2_512
        } else {
            0
        };
        payload.extend_from_slice(&flags.to_be_bytes());

        let resp = self.request(&payload).await?;

        if resp.is_empty() {
            return Err(SshError::AuthFailed("Pageant 返回空响应".into()));
        }
        if resp[0] != 14 {
            // SSH_AGENT_SIGN_RESPONSE = 14, SSH_AGENT_FAILURE = 5
            return Err(SshError::AuthFailed(format!(
                "Pageant 拒绝签名请求 (响应码: {})",
                resp[0]
            )));
        }

        // 解析 SSH_AGENT_SIGN_RESPONSE: byte(14) + string(signature)
        if resp.len() < 5 {
            return Err(SshError::AuthFailed("Pageant 签名响应截断".into()));
        }
        let sig_len = u32::from_be_bytes([
            resp[1],
            resp[2],
            resp[3],
            resp[4],
        ]) as usize;
        if resp.len() < 5 + sig_len {
            return Err(SshError::AuthFailed("Pageant 签名响应长度不匹配".into()));
        }
        let sig = resp[5..5 + sig_len].to_vec();
        Ok(sig)
    }
}

// ============================================================================
// russh Signer 实现（用于 authenticate_future）
// ============================================================================

/// AgentSigner: 持有 agent 连接，实现 russh::auth::Signer trait
///
/// russh 的 `authenticate_future` 接受一个 `Signer`，当服务器需要签名时
/// 会调用 `auth_publickey_sign`，我们委托给 SSH agent 完成签名。
///
/// 注意: russh::auth::Signer trait 的 `auth_publickey_sign(self, ...)` 是
/// by-ownership 的（消耗 self 并在 Future 中返回新的 self），因此不能用
/// `&mut self`，需要手动实现 Future（不能用 async_trait）。
pub struct AgentSigner {
    /// Agent 连接（签名时消耗，完成后在新 self 中放回）
    pub connection: Option<AgentConnection>,
}

impl AgentSigner {
    pub fn new(connection: AgentConnection) -> Self {
        Self {
            connection: Some(connection),
        }
    }
}

impl russh::Signer for AgentSigner {
    type Error = SshError;

    // russh 0.64 的 Signer 改为 `auth_sign(&mut self, &AgentIdentity, Option<HashAlg>, Vec<u8>)`，
    // 使用 RPITIT（无 `Future` 关联类型），且为 &mut self（无需 take/put）。
    // hash_alg 目前忽略：AgentConnection::sign_request 由 agent 自行选择签名 hash，
    // Ed25519/ECDSA 不依赖 hash_alg，RSA 场景后续如需可透传。
    fn auth_sign(
        &mut self,
        key: &russh::keys::agent::AgentIdentity,
        _hash_alg: Option<russh::keys::HashAlg>,
        to_sign: Vec<u8>,
    ) -> impl std::future::Future<Output = Result<Vec<u8>, Self::Error>> + Send {
        let public = key.public_key().into_owned();
        async move {
            match self.connection.as_mut() {
                Some(c) => c.sign_request(&public, to_sign).await,
                None => Err(SshError::AuthFailed("Agent connection already consumed".into())),
            }
        }
    }
}

// ============================================================================
// 便捷 API
// ============================================================================

impl AgentConnection {
    /// 列出 agent 中所有公钥的信息（用于 UI 显示）
    pub async fn list_identities_info() -> Result<Vec<IdentityInfo>, SshError> {
        let mut conn = Self::connect_env().await?;
        let keys = conn.request_identities().await?;
        let mut infos = Vec::with_capacity(keys.len());
        for pk in keys {
            use russh::keys::PublicKeyBase64;
            let algo = pk.algorithm().to_string();
            let b64 = pk.public_key_base64();
            infos.push(IdentityInfo {
                algorithm: algo,
                public_key_base64: b64,
                fingerprint: compute_fingerprint(&pk),
            });
        }
        Ok(infos)
    }
}

/// Agent 中的身份信息（用于 UI 显示）
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityInfo {
    /// 算法名，如 "ssh-ed25519"
    pub algorithm: String,
    /// 公钥 base64
    pub public_key_base64: String,
    /// SHA256 指纹
    pub fingerprint: String,
}

/// 计算公钥的 SHA256 指纹
fn compute_fingerprint(pk: &PublicKey) -> String {
    use base64::Engine;
    use russh::keys::PublicKeyBase64;
    use sha2::{Digest, Sha256};

    let blob = pk.public_key_bytes();
    let hash = Sha256::digest(&blob);
    let b64 = base64::engine::general_purpose::STANDARD.encode(hash);
    format!("SHA256:{}", b64)
}
