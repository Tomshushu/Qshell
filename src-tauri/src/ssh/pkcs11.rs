//! PKCS#11 智能卡 / 硬件安全密钥（YubiKey、OpenSC、国密/UKey 等）SSH 认证支持。
//!
//! 通过 `cryptoki` 在运行时动态加载用户指定的 PKCS#11 共享库（`.dll` / `.so` / `.dylib`），
//! 在零编译期原生驱动依赖的前提下枚举硬件令牌中的私钥与公钥，实现 `russh::Signer`
//! 并在连接期通过 `AuthInteractionRegistry` 安全弹窗请求 PIN（若未预存）。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use cryptoki::context::{CInitializeArgs, Pkcs11};
use cryptoki::mechanism::eddsa::{EddsaParams, EddsaSignatureScheme};
use cryptoki::mechanism::Mechanism;
use cryptoki::object::{Attribute, AttributeType, KeyType, ObjectClass, ObjectHandle};
use cryptoki::session::{Session, UserType};
use cryptoki::types::AuthPin;
use russh::keys::agent::AgentIdentity;
use russh::keys::{Algorithm, EcdsaCurve, HashAlg, PublicKey};
use russh::Signer;
use serde::Serialize;
use sha2::{Digest, Sha256, Sha384, Sha512};

/// PKCS#11 密钥算法类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pkcs11KeyKind {
    Rsa,
    Ecdsa(EcdsaCurve),
    Ed25519,
}

/// 枚举出的 PKCS#11 硬件密钥摘要信息（供前端预览或日志诊断）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pkcs11IdentityInfo {
    pub slot_id: u64,
    pub slot_label: String,
    pub key_label: String,
    pub key_id_hex: String,
    pub algorithm: String,
    pub fingerprint: String,
}

struct Pkcs11SessionState {
    _ctx: Arc<Pkcs11>,
    session: Session,
    private_key: ObjectHandle,
    key_kind: Pkcs11KeyKind,
}

static PKCS11_CTX_CACHE: OnceLock<Mutex<HashMap<PathBuf, Arc<Pkcs11>>>> = OnceLock::new();

/// PKCS#11 硬件签名器（实现 `russh::Signer`）
pub struct Pkcs11Signer {
    state: Arc<Mutex<Pkcs11SessionState>>,
    public_key: PublicKey,
    key_label: String,
}

impl Pkcs11Signer {
    /// 获取硬件密钥对应的 SSH 公钥
    pub fn public_key(&self) -> &PublicKey {
        &self.public_key
    }

    /// 获取硬件密钥标签
    pub fn key_label(&self) -> &str {
        &self.key_label
    }

    /// 获取密钥算法类型
    pub fn algorithm(&self) -> Algorithm {
        self.public_key.algorithm()
    }
}

/// 签名器错误类型（满足 `russh::Signer::Error: From<russh::SendError>`）
#[derive(Debug, thiserror::Error)]
pub enum Pkcs11SignError {
    #[error("SSH send error: {0}")]
    Send(#[from] russh::SendError),
    #[error("PKCS#11 error: {0}")]
    Pkcs11(String),
}

impl Signer for Pkcs11Signer {
    type Error = Pkcs11SignError;

    async fn auth_sign(
        &mut self,
        _key: &AgentIdentity,
        hash_alg: Option<HashAlg>,
        to_sign: Vec<u8>,
    ) -> Result<Vec<u8>, Self::Error> {
        let state = Arc::clone(&self.state);
        tracing::info!("[PKCS11] auth_sign 被调用: hash_alg={:?}, len={}", hash_alg, to_sign.len());
        let (mut to_sign, sig_blob) = tokio::task::spawn_blocking(move || {
            let sig_blob = sign_with_session(&state, hash_alg, &to_sign)?;
            Ok::<_, Pkcs11SignError>((to_sign, sig_blob))
        })
        .await
        .map_err(|e| Pkcs11SignError::Pkcs11(format!("PKCS#11 signing task panicked: {}", e)))??;
        // russh::Signer::auth_sign 约定：必须把 `string(signature_blob)` 追加到原 `to_sign` 缓冲区末尾再整体返回
        push_ssh_string(&mut to_sign, &sig_blob);
        tracing::info!("[PKCS11] auth_sign 完成: total_len={}", to_sign.len());
        Ok(to_sign)
    }
}

fn sign_with_session(
    state: &Arc<Mutex<Pkcs11SessionState>>,
    hash_alg: Option<HashAlg>,
    to_sign: &[u8],
) -> Result<Vec<u8>, Pkcs11SignError> {
    let guard = state
        .lock()
        .map_err(|_| Pkcs11SignError::Pkcs11("PKCS#11 session lock poisoned".into()))?;

    match guard.key_kind {
        Pkcs11KeyKind::Rsa => {
            let (alg_name, mechanism) = match hash_alg {
                Some(HashAlg::Sha512) => ("rsa-sha2-512", Mechanism::Sha512RsaPkcs),
                Some(HashAlg::Sha256) => ("rsa-sha2-256", Mechanism::Sha256RsaPkcs),
                None => ("rsa-sha2-256", Mechanism::Sha256RsaPkcs),
                other => {
                    return Err(Pkcs11SignError::Pkcs11(format!(
                        "Unsupported RSA hash algorithm for PKCS#11: {:?}",
                        other
                    )));
                }
            };
            let raw_sig = guard
                .session
                .sign(&mechanism, guard.private_key, to_sign)
                .map_err(|e| Pkcs11SignError::Pkcs11(format!("PKCS#11 RSA sign failed: {}", e)))?;
            Ok(format_ssh_signature_blob(alg_name, &raw_sig))
        }
        Pkcs11KeyKind::Ecdsa(curve) => {
            // 使用标准 CKM_ECDSA 对摘要进行硬件签名，兼容性最高（OpenSC / YubiKey / SoftHSM 均支持）
            let digest: Vec<u8> = match curve {
                EcdsaCurve::NistP256 => Sha256::digest(to_sign).to_vec(),
                EcdsaCurve::NistP384 => Sha384::digest(to_sign).to_vec(),
                EcdsaCurve::NistP521 => Sha512::digest(to_sign).to_vec(),
            };
            let raw_sig = match guard
                .session
                .sign(&Mechanism::Ecdsa, guard.private_key, &digest)
            {
                Ok(sig) => sig,
                Err(first_err) => {
                    // 部分令牌仅开放组合机制 CKM_ECDSA_SHA*，自动回退一次
                    let fallback_mech = match curve {
                        EcdsaCurve::NistP256 => Mechanism::EcdsaSha256,
                        EcdsaCurve::NistP384 => Mechanism::EcdsaSha384,
                        EcdsaCurve::NistP521 => Mechanism::EcdsaSha512,
                    };
                    guard
                        .session
                        .sign(&fallback_mech, guard.private_key, to_sign)
                        .map_err(|e| {
                            Pkcs11SignError::Pkcs11(format!(
                                "PKCS#11 ECDSA sign failed (CKM_ECDSA: {}; fallback: {})",
                                first_err, e
                            ))
                        })?
                }
            };
            format_ecdsa_ssh_signature(curve, &raw_sig).map_err(Pkcs11SignError::Pkcs11)
        }
        Pkcs11KeyKind::Ed25519 => {
            let mech_ed25519 = Mechanism::Eddsa(EddsaParams::new(EddsaSignatureScheme::Ed25519));
            let raw_sig = match guard
                .session
                .sign(&mech_ed25519, guard.private_key, to_sign)
            {
                Ok(sig) => sig,
                Err(_) => {
                    let mech_pure = Mechanism::Eddsa(EddsaParams::new(EddsaSignatureScheme::Pure));
                    guard
                        .session
                        .sign(&mech_pure, guard.private_key, to_sign)
                        .map_err(|e| {
                            Pkcs11SignError::Pkcs11(format!("PKCS#11 Ed25519 sign failed: {}", e))
                        })?
                }
            };
            Ok(format_ssh_signature_blob("ssh-ed25519", &raw_sig))
        }
    }
}

/// 加载 PKCS#11 驱动并初始化签名器（在阻塞线程池中执行，避免阻塞 Tokio 调度器）
pub async fn load_pkcs11_signer(
    library_path: String,
    pin: Option<String>,
    key_hint: Option<String>,
) -> Result<Pkcs11Signer, String> {
    tokio::task::spawn_blocking(move || load_pkcs11_signer_sync(&library_path, pin.as_deref(), key_hint.as_deref()))
        .await
        .map_err(|e| format!("PKCS#11 initialization task panicked: {}", e))?
}

/// 枚举指定 PKCS#11 驱动中可用的硬件公钥身份（供设置/诊断列表使用）
pub async fn list_pkcs11_identities(
    library_path: String,
    pin: Option<String>,
) -> Result<Vec<Pkcs11IdentityInfo>, String> {
    tokio::task::spawn_blocking(move || list_pkcs11_identities_sync(&library_path, pin.as_deref()))
        .await
        .map_err(|e| format!("PKCS#11 enumeration task panicked: {}", e))?
}

fn init_pkcs11_context(library_path: &str) -> Result<Arc<Pkcs11>, String> {
    let trimmed = library_path.trim();
    if trimmed.is_empty() {
        return Err("PKCS#11 library path is empty".into());
    }
    let path = Path::new(trimmed);
    if !path.exists() {
        return Err(format!("PKCS#11 library not found: {}", trimmed));
    }
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let cache = PKCS11_CTX_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = cache
        .lock()
        .map_err(|_| "PKCS#11 context cache lock poisoned".to_string())?;
    if let Some(existing) = guard.get(&canonical) {
        return Ok(Arc::clone(existing));
    }

    let ctx = Pkcs11::new(&canonical)
        .map_err(|e| format!("Failed to load PKCS#11 library '{}': {}", trimmed, e))?;
    // 若同一驱动在进程内重复初始化，忽略 CryptokiAlreadyInitialized 等同类错误
    if let Err(e) = ctx.initialize(CInitializeArgs::OsThreads) {
        let msg = e.to_string();
        if !msg.contains("AlreadyInitialized") && !msg.contains("CRYPTOKI_ALREADY_INITIALIZED") {
            return Err(format!("Failed to initialize PKCS#11 library '{}': {}", trimmed, e));
        }
    }
    let arc = Arc::new(ctx);
    guard.insert(canonical, Arc::clone(&arc));
    Ok(arc)
}

fn login_if_pin_provided(session: &Session, pin: Option<&str>) -> Result<(), String> {
    if let Some(pin_str) = pin.filter(|s| !s.is_empty()) {
        let auth_pin = AuthPin::new(pin_str.to_owned());
        if let Err(e) = session.login(UserType::User, Some(&auth_pin)) {
            let msg = e.to_string();
            if !msg.contains("UserAlreadyLoggedIn") && !msg.contains("USER_ALREADY_LOGGED_IN") {
                return Err(format!("PKCS#11 PIN login failed: {}", e));
            }
        }
    }
    Ok(())
}

fn list_pkcs11_identities_sync(
    library_path: &str,
    pin: Option<&str>,
) -> Result<Vec<Pkcs11IdentityInfo>, String> {
    let ctx = init_pkcs11_context(library_path)?;
    let slots = ctx
        .get_slots_with_token()
        .map_err(|e| format!("Failed to enumerate PKCS#11 token slots: {}", e))?;

    let mut result = Vec::new();
    for slot in slots {
        let slot_label = ctx
            .get_token_info(slot)
            .map(|info| info.label().trim().to_string())
            .unwrap_or_else(|_| format!("Slot {}", slot.id()));

        let Ok(session) = ctx.open_ro_session(slot) else {
            continue;
        };
        let _ = login_if_pin_provided(&session, pin);

        let Ok(priv_keys) = session.find_objects(&[Attribute::Class(ObjectClass::PRIVATE_KEY)]) else {
            continue;
        };
        for priv_handle in priv_keys {
            if let Ok(resolved) = resolve_keypair_attributes(&session, priv_handle) {
                result.push(Pkcs11IdentityInfo {
                    slot_id: slot.id(),
                    slot_label: slot_label.clone(),
                    key_label: resolved.label,
                    key_id_hex: hex_encode(&resolved.id),
                    algorithm: resolved.public_key.algorithm().to_string(),
                    fingerprint: resolved.public_key.fingerprint(HashAlg::Sha256).to_string(),
                });
            }
        }
    }
    Ok(result)
}

fn load_pkcs11_signer_sync(
    library_path: &str,
    pin: Option<&str>,
    key_hint: Option<&str>,
) -> Result<Pkcs11Signer, String> {
    let ctx = init_pkcs11_context(library_path)?;
    let slots = ctx
        .get_slots_with_token()
        .map_err(|e| format!("Failed to enumerate PKCS#11 token slots: {}", e))?;

    if slots.is_empty() {
        return Err("No PKCS#11 hardware token / smart card detected".into());
    }

    let hint = key_hint.map(str::trim).filter(|s| !s.is_empty());
    let mut last_err: Option<String> = None;

    for slot in slots {
        let session = match ctx.open_ro_session(slot) {
            Ok(s) => s,
            Err(e) => {
                last_err = Some(format!("Open session on slot {} failed: {}", slot.id(), e));
                continue;
            }
        };

        if let Err(e) = login_if_pin_provided(&session, pin) {
            last_err = Some(e);
            continue;
        }

        let priv_keys = match session.find_objects(&[Attribute::Class(ObjectClass::PRIVATE_KEY)]) {
            Ok(keys) => keys,
            Err(e) => {
                last_err = Some(format!("Find private keys on slot {} failed: {}", slot.id(), e));
                continue;
            }
        };

        for priv_handle in priv_keys {
            let resolved = match resolve_keypair_attributes(&session, priv_handle) {
                Ok(r) => r,
                Err(e) => {
                    last_err = Some(e);
                    continue;
                }
            };

            if let Some(h) = hint {
                let id_hex = hex_encode(&resolved.id);
                let matches_label = resolved.label.eq_ignore_ascii_case(h)
                    || resolved.label.to_lowercase().contains(&h.to_lowercase());
                let matches_id = id_hex.eq_ignore_ascii_case(h);
                if !matches_label && !matches_id {
                    continue;
                }
            }

            let key_label = resolved.label;
            let public_key = resolved.public_key;
            let key_kind = resolved.key_kind;
            return Ok(Pkcs11Signer {
                state: Arc::new(Mutex::new(Pkcs11SessionState {
                    _ctx: ctx,
                    session,
                    private_key: priv_handle,
                    key_kind,
                })),
                public_key,
                key_label,
            });
        }
    }

    Err(last_err.unwrap_or_else(|| match hint {
        Some(h) => format!("No matching PKCS#11 key found for '{}'", h),
        None => "No usable SSH private key found on PKCS#11 token".into(),
    }))
}

struct ResolvedKeypair {
    label: String,
    id: Vec<u8>,
    key_kind: Pkcs11KeyKind,
    public_key: PublicKey,
}

fn resolve_keypair_attributes(
    session: &Session,
    priv_handle: ObjectHandle,
) -> Result<ResolvedKeypair, String> {
    let attrs = session
        .get_attributes(
            priv_handle,
            &[AttributeType::KeyType, AttributeType::Id, AttributeType::Label],
        )
        .map_err(|e| format!("Failed to read PKCS#11 private key attributes: {}", e))?;

    let mut key_type = None;
    let mut id_bytes = Vec::new();
    let mut label_bytes = Vec::new();

    for attr in attrs {
        match attr {
            Attribute::KeyType(kt) => key_type = Some(kt),
            Attribute::Id(v) => id_bytes = v,
            Attribute::Label(v) => label_bytes = v,
            _ => {}
        }
    }

    let key_type = key_type.ok_or_else(|| "PKCS#11 private key missing CKA_KEY_TYPE".to_string())?;
    let label = String::from_utf8_lossy(&label_bytes).trim().to_string();

    // 查找匹配的公钥对象（优先按 CKA_ID，其次按 CKA_LABEL，最后取同类型公钥）
    let pub_handle = find_matching_public_key(session, &id_bytes, &label_bytes)?
        .ok_or_else(|| format!("No matching public key object found for PKCS#11 key '{}'", label))?;

    let (key_kind, public_key) = match key_type {
        KeyType::RSA => {
            let pub_attrs = session
                .get_attributes(
                    pub_handle,
                    &[AttributeType::Modulus, AttributeType::PublicExponent],
                )
                .map_err(|e| format!("Failed to read RSA public key attributes: {}", e))?;
            let mut modulus = Vec::new();
            let mut exponent = Vec::new();
            for attr in pub_attrs {
                match attr {
                    Attribute::Modulus(m) => modulus = m,
                    Attribute::PublicExponent(e) => exponent = e,
                    _ => {}
                }
            }
            let pk = build_rsa_public_key(&exponent, &modulus)?;
            (Pkcs11KeyKind::Rsa, pk)
        }
        KeyType::EC => {
            let pub_attrs = session
                .get_attributes(pub_handle, &[AttributeType::EcParams, AttributeType::EcPoint])
                .map_err(|e| format!("Failed to read ECDSA public key attributes: {}", e))?;
            let mut ec_params = Vec::new();
            let mut ec_point = Vec::new();
            for attr in pub_attrs {
                match attr {
                    Attribute::EcParams(p) => ec_params = p,
                    Attribute::EcPoint(pt) => ec_point = pt,
                    _ => {}
                }
            }
            let curve = parse_ec_curve_from_params(&ec_params)?;
            let pk = build_ecdsa_public_key(curve, &ec_point)?;
            (Pkcs11KeyKind::Ecdsa(curve), pk)
        }
        KeyType::EC_EDWARDS => {
            let pub_attrs = session
                .get_attributes(pub_handle, &[AttributeType::EcPoint])
                .map_err(|e| format!("Failed to read Ed25519 public key attributes: {}", e))?;
            let mut ec_point = Vec::new();
            for attr in pub_attrs {
                if let Attribute::EcPoint(pt) = attr {
                    ec_point = pt;
                }
            }
            let pk = build_ed25519_public_key(&ec_point)?;
            (Pkcs11KeyKind::Ed25519, pk)
        }
        other => {
            return Err(format!("Unsupported PKCS#11 key type for SSH: {}", other));
        }
    };

    Ok(ResolvedKeypair {
        label,
        id: id_bytes,
        key_kind,
        public_key,
    })
}

fn find_matching_public_key(
    session: &Session,
    id_bytes: &[u8],
    label_bytes: &[u8],
) -> Result<Option<ObjectHandle>, String> {
    if !id_bytes.is_empty() {
        let found = session
            .find_objects(&[
                Attribute::Class(ObjectClass::PUBLIC_KEY),
                Attribute::Id(id_bytes.to_vec()),
            ])
            .map_err(|e| format!("Failed to search PKCS#11 public key by CKA_ID: {}", e))?;
        if let Some(first) = found.into_iter().next() {
            return Ok(Some(first));
        }
    }

    if !label_bytes.is_empty() {
        let found = session
            .find_objects(&[
                Attribute::Class(ObjectClass::PUBLIC_KEY),
                Attribute::Label(label_bytes.to_vec()),
            ])
            .map_err(|e| format!("Failed to search PKCS#11 public key by CKA_LABEL: {}", e))?;
        if let Some(first) = found.into_iter().next() {
            return Ok(Some(first));
        }
    }

    let found = session
        .find_objects(&[Attribute::Class(ObjectClass::PUBLIC_KEY)])
        .map_err(|e| format!("Failed to list PKCS#11 public keys: {}", e))?;
    Ok(found.into_iter().next())
}

// ==================== SSH Wire Encoding & ASN.1 Helpers ====================

fn push_ssh_string(buf: &mut Vec<u8>, data: &[u8]) {
    buf.extend_from_slice(&(data.len() as u32).to_be_bytes());
    buf.extend_from_slice(data);
}

fn encode_ssh_mpint(raw: &[u8]) -> Vec<u8> {
    let trimmed = match raw.iter().position(|&b| b != 0) {
        Some(idx) => &raw[idx..],
        None => return Vec::new(),
    };
    let mut out = Vec::with_capacity(trimmed.len() + 1);
    if trimmed[0] & 0x80 != 0 {
        out.push(0x00);
    }
    out.extend_from_slice(trimmed);
    out
}

fn push_ssh_mpint(buf: &mut Vec<u8>, raw: &[u8]) {
    let mpint = encode_ssh_mpint(raw);
    push_ssh_string(buf, &mpint);
}

pub(crate) fn build_rsa_public_key(exponent: &[u8], modulus: &[u8]) -> Result<PublicKey, String> {
    if exponent.is_empty() || modulus.is_empty() {
        return Err("RSA public key missing exponent or modulus".into());
    }
    let mut wire = Vec::new();
    push_ssh_string(&mut wire, b"ssh-rsa");
    push_ssh_mpint(&mut wire, exponent);
    push_ssh_mpint(&mut wire, modulus);
    PublicKey::from_bytes(&wire).map_err(|e| format!("Invalid RSA public key from PKCS#11: {}", e))
}

pub(crate) fn parse_ec_curve_from_params(ec_params: &[u8]) -> Result<EcdsaCurve, String> {
    // DER OBJECT IDENTIFIER:
    // P-256 (prime256v1 / secp256r1): 06 08 2A 86 48 CE 3D 03 01 07
    // P-384 (secp384r1):             06 05 2B 81 04 00 22
    // P-521 (secp521r1):             06 05 2B 81 04 00 23
    const OID_P256: &[u8] = &[0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07];
    const OID_P384: &[u8] = &[0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22];
    const OID_P521: &[u8] = &[0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x23];

    if ec_params == OID_P256 {
        Ok(EcdsaCurve::NistP256)
    } else if ec_params == OID_P384 {
        Ok(EcdsaCurve::NistP384)
    } else if ec_params == OID_P521 {
        Ok(EcdsaCurve::NistP521)
    } else {
        Err(format!(
            "Unsupported ECDSA curve OID in PKCS#11 CKA_EC_PARAMS: {}",
            hex_encode(ec_params)
        ))
    }
}

pub(crate) fn unwrap_der_octet_string(bytes: &[u8]) -> &[u8] {
    if bytes.len() >= 2 && bytes[0] == 0x04 {
        let len_byte = bytes[1];
        if len_byte & 0x80 == 0 {
            let len = len_byte as usize;
            if bytes.len() == 2 + len {
                return &bytes[2..];
            }
        } else {
            let num_len_bytes = (len_byte & 0x7f) as usize;
            if num_len_bytes > 0 && num_len_bytes <= 2 && bytes.len() >= 2 + num_len_bytes {
                let mut len = 0usize;
                for &b in &bytes[2..2 + num_len_bytes] {
                    len = (len << 8) | (b as usize);
                }
                if bytes.len() == 2 + num_len_bytes + len {
                    return &bytes[2 + num_len_bytes..];
                }
            }
        }
    }
    bytes
}

pub(crate) fn build_ecdsa_public_key(curve: EcdsaCurve, ec_point: &[u8]) -> Result<PublicKey, String> {
    let point = unwrap_der_octet_string(ec_point);
    if point.is_empty() || point[0] != 0x04 {
        return Err("ECDSA public key point is not an uncompressed SEC1 point".into());
    }
    let (alg, curve_id) = match curve {
        EcdsaCurve::NistP256 => ("ecdsa-sha2-nistp256", "nistp256"),
        EcdsaCurve::NistP384 => ("ecdsa-sha2-nistp384", "nistp384"),
        EcdsaCurve::NistP521 => ("ecdsa-sha2-nistp521", "nistp521"),
    };
    let mut wire = Vec::new();
    push_ssh_string(&mut wire, alg.as_bytes());
    push_ssh_string(&mut wire, curve_id.as_bytes());
    push_ssh_string(&mut wire, point);
    PublicKey::from_bytes(&wire)
        .map_err(|e| format!("Invalid ECDSA public key from PKCS#11: {}", e))
}

pub(crate) fn build_ed25519_public_key(ec_point: &[u8]) -> Result<PublicKey, String> {
    let raw = unwrap_der_octet_string(ec_point);
    if raw.len() != 32 {
        return Err(format!(
            "Invalid Ed25519 public key length from PKCS#11: expected 32, got {}",
            raw.len()
        ));
    }
    let mut wire = Vec::new();
    push_ssh_string(&mut wire, b"ssh-ed25519");
    push_ssh_string(&mut wire, raw);
    PublicKey::from_bytes(&wire)
        .map_err(|e| format!("Invalid Ed25519 public key from PKCS#11: {}", e))
}

pub(crate) fn format_ssh_signature_blob(alg_name: &str, raw_sig: &[u8]) -> Vec<u8> {
    let mut blob = Vec::with_capacity(8 + alg_name.len() + raw_sig.len());
    push_ssh_string(&mut blob, alg_name.as_bytes());
    push_ssh_string(&mut blob, raw_sig);
    blob
}

pub(crate) fn format_ecdsa_ssh_signature(
    curve: EcdsaCurve,
    raw_sig: &[u8],
) -> Result<Vec<u8>, String> {
    // PKCS#11 CKM_ECDSA 返回定长 r || s
    if raw_sig.len() < 2 || raw_sig.len() % 2 != 0 {
        return Err(format!(
            "Invalid PKCS#11 ECDSA raw signature length: {}",
            raw_sig.len()
        ));
    }
    let half = raw_sig.len() / 2;
    let (r, s) = (&raw_sig[..half], &raw_sig[half..]);

    let mut inner = Vec::with_capacity(raw_sig.len() + 10);
    push_ssh_mpint(&mut inner, r);
    push_ssh_mpint(&mut inner, s);

    let alg_name = match curve {
        EcdsaCurve::NistP256 => "ecdsa-sha2-nistp256",
        EcdsaCurve::NistP384 => "ecdsa-sha2-nistp384",
        EcdsaCurve::NistP521 => "ecdsa-sha2-nistp521",
    };
    Ok(format_ssh_signature_blob(alg_name, &inner))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_ssh_mpint_sign_padding() {
        assert_eq!(encode_ssh_mpint(&[0x00, 0x00, 0x01]), vec![0x01]);
        assert_eq!(encode_ssh_mpint(&[0x80, 0x01]), vec![0x00, 0x80, 0x01]);
        assert_eq!(encode_ssh_mpint(&[0x00, 0x00]), Vec::<u8>::new());
    }

    #[test]
    fn test_unwrap_der_octet_string() {
        let raw = vec![0xab; 32];
        let mut der = vec![0x04, 0x20];
        der.extend_from_slice(&raw);
        assert_eq!(unwrap_der_octet_string(&der), raw.as_slice());

        // Long-form length (0x81 0x85 -> 133 bytes for P-521 uncompressed point)
        let long_raw = vec![0x04; 133];
        let mut long_der = vec![0x04, 0x81, 0x85];
        long_der.extend_from_slice(&long_raw);
        assert_eq!(unwrap_der_octet_string(&long_der), long_raw.as_slice());

        // Raw non-DER input falls back as-is
        let raw_ed = vec![0x11; 32];
        assert_eq!(unwrap_der_octet_string(&raw_ed), raw_ed.as_slice());
    }

    #[test]
    fn test_build_ed25519_public_key_roundtrip() {
        let pub_bytes = [0x42u8; 32];
        let mut der = vec![0x04, 0x20];
        der.extend_from_slice(&pub_bytes);
        let pk = build_ed25519_public_key(&der).expect("Ed25519 public key should parse");
        assert_eq!(pk.algorithm(), Algorithm::Ed25519);
    }

    #[test]
    fn test_parse_ec_curve_from_params() {
        assert_eq!(
            parse_ec_curve_from_params(&[0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07])
                .unwrap(),
            EcdsaCurve::NistP256
        );
        assert_eq!(
            parse_ec_curve_from_params(&[0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22]).unwrap(),
            EcdsaCurve::NistP384
        );
        assert_eq!(
            parse_ec_curve_from_params(&[0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x23]).unwrap(),
            EcdsaCurve::NistP521
        );
    }

    #[test]
    fn test_format_ecdsa_ssh_signature_framing() {
        let mut raw_sig = vec![0x81; 32];
        raw_sig.extend_from_slice(&vec![0x01; 32]);
        let blob = format_ecdsa_ssh_signature(EcdsaCurve::NistP256, &raw_sig).unwrap();
        // Leading string is "ecdsa-sha2-nistp256" (19 bytes)
        assert_eq!(&blob[..4], &19u32.to_be_bytes());
        assert_eq!(&blob[4..23], b"ecdsa-sha2-nistp256");
    }

    #[test]
    fn test_format_rsa_and_ed25519_signature_framing() {
        let rsa = format_ssh_signature_blob("rsa-sha2-256", &[1, 2, 3, 4]);
        assert_eq!(&rsa[..4], &12u32.to_be_bytes());
        assert_eq!(&rsa[4..16], b"rsa-sha2-256");
        assert_eq!(&rsa[16..20], &4u32.to_be_bytes());
        assert_eq!(&rsa[20..24], &[1, 2, 3, 4]);

        // Verify russh Signer::auth_sign append framing: to_sign + string(sig_blob)
        let mut to_sign = vec![0xAA, 0xBB, 0xCC];
        push_ssh_string(&mut to_sign, &rsa);
        assert_eq!(&to_sign[..3], &[0xAA, 0xBB, 0xCC]);
        assert_eq!(&to_sign[3..7], &(rsa.len() as u32).to_be_bytes());
        assert_eq!(&to_sign[7..], rsa.as_slice());
    }
}
