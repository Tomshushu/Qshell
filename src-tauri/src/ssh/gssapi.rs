//! Kerberos / GSSAPI (`gssapi-with-mic`, RFC 4462) 企业单点登录认证支持。
//!
//! 跨平台零编译期 C 头文件依赖实现：
//! - **Windows**：直接调用系统原生 Win32 SSPI (`secur32.dll` / `Kerberos` SSP)，复用当前域登录凭据（TGT）；
//! - **macOS / Linux**：通过 `libloading` 在运行时动态加载 `GSS.framework/GSS` 或 `libgssapi_krb5.so.2`，
//!   复用 `kinit` 票据缓存；若系统未安装 Kerberos 运行库则返回清晰的引导错误。

use russh::{GssapiAuthenticator, GssapiError, GssapiStep};
use serde::{Deserialize, Serialize};

/// RFC 4462 / RFC 1964 Kerberos 5 机制 DER OID (`1.2.840.113554.1.2.2`)
pub const KRB5_MECH_OID: &[u8] = &[
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x12, 0x01, 0x02, 0x02,
];

/// GSSAPI 认证错误（满足 `russh::auth::GssapiAuthenticator::Error: From<russh::SendError>`）
#[derive(Debug, thiserror::Error)]
pub enum Krb5GssapiError {
    #[error("SSH send error: {0}")]
    Send(#[from] russh::SendError),
    #[error("GSSAPI / Kerberos error: {0}")]
    Gssapi(String),
}

/// 存储在 `agent_identity` 字段中的可选 GSSAPI 配置
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GssapiConfig {
    /// 可选自定义 SPN（例如 `host/prod-db.corp.local`，留空则自动使用 `host/<host>`）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spn: Option<String>,
    /// 是否允许向远端主机委派 Kerberos 凭据（`ISC_REQ_DELEGATE` / `GSS_C_DELEG_FLAG`）
    #[serde(default)]
    pub delegate: bool,
    /// 可选显式 Kerberos 主体（例如 `alice@CORP.LOCAL`），留空则复用系统当前域凭据
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub principal: Option<String>,
}

/// 解析来自服务器配置的 GSSAPI 参数（兼容 JSON 或纯文本 SPN）
pub fn parse_gssapi_config(raw: Option<&str>) -> GssapiConfig {
    let Some(trimmed) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return GssapiConfig::default();
    };
    if trimmed.starts_with('{') {
        if let Ok(mut cfg) = serde_json::from_str::<GssapiConfig>(trimmed) {
            cfg.spn = cfg.spn.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
            cfg.principal = cfg
                .principal
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            return cfg;
        }
    }
    GssapiConfig {
        spn: Some(trimmed.to_string()),
        delegate: false,
        principal: None,
    }
}

/// 格式化 Windows SSPI 目标 SPN（`service/host` 格式）
pub fn format_sspi_spn(host: &str, custom_spn: Option<&str>) -> String {
    match custom_spn.map(str::trim).filter(|s| !s.is_empty()) {
        Some(spn) => {
            if let Some((svc, rest)) = spn.split_once('@') {
                if !spn.contains('/') {
                    return format!("{}/{}", svc, rest);
                }
            }
            spn.to_string()
        }
        None => format!("host/{}", host.trim()),
    }
}

/// 格式化 Unix GSSAPI hostbased-service 名称（`service@host` 格式）
pub fn format_gssapi_hostbased_name(host: &str, custom_spn: Option<&str>) -> String {
    match custom_spn.map(str::trim).filter(|s| !s.is_empty()) {
        Some(spn) => {
            if let Some((svc, rest)) = spn.split_once('/') {
                format!("{}@{}", svc, rest)
            } else if spn.contains('@') {
                spn.to_string()
            } else {
                format!("host@{}", spn)
            }
        }
        None => format!("host@{}", host.trim()),
    }
}

/// Kerberos 5 GSSAPI 认证状态机
pub struct Krb5GssapiAuthenticator {
    backend: std::sync::Arc<std::sync::Mutex<platform::GssapiBackend>>,
}

impl Krb5GssapiAuthenticator {
    /// 为目标主机初始化 Kerberos GSSAPI 客户端上下文（在阻塞线程池中执行，避免阻塞 Tokio 调度器）
    pub async fn new(
        host: &str,
        target_spn: Option<&str>,
        delegate_credentials: bool,
        principal: Option<&str>,
        password: Option<&str>,
    ) -> Result<Self, String> {
        let host_owned = host.to_string();
        let spn_owned = target_spn.map(|s| s.to_string());
        let principal_owned = principal.map(|s| s.to_string());
        let password_owned = password.map(|s| s.to_string());
        let backend = tokio::task::spawn_blocking(move || {
            platform::GssapiBackend::new(
                &host_owned,
                spn_owned.as_deref(),
                delegate_credentials,
                principal_owned.as_deref(),
                password_owned.as_deref(),
            )
        })
        .await
        .map_err(|e| format!("GSSAPI initialization task panicked: {}", e))??;
        Ok(Self {
            backend: std::sync::Arc::new(std::sync::Mutex::new(backend)),
        })
    }
}

impl GssapiAuthenticator for Krb5GssapiAuthenticator {
    type Error = Krb5GssapiError;

    async fn gssapi_step(
        &mut self,
        selected_mechanism: Option<Vec<u8>>,
        input_token: Option<Vec<u8>>,
        mic_data: Vec<u8>,
    ) -> Result<GssapiStep, Self::Error> {
        if let Some(mech) = selected_mechanism {
            if mech != KRB5_MECH_OID {
                return Err(Krb5GssapiError::Gssapi(
                    "Server selected an unsupported GSSAPI mechanism (expected Kerberos 5)".into(),
                ));
            }
        }
        let backend = std::sync::Arc::clone(&self.backend);
        tokio::task::spawn_blocking(move || {
            let mut guard = backend
                .lock()
                .map_err(|_| Krb5GssapiError::Gssapi("GSSAPI backend lock poisoned".into()))?;
            guard
                .step(input_token.as_deref(), &mic_data)
                .map_err(Krb5GssapiError::Gssapi)
        })
        .await
        .map_err(|e| Krb5GssapiError::Gssapi(format!("GSSAPI step task panicked: {}", e)))?
    }

    async fn gssapi_error(&mut self, error: GssapiError) {
        tracing::warn!("[SSH/GSSAPI] Server returned GSSAPI error: {:?}", error);
    }
}

// ==================== Windows Win32 SSPI 后端 ====================

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::ffi::c_void;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{SEC_E_OK, SEC_I_CONTINUE_NEEDED};
    use windows_sys::Win32::Security::Authentication::Identity::{
        AcquireCredentialsHandleW, DeleteSecurityContext, FreeCredentialsHandle,
        InitializeSecurityContextW, MakeSignature, QueryContextAttributesW, SecBuffer,
        SecBufferDesc, SecPkgContext_Sizes, ISC_REQ_DELEGATE, ISC_REQ_INTEGRITY,
        ISC_REQ_MUTUAL_AUTH, SECBUFFER_DATA, SECBUFFER_TOKEN, SECBUFFER_VERSION,
        SECPKG_ATTR_SIZES, SECPKG_CRED_OUTBOUND, SECURITY_NATIVE_DREP,
    };
    use windows_sys::Win32::Security::Credentials::SecHandle;

    const SEC_WINNT_AUTH_IDENTITY_UNICODE: u32 = 0x0000_0002;

    #[repr(C)]
    #[allow(non_snake_case)]
    struct SecWinntAuthIdentityW {
        User: *mut u16,
        UserLength: u32,
        Domain: *mut u16,
        DomainLength: u32,
        Password: *mut u16,
        PasswordLength: u32,
        Flags: u32,
    }

    pub struct GssapiBackend {
        spn_wide: Vec<u16>,
        cred_handle: SecHandle,
        has_cred: bool,
        ctx_handle: SecHandle,
        has_ctx: bool,
        delegate: bool,
    }

    // SecHandle 为不透明句柄，仅在拥有 &mut self 的顺序异步状态机中使用
    unsafe impl Send for GssapiBackend {}

    impl Drop for GssapiBackend {
        fn drop(&mut self) {
            unsafe {
                if self.has_ctx {
                    DeleteSecurityContext(&self.ctx_handle);
                    self.has_ctx = false;
                }
                if self.has_cred {
                    FreeCredentialsHandle(&self.cred_handle);
                    self.has_cred = false;
                }
            }
        }
    }

    fn parse_sspi_identity(principal: Option<&str>) -> (String, String) {
        let trimmed = principal.map(str::trim).unwrap_or("");
        if trimmed.is_empty() {
            return (String::new(), String::new());
        }
        if let Some((user, domain)) = trimmed.split_once('@') {
            return (user.trim().to_string(), domain.trim().to_string());
        }
        if let Some((domain, user)) = trimmed.split_once('\\') {
            return (user.trim().to_string(), domain.trim().to_string());
        }
        (trimmed.to_string(), String::new())
    }

    fn format_sspi_error(stage: &str, status: i32) -> String {
        let code = status as u32;
        match code {
            0x8009030e => format!(
                "未找到可用的 Kerberos 凭据 (0x{:08x})：请确认当前电脑已加入 AD 域，或在服务器配置中填写可选的 Kerberos 账号（如 user@REALM）与密码",
                code
            ),
            0x80090303 => format!(
                "找不到目标服务器的主体 SPN (0x{:08x})：请检查主机名/SPN 是否正确，或 KDC 是否已注册 host/<主机名>",
                code
            ),
            0x80090311 => format!(
                "无法联系 Kerberos 域控 / KDC (0x{:08x})：请检查网络连通性、88 端口或 ksetup 域配置",
                code
            ),
            0x8009030c => format!("Kerberos 账号或密码被 KDC 拒绝 (0x{:08x})", code),
            _ => format!("Windows SSPI {} failed: 0x{:08x}", stage, code),
        }
    }

    impl GssapiBackend {
        pub fn new(
            host: &str,
            target_spn: Option<&str>,
            delegate: bool,
            principal: Option<&str>,
            password: Option<&str>,
        ) -> Result<Self, String> {
            let spn = format_sspi_spn(host, target_spn);
            let spn_wide: Vec<u16> = spn.encode_utf16().chain(std::iter::once(0)).collect();
            let package_wide: Vec<u16> = "Kerberos\0".encode_utf16().collect();

            let mut cred_handle = SecHandle { dwLower: 0, dwUpper: 0 };
            let mut expiry: i64 = 0;

            let has_explicit_auth = principal.map(str::trim).is_some_and(|s| !s.is_empty())
                || password.is_some_and(|s| !s.is_empty());
            let (user_u16, domain_u16, pass_u16) = if has_explicit_auth {
                let (u, d) = parse_sspi_identity(principal);
                let p = password.unwrap_or("");
                (
                    u.encode_utf16().collect::<Vec<u16>>(),
                    d.encode_utf16().collect::<Vec<u16>>(),
                    p.encode_utf16().collect::<Vec<u16>>(),
                )
            } else {
                (Vec::new(), Vec::new(), Vec::new())
            };
            let auth_identity = has_explicit_auth.then(|| SecWinntAuthIdentityW {
                User: if user_u16.is_empty() { null_mut() } else { user_u16.as_ptr() as *mut u16 },
                UserLength: user_u16.len() as u32,
                Domain: if domain_u16.is_empty() { null_mut() } else { domain_u16.as_ptr() as *mut u16 },
                DomainLength: domain_u16.len() as u32,
                Password: if pass_u16.is_empty() { null_mut() } else { pass_u16.as_ptr() as *mut u16 },
                PasswordLength: pass_u16.len() as u32,
                Flags: SEC_WINNT_AUTH_IDENTITY_UNICODE,
            });
            let p_auth_data = auth_identity
                .as_ref()
                .map(|id| id as *const _ as *const c_void)
                .unwrap_or(null());

            let status = unsafe {
                AcquireCredentialsHandleW(
                    null(),
                    package_wide.as_ptr(),
                    SECPKG_CRED_OUTBOUND,
                    null(),
                    p_auth_data,
                    None,
                    null(),
                    &mut cred_handle,
                    &mut expiry,
                )
            };

            if status != SEC_E_OK {
                return Err(format_sspi_error("AcquireCredentialsHandleW(Kerberos)", status));
            }

            Ok(Self {
                spn_wide,
                cred_handle,
                has_cred: true,
                ctx_handle: SecHandle { dwLower: 0, dwUpper: 0 },
                has_ctx: false,
                delegate,
            })
        }

        pub fn step(
            &mut self,
            input_token: Option<&[u8]>,
            mic_data: &[u8],
        ) -> Result<GssapiStep, String> {
            let mut in_buf_storage = input_token.unwrap_or(&[]).to_vec();
            let mut in_sec_buf = SecBuffer {
                cbBuffer: in_buf_storage.len() as u32,
                BufferType: SECBUFFER_TOKEN,
                pvBuffer: if in_buf_storage.is_empty() {
                    null_mut()
                } else {
                    in_buf_storage.as_mut_ptr() as *mut c_void
                },
            };
            let in_desc = SecBufferDesc {
                ulVersion: SECBUFFER_VERSION,
                cBuffers: 1,
                pBuffers: &mut in_sec_buf,
            };
            let p_input = if input_token.is_some() {
                &in_desc as *const SecBufferDesc
            } else {
                null()
            };

            // 64 KiB 输出缓冲区足以容纳包含 PAC 的 Kerberos AP-REQ 令牌
            let mut out_storage = vec![0u8; 65536];
            let mut out_sec_buf = SecBuffer {
                cbBuffer: out_storage.len() as u32,
                BufferType: SECBUFFER_TOKEN,
                pvBuffer: out_storage.as_mut_ptr() as *mut c_void,
            };
            let mut out_desc = SecBufferDesc {
                ulVersion: SECBUFFER_VERSION,
                cBuffers: 1,
                pBuffers: &mut out_sec_buf,
            };

            let mut req_flags = ISC_REQ_MUTUAL_AUTH | ISC_REQ_INTEGRITY;
            if self.delegate {
                req_flags |= ISC_REQ_DELEGATE;
            }

            let p_ctx = if self.has_ctx {
                &self.ctx_handle as *const SecHandle
            } else {
                null()
            };
            let mut new_ctx = SecHandle { dwLower: 0, dwUpper: 0 };
            let mut ret_attr: u32 = 0;
            let mut expiry: i64 = 0;

            let status = unsafe {
                InitializeSecurityContextW(
                    &self.cred_handle,
                    p_ctx,
                    self.spn_wide.as_ptr(),
                    req_flags,
                    0,
                    SECURITY_NATIVE_DREP,
                    p_input,
                    0,
                    &mut new_ctx,
                    &mut out_desc,
                    &mut ret_attr,
                    &mut expiry,
                )
            };

            if status != SEC_E_OK && status != SEC_I_CONTINUE_NEEDED {
                return Err(format_sspi_error("InitializeSecurityContextW", status));
            }

            self.ctx_handle = new_ctx;
            self.has_ctx = true;

            let out_len = out_sec_buf.cbBuffer as usize;
            let out_token = if out_len > 0 {
                Some(out_storage[..out_len].to_vec())
            } else {
                None
            };

            if status == SEC_I_CONTINUE_NEEDED {
                return Ok(GssapiStep::Continue {
                    token: out_token.unwrap_or_default(),
                });
            }

            let mic = self.compute_mic(mic_data)?;
            Ok(GssapiStep::Complete {
                token: out_token,
                mic: Some(mic),
            })
        }

        fn compute_mic(&self, mic_data: &[u8]) -> Result<Vec<u8>, String> {
            let mut sizes = SecPkgContext_Sizes {
                cbMaxToken: 0,
                cbMaxSignature: 0,
                cbBlockSize: 0,
                cbSecurityTrailer: 0,
            };
            let q_status = unsafe {
                QueryContextAttributesW(
                    &self.ctx_handle,
                    SECPKG_ATTR_SIZES,
                    &mut sizes as *mut SecPkgContext_Sizes as *mut c_void,
                )
            };
            if q_status != SEC_E_OK {
                return Err(format!(
                    "Windows SSPI QueryContextAttributesW(SECPKG_ATTR_SIZES) failed: 0x{:08x}",
                    q_status as u32
                ));
            }

            let max_sig = (sizes.cbMaxSignature as usize).max(256);
            let mut data_copy = mic_data.to_vec();
            let mut sig_buf = vec![0u8; max_sig];

            let mut buffers = [
                SecBuffer {
                    cbBuffer: data_copy.len() as u32,
                    BufferType: SECBUFFER_DATA,
                    pvBuffer: if data_copy.is_empty() {
                        null_mut()
                    } else {
                        data_copy.as_mut_ptr() as *mut c_void
                    },
                },
                SecBuffer {
                    cbBuffer: sig_buf.len() as u32,
                    BufferType: SECBUFFER_TOKEN,
                    pvBuffer: sig_buf.as_mut_ptr() as *mut c_void,
                },
            ];
            let desc = SecBufferDesc {
                ulVersion: SECBUFFER_VERSION,
                cBuffers: 2,
                pBuffers: buffers.as_mut_ptr(),
            };

            let status = unsafe { MakeSignature(&self.ctx_handle, 0, &desc, 0) };
            if status != SEC_E_OK {
                return Err(format!(
                    "Windows SSPI MakeSignature failed: 0x{:08x}",
                    status as u32
                ));
            }

            let actual_len = buffers[1].cbBuffer as usize;
            Ok(sig_buf[..actual_len].to_vec())
        }
    }
}

// ==================== macOS / Linux 运行时动态加载 libgssapi 后端 ====================

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::*;
    use libloading::{Library, Symbol};
    use std::ffi::c_void;
    use std::ptr::{null, null_mut};

    const GSS_S_COMPLETE: u32 = 0;
    const GSS_S_CONTINUE_NEEDED: u32 = 1;
    const GSS_C_DELEG_FLAG: u32 = 1;
    const GSS_C_MUTUAL_FLAG: u32 = 2;
    const GSS_C_INTEG_FLAG: u32 = 32;
    const GSS_C_QOP_DEFAULT: u32 = 0;

    // GSS_C_NT_HOSTBASED_SERVICE OID: 1.2.840.113554.1.2.1.4
    static HOSTBASED_SERVICE_OID_BYTES: [u8; 10] = [
        0x2a, 0x86, 0x48, 0x86, 0xf7, 0x12, 0x01, 0x02, 0x01, 0x04,
    ];

    #[repr(C)]
    struct GssOidDesc {
        length: u32,
        elements: *mut c_void,
    }

    #[repr(C)]
    struct GssBufferDesc {
        length: usize,
        value: *mut c_void,
    }

    type GssNameT = *mut c_void;
    type GssCtxIdT = *mut c_void;
    type GssCredIdT = *mut c_void;
    type GssOid = *mut GssOidDesc;
    type GssChannelBindingsT = *mut c_void;

    type FnImportName = unsafe extern "C" fn(
        minor_status: *mut u32,
        input_name_buffer: *const GssBufferDesc,
        input_name_type: GssOid,
        output_name: *mut GssNameT,
    ) -> u32;

    type FnInitSecContext = unsafe extern "C" fn(
        minor_status: *mut u32,
        claimant_cred_handle: GssCredIdT,
        context_handle: *mut GssCtxIdT,
        target_name: GssNameT,
        mech_type: GssOid,
        req_flags: u32,
        time_req: u32,
        input_chan_bindings: GssChannelBindingsT,
        input_token: *const GssBufferDesc,
        actual_mech_type: *mut GssOid,
        output_token: *mut GssBufferDesc,
        ret_flags: *mut u32,
        time_rec: *mut u32,
    ) -> u32;

    type FnGetMic = unsafe extern "C" fn(
        minor_status: *mut u32,
        context_handle: GssCtxIdT,
        qop_req: u32,
        message_buffer: *const GssBufferDesc,
        message_token: *mut GssBufferDesc,
    ) -> u32;

    type FnReleaseBuffer =
        unsafe extern "C" fn(minor_status: *mut u32, buffer: *mut GssBufferDesc) -> u32;
    type FnReleaseName =
        unsafe extern "C" fn(minor_status: *mut u32, name: *mut GssNameT) -> u32;
    type FnDeleteSecContext = unsafe extern "C" fn(
        minor_status: *mut u32,
        context_handle: *mut GssCtxIdT,
        output_token: *mut GssBufferDesc,
    ) -> u32;

    pub struct GssapiBackend {
        lib: Library,
        target_name: GssNameT,
        ctx_handle: GssCtxIdT,
        delegate: bool,
    }

    unsafe impl Send for GssapiBackend {}

    impl Drop for GssapiBackend {
        fn drop(&mut self) {
            unsafe {
                let mut minor = 0u32;
                if !self.ctx_handle.is_null() {
                    if let Ok(delete_ctx) =
                        self.lib.get::<FnDeleteSecContext>(b"gss_delete_sec_context\0")
                    {
                        delete_ctx(&mut minor, &mut self.ctx_handle, null_mut());
                    }
                }
                if !self.target_name.is_null() {
                    if let Ok(release_name) =
                        self.lib.get::<FnReleaseName>(b"gss_release_name\0")
                    {
                        release_name(&mut minor, &mut self.target_name);
                    }
                }
            }
        }
    }

    impl GssapiBackend {
        pub fn new(
            host: &str,
            target_spn: Option<&str>,
            delegate: bool,
            _principal: Option<&str>,
            _password: Option<&str>,
        ) -> Result<Self, String> {
            let candidates: &[&str] = if cfg!(target_os = "macos") {
                &[
                    "/System/Library/Frameworks/GSS.framework/GSS",
                    "libgssapi_krb5.dylib",
                ]
            } else {
                &[
                    "libgssapi_krb5.so.2",
                    "libgssapi_krb5.so",
                    "libgssapi.so.3",
                ]
            };

            let mut loaded: Option<Library> = None;
            for path in candidates {
                if let Ok(lib) = unsafe { Library::new(path) } {
                    loaded = Some(lib);
                    break;
                }
            }
            let lib = loaded.ok_or_else(|| {
                "No system Kerberos / GSSAPI shared library found (expected libgssapi_krb5 or macOS GSS.framework)".to_string()
            })?;

            let service_name = format_gssapi_hostbased_name(host, target_spn);
            let mut service_bytes = service_name.into_bytes();
            let name_buf = GssBufferDesc {
                length: service_bytes.len(),
                value: service_bytes.as_mut_ptr() as *mut c_void,
            };
            let mut hostbased_oid = GssOidDesc {
                length: HOSTBASED_SERVICE_OID_BYTES.len() as u32,
                elements: HOSTBASED_SERVICE_OID_BYTES.as_ptr() as *mut c_void,
            };

            let import_name: Symbol<FnImportName> = unsafe {
                lib.get(b"gss_import_name\0")
                    .map_err(|e| format!("Failed to resolve gss_import_name: {}", e))?
            };
            let mut minor = 0u32;
            let mut target_name: GssNameT = null_mut();
            let major = unsafe {
                import_name(&mut minor, &name_buf, &mut hostbased_oid, &mut target_name)
            };
            if major != GSS_S_COMPLETE || target_name.is_null() {
                return Err(format!(
                    "gss_import_name failed: major=0x{:08x} minor=0x{:08x}",
                    major, minor
                ));
            }

            Ok(Self {
                lib,
                target_name,
                ctx_handle: null_mut(),
                delegate,
            })
        }

        pub fn step(
            &mut self,
            input_token: Option<&[u8]>,
            mic_data: &[u8],
        ) -> Result<GssapiStep, String> {
            let init_sec_context: Symbol<FnInitSecContext> = unsafe {
                self.lib
                    .get(b"gss_init_sec_context\0")
                    .map_err(|e| format!("Failed to resolve gss_init_sec_context: {}", e))?
            };
            let release_buffer: Symbol<FnReleaseBuffer> = unsafe {
                self.lib
                    .get(b"gss_release_buffer\0")
                    .map_err(|e| format!("Failed to resolve gss_release_buffer: {}", e))?
            };

            // DER OID 值部分（去掉 06 09 头部）
            let mut krb5_oid = GssOidDesc {
                length: (KRB5_MECH_OID.len() - 2) as u32,
                elements: KRB5_MECH_OID[2..].as_ptr() as *mut c_void,
            };

            let mut in_storage = input_token.unwrap_or(&[]).to_vec();
            let in_buf = GssBufferDesc {
                length: in_storage.len(),
                value: if in_storage.is_empty() {
                    null_mut()
                } else {
                    in_storage.as_mut_ptr() as *mut c_void
                },
            };
            let p_in = if input_token.is_some() {
                &in_buf as *const GssBufferDesc
            } else {
                null()
            };

            let mut out_buf = GssBufferDesc {
                length: 0,
                value: null_mut(),
            };
            let mut req_flags = GSS_C_MUTUAL_FLAG | GSS_C_INTEG_FLAG;
            if self.delegate {
                req_flags |= GSS_C_DELEG_FLAG;
            }
            let mut minor = 0u32;
            let mut ret_flags = 0u32;
            let major = unsafe {
                init_sec_context(
                    &mut minor,
                    null_mut(),
                    &mut self.ctx_handle,
                    self.target_name,
                    &mut krb5_oid,
                    req_flags,
                    0,
                    null_mut(),
                    p_in,
                    null_mut(),
                    &mut out_buf,
                    &mut ret_flags,
                    null_mut(),
                )
            };

            let out_token = if out_buf.length > 0 && !out_buf.value.is_null() {
                let slice = unsafe {
                    std::slice::from_raw_parts(out_buf.value as *const u8, out_buf.length)
                };
                let v = slice.to_vec();
                let mut rel_minor = 0u32;
                unsafe { release_buffer(&mut rel_minor, &mut out_buf) };
                Some(v)
            } else {
                None
            };

            if major == GSS_S_CONTINUE_NEEDED {
                return Ok(GssapiStep::Continue {
                    token: out_token.unwrap_or_default(),
                });
            }
            if major != GSS_S_COMPLETE {
                return Err(format!(
                    "gss_init_sec_context failed: major=0x{:08x} minor=0x{:08x} (verify kinit ticket & SPN)",
                    major, minor
                ));
            }

            let get_mic: Symbol<FnGetMic> = unsafe {
                self.lib
                    .get(b"gss_get_mic\0")
                    .map_err(|e| format!("Failed to resolve gss_get_mic: {}", e))?
            };
            let mut msg_copy = mic_data.to_vec();
            let msg_buf = GssBufferDesc {
                length: msg_copy.len(),
                value: if msg_copy.is_empty() {
                    null_mut()
                } else {
                    msg_copy.as_mut_ptr() as *mut c_void
                },
            };
            let mut mic_buf = GssBufferDesc {
                length: 0,
                value: null_mut(),
            };
            let mut mic_minor = 0u32;
            let mic_major = unsafe {
                get_mic(
                    &mut mic_minor,
                    self.ctx_handle,
                    GSS_C_QOP_DEFAULT,
                    &msg_buf,
                    &mut mic_buf,
                )
            };
            if mic_major != GSS_S_COMPLETE {
                return Err(format!(
                    "gss_get_mic failed: major=0x{:08x} minor=0x{:08x}",
                    mic_major, mic_minor
                ));
            }
            let mic = if mic_buf.length > 0 && !mic_buf.value.is_null() {
                let slice = unsafe {
                    std::slice::from_raw_parts(mic_buf.value as *const u8, mic_buf.length)
                };
                let v = slice.to_vec();
                let mut rel_minor = 0u32;
                unsafe { release_buffer(&mut rel_minor, &mut mic_buf) };
                v
            } else {
                Vec::new()
            };

            Ok(GssapiStep::Complete {
                token: out_token,
                mic: Some(mic),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_krb5_oid_der_encoding() {
        assert_eq!(KRB5_MECH_OID[0], 0x06);
        assert_eq!(KRB5_MECH_OID[1] as usize, KRB5_MECH_OID.len() - 2);
    }

    #[test]
    fn test_parse_gssapi_config() {
        assert_eq!(parse_gssapi_config(None), GssapiConfig::default());
        assert_eq!(parse_gssapi_config(Some("  ")), GssapiConfig::default());
        assert_eq!(
            parse_gssapi_config(Some("host/db.corp.local")),
            GssapiConfig {
                spn: Some("host/db.corp.local".into()),
                delegate: false,
                principal: None,
            }
        );
        assert_eq!(
            parse_gssapi_config(Some(r#"{"spn":"host/app.corp.local","delegate":true}"#)),
            GssapiConfig {
                spn: Some("host/app.corp.local".into()),
                delegate: true,
                principal: None,
            }
        );
    }

    #[test]
    fn test_spn_formatting() {
        assert_eq!(format_sspi_spn("10.0.0.1", None), "host/10.0.0.1");
        assert_eq!(
            format_sspi_spn("10.0.0.1", Some("host@db.corp.local")),
            "host/db.corp.local"
        );
        assert_eq!(
            format_gssapi_hostbased_name("web.corp.local", None),
            "host@web.corp.local"
        );
        assert_eq!(
            format_gssapi_hostbased_name("web.corp.local", Some("host/custom.corp.local")),
            "host@custom.corp.local"
        );
    }
}
